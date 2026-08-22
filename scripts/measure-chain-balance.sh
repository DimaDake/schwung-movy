#!/usr/bin/env bash
# measure-chain-balance.sh — do twelve chains actually divide across three cores?
#
# `2026-08-22-join-cost-prototype.md` priced the fan-out mechanism (~21 us fixed,
# 2.52x at the design point) and left exactly one caveat that can still kill
# parallel chain render:
#
#     "2.52x assumes three equal shares. Real chains have wildly different
#      costs, so the achievable figure is bounded by the largest single chain,
#      not by the mean."
#
# That is Amdahl's law with a partition instead of a serial fraction. A static
# assignment of chains to workers cannot finish before its largest member, so if
# one synth is half the set's cost, no number of workers helps — and the
# correctness backlog behind parallel render (auditing 65 module repos, §2/§3 of
# the schwung review) is not worth starting.
#
# Every other benchmark here measures the TOTAL render and divides by the chain
# count (measure-chain-cpu.sh takes a slope, bench-chain-cpu.sh extrapolates
# one), so none of them can see a distribution — and all of them load the SAME
# module into every chain, which is the one arrangement guaranteed to look
# balanced. This loads a MIXED set, reads the engine's per-chain cost report,
# and computes the best makespan achievable by longest-processing-time-first.
#
# Usage: ./scripts/measure-chain-balance.sh [move.local] [module ...]
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
# Short on purpose. Several synths (plaits, dexed) decay to silence under a HELD
# note — their envelope does not sustain — so a long window measures a tail and
# reports them as nearly free. Measured at 14 s: 8/12 sounding, dexed at 13.9 us.
# The window has to sit just after the strike, while every chain is still loaded.
SETTLE=3
JOIN_US=21           # measured, plans/2026-08-22-join-cost-prototype.md
BLD=$'\033[1m'; RST=$'\033[0m'; GRN=$'\033[0;32m'; RED=$'\033[0;31m'; YEL=$'\033[1;33m'

ssh -o ConnectTimeout=5 "ableton@$HOST" true 2>/dev/null || { echo "DEVICE OFFLINE"; exit 1; }
ssh "ableton@$HOST" 'touch /data/UserData/schwung/debug_log_on'

echo "${BLD}=== chain balance: how well do twelve chains divide? ===${RST}"
echo "host=$HOST  modules: ${MODULES[*]}"

# Movy has to BE the loaded overtake DSP for any of this to exist — open it here
# rather than requiring a device gesture.
ts_open_movy
sleep 8
cb_discover_samples

# One module per chain, cycled — a real Move set is heterogeneous, and the whole
# question is what that does to the partition.
ASSIGN=()
for c in $(seq 0 $((CHAINS-1))); do
    ASSIGN+=("${MODULES[$((c % ${#MODULES[@]}))]}")
done

echo
echo "loading:"
for c in $(seq 0 $((CHAINS-1))); do
    printf '  ch%-3s %s\n' "$c" "${ASSIGN[$c]}"
    ep "ch$c:synth:module" "${ASSIGN[$c]}"
done
# One load per audio callback, so a twelve-chain load takes a moment.
sleep $((CHAINS + 6))
for c in $(seq 0 $((CHAINS-1))); do cb_prepare "${ASSIGN[$c]}" "$c"; done
sleep 2

# Hold a four-note chord in every chain. Held, not struck: a released note is
# measuring a decaying tail, and the ceiling question is about the loaded case.
for c in $(seq 0 $((CHAINS-1))); do
    cb_pitches "${ASSIGN[$c]}"
    for i in 0 1 2 3; do ep "ch$c:midi" "144.${CB_P[$i]}.100"; done
done

# First read is a RESET: it throws away the load-and-warm-up phase, which is
# dominated by dlopen and first-block allocation and is not what we are pricing.
ssh "ableton@$HOST" "> $LOG"
ep "chcostlog" "1"
sleep "$SETTLE"

# Are the chains ACTUALLY sounding? A synth that received nothing costs its idle
# price, and an idle set looks beautifully balanced. `peaks` is the LAST rendered
# block, so this has to be sampled INSIDE the window — read after the window
# closed it reported plaits silent (peak 0) for a chain that was sounding at
# 10721 during the measurement, purely because its LPG had decayed by then.
ep "chpeaklog" "1"
ep "chcostlog" "1"; sleep 1
COST=$(ssh  "ableton@$HOST" "grep -o 'chain cost: .*'  $LOG | tail -n 1" | sed 's/chain cost: //')
PEAKS=$(ssh "ableton@$HOST" "grep -o 'chain peaks: .*' $LOG | tail -n 1" | sed 's/chain peaks: //')
SOUNDING=$(printf '%s' "$PEAKS" | tr ',' '\n' | awk '$1+0 > 0' | wc -l | tr -d ' ')

