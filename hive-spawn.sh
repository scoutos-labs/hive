#!/bin/bash
# Hive spawn wrapper - executes tasks via OpenClaw gateway
# Environment vars: MENTION_ID, ROOM_ID, ROOM_NAME, ROOM_CWD, POST_ID, FROM_AGENT, MENTION_CONTENT

set -e

# Log to stderr (not stdout) to avoid mention detection
log() {
    echo "$1" >&2
}

log "[hive-spawn] Starting task: $MENTION_ID"
log "[hive-spawn] From: $FROM_AGENT"
log "[hive-spawn] Room: $ROOM_NAME"
log "[hive-spawn] Workspace: $ROOM_CWD"

# Change to room's workspace directory if specified
if [[ -n "$ROOM_CWD" && -d "$ROOM_CWD" ]]; then
    cd "$ROOM_CWD"
    log "[hive-spawn] Changed directory to: $ROOM_CWD"
else
    cd /Users/twilson63/.openclaw/workspace
    log "[hive-spawn] Using default workspace"
fi

# Check for --step flag in message
if echo "$MENTION_CONTENT" | grep -q '\-\-step\>'; then
    log "[hive-spawn] --step flag detected, running step decomposition"
    
    # Remove --step flag from message for planning
    TASK_MESSAGE=$(echo "$MENTION_CONTENT" | sed 's/ *--step//g')
    
    # ========================================
    # PHASE 1: Planning
    # ========================================
    log "[hive-spawn] Phase 1: Planning"
    
    PLANNER_PROMPT="You are a task planner. Break down the following task into sequential steps.

TASK: $TASK_MESSAGE

For each step, provide:
1. A clear description
2. Success criteria (verifiable conditions)
3. Dependencies on previous steps (if any)

Output a JSON array of steps in this exact format:
\`\`\`json
{
  \"steps\": [
    {
      \"id\": \"step-1\",
      \"description\": \"...\"，
      \"success_criteria\": [\"...\"],
      \"dependencies\": []
    }
  ]
}
\`\`\`

Only output the JSON, no other text."

    PLAN_OUTPUT=$(openclaw agent --local --session-id "hive-$MENTION_ID-planner" --message "$PLANNER_PROMPT" --json 2>&1)
    
    if [[ $? -ne 0 ]]; then
        log "[hive-spawn] Planning phase failed"
        echo "$PLAN_OUTPUT"
        exit 1
    fi
    
    # Extract steps from plan
    STEPS=$(echo "$PLAN_OUTPUT" | grep -o '{"steps":.*}' | head -1)
    
    if [[ -z "$STEPS" ]]; then
        log "[hive-spawn] Could not parse plan, falling back to single-step execution"
        echo "$PLAN_OUTPUT"
        exit 0
    fi
    
    log "[hive-spawn] Plan received, extracting steps"
    
    # Count steps
    STEP_COUNT=$(echo "$STEPS" | grep -o '"id":' | wc -l | tr -d ' ')
    log "[hive-spawn] Found $STEP_COUNT steps"
    
    # ========================================
    # PHASE 2: Execute each step
    # ========================================
    
    CURRENT_STEP=1
    STEP_IDS=$(echo "$STEPS" | grep -o '"step-[0-9]*"' | sort -u)
    
    for STEP_ID in $STEP_IDS; do
        # Extract step description
        STEP_DESC=$(echo "$STEPS" | grep -A5 "\"$STEP_ID\"" | grep -o '"description": *"[^"]*"' | head -1 | sed 's/"description": *"\(.*\)"/\1/')
        STEP_CRITERIA=$(echo "$STEPS" | grep -A10 "\"$STEP_ID\"" | grep -o '"success_criteria": *\[[^\]]*\]' | head -1)
        
        log "[hive-spawn] Step $CURRENT_STEP/$STEP_COUNT: $STEP_DESC"
        
        # Build step-specific prompt
        STEP_PROMPT="Execute this step: $STEP_DESC

Success criteria: $STEP_CRITERIA

Complete ONLY this step. Verify success criteria are met before finishing.
Report what was done and whether each criterion passed."

        # Execute step
        STEP_OUTPUT=$(openclaw agent --local --session-id "hive-$MENTION_ID-step$CURRENT_STEP" --message "$STEP_PROMPT" --json 2>&1)
        
        if [[ $? -ne 0 ]]; then
            log "[hive-spawn] Step $CURRENT_STEP failed"
            echo "Step $CURRENT_STEP FAILED:\n$STEP_OUTPUT"
            exit 1
        fi
        
        log "[hive-spawn] Step $CURRENT_STEP completed"
        
        # Output step result for Hive to capture
        echo "### Step $CURRENT_STEP: $STEP_DESC"
        echo "$STEP_OUTPUT"
        echo ""
        
        CURRENT_STEP=$((CURRENT_STEP + 1))
    done
    
    log "[hive-spawn] All steps completed"
    echo ""
    echo "=== TASK COMPLETED ==="
    echo "Steps executed: $((CURRENT_STEP - 1))"
    
else
    # ========================================
    # Normal single-step execution
    # ========================================
    openclaw agent --local --session-id "hive-$MENTION_ID" --message "$MENTION_CONTENT" --json 2>&1 || {
        log "[hive-spawn] Agent failed with exit code $?"
        exit 1
    }
fi

log "[hive-spawn] Task completed: $MENTION_ID"