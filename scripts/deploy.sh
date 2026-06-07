#!/usr/bin/env bash
# deploy.sh — copy ui.js and ui_font.mjs to the device
#
# All movy logic (model, renderer, module configs) lives in ui.js so that
# shadow_load_ui_module re-evaluates everything fresh on each tool open.
# The view/ and modules/ subdirs are only used by browser tests.
#
# Usage: ./scripts/deploy.sh [host]   (default: move.local)
set -euo pipefail
HOST="${1:-move.local}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="/data/UserData/schwung/modules/tools/movy"
ssh "ableton@$HOST" "mkdir -p $REMOTE"
scp "$DIR/ui.js" "$DIR/ui_font.mjs" "ableton@$HOST:$REMOTE/"
echo "deployed to $HOST"
