#!/usr/bin/env bash
# test-auto.sh — device e2e for PARAMETER AUTOMATION display + registry.
#
# The param page cannot be read back as pixels, so movy logs its automation
# decisions (gated behind debug_log_on): `auto lanes t=<trk> [<keys>]` (the UI
# lane registry, mirror of the engine's assigned lanes) and `auto render ...
# <KNOB>:a<dot>t<touched>=<value>` (per-knob dot + held-value highlight). This
# test injects the real hold-step + knob-turn gesture and asserts on those.
#
# Covers the three regressions:
#   P1  held-step value updates live while turning a knob
#   P2  the automation dot shows on an automated param
#   P3  on reopen, the registry repopulates from the restored engine state
#       (empty registry = no dot, no held value, knob jumps on playback)
#
# Requires schwung-midi-inject-ui.py one directory up.
# Usage: ./scripts/test-auto.sh [host]   (default: move.local)

set -euo pipefail
HOST="${1:-move.local}"
MOVY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INJECT="$MOVY_DIR/../schwung-midi-inject-ui.py"
REMOTE="/data/UserData/schwung/modules/tools/movy"
LOG=/data/UserData/schwung/debug.log

RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'; BLD='\033[1m'; RST='\033[0m'
pass() { echo -e "${GRN}✓${RST} $1"; }
fail() { echo -e "${RED}✗${RST} $1"; FAILURES=$((FAILURES+1)); }
info() { echo -e "${YLW}→${RST} $1"; }
FAILURES=0

inj() { python3 "$INJECT" "$HOST" "$@" >/dev/null 2>&1; }
movylog() { ssh "ableton@$HOST" "grep '\[movy\]' $LOG 2>/dev/null || true"; }

# CC numbers (shared/constants.mjs): jog-click=3, Play=85, Rec=86, knob5=75.
# Knob 5 = LEVEL on Forge's Osc page — must be an AUTOMATABLE param (knob 2 =
# Coarse Ratio is automatable:false since the Kit-A curation, which silently
# broke the dot assertions). PAD=68 = drum pad 1 (bottom-left): the default
# focused pad after a reopen, so the reopen dot check sees the lane's pad.
CC_JOG=3; CC_PLAY=85; CC_REC=86; CC_KNOB2=75; CC_BACK=51
STEP1=16; STEP5=20; PAD=68

# ── Pre-flight + deploy ───────────────────────────────────────────────────────
ssh -o ConnectTimeout=5 "ableton@$HOST" 'echo ok' >/dev/null 2>&1 || {
    echo -e "${RED}Cannot reach $HOST${RST}"; exit 1; }
info "Building and deploying..."
cd "$MOVY_DIR"
node build/device.mjs >/dev/null 2>&1
scp -q "$MOVY_DIR/ui.js" "ableton@$HOST:$REMOTE/"
pass "Built + deployed"

# ── Fresh boot: exit movy (Back ×3: knobs→chain→exit), then reopen ────────────
info "Reopening movy fresh..."
for _ in 1 2 3; do inj cc $CC_BACK 127; sleep 0.12; inj cc $CC_BACK 0; sleep 0.15; done
ssh "ableton@$HOST" "touch /data/UserData/schwung/debug_log_on; > $LOG" >/dev/null 2>&1
ssh "ableton@$HOST" 'python3 -c "
import mmap, json
open(\"/data/UserData/schwung/open_tool_cmd.json\",\"w\").write(json.dumps({\"file_path\":\"/\",\"tool_id\":\"movy\"}))
f=open(\"/dev/shm/schwung-control\",\"r+b\"); mm=mmap.mmap(f.fileno(),0); mm[56]=1; mm.close()
"' >/dev/null 2>&1
sleep 3

# ── 1. Create automation, verify it displays (P1, P2) ─────────────────────────
info "Knobs view + clip + play, then hold step 5 and turn knob 5 (automatable)..."
inj cc $CC_JOG 127; sleep 0.1; inj cc $CC_JOG 0; sleep 0.3          # chain → knobs
inj note_on $PAD 100; sleep 0.1; inj note_off $PAD; sleep 0.1       # set step-entry pitch
inj note_on $STEP1 127; sleep 0.1; inj note_off $STEP1; sleep 0.2   # place note (auto-clip)
inj cc $CC_PLAY 127; sleep 0.1; inj cc $CC_PLAY 0; sleep 0.5        # play
inj note_on $STEP5 127; sleep 0.45                                  # hold step 5 (step-auto)
# Sweep up then down (well separated): bidirectional so we get distinct values
# regardless of the base, instead of clamping at a rail (which yields one value).
for _ in 1 2 3; do inj cc $CC_KNOB2 12; sleep 0.3; done             # up
for _ in 1 2 3; do inj cc $CC_KNOB2 116; sleep 0.3; done            # down
inj note_off $STEP5; sleep 0.8

L=$(movylog)
echo -e "${BLD}=== auto render (held) ===${RST}"; echo "$L" | grep "auto render held=1" | tail -8 || true

# A consumed knob turn recorded a lock at the held step.
if echo "$L" | grep -qE "aset|auto render held=1.*t1="; then :; fi
# The held value shows inverted (t1) with a percentage — and changes as we turn.
HELD_VALUES=$(echo "$L" | grep "auto render held=1" | grep -oE "t1=[0-9]+%" | sort -u | wc -l | tr -d ' ')
if echo "$L" | grep -q "auto render held=1.*t1="; then
    pass "P1: held-step value highlighted while holding (touched=1)"
else
    fail "P1: held value never highlighted (no 'auto render held=1 ... t1=' line)"
fi
if [[ "${HELD_VALUES:-0}" -ge 2 ]]; then
    pass "P1: held value updates live while turning ($HELD_VALUES distinct values)"
else
    fail "P1: held value did not change while turning ($HELD_VALUES distinct values)"
fi
# The automation dot is set on the turned param (a1) once a lane exists.
if echo "$L" | grep -qE "auto render .*:a1t"; then
    pass "P2: automation dot shown on automated param (a1)"
else
    fail "P2: automation dot never shown (no ':a1' in any 'auto render' line)"
fi

# ── 1b. LIVE record (no step held): the on-screen arc/value must follow the ───
#       turn while recording. This is the path the held-step test misses: a live
#       take is recArmed (recording+playing), NOT step-auto, so its repaint is
#       driven by liveTurn, not heldLocks. Frozen screen here = the reported bug.
info "Arming Record and turning knob 5 live (no step held)..."
inj cc $CC_REC 127; sleep 0.1; inj cc $CC_REC 0                     # arm record (one-bar count-in)
sleep 3                                                             # let the count-in elapse → recording live
# Drive to the floor first so the up-sweep below has full headroom and a known
# base. Then a pure up-sweep MUST yield ascending distinct values: a live take
# that fails to accumulate (the status poll wipes heldLocks every tick, the
# playhead advances) sticks at base+one-delta — the reported "snaps back" bug.
for _ in 1 2 3 4; do inj cc $CC_KNOB2 116; sleep 0.25; done         # down to floor
ssh "ableton@$HOST" "> $LOG" >/dev/null 2>&1                        # isolate the up-sweep frames
for _ in 1 2 3 4; do inj cc $CC_KNOB2 12; sleep 0.3; done           # up, well separated, no step held
sleep 0.6
inj cc $CC_REC 127; sleep 0.1; inj cc $CC_REC 0                     # stop recording

LL=$(movylog)
echo -e "${BLD}=== auto render (live, held=0) ===${RST}"; echo "$LL" | grep "auto render held=0" | grep -E "t1=" | tail -8 || true
LIVE_VALUES=$(echo "$LL" | grep "auto render held=0" | grep -oE "t1=[0-9]+%" | sort -u | wc -l | tr -d ' ')
if echo "$LL" | grep -qE "auto render held=0.*t1="; then
    pass "P4: live-record value highlighted while turning (no step held)"
else
    fail "P4: live take never repainted the arc/value (screen frozen while turning)"
fi
# An accumulating up-sweep gives several ascending values; a non-accumulating
# (reverting) take sticks at base+one-delta → one value. Require ≥3.
if [[ "${LIVE_VALUES:-0}" -ge 3 ]]; then
    pass "P4: live-record value accumulates across the take ($LIVE_VALUES distinct values)"
else
    fail "P4: live value did not accumulate — snaps back to base ($LIVE_VALUES distinct values)"
fi

# ── 2. Reopen and verify the registry repopulates from restore (P3 root) ──────
info "Reopening again to verify the registry restores..."
for _ in 1 2 3; do inj cc $CC_BACK 127; sleep 0.12; inj cc $CC_BACK 0; sleep 0.15; done
ssh "ableton@$HOST" "> $LOG" >/dev/null 2>&1
ssh "ableton@$HOST" 'python3 -c "
import mmap, json
open(\"/data/UserData/schwung/open_tool_cmd.json\",\"w\").write(json.dumps({\"file_path\":\"/\",\"tool_id\":\"movy\"}))
f=open(\"/dev/shm/schwung-control\",\"r+b\"); mm=mmap.mmap(f.fileno(),0); mm[56]=1; mm.close()
"' >/dev/null 2>&1
sleep 3.5
inj cc $CC_JOG 127; sleep 0.1; inj cc $CC_JOG 0; sleep 0.4          # show params → forces a render

L2=$(movylog)
echo -e "${BLD}=== auto lanes after reopen ===${RST}"; echo "$L2" | grep "auto lanes" | tail -4 || true

# The UI lane registry must be non-empty after restore (the bug: it was []).
if echo "$L2" | grep -qE "auto lanes t=[0-9]+ \[[^]]+\]"; then
    pass "P3: lane registry repopulated from restore (non-empty)"
else
    fail "P3: lane registry empty after reopen — restore re-sync broken"
fi
# And the dot shows on reopen WITHOUT any knob touch (registry-driven).
if echo "$L2" | grep -qE "auto render .*:a1t"; then
    pass "P2/P3: dot shown on reopen without re-touching a knob"
else
    fail "P2/P3: no dot after reopen (registry/automated flag not restored)"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
if [[ $FAILURES -eq 0 ]]; then
    echo -e "${GRN}${BLD}ALL AUTOMATION CHECKS PASSED${RST}"
else
    echo -e "${RED}${BLD}$FAILURES AUTOMATION CHECK(S) FAILED${RST}"
    echo -e "Live log: ${YLW}ssh ableton@$HOST 'tail -f $LOG | grep \\[movy\\]'${RST}"
    exit 1
fi
