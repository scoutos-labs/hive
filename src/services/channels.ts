/**
 * Hive - Channel Service
 */

import { 
  db, 
  channelKey, 
  channelsListKey, 
  postKey, 
  postsByChannelKey, 
  subKey, 
  subsByAgentKey, 
  subsByTargetKey, 
  generateId, 
  addToSet, 
  removeFromSet, 
  getList 
} from '../db/index.js';
import type { Channel, Post, CreateChannelBody, CreatePostBody, Subscription } from '../types.js';

// ============================================================================
// Channel Operations
// ============================================================================

export async function createChannel(data: CreateChannelBody): Promise<Channel> {
  const id = generateId('channel');
  const channel: Channel = {
    id,
    name: data.name,
    description: data.description,
    visibility: data.visibility || 'public',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await db.put(channelKey(id), channel);
  await addToSet(channelsListKey(), id);

  return channel;
}

export async function getChannel(id: string): Promise<Channel | null> {
  const channel = await db.get(channelKey(id));
  return channel || null;
}

export async function listChannels(): Promise<Channel[]> {
  const channelIds = await getList<string>(channelsListKey());
  const channels: Channel[] = [];

  for (const id of channelIds) {
    const channel = await db.get(channelKey(id));
    if (channel && channel.visibility === 'public') {
      channels.push(channel);
    }
  }

  return channels.sort((a, b) => b.createdAt - a.createdAt);
}

export async function updateChannel(id: string, data: Partial<Channel>): Promise<Channel | null> {
  const channel = await getChannel(id);
  if (!channel) return null;

  const updated: Channel = {
    ...channel,
    ...data,
    id,
    updatedAt: Date.now(),
  };

  await db.put(channelKey(id), updated);
  return updated;
}

export async function deleteChannel(id: string): Promise<boolean> {
  const channel = await getChannel(id);
  if (!channel) return false;

  await db.remove(channelKey(id));
  await removeFromSet(channelsListKey(), id);

  return true;
}

// ============================================================================
// Post Operations
// ============================================================================

export async function createPost(channelId: string, data: CreatePostBody): Promise<Post> {
  const id = generateId('post');

  // Extract mentions from content (@agentId)
  const mentionRegex = /@(\w[\w-]*)/g;
  const mentions: string[] = [];
  let match;
  while ((match = mentionRegex.exec(data.content)) !== null) {
    mentions.push(match[1]);
  }

  const post: Post = {
    id,
    channelId,
    authorId: data.authorId,
    content: data.content,
    mentions,
    createdAt: Date.now(),
  };

  await db.put(postKey(id), post);
  await addToSet(postsByChannelKey(channelId), id);

  return post;
}

export async function getPost(id: string): Promise<Post | null> {
  const post = await db.get(postKey(id));
  return post || null;
}

export async function listPosts(channelId: string, before?: number, limit = 50): Promise<Post[]> {
  const postIds = await getList<string>(postsByChannelKey(channelId));
  const posts: Post[] = [];

  for (const id of postIds) {
    const post = await db.get(postKey(id));
    if (post) {
      if (before && post.createdAt >= before) continue;
      posts.push(post);
      if (posts.length >= limit) break;
    }
  }

  return posts.sort((a, b) => b.createdAt - a.createdAt);
}

// ============================================================================
// Subscription Operations
// ============================================================================

export async function subscribeToChannel(channelId: string, agentId: string): Promise<void> {
  const subId = `${agentId}:${channelId}`;
  
  const subscription: Subscription = {
    id: subId,
    agentId,
    targetType: 'channel',
    targetId: channelId,
    createdAt: Date.now(),
  };

  await db.put(subKey(subId), subscription);
  await addToSet(subsByAgentKey(agentId), subId);
  await addToSet(subsByTargetKey('channel', channelId), subId);
}

export async function unsubscribeFromChannel(channelId: string, agentId: string): Promise<void> {
  const subId = `${agentId}:${channelId}`;

  await db.remove(subKey(subId));
  await removeFromSet(subsByAgentKey(agentId), subId);
  await removeFromSet(subsByTargetKey('channel', channelId), subId);
}

export async function getChannelSubscribers(channelId: string): Promise<string[]> {
  const subIds = await getList<string>(subsByTargetKey('channel', channelId));
  const agentIds = new Set<string>();

  for (const subId of subIds) {
    const sub = await db.get(subKey(subId));
    if (sub) {
      agentIds.add(sub.agentId);
    }
  }

  return Array.from(agentIds);
}

export async function getAgentSubscriptions(agentId: string): Promise<string[]> {
  const subIds = await getList<string>(subsByAgentKey(agentId));
  const channelIds: string[] = [];

  for (const subId of subIds) {
    const sub = await db.get(subKey(subId));
    if (sub && sub.targetType === 'channel') {
      channelIds.push(sub.targetId);
    }
  }

  return channelIds;
}

export async function isSubscribed(channelId: string, agentId: string): Promise<boolean> {
  const subId = `${agentId}:${channelId}`;
  const sub = await db.get(subKey(subId));
  return !!sub;
}