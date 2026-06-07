import { fontPrint, fontWidth } from '../font/index.js';
import { W, HEADER_H, BAR_Y } from './layout.js';

export function drawHeader(left: string, right: string | null, inverted = false): void {
    if (inverted) fill_rect(0, 0, W, HEADER_H, 1);
    const color = inverted ? 0 : 1;
    fontPrint(2, 1, left, color);
    if (right) fontPrint(W - fontWidth(right) - 2, 1, right, color);
}

export function drawBankBar(bankIndex: number, bankCount: number): void {
    if (bankCount <= 1) return;
    const segW = Math.floor((W - (bankCount - 1)) / bankCount);
    for (let b = 0; b < bankCount; b++) {
        const sx = b * (segW + 1);
        const sw = b === bankCount - 1 ? W - sx : segW;
        const h  = b === bankIndex ? 2 : 1;
        fill_rect(sx, BAR_Y, sw, h, 1);
    }
}
