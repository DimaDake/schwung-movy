#!/usr/bin/env bash
# deploy.sh — copy ui.js and ui_font.mjs to the device
# Usage: ./scripts/deploy.sh [host]   (default: move.local)
set -euo pipefail
HOST="${1:-move.local}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="/data/UserData/schwung/modules/tools/movy"
ssh "ableton@$HOST" "mkdir -p $REMOTE/view"
scp "$DIR/ui.js" "$DIR/ui_font.mjs" "ableton@$HOST:$REMOTE/"
scp "$DIR/view/model.mjs" "$DIR/view/renderer.mjs" "ableton@$HOST:$REMOTE/view/"
echo "deployed to $HOST"
