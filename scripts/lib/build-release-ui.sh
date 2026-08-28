#!/usr/bin/env bash
# Build ui.js as a RELEASE bundle, and prove the debug gate actually went off.
#
# Shared by scripts/build-module.sh (the store tarball) and scripts/deploy.sh
# --release (the same bundle, on the device). One copy, because the assertion is
# the point: an esbuild `define` that silently stopped applying would put the
# render lanes and the duplicate pin on the Settings page in front of every user,
# and nothing else in either path would notice.
#
# The assertion is on the substituted CONSTANT, not on any flag's name. The
# device bundle is not minified, so every flag name is present either way — what
# MOVY_DEBUG=0 buys is that `visibleFlags()` filters them out. Asserting absence
# would be asserting something untrue and would fail every release.
set -euo pipefail

build_release_ui() {
    local dir="$1"
    ( cd "$dir" && MOVY_DEBUG=0 node build/device.mjs )
    if ! grep -qF 'DEBUG_BUILD = true ? false' "$dir/ui.js"; then
        echo "ERROR: the debug gate is not off in the release bundle" >&2
        grep -o 'DEBUG_BUILD = [^;]*' "$dir/ui.js" | head -1 >&2
        echo "  MOVY_DEBUG=0 did not take — check build/device.mjs's define." >&2
        return 1
    fi
}
