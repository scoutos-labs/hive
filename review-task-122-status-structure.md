# Hive Audit — Status & Structure (task-122)

Date: 2026-02-28
Project: `/Users/mastercontrol/.openclaw/workspace/hive`

## 1) Repo snapshot

### Top-level
- Runtime/build: `package.json`, `tsconfig.json`, `bun.lock`
- Docs/spec: `README.md`, `PRD.md`, `QUICKSTART.md`
- App source: `src/`
- Data: `data/hive.db` (LMDB files present)
- Build artifact: `hive-server` (compiled Bun binary)

### Source layout
- `src/index.ts` — Hono app bootstrap, middleware, route mounting, health endpoints, shutdown hooks
- `src/db/index.ts` — LMDB connection, key helpers, ID generation, collection helpers
- `src/routes/`
  - `rooms.ts`
  - `agents.ts`
  - `posts.ts`
  - `subscriptions.ts`
  - `mentions.ts`
- `src/services/`
  - `spawn.ts` (active mention-processing + process spawn + output capture)
  - `notifications.ts` (webhook notifier)
  - `agents.ts`, `rooms.ts`, `mentions.ts` (service-layer utilities; some overlap/legacy)
- `src/types.ts` — shared TS interfaces

### Architecture map (current)
1. HTTP requests enter via Hono (`src/index.ts`) and route to feature routers.
2. Routers validate input (mostly with `zod`) and perform LMDB reads/writes using key patterns from `src/db/index.ts`.
3. Post creation path (`POST /posts`) extracts `@mentions` and calls `processMentions` from `src/services/spawn.ts`.
4. Mention flow in `spawn.ts`:
   - create mention records
   - verify room subscription
   - spawn agent process (`child_process.spawn('/bin/sh', ['-c', ...])`)
   - store spawn status/output back on mention records
   - if output contains mentions, auto-create response post (chain behavior)
5. Mention/agent/subscription data is stored denormalized via ID-list keys.

---

## 2) Build / test / typecheck status

Executed in `/Users/mastercontrol/.openclaw/workspace/hive`:

```bash
bun run typecheck
bun run build
bun run test
```

### Outcomes
- `bun run typecheck` → **PASS** (exit 0)
- `bun run build` → **PASS** (exit 0), compiled `hive-server`
- `bun run test` → **FAIL** (exit 1), no `test` script defined
  - Bun output: `note: a package.json script "test" was not found`

Environment used:
- `node v25.6.1`
- `bun 1.3.9`

---

## 3) Dependency risk scan

Commands run:
```bash
bun outdated
bun audit
npm audit --omit=dev --audit-level=high --json
```

### Findings
- `bun audit` → **No vulnerabilities found**.
- `npm audit` could not run due missing `package-lock.json` in this repo (`ENOLOCK`) — expected for Bun-first projects.
- Version drift (current vs latest from npm registry):
  - `hono`: `^4.7.0` → latest `4.12.3`
  - `lmdb`: `^3.1.0` → latest `3.5.1`
  - `zod`: `^4.3.6` → latest `4.3.6` (up to date)
  - `typescript`: `^5.7.0` → latest `5.9.3`
  - `@types/bun`: `latest` → latest `1.3.9`

Risk notes:
- No known vuln flagged by Bun audit at time of scan.
- `lmdb` is a native dependency; updates should be tested on target OS/arch before bumping.

---

## 4) Immediate blockers and unknowns

### Immediate blockers
1. **No test harness/script** (`bun run test` fails by definition), so runtime behavior is unverified beyond compile/typecheck.
2. **Working tree not clean**: `src/services/spawn.ts` is modified (uncommitted), so baseline is in-flight.
3. **Data integrity gaps in delete flows** noted in code comments:
   - deleting room/post does not fully clean index/list keys.
4. **Service duplication/drift risk**:
   - mention logic exists in both `src/services/spawn.ts` and `src/services/mentions.ts`; only one appears active in route flow.

### Unknowns
1. Intended canonical service layer (routes currently do direct DB access heavily).
2. Intended API contract shape consistency (some routes return `{success,data}`, others raw objects).
3. Whether mention-chain recursion should have loop protection/rate limits.
4. Deployment expectation for compiled binary path (`README` references `./dist/hive`, build outputs `./hive-server`).

---

## 5) Recommendations (max 10)

1. Add minimal test script + smoke tests for core routes (`rooms/agents/posts/mentions`).
2. Introduce integration tests for mention spawn lifecycle (pending/running/completed/failed).
3. Clean up stale/duplicate service paths (pick one mention-processing implementation).
4. Normalize API response schema across all endpoints.
5. Fix delete/index consistency (remove IDs from list keys atomically).
6. Add safeguards for spawn chains (depth/loop/volume limits).
7. Align docs/build output paths (`README` vs actual `hive-server`).
8. Add linting + strict TS checks in CI (`noUnusedLocals`, etc.) for drift detection.
9. Plan dependency refresh for `hono`, `lmdb`, `typescript` with regression pass.
10. Define baseline operational checks (health + DB path + startup config) and document production runbook.

---

## Quick status verdict

**Current state: buildable and type-safe, but not test-backed; architecture is understandable yet partially duplicated, with notable operational/data-integrity follow-ups before calling it production-ready.**
