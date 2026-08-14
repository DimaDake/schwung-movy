#!/usr/bin/env bash
# Device e2e: closing Movy while the sequencer plays must release every
# sounding note. Drives the real Leave-Movy flow (Back → jog to "Close Movy" →
# jog click), which is the path that reaches schwung's invokeModuleOnUnload and
# therefore our globalThis.onUnload.
#
# Asserts on the '[movy] unload: released N sequencer note(s)' log line: the
# hook fired, and it accounted for the gates that were open at teardown.
set -u

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

GRN='\033[0;32m'; RED='\033[0;31m'; BLD='\033[1m'; RST='\033[0m'
fails=0
pass() { echo -e "${GRN}✓${RST} $1"; }
fail() { echo -e "${RED}✗${RST} $1"; fails=$((fails+1)); }

CC_BACK=51; CC_JOG_TURN=14; CC_JOG_CLICK=3; CC_PLAY=85; CC_DELETE=119

echo -e "${BLD}=== Deploying ===${RST}"
"$MOVY_DIR/scripts/deploy.sh" "$HOST" >/dev/null 2>&1 || { echo "deploy failed"; exit 1; }

ssh "ableton@$HOST" 'touch /data/UserData/schwung/debug_log_on; > /data/UserData/schwung/debug.log'

echo -e "${BLD}=== Opening Movy ===${RST}"
ssh "ableton@$HOST" 'python3 -c "
import mmap, json
open(\"/data/UserData/schwung/open_tool_cmd.json\",\"w\").write(json.dumps({\"file_path\":\"/\",\"tool_id\":\"movy\"}))
f=open(\"/dev/shm/schwung-control\",\"r+b\"); mm=mmap.mmap(f.fileno(),0); mm[56]=1; mm.close()
"' 2>/dev/null
sleep 3

echo -e "${BLD}=== Placing a note and starting playback ===${RST}"
python3 "$INJECT" "$HOST" note_on 80 100    # pad → sets the step-entry pitch
sleep 0.2
python3 "$INJECT" "$HOST" note_off 80
sleep 0.2
# Delete the active clip first (Clear with no step held). A step press TOGGLES,
# so filling a clip that already holds notes — from an earlier suite, or from a
# previous run of this very script — clears those steps instead, and a clip left
# long and sparse leaves the playhead outside the filled bar for most of the
# loop. Starting from no clip makes all 16 presses additive and the new clip
# exactly one bar, so the gate coverage below is a property of the test rather
# than of whatever the device happened to be holding.
python3 "$INJECT" "$HOST" cc $CC_DELETE 127
sleep 0.15
python3 "$INJECT" "$HOST" cc $CC_DELETE 0
sleep 0.5

# Fill every step: one note on one step is silent for most of the loop, so a
# teardown sampled at a random moment would find no open gate and prove nothing.
for s in $(seq 16 31); do
    ts_tap_note "$s"        # one round trip: a slow tap becomes an automation hold
    sleep 0.1
done
sleep 0.3
python3 "$INJECT" "$HOST" cc $CC_PLAY 127   # Play
sleep 0.2
python3 "$INJECT" "$HOST" cc $CC_PLAY 0
sleep 3                                     # let the clip loop so gates open

if ssh "ableton@$HOST" 'grep -q "\[movy\] seq: play=1" /data/UserData/schwung/debug.log'; then
    pass "transport started (gates can be open at teardown)"
else
    fail "transport never started — teardown would have nothing to release"
fi

echo -e "${BLD}=== Closing Movy (Back → Close Movy → confirm) ===${RST}"
python3 "$INJECT" "$HOST" cc $CC_BACK 127   # Back at root → Leave modal
sleep 0.2
python3 "$INJECT" "$HOST" cc $CC_BACK 0
sleep 0.5
python3 "$INJECT" "$HOST" cc $CC_JOG_TURN 1 # jog CW → highlight "Close Movy"
sleep 0.5
python3 "$INJECT" "$HOST" cc $CC_JOG_CLICK 127   # confirm
sleep 0.2
python3 "$INJECT" "$HOST" cc $CC_JOG_CLICK 0
sleep 2

echo -e "\n${BLD}=== Unload log ===${RST}"
LOG=$(ssh "ableton@$HOST" 'grep -E "\[movy\] unload|invokeModuleOnUnload" /data/UserData/schwung/debug.log || true')
echo "$LOG"

echo -e "\n${BLD}=== Results ===${RST}"
if echo "$LOG" | qgrep "\[movy\] unload: released"; then
    pass "onUnload fired on Close Movy"
    N=$(echo "$LOG" | grep -o "released [0-9]*" | tail -1 | cut -d' ' -f2)
    if [ "${N:-0}" -gt 0 ]; then
        pass "released $N sequencer note(s) — activeNotes mirror is live at teardown"
    else
        fail "released 0 notes: either no gate was open, or seqState.activeNotes is not populated"
    fi
else
    fail "onUnload never ran — hanging notes on close are NOT fixed"
fi

if [ "$fails" -eq 0 ]; then
    echo -e "\n${GRN}${BLD}UNLOAD DEVICE TEST PASSED${RST}"
else
    echo -e "\n${RED}${BLD}$fails CHECK(S) FAILED${RST}"; exit 1
fi
