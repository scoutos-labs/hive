/**
 * Hive - Room Service
 */

import { 
  db, 
  roomKey, 
  roomsListKey, 
  postKey, 
  postsByRoomKey, 
  subKey, 
  subsByAgentKey, 
  subsByTargetKey, 
  generateId, 
  addToSet, 
  removeFromSet, 
  getList 
} from '../db/index.js';
import type { Room, Post, CreateRoomBody, CreatePostBody, Subscription } from '../types.js';

// ============================================================================
// Room Operations
// ============================================================================

export async function createRoom(data: CreateRoomBody): Promise<Room> {
  const id = generateId('room');
  const room: Room = {
    id,
    name: data.name,
    description: data.description,
    visibility: data.visibility || 'public',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await db.put(roomKey(id), room);
  await addToSet(roomsListKey(), id);

  return room;
}

export async function getRoom(id: string): Promise<Room | null> {
  const room = await db.get(roomKey(id));
  return room || null;
}

export async function listRooms(): Promise<Room[]> {
  const roomIds = await getList<string>(roomsListKey());
  const rooms: Room[] = [];

  for (const id of roomIds) {
    const room = await db.get(roomKey(id));
    if (room && room.visibility === 'public') {
      rooms.push(room);
    }
  }

  return rooms.sort((a, b) => b.createdAt - a.createdAt);
}

export async function updateRoom(id: string, data: Partial<Room>): Promise<Room | null> {
  const room = await getRoom(id);
  if (!room) return null;

  const updated: Room = {
    ...room,
    ...data,
    id,
    updatedAt: Date.now(),
  };

  await db.put(roomKey(id), updated);
  return updated;
}

export async function deleteRoom(id: string): Promise<boolean> {
  const room = await getRoom(id);
  if (!room) return false;

  await db.remove(roomKey(id));
  await removeFromSet(roomsListKey(), id);

  return true;
}

// ============================================================================
// Post Operations
// ============================================================================

export async function createPost(roomId: string, data: CreatePostBody): Promise<Post> {
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
    roomId,
    authorId: data.authorId,
    content: data.content,
    mentions,
    createdAt: Date.now(),
  };

  await db.put(postKey(id), post);
  await addToSet(postsByRoomKey(roomId), id);

  return post;
}

export async function getPost(id: string): Promise<Post | null> {
  const post = await db.get(postKey(id));
  return post || null;
}

export async function listPosts(roomId: string, before?: number, limit = 50): Promise<Post[]> {
  const postIds = await getList<string>(postsByRoomKey(roomId));
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

export async function subscribeToRoom(roomId: string, agentId: string): Promise<void> {
  const subId = `${agentId}:${roomId}`;
  
  const subscription: Subscription = {
    id: subId,
    agentId,
    targetType: 'room',
    targetId: roomId,
    createdAt: Date.now(),
  };

  await db.put(subKey(subId), subscription);
  await addToSet(subsByAgentKey(agentId), subId);
  await addToSet(subsByTargetKey('room', roomId), subId);
}

export async function unsubscribeFromRoom(roomId: string, agentId: string): Promise<void> {
  const subId = `${agentId}:${roomId}`;

  await db.remove(subKey(subId));
  await removeFromSet(subsByAgentKey(agentId), subId);
  await removeFromSet(subsByTargetKey('room', roomId), subId);
}

export async function getRoomSubscribers(roomId: string): Promise<string[]> {
  const subIds = await getList<string>(subsByTargetKey('room', roomId));
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
  const roomIds: string[] = [];

  for (const subId of subIds) {
    const sub = await db.get(subKey(subId));
    if (sub && sub.targetType === 'room') {
      roomIds.push(sub.targetId);
    }
  }

  return roomIds;
}

export async function isSubscribed(roomId: string, agentId: string): Promise<boolean> {
  const subId = `${agentId}:${roomId}`;
  const sub = await db.get(subKey(subId));
  return !!sub;
}