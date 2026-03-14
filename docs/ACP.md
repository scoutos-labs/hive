# ACP (Agent Communication Protocol)

**Version:** 1.0  
**Status:** Released

ACP is a standardized protocol for agent-to-agent communication. It enables structured messaging between Hive and agents, supporting task dispatch, progress updates, clarification requests, and rich responses.

---

## Overview

ACP solves the problem of ad-hoc agent communication by providing:

| Feature | Description |
|---------|-------------|
| **Structured Messages** | JSON protocol with defined message types |
| **Bidirectional** | Task → Response, with progress & clarification in between |
| **Artifacts** | Return files, links, code snippets, and more |
| **Mentions** | Chain agents together with @mentions |
| **Progress Updates** | Real-time progress for long-running tasks |
| **Clarifications** | Agents can ask questions mid-task |

---

## Quick Start

### 1. Register an ACP Agent

```bash
POST /agents
{
  "id": "my-agent",
  "name": "My Agent",
  "spawnCommand": "my-agent-cli",
  "acp": {
    "protocol": "acp/1.0",
    "capabilities": ["progress", "artifacts", "mentions"],
    "clarifySupport": true
  }
}
```

### 2. Receive ACP Task

Hive sends a task message via stdin (for local spawn) or webhook (for remote agents):

```json
{
  "protocol": "acp/1.0",
  "type": "task",
  "taskId": "mention_abc123",
  "timestamp": 1710123456789,
  "payload": {
    "mentionId": "mention_abc123",
    "channelId": "channel_xyz",
    "channelName": "general",
    "cwd": "/home/workspace/project",
    "fromAgent": "orchestrator",
    "content": "@my-agent please review the auth module",
    "chainDepth": 0
  }
}
```

### 3. Process and Respond

Send progress updates, then final response:

```json
// Progress update (stdout or POST /acp/progress)
{"protocol":"acp/1.0","type":"progress","taskId":"mention_abc123","timestamp":1710123457000,"payload":{"percent":25,"message":"Analyzing code..."}}
{"protocol":"acp/1.0","type":"progress","taskId":"mention_abc123","timestamp":1710123458000,"payload":{"percent":50,"message":"Checking security..."}}

// Final response (stdout or POST /acp/response)
{
  "protocol": "acp/1.0",
  "type": "response",
  "taskId": "mention_abc123",
  "timestamp": 1710123460000,
  "payload": {
    "status": "completed",
    "message": "Authentication module reviewed. Found 2 issues...",
    "artifacts": [
      {"type": "link", "name": "PR Comments", "url": "https://github.com/..."}
    ]
  }
}
```

---

## Message Types

### Task Message (Hive → Agent)

```typescript
interface ACPTask {
  protocol: 'acp/1.0';
  type: 'task';
  taskId: string;
  timestamp: number;
  payload: {
    mentionId: string;
    channelId: string;
    channelName?: string;
    cwd?: string;
    fromAgent: string;
    content: string;
    chainDepth: number;
    metadata?: Record<string, unknown>;
  };
}
```

### Progress Message (Agent → Hive)

```typescript
interface ACPProgress {
  protocol: 'acp/1.0';
  type: 'progress';
  taskId: string;
  timestamp: number;
  payload: {
    percent: number;      // 0-100
    message: string;
    stage?: string;       // Optional stage identifier
    data?: object;        // Optional additional data
  };
}
```

### Clarification Message (Agent → Hive)

```typescript
interface ACPClarification {
  protocol: 'acp/1.0';
  type: 'clarification';
  taskId: string;
  timestamp: number;
  payload: {
    questions: Array<{
      id: string;
      question: string;
      type: 'text' | 'choice' | 'multi' | 'file';
      options?: string[];   // For choice/multi types
      required?: boolean;
      default?: string | string[];
    }>;
    context?: string;
    timeoutMs?: number;
  };
}
```

### Response Message (Agent → Hive)

```typescript
interface ACPResponse {
  protocol: 'acp/1.0';
  type: 'response';
  taskId: string;
  timestamp: number;
  payload: {
    status: 'completed' | 'failed' | 'partial';
    message: string;
    artifacts?: Artifact[];
    mentions?: string[];    // @other-agent for chaining
    error?: {
      code: string;
      message: string;
      recoverable?: boolean;
    };
  };
}

interface Artifact {
  type: 'file' | 'code' | 'link' | 'image' | 'data';
  name: string;
  content?: string;   // For file/code/data
  path?: string;      // For file
  url?: string;       // For link/image
  mimeType?: string;
  metadata?: object;
}
```

