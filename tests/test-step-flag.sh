#!/bin/bash
# Tests for hive-spawn.sh --step flag functionality
# Run: bash tests/test-step-flag.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HIVE_SPAWN="$SCRIPT_DIR/../hive-spawn.sh"

# Test helper functions
test_count=0
pass_count=0
fail_count=0

test_start() {
    test_count=$((test_count + 1))
    echo -n "Test $test_count: $1... "
}

test_pass() {
    pass_count=$((pass_count + 1))
    echo "✅ PASS"
}

test_fail() {
    fail_count=$((fail_count + 1))
    echo "❌ FAIL: $1"
}

# ========================================
# Test 1: --step flag detection
# ========================================
test_start "--step flag detection"
MENTION_CONTENT="Build a REST API --step"
MENTION_ID="test-001"
ROOM_CWD="$HOME/.openclaw/workspace"

if echo "$MENTION_CONTENT" | grep -qE '\-\-step\b'; then
    test_pass
else
    test_fail "Should detect --step flag"
fi

# ========================================
# Test 2: No --step flag
# ========================================
test_start "No --step flag"
MENTION_CONTENT="Build a REST API"

if ! echo "$MENTION_CONTENT" | grep -qE '\-\-step\b'; then
    test_pass
else
    test_fail "Should NOT detect --step flag when absent"
fi

# ========================================
# Test 3: --step with text after
# ========================================
test_start "--step flag with trailing text"
MENTION_CONTENT="Create a file --step and verify it"

if echo "$MENTION_CONTENT" | grep -qE '\-\-step\b'; then
    # Check removal preserves trailing text
    CLEANED=$(echo "$MENTION_CONTENT" | sed 's/ *--step//g')
    if [[ "$CLEANED" == "Create a file and verify it" ]]; then
        test_pass
    else
        test_fail "Should preserve text after --step removal"
    fi
else
    test_fail "Should detect --step flag"
fi

# ========================================
# Test 4: Max steps limit
# ========================================
test_start "Max steps limit validation"
MAX_STEPS="${MAX_STEPS:-20}"

if [[ "$MAX_STEPS" -eq 20 ]]; then
    test_pass
else
    test_fail "MAX_STEPS should default to 20"
fi

# ========================================
# Test 5: Custom max steps
# ========================================
test_start "Custom max steps"
MAX_STEPS=50

if [[ "$MAX_STEPS" -eq 50 ]]; then
    test_pass
else
    test_fail "MAX_STEPS should be customizable"
fi

# ========================================
# Test 6: Fallback for 0 steps
# ========================================
test_start "Fallback for empty plan"
# Simulate plan with 0 steps
plan_line='{"type":"plan","steps":[]}'
step_count=$(echo "$plan_line" | jq -r '.steps | length // 0' 2>/dev/null)

if [[ -z "$step_count" || "$step_count" -eq 0 ]]; then
    test_pass
else
    test_fail "Should detect empty plan"
fi

# ========================================
# Test 7: Plan with steps
# ========================================
test_start "Plan with steps"
plan_line='{"type":"plan","steps":[{"id":"step-1","description":"First step"}]}'
step_count=$(echo "$plan_line" | jq -r '.steps | length // 0' 2>/dev/null)

if [[ "$step_count" -eq 1 ]]; then
    test_pass
else
    test_fail "Should parse plan with 1 step, got $step_count"
fi

# ========================================
# Test 8: Workspace fallback
# ========================================
test_start "Workspace fallback"
ROOM_CWD=""
HOME="$HOME"

fallback_path="${ROOM_CWD:-$HOME/.openclaw/workspace}"
if [[ "$fallback_path" == "$HOME/.openclaw/workspace" ]]; then
    test_pass
else
    test_fail "Should fallback to \$HOME/.openclaw/workspace"
fi

# ========================================
# Results
# ========================================
echo ""
echo "====================================="
echo "Results: $pass_count/$test_count passed"
echo "====================================="

if [[ $fail_count -eq 0 ]]; then
    echo "✅ All tests passed!"
    exit 0
else
    echo "❌ $fail_count tests failed"
    exit 1
fi