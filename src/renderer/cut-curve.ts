/* Draws a low-cut / high-cut response. A pair spans two cells as the band it
 * leaves behind; a lone cut fills one cell with just its corner.
 *
 * The curve itself is the filter graphic's own algorithm (gainAt in
 * filter-curve.ts) with resonance 0: a low cut IS its 'hp' mode and a high cut
 * IS its 'lp' mode, so the corner rounds and rolls off exactly like every other
 * filter movy draws. A pair is the two intersected — the min of a high-pass and
 * a low-pass is a band-pass, which keeps both corners the shape a single cut
 * would have had.
 *
 * Geometry follows the ENVELOPE (leftX = startCol*CELL_W+2, rightX =
 * (startCol+cells)*CELL_W-2, rowY+1..rowY+14) so a cut and an envelope on the
 * same page sit on the same baseline. 1-bit pixels via fill_rect only. */

import { drawLine, drawDottedH } from './primitives.js';
import { CELL_W } from './layout.js';
import { gainAt } from './filter-curve.js';

export function drawCutCurve(
    rowY: number, startCol: number, cellCount: number,
    lowcut: number | null, highcut: number | null,
): void {
    const leftX = startCol * CELL_W + 2;
    const rightX = (startCol + cellCount) * CELL_W - 2;
    const baseY = rowY + 14, topY = rowY + 1;
    const h = baseY - topY;
    const span = rightX - leftX;

    drawDottedH(leftX, rightX, baseY);              // frequency axis

    const response = (u: number): number => {
        /* Resonance is 0: these params are a corner and nothing else — there is
         * no Q knob to read, so inventing a bump would show a filter the module
         * does not have. */
        const hp = lowcut === null ? 1 : gainAt(u, 'hp', lowcut, 0, false);
        const lp = highcut === null ? 1 : gainAt(u, 'lp', highcut, 0, false);
        return Math.min(hp, lp);
    };
    const yAt = (px: number): number => {
        const g = response((px - leftX) / span);
        return Math.max(topY, Math.min(baseY, Math.round(baseY - g * h)));
    };

    /* Skip runs lying flat on the bottom axis, exactly as drawFilterCurve does,
     * so the curve ends where it reaches the floor instead of running along it. */
    let prevX = leftX, prevY = yAt(leftX);
    for (let px = leftX + 1; px <= rightX; px++) {
        const y = yAt(px);
        if (prevY < baseY || y < baseY) drawLine(prevX, prevY, px, y);
        prevX = px; prevY = y;
    }
}
