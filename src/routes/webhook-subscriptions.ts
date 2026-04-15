import { Hono } from 'hono';

import { getValidatedBody, validateBody, z } from '../middleware/validate.js';
import {
  createWebhookSubscription,
  deactivateWebhookSubscription,
  getWebhookSubscription,
  listWebhookSubscriptions,
  validateWebhookTarget,
} from '../services/webhook-subscriptions.js';
import type { ApiResponse, HiveEventType, PaginatedResponse, WebhookSubscription } from '../types.js';

const webhookEventTypeSchema = z.enum([
  'post.created',
  'task.started',
  'task.progress',
  'task.completed',
  'task.failed',
  'mention.spawn_status_changed',
]);

const createWebhookSubscriptionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  url: z.string().url(),
  eventTypes: z.array(webhookEventTypeSchema).min(1),
  secret: z.string().min(1),
  timeoutMs: z.number().int().positive().max(60000).optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
});

type CreateWebhookSubscriptionBody = {
  name?: string;
  url: string;
  eventTypes: HiveEventType[];
  secret: string;
  timeoutMs?: number;
  maxRetries?: number;
};

export const webhookSubscriptionsRouter = new Hono();

webhookSubscriptionsRouter.post('/', validateBody(createWebhookSubscriptionSchema), async (c) => {
  const body = getValidatedBody<CreateWebhookSubscriptionBody>(c);
  const validationError = validateWebhookTarget(body.url);

  if (validationError) {
    return c.json<ApiResponse<never>>({ success: false, error: validationError }, 400);
  }

  const subscription = await createWebhookSubscription(body);
  return c.json<ApiResponse<WebhookSubscription>>({ success: true, data: subscription }, 201);
});

webhookSubscriptionsRouter.get('/', (c) => {
  const subscriptions = listWebhookSubscriptions();

  return c.json<PaginatedResponse<WebhookSubscription>>({
    success: true,
    data: subscriptions,
    total: subscriptions.length,
    limit: 100,
    offset: 0,
  });
});

webhookSubscriptionsRouter.get('/:id', (c) => {
  const subscription = getWebhookSubscription(c.req.param('id'));

  if (!subscription) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Webhook subscription not found' }, 404);
  }

  return c.json<ApiResponse<WebhookSubscription>>({ success: true, data: subscription });
});

webhookSubscriptionsRouter.delete('/:id', async (c) => {
  const subscription = await deactivateWebhookSubscription(c.req.param('id'));

  if (!subscription) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Webhook subscription not found' }, 404);
  }

  return c.json<ApiResponse<WebhookSubscription>>({ success: true, data: subscription });
});

export default webhookSubscriptionsRouter;
