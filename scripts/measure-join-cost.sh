#!/usr/bin/env bash
# measure-join-cost.sh — price the fan-out/join mechanism for parallel chain
# render, on the device, at the real frame rate.
#
# measure-frame-phase.sh established the capacity: ~2.2 of the 3 non-SPI cores
# sit idle for the whole of movy's render window, because Move's own audio
# workers run strictly AFTER movy hands back. This script answers the question
# that one deliberately left open — capacity is not throughput. Splitting a
# 363 us render N ways only pays if waking N threads and joining them costs far
# less than the 363 - 363/N it saves.
#
# Nothing here touches movy. It cross-compiles a standalone binary, runs it in
# /tmp on the device, and deletes it. The binary's threads run BELOW Move's
# audio threads, so it cannot cause a dropout.
#
# Usage: ./scripts/measure-join-cost.sh [move.local] [-- extra join-cost args]
set -uo pipefail
cd "$(dirname "$0")/.."

HOST="${1:-move.local}"
[ $# -ge 1 ] && shift
[ "${1:-}" = "--" ] && shift
BLD=$'\033[1m'; RST=$'\033[0m'
CC=aarch64-unknown-linux-gnu-gcc
REMOTE=/tmp/join-cost

command -v "$CC" >/dev/null 2>&1 || {
    echo "ERROR: $CC not found. brew install aarch64-unknown-linux-gnu"; exit 1; }
ssh -o ConnectTimeout=5 -o BatchMode=yes "root@$HOST" true 2>/dev/null || {
    echo "DEVICE OFFLINE (or no root ssh) — SCHED_FIFO needs root@$HOST"; exit 1; }

mkdir -p dist
"$CC" -O2 -std=gnu11 -pthread -Wall -Wextra -o dist/join-cost scripts/bench/join-cost.c || exit 1

# Device glibc ceiling, same rule as build-dsp.sh.
MAXGLIBC=$(aarch64-unknown-linux-gnu-nm -D dist/join-cost | grep -o "GLIBC_[0-9.]*" | sort -uV | tail -1)
case "$MAXGLIBC" in
    GLIBC_2.3[6-9]*|GLIBC_2.[4-9]*|GLIBC_3*) echo "ERROR: $MAXGLIBC exceeds device glibc 2.35"; exit 1 ;;
esac

scp -q dist/join-cost "root@$HOST:$REMOTE" || exit 1
ssh "root@$HOST" "chmod +x $REMOTE"

run() {
    echo
    echo "${BLD}=== $1 ===${RST}"
    shift
    ssh "root@$HOST" "$REMOTE $*"
}

if [ $# -gt 0 ]; then
    run "custom: $*" "$@"
else
    # The bare mechanism first: no workload at all, so the number is purely wake
    # + rendezvous. Everything after it is that floor plus real work.
    run "bare mechanism, 3 threads, no workload" --work-us 0 --threads 3
    # 3 threads is the design point, not an arbitrary middle: frame-phase
    # measured ~2.2 free cores, i.e. the audio thread plus two helpers. 4 puts
    # more RT threads on the box than there are cores once Move's own audio
    # thread is counted, and the tail shows it.
    for n in 2 3 4; do
        run "$n threads, 363 us split $n ways" --threads "$n"
    done
    # Pinning removes core collisions entirely but makes the tail worse, because
    # a pinned worker cannot step aside when Move's audio thread takes its core.
    # Kept in the suite because that result is the argument against pinning.
    run "4 threads, pinned one-per-core" --threads 4 --affinity
fi
# --pure-spin is deliberately not in this suite. It prices the floor (~0.6 us,
# i.e. the rendezvous itself is free and the whole cost is the wake), but two
# spinning FIFO threads hit the RT throttle at 95% and one frame in the trial
# run stalled 47 ms. Run it by hand if you want the number.

ssh "root@$HOST" "rm -f $REMOTE"
echo
echo "removed $REMOTE from $HOST"
