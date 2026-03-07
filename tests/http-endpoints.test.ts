import { afterAll, describe, expect, it } from 'bun:test';
import { createHash, createHmac } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testDbPath = join(tmpdir(), `hive-test-${randomUUID()}`);
process.env.HIVE_DB_PATH = testDbPath;

const { app } = await import('../src/index.js');
const { closeDatabase, db, mentionKey } = await import('../src/db/index.js');

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 200));
  await closeDatabase();
  await rm(testDbPath, { recursive: true, force: true });
});

async function requestJson(path: string, init?: RequestInit) {
  const response = await app.request(path, init);
  const body = await response.json();
  return { response, body };
}

async function createChannel(overrides: Record<string, unknown> = {}) {
  const payload = {
    name: `Channel-${randomUUID()}`,
    description: 'Integration test channel',
    createdBy: `creator-${randomUUID()}`,
    ...overrides,
  };

  const { response, body } = await requestJson('/channels', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  expect(response.status).toBe(201);
  return body.data;
}

async function createAgent(overrides: Record<string, unknown> = {}) {
  const payload = {
    id: `agent-${randomUUID()}`,
    name: 'Test Agent',
    spawnCommand: 'true',
    ...overrides,
  };

  const { response, body } = await requestJson('/agents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  expect(response.status).toBe(201);
  return { payload, registered: body };
}

async function subscribeAgentToChannel(agentId: string, channelId: string) {
  const { response, body } = await requestJson('/subscriptions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentId, targetType: 'channel', targetId: channelId }),
  });

  expect(response.status).toBe(201);
  return body.data;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(condition: () => boolean, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (condition()) return;
    await sleep(25);
  }

  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

describe('core routes', () => {
  it('returns app metadata on GET /', async () => {
    const { response, body } = await requestJson('/');
    expect(response.status).toBe(200);
    expect(body.name).toBe('Hive');
    expect(body.status).toBe('ok');
  });

  it('returns health on GET /health', async () => {
    const { response, body } = await requestJson('/health');
    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
  });

  it('returns not found for unknown routes', async () => {
    const { response, body } = await requestJson('/does-not-exist');
    expect(response.status).toBe(404);
    expect(body).toEqual({ success: false, error: 'Not found' });
  });
});

describe('channels endpoints', () => {
  it('supports create/list/get/delete channel', async () => {
    const channel = await createChannel({ name: 'Channel Happy Path' });

    const list = await requestJson('/channels');
    expect(list.response.status).toBe(200);
    expect(list.body.success).toBe(true);
    expect(list.body.data.some((item: any) => item.id === channel.id)).toBe(true);

    const getOne = await requestJson(`/channels/${channel.id}`);
    expect(getOne.response.status).toBe(200);
    expect(getOne.body.data.id).toBe(channel.id);

    const del = await requestJson(`/channels/${channel.id}`, { method: 'DELETE' });
    expect(del.response.status).toBe(200);
    expect(del.body.success).toBe(true);
  });

  it('returns validation error for invalid create payload', async () => {
    const { response, body } = await requestJson('/channels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '', createdBy: '' }),
    });

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
  });

  it('returns not found for missing channel', async () => {
    const missingId = `channel-missing-${randomUUID()}`;

    const getOne = await requestJson(`/channels/${missingId}`);
    expect(getOne.response.status).toBe(404);

    const del = await requestJson(`/channels/${missingId}`, { method: 'DELETE' });
    expect(del.response.status).toBe(404);
  });
});

describe('agents endpoints', () => {
  it('supports register/list/get/update/delete agent', async () => {
    const created = await createAgent();
    const agentId = created.payload.id as string;

    const list = await requestJson('/agents');
    expect(list.response.status).toBe(200);
    expect(list.body.agents.some((item: any) => item.id === agentId)).toBe(true);

    const getOne = await requestJson(`/agents/${agentId}`);
    expect(getOne.response.status).toBe(200);
    expect(getOne.body.id).toBe(agentId);

    const update = await requestJson(`/agents/${agentId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Agent Name' }),
    });
    expect(update.response.status).toBe(200);
    expect(update.body.name).toBe('Updated Agent Name');

    const del = await requestJson(`/agents/${agentId}`, { method: 'DELETE' });
    expect(del.response.status).toBe(200);
    expect(del.body.success).toBe(true);
  });

  it('returns duplicate conflict for repeated id', async () => {
    const fixedId = `agent-dup-${randomUUID()}`;
    await createAgent({ id: fixedId });

    const duplicate = await requestJson('/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: fixedId, name: 'Dup', spawnCommand: 'true' }),
    });

    expect(duplicate.response.status).toBe(409);
    expect(duplicate.body.success).toBe(false);
  });

  it('supports default spawn settings and not found errors for agent operations', async () => {
    const withDefaults = await requestJson('/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'x', name: 'Missing command' }),
    });
    expect(withDefaults.response.status).toBe(201);

    const missingId = `agent-missing-${randomUUID()}`;
    const getOne = await requestJson(`/agents/${missingId}`);
    expect(getOne.response.status).toBe(404);

    const update = await requestJson(`/agents/${missingId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Nope' }),
    });
    expect(update.response.status).toBe(404);

    const del = await requestJson(`/agents/${missingId}`, { method: 'DELETE' });
    expect(del.response.status).toBe(404);
  });
});

describe('subscriptions endpoints', () => {
  it('supports create/list/get/delete subscription', async () => {
    const created = await createAgent();
    const agentId = created.payload.id as string;
    const channel = await createChannel();

    const create = await requestJson('/subscriptions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agentId,
        targetType: 'channel',
        targetId: channel.id,
      }),
    });

    expect(create.response.status).toBe(201);
    const subId = create.body.data.id;

    const listByAgent = await requestJson(`/subscriptions?agentId=${agentId}`);
    expect(listByAgent.response.status).toBe(200);
    expect(listByAgent.body.data.some((item: any) => item.id === subId)).toBe(true);

    const listByTarget = await requestJson(`/subscriptions?targetType=channel&targetId=${channel.id}`);
    expect(listByTarget.response.status).toBe(200);
    expect(listByTarget.body.data.some((item: any) => item.id === subId)).toBe(true);

    const getOne = await requestJson(`/subscriptions/${subId}`);
    expect(getOne.response.status).toBe(200);

    const del = await requestJson(`/subscriptions/${subId}`, { method: 'DELETE' });
    expect(del.response.status).toBe(200);

    const listAfterDelete = await requestJson(`/subscriptions?agentId=${agentId}`);
    expect(listAfterDelete.body.data.some((item: any) => item.id === subId)).toBe(false);
  });

  it('returns validation and not found errors for subscriptions', async () => {
    const invalid = await requestJson('/subscriptions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: 'a', targetType: 'invalid', targetId: 'x' }),
    });
    expect(invalid.response.status).toBe(400);

    const missingId = `sub-missing-${randomUUID()}`;
    const getOne = await requestJson(`/subscriptions/${missingId}`);
    expect(getOne.response.status).toBe(404);

    const del = await requestJson(`/subscriptions/${missingId}`, { method: 'DELETE' });
    expect(del.response.status).toBe(404);
  });
});

