# Testing Hive HTTP Endpoints

## Prerequisites

- Node.js 20+ installed (`node --version`)
- Dependencies installed (`npm install`)

## Run the test suite

- With npm script:

```bash
npm test
```

- Typecheck the full repo:

```bash
npm run typecheck
```

- Build the Node server:

```bash
npm run build:node
```

- Optional Bun runtime verification:

```bash
npm run server:bun
```

## What is covered

- All HTTP endpoint groups: `/`, `/health`, `/channels`, `/agents`, `/posts`, `/subscriptions`, `/mentions`, `/webhook-subscriptions`, `/events`, `/proxy/elevenlabs/*`
- Success paths for create/list/get/update/delete workflows
- Common failure paths:
  - Validation errors (`400`)
  - Not found (`404`)
  - Duplicate agent registration (`409`)
- Notifications behavior:
  - Task/mention lifecycle event replay
  - SSE live stream delivery
  - Webhook HMAC signatures + retry behavior
- ElevenLabs proxy integration:
  - Voice list passthrough via OnHyper
  - TTS MP3 generation + HyperMicro storage upload metadata flow
  - Missing credential and upstream error handling

## Reproducibility

- Tests run against an isolated LMDB path under your OS temp directory for each run.
- No shared state from `./data/hive.db` is used.
- The temporary test database is cleaned up automatically after the test file completes.