for c in $(seq 0 $((CHAINS-1))); do
    cb_pitches "${ASSIGN[$c]}"
    for i in 0 1 2 3; do ep "ch$c:midi" "128.${CB_P[$i]}.0"; done
done
for c in $(seq 0 $((CHAINS-1))); do ep "ch$c:synth:module" ""; done

if [ -z "$COST" ]; then
    echo "${RED}no cost report in the log — is this build deployed? (needs chcostlog)${RST}"
    exit 1
fi

BLOCKS=$(printf '%s' "$COST" | sed -n 's/.*blocks=\([0-9]*\).*/\1/p')
WORST=$(printf  '%s' "$COST" | sed -n 's/.*worst=\([0-9]*\).*/\1/p')
PAIRS=$(printf  '%s' "$COST" | sed 's/.*cost=//')

echo
echo "measured over $BLOCKS blocks, sounding ${SOUNDING}/$CHAINS"
[ "${SOUNDING:-0}" -lt "$CHAINS" ] && \
    echo "${YEL}WARNING: silent chains are measured at their idle cost — the split will look more even than it is${RST}"

echo
echo "${BLD}per-chain render cost${RST}"
printf '  %-5s %-14s %10s %10s\n' "chain" "module" "mean(us)" "max(us)"
MEANS=()
i=0
IFS=',' read -ra PARR <<< "$PAIRS"
for p in "${PARR[@]}"; do
    M="${p%%/*}"; X="${p##*/}"
    MEANS+=("$M")
    printf '  %-5s %-14s %10s %10s\n' "ch$i" "${ASSIGN[$i]}" \
        "$(awk -v v="$M" 'BEGIN{printf "%.1f", v/1000}')" \
        "$(awk -v v="$X" 'BEGIN{printf "%.1f", v/1000}')"
    i=$((i+1))
done

# LPT: sort descending, drop each chain onto the least-loaded worker. Optimal
# within 4/3 of the true best partition, and the true best needs an exponential
# search that would not change the verdict.
partition() {  # partition <workers>  <- costs on stdin (ns, one per line)
    sort -rn | awk -v W="$1" '
        { c[NR]=$1; n=NR; tot+=$1 }
        END {
            for (w=0; w<W; w++) load[w]=0
            for (i=1; i<=n; i++) {
                best=0
                for (w=1; w<W; w++) if (load[w] < load[best]) best=w
                load[best] += c[i]
            }
            mk=0; for (w=0; w<W; w++) if (load[w] > mk) mk=load[w]
            printf "%d %d\n", tot, mk
        }'
}

COSTS=$(printf '%s\n' "${MEANS[@]}")
TOTAL=$(printf '%s' "$COSTS" | awk '{t+=$1} END{print t+0}')
LARGEST=$(printf '%s' "$COSTS" | sort -rn | head -n 1)

echo
awk -v t="$TOTAL" -v l="$LARGEST" 'BEGIN{
    printf "  %-20s %10.1f us\n", "serial total", t/1000
    printf "  %-20s %10.1f us   (%.0f%% of total)\n", "largest chain", l/1000, (t?100*l/t:0)
}'

echo
echo "${BLD}achievable speedup — static partition, LPT${RST}"
printf '  %-9s %12s %10s %14s\n' "workers" "makespan" "ideal" "with ${JOIN_US}us join"
for W in 2 3 4; do
    read -r _ MK <<<"$(printf '%s' "$COSTS" | partition "$W")"
    awk -v w="$W" -v t="$TOTAL" -v mk="$MK" -v j="$JOIN_US" 'BEGIN{
        printf "  %-9s %10.1fus %9.2fx %13.2fx\n", w, mk/1000, (mk?t/mk:0), t/(mk + j*1000)
    }'
done

echo
awk -v t="$TOTAL" -v l="$LARGEST" -v w="$WORST" -v c="$CHAINS" 'BEGIN{
    printf "  hard ceiling from the largest single chain: %.2fx (infinite workers)\n", (l? t/l : 0)
    printf "  worst observed block: %.1f us vs %.1f us mean total\n", w/1000, t/1000
}'
echo
echo "${YEL}A split is only worth the correctness work if 3 workers clears ~2x.${RST}"
echo "${YEL}If the largest chain dominates, the fix is a smarter partition or"
echo "splitting one chain — not more workers.${RST}"
