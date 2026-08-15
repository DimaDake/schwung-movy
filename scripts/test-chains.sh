#!/usr/bin/env bash
# test-chains.sh — movy hosts its own schwung chains (Stage 3 foundation).
#
# The first device exercise of chain hosting. It checks SAFETY before features,
# because the failure mode here is not "a test fails" — it is MoveOriginal dying
# and taking the device's audio with it:
#
#   1. movy still sequences its four schwung tracks (chain hosting must degrade,
#      never break what already worked)
#   2. the chain host loaded, or said clearly why not
#   3. the tick rate did not collapse
#   4. MoveOriginal is still alive
#
# Loading a module INTO a movy chain is not exercised here: nothing in the UI
# can address `ch<N>:` yet (that is Stage 4). This deliberately tests the
# foundation rather than pretending to test the feature.
#
# Usage: ./scripts/test-chains.sh [move.local]
set -uo pipefail
cd "$(dirname "$0")/.."

HOST="${1:-move.local}"
MOVY_DIR="$(pwd)"
# Sourced for qgrep: `grep -q` under pipefail reports 141 on a FOUND line once
# the piped log outgrows the pipe buffer, so a passing check reads as a failure.
# The fixture helpers are not used here — this test wants a plain boot.
# shellcheck source=lib/test-set.sh
source "$MOVY_DIR/scripts/lib/test-set.sh"

LOG=/data/UserData/schwung/debug.log
INJECT_PY="$(cd .. && pwd)/schwung-midi-inject-ui.py"
PASS=0; FAIL=0
GRN=$'\033[0;32m'; RED=$'\033[0;31m'; YEL=$'\033[1;33m'; BLD=$'\033[1m'; RST=$'\033[0m'
pass() { echo "${GRN}✓${RST} $1"; PASS=$((PASS+1)); }
# Neither a pass nor a failure: something this suite cannot observe. Counted
# separately so an unverifiable step can never read as a green check.
WARN=0
warn() { echo "${YEL}!${RST} $1"; WARN=$((WARN+1)); }
fail() { echo "${RED}✗${RST} $1"; FAIL=$((FAIL+1)); }

ssh -o ConnectTimeout=5 "ableton@$HOST" true 2>/dev/null || {
    echo "DEVICE OFFLINE — SKIPPING CHAIN TEST"; exit 0
}

echo "${BLD}=== deploying ===${RST}"
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

LOGTXT=$(ssh "ableton@$HOST" "cat $LOG")

echo
echo "${BLD}=== Results ===${RST}"

# 1. The property that must never regress.
if echo "$LOGTXT" | qgrep "seq: engine ready"; then
    pass "engine still boots with chain hosting compiled in"
else
    fail "engine did not boot — chain hosting broke the sequencer"
fi

# 2. Chain host outcome. Loaded is the goal; a clear refusal is acceptable
#    (movy degrades). SILENCE is the real failure: it means the UI never sent
#    chain_host, or the DSP never handled it.
if echo "$LOGTXT" | qgrep "chain host loaded from"; then
    pass "chain host dlopened: $(echo "$LOGTXT" | grep -o 'chain host loaded from.*' | head -1)"
elif echo "$LOGTXT" | qgrep "chain hosting unavailable"; then
    fail "chain host refused: $(echo "$LOGTXT" | grep -o 'chain hosting unavailable.*' | head -1)"
elif echo "$LOGTXT" | qgrep "chain host copy failed"; then
    fail "copy failed: $(echo "$LOGTXT" | grep -o 'chain host copy failed.*' | head -1)"
else
    fail "no chain-host log line at all — chain_host param never reached the DSP"
fi

