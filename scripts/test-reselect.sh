#!/usr/bin/env bash
# test-reselect.sh — device check: a module reselect re-warms the chain host's
# per-component param cache (synth_params), which abs-CC automation playback
# resolves through. When that cache is empty, recorded automation is silently
# dropped (UI fine, audio dead) until a restart; the warm repopulates it.
#
# SCOPE / honesty: this drives the REAL browser reselect (jog-click open,
# jog-click confirm → loadSelectedModule) and asserts movy logs
# `auto warm t=<trk> cache=<max> type=<type>` populated (not the empty fallback
# `1.00`/`float`) — knob_N_max is the SAME find_param_info(synth_params) lookup
# abs-CC uses, and cache-populated was device-proven necessary AND sufficient
# for audibility (fix ON → cutoff swings across locked steps; OFF → flat).
#
# It requires a PRE-EXISTING automation lane on track 0 (real sets have one):
# injected NOTES don't reach movy-in-overtake, so this script can't create a
# clip/lane itself. Full audibility A/B is verified by building a scene via
# engine commands (tog/aset) + logging synth:cutoff — see
# memory project_reselect-synthparams-cache and the fix commit. This script is
# the cheap regression gate; the logic test (browser-test/logic.mjs) guards the
# warm scheduling. Usage: [host]
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
skip(){ echo -e "${YLW}SKIP${RST} $1"; }
FAILURES=0
inj(){ python3 "$INJECT" "$HOST" "$@" >/dev/null 2>&1; }
mlog(){ ssh "ableton@$HOST" "grep '\[movy\]' $LOG 2>/dev/null || true"; }

CC_JOG=3
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
inj cc $CC_JOG 127; sleep 0.1; inj cc $CC_JOG 0; sleep 0.4          # chain → knobs

LANES=$(mlog | grep 'auto lanes t=0' | tail -1)
if ! echo "$LANES" | grep -qE 'auto lanes t=0 \[[a-zA-Z]'; then
    skip "no automation lane on track 0 — add automation to this set first (note injection can't). Nothing to gate."
    exit 0
fi
pass "pre-existing automation lane on track 0 (${LANES##*auto lanes t=0 })"

info "Reselect the SAME module via the browser (jog-click open, jog-click confirm)…"
ssh "ableton@$HOST" "> $LOG" >/dev/null 2>&1
inj cc $CC_JOG 127; sleep 0.1; inj cc $CC_JOG 0; sleep 0.6          # open module browser
inj cc $CC_JOG 127; sleep 0.1; inj cc $CC_JOG 0                     # confirm → reselect + warm
# Warm window is tick-based (~96 ticks); the reload drops the tick rate to
# ~55 Hz, so the verify log can take ~2 s of wall time.
sleep 3.5

WARM=$(mlog | grep 'auto warm t=0' | tail -1)
info "warm log: ${WARM##*\[movy\] }"
if [ -z "$WARM" ]; then
    fail "no 'auto warm' after reselect — requestLaneWarm/laneWarmTick wiring is broken"
elif echo "$WARM" | grep -qE 'cache=1\.00 type=float'; then
    fail "cache EMPTY after reselect (fallback 1.00/float) — abs-CC automation would be silent (fix regressed)"
else
    pass "cache repopulated after reselect (proven necessary+sufficient for abs-CC audibility)"
fi

echo
[ "$FAILURES" -eq 0 ] && { echo -e "${GRN}reselect cache-warm check PASSED${RST}"; exit 0; } || { echo -e "${RED}reselect cache-warm check FAILED ($FAILURES)${RST}"; exit 1; }