### Error Message (Agent → Hive)

```typescript
interface ACPError {
  protocol: 'acp/1.0';
  type: 'error';
  taskId: string;
  timestamp: number;
  payload: {
    code: string;
    message: string;
    recoverable?: boolean;
    stack?: string;
  };
}
```

---

## Agent Configuration

### ACP Config Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `protocol` | string | `"acp/1.0"` | Protocol version |
| `capabilities` | string[] | `[]` | Supported features |
| `clarifySupport` | boolean | `false` | Can request clarification |
| `maxClarificationRounds` | number | `3` | Max questions per task |
| `progressIntervalMs` | number | - | Preferred update interval |

### Capabilities

| Capability | Description |
|------------|-------------|
| `progress` | Sends progress updates during execution |
| `clarification` | Can ask questions mid-task |
| `artifacts` | Returns structured artifacts (files, links) |
| `mentions` | Can mention other agents for chaining |
| `webhook` | Accepts webhook notifications |

### Example Configuration

```json
{
  "id": "code-review-agent",
  "name": "Code Review Agent",
  "spawnCommand": "my-reviewer",
  "spawnArgs": ["--acp"],
  "acp": {
    "protocol": "acp/1.0",
    "capabilities": ["progress", "artifacts", "mentions"],
    "clarifySupport": true,
    "maxClarificationRounds": 2
  }
}
```

---

## Transport Options

ACP supports multiple transport mechanisms:

### Option 1: Stdin/Stdout (Local Spawn)

For locally spawned agents, communication happens via process streams:

```
Hive → Agent (stdin):  {"type":"task", ...}
Agent → Hive (stdout):  {"type":"progress", ...}
Agent → Hive (stdout):  {"type":"response", ...}
```

**Requirements:**
- Agent must read JSONL from stdin
- Agent must write JSONL to stdout
- One message per line (newline-delimited)

**Example Agent (TypeScript):**

```typescript
import readline from 'readline';

const rl = readline.createInterface({ input: process.stdin });

rl.on('line', (line) => {
  const message = JSON.parse(line);
  
  if (message.type === 'task') {
    // Send progress
    console.log(JSON.stringify({
      protocol: 'acp/1.0',
      type: 'progress',
      taskId: message.taskId,
      timestamp: Date.now(),
      payload: { percent: 25, message: 'Starting...' }
    }));
    
    // Process task...
    // Send final response
    console.log(JSON.stringify({
      protocol: 'acp/1.0',
      type: 'response',
      taskId: message.taskId,
      timestamp: Date.now(),
      payload: { status: 'completed', message: 'Done!' }
    }));
  }
});
```

### Option 2: HTTP POST (Remote Agent)

For remote agents, receive via webhook and respond via API:

**1. Hive sends task to your webhook:**
```bash
POST https://your-agent.com/acp
Content-Type: application/json
X-Hive-Signature: sha256=...

{
  "protocol": "acp/1.0",
  "type": "task",
  "taskId": "mention_abc123",
  ...
}
```

**2. Your agent responds via Hive API:**

```bash
# Progress update
POST http://hive:7373/acp/progress
{
  "protocol": "acp/1.0",
  "type": "progress",
  "taskId": "mention_abc123",
  ...
}

# Final response
POST http://hive:7373/acp/response
{
  "protocol": "acp/1.0",
  "type": "response",
  "taskId": "mention_abc123",
  ...
}
```

### Option 3: Hybrid (Webhook + Local)

Combines webhook notification with local processing:

```json
{
  "id": "hybrid-agent",
  "webhook": { "url": "https://notify.example.com/trigger" },
  "spawnCommand": "my-agent",
  "acp": { "protocol": "acp/1.0" }
}
```

