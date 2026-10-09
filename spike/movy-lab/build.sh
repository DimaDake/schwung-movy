#!/usr/bin/env bash
# build.sh — cross-compile the WP0 spike binary from a PINNED schwung tag.
#
# Sources come from `git archive <tag>`, never the live checkout, so this is
# the build shape WP6's movy-host will use. Throwaway: deleted in WP6.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
SCHWUNG="${SCHWUNG:-$DIR/../../../schwung}"
TAG="${SCHWUNG_HOST_TAG:-v1.7.3}"
CC="${CROSS_PREFIX:-aarch64-unknown-linux-gnu-}gcc"
AR="${CROSS_PREFIX:-aarch64-unknown-linux-gnu-}ar"
OUT="$DIR/build"
SRC="$OUT/schwung-$TAG"

if [ ! -f "$SRC/.done" ]; then
    rm -rf "$SRC" && mkdir -p "$SRC"
    git -C "$SCHWUNG" archive "$TAG" libs/quickjs/quickjs-2025-04-26 \
        src/host/js_display.c src/host/js_display.h src/host/plugin_api_v1.h \
        src/lib/stb_image.h src/lib/stb_truetype.h src/lib/schwung_spi_lib.h \
        | tar -x -C "$SRC"
    rm -f "$SRC/libs/quickjs/quickjs-2025-04-26/libquickjs.a"
    make -s -C "$SRC/libs/quickjs/quickjs-2025-04-26" CC="$CC" AR="$AR" libquickjs.a
    touch "$SRC/.done"
fi

QJS="$SRC/libs/quickjs/quickjs-2025-04-26"
"$CC" -O2 -g -Wall -Wno-unused-function \
    -DSCHWUNG_TAG="\"$TAG\"" \
    -DMOVY_COMMIT="\"$(git -C "$DIR" rev-parse --short HEAD)\"" \
    "$DIR/movy-lab.c" "$SRC/src/host/js_display.c" \
    -I"$SRC/src" -I"$SRC/src/host" -I"$QJS" -L"$QJS" \
    -lquickjs -lm -ldl -lrt -lpthread \
    -o "$OUT/movy-lab"
echo "built $OUT/movy-lab (schwung $TAG)"
