#!/usr/bin/env bash
# Sync vendored Python agent from ../token-monitor-agent
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$(cd "$ROOT/../token-monitor-agent" && pwd)"
DEST="$ROOT/vendor/agent"

mkdir -p "$DEST"
rm -rf "$DEST/__pycache__"
cp "$SRC/agent.py" "$DEST/agent.py"
cp "$SRC/requirements.txt" "$DEST/requirements.txt"
rm -rf "$DEST/__pycache__"
echo "Synced vendor/agent from token-monitor-agent/"
ls -la "$DEST"
