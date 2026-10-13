#!/usr/bin/env bash
# Builds and runs movy-host's unit tests with the native compiler.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${TMPDIR:-/tmp}/movy-host-tests"
mkdir -p "$OUT"
"${CC:-cc}" -std=gnu11 -Wall -Wextra -Wno-unused-parameter -pthread -I"$DIR" \
    "$DIR/tests/test_host.c" "$DIR/deltas.c" "$DIR/midi_in.c" "$DIR/midi_out.c" \
    "$DIR/param_queue.c" "$DIR/param_bulk.c" "$DIR/status_snap.c" "$DIR/surface_keys.c" -o "$OUT/test_host"
"$OUT/test_host"
"${CC:-cc}" -std=gnu11 -Wall -Wextra -Wno-unused-parameter -pthread -I"$DIR" \
    "$DIR/tests/test_log.c" "$DIR/log_ring.c" "$DIR/testbus_log.c" "$DIR/midi_tap.c" -o "$OUT/test_log"
"$OUT/test_log"
"${CC:-cc}" -std=gnu11 -Wall -Wextra -Wno-unused-parameter -I"$DIR" \
    "$DIR/tests/test_power.c" "$DIR/power.c" -o "$OUT/test_power"
"$OUT/test_power"
"${CC:-cc}" -std=gnu11 -Wall -Wextra -I"$DIR" "$DIR/tests/test_signals.c" "$DIR/signals.c" -o "$OUT/test_signals"
"$OUT/test_signals"
"${CC:-cc}" -std=gnu11 -Wall -Wextra -I"$DIR" "$DIR/tests/test_handover.c" "$DIR/handover.c" -o "$OUT/test_handover"
"$OUT/test_handover"
# plugin_api_v1.h is schwung's: the reference checkout, as the JS suites use it.
SCHWUNG="${SCHWUNG:-$DIR/../../schwung}"
INC=(-I"$DIR" -I"$SCHWUNG/src" -I"$SCHWUNG/src/host")
"${CC:-cc}" -std=gnu11 -Wall -Wextra -shared -fPIC "${INC[@]}" "$DIR/tests/fake_dsp.c" -o "$OUT/fake_dsp.so"
"${CC:-cc}" -std=gnu11 -Wall -Wextra -Wno-unused-parameter -pthread "${INC[@]}" \
    "$DIR/tests/test_vtable.c" "$DIR/vtable.c" "$DIR/midi_out.c" "$DIR/param_bulk.c" "$DIR/status_snap.c" -ldl -o "$OUT/test_vtable"
"$OUT/test_vtable" "$OUT/fake_dsp.so"
bash "$DIR/tests/test_boot_door.sh"
"${CC:-cc}" -std=gnu11 -Wall -Wextra -I"$DIR" "${INC[@]}" "$DIR/tests/test_spi_fake.c" "$DIR/vdev/spi_fake.c" -o "$OUT/test_spi_fake"
"$OUT/test_spi_fake"
"${CC:-cc}" -std=gnu11 -Wall -Wextra -I"$DIR" "$DIR/tests/test_module_path.c" "$DIR/module_path.c" -o "$OUT/test_module_path"
"$OUT/test_module_path"
