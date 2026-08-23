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
# then the same running set swept across LANE COUNTS. Every arm is on one set on
# purpose — reloading between arms would change the chains, and the chains are
# what the answer depends on.
#
# The number is WALL time of ChainSlots::render, including fan-out and join
# (`wall=` in the cost report). Per-chain costs cannot show a speedup: parallel
# render does the same total work, it just does it at the same time — except that
# D1 measured it doing 27% MORE of it under three lanes, which is why the lane
# count is swept rather than fixed (T0).
#
# Usage: ./scripts/measure-parallel-render.sh [move.local] [module ...]
#        LANES="2 3" ./scripts/measure-parallel-render.sh
set -uo pipefail
cd "$(dirname "$0")/.."

HOST="${1:-move.local}"; shift || true
MODULES=("$@")

MOVY_DIR="$(pwd)"
# shellcheck source=lib/test-set.sh
source "$MOVY_DIR/scripts/lib/test-set.sh"
# shellcheck source=lib/chain-bench.sh
source "$MOVY_DIR/scripts/lib/chain-bench.sh"
# Filled after the source, which is what provides the shared fleet list.
[ ${#MODULES[@]} -eq 0 ] && MODULES=("${CB_DEFAULT_MODULES[@]}")
LOG=/data/UserData/schwung/debug.log
CHAINS=12
# Lane counts to sweep, lane 0 being the audio thread. 1 is the control arm: the
# parallel path with no helpers, which prices the planner and rendezvous alone.
LANES="${LANES:-1 2 3}"
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
cb_require_engine_link
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


show_arm() {  # show_arm <blocks> <sounding> <mean_ns> <max_ns>
    printf '  blocks=%s sounding=%s/%s  wall mean %.1f us  max %.1f us\n' \
        "$1" "$2" "$CHAINS" \
        "$(awk -v v="$3" 'BEGIN{print v/1000}')" "$(awk -v v="$4" 'BEGIN{print v/1000}')"
}

# D1 (plans/2026-08-23-parallel-render-prototype.md §6): charge the block to a
# line instead of guessing at it. Every input is already in the two log lines the
# arm collected — no extra device run, no extra instrumentation.
account_arm() {  # account_arm <lanes>
    read -r A_SSUM A_SRES A_PSUM A_CONT A_MAKE A_IDEAL A_IMB A_OVH A_SPD A_CEIL A_LOADS A_INFL \
        <<<"$(node scripts/lib/render-accounting.mjs \
            "$S_MEAN" "$S_COSTS" "$P_MEAN" "$P_COSTS" "${PLAN#*plan=}")"
    printf '  %-26s %9s us   %s\n' "sum of chains" "$A_PSUM" "lanes: $A_LOADS us"
    printf '  %-26s %9s us   %s\n' "  contention" "$A_CONT" "(same work, more threads)"
    # Lane 0 is the audio thread at FIFO 90 on core 3 and CANNOT be preempted by
    # Move's FIFO 70 workers; the FIFO 68 helpers can. Even inflation across lanes
    # means cache/bandwidth; lane 0 staying flat while helpers rise means preemption.
    printf '  %-26s %9s     %s\n' "  per-lane inflation" "$A_INFL" "(lane0 = audio thread, unpreemptable)"
    printf '  %-26s %9s us   %s\n' "  imbalance (plan)" "$A_IMB" "(vs $A_IDEAL us perfectly balanced)"
    printf '  %-26s %9s us   %s\n' "makespan" "$A_MAKE" "= busiest lane"
    printf '  %-26s %9s us   %s\n' "  overhead (rendezvous)" "$A_OVH" "(fan-out + join + preemption)"
    ROWS+=("$1 $P_MEAN $A_SPD $A_CONT $A_IMB $A_OVH $A_CEIL $P_SND")
}

# Re-strike from a KNOWN state, releasing first. Sending the note-ons again on
# top of a held chord STACKS voices on every polyphonic synth in the set — the
# first sweep did that and its closing serial baseline came back 82% more
# expensive than its opening one, with the one-lane control arm reporting 1.39x
# "contention" against no helper threads at all. Cost that grows with the arm
# number is indistinguishable from a lane count that does not pay.
restrike_chord() { release_chord; sleep 1; hold_chord; }

hold_chord

echo
echo "${BLD}A: serial — the baseline every arm is scored against${RST}"
ep "chparallel" "0"
read -r S_BLOCKS S_MEAN S_MAX S_SND S_COSTS <<<"$(sample)"
show_arm "$S_BLOCKS" "$S_SND" "$S_MEAN" "$S_MAX"
if [ -z "${S_MEAN:-}" ] || [ "${S_MEAN:-0}" = "0" ]; then
    echo "${RED}no wall reading — is this build deployed? (needs wall= in the cost report)${RST}"
    exit 1
fi

# T0. The lane count is the design point, not a tuning detail: D1 measured the
# chains costing 27% MORE under three lanes, so a lane is a cost to its
# neighbours as much as it is a worker, and "three is best" was priced by a
# measurement that assumed otherwise. `chlanes 1` is the control arm — the
# parallel path with nothing to fan out to, which prices the planner and the
# rendezvous on their own.
ROWS=()
ep "chparallel" "1"
for N in $LANES; do
    echo
    echo "${BLD}B: parallel, $N lane(s)${RST}"
    # Several synths decay to silence under a HELD note (the preset table in
    # chain-bench.sh only slows that down), so without this each arm would
    # measure a quieter, cheaper set than the one before it.
    restrike_chord
    ep "chlanes" "$N"
    sleep 2
    PLAN_BEFORE=$(read_plan)
    read -r P_BLOCKS P_MEAN P_MAX P_SND P_COSTS <<<"$(sample)"
    PLAN=$(read_plan)
    show_arm "$P_BLOCKS" "$P_SND" "$P_MEAN" "$P_MAX"
    echo "  $PLAN"
    # The costs are attributed to the lanes the plan names. A replan inside the
    # window would attribute them to lanes that did not run them.
    [ "${PLAN_BEFORE#*plan=}" != "${PLAN#*plan=}" ] && {
        echo "${YEL}WARNING: the plan changed during the window — lane figures are attributed to lanes"
        echo "  that did not run the whole window (the totals and contention are unaffected)"
        echo "  before: ${PLAN_BEFORE#*plan=}"
        echo "  after:  ${PLAN#*plan=}${RST}"
    }
    account_arm "$N"
done

# The sweep spends a minute or two on one held chord, and every synth in it is
# decaying the whole time. Measuring the baseline again at the end bounds that:
# if the two serial figures agree, the arms in between are comparable to each
# other; if they do not, the sweep measured the decay.
echo
echo "${BLD}C: serial again — drift check${RST}"
restrike_chord
ep "chparallel" "0"
read -r D_BLOCKS D_MEAN D_MAX D_SND D_COSTS <<<"$(sample)"
show_arm "$D_BLOCKS" "$D_SND" "$D_MEAN" "$D_MAX"

release_chord
for c in $(seq 0 $((CHAINS-1))); do ep "ch$c:synth:module" ""; done
ep "chparallel" "0"

# A silent chain is measured at its idle cost, and an idle set divides
# beautifully. The arms have to be sounding for the comparison to mean anything.
echo
[ "${S_SND:-0}" -lt "$CHAINS" ] && \
    echo "${YEL}WARNING: only $S_SND/$CHAINS chains were sounding — silent chains make the split look better than it is${RST}"
[ "${EP_FAILS:-0}" -gt 0 ] && \
    echo "${RED}WARNING: $EP_FAILS engine writes failed — some arm was not configured as reported${RST}"

echo "${BLD}how many lanes?${RST}"
printf '  %-6s %10s %8s %11s %10s %9s %8s %9s\n' \
    lanes wall speedup contention imbalance overhead ceiling sounding
awk -v s="$S_MEAN" -v sn="$S_SND" -v ch="$CHAINS" 'BEGIN{
    printf "  %-6s %9.1fus %8s %11s %10s %9s %8s %9s\n",
        "serial", s/1000, "1.00x", "-", "-", "-", "-", sn "/" ch
}'
for r in "${ROWS[@]}"; do
    read -r n mean spd cont imb ovh ceil snd <<<"$r"
    awk -v n="$n" -v m="$mean" -v sp="$spd" -v c="$cont" -v i="$imb" -v o="$ovh" -v ce="$ceil" \
        -v sn="$snd" -v ch="$CHAINS" 'BEGIN{
        printf "  %-6s %9.1fus %7sx %10sus %9sus %8sus %7sx %9s\n", n, m/1000, sp, c, i, o, ce, sn "/" ch
    }'
done
awk -v s="$S_MEAN" -v d="$D_MEAN" 'BEGIN{
    printf "\n  serial drift over the sweep: %.1f us -> %.1f us  (%.1f%%)\n", s/1000, d/1000, (s? 100*(d-s)/s : 0)
}'

