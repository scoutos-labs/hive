/**
 * Hive - ACP Spawn Protocol
 * 
 * Bidirectional ACP communication with spawned processes.
 * Enables:
 * - Sending ACP task messages via stdin
 * - Receiving ACP responses/progress via stdout
 * - Handling clarification requests
 * - Real-time progress events
 */

import { spawn, ChildProcess } from 'child_process';
import type { Agent, Mention, Channel, Post } from '../../types.js';
import type {
  ACPProgressPayload,
  ACPResponsePayload,
  ACPClarificationPayload,
} from '../../types/acp.js';
import {
  parseAgentOutput,
  formatAgentOutputForPost,
  createACPTaskMessage,
  createACPClarificationResponse,
} from './format.js';
import { emitHiveEvent } from '../events.js';
import { updateMentionStatus, createSpawnErrorPost } from '../spawn.js';
import { getSpawnConfig } from '../spawn-config.js';
import { checkCommandAllowed, validateSpawnArgs } from '../spawn-allowlist.js';
import { createPost } from '../channels.js';

// ============================================================================
// Logging Helper
// ============================================================================

const log = {
  info: (msg: string, ...args: unknown[]) => console.log(`[acp-spawn] ${msg}`, ...args),
  error: (msg: string, ...args: unknown[]) => console.error(`[acp-spawn] ${msg}`, ...args),
  debug: (msg: string, ...args: unknown[]) => {
    if (process.env.ACP_DEBUG === 'true' || process.env.DEBUG === 'true') {
      console.log(`[acp-spawn:debug] ${msg}`, ...args);
    }
  },
};

// ============================================================================
// Types
// ============================================================================

export interface ACPSpawnOptions {
  agent: Agent;
  mention: Mention;
  channel: Channel;
  post: Post;
  chainDepth: number;
}

export interface ACPSpawnResult {
  success: boolean;
  status: 'completed' | 'failed' | 'clarifying';
  exitCode: number | null;
  output?: string;
  error?: string;
  response?: ACPResponsePayload;
  clarification?: ACPClarificationPayload;
}

export interface ACPClarificationHandler {
  onClarification: (questions: ACPClarificationPayload['questions']) => Promise<Record<string, string | string[]>>;
}

// ============================================================================
// ACP Spawn State
// ============================================================================

/** Tracks active ACP spawns for clarification handling */
const activeSpawns = new Map<string, {
  process: ChildProcess;
  mentionId: string;
  agentId: string;
  clarificationResolve?: (answers: Record<string, string | string[]>) => void;
}>();

export type ActiveSpawn = ReturnType<typeof activeSpawns.get>;

// ============================================================================
// Check if agent supports ACP
// ============================================================================

export function agentSupportsACP(agent: Agent): boolean {
  return agent.acp?.protocol === 'acp/1.0';
}

// ============================================================================
// Send ACP Task Message via stdin
// ============================================================================

function sendACPTaskMessage(
  child: ChildProcess,
  params: {
    taskId: string;
    channelId: string;
    channelName?: string;
    cwd?: string;
    fromAgent: string;
    content: string;
    chainDepth: number;
  }
): boolean {
  const message = createACPTaskMessage(params);
  
  if (!child.stdin) {
    console.error('[acp-spawn] Child process has no stdin');
    return false;
  }
  
  try {
    child.stdin.write(message + '\n');
    console.log(`[acp-spawn] Sent ACP task message to ${child.pid}`);
    return true;
  } catch (err) {
    console.error('[acp-spawn] Failed to send ACP message:', err);
    return false;
  }
}

// ============================================================================
// Send Clarification Response via stdin
// ============================================================================

function sendClarificationResponse(
  child: ChildProcess,
  taskId: string,
  answers: Record<string, string | string[]>
): boolean {
  const message = createACPClarificationResponse(taskId, answers);
  
  if (!child.stdin) {
    console.error('[acp-spawn] Child process has no stdin');
    return false;
  }
  
  try {
    child.stdin.write(message + '\n');
    console.log(`[acp-spawn] Sent clarification response to ${child.pid}`);
    return true;
  } catch (err) {
    console.error('[acp-spawn] Failed to send clarification response:', err);
    return false;
  }
}

// ============================================================================
// Parse ACP Messages from stdout
// ============================================================================

function parseACPLine(line: string): { type: string; payload: unknown } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && 'type' in parsed) {
      return { type: parsed.type, payload: parsed.payload || parsed };
    }
  } catch {
    // Not JSON, return null
  }
  return null;
}

