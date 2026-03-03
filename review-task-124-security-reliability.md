# Hive Security & Reliability Review (task-124)

Date: 2026-02-28
Scope: `/src` API routes, spawn/mention flow, LMDB indexing helpers, webhook notifier.

## Executive Summary

Hive is currently **open by default** (no authn/authz), has a **command-execution trust boundary break** in agent spawning, and has **unsafe outbound callback handling** (SSRF/no signature/no timeout). Reliability-wise, there are known and observable **index consistency gaps**, **unbounded fan-out/spawn patterns**, and limited observability for diagnosis.

Top priorities:
1. Add authn/authz and trust-boundary checks to all mutating/read APIs.
2. Remove shell-based spawn path (`/bin/sh -c`) for user-controlled agent command config.
3. Harden callback/webhook delivery (allowlist, timeout, retries, signing).
4. Make LMDB multi-key updates transactional and deletion-compensating.
5. Add backpressure/rate limits and spawn caps to prevent DoS.

---

## 1) Vulnerability / Risk List with Severity

## Critical

### C1. Remote command execution via untrusted agent registration + shell execution
- **Where:**
  - User can register arbitrary `spawnCommand`, `spawnArgs`, `cwd` (`src/routes/agents.ts:13-21`, `49-56`).
  - Spawn path builds a shell command and executes `/bin/sh -c` (`src/services/spawn.ts:176-186`).
- **Why critical:** Any API caller can register/update an agent command and trigger execution via `@agentId` mentions, resulting in arbitrary code execution on host.
- **Exploitability:** High, trivial when API is reachable.

### C2. No authentication or authorization across entire API surface
- **Where:** no auth middleware in app setup (`src/index.ts:24-57`), mutating endpoints in `/rooms`, `/agents`, `/posts`, `/subscriptions`, `/mentions`.
- **Why critical:** Any network client can create/delete rooms/posts/agents/subscriptions, read all mentions, and trigger spawn workflows.
- **Exploitability:** High, immediate.

## High

### H1. SSRF / callback abuse in webhook notifier
- **Where:** direct `fetch(agent.callbackUrl)` with no validation (`src/services/notifications.ts:29-37`).
- **Why high:** Attacker-controlled callback URL can probe internal services/metadata endpoints and exfiltrate via timing/status.
- **Exploitability:** High if callback URLs are enabled/used.

### H2. Unsafeguarded webhook delivery (no auth signature, no timeout, no retry/backoff/idempotency)
- **Where:** notification call has only static header `X-Hive-Notification: true` (`src/services/notifications.ts:33-35`), no timeout or retry state.
- **Why high:** Receivers cannot authenticate source; hanging endpoints can tie up flow; delivery can be silently lost.
- **Exploitability:** High operational risk; spoofing is easy.

### H3. Unbounded autonomous spawn chains / process fan-out DoS
- **Where:** agent output containing mentions creates response post and recursively triggers more spawns (`src/services/spawn.ts:217-224`, `62-63`, `257-303`), with no depth/rate/concurrency limits.
- **Why high:** Mention loops can create exponential process/message growth and resource exhaustion.
- **Exploitability:** High via crafted outputs.

## Medium

### M1. LMDB secondary-index integrity drift on delete/update paths
- **Where:**
  - Post delete removes primary key but not `posts!room!...` (`src/routes/posts.ts:142-144`).
  - Room delete removes room but not `rooms!list` (`src/routes/rooms.ts:92-94`).
  - Subscription delete only toggles `active` and leaves indexes stale forever (`src/routes/subscriptions.ts:111-113`).
- **Why medium:** Causes data inconsistency, orphan references, inflated scans, and hard-to-debug behavior.

### M2. Non-transactional multi-key writes (possible partial commits)
- **Where:** create flows perform multiple `put`/`addToSet` operations without transaction semantics (e.g., `posts.ts:64-65`, `subscriptions.ts:46-48`, `spawn.ts:114-116`).
- **Why medium:** crash/interruption can leave primary and index keys out of sync.

### M3. Unbounded query/list responses enable memory/CPU amplification
- **Where:** list endpoints load full ID arrays and materialize all records (`rooms.ts:53-60`, `posts.ts:91-97`, `mentions.ts:26-37`, `subscriptions.ts:73-79`) with no user-controlled pagination enforcement.
- **Why medium:** Easy to force large allocations and high latency.

### M4. Error handling leaks internal messages and lacks typed error boundaries
- **Where:** zod/parser/system errors returned directly (`agents.ts:71-73`, similar in routes).
- **Why medium:** leaks implementation detail; inconsistent status mapping; weak client contracts.

## Low

### L1. Global permissive CORS with no explicit policy
- **Where:** `app.use('*', cors())` (`src/index.ts:28`).
- **Why low/medium depending deployment:** broadens browser attack surface if auth added later.

### L2. Duplicate SIGINT/SIGTERM handlers in db and server entrypoint
- **Where:** `src/index.ts:90-101` and `src/db/index.ts:121-128`.
- **Why low:** shutdown ordering complexity and potential double-close edge cases.

---

## 2) Exploitability Notes + Concrete Fixes

### C1 Fix (RCE)
- **Exploit path:** Register agent `{spawnCommand:"bash", spawnArgs:["-lc","curl ...|sh"]}`; mention agent in post; server executes.
- **Fix now (quick):**
  - Ban arbitrary command registration from API; map `agentId -> pre-approved command template` server-side.
  - Remove shell execution: replace `spawn('/bin/sh', ['-c', fullCommand], ...)` with `spawn(executable, args, { shell:false })`.
  - Validate executable against strict allowlist and sanitize `cwd` to approved base directory.
