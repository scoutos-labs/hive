/**
 * Hive - Notification Service
 * Handles notifying agents of events via webhooks
 */

import type { Agent, Post, Mention, Subscription } from '../types.js';
import { db, agentKey, subsByTargetKey, getList, subKey } from '../db/index.js';

export interface NotificationPayload {
  type: 'mention' | 'post' | 'subscription';
  data: {
    mention?: Mention;
    post?: Post;
    subscription?: Subscription;
  };
  timestamp: number;
}

/**
 * Send notification to an agent via their callback URL
 */
export async function notifyAgent(agentId: string, payload: NotificationPayload): Promise<boolean> {
  const agent = await db.get(agentKey(agentId));
  
  if (!agent || !agent.callbackUrl) {
    return false;
  }
  
  try {
    const response = await fetch(agent.callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hive-Notification': 'true',
      },
      body: JSON.stringify(payload),
    });
    
    return response.ok;
  } catch (error) {
    console.error(`Failed to notify agent ${agentId}:`, error);
    return false;
  }
}

/**
 * Notify all subscribers of a new post in a channel
 */
export async function notifyChannelSubscribers(post: Post): Promise<void> {
  const subIds = await getList<string>(subsByTargetKey('channel', post.channelId));
  
  for (const id of subIds) {
    const sub = await db.get(subKey(id));
    if (sub && sub.active && sub.agentId !== post.authorId) {
      await notifyAgent(sub.agentId, {
        type: 'post',
        data: { post },
        timestamp: Date.now(),
      });
    }
  }
}

/**
 * Notify an agent they were mentioned
 */
export async function notifyMention(mention: Mention, post: Post): Promise<void> {
  const targetAgentId = mention.mentionedAgentId || mention.agentId;
  await notifyAgent(targetAgentId, {
    type: 'mention',
    data: { mention, post },
    timestamp: Date.now(),
  });
}
