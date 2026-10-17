#!/usr/bin/env bash
# deploy.sh — build and copy ui.js to the device
#
# esbuild bundles all TypeScript (model, renderer, font, modules) into ui.js.
# ui_font.mjs is no longer deployed separately.
#
# Usage: ./scripts/deploy.sh [host]   (default: move.local)
#
# movy is a standalone module (plan WP8): movy-host loads dsp.so and ui.js at
# every open, so a deploy needs no Move restart. A movy-host that is RUNNING
# keeps the build it started with until it is closed and reopened.
set -euo pipefail
HOST="${1:-move.local}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="/data/UserData/schwung/modules/tools/movy"

cd "$DIR"
# shellcheck source=lib/deploy-host.sh
. "$DIR/scripts/lib/deploy-host.sh"
# MOVY_PREBUILT: scripts/vdev.sh tier built everything once for all its shards.
if [[ "${MOVY_PREBUILT:-0}" != 1 ]]; then
    node build/device.mjs
    ./scripts/build-dsp.sh
fi
ssh "ableton@$HOST" "mkdir -p $REMOTE"
scp "$DIR/ui.js" "ableton@$HOST:$REMOTE/"
# Override configs for modules whose own movy_config.json movy cannot use (see
# OVERRIDES_MODULE_FILE). Data files rather than imports, so ui.js does not
# carry 91 KB of JSON through the QuickJS parser on every tool open. A deploy
# that skips them leaves those kits on the layout the override replaces.
ssh "ableton@$HOST" "mkdir -p $REMOTE/configs"
scp "$DIR"/src/module-configs/*.json "ableton@$HOST:$REMOTE/configs/"
# NEVER overwrite dsp.so in place: a running movy-host has it mapped, and
# clobbering a mapped .so's inode corrupts its pages. scp to a temp name + mv
# gives the new file a fresh inode while the old mapping stays intact.
# chain-host.so rides the same rule: the engine dlopens a copy of it.
scp "$DIR/dist/dsp.so" "ableton@$HOST:$REMOTE/dsp.so.new"
scp "$DIR/dist/chain-host.so" "ableton@$HOST:$REMOTE/chain-host.so.new"
ssh "ableton@$HOST" "mv $REMOTE/dsp.so.new $REMOTE/dsp.so && mv $REMOTE/chain-host.so.new $REMOTE/chain-host.so"
deploy_host "$HOST"
echo "deployed to $HOST"
if ssh "ableton@$HOST" "pidof movy-host" >/dev/null 2>&1; then
    echo "MOVY IS OPEN ON $HOST: it runs the OLD build until it is closed and reopened."
fi
