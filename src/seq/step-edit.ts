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
}

/* Release a held button. Returns true if it was a tap (no gesture occurred),
 * so the caller can toggle the note (Note Mode only). */
export function editStepUp(button: number): boolean {
    const wasTap = heldRanges.has(button) && !gestured.has(button);
    heldRanges.delete(button);
    gestured.delete(button);
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

export function resetStepEdit(): void {
    heldRanges.clear();
    gestured.clear();
}
