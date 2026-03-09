import { Hono } from 'hono';
import { z } from 'zod';
import {
  createWebhookSubscription,
  listWebhookSubscriptions,
  getWebhookSubscription,
  deactivateWebhookSubscription,
} from '../services/webhooks.js';
import type { ApiResponse, HiveEventType, PaginatedResponse, WebhookSubscription } from '../types.js';

export const webhookSubscriptionsRouter = new Hono();

type WebhookSubscriptionPublic = Omit<WebhookSubscription, 'secret'>;

function toPublicWebhookSubscription(subscription: WebhookSubscription): WebhookSubscriptionPublic {
  const { secret: _secret, ...rest } = subscription;
  return rest;
}

const eventTypes = [
  'task.started',
  'task.progress',
  'task.completed',
  'task.failed',
  'mention.spawn_status_changed',
] as const satisfies HiveEventType[];

const createWebhookSubscriptionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  url: z.string().url(),
  eventTypes: z.array(z.enum(eventTypes)).min(1),
  secret: z.string().min(8).max(512),
  timeoutMs: z.number().int().min(500).max(60000).optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
});

webhookSubscriptionsRouter.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const validated = createWebhookSubscriptionSchema.parse(body);

    const subscription = await createWebhookSubscription(validated);

    return c.json<ApiResponse<WebhookSubscriptionPublic>>(
      { success: true, data: toPublicWebhookSubscription(subscription) },
      201
    );
  } catch (error) {
    return c.json<ApiResponse<never>>(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      400
    );
  }
});

webhookSubscriptionsRouter.get('/', async (c) => {
  const includeInactive = c.req.query('includeInactive') === 'true';
  const subscriptions = await listWebhookSubscriptions(includeInactive);

  return c.json<PaginatedResponse<WebhookSubscriptionPublic>>({
    success: true,
    data: subscriptions.map(toPublicWebhookSubscription),
    total: subscriptions.length,
    limit: subscriptions.length,
    offset: 0,
  });
});

webhookSubscriptionsRouter.get('/:id', async (c) => {
  const { id } = c.req.param();
  const subscription = await getWebhookSubscription(id);

  if (!subscription) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Webhook subscription not found' }, 404);
  }

  return c.json<ApiResponse<WebhookSubscriptionPublic>>({
    success: true,
    data: toPublicWebhookSubscription(subscription),
  });
});

webhookSubscriptionsRouter.delete('/:id', async (c) => {
  const { id } = c.req.param();
  const subscription = await deactivateWebhookSubscription(id);

  if (!subscription) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Webhook subscription not found' }, 404);
  }

  return c.json<ApiResponse<WebhookSubscriptionPublic>>({
    success: true,
    data: toPublicWebhookSubscription(subscription),
  });
});

export default webhookSubscriptionsRouter;
