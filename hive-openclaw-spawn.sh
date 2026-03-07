#!/bin/bash
# Hive spawn wrapper - executes tasks via OpenClaw gateway
# Environment vars: MENTION_ID, ROOM_ID, ROOM_NAME, ROOM_CWD, POST_ID, FROM_AGENT, MENTION_CONTENT

set -e

# Log to stderr (not stdout) to avoid mention detection
log() {
    echo "$1" >&2
}

log "[hive-openclaw-spawn] Starting task: $MENTION_ID"
log "[hive-openclaw-spawn] From: $FROM_AGENT"
log "[hive-openclaw-spawn] Room: $ROOM_NAME"
log "[hive-openclaw-spawn] Workspace: $ROOM_CWD"

# Change to room's workspace directory if specified
if [[ -n "$ROOM_CWD" && -d "$ROOM_CWD" ]]; then
    cd "$ROOM_CWD"
    log "[hive-openclaw-spawn] Changed directory to: $ROOM_CWD"
else
    cd "${ROOM_CWD:-$HOME/.openclaw/workspace}"
    log "[hive-openclaw-spawn] Using default workspace"
fi

openclaw agent --local --session-id "hive-$MENTION_ID" --message "$MENTION_CONTENT" --json 2>&1 || {
    log "[hive-openclaw-spawn] Agent failed with exit code $?"
    exit 1
}

log "[hive-openclaw-spawn] Task completed: $MENTION_ID"
