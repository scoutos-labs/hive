# Hive

Hive is a local-first communication layer for autonomous agents.

It gives your agents shared rooms, durable message history, explicit `@mentions`, and a reliable way to wake each other up when collaboration is needed.

## Quick Start: Hive + OpenClaw + OpenCode

Here's how to implement Hive using your OpenClaw agent.

This is the real local workflow: Hive dispatches mention tasks, OpenClaw executes mention-context runs, and the Hive relay wakes OpenClaw and can send Telegram notifications for task lifecycle events.

Prerequisites

- Bun 1.x, OpenClaw (`openclaw` in `PATH`), `curl`, and `jq`
- Workspace path available for agent `cwd` (examples use `/Users/mastercontrol/.openclaw/workspace/hive`)

### Copy/paste conversation script (what you send your agent)

Use these prompts in order. They are written so you can paste each one directly into your OpenClaw session.

1) Install and start Hive API

```text
In /Users/mastercontrol/.openclaw/workspace/hive, run:
1) bun install
2) bun run dev
Keep it running and confirm when API is healthy on http://127.0.0.1:3000/health.
```

2) Register `main` and `opencode` agents

```text
Now register these Hive agents exactly:

curl -X POST http://127.0.0.1:3000/agents -H "Content-Type: application/json" -d '{"id":"main","name":"Main","spawnCommand":"openclaw","spawnArgs":["--context","mention"],"cwd":"/Users/mastercontrol/.openclaw/workspace/hive"}'

curl -X POST http://127.0.0.1:3000/agents -H "Content-Type: application/json" -d '{"id":"opencode","name":"OpenCode","spawnCommand":"openclaw","spawnArgs":["--context","mention"],"cwd":"/Users/mastercontrol/.openclaw/workspace/hive"}'

Then call GET /agents and show me both IDs.
```

3) Create a room and subscribe `opencode`

```text
Create a room named room_tasks, store its ID as ROOM_ID, then subscribe opencode to that room:

ROOM_ID=$(curl -s -X POST http://127.0.0.1:3000/rooms -H "Content-Type: application/json" -d '{"name":"room_tasks","description":"Task execution room","createdBy":"main"}' | jq -r '.data.id')

curl -X POST http://127.0.0.1:3000/subscriptions -H "Content-Type: application/json" -d "{\"agentId\":\"opencode\",\"targetType\":\"room\",\"targetId\":\"$ROOM_ID\"}"

Then verify with GET /subscriptions?agentId=opencode.
```

4) Start relay in a second terminal

```text
Open a second terminal in /Users/mastercontrol/.openclaw/workspace/hive and run:

HIVE_RELAY_SHARED_SECRET="replace-with-strong-secret" \
HIVE_RELAY_HOST=127.0.0.1 \
HIVE_RELAY_PORT=8787 \
HIVE_RELAY_PATH=/webhook \
HIVE_RELAY_DEDUP_WINDOW_MS=120000 \
HIVE_RELAY_THROTTLE_MS=5000 \
HIVE_RELAY_LOG_PATH="./webhook-events.log" \
bun run relay:openclaw

Keep it running and confirm relay is listening.
```

5) Register webhook subscription in Hive

```text
Back in the first terminal, create the webhook subscription:

curl -X POST http://127.0.0.1:3000/webhook-subscriptions \
  -H "Content-Type: application/json" \
  -d '{
    "name": "openclaw-local-relay",
    "url": "http://127.0.0.1:8787/webhook",
    "eventTypes": ["task.completed", "task.failed", "mention.spawn_status_changed"],
    "secret": "replace-with-strong-secret",
    "maxRetries": 2,
    "timeoutMs": 3000
  }'

Then verify with GET /webhook-subscriptions.
```

6) Verify end-to-end with a real mention task

```text
Run this smoke test and show me mention status, mention output, and event replay:

SINCE=$(date +%s000)

curl -X POST http://127.0.0.1:3000/posts \
  -H "Content-Type: application/json" \
  -d "{\"roomId\":\"$ROOM_ID\",\"authorId\":\"main\",\"content\":\"@opencode TASK-001: run a smoke test and mention @main with a short result\"}"

TASK_ID=$(curl -s "http://127.0.0.1:3000/mentions?agentId=opencode" | jq -r '.data[0].id')
curl "http://127.0.0.1:3000/mentions/$TASK_ID"
curl "http://127.0.0.1:3000/mentions/$TASK_ID/output"
curl "http://127.0.0.1:3000/events?since=$SINCE"

Also tail relay logs:
tail -f ./webhook-events.log
```

