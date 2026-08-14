#!/usr/bin/env bash
# test-module-contract.sh — device e2e for the generic module-interaction
# contract (PR #2): idle/trigger one-shots and `knob_acceleration: "wide"`.
#
# Neither behaviour is visible as pixels, so movy's debug log is the signal:
#   trigger slot=<s> key=<comp>:<key> val=<idle|trigger>   (new mlog)
#   set slot=<s> gi=<n> key=<comp>:<key> val=<n>           (ordinary param set)
#
# Smack is the reference fixture: its root page puts `reroll` (an idle/trigger
# enum) on knob 5 and `seed` (1..9999, knob_acceleration wide) on knob 7, so
# both paths are reachable with no page navigation.
#
# The module is loaded into the track's FX 1 slot and the slot's previous
# contents are restored on exit, so a user's Set survives the run.
#
# Requires schwung-midi-inject-ui.py one directory up.
# Usage: ./scripts/test-module-contract.sh [host]   (default: move.local)

set -euo pipefail
HOST="${1:-move.local}"
MOVY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INJECT="$MOVY_DIR/../schwung-midi-inject-ui.py"

# Run against the fixture state rather than whatever the device happens to hold,
# so this passes standalone and in any order relative to the other suites. PREV
# below is captured AFTER this, so it records the fixture's FX 1 (empty) rather
# than the user's — which is correct, because the fixture is what the next run
# expects to find.
# shellcheck source=lib/test-set.sh
source "$MOVY_DIR/scripts/lib/test-set.sh"
test_set_begin || { echo "could not establish the fixture state"; exit 1; }
REMOTE="/data/UserData/schwung/modules/tools/movy"
LOG=/data/UserData/schwung/debug.log
SLOT=0
MODULE=smack

RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'; BLD='\033[1m'; RST='\033[0m'
pass() { echo -e "${GRN}✓${RST} $1"; }
fail() { echo -e "${RED}✗${RST} $1"; FAILURES=$((FAILURES+1)); }
info() { echo -e "${YLW}→${RST} $1"; }
FAILURES=0

inj() { python3 "$INJECT" "$HOST" "$@" >/dev/null 2>&1; }
# Rapid detents must share one ssh round-trip — per-event inject is ~600ms,
# far wider than the gesture windows being tested.
burst() { python3 "$MOVY_DIR/scripts/inject-burst.py" "$HOST" "$@" >/dev/null 2>&1; }
# One event, one line. The device can have two sinks writing debug.log —
# shadow_ui's own writer plus the `unified-log` pipe that restart-move.sh
# attaches to Move — so an event appears twice with different prefixes and, at a
# millisecond boundary, with timestamps 1 ms apart. These tests count EVENTS, so
# a raw line count silently doubled every trigger and detent assertion. Same
# message within 5 ms = the same event; the gestures under test are 25 ms apart
# or wider, so genuinely distinct events survive.
movylog() {
    ssh "ableton@$HOST" "grep '\[movy\]' $LOG 2>/dev/null || true" \
        | sed -E 's/\[[A-Z ]+\] \[[a-z-]+\] //' \
        | awk '{
            split($1, c, ":"); now = c[1]*3600 + c[2]*60 + c[3]
            msg = $0; sub(/^[^ ]+ /, "", msg)
            if (msg in last && now - last[msg] < 0.005) next
            last[msg] = now; print
        }'
}

# Jog wheel = CC14 (1 = one step clockwise), jog click = CC3, Back = CC51.
# Knobs are CC71..78; d2 is a signed 7-bit delta (1 = +1, 127 = -1).
CC_JOG=14; CC_CLICK=3; CC_BACK=51
KNOB_REROLL=76   # root page knob 5
KNOB_SEED=78     # root page knob 7

ssh -o ConnectTimeout=5 "ableton@$HOST" 'echo ok' >/dev/null 2>&1 || {
    echo -e "${RED}Cannot reach $HOST${RST}"; exit 1; }
pass "SSH reachable"

# ── Deploy ───────────────────────────────────────────────────────────────────
info "Building and deploying movy..."
cd "$MOVY_DIR"
node build/device.mjs >/dev/null 2>&1
ssh "ableton@$HOST" "mkdir -p $REMOTE" >/dev/null 2>&1
scp -q "$MOVY_DIR/ui.js" "ableton@$HOST:$REMOTE/"
pass "Built + deployed"

# ── Load the module into FX 1, remembering what was there ────────────────────
PREV=$(node "$MOVY_DIR/scripts/module-slot.mjs" get "$SLOT" fx1 2>/dev/null || echo "")
info "FX 1 previously: '${PREV:-<empty>}' — loading $MODULE"
restore() {
    info "Restoring FX 1 to '${PREV:-<empty>}'"
    node "$MOVY_DIR/scripts/module-slot.mjs" set "$SLOT" fx1 "${PREV:-none}" >/dev/null 2>&1 || true
    # Then hand the LEDs back: this run leaves movy open in overtake owning the
    # surface, so without a restart the hardware stays dark.
    test_set_end
}
trap restore EXIT INT TERM
node "$MOVY_DIR/scripts/module-slot.mjs" set "$SLOT" fx1 "$MODULE" >/dev/null 2>&1
pass "$MODULE loaded into FX 1"

# ── Reopen movy fresh, navigate chain → FX 1 → knobs ─────────────────────────
info "Reopening movy and navigating to FX 1 knobs..."
for _ in 1 2 3; do inj cc $CC_BACK 127; sleep 0.12; inj cc $CC_BACK 0; sleep 0.15; done
ssh "ableton@$HOST" "touch /data/UserData/schwung/debug_log_on; > $LOG" >/dev/null 2>&1
ssh "ableton@$HOST" 'python3 -c "
import mmap, json
open(\"/data/UserData/schwung/open_tool_cmd.json\",\"w\").write(json.dumps({\"file_path\":\"/\",\"tool_id\":\"movy\"}))
f=open(\"/dev/shm/schwung-control\",\"r+b\"); mm=mmap.mmap(f.fileno(),0); mm[56]=1; mm.close()
"' >/dev/null 2>&1
sleep 3
inj cc $CC_JOG 1; sleep 0.4                                  # chain: synth → FX 1
inj cc $CC_CLICK 127; sleep 0.15; inj cc $CC_CLICK 0; sleep 1.0   # enter knobs
CHAIN=$(movylog | grep -oE "chain chainIndex=[0-9]+" | tail -1 || true)
HIER=$(movylog | grep "loadHierarchy" | tail -1 || true)
[ -n "$HIER" ] && pass "Hierarchy loaded ($CHAIN): ${HIER##*movy] }" \
                || fail "No loadHierarchy after navigating to FX 1"

# ── 1. Trigger: one fire per clockwise gesture ───────────────────────────────
# Smack reports enums in INDEX format, so a fire writes val=1 and idle writes
# val=0 (enum-value.ts picks the format the module itself uses).
TRIG_RE="trigger .*reroll val=1"
IDLE_RE="trigger .*reroll val=0"

info "Trigger — four clockwise detents 60ms apart (one gesture)..."
ssh "ableton@$HOST" "> $LOG" >/dev/null 2>&1
burst $KNOB_REROLL 1 4 60; sleep 1.2
L=$(movylog)
NCC=$(echo "$L" | grep -c "knobCC k=5" || true)
NTRIG=$(echo "$L" | grep -c "$TRIG_RE" || true)
echo "  $NCC detent(s) → $NTRIG fire(s)"
{ [ "$NCC" -ge 3 ] && [ "$NTRIG" -eq 1 ]; } \
    && pass "One clockwise gesture fires exactly once ($NCC detents, 1 fire)" \
    || fail "Expected 1 fire from a rapid gesture; got $NTRIG from $NCC detents"

info "Trigger — counter-clockwise returns to idle and re-arms..."
ssh "ableton@$HOST" "> $LOG" >/dev/null 2>&1
burst $KNOB_REROLL 1 2 60; burst $KNOB_REROLL 127 1 60; burst $KNOB_REROLL 1 2 60
sleep 1.2
# `|| true` throughout: a log with no match means the module did not do the
# thing under test, which the comparison below reports. Under pipefail the bare
# pipeline would abort the run instead, skipping every later check.
SEQ=$(movylog | grep -oE "reroll val=[01]" | sed 's/reroll val=//' | tr '\n' ',' || true)
echo "  sequence: $SEQ"
[ "$SEQ" = "1,0,1," ] && pass "CW fires, CCW sends idle, CW re-fires (re-armed)" \
                      || fail "Expected '1,0,1,' got '$SEQ'"

info "Trigger — a pause past the reset window re-arms without a CCW turn..."
ssh "ableton@$HOST" "> $LOG" >/dev/null 2>&1
burst $KNOB_REROLL 1 1 0; sleep 1.2; burst $KNOB_REROLL 1 1 0; sleep 1.0
NTRIG=$(movylog | grep -c "$TRIG_RE" || true)
[ "$NTRIG" -eq 2 ] && pass "Two fires separated by a >700ms pause (n=$NTRIG)" \
                   || fail "Expected 2 fires across a pause, got $NTRIG"

info "Trigger — stays visually idle and offers no automation lane..."
ssh "ableton@$HOST" "> $LOG" >/dev/null 2>&1
burst $KNOB_REROLL 1 1 0; sleep 1.5
L=$(movylog)
if echo "$L" | qgrep -E "knob_[0-9]+_set .*reroll"; then
    fail "reroll was bound to an automation lane (should be automatable:false)"
else
    pass "No automation lane bound to the trigger"
fi
if echo "$L" | qgrep -E "RE-RO:a[1-9]"; then
    fail "Automation dot drawn on a trigger knob"
else
    pass "No automation dot on the trigger knob"
fi

# ── 2. Wide acceleration: slow = 1 step, fast = large jump ───────────────────
seedval() { movylog | grep -oE "key=fx1:seed val=[0-9]+" | tail -1 | grep -oE "[0-9]+$"; }

info "Wide acceleration — two deliberate detents on knob 7 (seed 1..9999)..."
ssh "ableton@$HOST" "> $LOG" >/dev/null 2>&1
burst $KNOB_SEED 1 1 0; sleep 1.2; A=$(seedval)
burst $KNOB_SEED 1 1 0; sleep 1.2; B=$(seedval)
echo "  seed: $A → $B"
if [ -n "$A" ] && [ -n "$B" ] && [ "$((B - A))" -eq 1 ]; then
    pass "Deliberate turns move exactly one step ($A → $B)"
else
    fail "Slow turns should move 1 step; got $A → $B"
fi

info "Wide acceleration — a fast sweep travels far..."
ssh "ableton@$HOST" "> $LOG" >/dev/null 2>&1
burst $KNOB_SEED 1 8 25; sleep 1.5
VALS=$(movylog | grep -oE "key=fx1:seed val=[0-9]+" | grep -oE "[0-9]+$" | tr '\n' ' ' || true)
echo "  seed sweep: $VALS"
FIRST=$(echo "$VALS" | awk '{print $1}'); LAST=$(echo "$VALS" | awk '{print $NF}')
if [ -n "$FIRST" ] && [ -n "$LAST" ] && [ "$((LAST - FIRST))" -gt 200 ]; then
    pass "Fast sweep accelerated ($FIRST → $LAST, +$((LAST - FIRST)))"
else
    fail "Fast sweep did not accelerate ($FIRST → $LAST)"
fi

info "Contrast — the same burst on a non-wide param is unaffected..."
ssh "ableton@$HOST" "> $LOG" >/dev/null 2>&1
burst 73 1 8 25; sleep 1.5
LL=$(movylog | grep -oE "key=fx1:loop_len val=[0-9]+" | grep -oE "[0-9]+$" | tr '\n' ' ' || true)
LF=$(echo "$LL" | awk '{print $1}'); LT=$(echo "$LL" | awk '{print $NF}')
echo "  loop_len: $LL"
if [ -n "$LF" ] && [ -n "$LT" ] && [ "$((LT - LF))" -le 4 ]; then
    pass "Non-wide param keeps its normal detent scaling ($LF → $LT)"
else
    fail "Non-wide param unexpectedly accelerated ($LF → $LT)"
fi

echo
echo -e "${BLD}=== Results ===${RST}"
if [ "$FAILURES" -eq 0 ]; then
    echo -e "${GRN}${BLD}ALL MODULE-CONTRACT CHECKS PASSED${RST}"
else
    echo -e "${RED}${BLD}$FAILURES CHECK(S) FAILED${RST}"; exit 1
fi
