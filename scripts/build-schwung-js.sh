#!/usr/bin/env bash
# build-schwung-js.sh — the schwung JS movy runs, from the PINNED tag, into
# dist/schwung-js/ (plans/2026-10-13-pin-schwung-js.md). Shipped as
# tools/movy/schwung/ and loaded from there by movy-host (host/module_path.c);
# the browser suites run the same bytes. Never edited: a change is an upstream
# PR and a pin bump (scripts/lib/schwung-pin.sh).
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/schwung-pin.sh
. "$DIR/scripts/lib/schwung-pin.sh"
SCHWUNG="${SCHWUNG:-$DIR/../schwung}"
TAG="$SCHWUNG_PIN_TAG"
TREE="$DIR/host/build/schwung-js-$TAG"
if [[ "$(cat "$TREE/.stamp" 2>/dev/null)" != "$TAG" ]]; then
    git -C "$SCHWUNG" rev-parse -q --verify "refs/tags/$TAG" >/dev/null \
        || { echo "ERROR: schwung tag $TAG not found in $SCHWUNG (git -C $SCHWUNG fetch --tags)" >&2; exit 1; }
    rm -rf "$TREE" && mkdir -p "$TREE"
    git -C "$SCHWUNG" archive "$TAG" src/shared src/shadow | tar -x -C "$TREE"
    echo "$TAG" > "$TREE/.stamp"
fi
# --tree: only the tag's tree, printed (the suites' schwung root,
# scripts/lib/schwung-pinned.mjs). Same bytes, so they test what ships.
[[ "${1:-}" = --tree ]] && { echo "$TREE"; exit 0; }
# Seeds come from movy's source, so the closure is recomputed every time (~50 ms).
node "$DIR/scripts/schwung-js-closure.mjs" "$TREE/src" "$DIR/dist/schwung-js" "$TAG"
