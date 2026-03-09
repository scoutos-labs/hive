#!/bin/bash
# Start Hive if not running

HIVE_DIR="/Users/mastercontrol/.openclaw/workspace/hive"
HIVE_LOG="/tmp/hive.log"

# Check if already running
if pgrep -f "hive-server" > /dev/null 2>&1; then
    echo "Hive already running"
    exit 0
fi

# Start Hive
cd "$HIVE_DIR" && ./hive-server > "$HIVE_LOG" 2>&1 &
sleep 2

# Verify it started
if curl -s http://127.0.0.1:7373/health > /dev/null 2>&1; then
    echo "Hive started successfully"
    exit 0
else
    echo "Failed to start Hive"
    cat "$HIVE_LOG"
    exit 1
fi