/* Pure LED-affordance decisions: context → LED value. "Lit only when
 * pressable; full brightness when active." White-LED buttons use brightness;
 * the Sample button is RGB so off = black. */

import { C_BLACK } from './colors.js';
import { WHITE_BRIGHT, WHITE_DIM, WHITE_OFF } from './colors.js';
import { VIEW_CHAIN } from '../app/state.js';

/** Back: off in the chain-param view, dim in module-param views. */
export function backLedColor(view: number): number {
    return view === VIEW_CHAIN ? WHITE_OFF : WHITE_DIM;
}

/** Left (dir -1) / Right (dir +1): off at the travel limit, dim when
 *  navigable, bright while pressed. */
export function arrowLedColor(dir: number, barOffset: number, maxOffset: number, pressed: boolean): number {
    const canGo = dir < 0 ? barOffset > 0 : barOffset < maxOffset;
    if (!canGo) return WHITE_OFF;
    return pressed ? WHITE_BRIGHT : WHITE_DIM;
}

/** Step recording: the arrows stop being bar navigation and become the head's
 *  own controls, so they advertise themselves by blinking rather than sitting
 *  at a steady dim. Right always does something (rest, or tie the held chord);
 *  Left only when there is something to go back to — an untie, or an earlier
 *  step — and is dark otherwise, the same "off at the travel limit" rule the
 *  bar arrows use. The blink swings bright↔dim, never bright↔off, so a lit
 *  arrow always means pressable. */
export function stepRecArrowColor(dir: number, canGoLeft: boolean, blink: boolean): number {
    if (dir < 0 && !canGoLeft) return WHITE_OFF;
    return blink ? WHITE_BRIGHT : WHITE_DIM;
}

/** Sample button has no movy action → off (RGB black). */
export function sampleLedColor(): number {
    return C_BLACK;
}

/** Capture: lit whenever there is buffered input worth keeping (Move parity —
 *  the button goes dark once the input is cleared). */
export function captureLedColor(pending: number): number {
    return pending > 0 ? WHITE_BRIGHT : WHITE_OFF;
}

/** Undo: lit when there is something to undo. While Shift is held the button
 *  means redo, so it advertises the redo stack instead — otherwise a lit button
 *  under Shift would promise an action that does nothing. */
export function undoLedColor(canUndo: boolean, canRedo: boolean, shiftHeld: boolean): number {
    return (shiftHeld ? canRedo : canUndo) ? WHITE_BRIGHT : WHITE_OFF;
}
