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
import { spanX } from './layout.js';

export function drawWavForm(rowY: number, viz: WavVizVM): void {
    const [x0, x1] = spanX(viz.startCol, viz.cellCount);
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

    /* Granular spread: the region grains are actually drawn from, as a dotted
     * fence either side of the cursor. Dotted rather than solid so it reads as
     * a boundary the cursor may wander past, not a second cursor.
     *
     * Two behaviours copied from granny's engine rather than guessed:
     *   max_offset = spray * (sample_len - 1)      -> the whole file, not a window
     *   start_idx wraps into [0, len)              -> so the fence wraps too
     * and because the offset is symmetric, ±0.5 already reaches every frame:
     * past that the region cannot grow, so the fences stop at the file edges
     * instead of drifting on and implying a spread the DSP never applies. */
    if (viz.spray !== undefined && viz.spray > 0) {
        const wrap = (f: number): number => f - Math.floor(f);
        const full = viz.spray >= 0.5;
        for (const side of [-1, 1]) {
            const at = full ? (side < 0 ? 0 : 1 - 1 / w)
                            : wrap(viz.position + side * viz.spray);
            const fx = x0 + colOf(at);
            for (let yy = topY; yy <= botY; yy++) {
                if (((yy + fx) & 1) !== 0) continue;
                const inWave = yy >= midY - halfAt(fx - x0) && yy <= midY + halfAt(fx - x0);
                fill_rect(fx, yy, 1, 1, inWave ? 0 : 1);
            }
        }
    }

    const mi = colOf(viz.position);
    const h = halfAt(mi), mx = x0 + mi;
    fill_rect(mx, midY - h, 1, 2 * h + 1, 0);                       // cut the sample out
    if (midY - h > topY) fill_rect(mx, topY, 1, (midY - h) - topY, 1);
    if (midY + h < botY) fill_rect(mx, midY + h + 1, 1, botY - (midY + h), 1);
}
