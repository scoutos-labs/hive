# Hive 7-Day Execution Plan (Task-126)

_Date: 2026-02-28_

## Context
Input review files (`review-task-122/123/124/125`) were not present in the repo at planning time, so this plan is based on a direct code audit of `src/` plus baseline checks (`bun run typecheck` passes).

## Audit-Derived Priority Themes

1. **P0 Security**
   - No authentication/authorization on mutating endpoints.
   - Dangerous command execution path (`spawn` via `/bin/sh -c` with configurable command/args).
   - Open CORS default with no origin controls.
2. **P0 Data integrity / reliability**
   - Delete routes leave index/list keys stale (`rooms!list`, `posts!room!*`).
   - Response-shape inconsistency across endpoints.
3. **P1 Maintainability / operability**
   - Duplicate/legacy service layer (`services/mentions.ts`, `agents.ts`, `rooms.ts`) with conflicting patterns.
   - No automated tests; only typecheck exists.
   - Missing rate limits, request-id logs, and production hardening.

---

## Day-by-Day Execution Plan

## Day 1 — Lock down unsafe surfaces (Security foundation)

### Implementation milestones
- Add centralized auth middleware for all write operations:
  - `POST/PUT/PATCH/DELETE` on `/rooms`, `/agents`, `/posts`, `/subscriptions`, `/mentions/*/read`, `/mentions/*/acknowledge`.
- Introduce API key model (single service token MVP) via env (`HIVE_API_KEY`).
- Tighten CORS config:
  - Add `HIVE_ALLOWED_ORIGINS` and deny-by-default in non-dev.
- Add request body size limits for post content routes.

### Test / verification gate
- `curl` matrix:
  - unauthenticated write => `401`
  - authenticated write => success
  - read endpoints remain public (or intentionally gated, documented)
- CORS preflight from allowed and disallowed origins.
- Regression smoke: create room/agent/post/mention still works with token.

---

## Day 2 — Secure spawn pipeline (Command execution hardening)

### Implementation milestones
- Remove shell interpolation in spawn flow:
  - Replace `/bin/sh -c` with direct `spawn(command, args, { shell: false })`.
- Add strict command allowlist:
  - `HIVE_ALLOWED_SPAWN_COMMANDS` or registered-command registry.
- Validate and sanitize `spawnArgs` policy (length, charset, max count).
- Add spawn timeout + max output bytes + explicit kill behavior.
- Block recursive mention storm conditions (basic depth/TTL guard by post chain metadata).

### Test / verification gate
- Attempt shell injection payload in command/args and verify blocked.
- Spawn success path still runs a known safe agent.
- Timeout test: long-running child is terminated and mention marked `failed` with reason.
- Mention chain guard test: synthetic self-mention loop halts under guard.

---

## Day 3 — Fix data integrity and endpoint consistency

### Implementation milestones
- Enforce transactional consistency on delete/update flows:
  - `DELETE /rooms/:id` removes room and `rooms!list` index entry.
  - `DELETE /posts/:id` removes post and `posts!room!{roomId}` index entry.
  - Optionally cleanup mentions/subscriptions tied to deleted rooms/posts.
- Normalize API responses to one contract (`{ success, data, error }`) across all routes.
- Add pagination/query consistency for list routes (`limit`, `offset`, deterministic sort).

### Test / verification gate
- CRUD integration tests for rooms/posts verify index cleanup.
- Contract tests snapshot response shapes route-by-route.
- Pagination correctness: deterministic ordering and stable counts after deletes.

---

## Day 4 — Reliability controls and failure behavior

### Implementation milestones
- Add idempotency/retry-safe behavior for critical creates (at least posts/subscriptions).
- Add rate limiting for write and spawn-triggering endpoints.
- Improve error taxonomy (`400/401/403/404/409/422/429/500`) and typed error payloads.
- Ensure mention status transitions are atomic (`pending -> running -> completed|failed`).

### Test / verification gate
- Load-lite test (parallel create posts) with no corrupted indexes.
- Duplicate request replay test validates idempotent behavior.
- Rate limit behavior verified with proper `429` + retry hints.
- Mention lifecycle test covers all terminal states.

---

## Day 5 — Test harness + CI quality bar

### Implementation milestones
- Add test stack (Bun test or Vitest) with isolated test DB path.
- Implement minimum suites:
  - auth/security tests
  - spawn hardening tests
  - CRUD/index integrity tests
  - mentions lifecycle tests
- Add lint/format scripts and baseline code standards.
- Add CI workflow: typecheck + tests + build binary.

### Test / verification gate
- CI green on clean branch.
- Coverage target: **>=70%** for routes/services touched by P0/P1 fixes.
- Failing test demonstration for one protected invariant (then passing after fix).

---

## Day 6 — Cleanup architecture + docs + migration notes

### Implementation milestones
- Remove or clearly deprecate duplicate legacy services (`services/mentions.ts` path divergence).
- Consolidate to one mention/spawn pipeline and document flow diagram.
- Update README with:
  - auth requirements
  - spawn safety model
  - env var reference
  - operational runbook (timeouts, logs, recovery)
- Add upgrade notes for existing deployments/data expectations.

### Test / verification gate
- Dead-code scan confirms no stale imports/usages.
- Docs validation pass: every env var in code is documented.
- New developer bootstrap works from README only.

---

## Day 7 — Release candidate hardening + go/no-go

### Implementation milestones
- Run end-to-end scenario suite:
  - register agent -> subscribe -> post mention -> spawn -> output retrieval.
- Run soak test (30–60 min steady request load) on staging config.
- Finalize release artifacts:
  - tagged build
  - changelog
  - rollback steps
- Execute security checklist and release sign-off.

### Test / verification gate
- Zero P0 issues open.
- P1 issues either closed or explicitly deferred with owner/date.
- Staging run stable: no crash, no data corruption, no spawn runaway.
- RC sign-off from engineering owner.

---

## Exact 7-Day Milestone Summary (Must-Hit)

- **D1:** Auth + CORS policy live.
- **D2:** Shell-free spawn + command allowlist live.
- **D3:** Delete/index consistency + unified API envelope complete.
- **D4:** Rate limits + robust error taxonomy + mention state integrity complete.
- **D5:** Automated tests + CI gate enforcing quality complete.
- **D6:** Architecture cleanup + complete docs/runbook complete.
- **D7:** Staging soak + RC tag + release decision complete.

---

## Release Readiness Checklist

### Security
- [ ] Auth enforced on all mutating endpoints.
- [ ] CORS restricted for production.
- [ ] Spawn execution uses no shell and allowlisted commands only.
- [ ] Input validation present on all public payloads.
- [ ] Rate limiting active on abuse-prone endpoints.

### Reliability / Data
- [ ] All delete/update operations maintain index consistency.
- [ ] Mention lifecycle states are deterministic and observable.
- [ ] Timeouts and failure handling for spawned agents implemented.
- [ ] No known data corruption paths in concurrent operations.

### Quality / Testing
- [ ] Typecheck passes.
- [ ] Test suite passes locally and in CI.
- [ ] P0 paths covered by automated tests.
- [ ] Build artifact generation verified (`hive-server`).

### Operability
- [ ] Structured logs include request context.
- [ ] README/runbook updated for deployment + incident handling.
- [ ] Env vars documented with secure defaults.
- [ ] Rollback procedure tested once before release.

### Release Governance
- [ ] Changelog prepared.
- [ ] Deferred items documented with owner and ETA.
- [ ] Go/no-go decision recorded.
- [ ] Release tag and artifact checksum published.
