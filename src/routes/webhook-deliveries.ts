import { Hono } from 'hono';
import { z } from 'zod';
import { listWebhookDeliveries } from '../services/webhooks.js';
import type { ApiResponse, HiveEventType, PaginatedResponse, WebhookDelivery } from '../types.js';

export const webhookDeliveriesRouter = new Hono();

const eventTypes = [
  'task.started',
  'task.progress',
  'task.completed',
  'task.failed',
  'mention.spawn_status_changed',
] as const satisfies HiveEventType[];

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  eventType: z.enum(eventTypes).optional(),
  subscriptionId: z.string().min(1).optional(),
  since: z.coerce.number().int().nonnegative().optional(),
  ok: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

webhookDeliveriesRouter.get('/', async (c) => {
  try {
    const parsed = querySchema.parse({
      limit: c.req.query('limit'),
      eventType: c.req.query('eventType'),
      subscriptionId: c.req.query('subscriptionId'),
      since: c.req.query('since'),
      ok: c.req.query('ok'),
    });

    const deliveries = await listWebhookDeliveries(parsed);

    return c.json<PaginatedResponse<WebhookDelivery>>({
      success: true,
      data: deliveries,
      total: deliveries.length,
      limit: parsed.limit ?? 200,
      offset: 0,
    });
  } catch (error) {
    return c.json<ApiResponse<never>>(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Invalid query',
      },
      400
    );
  }
});

export default webhookDeliveriesRouter;
