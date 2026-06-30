#!/usr/bin/env bash
# build-module.sh — produce dist/movy-module.tar.gz for the Schwung module store.
#
# The tarball extracts to a single top-level movy/ folder (module.json + the
# bundled ui.js + the cross-compiled dsp.so), which is the layout
# schwung-manager expects when installing from the catalog.
#
# Both ui.js and dsp.so are gitignored build artifacts, so a release must
# rebuild them here rather than ship whatever happens to be in the tree.
#
# Usage: ./scripts/build-module.sh
set -euo pipefail

MODULE_ID="movy"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

# release.json must advertise the same version the bundled module.json reports,
# otherwise the store re-offers the update forever (catalog says vX, downloaded
# tarball still pins the old version).
REL_VER=$(python3 -c "import json;print(json.load(open('release.json'))['version'])")
MOD_VER=$(python3 -c "import json;print(json.load(open('module.json'))['version'])")
if [[ "$REL_VER" != "$MOD_VER" ]]; then
    echo "ERROR: version mismatch: release.json=$REL_VER vs module.json=$MOD_VER" >&2
    exit 1
fi

echo "=== Building Movy module v$MOD_VER ==="
node build/device.mjs          # bundles TS (model/renderer/fonts) → ui.js
./scripts/build-dsp.sh         # cross-compiles the Rust engine → dist/dsp.so (GLIBC<=2.35 gate)

rm -rf "dist/${MODULE_ID}"
mkdir -p "dist/${MODULE_ID}"
cp module.json ui.js "dist/dsp.so" "dist/${MODULE_ID}/"

tar -czf "dist/${MODULE_ID}-module.tar.gz" -C dist "${MODULE_ID}/"
echo
echo "=== Release tarball ==="
tar -tzf "dist/${MODULE_ID}-module.tar.gz"
ls -lh "dist/${MODULE_ID}-module.tar.gz"
