#!/usr/bin/env bash
# test-seq.sh — device e2e for the sequencer: deploy, open movy, drive the
# surface via MIDI inject (pad, step button, Play), and assert engine
# behavior from the debug log (auto-start on first step, transport stop).
set -euo pipefail
HOST="${1:-move.local}"
MOVY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INJECT="$MOVY_DIR/../schwung-midi-inject-ui.py"

RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'; BLD='\033[1m'; RST='\033[0m'
pass() { echo -e "${GRN}✓${RST} $1"; }
fail() { echo -e "${RED}✗${RST} $1"; FAILURES=$((FAILURES+1)); }
info() { echo -e "${YLW}→${RST} $1"; }
FAILURES=0

info "Deploying (ui.js + dsp.so)..."
"$MOVY_DIR/scripts/deploy.sh" "$HOST" >/dev/null
pass "Deployed"

ssh "ableton@$HOST" 'touch /data/UserData/schwung/debug_log_on; > /data/UserData/schwung/debug.log'

info "Opening Movy..."
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
sleep 2

info "Playing a pad (note 80 → sets step-entry pitch)..."
python3 "$INJECT" "$HOST" note_on 80 100
sleep 0.2
python3 "$INJECT" "$HOST" note_off 80
sleep 0.3

info "Pressing step 1 (note 16) — should place a note and auto-start..."
python3 "$INJECT" "$HOST" note_on 16 127
sleep 0.1
python3 "$INJECT" "$HOST" note_off 16
sleep 2

info "Chord: hold two pads + press step 5 (note 20)..."
python3 "$INJECT" "$HOST" note_on 82 100
python3 "$INJECT" "$HOST" note_on 84 100
sleep 0.1
python3 "$INJECT" "$HOST" note_on 20 127
sleep 0.1
python3 "$INJECT" "$HOST" note_off 20
python3 "$INJECT" "$HOST" note_off 82
python3 "$INJECT" "$HOST" note_off 84
sleep 0.3

info "Bar navigation: Right then Left arrow (CC 63 / 62)..."
python3 "$INJECT" "$HOST" cc 63 127
sleep 0.1
python3 "$INJECT" "$HOST" cc 63 0
sleep 0.3
python3 "$INJECT" "$HOST" cc 62 127
sleep 0.1
python3 "$INJECT" "$HOST" cc 62 0
sleep 0.5

info "Loop Mode: tap Loop (CC 58), set 1-bar loop, double it (Shift+Step15)..."
python3 "$INJECT" "$HOST" cc 58 127     # Loop tap → enter Loop Mode
python3 "$INJECT" "$HOST" cc 58 0
sleep 0.2
python3 "$INJECT" "$HOST" note_on 16 127  # bar 1
python3 "$INJECT" "$HOST" note_off 16
sleep 0.1
python3 "$INJECT" "$HOST" note_on 16 127  # double-tap → 1-bar loop
python3 "$INJECT" "$HOST" note_off 16
sleep 0.2
python3 "$INJECT" "$HOST" cc 58 127     # exit Loop Mode
python3 "$INJECT" "$HOST" cc 58 0
sleep 0.2
python3 "$INJECT" "$HOST" cc 49 127     # Shift down
python3 "$INJECT" "$HOST" note_on 30 127  # Step 15 = note 30 → Double Loop
python3 "$INJECT" "$HOST" note_off 30
python3 "$INJECT" "$HOST" cc 49 0       # Shift up
sleep 0.5

# Snapshot the log BEFORE the Play press: step entry must NOT have auto-started
# the transport (any seq: play=1 here would be a regression of that behavior).
PRE_PLAY_LOG=$(ssh "ableton@$HOST" 'grep -E "\[movy\]" /data/UserData/schwung/debug.log 2>/dev/null || true')

info "Pressing Play (CC 85) — should START the transport (step entry did not)..."
python3 "$INJECT" "$HOST" cc 85 127
sleep 0.3
python3 "$INJECT" "$HOST" cc 85 0
sleep 1

info "Recording: Rec (CC 86), count-in + metronome, play pads, stop..."
python3 "$INJECT" "$HOST" cc 49 127      # Shift
python3 "$INJECT" "$HOST" note_on 21 127 # Shift+Step6 = metronome on
python3 "$INJECT" "$HOST" note_off 21
python3 "$INJECT" "$HOST" cc 49 0        # Shift up
sleep 0.2
python3 "$INJECT" "$HOST" cc 86 127      # Rec → count-in starts
python3 "$INJECT" "$HOST" cc 86 0
sleep 2.5                                # 1-bar count-in (clicks audible) then recording
python3 "$INJECT" "$HOST" note_on 70 110 # play a pad during recording
sleep 0.3
python3 "$INJECT" "$HOST" note_off 70
sleep 1
python3 "$INJECT" "$HOST" cc 86 127      # Rec again → stop recording
python3 "$INJECT" "$HOST" cc 86 0
sleep 0.5

info "Session mode: toggle (CC 50), launch a clip pad, toggle back..."
python3 "$INJECT" "$HOST" cc 50 127      # Note/Session toggle → session
python3 "$INJECT" "$HOST" cc 50 0
sleep 0.3
python3 "$INJECT" "$HOST" note_on 92 127 # top-left clip pad = track 0 slot 0
python3 "$INJECT" "$HOST" note_off 92
sleep 0.5
python3 "$INJECT" "$HOST" note_on 68 127 # bottom-left = track 3 slot 0 (empty → stop)
python3 "$INJECT" "$HOST" note_off 68
sleep 0.5
python3 "$INJECT" "$HOST" cc 50 127      # back to Note mode
python3 "$INJECT" "$HOST" cc 50 0
sleep 0.5

info "Drum multi-step: hold step 1 + press step 5 on a drum track..."
python3 "$INJECT" "$HOST" cc 43 127      # select track 0 (CC43 = slot 0)
python3 "$INJECT" "$HOST" cc 43 0
sleep 0.3
python3 "$INJECT" "$HOST" note_on 16 127 # hold step 1
sleep 0.1
python3 "$INJECT" "$HOST" note_on 20 127 # press step 5 while step 1 held
python3 "$INJECT" "$HOST" note_off 20    # release step 5 → enters
python3 "$INJECT" "$HOST" note_off 16    # release step 1 → enters
sleep 0.5

info "Persistence: waiting for autosave, then reopening Movy to restore..."
sleep 4   # autosave fires ~3s after the last edit
STATE_FILE="/data/UserData/schwung/modules/tools/movy/seq-state.json"
STATE_OK=$(ssh "ableton@$HOST" "test -s $STATE_FILE && echo yes || echo no")
ssh "ableton@$HOST" 'python3 -c "
import mmap, json
with open(\"/data/UserData/schwung/open_tool_cmd.json\", \"w\") as f:
    f.write(json.dumps({\"file_path\": \"/\", \"tool_id\": \"movy\"}))
with open(\"/dev/shm/schwung-control\", \"r+b\") as f:
    mm = mmap.mmap(f.fileno(), 0); mm[56] = 1; mm.close()
"'
sleep 3

LOG=$(ssh "ableton@$HOST" 'grep -E "\[movy\]|movy-dsp" /data/UserData/schwung/debug.log 2>/dev/null || true')
echo ""
echo -e "${BLD}=== Seq log ===${RST}"
echo "$LOG" | grep -E "seq:|movy-dsp" || echo "(no seq lines)"
echo ""

echo "$LOG" | grep -q "movy-dsp.*create_instance" \
    && pass "Engine loaded" || fail "Engine missing"
echo "$PRE_PLAY_LOG" | grep -q "seq: play=1" \
    && fail "Step entry auto-started transport (it must not)" \
    || pass "Step entry did not auto-start the transport"
echo "$LOG" | grep -q "seq: play=1" \
    && pass "Play button started the transport" || fail "Play did not start (seq: play=1 missing)"

[[ "$STATE_OK" == "yes" ]] \
    && pass "Autosave wrote a non-empty state file" || fail "No autosave file at $STATE_FILE"
echo "$LOG" | grep -q "seq: restored state" \
    && pass "State restored on reopen" || fail "No restore on reopen (seq: restored state missing)"

# Drum multi-step: each step entered on a drum lane logs "seq: step <n> lane <l>".
# Holding step 1 + pressing step 5 must enter BOTH (>= 2 lines). Only meaningful
# if track 0's synth is a drum; the local app-loop test is the authoritative proof.
STEP_LINES=$(echo "$LOG" | grep -c "seq: step" || true)
[[ "$STEP_LINES" -ge 2 ]] \
    && pass "Drum multi-step entered $STEP_LINES steps while one was held" \
    || fail "Multi-step not observed (expected >=2 'seq: step' lines, got $STEP_LINES)"

echo ""
if [[ $FAILURES -eq 0 ]]; then
    echo -e "${GRN}${BLD}SEQ DEVICE TEST PASSED${RST} — the placed note should have been looping audibly"
else
    echo -e "${RED}${BLD}$FAILURES CHECK(S) FAILED${RST}"
fi