# 3. The private copy exists and is distinct from schwung's (separate inode is
#    the whole point — a shared mapping would clobber schwung's g_host).
SRC_INO=$(ssh "ableton@$HOST" 'stat -c %i /data/UserData/schwung/modules/chain/dsp.so 2>/dev/null || echo x')
CPY_INO=$(ssh "ableton@$HOST" 'stat -c %i /data/UserData/schwung/modules/tools/movy/chain-dsp.so 2>/dev/null || echo y')
if [ "$CPY_INO" != "y" ] && [ "$SRC_INO" != "$CPY_INO" ]; then
    pass "private chain-host copy exists with its own inode"
else
    fail "no distinct private copy (src=$SRC_INO copy=$CPY_INO)"
fi

# 4. Load a module INTO a movy chain and confirm it is serviced. Driven through
#    the UI's own port by selecting track 5 (the first movy track) and opening
#    the module browser is a Stage-4 gesture; here the load is issued directly
#    over the remote-UI websocket to the engine's ch0 namespace, which is the
#    same path the port uses.
echo "${BLD}=== loading a module into movy chain 0 (track 5) ===${RST}"
node scripts/engine-param.mjs set "ch0:synth:module" plaits "$HOST" >/dev/null 2>&1
sleep 3
LOGTXT=$(ssh "ableton@$HOST" "cat $LOG")

# The engine logs each serviced load. That is the only external evidence
# available: the remote-UI socket can write an engine param but has no read
# verb, so there is nothing to poll.
if echo "$LOGTXT" | qgrep "chain 0: synth = plaits"; then
    pass "movy chain 0 created and loaded plaits"
else
    fail "no 'chain 0: synth = plaits' in the log — the load never reached the queue or was never serviced"
fi

# A second load into the same slot must reuse the instance, not leak one.
node scripts/engine-param.mjs set "ch0:synth:module" wurl "$HOST" >/dev/null 2>&1
sleep 3
LOGTXT=$(ssh "ableton@$HOST" "cat $LOG")
if echo "$LOGTXT" | qgrep "chain 0: synth = wurl"; then
    pass "chain 0 swapped module without a reload of the host"
else
    fail "second load into chain 0 did not appear in the log"
fi

if echo "$LOGTXT" | qgrep "chain hosting unavailable"; then
    fail "chain hosting dropped out during the loads"
else
    pass "chain hosting stayed up across loads"
fi

# THE claim: a movy-hosted track actually makes a sound. Loading and rendering
# without crashing is not the same thing, and only this proves the second. A
# note goes straight to the chain via the engine's ch<N>:midi param, and the
# engine reports the first non-silent block it renders.
echo "${BLD}=== is it audible? ===${RST}"
node scripts/engine-param.mjs set "ch0:synth:module" plaits "$HOST" >/dev/null 2>&1
sleep 2
node scripts/engine-param.mjs set "ch0:midi" "144.60.100" "$HOST" >/dev/null 2>&1
sleep 2
LOGTXT=$(ssh "ableton@$HOST" "cat $LOG")
if echo "$LOGTXT" | qgrep "chain 0: audio active"; then
    pass "movy chain 0 produced audio: $(echo "$LOGTXT" | grep -o 'chain 0: audio active.*' | head -1)"
else
    fail "chain 0 rendered only silence — the note never reached the synth, or its output is not summed"
fi
node scripts/engine-param.mjs set "ch0:midi" "128.60.0" "$HOST" >/dev/null 2>&1

# 5. Track selection across groups. This is what looked unreliable on device:
#    per-track state existed only for tracks 1-4, so a track button in any other
#    group set currentView to undefined and the UI had nothing to render.
echo "${BLD}=== track selection across groups ===${RST}"
ssh "ableton@$HOST" "> $LOG"
ts_tap_cc 50            # Note/Session -> latch Session view
sleep 0.6
ts_tap_note 25          # step 10 -> track 10 (group 3)
sleep 0.8
ts_tap_cc 43            # first track button of the focused group
sleep 0.8
SEL=$(ssh "ableton@$HOST" "cat $LOG")
# movy logs no line for a track switch, so the selection itself is not
# observable from here. What IS observable is the failure mode this replaced:
# an undefined view reaching the UI. The selection logic itself is covered by
# "track state exists for every track" in browser-test/app-loop.mjs.
warn "track switch is not logged — selection asserted in app-loop.mjs, not here"
if echo "$SEL" | qgrep -iE "undefined|NaN|TypeError"; then
    fail "undefined/NaN reached the UI after selecting an out-of-group track"
