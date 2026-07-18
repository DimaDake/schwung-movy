/* Draws a filter-response curve across two knob cells (cutoff+resonance) in place
 * of the two knob widgets — the filter analogue of drawLfoWave/drawEnvelope. The
 * corner/feature sits at the cutoff's x-position; resonance sets the bump/dip
 * magnitude. 1-bit pixels via fill_rect only; the label cells below are untouched. */

import type { FilterVizVM } from '../types/viewmodel.js';
import { drawLine, drawDottedH } from './primitives.js';
import { CELL_W } from './layout.js';

const PASS = 0.62;    // nominal pass-band gain (0..1 of the cell height)
/* Keep the corner this far inside the span (fraction of width) so the roll-off
 * stays visible even fully open/closed — never a bare flat line. */
const EDGE = 0.10;
const bump = (u: number, c: number, w: number) => Math.exp(-(((u - c) * w) ** 2));

/* Gain 0..1 at horizontal position u (0..1 across the span) for the given mode.
 * cutoff c = corner position; reso r = bump magnitude; steep = 24 dB. The lp/hp
 * roll-off is a quarter-ellipse: rounded (flat-tangent) at the corner, near-
 * vertical where it meets the floor, and 0 beyond — so the line ends at the
 * bottom axis instead of running on as a floor. */
function gainAt(u: number, mode: FilterVizVM['mode'], c: number, r: number, steep: boolean): number {
    const cx    = EDGE + c * (1 - 2 * EDGE);   // corner clamped inside the span
    const dropW = steep ? 0.07 : 0.11;         // horizontal width of the roll-off
    const pk    = r * (1 - PASS);              // resonance peak above the passband
    const top   = PASS + pk;
    // Quarter ellipse from the peak (dist 0) down to 0 (dist ≥ dropW).
    const ellipse = (dist: number): number => {
        const t = dist / dropW;
        return t >= 1 ? 0 : top * Math.sqrt(1 - t * t);
    };
    // Rounded rise from the passband up to the resonance peak.
    const shoulder = (dist: number): number => PASS + pk * bump(dist, 0, 8);
    switch (mode) {
        case 'lp': return u <= cx ? shoulder(cx - u) : ellipse(u - cx);
        case 'hp': return u >= cx ? shoulder(u - cx) : ellipse(cx - u);
        case 'bp': return Math.min(1, top * bump(u, cx, 5 + r * 4));
        case 'notch': return Math.max(0, PASS - PASS * (0.5 + 0.5 * r) * bump(u, cx, 7));
        case 'peak': return Math.min(1, PASS * 0.7 + (0.3 + 0.6 * r) * (1 - PASS * 0.7) * bump(u, cx, 6));
        case 'ap':
        case 'off':
        default: return PASS;
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
        const g = gainAt((px - x0) / spanW, viz.mode, viz.cutoff, viz.resonance, steep);
        return Math.max(topY, Math.min(botY, Math.round(botY - g * h)));
    };

    // Draw the response line, but skip runs that lie flat on the bottom axis so
    // the curve ends where it reaches the floor instead of continuing along it.
    let prevX = x0, prevY = yAt(x0);
    for (let px = x0 + 1; px <= x0 + spanW; px++) {
        const y = yAt(px);
        if (prevY < botY || y < botY) drawLine(prevX, prevY, px, y);
        prevX = px; prevY = y;
    }
}
