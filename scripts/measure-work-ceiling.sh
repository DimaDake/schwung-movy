#!/usr/bin/env bash
# measure-work-ceiling.sh — how much per-frame WORK can the shim absorb before
# the frame stops keeping up?
#
# Needed because the obvious budget numbers are both wrong:
#
#   * `total` (~2660us) is pre + ioctl + post, and the ioctl is mostly the
#     blocking WAIT for the next SPI frame. Work displaces that wait, so total
#     barely moves as chains are added — it reads as if chains were free.
#   * the 2900us frame period is not a work budget either, because the transfer
#     itself occupies part of it.
#
# So the ceiling is found by ramping: load a synth into 1..12 chains, hold a
# 4-note chord in each, and watch where `total` starts climbing and the ioctl
# wait collapses. The last chain count before that is the usable work budget.
#
# Usage: ./scripts/measure-work-ceiling.sh [move.local] [module] [max-chains]
set -uo pipefail
cd "$(dirname "$0")/.."

HOST="${1:-move.local}"
MODULE="${2:-surge}"
MAX="${3:-12}"
MOVY_DIR="$(pwd)"
# shellcheck source=lib/test-set.sh
source "$MOVY_DIR/scripts/lib/test-set.sh"
# shellcheck source=lib/chain-bench.sh
# for `ep` and the Frame(us) readers, which measure-chain-idle.sh also needs.
source "$MOVY_DIR/scripts/lib/chain-bench.sh"
LOG=/data/UserData/schwung/debug.log
SETTLE=10
PITCHES=(60 64 67 71)
BLD=$'\033[1m'; RST=$'\033[0m'; YEL=$'\033[1;33m'

ssh -o ConnectTimeout=5 "ableton@$HOST" true 2>/dev/null || { echo "DEVICE OFFLINE"; exit 1; }
ssh "ableton@$HOST" 'touch /data/UserData/schwung/debug_log_on'

cb_require_engine_link

echo "${BLD}=== work ceiling ramp ===${RST}"
echo "host=$HOST module=$MODULE up to $MAX chains, 4 held notes each"
for i in $(seq 0 11); do ep "ch$i:synth:module" ""; done
sleep 3

printf '\n%-8s %-10s %-10s %-10s %-10s\n' "chains" "work(us)" "pre" "post" "total"
ssh "ableton@$HOST" "> $LOG"; sleep "$SETTLE"
printf '%-8s %-10s %-10s %-10s %-10s\n' "0" \
    "$(( $(cb_frame_field pre) + $(cb_frame_field post) ))" "$(cb_frame_field pre)" "$(cb_frame_field post)" "$(cb_frame_total)"

for n in $(seq 1 "$MAX"); do
    ep "ch$((n-1)):synth:module" "$MODULE"
    sleep 4
    for p in "${PITCHES[@]}"; do ep "ch$((n-1)):midi" "144.$p.100"; done
    ssh "ableton@$HOST" "> $LOG"; sleep "$SETTLE"
    PRE=$(cb_frame_field pre); POST=$(cb_frame_field post); TOT=$(cb_frame_total)
    printf '%-8s %-10s %-10s %-10s %-10s\n' "$n" "$((PRE + POST))" "$PRE" "$POST" "$TOT"
done

echo
echo "${YEL}Read the TOTAL column: it stays flat while the ioctl wait absorbs the"
echo "extra work, and climbs once the wait is exhausted. The work value at the"
echo "last flat row is the usable budget.${RST}"

for i in $(seq 0 11); do
    for p in "${PITCHES[@]}"; do ep "ch$i:midi" "128.$p.0"; done
    ep "ch$i:synth:module" ""
done
echo "cleared"
