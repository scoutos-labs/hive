import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import type { HiveEvent } from '../types.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;
const DEFAULT_PATH = '/webhook';
const DEFAULT_OPENCLAW_BIN = 'openclaw';
const DEFAULT_DEDUP_WINDOW_MS = 0;
const DEFAULT_THROTTLE_MS = 0;

const RELAYABLE_TYPES = new Set([
  'task.completed',
  'task.failed',
  'mention.spawn_status_changed',
]);

export interface RelayRuntimeConfig {
  sharedSecret: string;
  openclawBin: string;
  dedupWindowMs: number;
  throttleMs: number;
  now: () => number;
  executeOpenclaw: (text: string) => Promise<OpenclawCommandResult>;
  logLine: (line: string) => void;
}

export interface OpenclawCommandResult {
  ok: boolean;
  exitCode: number | null;
  error?: string;
}

export interface RelayServerConfig {
  host: string;
  port: number;
  path: string;
  runtime: RelayRuntimeConfig;
}

export interface RelayResult {
  statusCode: number;
  body: {
    success: boolean;
    action: 'triggered' | 'ignored' | 'duplicate' | 'throttled';
    reason?: string;
  };
}

interface RelayState {
  seenEventIds: Map<string, number>;
  lastTriggerAt: number;
}

type HiveEventLike = Pick<HiveEvent, 'id' | 'type' | 'payload'> & { timestamp?: number };

export function parseRelayServerConfigFromEnv(env = process.env): RelayServerConfig {
  const sharedSecret = env.HIVE_RELAY_SHARED_SECRET;
  if (!sharedSecret) {
    throw new Error('Missing HIVE_RELAY_SHARED_SECRET');
  }

  const host = env.HIVE_RELAY_HOST || DEFAULT_HOST;
  const port = parsePositiveInt(env.HIVE_RELAY_PORT, DEFAULT_PORT);
  const path = normalizePath(env.HIVE_RELAY_PATH || DEFAULT_PATH);
  const openclawBin = env.HIVE_RELAY_OPENCLAW_BIN || DEFAULT_OPENCLAW_BIN;
  const dedupWindowMs = parseNonNegativeInt(env.HIVE_RELAY_DEDUP_WINDOW_MS, DEFAULT_DEDUP_WINDOW_MS);
  const throttleMs = parseNonNegativeInt(env.HIVE_RELAY_THROTTLE_MS, DEFAULT_THROTTLE_MS);
  const relayLogger = createRelayLogger(env.HIVE_RELAY_LOG_PATH);

  const runtime: RelayRuntimeConfig = {
    sharedSecret,
    openclawBin,
    dedupWindowMs,
    throttleMs,
    now: () => Date.now(),
    executeOpenclaw: createOpenclawExecutor(openclawBin),
    logLine: relayLogger,
  };

  return { host, port, path, runtime };
}

export function createOpenclawExecutor(openclawBin: string): (text: string) => Promise<OpenclawCommandResult> {
  return (text: string) =>
    new Promise((resolve) => {
      const child = spawn(
        openclawBin,
        ['system', 'event', '--mode', 'now', '--text', text],
        {
          stdio: 'ignore',
          detached: false,
        }
      );

      let settled = false;
      const finish = (result: OpenclawCommandResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      child.on('error', (error) => {
        finish({
          ok: false,
          exitCode: null,
          error: error.message,
        });
      });

      child.on('close', (code) => {
        if (code === 0) {
          finish({
            ok: true,
            exitCode: 0,
          });
          return;
        }

        finish({
          ok: false,
          exitCode: code,
          error: `openclaw exited with code ${code}`,
        });
      });
    });
}

export function createRelayHandler(config: RelayRuntimeConfig) {
  const state: RelayState = {
    seenEventIds: new Map(),
    lastTriggerAt: 0,
  };

  return async (rawBody: string, signatureHeader: string | null): Promise<RelayResult> => {
    const parsed = parseEvent(rawBody);
    const signatureVerified = verifyHiveSignature(config.sharedSecret, rawBody, signatureHeader);
    const eventId = parsed?.id || 'unknown';
    const eventType = parsed?.type || 'unknown';
    const eventTimestamp = typeof parsed?.timestamp === 'number' ? String(parsed.timestamp) : 'unknown';

    const finalize = (
      statusCode: number,
      body: RelayResult['body'],
      commandResult: OpenclawCommandResult | null
    ): RelayResult => {
      const commandState = commandResult ? (commandResult.ok ? 'success' : 'failed') : 'skipped';
      const commandExit = commandResult ? (commandResult.exitCode === null ? 'null' : String(commandResult.exitCode)) : 'na';
      const reasonSuffix = body.reason ? ` reason=${safeLogValue(body.reason)}` : '';

      config.logLine(
        `[hive-relay] eventId=${safeLogValue(eventId)} type=${safeLogValue(eventType)} timestamp=${safeLogValue(eventTimestamp)} signatureVerified=${signatureVerified} action=${body.action} command=${commandState} exitCode=${commandExit}${reasonSuffix}`
      );

      return { statusCode, body };
    };

    if (!signatureVerified) {
      return finalize(
        401,
        {
          success: false,
          action: 'ignored',
          reason: 'invalid signature',
        },
        null
      );
    }

    if (!parsed) {
      return finalize(
        400,
        {
          success: false,
          action: 'ignored',
          reason: 'invalid event payload',
        },
        null
      );
    }

    if (!RELAYABLE_TYPES.has(parsed.type)) {
      return finalize(
        200,
        {
          success: true,
          action: 'ignored',
          reason: 'event type not relayed',
        },
        null
      );
    }

    const now = config.now();
    cleanupSeenEventIds(state.seenEventIds, now, config.dedupWindowMs);

    if (isDuplicateEvent(state.seenEventIds, parsed.id, now, config.dedupWindowMs)) {
      return finalize(
        200,
        {
          success: true,
          action: 'duplicate',
          reason: 'event already processed',
        },
        null
      );
    }

    if (config.throttleMs > 0 && now - state.lastTriggerAt < config.throttleMs) {
      return finalize(
        200,
        {
          success: true,
          action: 'throttled',
          reason: 'notification throttled',
        },
        null
      );
    }

    const summary = buildEventSummary(parsed);
    if (!summary) {
      return finalize(
        200,
        {
          success: true,
          action: 'ignored',
          reason: 'event type not relayed',
        },
        null
      );
    }

    const commandResult = await config.executeOpenclaw(summary);
    if (!commandResult.ok) {
      return finalize(
        500,
        {
          success: false,
          action: 'triggered',
          reason: commandResult.error || 'openclaw command failed',
        },
        commandResult
      );
    }

    state.lastTriggerAt = now;

    return finalize(
      202,
      {
        success: true,
        action: 'triggered',
      },
      commandResult
    );
  };
}

export function startRelayServer(config: RelayServerConfig): Server {
  const handler = createRelayHandler(config.runtime);

  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== config.path) {
      writeJson(res, 404, {
        success: false,
        error: 'Not found',
      });
      return;
    }

    try {
      const rawBody = await readRawBody(req);
      const signature = req.headers['x-hive-signature'];
      const signatureHeader = Array.isArray(signature) ? signature[0] : signature || null;

      const result = await handler(rawBody, signatureHeader);
      writeJson(res, result.statusCode, result.body);
    } catch (error) {
      writeJson(res, 500, {
        success: false,
        error: error instanceof Error ? error.message : 'Internal error',
      });
    }
  });

  server.listen(config.port, config.host);
  return server;
}

