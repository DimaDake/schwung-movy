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
import { seqCmd, uiTick } from './engine.js';
import { momentaryDown, momentaryUp } from './momentary.js';
import { seqHeaderAnnounce, seqToast } from './render.js';
import { clipBars, loopStartBar, seqState } from './state.js';

const MAX_BARS = 16;
const DOUBLE_TAP_TICKS = 60; // ~0.3s at the ~196 Hz device rate
const CC_LOOP_BTN = 58;

let held = false;          // Loop button currently down
let gestured = false;      // a wheel/step gesture happened during this hold
const heldBars = new Set<number>();
let lastTapBar = -1;
let lastTapTick = -DOUBLE_TAP_TICKS;

/* Loop button (CC 58): momentary (tap latches, hold peeks then returns). */
export function loopButton(down: boolean): void {
    if (down) {
        held = true;
        gestured = false;
        const prev = seqState.loopMode;
        momentaryDown(CC_LOOP_BTN, () => { seqState.loopMode = prev; seqHeaderAnnounce(prev ? 'Loop' : 'Note'); });
        seqState.loopMode = true;
        seqHeaderAnnounce('Loop');
    } else {
        held = false;
        momentaryUp(CC_LOOP_BTN);
    }
}

export function loopHeld(): boolean {
    return held;
}

/* Wheel turn while Loop is held: resize the loop by whole bars from its
 * current start. Returns true if consumed. */
export function loopWheel(delta: number): boolean {
    if (!held) return false;
    gestured = true;
    const start = loopStartBar();
    const bars = clipBars();
    const next = Math.max(1, Math.min(bars + (delta > 0 ? 1 : -1), MAX_BARS - start));
    setLoopBars(start, start + next - 1);
    return true;
}

/* Step press in Loop Mode = bar selection. */
export function loopStepOn(bar: number): void {
    heldBars.add(bar);
    gestured = true;
    if (heldBars.size >= 2) {
        const bars = [...heldBars];
        setLoopBars(Math.min(...bars), Math.max(...bars));
        heldBars.clear();
        return;
    }
    if (bar === lastTapBar && uiTick() - lastTapTick <= DOUBLE_TAP_TICKS) {
        setLoopBars(bar, bar);
    } else {
        seqState.barOffset = bar;   // single press selects the viewed bar
    }
    lastTapBar = bar;
    lastTapTick = uiTick();
}

export function loopStepOff(bar: number): void {
    heldBars.delete(bar);
}

function setLoopBars(startBar: number, endBar: number): void {
    const s = Math.max(0, Math.min(startBar, MAX_BARS - 1));
    const e = Math.max(s, Math.min(endBar, MAX_BARS - 1));
    const startStep = s * NUM_STEP_BUTTONS;
    const lenStep = (e - s + 1) * NUM_STEP_BUTTONS;
    seqCmd(`loop ${seqState.watchTrack} ${startStep} ${lenStep}`);
    // Optimistic mirror.
    seqState.loopStart = startStep;
    seqState.lenSteps = lenStep;
    seqHeaderAnnounce(s === e ? `Loop ${s + 1}` : `Loop ${s + 1}-${e + 1}`);
}

/* Shift+Step 15: double the loop (notes + length). */
export function doubleLoop(): void {
    seqCmd('dbl ' + seqState.watchTrack);
    const bars = clipBars();
    if (loopStartBar() + bars * 2 <= MAX_BARS) {
        seqState.lenSteps = bars * 2 * NUM_STEP_BUTTONS; // optimistic
        seqToast('Loop doubled');
    }
}

export function resetLoopMode(): void {
    held = false;
    gestured = false;
    heldBars.clear();
    lastTapBar = -1;
    lastTapTick = -DOUBLE_TAP_TICKS;
}