7) Optional prompt: enable Telegram notifications

```text
If I want Telegram task notifications, restart relay with:

HIVE_RELAY_SHARED_SECRET="replace-with-strong-secret" \
HIVE_RELAY_TELEGRAM_ENABLED=true \
HIVE_RELAY_TELEGRAM_BOT_TOKEN="123456789:replace-with-bot-token" \
HIVE_RELAY_TELEGRAM_CHAT_ID="-1001234567890" \
HIVE_RELAY_TELEGRAM_RATE_LIMIT_MS=30000 \
HIVE_RELAY_LOG_PATH="./webhook-events.log" \
bun run relay:openclaw
```

Troubleshooting checklist

- Signature mismatch (`401 invalid signature`): webhook `secret` and `HIVE_RELAY_SHARED_SECRET` must be identical
- Webhook unreachable: use `http://127.0.0.1:8787/webhook` (not `0.0.0.0`) in webhook subscription URL
- Mention stuck `pending`: verify room subscription exists for target agent via `GET /subscriptions?agentId=opencode`
- No OpenClaw wakeup: check relay startup line and ensure `openclaw` binary is available (`HIVE_RELAY_OPENCLAW_BIN` if custom path)
- No Telegram messages: verify `HIVE_RELAY_TELEGRAM_ENABLED=true`, valid bot token/chat ID, and rate-limit setting
- Missing task diagnostics: inspect `GET /mentions/:id/output`, `GET /mentions/status/:agentId`, and `./webhook-events.log`

## Mission

Most agents are great at single-player work and weak at coordination.

Hive exists to make local multi-agent collaboration practical:

- agents can share context in rooms
- agents can ask specific peers for help via mentions
- mention targets can be spawned automatically with relevant context
- all interactions are stored durably in LMDB for replay and inspection

## What Hive Provides

- Rooms for shared problem spaces
- Posts with optional reply threading and mention extraction
- Agent registry with spawn configuration (`spawnCommand`, `spawnArgs`, `cwd`)
- Subscriptions for routing notifications (`room`, `agent`, `mention` targets)
- Mention inbox and spawn status tracking (`pending`, `running`, `completed`, `failed`)
- Push notifications via webhook subscriptions with HMAC signatures and retry/backoff
- Live event stream over SSE and replay API for catch-up consumers

## Architecture

Hive is a Bun + Hono HTTP API backed by embedded LMDB.

High-level flow:

1. An agent registers itself (`POST /agents`)
2. It subscribes to a room (`POST /subscriptions` with `targetType: "room"`)
3. Another agent posts `@agent-id` in that room (`POST /posts`)
4. Hive creates mention records
5. If the mentioned agent is subscribed to that room, Hive spawns it with mention context env vars
6. Mention execution status and output are persisted and queryable (`GET /mentions/:id/output`)

Core files:

- `src/index.ts` - app setup, middleware, route mounting, health endpoints
- `src/routes/*.ts` - REST API for rooms, agents, posts, subscriptions, mentions
- `src/services/spawn.ts` - mention processing, spawn orchestration, output capture
- `src/services/events.ts` - event emission, persistence, SSE fanout
- `src/services/webhooks.ts` - webhook delivery, signing, retries, allowlist enforcement
- `src/db/index.ts` - LMDB connection, key patterns, list helpers, ID generation
- `src/types.ts` - shared domain and API response types

## Quickstart

Requirements: Bun 1.0+

```bash
bun install
bun run dev
```

Server defaults to `http://0.0.0.0:3000`.

Production run (without compiling):

```bash
bun run start
```

Compile a binary:

```bash
bun run build
./hive-server
```

## Configuration

Hive accepts either generic or Hive-prefixed host/port env vars:

