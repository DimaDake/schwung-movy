/* Where the step-record head is, and everything that follows it there.
 *
 * Split out of step-rec.ts, which owns the gestures — this file owns the
 * position: the head index, the grow-vs-wrap rule at the end of the clip, and
 * the `hold` command that re-points the engine (and through it the pad LEDs,
 * the length span on the step row, the header's note names and the back-step
 * preview's pitches) at whichever step the head is on. */

import { NUM_STEP_BUTTONS } from './constants.js';
import { seqCmd } from './engine.js';
import { seqState } from './state.js';

export const TICKS_PER_STEP = 24;   // 96 PPQN / 4 (mirror of seq-core)
export const MAX_STEPS = 256;       // 16 bars — the engine's clip ceiling

let head = 0;
/* Latched when the mode is entered, never re-derived: writing the first note on
 * an empty clip makes it non-empty, and re-deriving would turn it into a
 * one-step clip that wraps immediately. */
let growMode = false;
/* No note has been written at the head since the head arrived here. The first
 * melodic write at a fresh head clears the step, later ones stack onto it. */
let fresh = true;
/* A back-step wants to play what is on the step it lands on, but the pitches
 * come from the engine's next status reply — so the request is parked here and
 * the tick consumes it when the reply arrives. */
let previewPending = false;

export function headStep(): number { return head; }
export function headIsFresh(): boolean { return fresh; }
export function headWritten(): void { fresh = false; }
export function growModeOn(): boolean { return growMode; }
export function previewWanted(): boolean { return previewPending; }
export function requestPreview(): void { previewPending = true; }
export function takePreview(): boolean {
    if (!previewPending) return false;
    previewPending = false;
    return true;
}

/* Enter the mode: park on step 1 and decide grow-vs-wrap for the whole
 * gesture. */
export function headBegin(): void {
    growMode = seqState.lenSteps === 0;
    setHead(0);
}

export function headEnd(): void {
    previewPending = false;
    seqState.holdStep = -1;
    seqState.holdNotes = [];
    seqCmd('hold ' + seqState.watchTrack + ' -1');
}

export function headReset(): void {
    head = 0;
    growMode = false;
    fresh = true;
    previewPending = false;
}

/* Move the head and re-point everything that follows it. holdNotes is cleared
 * optimistically so a status reply still describing the PREVIOUS step can never
 * be read as this step's content. */
export function setHead(step: number): void {
    previewPending = false;      // a new move supersedes any pending preview
    head = step;
    fresh = true;
    seqState.barOffset = Math.min(Math.floor(head / NUM_STEP_BUTTONS), 15);
    seqState.holdStep = head;
    seqState.holdNotes = [];
    seqCmd('hold ' + seqState.watchTrack + ' ' + head);
}

/* Grow mode only: take `step` into the clip. The engine rounds a clip up to the
 * bar end when a note lands outside the current window (Clip::extend_to_step),
 * so this must be queued AFTER the write that caused it — it trims the rounding
 * back to the per-step length the user actually played. Never shrinks. */
export function growTo(step: number): void {
    if (!growMode) return;
    const want = Math.min(step + 1, MAX_STEPS);
    if (want <= seqState.lenSteps) return;
    seqState.lenSteps = want;
    seqCmd('clen ' + seqState.watchTrack + ' ' + want);
}

/* One step forward. A new clip grows to include the step being left; an
 * existing one wraps at its end and overwrites. */
export function advanceHead(): void {
    growTo(head);
    let next = head + 1;
    if (growMode) {
        if (next >= MAX_STEPS) next = 0;
    } else if (next >= seqState.lenSteps) {
        next = seqState.loopStart;
    }
    setHead(next);
}
