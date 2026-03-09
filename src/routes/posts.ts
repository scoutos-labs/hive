/**
 * Hive - Post Routes
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { db, postKey, postsByChannelKey, channelKey, channelsListKey, generateId, addToSet, removeFromSet, getList } from '../db/index.js';
import { processMentions } from '../services/spawn.js';
import type { Post, PostCreateInput, ApiResponse, PaginatedResponse } from '../types.js';

export const postsRouter = new Hono();

// Validation schemas
const createPostSchema = z.object({
  channelId: z.string().min(1),
  authorId: z.string().min(1),
  content: z.string().min(1).max(10000),
  replyTo: z.string().optional(),
});

// Helper to extract mentions from content (@agentId pattern)
function extractMentions(content: string): string[] {
  const mentionRegex = /@([a-zA-Z0-9_-]+)/g;
  const mentions: string[] = [];
  let match;
  
  while ((match = mentionRegex.exec(content)) !== null) {
    mentions.push(match[1]);
  }
  
  return [...new Set(mentions)]; // unique mentions
}

// POST /posts - Create a new post
postsRouter.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const validated = createPostSchema.parse(body);
    
    // Verify channel exists
    const channel = db.get(channelKey(validated.channelId)) as any;
    if (!channel) {
      return c.json<ApiResponse<never>>(
        { success: false, error: 'Channel not found' },
        404
      );
    }
    
    const postId = generateId('post');
    const now = Date.now();
    const mentions = extractMentions(validated.content);
    
    const post: Post = {
      id: postId,
      channelId: validated.channelId,
      authorId: validated.authorId,
      content: validated.content,
      createdAt: now,
      updatedAt: now,
      replyTo: validated.replyTo,
      mentions,
    };
    
    await db.put(postKey(postId), post);
    await addToSet(postsByChannelKey(validated.channelId), postId);
    
    // Process mentions (create records + spawn agents)
    const processedMentions = await processMentions(post, channel);
    
    return c.json<ApiResponse<Post>>({
      success: true,
      data: {
        ...post,
        processedMentions: processedMentions.length,
      } as any,
    }, 201);
  } catch (error) {
    console.error('[posts] Error creating post:', error);
    return c.json<ApiResponse<never>>(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      400
    );
  }
});

// GET /posts - List posts (optionally filter by channel)
postsRouter.get('/', async (c) => {
  const channelId = c.req.query('channelId');
  
  if (channelId) {
    const postIds = await getList<string>(postsByChannelKey(channelId));
    const posts: Post[] = [];
    
    for (const id of postIds) {
      const post = db.get(postKey(id));
      if (post) posts.push(post);
    }
    
    // Sort by creation time (newest first)
    posts.sort((a, b) => b.createdAt - a.createdAt);
    
    return c.json<PaginatedResponse<Post>>({
      success: true,
      data: posts,
      total: posts.length,
      limit: 100,
      offset: 0,
    });
  }
  
  const channelIds = await getList<string>(channelsListKey());
  const seen = new Set<string>();
  const allPosts: Post[] = [];

  for (const id of channelIds) {
    const postIds = await getList<string>(postsByChannelKey(id));
    for (const postId of postIds) {
      if (seen.has(postId)) continue;
      const post = db.get(postKey(postId));
      if (!post) continue;
      seen.add(postId);
      allPosts.push(post);
    }
  }

  allPosts.sort((a, b) => b.createdAt - a.createdAt);

  return c.json<PaginatedResponse<Post>>({
    success: true,
    data: allPosts,
    total: allPosts.length,
    limit: 100,
    offset: 0,
  });
});

// GET /posts/errors - Get all errors across channels
postsRouter.get('/errors', async (c) => {
  const sinceParam = parseInt(c.req.query('since') || '0', 10);
  const limitParam = parseInt(c.req.query('limit') || '50', 10);
  const since = Number.isFinite(sinceParam) && sinceParam > 0 ? sinceParam : 0;
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50;

  const channelIds = await getList<string>(channelsListKey());
  const errors: Post[] = [];

  for (const channelId of channelIds) {
    const postIds = await getList<string>(postsByChannelKey(channelId));

    for (const id of postIds) {
      const post = db.get(postKey(id));
      if (!post || post.authorId !== 'hive') continue;

      try {
        const content = JSON.parse(post.content);
        if (content.type === 'error' && post.createdAt >= since) {
          errors.push(post);
        }
      } catch {
        continue;
      }
    }
  }

  errors.sort((a, b) => b.createdAt - a.createdAt);

  return c.json({ success: true, data: errors.slice(0, limit) });
});

// GET /posts/:id - Get a specific post
postsRouter.get('/:id', async (c) => {
  const { id } = c.req.param();
  const post = db.get(postKey(id));
  
  if (!post) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Post not found' }, 404);
  }
  
  return c.json<ApiResponse<Post>>({ success: true, data: post });
});

// DELETE /posts/:id - Delete a post
postsRouter.delete('/:id', async (c) => {
  const { id } = c.req.param();
  const post = db.get(postKey(id));
  
  if (!post) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Post not found' }, 404);
  }
  
  // Remove primary record and its channel-index entry so list queries stay consistent
  await db.remove(postKey(id));
  await removeFromSet(postsByChannelKey(post.channelId), id);
  
  return c.json<ApiResponse<never>>({ success: true });
});

export default postsRouter;
