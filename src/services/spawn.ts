/**
 * Hive - Spawn Service
 * 
 * Spawns agents when they are mentioned in posts.
 * Captures output and updates mention records.
 * Creates response posts that can trigger mention chains.
 */

import { spawn } from 'child_process';
import { 
  db, 
  agentKey, 
  subKey, 
  subsByAgentKey,
  subsByTargetKey,
  mentionKey, 
  mentionsByAgentKey,
  mentionsByRoomKey,
  postKey,
  postsByRoomKey,
  generateId, 
  addToSet, 
  getList 
} from '../db/index.js';
import type { Agent, Mention, Room, Post } from '../types.js';
import { emitHiveEvent } from './events.js';
import { getSpawnConfig } from './spawn-config.js';
import { checkCommandAllowed, validateSpawnArgs } from './spawn-allowlist.js';
import { createPost } from './rooms.js';

// ============================================================================
// Concurrency tracking
// ============================================================================

/** Number of currently running agent processes (global). */
let globalRunningCount = 0;

/** Per-agent running counts keyed by agentId. */
const perAgentRunningCount = new Map<string, number>();

function incrementRunning(agentId: string): void {
  globalRunningCount++;
  perAgentRunningCount.set(agentId, (perAgentRunningCount.get(agentId) ?? 0) + 1);
}

function decrementRunning(agentId: string): void {
  globalRunningCount = Math.max(0, globalRunningCount - 1);
  const prev = perAgentRunningCount.get(agentId) ?? 0;
  const next = Math.max(0, prev - 1);
  if (next === 0) {
    perAgentRunningCount.delete(agentId);
  } else {
    perAgentRunningCount.set(agentId, next);
  }
}

// ============================================================================
// Create a post from agent output (triggers mention chain)
// ============================================================================

async function createAgentResponsePost(
  room: Room,
  authorId: string,
  output: string,
  replyToPostId?: string,
  chainDepth: number = 0
): Promise<Post> {
  // Create post directly in database
  const postId = generateId('post');
  
  // Extract mentions from output. This intentionally mirrors user mention
  // parsing so agent-to-agent chains use the same routing rules.
  const mentionRegex = /@([a-zA-Z0-9_-]+)/g;
  const mentions: string[] = [];
  let match;
  while ((match = mentionRegex.exec(output)) !== null) {
    mentions.push(match[1]);
  }
  
  const post: Post = {
    id: postId,
    roomId: room.id,
    authorId,
    content: output.trim(),
    mentions,
    createdAt: Date.now(),
    replyTo: replyToPostId,
  };
  
  // Store post
  await db.put(postKey(postId), post);
  await addToSet(postsByRoomKey(room.id), postId);
  
  console.log(`[spawn] Created agent response post ${postId} with mentions: ${mentions.join(', ')} (chain depth ${chainDepth})`);
  
  // Process mentions in this post (triggers spawn chain)
  await processMentions(post, room, chainDepth);
  
  return post;
}

// ============================================================================
// Check if agent is subscribed to a room
// ============================================================================

export async function isAgentSubscribedToRoom(agentId: string, roomId: string): Promise<boolean> {
  const subIds = await getList<string>(`subs!agent!${agentId}`);
  
  for (const subId of subIds) {
    const sub = await db.get(subKey(subId));
    if (sub && sub.targetType === 'room' && sub.targetId === roomId && sub.active) {
      return true;
    }
  }
  
  return false;
}

async function createSubscription(input: {
  agentId: string;
  targetType: 'room' | 'agent' | 'mention';
  targetId: string;
}): Promise<void> {
  const subId = generateId('sub');
  const now = Date.now();

  await db.put(subKey(subId), {
    id: subId,
    agentId: input.agentId,
    targetType: input.targetType,
    targetId: input.targetId,
    createdAt: now,
    active: true,
  });

  await addToSet(subsByAgentKey(input.agentId), subId);
  await addToSet(subsByTargetKey(input.targetType, input.targetId), subId);
}

async function createSpawnErrorPost(params: {
  roomId: string;
  mentionId: string;
  agentId: string;
  spawnError?: string;
  exitCode?: number | null;
}): Promise<void> {
  const { roomId, mentionId, agentId, spawnError, exitCode } = params;
  if (exitCode === 0 && !spawnError) return;

  const errorMessage = spawnError || `Process exited with code ${exitCode}`;

  try {
    await createPost(roomId, {
      authorId: 'hive',
      content: JSON.stringify({
        type: 'error',
        mentionId,
        agentId,
        error: errorMessage,
        exitCode: exitCode ?? null,
        timestamp: Date.now(),
      }),
    });
  } catch (postErr) {
    console.error('[spawn] Failed to post error:', postErr);
  }
}

