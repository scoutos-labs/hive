/**
 * Hive - ACP Webhook Service
 * 
 * Sends ACP-formpliant task notifications to webhook endpoints.
 * Receives ACP responses from external agents.
 */

import type { Agent, Channel, Post, Mention } from '../../types.js';
import type {
  ACPWebhookPayload,
  ACPWebhookResponse,
  ACPTaskPayload,
} from '../../types/acp.js';
import { ACP_VERSION } from '../../types/acp.js';

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TIMEOUT_MS = 60000;

// ============================================================================
// Send ACP Task Notification
// ============================================================================

export interface SendACPTaskOptions {
  agent: Agent;
  mention: Mention;
  channel: Channel;
  post: Post;
}

export interface SendACPTaskResult {
  success: boolean;
  statusCode?: number;
  responseUrl?: string;
  error?: string;
  durationMs?: number;
}

/**
 * Send an ACP task notification to an agent's webhook.
 * Uses ACP protocol format instead of legacy payload.
 */
export async function sendACPTaskNotification(
  options: SendACPTaskOptions
): Promise<SendACPTaskResult> {
  const { agent, mention, channel, post } = options;

  if (!agent.webhook?.url) {
    return { success: false, error: 'Agent has no webhook URL configured' };
  }

  const webhook = agent.webhook;
  const taskPayload: ACPTaskPayload = {
    mentionId: mention.id,
    channelId: channel.id,
    channelName: channel.name,
    cwd: channel.cwd || agent.cwd,
    fromAgent: mention.mentioningAgentId || 'unknown',
    content: post.content,
    chainDepth: 0, // Will be set by caller
  };

  const message: ACPWebhookPayload = {
    protocol: ACP_VERSION,
    type: 'task',
    taskId: mention.id,
    timestamp: Date.now(),
    task: taskPayload,
  };

  // Add signature if secret configured
  if (webhook.secret) {
    message.signature = await signPayload(webhook.secret, message);
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Hive/1.0 ACP/1.0',
    ...webhook.headers,
  };

  const timeoutMs = Math.min(webhook.timeout || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(webhook.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(message),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const durationMs = Date.now() - startTime;

    if (!response.ok) {
      return {
        success: false,
        statusCode: response.status,
        error: `Webhook returned ${response.status}: ${response.statusText}`,
        durationMs,
      };
    }

    // Parse response
    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch {
      // Empty or non-JSON response is OK for synchronous acknowledgment
      return {
        success: true,
        statusCode: response.status,
        durationMs,
      };
    }

    // Check if response is ACP-compliant
    if (isACPWebhookResponse(responseBody)) {
      return {
        success: true,
        statusCode: response.status,
        responseUrl: responseBody.responseUrl,
        durationMs,
      };
    }

    return {
      success: true,
      statusCode: response.status,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';

    if (errorMessage.includes('abort')) {
      return {
        success: false,
        error: `Webhook timed out after ${timeoutMs}ms`,
        durationMs,
      };
    }

    return {
      success: false,
      error: `Webhook failed: ${errorMessage}`,
      durationMs,
    };
  }
}

// ============================================================================
// Signature Generation
// ============================================================================

/**
 * Generate HMAC-SHA256 signature for webhook payload.
 */
async function signPayload(secret: string, payload: unknown): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(payload));
  const keyData = encoder.encode(secret);

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, data);
  const hexSignature = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return `sha256=${hexSignature}`;
}

// ============================================================================
// Type Guards
// ============================================================================

function isACPWebhookResponse(obj: unknown): obj is ACPWebhookResponse {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'protocol' in obj &&
    (obj as { protocol: unknown }).protocol === ACP_VERSION &&
    'taskId' in obj &&
    'type' in obj
  );
}

// ============================================================================
// Legacy Webhook Support
// ============================================================================

/**
 * Send legacy webhook notification (non-ACP format).
 * For backwards compatibility with existing agents.
 */
export async function sendLegacyWebhook(
  agent: Agent,
  mention: Mention,
  channel: Channel,
  post: Post,
  env: Record<string, string>
): Promise<SendACPTaskResult> {
  if (!agent.webhook?.url) {
    return { success: false, error: 'Agent has no webhook URL configured' };
  }

  const webhook = agent.webhook;
  const payload = {
    mentionId: mention.id,
    agentId: agent.id,
    channelId: channel.id,
    channelName: channel.name,
    postId: post.id,
    fromAgent: mention.mentioningAgentId || 'unknown',
    content: post.content,
    timestamp: Date.now(),
    environment: env,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Hive/1.0',
    ...webhook.headers,
  };

  // Add signature if secret configured
  if (webhook.secret) {
    headers['X-Hive-Signature'] = await signPayload(webhook.secret, payload);
  }

  const timeoutMs = Math.min(webhook.timeout || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(webhook.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const durationMs = Date.now() - startTime;

    if (!response.ok) {
      return {
        success: false,
        statusCode: response.status,
        error: `Webhook returned ${response.status}`,
        durationMs,
      };
    }

    return {
      success: true,
      statusCode: response.status,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';

    return {
      success: false,
      error: errorMessage,
      durationMs,
    };
  }
}

// ============================================================================
// Smart Send (ACP or Legacy)
// ============================================================================

/**
 * Send webhook notification, choosing ACP or legacy format based on agent config.
 */
export async function sendWebhookNotification(
  options: SendACPTaskOptions,
  env?: Record<string, string>
): Promise<SendACPTaskResult> {
  const { agent } = options;

  // Use ACP format if configured
  if (agent.acp?.protocol === 'acp/1.0') {
    return sendACPTaskNotification(options);
  }

  // Fall back to legacy format
  return sendLegacyWebhook(
    agent,
    options.mention,
    options.channel,
    options.post,
    env || {}
  );
}

export default {
  sendACPTaskNotification,
  sendLegacyWebhook,
  sendWebhookNotification,
};
