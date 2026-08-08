/* The quantize confirmation panel: a titled box over whatever view is on
 * screen, holding the candidate strengths with the current one boxed.
 *
 * A panel rather than a full-screen takeover (which is what the capture overlay
 * is): you hit Shift+Step 16 mid-take while watching your steps, and blanking
 * the pattern for a second to confirm a value you already chose would be
 * disorienting. The box geometry is the volume overlay's, so the two read as
 * the same kind of thing. */

import { fontPrint, fontWidth, FONT_HEIGHT } from '../font/index.js';
import { BIG_FONT_HEIGHT } from '../font/big.js';
import { drawValueRow, SEL_BOX_PAD } from './value-row.js';
import type { QuantOverlayVM } from '../seq/quant-overlay.js';

/* Volume's box inset, but taller: this panel stacks a title, an 11px value row
 * and a marker row, where volume has a title, a bar and two small labels.
 * Vertically centred on the 64px screen, clear of the header and toast bands. */
const BOX_X = 4, BOX_Y = 12, BOX_W = 120, BOX_H = 40;
/* Frame → content on every edge. The title and the marker each sit one row
 * inside that, so the box breathes the same amount top and bottom. */
const PAD = 4;
const TITLE_Y = BOX_Y + PAD;                                  // 5px row
const MARK = 'DEF';

/* The band the values (and the marker under them) live in, measured from the
 * frame so the box breathes equally top and bottom. */
const BAND_TOP = TITLE_Y + FONT_HEIGHT + 2;
const BAND_BOTTOM = BOX_Y + BOX_H - PAD;
const SEL_H = BIG_FONT_HEIGHT + SEL_BOX_PAD * 2;
const MARK_H = FONT_HEIGHT + 1;   // marker row plus the gap above it

/* Without a marker there is nothing to reserve the bottom row for, so the
 * values centre in the band instead of leaving it visibly bottom-heavy. */
function selBoxTop(marked: boolean): number {
    const used = SEL_H + (marked ? MARK_H : 0);
    return BAND_TOP + Math.floor(((BAND_BOTTOM - BAND_TOP) - used) / 2);
}

export function drawQuantOverlay(vm: QuantOverlayVM): void {
    // Cleared field inside a 1px frame — the volume overlay's construction, so
    // the panel sits on top of the view rather than blending into it.
    fill_rect(BOX_X, BOX_Y, BOX_W, BOX_H, 0);
    fill_rect(BOX_X, BOX_Y, BOX_W, 1, 1);
    fill_rect(BOX_X, BOX_Y + BOX_H - 1, BOX_W, 1, 1);
    fill_rect(BOX_X, BOX_Y, 1, BOX_H, 1);
    fill_rect(BOX_X + BOX_W - 1, BOX_Y, 1, BOX_H, 1);

    const title = 'T' + (vm.track + 1) + ' QUANTIZE';
    fontPrint(BOX_X + Math.floor((BOX_W - fontWidth(title)) / 2), TITLE_Y, title, 1);

    const marked = vm.defIdx >= 0 && vm.defIdx < vm.values.length;
    const boxTop = selBoxTop(marked);
    const { slotX, widths } = drawValueRow(
        vm.values, vm.selIdx, boxTop + SEL_BOX_PAD, undefined, BOX_X + 1, BOX_W - 2);

    /* The default needs its own channel: the inverted box is already spoken
     * for by the selection, and the two coincide in the common case. */
    if (marked) {
        const markX = slotX[vm.defIdx] + Math.floor((widths[vm.defIdx] - fontWidth(MARK)) / 2);
        fontPrint(markX, boxTop + SEL_H + 1, MARK, 1);
    }
}
