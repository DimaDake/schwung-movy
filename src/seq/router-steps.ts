/* The step-button row: what a press MEANS in each mode, and note entry.
 *
 * Split out of router.ts, which is the dispatcher; this is the step half of
 * what it dispatches to. The shifted functions the row can reach live next
 * door in step-shortcuts.ts — two of the branches below hand off to them. */

import { mlog } from '../log.js';
import { appState } from '../app/state.js';
import { beginEdit, endEdit, CLOSE } from '../undo/group.js';
import { trackLabel } from '../undo/label.js';
import { NUM_STEP_BUTTONS } from './constants.js';
import { deleteActive, deleteStep } from './edit-ops.js';
import { dupActive, onUnit as dupOnUnit } from './duplicate.js';
import { seqCmd } from './engine.js';
import { loopStepOff, loopStepOn } from './loop-mode.js';
import { shiftStepFunction } from './step-shortcuts.js';
import { muteHeld, muteMarkGestured, muteShiftHeld } from './router-buttons.js';
import { toggleMute, toggleSolo } from '../mixer/track-mutes.js';
import { TRACK_COUNT } from '../track/ref.js';
import { sessionButtonHeld, sessionStepPress, sessionStepRelease, trackSelectActive } from './track-select.js';
import { songSceneStep, songSceneReleasePending, songSceneRowActive } from './song.js';
import {
    maxBarOffset, minBarOffset, occHasStep, occToggleStep, seqState,
} from './state.js';
import { heldSetList, setHeldSet } from './held.js';
import {
    anyStepHeld, editStepDown, editStepUp, heldStepAbs, setLengthTo,
    endStepAutomation,
} from './step-edit.js';
import { momentaryGesture } from './momentary.js';
import { stepRecActive, stepRecStepTap } from './step-rec.js';
import { heldChordPitches } from './router-pads.js';
import { watchedTrack } from './watch.js';

/* Steps whose PRESS the mute map consumed. Their release is consumed too, or
 * the step path sees a release with no press: a bit-per-step rather than "Mute
 * is still down", because a step already held when Mute arrives is NOT a map
 * press — its release still belongs to the note it was entering. */
let muteMapPresses = 0;

/* The step row as a 16-track mute map, held under Mute. It is the only surface
 * that reaches every track without scrolling the group, and holding Mute puts
 * it in front of whatever the row was showing — steps, Loop bars, the
 * step-record head — so muting track 12 never costs you the view you play in.
 *
 * Returns true when the event belonged to the map. */
function muteMapStep(button: number, on: boolean): boolean {
    const bit = 1 << button;
    if (!on) {
        if (!(muteMapPresses & bit)) return false;
        muteMapPresses &= ~bit;
        return true;
    }
    if (!muteHeld() || button >= TRACK_COUNT) return false;
    muteMapPresses |= bit;
    if (muteShiftHeld() || appState.shiftHeld) toggleSolo(button);
    else toggleMute(button);
    /* Suppresses the current-track toggle on Mute's release: the gesture the
     * user made is this one. */
    muteMarkGestured();
    /* Muting from inside a held-Session peek USED the peek, so its release
     * reverts to the view you came from. Marking the gesture rather than
     * leaning on the 500 ms rule: the intent is in what the press did, not in
     * how long it lasted, and a quick hold would otherwise latch Session view
     * behind the mute. Guarded on the button actually being down so a latched
     * Session view never marks some unrelated momentary. */
    if (sessionButtonHeld()) momentaryGesture();
    appState.dirty = true;
    return true;
}

/** Forget consumed presses whose release can no longer arrive (input reset). */
export function resetMuteMap(): void { muteMapPresses = 0; }

/* A press registers a held range (for hold-step editing) and, in the relevant
 * mode, also drives note toggle / bar select. The note toggle fires on RELEASE
 * so a held step + gesture can edit instead of toggling (native behavior).
 * Shift+step are the shifted functions. */
