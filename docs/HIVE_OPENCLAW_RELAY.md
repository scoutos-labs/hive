# Hive -> OpenClaw Local Notification Relay

This relay receives Hive webhook events on localhost, verifies `X-Hive-Signature`, filters high-signal event types, and immediately triggers OpenClaw via:

`openclaw system event --mode now --text "..."`

It can also send Telegram notifications (for Rakis or any target chat) for important task lifecycle events.

## What It Relays

- `task.completed`
- `task.failed`
- `mention.spawn_status_changed`

Other event types are accepted but ignored.

## Environment Variables

- `HIVE_RELAY_SHARED_SECRET` (required) - HMAC secret that must match webhook subscription secret
- `HIVE_RELAY_HOST` (optional, default `127.0.0.1`) - relay bind host
- `HIVE_RELAY_PORT` (optional, default `8787`) - relay bind port
- `HIVE_RELAY_PATH` (optional, default `/webhook`) - webhook path
- `HIVE_RELAY_OPENCLAW_BIN` (optional, default `openclaw`) - OpenClaw binary path/name
- `HIVE_RELAY_DEDUP_WINDOW_MS` (optional, default `0`) - dedup window by `event.id` (`0` disables)
- `HIVE_RELAY_THROTTLE_MS` (optional, default `0`) - minimum delay between OpenClaw wakeups (`0` disables)
- `HIVE_RELAY_LOG_PATH` (optional) - append relay observability logs to a file; defaults to stdout when unset
- `HIVE_RELAY_TELEGRAM_ENABLED` (optional, default `false`) - enable Telegram notifications for `task.completed` / `task.failed`
- `HIVE_RELAY_TELEGRAM_BOT_TOKEN` (required when Telegram enabled) - Telegram bot token from BotFather
- `HIVE_RELAY_TELEGRAM_CHAT_ID` (required when Telegram enabled) - destination chat ID (for Rakis, set Rakis chat ID)
- `HIVE_RELAY_TELEGRAM_RATE_LIMIT_MS` (optional, default `30000`) - minimum delay between Telegram messages (`0` disables)

## Setup

1) Start Hive.

2) Start the local relay with the shared secret.

   - If you want Telegram notifications, create a bot token via BotFather and capture the destination chat ID.
   - Set `HIVE_RELAY_TELEGRAM_ENABLED=true` plus token + chat ID env vars.

3) Create a Hive webhook subscription pointing to the relay URL using the same secret.

## Sample Launch Command

```bash
HIVE_RELAY_SHARED_SECRET="replace-with-strong-secret" \
HIVE_RELAY_PORT=8787 \
HIVE_RELAY_DEDUP_WINDOW_MS=120000 \
HIVE_RELAY_THROTTLE_MS=5000 \
HIVE_RELAY_TELEGRAM_ENABLED=true \
HIVE_RELAY_TELEGRAM_BOT_TOKEN="123456789:replace-with-bot-token" \
HIVE_RELAY_TELEGRAM_CHAT_ID="-1001234567890" \
HIVE_RELAY_TELEGRAM_RATE_LIMIT_MS=30000 \
HIVE_RELAY_LOG_PATH="./webhook-events.log" \
bun run relay:openclaw
```

## Example Telegram Output

When enabled, task events produce concise notifications like:

```text
Hive task update: task=mention-42 agent=builder status=completed room=ops summary=response posted to room
Hive task update: task=mention-43 agent=tester status=failed room=ops summary=exit 1
```

If Telegram delivery fails, the relay still wakes OpenClaw and returns success for the webhook path (failure is logged for debugging).

## Quick Log Verification (`tail -f`)

1) Start the relay with `HIVE_RELAY_LOG_PATH` set.
2) In another terminal, stream logs:

```bash
tail -f ./webhook-events.log
```

3) Trigger a Hive event (for example, post a task mention).
4) Confirm one line appears per webhook event with `eventId`, `type`, `timestamp`, `signatureVerified`, `action`, `command`, `exitCode`, `telegram`, and `telegramCode`.

## Example Webhook Subscription

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

## Running Tests

```bash
bun test tests/openclaw-relay.test.ts
```
