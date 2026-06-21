/* Hold-step editing (manual §11): while one or more step buttons are held,
 * the encoders and +/- / arrow buttons edit the held steps' notes instead of
 * their normal function, and a pad press toggles a pitch in the held step(s).
 * Holding a bar in Loop Mode applies the same edits to every note in the bar.
 *
 * A step press registers a held range; on release, if no edit gesture
 * happened during the hold, it was a tap (the caller toggles the note). All
 * edits are emitted as engine commands and confirmed by the next status
 * poll; toasts report the gesture. */

import { NUM_STEP_BUTTONS } from './constants.js';
import { seqCmd } from './engine.js';
import { seqToast } from './render.js';
import { seqState } from './state.js';

const TICKS_PER_STEP = 24;             // 96 PPQN / 4 (mirror of seq-core)
const VEL_STEP = 4;                    // velocity per encoder detent
const LEN_STEP = Math.round(TICKS_PER_STEP / 10); // ~10% of a step
const NUDGE_COARSE = LEN_STEP;         // 10% of a step
const NUDGE_FINE = 1;                  // Shift = ~1%

interface Range { s0: number; s1: number; }

const heldRanges = new Map<number, Range>(); // physical button (0-15) → range
const gestured = new Set<number>();
const pressMs = new Map<number, number>();   // button → Date.now() at press
/* Drum steps that were held together (a multi-press): each is an independent
 * entry, so the solo-hold step-automation timer must not suppress their toggle.
 * Without this, holding one drum step as an anchor while tapping others would
 * promote the anchor to automation mode once it's briefly held alone, and it
 * would never enter (the "holding one step never blocks entering others" rule). */
const coPressed = new Set<number>();

/* Last hold-A + press-B length target, for the end/start toggle. atEnd=true means
 * the note ends at the END of step b ((b-a+1) steps); false trims to the START of
 * b ((b-a) steps). Reset when the anchor (A) is released. */
let lastLenTarget: { a: number; b: number; atEnd: boolean } | null = null;

/* A hold this long (no tap) switches to step-automation mode. */
const STEP_AUTO_MS = 300;

export function anyStepHeld(): boolean {
    return heldRanges.size > 0;
}

/* Register a held step button. In Note Mode it covers one step; in Loop Mode
 * the button is a bar, so the range is that bar's 16 steps. */
export function editStepDown(button: number): void {
    let range: Range;
    if (seqState.loopMode) {
        const base = button * NUM_STEP_BUTTONS;
        range = { s0: base, s1: base + NUM_STEP_BUTTONS - 1 };
    } else {
        const step = seqState.barOffset * NUM_STEP_BUTTONS + button;
        range = { s0: step, s1: step };
    }
    heldRanges.set(button, range);
    pressMs.set(button, Date.now());
    // Two+ steps held together are independent entries (drum lanes, or empty
    // synth steps — the length gesture is gated on an occupied anchor in the
    // router, so it never reaches editStepDown for the second step). Exempt them
    // from the solo-hold automation timer AND undo any promotion that already
    // happened (the anchor may have been held alone past 300ms before this
    // second press — as device MIDI-inject latency causes), so each still
    // toggles on release.
    if (heldRanges.size >= 2) {
        for (const b of heldRanges.keys()) {
            coPressed.add(b);
            gestured.delete(b);
        }
        if (seqState.stepAutoMode) endStepAutomation(); // cancel solo-hold promotion
    }
}

/* Promote the single held step to step-automation mode (knob turns record
 * automation, the release won't toggle a note). Returns the step, or -1 if not
 * exactly one step is held. Idempotent. */
export function beginStepAutomation(): number {
    const r = heldRange();                // one step (Note) or a whole bar (Loop)
    if (!r) return -1;
    markGestured();                       // release is no longer a tap
    if (!seqState.stepAutoMode) {
        seqState.stepAutoMode = true;
        seqState.holdStep = r.s0;         // representative step for the held-value display
        seqCmd('hold ' + seqState.watchTrack + ' ' + r.s0);
    }
    return r.s0;
}

/* Per-tick: a single step held past the threshold enters step-automation mode
 * even without a knob turn (so the user can see the step's automation values). */
export function stepAutoTick(): void {
    if (seqState.stepAutoMode || heldRanges.size !== 1) return;
    const button = [...heldRanges.keys()][0];
    // A step from a drum multi-press stays an independent entry, never a
    // promoted solo hold — so its release still toggles the note.
    if (coPressed.has(button)) return;
    const t = pressMs.get(button);
    if (t !== undefined && Date.now() - t >= STEP_AUTO_MS) beginStepAutomation();
}

/* Leave step-automation mode (called on step release when nothing is held). */
export function endStepAutomation(): void {
    seqState.stepAutoMode = false;
    seqState.heldLocks.clear();
}

/* Release a held button. Returns true if it was a tap (no gesture occurred),
 * so the caller can toggle the note (Note Mode only). */
