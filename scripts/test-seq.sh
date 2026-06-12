#!/usr/bin/env bash
# test-seq.sh — device e2e for the sequencer: deploy, open movy, drive the
# surface via MIDI inject (pad, step button, Play), and assert engine
# behavior from the debug log (auto-start on first step, transport stop).
set -euo pipefail
HOST="${1:-move.local}"
MOVY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INJECT="$MOVY_DIR/../schwung-midi-inject-ui.py"

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
sleep 2

info "Playing a pad (note 80 → sets step-entry pitch)..."
python3 "$INJECT" "$HOST" note_on 80 100
sleep 0.2
python3 "$INJECT" "$HOST" note_off 80
sleep 0.3

info "Pressing step 1 (note 16) — should place a note and auto-start..."
python3 "$INJECT" "$HOST" note_on 16 127
sleep 0.1
python3 "$INJECT" "$HOST" note_off 16
sleep 2

info "Pressing Play (CC 85) — should stop the transport..."
python3 "$INJECT" "$HOST" cc 85 127
sleep 0.3
python3 "$INJECT" "$HOST" cc 85 0
sleep 1

LOG=$(ssh "ableton@$HOST" 'grep -E "\[movy\]|movy-dsp" /data/UserData/schwung/debug.log 2>/dev/null || true')
echo ""
echo -e "${BLD}=== Seq log ===${RST}"
echo "$LOG" | grep -E "seq:|movy-dsp" || echo "(no seq lines)"
echo ""

echo "$LOG" | grep -q "movy-dsp.*create_instance" \
    && pass "Engine loaded" || fail "Engine missing"
echo "$LOG" | grep -q "seq: play=1" \
    && pass "Step entry auto-started transport" || fail "No auto-start (seq: play=1 missing)"
echo "$LOG" | grep -q "seq: play=0" \
    && pass "Play button stopped transport" || fail "No stop (seq: play=0 missing)"

echo ""
if [[ $FAILURES -eq 0 ]]; then
    echo -e "${GRN}${BLD}SEQ DEVICE TEST PASSED${RST} — the placed note should have been looping audibly"
else
    echo -e "${RED}${BLD}$FAILURES CHECK(S) FAILED${RST}"
fi
