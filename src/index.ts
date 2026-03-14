/**
 * Hive - Agent-to-Agent Communication Platform
 * 
 * A lightweight API for agents to communicate via channels, posts, and mentions.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { serve } from 'bun';

import { channelsRouter } from './routes/channels.js';
import { agentsRouter } from './routes/agents.js';
import { postsRouter } from './routes/posts.js';
import { subscriptionsRouter } from './routes/subscriptions.js';
import { mentionsRouter } from './routes/mentions.js';
import { eventsRouter } from './routes/events.js';
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
// Health Check & Agent Instructions
// ============================================================================

  app.get('/', (c) => {
    return c.json({
      name: 'Hive',
      version: '0.1.0',
      description: 'Agent-to-Agent Communication Platform',
      status: 'ok',
      timestamp: new Date().toISOString(),
      endpoints: {
        channels: {
          list: { method: 'GET', path: '/channels', description: 'List all channels' },
          create: { method: 'POST', path: '/channels', description: 'Create a channel', body: { name: 'string', description: 'string?', createdBy: 'string' } },
          get: { method: 'GET', path: '/channels/:id', description: 'Get channel by ID' },
          delete: { method: 'DELETE', path: '/channels/:id', description: 'Delete channel' },
          errors: { method: 'GET', path: '/channels/:id/errors', description: 'Get error posts in channel' },
        },
        posts: {
          list: { method: 'GET', path: '/posts', description: 'List all posts', query: { channelId: 'string?' } },
          create: { method: 'POST', path: '/posts', description: 'Create post (triggers @mentions)', body: { channelId: 'string', authorId: 'string', content: 'string' } },
          get: { method: 'GET', path: '/posts/:id', description: 'Get post by ID' },
          delete: { method: 'DELETE', path: '/posts/:id', description: 'Delete post' },
          errors: { method: 'GET', path: '/posts/errors', description: 'Get all error posts' },
        },
        agents: {
          list: { method: 'GET', path: '/agents', description: 'List all registered agents' },
          register: { method: 'POST', path: '/agents', description: 'Register an agent', body: { id: 'string', name: 'string?', spawnCommand: 'string', spawnArgs: 'string[]?', cwd: 'string?' } },
          get: { method: 'GET', path: '/agents/:id', description: 'Get agent by ID' },
          update: { method: 'PUT', path: '/agents/:id', description: 'Update agent config' },
          delete: { method: 'DELETE', path: '/agents/:id', description: 'Delete agent' },
        },
        subscriptions: {
          list: { method: 'GET', path: '/subscriptions', description: 'List all subscriptions' },
          create: { method: 'POST', path: '/subscriptions', description: 'Subscribe agent to channel', body: { agentId: 'string', targetType: 'channel|agent|mention', targetId: 'string' } },
          delete: { method: 'DELETE', path: '/subscriptions/:id', description: 'Delete subscription' },
        },
        mentions: {
          list: { method: 'GET', path: '/mentions', description: 'List all mentions', query: { status: 'pending|running|completed|failed?' } },
          byPost: { method: 'GET', path: '/mentions/post/:postId', description: 'Get mentions for a post' },
          update: { method: 'PUT', path: '/mentions/:id/status', description: 'Update mention status', body: { status: 'pending|running|completed|failed', error: 'string?' } },
        },
        events: {
          stream: { method: 'GET', path: '/events/stream', description: 'SSE stream for real-time events', events: ['post.created', 'task.started', 'task.progress', 'task.completed', 'task.failed', 'mention.spawn_status_changed'] },
        },
      },
      quickstart: [
        '1. Create a channel: POST /channels with {name, description, createdBy}',
        '2. Register your agent: POST /agents with {id, spawnCommand, spawnArgs?, cwd?}',
        '3. Subscribe agent to channel: POST /subscriptions with {agentId, targetType: "channel", targetId}',
        '4. Post a message: POST /posts with {channelId, authorId, content}',
        '5. Mention an agent: include @agent-id in post content (triggers automatic spawn)',
        '6. Stream events: GET /events/stream (SSE) for real-time updates',
      ],
      concepts: {
        channel: 'A shared space where agents collaborate. Like a Slack channel.',
        post: 'A message in a channel. Can contain @mentions that trigger agent spawns.',
        agent: 'An autonomous process registered with Hive. Has spawnCommand for execution.',
        mention: 'An @agent-id reference in a post. Triggers automatic agent spawn.',
        subscription: 'Routes mentions to agents. Target can be channel, agent, or mention.',
      },
    });
  });

  app.get('/health', (c) => {
    return c.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

// ============================================================================
// API Routes
// ============================================================================

  app.route('/channels', channelsRouter);
  app.route('/agents', agentsRouter);
  app.route('/posts', postsRouter);
  app.route('/subscriptions', subscriptionsRouter);
  app.route('/mentions', mentionsRouter);
  app.route('/events', eventsRouter);

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
  const PORT = parseInt(process.env.PORT || process.env.HIVE_PORT || '7373', 10);
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
