/**
 * Hive - ACP Client
 * 
 * Connect to external ACP endpoints (Claude Code, Codex, etc.)
 * Enables Hive to act as an ACP client for remote agents.
 */

import type {
  ACPMessage,
  ACPTaskPayload,
  ACPResponsePayload,
  ACPProgressPayload,
  ACPClarificationPayload,
} from '../../types/acp.js';
import { ACP_VERSION } from '../../types/acp.js';
import { db, mentionKey, channelKey } from '../../db/index.js';

// ============================================================================
// Types
// ============================================================================

export interface ACPClientConfig {
  /** Endpoint URL (HTTP or WebSocket) */
  endpoint: string;
  /** Connection type */
  transport: 'http' | 'websocket';
  /** Authentication token */
  token?: string;
  /** API key */
  apiKey?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Enable session persistence */
  persistSession?: boolean;
  /** Session ID for persistence */
  sessionId?: string;
}

export interface ACPClientOptions {
  agentId: string;
  mentionId: string;
  channelId: string;
  config: ACPClientConfig;
  onProgress?: (progress: ACPProgressPayload) => void;
  onClarification?: (questions: ACPClarificationPayload['questions']) => Promise<Record<string, string | string[]>>;
}

export interface ACPClientResult {
  success: boolean;
  status: 'completed' | 'failed' | 'timeout';
  response?: ACPResponsePayload;
  error?: string;
}

// ============================================================================
// ACP Client
// ============================================================================

/**
 * Send an ACP task to an external endpoint and await response.
 */
export async function sendACPTask(
  options: ACPClientOptions
): Promise<ACPClientResult> {
  const { mentionId, channelId, config, onProgress, onClarification } = options;

  // Get mention and channel from DB
  const mention = await db.get(mentionKey(mentionId));
  const channel = await db.get(channelKey(channelId));
  
  if (!mention || !channel) {
    return {
      success: false,
      status: 'failed',
      error: `Mention or channel not found: ${mentionId}`,
    };
  }

  // Build task payload
  const taskPayload: ACPTaskPayload = {
    mentionId,
    channelId,
    channelName: channel.name,
    cwd: channel.cwd,
    fromAgent: mention.mentioningAgentId || 'unknown',
    content: mention.content || '',
    chainDepth: 0,
  };

  const taskMessage: ACPMessage = {
    protocol: ACP_VERSION,
    type: 'task',
    taskId: mentionId,
    timestamp: Date.now(),
    payload: taskPayload,
  };

  // Choose transport
  if (config.transport === 'websocket') {
    return sendViaWebSocket(config, taskMessage, { onProgress, onClarification });
  } else {
    return sendViaHTTP(config, taskMessage, { onProgress, timeout: config.timeout });
  }
}

// ============================================================================
// HTTP Transport
// ============================================================================

interface HTTPOptions {
  onProgress?: (progress: ACPProgressPayload) => void;
  timeout?: number;
}

async function sendViaHTTP(
  config: ACPClientConfig,
  message: ACPMessage,
  options: HTTPOptions
): Promise<ACPClientResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Hive/1.0 ACP-Client/1.0',
  };

  if (config.token) {
    headers['Authorization'] = `Bearer ${config.token}`;
  }
  if (config.apiKey) {
    headers['X-API-Key'] = config.apiKey;
  }

  const timeout = config.timeout || 60000;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(message),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        success: false,
        status: 'failed',
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    // Check if response is SSE stream or JSON
    const contentType = response.headers.get('content-type') || '';
    
    if (contentType.includes('text/event-stream')) {
      // Handle SSE stream for progress updates
      return handleSSEStream(response, message.taskId, options);
    } else {
      // Single JSON response
      const body = await response.json();
      
      if (!isACPMessage(body)) {
        return {
          success: false,
          status: 'failed',
          error: 'Invalid ACP response format',
        };
      }

      if (body.type === 'response') {
        const payload = body.payload as ACPResponsePayload;
        return {
          success: payload.status === 'completed',
          status: payload.status === 'completed' ? 'completed' : 'failed',
          response: payload,
        };
      }

      return {
        success: false,
        status: 'failed',
        error: `Unexpected message type: ${body.type}`,
      };
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    
    if (errorMessage.includes('abort')) {
      return {
        success: false,
        status: 'timeout',
        error: `Request timed out after ${timeout}ms`,
      };
    }
    
    return {
      success: false,
      status: 'failed',
      error: errorMessage,
    };
  }
}

// ============================================================================
// SSE Stream Handler
// ============================================================================

async function handleSSEStream(
  response: Response,
  _taskId: string,
  options: HTTPOptions
): Promise<ACPClientResult> {
  const reader = response.body?.getReader();
  if (!reader) {
    return { success: false, status: 'failed', error: 'No response body' };
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let finalResponse: ACPResponsePayload | undefined;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim() || !line.startsWith('data:')) continue;

        const data = line.slice(5).trim();
        try {
          const parsed = JSON.parse(data);
          
          if (!isACPMessage(parsed)) continue;

          if (parsed.type === 'progress' && options.onProgress) {
            options.onProgress(parsed.payload as ACPProgressPayload);
          } else if (parsed.type === 'response') {
            finalResponse = parsed.payload as ACPResponsePayload;
          }
        } catch {
          // Ignore parse errors
        }
      }
    }

    if (finalResponse) {
      return {
        success: finalResponse.status === 'completed',
        status: finalResponse.status === 'completed' ? 'completed' : 'failed',
        response: finalResponse,
      };
    }

    return {
      success: false,
      status: 'failed',
      error: 'No response received from stream',
    };
  } catch (err) {
    return {
      success: false,
      status: 'failed',
      error: err instanceof Error ? err.message : 'Stream error',
    };
  }
}

// ============================================================================
// WebSocket Transport
// ============================================================================

interface WebSocketOptions {
  onProgress?: (progress: ACPProgressPayload) => void;
  onClarification?: (questions: ACPClarificationPayload['questions']) => Promise<Record<string, string | string[]>>;
}

async function sendViaWebSocket(
  _config: ACPClientConfig,
  _message: ACPMessage,
  _options: WebSocketOptions
): Promise<ACPClientResult> {
  return new Promise((resolve) => {
    // Note: WebSocket support requires browser or Node with ws package
    // This is a placeholder for full WebSocket implementation
    // In Bun, we can use the native WebSocket
    
    // For now, fall back to HTTP
    // TODO: Implement proper WebSocket transport when needed
    
    resolve({
      success: false,
      status: 'failed',
      error: 'WebSocket transport not yet implemented. Use HTTP transport.',
    });
  });
}

// ============================================================================
// Type Guards
// ============================================================================

function isACPMessage(obj: unknown): obj is ACPMessage {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'protocol' in obj &&
    (obj as { protocol: unknown }).protocol === ACP_VERSION &&
    'type' in obj &&
    'taskId' in obj
  );
}

// ============================================================================
// Helper: Create ACP Client for Agent
// ============================================================================

/**
 * Create an ACP client config from an agent's webhook configuration.
 */
export function createACPClientFromAgent(_agentId: string): ACPClientConfig | null {
  // This would typically fetch the agent from DB and extract config
  // For now, return null to indicate it needs to be implemented
  // In practice, this would be called from a route handler
  return null;
}

// ============================================================================
// Export
// ============================================================================

export default {
  sendACPTask,
  sendViaHTTP,
  sendViaWebSocket,
  createACPClientFromAgent,
};
