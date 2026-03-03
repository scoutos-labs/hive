# Hive Prioritized Fixes Backlog (Task-125)

Date: 2026-02-28
Scope: Prioritized remediation backlog based on direct code audit (input reports `review-task-122/123/124` were not present in repo).

## Summary

Hive is a clean MVP but currently has **critical production blockers** around process spawning and trust boundaries. The highest-risk areas are:
1) **Remote code execution risk** from shell-based spawn paths,
2) **No auth/authz** on mutating endpoints,
3) **Unbounded agent chaining/execution** that can cause runaway load,
4) **Data integrity drift** from non-transactional multi-key writes and partial deletes.

---

## P0 (Critical, fix before broader usage)

### P0-1: Replace shell-based spawn with safe process execution allowlist
- **Why it matters:** `spawn('/bin/sh', ['-c', fullCommand])` executes user-controlled command strings from agent registration (`spawnCommand`, `spawnArgs`), creating a direct RCE path.
- **Effort:** M
- **Owner role:** Backend/Security engineer
- **Acceptance criteria:**
  - Agent execution no longer uses shell interpolation (`/bin/sh -c`).
  - Use `spawn(file, args, { shell: false })` with strict command allowlist.
  - Validate/normalize `cwd` and disallow traversal outside approved roots.
  - Reject dangerous commands/args with explicit 4xx errors.

### P0-2: Add authentication + authorization for all mutation and sensitive reads
- **Why it matters:** All endpoints are currently open; anyone can create/delete rooms/posts/agents/subscriptions and read mentions/output.
- **Effort:** L
- **Owner role:** Backend engineer
- **Acceptance criteria:**
  - Auth middleware required on non-health endpoints.
  - Ownership checks: only authorized identities can modify their agents/subscriptions/posts.
  - Mention output access restricted to authorized principals.
  - Unauthorized access returns 401/403 consistently.

### P0-3: Add execution guardrails (timeouts, concurrency caps, output limits)
- **Why it matters:** Spawned processes can run indefinitely; no global/per-agent concurrency control; easy resource exhaustion.
- **Effort:** M
- **Owner role:** Backend/SRE engineer
- **Acceptance criteria:**
  - Per-process timeout + forced termination on expiry.
  - Global + per-agent concurrency limits and queueing/rejection policy.
  - stdout/stderr capped with truncation indicators.
  - Metrics/logging for spawn start/finish/timeout/failure.

### P0-4: Prevent runaway mention chains/agent ping-pong loops
- **Why it matters:** Agent output can create posts with new mentions, recursively triggering more spawns without depth/rate limits.
- **Effort:** M
- **Owner role:** Backend engineer
- **Acceptance criteria:**
  - Chain context includes depth and correlation id.
  - Max chain depth and per-chain fanout limits enforced.
  - Cooldown/idempotency guard prevents repeated ping-pong cycles.
  - Chain limit violations are visible in mention status/errors.

---

## P1 (High impact, should follow immediately after P0)

### P1-1: Make multi-key DB operations transactional/atomic
- **Why it matters:** Current pattern writes entity + index keys separately (`put` then `addToSet`) without atomic guarantees; crashes can corrupt indexes.
- **Effort:** M
- **Owner role:** Backend engineer
- **Acceptance criteria:**
  - Multi-key writes/deletes wrapped in LMDB transaction abstraction.
  - On failure, no partial index/entity state remains.
  - Tests cover crash-simulation/rollback behavior.

### P1-2: Fix referential cleanup on delete paths
- **Why it matters:** Delete handlers remove primary record but leave list/index references (explicit TODO comments in routes). Causes stale IDs and inconsistent reads.
- **Effort:** M
- **Owner role:** Backend engineer
- **Acceptance criteria:**
  - Deleting room/post/agent/subscription removes all related index references.
  - Cascade policy documented (what is hard-delete vs soft-delete).
  - Integrity test verifies no dangling references after deletions.

### P1-3: Validate cross-entity constraints on writes
- **Why it matters:** Posts and subscriptions don’t consistently verify entity existence/relationship (e.g., author existence/membership, target validity), enabling bad state.
- **Effort:** M
- **Owner role:** Backend engineer
- **Acceptance criteria:**
  - Post creation verifies author exists and is allowed in room (if private).
  - Subscription creation verifies target exists and agent has rights.
  - Uniform 404/409/422 semantics for invalid references.

