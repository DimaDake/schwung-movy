#!/usr/bin/env bash
# Runs every device suite. Each script establishes the fixture state itself, so
# any subset in any order is valid — that independence is the point, and this
# runner is only a convenience.
set -uo pipefail
HOST="${1:-move.local}"
cd "$(dirname "$0")/.."

GRN='\033[0;32m'; RED='\033[0;31m'; BLD='\033[1m'; RST='\033[0m'

# Nothing bash left in the sweep. `test-seq.sh` was the last one and its
# scenario (test-device/scenarios/seq.ts) took over on 2026-09-13; the four
# scripts still in scripts/ were never in this sweep. test-jog-hint.mjs used to
# be here too, recorded as blocked on a schwung change (SNAPSHOT_DISPLAY) — it
# never was: the framebuffer is a file in /dev/shm and scp reads it, which is
# what the script itself did. It is the `jog-hint` scenario now.
#
# This wrapper is kept for the ONE thing `npm run test:device` does not do:
# hand the LEDs back afterwards, including on Ctrl-C. Add a bash suite here
# only if one ever comes back, which the Test 16 ratchet says it may not.
SCRIPTS=()
declare -a FAILED=()

# Each bash suite normally restarts the Move stack on the way out to hand the
# LEDs back. Across a sweep that is a needless restart per suite, so suppress
# theirs and do it once at the end — including on Ctrl-C, which is exactly
# when a half-finished sweep would otherwise leave the hardware dark. The TS
# scenarios manage their own device connection independently of this trap.
export TS_SKIP_RESTORE=1
MOVY_DIR="$(pwd)"
# shellcheck source=lib/test-set.sh
source "$MOVY_DIR/scripts/lib/test-set.sh"
restore_at_end() { TS_SKIP_RESTORE=0 test_set_end; }
trap restore_at_end EXIT INT TERM

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

for s in "${SCRIPTS[@]+"${SCRIPTS[@]}"}"; do
    run_one "$s" ./scripts/"$s" "$HOST"
done
run_one "test:device (TS scenarios)" npm run test:device -- --host "$HOST"

echo
echo -e "${BLD}=== Time per suite (slowest last) ===${RST}"
printf '%s\n' "${TIMES[@]}" | sort -n
echo -e "${BLD}total: $(( $(date +%s) - SWEEP_T0 ))s${RST}"

echo
if [ ${#FAILED[@]} -eq 0 ]; then
    echo -e "${GRN}${BLD}ALL DEVICE SUITES PASSED${RST}"
else
    echo -e "${RED}${BLD}FAILED: ${FAILED[*]}${RST}"; exit 1
fi
