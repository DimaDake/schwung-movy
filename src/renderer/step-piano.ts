/* The held-step piano (seq/step-piano.ts) in the bottom band.
 *
 * Rows PIANO_Y..+6: two rows of black-key interior, the black keys' bottom
 * line, three rows where only white keys reach, and a bottom line. No top line:
 * the black keys hang from the band's edge. Every key is an outline and the
 * step's notes are filled; where two filled keys meet, the line between them
 * goes dark so they stay two keys.
 *
 * Drawn in runs per slot, not per pixel: the 2 px zoom is 63 slots. */

import { isBlackKey } from '../seq/piano-range.js';
import type { StepPianoVM } from '../seq/step-piano.js';

/** Clear of the lowest knob-page row (55) by one. */
export const PIANO_Y = 57;
const BLACK_LINE = PIANO_Y + 2;      // the black keys' bottom line
const WHITE_Y = PIANO_Y + 3;         // rows only white keys reach
const WHITE_H = 3;
const BOTTOM = PIANO_Y + 6;

export function drawStepPiano(vm: StepPianoVM): void {
    const { win, x0 } = vm;
    const on = (m: number): boolean => vm.sel.indexOf(m) >= 0;
    /* A line between two keys: dark only when both sides are filled. */
    const line = (x: number, y: number, w: number, h: number, a: number, b: number): void => {
        if (!(on(a) && on(b))) fill_rect(x, y, w, h, 1);
    };
    const xEnd = x0 + win.n * win.k;
    const c = Math.floor(win.k / 2);  // the white keys' split under a black key

    fill_rect(0, PIANO_Y - 1, 128, 64 - PIANO_Y + 1, 0);
    fill_rect(x0, BOTTOM, xEnd - x0 + 1, 1, 1);
    fill_rect(x0, PIANO_Y, 1, BOTTOM - PIANO_Y, 1);
    fill_rect(xEnd, PIANO_Y, 1, BOTTOM - PIANO_Y, 1);

    for (let s = 0; s < win.n; s++) {
        const m = win.lo + s, x = x0 + s * win.k, ix = x + 1, iw = win.k - 1;
        const black = isBlackKey(m);
        if (s > 0) {
            line(x, PIANO_Y, 1, 3, m - 1, m);                 // slot line, top zone
            if (!black && !isBlackKey(m - 1)) line(x, WHITE_Y, 1, WHITE_H, m - 1, m);   // E|F, B|C
            else if (on(black ? m - 1 : m)) fill_rect(x, WHITE_Y, 1, WHITE_H, 1);       // inside a white key
        }
        if (!black) {
            if (on(m)) fill_rect(ix, PIANO_Y, iw, BOTTOM - PIANO_Y, 1);
            continue;
        }
        if (on(m)) fill_rect(ix, PIANO_Y, iw, 2, 1);
        /* Under a black key: its bottom line, then the two white keys split at c. */
        if (c > 1) line(ix, BLACK_LINE, c - 1, 1, m, m - 1);
        line(x + c, BLACK_LINE, win.k - c, 1, m, m + 1);
        if (c > 1 && on(m - 1)) fill_rect(ix, WHITE_Y, c - 1, WHITE_H, 1);
        line(x + c, WHITE_Y, 1, WHITE_H, m - 1, m + 1);
        if (win.k - c > 1 && on(m + 1)) fill_rect(x + c + 1, WHITE_Y, win.k - c - 1, WHITE_H, 1);
    }
}
