# ACP Integration Plan for Hive

## Overview

Integrate Agent Communication Protocol (ACP) into Hive for:
1. External agent notification (webhooks)
2. Internal spawn communication (stdin/stdout)
3. Standard response format for all agents

## Phase 1: ACP Response Types & Normalization ✅ COMPLETE

**Goal:** Define ACP protocol types and normalize all agent outputs to ACP format.

### Tasks
- [x] Create `src/types/acp.ts` with ACP protocol types
- [x] Create `src/services/acp/format.ts` for output formatting
- [x] Update `spawn.ts` to use ACP formatting
- [x] Add ACP parsing for agent stdout (JSONL)

### ACP Types

```typescript
interface ACPMessage {
  protocol: 'acp/1.0';
  type: 'task' | 'progress' | 'response' | 'clarification' | 'error';
  taskId: string;
  timestamp: number;
  payload: unknown;
}

interface ACPTask {
  taskId: string;
  channelId: string;
  channelName?: string;
  cwd?: string;
  mentionedBy: string;
  content: string;
  chainDepth: number;
}

interface ACPProgress {
  percent: number;
  message: string;
  stage?: string;
}

interface ACPResponse {
  status: 'completed' | 'failed';
  message: string;
  artifacts?: ACPArtifact[];
  mentions?: string[]; // @other-agent for chaining
}

interface ACPClarification {
  questions: Array<{
    id: string;
    question: string;
    type: 'text' | 'choice' | 'multi';
    options?: string[];
  }>;
}

interface ACPArtifact {
  type: 'file' | 'code' | 'link' | 'image';
  name: string;
  content?: string;
  path?: string;
  url?: string;
}
```

---

## Phase 2: Webhook ACP Transport ✅ COMPLETE

**Goal:** Send ACP-formatted task notifications to webhook endpoints.

### Tasks
- [x] Update `Agent.webhook` type to support ACP protocol
- [x] Create `src/services/acp/webhook.ts` for ACP webhook delivery
- [x] Add ACP signature verification for responses
- [x] Update agent registration schema to include `protocol: 'acp'`

### Webhook Flow

```
Mention → Hive → POST /agent-webhook (ACP format)
                    ↓
              Remote Agent processes
                    ↓
              POST /mentions/:id/response (ACP format)
                    ↓
              Hive creates response post
```

---

## Phase 3: Stdin/Stdout ACP Stream ✅ COMPLETE

**Goal:** Enable bidirectional ACP communication with spawned processes.

### Tasks
- [x] Create `src/services/acp/spawn-protocol.ts`
- [x] Implement ACP message framing (newline-delimited JSON)
- [x] Handle clarification requests (pause spawn, wait for response)
- [x] Stream progress events via SSE

### Spawn Protocol Flow

```
Hive → Agent (stdin):  {"type":"task","taskId":"...","payload":{...}}
Hive ← Agent (stdout): {"type":"progress","percent":25,"message":"..."}
Hive ← Agent (stdout): {"type":"clarification","questions":[...]}
Hive → Agent (stdin):  {"type":"clarification_response","answers":[...]}
Hive ← Agent (stdout): {"type":"response","status":"completed","message":"..."}
```

---

## Phase 4: ACP Client Mode ✅ COMPLETE

**Goal:** Allow Hive to connect to external ACP agents (Claude Code, Codex).

### Tasks
- [x] Create `src/services/acp/client.ts` for ACP client
- [x] Support WebSocket and HTTP transports
- [x] Implement session persistence for long-running tasks
- [x] Add reconnection logic

### Client Features

```typescript
// Send task to external ACP endpoint
const result = await sendACPTask({
  agentId: 'external-codex',
  mentionId: 'mention_abc123',
  channelId: 'channel_xyz',
  config: {
    endpoint: 'https://api.example.com/acp',
    transport: 'http',
    token: 'auth-token',
    timeout: 60000,
  },
  onProgress: (progress) => {
    console.log(`Progress: ${progress.percent}% - ${progress.message}`);
  },
  onClarification: async (questions) => {
    // Handle clarification from user
    return { q1: 'answer' };
  },
});
```

### Transport Support

| Transport | Status | Notes |
|-----------|--------|-------|
| HTTP POST | ✅ | Primary transport |
| HTTP SSE | ✅ | Stream progress via event-stream |
| WebSocket | 📋 | Planned for long-lived sessions |

---

## Implementation Complete

All four phases of ACP integration are now complete:

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Types & Formatting | ✅ |
| 2 | Webhook Transport | ✅ |
| 3 | Stdin/Stdout Protocol | ✅ |
| 4 | ACP Client | ✅ |

### Files Created

```
src/
├── types/
│   └── acp.ts           # ACP type definitions
├── services/
│   └── acp/
│       ├── index.ts           # Service entry point
│       ├── format.ts          # Output parsing & formatting
│       ├── parser.ts          # Inbound message parsing
│       ├── webhook.ts         # Webhook delivery
│       ├── spawn-protocol.ts  # Stdin/stdout protocol
│       └── client.ts          # External ACP client
└── routes/
    └── acp.ts            # ACP HTTP endpoints
```

---

## Implementation Order

1. **Phase 1** - Foundation (types, formatting)
2. **Phase 2** - Webhook ACP (simpler, no process changes)
3. **Phase 3** - Stdin/Stdout ACP (biggest change)
4. **Phase 4** - ACP Client (optional enhancement)

---

## Files to Create/Modify

### New Files
- `src/types/acp.ts` - ACP type definitions
- `src/services/acp/index.ts` - ACP service entry
- `src/services/acp/format.ts` - Output formatting
- `src/services/acp/parser.ts` - ACP message parsing
- `src/services/acp/webhook.ts` - Webhook delivery
- `src/services/acp/spawn-protocol.ts` - Stdin/stdout protocol
- `src/schemas/acp.ts` - Validation schemas

### Modified Files
- `src/types.ts` - Add ACP-related agent fields
- `src/services/spawn.ts` - Use ACP formatting
- `src/routes/agents.ts` - Accept ACP config
- `src/services/events.ts` - Add ACP event types

---

## Backwards Compatibility

- Plain text output → wrapped in ACP response
- Existing agents work without changes
- ACP-aware agents get richer communication