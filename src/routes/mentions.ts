/**
 * Hive - Mention Routes
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { 
  db, 
  mentionKey, 
  mentionsByAgentKey, 
  mentionsByRoomKey, 
  generateId, 
  addToSet, 
  getList,
} from '../db/index.js';
import type { Mention, ApiResponse, PaginatedResponse } from '../types.js';

export const mentionsRouter = new Hono();

// GET /mentions - List mentions (filter by agentId)
mentionsRouter.get('/', async (c) => {
  const agentId = c.req.query('agentId');
  const roomId = c.req.query('roomId');
  const unreadOnly = c.req.query('unread') === 'true';
  
  let mentionIds: string[] = [];
  
  if (agentId) {
    mentionIds = await getList<string>(mentionsByAgentKey(agentId));
  } else if (roomId) {
    mentionIds = await getList<string>(mentionsByRoomKey(roomId));
  }
  
  const mentions: Mention[] = [];
  for (const id of mentionIds) {
    const mention = db.get(mentionKey(id));
    if (mention) {
      if (unreadOnly && mention.read) continue;
      mentions.push(mention);
    }
  }
  
  // Sort by creation time (newest first)
  mentions.sort((a, b) => b.createdAt - a.createdAt);
  
  return c.json<PaginatedResponse<Mention>>({
    success: true,
    data: mentions,
    total: mentions.length,
    limit: 100,
    offset: 0,
  });
});

// GET /mentions/:id - Get a specific mention
mentionsRouter.get('/:id', async (c) => {
  const { id } = c.req.param();
  const mention = db.get(mentionKey(id));
  
  if (!mention) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Mention not found' }, 404);
  }
  
  return c.json<ApiResponse<Mention>>({ success: true, data: mention });
});

// PATCH /mentions/:id/read - Mark mention as read
mentionsRouter.patch('/:id/read', async (c) => {
  const { id } = c.req.param();
  const mention = db.get(mentionKey(id));
  
  if (!mention) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Mention not found' }, 404);
  }
  
  const updated: Mention = {
    ...mention,
    read: true,
  };
  
  await db.put(mentionKey(id), updated);
  
  return c.json<ApiResponse<Mention>>({ success: true, data: updated });
});

// POST /mentions/:id/read - Mark mention as read (alternative)
mentionsRouter.post('/:id/read', async (c) => {
  const { id } = c.req.param();
  const mention = db.get(mentionKey(id));
  
  if (!mention) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Mention not found' }, 404);
  }
  
  const updated: Mention = {
    ...mention,
    read: true,
  };
  
  await db.put(mentionKey(id), updated);
  
  return c.json<ApiResponse<Mention>>({ success: true, data: updated });
});

// POST /mentions/:id/acknowledge - Mark mention as acknowledged
mentionsRouter.post('/:id/acknowledge', async (c) => {
  const { id } = c.req.param();
  const mention = db.get(mentionKey(id));
  
  if (!mention) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Mention not found' }, 404);
  }
  
  const updated: Mention = {
    ...mention,
    read: true,
    acknowledged: true,
  };
  
  await db.put(mentionKey(id), updated);
  
  return c.json<ApiResponse<Mention>>({ success: true, data: updated });
});

// GET /mentions/:id/output - Get spawn output for a mention
mentionsRouter.get('/:id/output', async (c) => {
  const { id } = c.req.param();
  const mention = db.get(mentionKey(id));
  
  if (!mention) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Mention not found' }, 404);
  }
  
  return c.json<ApiResponse<{ 
    status: string; 
    output?: string; 
    error?: string;
    pid?: number;
    completedAt?: number;
  }>>({
    success: true,
    data: {
      status: mention.spawnStatus || 'pending',
      output: mention.spawnOutput,
      error: mention.spawnError,
      pid: mention.spawnPid,
      completedAt: mention.completedAt,
    },
  });
});

export default mentionsRouter;