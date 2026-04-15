/**
 * Persisted webhook subscriptions for event fan-out.
 *
 * Hive emits events synchronously for in-process consumers and queues webhook
 * deliveries from the same event source so replay and outbound delivery stay in
 * the same storage namespace.
 */

import { createHmac } from 'node:crypto';

import {
  addToSet,
  db,
  generateId,
  getList,
  webhookDeliveriesListKey,
  webhookDeliveryKey,
  webhookSubKey,
  webhookSubsListKey,
} from '../db/index.js';
import type { HiveEvent, WebhookDelivery, WebhookSubscription } from '../types.js';

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_RETRIES = 3;

export interface CreateWebhookSubscriptionInput {
  name?: string;
  url: string;
  eventTypes: WebhookSubscription['eventTypes'];
  secret: string;
  timeoutMs?: number;
  maxRetries?: number;
}

function getAllowedWebhookHosts(): string[] {
  return (process.env.HIVE_WEBHOOK_ALLOWLIST || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function validateWebhookTarget(url: string): string | null {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return 'Webhook URL must be a valid URL';
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return 'Webhook URL must use http or https';
  }

  const allowedHosts = getAllowedWebhookHosts();
  if (allowedHosts.length > 0 && !allowedHosts.includes(parsed.hostname.toLowerCase())) {
    return `Webhook host ${parsed.hostname} is not in HIVE_WEBHOOK_ALLOWLIST`;
  }

  return null;
}

export async function createWebhookSubscription(input: CreateWebhookSubscriptionInput): Promise<WebhookSubscription> {
  const now = Date.now();

  const subscription: WebhookSubscription = {
    id: generateId('webhook'),
    name: input.name,
    url: input.url,
    eventTypes: input.eventTypes,
    secret: input.secret,
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxRetries: input.maxRetries ?? DEFAULT_MAX_RETRIES,
    active: true,
    createdAt: now,
    updatedAt: now,
  };

  await db.put(webhookSubKey(subscription.id), subscription);
  await addToSet(webhookSubsListKey(), subscription.id);

  return subscription;
}

export function listWebhookSubscriptions(): WebhookSubscription[] {
  const ids = getList<string>(webhookSubsListKey());
  const subscriptions: WebhookSubscription[] = [];

  for (const id of ids) {
    const subscription = db.get(webhookSubKey(id)) as WebhookSubscription | undefined;
    if (subscription) {
      subscriptions.push(subscription);
    }
  }

  return subscriptions;
}

export function getWebhookSubscription(id: string): WebhookSubscription | null {
  return (db.get(webhookSubKey(id)) as WebhookSubscription | undefined) ?? null;
}

export async function deactivateWebhookSubscription(id: string): Promise<WebhookSubscription | null> {
  const existing = getWebhookSubscription(id);
  if (!existing) {
    return null;
  }

  const updated: WebhookSubscription = {
    ...existing,
    active: false,
    updatedAt: Date.now(),
  };

  await db.put(webhookSubKey(id), updated);
  return updated;
}

async function recordWebhookDelivery(delivery: Omit<WebhookDelivery, 'id'>) {
  const stored: WebhookDelivery = {
    id: generateId('webhookDelivery'),
    ...delivery,
  };

  await db.put(webhookDeliveryKey(stored.id), stored);
  await addToSet(webhookDeliveriesListKey(), stored.id);
}

function signWebhookPayload(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

async function sendWebhookEvent(subscription: WebhookSubscription, event: HiveEvent) {
  const body = JSON.stringify(event);
  const headers = new Headers({
    'content-type': 'application/json',
    'x-hive-signature': signWebhookPayload(subscription.secret, body),
  });

  let attempts = 0;
  let lastError: string | undefined;
  let lastStatusCode: number | undefined;

  // `maxRetries` counts retry attempts after the initial delivery.
  while (attempts <= subscription.maxRetries) {
    const startedAt = Date.now();
    attempts += 1;

    try {
      const response = await fetch(subscription.url, {
        method: 'POST',
        headers,
        body,
      });

      lastStatusCode = response.status;

      if (response.ok) {
        await recordWebhookDelivery({
          subscriptionId: subscription.id,
          eventType: event.type,
          timestamp: Date.now(),
          ok: true,
          statusCode: response.status,
          durationMs: Date.now() - startedAt,
        });
        return;
      }

      lastError = await response.text();
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Webhook delivery failed';
    }
  }

  await recordWebhookDelivery({
    subscriptionId: subscription.id,
    eventType: event.type,
    timestamp: Date.now(),
    ok: false,
    statusCode: lastStatusCode,
    error: lastError,
  });
}

export async function deliverWebhookEvent(event: HiveEvent) {
  const subscriptions = listWebhookSubscriptions();

  for (const subscription of subscriptions) {
    if (!subscription.active || !subscription.eventTypes.includes(event.type)) {
      continue;
    }

    await sendWebhookEvent(subscription, event);
  }
}