export function verifyHiveSignature(secret: string, payload: string, signatureHeader: string | null): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false;

  const receivedHex = signatureHeader.slice('sha256='.length);
  if (!/^[0-9a-f]{64}$/i.test(receivedHex)) return false;

  const expected = createHmac('sha256', secret).update(payload).digest();
  const received = Buffer.from(receivedHex, 'hex');

  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

export function buildEventSummary(event: HiveEventLike): string | null {
  const payload = asRecord(event.payload);

  if (event.type === 'task.completed') {
    return compact(`Hive task completed by ${field(payload, 'agentId')} in ${field(payload, 'roomId')} (${field(payload, 'taskId')}).`);
  }

  if (event.type === 'task.failed') {
    const exitCode = field(payload, 'exitCode');
    return compact(`Hive task failed for ${field(payload, 'agentId')} in ${field(payload, 'roomId')} (${field(payload, 'taskId')}, exit ${exitCode}).`);
  }

  if (event.type === 'mention.spawn_status_changed') {
    return compact(
      `Hive mention ${field(payload, 'mentionId')} status ${field(payload, 'fromStatus')} -> ${field(payload, 'toStatus')} (${field(payload, 'agentId')}).`
    );
  }

  return null;
}

function writeJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function parseEvent(rawBody: string): HiveEventLike | null {
  try {
    const parsed = JSON.parse(rawBody) as Partial<HiveEventLike>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.id !== 'string') return null;
    if (typeof parsed.type !== 'string') return null;
    if (!parsed.payload || typeof parsed.payload !== 'object') return null;
    return parsed as HiveEventLike;
  } catch {
    return null;
  }
}

async function readRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks).toString('utf8');
}

function cleanupSeenEventIds(seenEventIds: Map<string, number>, now: number, windowMs: number): void {
  if (windowMs <= 0 || seenEventIds.size === 0) return;

  for (const [id, seenAt] of seenEventIds) {
    if (now - seenAt >= windowMs) {
      seenEventIds.delete(id);
    }
  }
}

function isDuplicateEvent(seenEventIds: Map<string, number>, eventId: string, now: number, windowMs: number): boolean {
  if (windowMs <= 0) return false;

  const existing = seenEventIds.get(eventId);
  if (typeof existing === 'number' && now - existing < windowMs) {
    return true;
  }

  seenEventIds.set(eventId, now);
  return false;
}

function parsePositiveInt(rawValue: string | undefined, fallback: number): number {
  if (!rawValue) return fallback;
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseNonNegativeInt(rawValue: string | undefined, fallback: number): number {
  if (!rawValue) return fallback;
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function normalizePath(path: string): string {
  if (path.startsWith('/')) return path;
  return `/${path}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  return value as Record<string, unknown>;
}

function field(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value === 'string' && value.trim().length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  return 'unknown';
}

function createRelayLogger(logPath: string | undefined): (line: string) => void {
  const targetPath = typeof logPath === 'string' ? logPath.trim() : '';
  if (!targetPath) {
    return (line: string) => {
      console.log(line);
    };
  }

  return (line: string) => {
    try {
      appendFileSync(targetPath, `${line}\n`, 'utf8');
    } catch (error) {
      console.error('[hive-relay] failed to write relay log file', error);
      console.log(line);
    }
  };
}

function safeLogValue(value: string): string {
  if (value.length === 0) return 'unknown';
  return value.replace(/\s+/g, '_');
}

function compact(input: string): string {
  const normalized = input.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 280) return normalized;
  return `${normalized.slice(0, 277)}...`;
}