type SpawnTextEvent = {
  type: 'text';
  content?: unknown;
  text?: unknown;
};

function isSpawnTextEvent(event: unknown): event is SpawnTextEvent {
  return !!event && typeof event === 'object' && (event as { type?: unknown }).type === 'text';
}

function formatSpawnOutputForPost(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) return '';

  const lines = trimmed.split('\n').filter(line => line.trim());
  const textEvents: SpawnTextEvent[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isSpawnTextEvent(parsed)) {
        textEvents.push(parsed);
      }
    } catch {
      // If stdout is not JSONL, fall back to the raw output.
      return trimmed;
    }
  }

  if (textEvents.length === 0) return trimmed;

  return textEvents
    .map(event => {
      if (typeof event.content === 'string') return event.content;
      if (typeof event.text === 'string') return event.text;
      return JSON.stringify(event);
    })
    .join('\n\n');
}

// ============================================================================
// Create a mention record
// ============================================================================

export async function createMention(
  postId: string,
  roomId: string,
  roomName: string,
  mentionedAgentId: string,
  mentioningAgentId: string,
  content: string
): Promise<Mention> {
  const mentionId = generateId('mention');
  
  const mention: Mention = {
    id: mentionId,
    agentId: mentionedAgentId,
    postId,
    roomId,
    roomName,
    mentionedAgentId,
    mentioningAgentId,
    content: content.slice(0, 1000), // Store snippet
    createdAt: Date.now(),
    read: false,
    acknowledged: false,
    spawnStatus: 'pending',
  };
  
  await db.put(mentionKey(mentionId), mention);
  await addToSet(mentionsByAgentKey(mentionedAgentId), mentionId);
  await addToSet(mentionsByRoomKey(roomId), mentionId);

  await emitHiveEvent(
    'mention.spawn_status_changed',
    {
      mentionId,
      agentId: mentionedAgentId,
      roomId,
      postId,
      fromStatus: null,
      toStatus: 'pending',
    },
    'spawn:createMention'
  );
  
  return mention;
}

// ============================================================================
// Update mention with spawn result
// ============================================================================

export async function updateMentionStatus(
  mentionId: string,
  status: 'pending' | 'running' | 'completed' | 'failed',
  output?: string,
  error?: string
): Promise<void> {
  const mention = await db.get(mentionKey(mentionId)) as Mention | undefined;
  if (!mention) return;
  const previousStatus = mention.spawnStatus || 'pending';
  
  mention.spawnStatus = status;
  if (output) mention.spawnOutput = output;
  if (error) mention.spawnError = error;
  if (status === 'completed' || status === 'failed') {
    mention.completedAt = Date.now();
  }
  
  await db.put(mentionKey(mentionId), mention);

  // Emit transition events only for real state changes so downstream relays do
  // not treat idempotent writes as new work.
  if (previousStatus !== status) {
    await emitHiveEvent(
      'mention.spawn_status_changed',
      {
        mentionId: mention.id,
        agentId: mention.mentionedAgentId || mention.agentId,
        roomId: mention.roomId,
        postId: mention.postId,
        fromStatus: previousStatus,
        toStatus: status,
      },
      'spawn:updateMentionStatus'
    );
  }
}

// ============================================================================
// Spawn an agent process and capture output
// ============================================================================

