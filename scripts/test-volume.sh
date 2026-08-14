#!/usr/bin/env bash
# test-volume.sh — device e2e for the track-volume gesture
#
# Hold a track button + turn the master volume knob → that track's schwung
# slot volume moves, and movy diverts the knob at Move by injecting the
# track-hold Move never sees in overtake (schwung_shim.c:5860 forwards CC 79
# to Move unconditionally).
#
# What this proves:
#   1. CC 79 reaches the gesture handler and applies 0.05/detent.
#   2. The value lands on the chain slot — the second run re-reads slot:volume
#      at arm time, so its starting point is the first run's result.
#   3. movy's divert packets are delivered into Move's MIDI_IN (the inject
#      ring's consumer cursor advances).
#
# What it cannot prove: that Move's *master* volume stays put during a real
# gesture. Move ignores injected knob events (verified: 120 synthetic detents
# moved nothing), and the only live master-volume readout schwung has is a
# pixel scan of Move's overlay, gated on a hardware touch. That check needs a
# physical turn of the knob.
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

# The previous run's applied value is the expected starting point for this one
# (the slot keeps it), so read it before clearing the log.
PREV_VOL=$(ssh "ableton@$HOST" 'grep -a "trackvol t='"$TRACK"'" /data/UserData/schwung/debug.log | tail -1' || true)

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

# The value is read back off the slot at arm time, so a second run must start
# where the first ended — that is the proof the write landed on the chain slot.
# `|| true` on both: APPLIED is empty when the gesture never reached the handler
# (already reported above), and pipefail would otherwise abort here — taking the
# divert check below down with it and hiding a second, independent failure.
NEW_VAL=$(echo "$APPLIED" | grep -o "v=[0-9.]*" | cut -d= -f2 || true)
EXPECTED_STEP=$(python3 -c "print('%.2f' % ($DETENTS * 0.05))")
if [ -z "$NEW_VAL" ]; then
    info "no applied value to compare — slot read-back not asserted"
elif [ -n "$PREV_VOL" ]; then
    OLD_VAL=$(echo "$PREV_VOL" | grep -o "v=[0-9.]*" | cut -d= -f2 || true)
    DIFF=$(python3 -c "print('%.2f' % ($NEW_VAL - $OLD_VAL))")
    if [ "$DIFF" = "$EXPECTED_STEP" ]; then
        pass "slot read-back: $OLD_VAL -> $NEW_VAL (+$DIFF)"
    else
        fail "slot read-back drifted: $OLD_VAL -> $NEW_VAL (expected +$EXPECTED_STEP)"
    fi
else
    info "first run on a clean log — re-run to assert slot read-back"
fi

# movy pushes a track-hold press + release into Move's MIDI_IN; the shim's
# drain advances the ring's consumer cursor once per delivered packet.
RING_AFTER=$(ssh "ableton@$HOST" "$RING")
DELIVERED=$(( $(echo "$RING_AFTER" | cut -d' ' -f2) - $(echo "$RING_BEFORE" | cut -d' ' -f2) ))
if [ "$DELIVERED" -ge 2 ]; then
    pass "divert delivered into Move's MIDI_IN ($DELIVERED packets)"
else
    fail "divert not delivered (ring consumer advanced by $DELIVERED, expected >= 2)"
fi

echo
if [ "$FAILURES" -eq 0 ]; then
    echo -e "${GRN}ALL VOLUME CHECKS PASSED${RST}"; exit 0
else
    echo -e "${RED}$FAILURES VOLUME CHECK(S) FAILED${RST}"; exit 1
fi
