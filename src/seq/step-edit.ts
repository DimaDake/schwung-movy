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
}

/* Promote the single held step to step-automation mode (knob turns record
 * automation, the release won't toggle a note). Returns the step, or -1 if not
 * exactly one step is held. Idempotent. */
export function beginStepAutomation(): number {
    const s = heldStepAbs();
    if (s < 0) return -1;
    markGestured();                       // release is no longer a tap
    if (!seqState.stepAutoMode) {
        seqState.stepAutoMode = true;
        seqState.holdStep = s;
        seqCmd('hold ' + seqState.watchTrack + ' ' + s);
    }
    return s;
}

/* Per-tick: a single step held past the threshold enters step-automation mode
 * even without a knob turn (so the user can see the step's automation values). */
export function stepAutoTick(): void {
    if (seqState.stepAutoMode || heldRanges.size !== 1) return;
    const button = [...heldRanges.keys()][0];
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
    const wasTap = heldRanges.has(button) && !gestured.has(button);
    heldRanges.delete(button);
    gestured.delete(button);
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

/* Wheel → note length (±10% of a step per detent). */
export function editLength(delta: number): boolean {
    if (!anyStepHeld()) return false;
    const d = (delta > 0 ? 1 : -1) * LEN_STEP;
    forEach((r) => seqCmd(`elen ${seqState.watchTrack} ${r.s0} ${r.s1} ${lane()} ${d}`));
    seqToast(d > 0 ? 'Length +' : 'Length -');
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

/* The single held step's absolute index (Note mode), or -1 if not exactly one. */
export function heldStepAbs(): number {
    if (heldRanges.size !== 1) return -1;
    const r = [...heldRanges.values()][0];
    return r.s0 === r.s1 ? r.s0 : -1;
}

/* Hold A + press B → set A's note length to span to B. Returns true if a
 * length-set was emitted (B > A), false otherwise. */
export function setLengthTo(absB: number): boolean {
    const a = heldStepAbs();
    if (a < 0 || absB <= a) return false;
    markGestured();
    const ticks = (absB - a) * TICKS_PER_STEP;
    seqCmd(`slen ${seqState.watchTrack} ${a} ${a} ${lane()} ${ticks}`);
    seqToast('Length ' + (absB - a));
    return true;
}

export function resetStepEdit(): void {
    heldRanges.clear();
    gestured.clear();
    pressMs.clear();
}