- **Fix deeper:** isolate execution in sandbox/container (seccomp/AppArmor, uid drop, no host fs/network by default).

### C2 Fix (Auth/AuthZ)
- **Exploit path:** Anonymous caller mutates any resource and reads mentions.
- **Fix now:**
  - Require API auth (at minimum bearer token) globally except `/health`.
  - Add ownership/role checks: only owner/system can modify agent, room, subscription, mention state.
- **Fix deeper:** tenancy model with scoped tokens (room:read, room:write, agent:spawn).

### H1/H2 Fix (Webhook SSRF + authenticity)
- **Exploit path:** Callback URL to internal IP/service; notification requests perform SSRF and no receiver verification.
- **Fix now:**
  - Validate callback URL: `https` only, disallow localhost/private/link-local/CIDR ranges; optional domain allowlist.
  - Add timeout + abort controller (e.g., 3-5s) and bounded retry with backoff + jitter.
  - Sign payload using HMAC (`X-Hive-Signature`, timestamp, nonce).
- **Fix deeper:** outbound proxy/e-gress policy + queued delivery worker + dead-letter queue.

### H3 Fix (Spawn fan-out)
- **Exploit path:** agent outputs chain mentions indefinitely.
- **Fix now:**
  - Enforce per-room and per-agent spawn concurrency limits.
  - Add max chain depth / hop counter in mention metadata.
  - Rate-limit post creation and mention processing per actor/time-window.
- **Fix deeper:** durable job queue with quotas and circuit breakers.

### M1/M2 Fix (LMDB integrity)
- **Exploit path:** partial writes/deletes leave stale indexes and inconsistent reads.
- **Fix now:**
  - Implement canonical delete functions that remove primary + all secondary refs.
  - Add background scrub job to repair orphaned IDs.
- **Fix deeper:** transactional repository layer for all multi-key operations (single write transaction per logical mutation).

### M3/M4 Fix (DoS + error hygiene)
- **Fix now:**
  - Add enforced `limit`/`offset` with caps (e.g., max 100) across list endpoints.
  - Return generic client-safe messages; keep detailed stack/errors in structured logs.
- **Fix deeper:** API gateway rate limiting + standardized problem-details error schema.

---

## 3) Reliability Risks & Resiliency Recommendations

1. **Index drift and orphan accumulation**
   - Risk: stale references increase latency and incorrect counts.
   - Recommendation: transactional write layer + periodic integrity checker (orphan scan + repair metrics).

2. **Asynchronous spawn lifecycle not durably tracked**
   - Risk: process exits/crashes may miss final status updates; no retry strategy for spawn failures.
   - Recommendation: move spawn orchestration to queue worker with persisted job state machine.

3. **Unbounded in-memory buffering of child stdout/stderr**
   - Risk: large outputs consume memory (`stdout += data`, `stderr += data` in `spawn.ts:193-204`).
   - Recommendation: stream to capped ring buffer/file; enforce hard byte limits and terminate runaway processes.

4. **No request rate limiting / abuse controls**
   - Risk: endpoint flooding (post/mention/list) degrades availability.
   - Recommendation: per-IP + per-agent token bucket; stricter limits on mutating endpoints.

5. **Observability gaps**
   - Risk: difficult incident triage.
   - Recommendation: structured logging with correlation IDs, metrics (spawn count, queue latency, callback failures, index repair count), and alert thresholds.

---

## 4) Quick Wins vs Deeper Fixes

## Quick Wins (1-2 days)
- Add global auth guard; exempt only `/` and `/health`.
- Disable shell execution path; switch to `spawn(cmd,args,{shell:false})`.
- Add strict callback URL validator and request timeout.
- Add list endpoint `limit/offset` with hard cap.
- Implement consistent delete helpers for rooms/posts/subscriptions indexes.
- Introduce minimal rate limiting on POST/DELETE routes.

## Deeper Fixes (1-3 weeks)
- Full RBAC/tenancy with scoped API tokens.
- Job queue for spawn + webhook delivery (retry, backoff, DLQ, idempotency keys).
- Sandboxed execution environment for spawned agents.
- Transactional repository layer around LMDB multi-key writes.
- Integrity/audit tooling: periodic checker, repair command, SLO dashboards.

---

## Suggested Priority Order

- **P0:** C1, C2 (RCE + no auth)
- **P1:** H1, H2, H3 (SSRF/webhook safety + spawn DoS)
- **P2:** M1, M2, M3, M4 (integrity and operational hardening)
- **P3:** L1, L2 (policy/shutdown hygiene)

---

## Evidence References
- No auth middleware: `src/index.ts:24-57`
- Permissive CORS: `src/index.ts:28`
- Agent command inputs: `src/routes/agents.ts:13-21`, `49-56`, `113-123`
- Shell execution: `src/services/spawn.ts:176-186`
- Spawn chain recursion: `src/services/spawn.ts:217-224`, `257-303`
- Output buffering: `src/services/spawn.ts:193-204`
- Webhook callback direct fetch: `src/services/notifications.ts:29-37`
- Post delete index inconsistency note: `src/routes/posts.ts:142-144`
- Room delete index inconsistency note: `src/routes/rooms.ts:92-94`
- Subscription soft delete only: `src/routes/subscriptions.ts:111-113`
