# Hive auth migration path (Task 21)

This guide shows how to move from today's open local mode to authenticated mode with minimal disruption.

## Recommended defaults

- Keep local development open by default:
  - `HIVE_AUTH_ENABLED=false`
- Keep sensitive policy definitions ready:
  - `HIVE_AUTH_PROTECT_SENSITIVE=true`
  - `HIVE_AUTH_ALLOW_ANONYMOUS_READ=true`

These defaults preserve current behavior while letting you stage secure mode in non-local environments.

## Rollout phases

### Phase 0: Baseline (current local mode)

- Run with `HIVE_AUTH_ENABLED=false`
- No client changes required
- Confirm service reports auth state on `GET /`

### Phase 1: Prepare role tokens

Provision strong random tokens per role:

- `HIVE_AUTH_VIEWER_TOKEN`
- `HIVE_AUTH_OPERATOR_TOKEN`
- `HIVE_AUTH_ADMIN_TOKEN`

Store via your secret manager or runtime env injection.

### Phase 2: Enable in a staging/shared environment

Set:

- `HIVE_AUTH_ENABLED=true`
- `HIVE_AUTH_PROTECT_SENSITIVE=true`
- `HIVE_AUTH_ALLOW_ANONYMOUS_READ=true`

Validation checklist:

- Anonymous `GET /channels` works
- Anonymous `POST /channels` returns `401`
- `viewer` token still cannot mutate (`403`)
- `operator` token can `POST`/`PUT`/`PATCH`
- Only `admin` can `DELETE`
- Only `admin` can access `/webhook-subscriptions/*`

### Phase 3: Wire Hive UI role usage

- Read-only UI surfaces use `viewer` token (or anonymous if acceptable)
- Write-capable task operations use `operator` token
- Admin pages and destructive actions use `admin` token

For browser-based UI, avoid embedding long-lived admin secrets in client bundles. Use a backend-for-frontend or proxy where possible.

### Phase 4: Tighten read access (optional)

If you need fully authenticated reads:

- set `HIVE_AUTH_ALLOW_ANONYMOUS_READ=false`

Now all endpoints require an auth token with the minimum role for that route.

## Operational notes

- Auth mechanism is intentionally lightweight scaffolding, not a final IAM model
- Start with environment-level shared tokens, then evolve to per-user auth later
- Rotate tokens periodically and after any accidental disclosure

## Quick env example

```bash
HIVE_AUTH_ENABLED=true
HIVE_AUTH_PROTECT_SENSITIVE=true
HIVE_AUTH_ALLOW_ANONYMOUS_READ=true
HIVE_AUTH_VIEWER_TOKEN="replace-viewer-token"
HIVE_AUTH_OPERATOR_TOKEN="replace-operator-token"
HIVE_AUTH_ADMIN_TOKEN="replace-admin-token"
```
