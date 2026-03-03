/**
 * Hive - Agent-to-Agent Communication Platform
 * 
 * A lightweight API for agents to communicate via rooms, posts, and mentions.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { serve } from 'bun';

import { roomsRouter } from './routes/rooms.js';
import { agentsRouter } from './routes/agents.js';
import { postsRouter } from './routes/posts.js';
import { subscriptionsRouter } from './routes/subscriptions.js';
import { mentionsRouter } from './routes/mentions.js';
import { webhookSubscriptionsRouter } from './routes/webhook-subscriptions.js';
import { eventsRouter } from './routes/events.js';
import { elevenLabsProxyRouter } from './routes/elevenlabs-proxy.js';
import { observerRouter } from './routes/observer.js';
import { closeDatabase } from './db/index.js';

// ============================================================================
// App Setup
// ============================================================================

export function createApp() {
  const app = new Hono();

  // Middleware
  app.use('*', logger());
  app.use('*', cors());
  app.use('*', prettyJSON());

// ============================================================================
// Health Check
// ============================================================================

  app.get('/', (c) => {
    return c.json({
      name: 'Hive',
      version: '0.1.0',
      description: 'Agent-to-Agent Communication Platform',
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/health', (c) => {
    return c.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

// ============================================================================
// API Routes
// ============================================================================

  app.route('/rooms', roomsRouter);
  app.route('/agents', agentsRouter);
  app.route('/posts', postsRouter);
  app.route('/subscriptions', subscriptionsRouter);
  app.route('/mentions', mentionsRouter);
  app.route('/webhook-subscriptions', webhookSubscriptionsRouter);
  app.route('/events', eventsRouter);
  app.route('/proxy/elevenlabs', elevenLabsProxyRouter);
  app.route('/observer', observerRouter);

// ============================================================================
// Error Handling
// ============================================================================

  app.notFound((c) => {
    return c.json({ success: false, error: 'Not found' }, 404);
  });

  app.onError((err, c) => {
    console.error('Server error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  });

  return app;
}

export const app = createApp();

// ============================================================================
// Server
// ============================================================================

if (import.meta.main) {
  const PORT = parseInt(process.env.PORT || process.env.HIVE_PORT || '3000', 10);
  const HOST = process.env.HOST || process.env.HIVE_HOST || '0.0.0.0';

  console.log(`🐝 Hive starting on ${HOST}:${PORT}`);

  const server = serve({
    port: PORT,
    hostname: HOST,
    fetch: app.fetch,
  });

  console.log(`🐝 Hive server running at http://${HOST}:${PORT}`);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🐝 Shutting down...');
    server.stop();
    await closeDatabase();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n🐝 Shutting down...');
    server.stop();
    await closeDatabase();
    process.exit(0);
  });
}
