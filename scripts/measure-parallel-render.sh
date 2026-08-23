#!/usr/bin/env bash
# measure-parallel-render.sh — does splitting the block actually shorten it?
#
# Everything before this measured the parts. `measure-join-cost.sh` priced the
# fan-out mechanism against a synthetic kernel (~21 us, 2.52x);
# `measure-chain-balance.sh` priced the partition against real chains but only on
# paper, by feeding measured per-chain costs to an offline packer (2.98x at three
# lanes). Neither ever ran two real chains at the same time.
#
# This runs the real thing: one mixed twelve-chain set, held, measured SERIAL,
# then the same running set flipped to PARALLEL and measured again. The A/B is on
# one set on purpose — reloading between the two arms would change the chains,
# and the chains are what the answer depends on.
#
# The number is WALL time of ChainSlots::render, including fan-out and join
# (`wall=` in the cost report). Per-chain costs cannot show a speedup: parallel
# render does the same total work, it just does it at the same time.
#
# Usage: ./scripts/measure-parallel-render.sh [move.local] [module ...]
set -uo pipefail
cd "$(dirname "$0")/.."

HOST="${1:-move.local}"; shift || true
MODULES=("$@")
[ ${#MODULES[@]} -eq 0 ] && MODULES=(plaits obxd dexed noisemaker helm forge weird-dreams surge)

MOVY_DIR="$(pwd)"
# shellcheck source=lib/test-set.sh
source "$MOVY_DIR/scripts/lib/test-set.sh"
# shellcheck source=lib/chain-bench.sh
source "$MOVY_DIR/scripts/lib/chain-bench.sh"
LOG=/data/UserData/schwung/debug.log
CHAINS=12
# Short on purpose — several synths decay to silence under a HELD note, so a long
# window measures a tail. Same reasoning as measure-chain-balance.sh.
SETTLE=4
FRAME_US=2902       # plans/2026-08-21-frame-phase-measurement.md
BLD=$'\033[1m'; RST=$'\033[0m'; GRN=$'\033[0;32m'; RED=$'\033[0;31m'; YEL=$'\033[1;33m'

ssh -o ConnectTimeout=5 "ableton@$HOST" true 2>/dev/null || { echo "DEVICE OFFLINE"; exit 1; }
ssh "ableton@$HOST" 'touch /data/UserData/schwung/debug_log_on'

echo "${BLD}=== parallel chain render: serial vs parallel, one running set ===${RST}"
echo "host=$HOST  modules: ${MODULES[*]}"

ts_open_movy
sleep 8
cb_discover_samples

ASSIGN=()
for c in $(seq 0 $((CHAINS-1))); do
    ASSIGN+=("${MODULES[$((c % ${#MODULES[@]}))]}")
done

echo
echo "loading ${CHAINS} chains:"
for c in $(seq 0 $((CHAINS-1))); do
    printf '  ch%-3s %s\n' "$c" "${ASSIGN[$c]}"
    ep "ch$c:synth:module" "${ASSIGN[$c]}"
done
sleep $((CHAINS + 6))
for c in $(seq 0 $((CHAINS-1))); do cb_prepare "${ASSIGN[$c]}" "$c"; done
sleep 2

hold_chord() {
    for c in $(seq 0 $((CHAINS-1))); do
        cb_pitches "${ASSIGN[$c]}"
        for i in 0 1 2 3; do ep "ch$c:midi" "144.${CB_P[$i]}.100"; done
    done
}
release_chord() {
    for c in $(seq 0 $((CHAINS-1))); do
        cb_pitches "${ASSIGN[$c]}"
        for i in 0 1 2 3; do ep "ch$c:midi" "128.${CB_P[$i]}.0"; done
    done
}

# `arm <0|1>` then `sample <label>`: the first cost read is always a RESET that
# throws away the mode switch and the warm-up, so the window only ever contains
# settled blocks in the mode being measured.
sample() {  # sample <label> -> "<blocks> <wall_mean_ns> <wall_max_ns> <sounding> <per_chain_means>"
    ssh "ableton@$HOST" "> $LOG"
    ep "chcostlog" "1"
    sleep "$SETTLE"
    ep "chpeaklog" "1"
    ep "chcostlog" "1"; sleep 1
    local cost peaks
    cost=$(ssh  "ableton@$HOST" "grep -o 'chain cost: .*'  $LOG | tail -n 1")
    peaks=$(ssh "ableton@$HOST" "grep -o 'chain peaks: .*' $LOG | tail -n 1")
    local blocks wall snd means
    blocks=$(printf '%s' "$cost" | sed -n 's/.*blocks=\([0-9]*\).*/\1/p')
    wall=$(printf   '%s' "$cost" | sed -n 's/.*wall=\([0-9]*\)\/\([0-9]*\).*/\1 \2/p')
    snd=$(printf '%s' "$peaks" | sed 's/.*chain peaks: //' | tr ',' '\n' | awk '$1+0 > 0' | wc -l | tr -d ' ')
    # Per-chain MEANS only — the accounting sums them against the wall, and a
    # max would sum peaks that never happened in the same block.
    means=$(printf '%s' "$cost" | sed 's/.*cost=//' | tr ',' '\n' | cut -d/ -f1 | paste -sd, -)
    echo "$blocks $wall $snd $means"
}

read_plan() { ep "chrenderlog" "1"; sleep 1
    ssh "ableton@$HOST" "grep -o 'chain render: .*' $LOG | tail -n 1" | sed 's/chain render: //'
}

hold_chord

echo
echo "${BLD}A: serial${RST}"
ep "chparallel" "0"
read -r S_BLOCKS S_MEAN S_MAX S_SND S_COSTS <<<"$(sample serial)"
printf '  blocks=%s sounding=%s/%s  wall mean %.1f us  max %.1f us\n' \
    "$S_BLOCKS" "$S_SND" "$CHAINS" \
    "$(awk -v v="$S_MEAN" 'BEGIN{print v/1000}')" "$(awk -v v="$S_MAX" 'BEGIN{print v/1000}')"

echo
echo "${BLD}B: parallel${RST}"
ep "chparallel" "1"
sleep 2
PLAN_BEFORE=$(read_plan)
read -r P_BLOCKS P_MEAN P_MAX P_SND P_COSTS <<<"$(sample parallel)"
PLAN=$(read_plan)
printf '  blocks=%s sounding=%s/%s  wall mean %.1f us  max %.1f us\n' \
    "$P_BLOCKS" "$P_SND" "$CHAINS" \
    "$(awk -v v="$P_MEAN" 'BEGIN{print v/1000}')" "$(awk -v v="$P_MAX" 'BEGIN{print v/1000}')"
echo "  $PLAN"
# The costs are attributed to the lanes the plan names. A replan inside the
# window would attribute them to lanes that did not run them.
[ "${PLAN_BEFORE#*plan=}" != "${PLAN#*plan=}" ] && {
    echo "${YEL}WARNING: the plan changed during the window — lane figures are attributed to lanes"
    echo "  that did not run the whole window (the totals and contention are unaffected)"
    echo "  before: ${PLAN_BEFORE#*plan=}"
    echo "  after:  ${PLAN#*plan=}${RST}"
}

release_chord
for c in $(seq 0 $((CHAINS-1))); do ep "ch$c:synth:module" ""; done
ep "chparallel" "0"

echo
if [ -z "${S_MEAN:-}" ] || [ -z "${P_MEAN:-}" ] || [ "${S_MEAN:-0}" = "0" ]; then
    echo "${RED}no wall reading — is this build deployed? (needs wall= in the cost report)${RST}"
    exit 1
fi

# A silent chain is measured at its idle cost, and an idle set divides
# beautifully. Both arms have to be sounding for the comparison to mean anything.
[ "${S_SND:-0}" -lt "$CHAINS" ] || [ "${P_SND:-0}" -lt "$CHAINS" ] && \
    echo "${YEL}WARNING: not every chain was sounding — silent chains make the split look better than it is${RST}"

echo "${BLD}result${RST}"
awk -v s="$S_MEAN" -v p="$P_MEAN" -v sx="$S_MAX" -v px="$P_MAX" -v f="$FRAME_US" 'BEGIN{
    printf "  %-22s %10.1f us  ->  %10.1f us   %5.2fx\n", "wall mean", s/1000, p/1000, (p? s/p : 0)
    printf "  %-22s %10.1f us  ->  %10.1f us   %5.2fx\n", "wall max",  sx/1000, px/1000, (px? sx/px : 0)
    printf "  %-22s %9.1f%%  ->  %9.1f%%\n", "of the 2902us frame", 100*s/1000/f, 100*p/1000/f
}'
echo
# D1 (plans/2026-08-23-parallel-render-prototype.md §6): charge the gap to a
# line instead of guessing at it. Every input is already in the two log lines
# above — no extra device run, no extra instrumentation.
read -r A_SSUM A_SRES A_PSUM A_CONT A_MAKE A_IDEAL A_IMB A_OVH A_SPD A_CEIL A_LOADS A_INFL <<<"$(
    node scripts/lib/render-accounting.mjs "$S_MEAN" "$S_COSTS" "$P_MEAN" "$P_COSTS" "${PLAN#*plan=}"
)"
echo "${BLD}where the block went${RST}"
printf '  %-26s %9s us\n' "serial: sum of chains" "$A_SSUM"
printf '  %-26s %9s us   %s\n' "  timer residual" "$A_SRES" \
    "(should be ~0 — the per-chain timers vs the wall)"
