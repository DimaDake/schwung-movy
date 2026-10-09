#!/usr/bin/env bash
# build-chain-host.sh — cross-compile schwung's chain host from the PINNED tag
# into dist/chain-host.so, which movy ships and loads instead of the installed
# modules/chain/dsp.so.
#
# Why movy carries its own: the chain host is CODE that every movy track runs
# through, and loading the stock one meant a schwung update could change how
# movy's tracks behave overnight with no movy change at all — exactly what
# happened to dbxhost. Upstream chain fixes arrive by bumping the pin
# (scripts/lib/schwung-pin.sh), never silently.
#
# The compile lines mirror schwung's own scripts/build.sh at that tag; the
# sources come from `git archive`, so the checkout's branch is irrelevant.
# Called by build-dsp.sh, so every path that ships dsp.so ships this beside it.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/schwung-pin.sh
. "$DIR/scripts/lib/schwung-pin.sh"
SCHWUNG="${SCHWUNG:-$DIR/../schwung}"
TAG="$SCHWUNG_PIN_TAG"
CC="${CROSS_PREFIX:-aarch64-unknown-linux-gnu-}gcc"
OUT="$DIR/engine/target/chain-host/$TAG"
SO="$OUT/chain-host.so"

# Keyed on the tag AND this script, so editing a compile line rebuilds; a
# rebuild is ~20 s and build-dsp.sh runs on every device sweep.
STAMP="$TAG:$(shasum "$0" | cut -d' ' -f1)"
if [[ ! -f "$SO" || "$(cat "$OUT/.stamp" 2>/dev/null)" != "$STAMP" ]]; then
    if ! git -C "$SCHWUNG" rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
        echo "ERROR: schwung tag $TAG not found in $SCHWUNG (git -C $SCHWUNG fetch --tags)" >&2
        exit 1
    fi
    rm -rf "$OUT" && mkdir -p "$OUT/src"
    git -C "$SCHWUNG" archive "$TAG" src/modules/chain/dsp src/host src/lib | tar -x -C "$OUT/src"
    (
        cd "$OUT/src"
        # Hidden-visibility objects, as upstream builds them: these are plain
        # host sources, and compiled in with the rest they would export lane_*
        # into the dynamic table a dlopen'd sub-plugin can bind to.
        "$CC" -g -O3 -fPIC -fvisibility=hidden -c src/host/lane_store.c -o lane_store.o -Isrc
        "$CC" -g -O3 -fPIC -fvisibility=hidden -c src/host/lane_serial.c -o lane_serial.o -Isrc
        "$CC" -g -O3 -fPIC -fvisibility=hidden -c src/host/lane_edit.c -o lane_edit.o -Isrc -Isrc/host
        "$CC" -g -O3 -shared -fPIC \
            src/modules/chain/dsp/chain_host.c \
            src/modules/chain/dsp/chain_json.c \
            src/modules/chain/dsp/chain_params.c \
            src/modules/chain/dsp/chain_mod.c \
            src/modules/chain/dsp/chain_midi.c \
            src/modules/chain/dsp/chain_patch.c \
            src/modules/chain/dsp/chain_reorder.c \
            src/modules/chain/dsp/chain_bus.c \
            src/modules/chain/dsp/chain_scene.c \
            src/modules/chain/dsp/chain_lanes.c \
            src/modules/chain/dsp/chain_chance.c \
            src/modules/chain/dsp/chain_synth_load.c \
            src/modules/chain/dsp/chain_fx_load.c \
            src/host/unified_log.c \
            lane_store.o lane_serial.o lane_edit.o \
            -o "$SO" -Isrc -lm -ldl -lpthread
    )
    echo "$STAMP" > "$OUT/.stamp"
fi

mkdir -p "$DIR/dist"
cp "$SO" "$DIR/dist/chain-host.so"
echo "dist/chain-host.so built (schwung $TAG)"
