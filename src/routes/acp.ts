/**
 * Hive - ACP Routes
 * 
 * HTTP endpoints for ACP protocol messages.
 * - Receive responses from external agents
 * - Receive progress updates
 * - Handle clarification responses
 */

import { Hono } from 'hono';
import { db, mentionKey, postKey, channelKey } from '../db/index.js';
import { emitHiveEvent } from '../services/events.js';
import {
  parseACPResponseMessage,
  parseACPProgressMessage,
  validateACPResponse,
} from '../services/acp/parser.js';
import { formatAgentOutputForPost } from '../services/acp/format.js';
import type { ApiResponse } from '../types.js';
import type { ACPResponsePayload, ACPProgressPayload } from '../types/acp.js';

// Logging helper
const log = {
  info: (msg: string, ...args: unknown[]) => console.log(`[acp-route] ${msg}`, ...args),
  error: (msg: string, ...args: unknown[]) => console.error(`[acp-route] ${msg}`, ...args),
  debug: (msg: string, ...args: unknown[]) => {
    if (process.env.ACP_DEBUG === 'true' || process.env.DEBUG === 'true') {
      console.log(`[acp-route:debug] ${msg}`, ...args);
    }
  },
};

export const acpRouter = new Hono();

// ============================================================================
// POST /acp/response - Receive ACP Response
// ============================================================================

/**
 * Receive a response from an external agent via ACP.
 * Creates a post in the channel with the response.
 *
 * Body: ACPResponseMessage JSON
 */