describe('posts and mentions endpoints', () => {
  it('supports create/list/get/delete post and mention workflows', async () => {
    const channel = await createChannel();
    const created = await createAgent();
    const agentId = created.payload.id as string;

    const createPost = await requestJson('/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        channelId: channel.id,
        authorId: 'author-1',
        content: `Hello @${agentId}`,
      }),
    });

    expect(createPost.response.status).toBe(201);
    const postId = createPost.body.data.id;
    expect(createPost.body.data.processedMentions).toBe(1);

    const listByChannel = await requestJson(`/posts?channelId=${channel.id}`);
    expect(listByChannel.response.status).toBe(200);
    expect(listByChannel.body.data.some((item: any) => item.id === postId)).toBe(true);

    const listAll = await requestJson('/posts');
    expect(listAll.response.status).toBe(200);
    expect(Array.isArray(listAll.body.data)).toBe(true);

    const getPost = await requestJson(`/posts/${postId}`);
    expect(getPost.response.status).toBe(200);

    const mentionsList = await requestJson(`/mentions?agentId=${agentId}`);
    expect(mentionsList.response.status).toBe(200);
    expect(mentionsList.body.total).toBeGreaterThan(0);

    const mentionId = mentionsList.body.data[0].id as string;

    const getMention = await requestJson(`/mentions/${mentionId}`);
    expect(getMention.response.status).toBe(200);

    const markReadPatch = await requestJson(`/mentions/${mentionId}/read`, { method: 'PATCH' });
    expect(markReadPatch.response.status).toBe(200);
    expect(markReadPatch.body.data.read).toBe(true);

    const markReadPost = await requestJson(`/mentions/${mentionId}/read`, { method: 'POST' });
    expect(markReadPost.response.status).toBe(200);
    expect(markReadPost.body.data.read).toBe(true);

    const ack = await requestJson(`/mentions/${mentionId}/acknowledge`, { method: 'POST' });
    expect(ack.response.status).toBe(200);
    expect(ack.body.data.acknowledged).toBe(true);

    const output = await requestJson(`/mentions/${mentionId}/output`);
    expect(output.response.status).toBe(200);
    expect(output.body.data.status).toBeDefined();

    const unreadOnly = await requestJson(`/mentions?agentId=${agentId}&unread=true`);
    expect(unreadOnly.response.status).toBe(200);
    expect(unreadOnly.body.data.length).toBe(0);

    const mentionsByChannel = await requestJson(`/mentions?channelId=${channel.id}`);
    expect(mentionsByChannel.response.status).toBe(200);
    expect(mentionsByChannel.body.data.length).toBeGreaterThan(0);

    const del = await requestJson(`/posts/${postId}`, { method: 'DELETE' });
    expect(del.response.status).toBe(200);
  });

  it('returns validation and not found errors for posts and mentions', async () => {
    const invalidPost = await requestJson('/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channelId: '', authorId: '', content: '' }),
    });
    expect(invalidPost.response.status).toBe(400);

    const missingChannelPost = await requestJson('/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        channelId: `channel-missing-${randomUUID()}`,
        authorId: 'author-2',
        content: 'hello',
      }),
    });
    expect(missingChannelPost.response.status).toBe(404);

    const missingPostId = `post-missing-${randomUUID()}`;
    const getPost = await requestJson(`/posts/${missingPostId}`);
    expect(getPost.response.status).toBe(404);

    const delPost = await requestJson(`/posts/${missingPostId}`, { method: 'DELETE' });
    expect(delPost.response.status).toBe(404);

    const missingMentionId = `mention-missing-${randomUUID()}`;
    const getMention = await requestJson(`/mentions/${missingMentionId}`);
    expect(getMention.response.status).toBe(404);

    const patchRead = await requestJson(`/mentions/${missingMentionId}/read`, { method: 'PATCH' });
    expect(patchRead.response.status).toBe(404);

    const postRead = await requestJson(`/mentions/${missingMentionId}/read`, { method: 'POST' });
    expect(postRead.response.status).toBe(404);

    const ack = await requestJson(`/mentions/${missingMentionId}/acknowledge`, { method: 'POST' });
    expect(ack.response.status).toBe(404);

    const output = await requestJson(`/mentions/${missingMentionId}/output`);
    expect(output.response.status).toBe(404);
  });
});