// ============================================================================
// Spawn Agent with ACP Protocol
// ============================================================================

export async function spawnAgentACP(
  options: ACPSpawnOptions
): Promise<ACPSpawnResult> {
  const { agent, mention, channel, post, chainDepth } = options;
  const cfg = getSpawnConfig();

  const command = (agent.spawnCommand || 'openclaw').trim();
  const args = agent.spawnArgs || [];

  // Validate command and args
  const cmdCheck = checkCommandAllowed(command);
  if (!cmdCheck.allowed) {
    return {
      success: false,
      status: 'failed',
      exitCode: null,
      error: cmdCheck.reason || 'Command not allowed',
    };
  }

  const argsError = validateSpawnArgs(args);
  if (argsError) {
    return {
      success: false,
      status: 'failed',
      exitCode: null,
      error: argsError,
    };
  }

  const spawnCwd = channel.cwd || agent.cwd;

  // Resolve placeholders in args
  const resolvedArgs = args.map(arg => {
    if (arg === '$WORKSPACE' && spawnCwd) return spawnCwd;
    if (arg === '$MENTION_CONTENT') return post.content;
    return arg;
  });

  return new Promise((resolve) => {
    let stdoutBuf = '';
    let stderrBuf = '';
    let finalResponse: ACPResponsePayload | undefined;
    let clarification: ACPClarificationPayload | undefined;
    const progressEvents: ACPProgressPayload[] = [];

    console.log(`[acp-spawn] Spawning ${agent.id} for mention ${mention.id}`);

    // Create stdin pipe for bidirectional communication
    const child = spawn(command, resolvedArgs, {
      cwd: spawnCwd,
      env: {
        ...process.env,
        MENTION_ID: mention.id,
        CHANNEL_ID: channel.id,
        CHANNEL_NAME: channel.name,
        CHANNEL_CWD: spawnCwd || '',
        POST_ID: post.id,
        FROM_AGENT: mention.mentioningAgentId || 'unknown',
        MENTION_CONTENT: post.content,
        HIVE_CHAIN_DEPTH: String(chainDepth),
        ACP_PROTOCOL: '1.0', // Signal ACP support to agent
      },
      stdio: ['pipe', 'pipe', 'pipe'], // Enable stdin
    });

    // Track active spawn
    activeSpawns.set(mention.id, {
      process: child,
      mentionId: mention.id,
      agentId: agent.id,
    });

    // Update status to running
    updateMentionStatus(mention.id, 'running').catch(() => {});
    emitHiveEvent('task.started', {
      taskId: mention.id,
      mentionId: mention.id,
      agentId: agent.id,
      channelId: channel.id,
      postId: post.id,
      chainDepth,
    }, 'acp-spawn:start').catch(() => {});

    // Send ACP task message via stdin
    sendACPTaskMessage(child, {
      taskId: mention.id,
      channelId: channel.id,
      channelName: channel.name,
      cwd: spawnCwd,
      fromAgent: mention.mentioningAgentId || 'unknown',
      content: post.content,
      chainDepth,
    });

    // Handle stdout - parse ACP messages
    child.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stdoutBuf += chunk;
      console.log(`[acp-spawn:${agent.id}:out] ${chunk.slice(0, 200)}`);

      // Parse lines for ACP messages
      const lines = chunk.split('\n');
      for (const line of lines) {
        const parsed = parseACPLine(line);
        if (!parsed) continue;

        switch (parsed.type) {
          case 'progress':
            const progress = parsed.payload as ACPProgressPayload;
            progressEvents.push(progress);
            emitHiveEvent('task.progress', {
              taskId: mention.id,
              mentionId: mention.id,
              agentId: agent.id,
              channelId: channel.id,
              percent: progress.percent,
              message: progress.message,
              stage: progress.stage,
            }, 'acp-spawn:progress').catch(() => {});
            break;

          case 'response':
            finalResponse = parsed.payload as ACPResponsePayload;
            break;

          case 'clarification':
            clarification = parsed.payload as ACPClarificationPayload;
            // Signal that we need clarification
            // The spawn promise will be resolved with clarifying status
            break;

          case 'error':
            stderrBuf += (parsed.payload as { message?: string })?.message || JSON.stringify(parsed.payload);
            break;
        }
      }
    });

    // Handle stderr
    child.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stderrBuf += chunk;
      log.error(`stderr: ${chunk.slice(0, 200)}${chunk.length > 200 ? '...' : ''}`);
    });

    // Timeout
    const timeoutHandle = setTimeout(() => {
      if (child.killed) return;
      log.error(`Agent ${agent.id} timed out after ${cfg.timeoutMs}ms`);
      child.kill('SIGKILL');
      activeSpawns.delete(mention.id);
      resolve({
        success: false,
        status: 'failed',
        exitCode: null,
        error: `Timeout after ${cfg.timeoutMs}ms`,
      });
    }, cfg.timeoutMs);

    // Handle completion
    child.on('close', async (code) => {
      clearTimeout(timeoutHandle);
      activeSpawns.delete(mention.id);
      log.info(`Agent ${agent.id} closed with exit code ${code}`);
      log.debug(`stdout length: ${stdoutBuf.length}, stderr length: ${stderrBuf.length}`);

      const parsedOutput = formatAgentOutputForPost({
        ...parseAgentOutput(stdoutBuf, mention.id),
      });
      const completedSuccessfully = code === 0 && finalResponse?.status !== 'failed' && !stderrBuf.trim();

      // Determine status
      let status: 'completed' | 'failed' | 'clarifying';
      if (clarification && !finalResponse) {
        status = 'clarifying';
      } else if (completedSuccessfully) {
        status = 'completed';
      } else {
        status = 'failed';
      }

      // Update mention
      await updateMentionStatus(
        mention.id,
        status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'running',
        finalResponse?.message || parsedOutput,
        stderrBuf || undefined
      );

      // Create response post if completed
      if (status === 'completed' && (finalResponse?.message || parsedOutput)) {
        await createPost(channel.id, {
          authorId: agent.id,
          content: parsedOutput || finalResponse?.message || 'Task completed',
        });
      }

      // Emit completion event
      await emitHiveEvent(
        status === 'completed' ? 'task.completed' : 'task.failed',
        {
          taskId: mention.id,
          mentionId: mention.id,
          agentId: agent.id,
          channelId: channel.id,
          postId: post.id,
          exitCode: code,
          error: stderrBuf || undefined,
        },
        'acp-spawn:close'
      );

      resolve({
        success: status === 'completed',
        status,
        exitCode: code,
        output: finalResponse?.message || parsedOutput,
        error: stderrBuf || undefined,
        response: finalResponse,
        clarification,
      });
    });

    // Handle error
    child.on('error', async (err) => {
      clearTimeout(timeoutHandle);
      activeSpawns.delete(mention.id);

      console.error(`[acp-spawn] Process error:`, err);
      await updateMentionStatus(mention.id, 'failed', undefined, err.message);
      await createSpawnErrorPost({
        channelId: channel.id,
        mentionId: mention.id,
        agentId: agent.id,
        spawnError: err.message,
        exitCode: null,
      });

      resolve({
        success: false,
        status: 'failed',
        exitCode: null,
        error: err.message,
      });
    });
  });
}