export function editStepUp(button: number): boolean {
    // The anchor is the only registered held step during a length gesture (B is
    // never added), so releasing a registered step ends the gesture's toggle.
    if (heldRanges.has(button)) lastLenTarget = null;
    const wasTap = heldRanges.has(button) && !gestured.has(button);
    heldRanges.delete(button);
    gestured.delete(button);
    coPressed.delete(button);
    pressMs.delete(button);
    return wasTap;
}

function markGestured(): void {
    for (const b of heldRanges.keys()) gestured.add(b);
}

function lane(): number {
    return seqState.watchLane;
}

function forEach(emit: (r: Range) => void): void {
    markGestured();
    for (const r of heldRanges.values()) emit(r);
}

/* Volume encoder → velocity. */
export function editVelocity(delta: number): boolean {
    if (!anyStepHeld()) return false;
    const d = (delta > 0 ? 1 : -1) * VEL_STEP;
    forEach((r) => seqCmd(`evel ${seqState.watchTrack} ${r.s0} ${r.s1} ${lane()} ${d}`));
    seqToast(d > 0 ? 'Velocity +' : 'Velocity -');
    return true;
}

/* Left/Right arrow → nudge (Shift = fine). */
export function editNudge(dir: number, shift: boolean): boolean {
    if (!anyStepHeld()) return false;
    const d = dir * (shift ? NUDGE_FINE : NUDGE_COARSE);
    forEach((r) => seqCmd(`enudge ${seqState.watchTrack} ${r.s0} ${r.s1} ${lane()} ${d}`));
    seqToast(dir > 0 ? 'Nudge >' : 'Nudge <');
    return true;
}

/* +/- buttons → transpose by a semitone (melodic only). */
export function editTranspose(semitones: number): boolean {
    if (!anyStepHeld() || seqState.watchLane >= 0) return false;
    forEach((r) => seqCmd(`etrn ${seqState.watchTrack} ${r.s0} ${r.s1} -1 ${semitones}`));
    seqToast(semitones > 0 ? 'Transpose +' : 'Transpose -');
    return true;
}

/* Pad pressed while a step is held: toggle that pitch in a held single step
 * (Note Mode), or add it to every step of a held bar (Loop Mode). Returns
 * true if consumed (so the pad isn't also treated as chord input). */
export function editPad(pitch: number, vel: number): boolean {
    if (!anyStepHeld()) return false;
    const t = seqState.watchTrack;
    forEach((r) => {
        if (r.s0 === r.s1) {
            seqCmd(`ltog ${t} ${r.s0} ${pitch} ${vel}`);
        } else {
            seqCmd(`addp ${t} ${r.s0} ${r.s1} ${pitch} ${vel}`);
        }
    });
    return true;
}

/* The single held range (one step in Note mode, a whole bar in Loop mode), or
 * null unless exactly one button is held. Drives step-automation's target. */
export function heldRange(): { s0: number; s1: number } | null {
    if (heldRanges.size !== 1) return null;
    const r = [...heldRanges.values()][0];
    return { s0: r.s0, s1: r.s1 };
}

/* Every absolute step currently held (flattening Loop-mode bar ranges). */
export function heldStepList(): number[] {
    const out: number[] = [];
    for (const r of heldRanges.values()) for (let s = r.s0; s <= r.s1; s++) out.push(s);
    return out;
}

/* Mark the held buttons as gestured so their release won't toggle a note. */
export function markHeldGestured(): void {
    markGestured();
}

/* The single held step's absolute index (Note mode), or -1 if not exactly one. */
export function heldStepAbs(): number {
    if (heldRanges.size !== 1) return -1;
    const r = [...heldRanges.values()][0];
    return r.s0 === r.s1 ? r.s0 : -1;
}

/* Hold A (an occupied step) + press B → set A's note length. First press of a
 * given B ends the note at the END of B ((B-A+1) steps); pressing the same B
 * again trims to the START of B ((B-A) steps); each repeat flips. Returns true
 * if a length-set was emitted. The router only calls this when A is occupied;
 * B <= A is a no-op (returns false; the router still consumes the press so B is
 * not entered). */
export function setLengthTo(absB: number): boolean {
    const a = heldStepAbs();
    if (a < 0 || absB <= a) return false;
    markGestured();
    let atEnd = true;
    if (lastLenTarget && lastLenTarget.a === a && lastLenTarget.b === absB) {
        atEnd = !lastLenTarget.atEnd; // repeat press of the same B flips end/start
    }
    lastLenTarget = { a, b: absB, atEnd };
    const steps = atEnd ? (absB - a + 1) : (absB - a);
    seqCmd(`slen ${seqState.watchTrack} ${a} ${a} ${lane()} ${steps * TICKS_PER_STEP}`);
    seqToast('Length ' + steps);
    return true;
}

export function resetStepEdit(): void {
    heldRanges.clear();
    gestured.clear();
    coPressed.clear();
    pressMs.clear();
    lastLenTarget = null;
}
