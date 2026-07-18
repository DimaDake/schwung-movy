/* Draws a filter-response curve across two knob cells (cutoff+resonance) in place
 * of the two knob widgets — the filter analogue of drawLfoWave/drawEnvelope. The
 * corner/feature sits at the cutoff's x-position; resonance sets the bump/dip
 * magnitude. 1-bit pixels via fill_rect only; the label cells below are untouched. */

import type { FilterVizVM } from '../types/viewmodel.js';
import { drawLine, drawDottedH } from './primitives.js';
import { CELL_W } from './layout.js';

const PASS  = 0.62;   // nominal pass-band gain (0..1 of the cell height)
const FLOOR = 0.04;   // stop-band gain — sits just above the frequency axis
/* Keep the corner this far inside the span (fraction of width) so the roll-off
 * stays visible even fully open/closed — never a bare flat line. */
const EDGE  = 0.10;
const bump  = (u: number, c: number, w: number) => Math.exp(-(((u - c) * w) ** 2));

/* Gain 0..1 at horizontal position u (0..1 across the span) for the given mode.
 * cutoff c = corner/feature position; reso r = bump/dip magnitude; steep = 24 dB.
 * lp/hp roll off with a near-vertical drop (large slope) at the corner. */
function gainAt(u: number, mode: FilterVizVM['mode'], c: number, r: number, steep: boolean): number {
    const cx   = EDGE + c * (1 - 2 * EDGE);   // corner clamped inside the span
    const drop = steep ? 26 : 15;             // gain lost per unit-u past the corner (steep = near-vertical)
    const qw   = 9 - r * 3;                    // resonance narrows the peak
    const peakG = r * (1 - PASS) * bump(u, cx, qw);
    switch (mode) {
        case 'lp': {
            const base = u <= cx ? PASS : Math.max(FLOOR, PASS - (u - cx) * drop);
            return Math.min(1, base + peakG);
        }
        case 'hp': {
            const base = u >= cx ? PASS : Math.max(FLOOR, PASS - (cx - u) * drop);
            return Math.min(1, base + peakG);
        }
        case 'bp':
            return Math.min(1, FLOOR + (PASS + r * (1 - PASS)) * bump(u, cx, 5 + r * 4));
        case 'notch':
            return Math.max(FLOOR, PASS - PASS * (0.5 + 0.5 * r) * bump(u, cx, 7));
        case 'peak':
            return Math.min(1, PASS * 0.7 + (0.3 + 0.6 * r) * (1 - PASS * 0.7) * bump(u, cx, 6));
        case 'ap':
        case 'off':
        default:
            return PASS;
    }
}

export function drawFilterCurve(rowY: number, viz: FilterVizVM): void {
    const x0 = viz.startCol * CELL_W + 1;
    const spanW = 2 * CELL_W - 2;             // 62px
    const topY = rowY + 1, botY = rowY + 14;
    const h = botY - topY;

    drawDottedH(x0, x0 + spanW, botY);        // frequency axis

    if (viz.mode === 'ap' || viz.mode === 'off') {
        const y = Math.round(botY - PASS * h);
        drawDottedH(x0, x0 + spanW, y);       // flat line — no spectral shape
        return;
    }

    const steep = viz.slope === 1;
    const yAt = (px: number): number => {
        const u = (px - x0) / spanW;
        const g = gainAt(u, viz.mode, viz.cutoff, viz.resonance, steep);
        return Math.max(topY, Math.min(botY, Math.round(botY - g * h)));
    };

    let prevX = x0, prevY = yAt(x0);
    for (let px = x0 + 1; px <= x0 + spanW; px++) {
        const y = yAt(px);
        drawLine(prevX, prevY, px, y);
        prevX = px; prevY = y;
    }
}
