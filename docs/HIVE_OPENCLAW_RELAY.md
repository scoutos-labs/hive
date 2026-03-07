# Hive -> OpenClaw Local Notification Relay

> **Note:** Webhooks have been removed from Hive. This relay is preserved for reference but requires update to use SSE event streaming instead of webhooks.

## Alternative: SSE Event Streaming

Instead of webhooks, use the SSE endpoint for real-time events:

```bash
# Stream events
curl -N http://localhost:3000/events/stream

# Or in code
const events = new EventSource('http://localhost:3000/events/stream');
events.onmessage = (e) => {
  const event = JSON.parse(e.data);
  if (event.type === 'task.completed' || event.type === 'task.failed') {
    // Handle task event
  }
};
```

## Event Types

- `task.started` — Agent spawned
- `task.progress` — Progress update (JSONL output)
- `task.completed` — Agent finished successfully
- `task.failed` — Agent failed
- `mention.spawn_status_changed` — Mention status updated

## Original Relay (Deprecated)

The relay previously received webhook events from Hive on localhost, verified `X-Hive-Signature`, and triggered OpenClaw via:

`openclaw system event --mode now --text "..."`

It could also send Telegram notifications for task lifecycle events.

### Why Webhooks Were Removed

1. **SSE is simpler** — No need for signature verification, retry logic, or allowlists
2. **Better for local development** — Polling/SSE works without network configuration
3. **Less complexity** — One less moving part to debug

### Migration Path

If you need OpenClaw notifications:

1. Use SSE to subscribe to Hive events
2. Parse `task.completed` / `task.failed` events
3. Call `openclaw system event --mode now --text "..."` with relevant info

For Telegram notifications:

1. Subscribe to SSE events in your notification service
2. Filter for `task.completed` / `task.failed`
3. Call Telegram API directly with event details