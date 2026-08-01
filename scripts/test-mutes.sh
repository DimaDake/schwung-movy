#!/usr/bin/env bash
# test-mutes.sh — device e2e for the Mute / Solo gestures
#
#   Mute                → mute the current track (any press length)
#   Shift + Mute        → solo the current track
#   Shift + Mute + track→ solo that track
#   Session view        → both standalone forms inactive
#
# The last check is the one that needs a device: solo lives only in movy's
# memory while its effect (the derived engine mutes) outlives a reopen, so the
# bookkeeping is persisted per set. A regression there strands the other tracks
# muted — and it cannot be caught in the browser tests, because the failure mode
# was an import cycle that only breaks in the single-file device bundle.
#
# Usage: ./scripts/test-mutes.sh [host]   (default: move.local)

set -euo pipefail
HOST="${1:-move.local}"
MOVY_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Run against the fixture state rather than whatever the device happens to hold,
# so this passes standalone and in any order relative to the other suites.
# shellcheck source=lib/test-set.sh
source "$MOVY_DIR/scripts/lib/test-set.sh"
test_set_begin || { echo "could not establish the fixture state"; exit 1; }
# Hand the LEDs back when this run ends, however it ends: the suites leave movy
# open in overtake owning the surface, so without this the hardware stays dark.
trap test_set_end EXIT INT TERM


RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'; RST='\033[0m'
pass() { echo -e "${GRN}✓${RST} $1"; }
fail() { echo -e "${RED}✗${RST} $1"; FAILURES=$((FAILURES+1)); }
info() { echo -e "${YLW}→${RST} $1"; }
FAILURES=0

SETS=/data/UserData/schwung/modules/tools/movy/sets
LOG=/data/UserData/schwung/debug.log

ssh -o ConnectTimeout=5 "ableton@$HOST" 'echo ok' >/dev/null 2>&1 || {
    echo -e "${RED}Cannot reach $HOST${RST}"; exit 1; }

info "Building and deploying..."
cd "$MOVY_DIR"
node build/device.mjs >/dev/null 2>&1
scp -q "$MOVY_DIR/ui.js" "ableton@$HOST:/data/UserData/schwung/modules/tools/movy/"
scp -q "$MOVY_DIR/scripts/inject-ui.py" "ableton@$HOST:/tmp/inject-ui.py"
pass "Built + deployed"

open_movy() {
    ssh "ableton@$HOST" 'python3 -c "
import mmap, json
with open(\"/data/UserData/schwung/open_tool_cmd.json\", \"w\") as f:
    f.write(json.dumps({\"file_path\": \"/\", \"tool_id\": \"movy\"}))
with open(\"/dev/shm/schwung-control\", \"r+b\") as f:
    mm = mmap.mmap(f.fileno(), 0); mm[56] = 1; mm.close()
"'
    sleep 4
}

inject() { ssh "ableton@$HOST" "python3 /tmp/inject-ui.py $*"; }
logtail() { ssh "ableton@$HOST" "grep -a '$1' $LOG | tail -1" || true; }

ssh "ableton@$HOST" "touch /data/UserData/schwung/debug_log_on
    UU=\$(sed -n 1p /data/UserData/schwung/active_set.txt 2>/dev/null)
    rm -f $SETS/\$UU/ui-state.json" >/dev/null 2>&1   # deterministic baseline
open_movy
ssh "ableton@$HOST" "> $LOG"

# Baseline: every track unmuted. Mute is a toggle and the shell cannot read the
# engine, so probe instead of assuming: engaging a solo logs base=<mask>, the
# user's own mutes at that moment. Un-solo restores them, so the probe is
# non-destructive.
probe_mutes() {
    ssh "ableton@$HOST" "> $LOG"
    inject 49:127 88:127 sleep:250 88:0 49:0 >/dev/null; sleep 1.5
    local line; line=$(logtail 'solo t=')
    inject 49:127 88:127 sleep:250 88:0 49:0 >/dev/null; sleep 1.5   # un-solo
    echo "$line" | sed -n 's/.*base=\([01]*\).*/\1/p'
}

BASE=$(probe_mutes)
info "Track mutes at start: ${BASE:-unknown}"
for t in 0 1 2 3; do
    if [ "$(echo "$BASE" | cut -c$((t+1)))" = "1" ]; then
        inject 88:127 $((43-t)):127 $((43-t)):0 88:0 >/dev/null; sleep 0.5
    fi
done
BASE=$(probe_mutes)
if [ "$BASE" = "0000" ]; then pass "baseline: all tracks unmuted"
else fail "could not reach an unmuted baseline (got '${BASE:-none}')"; fi
ssh "ableton@$HOST" "> $LOG"

# 1. Mute — any press length (the 500 ms hold rule used to swallow long ones).
inject 88:127 sleep:900 88:0 >/dev/null; sleep 1.5
if [ -n "$(logtail 'mute t=')" ]; then pass "long Mute press toggles the current track"
else fail "long Mute press did nothing"; fi
inject 88:127 sleep:120 88:0 >/dev/null; sleep 1.5   # back to unmuted

# 2. Shift+Mute — solo the current track.
ssh "ableton@$HOST" "> $LOG"
inject 49:127 88:127 sleep:300 88:0 49:0 >/dev/null; sleep 2
SOLO=$(logtail 'solo t=')
if echo "$SOLO" | grep -q 'set=1000 mutes=0111'; then pass "Shift+Mute solos track 1, muting the rest"
else fail "expected 'set=1000 mutes=0111', got: $SOLO"; fi

# 3. The regression: the solo must survive a reopen, so un-solo still restores.
info "Reopening movy (fresh JS context)..."
# Wait for the solo to actually reach disk instead of sleeping a fixed 4 s. The
# autosave is tick-based and the device's tick rate moves with load, so the real
# interval is nearer 8 s than the ~3 s its constant assumes. Reopening early
# reloaded the PREVIOUS blob, cleared the solo, and looked exactly like a
# persistence bug.
ts_wait_ui_state '"solo":\[1,0,0,0\]' || fail "solo never reached disk — nothing to restore"
open_movy
ssh "ableton@$HOST" "> $LOG"
inject 49:127 88:127 sleep:300 88:0 49:0 >/dev/null; sleep 2
UNSOLO=$(logtail 'solo t=')
if echo "$UNSOLO" | grep -q '\-> 0 set=0000 mutes=0000'; then
    pass "solo survives a reopen — un-solo unmutes the borrowed tracks"
else
    fail "stranded mutes after reopen: $UNSOLO"
fi

# 4. Shift+Mute+track solos that track, with no stray mute.
ssh "ableton@$HOST" "> $LOG"
inject 49:127 88:127 42:127 42:0 88:0 49:0 >/dev/null; sleep 2
if [ -n "$(logtail 'solo t=1')" ] && [ -z "$(logtail 'mute t=')" ]; then
    pass "Shift+Mute+track solos that track only"
else
    fail "Shift+Mute+track: $(logtail 'solo t=') / stray mute: $(logtail 'mute t=')"
fi
inject 49:127 88:127 42:127 42:0 88:0 49:0 >/dev/null; sleep 1   # un-solo

# 5. Session view has no current track: the standalone forms do nothing.
ssh "ableton@$HOST" "> $LOG"
inject 50:127 50:0 sleep:400 88:127 sleep:300 88:0 sleep:400 49:127 88:127 sleep:300 88:0 49:0 >/dev/null
sleep 2
if [ -z "$(logtail 'solo t=')" ] && [ -z "$(logtail 'mute t=')" ]; then
    pass "Session view: Mute and Shift+Mute are modifiers only"
else
    fail "Session view fired: $(logtail 'solo t=') $(logtail 'mute t=')"
fi
inject 50:127 50:0 >/dev/null   # back to Note view

echo
if [ "$FAILURES" -eq 0 ]; then
    echo -e "${GRN}ALL MUTE/SOLO CHECKS PASSED${RST}"; exit 0
else
    echo -e "${RED}$FAILURES MUTE/SOLO CHECK(S) FAILED${RST}"; exit 1
fi
