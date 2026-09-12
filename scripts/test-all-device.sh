#!/usr/bin/env bash
# Runs every device suite. Each script establishes the fixture state itself, so
# any subset in any order is valid — that independence is the point, and this
# runner is only a convenience.
set -uo pipefail
HOST="${1:-move.local}"
cd "$(dirname "$0")/.."

GRN='\033[0;32m'; RED='\033[0;31m'; BLD='\033[1m'; RST='\033[0m'

# What MIGRATION.md's step 6 leaves behind: the one bash suite not yet
# migrated (test-seq.sh), plus test-jog-hint.mjs, which is blocked on
# SNAPSHOT_DISPLAY and was never migrated at all. Every retired script's own
# entry was removed here in the same commit that retired it, and nothing was
# ever added back for what replaced them — so this sweep silently shrank to 2
# of 14 suites while still printing a green "ALL DEVICE SUITES PASSED" banner.
# The TS scenarios are one entry below, run as the single process they already
# are (test-device/run.mjs), not unrolled per-scenario here.
SCRIPTS=(test-seq.sh)
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

for s in "${SCRIPTS[@]}"; do
    run_one "$s" ./scripts/"$s" "$HOST"
done
run_one "test:device (TS scenarios)" npm run test:device -- --host "$HOST"
run_one test-jog-hint.mjs node scripts/test-jog-hint.mjs "$HOST"

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
