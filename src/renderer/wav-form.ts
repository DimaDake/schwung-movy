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
    /* Full cell width, unlike the other graphics. They inset 1-2px so adjacent
     * curves stay visually separate; a waveform has no neighbour to collide
     * with (it owns every cell it spans) and every pixel is another slice of
     * the sample, so the padding was pure lost resolution. */
    const x0 = viz.startCol * CELL_W;
    const x1 = (viz.startCol + viz.cellCount) * CELL_W;
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
        const v = pts[Math.min(pts.length - 1, i)] ?? 0;
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
    const mi = Math.min(w - 1, Math.floor(Math.max(0, Math.min(1, viz.position)) * w));
    const h = halfAt(mi), mx = x0 + mi;
    fill_rect(mx, midY - h, 1, 2 * h + 1, 0);                       // cut the sample out
    if (midY - h > topY) fill_rect(mx, topY, 1, (midY - h) - topY, 1);
    if (midY + h < botY) fill_rect(mx, midY + h + 1, 1, botY - (midY + h), 1);
}
