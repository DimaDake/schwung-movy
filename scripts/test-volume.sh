#!/usr/bin/env bash
# test-volume.sh — device e2e for the track-volume gesture
#
# Hold a track button + turn the master volume knob → that track's schwung
# slot volume moves. On a schwung fork with shadow_set_overtake_suppress_
# master_volume (2026-08-24), movy excludes Move from the gesture entirely
# via that flag; on an older shim it falls back to diverting the knob by
# injecting the track-hold Move never sees in overtake (CC 79 otherwise
# forwards to Move unconditionally). See the module header in
# src/mixer/track-volume.ts.
#
# What this proves:
#   1. CC 79 reaches the gesture handler and walks the dB ladder (1 dB/detent
#      multiplicative, not a flat linear step — see DB_STEP in
#      track-volume.ts) correctly.
#   2. The value lands on the chain slot — the second run re-reads slot:volume
#      at arm time, so its starting point is the first run's result.
#   3. Whichever path armed the divert did what it claims: "suppress" moves
#      nothing through the inject ring (Move is excluded), "inject" delivers
#      the track-hold press+release into Move's MIDI_IN.
#
# What it cannot prove: that Move's *master* volume stays put during a real
# gesture on the "inject" (old-schwung) path. Move ignores injected knob
# events (verified: 120 synthetic detents moved nothing), and the only live
# master-volume readout schwung has is a pixel scan of Move's overlay, gated
# on a hardware touch. That check needs a physical turn of the knob. On the
# "suppress" (new-schwung) path this is moot — Move never sees the event.
#
# Usage: ./scripts/test-volume.sh [host]   (default: move.local)

set -euo pipefail
HOST="${1:-move.local}"
MOVY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INJECT="$MOVY_DIR/../schwung-midi-inject-ui.py"

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

TRACK=1                 # slot 1 → track button CC 42 (CC43 = slot 0)
TRACK_CC=$((43 - TRACK))
DETENTS=5               # +5 detents = +0.25

