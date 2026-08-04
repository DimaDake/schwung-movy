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

# Run against the fixture state rather than whatever the device happens to hold,
# so this passes standalone and in any order relative to the other suites.
# shellcheck source=lib/test-set.sh
source "$MOVY_DIR/scripts/lib/test-set.sh"
test_set_begin || { echo "could not establish the fixture state"; exit 1; }
# Hand the LEDs back when this run ends, however it ends: the suites leave movy
# open in overtake owning the surface, so without this the hardware stays dark.
trap test_set_end EXIT INT TERM
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

# The fixture seeds an automation lane on track 0 (`au 0 0 50 synth:decay`), so
# this no longer skips when the set happens to have none — an absent lane now
# means the fixture did not load, which is a real failure.
LANES=$(mlog | grep 'auto lanes t=0' | tail -1)
if ! echo "$LANES" | grep -qE 'auto lanes t=0 \[[a-zA-Z]'; then
    fail "no automation lane on track 0 — the fixture's 'au' line did not load"
    exit 1
fi
pass "fixture automation lane present on track 0 (${LANES##*auto lanes t=0 })"

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

info "Swap to a DIFFERENT module, then Undo it…"
# A same-module reselect records nothing (it changes nothing), so the undo path
# needs a real swap: jog one entry down the browser list before confirming.
ssh "ableton@$HOST" "> $LOG" >/dev/null 2>&1
inj cc $CC_JOG 127; sleep 0.1; inj cc $CC_JOG 0; sleep 0.6          # open browser
inj cc 14 1; sleep 0.3                                             # jog turn → next module
inj cc $CC_JOG 127; sleep 0.1; inj cc $CC_JOG 0                     # confirm → swap
sleep 3.5
SWAPPED=$(mlog | grep 'loadHierarchy: slot=0' | tail -1)
info "after swap: ${SWAPPED##*\[movy\] }"

# A second swap, so the module being RESTORED is the one just loaded — which
# carries a preset. Undoing this one is what exercises the staged replay
# (selector/preset first, settle, then the params the preset rewrites).
inj cc $CC_JOG 127; sleep 0.1; inj cc $CC_JOG 0; sleep 0.6          # open browser
inj cc 14 1; sleep 0.3                                             # jog → next module
inj cc $CC_JOG 127; sleep 0.1; inj cc $CC_JOG 0                     # confirm → swap again
sleep 3.5
info "after second swap: $(mlog | grep 'loadHierarchy: slot=0' | tail -1 | sed 's/.*\[movy\] //')"

inj cc 56 127; sleep 0.1; inj cc 56 0                               # Undo
sleep 4

UNDO_LOG=$(mlog)
# The bug this guards: a track chain slot is SET as `synth:module` but reports
# under the alias `synth_module`. Reading the colon form returned null, the
# drift check called that "the module changed behind our back", and every module
# undo refused and wiped the stack. Only the device proves the real key
# convention — a mock can always be written to agree with the code.
if echo "$UNDO_LOG" | grep -q 'undo: cleared (module drift)'; then
    fail "module undo refused as drift — the module read key is wrong again"
elif echo "$UNDO_LOG" | grep -qE '\[movy\] undo: (LOAD MODULE|CLEAR SLOT)'; then
    # Either verb: jogging one entry down the browser list can land on NONE,
    # which is a clear rather than a load and just as undoable.
    pass "module swap undone"
else
    fail "no 'undo: LOAD MODULE|CLEAR SLOT' — the swap recorded no undo entry"
fi
# Two restore paths. schwung's own whole-module blob (`<component>:state`) is
# preferred — the DSP applies preset and params together, so there is no
# ordering to get right. The per-param replay is the fallback for modules that
# expose no state, and its preset must go first or applying it would overwrite
# everything just restored.
if echo "$UNDO_LOG" | grep -q 'undo: restored module state'; then
    pass "the module was restored from its own state blob"
    echo "$UNDO_LOG" | grep -q 'undo: captured module state' \
        && pass "and that blob was captured before the swap" \
        || fail "restored a state blob that was never captured"
elif echo "$UNDO_LOG" | grep -q 'undo: replayed'; then
    pass "the outgoing module's params were replayed (no state blob)"
    if echo "$UNDO_LOG" | grep -q 'undo: restored .* selector/preset params'; then
        echo "$UNDO_LOG" | grep -q 'after settle' \
            && pass "preset written first, params after the settle" \
            || fail "lead written but the post-settle params never followed"
    else
        info "outgoing module declared no preset — staged replay not exercised"
    fi
else
    fail "the restore never completed (timed out?)"
fi

echo
[ "$FAILURES" -eq 0 ] && { echo -e "${GRN}reselect cache-warm check PASSED${RST}"; exit 0; } || { echo -e "${RED}reselect cache-warm check FAILED ($FAILURES)${RST}"; exit 1; }
