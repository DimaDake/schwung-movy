/* Undo / redo toast: a boxed three-line overlay over whatever view is up.
 *
 * Three lines rather than movy's usual one-line toast band because an undo has
 * to say three things — that it happened, what it was, and where — and a single
 * 128 px row cannot hold all three without abbreviating past legibility. */

import { fontPrint, fontWidth, FONT_HEIGHT } from '../font/index.js';
import type { UndoToastVM } from '../undo/label.js';

const BOX_X = 4, BOX_Y = 14, BOX_W = 120, BOX_H = 38;
const PAD = 5;
const LINE_H = 10;
const HEAD_H = LINE_H + 3;
/* Fixed height, body centred in what is left. A box that shrank to its content
 * ended up half-covering a row of the view beneath it, which looked broken;
 * a stable box with one line centred reads as deliberate. */

/** Trim to fit the box, dropping whole characters (an ellipsis costs more
 *  width than the character it saves at this size). */
function fit(s: string, maxW: number): string {
    if (fontWidth(s) <= maxW) return s;
    let out = s;
    while (out.length > 1 && fontWidth(out) > maxW) out = out.slice(0, -1);
    return out;
}

export function drawUndoOverlay(vm: UndoToastVM): void {
    const body = [vm.verb, vm.detail].filter((s) => s.length > 0);

    fill_rect(BOX_X, BOX_Y, BOX_W, BOX_H, 0);
    fill_rect(BOX_X, BOX_Y, BOX_W, 1, 1);
    fill_rect(BOX_X, BOX_Y + BOX_H - 1, BOX_W, 1, 1);
    fill_rect(BOX_X, BOX_Y, 1, BOX_H, 1);
    fill_rect(BOX_X + BOX_W - 1, BOX_Y, 1, BOX_H, 1);

    const innerW = BOX_W - PAD * 2;

    /* The head reads as a label, not as content, so it is inverted — the same
     * signal drawInvertedHeader uses for the page header. */
    const headY = BOX_Y + 3;
    fill_rect(BOX_X + 1, headY - 1, BOX_W - 2, FONT_HEIGHT + 3, 1);
    fontPrint(BOX_X + PAD, headY + 1, fit(vm.head, innerW), 0);

    const bodyTop = BOX_Y + HEAD_H;
    const bodyH = BOX_H - HEAD_H - 2;
    const top = bodyTop + Math.floor((bodyH - body.length * LINE_H) / 2) + 1;
    for (let i = 0; i < body.length; i++) {
        fontPrint(BOX_X + PAD, top + i * LINE_H, fit(body[i], innerW), 1);
    }
}
