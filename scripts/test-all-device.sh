#!/usr/bin/env bash
# Runs every device suite. Each script establishes the fixture state itself, so
# any subset in any order is valid — that independence is the point, and this
# runner is only a convenience.
#
# TS_HOST_MODE picks which host owns tracks 1-4 (`schwung`, the default, or
# `movy`). Prefer the two named wrappers — test-all-device-schwung.sh and
# test-all-device-movy.sh — so a sweep says in its own name what it covered.
set -uo pipefail
HOST="${1:-move.local}"
TS_HOST_MODE="${TS_HOST_MODE:-schwung}"
export TS_HOST_MODE
cd "$(dirname "$0")/.."

GRN='\033[0;32m'; RED='\033[0;31m'; BLD='\033[1m'; RST='\033[0m'

SCRIPTS=(test.sh test-seq.sh test-auto.sh test-reselect.sh test-unload.sh
         test-mutes.sh test-volume.sh test-module-contract.sh test-master-fx.sh
         test-lfo.sh test-items.sh)
declare -a FAILED=()

# Each suite normally restarts the Move stack on the way out to hand the LEDs
# back. Across a sweep that is eight needless restarts, so suppress theirs and
# do it once at the end — including on Ctrl-C, which is exactly when a
# half-finished sweep would otherwise leave the hardware dark.
export TS_SKIP_RESTORE=1
MOVY_DIR="$(pwd)"
# shellcheck source=lib/test-set.sh
source "$MOVY_DIR/scripts/lib/test-set.sh"
# Read the user's own track-host setting BEFORE the first suite pins it. A
# suite's own save would record whatever the previous one left behind, so the
# sweep is the only place that still knows what the device came in with.
ts_save_host_flag
restore_at_end() { TS_SKIP_RESTORE=0 test_set_end; }
trap restore_at_end EXIT INT TERM

echo -e "${BLD}### tracks 1-4 host: $TS_HOST_MODE ###${RST}"
SWEEP_T0=$(date +%s)
declare -a TIMES=()
run_one() {   # name, then the command
    local name="$1"; shift
    local t0; t0=$(date +%s)
    echo -e "\n${BLD}########## $name ##########${RST}"
    "$@" || FAILED+=("$name")
    local dt=$(( $(date +%s) - t0 ))
    TIMES+=("$(printf '%5ss  %s' "$dt" "$name")")
    echo -e "${BLD}---------- $name took ${dt}s ----------${RST}"
}

for s in "${SCRIPTS[@]}"; do
    run_one "$s" ./scripts/"$s" "$HOST"
done
run_one test-jog-hint.mjs node scripts/test-jog-hint.mjs "$HOST"

echo
echo -e "${BLD}=== Time per suite (slowest last) ===${RST}"
printf '%s\n' "${TIMES[@]}" | sort -n
echo -e "${BLD}total: $(( $(date +%s) - SWEEP_T0 ))s${RST}"

echo
if [ ${#FAILED[@]} -eq 0 ]; then
    echo -e "${GRN}${BLD}ALL DEVICE SUITES PASSED (tracks 1-4 host: $TS_HOST_MODE)${RST}"
else
    echo -e "${RED}${BLD}FAILED (tracks 1-4 host: $TS_HOST_MODE): ${FAILED[*]}${RST}"; exit 1
fi
