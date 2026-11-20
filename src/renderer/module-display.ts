/* A module's waveform overview on the main screen (keyboard/module-feedback.ts
 * `display_param`). 128 px = 128 peaks, one column each, mirrored around the
 * centre line; the playhead is a 1 px line with a 1 px black gap either side so
 * it stays visible through a loud passage on the 1-bit OLED. `mark` / `end` (>= 0) are a
 * module's start / end markers, see below. Header: the
 * track and the module's own text ("PLAY 1 - 4 BARS"), inverted bar. */

import { fontWidth } from '../font/index.js';
import { drawHeader } from './header.js';
import { W } from './layout.js';
import type { DisplayState } from '../keyboard/module-feedback.js';

export const WAVE_TOP = 9;
export const WAVE_BOTTOM = 56;                         // inclusive; rows 57+ belong to toasts and the Loop strip
export const WAVE_MID = Math.floor((WAVE_TOP + WAVE_BOTTOM) / 2);
export const WAVE_HALF = WAVE_MID - WAVE_TOP;

/** Column height (half-extent) a peak byte draws at. Pure, for the logic suite. */
export function waveHalfHeight(peak: number): number {
    if (peak <= 0) return 0;
    return Math.max(1, Math.round((peak / 255) * WAVE_HALF));
}

export function drawModuleDisplay(d: DisplayState, track: number): void {
    clear_screen();
    let text = d.header;
    const left = 'T' + (track + 1);
    while (text.length > 1 && fontWidth(left) + fontWidth(text) + 10 > W) text = text.slice(0, -1);
    drawHeader(left, text, true);
    if (!d.peaks) {
        for (let x = 0; x < W; x += 2) fill_rect(x, WAVE_MID, 1, 1, 1);   // nothing to draw: a dotted baseline
        return;
    }
    for (let x = 0; x < W; x++) {
        const h = waveHalfHeight(d.peaks[x]);
        fill_rect(x, WAVE_MID - h, 1, 2 * h + 1, 1);
    }
    const px = d.pos;
    if (px > 0) fill_rect(px - 1, WAVE_TOP, 1, WAVE_BOTTOM - WAVE_TOP + 1, 0);
    if (px < W - 1) fill_rect(px + 1, WAVE_TOP, 1, WAVE_BOTTOM - WAVE_TOP + 1, 0);
    fill_rect(px, WAVE_TOP, 1, WAVE_BOTTOM - WAVE_TOP + 1, 1);
    /* Start marker (a module's clip start): a dotted column with a flag on top
     * and a foot at the bottom, drawn over the playhead's gaps so both read. */
    if (d.mark >= 0 && d.mark < W) {
        for (let y = WAVE_TOP; y <= WAVE_BOTTOM; y += 2) fill_rect(d.mark, y, 1, 1, 1);
        fill_rect(d.mark, WAVE_TOP, Math.min(4, W - d.mark), 2, 1);
        fill_rect(d.mark, WAVE_BOTTOM - 1, Math.min(4, W - d.mark), 2, 1);
    }
    /* End marker (a module's loop end): the mirror of the start marker, its flag
     * pointing left. */
    if (d.end >= 0 && d.end < W) {
        for (let y = WAVE_TOP + 1; y <= WAVE_BOTTOM; y += 2) fill_rect(d.end, y, 1, 1, 1);
        const w = Math.min(4, d.end + 1);
        fill_rect(d.end - w + 1, WAVE_TOP, w, 2, 1);
        fill_rect(d.end - w + 1, WAVE_BOTTOM - 1, w, 2, 1);
    }
}
