import { Hono } from 'hono';
import { z } from 'zod';
import { getEventsSince, subscribeToEventStream } from '../services/events.js';
import type { ApiResponse, HiveEvent } from '../types.js';

export const eventsRouter = new Hono();

const replayQuerySchema = z.object({
  since: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
});

eventsRouter.get('/', async (c) => {
  try {
    const parsed = replayQuerySchema.parse({
      since: c.req.query('since'),
      limit: c.req.query('limit'),
    });

    const events = await getEventsSince(parsed.since, parsed.limit ?? 200);

    return c.json<ApiResponse<{ events: HiveEvent[] }>>({
      success: true,
      data: { events },
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
