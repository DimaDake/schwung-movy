#!/usr/bin/env bash
# build-host.sh — cross-compile movy-host (the standalone flavour's C host,
# host/) and its RT helper into dist/, from schwung sources at the PINNED tag.
#
# The schwung half is QuickJS + js_display + js_host_common + unified_log and a
# handful of headers, taken with `git archive <tag>` like build-chain-host.sh,
# so the checkout's branch never reaches a build. Upstream PR U1 ("standalone
# SDK") would replace this source subset with a published static library.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/schwung-pin.sh
. "$DIR/scripts/lib/schwung-pin.sh"
SCHWUNG="${SCHWUNG:-$DIR/../schwung}"
TAG="$SCHWUNG_PIN_TAG"
CC="${CROSS_PREFIX:-aarch64-unknown-linux-gnu-}gcc"
AR="${CROSS_PREFIX:-aarch64-unknown-linux-gnu-}ar"
NM="${CROSS_PREFIX:-aarch64-unknown-linux-gnu-}nm"
OUT="$DIR/host/build"
SRC="$OUT/schwung-$TAG"
QJS_DIR=libs/quickjs/quickjs-2025-04-26

SCHWUNG_FILES=(
    "$QJS_DIR"
    src/host/js_display.c src/host/js_display.h
    src/host/js_host_common.c src/host/js_host_common.h
    src/host/unified_log.c src/host/unified_log.h
    src/host/plugin_api_v1.h
    src/host/shadow_constants.h src/host/scene_morph.h
    src/host/shadow_midi_inject_writer.h src/host/ui_midi_ring.h
    src/lib/schwung_spi_lib.h src/lib/stb_image.h src/lib/stb_truetype.h
)

# The QuickJS archive is the slow part (~40 s); keyed on the tag and the
# source list, so a changed list re-extracts and an edited compile line does not.
STAMP="$TAG:$(printf '%s\n' "${SCHWUNG_FILES[@]}" | shasum | cut -d' ' -f1)"
if [[ "$(cat "$SRC/.stamp" 2>/dev/null)" != "$STAMP" ]]; then
    if ! git -C "$SCHWUNG" rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
        echo "ERROR: schwung tag $TAG not found in $SCHWUNG (git -C $SCHWUNG fetch --tags)" >&2
        exit 1
    fi
    rm -rf "$SRC" && mkdir -p "$SRC"
    git -C "$SCHWUNG" archive "$TAG" "${SCHWUNG_FILES[@]}" | tar -x -C "$SRC"
    rm -f "$SRC/$QJS_DIR/libquickjs.a"
    make -s -C "$SRC/$QJS_DIR" CC="$CC" AR="$AR" libquickjs.a
    echo "$STAMP" > "$SRC/.stamp"
fi

# The oldest installed schwung whose shared JS this ui.js may import; one
# definition, in the TS that the overtake flavour checks it against.
FLOOR=$(grep -o "SCHWUNG_FLOOR = '[^']*'" "$DIR/src/renderer/schwung-floor.ts" | cut -d"'" -f2)
# "+" marks a build from a tree whose host/ differs from HEAD, untracked
# files included — a dirty host must never print as the commit it is not.
MOVY_SHA="$(git -C "$DIR" rev-parse --short HEAD)$([[ -z "$(git -C "$DIR" status --porcelain -- host standalone)" ]] || echo +)"
CFLAGS=(-O2 -g -Wall -Wextra -Wno-unused-parameter -Wno-cast-function-type -std=gnu11 -pthread
        -DSCHWUNG_TAG="\"$TAG\"" -DMOVY_COMMIT="\"$MOVY_SHA\"" -DSCHWUNG_FLOOR="\"$FLOOR\""
        -I"$DIR/host" -I"$SRC/src" -I"$SRC/src/host" -I"$SRC/$QJS_DIR")
# The test bus's UI_EVAL runs arbitrary JS in the UI: dev builds only.
# movy-sa is dev-only until WP8; the switch's shipping build sets MOVY_RELEASE=1.
[[ "${MOVY_RELEASE:-0}" = 1 ]] || CFLAGS+=(-DMOVY_TESTBUS_EVAL)
mkdir -p "$DIR/dist"
# shellcheck disable=SC2046
"$CC" "${CFLAGS[@]}" $(ls "$DIR"/host/*.c) \
    "$SRC/src/host/js_display.c" "$SRC/src/host/js_host_common.c" "$SRC/src/host/unified_log.c" \
    -L"$SRC/$QJS_DIR" -lquickjs -lm -ldl -lrt -lpthread \
    -rdynamic -o "$DIR/dist/movy-host"   # -rdynamic: the crash backtrace names functions
"$CC" -O2 -Wall -Wextra -std=gnu11 -I"$DIR/host" "$DIR/host/heal/heal.c" -o "$DIR/dist/movy-heal"

# Device glibc ceiling, the same rule build-dsp.sh applies to dsp.so.
for bin in movy-host movy-heal; do
    MAXGLIBC=$("$NM" -D "$DIR/dist/$bin" | grep -o "GLIBC_[0-9.]*" | sort -uV | tail -1)
    case "$MAXGLIBC" in
        GLIBC_2.3[6-9]*|GLIBC_2.[4-9]*|GLIBC_3*) echo "ERROR: $bin needs $MAXGLIBC > device glibc 2.35"; exit 1 ;;
    esac
done
echo "dist/movy-host built (schwung $TAG, movy $MOVY_SHA, $MAXGLIBC max)"
