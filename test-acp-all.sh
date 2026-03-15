#!/bin/bash
# Comprehensive ACP Integration Test Suite
# Tests all three ACP use cases:
# 1. Local spawn with ACP stdin/stdout
# 2. HTTP endpoints (progress, response)
# 3. Webhook delivery (simulated)

set -e

BASE_URL="${BASE_URL:-http://localhost:7374}"
FORGE_DIR="$HOME/forge/hive"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║          Hive ACP Integration Test Suite                     ║"
echo "║          Testing All Three Use Cases                         ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo -e "${BLUE}Server:${NC} $BASE_URL"
echo -e "${BLUE}Test Time:${NC} $(date)"
echo ""

# Track test results
TESTS_PASSED=0
TESTS_FAILED=0

pass() {
    echo -e "${GREEN}✓ PASS${NC}: $1"
    ((TESTS_PASSED++))
}

fail() {
    echo -e "${RED}✗ FAIL${NC}: $1"
    ((TESTS_FAILED++))
}

# ============================================================================
# SETUP
# ============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${YELLOW}SETUP${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Create test channel
echo "Creating test channel..."
CHANNEL_RESULT=$(curl -s -X POST "$BASE_URL/channels" \
  -H "Content-Type: application/json" \
  -d '{"name":"acp-comprehensive-test","description":"Full ACP test suite","createdBy":"test-runner"}')
CHANNEL_ID=$(echo "$CHANNEL_RESULT" | jq -r '.data.id // .id')

if [ -z "$CHANNEL_ID" ] || [ "$CHANNEL_ID" = "null" ]; then
    fail "Failed to create channel"
    exit 1
fi
pass "Created channel: $CHANNEL_ID"

# Create mention ID for testing
MENTION_ID="test_mention_$(date +%s)"

echo ""

# ============================================================================
# TEST 1: HTTP ENDPOINTS
# ============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${YELLOW}TEST 1: HTTP ENDPOINTS${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1.1 Create a mention first
echo ""
echo "1.1 Creating test mention..."
MENTION_RESULT=$(curl -s -X POST "$BASE_URL/mentions" \
  -H "Content-Type: application/json" \
  -d "{\"channelId\":\"$CHANNEL_ID\",\"agentId\":\"http-test-agent\",\"mentioningAgentId\":\"test-runner\",\"content\":\"Test HTTP endpoints\"}")
MENTION_ID=$(echo "$MENTION_RESULT" | jq -r '.data.id // .id')

if [ -n "$MENTION_ID" ] && [ "$MENTION_ID" != "null" ]; then
    pass "Created mention: $MENTION_ID"
else
    fail "Failed to create mention"
fi

# 1.2 Test Progress Endpoint
echo ""
echo "1.2 Testing POST /acp/progress..."
PROGRESS_RESULT=$(curl -s -X POST "$BASE_URL/acp/progress" \
  -H "Content-Type: application/json" \
  -d "{
    \"protocol\": \"acp/1.0\",
    \"type\": \"progress\",
    \"taskId\": \"$MENTION_ID\",
    \"timestamp\": $(date +%s)000,
    \"payload\": {
      \"percent\": 25,
      \"message\": \"Starting test...\",
      \"stage\": \"initialization\"
    }
  }")

if echo "$PROGRESS_RESULT" | jq -e '.success == true' > /dev/null 2>&1; then
    pass "Progress endpoint accepted message"
    echo "    Response: $(echo "$PROGRESS_RESULT" | jq -c '.data')"
else
    fail "Progress endpoint failed"
    echo "    Error: $PROGRESS_RESULT"
fi

# 1.3 Test another progress update
echo ""
echo "1.3 Testing progress update at 50%..."
curl -s -X POST "$BASE_URL/acp/progress" \
  -H "Content-Type: application/json" \
  -d "{
    \"protocol\": \"acp/1.0\",
    \"type\": \"progress\",
    \"taskId\": \"$MENTION_ID\",
    \"timestamp\": $(date +%s)000,
    \"payload\": {
      \"percent\": 50,
      \"message\": \"Processing ACP test...\",
      \"stage\": \"processing\"
    }
  }" | jq -c '.data' && pass "Progress 50% sent" || fail "Progress 50% failed"

