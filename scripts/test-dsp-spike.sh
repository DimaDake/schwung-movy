#!/usr/bin/env bash
# test-dsp-spike.sh — TEMPORARY Step-0 check: deploy movy with the Rust
# engine, open it, and assert the spike sequence ran (engine loaded, param
# round-trip, clock ticking, 4 channel-addressed notes emitted).
# Superseded by sequencer checks in test.sh once the real seq UI lands.
set -euo pipefail
HOST="${1:-move.local}"
MOVY_DIR="$(cd "$(dirname "$0")/.." && pwd)"

RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'; BLD='\033[1m'; RST='\033[0m'
pass() { echo -e "${GRN}✓${RST} $1"; }
fail() { echo -e "${RED}✗${RST} $1"; FAILURES=$((FAILURES+1)); }
info() { echo -e "${YLW}→${RST} $1"; }
FAILURES=0

info "Deploying (ui.js + dsp.so)..."
"$MOVY_DIR/scripts/deploy.sh" "$HOST" >/dev/null
pass "Deployed"

ssh "ableton@$HOST" 'touch /data/UserData/schwung/debug_log_on; > /data/UserData/schwung/debug.log'

info "Opening Movy..."
ssh "ableton@$HOST" 'python3 -c "
import mmap, json
cmd = json.dumps({\"file_path\": \"/\", \"tool_id\": \"movy\"})
with open(\"/data/UserData/schwung/open_tool_cmd.json\", \"w\") as f:
    f.write(cmd)
with open(\"/dev/shm/schwung-control\", \"r+b\") as f:
    mm = mmap.mmap(f.fileno(), 0)
    mm[56] = 1
    mm.close()
"'

info "Waiting for spike sequence (~12s)..."
sleep 12

LOG=$(ssh "ableton@$HOST" 'grep -E "\[movy\]|movy-dsp|Overtake DSP" /data/UserData/schwung/debug.log 2>/dev/null || true')
echo ""
echo -e "${BLD}=== Spike log ===${RST}"
echo "$LOG"
echo ""

echo "$LOG" | grep -q "Overtake DSP: loaded generator" \
    && pass "dsp.so loaded by shim" || fail "dsp.so not loaded"
echo "$LOG" | grep -q "movy-dsp.*create_instance" \
    && pass "Engine instance created" || fail "create_instance missing"
echo "$LOG" | grep -q "spike ping -> pong" \
    && pass "Param round-trip (ping/pong)" || fail "ping/pong failed"

STATS=$(echo "$LOG" | grep "spike stats ->" | tail -1 || true)
if [[ -n "$STATS" ]]; then
    TICKS=$(echo "$STATS" | grep -o "ticks=[0-9]*" | cut -d= -f2)
    NOTES=$(echo "$STATS" | grep -o "notes_sent=[0-9]*" | cut -d= -f2)
    MIDIFAIL=$(echo "$STATS" | grep -o "midi_fail=[0-9]*" | cut -d= -f2)
    [[ -n "$TICKS" && "$TICKS" -gt 100 ]] \
        && pass "Clock ticking in render_block (ticks=$TICKS)" || fail "Clock not ticking (ticks=$TICKS)"
    [[ "$NOTES" == "4" ]] \
        && pass "4 channel-addressed notes emitted" || fail "notes_sent=$NOTES (expected 4)"
    [[ "$MIDIFAIL" == "0" ]] \
        && pass "No MIDI send failures" || fail "midi_fail=$MIDIFAIL"
else
    fail "spike stats never logged"
fi

echo ""
if [[ $FAILURES -eq 0 ]]; then
    echo -e "${GRN}${BLD}SPIKE PASSED${RST} — listen check: 4 notes + 4 clicks should have been audible"
else
    echo -e "${RED}${BLD}$FAILURES CHECK(S) FAILED${RST}"
fi
