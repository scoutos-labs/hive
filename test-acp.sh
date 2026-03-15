#!/bin/bash
# Test Hive ACP Integration

set -e

BASE_URL="${BASE_URL:-http://localhost:7373}"

echo "=== Testing Hive ACP Integration ==="
echo "Server: $BASE_URL"
echo ""

# Health check
echo "1. Health Check"
curl -s "$BASE_URL/health" | jq . || echo "ERROR: Server not responding"
echo ""

# Create channel
echo "2. Create Channel"
CHANNEL=$(curl -s -X POST "$BASE_URL/channels" \
  -H "Content-Type: application/json" \
  -d '{"name":"acp-test","description":"ACP testing channel","createdBy":"tester"}')
echo "$CHANNEL" | jq .
CHANNEL_ID=$(echo "$CHANNEL" | jq -r '.data.id // .id')
echo "Channel ID: $CHANNEL_ID"
echo ""

# Register ACP agent
echo "3. Register ACP Agent"
curl -s -X POST "$BASE_URL/agents" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "test-acp-agent",
    "name": "Test ACP Agent",
    "description": "Agent with ACP protocol",
    "spawnCommand": "echo",
    "spawnArgs": ["{\"protocol\":\"acp/1.0\",\"type\":\"response\",\"taskId\":\"test\",\"timestamp\":0,\"payload\":{\"status\":\"completed\",\"message\":\"ACP v0.1.0 works!\"}}"],
    "acp": {
      "protocol": "acp/1.0",
      "capabilities": ["progress", "artifacts", "mentions"]
    }
  }' | jq .
echo ""

# List agents
echo "4. List Agents"
curl -s "$BASE_URL/agents" | jq .
echo ""

# Create post with mention
echo "5. Create Post with @mention"
POST=$(curl -s -X POST "$BASE_URL/posts" \
  -H "Content-Type: application/json" \
  -d "{\"channelId\":\"$CHANNEL_ID\",\"authorId\":\"tester\",\"content\":\"@test-acp-agent Say hello with ACP!\"}")
echo "$POST" | jq .
echo ""

# Test ACP response endpoint
echo "6. Test ACP Response Endpoint"
curl -s -X POST "$BASE_URL/acp/response" \
  -H "Content-Type: application/json" \
  -d '{
    "protocol": "acp/1.0",
    "type": "response",
    "taskId": "test-mention-123",
    "timestamp": 0,
    "payload": {
      "status": "completed",
      "message": "ACP response works!"
    }
  }' | jq .
echo ""

# Test ACP progress endpoint
echo "7. Test ACP Progress Endpoint"
curl -s -X POST "$BASE_URL/acp/progress" \
  -H "Content-Type: application/json" \
  -d '{
    "protocol": "acp/1.0",
    "type": "progress",
    "taskId": "test-mention-123",
    "timestamp": 0,
    "payload": {
      "percent": 50,
      "message": "Processing..."
    }
  }' | jq .
echo ""

echo "=== Tests Complete ==="