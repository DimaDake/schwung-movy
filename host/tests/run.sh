#!/usr/bin/env bash
# Builds and runs movy-host's unit tests with the native compiler.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${TMPDIR:-/tmp}/movy-host-tests"
mkdir -p "$OUT"
"${CC:-cc}" -std=gnu11 -Wall -Wextra -Wno-unused-parameter -pthread -I"$DIR" \
    "$DIR/tests/test_host.c" "$DIR/deltas.c" "$DIR/midi_in.c" "$DIR/midi_out.c" \
    "$DIR/param_queue.c" "$DIR/param_bulk.c" -o "$OUT/test_host"
"$OUT/test_host"
"${CC:-cc}" -std=gnu11 -Wall -Wextra -Wno-unused-parameter -pthread -I"$DIR" \
    "$DIR/tests/test_log.c" "$DIR/log_ring.c" "$DIR/testbus_log.c" "$DIR/midi_tap.c" -o "$OUT/test_log"
"$OUT/test_log"
