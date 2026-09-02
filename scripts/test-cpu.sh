#!/usr/bin/env bash
# test-cpu.sh — the CPU meter's numbers, on real hardware.
#
# Everything the meter DRAWS is covered by local suites; what only the device can
# answer is whether the engine measures anything real, and whether a chain that
# stops sounding stops being charged for it. That second one is the fix in
# `render_parallel` (cost_ns is never cleared between rounds, and a deep-asleep
# chain builds no task), and it is unreachable from a host build because a host
# build cannot load a chain at all.
#
# Reads through `cpulog`, the write-to-read verb — the remote-UI socket can write
# but not read, so a write that makes the engine log is the only way in.
#
# Usage: ./scripts/test-cpu.sh [move.local]
set -uo pipefail
cd "$(dirname "$0")/.."

HOST="${1:-move.local}"
LOG=/data/UserData/schwung/debug.log
CHAINS=(4 5)
MODULE=plaits
FAILS=0

pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s: %s\n' "$1" "$2"; FAILS=$((FAILS + 1)); }
check() { if [ "$2" = 1 ]; then pass "$1"; else fail "$1" "${3:-assertion failed}"; fi; }

MOVY_DIR="$(pwd)"
# shellcheck source=lib/test-set.sh
source "$MOVY_DIR/scripts/lib/test-set.sh"
# shellcheck source=lib/chain-bench.sh
source "$MOVY_DIR/scripts/lib/chain-bench.sh"

# A dropped write is only useful if you know WHICH one — a bare count leaves you
# rerunning the whole suite to find out. Retried once: the first write after
# `ts_open_movy` races the engine's dlopen, and that one is not a fault.
EP_DROPPED=()
ep() {
    node scripts/engine-param.mjs set "$1" "$2" "$HOST" >/dev/null 2>&1 && return 0
    sleep 1
    node scripts/engine-param.mjs set "$1" "$2" "$HOST" >/dev/null 2>&1 && return 0
    EP_FAILS=$((EP_FAILS + 1)); EP_DROPPED+=("$1"); return 1
}

ssh "ableton@$HOST" "touch /data/UserData/schwung/debug_log_on" >/dev/null 2>&1
# Movy has to BE the loaded overtake DSP for the engine to exist at all — a
# stack restart leaves nothing loaded, and every `ep` write then goes to no one.
ts_open_movy
sleep 3
cb_require_engine_link

# `cpulog` appends; every read takes the LAST line, so the log is cleared once
# and each phase is read after its own write.
cpu_read() {
    ep "cpulog" "1"
    sleep 1
    ssh "ableton@$HOST" "grep -o 'cpu: .*' $LOG | tail -n 1" 2>/dev/null
}
field() { printf '%s' "$1" | grep -o "$2=[^ ]*" | head -n 1 | cut -d= -f2; }
# Column N of the chcost triple list, as an integer (1=total, 2=synth, 3=peak).
col() { printf '%s' "$1" | tr ',' '\n' | sed -n "$(($2 + 1))p" | cut -d/ -f"$3"; }

echo "cpu meter on $HOST"
ssh "ableton@$HOST" "> $LOG" >/dev/null 2>&1

# ── Arm 1: chains loaded and SOUNDING ───────────────────────────────────────
for c in "${CHAINS[@]}"; do ep "ch$c:synth:module" "$MODULE"; done
sleep 8
for c in "${CHAINS[@]}"; do ep "ch$c:synth:decay" "1"; done   # or the LPG decays it to silence
cb_pitches "$MODULE"
for c in "${CHAINS[@]}"; do
    for i in 0 1 2 3; do ep "ch$c:midi" "144.${CB_P[$i]}.100"; done
done
sleep 2
ep "cpurst" "1"      # start the peak observation the way the page does
sleep 1
LIVE=$(cpu_read)

if [ -z "$LIVE" ]; then
    fail "the engine answered cpulog" "no 'cpu:' line in $LOG — is ENGINE 0.62.0 deployed?"
    echo; printf '\033[31m\033[1m%d CPU-METER CHECK(S) FAILED\033[0m\n' "$((FAILS + 1))"; exit 1
fi
pass "the engine answered cpulog"
echo "    $LIVE"

WALL=$(field "$LIVE" chwall)
BLOCK=$(printf '%s' "$WALL" | cut -d/ -f3)
COST=$(field "$LIVE" chcost)
MASK=$(field "$LIVE" chmask)
LOADED=$(printf '%s' "$MASK" | cut -d/ -f1)
ASLEEP_LIVE=$(printf '%s' "$MASK" | cut -d/ -f2)

check "the block period is the audio block" \
    "$([ "$BLOCK" -gt 2800 ] && [ "$BLOCK" -lt 3000 ] && echo 1 || echo 0)" \
    "expected ~2902 us, got '$BLOCK'"
check "chcost carries one triple per chain" \
    "$([ "$(printf '%s' "$COST" | awk -F, '{print NF}')" = 16 ] && echo 1 || echo 0)" \
    "got '$COST'"
check "the loaded mask names the chains that were loaded" \
    "$([ "$LOADED" != "0000" ] && echo 1 || echo 0)" "mask '$MASK'"

