/* The step-button row: presses, the shifted functions, and note entry.
 *
 * Split out of router.ts, which is the dispatcher; this is the step half of
 * what it dispatches to. */

import { mlog } from '../log.js';
import { appState, VIEW_MAIN_PARAMS, VIEW_CLIP_PARAMS } from '../app/state.js';
import { beginEdit, endEdit, CLOSE } from '../undo/group.js';
import { beginGesture } from '../undo/edit.js';
import { trackLabel } from '../undo/label.js';
import {
    NUM_STEP_BUTTONS, MAIN_PAGE_STEPS, STEP_CLIP_PARAMS, STEP_METRO,
    STEP_FULL_VEL, STEP_DOUBLE_LOOP, STEP_QUANTIZE,
} from './constants.js';
import { openMainPage } from './main-page.js';
import { openClipPage } from './clip-page.js';
import { deleteActive, deleteStep } from './edit-ops.js';
import { dupActive, onUnit as dupOnUnit } from './duplicate.js';
import { seqCmd } from './engine.js';
import { doubleLoop, loopStepOff, loopStepOn } from './loop-mode.js';
import { seqToast } from './render.js';
import { momentaryGesture } from './momentary.js';
import { sessionStepPress } from './track-select.js';
import { maxBarOffset, minBarOffset, occHasStep, occToggleStep, seqState } from './state.js';
import { heldSetList, setHeldSet } from './held.js';
import {
    anyStepHeld, editStepDown, editStepUp, heldStepAbs, setLengthTo,
    endStepAutomation,
} from './step-edit.js';
import { stepRecActive, stepRecStepTap } from './step-rec.js';
import { heldChordPitches } from './router-pads.js';
import { nextQuantCandidate } from './quant.js';
import { armQuantOverlay } from './quant-overlay.js';

/* A press registers a held range (for hold-step editing) and, in the relevant
 * mode, also drives note toggle / bar select. The note toggle fires on RELEASE
 * so a held step + gesture can edit instead of toggling (native behavior).
 * Shift+step are the shifted functions. */
export function handleStepButton(button: number, on: boolean, shiftHeld: boolean): void {
    /* Step recording owns the row while it is active: a press moves the head,
     * and nothing registers as a held range — so hold-step editing and step
     * recording can never both be claiming the pads. */
    if (stepRecActive()) {
        if (on) stepRecStepTap(button);
        return;
    }
    /* Session view: the step row is the 16-track selector, not steps. Above the
     * edit gestures below, because none of them mean anything when the row is
     * addressing tracks. Shift is not consulted — the shifted step functions
     * stay available in Track view, where the row is actually steps. */
    if (seqState.sessionMode) {
        if (on) {
            /* Marks an in-flight Note/Session HOLD as used, so its release
             * reverts to the previous view instead of latching into Session —
             * "hold Session, tap a track, carry on where you were". A no-op when
             * Session is latched rather than held, which is why the same line
             * serves both forms. */
            momentaryGesture();
            sessionStepPress(button);
        }
        return;
    }
    if (on && dupActive()) {
        const absB = seqState.barOffset * NUM_STEP_BUTTONS + button;
        dupOnUnit(seqState.loopMode
            ? { kind: 'bar', track: seqState.watchTrack, bar: button }
            : { kind: 'step', track: seqState.watchTrack, step: absB });
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
                seqCmd('hold ' + seqState.watchTrack + ' ' + seqState.holdStep);
            }
        }
    } else {
        const wasTap = editStepUp(button);
        if (!anyStepHeld()) {
            if (seqState.holdNotes.length > 0) {
                setHeldSet(seqState.watchTrack, seqState.holdNotes);
                seqState.lastPitch[seqState.watchTrack] = seqState.holdNotes[0];
            }
            seqState.holdNotes = [];
            seqState.holdStep = -1;
            seqState.holdLen = 0;
            seqCmd('hold ' + seqState.watchTrack + ' -1');
            endStepAutomation();
        }
        if (seqState.loopMode) loopStepOff(button);
        else if (wasTap) toggleStep(button);
    }
}

/* Shift + step button = Move's shifted step functions. Step 10 toggles Full
 * Velocity; further entries (Double Loop = Step 15, Quantize = Step 16) land
 * in later steps. Steps 5/7/9 (0-indexed 4/6/8) open the Main Params page. */
function shiftStepFunction(step: number): void {
    if (step in MAIN_PAGE_STEPS) {
        if (appState.currentView !== VIEW_MAIN_PARAMS) {
            openMainPage(appState.currentView);
            appState.currentView = VIEW_MAIN_PARAMS;
        }
        appState.dirty = true;
        return;
    }
    // Clip Params edits the active/playing clip, so it only opens in Track view
    // (Session view shows the clip grid, not a single clip's params).
    if (step === STEP_CLIP_PARAMS) {
        if (!seqState.sessionMode && appState.currentView !== VIEW_CLIP_PARAMS) {
            openClipPage(appState.currentView, appState.activeTrack.index);
            appState.currentView = VIEW_CLIP_PARAMS;
        }
        appState.dirty = true;
        return;
    }
    if (step === STEP_FULL_VEL) {
        seqState.fullVelocity = !seqState.fullVelocity;
        seqToast(seqState.fullVelocity ? 'Full Velocity On' : 'Full Velocity Off');
    } else if (step === STEP_DOUBLE_LOOP) {
        doubleLoop();
    } else if (step === STEP_METRO) {
        seqCmd('metro ' + (seqState.metro ? 0 : 1));
        seqToast(seqState.metro ? 'Metronome Off' : 'Metronome On');
    } else if (step === STEP_QUANTIZE) {
        cycleQuantize();
    }
}

/* Shift+Step 16: advance the watched clip's quantization to the next candidate
 * (0 / set default / 100) and show the panel. One gesture key for the whole
 * audition, so pressing through 0 -> 70 -> 100 is a single undo back to where
 * you started rather than three; the panel is the feedback, so no toast. */
function cycleQuantize(): void {
    const track = seqState.watchTrack;
    const next = nextQuantCandidate(seqState.clipQuant, seqState.defaultQuant);
    beginGesture('quant:' + track, 'CLIP QUANT', trackLabel(track));
    seqState.clipQuant = next;
    seqCmd('cq ' + track + ' ' + next);
    armQuantOverlay(Date.now());
}

export function navigateBar(delta: number): void {
    const next = Math.max(minBarOffset(), Math.min(seqState.barOffset + delta, maxBarOffset()));
    seqState.barOffset = next;
}

function toggleStep(button: number): void {
    const step = seqState.barOffset * NUM_STEP_BUTTONS + button;
    const t = seqState.watchTrack;
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
