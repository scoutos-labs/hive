/**
 * Hive - ACP Output Formatter
 * 
 * Normalizes agent output to ACP format.
 * Handles both structured (JSONL) and plain text output.
 */

import type {
  ACPMessage,
  ACPResponseMessage,
  ACPClarificationResponseMessage,
  ACPProgressPayload,
  ACPResponsePayload,
  ACPQuestion,
} from '../../types/acp.js';

const ACP_VER = 'acp/1.0' as const;

// ============================================================================
// Output Parsing Types
// ============================================================================

/** Parsed ACP line from agent stdout */
export interface ParsedACPLine {
  valid: boolean;
  type: 'text' | 'progress' | 'response' | 'clarification' | 'error' | 'raw';
  message?: ACPMessage;
  raw?: string;
}

/** Result of parsing agent output */
export interface ParsedAgentOutput {
  /** Lines that were valid ACP messages */
  acpMessages: ACPMessage[];
  /** Lines that were plain text */
  rawLines: string[];
  /** Combined text content from text events and raw lines */
  textContent: string;
  /** Has valid ACP messages? */
  hasACP: boolean;
  /** Final response if any */
  finalResponse?: ACPResponsePayload;
  /** Progress updates */
  progress: ACPProgressPayload[];
  /** Clarification requests */
  clarifications: ACPQuestion[][];
  /** Errors */
  errors: Array<{ code: string; message: string }>;
}

// ============================================================================
// Known ACP Event Types (from spawned agents)
// ============================================================================

/** OpenClaw-style JSONL output */
interface OpenClawTextEvent {
  type: 'text';
  content?: string;
  text?: string;
}

/** ACP-compliant progress event */
interface ACPProgressEvent {
  type: 'progress';
  taskId: string;
  payload: ACPProgressPayload;
}

/** ACP-compliant response event */
interface ACPResponseEvent {
  type: 'response';
  taskId: string;
  payload: ACPResponsePayload;
}

/** ACP-compliant clarification event */
interface ACPClarificationEvent {
  type: 'clarification';
  taskId: string;
  payload: { questions: ACPQuestion[] };
}

/** ACP-compliant error event */
interface ACPErrorEvent {
  type: 'error';
  taskId: string;
  payload: { code: string; message: string; recoverable?: boolean };
}

type ACPEvent = OpenClawTextEvent | ACPProgressEvent | ACPResponseEvent | ACPClarificationEvent | ACPErrorEvent;

// ============================================================================
// Parse ACP Lines from Agent Output
// ============================================================================

/**
 * Parse a single line of agent output.
 * Returns parsed ACP message or raw text.
 */
export function parseACPLine(line: string, taskId: string): ParsedACPLine {
  const trimmed = line.trim();
  if (!trimmed) {
    return { valid: false, type: 'raw', raw: '' };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;

    // Check if it's a full ACP message
    if (isACPMessageStructure(parsed)) {
      if (parsed.type === 'task') {
        return { valid: false, type: 'raw', raw: trimmed };
      }

      return {
        valid: true,
        type: parsed.type,
        message: parsed,
      };
    }

    // Check if it's an ACP event (type + payload structure)
    if (isACPEventStructure(parsed)) {
      const message = acpEventToMessage(parsed, taskId);
      return { valid: true, type: parsed.type, message };
    }

    // Check for OpenClaw-style text event
    if (isOpenClawTextEvent(parsed)) {
      return {
        valid: true,
        type: 'text',
        message: {
          protocol: ACP_VER,
          type: 'response',
          taskId,
          timestamp: Date.now(),
          payload: {
            status: 'completed',
            message: (parsed.content || parsed.text || '').trim(),
          } as ACPResponsePayload,
        } as ACPResponseMessage,
      };
    }

    // Not a known format, treat as raw
    return { valid: false, type: 'raw', raw: trimmed };
  } catch {
    // Not JSON, treat as raw text
    return { valid: false, type: 'raw', raw: trimmed };
  }
}

/**
 * Parse complete agent output (stdout).
 * Extracts ACP messages, text content, and final response.
 */
export function parseAgentOutput(output: string, taskId: string): ParsedAgentOutput {
  const lines = output.split('\n');
  const result: ParsedAgentOutput = {
    acpMessages: [],
    rawLines: [],
    textContent: '',
    hasACP: false,
    progress: [],
    clarifications: [],
    errors: [],
  };

  const textParts: string[] = [];

  for (const line of lines) {
    const parsed = parseACPLine(line, taskId);

    if (parsed.valid && parsed.message) {
      result.acpMessages.push(parsed.message);
      result.hasACP = true;

      // Extract specific message types
      switch (parsed.message.type) {
        case 'response':
          result.finalResponse = parsed.message.payload as ACPResponsePayload;
          const msg = (parsed.message.payload as ACPResponsePayload).message;
          if (msg) textParts.push(msg);
          break;

        case 'progress':
          result.progress.push(parsed.message.payload as ACPProgressPayload);
          break;

        case 'clarification':
          const clarPayload = parsed.message.payload as { questions: ACPQuestion[] };
          result.clarifications.push(clarPayload.questions);
          break;

        case 'error':
          const errPayload = parsed.message.payload as { code: string; message: string };
          result.errors.push(errPayload);
          break;
      }
    } else if (parsed.raw) {
      result.rawLines.push(parsed.raw);
      textParts.push(parsed.raw);
    }
  }

  result.textContent = textParts.join('\n');

  // If no final response but we have content, create one
  if (!result.finalResponse && result.textContent) {
    result.finalResponse = {
      status: 'completed',
      message: result.textContent,
    };
  }

  return result;
}