C0=${CHAINS[0]}
T0=$(col "$COST" "$C0" 1); S0=$(col "$COST" "$C0" 2); P0=$(col "$COST" "$C0" 3)
check "a sounding chain costs something" \
    "$([ "${T0:-0}" -gt 0 ] && echo 1 || echo 0)" "chain $C0 total '$T0' us"
check "its synth stage is part of that, not more than it" \
    "$([ "${S0:-0}" -le "${T0:-0}" ] && echo 1 || echo 0)" "synth $S0 > total $T0"
check "the held peak is at least the mean" \
    "$([ "${P0:-0}" -ge "${T0:-0}" ] && echo 1 || echo 0)" "peak $P0 < mean $T0"
check "the whole render has a wall time" \
    "$([ "$(printf '%s' "$WALL" | cut -d/ -f1)" -gt 0 ] && echo 1 || echo 0)" "wall '$WALL'"

# ── Arm 2: the same chains SILENT ───────────────────────────────────────────
# The Task-2 fix. Before it, a deep-asleep chain re-added the cost it had while
# awake on every block and its mean never moved.
#
# `decay` goes back down first. Arm 1 set it to maximum so a HELD note keeps
# sounding (plaits' LPG decays a held note otherwise), and at that setting the
# tail after note-off never falls under SILENCE_LEVEL — the chain simply never
# sleeps, and the arm asserts against a premise that was never met.
for c in "${CHAINS[@]}"; do
    ep "ch$c:synth:decay" "0"
    for i in 0 1 2 3; do ep "ch$c:midi" "128.${CB_P[$i]}.0"; done
done
sleep 14                                   # past SLEEP_AFTER (344 blocks) plus decay
IDLE=$(cpu_read)
echo "    $IDLE"
# Did the chains ACTUALLY go quiet? `peaks` is the last rendered block, so a
# non-zero reading here means the arm's premise failed and every assertion under
# it would be about the wrong thing.
ep "chpeaklog" "1"; sleep 1
PEAKS=$(ssh "ableton@$HOST" "grep -o 'chain peaks: .*' $LOG | tail -n 1" 2>/dev/null | sed 's/chain peaks: //')
PK0=$(printf '%s' "$PEAKS" | tr ',' '\n' | sed -n "$((C0 + 1))p")

ICOST=$(field "$IDLE" chcost)
IMASK=$(field "$IDLE" chmask)
ASLEEP=$(printf '%s' "$IMASK" | cut -d/ -f2)
IT0=$(col "$ICOST" "$C0" 1)

if [ "${PK0:-1}" != "0" ]; then
    fail "chain $C0 went silent" \
        "peak still ${PK0:-?} — the sleep arm cannot run, so the decay fix is UNVERIFIED here"
else
    pass "chain $C0 went silent (peak 0)"
    check "a silent chain is reported asleep" \
        "$([ "$ASLEEP" != "0000" ] && echo 1 || echo 0)" \
        "asleep mask '$ASLEEP' (was '$ASLEEP_LIVE' while sounding)"
    check "and stops being charged for what it cost awake" \
        "$([ "${IT0:-1}" -lt "${T0:-0}" ] && echo 1 || echo 0)" \
        "chain $C0 still reads $IT0 us, was $T0 us while sounding"
    check "its held peak survives the silence" \
        "$([ "$(col "$ICOST" "$C0" 3)" -ge "${P0:-0}" ] && echo 1 || echo 0)" \
        "peak fell from $P0 to $(col "$ICOST" "$C0" 3)"
fi

# ── Arm 3: CPU Optimize off — one render call, so no FX segment ─────────────
ep "chparallel" "0"; ep "chidle" "0"
sleep 1
for c in "${CHAINS[@]}"; do ep "ch$c:synth:decay" "1"; done
for c in "${CHAINS[@]}"; do
    for i in 0 1 2 3; do ep "ch$c:midi" "144.${CB_P[$i]}.100"; done
done
sleep 3
OFF=$(cpu_read)
echo "    $OFF"
OCOST=$(field "$OFF" chcost)
OT0=$(col "$OCOST" "$C0" 1); OS0=$(col "$OCOST" "$C0" 2)
check "unsplit: the chain still costs something" \
    "$([ "${OT0:-0}" -gt 0 ] && echo 1 || echo 0)" "chain $C0 total '$OT0' us"
check "unsplit: the synth stage IS the whole chain, so no FX segment is drawn" \
    "$([ "${OT0:-0}" -gt 0 ] && [ "$(( OT0 - OS0 ))" -le $(( OT0 / 10 )) ] && echo 1 || echo 0)" \
    "total $OT0 us vs synth $OS0 us — expected them within 10%"

# ── Teardown ────────────────────────────────────────────────────────────────
for c in "${CHAINS[@]}"; do
    for i in 0 1 2 3; do ep "ch$c:midi" "128.${CB_P[$i]}.0"; done
    ep "ch$c:synth:module" ""
done
ep "chparallel" "1"; ep "chidle" "3"

echo
if [ "$EP_FAILS" -gt 0 ]; then
    fail "every engine write landed" "$EP_FAILS dropped (${EP_DROPPED[*]}) — results above are unreliable"
fi
if [ "$FAILS" -eq 0 ]; then
    printf '\033[32m\033[1mALL CPU-METER CHECKS PASSED\033[0m\n'
else
    printf '\033[31m\033[1m%d CPU-METER CHECK(S) FAILED\033[0m\n' "$FAILS"
    exit 1
fi
