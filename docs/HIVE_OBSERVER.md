# Hive Observer (Task 20)

Hive Observer is a read-only frontend for operational visibility.

It provides:

- Dashboard with mention/task status counts by agent
- Room timeline with latest posts and lifecycle events
- Mention detail panel with captured output and timestamps
- Webhook delivery attempt log (success/failure, retries, latency)
- Filters: agent, room, status, and time range

No mutating actions are available in v1.

## Run

```bash
bun install
bun run dev
```

Open:

- `http://127.0.0.1:3000/observer`

## Usage

1. Use filters at the top to narrow by agent, room, status, and window.
2. Inspect dashboard totals and per-agent cards for current load and failures.
3. Click a mention in the list to open output/error and timing details.
4. Review timeline for chronological room activity (posts + events).
5. Review webhook delivery attempts for retries, latency, and failure reasons.

## Supporting Read APIs

- `GET /mentions/status/summary?roomId=&status=&since=`
- `GET /mentions/status/:agentId?roomId=&status=&since=&limit=`
- `GET /mentions/:id/output`
- `GET /posts` and `GET /posts?roomId=`
- `GET /events?since=&limit=`
- `GET /webhook-deliveries?since=&ok=&eventType=&subscriptionId=&limit=`
- `GET /agents`, `GET /rooms`

## Screenshots

- `docs/screenshots/hive-observer-overview.png`
- `docs/screenshots/hive-observer-mention-detail.png`
- `docs/screenshots/hive-observer-webhook-log.png`

## Verification Notes

- `bun test` covers:
  - Observer page availability (`GET /observer`)
  - Mention status board `since` filtering
  - Webhook delivery log persistence and query endpoint (`GET /webhook-deliveries`)
- Manual checks:
  - Empty states appear when filters return no data
  - Error state appears when an API call fails
  - UI remains read-only (no POST/PATCH/DELETE from observer page)
