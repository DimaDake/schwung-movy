import { fontPrint, fontWidth } from '../font/index.js';
import { W, HEADER_H, BAR_Y, BAR_H } from './layout.js';

export function drawInvertedHeader(left: string, right: string | null): void {
    fill_rect(0, 0, W, HEADER_H, 1);
    fontPrint(2, 1, left, 0);
    if (right) fontPrint(W - fontWidth(right) - 2, 1, right, 0);
}

export function drawBankBar(bankIndex: number, bankCount: number): void {
    if (bankCount <= 1) return;
    const segW = Math.floor((W - (bankCount - 1)) / bankCount);
    for (let b = 0; b < bankCount; b++) {
        const sx = b * (segW + 1);
        const sw = b === bankCount - 1 ? W - sx : segW;
        const y  = b === bankIndex ? BAR_Y     : BAR_Y + BAR_H - 1;
        const h  = b === bankIndex ? 2         : 1;
        fill_rect(sx, y, sw, h, 1);
    }
}
