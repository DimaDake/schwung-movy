#!/usr/bin/env bash
# test-seq.sh — device e2e for the sequencer: deploy, open movy, drive the
# surface via MIDI inject (pad, step button, Play), and assert engine
# behavior from the debug log (auto-start on first step, transport stop).
set -euo pipefail
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
# Rec goes through the one-round-trip helper: driven as two separate injects it
# is a >500 ms press, which is the step-record HOLD, not the arm tap.
ts_tap_cc 86                             # Rec → count-in starts
sleep 2.5                                # 1-bar count-in (clicks audible) then recording
python3 "$INJECT" "$HOST" note_on 70 110 # play a pad during recording
sleep 0.3
python3 "$INJECT" "$HOST" note_off 70
sleep 1
ts_tap_cc 86                             # Rec again → stop recording
sleep 0.5

info "Step record: hold Rec (CC 86) while stopped, play a note, rest, play again..."
ts_tap_cc 85                             # stop the transport — step record is stopped-only
sleep 0.8
# One round trip for the whole gesture: as separate injects the pads would be
# ~500 ms apart but Rec would still be down, so they would pile into one chord
# on one step and the head would never advance.
ts_send "0x0B:0xB0:86:127:0.15" \
        "0x09:0x90:70:110:0.10" "0x08:0x80:70:0:0.15" \
        "0x0B:0xB0:63:127:0.10" "0x0B:0xB0:63:0:0.15" \
        "0x09:0x90:71:110:0.10" "0x08:0x80:71:0:0.15" \
        "0x0B:0xB0:86:0:0"
sleep 1

info "Step record on an EMPTY clip: three notes must make a THREE-step clip..."
# The fixture leaves tracks 2 and 3 without clips, so this is the only place the
# grow-per-step path runs on device — track 0's clip is 16 steps and takes the
# wrap path instead. A 16 here means the engine's bar rounding won.
ts_tap_cc 41                             # track 2 (CC 43 = track 0 … CC 40 = track 3)
sleep 0.8
ts_send "0x0B:0xB0:86:127:0.15" \
        "0x09:0x90:70:110:0.10" "0x08:0x80:70:0:0.15" \
        "0x09:0x90:71:110:0.10" "0x08:0x80:71:0:0.15" \
        "0x09:0x90:72:110:0.10" "0x08:0x80:72:0:0.15" \
        "0x0B:0xB0:86:0:0"
sleep 1
if ts_wait_seq_state '^cl 2 0 3 '; then
    pass "Empty clip grew to exactly 3 steps (not a rounded-up bar)"
else
    fail "Empty clip did not grow per step — expected 'cl 2 0 3' in seq-state"
    ts_ssh "grep '^cl ' '$(ts_seq_path)' 2>/dev/null || true"
fi
ts_tap_cc 43                             # back to track 0 for the rest of the run
sleep 0.5

info "Hold Session + step selects a track the SEQUENCER follows, not just the screen..."
# The regression: the Session step row moved appState.activeTrack (screen, pads,
# knobs) but never seqState.watchTrack, and the engine re-pinned watchTrack from
# `trk=` on every status poll — so the step row and every step edit stayed on the
# track you came from. Only a real device shows it end to end: the mirror is
# what the engine argues with.
#
# Track 9 because nothing else in this suite writes there, and because the bug
# is specifically about tracks past the first group. Step buttons are notes
# 16..31, so step 10 (index 9) is note 25. One round trip for the whole gesture:
# separate injects are ~0.5 s apart, which movy reads as a hold, not a tap.
ts_send "0x0B:0xB0:50:127:0.20" \
        "0x09:0x90:25:127:0.10" "0x08:0x80:25:0:0.20" \
        "0x0B:0xB0:50:0:0.40" \
        "0x09:0x90:16:110:0.10" "0x08:0x80:16:0:0"
sleep 1
if ts_wait_seq_state '^cl 9 0 16 '; then
    pass "Held Session + step retargeted the sequencer — the note landed on track 9"
