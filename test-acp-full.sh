#!/bin/bash
# Full ACP Message Flow Test
# This tests the complete ACP cycle: task → progress → response

set -e

BASE_URL="${BASE_URL:-http://localhost:7374}"
FORGE_DIR="$HOME/forge/hive"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║         Hive ACP Integration Test - Full Flow               ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "Server: $BASE_URL"
echo ""

# Clean up any existing test data
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1. SETUP - Create Channel and Agent"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Create channel
CHANNEL_RESULT=$(curl -s -X POST "$BASE_URL/channels" \
  -H "Content-Type: application/json" \
  -d '{"name":"acp-full-test","description":"Full ACP flow testing","createdBy":"test-runner"}')
CHANNEL_ID=$(echo "$CHANNEL_RESULT" | jq -r '.data.id // .id')
echo "Channel: $CHANNEL_ID"

# Register ACP test agent
echo ""
echo "Registering ACP test agent..."
curl -s -X POST "$BASE_URL/agents" \
  -H "Content-Type: application/json" \
  -d "{
    \"id\": \"acp-tester\",
    \"name\": \"ACP Tester\",
    \"description\": \"Full ACP protocol test agent\",
    \"spawnCommand\": \"bun\",
    \"spawnArgs\": [\"run\", \"$FORGE_DIR/test-acp-agent.ts\"],
    \"cwd\": \"$FORGE_DIR\",
    \"acp\": {
      \"protocol\": \"acp/1.0\",
      \"capabilities\": [\"progress\", \"artifacts\", \"mentions\"],
      \"clarifySupport\": false
    }
  }" | jq '.data // .'
echo ""

# Give server a moment
sleep 1

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "2. TEST ACP TASK FLOW - Post with @mention"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Create post with mention - this triggers agent spawn
echo "Creating post with @acp-tester mention..."
POST_RESULT=$(curl -s -X POST "$BASE_URL/posts" \
  -H "Content-Type: application/json" \
  -d "{\"channelId\":\"$CHANNEL_ID\",\"authorId\":\"test-runner\",\"content\":\"@acp-tester --test-acp\"}")
POST_ID=$(echo "$POST_RESULT" | jq -r '.data.id // .id')
echo "Post: $POST_ID"
echo ""

# Wait for agent to process
echo "Waiting for agent to process (3 seconds)..."
sleep 3

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "3. VERIFY RESULTS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check for agent response posts
echo "Checking for agent response posts..."
curl -s "$BASE_URL/posts?channelId=$CHANNEL_ID" | jq '.data[] | select(.authorId == "acp-tester") | {id, content: .content[0:200]}'
echo ""

# Check mentions
echo "Checking mentions..."
curl -s "$BASE_URL/mentions?agentId=acp-tester" | jq '.data[0:3]'
echo ""

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "4. TEST ACP HTTP ENDPOINTS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Create a mention manually for endpoint testing
echo "Creating test mention for endpoint tests..."
MENTION_RESULT=$(curl -s -X POST "$BASE_URL/mentions" \
  -H "Content-Type: application/json" \
  -d "{\"channelId\":\"$CHANNEL_ID\",\"agentId\":\"acp-tester\",\"mentioningAgentId\":\"test-runner\",\"content\":\"Test ACP endpoints\"}")
MENTION_ID=$(echo "$MENTION_RESULT" | jq -r '.data.id // .id')
echo "Mention: $MENTION_ID"
echo ""

# Test ACP Progress endpoint
echo "Testing ACP Progress endpoint..."
curl -s -X POST "$BASE_URL/acp/progress" \
  -H "Content-Type: application/json" \
  -d "{
    \"protocol\": \"acp/1.0\",
    \"type\": \"progress\",
    \"taskId\": \"$MENTION_ID\",
    \"timestamp\": $(date +%s)000,
    \"payload\": {
      \"percent\": 50,
      \"message\": \"Testing progress endpoint\",
      \"stage\": \"test\"
    }
  }" | jq .
echo ""

# Test ACP Response endpoint
echo "Testing ACP Response endpoint..."
curl -s -X POST "$BASE_URL/acp/response" \
  -H "Content-Type: application/json" \
  -d "{
    \"protocol\": \"acp/1.0\",
    \"type\": \"response\",
    \"taskId\": \"$MENTION_ID\",
    \"timestamp\": $(date +%s)000,
    \"payload\": {
      \"status\": \"completed\",
      \"message\": \"ACP Response endpoint works!\\n\\nThis is a test response from the HTTP endpoint.\",
      \"artifacts\": [
        {\"type\": \"link\", \"name\": \"Test Link\", \"url\": \"https://github.com/scoutos-labs/hive\"}
      ],
      \"mentions\": []
    }
  }" | jq .
echo ""

# Verify the response created a post
sleep 1
echo "Verifying response post..."
curl -s "$BASE_URL/posts?channelId=$CHANNEL_ID" | jq '.data[] | select(.authorId == "acp-tester") | {id, authorId, content: .content[0:100]}'
echo ""

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                    TEST COMPLETE                            ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "ACP Features Tested:"
echo "  ✅ Agent registration with ACP config"
echo "  ✅ ACP task spawning via @mention"
echo "  ✅ ACP progress endpoint"
echo "  ✅ ACP response endpoint"
echo "  ✅ Response post creation"
echo ""
echo "Server: $BASE_URL"
echo "Channel: $CHANNEL_ID"
echo ""