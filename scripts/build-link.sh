#!/usr/bin/env bash
# build-link.sh — cross-compile movy-link (link/, GPL) into dist/, against the
# Link SDK schwung vendors (libs/link, a submodule) at schwung's PINNED tag.
#
# git archive does not descend into submodules, so the SDK and its asio come
# from the submodule repos themselves, at the commits the pinned tag records.
# The recipe is schwung's own for link-subscriber (scripts/build.sh): C++17,
# static libstdc++, and the arc4random shim Move's glibc 2.34 needs.
#
#   scripts/build-link.sh              aarch64 dist/movy-link (+ movy-link-probe)
#   scripts/build-link.sh --host-test  build and run link/tests on this machine
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/schwung-pin.sh
. "$DIR/scripts/lib/schwung-pin.sh"
SCHWUNG="${SCHWUNG:-$DIR/../schwung}"
TAG="$SCHWUNG_PIN_TAG"

if [[ "${1:-}" == "--mac-probe" ]]; then
    # A probe on this Mac subscribes over the real WiFi/USB path
    # (scripts/measure-link-cost.sh). Needs the SDK the aarch64 build extracted.
    SDK=$(ls -d "$DIR"/host/build/link-* 2>/dev/null | head -1)
    [[ -n "$SDK" ]] || { echo "ERROR: run scripts/build-link.sh once first (extracts the SDK)" >&2; exit 1; }
    "${CXX:-c++}" -std=c++17 -O2 -DLINK_PLATFORM_MACOSX=1 -Wno-multichar -I"$SDK/include" \
        -I"$SDK/modules/asio-standalone/asio/include" "$DIR/link/movy_link_probe.cpp" -o "$DIR/dist/movy-link-probe-mac"
    echo "dist/movy-link-probe-mac built"
    exit 0
fi
if [[ "${1:-}" == "--host-test" ]]; then
    OUT="${TMPDIR:-/tmp}/movy-link-tests"
    mkdir -p "$OUT"
    "${CXX:-c++}" -std=c++17 -Wall -Wextra -I"$DIR/link" "$DIR/link/tests/test_link_rings.cpp" -o "$OUT/test_link_rings"
    "$OUT/test_link_rings"
    exit 0
fi

CXX="${CROSS_PREFIX:-aarch64-unknown-linux-gnu-}g++"
CC="${CROSS_PREFIX:-aarch64-unknown-linux-gnu-}gcc"
OUT="$DIR/host/build"
if ! git -C "$SCHWUNG" rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
    echo "ERROR: schwung tag $TAG not found in $SCHWUNG (git -C $SCHWUNG fetch --tags)" >&2
    exit 1
fi
LINK_SHA=$(git -C "$SCHWUNG" ls-tree "$TAG" libs/link | awk '{print $3}')
ASIO_SHA=$(git -C "$SCHWUNG/libs/link" ls-tree "$LINK_SHA" modules/asio-standalone | awk '{print $3}')
SDK="$OUT/link-$LINK_SHA"
if [[ "$(cat "$SDK/.stamp" 2>/dev/null)" != "$LINK_SHA:$ASIO_SHA" ]]; then
    rm -rf "$SDK" && mkdir -p "$SDK/modules/asio-standalone" "$SDK/compat"
    git -C "$SCHWUNG/libs/link" archive "$LINK_SHA" include | tar -x -C "$SDK"
    git -C "$SCHWUNG/libs/link/modules/asio-standalone" archive "$ASIO_SHA" asio/include \
        | tar -x -C "$SDK/modules/asio-standalone"
    git -C "$SCHWUNG" show "$TAG:src/host/arc4random_compat.c" > "$SDK/compat/arc4random_compat.c"
    echo "$LINK_SHA:$ASIO_SHA" > "$SDK/.stamp"
fi

mkdir -p "$DIR/dist"
"$CC" -c -O2 "$SDK/compat/arc4random_compat.c" -o "$OUT/arc4random_compat.o"
build() {  # build <source> <output>
    "$CXX" -std=c++17 -O2 -DNDEBUG -DLINK_PLATFORM_UNIX=1 -DLINK_PLATFORM_LINUX=1 -Wno-multichar \
        -I"$DIR/link" -I"$SDK/include" -I"$SDK/modules/asio-standalone/asio/include" \
        "$1" "$OUT/arc4random_compat.o" -o "$2" \
        -lpthread -lrt -latomic -static-libstdc++ -Wl,--wrap=arc4random
}
build "$DIR/link/movy_link.cpp" "$DIR/dist/movy-link"
[[ -f "$DIR/link/movy_link_probe.cpp" ]] && build "$DIR/link/movy_link_probe.cpp" "$DIR/dist/movy-link-probe"
# The box runs glibc 2.34 (no symbol may come from a later one).
MAX=$("${CROSS_PREFIX:-aarch64-unknown-linux-gnu-}objdump" -T "$DIR/dist/movy-link" | grep -o 'GLIBC_[0-9.]*' | sort -V | tail -1)
case "$MAX" in GLIBC_2.3[5-9]*|GLIBC_2.[4-9]*) echo "ERROR: movy-link needs $MAX" >&2; exit 1 ;; esac
echo "dist/movy-link built (Link ${LINK_SHA:0:8}, schwung $TAG, $MAX max)"
