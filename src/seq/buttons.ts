/* Pure LED-affordance decisions: context → LED value. Dark = does nothing here,
 * dim = you can press this, bright = active. The fourth state — bright while
 * physically held — is NOT decided here: led-cache.ts applies it to every
 * button from one place, so these functions never take a `pressed` flag.
 * White-LED buttons use brightness; the Sample button is RGB so off = black. */

import { C_BLACK } from './colors.js';
import { WHITE_BRIGHT, WHITE_DIM, WHITE_OFF } from './colors.js';
import { groupStep } from '../track/focus.js';
/** Back: dim everywhere it does something — and at the chain root it does,
 *  opening the Leave menu (Background / Close Movy). It used to sit dark there,
 *  which advertised the root as a dead end. */
export function backLedColor(_view: number): number {
    return WHITE_DIM;
}

/** Left (dir -1) / Right (dir +1): off at the travel limit, dim when navigable.
 *  The bright-while-pressed half is no longer here — led-cache applies it to
 *  every button, and keeping a second copy would let the two drift. */
export function arrowLedColor(dir: number, barOffset: number, maxOffset: number): number {
    const canGo = dir < 0 ? barOffset > 0 : barOffset < maxOffset;
    return canGo ? WHITE_DIM : WHITE_OFF;
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

/** Octave up/down move the focused group in Session view. Off at the travel
 *  limit, dim when a move exists — the same affordance rule the bar arrows use,
 *  so "lit means pressable" stays true everywhere on the panel. */
export function groupArrowColor(dir: number): number {
    return groupStep(dir) >= 0 ? WHITE_DIM : WHITE_OFF;
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
    /* Dim, not bright: dim is this UI's "you can press this". led-cache takes it
     * to full bright while the button is actually held. */
    return (shiftHeld ? canRedo : canUndo) ? WHITE_DIM : WHITE_OFF;
}

/* What a full-screen takeover leaves of the white action buttons. Dim is this
 * UI's "you can press this", so a button the screen swallows must go dark or
 * it promises an action that does not happen; one the screen gives a meaning
 * to must light even where the normal rule would leave it dark (Capture has
 * nothing buffered, yet renames on the Sets page).
 *
 * `setsEditable` is null off the Sets page; on it, whether the cursor is on a
 * Set the three edit buttons can act on ([NEW] and an armed delete are not). */
export interface ButtonScreen { keyboard: boolean; setsEditable: boolean | null; }

/* MoveCCButtons: Back, Capture, Copy, Delete. */
const CC_BACK = 51;
const SETS_EDIT_CCS: readonly number[] = [52, 60, 119];

export function screenButtonColor(cc: number, color: number, s: ButtonScreen): number {
    /* The keyboard takes every control; Back is its cancel. */
    if (s.keyboard) return cc === CC_BACK ? WHITE_DIM : WHITE_OFF;
    if (s.setsEditable !== null && SETS_EDIT_CCS.includes(cc)) return s.setsEditable ? WHITE_DIM : WHITE_OFF;
    return color;
}
