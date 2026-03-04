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

Output ONLY valid JSON, no markdown, no code blocks, no other text:
{\"steps\":[{\"id\":\"step-1\",\"description\":\"...\",\"success_criteria\":[\"...\"],\"dependencies\":[]}]}

Analyze the task and output the JSON plan now."

    plan_raw=$(openclaw agent --local --session-id "hive-$MENTION_ID-planner" --message "$PLANNER_PROMPT" --json 2>&1)
    
    if [[ $? -ne 0 ]]; then
        log "[hive-spawn] Planning phase failed"
        echo "$plan_raw"
        exit 1
    fi
    
    # Extract JSON from response - handle various output formats
    # First try: extract from markdown code blocks
    plan_json=$(echo "$plan_raw" | sed -n '/```/,/```/p' | sed '1d;$d' | tr -d '\n' | tr -d '\r')
    
    # Second try: find JSON object in raw output
    if [[ -z "$plan_json" || ! "$plan_json" =~ \"steps\" ]]; then
        plan_json=$(echo "$plan_raw" | grep -o '{[^{}]*"steps"[^{}]*\[[^][]*\][^{}]*}' | head -1)
    fi
    
    # Third try: extract between first { and last }
    if [[ -z "$plan_json" || ! "$plan_json" =~ \"steps\" ]]; then
        plan_json=$(echo "$plan_raw" | sed -n 's/.*\({.*"steps".*}\).*/\1/p' | head -1)
    fi
    
    log "[hive-spawn] Extracted plan: ${plan_json:0:200}..."
    
    # Parse steps using jq if available, else basic parsing
    if command -v jq &> /dev/null && [[ -n "$plan_json" ]]; then
        step_count=$(echo "$plan_json" | jq '.steps | length' 2>/dev/null || echo "1")
    else
        # Fallback: count step-N patterns
        step_count=$(echo "$plan_json" | grep -o '"step-[0-9]*"' | wc -l | tr -d ' ')
    fi
    
    if [[ -z "$plan_json" || "$step_count" -eq 0 ]]; then
        log "[hive-spawn] Could not parse plan, falling back to single-step execution"
        openclaw agent --local --session-id "hive-$MENTION_ID" --message "$TASK_MESSAGE" --json 2>&1
        exit $?
    fi
    
    log "[hive-spawn] Plan has $step_count steps"
    
    # ========================================
    # PHASE 2: Execute each step
    # ========================================
    
    all_output=""
    current_step=1
    
    while [[ $current_step -le $step_count ]]; do
        # Extract step description
        if command -v jq &> /dev/null; then
            step_desc=$(echo "$plan_json" | jq -r ".steps[$((current_step-1))].description" 2>/dev/null)
            step_criteria=$(echo "$plan_json" | jq -r ".steps[$((current_step-1))].success_criteria[]" 2>/dev/null | tr '\n' ', ')
        else
            # Basic extraction
            step_desc=$(echo "$plan_json" | grep -o "\"step-$current_step\"" -A5 | grep -o '"description":"[^"]*"' | head -1 | sed 's/"description":"//;s/"$//')
        fi
        
        log "[hive-spawn] Step $current_step/$step_count: ${step_desc:0:100}"
        
        # Build step-specific prompt
        step_prompt="Execute this step EXACTLY: $step_desc

Success criteria: $step_criteria

Complete ONLY this step. Do NOT do anything else.
Report what was done and whether criteria passed."

        # Execute step
        step_output=$(openclaw agent --local --session-id "hive-$MENTION_ID-step$current_step" --message "$step_prompt" --json 2>&1)
        
        if [[ $? -ne 0 ]]; then
            log "[hive-spawn] Step $current_step failed"
            echo "### Step $current_step FAILED ###"
            echo "$step_output"
            exit 1
        fi
        
        log "[hive-spawn] Step $current_step completed successfully"
        
        # Append to combined output
        all_output+="### Step $current_step: ${step_desc:0:80} ###\n$step_output\n\n"
        
        current_step=$((current_step + 1))
    done
    
    log "[hive-spawn] All $step_count steps completed"
    echo "$all_output"
    echo ""
    echo "=== TASK COMPLETED ==="
    echo "Steps executed: $step_count"
    
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