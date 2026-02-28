import { describe, expect, it } from 'bun:test';
import { createHmac } from 'node:crypto';
import {
  buildEventSummary,
  createRelayHandler,
  verifyHiveSignature,
} from '../src/services/openclaw-relay.js';

function sign(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function successResult() {
  return { ok: true, exitCode: 0 };
}

describe('openclaw relay signature verification', () => {
  it('accepts valid HMAC signatures', () => {
    const payload = '{"ok":true}';
    const signature = sign('secret-1', payload);
    expect(verifyHiveSignature('secret-1', payload, signature)).toBe(true);
  });

  it('rejects invalid signatures', () => {
    const payload = '{"ok":true}';
    expect(verifyHiveSignature('secret-1', payload, 'sha256=deadbeef')).toBe(false);
    expect(verifyHiveSignature('secret-1', payload, null)).toBe(false);
  });
});

describe('openclaw relay handling', () => {
  it('triggers openclaw for relayed event types', async () => {
    const calledWith: string[] = [];
    const handler = createRelayHandler({
      sharedSecret: 'relay-secret',
      openclawBin: 'openclaw',
      dedupWindowMs: 0,
      throttleMs: 0,
      now: () => 1_000,
      executeOpenclaw: async (text: string) => {
        calledWith.push(text);
        return successResult();
      },
      logLine: () => {},
    });

    const event = {
      id: 'event-1',
      type: 'task.completed',
      timestamp: 1_700_000_000_001,
      payload: {
        taskId: 'mention-1',
        agentId: 'builder',
        roomId: 'room-alpha',
      },
    };

    const raw = JSON.stringify(event);
    const result = await handler(raw, sign('relay-secret', raw));

    expect(result.statusCode).toBe(202);
    expect(result.body.action).toBe('triggered');
    expect(calledWith).toHaveLength(1);
    expect(calledWith[0]).toContain('task completed');
    expect(calledWith[0]).toContain('builder');
  });

  it('ignores unhandled event types', async () => {
    const calledWith: string[] = [];
    const handler = createRelayHandler({
      sharedSecret: 'relay-secret',
      openclawBin: 'openclaw',
      dedupWindowMs: 0,
      throttleMs: 0,
      now: () => 2_000,
      executeOpenclaw: async (text: string) => {
        calledWith.push(text);
        return successResult();
      },
      logLine: () => {},
    });

    const event = {
      id: 'event-2',
      type: 'task.progress',
      timestamp: 1_700_000_000_002,
      payload: {
        taskId: 'mention-2',
      },
    };

    const raw = JSON.stringify(event);
    const result = await handler(raw, sign('relay-secret', raw));

    expect(result.statusCode).toBe(200);
    expect(result.body.action).toBe('ignored');
    expect(calledWith).toHaveLength(0);
  });

  it('deduplicates by event id when enabled', async () => {
    const calledWith: string[] = [];
    const handler = createRelayHandler({
      sharedSecret: 'relay-secret',
      openclawBin: 'openclaw',
      dedupWindowMs: 60_000,
      throttleMs: 0,
      now: () => 3_000,
      executeOpenclaw: async (text: string) => {
        calledWith.push(text);
        return successResult();
      },
      logLine: () => {},
    });

    const event = {
      id: 'event-dup',
      type: 'task.failed',
      timestamp: 1_700_000_000_003,
      payload: {
        taskId: 'mention-3',
        agentId: 'tester',
        roomId: 'room-beta',
        exitCode: 1,
      },
    };

    const raw = JSON.stringify(event);
    const signature = sign('relay-secret', raw);

    const first = await handler(raw, signature);
    const second = await handler(raw, signature);

    expect(first.body.action).toBe('triggered');
    expect(second.body.action).toBe('duplicate');
    expect(calledWith).toHaveLength(1);
  });

  it('throttles notifications when configured', async () => {
    let currentTime = 10_000;
    const calledWith: string[] = [];
    const handler = createRelayHandler({
      sharedSecret: 'relay-secret',
      openclawBin: 'openclaw',
      dedupWindowMs: 0,
      throttleMs: 5_000,
      now: () => currentTime,
      executeOpenclaw: async (text: string) => {
        calledWith.push(text);
        return successResult();
      },
      logLine: () => {},
    });

    const eventA = JSON.stringify({
      id: 'event-4',
      type: 'task.completed',
      timestamp: 1_700_000_000_004,
      payload: {
        taskId: 'mention-4',
        agentId: 'planner',
        roomId: 'room-gamma',
      },
    });

    const eventB = JSON.stringify({
      id: 'event-5',
      type: 'task.failed',
      timestamp: 1_700_000_000_005,
      payload: {
        taskId: 'mention-5',
        agentId: 'planner',
        roomId: 'room-gamma',
      },
    });

    const first = await handler(eventA, sign('relay-secret', eventA));
    const second = await handler(eventB, sign('relay-secret', eventB));
    currentTime += 6_000;
    const third = await handler(eventB, sign('relay-secret', eventB));

    expect(first.body.action).toBe('triggered');
    expect(second.body.action).toBe('throttled');
    expect(third.body.action).toBe('triggered');
    expect(calledWith).toHaveLength(2);
  });

  it('logs event id/type/timestamp, action, and command status in one line', async () => {
    const logs: string[] = [];
    const handler = createRelayHandler({
      sharedSecret: 'relay-secret',
      openclawBin: 'openclaw',
      dedupWindowMs: 0,
      throttleMs: 0,
      now: () => 4_000,
      executeOpenclaw: async () => ({ ok: false, exitCode: 17, error: 'openclaw exited with code 17' }),
      logLine: (line: string) => logs.push(line),
    });

    const event = {
      id: 'event-log-1',
      type: 'task.completed',
      timestamp: 1_700_000_000_006,
      payload: {
        taskId: 'mention-6',
        agentId: 'observer',
        roomId: 'room-zeta',
      },
    };

    const raw = JSON.stringify(event);
    const result = await handler(raw, sign('relay-secret', raw));

    expect(result.statusCode).toBe(500);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('eventId=event-log-1');
    expect(logs[0]).toContain('type=task.completed');
    expect(logs[0]).toContain('timestamp=1700000000006');
    expect(logs[0]).toContain('signatureVerified=true');
    expect(logs[0]).toContain('action=triggered');
    expect(logs[0]).toContain('command=failed');
    expect(logs[0]).toContain('exitCode=17');
  });
});

describe('event summary formatting', () => {
  it('formats mention status changes', () => {
    const summary = buildEventSummary({
      id: 'event-6',
      type: 'mention.spawn_status_changed',
      timestamp: 1_700_000_000_007,
      payload: {
        mentionId: 'mention-6',
        fromStatus: 'running',
        toStatus: 'failed',
        agentId: 'builder',
      },
    });

    expect(summary).toContain('mention-6');
    expect(summary).toContain('running -> failed');
  });
});
