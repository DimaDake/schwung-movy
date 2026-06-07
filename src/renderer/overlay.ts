import type { ViewModel } from '../types/viewmodel.js';
import { fontPrint } from '../font/index.js';
import { W, ROW0_Y, LBL0_Y, ROW1_Y, LBL1_Y, LBL_H } from './layout.js';

export function drawEnumOverlay(vm: ViewModel): void {
    const ov  = vm.overlay!;
    const row = Math.floor(ov.slot / 4);
    const rowTop = row === 0 ? ROW0_Y : ROW1_Y;
    const rowH   = (row === 0 ? LBL0_Y : LBL1_Y) + LBL_H - rowTop;

    fill_rect(0, rowTop, W, rowH, 0);

    const ROW_H   = 7;
    const VISIBLE = 3;
    const n       = ov.options.length;
    const half    = Math.floor(VISIBLE / 2);
    const start   = Math.max(0, Math.min(ov.selected - half, n - VISIBLE));
    const listTop = rowTop + Math.floor((rowH - VISIBLE * ROW_H) / 2);

    for (let i = 0; i < VISIBLE; i++) {
        const idx = start + i;
        if (idx >= n) break;
        const y = listTop + i * ROW_H;
        if (idx === ov.selected) {
            fill_rect(0, y, W - 2, ROW_H, 1);
            fontPrint(2, y + 1, ov.options[idx], 0);
        } else {
            fontPrint(2, y + 1, ov.options[idx], 1);
        }
    }

    if (n > VISIBLE) {
        const trackH = VISIBLE * ROW_H;
        const thumbH = Math.max(3, Math.round(trackH * VISIBLE / n));
        const thumbY = listTop + Math.round((trackH - thumbH) * start / Math.max(1, n - VISIBLE));
        fill_rect(W - 1, listTop, 1, trackH, 1);
        fill_rect(W - 1, thumbY,  1, thumbH, 0);
    }
}
