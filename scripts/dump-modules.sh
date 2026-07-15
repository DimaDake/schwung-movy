#!/usr/bin/env bash
# dump-modules.sh — full module inventory dump (device + movy layout).
#
# 1. Temporarily replaces movy's on-device ui.js with the collector
#    (scripts/dump-tool/ui.js). The shadow UI caches its tool list, so a new
#    tool dir is invisible to open_tool_cmd until the Tools menu is opened —
#    piggybacking on movy's existing registration avoids that entirely, and
#    shadow_load_ui_module re-evaluates ui.js fresh on every open.
# 2. Opens "movy" via open_tool_cmd; the collector loads EVERY installed
#    module into track 1's chain slots, captures module.json / live
#    ui_hierarchy / live chain_params / current values / presets, restores
#    the chain, exits.
# 3. Pulls the dump back to docs/module-dump/device-dump.json (pretty-printed)
# 4. Restores the real movy ui.js (fresh local build) + removes the dump file
# 5. Runs scripts/dump-movy-layout.mjs to derive the movy page layouts
#
# WARNING: loading every module resets the edited params of the modules that
# were previously in track 1's chain (module ids are restored, values may not
# be). Run against a dev device / disposable set.
#
# Usage: ./scripts/dump-modules.sh [host]   (default: move.local)

set -euo pipefail
HOST="${1:-move.local}"
MOVY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TOOL_DIR="$MOVY_DIR/scripts/dump-tool"
OUT_DIR="$MOVY_DIR/docs/module-dump"
REMOTE_MOVY="/data/UserData/schwung/modules/tools/movy"
REMOTE_DUMP="/data/UserData/schwung/movy-module-dump.json"
POLL_S=5
TIMEOUT_S=1200   # 75 modules × up to 12 s load timeout ≈ worst case 15 min

RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'; RST='\033[0m'
pass() { echo -e "${GRN}✓${RST} $1"; }
info() { echo -e "${YLW}→${RST} $1"; }
die()  { echo -e "${RED}✗ $1${RST}"; exit 1; }

# Never leave the collector installed as movy — restore on any exit path.
RESTORE_NEEDED=0
restore_movy() {
    if [ "$RESTORE_NEEDED" = 1 ]; then
        (cd "$MOVY_DIR" && node build/device.mjs >/dev/null 2>&1)
        scp -q "$MOVY_DIR/ui.js" "ableton@$HOST:$REMOTE_MOVY/ui.js" \
            && echo "movy ui.js restored (trap)"
    fi
}
trap restore_movy EXIT

info "Checking SSH ($HOST)..."
ssh -o ConnectTimeout=5 "ableton@$HOST" 'echo ok' >/dev/null 2>&1 || die "Cannot reach $HOST"
pass "SSH reachable"

info "Deploying collector as movy's ui.js (original restored after)..."
ssh "ableton@$HOST" "test -f $REMOTE_MOVY/ui.js && rm -f $REMOTE_DUMP" >/dev/null 2>&1 \
    || die "movy is not installed on the device ($REMOTE_MOVY/ui.js missing)"
scp -q "$TOOL_DIR/ui.js" "ableton@$HOST:$REMOTE_MOVY/ui.js"
RESTORE_NEEDED=1
pass "Collector deployed"

info "Enabling debug log + opening the collector (as movy)..."
ssh "ableton@$HOST" '
    touch /data/UserData/schwung/debug_log_on
    python3 -c "
import mmap, json
with open(\"/data/UserData/schwung/open_tool_cmd.json\", \"w\") as f:
    f.write(json.dumps({\"file_path\": \"/\", \"tool_id\": \"movy\"}))
with open(\"/dev/shm/schwung-control\", \"r+b\") as f:
    mm = mmap.mmap(f.fileno(), 0)
    mm[56] = 1
    mm.close()
"'
pass "Collector opened"

info "Waiting for dump (poll every ${POLL_S}s, timeout ${TIMEOUT_S}s)..."
ELAPSED=0
while true; do
    sleep "$POLL_S"; ELAPSED=$((ELAPSED + POLL_S))
    STATUS=$(ssh "ableton@$HOST" "
        if [ -f $REMOTE_DUMP ]; then
            python3 -c \"
import json
try:
    d = json.load(open('$REMOTE_DUMP'))
    print(('DONE' if d.get('complete') else 'RUN'), len(d.get('modules', [])), d.get('module_count', 0))
except Exception:
    print('PARTIAL', 0, 0)
\"
        else echo 'WAIT 0 0'; fi" 2>/dev/null) || STATUS="SSHFAIL 0 0"
    read -r PHASE DONE TOTAL <<< "$STATUS"
    echo "   ... $PHASE $DONE/$TOTAL (${ELAPSED}s)"
    [ "$PHASE" = "DONE" ] && break
    [ "$ELAPSED" -ge "$TIMEOUT_S" ] && die "Timed out. Check: ssh ableton@$HOST 'grep movy-dump /data/UserData/schwung/debug.log | tail'"
done
pass "Dump complete on device"

info "Fetching dump..."
mkdir -p "$OUT_DIR"
scp -q "ableton@$HOST:$REMOTE_DUMP" "$OUT_DIR/device-dump.raw.json"
node -e "
const fs = require('fs');
const d = JSON.parse(fs.readFileSync('$OUT_DIR/device-dump.raw.json', 'utf8'));
fs.writeFileSync('$OUT_DIR/device-dump.json', JSON.stringify(d, null, 1) + '\n');
fs.unlinkSync('$OUT_DIR/device-dump.raw.json');
"
pass "Saved $OUT_DIR/device-dump.json"

info "Restoring real movy ui.js (fresh build)..."
(cd "$MOVY_DIR" && node build/device.mjs >/dev/null 2>&1)
scp -q "$MOVY_DIR/ui.js" "ableton@$HOST:$REMOTE_MOVY/ui.js"
RESTORE_NEEDED=0
ssh "ableton@$HOST" "rm -f $REMOTE_DUMP" >/dev/null 2>&1
pass "movy restored, device dump removed"

info "Generating movy layouts..."
(cd "$MOVY_DIR" && npm run build:browser >/dev/null 2>&1 && node scripts/dump-movy-layout.mjs)
pass "Done. Review docs/module-dump/ and commit."
