#!/usr/bin/env bash
# run-gate.sh — run a gate in the FOREGROUND and end with one verdict.
#
# WHY THIS EXISTS, and it is not convenience. On 2026-09-19 two implementer
# sessions ended their turn saying "waiting on the sweep" when the sweep was
# already dead; nothing was running, nobody noticed, and the orchestrator spent
# fourteen messages waking agents up. A command that has not returned cannot be
# mistaken for one that has. So this runs the gate in the foreground, prints a
# heartbeat while it works, and exits with the verdict — there is nothing to
# poll and nothing to believe about.
#
# It also removes the trap the gate itself is most often wrong about:
# `SCHWUNG=` is a BUILD-time alias, and a run without it reports the Schwung
# half as passed when it never ran. This script finds the checkout and exports
# it, and `browser-test/schwung-built.mjs` fails the run if the built bundle
# still has no param_pages.
#
#   ./scripts/run-gate.sh local              # build + every local suite
#   ./scripts/run-gate.sh preflight [host]   # is the DEVICE gate itself green?
#   ./scripts/run-gate.sh device [host]      # the full device tier
#   ./scripts/run-gate.sh both [host]        # local, then device
#
# PREFLIGHT IS THE ONE TO RUN FIRST, before starting an item rather than after
# finishing it. Three times in one session the tier turned out to be red for its
# OWN reasons — a partially cold chain, a check that graded the wrong window, an
# arm that was noted but never asserted — and each was discovered by an item that
# had already spent an hour. It is one scenario (`smoke`), ~90 s, and it answers
# "is the gate I am about to be judged by green right now".
set -uo pipefail

MODE="${1:-local}"
HOST="${2:-move.local}"
MOVY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$MOVY_DIR" || exit 2

BOLD='\033[1m'; RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'; RST='\033[0m'

# The checkout, so the build carries param_pages. Named rather than assumed:
# the one thing a caller must be able to see in the output.
if [ -z "${SCHWUNG:-}" ] && [ -d "$MOVY_DIR/../schwung/src/shared/param_pages" ]; then
    export SCHWUNG="$MOVY_DIR/../schwung"
fi
echo -e "${BOLD}gate:${RST} mode=$MODE host=$HOST SCHWUNG=${SCHWUNG:-<unset — the Schwung half will refuse to run>}"

# A heartbeat, not a progress bar: it says the process is alive and how long it
# has been, which is the only thing a reader needs while a 25-minute sweep runs.
heartbeat() {
    local label="$1" start=$SECONDS
    while sleep 30; do
        printf '  … %s still running (%dm%02ds)\n' "$label" $(( (SECONDS-start)/60 )) $(( (SECONDS-start)%60 ))
    done
}
stage() {
    local label="$1"; shift
    echo -e "${BOLD}→ $label${RST}"
    heartbeat "$label" & local hb=$!
    "$@"; local rc=$?
    kill "$hb" 2>/dev/null; wait "$hb" 2>/dev/null
    if [ $rc -eq 0 ]; then echo -e "${GRN}✓ $label${RST}"; else echo -e "${RED}✗ $label (exit $rc)${RST}"; fi
    return $rc
}

local_gate() { npm test; }
device_tier() { npm run test:device; }
# The canary, and the reachability check it needs. `smoke` is the scenario that
# opens the tool, arms its own renderer, turns knobs and reads them back — if
# the harness is broken, it is broken here.
preflight() {
    if ! ssh -o ConnectTimeout=5 -o BatchMode=yes "ableton@$HOST" echo ok >/dev/null 2>&1; then
        echo -e "${YLW}DEVICE OFFLINE ($HOST) — the device gate cannot run${RST}"
        return 3
    fi
    npm run test:device -- --scenario smoke
}

rc=0
case "$MODE" in
    local)     stage "local suites" local_gate; rc=$?;;
    device)    stage "device tier" device_tier; rc=$?;;
    preflight) stage "device preflight (smoke)" preflight; rc=$?;;
    both)      stage "local suites" local_gate; rc=$?
               [ $rc -eq 0 ] && { stage "device tier" device_tier; rc=$?; };;
    *) echo "usage: $0 {local|preflight|device|both} [host]"; exit 2;;
esac

echo
if [ $rc -eq 0 ]; then
    echo -e "${BOLD}${GRN}VERDICT: GREEN${RST} — $MODE"
elif [ $rc -eq 3 ]; then
    echo -e "${BOLD}${YLW}VERDICT: DEVICE OFFLINE${RST} — say so IN CAPS when reporting"
else
    echo -e "${BOLD}${RED}VERDICT: RED${RST} — $MODE (exit $rc). The evidence is above and, for the"
    echo    "         device tier, in .test-out/<scenario>.md. Do not re-run it to see if it passes."
fi
exit $rc
