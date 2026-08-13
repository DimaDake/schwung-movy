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
import { gainAt, EDGE } from './filter-curve.js';

/* Half the guaranteed gap between a PAIR's two corners, as a fraction of the
 * span. With EDGE at 0.10 this gives the low cut [0.10, 0.40] and the high cut
 * [0.60, 0.90] — always at least a fifth of the span left open between them. */
const GAP = 0.10;

/* gainAt maps its 0..1 argument to a corner at EDGE + c*(1-2*EDGE). To land a
 * corner at `target` instead, hand it the value that transform inverts to. */
const atSpan = (target: number): number => (target - EDGE) / (1 - 2 * EDGE);

/* When both corners are present they are squeezed into opposite halves so they
 * can never cross. Letting them meet costs information rather than showing it:
 * a low cut fully up against a high cut fully down collapses the curve onto the
 * floor, and a flat floor says nothing about where EITHER knob sits — which is
 * exactly the state a reverb's LoCut/HiCut sit in when someone sweeps them. The
 * corners still move over their whole travel; only the span they map onto
 * shrinks, and the label under each knob carries the real value. */
const pairLow  = (v: number): number => atSpan(EDGE + v * (0.5 - GAP - EDGE));
const pairHigh = (v: number): number => atSpan(0.5 + GAP + v * (1 - EDGE - 0.5 - GAP));

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

    /* A lone cut has nothing to cross, so it keeps the full span. */
    const both = lowcut !== null && highcut !== null;
    const loC = lowcut === null ? null : (both ? pairLow(lowcut) : lowcut);
    const hiC = highcut === null ? null : (both ? pairHigh(highcut) : highcut);

    const response = (u: number): number => {
        /* Resonance is 0: these params are a corner and nothing else — there is
         * no Q knob to read, so inventing a bump would show a filter the module
         * does not have. */
        const hp = loC === null ? 1 : gainAt(u, 'hp', loC, 0, false);
        const lp = hiC === null ? 1 : gainAt(u, 'lp', hiC, 0, false);
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