# Two gates on whether the table above may be read at all. They are cheap and
# they are what the first sweep needed: it printed a plausible-looking ranking
# from a set whose cost grew under it, and nothing in the ranking said so.
awk -v s="$S_MEAN" -v d="$D_MEAN" -v y="$YEL" -v r="$RST" 'BEGIN{
    drift = s ? 100 * (d - s) / s : 0; if (drift < 0) drift = -drift
    if (drift > 10) printf "%sWARNING: the set changed under the sweep (%.0f%% drift) — the arms are NOT comparable%s\n", y, drift, r
}'
for row in "${ROWS[@]}"; do
    read -r n _ spd _ <<<"$row"
    [ "$n" = "1" ] && awk -v sp="$spd" -v y="$YEL" -v r="$RST" 'BEGIN{
        # One lane runs the parallel path with nothing to hand out, so it can only
        # differ from serial by the planner and the rendezvous. Anything else means
        # the two arms did not see the same work.
        if (sp < 0.9 || sp > 1.1) printf "%sWARNING: the one-lane control arm read %.2fx, not ~1.00x — the sweep measured something other than lanes%s\n", y, sp, r
    }'
done

echo
echo "${YEL}Read it as: contention and imbalance are NOT fan-out. Only 'overhead' is."
echo "A lane finishing early is charged to imbalance — the wall is set by the LAST"
echo "lane, so an idle lane cannot appear in the rendezvous residue. And a lane is"
echo "not free to its neighbours: if contention rises faster than the split saves,"
echo "the extra lane is costing more than it buys.${RST}"