// ============================================================================
// Handle Clarification Response (External API)
// ============================================================================

export async function handleClarificationResponse(
  mentionId: string,
  answers: Record<string, string | string[]>
): Promise<boolean> {
  const spawnState = activeSpawns.get(mentionId);
  if (!spawnState) {
    console.error(`[acp-spawn] No active spawn for mention ${mentionId}`);
    return false;
  }

  const success = sendClarificationResponse(
    spawnState.process,
    mentionId,
    answers
  );

  if (success && spawnState.clarificationResolve) {
    spawnState.clarificationResolve(answers);
  }

  return success;
}

// ============================================================================
// Get Active Spawn
// ============================================================================

export function getActiveSpawn(mentionId: string): ActiveSpawn {
  return activeSpawns.get(mentionId);
}

// ============================================================================
// Kill Active Spawn
// ============================================================================

export function killSpawn(mentionId: string): boolean {
  const spawnState = activeSpawns.get(mentionId);
  if (!spawnState) return false;

  try {
    spawnState.process.kill('SIGTERM');
    activeSpawns.delete(mentionId);
    return true;
  } catch (err) {
    console.error(`[acp-spawn] Failed to kill spawn ${mentionId}:`, err);
    return false;
  }
}

export default {
  spawnAgentACP,
  agentSupportsACP,
  handleClarificationResponse,
  getActiveSpawn,
  killSpawn,
};