printf '  %-26s %9s us   %s\n' "parallel: sum of chains" "$A_PSUM" "lanes: $A_LOADS us"
printf '  %-26s %9s us   %s\n' "  contention" "$A_CONT" "(same work, more threads)"
# Lane 0 is the audio thread at FIFO 90 on core 3 and CANNOT be preempted by
# Move's FIFO 70 workers; the FIFO 68 helpers can. Even inflation across lanes
# means cache/bandwidth; lane 0 staying flat while helpers rise means preemption.
printf '  %-26s %9s     %s\n' "  per-lane inflation" "$A_INFL" "(lane0 = audio thread, unpreemptable)"
printf '  %-26s %9s us   %s\n' "  perfect balance would be" "$A_IDEAL" ""
printf '  %-26s %9s us   %s\n' "  imbalance (plan)" "$A_IMB" "(pinning + LPT slack — §5, T1)"
printf '  %-26s %9s us   %s\n' "makespan" "$A_MAKE" "= busiest lane"
printf '  %-26s %9s us   %s\n' "  overhead (rendezvous)" "$A_OVH" "(fan-out + join + preemption — T2)"
printf '  %-26s %9sx\n' "measured speedup" "$A_SPD"
printf '  %-26s %9sx   %s\n' "ceiling if free rendezvous" "$A_CEIL" "(what T2 is worth, at most)"
echo
echo "${YEL}Read it as: contention and imbalance are NOT fan-out. Only 'overhead' is."
echo "A lane finishing early is charged to imbalance — the wall is set by the LAST"
echo "lane, so an idle lane cannot appear in the rendezvous residue.${RST}"
