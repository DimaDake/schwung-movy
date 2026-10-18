/* The held-step piano: while one step of a melodic clip is held in Note mode,
 * the bottom band (the bar strip's place, clear of the knobs) shows a keyboard
 * with that step's notes filled in.
 *
 * Holding a step IS the gesture — pads pressed under it toggle notes into the
 * step (step-edit.ts editPad), and the engine reports the step's pitches back
 * as `hnotes=` — so the piano needs no state of its own beyond the window. */

import { seqState } from './state.js';
import { heldStepAbs } from './step-edit.js';
import { displayHoldNotes } from './leds.js';
import { watchedTrack } from './watch.js';
import { fitWindow, PIANO_W, type PianoWindow } from './piano-range.js';

export interface StepPianoVM {
    win: PianoWindow;
    /** Pitches filled in, as they SOUND (clip transpose applied), like the pads. */
    sel: number[];
    /** Left edge, centring the keyboard on the screen. */
    x0: number;
}

const windows = new Map<number, PianoWindow>();   // track → last window shown
let shownTrack = -1, shownStep = -1;

export function stepPianoVM(): StepPianoVM | null {
    /* Drum lanes have no keyboard, and a Loop-mode hold is a whole bar — its
     * notes are not one step's. holdStep must match the hold too: until the
     * engine answers `hold`, holdNotes still describes nothing (it was cleared
     * at the press), never a different step. */
    const step = seqState.loopMode || seqState.sessionMode || seqState.watchLane >= 0
        ? -1 : heldStepAbs();
    if (step < 0 || seqState.holdStep !== step) {
        shownStep = -1;
        return null;
    }
    const t = watchedTrack();
    const holding = t === shownTrack && step === shownStep;
    shownTrack = t; shownStep = step;
    const sel = displayHoldNotes();
    const win = fitWindow(sel, windows.get(t) ?? null, seqState.lastPitch[t] ?? 60, holding);
    windows.set(t, win);
    return { win, sel, x0: Math.floor((PIANO_W - (win.n * win.k + 1)) / 2) };
}

/** What a repaint depends on — the band is redrawn only when this changes. */
export function stepPianoKey(vm: StepPianoVM): string {
    return vm.win.lo + ':' + vm.win.k + ':' + vm.sel.join('.');
}

export function resetStepPiano(): void {
    windows.clear();
    shownTrack = -1; shownStep = -1;
}
