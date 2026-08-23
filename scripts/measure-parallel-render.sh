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
sample() {  # sample <label> -> "<blocks> <wall_mean_ns> <wall_max_ns> <sounding>"
    ssh "ableton@$HOST" "> $LOG"
    ep "chcostlog" "1"
    sleep "$SETTLE"
    ep "chpeaklog" "1"
    ep "chcostlog" "1"; sleep 1
    local cost peaks
    cost=$(ssh  "ableton@$HOST" "grep -o 'chain cost: .*'  $LOG | tail -n 1")
    peaks=$(ssh "ableton@$HOST" "grep -o 'chain peaks: .*' $LOG | tail -n 1")
    local blocks wall snd
    blocks=$(printf '%s' "$cost" | sed -n 's/.*blocks=\([0-9]*\).*/\1/p')
    wall=$(printf   '%s' "$cost" | sed -n 's/.*wall=\([0-9]*\)\/\([0-9]*\).*/\1 \2/p')
    snd=$(printf '%s' "$peaks" | sed 's/.*chain peaks: //' | tr ',' '\n' | awk '$1+0 > 0' | wc -l | tr -d ' ')
    echo "$blocks $wall $snd"
}

hold_chord

echo
echo "${BLD}A: serial${RST}"
ep "chparallel" "0"
read -r S_BLOCKS S_MEAN S_MAX S_SND <<<"$(sample serial)"
printf '  blocks=%s sounding=%s/%s  wall mean %.1f us  max %.1f us\n' \
    "$S_BLOCKS" "$S_SND" "$CHAINS" \
    "$(awk -v v="$S_MEAN" 'BEGIN{print v/1000}')" "$(awk -v v="$S_MAX" 'BEGIN{print v/1000}')"

echo
echo "${BLD}B: parallel${RST}"
ep "chparallel" "1"
sleep 2
ep "chrenderlog" "1"
read -r P_BLOCKS P_MEAN P_MAX P_SND <<<"$(sample parallel)"
ep "chrenderlog" "1"; sleep 1
PLAN=$(ssh "ableton@$HOST" "grep -o 'chain render: .*' $LOG | tail -n 1" | sed 's/chain render: //')
printf '  blocks=%s sounding=%s/%s  wall mean %.1f us  max %.1f us\n' \
    "$P_BLOCKS" "$P_SND" "$CHAINS" \
    "$(awk -v v="$P_MEAN" 'BEGIN{print v/1000}')" "$(awk -v v="$P_MAX" 'BEGIN{print v/1000}')"
echo "  $PLAN"

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
echo "${YEL}Compare against 2.98x, the offline prediction from the same modules in"
echo "plans/2026-08-22-chain-balance-measurement.md. A large gap is the fan-out"
echo "and the lane pinning, which that prediction did not charge for.${RST}"