else
    fail "Step edit did not follow the Session selector to track 9"
    ts_ssh "grep '^cl ' '$(ts_seq_path)' 2>/dev/null || true"
fi

# Back to track 0 via the same gesture — the track buttons address the FOCUSED
# group, which selecting track 9 moved to group 2, so CC 43 would now be track 8.
ts_send "0x0B:0xB0:50:127:0.20" \
        "0x09:0x90:16:127:0.10" "0x08:0x80:16:0:0.20" \
        "0x0B:0xB0:50:0:0"
sleep 0.8

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
# Track 1 is the fixture's drum module (CC 43 = slot 0 … CC 40 = slot 3), so
# watchLane >= 0 and each entered step logs its lane. Track 0 is melodic.
# Both gestures go through the shared one-round-trip helpers: driven as separate
# injects, the track press lasts long enough to read as a momentary hold (which
# reverts to the previous track on release) and the step presses pass
# STEP_AUTO_MS, becoming automation holds that enter no note at all.
ts_tap_cc 42                             # select track 1 (drum)
sleep 0.5
ts_tap_two_steps 16 20                   # hold step 1, tap step 5 → both enter
sleep 0.5

info "Capture: play a phrase with the transport stopped, then press Capture..."
python3 "$INJECT" "$HOST" cc 85 127      # make sure the transport is stopped —
python3 "$INJECT" "$HOST" cc 85 0        # capture-while-stopped is the path that
sleep 0.8                                # detects a tempo and opens the overlay

# Track 3 is the one track nothing else in this suite writes to (the grow-per-step
# leg above fills track 2), so it is the only place the free-tempo path runs: with
# an empty clip movy owns the tempo, so the take sets it and the overlay offers
# the candidates. One round trip for the whole phrase — separate injects are
# ~0.5 s apart, a plausible rhythm but a ragged one, and the spacing is exactly
# what the estimator reads.
ts_tap_cc 40                             # track 3 (no clip in the fixture)
sleep 0.5
# One pad, ten times, evenly spaced. Ten because the surface drops some of a
# fast injected stream — the estimator needs three onsets and a take that only
# just clears that bar would be a coin flip every run.  One pad because a melodic layout leaves gaps where
# a pad plays nothing, and a take made of pads that never sounded has no onsets
# to read a tempo from. Pad 70 is the one the recording leg above already proves.
ts_send "0x09:0x90:70:110:0.06" "0x08:0x80:70:0:0.19" \
        "0x09:0x90:70:110:0.06" "0x08:0x80:70:0:0.19" \
        "0x09:0x90:70:110:0.06" "0x08:0x80:70:0:0.19" \
        "0x09:0x90:70:110:0.06" "0x08:0x80:70:0:0.19" \
        "0x09:0x90:70:110:0.06" "0x08:0x80:70:0:0.19" \
        "0x09:0x90:70:110:0.06" "0x08:0x80:70:0:0.19" \
        "0x09:0x90:70:110:0.06" "0x08:0x80:70:0:0.19" \
        "0x09:0x90:70:110:0.06" "0x08:0x80:70:0:0.19" \
        "0x09:0x90:70:110:0.06" "0x08:0x80:70:0:0.19" \
        "0x09:0x90:70:110:0.06" "0x08:0x80:70:0:0.19"
sleep 0.5
ts_tap_cc 52                             # Capture → commit, set the tempo, roll
sleep 1.5
ts_tap_cc 49                             # any press dismisses the overlay (Shift)
sleep 0.5
python3 "$INJECT" "$HOST" cc 85 127      # stop again for the second capture
python3 "$INJECT" "$HOST" cc 85 0
sleep 0.8

# Track 0's clip already has notes, so the tempo is not up for grabs: the take is
# fitted to it and the overlay explains rather than offers.
ts_tap_cc 43                             # back to track 0 (melodic, has notes)
sleep 0.5
ts_send "0x09:0x90:70:110:0.05" "0x08:0x80:70:0:0.25" \
        "0x09:0x90:70:110:0.05" "0x08:0x80:70:0:0.25" \
        "0x09:0x90:70:110:0.05" "0x08:0x80:70:0:0.25" \
        "0x09:0x90:70:110:0.05" "0x08:0x80:70:0:0.25"
