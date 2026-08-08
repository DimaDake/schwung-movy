/* The quantize confirmation panel: candidates in the big font with the current
 * one boxed, drawn as a strip over the current view rather than a full-screen
 * takeover. You hit Shift+Step 16 mid-take while watching your steps, so
 * blanking the pattern for a second to confirm a value you already chose would
 * be disorienting. */

import { fontPrint, fontWidth, FONT_HEIGHT } from '../font/index.js';
import { BIG_FONT_HEIGHT } from '../font/big.js';
import { W } from './layout.js';
import { drawValueRow } from './value-row.js';
import type { QuantOverlayVM } from '../seq/quant-overlay.js';

const PANEL_Y = 18;
const PAD = 3;
const MARK = 'DEF';
/* The selection box overhangs the glyphs by BOX_PAD, so the marker row has to
 * clear that too or DEF collides with the box under the boxed value. */
const BOX_PAD = 2;
const MARK_DY = BIG_FONT_HEIGHT + BOX_PAD + 1;
const PANEL_H = PAD * 2 + MARK_DY + FONT_HEIGHT;

export function drawQuantOverlay(vm: QuantOverlayVM): void {
    // Knock the strip out of whatever is underneath: a 1px frame around a
    // cleared field, so the panel reads as on top rather than as part of it.
    fill_rect(0, PANEL_Y, W, PANEL_H, 1);
    fill_rect(1, PANEL_Y + 1, W - 2, PANEL_H - 2, 0);

    const valueY = PANEL_Y + PAD;
    const { slotX, widths } = drawValueRow(vm.values, vm.selIdx, valueY);

    /* The default needs its own channel: the inverted box is already spoken
     * for by the selection, and the two coincide in the common case. */
    if (vm.defIdx >= 0 && vm.defIdx < slotX.length) {
        const markX = slotX[vm.defIdx] + Math.floor((widths[vm.defIdx] - fontWidth(MARK)) / 2);
        fontPrint(Math.max(1, markX), valueY + MARK_DY, MARK, 1);
    }
}
