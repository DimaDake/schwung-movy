/* Loop Mode: the Loop button turns the step row into a bar selector and
 * gates the loop-length gestures (manual §11.5 / §12.1).
 *
 * - Tap Loop          → toggle Loop Mode (step buttons show bars).
 * - Two bars pressed  → set the loop window to [min, max] bars (works for
 *                       simultaneous presses and hold-first-then-second).
 * - Double-tap a bar  → 1-bar loop at that bar.
 * - Hold Loop + wheel → grow/shrink the loop by whole bars.
 *
 * The engine owns the loop window; this module only emits `loop`/`dbl`
 * commands and the optimistic mirror is corrected by the next status poll. */

import { NUM_STEP_BUTTONS } from './constants.js';
import { appState } from '../app/state.js';
import { undoableEdit } from '../undo/edit.js';
import { trackLabel } from '../undo/label.js';
import { seqCmd } from './engine.js';
import { momentaryDown, momentaryGesture, momentaryUp } from './momentary.js';
import { seqHeaderAnnounce, seqToast } from './render.js';
import { clipBars, loopStartBar, seqState } from './state.js';

const MAX_BARS = 16;
/* Wall-clock, not tick-counted: the device tick rate is not a stable constant
 * (63-205 Hz observed, and it moves with load), so a tick-based window silently
 * swung from 0.29s to 0.95s depending on how busy the UI was. Same reasoning as
 * momentary.ts's hold threshold. */
const DOUBLE_TAP_MS = 450;
const CC_LOOP_BTN = 58;

let held = false;          // Loop button currently down
let loopPrev = false;      // loopMode before the current press (tap/hold decision)
const heldBars = new Set<number>();
let lastTapBar = -1;
let lastTapMs = -DOUBLE_TAP_MS;

/* Loop button (CC 58): momentary. Down shows the loop bars; a clean tap latches
 * (or toggles back to Note if already in Loop); a hold or a wheel/bar gesture
 * while held reverts to the prior view on release (so Loop+wheel resize keeps
 * the bars visible and never permanently flips the mode). */
export function loopButton(down: boolean): void {
    if (down) {
        held = true;
        loopPrev = seqState.loopMode;
        momentaryDown(CC_LOOP_BTN, () => {
            seqState.loopMode = loopPrev;
            appState.dirty = true;   // erase the readout band on the way out
            seqHeaderAnnounce(loopPrev ? 'Loop' : 'Note');
        });
        seqState.loopMode = true;
        seqHeaderAnnounce('Loop');
    } else {
        held = false;
        if (momentaryUp(CC_LOOP_BTN) === 'tap' && loopPrev) {
            seqState.loopMode = false; // tap while already in Loop → back to Note
            appState.dirty = true;
            seqHeaderAnnounce('Note');
        }
    }
}

export function loopHeld(): boolean {
    return held;
}

/* Wheel turn while Loop is held: resize the loop by whole bars from its
 * current start. Returns true if consumed. */
export function loopWheel(delta: number): boolean {
    if (!held) return false;
    momentaryGesture(); // resizing = modifier use; release reverts, never latches
    const start = loopStartBar();
    const bars = clipBars();
    const next = Math.max(1, Math.min(bars + (delta > 0 ? 1 : -1), MAX_BARS - start));
    setLoopBars(start, start + next - 1);
    return true;
}

/* Step press in Loop Mode = bar selection. The *At variant takes the timestamp so
 * the double-tap window is testable without sleeping. */
export function loopStepOnAt(bar: number, nowMs: number): void {
    heldBars.add(bar);
    momentaryGesture(); // selecting/setting bars while Loop held = modifier use
    if (heldBars.size >= 2) {
        const bars = [...heldBars];
        setLoopBars(Math.min(...bars), Math.max(...bars));
        heldBars.clear();
        return;
    }
    if (bar === lastTapBar && nowMs - lastTapMs <= DOUBLE_TAP_MS) {
        setLoopBars(bar, bar);
    } else {
        seqState.barOffset = bar;   // single press selects the viewed bar
    }
    lastTapBar = bar;
    lastTapMs = nowMs;
}

export function loopStepOn(bar: number): void {
    loopStepOnAt(bar, Date.now());
}

export function loopStepOff(bar: number): void {
    heldBars.delete(bar);
}

function setLoopBars(startBar: number, endBar: number): void {
    const s = Math.max(0, Math.min(startBar, MAX_BARS - 1));
    const e = Math.max(s, Math.min(endBar, MAX_BARS - 1));
    const startStep = s * NUM_STEP_BUTTONS;
    const lenStep = (e - s + 1) * NUM_STEP_BUTTONS;
    undoableEdit('SET LOOP', trackLabel(seqState.watchTrack),
        () => seqCmd(`loop ${seqState.watchTrack} ${startStep} ${lenStep}`));
    // Optimistic mirror.
    seqState.loopStart = startStep;
    seqState.lenSteps = lenStep;
    /* Keep the viewed bar inside the new window: a two-bar press or a wheel shrink
     * used to leave barOffset outside it, so the step row then edited a bar that
     * no longer plays. Clamping (rather than jumping to the start) keeps you as
     * near as possible to where you were looking. */
    seqState.barOffset = Math.max(s, Math.min(seqState.barOffset, e));
    seqHeaderAnnounce(s === e ? `Loop ${s + 1}` : `Loop ${s + 1}-${e + 1}`);
}

/* Shift+Step 15: double the loop (notes + length). */
export function doubleLoop(): void {
    undoableEdit('DOUBLE LOOP', trackLabel(seqState.watchTrack),
        () => seqCmd('dbl ' + seqState.watchTrack));
    const bars = clipBars();
    if (loopStartBar() + bars * 2 <= MAX_BARS) {
        seqState.lenSteps = bars * 2 * NUM_STEP_BUTTONS; // optimistic
        seqToast('Loop doubled');
    }
}

export function resetLoopMode(): void {
    held = false;
    loopPrev = false;
    heldBars.clear();
    lastTapBar = -1;
    lastTapMs = -DOUBLE_TAP_MS;
}
