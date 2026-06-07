import type { ViewModel } from '../types/viewmodel.js';
import { fontPrint } from '../font/index.js';
import { drawInvertedHeader } from './header.js';
import { W } from './layout.js';

export function drawEnumOverlay(vm: ViewModel): void {
    const ov  = vm.overlay!;
    const row = Math.floor(ov.slot / 4);
    const col = ov.slot % 4;
    const pvm = vm.rows[row]?.[col];
    const fullName = pvm ? pvm.fullName : '';
    const valueStr = ov.options[ov.selected] || String(ov.selected);

    clear_screen();
    drawInvertedHeader(fullName, valueStr);

    const LIST_TOP = 8;
    const ROW_H    = 7;
    const VISIBLE  = Math.floor((64 - LIST_TOP) / ROW_H);
    const n        = ov.options.length;
    const half     = Math.floor(VISIBLE / 2);
    const start    = Math.max(0, Math.min(ov.selected - half, n - VISIBLE));

    for (let i = 0; i < VISIBLE; i++) {
        const idx = start + i;
        if (idx >= n) break;
        const y = LIST_TOP + i * ROW_H;
        if (idx === ov.selected) {
            fill_rect(0, y, W - 2, ROW_H, 1);
            fontPrint(2, y + 1, ov.options[idx], 0);
        } else {
            fontPrint(2, y + 1, ov.options[idx], 1);
        }
    }

    if (n > VISIBLE) {
        const trackH = 64 - LIST_TOP;
        const thumbH = Math.max(3, Math.round(trackH * VISIBLE / n));
        const thumbY = LIST_TOP + Math.round((trackH - thumbH) * start / Math.max(1, n - VISIBLE));
        fill_rect(W - 1, LIST_TOP, 1, trackH, 1);
        fill_rect(W - 1, thumbY,   1, thumbH, 0);
    }
}
