/* Draws a sample's peak envelope with a position marker, in place of the knob
 * widgets it spans. Mirrored around a centre line, one column per pixel.
 *
 * The marker is the envelope's COMPLEMENT in its own column: the sample is
 * cleared there and the space around it is lit. That inverts it over the
 * waveform without ever reading the framebuffer back — and it is
 * self-correcting, which is the point. Through a quiet passage the marker is a
 * tall bright line; through a loud one it becomes a dark notch cut into the
 * body. Either way it is the highest-contrast thing in the column. */

import type { WavVizVM } from '../types/viewmodel.js';
import { CELL_W } from './layout.js';

export function drawWavForm(rowY: number, viz: WavVizVM): void {
    /* Inset 1px per side, the same as the filter and LFO graphics. A waveform
     * does own every cell it spans, but it is not always alone on the line —
     * mrsample seats a filter curve directly beside it — and without the inset
     * the two drawings run together into one shape. Two pixels out of sixty is
     * a cheaper price than an ambiguous picture. */
    const x0 = viz.startCol * CELL_W + 1;
    const x1 = (viz.startCol + viz.cellCount) * CELL_W - 1;
    const w = x1 - x0;
    const topY = rowY + 1, botY = rowY + 14;
    const midY = Math.round((topY + botY) / 2);
    const amp = Math.min(midY - topY, botY - midY);
    const pts = viz.points;

    const halfAt = (i: number): number => {
        if (pts.length === 0) return 0;
        /* points are computed at exactly `w` columns, but a partial job or a
         * width change can leave a shorter array — index defensively rather
         * than draw garbage. */
        const v = (pts[Math.min(pts.length - 1, i)] ?? 0) * viz.gain;
        return Math.round(Math.max(0, Math.min(1, v)) * amp);
    };

    for (let i = 0; i < w; i++) {
        const h = halfAt(i);
        if (h <= 0) fill_rect(x0 + i, midY, 1, 1, 1);
        else fill_rect(x0 + i, midY - h, 1, 2 * h + 1, 1);
    }

    /* Same mapping the envelope itself uses: column i covers the frames
     * [i/w, (i+1)/w) of the sample, so the marker belongs in floor(p*w). The
     * obvious round(p*(w-1)) disagrees with that for a quarter of all positions
     * and lands a pixel off the column that will actually play. */
    /* Loop bounds first, so the playback cursor is drawn ON TOP of them — the
     * cursor is the thing that moves and the thing you are usually looking for.
     * Brackets face INWARD (the tips point at the looped region), which is how
     * you tell a start from an end without a label. */
    const colOf = (p: number): number =>
        Math.min(w - 1, Math.floor(Math.max(0, Math.min(1, p)) * w));
    const bracket = (p: number | undefined, opening: boolean): void => {
        if (p === undefined) return;
        const bx = x0 + colOf(p);
        fill_rect(bx, topY, 1, botY - topY + 1, 1);          // the stem
        const dir = opening ? 1 : -1;                         // tips point inward
        const tipX = bx + dir;
        if (tipX >= x0 && tipX < x1) {
            fill_rect(tipX, topY, 1, 2, 1);
            fill_rect(tipX, botY - 1, 1, 2, 1);
        }
    };
    bracket(viz.loopStart, true);
    bracket(viz.loopEnd, false);

    const mi = Math.min(w - 1, Math.floor(Math.max(0, Math.min(1, viz.position)) * w));
    const h = halfAt(mi), mx = x0 + mi;
    fill_rect(mx, midY - h, 1, 2 * h + 1, 0);                       // cut the sample out
    if (midY - h > topY) fill_rect(mx, topY, 1, (midY - h) - topY, 1);
    if (midY + h < botY) fill_rect(mx, midY + h + 1, 1, botY - (midY + h), 1);
}
