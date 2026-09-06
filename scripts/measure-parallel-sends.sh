#!/usr/bin/env bash
# measure-parallel-sends.sh — does fanning the SEND phase out actually pay?
#
# plans/2026-09-06-send-cost-measurement.md priced this on paper: two heavy
# reverbs cost 584us serial, and overlapping them should cost max(A,B) plus a
# ~21us wake — a 207us saving, 7% of the frame. That arithmetic assumed a
# rendezvous on the send path costs what one on the CHAIN path costs, which had
# never been built, let alone timed. This is the measurement.
#
# THREE ARMS, A/B/A'. Send state survives between arms (a loaded FX, a held
# note, a settled reverb tail), so a single A-then-B pair cannot separate "B is
# faster" from "the second arm is always faster". A' is what says which.
#
# The outcome is `chwall` — the whole audio-callback wall, which brackets the
# chain render AND the send phase in one number. Per-bus `sndcostlog` costs
# CANNOT answer this: each bus costs the same wherever it runs, which is the
# entire point of overlapping them. The fixture plays ONE synth (~36us of chain
# render), so `chparallel` moving that phase too is inside the noise and the
# wall delta is the send phase — that is why the light one-synth fixture is the
# right one here and a twelve-chain set would be the wrong one.
#
# `par=` in sndlog is the arm's proof. A parallel send phase sounds exactly like
# a serial one and reports the same per-bus costs, so without reading back which
# path ran, an arm that silently fell through to serial would print as a real
# measurement of nothing.
#
# Usage: ./scripts/measure-parallel-sends.sh [move.local] [fx0] [fx1]
set -uo pipefail
cd "$(dirname "$0")/.."

HOST="${1:-move.local}"
# The heavy pair from the cost table: 231us + 354us. The light pair saves 24us,
# inside the noise of a 2902us block — measuring it would be measuring jitter.
FX0="${2:-dragonfly-hall}"
FX1="${3:-tape-echo2}"

LOG=/data/UserData/schwung/debug.log
TRACK=0            # the only track the fixture seeds with a synth
SETTLE=8           # seconds of settled audio per arm

MOVY_DIR="$(pwd)"
# shellcheck source=lib/test-set.sh
source "$MOVY_DIR/scripts/lib/test-set.sh"
# shellcheck source=lib/chain-bench.sh
source "$MOVY_DIR/scripts/lib/chain-bench.sh"

TS_HOST_MODE=movy test_set_begin
trap test_set_end EXIT INT TERM
ts_ssh "touch /data/UserData/schwung/debug_log_on" >/dev/null 2>&1
ts_open_movy
sleep 3
cb_require_engine_link

# ── The set under test ──────────────────────────────────────────────────────
echo "loading sends: 0=$FX0 1=$FX1"
ep "snd0:module" "$FX0"; sleep 2
ep "snd1:module" "$FX1"; sleep 2
# Unity, centred, unmuted, BOTH sends at full. A bus fed nothing idles out and
# measures zero — which is indistinguishable from a fan-out that saved
# everything.
ep "ch$TRACK:mix" "1.0,0.0,0,1.0,1.0"

hold()    { ep "ch$TRACK:midi" "144.60.100"; ep "ch$TRACK:midi" "144.64.100"; }
release() { ep "ch$TRACK:midi" "128.60.0";   ep "ch$TRACK:midi" "128.64.0"; }
# Re-struck from a KNOWN state between arms: sending note-ons on top of a held
# chord stacks voices on a polyphonic synth, and cost that grows with the arm
# number is indistinguishable from a lane count that does not pay.
restrike() { release; sleep 1; hold; }

snd_line() { ts_ssh "grep -o 'sends: .*' $LOG | tail -n 1" 2>/dev/null; }

