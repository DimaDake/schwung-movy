#!/usr/bin/env bash
# measure-chain-idle.sh — does skipping silent chains cost samples, and what does
# it save?
#
# Two questions, in the order that matters. The split has to be proven free
# BEFORE any gate is trusted, because `chidle >= 1` changes how every movy chain
# renders — sleeping or not — and a saving measured against a path that already
# altered the audio is worth nothing.
#
#   1. EQUIVALENCE. `chidle 0` is one render_block call, the way movy has always
#      done it. `chidle 1` splits it into render_block + process_fx and sleeps
#      nothing. Those two must produce bit-identical output, which `chdigest`
#      can answer directly.
#
#   2. THE SAVING. With chains loaded and SILENT, compare per-block cost at
#      `chidle 0` against `chidle 3`. This is the number
#      docs/chain-idle-cpu-optimization.md predicted and never measured: twelve
#      idle helm chains at ~2340 us, against a ~2000 us frame budget.
#
# Usage: ./scripts/measure-chain-idle.sh [move.local] [module ...]
set -uo pipefail
cd "$(dirname "$0")/.."

HOST="${1:-move.local}"; shift || true
MODULES=("$@")

MOVY_DIR="$(pwd)"
# shellcheck source=lib/test-set.sh
source "$MOVY_DIR/scripts/lib/test-set.sh"
# shellcheck source=lib/chain-bench.sh
source "$MOVY_DIR/scripts/lib/chain-bench.sh"
# shellcheck source=lib/chain-equiv.sh
CE_FLAG=chidle
source "$MOVY_DIR/scripts/lib/chain-equiv.sh"
[ ${#MODULES[@]} -eq 0 ] && MODULES=("${CB_DEFAULT_MODULES[@]}")
LOG=/data/UserData/schwung/debug.log
CHAINS=12
BLOCKS="${BLOCKS:-512}"
# Generous: the window itself is ~1.5 s and the log read is a round trip behind.
WINDOW_WAIT=6
# Between arms, so the previous arm's release tails do not bleed into the next.
GAP=4
# One second of silence is what puts a gate to sleep (SLEEP_AFTER = 344 blocks),
# and the probe period is another half. Three seconds clears both with room.
SLEEP_SETTLE=3
BLD=$'\033[1m'; RST=$'\033[0m'; GRN=$'\033[0;32m'; RED=$'\033[0;31m'; YEL=$'\033[1;33m'

FAILED=0

ssh -o ConnectTimeout=5 "ableton@$HOST" true 2>/dev/null || { echo "DEVICE OFFLINE"; exit 1; }
ssh "ableton@$HOST" 'touch /data/UserData/schwung/debug_log_on'

echo "${BLD}=== chain idle: is the split free, and what does sleeping save? ===${RST}"
echo "host=$HOST  modules: ${MODULES[*]}"

ts_open_movy
sleep 8
cb_require_engine_link

# The engine must be the build under test. A stale dsp.so answers every write
# and reports nothing about chidle, which reads exactly like a clean PASS.
# `chidlelog` is the probe, not a `chidle` write: 3 is the default, so setting
# it is a no-op that logs nothing and reads exactly like a missing feature.
ssh "ableton@$HOST" "> $LOG"
ep "chidlelog" "1"
sleep 1
if ! ssh "ableton@$HOST" "grep -q 'chain idle: level' $LOG"; then
    echo "${RED}engine does not know chidle — is this build deployed?${RST}"
    echo "  (./scripts/deploy.sh, then re-open movy so the DSP reloads)"
    exit 1
fi
echo "${GRN}engine speaks chidle${RST}"

cb_discover_samples

ASSIGN=()
for c in $(seq 0 $((CHAINS-1))); do
    ASSIGN+=("${MODULES[$((c % ${#MODULES[@]}))]}")
done

echo
echo "chain assignment:"
for c in $(seq 0 $((CHAINS-1))); do printf '  ch%-3s %s\n' "$c" "${ASSIGN[$c]}"; done

# --- 1. equivalence ------------------------------------------------------
#
# Three arms, not two, and every arm reloads — see scripts/lib/chain-equiv.sh.
# A two-arm run of this reported every chain as differing, and the cause was
# state surviving between arms, not the split.
echo
echo "${BLD}1. equivalence: does splitting synth from FX change the samples?${RST}"
A=$(ce_arm "A: chidle 0 — one render_block call, the control" 0)
sleep "$GAP"
B=$(ce_arm "B: chidle 1 — split, sleeping nothing, the arm under test" 1)
sleep "$GAP"
A2=$(ce_arm "A': chidle 0 again — the control, second half" 0)

for d in "$A" "$B" "$A2"; do
    n=$(printf '%s' "$d" | tr ',' '\n' | grep -c '/')
    if [ "$n" != "$CHAINS" ]; then
        echo "${RED}✗ an arm returned $n of $CHAINS digests — nothing can be concluded${RST}"
        FAILED=1
    fi
done

if [ "$FAILED" = "0" ]; then
    REPRO=0; SAME=0; DIFF=0; SILENT=0
    for i in $(seq 1 "$CHAINS"); do
        a=$(printf '%s' "$A"  | cut -d, -f"$i")
        b=$(printf '%s' "$B"  | cut -d, -f"$i")
        a2=$(printf '%s' "$A2" | cut -d, -f"$i")
        voiced=${a#*/}
        if [ "${voiced:-0}" = "0" ]; then
            SILENT=$((SILENT + 1)); continue
        fi
        # A chain whose own control arms disagree cannot testify about the arm
        # between them. Excluded, not failed — that is coverage, not a defect.
        if [ "$a" != "$a2" ]; then continue; fi
        REPRO=$((REPRO + 1))
        if [ "$a" = "$b" ]; then SAME=$((SAME + 1)); else
            DIFF=$((DIFF + 1))
            echo "  ${RED}ch$((i-1)) ${ASSIGN[$((i-1))]}: $a -> $b${RST}"
        fi
    done
    echo "  reproducible: $REPRO/$CHAINS   identical: $SAME   DIFFERING: $DIFF   silent: $SILENT"
    if [ "$DIFF" -gt 0 ]; then
        echo "${RED}✗ THE SPLIT CHANGES THE AUDIO — the gate is unsafe until this is fixed${RST}"
        FAILED=1
    elif [ "$REPRO" = "0" ]; then
        echo "${YEL}! no chain was reproducible across its own control arms.${RST}"
        echo "${YEL}  This run proves nothing about the split either way.${RST}"
    else
        echo "${GRN}✓ $SAME reproducible chain(s) bit-identical — the split changes no samples${RST}"
    fi
fi

# --- 2. the saving -------------------------------------------------------
#
# Loaded and silent is the case the optimization exists for: a chain costs CPU
# whenever it is loaded, whether or not anything is playing.
cost_with() {  # cost_with <flag> <value>
    ep "$1" "$2"
    sleep "$SLEEP_SETTLE"
    ssh "ableton@$HOST" "> $LOG"
    ep "chcostlog" "1"        # first read RESETS the window
    sleep 2
    ep "chcostlog" "1"
    sleep 1
    ssh "ableton@$HOST" "grep 'chain cost:' $LOG | tail -1" | sed 's/.*chain cost: //'
}

echo
echo "${BLD}2. the saving: twelve chains loaded, nothing playing${RST}"
C0="$(cost_with chidle 0)"
C3="$(cost_with chidle 3)"
echo "  chidle 0: $C0"
echo "  chidle 3: $C3"

ep "chidlelog" "1"
sleep 1
SLP="$(ssh "ableton@$HOST" "grep 'chain idle: level' $LOG | tail -1" | sed 's/.*chain idle: //')"
echo "  gate: ${SLP:-unreported}"

# The gate has to have actually fired. A saving of zero and a saving that was
# never attempted look the same in a cost table.
ASLEEP_N="$(printf '%s' "$SLP" | grep -o 'asleep=[0-9]*' | grep -o '[0-9]*')"
if [ -n "$ASLEEP_N" ] && [ "$ASLEEP_N" -gt 0 ] 2>/dev/null; then
    echo "${GRN}✓ $ASLEEP_N chain(s) asleep — the gate fired${RST}"
else
    echo "${YEL}! no chain reported asleep. Either nothing was silent, or the${RST}"
    echo "${YEL}  gate never fired — the cost comparison above means nothing.${RST}"
fi

# --- 3. a sleeping chain's LFOs still advance ----------------------------
#
# The reason this optimization was documented and never built: once movy stops
# calling render_block, the chain cannot wake itself, and lfo_tick lives INSIDE
# render_block. A sleeping chain's LFOs would advance only on the 1-in-172 probe
# — ~172x too slow, in visible steps, resuming from a stale phase at note-on.
# `ChainInstance::mod_tick` is the fix; this is the only place it is observable.
#
# Asserted on the DRIVEN param's value, not on the LFO's own state: a target
# field proves a write landed, and the question here is whether the modulation
# is actually moving the sound.
echo
echo "${BLD}3. mod_tick: do a sleeping chain's LFOs still move?${RST}"
# `cb_prepare` sets plaits decay=1 so a held note SUSTAINS, which is what the
# cost benchmarks need and the exact opposite of what this needs: a chain that
# rings forever never goes silent and never sleeps. Put it back first.
ep "ch0:synth:decay" "0"
# `enabled` is what arms the LFO. `active` is derived from target+param and
# refuses to be told, so writing it looks like it worked and does nothing —
# which is how this check first reported a mod_tick failure that was its own.
ep "ch0:lfo1:enabled" "1"
ep "ch0:lfo1:shape" "0"
ep "ch0:lfo1:sync" "0"
ep "ch0:lfo1:rate_hz" "2.0"
ep "ch0:lfo1:depth" "1.0"
ep "ch0:lfo1:target" "synth"
ep "ch0:lfo1:target_param" "timbre"
# Long enough to be asleep again: every write above woke the chain.
sleep $((SLEEP_SETTLE + 2))

lfo_value() {
    ssh "ableton@$HOST" "> $LOG"
    ep "chlfolog" "0"
    sleep 1
    ssh "ableton@$HOST" "grep -o 'chain 0 lfos: .*' $LOG | tail -1"
}
V1="$(lfo_value)"
sleep 2
V2="$(lfo_value)"
echo "  t0: ${V1:-unreported}"
echo "  t1: ${V2:-unreported}"

ep "chidlelog" "1"
sleep 1
G3="$(ssh "ableton@$HOST" "grep 'chain idle: level' $LOG | tail -1" | sed 's/.*chain idle: //')"
echo "  gate: ${G3:-unreported}"
# Chain 0 SPECIFICALLY, not the count: ten sleeping chains let this pass while
# the one chain being watched stayed awake the whole time.
SLEEPING="$(printf '%s' "$G3" | sed -n 's/.*sleeping=\[\([^]]*\)\].*/\1/p')"
CH0_ASLEEP=0
for i in $(printf '%s' "$SLEEPING" | tr ',' ' '); do
    [ "$i" = "0" ] && CH0_ASLEEP=1
done

if [ -z "$V1" ] || [ -z "$V2" ]; then
    echo "${RED}✗ no LFO report came back — nothing was observed${RST}"
    FAILED=1
elif ! printf '%s' "$V1" | qgrep 'active=1'; then
    echo "${YEL}! the LFO never armed, so this says nothing about mod_tick${RST}"
elif [ "$CH0_ASLEEP" = "0" ]; then
    echo "${YEL}! chain 0 was awake, so this says nothing about a SLEEPING chain${RST}"
elif [ "$V1" = "$V2" ]; then
    echo "${RED}✗ the LFO did not move while the chain slept — mod_tick is not working${RST}"
    FAILED=1
else
    echo "${GRN}✓ the LFO advanced while chain 0 was asleep — mod_tick works${RST}"
fi

# --- 4. the two defaults together ----------------------------------------
#
# Both flags now ship ON, and they could have pulled against each other:
# `chidle` empties the helper lanes, and if the pool's unpark/join cost anything
# per block, every sleeping set would pay it for work it is not doing — the one
# case where defaulting parallel on is a REGRESSION rather than a speedup.
#
# It does not, and this section is the evidence: measured at 440us parallel
# against 445us serial on twelve sleeping chains (2026-08-24), and 380 vs 378 on
# a set with no chains at all. Note what this does NOT test — the empty-lane
# skip in render_pool::render_block scores the same with the line removed, so
# that line's guard is the unit test, not this. What this guards is the DEFAULT:
# it fails if parallel render ever starts taxing a set that is asleep.
echo
echo "${BLD}4. does the pool cost anything once everything is asleep?${RST}"
#
# Read with cb_frame_work, NOT chcostlog: the engine only accumulates wall time
# on a block where some chain rendered, so a fully-asleep set reports ~0 from
# the cost meter whatever the render path did. That would have made this check
# pass without testing anything.
ep "chidle" "3"
frame_work_with() {  # frame_work_with <flag> <value> -> mean us
    ep "$1" "$2"
    sleep "$SLEEP_SETTLE"
    ssh "ableton@$HOST" "> $LOG"
    # The shim emits Frame(us) on a slow period, not per block. A 3s window
    # caught none of them and the arm read as 0us — which the guard below
    # reports as "nothing was compared" rather than as a match. 10s is what
    # measure-work-ceiling.sh settles for, for the same reason.
    sleep 10
    cb_frame_work
}
TS="$(frame_work_with chparallel 0)"
TP="$(frame_work_with chparallel 1)"
echo "  chparallel 0 (serial):   ${TS}us frame work"
echo "  chparallel 1 (default):  ${TP}us frame work"

ep "chidlelog" "1"
sleep 1
G4="$(ssh "ableton@$HOST" "grep 'chain idle: level' $LOG | tail -1" | sed 's/.*chain idle: //')"
A4="$(printf '%s' "$G4" | grep -o 'asleep=[0-9]*' | grep -o '[0-9]*')"
echo "  gate: ${G4:-unreported}"

if [ "${TS:-0}" = "0" ] || [ "${TP:-0}" = "0" ]; then
    echo "${YEL}! no Frame(us) lines came back — nothing was compared${RST}"
elif [ -z "$A4" ] || [ "$A4" -lt 2 ] 2>/dev/null; then
    # A set that never slept has full helper lanes, so the skip was never
    # reached and a matching pair of numbers would mean nothing.
    echo "${YEL}! only ${A4:-0} chain(s) asleep — the empty-lane path was not exercised${RST}"
elif [ "$TP" -gt $((TS + 60)) ]; then
    # 60us is well under the ~140us the pool cost per frame before the skip, and
    # well over frame-to-frame noise on an idle device.
    echo "${RED}✗ parallel costs ${TP}us against serial's ${TS}us on a SLEEPING set —${RST}"
    echo "${RED}  the pool is being woken for empty lanes${RST}"
    FAILED=1
else
    echo "${GRN}✓ ${TP}us parallel vs ${TS}us serial — an asleep set does not pay for the pool${RST}"
fi

if [ "${EP_FAILS:-0}" -gt 0 ]; then
    echo "${RED}✗ $EP_FAILS engine write(s) failed — some arm ran unconfigured${RST}"
    FAILED=1
fi

echo
if [ "$FAILED" != "0" ]; then
    echo "${RED}${BLD}CHAIN IDLE CHECKS FAILED${RST}"
    exit 1
fi
echo "${GRN}${BLD}CHAIN IDLE CHECKS PASSED${RST}"
exit 0
