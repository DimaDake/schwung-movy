import type { ViewModel } from '../types/viewmodel.js';
import { fontPrint } from '../font/index.js';
import { CELL_W, ROW0_Y, LBL1_Y, LBL_H } from './layout.js';

export function drawEnumOverlay(vm: ViewModel): void {
    const ov  = vm.overlay!;
    // Cols 0,1 → left 3 columns; cols 2,3 → right 3 columns
    const ovX = (ov.slot % 4) < 2 ? 0 : CELL_W;
    const ovW = 3 * CELL_W;
    const ovY = ROW0_Y;
    const ovH = LBL1_Y + LBL_H - ROW0_Y;

    fill_rect(ovX, ovY, ovW, ovH, 0);

    if (ov.waveform) {
        const midY = ovY + Math.floor(ovH / 2);
        const maxH = Math.floor(ovH / 2) - 1;
        for (let i = 0; i < ov.waveform.length && i < ovW; i++) {
            const h = Math.max(1, Math.round(ov.waveform[i] * maxH));
            fill_rect(ovX + i, midY - h, 1, h * 2, 1);
        }
        return;
    }

    const ROW_H   = 7;
    const VISIBLE = Math.floor(ovH / ROW_H);
    const n       = ov.options.length;
    const half    = Math.floor(VISIBLE / 2);
    const start   = Math.max(0, Math.min(ov.selected - half, n - VISIBLE));
    const listTop = ovY + Math.floor((ovH - VISIBLE * ROW_H) / 2);

    for (let i = 0; i < VISIBLE; i++) {
        const idx = start + i;
        if (idx >= n) break;
        const y = listTop + i * ROW_H;
        if (idx === ov.selected) {
            fill_rect(ovX, y, ovW - 2, ROW_H, 1);
            fontPrint(ovX + 2, y + 1, ov.options[idx], 0);
        } else {
            fontPrint(ovX + 2, y + 1, ov.options[idx], 1);
        }
    }

    if (n > VISIBLE) {
        const trackH = VISIBLE * ROW_H;
        const thumbH = Math.max(3, Math.round(trackH * VISIBLE / n));
        const thumbY = listTop + Math.round((trackH - thumbH) * start / Math.max(1, n - VISIBLE));
        fill_rect(ovX + ovW - 1, listTop, 1, trackH, 1);
        fill_rect(ovX + ovW - 1, thumbY,  1, thumbH, 0);
    }
}