# `arm <0|1> <label>`: the first cost read after the switch is a RESET that
# discards the mode change and the warm-up, so the window holds only settled
# blocks in the mode being measured.
arm() {
    ep "chparallel" "$1"
    restrike
    sleep 2
    ts_ssh "> $LOG" >/dev/null 2>&1
    ep "chcostlog" "1"          # reset the window
    sleep "$SETTLE"
    ep "chcostlog" "1"; sleep 1
    ep "sndcostlog" "1"; sleep 1
    ep "sndlog" "1"; sleep 1
    local cost wall par sndc
    cost=$(ts_ssh "grep -o 'chain cost: .*' $LOG | tail -n 1")
    # Per-bus costs from the SAME window as the wall, so the rendezvous below is
    # derived from one arm rather than from two runs of different things.
    sndc=$(ts_ssh "grep -o 'send cost: .*' $LOG | tail -n 1")
    ARM_B0=$(printf '%s' "$sndc" | grep -oE '0:us=[0-9.]+' | cut -d= -f2)
    ARM_B1=$(printf '%s' "$sndc" | grep -oE '1:us=[0-9.]+' | cut -d= -f2)
    wall=$(printf '%s' "$cost" | sed -n 's/.*wall=\([0-9]*\)\/.*/\1/p')
    SND=$(snd_line)
    par=$(printf '%s' "$SND" | grep -oE 'par=[01]' | cut -d= -f2)
    ARM_WALL="${wall:-0}"
    ARM_PAR="${par:-?}"
    printf '  %-10s wall %8.1f us   par=%s   %s\n' "$2" \
        "$(awk -v v="$ARM_WALL" 'BEGIN{print v/1000}')" "$ARM_PAR" \
        "$(printf '%s' "$SND" | grep -oE 'plan=[0-9,|]*')"
}

echo
echo "=== arms (send phase) ==="
arm 0 serial;   S1=$ARM_WALL;  P1=$ARM_PAR; B0=$ARM_B0; B1=$ARM_B1
arm 1 parallel; PW=$ARM_WALL;  PP=$ARM_PAR
arm 0 "serial-2"; S2=$ARM_WALL;  P2=$ARM_PAR
release

echo
FAIL=0
# The arms have to BE the arms. A serial arm reporting par=1, or a parallel arm
# reporting par=0, means the flag never reached the engine and both numbers are
# the same measurement printed twice.
[ "$P1" = "0" ] && [ "$P2" = "0" ] || { echo "FAIL: a serial arm reported par=$P1/$P2"; FAIL=1; }
[ "$PP" = "1" ] || {
    echo "FAIL: the parallel arm reported par=$PP — the phase did not fan out."
    echo "      Below the threshold this is CORRECT behaviour, not a bug: check"
    echo "      that both buses are being fed (sndlog in=... > 0 for each)."
    FAIL=1
}
[ "$EP_FAILS" -eq 0 ] || { echo "FAIL: $EP_FAILS engine writes never arrived"; FAIL=1; }

# Drift between the two serial arms is the error bar. A saving smaller than it
# is not a saving — it is the difference between two runs of the same thing.
SERIAL=$(awk -v a="$S1" -v b="$S2" 'BEGIN{print (a+b)/2}')
DRIFT=$(awk -v a="$S1" -v b="$S2" 'BEGIN{d=a-b; print (d<0?-d:d)}')
awk -v s="$SERIAL" -v p="$PW" -v d="$DRIFT" 'BEGIN{
    printf "serial   %8.1f us  (arms differ by %.1f us — the error bar)\n", s/1000, d/1000
    printf "parallel %8.1f us\n", p/1000
    printf "saved    %8.1f us  (%.1f%% of a 2902 us frame)\n", (s-p)/1000, (s-p)/29020
    if (s-p <= d) print "\nINCONCLUSIVE: the saving does not clear the drift between the serial arms."
}'

# What the fan-out actually cost on THIS path — the one number
# plans/2026-09-06-send-cost-measurement.md could not supply, since it carried
# ~21 us over from the chain work without a send-phase rendezvous existing yet.
# The 2026-09-06 run put it at 25.2 us, which is what FANOUT_NS now holds.
#
#   serial   = C + A + B          (C = chain render + the rest of the callback)
#   parallel = C + max(A,B) + F
#   so       F = min(A,B) - (serial - parallel)
#
# C cancels, which is what makes this readable off two walls and the per-bus
# costs rather than needing the callback broken down.
awk -v s="$SERIAL" -v p="$PW" -v b0="${B0:-0}" -v b1="${B1:-0}" 'BEGIN{
    if (b0 <= 0 || b1 <= 0) { print "\nrendezvous: not derivable (a bus reported no cost)"; exit }
    min = (b0 < b1) ? b0 : b1
    printf "\nbuses    %8.1f us + %8.1f us  (serial arm, settled)\n", b0, b1
    printf "rendezvous %6.1f us  = the cheaper bus (%.1f) minus what was saved (%.1f)\n", \
        min - (s-p)/1000, min, (s-p)/1000
    printf "           render_plan::FANOUT_NS is set to 25.0 us\n"
}'
exit "$FAIL"
