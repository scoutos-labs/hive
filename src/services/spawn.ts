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

// ============================================================================
// Create a post from agent output (triggers mention chain)
// ============================================================================

async function createAgentResponsePost(
  room: Room,
  authorId: string,
  output: string,
  replyToPostId?: string
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
  
  console.log(`[spawn] Created agent response post ${postId} with mentions: ${mentions.join(', ')}`);
  
  // Process mentions in this post (triggers spawn chain)
  await processMentions(post, room);
  
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
  room: Room
): Promise<void> {
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
    FROM_AGENT: mention.mentioningAgentId || 'unknown',
    MENTION_CONTENT: post.content,
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

  const args = agent.spawnArgs || [];
  
  // Update status to running
  await updateMentionStatus(mention.id, 'running');
  await emitHiveEvent(
    'task.started',
    {
      taskId: mention.id,
      mentionId: mention.id,
      agentId,
      roomId: room.id,
      postId: post.id,
    },
    'spawn:spawnAgent'
  );
  
  try {
    // Spawn directly (without shell interpolation) so user-controlled args are
    // passed as literal argv entries.
    const child = spawn(command, args, {
      cwd: agent.cwd,
      env,
      detached: false, // Wait for completion to capture output
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let settled = false;
    
    // Capture stdout and stderr
    let stdout = '';
    let stderr = '';
    
    child.stdout?.on('data', (data) => {
      stdout += data.toString();
      // Log in real-time for debugging
      console.log(`[spawn:${agentId}:out] ${data.toString().slice(0, 200)}...`);
      void emitHiveEvent(
        'task.progress',
        {
          taskId: mention.id,
          mentionId: mention.id,
          agentId,
          roomId: room.id,
          postId: post.id,
          stream: 'stdout',
          chunk: data.toString().slice(0, 1000),
        },
        'spawn:stdout'
      );
    });
    
    child.stderr?.on('data', (data) => {
      stderr += data.toString();
      console.error(`[spawn:${agentId}:err] ${data.toString().slice(0, 200)}...`);
      void emitHiveEvent(
        'task.progress',
        {
          taskId: mention.id,
          mentionId: mention.id,
          agentId,
          roomId: room.id,
          postId: post.id,
          stream: 'stderr',
          chunk: data.toString().slice(0, 1000),
        },
        'spawn:stderr'
      );
    });
    
    // Handle completion
    child.once('close', async (code) => {
      if (settled) return;
      settled = true;

      const success = code === 0;
      const output = stdout.slice(-10000); // Keep last 10KB
      const error = stderr.slice(-5000) || undefined;
      
      if (success) {
        console.log(`[spawn] Agent ${agentId} completed successfully (PID: ${child.pid})`);
        await updateMentionStatus(mention.id, 'completed', output, undefined);
        
        // Check for @mentions in output - if found, create a post (triggers chain)
        const mentionRegex = /@([a-zA-Z0-9_-]+)/g;
        const hasMentions = mentionRegex.test(stdout);
        let responsePostId: string | undefined;
        
        if (hasMentions) {
          console.log(`[spawn] Output contains mentions, creating response post`);
          const responsePost = await createAgentResponsePost(room, agentId, stdout, post.id);
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
            outputLength: stdout.length,
            responsePostId,
          },
          'spawn:close'
        );
      } else {
        console.error(`[spawn] Agent ${agentId} failed with code ${code}`);
        await updateMentionStatus(mention.id, 'failed', output, error);
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
          },
          'spawn:close'
        );
      }
      
      console.log(`[spawn] Output length: ${stdout.length} chars`);
    });
    
    child.once('error', async (err) => {
      if (settled) return;
      settled = true;

      console.error(`[spawn] Failed to spawn agent ${agentId}:`, err.message);
      await updateMentionStatus(mention.id, 'failed', undefined, err.message);
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

export async function processMentions(post: Post, room: Room): Promise<Mention[]> {
  const mentions: Mention[] = [];
  
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
    const isSubscribed = await isAgentSubscribedToRoom(mentionedAgentId, post.roomId);
    if (!isSubscribed) {
      console.log(`[mentions] Agent ${mentionedAgentId} not subscribed to room ${post.roomId}, skipping spawn`);
    }
    
    // Mention records are created even for unsubscribed agents so operators can
    // audit intent and see why no spawn was triggered.
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
    
    // Only spawn if subscribed
    if (isSubscribed) {
      // Spawn asynchronously - don't await
      spawnAgent(mentionedAgentId, mention, post, room).catch(err => {
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
