#!/usr/bin/env bash
# test-versions.sh — a set written by an EARLIER movy keeps its work when this
# build opens it, and a version can be restored from the device.
#
# The local suites prove the logic against captured files. This proves the two
# things they cannot: that a real device opening a real pre-feature set adopts
# it WITHOUT touching the state, and that a restore driven by the actual
# gestures reaches THE ENGINE rather than only the disk.
#
# How the engine round trip is asserted with disk reads only: after the restore,
# movy's autosave writes back what `host_module_get_param('state')` returns —
# the engine's own copy. So if the file still holds the clips several seconds
# later, they came out of the engine. A restore that wrote only the disk would
# be erased by that same autosave, which is exactly the failure worth catching.
set -euo pipefail
HOST="${1:-move.local}"
MOVY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/test-set.sh
source "$MOVY_DIR/scripts/lib/test-set.sh"
test_set_begin
trap test_set_end EXIT INT TERM

SETS=/data/UserData/schwung/modules/tools/movy/sets
FIX="$MOVY_DIR/browser-test/fixtures/old-sets/movy-chains"
PASS=0; FAIL=0
ok()  { echo -e "  \033[0;32m✓\033[0m $1"; PASS=$((PASS+1)); }
bad() { echo -e "  \033[0;31m✗\033[0m $1"; FAIL=$((FAIL+1)); }

clips_now() { ts_ssh "grep -c '^cl ' '$(ts_seq_path)' 2>/dev/null || echo 0" | tr -d ' \r\n'; }

# Block until the set file's clip count matches, or give up. The autosave is
# tick-based and the device rate moves with load, so any fixed sleep is a race —
# the reason ts_wait_ui exists, and the same reason applies here.
wait_clips() {
    local want="$1" waited=0 got
    while [ $waited -lt 40 ]; do
        got=$(clips_now)
        [ "${got:-0}" "$2" "$want" ] && return 0
        sleep 2; waited=$((waited + 2))
    done
    return 1
}

# ── Seed the PRE-FEATURE layout, with movy closed ───────────────────────────
# The running tool autosaves over these files, so a fixture written under it is
# a copy of whatever the last test left.
ts_phase_start "seed an old-format set"
ts_close_movy
UUID=$(ts_active_uuid)
[ -n "$UUID" ] || { echo "test-versions: no active set" >&2; exit 1; }
D="$SETS/$UUID"
ts_ssh "mkdir -p $D"
# A previous run's version store must go or adoption cannot be observed: this
# set would already have a history and the "adopted" entry would never appear.
# Try as ableton first — on a set movy has not yet versioned, v/ does not exist
# and no root is needed — and fall back to root for the root-owned tree movy
# leaves behind on every device it has actually run on (see ts_ssh_root).
ts_ssh "rm -rf $D/v $D/versions.json" 2>/dev/null \
    || ts_ssh_root "rm -rf $D/v $D/versions.json" \
    || { echo "test-versions: cannot clear $D/v — movy writes it as root and root ssh is unavailable" >&2; exit 1; }
scp -q "$FIX/seq-state.json" "ableton@$HOST:$D/seq-state.json"
scp -q "$FIX/seq-state.json" "ableton@$HOST:$D/seq-state.1.json"
scp -q "$FIX/ui-state.json"  "ableton@$HOST:$D/ui-state.json"
BEFORE=$(ts_ssh "md5sum $D/seq-state.json | cut -d' ' -f1")
ts_ssh '> /data/UserData/schwung/debug.log'
ts_phase_end

# ── 1. Opening it adopts, and does not disturb what it adopted ──────────────
ts_phase_start "open movy on the old set"
ts_open_movy
sleep 10   # the open capture rides the load, behind the splash
ts_phase_end

if ts_ssh "test -f $D/versions.json"; then ok "versions.json created"
else bad "no index written"; fi

# The ADOPTED entry specifically. The open capture writes an index too, so
# "a history exists" is satisfied with adoption removed entirely.
if ts_ssh "cat $D/versions.json 2>/dev/null" | qgrep '"why":"adopted"'; then
    ok "the old set's own files were adopted"
else
    bad "nothing was adopted from the pre-feature files"
fi
if ts_ssh "test -d $D/v"; then ok "and copied out of the rotation into v/"
else bad "no version directory"; fi

AFTER=$(ts_ssh "md5sum $D/seq-state.json | cut -d' ' -f1")
if [ "$BEFORE" = "$AFTER" ]; then ok "adoption did not modify the state it adopted"
else bad "adoption modified the current state"; fi

# The set still plays: its clips survived the open.
HAVE=$(clips_now)
if [ "${HAVE:-0}" -ge 1 ]; then ok "the old set opened with $HAVE clip(s)"
else bad "the old set's clips did not survive the open"; fi

# ── 2. Wipe a clip through the engine, and let the autosave carry it ────────
ts_phase_start "delete track 0's clip"
node "$MOVY_DIR/scripts/engine-param.mjs" set cmd "clipdel 0" "$HOST" >/dev/null 2>&1 || true
if wait_clips "$HAVE" -lt; then ok "the deletion reached disk (fewer clips than before)"
else bad "the clip deletion never landed — the rest of this suite proves nothing"; fi
ts_phase_end

# ── 3. Restore it back, through the real gestures ───────────────────────────
# Shift+Step 2 opens Settings (STEP_FLAGS = 1, so note 16 + 1). Then jog down
# far enough to CLAMP on the last row, which is BACKUPS — clamping is what makes
# this independent of how many flags the build shows. Then three clicks: open
# the page, arm the confirm on the newest version, perform the restore.
ts_phase_start "restore via Settings -> BACKUPS"
ts_send "0x0B:0xB0:49:127:0.08" "0x09:0x90:17:127:0.08" \
        "0x08:0x80:17:0:0.08"   "0x0B:0xB0:49:0:0.3"
JOGS=()
for _ in $(seq 1 40); do JOGS+=("0x0B:0xB0:14:1:0.02"); done
ts_send "${JOGS[@]}"
sleep 0.5
ts_send "0x0B:0xB0:3:127:0.15" "0x0B:0xB0:3:0:0.4"     # open BACKUPS
ts_send "0x0B:0xB0:3:127:0.15" "0x0B:0xB0:3:0:0.4"     # arm the confirm
ts_send "0x0B:0xB0:3:127:0.15" "0x0B:0xB0:3:0:0"       # restore
ts_phase_end

LOG=$(ts_ssh 'grep -E "\[movy\] versions:" /data/UserData/schwung/debug.log 2>/dev/null || true')
echo "$LOG" | sed 's/^/    /' | tail -n 6
if echo "$LOG" | qgrep "versions: restored"; then ok "the restore ran"
else bad "no restore in the log — the gesture never reached the page"; fi

# THE assertion: several seconds and one autosave later, the clips are still
# there. That autosave wrote what the ENGINE holds, so a restore that reached
# only the disk would have been erased by it.
if wait_clips "$HAVE" -ge; then ok "the restored clips are what the engine holds"
else bad "the restore did not reach the engine — the autosave wrote it away"; fi

echo
if [ "$FAIL" -eq 0 ]; then
    echo -e "\033[0;32m\033[1mALL $PASS CHECKS PASSED\033[0m"
else
    echo -e "\033[0;31m\033[1m$FAIL CHECK(S) FAILED\033[0m"; exit 1
fi