export async function spawnAgent(
  agentId: string,
  mention: Mention,
  post: Post,
  room: Room,
  chainDepth: number = 0
): Promise<void> {
  const cfg = getSpawnConfig();

  // ── Concurrency guards ────────────────────────────────────────────────────
  const agentRunning = perAgentRunningCount.get(agentId) ?? 0;
  if (agentRunning >= cfg.perAgentConcurrencyLimit) {
    const msg = `Per-agent concurrency limit (${cfg.perAgentConcurrencyLimit}) reached for ${agentId}`;
    console.warn(`[spawn] ${msg}`);
    await updateMentionStatus(mention.id, 'failed', undefined, msg);
    return;
  }
  if (globalRunningCount >= cfg.globalConcurrencyLimit) {
    const msg = `Global concurrency limit (${cfg.globalConcurrencyLimit}) reached`;
    console.warn(`[spawn] ${msg}`);
    await updateMentionStatus(mention.id, 'failed', undefined, msg);
    return;
  }

  const agent = await db.get(agentKey(agentId)) as Agent | undefined;
  
  if (!agent) {
    console.log(`[spawn] Agent ${agentId} not found, skipping spawn`);
    return;
  }
  
  console.log(`[spawn] Spawning agent ${agentId} for mention ${mention.id} (chain depth ${chainDepth})`);
  
  // Build environment with mention context
  const env = {
    ...process.env,
    MENTION_ID: mention.id,
    ROOM_ID: room.id,
    ROOM_NAME: room.name,
    ROOM_CWD: room.cwd || agent.cwd || '',
    POST_ID: post.id,
    FROM_AGENT: mention.mentioningAgentId || 'unknown',
    MENTION_CONTENT: post.content,
    HIVE_CHAIN_DEPTH: String(chainDepth),
  };
  
  const command = agent.spawnCommand.trim();
  if (!command) {
    await updateMentionStatus(mention.id, 'failed', undefined, 'Agent spawnCommand is empty');
    await emitHiveEvent(
      'task.failed',
      {
        taskId: mention.id,
        mentionId: mention.id,
        agentId,
        roomId: room.id,
        postId: post.id,
        error: 'Agent spawnCommand is empty',
      },
      'spawn:spawnAgent'
    );
    return;
  }

  // Defense-in-depth: re-check allowlist at spawn time in case the agent record
  // was persisted before the allowlist was enabled or was written directly to DB.
  const cmdCheck = checkCommandAllowed(command);
  if (!cmdCheck.allowed) {
    const msg = cmdCheck.reason ?? 'spawnCommand not on allowlist';
    console.error(`[spawn] Blocked spawn for agent ${agentId}: ${msg}`);
    await updateMentionStatus(mention.id, 'failed', undefined, msg);
    await emitHiveEvent(
      'task.failed',
      { taskId: mention.id, mentionId: mention.id, agentId, roomId: room.id, postId: post.id, error: msg },
      'spawn:spawnAgent'
    );
    return;
  }

  const args = agent.spawnArgs || [];

  // Validate args before spawning
  const argsError = validateSpawnArgs(args);
  if (argsError) {
    console.error(`[spawn] Invalid args for agent ${agentId}: ${argsError}`);
    await updateMentionStatus(mention.id, 'failed', undefined, argsError);
    await emitHiveEvent(
      'task.failed',
      { taskId: mention.id, mentionId: mention.id, agentId, roomId: room.id, postId: post.id, error: argsError },
      'spawn:spawnAgent'
    );
    return;
  }

  // Resolve working directory: room.cwd takes precedence over agent.cwd
  const spawnCwd = room.cwd || agent.cwd;
  
  // Resolve $WORKSPACE placeholder in args with the cwd
  const resolvedArgs = args.map(arg => {
    if (arg === '$WORKSPACE' && spawnCwd) return spawnCwd;
    if (arg === '$MENTION_CONTENT') return post.content;
    return arg;
  });
  
  // Update status to running and track concurrency
  incrementRunning(agentId);
  await updateMentionStatus(mention.id, 'running');
  await emitHiveEvent(
    'task.started',
    {
      taskId: mention.id,
      mentionId: mention.id,
      agentId,
      roomId: room.id,
      postId: post.id,
      chainDepth,
    },
    'spawn:spawnAgent'
  );
  
  try {
    // Spawn directly (without shell interpolation) so user-controlled args are
    // passed as literal argv entries.
    const child = spawn(command, resolvedArgs, {
      cwd: spawnCwd,
      env,
      detached: false, // Wait for completion to capture output
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let settled = false;

    // ── Timeout watchdog ────────────────────────────────────────────────────
    const timeoutHandle = setTimeout(() => {
      if (settled) return;
      settled = true;
      decrementRunning(agentId);
      console.warn(`[spawn] Agent ${agentId} timed out after ${cfg.timeoutMs}ms, killing`);
      try { child.kill('SIGKILL'); } catch { /* already dead */ }
      const msg = `Spawn timed out after ${cfg.timeoutMs}ms`;
      updateMentionStatus(mention.id, 'failed', undefined, msg).catch(() => {});
      emitHiveEvent(
        'task.failed',
        { taskId: mention.id, mentionId: mention.id, agentId, roomId: room.id, postId: post.id, error: msg },
        'spawn:timeout'
      ).catch(() => {});
    }, cfg.timeoutMs);
    
    // Capture stdout and stderr with byte caps
    let stdoutBuf = '';
    let stdoutTruncated = false;
    let stderrBuf = '';
    let stderrTruncated = false;
    
    child.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      if (!stdoutTruncated) {
        const remaining = cfg.maxStdoutBytes - stdoutBuf.length;
        if (remaining <= 0) {
          stdoutTruncated = true;
        } else {
          stdoutBuf += chunk.slice(0, remaining);
          if (stdoutBuf.length >= cfg.maxStdoutBytes) stdoutTruncated = true;
        }
      }
      console.log(`[spawn:${agentId}:out] ${chunk.slice(0, 200)}`);
      void emitHiveEvent(
        'task.progress',
        {
          taskId: mention.id,
          mentionId: mention.id,
          agentId,
          roomId: room.id,
          postId: post.id,
          stream: 'stdout',
          chunk: chunk.slice(0, 1000),
        },
        'spawn:stdout'
      );
    });
    
    child.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      if (!stderrTruncated) {
        const remaining = cfg.maxStderrBytes - stderrBuf.length;
        if (remaining <= 0) {
          stderrTruncated = true;
        } else {
          stderrBuf += chunk.slice(0, remaining);
          if (stderrBuf.length >= cfg.maxStderrBytes) stderrTruncated = true;
        }
      }
      console.error(`[spawn:${agentId}:err] ${chunk.slice(0, 200)}`);
      void emitHiveEvent(
        'task.progress',
        {
          taskId: mention.id,
          mentionId: mention.id,
          agentId,
          roomId: room.id,
          postId: post.id,
          stream: 'stderr',
          chunk: chunk.slice(0, 1000),
        },
        'spawn:stderr'
      );
    });
    
    // Handle completion
    child.once('close', async (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      decrementRunning(agentId);

      const success = code === 0;
      const output = stdoutTruncated ? stdoutBuf + '\n[output truncated]' : stdoutBuf;
      const errorText = stderrTruncated ? stderrBuf + '\n[stderr truncated]' : stderrBuf;
      const error = errorText || undefined;
      
      if (success) {
        console.log(`[spawn] Agent ${agentId} completed successfully (PID: ${child.pid})`);
        await updateMentionStatus(mention.id, 'completed', output, undefined);

        const postContent = formatSpawnOutputForPost(stdoutBuf);
        let responsePostId: string | undefined;

        if (postContent) {
          console.log(`[spawn] Creating response post from agent output (chain depth ${chainDepth + 1})`);
          const responsePost = await createAgentResponsePost(room, agentId, postContent, post.id, chainDepth + 1);
          responsePostId = responsePost.id;
        }

        await emitHiveEvent(
          'task.completed',
          {
            taskId: mention.id,
            mentionId: mention.id,
            agentId,
            roomId: room.id,
            postId: post.id,
            exitCode: code,
            outputLength: stdoutBuf.length,
            responsePostId,
            chainDepth,
          },
          'spawn:close'
        );
      } else {
        console.error(`[spawn] Agent ${agentId} failed with code ${code}`);
        await updateMentionStatus(mention.id, 'failed', output, error);
        await createSpawnErrorPost({
          roomId: post.roomId,
          mentionId: mention.id,
          agentId: agent.id,
          spawnError: error,
          exitCode: code,
        });
        await emitHiveEvent(
          'task.failed',
          {
            taskId: mention.id,
            mentionId: mention.id,
            agentId,
            roomId: room.id,
            postId: post.id,
            exitCode: code,
            error,
            chainDepth,
          },
          'spawn:close'
        );
      }
      
      console.log(`[spawn] Output length: ${stdoutBuf.length} chars`);
    });
    
    child.once('error', async (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      decrementRunning(agentId);

      console.error(`[spawn] Failed to spawn agent ${agentId}:`, err.message);
      await updateMentionStatus(mention.id, 'failed', undefined, err.message);
      await createSpawnErrorPost({
        roomId: post.roomId,
        mentionId: mention.id,
        agentId: agent.id,
        spawnError: err.message,
        exitCode: null,
      });
      await emitHiveEvent(
        'task.failed',
        {
          taskId: mention.id,
          mentionId: mention.id,
          agentId,
          roomId: room.id,
          postId: post.id,
          error: err.message,
        },
        'spawn:error'
      );
    });
    
    // Store PID
    const mentionData = await db.get(mentionKey(mention.id)) as Mention | undefined;
    if (mentionData) {
      mentionData.spawnPid = child.pid;
      await db.put(mentionKey(mention.id), mentionData);
    }
    
    console.log(`[spawn] Spawned agent ${agentId} (PID: ${child.pid})`);
    
  } catch (err) {
    decrementRunning(agentId);
    console.error(`[spawn] Error spawning agent ${agentId}:`, err);
    await updateMentionStatus(mention.id, 'failed', undefined, String(err));
    await emitHiveEvent(
      'task.failed',
      {
        taskId: mention.id,
        mentionId: mention.id,
        agentId,
        roomId: room.id,
        postId: post.id,
        error: String(err),
      },
      'spawn:exception'
    );
  }
}

