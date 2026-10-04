/* canvas-dive-input.ts — what a fullscreen canvas dive takes from the surface.
 *
 * Upstream hands a canvas every CC while it is up and keeps Back and the jog
 * click as the way out (shadow_ui.js dispatchCanvasMidi). movy takes the same
 * set a modal needs — the jog assembly, Back, the eight knobs and their
 * touches — and leaves the rest (transport, steps, track buttons) to run under
 * it, as the quantize panel does. A knob behind a fullscreen screen would edit
 * a parameter nobody can see, so the knobs go to the script, never the page.
 *
 * Releases are never taken: the handler that armed a hold has no other way to
 * learn the button came up.
 *
 * PADS PLAY AND ARE ALSO TOLD, a tick later. The script asks the module which
 * pad is focused when it hears one (DR32's browser follows the pad you hit),
 * and movy's own press is what moves that focus — so the note is handed over
 * after the press has been routed, not before.
 */
import { canvasDiveActive, canvasDiveBack, canvasDiveClick, canvasDiveJog, canvasDiveMidi,
         canvasDivePad } from '../renderer/schwung-canvas-dive.js';

const KNOB_TOUCH_LAST = 9;      /* notes 0-7 knobs, 8 master, 9 jog */
let padsOwed: number[][] = [];

export function canvasDiveTakes(data: number[]): boolean {
    if (!canvasDiveActive()) { padsOwed = []; return false; }
    const status = data[0] & 0xF0, k = data[1], v = data[2];
    if (status === 0xB0) {
        if (k === MoveBack) { if (v > 0) canvasDiveBack(); return v > 0; }
        if (k === MoveMainButton) { if (v > 0) canvasDiveClick(); return v > 0; }
        if (k === MoveMainKnob) { const d = decodeDelta(v); if (d) canvasDiveJog(d); return true; }
        if (k >= MoveKnob1 && k < MoveKnob1 + 8) { canvasDiveMidi(data); return true; }
        return false;
    }
    if ((status === 0x90 || status === 0x80) && k <= KNOB_TOUCH_LAST) {
        canvasDiveMidi(data);
        return status === 0x90 && v > 0;
    }
    if (status === 0x90 && v > 0 && k >= MovePads[0] && k <= MovePads[MovePads.length - 1]) {
        padsOwed.push([k, v]);
    }
    return false;
}

/** Deliver the pad presses routed since the last tick. */
export function canvasDiveDeliverPads(): void {
    const owed = padsOwed;
    padsOwed = [];
    for (const [n, v] of owed) canvasDivePad(n, v);
}
