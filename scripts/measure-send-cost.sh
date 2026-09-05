#!/usr/bin/env bash
# measure-send-cost.sh — what one send bus's FX pass costs per block.
#
# The two questions a SERIAL send phase raises:
#   1. is a second bus worth a rendezvous? Fan-out costs ~21us of scheduler wake
#      (plans/2026-08-2x join-cost), so parallel only pays when the CHEAPER of
#      the two buses costs more than that.
#   2. what would sends 3 and 4 add? Serially, exactly their own cost, straight
#      onto the critical path.
#
# Both are answered by one number per FX, so that is what this measures. Costs
# are read with `sndcostlog`, which resets its window — so each FX is timed over
# its own settled window, with the load phase discarded.
#
# Usage: ./scripts/measure-send-cost.sh [move.local] [fx ...]
set -uo pipefail
cd "$(dirname "$0")/.."

HOST="${1:-move.local}"
shift || true
FX=("$@")
[ ${#FX[@]} -eq 0 ] && FX=(midiverb mverb freeverb dragonfly-hall tape-echo2)

LOG=/data/UserData/schwung/debug.log
TRACK=0            # the only track the fixture seeds with a synth
SETTLE=6           # seconds of audio per FX before the window is read

MOVY_DIR="$(pwd)"
# shellcheck source=lib/test-set.sh
source "$MOVY_DIR/scripts/lib/test-set.sh"

ep() {
    node scripts/engine-param.mjs set "$1" "$2" "$HOST" >/dev/null 2>&1 && return 0
    sleep 1
    node scripts/engine-param.mjs set "$1" "$2" "$HOST" >/dev/null 2>&1
}

TS_HOST_MODE=movy test_set_begin
trap test_set_end EXIT INT TERM
ts_ssh "touch /data/UserData/schwung/debug_log_on" >/dev/null 2>&1
ts_open_movy
sleep 3
ep "chcostlog" "1" || { echo "ENGINE UNREACHABLE at $HOST"; exit 1; }

read_us() {   # $1 = bus
    ep "sndcostlog" "1"
    sleep 1
    ts_ssh "grep -o 'send cost: .*' $LOG | tail -n 1" 2>/dev/null \
        | grep -oE "$1:us=[0-9.]+,max=[0-9.]+"
}

printf '\n%-16s %10s %10s\n' MODULE "mean us" "max us"
printf '%-16s %10s %10s\n' ---------------- ---------- ----------

for fx in "${FX[@]}"; do
    ts_ssh "> $LOG" >/dev/null 2>&1
    ep "snd0:module" "$fx"
    sleep 2
    # Unity, centred, full send. A held note is what gives the bus something to
    # work on — an FX fed silence can idle out and measure nothing.
    ep "ch$TRACK:mix" "1.0,0.0,0,1.0,0.0"
    ep "ch$TRACK:midi" "144.60.100"
    sleep 2
    ep "sndcostlog" "1" >/dev/null 2>&1     # discard the load + attack window
    sleep "$SETTLE"
    LINE=$(read_us 0)
    ep "ch$TRACK:midi" "128.60.0"
    MEAN=$(echo "$LINE" | grep -oE 'us=[0-9.]+' | cut -d= -f2)
    MAX=$(echo "$LINE" | grep -oE 'max=[0-9.]+' | cut -d= -f2)
    printf '%-16s %10s %10s\n' "$fx" "${MEAN:-?}" "${MAX:-?}"
    ep "snd0:module" ""
    sleep 1
done

# The block period the numbers are against, so a reader does not have to guess.
printf '\nframe budget: 2902us per block (128 frames @ 44.1k)\n'
printf 'fan-out cost: ~21us of scheduler wake per parallel round\n'