// ============================================================================
// Process mentions in a post
// ============================================================================

export async function processMentions(post: Post, room: Room, chainDepth: number = 0): Promise<Mention[]> {
  const mentions: Mention[] = [];
  const cfg = getSpawnConfig();
  
  // Extract mentions from content (@agentId pattern)
  const mentionRegex = /@([a-zA-Z0-9_-]+)/g;
  const mentionedAgents = new Set<string>();
  let match;
  while ((match = mentionRegex.exec(post.content)) !== null) {
    mentionedAgents.add(match[1]);
  }
  
  for (const mentionedAgentId of mentionedAgents) {
    // Check if agent exists
    const agent = await db.get(agentKey(mentionedAgentId)) as Agent | undefined;
    if (!agent) {
      console.log(`[mentions] Agent ${mentionedAgentId} not found, skipping`);
      continue;
    }
    
    // Check if agent is subscribed to the room
    let isSubscribed = await isAgentSubscribedToRoom(mentionedAgentId, post.roomId);
    if (!isSubscribed) {
      // AUTO-SUBSCRIBE: Create subscription for first-time mentions
      try {
        await createSubscription({
          agentId: agent.id,
          targetType: 'room',
          targetId: post.roomId,
        });
        console.log(`[posts] Auto-subscribed agent ${agent.id} to room ${post.roomId}`);
        isSubscribed = true;
      } catch (err) {
        console.error(`[posts] Failed to auto-subscribe ${agent.id}:`, err);
        continue;
      }
    }
    
    // Create mention record
    const mention = await createMention(
      post.id,
      post.roomId,
      room.name,
      mentionedAgentId,
      post.authorId,
      post.content
    );
    
    mentions.push(mention);
    
    // Only spawn if subscribed and chain depth limit not exceeded
    if (isSubscribed) {
      if (chainDepth > cfg.maxChainDepth) {
        console.warn(
          `[mentions] Chain depth ${chainDepth} exceeds limit ${cfg.maxChainDepth} for agent ${mentionedAgentId}, suppressing spawn`
        );
        await updateMentionStatus(
          mention.id,
          'failed',
          undefined,
          `Chain depth limit (${cfg.maxChainDepth}) exceeded`
        );
        continue;
      }
      // Spawn asynchronously - don't await
      spawnAgent(mentionedAgentId, mention, post, room, chainDepth).catch(err => {
        console.error(`[mentions] Spawn error for ${mentionedAgentId}:`, err);
      });
    }
  }
  
  return mentions;
}

// ============================================================================
// Get mention by ID
// ============================================================================

export async function getMention(mentionId: string): Promise<Mention | null> {
  return (await db.get(mentionKey(mentionId))) || null;
}

// ============================================================================
// Get mentions for an agent
// ============================================================================

export async function getAgentMentions(
  agentId: string,
  options?: { unacknowledgedOnly?: boolean; limit?: number }
): Promise<Mention[]> {
  const mentionIds = await getList<string>(mentionsByAgentKey(agentId));
  const mentions: Mention[] = [];
  
  for (const id of mentionIds) {
    const mention = await db.get(mentionKey(id)) as Mention | undefined;
    if (mention) {
      if (options?.unacknowledgedOnly && mention.acknowledged) continue;
      mentions.push(mention);
      if (options?.limit && mentions.length >= options.limit) break;
    }
  }
  
  return mentions.sort((a, b) => b.createdAt - a.createdAt);
}