// ============================================================================
// Format Output for Post Creation
// ============================================================================

/**
 * Format parsed agent output for creating a channel post.
 * ACP-aware agents get structured formatting.
 */
export function formatAgentOutputForPost(parsed: ParsedAgentOutput): string {
  // If agent sent a proper ACP response, use its message
  if (parsed.finalResponse && parsed.hasACP) {
    const { message, artifacts, mentions } = parsed.finalResponse;

    let post = message;

    // Add artifacts if present
    if (artifacts && artifacts.length > 0) {
      post += '\n\n**Artifacts:**';
      for (const artifact of artifacts) {
        if (artifact.type === 'file' && artifact.path) {
          post += `\n- 📄 ${artifact.name}: \`${artifact.path}\``;
        } else if (artifact.type === 'link' && artifact.url) {
          post += `\n- 🔗 ${artifact.name}: ${artifact.url}`;
        } else if (artifact.type === 'code' && artifact.content) {
          const lang = artifact.mimeType?.split('/').pop() || '';
          post += `\n- 💻 ${artifact.name}:\n\`\`\`${lang}\n${artifact.content}\n\`\`\``;
        } else {
          post += `\n- ${artifact.name}`;
        }
      }
    }

    // Add mentions if present
    if (mentions && mentions.length > 0) {
      post += '\n\n' + mentions.map(m => `@${m}`).join(' ');
    }

    return post.trim();
  }

  // Fallback: raw text content
  return parsed.textContent;
}

// ============================================================================
// Create ACP Messages (for Hive → Agent)
// ============================================================================

/**
 * Create an ACP task message to send to an agent.
 */
export function createACPTaskMessage(params: {
  taskId: string;
  channelId: string;
  channelName?: string;
  cwd?: string;
  fromAgent: string;
  content: string;
  chainDepth: number;
  metadata?: Record<string, unknown>;
}): string {
  const message: ACPMessage = {
    protocol: ACP_VER,
    type: 'task',
    taskId: params.taskId,
    timestamp: Date.now(),
    payload: {
      mentionId: params.taskId,
      channelId: params.channelId,
      channelName: params.channelName,
      cwd: params.cwd,
      fromAgent: params.fromAgent,
      content: params.content,
      chainDepth: params.chainDepth,
      metadata: params.metadata,
    },
  };

  return JSON.stringify(message);
}

/**
 * Create an ACP clarification response message.
 */
export function createACPClarificationResponse(
  taskId: string,
  answers: Record<string, string | string[]>
): string {
  const message: ACPClarificationResponseMessage = {
    protocol: ACP_VER,
    type: 'response', // Using 'response' as clarification response
    taskId,
    timestamp: Date.now(),
    payload: {
      answers,
      respondedAt: Date.now(),
    },
  };

  return JSON.stringify(message);
}

// ============================================================================
// Helpers
// ============================================================================

function isACPMessageStructure(obj: unknown): obj is ACPMessage {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'protocol' in obj &&
    (obj as { protocol: unknown }).protocol === ACP_VER &&
    'type' in obj &&
    'taskId' in obj &&
    'timestamp' in obj
  );
}

function isACPEventStructure(obj: unknown): obj is ACPEvent {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'type' in obj &&
    ['progress', 'response', 'clarification', 'error'].includes((obj as { type: unknown }).type as string)
  );
}

function isOpenClawTextEvent(obj: unknown): obj is OpenClawTextEvent {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'type' in obj &&
    (obj as { type: unknown }).type === 'text' &&
    ('content' in obj || 'text' in obj)
  );
}

function acpEventToMessage(event: ACPEvent, taskId: string): ACPMessage {
  const base = {
    protocol: ACP_VER,
    taskId,
    timestamp: Date.now(),
  };

  switch (event.type) {
    case 'progress':
      return { ...base, type: event.type, payload: event.payload };
    case 'response':
      return { ...base, type: event.type, payload: event.payload };
    case 'clarification':
      return { ...base, type: event.type, payload: event.payload };
    case 'error':
      return { ...base, type: event.type, payload: event.payload };
    default:
      // OpenClaw text event
      return {
        ...base,
        type: 'response',
        payload: {
          status: 'completed',
          message: ('content' in event ? event.content : 'text' in event ? event.text : '') || '',
        },
      };
  }
}

export default {
  parseACPLine,
  parseAgentOutput,
  formatAgentOutputForPost,
  createACPTaskMessage,
  createACPClarificationResponse,
};
