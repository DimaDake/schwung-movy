#!/usr/bin/env bash
# autorun-pending-measurements.sh — wait for the device, then finish the
# measurements that were outstanding when it went offline.
#
# Written to run unattended. Everything it does is idempotent and writes to
# /tmp/autorun-*.log, so a partial run is still useful.
#
# Pending work, in order:
#   1. deploy (the pad-latency fix is built but never reached the device)
#   2. re-measure pad latency, host vs movy, now that the engine answers pads
#   3. weird-dreams / forge / mrdrums with kits and samples, so they actually
#      sound instead of measuring silence
#   4. minijv / osirus, which never completed
set -uo pipefail
cd "$(dirname "$0")/.."
MOVY_DIR="$(pwd)"
OUT=/tmp/autorun-results.log
: > "$OUT"
log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$OUT"; }

# ── wait for the device (up to 8 hours) ──────────────────────────────────────
HOST=""
for _ in $(seq 1 960); do
    for h in move.local 192.168.178.29; do
        if ssh -o ConnectTimeout=4 -o StrictHostKeyChecking=accept-new "ableton@$h" 'echo ok' >/dev/null 2>&1; then
            HOST="$h"; break 2
        fi
    done
    sleep 30
done
[ -z "$HOST" ] && { log "device never came back — nothing run"; exit 1; }
log "device up at $HOST"

export HOST
open_movy() {
    ssh "ableton@$HOST" 'python3 -c "
import mmap, json
open(\"/data/UserData/schwung/open_tool_cmd.json\",\"w\").write(json.dumps({\"file_path\":\"/\",\"tool_id\":\"movy\"}))
f=open(\"/dev/shm/schwung-control\",\"r+b\"); mm=mmap.mmap(f.fileno(),0); mm[56]=1; mm.close()
"' >/dev/null 2>&1
    sleep 8
}

# ── 1. deploy ────────────────────────────────────────────────────────────────
log "deploying (pad-latency fix)"
./scripts/deploy.sh "$HOST" >/dev/null 2>&1 && log "deployed" || { log "DEPLOY FAILED"; exit 1; }
open_movy

# ── 2. pad latency after the fix ─────────────────────────────────────────────
log "=== pad latency, host vs movy (after the engine took over pads) ==="
{
    source "$MOVY_DIR/scripts/lib/test-set.sh"
    LOG=/data/UserData/schwung/debug.log
    ipc() { ssh "ableton@$HOST" "grep -o 'perf_ipc[^|]*' $LOG | tail -n 4" \
        | awk '{for(i=1;i<=NF;i++){if($i~/^ipc_ms=/){split($i,a,"=");s+=a[2];n++}}}
               END{printf "%.2f\n",(n?s/n:0)}'; }
    pads() { ts_send "0x09:0x90:68:100:0.04" "0x09:0x90:70:100:0.04" "0x09:0x90:72:100:0.04" \
                     "0x09:0x90:74:100:0.04" "0x08:0x80:68:0:0.02" "0x08:0x80:70:0:0.02" \
                     "0x08:0x80:72:0:0.02" "0x08:0x80:74:0:0"; }
    sel() { ts_tap_cc 50; sleep 0.7; ts_tap_note $((16+$1)); sleep 0.9; ts_tap_cc 50; sleep 0.7; }

    node scripts/engine-param.mjs set "ch0:synth:module" plaits "$HOST" >/dev/null 2>&1; sleep 5
    sel 0; ssh "ableton@$HOST" "> $LOG"; sleep 2
    for _ in 1 2 3 4 5; do pads; done; sleep 6
    log "  host track  ipc_ms=$(ipc)"
    sel 4; ssh "ableton@$HOST" "> $LOG"; sleep 2
    for _ in 1 2 3 4 5; do pads; done; sleep 6
    log "  movy track  ipc_ms=$(ipc)   (was 2.12 before the fix; host was 0.30)"
    node scripts/engine-param.mjs set "ch0:synth:module" "" "$HOST" >/dev/null 2>&1
} 2>&1 | tee -a "$OUT"

# ── 3. the three that were silent ────────────────────────────────────────────
log "=== weird-dreams / forge / mrdrums, now with kits and samples ==="
./scripts/stress-16-tracks.sh "$HOST" weird-dreams forge mrdrums 2>&1 \
    | grep -vE "Warning|^$" | tee -a "$OUT"

# ── 4. the two that never finished ───────────────────────────────────────────
log "=== minijv / osirus ==="
./scripts/stress-16-tracks.sh "$HOST" minijv osirus 2>&1 \
    | grep -vE "Warning|^$" | tee -a "$OUT"

log "=== done — results in $OUT ==="
