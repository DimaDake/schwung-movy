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
"${CC:-cc}" -std=gnu11 -Wall -Wextra -I"$DIR" "$DIR/tests/test_glitch.c" "$DIR/glitch.c" "$DIR/glitch_log.c" -o "$OUT/test_glitch"
"$OUT/test_glitch"
# schwung's headers and speaker_eq.c from the PINNED tag, the bytes build-host.sh
# ships -- never the checkout, which follows origin/main.
SCHWUNG="${SCHWUNG:-$DIR/../../schwung}"
# shellcheck source=../../scripts/lib/schwung-pin.sh
. "$DIR/../scripts/lib/schwung-pin.sh"
PIN="$OUT/schwung-$SCHWUNG_PIN_TAG"
if [[ "$(cat "$PIN/.stamp" 2>/dev/null)" != "$SCHWUNG_PIN_TAG" ]]; then
    rm -rf "$PIN" && mkdir -p "$PIN"
    git -C "$SCHWUNG" archive "$SCHWUNG_PIN_TAG" src/host src/lib libs/quickjs/quickjs-2025-04-26 | tar -x -C "$PIN"
    echo "$SCHWUNG_PIN_TAG" > "$PIN/.stamp"
fi
SCHWUNG="$PIN"
INC=(-I"$DIR" -I"$SCHWUNG/src" -I"$SCHWUNG/src/host")
"${CC:-cc}" -std=gnu11 -Wall -Wextra -shared -fPIC "${INC[@]}" "$DIR/tests/fake_dsp.c" -o "$OUT/fake_dsp.so"
"${CC:-cc}" -std=gnu11 -Wall -Wextra -Wno-unused-parameter -pthread "${INC[@]}" \
    "$DIR/tests/test_vtable.c" "$DIR/vtable.c" "$DIR/mirror.c" "$DIR/settings_file.c" "$DIR/midi_out.c" "$DIR/param_bulk.c" "$DIR/status_snap.c" -ldl -o "$OUT/test_vtable"
"$OUT/test_vtable" "$OUT/fake_dsp.so"
bash "$DIR/tests/test_boot_door.sh"
"${CC:-cc}" -std=gnu11 -Wall -Wextra -I"$DIR" "${INC[@]}" "$DIR/tests/test_spi_fake.c" "$DIR/vdev/spi_fake.c" -o "$OUT/test_spi_fake"
"${CC:-cc}" -std=gnu11 -O2 -Wall -Wextra "${INC[@]}" "$DIR/tests/test_mirror.c" "$DIR/mirror.c" "$DIR/settings_file.c" -o "$OUT/test_mirror"
"$OUT/test_mirror"
"${CC:-cc}" -std=gnu11 -O2 -Wall -Wextra "${INC[@]}" "$DIR/tests/test_speaker.c" "$DIR/speaker.c" "$DIR/settings_file.c" \
    "$SCHWUNG/src/host/speaker_eq.c" -lm -o "$OUT/test_speaker"
"$OUT/test_speaker"
"$OUT/test_spi_fake"
"${CC:-cc}" -std=gnu11 -Wall -Wextra -I"$DIR" "$DIR/tests/test_module_path.c" "$DIR/module_path.c" -o "$OUT/test_module_path"
"$OUT/test_module_path"
QJS=(-I"$SCHWUNG/libs/quickjs/quickjs-2025-04-26")
"${CC:-cc}" -std=gnu11 -Wall -Wextra -Wno-unused-parameter "${INC[@]}" "${QJS[@]}" \
    "$DIR/tests/test_poweroff_show.c" "$DIR/poweroff_show.c" -o "$OUT/test_poweroff_show"
"$OUT/test_poweroff_show"
