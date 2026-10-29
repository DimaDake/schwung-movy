/* The generator preview's controls (preview.ts): only while it is shown, so a
 * held track button hands every control back to the pages underneath. */

import { aiPreviewActive, commitPreview, previewSwitch } from './preview.js';
import { knobTouch, knobTurn } from './preview-knobs.js';

/** Jog turn switches, jog click and Back commit, the knobs are the option's
 *  (preview-knobs.ts); every other control passes through, so the clip stays
 *  editable. Knob touches never reach the page underneath. */
export function previewInput(data: number[]): boolean {
    if (!aiPreviewActive()) return false;
    const kind = data[0] & 0xF0;
    if ((kind === 0x90 || kind === 0x80) && data[1] < 8) { knobTouch(data[1], kind === 0x90 && data[2] > 0); return true; }
    if (kind !== 0xB0) return false;
    const [, cc, v] = data;
    if (cc === MoveMainKnob) { previewSwitch(decodeDelta(v)); return true; }
    if (cc === MoveMainButton || cc === MoveBack) { if (v > 0) commitPreview(cc === MoveBack ? 'back' : 'jog click'); return true; }
    if (cc >= 71 && cc <= 78) { knobTurn(cc - 71, decodeDelta(v)); return true; }
    return false;
}