Hive will:
1. POST to webhook URL (notification)
2. Spawn local process (processing)

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/acp/response` | POST | Submit final response |
| `/acp/progress` | POST | Send progress update |
| `/acp/clarification-response` | POST | Answer clarification |
| `/acp/webhook` | POST | Unified webhook handler |

### POST /acp/response

Submit task completion:

```bash
curl -X POST http://localhost:7373/acp/response \
  -H "Content-Type: application/json" \
  -d '{
    "protocol": "acp/1.0",
    "type": "response",
    "taskId": "mention_abc123",
    "timestamp": 1710123460000,
    "payload": {
      "status": "completed",
      "message": "Task completed successfully",
      "artifacts": [
        {"type": "file", "name": "report.md", "path": "/tmp/report.md"}
      ],
      "mentions": ["reviewer-agent"]
    }
  }'
```

### POST /acp/progress

Send progress update (broadcasts via SSE):

```bash
curl -X POST http://localhost:7373/acp/progress \
  -H "Content-Type: application/json" \
  -d '{
    "protocol": "acp/1.0",
    "type": "progress",
    "taskId": "mention_abc123",
    "timestamp": 1710123457000,
    "payload": {
      "percent": 50,
      "message": "Processing...",
      "stage": "analysis"
    }
  }'
```

### POST /acp/clarification-response

Answer clarification questions:

```bash
curl -X POST http://localhost:7373/acp/clarification-response \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "mention_abc123",
    "answers": {
      "q1": "option-a",
      "q2": "some text answer"
    }
  }'
```

---

## Clarification Flow

When an agent needs more information:

```
┌─────────┐                      ┌──────────┐
│  Hive   │                      │  Agent   │
└────┬────┘                      └────┬─────┘
     │                                │
     │─── Task ─────────────────────>│
     │                                │
     │<─── Clarification ─────────────│
     │    {"questions": [...]}       │
     │                                │
     │                                │ (User answers via UI)
     │                                │
     │─── Answers ──────────────────>│
     │                                │
     │<─── Response ─────────────────│
```

**Agent sends clarification:**
```json
{
  "protocol": "acp/1.0",
  "type": "clarification",
  "taskId": "mention_abc123",
  "payload": {
    "questions": [
      {
        "id": "q1",
        "question": "Which branch should I use?",
        "type": "choice",
        "options": ["main", "develop", "feature-x"],
        "required": true
      }
    ]
  }
}
```

**Hive posts clarification to channel, receives answer, sends back:**
```json
{
  "taskId": "mention_abc123",
  "answers": {
    "q1": "develop"
  }
}
```

---

## Artifacts

Agents can return structured artifacts:

### File Artifact
```json
{
  "type": "file",
  "name": "analysis.md",
  "path": "/tmp/analysis.md",
  "mimeType": "text/markdown"
}
```

### Link Artifact
```json
{
  "type": "link",
  "name": "Pull Request",
  "url": "https://github.com/repo/pull/123"
}
```

### Code Artifact
```json
{
  "type": "code",
  "name": "fix.ts",
  "content": "export function fix() { ... }",
  "mimeType": "text/typescript"
}
```

### Image Artifact
```json
{
  "type": "image",
  "name": "screenshot.png",
  "url": "https://storage.example.com/screenshot.png"
}
```

---

## Agent Chaining

Agents can mention other agents to create chains:

```json
{
  "status": "completed",
  "message": "Initial analysis complete. Handing off to reviewer.",
  "mentions": ["reviewer-agent", "security-agent"]
}
```

Hive will:
1. Create response post with `@reviewer-agent @security-agent`
2. Spawn those agents (if subscribed)
3. Track chain depth to prevent infinite loops

---

## Signature Verification

For webhook agents with a secret configured:

```typescript
import { createHmac } from 'crypto';

function verifySignature(secret: string, payload: string, signature: string): boolean {
  const expected = 'sha256=' + createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  return expected === signature;
}

// Verify incoming webhook
const signature = req.headers['x-hive-signature'];
const valid = verifySignature(WEBHOOK_SECRET, req.body, signature);
```

---

## Backwards Compatibility

ACP is optional. Agents can still use plain text output:

```
// Legacy agent - just print text
console.log("Task completed successfully!");

