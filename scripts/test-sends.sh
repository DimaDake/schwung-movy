#!/usr/bin/env bash
# test-sends.sh — a movy send FX bus actually carries audio.
#
# The one claim no host build can reach. `browser-test/logic/mixer.mjs` proves
# the routing and `send_bus.rs` proves the arithmetic, but neither can load a
# real audio FX into a real chain host and watch a track's signal come out the
# other side — a host build cannot load a chain at all.
#
# Two failures with the same symptom are separated on purpose:
#
#   in=0   — no track fed the bus (a mix/tap bug)
#   out=0  — the bus was fed and the FX produced silence (a load/process bug)
#
# `sndlog` is what makes both visible: the remote-UI socket a device test drives
# can write engine params but cannot read them.
#
# Usage: ./scripts/test-sends.sh [move.local]
set -uo pipefail
cd "$(dirname "$0")/.."

HOST="${1:-move.local}"
LOG=/data/UserData/schwung/debug.log
SEND_FX=freeverb        # cheap, always installed, and audibly wet
# The fixture seeds a synth on track 0 (and a drum module on track 1); every
# other track is empty, so a send from one would measure silence and report it
# as a routing bug. With TS_HOST_MODE=movy, track 0 IS movy chain 0.
TRACK=0
FAILS=0

pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s: %s\n' "$1" "$2"; FAILS=$((FAILS + 1)); }
check() { if [ "$2" = 1 ]; then pass "$1"; else fail "$1" "${3:-assertion failed}"; fi; }

MOVY_DIR="$(pwd)"
# shellcheck source=lib/test-set.sh
source "$MOVY_DIR/scripts/lib/test-set.sh"

ep() {
    node scripts/engine-param.mjs set "$1" "$2" "$HOST" >/dev/null 2>&1 && return 0
    sleep 1
    node scripts/engine-param.mjs set "$1" "$2" "$HOST" >/dev/null 2>&1
}

# The fixture puts a synth on the movy chains and pins the host mode, so this
# suite never runs on whatever the device happened to hold.
TS_HOST_MODE=movy test_set_begin
trap test_set_end EXIT INT TERM

ts_ssh "touch /data/UserData/schwung/debug_log_on" >/dev/null 2>&1
ts_open_movy
sleep 3
ep "chcostlog" "1" || { echo "ENGINE UNREACHABLE at $HOST"; exit 1; }
ts_ssh "> $LOG" >/dev/null 2>&1

# Read the last `sends:` line the engine logged.
snd_read() {
    ep "sndlog" "1"
    sleep 1
    ts_ssh "grep -o 'sends: .*' $LOG | tail -n 1" 2>/dev/null
}

echo -e "\033[1m=== A bus with no module and no sender ===\033[0m"
BASE=$(snd_read)
echo "  $BASE"
check "the engine answers sndlog at all" "$([ -n "$BASE" ] && echo 1 || echo 0)" \
      "no 'sends:' line — the diagnostic never ran"
check "bus 0 starts with no module" \
      "$(echo "$BASE" | qgrep '0:mod=-' && echo 1 || echo 0)" "$BASE"
check "and nothing has been fed to it" \
      "$(echo "$BASE" | qgrep '0:in=0,out=0' && echo 1 || echo 0)" "$BASE"

echo -e "\033[1m=== Loading $SEND_FX into send 1 ===\033[0m"
ep "snd0:module" "$SEND_FX"
sleep 2
LOADED=$(snd_read)
echo "  $LOADED"
check "the bus reports the module it was given" \
      "$(echo "$LOADED" | qgrep "0:mod=$SEND_FX" && echo 1 || echo 0)" "$LOADED"

echo -e "\033[1m=== Feeding it from track $TRACK ===\033[0m"
# Unity gain, centred, unmuted, send 1 at full. The synth has to be sounding for
# there to be anything to send, so hold a note across the measurement.
ep "ch$TRACK:mix" "1.0,0.0,0,1.0,0.0"
ep "ch$TRACK:midi" "144.60.100"
sleep 2
FED=$(snd_read)
ep "ch$TRACK:midi" "128.60.0"
echo "  $FED"

# One regex over bus 0's whole group: `out=` and `blocks=` are not prefixed
# with the bus number, so matching them alone would pick up bus 1's.
bus0() { echo "$1" | grep -oE '0:in=[0-9]+,out=[0-9]+,blocks=[0-9]+' | head -1; }
field() { echo "$1" | grep -oE "$2=[0-9]+" | cut -d= -f2; }
G=$(bus0 "$FED")
IN=$(field "$G" in); OUT=$(field "$G" out); BLOCKS=$(field "$G" blocks)
IN=${IN:-0}; OUT=${OUT:-0}; BLOCKS=${BLOCKS:-0}

check "the track's audio reached the bus" "$([ "$IN" -gt 0 ] && echo 1 || echo 0)" \
      "in=$IN — no track fed it, so the post-fader tap never ran"
check "the FX pass ran" "$([ "$BLOCKS" -gt 0 ] && echo 1 || echo 0)" "blocks=$BLOCKS"
check "and audio came out of it" "$([ "$OUT" -gt 0 ] && echo 1 || echo 0)" \
      "out=$OUT — the bus was fed but the FX produced silence"

echo -e "\033[1m=== A track at zero send feeds nothing ===\033[0m"
# The zero-cost path, on the device rather than in a unit test: the same note,
# the same loaded FX, only the send level down.
ep "ch$TRACK:mix" "1.0,0.0,0,0.0,0.0"
sleep 2
ts_ssh "> $LOG" >/dev/null 2>&1
ep "ch$TRACK:midi" "144.60.100"
sleep 2
ZERO=$(snd_read)
ep "ch$TRACK:midi" "128.60.0"
echo "  $ZERO"
ZIN=$(field "$(bus0 "$ZERO")" in); ZIN=${ZIN:-0}
check "nothing reaches a bus the track is not sending to" \
      "$([ "$ZIN" = 0 ] && echo 1 || echo 0)" "in=$ZIN with the send at zero"

# Leave the bus empty: this suite owns the device state it created.
ep "snd0:module" ""

echo
if [ "$FAILS" = 0 ]; then
    echo -e "\033[32m\033[1mSEND FX DEVICE TEST PASSED\033[0m"
else
    echo -e "\033[31m\033[1mSEND FX DEVICE TEST FAILED\033[0m ($FAILS check(s))"
    exit 1
fi