acpRouter.post('/response', async (c) => {
  log.info('POST /acp/response - Received ACP response');
  const body = await c.req.json().catch(() => null);

  if (!body) {
    log.error('Invalid JSON body');
    return c.json<ApiResponse>(
      { success: false, error: 'Invalid JSON body' },
      400
    );
  }

  log.debug('Response body:', JSON.stringify(body).slice(0, 500));

  // Validate ACP message structure
  const parseResult = parseACPResponseMessage(JSON.stringify(body));

  if (!parseResult.success || !parseResult.message) {
    log.error(`Invalid ACP response: ${parseResult.error}`);
    return c.json<ApiResponse>(
      { success: false, error: parseResult.error || 'Invalid ACP response' },
      400
    );
  }

  const message = parseResult.message;
  const payload = message.payload as ACPResponsePayload;
  log.info(`Valid ACP response for task ${message.taskId}, status: ${payload.status}`);

  // Validate response payload
  const validation = validateACPResponse(payload);
  if (!validation.valid) {
    log.error(`Invalid response payload: ${validation.errors.join(', ')}`);
    return c.json<ApiResponse>(
      { success: false, error: `Invalid response payload: ${validation.errors.join(', ')}` },
      400
    );
  }

  // Find the mention
  const mentionId = message.taskId;
  const mention = await db.get(mentionKey(mentionId));

  if (!mention) {
    log.error(`Mention not found: ${mentionId}`);
    return c.json<ApiResponse>(
      { success: false, error: `Mention not found: ${mentionId}` },
      404
    );
  }

  log.info(`Found mention ${mentionId} for agent ${mention.agentId}`);

  // Get channel
  const channel = await db.get(channelKey(mention.channelId));
  if (!channel) {
    log.error(`Channel not found: ${mention.channelId}`);
    return c.json<ApiResponse>(
      { success: false, error: `Channel not found: ${mention.channelId}` },
      404
    );
  }

  // Update mention status
  const status = payload.status === 'completed' ? 'completed' :
                  payload.status === 'failed' ? 'failed' : 'completed';

  log.info(`Updating mention ${mentionId} status to ${status}`);

  mention.spawnStatus = status;
  mention.spawnOutput = payload.message;
  if (status === 'completed' || status === 'failed') {
    mention.completedAt = Date.now();
  }
  await db.put(mentionKey(mentionId), mention);

  // Create response post
  const postId = `post_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const agentId = mention.agentId;

  // Format the response for the channel
  const postContent = formatAgentOutputForPost({
    acpMessages: [message],
    rawLines: [],
    textContent: payload.message,
    hasACP: true,
    progress: [],
    clarifications: [],
    errors: payload.status === 'failed' ? [{ code: 'error', message: payload.error?.message || 'Unknown error' }] : [],
    finalResponse: payload,
  });

  log.info(`Creating response post ${postId} for channel ${channel.id}`);
  log.debug(`Post content: ${postContent.slice(0, 200)}...`);

  const post = {
    id: postId,
    channelId: channel.id,
    authorId: agentId,
    content: postContent,
    createdAt: Date.now(),
    mentions: payload.mentions || [],
  };

  await db.put(postKey(postId), post);
  log.info(`Post ${postId} created successfully`);

  // Emit event
  await emitHiveEvent(
    'task.completed',
    {
      taskId: mentionId,
      mentionId,
      agentId,
      channelId: channel.id,
      postId,
      responsePostId: postId,
      status: payload.status,
    },
    'acp:response'
  );

  log.info(`ACP response processed successfully for task ${mentionId}`);

  return c.json({
    success: true,
    data: {
      mentionId,
      postId,
      status: payload.status,
    },
  });
});

// ============================================================================
// POST /acp/progress - Receive Progress Update
// ============================================================================

/**
 * Receive a progress update from an agent.
 * Emits a progress event for SSE subscribers.
 *
 * Body: ACPProgressMessage JSON
 */
acpRouter.post('/progress', async (c) => {
  const body = await c.req.json().catch(() => null);

  if (!body) {
    return c.json<ApiResponse>(
      { success: false, error: 'Invalid JSON body' },
      400
    );
  }

  const parseResult = parseACPProgressMessage(JSON.stringify(body));

  if (!parseResult.success || !parseResult.message) {
    return c.json<ApiResponse>(
      { success: false, error: parseResult.error || 'Invalid ACP progress' },
      400
    );
  }

  const message = parseResult.message;
  const payload = message.payload as ACPProgressPayload;

  // Find mention
  const mentionId = message.taskId;
  const mention = await db.get(mentionKey(mentionId));

  if (!mention) {
    return c.json<ApiResponse>(
      { success: false, error: `Mention not found: ${mentionId}` },
      404
    );
  }

  // Emit progress event
  await emitHiveEvent(
    'task.progress',
    {
      taskId: mentionId,
      mentionId,
      agentId: mention.agentId,
      channelId: mention.channelId,
      percent: payload.percent,
      message: payload.message,
      stage: payload.stage,
    },
    'acp:progress'
  );

  return c.json({
    success: true,
    data: {
      mentionId,
      percent: payload.percent,
      message: payload.message,
    },
  });
});

// ============================================================================
// POST /acp/clarification-response - Answer Clarification
// ============================================================================

/**
 * Provide answers to a clarification request.
 * This resumes a paused agent that was waiting for input.
 *
 * Body: { taskId: string, answers: Record<string, string | string[]> }
 */
acpRouter.post('/clarification-response', async (c) => {
  const body = await c.req.json().catch(() => null);

  if (!body || !body.taskId || !body.answers) {
    return c.json<ApiResponse>(
      { success: false, error: 'Missing taskId or answers' },
      400
    );
  }

  const { taskId, answers } = body;

  // Find mention
  const mention = await db.get(mentionKey(taskId));

  if (!mention) {
    return c.json<ApiResponse>(
      { success: false, error: `Mention not found: ${taskId}` },
      404
    );
  }

  // Store clarification response
  // In a full implementation, this would resume the paused agent
  // For now, we emit an event that can be consumed by the spawn service

  await emitHiveEvent(
    'task.progress',
    {
      taskId,
      mentionId: taskId,
      agentId: mention.agentId,
      channelId: mention.channelId,
      stage: 'clarification_response',
      answers,
    },
    'acp:clarification_response'
  );

  return c.json({
    success: true,
    data: {
      mentionId: taskId,
      status: 'clarification_answered',
    },
  });
});

// ============================================================================
// POST /acp/webhook - Receive Webhook from External Agent
// ============================================================================

/**
 * Receive a webhook notification from an external agent.
 * This is the primary endpoint for remote agents using ACP.
 *
 * Body: ACPWebhookPayload or legacy webhook payload
 * 
 * For async responses, agents should POST to /acp/response later.
 */
acpRouter.post('/webhook', async (c) => {
  const body = await c.req.json().catch(() => null);

  if (!body) {
    return c.json<ApiResponse>(
      { success: false, error: 'Invalid JSON body' },
      400
    );
  }

  // Check if this is an ACP message
  if (body.protocol === 'acp/1.0' && body.type === 'task') {
    // This is a webhook notification FROM Hive TO an external agent
    // This endpoint shouldn't receive those - external agents should respond
    return c.json<ApiResponse>(
      { success: false, error: 'This endpoint receives responses, not task notifications' },
      400
    );
  }

  // Check if this is a response
  if (body.protocol === 'acp/1.0' && body.type === 'response') {
    // Forward to /response endpoint
    const response = await fetch(new URL('/acp/response', c.req.url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return response;
  }

  // Legacy webhook format
  if (body.mentionId && body.agentId) {
    // Legacy response format
    const mentionId = body.mentionId;
    const mention = await db.get(mentionKey(mentionId));

    if (!mention) {
      return c.json<ApiResponse>(
        { success: false, error: `Mention not found: ${mentionId}` },
        404
      );
    }

    // Update mention status
    mention.spawnStatus = body.status || 'completed';
    mention.spawnOutput = body.output || body.message || '';
    mention.completedAt = Date.now();
    await db.put(mentionKey(mentionId), mention);

    // Create post if content provided
    if (body.content || body.message) {
      const channel = await db.get(channelKey(mention.channelId));
      if (channel) {
        const postId = `post_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const post = {
          id: postId,
          channelId: channel.id,
          authorId: body.agentId,
          content: body.content || body.message,
          createdAt: Date.now(),
          mentions: body.mentions || [],
        };
        await db.put(postKey(postId), post);
      }
    }

    return c.json({ success: true, mentionId });
  }

  return c.json<ApiResponse>(
    { success: false, error: 'Unknown payload format' },
    400
  );
});

export default acpRouter;
