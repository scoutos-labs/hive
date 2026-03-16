/**
 * Hive - LMDB Database Setup
 * 
 * Key patterns documented in README.md
 */

import { open } from 'lmdb';

// ============================================================================
// Database Connection
// ============================================================================

const DB_PATH = process.env.HIVE_DB_PATH || './data/hive.db';

// Use any for flexibility - LMDB typing with complex schemas is challenging
export const db = open<any, any>({
  path: DB_PATH,
  compression: true,
});

let closePromise: Promise<void> | null = null;

// ============================================================================
// Key Pattern Utilities
// ============================================================================

/**
 * LMDB Key Patterns:
 * 
 * Channels:
 *   channel!{channelId}              -> Channel object
 *   channels!list                 -> string[] of all channel ids
 * 
 * Posts:
 *   post!{postId}              -> Post object
 *   posts!channel!{channelId}        -> string[] of post ids in channel (sorted by time)
 *   posts!agent!{agentId}      -> string[] of post ids by agent
 * 
 * Agents:
 *   agent!{agentId}            -> Agent object
 *   agents!list                -> string[] of all agent ids
 * 
 * Subscriptions:
 *   sub!{subId}                -> Subscription object
 *   subs!agent!{agentId}       -> string[] of subscription ids for agent
 *   subs!target!{type}!{id}    -> string[] of subscription ids for target
 * 
 * Mentions:
 *   mention!{mentionId}        -> Mention object
 *   mentions!agent!{agentId}   -> string[] of mention ids for agent
 *   mentions!channel!{channelId}     -> string[] of mention ids in channel
 */

// Delimiter invariant: `!` splits namespaces to keep related keys grouped when
// scanning, and id segments should never contain `!`.

// Channel keys
export const channelKey = (id: string) => `channel!${id}`;
export const channelsListKey = () => 'channels!list';

// Post keys
export const postKey = (id: string) => `post!${id}`;
export const postsByChannelKey = (channelId: string) => `posts!channel!${channelId}`;
export const postsByAgentKey = (agentId: string) => `posts!agent!${agentId}`;

// Agent keys
export const agentKey = (id: string) => `agent!${id}`;
export const agentsListKey = () => 'agents!list';

// Subscription keys
export const subKey = (id: string) => `sub!${id}`;
export const subsByAgentKey = (agentId: string) => `subs!agent!${agentId}`;
export const subsByTargetKey = (type: string, id: string) => `subs!target!${type}!${id}`;

// Mention keys
export const mentionKey = (id: string) => `mention!${id}`;
export const mentionsByAgentKey = (agentId: string) => `mentions!agent!${agentId}`;
export const mentionsByChannelKey = (channelId: string) => `mentions!channel!${channelId}`;

// Event keys
export const eventKey = (id: string) => `event!${id}`;
export const eventsListKey = () => 'events!list';

// Webhook subscription keys
export const webhookSubKey = (id: string) => `webhook!${id}`;
export const webhookSubsListKey = () => 'webhooks!list';

// Webhook delivery keys
export const webhookDeliveryKey = (id: string) => `webhookDelivery!${id}`;
export const webhookDeliveriesListKey = () => 'webhookDeliveries!list';

// Audio asset keys (ElevenLabs -> HyperMicro proxy)
export const audioAssetKey = (id: string) => `audio!${id}`;
export const audioAssetsListKey = () => 'audios!list';

// ============================================================================
// ID Generation
// ============================================================================

export const generateId = (prefix: string): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${prefix}_${timestamp}${random}`;
};

// ============================================================================
// Database Helpers
// ============================================================================

/**
 * Atomically add a value to a set (list with unique values).
 * 
 * Uses LMDB's binary-unsafe compare-and-swap pattern to prevent race conditions
 * when multiple concurrent calls modify the same key.
 */
export async function addToSet<T>(key: string, value: T): Promise<void> {
  // Use LMDB's atomic transaction to prevent race conditions
  await db.transaction(async () => {
    const existing = db.get(key); // Note: db.get() is synchronous in lmdb
    if (existing) {
      if (!existing.includes(value)) {
        await db.put(key, [...existing, value]);
      }
    } else {
      await db.put(key, [value]);
    }
  });
}

/**
 * Atomically remove a value from a set.
 * 
 * Uses LMDB's atomic transaction to prevent race conditions.
 */
export async function removeFromSet<T>(key: string, value: T): Promise<void> {
  await db.transaction(async () => {
    const existing = db.get(key); // Note: db.get() is synchronous in lmdb
    if (existing) {
      const filtered = existing.filter((v: T) => v !== value);
      await db.put(key, filtered);
    }
  });
}

export function getList<T>(key: string): T[] {
  return db.get(key) || [];
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

/**
 * Close LMDB exactly once.
 *
 * Multiple shutdown hooks can run in the same process; this guard prevents
 * duplicate close calls from racing and throwing during termination.
 */
export async function closeDatabase(): Promise<void> {
  if (closePromise) {
    await closePromise;
    return;
  }

  closePromise = db.close().catch((error) => {
    closePromise = null;
    throw error;
  });

  await closePromise;
}

// NOTE: Signal handlers are registered in src/index.ts to avoid duplicate
// registrations that can cause double-close races. closeDatabase() is
// idempotent if called more than once, but registering handlers here
// leads to multiple process.exit() calls racing on shutdown.