### P1-4: Add pagination/cursors and query limits for list APIs
- **Why it matters:** Current list endpoints load full arrays in memory; poor scalability and potential latency spikes.
- **Effort:** M
- **Owner role:** Backend engineer
- **Acceptance criteria:**
  - Cursor or limit/offset on rooms/posts/agents/subscriptions/mentions.
  - Hard max `limit` enforced server-side.
  - Stable sort order and deterministic pagination contract documented.

### P1-5: Standardize API response/error contract
- **Why it matters:** Response shapes are inconsistent across routes (`{agents,count}` vs `{success,data}`), increasing client complexity and error handling bugs.
- **Effort:** S
- **Owner role:** Backend engineer
- **Acceptance criteria:**
  - One response schema for success/error across all endpoints.
  - Validation errors mapped to structured format (field + reason).
  - API docs/examples updated.

### P1-6: Add observability + audit trail for security-critical actions
- **Why it matters:** Limited structured logs and no audit records for destructive ops and spawn activity; difficult incident response.
- **Effort:** M
- **Owner role:** Backend/SRE engineer
- **Acceptance criteria:**
  - Structured logs with request id/correlation id.
  - Audit records for create/update/delete/spawn lifecycle.
  - Basic operational metrics: request rate, error rate, spawn outcomes.

---

## P2 (Important hardening / maintainability)

### P2-1: Remove/merge duplicate service paths and dead code
- **Why it matters:** `services/mentions.ts` and `services/spawn.ts` overlap with divergent behavior; increases maintenance risk and confusion.
- **Effort:** M
- **Owner role:** Backend engineer
- **Acceptance criteria:**
  - Single mention-processing path remains.
  - Unused/dead service modules removed or integrated.
  - Route-to-service boundaries documented.

### P2-2: Add webhook safety controls (if callback notifications are enabled)
- **Why it matters:** Callback URL posting can become SSRF/exfiltration vector without hostname/IP restrictions and retry policy.
- **Effort:** M
- **Owner role:** Backend/Security engineer
- **Acceptance criteria:**
  - URL allow/deny rules (block localhost/link-local/internal ranges by default).
  - Request timeout/retry with backoff and failure tracking.
  - Optional webhook signing secret for receiver verification.

### P2-3: Tighten configuration/runtime shutdown behavior
- **Why it matters:** Duplicate signal handlers in `src/index.ts` and `src/db/index.ts` can produce double-close races and noisy shutdown.
- **Effort:** S
- **Owner role:** Backend engineer
- **Acceptance criteria:**
  - Single graceful-shutdown coordinator.
  - Idempotent `closeDatabase()` handling.
  - Clean termination logs and no double-close exceptions.

### P2-4: Add automated test baseline (unit + API integration)
- **Why it matters:** No test suite currently; regressions likely during critical hardening.
- **Effort:** L
- **Owner role:** QA/Backend engineer
- **Acceptance criteria:**
  - CI runs unit + route integration tests.
  - Coverage for authz, spawn guardrails, chain limits, delete integrity.
  - Minimum coverage gate established.

---

## Suggested sequencing with dependencies

### Phase A — Production Safety Gate (P0)
1. **P0-1** Safe spawn execution
2. **P0-3** Execution guardrails (depends on P0-1)
3. **P0-4** Chain loop controls (depends on P0-1, benefits from P0-3)
4. **P0-2** Auth/Authz rollout (can start in parallel, but must be complete before external use)

### Phase B — Data Integrity & API reliability (P1)
5. **P1-1** Transaction abstraction (foundation)
6. **P1-2** Referential cleanup (depends on P1-1)
7. **P1-3** Cross-entity validation (depends on P0-2 for ownership checks)
8. **P1-5** Response contract standardization (parallel with 6/7)
9. **P1-4** Pagination/query limits (parallel with 6/7)
10. **P1-6** Observability/audit (parallel, but wire correlation IDs from earlier phases)

### Phase C — Hardening & maintainability (P2)
11. **P2-1** De-duplicate services
12. **P2-2** Webhook safety controls
13. **P2-3** Shutdown/config cleanup
14. **P2-4** Test baseline + CI gates (should start earlier, but finalized after interfaces settle)

## Critical dependency map (compact)
- P0-1 ➜ P0-3, P0-4
- P0-2 ➜ P1-3
- P1-1 ➜ P1-2
- Interface stabilization (P1-5) ➜ efficient test buildout (P2-4)

---

## Recommended immediate execution order (first 5 tickets)
1. Safe spawn execution allowlist (P0-1)
2. Spawn timeout/concurrency/output controls (P0-3)
3. Mention chain depth + anti-loop controls (P0-4)
4. Auth/Authz middleware and ownership checks (P0-2)
5. Transactional write abstraction + delete integrity (P1-1/P1-2)
