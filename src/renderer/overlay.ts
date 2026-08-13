import type { ViewModel } from '../types/viewmodel.js';
import { fontPrint, fontWidth } from '../font/index.js';
import { CELL_W, ROW0_Y, LBL1_Y, LBL_H, W, TOAST_Y, TOAST_H } from './layout.js';
import { drawWave } from './lfo-wave.js';

// Centred toast bar at the bottom — inverted so it reads over any content below
export function drawJogToast(text: string): void {
    fill_rect(0, TOAST_Y, W, TOAST_H, 1);
    const tw = fontWidth(text);
    const tx = Math.max(1, Math.floor((W - tw) / 2));
    fontPrint(tx, TOAST_Y + 1, text, 0);
}

/* Waveform gutter geometry. 13×5 at ONE cycle: at two cycles sine and triangle
 * collapse into the same squiggle at this height, and a 7px-tall glyph bleeds
 * into the neighbouring row and gets clipped by the selection bar. The 16px
 * gutter still leaves 78px of text, which fits the longest option names. */
const GLYPH_W = 13, GLYPH_H = 5, GUTTER = 16;

export function drawEnumOverlay(vm: ViewModel): void {
    const ov  = vm.overlay!;
    // Cols 0,1 → left 3 columns; cols 2,3 → right 3 columns
    const ovX = (ov.slot % 4) < 2 ? 0 : CELL_W;
    const ovW = 3 * CELL_W;
    const ovY = ROW0_Y;
    const ovH = LBL1_Y + LBL_H - ROW0_Y;

    fill_rect(ovX, ovY, ovW, ovH, 0);

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
        const sel = idx === ov.selected;
        if (sel) fill_rect(ovX, y, ovW - 2, ROW_H, 1);
        if (ov.shapeIds) {
            /* Drawn in the row's FOREGROUND colour so it inverts along with the
             * text. Drawing it lit and then inverting the gutter erases it. */
            drawWave(ovX + 2, y + Math.floor((ROW_H - GLYPH_H) / 2),
                     GLYPH_W, GLYPH_H, ov.shapeIds[idx] ?? 10, 1, sel ? 0 : 1);
        }
        fontPrint(ovX + (ov.shapeIds ? GUTTER : 2), y + 1, ov.options[idx], sel ? 0 : 1);
    }

    if (n > VISIBLE) {
        const trackH = VISIBLE * ROW_H;
        const thumbH = Math.max(3, Math.round(trackH * VISIBLE / n));
        const thumbY = listTop + Math.round((trackH - thumbH) * start / Math.max(1, n - VISIBLE));
        fill_rect(ovX + ovW - 1, listTop, 1, trackH, 1);
        fill_rect(ovX + ovW - 1, thumbY,  1, thumbH, 0);
    }
}
