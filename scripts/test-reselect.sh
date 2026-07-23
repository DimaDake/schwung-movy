#!/usr/bin/env bash
# test-reselect.sh — device e2e: step automation stays audible after a REAL
# module reselect (the same-id browser reload that emptied the chain host's
# synth_params cache and silently killed abs-CC playback until a restart).
#
# Why this exists: the fix spans movy → chain host → abs-CC and fails SILENTLY
# (UI fine, audio dead). Unit tests mock the host away and can't see a dropped
# warm call site or a changed host contract, so this drives the real path and
# asserts the real cache. See scripts/chain-params.mjs for the WS repro harness.
#
# Signal: after a reselect movy logs `auto warm t=<trk> cache=<max> type=<type>`
# read from knob_N_max — the SAME find_param_info(synth_params) lookup abs-CC
# uses. Empty cache → the fallback `cache=1.00 type=float`; populated → the real
# param range. So a populated, non-fallback line == automation is audible again.
#
# Requires a synth with an automatable param on track 0 whose max is not exactly
# 1.0-float (obxd, the bug's repro module, has cutoff=0..100). Usage: [host]
set -uo pipefail
HOST="${1:-move.local}"
MOVY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INJECT="$MOVY_DIR/../schwung-midi-inject-ui.py"
REMOTE="/data/UserData/schwung/modules/tools/movy"
LOG=/data/UserData/schwung/debug.log
RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'; RST='\033[0m'
pass(){ echo -e "${GRN}✓${RST} $1"; }
fail(){ echo -e "${RED}✗${RST} $1"; FAILURES=$((FAILURES+1)); }
info(){ echo -e "${YLW}→${RST} $1"; }
FAILURES=0
inj(){ python3 "$INJECT" "$HOST" "$@" >/dev/null 2>&1; }
mlog(){ ssh "ableton@$HOST" "grep '\[movy\]' $LOG 2>/dev/null || true"; }

CC_JOG=3; CC_PLAY=85; CC_KNOB1=71; STEP1=16; STEP5=20; PAD=68

ssh -o ConnectTimeout=5 "ableton@$HOST" 'echo ok' >/dev/null 2>&1 || { echo -e "${RED}Cannot reach $HOST${RST}"; exit 1; }
info "Build + deploy…"; cd "$MOVY_DIR"; node build/device.mjs >/dev/null 2>&1
scp -q "$MOVY_DIR/ui.js" "ableton@$HOST:$REMOTE/"

info "Reopen movy fresh on track 0…"
for _ in 1 2 3; do inj cc $CC_JOG 0; done
ssh "ableton@$HOST" "touch /data/UserData/schwung/debug_log_on; > $LOG" >/dev/null 2>&1
ssh "ableton@$HOST" 'python3 -c "
import mmap, json
open(\"/data/UserData/schwung/open_tool_cmd.json\",\"w\").write(json.dumps({\"file_path\":\"/\",\"tool_id\":\"movy\"}))
f=open(\"/dev/shm/schwung-control\",\"r+b\"); mm=mmap.mmap(f.fileno(),0); mm[56]=1; mm.close()
"' >/dev/null 2>&1
sleep 4

info "Create an automation lane (play, hold step 5, sweep knob 1)…"
inj cc $CC_JOG 127; sleep 0.1; inj cc $CC_JOG 0; sleep 0.3          # chain → knobs
inj note_on $PAD 100; sleep 0.1; inj note_off $PAD; sleep 0.1       # step-entry pitch
inj note_on $STEP1 127; sleep 0.1; inj note_off $STEP1; sleep 0.2   # place note (auto-clip)
inj cc $CC_PLAY 127; sleep 0.1; inj cc $CC_PLAY 0; sleep 0.4        # play
inj note_on $STEP5 127; sleep 0.4                                   # hold step 5 → step-auto
for _ in 1 2 3; do inj cc $CC_KNOB1 12; sleep 0.25; done            # sweep up
inj note_off $STEP5; sleep 0.6

LANES=$(mlog | grep 'auto lanes t=0' | tail -1)
if echo "$LANES" | grep -qE 'auto lanes t=0 \[[a-zA-Z]'; then
    pass "automation lane created on track 0 (${LANES##*auto lanes t=0 })"
else
    fail "no automation lane on track 0 — cannot exercise the reselect path (${LANES:-none})"
    echo -e "${RED}$FAILURES failure(s)${RST}"; exit 1
fi

info "Reselect the SAME module via the browser (jog-click open, jog-click confirm)…"
ssh "ableton@$HOST" "> $LOG" >/dev/null 2>&1     # clear so we grep only post-reselect logs
inj cc $CC_JOG 127; sleep 0.1; inj cc $CC_JOG 0; sleep 0.6          # open module browser
inj cc $CC_JOG 127; sleep 0.1; inj cc $CC_JOG 0                     # confirm → reselect + warm
# The warm window is tick-based (~96 ticks); the reload drops the tick rate to
# ~55 Hz, so the verify log can take ~2 s of wall time — wait generously.
sleep 3.5

WARM=$(mlog | grep 'auto warm t=0' | tail -1)
info "warm log: ${WARM##*\[movy\] }"
if [ -z "$WARM" ]; then
    fail "no 'auto warm' after reselect — requestLaneWarm/laneWarmTick wiring is broken"
elif echo "$WARM" | grep -qE 'cache=1\.00 type=float'; then
    fail "cache EMPTY after reselect (fallback 1.00/float) — abs-CC automation is silent (fix regressed)"
else
    pass "cache repopulated after reselect — automation stays audible without a restart"
fi

echo
[ "$FAILURES" -eq 0 ] && { echo -e "${GRN}reselect e2e PASSED${RST}"; exit 0; } || { echo -e "${RED}reselect e2e FAILED ($FAILURES)${RST}"; exit 1; }
