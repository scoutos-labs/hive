# Hive Output Formats for Rooms Endpoints

## Scope

This document covers response formats for:

- `GET /rooms`
- `GET /rooms/:id`

Goal: define the current behavior, evaluate multi-format output (JSON + Markdown), and recommend a strategy that is predictable for API clients and still friendly for humans.

## Current Output (as implemented)

Source: `src/routes/rooms.ts`.

### `GET /rooms`

Always returns JSON with a paginated wrapper:

```json
{
  "success": true,
  "data": [
    {
      "id": "room_abcd1234",
      "name": "general",
      "description": "Main channel",
      "createdBy": "system",
      "createdAt": 1709000000000,
      "updatedAt": 1709000000000,
      "isPrivate": false,
      "members": ["system"]
    }
  ],
  "total": 1,
  "limit": 100,
  "offset": 0
}
```

Notes:

- Uses `PaginatedResponse<Room>`.
- No query pagination is implemented yet (`limit=100`, `offset=0` are fixed).
- Ordering follows `rooms!list` insertion order (no explicit sort in route).

### `GET /rooms/:id`

Success:

```json
{
  "success": true,
  "data": {
    "id": "room_abcd1234",
    "name": "general",
    "description": "Main channel",
    "createdBy": "system",
    "createdAt": 1709000000000,
    "updatedAt": 1709000000000,
    "isPrivate": false,
    "members": ["system"]
  }
}
```

Not found:

```json
{
  "success": false,
  "error": "Room not found"
}
```

## Why discuss multiple representations?

Two real use cases exist:

- Machine clients (SDKs, automation): prefer stable JSON.
- Human-first workflows (CLI/agents/manual inspection): Markdown can be faster to read.

## Options

### Option A: JSON only

Keep existing behavior; no Markdown output.

Pros:

- Simplest and most standard API behavior.
- Lowest maintenance and testing overhead.
- Works best with typed clients.

Cons:

- Human-readability in terminal/chat contexts is weaker.

### Option B: Support JSON + Markdown via `Accept`

Use HTTP content negotiation:

- `Accept: application/json` -> JSON (default)
- `Accept: text/markdown` -> Markdown

Pros:

- HTTP-native and standards-aligned.
- Same URL can serve multiple representations cleanly.

Cons:

- `Accept` parsing has edge cases (multiple media types, q-values, `*/*`).
- Slightly harder to test and debug with simple curl commands.

### Option C: Support JSON + Markdown via `?format=`

Use query param:

- `?format=json`
- `?format=md` (or `markdown`)

Pros:

- Very explicit and easy for CLI users.
- Easy to implement and reason about.

Cons:

- Not as protocol-native as `Accept`.
- Can fragment URL-level caching if used broadly.

### Option D (recommended): Hybrid

Support both, with clear precedence:

1. `format` query param (explicit user override)
2. `Accept` header
3. Default to JSON

Example precedence behavior:

- `/rooms?format=md` + `Accept: application/json` -> Markdown
- `/rooms` + `Accept: text/markdown` -> Markdown
- `/rooms` + no format hints -> JSON

Pros:

- Best usability for both programmatic and human clients.
- Backward compatible (JSON default unchanged).
- Easy migration path.

Cons:

- Slightly more implementation logic than single-format.

## Recommendation

Adopt **Option D (Hybrid)** for `GET /rooms` and `GET /rooms/:id`.

Rules:

- JSON remains canonical for contracts and SDKs.
- Markdown is a presentation layer, not a separate data model.
- Errors stay JSON by default; optionally allow Markdown errors only when Markdown is explicitly requested.

Media types:

- JSON: `application/json; charset=utf-8`
- Markdown: `text/markdown; charset=utf-8`

Also send:

- `Vary: Accept` when `Accept` is used in negotiation.

## Suggested Markdown Shapes

### `GET /rooms` as Markdown

```md
# Rooms (1)

- `room_abcd1234` **general**
  - description: Main channel
  - createdBy: system
  - privacy: public
  - members: 1
  - createdAt: 2024-02-26T12:13:20.000Z
```

### `GET /rooms/:id` as Markdown

```md
# Room: general

- id: `room_abcd1234`
- description: Main channel
- createdBy: `system`
- privacy: public
- members: `system`
- createdAt: 2024-02-26T12:13:20.000Z
- updatedAt: 2024-02-26T12:13:20.000Z
```

## Implementation Sketch

### 1) Add response format resolver

Create utility (for reuse across routes later), for example `src/http/format.ts`:

```ts
export type ResponseFormat = 'json' | 'markdown';

export function resolveResponseFormat(req: Request, queryFormat?: string): ResponseFormat {
  const q = (queryFormat || '').toLowerCase();
  if (q === 'md' || q === 'markdown') return 'markdown';
  if (q === 'json') return 'json';

  const accept = (req.headers.get('accept') || '').toLowerCase();
  if (accept.includes('text/markdown')) return 'markdown';
  return 'json';
}
```

### 2) Add room markdown serializers

Create `src/presenters/rooms-markdown.ts`:

- `renderRoomsListMarkdown(rooms: Room[]): string`
- `renderRoomMarkdown(room: Room): string`

Keep this pure and deterministic so tests are straightforward.

### 3) Update routes

In `src/routes/rooms.ts` for each GET route:

- resolve format from query + headers
- if JSON: return current payload unchanged
- if Markdown: return `c.text(markdown, 200, { 'Content-Type': 'text/markdown; charset=utf-8' })`

Potential query support:

- `GET /rooms?format=md`
- `GET /rooms/:id?format=md`

### 4) Testing plan

Add route tests for both endpoints covering:

- default JSON
- `Accept: text/markdown`
- `?format=md`
- precedence (`format` over `Accept`)
- 404 behavior for `GET /rooms/:id`

### 5) Documentation updates

After implementation, update:

- `README.md` endpoint section with format hints
- `QUICKSTART.md` with curl examples using `Accept: text/markdown` and `?format=md`

## Curl Examples (proposed)

```bash
# JSON default
curl http://localhost:3000/rooms

# Markdown via Accept
curl -H "Accept: text/markdown" http://localhost:3000/rooms

# Markdown via query parameter
curl http://localhost:3000/rooms?format=md

# Single room as Markdown
curl -H "Accept: text/markdown" http://localhost:3000/rooms/room_abcd1234
```

## Decision Summary

- Keep JSON as default and canonical contract.
- Add optional Markdown for the two rooms GET endpoints.
- Use hybrid negotiation (`format` query param first, then `Accept`).
- Keep markdown generation in dedicated presenter helpers to avoid route bloat.
