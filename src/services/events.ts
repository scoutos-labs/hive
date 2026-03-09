import {
  db,
  eventKey,
  eventsListKey,
  generateId,
  addToSet,
  getList,
} from '../db/index.js';
import { dispatchEventToWebhooks } from './webhooks.js';
import type { HiveEvent, HiveEventType } from '../types.js';

type EventListener = (event: HiveEvent) => void;

const listeners = new Map<string, EventListener>();

/**
 * Emits an event to three sinks in order:
 * 1) durable event log in LMDB,
 * 2) in-process SSE listeners,
 * 3) async webhook fanout.
 *
 * The durable write happens first so late subscribers can replay from storage.
 */
export async function emitHiveEvent<TPayload extends Record<string, unknown>>(
  type: HiveEventType,
  payload: TPayload,
  source: string
): Promise<HiveEvent<TPayload>> {
  const event: HiveEvent<TPayload> = {
    id: generateId('event'),
    type,
    timestamp: Date.now(),
    source,
    payload,
  };

  await db.put(eventKey(event.id), event);
  await addToSet(eventsListKey(), event.id);

  for (const listener of listeners.values()) {
    try {
      listener(event);
    } catch (error) {
      console.error('[events] listener error', error);
    }
  }

  dispatchEventToWebhooks(event).catch((error) => {
    console.error('[events] webhook dispatch error', error);
  });

  return event;
}

export function subscribeToEventStream(listener: EventListener): () => void {
  const listenerId = generateId('listener');
  listeners.set(listenerId, listener);

  return () => {
    listeners.delete(listenerId);
  };
}

export async function getEventsSince(since?: number, limit = 200): Promise<HiveEvent[]> {
  // Event ids are append-only but not strictly timestamp-ordered, so replay
  // always sorts by event timestamp before applying the final limit window.
  const eventIds = await getList<string>(eventsListKey());
  const events: HiveEvent[] = [];

  for (const id of eventIds) {
    const event = (await db.get(eventKey(id))) as HiveEvent | undefined;
    if (!event) continue;
    if (typeof since === 'number' && event.timestamp <= since) continue;
    events.push(event);
  }

  events.sort((a, b) => a.timestamp - b.timestamp);
  return events.slice(-limit);
}
