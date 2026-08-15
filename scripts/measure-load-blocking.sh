#!/usr/bin/env bash
# measure-load-blocking.sh — how long does a chain module load block the SPI
# audio callback?
#
# schwung handles `synth:module` (dlopen + module.json + preset reads) inside
# shadow_inprocess_handle_param_request(), which runs in shim_pre_transfer —
# the real-time SPI callback with a ~900us budget. The shim already times that
# section and logs it as `param=avg/max` (microseconds) in its `spi_timing`
# line, every 1000 callbacks (~2.9 s).
#
# This measures the platform's OWN cost so movy can decide whether hosting its
# chains the same way is acceptable, or whether it needs to move loads off the
# audio thread. Answering it with schwung's numbers rather than movy's means the
# answer is available before any of movy's chain hosting exists.
#
# Usage: ./scripts/measure-load-blocking.sh [move.local] [slot] [module-a] [module-b]
set -uo pipefail

HOST="${1:-move.local}"
SLOT="${2:-0}"
MOD_A="${3:-plaits}"
MOD_B="${4:-none}"
LOG=/data/UserData/schwung/debug.log

BLD=$'\033[1m'; GRN=$'\033[0;32m'; YEL=$'\033[1;33m'; RST=$'\033[0m'

ssh -o ConnectTimeout=5 "ableton@$HOST" true 2>/dev/null || {
    echo "DEVICE OFFLINE — cannot measure"; exit 1
}

echo "${BLD}=== chain module load: SPI callback blocking ===${RST}"
echo "host=$HOST slot=$SLOT  swapping: $MOD_A <-> $MOD_B"

# Debug log carries spi_timing (LOG_LEVEL_DEBUG); persists until cleared.
ssh "ableton@$HOST" 'touch /data/UserData/schwung/debug_log_on'

# Collect `param=avg/max` values from spi_timing lines.
param_stats() {
    ssh "ableton@$HOST" "grep -o 'param=[0-9]*/[0-9]*' $LOG | tail -n ${1:-20}"
}
max_of() { awk -F/ '{ if ($2+0 > m) m = $2+0 } END { print m+0 }'; }

echo
echo "${BLD}1. Baseline — no module loads${RST}"
ssh "ableton@$HOST" "> $LOG"
sleep 12                                  # ~4 spi_timing windows
BASE=$(param_stats 20 | max_of)
echo "   idle param handler max: ${BASE} us"

echo
echo "${BLD}2. During module loads${RST}"
ssh "ableton@$HOST" "> $LOG"
for i in 1 2 3; do
    node scripts/module-slot.mjs set "$SLOT" synth "$MOD_A" >/dev/null 2>&1
    sleep 4
    node scripts/module-slot.mjs set "$SLOT" synth "$MOD_B" >/dev/null 2>&1
    sleep 4
done
LOADED=$(param_stats 40 | max_of)
echo "   param handler max across loads: ${LOADED} us"

echo
echo "${BLD}=== Result ===${RST}"
echo "   idle:          ${BASE} us"
echo "   with loads:    ${LOADED} us"
echo "   SPI budget:    ~900 us per callback"
if [ "${LOADED:-0}" -gt 0 ]; then
    if [ "${LOADED}" -gt 900 ]; then
        echo "   ${YEL}A single load OVERRUNS the callback budget.${RST}"
        echo "   => serialising loads (one per callback) bounds a 12-chain burst"
        echo "      but each one still overruns; moving loads off the audio"
        echo "      thread is worth its complexity."
    else
        echo "   ${GRN}A single load fits inside the callback budget.${RST}"
        echo "   => serialising loads (one per callback) is sufficient; a worker"
        echo "      thread would add concurrency against unlocked chain state"
        echo "      for no measured gain."
    fi
fi
echo
echo "Raw spi_timing samples:"
ssh "ableton@$HOST" "grep -o 'param=[0-9]*/[0-9]*' $LOG | tail -12" | sed 's/^/   /'
