#!/usr/bin/env bash
# build-module.sh — produce dist/movy-module.tar.gz for the Schwung module store.
#
# The tarball extracts to a single top-level movy/ folder (module.json + the
# bundled ui.js + the cross-compiled dsp.so + configs/ + the standalone host:
# movy-host, movy-heal, `standalone` and boot-entry.sh), which is the layout
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

# Every release ships an announcement, and it is written BEFORE the tarball so
# it cannot become an afterthought once the release is already public. Discord
# hard-caps a message at 2000 characters and refuses a longer one, so the length
# is checked here rather than discovered in the paste box.
ANN="docs/discord-v$MOD_VER.md"
if [[ ! -f "$ANN" ]]; then
    echo "ERROR: no release announcement at $ANN" >&2
    echo "       Write it first — what a user GETS, in their words." >&2
    echo "       See docs/RELEASING.md." >&2
    exit 1
fi
ANN_LEN=$(python3 -c "import sys;print(len(open(sys.argv[1],encoding='utf-8').read().rstrip()))" "$ANN")
if (( ANN_LEN > 2000 )); then
    echo "ERROR: $ANN is $ANN_LEN characters; Discord caps a message at 2000" >&2
    exit 1
fi

echo "=== Building Movy module v$MOD_VER ==="
echo "announcement: $ANN ($ANN_LEN/2000 chars)"
node build/device.mjs
./scripts/build-dsp.sh         # cross-compiles the Rust engine → dist/dsp.so (GLIBC<=2.35 gate) + dist/chain-host.so
# movy-host and its RT helper. MOVY_RELEASE drops the test bus's UI_EVAL,
# which runs arbitrary JS in the UI.
MOVY_RELEASE=1 ./scripts/build-host.sh
./scripts/build-schwung-js.sh   # the pinned schwung JS movy-host loads → dist/schwung-js

rm -rf "dist/${MODULE_ID}"
mkdir -p "dist/${MODULE_ID}/configs"
# settings-schema.json: the AI key page at move.local:7700/modules/movy. Its
# config.json and secrets/ are the user's and must never ship (they would
# overwrite a pasted key on update).
cp settings-schema.json "dist/${MODULE_ID}/"
cp module.json ui.js "dist/dsp.so" "dist/chain-host.so" "dist/movy-host" "dist/movy-heal" "dist/${MODULE_ID}/"
cp -R dist/schwung-js "dist/${MODULE_ID}/schwung"
# The standalone module (plan WP8): schwung's Tools menu runs `standalone`, the
# boot picker runs boot-entry.sh (module.json's boot_target), both the same body.
cp standalone/launch.sh "dist/${MODULE_ID}/standalone"
cp standalone/boot-entry.sh "dist/${MODULE_ID}/boot-entry.sh"
chmod 755 "dist/${MODULE_ID}/"{standalone,boot-entry.sh,movy-host,movy-heal}
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
# The AI settings page ships; the user's values and keys never do.
LISTING=$(tar -tzf "dist/${MODULE_ID}-module.tar.gz")
if ! grep -x "${MODULE_ID}/settings-schema.json" <<<"$LISTING" >/dev/null \
   || grep -E "^${MODULE_ID}/(config\.json|secrets/)" <<<"$LISTING" >/dev/null; then
    echo "ERROR: tarball must carry settings-schema.json and no config.json/secrets/" >&2
    exit 1
fi
# Without its pinned JS movy-host imports nothing of schwung's: no pages.
PINNED_JS=$(tar -tzf "dist/${MODULE_ID}-module.tar.gz" | grep -c "^${MODULE_ID}/schwung/.*\.mjs$" || true)
WANT_JS=$(tail -n +2 dist/schwung-js/PIN | grep -c . || true)
if [[ "$PINNED_JS" != "$WANT_JS" || "$WANT_JS" = 0 ]]; then
    echo "ERROR: tarball carries $PINNED_JS pinned schwung JS files, expected $WANT_JS" >&2
    exit 1
fi
echo "(tarball carries $PINNED_JS pinned schwung JS files, $(head -1 dist/schwung-js/PIN))"
# A file the store unpacks without its x bit is a Tools entry that does nothing
# and a boot row that falls through to stock (the manager chmods only the
# boot_target's exec).
for f in standalone boot-entry.sh movy-host movy-heal; do
    MODE=$(tar -tvzf "dist/${MODULE_ID}-module.tar.gz" "${MODULE_ID}/$f" 2>/dev/null | cut -c1-10)
    if [[ "$MODE" != -rwx* ]]; then
        echo "ERROR: ${MODULE_ID}/$f is missing from the tarball or not executable ($MODE)" >&2
        exit 1
    fi
done
ls -lh "dist/${MODULE_ID}-module.tar.gz"
