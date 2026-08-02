/* Step recording (manual §5): hold Rec while the transport is stopped and play
 * the pads to fill the sequencer one step at a time — OP-Z / OP-XY / KeyStep
 * step entry, for melodic and drum tracks alike.
 *
 * Chord accumulation is KeyStep's: notes that overlap in time land on the same
 * step, and the head advances only when the LAST pad comes up. So a chord needs
 * no modifier, and a single-finger run still advances one note per step.
 *
 * This file owns the gestures; step-rec-head.ts owns where the head is. */

import { seqCmd } from './engine.js';
import {
    TICKS_PER_STEP, advanceHead, growTo, headBegin, headEnd, headIsFresh,
    headReset, headStep, growModeOn, previewWanted, requestPreview, setHead,
    headWritten,
} from './step-rec-head.js';
import { occHasStep, occToggleStep, seqState } from './state.js';

const TAP_MS = 500;          // tap-vs-hold, matching momentary.ts

/* The chord currently under the fingers. `anchor` is the step it was written
 * to, which stays fixed while a tie moves the head forward. */
interface OpenChord { pitches: number[]; anchor: number; tieSteps: number; }

let active = false;
let touched = false;         // anything at all happened during this hold
let pressMs = 0;
let chord: OpenChord | null = null;
const heldPads = new Map<number, number>();   // padNote → pitch

export function stepRecActive(): boolean { return active; }
export function stepRecHead(): number { return headStep(); }
export function stepRecGrowMode(): boolean { return growModeOn(); }
export function stepRecPreviewPending(): boolean { return previewWanted(); }

function isDrum(): boolean { return seqState.watchLane >= 0; }

/* Rec down. Returns true when step recording took the press, so the caller
 * must not also arm live recording. Stopped-transport only — Rec while playing
 * keeps its existing meaning. */
export function stepRecDownAt(nowMs: number): boolean {
    if (active || seqState.playing) return false;
    active = true;
    touched = false;
    pressMs = nowMs;
    chord = null;
    heldPads.clear();
    headBegin();
    return true;
}

export function stepRecDown(nowMs: number = Date.now()): boolean {
    return stepRecDownAt(nowMs);
}

/* Rec up. Returns true when the press was a bare quick tap, so the caller
 * should apply the old meaning (toggle the live-record arm) — nothing is lost
 * by putting step recording on the same button. */
export function stepRecUpAt(nowMs: number): boolean {
    if (!active) return false;
    const wasTap = !touched && nowMs - pressMs < TAP_MS;
    stepRecEnd();
    return wasTap;
}

export function stepRecUp(nowMs: number = Date.now()): boolean {
    return stepRecUpAt(nowMs);
}

/* Leave the mode. Separate from stepRecUp so Play can end it without the tap
 * rule ever firing. */
export function stepRecEnd(): void {
    if (!active) return;
    active = false;
    chord = null;
    heldPads.clear();
    headEnd();
}

/* A pad played while the mode is active. Returns true when consumed, so the
 * caller skips the normal chord/live-capture path. The note has already been
 * sounded by midi/router.ts — this only writes it. */
export function stepRecPad(padNote: number, pitch: number, vel: number): boolean {
    if (!active) return false;
    touched = true;
    heldPads.set(padNote, pitch);
    const t = seqState.watchTrack;
    const step = headStep();
    if (!chord) chord = { pitches: [], anchor: step, tieSteps: 0 };
    /* Melodic replaces because the head is the user's cursor: stepping back and
     * replaying has to overwrite cleanly. Drums only ever add, so a kick pass
     * followed by a snare pass builds a kit instead of erasing one. */
    if (headIsFresh() && !isDrum()) seqCmd(`del ${t} ${step} ${step} -1`);
    headWritten();
    seqCmd(`addp ${t} ${step} ${step} ${pitch} ${vel}`);
    chord.pitches.push(pitch);
    if (!occHasStep(step)) occToggleStep(step);
    return true;
}

/* A pad released. The head advances only once every pad is up (KeyStep). */
export function stepRecPadRelease(padNote: number): boolean {
    if (!active) return false;
    if (!heldPads.delete(padNote)) return true;   // not ours, but still consumed
    if (heldPads.size > 0) return true;           // chord still open
    chord = null;
    advanceHead();
    return true;
}

/* Left/Right. With the chord still under the fingers they tie and untie it —
 * the notes grow into the following steps and the head rides along, which is
 * the KeyStep "Tap = tie" gesture without needing a spare button. With no pad
 * held they move the head: forward leaves a rest, backward re-opens the
 * previous step for editing. Returns true when consumed. */
export function stepRecArrow(dir: number): boolean {
    if (!active) return false;
    touched = true;
    if (chord) {
        if (dir > 0) chord.tieSteps++;
        else if (chord.tieSteps > 0) chord.tieSteps--;
        else return true;              // already one step long: consumed no-op
        const ticks = (chord.tieSteps + 1) * TICKS_PER_STEP;
        /* Per pitch rather than lane -1: on a drum track a tie must only touch
         * the notes this chord entered, never what an earlier pass left on the
         * same step. */
        const t = seqState.watchTrack;
        for (const p of chord.pitches) {
            seqCmd(`slen ${t} ${chord.anchor} ${chord.anchor} ${p} ${ticks}`);
        }
        const open = chord;            // setHead must not close the open chord
        const end = open.anchor + open.tieSteps;
        growTo(end);
        setHead(end);
        chord = open;
        return true;
    }
    if (dir > 0) {
        advanceHead();
    } else {
        setHead(Math.max(0, headStep() - 1));
        requestPreview();              // play what is there, ready to overwrite
    }
    return true;
}

export function resetStepRec(): void {
    active = false;
    touched = false;
    pressMs = 0;
    chord = null;
    heldPads.clear();
    headReset();
}
