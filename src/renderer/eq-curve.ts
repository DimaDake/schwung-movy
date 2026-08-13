/* Draws an EQ response curve across a band group's 2-3 cells, in place of those
 * knob widgets — the EQ analogue of drawFilterCurve. Low is a shelf, high is a
 * shelf, mid is a bell; the dotted line is 0 dB, so a cut reads as clearly as a
 * boost. 1-bit pixels via fill_rect only; the label cells below are untouched. */

import type { EqVizVM } from '../types/viewmodel.js';
import { drawDottedH } from './primitives.js';
import { CELL_W } from './layout.js';

/* Band weights across the span (u = 0..1). The shelves are logistic so they
 * flatten at the edges the way a real shelving filter does, and the mid bell
 * sits between their shoulders. They overlap deliberately: two adjacent bands
 * pushing the same way should reinforce rather than draw a step. */
const shelfLow  = (u: number): number => 1 / (1 + Math.exp((u - 0.28) * 11));
const shelfHigh = (u: number): number => 1 / (1 + Math.exp((0.72 - u) * 11));
const bellMid   = (u: number): number => Math.exp(-(((u - 0.5) / 0.20) ** 2));

const WEIGHT = { low: shelfLow, mid: bellMid, high: shelfHigh };

export function drawEqCurve(rowY: number, viz: EqVizVM): void {
    const x0 = viz.startCol * CELL_W + 1;
    const spanW = viz.cellCount * CELL_W - 2;
    const topY = rowY + 1, botY = rowY + 14;
    const midY = Math.round((topY + botY) / 2);
    const amp = (botY - topY) / 2;

    drawDottedH(x0, x0 + spanW, midY);            // 0 dB

    const gainAt = (u: number): number => {
        let v = 0;
        viz.bands.forEach((b, i) => { v += viz.gains[i] * WEIGHT[b](u); });
        return Math.max(-1, Math.min(1, v));
    };
    /* One pixel per column plus a vertical connector, the same way the waveform
     * silhouettes are drawn — a shelf's shoulder is steep enough that Bresenham
     * diagonals would break the line at this height. */
    const yAt = (px: number): number =>
        Math.round(midY - gainAt((px - x0) / spanW) * amp);
    let py = yAt(x0);
    fill_rect(x0, py, 1, 1, 1);
    for (let px = x0 + 1; px <= x0 + spanW; px++) {
        const ny = yAt(px);
        fill_rect(px, Math.min(py, ny), 1, Math.abs(ny - py) + 1, 1);
        py = ny;
    }
}