describe('mentions status board endpoints', () => {
  it('returns per-agent status summary and detailed status views', async () => {
    const channel = await createChannel({ name: 'Task Board Channel' });
    const agentA = await createAgent({ id: `status-a-${randomUUID()}`, name: 'Status Agent A' });
    const agentB = await createAgent({ id: `status-b-${randomUUID()}`, name: 'Status Agent B' });
    const agentAId = agentA.payload.id as string;
    const agentBId = agentB.payload.id as string;

    const postOne = await requestJson('/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        channelId: channel.id,
        authorId: 'status-author',
        content: `Work items for @${agentAId} and @${agentBId}`,
      }),
    });
    expect(postOne.response.status).toBe(201);

    const postTwo = await requestJson('/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        channelId: channel.id,
        authorId: 'status-author',
        content: `Follow-up for @${agentAId}`,
      }),
    });
    expect(postTwo.response.status).toBe(201);

    const mentionsA = await requestJson(`/mentions?agentId=${agentAId}`);
    const mentionsB = await requestJson(`/mentions?agentId=${agentBId}`);

    expect(mentionsA.body.total).toBe(2);
    expect(mentionsB.body.total).toBe(1);

    const runningMention = mentionsA.body.data[0];
    const completedMention = mentionsA.body.data[1];
    const failedMention = mentionsB.body.data[0];

    await db.put(mentionKey(runningMention.id), {
      ...runningMention,
      spawnStatus: 'running',
    });

    await db.put(mentionKey(completedMention.id), {
      ...completedMention,
      spawnStatus: 'completed',
      completedAt: Date.now(),
    });

    await db.put(mentionKey(failedMention.id), {
      ...failedMention,
      spawnStatus: 'failed',
      spawnError: 'simulated failure',
      completedAt: Date.now(),
    });

    const summary = await requestJson('/mentions/status/summary');
    expect(summary.response.status).toBe(200);
    expect(summary.body.success).toBe(true);

    const summaryA = summary.body.data.agents.find((item: any) => item.agentId === agentAId);
    const summaryB = summary.body.data.agents.find((item: any) => item.agentId === agentBId);

    expect(summaryA.counts.running).toBe(1);
    expect(summaryA.counts.completed).toBe(1);
    expect(summaryA.counts.total).toBe(2);

    expect(summaryB.counts.failed).toBe(1);
    expect(summaryB.counts.total).toBe(1);

    expect(summary.body.data.totals.running).toBeGreaterThanOrEqual(1);
    expect(summary.body.data.totals.completed).toBeGreaterThanOrEqual(1);
    expect(summary.body.data.totals.failed).toBeGreaterThanOrEqual(1);

    const detailCompleted = await requestJson(`/mentions/status/${agentAId}?status=completed&limit=10`);
    expect(detailCompleted.response.status).toBe(200);
    expect(detailCompleted.body.data.agentId).toBe(agentAId);
    expect(detailCompleted.body.data.counts.completed).toBe(1);
    expect(detailCompleted.body.data.counts.total).toBe(1);
    expect(detailCompleted.body.data.mentions[0].status).toBe('completed');
  });

  it('returns validation and not found errors for status board queries', async () => {
    const invalidStatus = await requestJson('/mentions/status/summary?status=done');
    expect(invalidStatus.response.status).toBe(400);

    const missingAgent = await requestJson(`/mentions/status/agent-missing-${randomUUID()}`);
    expect(missingAgent.response.status).toBe(404);

    const channel = await createChannel({ name: 'Task Board Validation Channel' });
    const created = await createAgent({ id: `sv-${randomUUID()}` });
    const agentId = created.payload.id as string;

    await requestJson('/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        channelId: channel.id,
        authorId: 'validator',
        content: `Task for @${agentId}`,
      }),
    });

    const invalidLimit = await requestJson(`/mentions/status/${agentId}?limit=0`);
    expect(invalidLimit.response.status).toBe(400);
  });
});