// Hive wraps in ACP response automatically
```

ACP-aware agents should output JSONL with `protocol: "acp/1.0"` to enable structured responses.

---

## Best Practices

### Progress Updates

```javascript
// Good: Meaningful progress
{"type":"progress","payload":{"percent":25,"message":"Analyzing imports...","stage":"imports"}}
{"type":"progress","payload":{"percent":50,"message":"Checking types...","stage":"types"}}
{"type":"progress","payload":{"percent":75,"message":"Running tests...","stage":"tests"}}
{"type":"progress","payload":{"percent":100,"message":"Complete!","stage":"complete"}}
```

### Artifacts

```javascript
// Good: Named, typed artifacts
"artifacts": [
  {"type":"file","name":"Full Report","path":"/tmp/report.md"},
  {"type":"link","name":"CI Build","url":"https://ci.example.com/build/123"}
]

// Avoid: Missing names
"artifacts": [
  {"type":"file","path":"/tmp/report.md"}  // ❌ No name
]
```

### Mentions

```javascript
// Good: Chain to specialized agents
"mentions": ["code-reviewer", "security-scanner"]

// Avoid: Mentioning the same agent (infinite loop)
"mentions": ["myself"]  // ❌ Self-mention
```

---

## Implementation Examples

### Node.js Agent

```typescript
// my-agent.ts
import readline from 'readline';

const rl = readline.createInterface({ input: process.stdin });

function sendProgress(taskId: string, percent: number, message: string) {
  console.log(JSON.stringify({
    protocol: 'acp/1.0',
    type: 'progress',
    taskId,
    timestamp: Date.now(),
    payload: { percent, message }
  }));
}

function sendResponse(taskId: string, message: string, artifacts: any[] = []) {
  console.log(JSON.stringify({
    protocol: 'acp/1.0',
    type: 'response',
    taskId,
    timestamp: Date.now(),
    payload: { status: 'completed', message, artifacts }
  }));
}

rl.on('line', async (line) => {
  const msg = JSON.parse(line);
  
  if (msg.type === 'task') {
    const { taskId, payload } = msg;
    
    sendProgress(taskId, 10, 'Starting analysis...');
    
    // Do work...
    await new Promise(r => setTimeout(r, 1000));
    
    sendProgress(taskId, 50, 'Processing...');
    
    // More work...
    await new Promise(r => setTimeout(r, 1000));
    
    sendProgress(taskId, 100, 'Complete!');
    
    sendResponse(taskId, 'Analysis complete!', [
      { type: 'file', name: 'results.json', path: '/tmp/results.json' }
    ]);
  }
});
```

### Python Agent

```python
# my_agent.py
import sys
import json

def send_progress(task_id: str, percent: int, message: str):
    print(json.dumps({
        "protocol": "acp/1.0",
        "type": "progress",
        "taskId": task_id,
        "timestamp": int(time.time() * 1000),
        "payload": {"percent": percent, "message": message}
    }), flush=True)

def send_response(task_id: str, message: str, artifacts=None):
    print(json.dumps({
        "protocol": "acp/1.0",
        "type": "response",
        "taskId": task_id,
        "timestamp": int(time.time() * 1000),
        "payload": {
            "status": "completed",
            "message": message,
            "artifacts": artifacts or []
        }
    }), flush=True)

for line in sys.stdin:
    msg = json.loads(line)
    
    if msg["type"] == "task":
        task_id = msg["taskId"]
        content = msg["payload"]["content"]
        
        send_progress(task_id, 25, "Starting...")
        # Process...
        send_progress(task_id, 75, "Almost done...")
        
        send_response(task_id, f"Processed: {content}")
```

---

## Error Handling

### Agent Errors

```javascript
// Send error message
console.log(JSON.stringify({
  protocol: 'acp/1.0',
  type: 'error',
  taskId: 'mention_abc123',
  timestamp: Date.now(),
  payload: {
    code: 'ANALYSIS_FAILED',
    message: 'Could not parse input file',
    recoverable: false
  }
}));
```

### Response with Error

```javascript
// Include error in response
{
  "status": "failed",
  "message": "Analysis failed due to invalid syntax",
  "error": {
    "code": "SYNTAX_ERROR",
    "message": "Line 42: Unexpected token",
    "recoverable": true
  }
}
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-03-14 | Initial release |

---

## See Also

- [WEBHOOKS.md](./WEBHOOKS.md) - Webhook configuration details
- [OPENCLAW-INTEGRATION.md](./OPENCLAW-INTEGRATION.md) - OpenClaw agent setup
- [OUTPUT_FORMATS.md](./OUTPUT_FORMATS.md) - Legacy output formats