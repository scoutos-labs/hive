import { createHmac } from 'node:crypto';
import {
  db,
  webhookSubKey,
  webhookSubsListKey,
  generateId,
  addToSet,
  getList,
} from '../db/index.js';
import type { HiveEvent, HiveEventType, WebhookSubscription } from '../types.js';

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 250;

function parseAllowlist(): string[] {
  const raw = process.env.HIVE_WEBHOOK_ALLOWLIST;
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function hostMatchesAllowlist(hostname: string, allowlist: string[]): boolean {
  const normalizedHost = hostname.toLowerCase();
  return allowlist.some((allowed) => {
    if (allowed.startsWith('*.')) {
      const suffix = allowed.slice(2);
      return normalizedHost === suffix || normalizedHost.endsWith(`.${suffix}`);
    }
    return normalizedHost === allowed;
  });
}

function validateWebhookUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid webhook URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Webhook URL must use http or https');
  }

  const allowlist = parseAllowlist();
  if (allowlist.length > 0 && !hostMatchesAllowlist(parsed.hostname, allowlist)) {
    throw new Error('Webhook URL host is not allowlisted');
  }

  return parsed.toString();
}

function createSignature(secret: string, body: string): string {
  const digest = createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${digest}`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function deliverOnce(subscription: WebhookSubscription, event: HiveEvent): Promise<boolean> {
  const body = JSON.stringify(event);
  const signature = createSignature(subscription.secret, body);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), subscription.timeoutMs);

  try {
    const response = await fetch(subscription.url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Hive-Event-Id': event.id,
        'X-Hive-Event-Type': event.type,
        'X-Hive-Event-Timestamp': String(event.timestamp),
        'X-Hive-Signature': signature,
      },
      body,
    });

    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function deliverWithRetry(subscription: WebhookSubscription, event: HiveEvent): Promise<void> {
  // maxRetries is the number of retries after the first attempt.
  const attempts = Math.max(1, subscription.maxRetries + 1);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const ok = await deliverOnce(subscription, event);
    if (ok) return;

    const hasNextAttempt = attempt < attempts - 1;
    if (hasNextAttempt) {
      await sleep(RETRY_BASE_DELAY_MS * (2 ** attempt));
    }
  }
}

export async function createWebhookSubscription(input: {
  name?: string;
  url: string;
  eventTypes: HiveEventType[];
  secret: string;
  timeoutMs?: number;
  maxRetries?: number;
}): Promise<WebhookSubscription> {
  const now = Date.now();
  const id = generateId('webhook');
  const normalizedUrl = validateWebhookUrl(input.url);

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = input.maxRetries ?? DEFAULT_MAX_RETRIES;

  const subscription: WebhookSubscription = {
    id,
    name: input.name,
    url: normalizedUrl,
    eventTypes: input.eventTypes,
    secret: input.secret,
    timeoutMs,
    maxRetries,
    active: true,
    createdAt: now,
    updatedAt: now,
  };

  await db.put(webhookSubKey(id), subscription);
  await addToSet(webhookSubsListKey(), id);

  return subscription;
}

export async function listWebhookSubscriptions(includeInactive = false): Promise<WebhookSubscription[]> {
  const ids = await getList<string>(webhookSubsListKey());
  const subscriptions: WebhookSubscription[] = [];

  for (const id of ids) {
    const sub = (await db.get(webhookSubKey(id))) as WebhookSubscription | undefined;
    if (!sub) continue;
    if (!includeInactive && !sub.active) continue;
    subscriptions.push(sub);
  }

  return subscriptions.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getWebhookSubscription(id: string): Promise<WebhookSubscription | null> {
  const sub = (await db.get(webhookSubKey(id))) as WebhookSubscription | undefined;
  return sub || null;
}

export async function deactivateWebhookSubscription(id: string): Promise<WebhookSubscription | null> {
  const existing = await getWebhookSubscription(id);
  if (!existing) return null;

  const updated: WebhookSubscription = {
    ...existing,
    active: false,
    updatedAt: Date.now(),
  };

  await db.put(webhookSubKey(id), updated);
  return updated;
}

export async function dispatchEventToWebhooks(event: HiveEvent): Promise<void> {
  const subscriptions = await listWebhookSubscriptions(false);

  await Promise.all(
    subscriptions
      .filter((subscription) => subscription.eventTypes.includes(event.type))
      .map((subscription) => deliverWithRetry(subscription, event))
  );
}

// Webhook deliveries are stored as events in the database
// This function retrieves delivery attempts from the events log
export async function listWebhookDeliveries(options: {
  limit?: number;
  eventType?: string;
  subscriptionId?: string;
  since?: number;
  ok?: boolean;
}): Promise<any[]> {
  // For now, return events that are webhook-related
  // In the future, we could store dedicated webhook delivery records
  const ids = await getList<string>('events!list');
  const deliveries: any[] = [];

  for (const id of ids) {
    const event = await db.get(`event!${id}`);
    if (!event) continue;

    const evt = event as any;
    
    // Filter by event type if specified
    if (options.eventType && evt.type !== options.eventType) continue;
    
    // Filter by time if specified
    if (options.since && evt.timestamp < options.since) continue;

    deliveries.push(evt);
  }

  // Sort by timestamp descending and apply limit
  deliveries.sort((a, b) => b.timestamp - a.timestamp);
  
  return options.limit ? deliveries.slice(0, options.limit) : deliveries;
}
