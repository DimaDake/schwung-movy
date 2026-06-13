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

/** Sample button has no movy action → off (RGB black). */
export function sampleLedColor(): number {
    return C_BLACK;
}

/** Capture / Undo have no movy action yet → off (white). */
export function captureLedColor(): number { return WHITE_OFF; }
export function undoLedColor(): number { return WHITE_OFF; }