describe('notifications MVP', () => {
  it('supports webhook subscription CRUD with allowlist validation', async () => {
    const previousAllowlist = process.env.HIVE_WEBHOOK_ALLOWLIST;
    process.env.HIVE_WEBHOOK_ALLOWLIST = 'allowed.example.com';

    try {
      const invalidCreate = await requestJson('/webhook-subscriptions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: 'https://blocked.example.com/hook',
          eventTypes: ['task.completed'],
          secret: 'super-secret-key',
        }),
      });

      expect(invalidCreate.response.status).toBe(400);

      const create = await requestJson('/webhook-subscriptions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Allowed Hook',
          url: 'https://allowed.example.com/hook',
          eventTypes: ['task.started', 'task.completed', 'mention.spawn_status_changed'],
          secret: 'super-secret-key',
        }),
      });

      expect(create.response.status).toBe(201);
      const webhookId = create.body.data.id as string;

      const list = await requestJson('/webhook-subscriptions');
      expect(list.response.status).toBe(200);
      expect(list.body.data.some((item: any) => item.id === webhookId)).toBe(true);

      const getOne = await requestJson(`/webhook-subscriptions/${webhookId}`);
      expect(getOne.response.status).toBe(200);

      const remove = await requestJson(`/webhook-subscriptions/${webhookId}`, { method: 'DELETE' });
      expect(remove.response.status).toBe(200);
      expect(remove.body.data.active).toBe(false);
    } finally {
      process.env.HIVE_WEBHOOK_ALLOWLIST = previousAllowlist;
    }
  });

  it('replays task and mention lifecycle events', async () => {
    const channel = await createChannel({ name: 'Event Replay Channel' });
    const agent = await createAgent({
      id: `event-agent-${randomUUID()}`,
      spawnCommand: 'true',
    });
    const agentId = agent.payload.id as string;
    await subscribeAgentToChannel(agentId, channel.id);

    const since = Date.now();

    const post = await requestJson('/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        channelId: channel.id,
        authorId: 'orchestrator',
        content: `Please run this @${agentId}`,
      }),
    });

    expect(post.response.status).toBe(201);

    await sleep(250);

    const replay = await requestJson(`/events?since=${since}`);
    expect(replay.response.status).toBe(200);

    const types = replay.body.data.events.map((event: any) => event.type);
    expect(types.includes('mention.spawn_status_changed')).toBe(true);
    expect(types.includes('task.started')).toBe(true);
    expect(types.includes('task.completed') || types.includes('task.failed')).toBe(true);
  });

  it('signs webhook payloads and retries on failures', async () => {
    const previousAllowlist = process.env.HIVE_WEBHOOK_ALLOWLIST;
    process.env.HIVE_WEBHOOK_ALLOWLIST = 'hooks.example.com';
    const originalFetch = globalThis.fetch;

    try {
      const channel = await createChannel({ name: 'Webhook Delivery Channel' });
      const agent = await createAgent({
        id: `webhook-agent-${randomUUID()}`,
        spawnCommand: 'true',
      });
      const agentId = agent.payload.id as string;
      await subscribeAgentToChannel(agentId, channel.id);

      const secret = 'webhook-signing-secret';

      const createHook = await requestJson('/webhook-subscriptions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: 'https://hooks.example.com/notify',
          eventTypes: ['task.completed'],
          secret,
          maxRetries: 2,
          timeoutMs: 2000,
        }),
      });

      expect(createHook.response.status).toBe(201);

      const deliveries: Array<{ headers: Headers; body: string }> = [];
      let attempts = 0;

      globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        attempts += 1;
        deliveries.push({
          headers: new Headers(init?.headers),
          body: typeof init?.body === 'string' ? init.body : '',
        });

        if (attempts < 3) {
          return new Response('temporary failure', { status: 500 });
        }

        return new Response('ok', { status: 200 });
      }) as typeof fetch;

      await requestJson('/posts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          channelId: channel.id,
          authorId: 'dispatcher',
          content: `Notify @${agentId}`,
        }),
      });

      await waitFor(() => attempts >= 3, 4000);

      const last = deliveries[deliveries.length - 1];
      const signature = last.headers.get('X-Hive-Signature');
      const expected = `sha256=${createHmac('sha256', secret).update(last.body).digest('hex')}`;

      expect(signature).toBe(expected);
      expect(attempts).toBe(3);
    } finally {
      globalThis.fetch = originalFetch;
      process.env.HIVE_WEBHOOK_ALLOWLIST = previousAllowlist;
    }
  });

  it('streams live events via SSE', async () => {
    const channel = await createChannel({ name: 'SSE Channel' });
    const agent = await createAgent({
      id: `sse-agent-${randomUUID()}`,
      spawnCommand: 'true',
    });
    const agentId = agent.payload.id as string;
    await subscribeAgentToChannel(agentId, channel.id);

    const controller = new AbortController();
    const sseResponse = await app.request('/events/stream', {
      headers: { accept: 'text/event-stream' },
      signal: controller.signal,
    });

    expect(sseResponse.status).toBe(200);
    expect(sseResponse.headers.get('content-type')).toContain('text/event-stream');

    const reader = sseResponse.body?.getReader();
    expect(reader).toBeDefined();

    await requestJson('/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        channelId: channel.id,
        authorId: 'stream-author',
        content: `Streaming @${agentId}`,
      }),
    });

    const decoder = new TextDecoder();
    let buffered = '';
    const started = Date.now();

    while (Date.now() - started < 3000) {
      const next = await reader!.read();
      if (next.done) break;
      buffered += decoder.decode(next.value, { stream: true });

      if (buffered.includes('event: mention.spawn_status_changed')) {
        break;
      }
    }

    expect(buffered.includes('event: mention.spawn_status_changed')).toBe(true);

    controller.abort();
    await reader!.cancel();
  });
});