else
    pass "no undefined/NaN in the log after cross-group selection"
fi
ts_tap_cc 50            # back to Note view
sleep 0.4

# 6. THE Stage-4 gesture: load a synth onto a movy track the way a user does —
#    select the track, then drive the module browser with the jog wheel. Every
#    earlier chain load in this file went straight to the engine's ch<N>: param,
#    which proves the engine but not the UI path.
echo "${BLD}=== loading a module onto a movy track through the browser ===${RST}"
CC_JOG=14; CC_CLICK=3
ssh "ableton@$HOST" "> $LOG"
ts_tap_cc 50            # Session view
sleep 0.6
ts_tap_note 20          # step 5 -> track 5 (first movy track, chain 0)
sleep 0.8
ts_tap_cc 50            # back to Note view, still on track 5
sleep 0.6
# Chain view: jog to the synth slot and click into the browser.
python3 "$INJECT_PY" "$HOST" cc $CC_CLICK 127 >/dev/null 2>&1; sleep 0.15
python3 "$INJECT_PY" "$HOST" cc $CC_CLICK 0 >/dev/null 2>&1; sleep 1.2
# Pick the next module and confirm.
python3 "$INJECT_PY" "$HOST" cc $CC_JOG 1 >/dev/null 2>&1; sleep 0.5
python3 "$INJECT_PY" "$HOST" cc $CC_CLICK 127 >/dev/null 2>&1; sleep 0.15
python3 "$INJECT_PY" "$HOST" cc $CC_CLICK 0 >/dev/null 2>&1; sleep 3

LOGTXT=$(ssh "ableton@$HOST" "cat $LOG")
if echo "$LOGTXT" | qgrep -E "chain 0: (synth|midi_fx1|fx1|fx2) = "; then
    pass "browser load reached a movy chain: $(echo "$LOGTXT" | grep -oE 'chain 0: [a-z_0-9]+ = .*' | tail -1)"
else
    # Do NOT call this a pass. The jog sequence below is a guess at the chain
    # view's cursor state, and movy logs nothing between the press and the
    # engine write, so there is no way to tell "the gesture missed the browser"
    # from "the browser refused the load". The load path itself IS asserted
    # against the real handler in browser-test/app-loop.mjs ("the module browser
    # loads onto a movy-hosted track"), which checks the exact ch<N>: key.
    warn "browser gesture did not produce a chain load — unverified at the gesture level"
fi

# 7. Tick rate — chain rendering runs every block.
RATE=$(echo "$LOGTXT" | grep -o 'perf_tick_rate=[0-9]*' | tail -1 | cut -d= -f2)
if [ -n "$RATE" ] && [ "$RATE" -ge 60 ]; then
    pass "tick rate ${RATE}/s >= 60"
else
    fail "tick rate ${RATE:-unknown}/s below threshold"
fi

# 8. Nothing crashed. Last, because it is the check that matters most and
#    reads best at the bottom.
if ssh "ableton@$HOST" 'pgrep -f MoveOriginal >/dev/null 2>&1'; then
    pass "MoveOriginal is alive"
else
    fail "MoveOriginal DIED — recover with the davebox restart sequence"
fi

echo
echo "Restarting the Move stack (movy owns the LEDs while open)..."
ssh "ableton@$HOST" 'systemctl --user restart move-launcher 2>/dev/null || true' >/dev/null 2>&1

if [ "$FAIL" -eq 0 ]; then
    echo "${GRN}${BLD}CHAIN DEVICE TEST PASSED${RST} ($PASS checks, $WARN unverified)"
else
    echo "${RED}${BLD}$FAIL CHECK(S) FAILED${RST}"
    exit 1
fi
