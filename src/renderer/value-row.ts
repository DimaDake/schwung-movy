/* A centred row of big-font values with one of them knocked out of a solid
 * box. Shared by the capture overlay (full screen, with an arrow between a
 * "played → set" pair) and the quantize panel (a strip over the current view),
 * so the two speak the same visual language without duplicating the layout
 * arithmetic.
 *
 * Returns each value's left edge, because a caller may need to place something
 * under a particular one — the quantize panel marks its default that way. */

import { fontPrintBig, fontWidthBig, BIG_FONT_HEIGHT } from '../font/big.js';
import { W } from './layout.js';

const GUTTER = 10;
const BOX_PAD = 2;

export interface RowSeparator {
    width: number;
    draw: (x: number, y: number) => void;
}

export interface ValueRowLayout {
    /** Left edge of each value, in the order given. */
    slotX: number[];
    widths: number[];
}

export function drawValueRow(
    values: string[], selIdx: number, y: number, sep?: RowSeparator,
): ValueRowLayout {
    const widths = values.map(fontWidthBig);
    const sepW = sep ? sep.width + GUTTER : 0;
    const total = widths.reduce((a, b) => a + b, 0) + GUTTER * (widths.length - 1) + sepW;
    let x = Math.max(0, Math.floor((W - total) / 2));

    const slotX: number[] = [];
    for (let i = 0; i < values.length; i++) {
        if (i > 0 && sep) {
            sep.draw(x, y + Math.floor((BIG_FONT_HEIGHT - 5) / 2));
            x += sep.width + GUTTER;
        }
        slotX.push(x);
        if (i === selIdx) {
            // Solid box, digits knocked out — the same inversion the header uses.
            fill_rect(x - BOX_PAD, y - BOX_PAD,
                      widths[i] + BOX_PAD * 2, BIG_FONT_HEIGHT + BOX_PAD * 2, 1);
            fontPrintBig(x, y, values[i], 0);
        } else {
            fontPrintBig(x, y, values[i], 1);
        }
        x += widths[i] + GUTTER;
    }
    return { slotX, widths };
}
