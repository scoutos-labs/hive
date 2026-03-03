# ADR-0001: Minimal authentication guard for Hive API

- Status: accepted
- Date: 2026-02-28
- Decision owners: Hive maintainers

## Context

Hive runs in local-first mode and currently allows anonymous access to all endpoints. That is fine for solo local workflows, but the planned write-capable Hive UI needs a safer baseline that can evolve into stronger auth without breaking current usage.

We need a minimal, low-friction foundation that:

1. Keeps current local workflows working by default
2. Introduces explicit roles for future UI permissions
3. Protects sensitive operations behind an opt-in guard
4. Is simple enough to operate without introducing a full identity provider yet

## Decision

Adopt a token-based role guard with three roles and incremental enforcement.

### Role model

- `viewer`: read-only access (intended for dashboards and observers)
- `operator`: can perform non-destructive mutations (`POST`/`PUT`/`PATCH`)
- `admin`: can perform destructive and sensitive operations

Role hierarchy is strict and cumulative: `admin` includes all `operator` and `viewer` permissions.

### Guard strategy

- Default mode remains open (`HIVE_AUTH_ENABLED=false`)
- Enforcement is enabled with `HIVE_AUTH_ENABLED=true`
- Endpoint protection can be toggled with `HIVE_AUTH_PROTECT_SENSITIVE` (default `true`)
- Auth is bearer token based: `Authorization: Bearer <token>`
- Role tokens come from env vars:
  - `HIVE_AUTH_VIEWER_TOKEN`
  - `HIVE_AUTH_OPERATOR_TOKEN`
  - `HIVE_AUTH_ADMIN_TOKEN`

### Policy in enforced mode

- Safe methods (`GET`, `HEAD`, `OPTIONS`) are still anonymous by default (`HIVE_AUTH_ALLOW_ANONYMOUS_READ=true`)
- Mutating methods require at least `operator`
- `DELETE` requires `admin`
- Sensitive endpoint classes:
  - `/proxy/elevenlabs/*` requires at least `operator` (external API/spend impact)
  - `/webhook-subscriptions/*` requires `admin` (outbound data flow risk)

## Rationale

- Minimizes migration risk by preserving open local behavior by default
- Gives the UI a concrete authorization contract early (`viewer/operator/admin`)
- Handles highest-risk surfaces first (webhooks and spend-triggering proxy routes)
- Avoids premature complexity (no user database, sessions, OAuth, or external IdP yet)

## Consequences

### Positive

- Fast path to basic hardening for shared/dev environments
- Clear role vocabulary for future API/UI policy expansion
- Simple operational model (just env vars)

### Negative / limitations

- Tokens are static and coarse-grained
- No per-user identity, audit trail, or token rotation protocol yet
- No scoped tokens per endpoint/resource yet

## Follow-up work

1. Add structured audit events for auth denials and role usage
2. Move from static shared tokens to per-user credentials
3. Add policy tests for each endpoint group
4. Evaluate pluggable auth providers (OIDC/JWT) after UI role needs are stable
