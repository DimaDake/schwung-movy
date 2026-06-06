#!/usr/bin/env bash
# test.sh — deploy movy and verify knob handling end-to-end
# Fully automated: deploys, opens Movy on device, injects knob CCs, checks log.
#
# Requires schwung-midi-inject-ui.py in the parent directory (../):
#   /Users/dake/git/cld/schwung-midi-inject-ui.py
#
# Usage: ./scripts/test.sh [host]   (default host: move.local)

set -euo pipefail
HOST="${1:-move.local}"
MOVY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INJECT="$MOVY_DIR/../schwung-midi-inject-ui.py"

RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'; BLD='\033[1m'; RST='\033[0m'
pass() { echo -e "${GRN}✓${RST} $1"; }
fail() { echo -e "${RED}✗${RST} $1"; FAILURES=$((FAILURES+1)); }
info() { echo -e "${YLW}→${RST} $1"; }
FAILURES=0

# ── 1. Pre-flight ────────────────────────────────────────────────────────────
info "Checking SSH ($HOST)..."
ssh -o ConnectTimeout=5 "ableton@$HOST" 'echo ok' >/dev/null 2>&1 || {
    echo -e "${RED}Cannot reach $HOST${RST}"; exit 1; }
pass "SSH reachable"

# ── 2. Deploy ────────────────────────────────────────────────────────────────
info "Deploying ui.js + ui_font.mjs + view/..."
REMOTE="/data/UserData/schwung/modules/tools/movy"
ssh "ableton@$HOST" "mkdir -p $REMOTE/view" >/dev/null 2>&1
scp -q "$MOVY_DIR/ui.js" "$MOVY_DIR/ui_font.mjs" "ableton@$HOST:$REMOTE/"
scp -q "$MOVY_DIR/view/model.mjs" "$MOVY_DIR/view/renderer.mjs" "ableton@$HOST:$REMOTE/view/"
pass "Deployed"

# ── 3. Enable logging + clear log ────────────────────────────────────────────
ssh "ableton@$HOST" '
    touch /data/UserData/schwung/debug_log_on
    > /data/UserData/schwung/debug.log
' >/dev/null 2>&1
pass "Debug log enabled and cleared"

# ── 4. Open Movy on device via open_tool_cmd ─────────────────────────────────
info "Opening Movy on device..."
ssh "ableton@$HOST" 'python3 -c "
import mmap, json
cmd = json.dumps({\"file_path\": \"/\", \"tool_id\": \"movy\"})
with open(\"/data/UserData/schwung/open_tool_cmd.json\", \"w\") as f:
    f.write(cmd)
with open(\"/dev/shm/schwung-control\", \"r+b\") as f:
    mm = mmap.mmap(f.fileno(), 0)
    mm[56] = 1
    mm.close()
print(\"open_tool_cmd set\")
"'

sleep 1
pass "Movy open command sent"

# ── 5. Inject knob turns ─────────────────────────────────────────────────────
info "Injecting knob turns..."
python3 "$INJECT" "$HOST" cc 71 65  # knob 1 right
sleep 0.15
python3 "$INJECT" "$HOST" cc 71 63  # knob 1 left
sleep 0.15
python3 "$INJECT" "$HOST" cc 72 65  # knob 2 right
sleep 0.4

# ── 6. Fetch log ─────────────────────────────────────────────────────────────
LOG=$(ssh "ableton@$HOST" 'grep "\[movy\]" /data/UserData/schwung/debug.log 2>/dev/null || true')

echo ""
echo -e "${BLD}=== Movy log ===${RST}"
if [[ -n "$LOG" ]]; then
    echo "$LOG"
else
    echo "(no [movy] lines found)"
fi
echo ""

# ── 7. Evaluate ──────────────────────────────────────────────────────────────
echo -e "${BLD}=== Results ===${RST}"

if echo "$LOG" | grep -q "init: activeSlot="; then
    SLOT=$(echo "$LOG" | grep "init: activeSlot=" | tail -1 | grep -o "activeSlot=[0-9]*" | cut -d= -f2)
    pass "Module loaded — targeting slot $SLOT"
else
    fail "init never ran (syntax error or path issue?)"
fi

if echo "$LOG" | grep -q "loadHierarchy:"; then
    if echo "$LOG" | grep -qE "loaded [1-9][0-9]* params"; then
        N=$(echo "$LOG" | grep "loaded.*params" | tail -1 | grep -o "[0-9]* params" | awk '{print $1}')
        pass "ui_hierarchy loaded — $N real params from synth"
    elif echo "$LOG" | grep -q "ui_hierarchy null"; then
        pass "ui_hierarchy null → fallback test params active"
    elif echo "$LOG" | grep -q "parse error"; then
        fail "ui_hierarchy parse error — check synth module.json"
    else
        fail "loadHierarchy ran but outcome unclear — check log above"
    fi
else
    fail "loadHierarchy never called"
fi

if echo "$LOG" | grep -q "knobCC k="; then
    N=$(echo "$LOG" | grep -c "knobCC k=" || true)
    pass "Knob CC received ($N events processed)"
else
    fail "No knob CC received — MIDI not reaching onMidiMessageInternal"
fi

if echo "$LOG" | grep -q "^.*set slot="; then
    pass "applyKnobDelta ran — param write attempted"
    if echo "$LOG" | grep -q "set_param returned true"; then
        pass "shadow_set_param returned true — IPC OK"
    elif echo "$LOG" | grep -q "set_param returned false"; then
        fail "shadow_set_param returned false — IPC timeout or key rejected"
    else
        pass "test params path — IPC skipped (no real synth loaded)"
    fi
else
    if echo "$LOG" | grep -q "no param"; then
        fail "applyKnobDelta: knobParams empty at knob turn time"
    else
        fail "applyKnobDelta never reached"
    fi
fi

# ── 8. Summary ───────────────────────────────────────────────────────────────
echo ""
if [[ $FAILURES -eq 0 ]]; then
    echo -e "${GRN}${BLD}ALL CHECKS PASSED${RST}"
else
    echo -e "${RED}${BLD}$FAILURES CHECK(S) FAILED${RST}"
    echo -e "Live log: ${YLW}ssh ableton@$HOST 'tail -f /data/UserData/schwung/debug.log | grep \\[movy\\]'${RST}"
fi
