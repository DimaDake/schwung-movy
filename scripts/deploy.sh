#!/usr/bin/env bash
# deploy.sh — copy ui.js and ui_font.mjs to the device
# Usage: ./scripts/deploy.sh [host]   (default: move.local)
set -euo pipefail
HOST="${1:-move.local}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
scp "$DIR/ui.js" "$DIR/ui_font.mjs" "ableton@$HOST:/data/UserData/schwung/modules/tools/movy/"
echo "deployed to $HOST"
