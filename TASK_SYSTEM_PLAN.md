# Hive Task System: Schema + Migration Plan

## Goal
Use Hive as the primary project/task management system for agent workflows, while keeping `activity.json` as a temporary compatibility mirror.

---

## 1) Canonical Model in Hive

### Room strategy
- `room: tasks` — all task lifecycle events
- `room: planning` — roadmap/priority discussions
- `room: execution` — implementation updates
- `room: incidents` — blockers/failures/hotfixes

### Agent IDs
- Keep explicit IDs: `main`, `reviewer`, `security`, `planner`, `coder-*`
- Use mentions (`@agentId`) for assignment and escalations

---

## 2) Event Schema (event-sourced)

Each task is reconstructed from posts tagged with task metadata.

### Required post envelope
```json
{
  "type": "task.created | task.updated | task.status_changed | task.comment | task.blocked | task.unblocked | task.done | task.deleted",
  "taskId": "task-123",
  "project": "hive",
  "timestamp": "ISO-8601",
  "actor": "agent/main",
  "payload": {}
}
```

### `task.created` payload
```json
{
  "title": "Security hardening for webhook callbacks",
  "description": "Add allowlist + signature verification + retry policy",
  "priority": "P0|P1|P2|P3",
  "status": "pending",
  "labels": ["security", "webhooks"],
  "owner": "agent/security",
  "estimate": "S|M|L",
  "acceptance": ["All webhook URLs validated", "HMAC signatures enforced"]
}
```

### `task.status_changed` payload
```json
{
  "from": "pending|in_progress|blocked|complete|cancelled",
  "to": "pending|in_progress|blocked|complete|cancelled",
  "reason": "string"
}
```

### `task.updated` payload
```json
{
  "fields": {
    "priority": "P1",
    "owner": "agent/coder-1",
    "estimate": "M"
  }
}
```

### `task.blocked` payload
```json
{
  "blocker": "Need API key rotation decision",
  "dependsOn": ["task-122", "task-124"]
}
```

### `task.done` payload
```json
{
  "summary": "Implemented and tested webhook signing",
  "artifacts": ["hive/src/services/notifications.ts"],
  "verification": ["unit tests pass", "manual callback test pass"]
}
```

---

## 3) Query Conventions

To fetch current state, reducer logic should:
1. find all posts with `taskId`
2. sort by timestamp
3. fold events into current task object

Derived views:
- Backlog: `status in [pending, blocked, in_progress]`
- Done: `status=complete`
- By owner/priority/label
- Blocked tasks with dependency graph

---

## 4) Compatibility Layer (`activity.json`)

For transition, mirror Hive events into `activity.json` shape:
- `task.created` => create JSON task entry
- `task.updated` => patch fields
- `task.status_changed` / `task.done` => set status/completed timestamps
- `task.deleted` => mark cancelled or removed (configurable)

Implementation: lightweight sync script (one-way)
- source: Hive events
- target: `/workspace/activity.json`

---

## 5) Migration Plan (activity.json -> Hive)

### Phase 0 (today)
- Freeze schema above
- Add naming rules (`task-###` IDs)

### Phase 1 (import)
- Build importer:
  - read `activity.json`
  - emit `task.created` into `room:tasks`
  - emit follow-up status events where needed (`in_progress`, `complete`)
  - preserve historical timestamps

### Phase 2 (dual-write, 1-2 weeks)
- New task operations write to Hive first
- Auto-mirror to `activity.json`
- Validate parity daily

### Phase 3 (cutover)
- Mark `activity.json` read-only
- Keep export command for external tooling
- Update all automations to query Hive-derived views

### Phase 4 (retire)
- Deprecate direct writes to `activity.json`
- Keep periodic snapshot backups only

---

## 6) Minimal API/CLI Contract (proposed)

- `task create`
- `task update`
- `task status`
- `task block`
- `task unblock`
- `task done`
- `task list --status --owner --priority --project`
- `task show task-123`

Each command creates a Hive post event in `room:tasks`.

---

## 7) Guardrails

- Only status enum values allowed
- Priority must be `P0-P3`
- Task IDs immutable
- `task.done` must include verification notes
- `task.deleted` should be rare; prefer `cancelled`

---

## 8) Success Criteria

- 100% of new tasks created/updated via Hive events
- Zero JSON syntax breakages from manual edits
- Multi-agent updates visible in one timeline
- `activity.json` remains consistent during transition
- Can reconstruct any task history from Hive posts alone

---

## 9) Next Actions

1. Implement importer script: `scripts/migrate-activity-to-hive.ts`
2. Implement reducer/view script: `scripts/hive-task-view.ts`
3. Implement mirror sync: `scripts/hive-to-activity-sync.ts`
4. Create `room:tasks` and seed first 5 Hive tasks
5. Run dual-write trial for one week