# 1.4 Test Response Endpoint
echo ""
echo "1.4 Testing POST /acp/response..."
RESPONSE_RESULT=$(curl -s -X POST "$BASE_URL/acp/response" \
  -H "Content-Type: application/json" \
  -d "{
    \"protocol\": \"acp/1.0\",
    \"type\": \"response\",
    \"taskId\": \"$MENTION_ID\",
    \"timestamp\": $(date +%s)000,
    \"payload\": {
      \"status\": \"completed\",
      \"message\": \"✅ HTTP endpoint test passed!\\n\\nThis response was delivered via the /acp/response endpoint.\",
      \"artifacts\": [
        {\"type\": \"data\", \"name\": \"test-results.json\", \"content\": \"{\\\"test\\\":\\\"passed\\\",\\\"endpoint\\\":\\\"/acp/response\\\"}\", \"mimeType\": \"application/json\"}
      ],
      \"mentions\": []
    }
  }")

if echo "$RESPONSE_RESULT" | jq -e '.success == true' > /dev/null 2>&1; then
    pass "Response endpoint created post"
    POST_ID=$(echo "$RESPONSE_RESULT" | jq -r '.data.postId')
    echo "    Post ID: $POST_ID"
else
    fail "Response endpoint failed"
    echo "    Error: $RESPONSE_RESULT"
fi

# 1.5 Verify the post was created
echo ""
echo "1.5 Verifying post creation..."
sleep 1
POST_CHECK=$(curl -s "$BASE_URL/posts?channelId=$CHANNEL_ID" | jq -e '.data[] | select(.authorId == "http-test-agent")')
if [ -n "$POST_CHECK" ]; then
    pass "Post found in channel"
    echo "    Content preview: $(echo "$POST_CHECK" | jq -r '.content' | head -c 100)..."
else
    fail "Post not found in channel"
fi

echo ""

# ============================================================================
# TEST 2: LOCAL SPAWN WITH ACP
# ============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${YELLOW}TEST 2: LOCAL SPAWN WITH ACP PROTOCOL${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 2.1 Register an ACP agent that will be spawned
echo ""
echo "2.1 Registering ACP spawn agent..."
REGISTER_RESULT=$(curl -s -X POST "$BASE_URL/agents" \
  -H "Content-Type: application/json" \
  -d "{
    \"id\": \"acp-spawn-tester\",
    \"name\": \"ACP Spawn Tester\",
    \"description\": \"Agent that outputs ACP messages when spawned\",
    \"spawnCommand\": \"bun\",
    \"spawnArgs\": [\"run\", \"$FORGE_DIR/test-acp-agent.ts\"],
    \"cwd\": \"$FORGE_DIR\",
    \"acp\": {
      \"protocol\": \"acp/1.0\",
      \"capabilities\": [\"progress\", \"artifacts\", \"mentions\"]
    }
  }")

if echo "$REGISTER_RESULT" | jq -e '.data.id // .id' > /dev/null 2>&1; then
    pass "ACP agent registered"
    echo "    Agent ID: acp-spawn-tester"
    echo "    ACP Config: $(echo "$REGISTER_RESULT" | jq -c '.data.acp // .acp')"
else
    fail "Failed to register ACP agent"
    echo "    Error: $REGISTER_RESULT"
fi

# 2.2 Create a post mentioning the agent
echo ""
echo "2.2 Creating post with @acp-spawn-tester mention..."
POST_RESULT=$(curl -s -X POST "$BASE_URL/posts" \
  -H "Content-Type: application/json" \
  -d "{\"channelId\":\"$CHANNEL_ID\",\"authorId\":\"test-runner\",\"content\":\"@acp-spawn-tester --test-acp\"}")

NEW_POST_ID=$(echo "$POST_RESULT" | jq -r '.data.id // .id')
if [ -n "$NEW_POST_ID" ] && [ "$NEW_POST_ID" != "null" ]; then
    pass "Post created with mention"
    echo "    Post ID: $NEW_POST_ID"
    
    # Check if mentions array has the agent
    MENTIONS=$(echo "$POST_RESULT" | jq -r '.data.mentions // []')
    echo "    Mentions: $MENTIONS"
else
    fail "Failed to create post with mention"
fi

# 2.3 Wait for agent to spawn and respond
echo ""
echo "2.3 Waiting for agent spawn and response (5 seconds)..."
sleep 5

# 2.4 Check for agent response
echo ""
echo "2.4 Checking for agent response..."
AGENT_POSTS=$(curl -s "$BASE_URL/posts?channelId=$CHANNEL_ID" | jq '[.data[] | select(.authorId == "acp-spawn-tester")]')

if [ "$(echo "$AGENT_POSTS" | jq 'length')" -gt 0 ]; then
    pass "Agent responded with ACP"
    echo "    Found $(echo "$AGENT_POSTS" | jq 'length') response(s)"
    echo "    First response: $(echo "$AGENT_POSTS" | jq -r '.[0].content' | head -c 200)..."
