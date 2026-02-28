/**
 * Hive - Spawn Service
 * 
 * Spawns agents when they are mentioned in posts.
 */

import { spawn } from 'child_process';
import { 
  db, 
  agentKey, 
  subKey, 
  mentionKey, 
  mentionsByAgentKey, 
  mentionsByRoomKey, 
  generateId, 
  addToSet, 
  getList 
} from '../db/index.js';
import type { Agent, Mention, Room, Post } from '../types.js';

// ============================================================================
// Check if agent is subscribed to a room
// ============================================================================

export async function isAgentSubscribedToRoom(agentId: string, roomId: string): Promise<boolean> {
  // Get all subscriptions for this agent
  const subIds = await getList<string>(`subs!agent!${agentId}`);
  
  for (const subId of subIds) {
    const sub = await db.get(subKey(subId));
    if (sub && sub.targetType === 'room' && sub.targetId === roomId && sub.active) {
      return true;
    }
  }
  
  return false;
}

// ============================================================================
// Create a mention record
// ============================================================================

export async function createMention(
  postId: string,
  roomId: string,
  mentionedAgentId: string,
  mentioningAgentId: string
): Promise<Mention> {
  const mentionId = generateId('mention');
  
  const mention: Mention = {
    id: mentionId,
    agentId: mentionedAgentId,
    postId,
    mentionedAgentId,
    mentioningAgentId,
    roomId,
    createdAt: Date.now(),
    read: false,
  };
  
  await db.put(mentionKey(mentionId), mention);
  await addToSet(mentionsByAgentKey(mentionedAgentId), mentionId);
  await addToSet(mentionsByRoomKey(roomId), mentionId);
  
  return mention;
}

// ============================================================================
// Spawn an agent process
// ============================================================================

export async function spawnAgent(agentId: string, mention: Mention, post: Post, room: Room): Promise<void> {
  // Get agent config
  const agent = await db.get(agentKey(agentId)) as Agent | undefined;
  
  if (!agent) {
    console.log(`[spawn] Agent ${agentId} not found, skipping spawn`);
    return;
  }
  
  console.log(`[spawn] Spawning agent ${agentId} for mention ${mention.id}`);
  
  // Build environment with mention context
  const env = {
    ...process.env,
    MENTION_ID: mention.id,
    ROOM_ID: room.id,
    ROOM_NAME: room.name,
    POST_ID: post.id,
    FROM_AGENT: mention.mentioningAgentId || '',
    MENTION_CONTENT: post.content.slice(0, 500),
  };
  
  const args = agent.spawnArgs || [];
  
  try {
    const child = spawn(agent.spawnCommand, args, {
      cwd: agent.cwd,
      env,
      detached: true,
      stdio: 'ignore',
    });
    
    child.unref(); // Don't wait for child to complete
    
    child.on('error', (err) => {
      console.error(`[spawn] Failed to spawn agent ${agentId}:`, err.message);
    });
    
    console.log(`[spawn] Spawned agent ${agentId} (PID: ${child.pid})`);
  } catch (err) {
    console.error(`[spawn] Error spawning agent ${agentId}:`, err);
  }
}

// ============================================================================
// Process mentions in a post
// ============================================================================

export async function processMentions(post: Post, room: Room): Promise<Mention[]> {
  const mentions: Mention[] = [];
  
  for (const mentionedAgentId of post.mentions) {
    // Check if agent exists
    const agent = await db.get(agentKey(mentionedAgentId)) as Agent | undefined;
    if (!agent) {
      console.log(`[mentions] Agent ${mentionedAgentId} not found, skipping`);
      continue;
    }
    
    // Check if agent is subscribed to the room
    const isSubscribed = await isAgentSubscribedToRoom(mentionedAgentId, post.roomId);
    if (!isSubscribed) {
      console.log(`[mentions] Agent ${mentionedAgentId} not subscribed to room ${post.roomId}, skipping spawn`);
      // Still create the mention record, just don't spawn
    }
    
    // Create mention record
    const mention = await createMention(
      post.id,
      post.roomId,
      mentionedAgentId,
      post.authorId
    );
    
    mentions.push(mention);
    
    // Only spawn if subscribed
    if (isSubscribed) {
      await spawnAgent(mentionedAgentId, mention, post, room);
    }
  }
  
  return mentions;
}