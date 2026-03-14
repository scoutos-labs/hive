# ACP (Agent Communication Protocol) - Skill Reference

This document provides a quick reference for implementing ACP in your agents.

## Message Types Quick Reference

| Type | Direction | Purpose |
|------|-----------|---------|
| `task` | Hive → Agent | Initial task assignment |
| `progress` | Agent → Hive | Progress update |
| `clarification` | Agent → Hive | Request clarification |
| `response` | Agent → Hive | Final task response |
| `error` | Agent → Hive | Error report |

## Minimal ACP Agent (5 lines)

```javascript
// Read task from stdin
const task = JSON.parse(require('fs').readFileSync(0, 'utf-8'));

// Process...

// Send response
console.log(JSON.stringify({
  protocol: 'acp/1.0',
  type: 'response',
  taskId: task.taskId,
  timestamp: Date.now(),
  payload: { status: 'completed', message: 'Done!' }
}));
```

## Progress Pattern

```javascript
// Send progress updates during long tasks
function progress(taskId, percent, message) {
  console.log(JSON.stringify({
    protocol: 'acp/1.0',
    type: 'progress',
    taskId,
    timestamp: Date.now(),
    payload: { percent, message }
  }));
}

// Usage
progress(taskId, 25, 'Starting...');
progress(taskId, 50, 'Halfway...');
progress(taskId, 100, 'Complete!');
```

## Artifacts Pattern

```javascript
// Return structured results
console.log(JSON.stringify({
  protocol: 'acp/1.0',
  type: 'response',
  taskId: task.taskId,
  timestamp: Date.now(),
  payload: {
    status: 'completed',
    message: 'Analysis complete',
    artifacts: [
      { type: 'file', name: 'Report', path: '/tmp/report.md' },
      { type: 'link', name: 'PR', url: 'https://github.com/...' }
    ]
  }
}));
```

## Clarification Pattern

```javascript
// Ask a question
console.log(JSON.stringify({
  protocol: 'acp/1.0',
  type: 'clarification',
  taskId: task.taskId,
  timestamp: Date.now(),
  payload: {
    questions: [
      {
        id: 'branch',
        question: 'Which branch?',
        type: 'choice',
        options: ['main', 'develop'],
        required: true
      }
    ]
  }
}));

// Agent will receive answers via stdin:
// {"type":"clarification_response","taskId":"...","payload":{"answers":{"branch":"develop"}}}
```

## Agent Chaining

```javascript
// Mention other agents to create chains
console.log(JSON.stringify({
  protocol: 'acp/1.0',
  type: 'response',
  taskId: task.taskId,
  payload: {
    status: 'completed',
    message: 'Initial analysis done. Passing to reviewer.',
    mentions: ['code-reviewer', 'security-scanner']
  }
}));
```

## Environment Variables

Hive provides these to spawned agents:

| Variable | Description |
|----------|-------------|
| `MENTION_ID` | Task ID (use as `taskId`) |
| `CHANNEL_ID` | Channel ID |
| `CHANNEL_NAME` | Channel name |
| `CHANNEL_CWD` | Working directory |
| `FROM_AGENT` | Agent that mentioned you |
| `MENTION_CONTENT` | Full message content |
| `ACP_PROTOCOL` | `"1.0"` if ACP enabled |

## Python Template

```python
#!/usr/bin/env python3
import sys
import json
import time

def send(msg):
    print(json.dumps(msg), flush=True)

def send_response(task_id, message, artifacts=None):
    send({
        "protocol": "acp/1.0",
        "type": "response",
        "taskId": task_id,
        "timestamp": int(time.time() * 1000),
        "payload": {
            "status": "completed",
            "message": message,
            "artifacts": artifacts or []
        }
    })

def send_progress(task_id, percent, message):
    send({
        "protocol": "acp/1.0",
        "type": "progress",
        "taskId": task_id,
        "timestamp": int(time.time() * 1000),
        "payload": {"percent": percent, "message": message}
    })

# Read task
task = json.loads(sys.stdin.read())
task_id = task["taskId"]
content = task["payload"]["content"]

# Process
send_progress(task_id, 25, "Starting...")
send_progress(task_id, 75, "Processing...")

# Respond
send_response(task_id, f"Processed: {content}")
```

## TypeScript Template

```typescript
import readline from 'readline';

const rl = readline.createInterface({ input: process.stdin });

rl.on('line', (line) => {
  const msg = JSON.parse(line);
  
  if (msg.type === 'task') {
    const taskId = msg.taskId;
    
    // Send progress
    process.stdout.write(JSON.stringify({
      protocol: 'acp/1.0',
      type: 'progress',
      taskId,
      timestamp: Date.now(),
      payload: { percent: 50, message: 'Working...' }
    }) + '\n');
    
    // Process task...
    const result = processTask(msg.payload);
    
    // Send response
    process.stdout.write(JSON.stringify({
      protocol: 'acp/1.0',
      type: 'response',
      taskId,
      timestamp: Date.now(),
      payload: { status: 'completed', message: result }
    }) + '\n');
  }
});

function processTask(payload: any): string {
  // Your logic here
  return 'Task completed';
}
```

## Testing Your Agent

```bash
# Test locally with echo
echo '{"protocol":"acp/1.0","type":"task","taskId":"test1","payload":{"content":"hello"}}' | ./your-agent

# Expected output:
# {"protocol":"acp/1.0","type":"progress","taskId":"test1",...}
# {"protocol":"acp/1.0","type":"response","taskId":"test1",...}

# Register with Hive and test via @mention
curl -X POST http://localhost:7373/agents -H "Content-Type: application/json" -d '{"id":"test","spawnCommand":"./your-agent"}'
```