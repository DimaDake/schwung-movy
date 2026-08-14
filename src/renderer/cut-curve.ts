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
import { spanX } from './layout.js';
import { gainAt, EDGE } from './filter-curve.js';

/* How far a PAIR's two corners may cross past the middle, as a fraction of the
 * span: the low cut travels [0.10, 0.66] and the high cut [0.34, 0.90].
 *
 * They still MEET and shut the band to a flat line — that state is real and
 * worth showing — but only once both knobs are near their extremes. On the raw
 * values the corners are inverted for 6 of 25 sampled positions and every one
 * of those draws the same dead floor; here it is 1, and the band closes
 * gradually (full, half, shut) rather than snapping.
 *
 * Sized against the roll-off: gainAt's corner is dropW = 0.11 wide either side,
 * so the corners must cross by at least 2*dropW to reach a true flat line.
 * Below that the band never fully shuts; well above it, the dead cases return. */
const OVERLAP = 0.32;

/* gainAt maps its 0..1 argument to a corner at EDGE + c*(1-2*EDGE). To land a
 * corner at `target` instead, hand it the value that transform inverts to. */
const atSpan = (target: number): number => (target - EDGE) / (1 - 2 * EDGE);

/* Each corner takes a little over half the span, overlapping past the middle.
 * A dead floor says nothing about where EITHER knob sits, so the travel is
 * spent on states that differ instead. The label under each knob carries the
 * real value throughout. */
const pairLow  = (v: number): number => atSpan(EDGE + v * (0.5 + OVERLAP / 2 - EDGE));
const pairHigh = (v: number): number => atSpan(0.5 - OVERLAP / 2 + v * (1 - EDGE - 0.5 + OVERLAP / 2));

export function drawCutCurve(
    rowY: number, startCol: number, cellCount: number,
    lowcut: number | null, highcut: number | null,
): void {
    const [leftX, rightXEnd] = spanX(startCol, cellCount);
    const rightX = rightXEnd - 1;
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
