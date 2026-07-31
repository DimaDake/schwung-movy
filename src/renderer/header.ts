import { fontPrint, fontWidth } from '../font/index.js';
import { W, HEADER_H, BAR_Y } from './layout.js';

export function drawHeader(left: string, right: string | null, inverted = false): void {
    if (inverted) fill_rect(0, 0, W, HEADER_H, 1);
    const color = inverted ? 0 : 1;
    fontPrint(2, 1, left, color);
    if (right) fontPrint(W - fontWidth(right) - 2, 1, right, color);
}

/* One segment per page, the current one double height. Param-dense modules run
 * to 70 pages (minijv), so the segment pitch has to survive down to a single
 * pixel per page:
 *
 *   - the 1 px gap between segments is dropped as soon as gaps no longer fit,
 *     because a visible page matters more than a visible separator;
 *   - every segment is the SAME width, and the leftover pixels are split either
 *     side of the bar instead of being handed to the last page — that is what
 *     made the final page's tick 2.5x longer than the rest at 13 pages, and a
 *     59 px blob next to 69 zero-width segments at 70.
 */
export function drawBankBar(bankIndex: number, bankCount: number, dottedFirst = false): void {
    if (bankCount <= 1) return;

    /* Past one pixel per page a ruler cannot exist. Show the position on a
     * full-width line instead of a bar that lies about the page count. */
    if (bankCount > W) {
        fill_rect(0, BAR_Y, W, 1, 1);
        const x = Math.min(W - 1, Math.floor(bankIndex * W / bankCount));
        fill_rect(x, BAR_Y, 1, 2, 1);
        return;
    }

    const gap   = bankCount * 2 - 1 <= W ? 1 : 0;
    const segW  = Math.max(1, Math.floor((W - (bankCount - 1) * gap) / bankCount));
    const x0    = Math.floor((W - (bankCount * segW + (bankCount - 1) * gap)) / 2);

    for (let b = 0; b < bankCount; b++) {
        const sx = x0 + b * (segW + gap);
        const h  = b === bankIndex ? 2 : 1;
        if (dottedFirst && b === 0) {
            // Step page indicator: dotted segment (every other pixel), double
            // height when selected.
            for (let x = sx; x < sx + segW; x += 2) fill_rect(x, BAR_Y, 1, h, 1);
        } else {
            fill_rect(sx, BAR_Y, segW, h, 1);
        }
    }
}

export function drawPadGridIcon(x: number, y: number, padCount: number, currentPad: number): void {
    const rows = padCount <= 8 ? 2 : 4;
    const w    = 6;
    const h    = rows + 2;
    fill_rect(x,         y,         w, 1, 1);
    fill_rect(x,         y + h - 1, w, 1, 1);
    fill_rect(x,         y,         1, h, 1);
    fill_rect(x + w - 1, y,         1, h, 1);
    if (currentPad >= 1 && currentPad <= padCount) {
        const row = Math.floor((currentPad - 1) / 4);
        const col = (currentPad - 1) % 4;
        fill_rect(x + 1 + col, y + rows - row, 1, 1, 1);
    }
}
