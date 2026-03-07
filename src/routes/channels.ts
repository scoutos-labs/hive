/**
 * Hive - Channel Routes
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { db, channelKey, channelsListKey, postsByChannelKey, postKey, generateId, addToSet, removeFromSet, getList } from '../db/index.js';
import type { Channel, Post, ChannelCreateInput, ApiResponse, PaginatedResponse } from '../types.js';

export const channelsRouter = new Hono();

// Validation schemas
const createChannelSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  createdBy: z.string().min(1),
  isPrivate: z.boolean().optional().default(false),
  cwd: z.string().optional(),  // Working directory for agents spawned in this channel
});

// POST /channels - Create a new channel
channelsRouter.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const validated = createChannelSchema.parse(body);
    
    const channelId = generateId('channel');
    const now = Date.now();
    
    const channel: Channel = {
      id: channelId,
      name: validated.name,
      description: validated.description,
      createdBy: validated.createdBy,
      createdAt: now,
      updatedAt: now,
      isPrivate: validated.isPrivate,
      members: [validated.createdBy],
      cwd: validated.cwd,  // Working directory for agents spawned in this channel
    };
    
    await db.put(channelKey(channelId), channel);
    await addToSet(channelsListKey(), channelId);
    
    return c.json<ApiResponse<Channel>>({ success: true, data: channel }, 201);
  } catch (error) {
    return c.json<ApiResponse<never>>(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      400
    );
  }
});

// GET /channels - List all channels
channelsRouter.get('/', async (c) => {
  const channelIds = await getList<string>(channelsListKey());
  const channels: Channel[] = [];
  
  for (const id of channelIds) {
    const channel = db.get(channelKey(id));
    if (channel) channels.push(channel);
  }
  
  return c.json<PaginatedResponse<Channel>>({
    success: true,
    data: channels,
    total: channels.length,
    limit: 100,
    offset: 0,
  });
});

// GET /channels/:id - Get a specific channel
// GET /channels/:channelId/errors - Get spawn errors for a channel
channelsRouter.get('/:channelId/errors', async (c) => {
  const channelId = c.req.param('channelId');
  const sinceParam = parseInt(c.req.query('since') || '0', 10);
  const limitParam = parseInt(c.req.query('limit') || '50', 10);
  const since = Number.isFinite(sinceParam) && sinceParam > 0 ? sinceParam : 0;
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50;

  const postIds = await getList<string>(postsByChannelKey(channelId));
  const errors: Post[] = [];

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

  errors.sort((a, b) => b.createdAt - a.createdAt);

  return c.json({ success: true, data: errors.slice(0, limit) });
});

channelsRouter.get('/:id', async (c) => {
  const { id } = c.req.param();
  const channel = db.get(channelKey(id));
  
  if (!channel) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Channel not found' }, 404);
  }
  
  return c.json<ApiResponse<Channel>>({ success: true, data: channel });
});

// PUT /channels/:id - Update a channel
const updateChannelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  cwd: z.string().optional(),
  isPrivate: z.boolean().optional(),
  members: z.array(z.string()).optional(),
});

channelsRouter.put('/:id', async (c) => {
  const { id } = c.req.param();
  const channel = db.get(channelKey(id)) as Channel | undefined;
  
  if (!channel) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Channel not found' }, 404);
  }
  
  try {
    const body = await c.req.json();
    const validated = updateChannelSchema.parse(body);
    
    const updatedChannel: Channel = {
      ...channel,
      ...validated,
      updatedAt: Date.now(),
    };
    
    await db.put(channelKey(id), updatedChannel);
    
    return c.json<ApiResponse<Channel>>({ success: true, data: updatedChannel });
  } catch (error) {
    return c.json<ApiResponse<never>>(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      400
    );
  }
});

// DELETE /channels/:id - Delete a channel
channelsRouter.delete('/:id', async (c) => {
  const { id } = c.req.param();
  const channel = db.get(channelKey(id));
  
  if (!channel) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Channel not found' }, 404);
  }
  
  // Remove primary record and all index entries atomically
  await db.remove(channelKey(id));
  await removeFromSet(channelsListKey(), id);
  // Remove the channel's post index (individual post records are left as orphans
  // so that existing post IDs remain resolvable for audit purposes).
  await db.remove(postsByChannelKey(id));
  
  return c.json<ApiResponse<never>>({ success: true });
});

export default channelsRouter;
