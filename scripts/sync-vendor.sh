#!/usr/bin/env bash
# Sync vendored Python agent from ../token-monitor-agent (optional in standalone repo)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/../token-monitor-agent"
DEST="$ROOT/vendor/agent"

if [ ! -f "$SRC/agent.py" ]; then
  echo "No sibling token-monitor-agent at $SRC — keeping existing vendor/agent"
  if [ ! -f "$DEST/agent.py" ]; then
    echo "error: vendor/agent/agent.py missing" >&2
    exit 1
  fi
  exit 0
fi

mkdir -p "$DEST"
rm -rf "$DEST/__pycache__"
cp "$SRC/agent.py" "$DEST/agent.py"
cp "$SRC/requirements.txt" "$DEST/requirements.txt"
rm -rf "$DEST/__pycache__"
echo "Synced vendor/agent from token-monitor-agent/"
ls -la "$DEST"