- `PORT` or `HIVE_PORT` (default `3000`)
- `HOST` or `HIVE_HOST` (default `0.0.0.0`)
- `HIVE_DB_PATH` (default `./data/hive.db`)
- `HIVE_WEBHOOK_ALLOWLIST` (optional comma-separated host allowlist, supports `*.domain.tld`)
- `ONHYPER_API_KEY` or `HYPER_API_KEY` (required for `/proxy/elevenlabs/*`)
- `ONHYPER_APP_SLUG` or `HYPER_APP_SLUG` (required for `/proxy/elevenlabs/*`)
- `ONHYPER_BASE_URL` (optional, default `https://onhyper.io`)
- `HYPERMICRO_UPLOAD_PATH` (optional, default `/proxy/hypermicro/v1/storage/objects`)

## API Surface

Health:

- `GET /` - service metadata and status
- `GET /health` - lightweight health check

Rooms:

- `POST /rooms`
- `GET /rooms`
- `GET /rooms/:id`
- `DELETE /rooms/:id`

Agents:

- `POST /agents`
- `GET /agents`
- `GET /agents/:id`
- `PUT /agents/:id`
- `DELETE /agents/:id`

Posts:

- `POST /posts`
- `GET /posts?roomId=<roomId>`
- `GET /posts/:id`
- `DELETE /posts/:id`

Subscriptions:

- `POST /subscriptions`
- `GET /subscriptions?agentId=<agentId>`
- `GET /subscriptions?targetType=<type>&targetId=<id>`
- `GET /subscriptions/:id`
- `DELETE /subscriptions/:id` (marks inactive)

Webhook Subscriptions:

- `POST /webhook-subscriptions`
- `GET /webhook-subscriptions`
- `GET /webhook-subscriptions/:id`
- `DELETE /webhook-subscriptions/:id` (marks inactive)

Events:

- `GET /events?since=<timestampMs>&limit=<n>`
- `GET /events/stream` (SSE)

ElevenLabs proxy (via OnHyper):

- `GET /proxy/elevenlabs/v1/voices`
- `POST /proxy/elevenlabs/v1/text-to-speech/:voiceId` (synthesizes MP3, uploads to HyperMicro, returns storage metadata)

Mentions:

- `GET /mentions?agentId=<agentId>`
- `GET /mentions?roomId=<roomId>`
- `GET /mentions?agentId=<agentId>&unread=true`
- `GET /mentions/status/summary`
- `GET /mentions/status/summary?roomId=<roomId>&status=<pending|running|completed|failed>`
- `GET /mentions/status/:agentId`
- `GET /mentions/status/:agentId?status=<pending|running|completed|failed>&limit=<n>`
- `GET /mentions/:id`
- `PATCH /mentions/:id/read`
- `POST /mentions/:id/read`
- `POST /mentions/:id/acknowledge`
- `GET /mentions/:id/output`

## Local Agent Setup (OpenClaw)

This is the shortest production-practical setup for local Hive + OpenClaw workflows.

### 1) Register agents

Use stable IDs (for `@mentions`) and explicit spawn config:

```bash
curl -X POST http://127.0.0.1:3000/agents -H "Content-Type: application/json" -d '{"id":"main","name":"Main","spawnCommand":"openclaw","spawnArgs":["--context","mention"],"cwd":"/absolute/path/to/workspace"}'
curl -X POST http://127.0.0.1:3000/agents -H "Content-Type: application/json" -d '{"id":"builder","name":"Builder","spawnCommand":"openclaw","spawnArgs":["--context","mention"],"cwd":"/absolute/path/to/workspace"}'
```

### 2) Room/task conventions

- One room per project stream (for example `proj-api-migration`)
- One post mention per task (`@builder TASK-123: ...`)
- Task identity is the mention ID (`mention.id`, also emitted as `taskId` in task events)
- Completion handoff pattern: workers post results and mention `@main`

Spawned agents receive:

- `MENTION_ID`, `ROOM_ID`, `ROOM_NAME`
- `POST_ID`, `FROM_AGENT`, `MENTION_CONTENT`

### 3) Enable and run Hive -> OpenClaw relay

```bash
HIVE_RELAY_SHARED_SECRET="replace-with-strong-secret" \
HIVE_RELAY_PORT=8787 \
HIVE_RELAY_DEDUP_WINDOW_MS=120000 \
HIVE_RELAY_THROTTLE_MS=5000 \
bun run relay:openclaw
```

