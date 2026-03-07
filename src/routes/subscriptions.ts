/**
 * Hive - Subscription Routes
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { 
  db, 
  subKey, 
  subsByAgentKey, 
  subsByTargetKey, 
  generateId, 
  addToSet, 
  getList,
  removeFromSet,
} from '../db/index.js';
import type { Subscription, SubscriptionType, ApiResponse, PaginatedResponse } from '../types.js';

export const subscriptionsRouter = new Hono();

// Validation schemas
const createSubscriptionSchema = z.object({
  agentId: z.string().min(1),
  targetType: z.enum(['channel', 'agent', 'mention']),
  targetId: z.string().min(1),
});

// POST /subscriptions - Create a new subscription
subscriptionsRouter.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const validated = createSubscriptionSchema.parse(body);
    
    const subId = generateId('sub');
    const now = Date.now();
    
    const subscription: Subscription = {
      id: subId,
      agentId: validated.agentId,
      targetType: validated.targetType as SubscriptionType,
      targetId: validated.targetId,
      createdAt: now,
      active: true,
    };
    
    await db.put(subKey(subId), subscription);
    await addToSet(subsByAgentKey(validated.agentId), subId);
    await addToSet(subsByTargetKey(validated.targetType, validated.targetId), subId);
    
    return c.json<ApiResponse<Subscription>>({ success: true, data: subscription }, 201);
  } catch (error) {
    return c.json<ApiResponse<never>>(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      400
    );
  }
});

// GET /subscriptions - List subscriptions (filter by agentId)
subscriptionsRouter.get('/', async (c) => {
  const agentId = c.req.query('agentId');
  const targetType = c.req.query('targetType');
  const targetId = c.req.query('targetId');
  
  let subIds: string[] = [];
  
  if (agentId) {
    subIds = await getList<string>(subsByAgentKey(agentId));
  } else if (targetType && targetId) {
    subIds = await getList<string>(subsByTargetKey(targetType, targetId));
  }
  
  const subscriptions: Subscription[] = [];
  for (const id of subIds) {
    const sub = db.get(subKey(id));
    if (sub && sub.active) {
      subscriptions.push(sub);
    }
  }
  
  return c.json<PaginatedResponse<Subscription>>({
    success: true,
    data: subscriptions,
    total: subscriptions.length,
    limit: 100,
    offset: 0,
  });
});

// GET /subscriptions/:id - Get a specific subscription
subscriptionsRouter.get('/:id', async (c) => {
  const { id } = c.req.param();
  const subscription = db.get(subKey(id));
  
  if (!subscription) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Subscription not found' }, 404);
  }
  
  return c.json<ApiResponse<Subscription>>({ success: true, data: subscription });
});

// DELETE /subscriptions/:id - Delete (deactivate) a subscription
subscriptionsRouter.delete('/:id', async (c) => {
  const { id } = c.req.param();
  const subscription = db.get(subKey(id));
  
  if (!subscription) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Subscription not found' }, 404);
  }
  
  // Mark as inactive instead of deleting
  await db.put(subKey(id), { ...subscription, active: false });
  
  return c.json<ApiResponse<never>>({ success: true });
});

export default subscriptionsRouter;