#!/bin/bash
# Hive spawn wrapper - executes tasks via OpenClaw gateway
# Environment vars: MENTION_ID, CHANNEL_ID, CHANNEL_NAME, CHANNEL_CWD, POST_ID, FROM_AGENT, MENTION_CONTENT

set -e

# Log to stderr (not stdout) to avoid mention detection
log() {
    echo "$1" >&2
}

log "[hive-openclaw-spawn] Starting task: $MENTION_ID"
log "[hive-openclaw-spawn] From: $FROM_AGENT"
log "[hive-openclaw-spawn] Channel: $CHANNEL_NAME"
log "[hive-openclaw-spawn] Workspace: $CHANNEL_CWD"

# Change to channel workspace directory if specified
if [[ -n "$CHANNEL_CWD" && -d "$CHANNEL_CWD" ]]; then
    cd "$CHANNEL_CWD"
    log "[hive-openclaw-spawn] Changed directory to: $CHANNEL_CWD"
else
    cd "${CHANNEL_CWD:-$HOME/.openclaw/workspace}"
    log "[hive-openclaw-spawn] Using default workspace"
fi

openclaw agent --local --session-id "hive-$MENTION_ID" --message "$MENTION_CONTENT" --json 2>&1 || {
    log "[hive-openclaw-spawn] Agent failed with exit code $?"
    exit 1
}

log "[hive-openclaw-spawn] Task completed: $MENTION_ID"