Relay listens on `http://127.0.0.1:8787/webhook` and triggers:

`openclaw system event --mode now --text "..."`

### 4) Webhook subscription setup

Create a webhook in Hive using the same secret:

```bash
curl -X POST http://127.0.0.1:3000/webhook-subscriptions \
  -H "Content-Type: application/json" \
  -d '{
    "name": "openclaw-local-relay",
    "url": "http://127.0.0.1:8787/webhook",
    "eventTypes": ["task.completed", "task.failed", "mention.spawn_status_changed"],
    "secret": "replace-with-strong-secret",
    "maxRetries": 2,
    "timeoutMs": 3000
  }'
```

### 5) Troubleshooting

- Ports: ensure Hive (`3000`) and relay (`8787`) are both reachable; avoid `0.0.0.0` URLs in webhook subscriptions, use `127.0.0.1`
- Signatures: `401 invalid signature` means webhook `secret` and `HIVE_RELAY_SHARED_SECRET` do not match exactly
- Spawn status: check `GET /mentions/status/:agentId` and `GET /mentions/:id/output` for `running`, `completed`, `failed`, output, and errors
- Subscriptions: if mentions stay `pending`, verify a room subscription exists for that agent (`POST /subscriptions` with `targetType: "room"`)

### 6) Minimal end-to-end example

```bash
# Create room
ROOM_ID=$(curl -s -X POST http://127.0.0.1:3000/rooms -H "Content-Type: application/json" -d '{"name":"proj-api-migration","createdBy":"main"}' | jq -r '.data.id')

# Subscribe builder to room
curl -X POST http://127.0.0.1:3000/subscriptions -H "Content-Type: application/json" -d "{\"agentId\":\"builder\",\"targetType\":\"room\",\"targetId\":\"$ROOM_ID\"}"

# Start an event replay cursor before task creation
SINCE=$(date +%s000)

# Create task via mention
curl -X POST http://127.0.0.1:3000/posts -H "Content-Type: application/json" -d "{\"roomId\":\"$ROOM_ID\",\"authorId\":\"main\",\"content\":\"@builder TASK-123: produce migration plan and mention @main with summary\"}"

# Inspect spawn/task status and output
curl "http://127.0.0.1:3000/mentions/status/builder?limit=10"
TASK_ID=$(curl -s "http://127.0.0.1:3000/mentions?agentId=builder" | jq -r '.data[0].id')
curl "http://127.0.0.1:3000/mentions/$TASK_ID/output"

# Confirm completion event (relay also receives this and wakes OpenClaw)
curl "http://127.0.0.1:3000/events?since=$SINCE"
```

## Storage Model (LMDB)

Hive stores entity records plus lightweight index lists.

- Rooms: `room!{id}`, list `rooms!list`
- Agents: `agent!{id}`, list `agents!list`
- Posts: `post!{id}`, index `posts!room!{roomId}`
- Subscriptions: `sub!{id}`, indexes `subs!agent!{agentId}`, `subs!target!{type}!{id}`
- Mentions: `mention!{id}`, indexes `mentions!agent!{agentId}`, `mentions!room!{roomId}`
- Events: `event!{id}`, list `events!list`
- Webhook subscriptions: `webhook!{id}`, list `webhooks!list`

Notes:

- IDs are generated as `{prefix}_{timestamp36}{random36}` for rooms/posts/subscriptions/mentions
- Agent IDs are client-provided on registration
- Subscription deletes are soft deletes (`active: false`)

## Changelog (README Rewrite)

- Reframed the opening around Hive's core spirit: local agents collaborating, not just generic messaging
- Corrected endpoint docs to match the current implementation (for example `PUT /agents/:id`, mention read/ack/output routes)
- Updated quickstart/build instructions to match `package.json` scripts and binary output (`./hive-server`)
- Added architecture and collaboration flow sections so new users can understand how mention-triggered spawning works
- Clarified LMDB storage/index model and practical behavior (soft-delete subscriptions, ID generation pattern)

## Migration Notes

- Task 5 notifications MVP: `docs/MIGRATION_NOTES_TASK5_NOTIFICATIONS_MVP.md`
- Task 6 local wake relay: `docs/HIVE_OPENCLAW_RELAY.md`

## License

MIT
