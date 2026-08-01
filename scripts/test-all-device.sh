#!/usr/bin/env bash
# Runs every device suite. Each script establishes the fixture state itself, so
# any subset in any order is valid — that independence is the point, and this
# runner is only a convenience.
set -uo pipefail
HOST="${1:-move.local}"
cd "$(dirname "$0")/.."

GRN='\033[0;32m'; RED='\033[0;31m'; BLD='\033[1m'; RST='\033[0m'

SCRIPTS=(test.sh test-seq.sh test-auto.sh test-reselect.sh test-unload.sh
         test-mutes.sh test-volume.sh test-module-contract.sh)
declare -a FAILED=()

# Each suite normally restarts the Move stack on the way out to hand the LEDs
# back. Across a sweep that is eight needless restarts, so suppress theirs and
# do it once at the end — including on Ctrl-C, which is exactly when a
# half-finished sweep would otherwise leave the hardware dark.
export TS_SKIP_RESTORE=1
MOVY_DIR="$(pwd)"
# shellcheck source=lib/test-set.sh
source "$MOVY_DIR/scripts/lib/test-set.sh"
restore_at_end() { TS_SKIP_RESTORE=0 test_set_end; }
trap restore_at_end EXIT INT TERM

for s in "${SCRIPTS[@]}"; do
    echo -e "\n${BLD}########## $s ##########${RST}"
    ./scripts/"$s" "$HOST" || FAILED+=("$s")
done

echo -e "\n${BLD}########## test-jog-hint.mjs ##########${RST}"
node scripts/test-jog-hint.mjs "$HOST" || FAILED+=("test-jog-hint.mjs")

echo
if [ ${#FAILED[@]} -eq 0 ]; then
    echo -e "${GRN}${BLD}ALL DEVICE SUITES PASSED${RST}"
else
    echo -e "${RED}${BLD}FAILED: ${FAILED[*]}${RST}"; exit 1
fi
