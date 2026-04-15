/**
 * Hive - Mention Service
 * Handles mention creation and notification logic
 */

import { spawn } from 'child_process';
import { 
  db, 
  mentionKey, 
  mentionsByAgentKey, 
  generateId, 
  addToSet, 
  getList 
} from '../db/index.js';
import * as channelsService from './channels.js';
import * as agentsService from './agents.js';
import type { Mention, Agent } from '../types.js';

// ============================================================================
// Mention Processing
// ============================================================================

/**
 * Process mentions in a post - spawn agents for subscribed mentions
 */
export async function processMentions(
  postId: string,
  channelId: string,
  channelName: string,
  authorId: string,
  content: string,
  mentions: string[]
): Promise<Mention[]> {
  const createdMentions: Mention[] = [];

  for (const agentId of mentions) {
    // Check if agent exists
    const agent = await agentsService.getAgent(agentId);
    if (!agent) {
      console.log(`[mentions] Agent ${agentId} not found, skipping`);
      continue;
    }

    // Check if agent is subscribed to the channel
    const subscribed = await channelsService.isSubscribed(channelId, agentId);
    if (!subscribed) {
      console.log(`[mentions] Agent ${agentId} not subscribed to channel ${channelId}, skipping`);
      continue;
    }

    // Create mention record
    const mentionId = generateId('mention');
    const mention: Mention = {
      id: mentionId,
      agentId,
      postId,
      channelId,
      channelName,
      fromAgentId: authorId,
      content: content.slice(0, 500), // Truncate for storage
      createdAt: Date.now(),
      acknowledged: false,
    };

    // Store mention
    await db.put(mentionKey(mentionId), mention);
    await addToSet(mentionsByAgentKey(agentId), mentionId);

    createdMentions.push(mention);

    // Spawn agent
    await spawnAgentForMention(agent, mention);
  }

  return createdMentions;
}

/**
 * Spawn an agent when mentioned - supports both webhook and local spawn
 */
async function spawnAgentForMention(agent: Agent, mention: Mention): Promise<void> {
  const env = {
    ...process.env,
    MENTION_ID: mention.id,
    CHANNEL_ID: mention.channelId,
    CHANNEL_NAME: mention.channelName || '',
    POST_ID: mention.postId,
    FROM_AGENT: mention.fromAgentId || '',
    MENTION_CONTENT: mention.content || '',
    WORKSPACE: agent.cwd || process.cwd(),
    // Also provide as JSON for easier parsing
    MENTION_PAYLOAD: JSON.stringify({
      mentionId: mention.id,
      agentId: agent.id,
      channelId: mention.channelId,
      channelName: mention.channelName,
      postId: mention.postId,
      fromAgent: mention.fromAgentId,
      content: mention.content,
      timestamp: mention.createdAt,
    }),
  };

  // Fire webhook if configured
  if (agent.webhook) {
    await notifyViaWebhook(agent, mention, env);
  }

  // Spawn locally if spawnCommand configured
  if (agent.spawnCommand) {
    await spawnLocally(agent, mention, env);
  }

  // If neither configured, log warning
  if (!agent.webhook && !agent.spawnCommand) {
    console.warn(`[mentions] Agent ${agent.id} has no webhook or spawnCommand, mention will not be processed`);
  }
}

/**
 * Notify a remote agent via webhook
 */
async function notifyViaWebhook(
  agent: Agent,
  mention: Mention,
  env: Record<string, string>
): Promise<void> {
  if (!agent.webhook) return;

  const { secret, headers = {}, timeout = 30000 } = agent.webhook;
  const webhookUrl = agent.webhook.url;

  const payload = {
    // OpenClaw-compatible fields
    name: agent.id,              // Agent name for spawning
    message: mention.content,    // Message content
    
    // Original Hive fields (for reference)
    mentionId: mention.id,
    agentId: agent.id,
    channelId: mention.channelId,
    channelName: mention.channelName,
    postId: mention.postId,
    fromAgent: mention.fromAgentId,
    content: mention.content,
    timestamp: mention.createdAt,
    environment: env,
  };

  const body = JSON.stringify(payload);

  // Create HMAC signature if secret provided
  let signature: string | undefined;
  if (secret) {
    signature = await createHmacSignature(secret, body);
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(signature ? { 'X-Hive-Signature': signature } : {}),
        ...headers,
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`[mentions] Webhook failed for agent ${agent.id}: ${response.status} ${response.statusText}`);
    } else {
      console.log(`[mentions] Agent ${agent.id} notified via webhook (${response.status})`);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[mentions] Webhook error for ${agent.id}:`, errorMessage);
  }
}

/**
 * Create HMAC-SHA256 signature for webhook payload
 */
async function createHmacSignature(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const bodyData = encoder.encode(body);

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, bodyData);
  const signatureBytes = new Uint8Array(signature);
  const signatureHex = Array.from(signatureBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return `sha256=${signatureHex}`;
}

/**
 * Spawn agent process locally (original behavior)
 */
async function spawnLocally(
  agent: Agent,
  mention: Mention,
  env: Record<string, string>
): Promise<void> {
  const command = agent.spawnCommand || 'openclaw';
  const rawArgs = agent.spawnArgs || ['--context', 'mention'];

  // Substitute variables in args
  const args = rawArgs.map(arg => {
    return arg
      .replace(/\$MENTION_CONTENT/g, mention.content || '')
      .replace(/\$WORKSPACE/g, agent.cwd || process.cwd())
      .replace(/\$CHANNEL_ID/g, mention.channelId || '')
      .replace(/\$POST_ID/g, mention.postId || '')
      .replace(/\$MENTION_ID/g, mention.id || '');
  });

  try {
    const child = spawn(command, args, {
      cwd: agent.cwd,
      env,
      detached: true,
      stdio: 'ignore',
    });

    child.unref(); // Don't wait for child to complete

    child.on('error', (err) => {
      console.error(`[mentions] Failed to spawn agent ${agent.id}:`, err.message);
    });

    console.log(`[mentions] Spawned agent ${agent.id} locally (PID: ${child.pid})`);
  } catch (err) {
    console.error(`[mentions] Spawn error for ${agent.id}:`, err);
  }
}

// ============================================================================
// Mention Queries
// ============================================================================

/**
 * Get mentions for an agent
 */
export async function getAgentMentions(
  agentId: string,
  unacknowledgedOnly = false,
  limit = 50
): Promise<Mention[]> {
  const mentionIds = await getList<string>(mentionsByAgentKey(agentId));
  const mentions: Mention[] = [];

  for (const id of mentionIds) {
    const mention = await db.get(mentionKey(id));
    if (mention) {
      if (unacknowledgedOnly && mention.acknowledged) continue;
      mentions.push(mention);
      if (mentions.length >= limit) break;
    }
  }

  return mentions.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Acknowledge a mention
 */
export async function acknowledgeMention(mentionId: string): Promise<Mention | null> {
  const mention = await db.get(mentionKey(mentionId));
  if (!mention) return null;

  mention.acknowledged = true;
  await db.put(mentionKey(mentionId), mention);

  return mention;
}

/**
 * Get a specific mention
 */
export async function getMention(id: string): Promise<Mention | null> {
  const mention = await db.get(mentionKey(id));
  return mention || null;
}
