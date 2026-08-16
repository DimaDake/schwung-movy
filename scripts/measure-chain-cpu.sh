#!/usr/bin/env bash
# measure-chain-cpu.sh — what does each movy-hosted chain cost per audio block?
#
# The design deliberately left the CPU ceiling unset: "measure on device, derive
# the cap from data" rather than guessing a number. This is that measurement.
#
# Movy renders its chains inside the overtake DSP's render_block, which the shim
# calls from shadow_inprocess_render_to_buffer. The shim already times exactly
# that and logs it as `render=avg/max` (microseconds) in the `Post(us)` half of
# its `spi_timing` line — NOT `mix_audio`, which covers the shim's own slot
# mixing and does not move when a movy chain is added (measured: flat 7us across
# six chains). Chains are loaded one at a time and the section re-read after
# each, giving a per-chain slope rather than a single total.
#
# Budget: ~900us for the SPI section, inside a 2900us frame (128 frames @ 44.1k).
#
# Usage: ./scripts/measure-chain-cpu.sh [move.local] [module] [max-chains]
set -uo pipefail
cd "$(dirname "$0")/.."

HOST="${1:-move.local}"
MODULE="${2:-plaits}"
MAX="${3:-6}"
MOVY_DIR="$(pwd)"
# shellcheck source=lib/test-set.sh
source "$MOVY_DIR/scripts/lib/test-set.sh"
LOG=/data/UserData/schwung/debug.log
BLD=$'\033[1m'; RST=$'\033[0m'; YEL=$'\033[1;33m'

ssh -o ConnectTimeout=5 "ableton@$HOST" true 2>/dev/null || {
    echo "DEVICE OFFLINE — cannot measure"; exit 1
}

echo "${BLD}=== per-chain render cost ===${RST}"
echo "host=$HOST module=$MODULE up to $MAX chains"
ssh "ableton@$HOST" 'touch /data/UserData/schwung/debug_log_on'

# `render=avg/max` (Post half of spi_timing) times
# shadow_inprocess_render_to_buffer — the call that invokes movy's render_block,
# and therefore every chain it renders.
mix_max() {
    ssh "ableton@$HOST" "grep -o 'render=[0-9]*/[0-9]*' $LOG | tail -n 12" \
        | awk -F/ '{ if ($2+0 > m) m = $2+0 } END { print m+0 }'
}
mix_avg() {
    ssh "ableton@$HOST" "grep -o 'render=[0-9]*/[0-9]*' $LOG | tail -n 12" \
        | awk -F= '{split($2,a,"/"); s+=a[1]; n++} END { print (n? int(s/n) : 0) }'
}

ssh "ableton@$HOST" "> $LOG"; sleep 10
BASE_AVG=$(mix_avg); BASE_MAX=$(mix_max)
echo
printf '%-8s %-14s %-14s %s\n' "chains" "render avg(us)" "render max(us)" "delta avg"
printf '%-8s %-14s %-14s %s\n' "0" "$BASE_AVG" "$BASE_MAX" "-"

PREV=$BASE_AVG
for n in $(seq 1 "$MAX"); do
    node scripts/engine-param.mjs set "ch$((n-1)):synth:module" "$MODULE" "$HOST" >/dev/null 2>&1
    sleep 3
    ssh "ableton@$HOST" "> $LOG"; sleep 10
    A=$(mix_avg); M=$(mix_max)
    printf '%-8s %-14s %-14s %s\n' "$n" "$A" "$M" "+$((A - PREV))"
    PREV=$A
done

echo
TOTAL=$((PREV - BASE_AVG))
if [ "$MAX" -gt 0 ] && [ "$TOTAL" -gt 0 ]; then
    PER=$((TOTAL / MAX))
    echo "${BLD}per-chain average: ~${PER}us${RST}  (${MODULE})"
    echo "SPI section budget ~900us, frame budget 2900us."
    if [ "$PER" -gt 0 ]; then
        echo "=> a 900us section fits roughly $((900 / PER)) chains of this module"
        echo "   (plus whatever the shim's own mixing already costs)"
    fi
else
    echo "${YEL}no measurable delta — either the chains did not load, or the"
    echo "cost is below this counter's resolution.${RST}"
fi

# Leave the chains unloaded so the next run starts from zero.
for n in $(seq 1 "$MAX"); do
    node scripts/engine-param.mjs set "ch$((n-1)):synth:module" "" "$HOST" >/dev/null 2>&1
done
echo
echo "cleared $MAX chain(s)"