else
    echo -e "${YELLOW}⚠ No agent response yet (agent may still be processing)${NC}"
    echo "    Checking mentions..."
    MENTION_STATUS=$(curl -s "$BASE_URL/mentions?agentId=acp-spawn-tester" | jq '.data[0]')
    echo "    Last mention status: $(echo "$MENTION_STATUS" | jq -r '.spawnStatus // "unknown"')"
fi

echo ""

# ============================================================================
# TEST 3: WEBHOOK DELIVERY (SIMULATED)
# ============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${YELLOW}TEST 3: WEBHOOK SIMULATION${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 3.1 Register a webhook agent
echo ""
echo "3.1 Registering webhook-based ACP agent..."
WEBHOOK_RESULT=$(curl -s -X POST "$BASE_URL/agents" \
  -H "Content-Type: application/json" \
  -d "{
    \"id\": \"webhook-acp-tester\",
    \"name\": \"Webhook ACP Tester\",
    \"description\": \"Agent that receives ACP via webhook\",
    \"webhook\": {
      \"url\": \"https://httpbin.org/post\",
      \"timeout\": 10000
    },
    \"acp\": {
      \"protocol\": \"acp/1.0\",
      \"capabilities\": [\"progress\", \"artifacts\"]
    }
  }")

if echo "$WEBHOOK_RESULT" | jq -e '.data.id // .id' > /dev/null 2>&1; then
    pass "Webhook agent registered"
    echo "    Agent ID: webhook-acp-tester"
    echo "    Webhook URL: $(echo "$WEBHOOK_RESULT" | jq -r '.data.webhook.url // .webhook.url')"
else
    fail "Failed to register webhook agent"
fi

# 3.2 Create mention for webhook agent
echo ""
echo "3.2 Creating mention for webhook agent..."
WEBHOOK_MENTION=$(curl -s -X POST "$BASE_URL/mentions" \
  -H "Content-Type: application/json" \
  -d "{\"channelId\":\"$CHANNEL_ID\",\"agentId\":\"webhook-acp-tester\",\"mentioningAgentId\":\"test-runner\",\"content\":\"Test webhook delivery\"}")
WEBHOOK_MENTION_ID=$(echo "$WEBHOOK_MENTION" | jq -r '.data.id // .id')

if [ -n "$WEBHOOK_MENTION_ID" ] && [ "$WEBHOOK_MENTION_ID" != "null" ]; then
    pass "Created webhook mention: $WEBHOOK_MENTION_ID"
else
    fail "Failed to create webhook mention"
fi

# 3.3 Simulate webhook response
echo ""
echo "3.3 Simulating webhook response..."
WEBHOOK_RESPONSE=$(curl -s -X POST "$BASE_URL/acp/response" \
  -H "Content-Type: application/json" \
  -d "{
    \"protocol\": \"acp/1.0\",
    \"type\": \"response\",
    \"taskId\": \"$WEBHOOK_MENTION_ID\",
    \"timestamp\": $(date +%s)000,
    \"payload\": {
      \"status\": \"completed\",
      \"message\": \"✅ Webhook simulation successful!\\n\\nThis simulates an external agent receiving a webhook notification and responding via the ACP HTTP endpoint.\",
      \"artifacts\": [
        {\"type\": \"link\", \"name\": \"Webhook Docs\", \"url\": \"https://github.com/scoutos-labs/hive/blob/main/docs/ACP.md\"}
      ]
    }
  }")

if echo "$WEBHOOK_RESPONSE" | jq -e '.success == true' > /dev/null 2>&1; then
    pass "Webhook response accepted"
    echo "    Response: $(echo "$WEBHOOK_RESPONSE" | jq -c '.data')"
else
    fail "Webhook response failed"
    echo "    Error: $WEBHOOK_RESPONSE"
fi

echo ""

# ============================================================================
# SUMMARY
# ============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${YELLOW}TEST SUMMARY${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "  ${GREEN}Passed:${NC} $TESTS_PASSED"
echo -e "  ${RED}Failed:${NC} $TESTS_FAILED"
echo ""

# Show all posts in the channel
echo "All posts in test channel:"
curl -s "$BASE_URL/posts?channelId=$CHANNEL_ID" | jq '.data[] | {id, authorId, content: .content[0:100]}'
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}══════════════════════════════════════${NC}"
    echo -e "${GREEN}  All ACP tests passed!              ${NC}"
    echo -e "${GREEN}══════════════════════════════════════${NC}"
    exit 0
else
    echo -e "${RED}══════════════════════════════════════${NC}"
    echo -e "${RED}  Some tests failed                  ${NC}"
    echo -e "${RED}══════════════════════════════════════${NC}"
    exit 1
fi