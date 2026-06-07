#!/usr/bin/env bash
# deploy.sh — build and copy ui.js to the device
#
# esbuild bundles all TypeScript (model, renderer, font, modules) into ui.js.
# ui_font.mjs is no longer deployed separately.
#
# Usage: ./scripts/deploy.sh [host]   (default: move.local)
set -euo pipefail
HOST="${1:-move.local}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="/data/UserData/schwung/modules/tools/movy"

cd "$DIR"
node build/device.mjs
ssh "ableton@$HOST" "mkdir -p $REMOTE"
scp "$DIR/ui.js" "ableton@$HOST:$REMOTE/"
echo "deployed to $HOST"