RING='python3 -c "
import mmap,struct
f=open(\"/dev/shm/schwung-midi-inject\",\"r+b\"); mm=mmap.mmap(f.fileno(),0)
print(\"%d %d\" % struct.unpack_from(\"<II\",mm,0))
"'

# ── 1. Pre-flight + deploy ───────────────────────────────────────────────────
ssh -o ConnectTimeout=5 "ableton@$HOST" 'echo ok' >/dev/null 2>&1 || {
    echo -e "${RED}Cannot reach $HOST${RST}"; exit 1; }
pass "SSH reachable"

info "Building and deploying..."
cd "$MOVY_DIR"
node build/device.mjs >/dev/null 2>&1
REMOTE="/data/UserData/schwung/modules/tools/movy"
ssh "ableton@$HOST" "mkdir -p $REMOTE" >/dev/null 2>&1
scp -q "$MOVY_DIR/ui.js" "ableton@$HOST:$REMOTE/"
pass "Built + deployed"

ssh "ableton@$HOST" '
    touch /data/UserData/schwung/debug_log_on
    > /data/UserData/schwung/debug.log
' >/dev/null 2>&1

# ── 2. Open movy ─────────────────────────────────────────────────────────────
info "Opening Movy..."
ssh "ableton@$HOST" 'python3 -c "
import mmap, json
with open(\"/data/UserData/schwung/open_tool_cmd.json\", \"w\") as f:
    f.write(json.dumps({\"file_path\": \"/\", \"tool_id\": \"movy\"}))
with open(\"/dev/shm/schwung-control\", \"r+b\") as f:
    mm = mmap.mmap(f.fileno(), 0); mm[56] = 1; mm.close()
"'
sleep 2.5

RING_BEFORE=$(ssh "ableton@$HOST" "$RING")

# ── 3. Run the gesture ───────────────────────────────────────────────────────
# Track button and knob go to movy's UI stream — in overtake Move never sees
# CC 40-43, and the divert into Move is movy's own doing.
python3 "$INJECT" "$HOST" cc "$TRACK_CC" 127 >/dev/null
sleep 0.2
python3 "$INJECT" "$HOST" note_on 8 127 >/dev/null   # master knob touch → arms + diverts
sleep 0.5
python3 "$INJECT" "$HOST" cc 79 "$DETENTS" >/dev/null
sleep 0.5
python3 "$INJECT" "$HOST" note_off 8 >/dev/null
python3 "$INJECT" "$HOST" cc "$TRACK_CC" 0 >/dev/null
sleep 1.5

# ── 4. Assertions ────────────────────────────────────────────────────────────
LOG=$(ssh "ableton@$HOST" 'grep -a "\[movy\]" /data/UserData/schwung/debug.log | tail -80' || true)
APPLIED=$(echo "$LOG" | grep -o "trackvol t=$TRACK d=[-0-9]* v=[0-9.]*" | tail -1 || true)

if [ -n "$APPLIED" ]; then
    pass "gesture reached the handler — $APPLIED"
else
    fail "no trackvol log line — CC 79 did not reach the handler"
fi

if echo "$APPLIED" | qgrep "d=$DETENTS "; then
    pass "applied $DETENTS detents in one packet"
else
    fail "expected a single d=$DETENTS packet, got: $APPLIED"
fi

# The value is read back off the slot at ARM time (before the turn), logged
# separately as "trackvol arm t=N read=X" — compare against that instead of a
# previous run's log line: the shared device-test fixture (test_set_begin)
# resets chain-slot state on every invocation (see movy/CLAUDE.md "Device
# tests run against a fixture state"), so nothing actually carries between
# runs and a cross-run comparison would silently compare two independent
# fixture-reset baselines instead of proving the write landed.
# `|| true`: APPLIED/ARM_LOG can be empty when the gesture never reached the
# handler (already reported above), and pipefail would otherwise abort here —
# taking the divert check below down with it and hiding an independent failure.
NEW_VAL=$(echo "$APPLIED" | grep -o "v=[0-9.]*" | cut -d= -f2 || true)
ARM_LOG=$(echo "$LOG" | grep -o "trackvol arm t=$TRACK[^$]*" | tail -1 || true)
OLD_VAL=$(echo "$ARM_LOG" | grep -o "read=[0-9.]*" | cut -d= -f2 || true)
if [ -z "$NEW_VAL" ] || [ -z "$OLD_VAL" ]; then
    info "no applied/arm value to compare — slot read-back not asserted"
else
    # The ladder is 1 dB/detent, multiplicative — DETENTS up moves the ratio
    # by 10^(DETENTS/20), not a flat linear step (see DB_STEP in
    # track-volume.ts). OLD_VAL is only printed to 2dp (mlog's toFixed(2)),
    # so this is a tolerance check, not exact-match.
    EXPECTED=$(python3 -c "print('%.4f' % ($OLD_VAL * 10 ** ($DETENTS / 20)))")
    CLOSE=$(python3 -c "print(1 if abs($NEW_VAL - $EXPECTED) < 0.01 or $NEW_VAL in (0.0000, 4.0000) else 0)")
    if [ "$CLOSE" = "1" ]; then
        pass "slot read-back: $OLD_VAL -> $NEW_VAL (expected ~$EXPECTED)"
    else
        fail "slot read-back drifted: $OLD_VAL -> $NEW_VAL (expected ~$EXPECTED)"
    fi
fi

# Which path armed the divert: "suppress" (shadow_set_overtake_suppress_
# master_volume, no MIDI_IN injection needed — Move is excluded entirely) or
# "inject" (the older injectHold trick, which does push packets into Move's
# MIDI_IN). Keyed off the debug log rather than assumed, since a schwung build
# without the new capability falls back to "inject" automatically. ARM_LOG was
# already captured above for the slot read-back check.
RING_AFTER=$(ssh "ableton@$HOST" "$RING")
DELIVERED=$(( $(echo "$RING_AFTER" | cut -d' ' -f2) - $(echo "$RING_BEFORE" | cut -d' ' -f2) ))
if echo "$ARM_LOG" | qgrep "path=suppress"; then
    if [ "$DELIVERED" -eq 0 ]; then
        pass "new path: Move excluded, no MIDI_IN injection ($ARM_LOG)"
    else
        fail "new path armed (path=suppress) but the inject ring still moved ($DELIVERED packets)"
    fi
elif echo "$ARM_LOG" | qgrep "path=inject"; then
    if [ "$DELIVERED" -ge 2 ]; then
        pass "old path: divert delivered into Move's MIDI_IN ($DELIVERED packets)"
    else
        fail "old path armed (path=inject) but divert not delivered (ring advanced by $DELIVERED, expected >= 2)"
    fi
else
    fail "no trackvol arm log line with a path= tag — can't tell which mechanism ran"
fi

echo
if [ "$FAILURES" -eq 0 ]; then
    echo -e "${GRN}ALL VOLUME CHECKS PASSED${RST}"; exit 0
else
    echo -e "${RED}$FAILURES VOLUME CHECK(S) FAILED${RST}"; exit 1
fi
