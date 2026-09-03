#!/usr/bin/env bash
# build-module.sh — produce dist/movy-module.tar.gz for the Schwung module store.
#
# The tarball extracts to a single top-level movy/ folder (module.json + the
# bundled ui.js + the cross-compiled dsp.so + configs/), which is the layout
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
# shellcheck source=lib/build-release-ui.sh
. "$DIR/scripts/lib/build-release-ui.sh"

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
# The one release path for the store tarball. The bundle and its gate assertion
# live in scripts/lib/build-release-ui.sh, shared with `deploy.sh --release`.
build_release_ui "$(pwd)"
./scripts/build-dsp.sh         # cross-compiles the Rust engine → dist/dsp.so (GLIBC<=2.35 gate)

rm -rf "dist/${MODULE_ID}"
mkdir -p "dist/${MODULE_ID}/configs"
cp module.json ui.js "dist/dsp.so" "dist/${MODULE_ID}/"
# Override configs for the modules whose own movy_config.json movy cannot use
# (OVERRIDES_MODULE_FILE in src/modules/loader.ts). They are DATA FILES rather
# than imports so ui.js does not carry ~90 KB of JSON through the QuickJS parser
# on every tool open — which also means the tarball has to carry them or a fresh
# install silently gives those kits back the layout the override replaces.
cp src/module-configs/*.json "dist/${MODULE_ID}/configs/"

# The list and the files must agree, checked against the SHIPPING tree rather
# than the source dir: an override added to the list without a config, or a
# config left behind by a rename, both produce a tarball that looks complete and
# regresses one kit on install. Neither raises an error at runtime — movy falls
# back to the module's own config and only says so in the log.
python3 - "$MODULE_ID" <<'PYEOF'
import pathlib, re, sys
mod = sys.argv[1]
src = pathlib.Path("src/modules/loader.ts").read_text()
m = re.search(r"OVERRIDES_MODULE_FILE = new Set\(\[(.*?)\]\)", src, re.S)
if not m:
    raise SystemExit("could not find OVERRIDES_MODULE_FILE in src/modules/loader.ts")
listed  = set(re.findall(r"'([^']+)'", m.group(1)))
shipped = {p.stem for p in pathlib.Path(f"dist/{mod}/configs").glob("*.json")}
if listed != shipped:
    missing, extra = sorted(listed - shipped), sorted(shipped - listed)
    raise SystemExit(
        "ERROR: override configs do not match OVERRIDES_MODULE_FILE\n"
        + (f"  listed but not shipped: {missing}\n" if missing else "")
        + (f"  shipped but not listed: {extra}\n" if extra else ""))
print(f"override configs: {len(shipped)} shipped, matching the list")
PYEOF

# Build ustar tarball without mac metadata/sparse headers so busybox tar on
# the device does not unpack dsp.so as GNUSparseFile.0/dsp.so.
COPYFILE_DISABLE=1 tar --format ustar --no-xattrs --no-mac-metadata \
    -czf "dist/${MODULE_ID}-module.tar.gz" -C dist "${MODULE_ID}/"
# Read the finished ARTEFACT back, not the directory it was built from: the
# tarball is what ships, and a packaging flag that quietly dropped a path would
# not show up in either check above.
echo
echo "=== Release tarball ==="
tar -tzf "dist/${MODULE_ID}-module.tar.gz"
PACKED=$(tar -tzf "dist/${MODULE_ID}-module.tar.gz" | grep -c "^${MODULE_ID}/configs/.*\.json$" || true)
WANT=$(ls src/module-configs/*.json | wc -l | tr -d ' ')
if [[ "$PACKED" != "$WANT" ]]; then
    echo "ERROR: tarball carries $PACKED override configs, expected $WANT" >&2
    exit 1
fi
echo "(tarball carries $PACKED override configs)"
ls -lh "dist/${MODULE_ID}-module.tar.gz"
