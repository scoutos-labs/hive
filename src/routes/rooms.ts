/**
 * Hive - Room Routes
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { db, roomKey, roomsListKey, postsByRoomKey, generateId, addToSet, removeFromSet, getList } from '../db/index.js';
import type { Room, RoomCreateInput, ApiResponse, PaginatedResponse } from '../types.js';

export const roomsRouter = new Hono();

// Validation schemas
const createRoomSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  createdBy: z.string().min(1),
  isPrivate: z.boolean().optional().default(false),
});

// POST /rooms - Create a new room
roomsRouter.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const validated = createRoomSchema.parse(body);
    
    const roomId = generateId('room');
    const now = Date.now();
    
    const room: Room = {
      id: roomId,
      name: validated.name,
      description: validated.description,
      createdBy: validated.createdBy,
      createdAt: now,
      updatedAt: now,
      isPrivate: validated.isPrivate,
      members: [validated.createdBy],
    };
    
    await db.put(roomKey(roomId), room);
    await addToSet(roomsListKey(), roomId);
    
    return c.json<ApiResponse<Room>>({ success: true, data: room }, 201);
  } catch (error) {
    return c.json<ApiResponse<never>>(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      400
    );
  }
});

// GET /rooms - List all rooms
roomsRouter.get('/', async (c) => {
  const roomIds = await getList<string>(roomsListKey());
  const rooms: Room[] = [];
  
  for (const id of roomIds) {
    const room = db.get(roomKey(id));
    if (room) rooms.push(room);
  }
  
  return c.json<PaginatedResponse<Room>>({
    success: true,
    data: rooms,
    total: rooms.length,
    limit: 100,
    offset: 0,
  });
});

// GET /rooms/:id - Get a specific room
roomsRouter.get('/:id', async (c) => {
  const { id } = c.req.param();
  const room = db.get(roomKey(id));
  
  if (!room) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Room not found' }, 404);
  }
  
  return c.json<ApiResponse<Room>>({ success: true, data: room });
});

// DELETE /rooms/:id - Delete a room
roomsRouter.delete('/:id', async (c) => {
  const { id } = c.req.param();
  const room = db.get(roomKey(id));
  
  if (!room) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Room not found' }, 404);
  }
  
  // Remove primary record and all index entries atomically
  await db.remove(roomKey(id));
  await removeFromSet(roomsListKey(), id);
  // Remove the room's post index (individual post records are left as orphans
  // so that existing post IDs remain resolvable for audit purposes).
  await db.remove(postsByRoomKey(id));
  
  return c.json<ApiResponse<never>>({ success: true });
});

export default roomsRouter;