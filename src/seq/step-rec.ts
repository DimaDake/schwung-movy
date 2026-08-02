/* Step recording (manual §5): hold Rec while the transport is stopped and play
 * the pads to fill the sequencer one step at a time — OP-Z / OP-XY / KeyStep
 * step entry, for melodic and drum tracks alike.
 *
 * Chord accumulation is KeyStep's: notes that overlap in time land on the same
 * step, and the head advances only when the LAST pad comes up. So a chord needs
 * no modifier, and a single-finger run still advances one note per step.
 *
 * The mode owns the head; the engine's `hold` command is pointed at it on every
 * move, which is what makes the rest cheap — the status reply already drives the
 * pad LEDs (app/tick.ts) and the note-length span on the step row (leds.ts), and
 * supplies the header's note names and the back-step preview's pitches. */

import { NUM_STEP_BUTTONS } from './constants.js';
import { seqCmd } from './engine.js';
import { occHasStep, occToggleStep, seqState } from './state.js';

const TICKS_PER_STEP = 24;   // 96 PPQN / 4 (mirror of seq-core)
const MAX_STEPS = 256;       // 16 bars — the engine's clip ceiling
const TAP_MS = 500;          // tap-vs-hold, matching momentary.ts

/* The chord currently under the fingers. `anchor` is the step it was written
 * to, which stays fixed while a tie moves the head forward. */
interface OpenChord { pitches: number[]; anchor: number; tieSteps: number; }

let active = false;
let head = 0;
/* Latched at entry, never re-derived: entering the first note on an empty clip
 * makes it non-empty, and re-deriving would turn it into a one-step clip that
 * wraps immediately. */
let growMode = false;
let touched = false;         // anything at all happened during this hold
let pressMs = 0;
/* No note has been written at the head since the head arrived here. The first
 * melodic write at a fresh head clears the step, later ones stack. */
let fresh = true;
let chord: OpenChord | null = null;
const heldPads = new Map<number, number>();   // padNote → pitch

export function stepRecActive(): boolean { return active; }
export function stepRecHead(): number { return head; }
export function stepRecGrowMode(): boolean { return growMode; }

function isDrum(): boolean { return seqState.watchLane >= 0; }

/* Rec down. Returns true when step recording took the press, so the caller
 * must not also arm live recording. Stopped-transport only — Rec while playing
 * keeps its existing meaning. */
export function stepRecDownAt(nowMs: number): boolean {
    if (active || seqState.playing) return false;
    active = true;
    touched = false;
    pressMs = nowMs;
    growMode = seqState.lenSteps === 0;
    chord = null;
    heldPads.clear();
    setHead(0);
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
    seqState.holdStep = -1;
    seqState.holdNotes = [];
    seqCmd('hold ' + seqState.watchTrack + ' -1');
}

/* Move the head and re-point everything that follows it. holdNotes is cleared
 * optimistically so a status reply still describing the PREVIOUS step can never
 * be read as this step's content. */
function setHead(step: number): void {
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
function growTo(step: number): void {
    if (!growMode) return;
    const want = Math.min(step + 1, MAX_STEPS);
    if (want <= seqState.lenSteps) return;
    seqState.lenSteps = want;
    seqCmd('clen ' + seqState.watchTrack + ' ' + want);
}

function advanceHead(): void {
    growTo(head);                        // the step being left joins the clip
    let next = head + 1;
    if (growMode) {
        if (next >= MAX_STEPS) next = 0;
    } else if (next >= seqState.lenSteps) {
        next = seqState.loopStart;
    }
    setHead(next);
}

/* A pad played while the mode is active. Returns true when consumed, so the
 * caller skips the normal chord/live-capture path. The note has already been
 * sounded by midi/router.ts — this only writes it. */
export function stepRecPad(padNote: number, pitch: number, vel: number): boolean {
    if (!active) return false;
    touched = true;
    heldPads.set(padNote, pitch);
    const t = seqState.watchTrack;
    if (!chord) chord = { pitches: [], anchor: head, tieSteps: 0 };
    /* Melodic replaces because the head is the user's cursor: stepping back and
     * replaying has to overwrite cleanly. Drums only ever add, so a kick pass
     * followed by a snare pass builds a kit instead of erasing one. */
    if (fresh && !isDrum()) seqCmd(`del ${t} ${head} ${head} -1`);
    fresh = false;
    seqCmd(`addp ${t} ${head} ${head} ${pitch} ${vel}`);
    chord.pitches.push(pitch);
    if (!occHasStep(head)) occToggleStep(head);
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

export function resetStepRec(): void {
    active = false;
    head = 0;
    growMode = false;
    touched = false;
    pressMs = 0;
    fresh = true;
    chord = null;
    heldPads.clear();
}
