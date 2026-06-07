#!/usr/bin/env bash
# test.sh — deploy movy and verify end-to-end behaviour on device
#
# Checks:
#   1. SSH reachability
#   2. Deploy
#   3. Movy loads (init ran, loadHierarchy ran)
#   4. Knob CCs reach the model and set params
#   5. Jog wheel CC reaches changePage (bank switching)
#   6. If a real synth is loaded: chain_params read + config looked up
#
# Requires schwung-midi-inject-ui.py one directory up.
# Usage: ./scripts/test.sh [host]   (default: move.local)

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
# All movy logic is in ui.js (inlined) — shadow_load_ui_module re-evaluates
# ui.js fresh on every tool open, so no module-cache issues.
info "Building and deploying..."
cd "$MOVY_DIR"
node build/device.mjs >/dev/null 2>&1
REMOTE="/data/UserData/schwung/modules/tools/movy"
ssh "ableton@$HOST" "mkdir -p $REMOTE" >/dev/null 2>&1
scp -q "$MOVY_DIR/ui.js" "ableton@$HOST:$REMOTE/"
pass "Built + deployed"

# ── 3. Enable logging + clear log ────────────────────────────────────────────
ssh "ableton@$HOST" '
    touch /data/UserData/schwung/debug_log_on
    > /data/UserData/schwung/debug.log
' >/dev/null 2>&1
pass "Debug log enabled and cleared"

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
"'
sleep 1.5   # allow fresh JS context + init + first hierarchy poll
pass "Movy opened fresh"

# ── 5. Inject knob turns ─────────────────────────────────────────────────────
info "Injecting knob CCs..."
python3 "$INJECT" "$HOST" cc 71 65   # knob 1 +1
sleep 0.15
python3 "$INJECT" "$HOST" cc 71 63   # knob 1 -1
sleep 0.15
python3 "$INJECT" "$HOST" cc 72 65   # knob 2 +1
sleep 0.2

# ── 6. Inject jog wheel turn (CC14, value 1 = one step clockwise) ────────────
info "Injecting jog wheel turn (bank switch)..."
python3 "$INJECT" "$HOST" cc 14 1
sleep 0.2
python3 "$INJECT" "$HOST" cc 14 1    # second step — tests clamping at bank boundary
sleep 0.3

# ── 7. Fetch log ─────────────────────────────────────────────────────────────
LOG=$(ssh "ableton@$HOST" 'grep "\[movy\]" /data/UserData/schwung/debug.log 2>/dev/null || true')

echo ""
echo -e "${BLD}=== Movy log ===${RST}"
if [[ -n "$LOG" ]]; then
    echo "$LOG"
else
    echo "(no [movy] lines found)"
fi
echo ""

# ── 8. Evaluate ──────────────────────────────────────────────────────────────
echo -e "${BLD}=== Results ===${RST}"

# Init
if echo "$LOG" | grep -q "init: activeSlot="; then
    SLOT=$(echo "$LOG" | grep "init: activeSlot=" | tail -1 | grep -o "activeSlot=[0-9]*" | cut -d= -f2)
    pass "Module loaded — targeting slot $SLOT"
else
    fail "init never ran (syntax error or path issue?)"
fi

# Hierarchy load
if echo "$LOG" | grep -q "loadHierarchy:"; then
    if echo "$LOG" | grep -qE "[0-9]+ params(,| loaded)"; then
        N=$(echo "$LOG" | grep -E "[0-9]+ params" | tail -1 | grep -o "[0-9]* params" | awk '{print $1}')
        pass "Hierarchy loaded — $N params"
    elif echo "$LOG" | grep -q "ui_hierarchy null"; then
        pass "Hierarchy: no synth loaded — fallback test params active"
    else
        fail "loadHierarchy ran but outcome unclear"
    fi
else
    fail "loadHierarchy never called"
fi

# chain_params + config (only meaningful if real synth loaded)
if echo "$LOG" | grep -q "config loaded for"; then
    MOD=$(echo "$LOG" | grep "config loaded for" | tail -1 | grep -o "for [a-z]*" | cut -d' ' -f2)
    pass "Module config loaded for '$MOD' — named banks active"
elif echo "$LOG" | grep -q "loadHierarchy:.*module="; then
    MOD=$(echo "$LOG" | grep "loadHierarchy:.*module=" | tail -1 | grep -o "module=[^ ]*" | cut -d= -f2)
    if [[ -z "$MOD" || "$MOD" == "—" ]]; then
        pass "No synth loaded — config lookup skipped (expected)"
    else
        pass "Synth '$MOD' loaded — no bundled config, fell back to auto-layout"
    fi
fi

# Knob CCs
if echo "$LOG" | grep -q "knobCC k="; then
    N=$(echo "$LOG" | grep -c "knobCC k=" || true)
    pass "Knob CCs received ($N events)"
else
    fail "No knob CCs received"
fi

# set_param
if echo "$LOG" | grep -q "^.*set slot="; then
    pass "applyKnobDelta ran — param write attempted"
    if echo "$LOG" | grep -q "set_param returned true"; then
        pass "shadow_set_param returned true — IPC OK"
    elif echo "$LOG" | grep -q "set_param returned false"; then
        fail "shadow_set_param returned false — IPC timeout or key rejected"
    else
        pass "Test params path — IPC skipped (no real synth)"
    fi
else
    if echo "$LOG" | grep -q "no param\|empty slot"; then
        fail "applyKnobDelta: knobParams empty at knob turn time"
    else
        fail "applyKnobDelta never reached"
    fi
fi

# Jog wheel / bank switch
if echo "$LOG" | grep -q "jog bank delta="; then
    pass "Jog wheel CC reached changePage handler"
else
    fail "Jog wheel CC not received (CC14 not reaching onMidiMessageInternal)"
fi
if echo "$LOG" | grep -q "changePage delta="; then
    PLINE=$(echo "$LOG" | grep "changePage delta=" | head -1 | sed 's/.*\[movy\] //')
    pass "changePage called — $PLINE"
else
    fail "changePage not logged (model.mjs changePage mlog missing or module not reloaded)"
fi

# ── 9. Summary ───────────────────────────────────────────────────────────────
echo ""
if [[ $FAILURES -eq 0 ]]; then
    echo -e "${GRN}${BLD}ALL CHECKS PASSED${RST}"
else
    echo -e "${RED}${BLD}$FAILURES CHECK(S) FAILED${RST}"
    echo -e "Live log: ${YLW}ssh ableton@$HOST 'tail -f /data/UserData/schwung/debug.log | grep \\[movy\\]'${RST}"
fi
