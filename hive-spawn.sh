#!/bin/bash
# Hive spawn wrapper - executes tasks via OpenClaw gateway
# Supports --step flag for task decomposition with streaming JSON output
# Environment vars: MENTION_ID, ROOM_ID, ROOM_NAME, ROOM_CWD, POST_ID, FROM_AGENT, MENTION_CONTENT

set -e

# Log to stderr (not stdout) to avoid mention detection
log() {
    echo "$1" >&2
}

# Output streaming JSON to stdout (captured by Hive)
emit() {
    echo "$1"
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

# Parse JSON line and extract field
json_field() {
    echo "$1" | jq -r ".$2 // empty" 2>/dev/null
}

# Check for --step flag in message
if echo "$MENTION_CONTENT" | grep -qE '\-\-step\b'; then
    log "[hive-spawn] --step flag detected, running step decomposition"
    emit '{"type":"step_mode","enabled":true}'
    
    # Remove --step flag from message for planning
    TASK_MESSAGE=$(echo "$MENTION_CONTENT" | sed 's/ *--step//g')
    
    # ========================================
    # PHASE 1: Planning
    # ========================================
    log "[hive-spawn] Phase 1: Planning"
    emit '{"type":"phase","name":"planning"}'
    
    # Planner prompt - be EXTREMELY explicit that this is planning ONLY
    PLANNER_PROMPT="STOP. READ CAREFULLY.

You are NOT an executor. You are ONLY a planner.
DO NOT create files. DO NOT write code. DO NOT execute anything.
Your ONLY output should be a JSON plan.

The task is: $TASK_MESSAGE

Your response must be ONLY this JSON:
{\"type\":\"plan\",\"steps\":[{\"id\":\"step-1\",\"description\":\"First step description\",\"success_criteria\":[\"something that can be verified\"],\"dependencies\":[]}]}

If you create a file, write code, or do anything other than outputting JSON, you have FAILED.
Output the plan now. JSON ONLY. No other text."

    plan_output=$(openclaw agent --local --session-id "hive-$MENTION_ID-planner" --message "$PLANNER_PROMPT" --json 2>&1)
    
    if [[ $? -ne 0 ]]; then
        log "[hive-spawn] Planning phase failed"
        emit "{\"type\":\"error\",\"phase\":\"planning\",\"message\":\"Planner failed\"}"
        echo "$plan_output"
        exit 1
    fi
    
    # Extract plan line from output - handle openclaw's payloads format
    # The output is: {"payloads":[{"text":"json content here"}],...}
    # We need to extract the text and find the plan JSON
    
    plan_text=$(echo "$plan_output" | jq -r '.payloads[0].text // empty' 2>/dev/null)
    
    if [[ -n "$plan_text" ]]; then
        # Plan text found - extract JSON from it
        plan_line=$(echo "$plan_text" | grep -o '{"type":"plan"[^}]*"steps"[^]]*][^}]*}' | head -1)
    fi
    
    # Fallback: search raw output for plan
    if [[ -z "$plan_line" ]]; then
        plan_line=$(echo "$plan_output" | grep -o '{"type":"plan"[^}]*"steps"[^]]*][^}]*}' | head -1)
    fi
    
    # Fallback: look for plan in code blocks
    if [[ -z "$plan_line" ]]; then
        plan_line=$(echo "$plan_output" | sed -n '/```/,/```/p' | grep -o '{"type":"plan"[^}]*"steps"[^]]*][^}]*}' | head -1)
    fi
    
    if [[ -z "$plan_line" ]]; then
        log "[hive-spawn] Could not parse plan, falling back to single-step"
        emit '{"type":"fallback","reason":"plan_parse_failed"}'
        openclaw agent --local --session-id "hive-$MENTION_ID" --message "$TASK_MESSAGE" --json 2>&1
        exit $?
    fi
    
    # Parse step count
    step_count=$(echo "$plan_line" | jq -r '.steps | length // 0' 2>/dev/null)
    
    if [[ -z "$step_count" || "$step_count" -eq 0 ]]; then
        log "[hive-spawn] No steps found in plan"
        emit '{"type":"fallback","reason":"no_steps"}'
        openclaw agent --local --session-id "hive-$MENTION_ID" --message "$TASK_MESSAGE" --json 2>&1
        exit $?
    fi
    
    emit "$plan_line"
    emit "{\"type\":\"plan_parsed\",\"step_count\":$step_count}"
    log "[hive-spawn] Plan has $step_count steps"
    
    # ========================================
    # PHASE 2: Execute each step
    # ========================================
    emit '{"type":"phase","name":"execution"}'
    
    all_success=true
    current_step=1
    
    while [[ $current_step -le $step_count ]]; do
        # Extract step info
        step_desc=$(echo "$plan_line" | jq -r ".steps[$((current_step-1))].description // empty" 2>/dev/null)
        step_criteria=$(echo "$plan_line" | jq -r ".steps[$((current_step-1))].success_criteria // []" 2>/dev/null)
        
        emit "{\"type\":\"step_start\",\"step\":$current_step,\"total\":$step_count,\"description\":\"$step_desc\"}"
        log "[hive-spawn] Step $current_step/$step_count: ${step_desc:0:80}"
        
        # Build step prompt
        step_prompt="Execute this step EXACTLY. Do NOT do anything else.

Step: $step_desc
Success criteria: $step_criteria

Instructions:
1. Complete ONLY this step
2. Verify each success criterion is met
3. Report what was done

Output a JSON line when done:
{\"type\":\"step_result\",\"step\":$current_step,\"success\":true,\"summary\":\"what was done\"}
Or if failed:
{\"type\":\"step_result\",\"step\":$current_step,\"success\":false,\"error\":\"what went wrong\"}"

        # Execute step
        step_output=$(openclaw agent --local --session-id "hive-$MENTION_ID-step$current_step" --message "$step_prompt" --json 2>&1)
        step_exit=$?
        
        if [[ $step_exit -ne 0 ]]; then
            emit "{\"type\":\"step_error\",\"step\":$current_step,\"error\":\"Execution failed with exit code $step_exit\"}"
            log "[hive-spawn] Step $current_step failed"
            all_success=false
            break
        fi
        
        # Check for success in output
        if echo "$step_output" | grep -q '"success":true'; then
            emit "{\"type\":\"step_complete\",\"step\":$current_step,\"success\":true}"
            log "[hive-spawn] Step $current_step completed successfully"
        else
            emit "{\"type\":\"step_complete\",\"step\":$current_step,\"success\":false}"
            log "[hive-spawn] Step $current_step completed without success marker"
            all_success=false
        fi
        
        # Include step output
        echo "$step_output"
        
        current_step=$((current_step + 1))
    done
    
    # ========================================
    # PHASE 3: Final summary
    # ========================================
    if [[ "$all_success" == "true" ]]; then
        emit "{\"type\":\"done\",\"status\":\"success\",\"steps_executed\":$((current_step-1))}"
        log "[hive-spawn] All steps completed successfully"
    else
        emit "{\"type\":\"done\",\"status\":\"partial\",\"steps_executed\":$((current_step-1))}"
        log "[hive-spawn] Completed with some failures at step $current_step"
    fi
    
else
    # ========================================
    # Normal single-step execution (no --step)
    # ========================================
    openclaw agent --local --session-id "hive-$MENTION_ID" --message "$MENTION_CONTENT" --json 2>&1 || {
        log "[hive-spawn] Agent failed with exit code $?"
        exit 1
    }
fi

log "[hive-spawn] Task completed: $MENTION_ID"