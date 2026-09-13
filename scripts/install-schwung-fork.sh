#!/usr/bin/env bash
# install-schwung-fork.sh — put a fork branch's param_pages on the device, and
# RESTART THE STACK.
#
# Usage:
#   ./scripts/install-schwung-fork.sh <branch> [host] [--reboot]
#
#   <branch>   the fork branch to install FROM. The checkout named by
#              $SCHWUNG_DIR must be ON it; this script will not move one.
#   host       default move.local
#   --reboot   hand the whole host to the fork's own scripts/install.sh local
#              instead (see below); everything else about this script is skipped.
#
# A FILE COPY IS NOT AN INSTALL, and the failure is silent: shadow_ui's stderr
# is /dev/null and the device has no syslog, so debug.log says only
# "shadow_load_ui_module returned false". To see the real message, deploy a
# throwaway ui.js that does the import inside try/catch and console.log's the
# error — console.log reaches debug.log.
#
# WHY THE RESTART IS THE POINT. shadow_load_ui_module renames only `ui.js`, and
# QuickJS caches every module a tool IMPORTS for the life of the shadow_ui
# process — so a freshly copied `voices.mjs` links against the CACHED old
# `page_plan.mjs` and dies with "Could not find export 'navLabelsOf'". The copy
# that changed nothing visible is indistinguishable from the copy that was not
# needed. That is what `restart_move_stack` below is for, and it is the same
# verified body the device test tier uses (scripts/lib/restart-stack.py, as
# root — as `ableton` the pkill inside restart-move.sh is EPERM, `|| true`
# swallows it, and the stack stays up while the script exits 0).
#
# WHY param_pages AND NOT THE WHOLE HOST. That is what the fork branch carries
# for this migration (the ledger's SP-06: "installs a fork branch's param_pages
# onto the device *with the restart*"). Schwung's own scripts/install.sh is the
# reliable path for a WHOLE host — it builds, ships and REBOOTS — and it is what
# `--reboot` runs, because a fork that changes anything outside param_pages
# needs it: the restart above reloads modules, not the shim.
set -euo pipefail

MOVY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCHWUNG_DIR="${SCHWUNG_DIR:-$MOVY_DIR/../schwung}"
SRC="$SCHWUNG_DIR/src/shared/param_pages"
REMOTE_SHARED=/data/UserData/schwung/shared

# The whole leading comment block, so the usage text cannot go stale beside it.
usage() {
    awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"
    exit "${1:-1}"
}

BRANCH=""; HOST="move.local"; REBOOT=false
while [ $# -gt 0 ]; do
    case "$1" in
        -h|--help) usage 0 ;;
        --reboot)  REBOOT=true ;;
        -*)        echo "unknown option: $1" >&2; usage ;;
        *)         if [ -z "$BRANCH" ]; then BRANCH="$1"; else HOST="$1"; fi ;;
    esac
    shift
done
[ -n "$BRANCH" ] || usage
[ -d "$SRC" ] || { echo "no param_pages at $SRC (set SCHWUNG_DIR)" >&2; exit 1; }

# THE CHECKOUT IS THE ARGUMENT'S EVIDENCE, so it is not moved to match. The
# reference checkout is PINNED (movy/CLAUDE.md): switching its branch to install
# something would silently change what every other reader of that checkout — the
# tests especially — is reading. A fork on another branch goes in its own
# checkout, and $SCHWUNG_DIR points at it.
on="$(git -C "$SCHWUNG_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
if [ "$on" != "$BRANCH" ]; then
    echo "refusing: $SCHWUNG_DIR is on '$on', not '$BRANCH'." >&2
    echo "Clone the fork somewhere else and set SCHWUNG_DIR to it." >&2
    exit 1
fi
commit="$(git -C "$SCHWUNG_DIR" rev-parse --short HEAD)"

if [ "$REBOOT" = true ]; then
    # The whole host, by the procedure Schwung documents: install.sh local
    # builds this checkout, ships it, and REBOOTS the Move.
    echo "==> full host install from $SCHWUNG_DIR ($BRANCH $commit)"
    exec "$SCHWUNG_DIR/scripts/install.sh" local --skip-confirmation
fi

echo "==> $BRANCH $commit -> $HOST:$REMOTE_SHARED/param_pages"

# Staged and swapped inside one ssh: a half-copied param_pages is the link error
# this script exists to avoid, and the swap is a rename so it is never partial.
# The replaced tree is kept as `param_pages.prev` rather than deleted — one
# directory, and the way back if the branch is the wrong one.
ssh -o ConnectTimeout=5 "ableton@$HOST" \
    "rm -rf $REMOTE_SHARED/param_pages.new && mkdir -p $REMOTE_SHARED/param_pages.new"
scp -q -r "$SRC/." "ableton@$HOST:$REMOTE_SHARED/param_pages.new/"
ssh -o ConnectTimeout=5 "ableton@$HOST" \
    "cd $REMOTE_SHARED && rm -rf param_pages.prev && \
     mv param_pages param_pages.prev && mv param_pages.new param_pages && \
     ls param_pages | wc -l"

# shellcheck source=lib/restart-stack.sh
. "$MOVY_DIR/scripts/lib/restart-stack.sh"
restart_move_stack "$HOST"
echo "==> installed $BRANCH $commit; rollback: mv $REMOTE_SHARED/param_pages{.prev,}"