describe('elevenlabs proxy integration', () => {
  it('passes through voice listing via OnHyper proxy', async () => {
    const previousApiKey = process.env.ONHYPER_API_KEY;
    const previousAppSlug = process.env.ONHYPER_APP_SLUG;
    const previousBaseUrl = process.env.ONHYPER_BASE_URL;
    const originalFetch = globalThis.fetch;

    process.env.ONHYPER_API_KEY = 'oh_test_key';
    process.env.ONHYPER_APP_SLUG = 'agent-talk-test';
    process.env.ONHYPER_BASE_URL = 'https://proxy.test';

    const calls: Array<{ url: string; headers: Headers }> = [];

    try {
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({
          url: String(input),
          headers: new Headers(init?.headers),
        });

        return new Response(
          JSON.stringify({
            voices: [{ voice_id: 'voice_1', name: 'Nova' }],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        );
      }) as typeof fetch;

      const { response, body } = await requestJson('/proxy/elevenlabs/v1/voices');
      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.voices[0].voice_id).toBe('voice_1');

      expect(calls.length).toBe(1);
      expect(calls[0].url).toBe('https://proxy.test/proxy/elevenlabs/v1/voices');
      expect(calls[0].headers.get('x-api-key')).toBe('oh_test_key');
      expect(calls[0].headers.get('x-app-slug')).toBe('agent-talk-test');
    } finally {
      globalThis.fetch = originalFetch;
      process.env.ONHYPER_API_KEY = previousApiKey;
      process.env.ONHYPER_APP_SLUG = previousAppSlug;
      process.env.ONHYPER_BASE_URL = previousBaseUrl;
    }
  });

  it('generates mp3 output and persists it to hypermicro storage', async () => {
    const previousApiKey = process.env.ONHYPER_API_KEY;
    const previousAppSlug = process.env.ONHYPER_APP_SLUG;
    const previousBaseUrl = process.env.ONHYPER_BASE_URL;
    const previousUploadPath = process.env.HYPERMICRO_UPLOAD_PATH;
    const originalFetch = globalThis.fetch;

    process.env.ONHYPER_API_KEY = 'oh_test_key';
    process.env.ONHYPER_APP_SLUG = 'agent-talk-test';
    process.env.ONHYPER_BASE_URL = 'https://proxy.test';
    process.env.HYPERMICRO_UPLOAD_PATH = '/proxy/hypermicro/v1/storage/objects';

    const audioBytes = Uint8Array.from([0x49, 0x44, 0x33, 0x01, 0x00, 0x00]);
    const fetchCalls: Array<{ url: string; body: string; headers: Headers }> = [];

    try {
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({
          url: String(input),
          body: typeof init?.body === 'string' ? init.body : '',
          headers: new Headers(init?.headers),
        });

        if (fetchCalls.length === 1) {
          return new Response(audioBytes, {
            status: 200,
            headers: { 'content-type': 'audio/mpeg' },
          });
        }

        return new Response(
          JSON.stringify({
            key: 'agent-talk/audio/uploaded.mp3',
            url: 'https://storage.test/agent-talk/audio/uploaded.mp3',
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        );
      }) as typeof fetch;

      const text = 'hello from test';
      const { response, body } = await requestJson('/proxy/elevenlabs/v1/text-to-speech/voice_123', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text,
          modelId: 'eleven_turbo_v2_5',
        }),
      });

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.voiceId).toBe('voice_123');
      expect(body.data.size).toBe(audioBytes.byteLength);
      expect(body.data.contentType).toBe('audio/mpeg');
      expect(body.data.storageKey).toBe('agent-talk/audio/uploaded.mp3');
      expect(body.data.storageUrl).toBe('https://storage.test/agent-talk/audio/uploaded.mp3');

      const expectedHash = createHash('sha256').update(text).digest('hex');
      expect(body.data.textHash).toBe(expectedHash);

      expect(fetchCalls[0].url).toBe('https://proxy.test/proxy/elevenlabs/v1/text-to-speech/voice_123');
      expect(fetchCalls[1].url).toBe('https://proxy.test/proxy/hypermicro/v1/storage/objects');

      const uploadPayload = JSON.parse(fetchCalls[1].body);
      expect(uploadPayload.metadata.voiceId).toBe('voice_123');
      expect(uploadPayload.metadata.textHash).toBe(expectedHash);
      expect(uploadPayload.metadata.size).toBe(audioBytes.byteLength);
      expect(uploadPayload.contentType).toBe('audio/mpeg');
      expect(typeof uploadPayload.dataBase64).toBe('string');
      expect(uploadPayload.dataBase64.length).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = originalFetch;
      process.env.ONHYPER_API_KEY = previousApiKey;
      process.env.ONHYPER_APP_SLUG = previousAppSlug;
      process.env.ONHYPER_BASE_URL = previousBaseUrl;
      process.env.HYPERMICRO_UPLOAD_PATH = previousUploadPath;
    }
  });

  it('returns clear config errors when OnHyper credentials are missing', async () => {
    const previousApiKey = process.env.ONHYPER_API_KEY;
    const previousHyperApiKey = process.env.HYPER_API_KEY;
    const previousAppSlug = process.env.ONHYPER_APP_SLUG;
    const previousHyperAppSlug = process.env.HYPER_APP_SLUG;

    delete process.env.ONHYPER_API_KEY;
    delete process.env.HYPER_API_KEY;
    delete process.env.ONHYPER_APP_SLUG;
    delete process.env.HYPER_APP_SLUG;

    try {
      const { response, body } = await requestJson('/proxy/elevenlabs/v1/voices');
      expect(response.status).toBe(500);
      expect(body.success).toBe(false);
      expect(body.error).toContain('Missing OnHyper API key');
    } finally {
      process.env.ONHYPER_API_KEY = previousApiKey;
      process.env.HYPER_API_KEY = previousHyperApiKey;
      process.env.ONHYPER_APP_SLUG = previousAppSlug;
      process.env.HYPER_APP_SLUG = previousHyperAppSlug;
    }
  });

  it('returns upstream errors for failed tts calls', async () => {
    const previousApiKey = process.env.ONHYPER_API_KEY;
    const previousAppSlug = process.env.ONHYPER_APP_SLUG;
    const previousBaseUrl = process.env.ONHYPER_BASE_URL;
    const originalFetch = globalThis.fetch;

    process.env.ONHYPER_API_KEY = 'oh_test_key';
    process.env.ONHYPER_APP_SLUG = 'agent-talk-test';
    process.env.ONHYPER_BASE_URL = 'https://proxy.test';

    try {
      globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => {
        return new Response(JSON.stringify({ error: 'invalid voice id' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch;

      const { response, body } = await requestJson('/proxy/elevenlabs/v1/text-to-speech/missing-voice', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'test' }),
      });

      expect(response.status).toBe(502);
      expect(body.success).toBe(false);
      expect(body.error).toContain('invalid voice id');
    } finally {
      globalThis.fetch = originalFetch;
      process.env.ONHYPER_API_KEY = previousApiKey;
      process.env.ONHYPER_APP_SLUG = previousAppSlug;
      process.env.ONHYPER_BASE_URL = previousBaseUrl;
    }
  });
});
