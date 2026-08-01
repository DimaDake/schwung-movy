import { fontPrint, fontWidth } from '../font/index.js';
import { W, HEADER_H, BAR_Y } from './layout.js';

export function drawHeader(left: string, right: string | null, inverted = false): void {
    if (inverted) fill_rect(0, 0, W, HEADER_H, 1);
    const color = inverted ? 0 : 1;
    fontPrint(2, 1, left, color);
    if (right) fontPrint(W - fontWidth(right) - 2, 1, right, color);
}

/* One segment per page, the current one double height. The separators carry the
 * BANK structure: pages belonging to the same bank sit flush against each other
 * and a 1 px gap marks where the next bank starts, so the bar shows the same
 * grouping Shift+jog steps through. `groups` is one bank id per page; without it
 * every page is its own bank (the chain view's slot strip).
 *
 * A gap is a separator, never a spacer — it is 1 px or nothing. Leftover pixels
 * go into the SEGMENTS, spread by floor difference so no two differ by more than
 * 1 px: never a 2 px gap, never one long segment, never a margin. The bar always
 * spans the full width.
 */
export function drawBankBar(
    bankIndex: number, bankCount: number, dottedFirst = false, groups?: number[],
): void {
    if (bankCount <= 1) return;

    /* Past one pixel per page a ruler cannot exist. Show the position on a
     * full-width line instead of a bar that lies about the page count. */
    if (bankCount > W) {
        fill_rect(0, BAR_Y, W, 1, 1);
        const x = Math.min(W - 1, Math.floor(bankIndex * W / bankCount));
        fill_rect(x, BAR_Y, 1, 2, 1);
        return;
    }

    /* gap[b] = 1 when a separator precedes page b — i.e. b starts a new bank. */
    const gap = new Array<number>(bankCount).fill(0);
    const useGroups = !!groups && groups.length === bankCount;
    const bounds: number[] = [];
    for (let b = 1; b < bankCount; b++) {
        if (!useGroups || groups![b] !== groups![b - 1]) bounds.push(b);
    }

    /* Every page needs a pixel before any separator does, so thin the
     * separators out — evenly, not by dropping the tail — when they do not fit. */
    const keep = Math.min(bounds.length, Math.max(0, W - bankCount));
    for (let i = 0; i < keep; i++) gap[bounds[Math.floor(i * bounds.length / keep)]] = 1;

    const area = W - keep;                                   // pixels left for segments
    const edge = (b: number): number => Math.floor(b * area / bankCount);

    let x = 0;
    for (let b = 0; b < bankCount; b++) {
        x += gap[b];
        const segW = edge(b + 1) - edge(b);
        const h    = b === bankIndex ? 2 : 1;
        if (dottedFirst && b === 0) {
            // Step page indicator: dotted segment (every other pixel), double
            // height when selected.
            for (let px = x; px < x + segW; px += 2) fill_rect(px, BAR_Y, 1, h, 1);
        } else {
            fill_rect(x, BAR_Y, segW, h, 1);
        }
        x += segW;
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
