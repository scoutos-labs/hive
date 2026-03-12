import { Hono } from 'hono';
import { getEventsSince, subscribeToEventStream } from '../services/events.js';
import { getValidatedQuery, validateQuery } from '../middleware/validate.js';
import { replayQuerySchema, type ReplayQueryInput } from '../schemas/events.js';
import type { ApiResponse, HiveEvent } from '../types.js';

export const eventsRouter = new Hono();

eventsRouter.get('/', validateQuery(replayQuerySchema), async (c) => {
  const { since, limit } = getValidatedQuery<ReplayQueryInput>(c);
  const events = await getEventsSince(since, limit ?? 200);

  return c.json<ApiResponse<{ events: HiveEvent[] }>>({
    success: true,
    data: { events },
  });
});

eventsRouter.get('/stream', (c) => {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: HiveEvent) => {
        controller.enqueue(
          encoder.encode(
            `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
          )
        );
      };

      const unsubscribe = subscribeToEventStream(send);
      const keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(': keepalive\n\n'));
      }, 15000);

      c.req.raw.signal.addEventListener('abort', () => {
        clearInterval(keepAlive);
        unsubscribe();
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
});

export default eventsRouter;
