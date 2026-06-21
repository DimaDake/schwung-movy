import { fontPrint, fontWidth } from '../font/index.js';
import { W, HEADER_H, BAR_Y } from './layout.js';

export function drawHeader(left: string, right: string | null, inverted = false): void {
    if (inverted) fill_rect(0, 0, W, HEADER_H, 1);
    const color = inverted ? 0 : 1;
    fontPrint(2, 1, left, color);
    if (right) fontPrint(W - fontWidth(right) - 2, 1, right, color);
}

export function drawBankBar(bankIndex: number, bankCount: number, dottedFirst = false): void {
    if (bankCount <= 1) return;
    const segW = Math.floor((W - (bankCount - 1)) / bankCount);
    for (let b = 0; b < bankCount; b++) {
        const sx = b * (segW + 1);
        const sw = b === bankCount - 1 ? W - sx : segW;
        const h  = b === bankIndex ? 2 : 1;
        if (dottedFirst && b === 0) {
            // Step page indicator: dotted segment (every other pixel), double
            // height when selected.
            for (let x = sx; x < sx + sw; x += 2) fill_rect(x, BAR_Y, 1, h, 1);
        } else {
            fill_rect(sx, BAR_Y, sw, h, 1);
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
