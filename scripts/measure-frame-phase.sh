#!/usr/bin/env bash
# measure-frame-phase.sh — where inside the 2.9 ms audio frame does each thread
# actually run, and how many cores are free while movy renders?
#
# This is the measurement that gates the parallel-chain-render design
# (plans/2026-08-16-parallel-chain-render.md and the 2026-08-21 review). The
# per-thread CPU table in measure-core-contention.sh answers "how much CPU does
# Move use", which is the wrong question — the design needs "are the other cores
# free at the instant movy renders", and that is a phase question.
#
# Uses the kernel's own sched_switch tracepoint, so it needs root and it costs
# nothing in the shim: no rebuild, no code in the audio path, no perturbation
# beyond ~1us per context switch.
#
# Usage: ./scripts/measure-frame-phase.sh [move.local] [seconds] [-- analyzer args]
set -uo pipefail
cd "$(dirname "$0")/.."

HOST="${1:-move.local}"
SECS="${2:-2}"
[ $# -ge 1 ] && shift
[ $# -ge 1 ] && shift
[ "${1:-}" = "--" ] && shift
OUT="/tmp/frame-phase-$(date +%H%M%S).trace"
BLD=$'\033[1m'; RST=$'\033[0m'; YEL=$'\033[1;33m'

ssh -o ConnectTimeout=5 -o BatchMode=yes "root@$HOST" true 2>/dev/null || {
    echo "DEVICE OFFLINE (or no root ssh) — ftrace needs root@$HOST"; exit 1; }

echo "${BLD}=== capturing ${SECS}s of sched_switch on $HOST ===${RST}"

# One round trip: arm, capture, disarm, dump, release the buffer. stdout is the
# raw trace (goes to $OUT); anything human-readable goes to stderr.
ssh "root@$HOST" 'sh -s' <<EOS > "$OUT"
T=/sys/kernel/debug/tracing
echo 0 > \$T/tracing_on
echo nop > \$T/current_tracer
# mono so timestamps are comparable ACROSS cpus; the default per-cpu 'local'
# clock is not, and every number this script prints is a cross-core comparison.
echo mono > \$T/trace_clock
echo 8192 > \$T/buffer_size_kb
echo > \$T/trace
echo 1 > \$T/events/sched/sched_switch/enable
echo 1 > \$T/tracing_on
sleep $SECS
echo 0 > \$T/tracing_on
echo 0 > \$T/events/sched/sched_switch/enable
grep -v '^#' \$T/trace
# Report what movy was doing, so a capture taken against an idle device is not
# later read as a measurement of the loaded case.
{
  echo "device state:"
  echo "  overtake dsp : \$(grep -c movy /proc/\$(pgrep -f MoveOriginal | head -n 1)/maps 2>/dev/null) movy mappings"
  echo "  load average : \$(cut -d' ' -f1-3 /proc/loadavg)"
} >&2
# Leave the buffer released; 8 MB/cpu pinned is not something to forget on a
# device with 1 GB of RAM.
echo > \$T/trace
echo 1408 > \$T/buffer_size_kb
EOS

echo "trace: $OUT ($(grep -c . "$OUT") switches)"
node scripts/lib/frame-phase.mjs "$OUT" "$@"
