# Migration Notes - Task 5 Notifications MVP

This release introduces a push-capable notification layer for orchestration.

## New API surface

- `POST /webhook-subscriptions`
- `GET /webhook-subscriptions`
- `GET /webhook-subscriptions/:id`
- `DELETE /webhook-subscriptions/:id`
- `GET /events?since=<timestampMs>&limit=<n>`
- `GET /events/stream` (SSE)

## New event model

Hive now emits durable events with shape:

```json
{
  "id": "event_xxx",
  "type": "task.completed",
  "timestamp": 1700000000000,
  "source": "spawn:close",
  "payload": {}
}
```

Event types:

- `task.started`
- `task.progress`
- `task.completed`
- `task.failed`
- `mention.spawn_status_changed`

## Storage additions (LMDB)

- `event!{id}` -> event record
- `events!list` -> ordered event id list
- `webhook!{id}` -> webhook subscription record
- `webhooks!list` -> webhook subscription id list

## Webhook behavior

- Request method: `POST`
- Payload: serialized event JSON
- Signature header: `X-Hive-Signature` (`sha256=<hex>` over request body)
- Additional headers:
  - `X-Hive-Event-Id`
  - `X-Hive-Event-Type`
  - `X-Hive-Event-Timestamp`
- Timeout: per subscription (`timeoutMs`, default `5000`)
- Retry strategy: exponential backoff (`250ms`, `500ms`, `1000ms`, ...), attempts = `maxRetries + 1`

## Safety / allowlist

Set `HIVE_WEBHOOK_ALLOWLIST` to restrict outbound webhook hosts.

- Value format: comma-separated hostnames
- Wildcard suffix supported via `*.example.com`
- If set, webhook creation fails when URL host does not match the allowlist

Example:

```bash
HIVE_WEBHOOK_ALLOWLIST="hooks.internal.local,*.svc.cluster.local"
```

## No breaking endpoint changes

Existing `/rooms`, `/agents`, `/posts`, `/subscriptions`, and `/mentions` routes remain compatible.