export function handleStepButton(button: number, on: boolean, shiftHeld: boolean): void {
    /* Release of the step that opened a latched-Session track peek. By now the
     * switch has already put us in Track view, so the row is real steps again
     * and letting this through would toggle a note under the finger that was
     * only ever selecting a track. Above everything, including step recording:
     * it closes a gesture that is already in flight. */
    if (!on && sessionStepRelease(button)) return;
    /* Mute held: the row is the MUTE MAP, wherever you are. Above step
     * recording, the track selector and every edit gesture, because the map is
     * the row's meaning for as long as the button is down — one rule, in Track
     * view and Session view alike. */
    if (muteMapStep(button, on)) return;
    /* Step recording owns the row while it is active: a press moves the head,
     * and nothing registers as a held range — so hold-step editing and step
     * recording can never both be claiming the pads. */
    if (stepRecActive()) {
        if (on) stepRecStepTap(button);
        return;
    }
    /* The step row is the 16-track selector, not steps — in Session view, and
     * also while the Session button is held after a selection has already
     * dropped us back onto a track (trackSelectHold). Above the edit gestures
     * below, because none of them mean anything when the row is addressing
     * tracks. */
    /* Loop held in Session view turns the row into the scene launcher: the
     * eight clip columns on the step buttons printed 1,3,5…15. Above the track
     * selector, which keeps the row on unmodified presses — Loop is what
     * changes what the row means. The release of a press this row consumed
     * belongs to it too, even if Loop came up in between. */
    if (songSceneRowActive() || (!on && songSceneReleasePending(button))) {
        songSceneStep(button, on);
        return;
    }
    if (trackSelectActive()) {
        /* Shift keeps the SHIFTED STEP FUNCTIONS in Session view. They are
         * global — the CPU meter, Settings, the metronome — and Session view is
         * where you are most likely to reach for them; the row's own meaning
         * (the track selector) is the unmodified press. Latched Session view
         * only: while the Session button is still HELD the row is a transient
         * selector inside Track view, and a press there is finishing that
         * gesture. */
        if (on && shiftHeld && seqState.sessionMode) {
            shiftStepFunction(button);
            return;
        }
        if (on) sessionStepPress(button);
        return;
    }
    if (on && dupActive()) {
        const absB = seqState.barOffset * NUM_STEP_BUTTONS + button;
        dupOnUnit(seqState.loopMode
            ? { kind: 'bar', track: watchedTrack(), bar: button }
            : { kind: 'step', track: watchedTrack(), step: absB });
    } else if (on && deleteActive()) {
        deleteStep(button);
    } else if (on && shiftHeld) {
        shiftStepFunction(button);
    } else if (on) {
        const absB = seqState.barOffset * NUM_STEP_BUTTONS + button;
        // The hold-A + press-B length gesture is melodic-only and fires only
        // when the anchor A already has a note. An empty anchor (or a drum
        // lane) instead registers B as an independent held step, so two empty
        // steps held together enter notes on both. B is never registered when
        // the anchor is occupied, so it does not toggle and multi-entry can't
        // collide with length-setting.
        const anchor = (!seqState.loopMode && seqState.watchLane < 0)
            ? heldStepAbs() : -1;
        if (anchor >= 0 && absB !== anchor && occHasStep(anchor)) {
            setLengthTo(absB); // B<=anchor → consumed no-op; either way don't enter B
        } else {
            editStepDown(button);
            if (seqState.loopMode) loopStepOn(button);
            if (!seqState.loopMode && seqState.watchLane < 0 && heldStepAbs() >= 0) {
                seqState.holdStep = heldStepAbs();
                seqState.holdNotes = [];
                seqCmd('hold ' + watchedTrack() + ' ' + seqState.holdStep);
            }
        }
    } else {
        const wasTap = editStepUp(button);
        if (!anyStepHeld()) {
            if (seqState.holdNotes.length > 0) {
                setHeldSet(watchedTrack(), seqState.holdNotes);
                seqState.lastPitch[watchedTrack()] = seqState.holdNotes[0];
            }
            seqState.holdNotes = [];
            seqState.holdStep = -1;
            seqState.holdLen = 0;
            seqCmd('hold ' + watchedTrack() + ' -1');
            endStepAutomation();
        }
        if (seqState.loopMode) loopStepOff(button);
        else if (wasTap) toggleStep(button);
    }
}

export function navigateBar(delta: number): void {
    const next = Math.max(minBarOffset(), Math.min(seqState.barOffset + delta, maxBarOffset()));
    seqState.barOffset = next;
}

function toggleStep(button: number): void {
    const step = seqState.barOffset * NUM_STEP_BUTTONS + button;
    const t = watchedTrack();
    // A sub-bar clip length (LENGTH knob) hides the steps in the rest of that
    // bar; pressing one is inert (no entry). The next empty bar stays tappable
    // so the native "tap into the next bar to grow the clip" still works, and a
    // pre-existing note past the length can still be cleared.
    // Measured from the loop END (absolute): a loop starting mid-clip has its own
    // last bar, and lenSteps alone would put the boundary in the wrong place.
    const loopEnd = seqState.loopStart + seqState.lenSteps;
    const barEnd = Math.ceil(loopEnd / NUM_STEP_BUTTONS) * NUM_STEP_BUTTONS;
    if (seqState.lenSteps > 0 && step >= loopEnd && step < barEnd && !occHasStep(step)) return;
    const wasSet = occHasStep(step);

    beginEdit({
        key: 'step:' + t + ':' + step,
        verb: wasSet ? 'CLEAR STEP' : 'ADD STEP',
        target: trackLabel(t) + ' STEP ' + (step + 1),
        close: CLOSE.IMMEDIATE, seq: true,
    });
    if (seqState.watchLane >= 0) {
        /* Drum lane: toggle just the selected lane's pitch at this step. */
        seqCmd(`ltog ${t} ${step} ${seqState.watchLane} ${seqState.lastVel[t]}`);
        // Interaction-rate only (one per step press) — never a per-tick path;
        // lets the device test count multi-step entries from the log.
        mlog(`seq: step ${step} lane ${seqState.watchLane}`);
    } else {
        /* Melodic: place the currently-held chord, else the full selected
         * (white) note set, else the last-played note; an occupied step clears. */
        const chord = heldChordPitches();
        const selected = heldSetList(t);
        const pitches = chord.length > 0
            ? chord
            : (selected.length > 0 ? selected : [seqState.lastPitch[t]]);
        const v = seqState.lastVel[t];
        seqCmd(`tog ${t} ${step} ${pitches.map((p) => `${p} ${v}`).join(' ')}`);
    }
    endEdit();

    /* Optimistic mirror so the step LED flips this tick. Adding the first
     * note auto-starts the transport and implicitly creates a 1-bar clip. */
    if (!wasSet) {
        if (seqState.lenSteps === 0) seqState.lenSteps = NUM_STEP_BUTTONS;
        if (step >= seqState.lenSteps) {
            seqState.lenSteps = (Math.floor(step / NUM_STEP_BUTTONS) + 1) * NUM_STEP_BUTTONS;
        }
    }
    occToggleStep(step);
}
