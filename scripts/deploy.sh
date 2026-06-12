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
./scripts/build-dsp.sh
ssh "ableton@$HOST" "mkdir -p $REMOTE"
scp "$DIR/ui.js" "ableton@$HOST:$REMOTE/"
# NEVER overwrite dsp.so in place: it may be dlopen'd by the shim, and
# clobbering a mapped .so's inode corrupts its pages (crashes MoveOriginal).
# scp to a temp name + mv gives the new file a fresh inode while the old
# mapping stays intact; the movy UI then hot-reloads the engine by version.
scp "$DIR/dist/dsp.so" "ableton@$HOST:$REMOTE/dsp.so.new"
ssh "ableton@$HOST" "mv $REMOTE/dsp.so.new $REMOTE/dsp.so"
echo "deployed to $HOST"
