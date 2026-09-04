#!/usr/bin/env bash
# deploy.sh — build and copy ui.js to the device
#
# esbuild bundles all TypeScript (model, renderer, font, modules) into ui.js.
# ui_font.mjs is no longer deployed separately.
#
# Usage: ./scripts/deploy.sh [--release] [--no-restart] [host]   (default: move.local)
#
# A CHANGED dsp.so restarts the Move stack, because nothing else makes it run:
# the shim dlopens the engine by path and glibc keeps handing back the library
# it already loaded under that path until MoveOriginal is gone. --no-restart
# ships the files and leaves the old engine running (ui.js alone reloads on the
# next tool open, so it is fine for a UI-only change).
#
# --release deploys the bundle that SHIPS: the Settings page then lists only the
# two settings marked `release`, not every flag. Same build and same gate
# assertion the store tarball uses (scripts/lib/build-release-ui.sh) — without
# it, a "release" deploy would be a debug bundle wearing the name.
set -euo pipefail
RELEASE=0
RESTART=1
while [[ "${1:-}" == --* ]]; do
    case "$1" in
        --release)    RELEASE=1 ;;
        --no-restart) RESTART=0 ;;
        *) echo "unknown option: $1" >&2; exit 1 ;;
    esac
    shift
done
HOST="${1:-move.local}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="/data/UserData/schwung/modules/tools/movy"

cd "$DIR"
# shellcheck source=lib/build-release-ui.sh
. "$DIR/scripts/lib/build-release-ui.sh"
# shellcheck source=lib/restart-stack.sh
. "$DIR/scripts/lib/restart-stack.sh"
if [[ "$RELEASE" == 1 ]]; then build_release_ui "$DIR"; else node build/device.mjs; fi
./scripts/build-dsp.sh
ssh "ableton@$HOST" "mkdir -p $REMOTE"
scp "$DIR/ui.js" "ableton@$HOST:$REMOTE/"
# Override configs for modules whose own movy_config.json movy cannot use (see
# OVERRIDES_MODULE_FILE). Data files rather than imports, so ui.js does not
# carry 91 KB of JSON through the QuickJS parser on every tool open. A deploy
# that skips them leaves those kits on the layout the override replaces.
ssh "ableton@$HOST" "mkdir -p $REMOTE/configs"
scp "$DIR"/src/module-configs/*.json "ableton@$HOST:$REMOTE/configs/"
# Ship module.json too — capabilities (e.g. suspend_self_managed) live here and
# are read by the host at module-scan time. NOTE: the host caches module
# metadata at boot, so a *capability* change only takes effect after a host
# reboot/rescan (ui.js/dsp.so hot-reload without one).
scp "$DIR/module.json" "ableton@$HOST:$REMOTE/"
# NEVER overwrite dsp.so in place: it may be dlopen'd by the shim, and
# clobbering a mapped .so's inode corrupts its pages (crashes MoveOriginal).
# scp to a temp name + mv gives the new file a fresh inode while the old
# mapping stays intact.
#
# The fresh inode protects the RUNNING engine; it does not deliver the new one.
# The shim dlopens this path, and glibc returns the library already loaded under
# it, so the version gate re-issues a load the shim answers with the old binary
# for ever. Hence the md5 comparison and the restart below — without it a
# redeployed engine is simply not the one running, which cost a whole session of
# "the fix is deployed and does nothing".
BEFORE=$(ssh "ableton@$HOST" "md5sum $REMOTE/dsp.so 2>/dev/null | cut -d' ' -f1" || true)
scp "$DIR/dist/dsp.so" "ableton@$HOST:$REMOTE/dsp.so.new"
ssh "ableton@$HOST" "mv $REMOTE/dsp.so.new $REMOTE/dsp.so"
AFTER=$(ssh "ableton@$HOST" "md5sum $REMOTE/dsp.so | cut -d' ' -f1")
echo "deployed $([[ "$RELEASE" == 1 ]] && echo 'RELEASE' || echo 'debug') build to $HOST"

if [[ "$BEFORE" == "$AFTER" ]]; then
    echo "engine unchanged — no restart needed"
elif [[ "$RESTART" == 0 ]]; then
    echo "THE ENGINE CHANGED BUT THE STACK WAS NOT RESTARTED (--no-restart):"
    echo "  the OLD dsp.so is still running. Restart before trusting any result."
else
    echo "engine changed — restarting the Move stack so it is the one that runs"
    if ! restart_move_stack "$HOST"; then
        echo "RESTART FAILED — THE OLD ENGINE IS STILL RUNNING ON $HOST." >&2
        echo "  Restart it as root (see scripts/lib/restart-stack.sh), then re-run this." >&2
        exit 1
    fi
fi