sleep 0.5
ts_tap_cc 52                             # Capture → fit to the set tempo
sleep 1.5
ts_tap_cc 49                             # dismiss
sleep 0.5

info "Persistence: waiting for autosave, then reopening Movy to restore..."
sleep 4   # autosave fires ~3s after the last edit
# State is now per-set under sets/<uuid>/seq-state.json (keyed by active_set.txt).
SETS_DIR="/data/UserData/schwung/modules/tools/movy/sets"
# grep -q, not qgrep: this pipeline runs on the DEVICE, where the helper does
# not exist — and it is safe there (find's output is a handful of paths, and the
# remote shell has no pipefail).
STATE_OK=$(ssh "ableton@$HOST" "find $SETS_DIR -name seq-state.json -size +0c 2>/dev/null | grep -q . && echo yes || echo no")
ssh "ableton@$HOST" 'python3 -c "
import mmap, json
with open(\"/data/UserData/schwung/open_tool_cmd.json\", \"w\") as f:
    f.write(json.dumps({\"file_path\": \"/\", \"tool_id\": \"movy\"}))
with open(\"/dev/shm/schwung-control\", \"r+b\") as f:
    mm = mmap.mmap(f.fileno(), 0); mm[56] = 1; mm.close()
"'
sleep 3

info "Undo: enter a step, Undo (CC 56), then Shift+Undo to redo..."
ts_tap_cc 43                             # track 0
sleep 0.3
ts_tap_note 24                           # step 9 — a step the earlier phases left alone
sleep 0.5
# Undo through the helper: as two injects the press is >500 ms, and a long
# press is not what the button reads.
ts_tap_cc 56
sleep 0.8
ts_send "0x0B:0xB0:49:127:0.10" \
        "0x0B:0xB0:56:127:0.10" "0x0B:0xB0:56:0:0.10" \
        "0x0B:0xB0:49:0:0.30"            # Shift+Undo = redo
sleep 1

LOG=$(ssh "ableton@$HOST" 'grep -E "\[movy\]|movy-dsp" /data/UserData/schwung/debug.log 2>/dev/null || true')
echo ""
echo -e "${BLD}=== Seq log ===${RST}"
echo "$LOG" | grep -E "seq:|movy-dsp" || echo "(no seq lines)"
echo ""

echo "$LOG" | qgrep "movy-dsp.*create_instance" \
    && pass "Engine loaded" || fail "Engine missing"

# Undo. The button reaching movy at all is the part only the device can prove:
# CC 56 is one of the buttons schwung's overtake owns, and the local suites
# drive the router directly rather than through the shim.
echo "$LOG" | qgrep "\[movy\] undo: " \
    && pass "Undo (CC 56) reached movy and applied an entry" \
    || fail "Undo did not apply (no '[movy] undo:' line)"
echo "$LOG" | qgrep "\[movy\] redo: " \
    && pass "Shift+Undo redid the entry" \
    || fail "Shift+Undo did not redo (no '[movy] redo:' line)"
# An un-grouped edit means some gesture mutates the set without recording an
# undo entry. Local suites assert this too, but only for gestures they drive;
# a full device run exercises far more of the surface.
UNGROUPED=$(echo "$LOG" | grep -c "undo: ungrouped" || true)
[ "$UNGROUPED" -eq 0 ] \
    && pass "No un-grouped edits during the whole run" \
    || fail "$UNGROUPED edit(s) bypassed undo — see 'undo: ungrouped' in the log"
echo "$PRE_PLAY_LOG" | qgrep "seq: play=1" \
    && fail "Step entry auto-started transport (it must not)" \
    || pass "Step entry did not auto-start the transport"
echo "$LOG" | qgrep "seq: play=1" \
    && pass "Play button started the transport" || fail "Play did not start (seq: play=1 missing)"

[[ "$STATE_OK" == "yes" ]] \
    && pass "Autosave wrote a non-empty per-set state file" || fail "No autosave file under $SETS_DIR"
# Capture: the button committed, and the engine answered with an overlay — which
# only happens when a take was actually written and the transport rolled.
echo "$LOG" | qgrep "seq: capture commit" \
    && pass "Capture committed the buffered phrase" \
    || fail "Capture did not commit (seq: capture commit missing — was anything buffered?)"
echo "$LOG" | qgrep -E "seq: capture select bpm=[0-9]+" \
    && pass "Empty clip: capture detected a tempo and offered it — $(echo "$LOG" | grep -oE 'seq: capture select bpm=[0-9]+ bars=[0-9]+' | tail -1)" \
    || fail "Empty-clip capture did not open the tempo selector (no seq: capture select line)"
echo "$LOG" | qgrep -E "seq: capture fixed bpm=[0-9]+ bars=[0-9]+ why=notes" \
    && pass "Clip with notes: capture fitted the take instead of retempoing" \
    || fail "Overdub capture did not report a fixed tempo (no seq: capture fixed ... why=notes)"

echo "$LOG" | qgrep "seq: loaded set" \
    && pass "Set state loaded on reopen" || fail "No set load on reopen (seq: loaded set missing)"

# Drum multi-step: each step entered on a drum lane logs "seq: step <n> lane <l>".
# Holding step 1 + pressing step 5 must enter BOTH (>= 2 lines).
#
# This used to skip when it saw zero lines, because only the drum branch of
# toggleStep() logs and track 0 was whatever the device happened to hold. The
# fixture puts a drum module on track 1, so silence is now a genuine failure.
# browser-test/app-loop.mjs asserts both entries unconditionally and is the
# authoritative proof; this is the on-device echo.
# Step record: one "seq: steprec <step>" per step entered. Two notes with a
# Right-arrow rest between them must land on steps 0 and 2 — the rest is what
# proves the arrow moved the head rather than the notes simply stacking.
STEPREC_LINES=$(echo "$LOG" | grep -c "seq: steprec" || true)
if [[ "$STEPREC_LINES" -ge 2 ]] && echo "$LOG" | qgrep "seq: steprec 2"; then
    pass "Step record entered $STEPREC_LINES steps, the rest advanced the head"
else
    fail "Step record entered $STEPREC_LINES step(s); expected 2, with one on step 2"
fi

STEP_LINES=$(echo "$LOG" | grep -c "seq: step " || true)
if [[ "$STEP_LINES" -ge 2 ]]; then
    pass "Drum multi-step entered $STEP_LINES steps while one was held"
else
    fail "Multi-step entered $STEP_LINES step(s) on the fixture's drum track (expected 2)"
fi

# Background mode (Phase 2) cannot be auto-driven here: the suspend gesture is
# Back (a CC), and CC injection does not reach the overtake UI (only notes do —
# the pre-existing schwung-midi-inject-ui.py limitation). It also needs a host
# that supports self-managed suspend. Verify manually on such a host:
info "MANUAL: background mode — with a self-managed-suspend host:"
info "  MANUAL:  1. Play the sequencer, enable a synced slot LFO (slow division)."
info "  MANUAL:  2. Back at root → Leave Movy menu; jog-click Background →"
info "  MANUAL:     Move's UI returns; sequence keeps playing, synced LFO locked."
info "  MANUAL:  3. Reopen Movy (Tools) → LEDs/screen repaint; debug.log shows"
info "  MANUAL:     '[movy] resume from background'; no stuck notes."
info "  MANUAL:  4. Shift+Back → Movy fully exits."

echo ""
if [[ $FAILURES -eq 0 ]]; then
    echo -e "${GRN}${BLD}SEQ DEVICE TEST PASSED${RST} — the placed note should have been looping audibly"
else
    echo -e "${RED}${BLD}$FAILURES CHECK(S) FAILED${RST}"
    exit 1
fi
