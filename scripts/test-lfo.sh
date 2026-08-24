#!/usr/bin/env bash
# test-lfo.sh — an LFO assigned on a MOVY-hosted track actually modulates.
#
# The bug this exists for: the LFO target commit went through
# `shadow_set_param_timeout(track, …)`, schwung's SLOT-addressed API, which
# refuses any index past slot 3 (shadow_ui.c: `slot >= SHADOW_UI_SLOTS`). A movy
# track is a chain in movy's own engine, not a schwung slot, so on tracks 5-16
# the write returned false having written nothing: the target never changed and
# `enabled` stayed 0, so the chain's lfo_tick() skipped the LFO entirely.
#
# No local test can prove the other half — that the chain host then really moves
# the param. That needs the real chain DSP, so it is checked here by SAMPLING THE
# DRIVEN PARAM twice and requiring it to have moved (`chlfolog`, which makes the
# engine log a chain's LFO state; the remote-UI socket can write but not read).
#
# Usage: ./scripts/test-lfo.sh [move.local]
set -uo pipefail
cd "$(dirname "$0")/.."

HOST="${1:-move.local}"
MOVY_DIR="$(pwd)"
# shellcheck source=lib/test-set.sh
source "$MOVY_DIR/scripts/lib/test-set.sh"

LOG=/data/UserData/schwung/debug.log
PASS=0; FAIL=0
GRN=$'\033[0;32m'; RED=$'\033[0;31m'; BLD=$'\033[1m'; RST=$'\033[0m'
pass() { echo "${GRN}✓${RST} $1"; PASS=$((PASS+1)); }
fail() { echo "${RED}✗${RST} $1"; FAIL=$((FAIL+1)); }

ssh -o ConnectTimeout=5 "ableton@$HOST" true 2>/dev/null || {
    echo "DEVICE OFFLINE — SKIPPING LFO TEST"; exit 0
}

ep() { node scripts/engine-param.mjs set "$1" "$2" "$HOST" >/dev/null 2>&1; }
# The engine's LFO report for chain 4, as one line. `chlfolog`'s VALUE is the
# chain to report on — it has to track the chain this suite loads into, or the
# report comes back empty and every check below fails on a blank string.
lfo_report() {
    ssh "ableton@$HOST" "> $LOG"
    ep "chlfolog" "4"
    sleep 1.2
    ssh "ableton@$HOST" "grep -o 'chain 4 lfos:.*' $LOG | head -n 1"
}

echo "${BLD}=== deploying ===${RST}"
./scripts/build-dsp.sh >/dev/null 2>&1 || { echo "dsp build failed"; exit 1; }
./scripts/deploy.sh "$HOST" >/dev/null 2>&1 || { echo "deploy failed"; exit 1; }
ssh "ableton@$HOST" 'touch /data/UserData/schwung/debug_log_on; > /data/UserData/schwung/debug.log'

echo "${BLD}=== opening movy ===${RST}"
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
sleep 8

echo "${BLD}=== loading a synth into movy chain 4 (track index 4, shown as track 5) ===${RST}"
ep "ch4:synth:module" "plaits"
sleep 3
if ssh "ableton@$HOST" "cat $LOG" | qgrep "chain 4: synth = plaits"; then
    pass "chain 4 holds a synth"
else
    fail "chain 4 never loaded — the rest of this suite would prove nothing"
    echo "${RED}${BLD}LFO DEVICE TEST FAILED${RST} ($PASS passed, $FAIL failed)"; exit 1
fi

# ── 1. an unassigned LFO is inactive ───────────────────────────────────────────
BEFORE=$(lfo_report)
echo "  before: $BEFORE"
if echo "$BEFORE" | qgrep 'lfo1=\[: active=0'; then
    pass "LFO 1 starts unassigned and inactive"
else
    fail "LFO 1 did not start clean: $BEFORE"
fi

# ── 2. the assignment lands in the chain ───────────────────────────────────────
# Exactly the three fields movy's assign path commits, in the same order.
ep "ch4:lfo1:target" "synth"
ep "ch4:lfo1:target_param" "morph"
ep "ch4:lfo1:enabled" "1"
ep "ch4:lfo1:depth" "0.9"
ep "ch4:lfo1:rate_hz" "8.0"
ep "ch4:lfo1:sync" "0"
sleep 1

AFTER=$(lfo_report)
echo "  after:  $AFTER"
if echo "$AFTER" | qgrep 'lfo1=\[synth:morph'; then
    pass "the target reached the chain instance"
else
    fail "target never landed: $AFTER"
fi
if echo "$AFTER" | qgrep 'lfo1=\[synth:morph active=1'; then
    pass "the chain marked the LFO active"
else
    fail "the LFO is assigned but inactive — enabled never landed: $AFTER"
fi

# ── 3. THE claim: the driven param actually moves ──────────────────────────────
# Two samples of the live value. An assigned-but-dead LFO reports a target and a
# frozen value, which is exactly what "mapping does nothing" looked like.
lfo_value() { lfo_report | grep -o 'lfo1=\[[^]]*value=[^]]*\]' | sed 's/.*value=//; s/\]//'; }
V1=$(echo "$AFTER" | grep -o 'lfo1=\[[^]]*value=[^]]*\]' | sed 's/.*value=//; s/\]//')
# Several samples, not two: a periodic value read at two arbitrary instants can
# legitimately come back the same, and a flaky device test is worse than none.
SEEN="$V1"; MOVED=0
for _ in 1 2 3; do
    sleep 0.7
    VN=$(lfo_value)
    SEEN="$SEEN -> $VN"
    [ -n "$VN" ] && [ "$VN" != "$V1" ] && MOVED=1
done
echo "  driven param: $SEEN"
if [ -n "$V1" ] && [ "$MOVED" -eq 1 ]; then
    pass "the driven param is moving ($SEEN) — modulation is live"
else
    fail "the driven param never moved ($SEEN) — assigned but not modulating"
fi

# ── 4. clearing stops it ───────────────────────────────────────────────────────
ep "ch4:lfo1:target" ""
ep "ch4:lfo1:target_param" ""
ep "ch4:lfo1:enabled" "0"
sleep 1
CLEARED=$(lfo_report)
if echo "$CLEARED" | qgrep 'lfo1=\[: active=0'; then
    pass "clearing the target deactivates the LFO"
else
    fail "the LFO stayed active after a clear: $CLEARED"
fi

echo
if [ "$FAIL" -eq 0 ]; then
    echo "${GRN}${BLD}LFO DEVICE TEST PASSED${RST} ($PASS checks)"
    exit 0
fi
echo "${RED}${BLD}LFO DEVICE TEST FAILED${RST} ($PASS passed, $FAIL failed)"
exit 1
