/* Draws a low-cut / high-cut response. A pair spans two cells as a band-pass;
 * a lone cut fills one cell with just its corner. Geometry matches the envelope
 * graphic exactly — leftX = startCol*CELL_W+2, rightX = (startCol+cells)*CELL_W-2,
 * rowY+1..rowY+14 — so a cut and an envelope on the same page sit on the same
 * baseline. 1-bit pixels via fill_rect only. */

import { drawDottedH } from './primitives.js';
import { CELL_W } from './layout.js';

/* Keep a corner this far inside the span so it stays visible at either
 * extreme — fully open still shows the shoulder rather than a bare flat line. */
const EDGE = 0.12;
/* Transition steepness. Soft enough to read as a filter rather than a step,
 * sharp enough that a pair keeps a visible plateau between its two corners at
 * 60px; below about 20 the band-pass collapses into a single bell. */
const K = 24;
const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

export function drawCutCurve(
    rowY: number, startCol: number, cellCount: number,
    lowcut: number | null, highcut: number | null,
): void {
    const leftX = startCol * CELL_W + 2;
    const rightX = (startCol + cellCount) * CELL_W - 2;
    const baseY = rowY + 14, topY = rowY + 1;
    const span = rightX - leftX;

    drawDottedH(leftX, rightX, baseY);              // frequency axis

    const clamp = (v: number): number => EDGE + Math.max(0, Math.min(1, v)) * (1 - 2 * EDGE);
    const loC = lowcut === null ? null : clamp(lowcut);
    const hiC = highcut === null ? null : clamp(highcut);

    const gainAt = (u: number): number => {
        let g = 1;
        if (loC !== null) g *= sigmoid((u - loC) * K);
        if (hiC !== null) g *= 1 - sigmoid((u - hiC) * K);
        return g;
    };
    /* One pixel per column plus a vertical connector, as the waveform and EQ
     * curves do — a corner this steep would otherwise break into a dotted
     * diagonal at 13px of travel. */
    const yAt = (px: number): number =>
        Math.round(baseY - gainAt((px - leftX) / span) * (baseY - topY));
    let py = yAt(leftX);
    fill_rect(leftX, py, 1, 1, 1);
    for (let px = leftX + 1; px <= rightX; px++) {
        const ny = yAt(px);
        fill_rect(px, Math.min(py, ny), 1, Math.abs(ny - py) + 1, 1);
        py = ny;
    }
}
