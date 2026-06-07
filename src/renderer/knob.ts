import type { ParamVM } from '../types/viewmodel.js';
import { CELL_W, KW, LBL_H } from './layout.js';
import { fontPrint, fontWidth } from '../font/index.js';
import { fontPrint5x3, fontWidth5x3 } from '../font/index5x3.js';
import { autoShorten, enumSquareLines } from './shorten.js';

function drawCircleBorder(cx: number, cy: number, r: number): void {
    let x = r, y = 0, err = 0;
    while (x >= y) {
        fill_rect(cx + x, cy + y, 1, 1, 1); fill_rect(cx + y, cy + x, 1, 1, 1);
        fill_rect(cx - y, cy + x, 1, 1, 1); fill_rect(cx - x, cy + y, 1, 1, 1);
        fill_rect(cx - x, cy - y, 1, 1, 1); fill_rect(cx - y, cy - x, 1, 1, 1);
        fill_rect(cx + y, cy - x, 1, 1, 1); fill_rect(cx + x, cy - y, 1, 1, 1);
        y++;
        if (err <= 0) { err += 2 * y + 1; }
        if (err > 0)  { x--; err -= 2 * x + 1; }
    }
}

function drawLine(x0: number, y0: number, x1: number, y1: number): void {
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    while (true) {
        fill_rect(x0, y0, 1, 1, 1);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
    }
}

function drawRegularKnob(kx: number, ky: number, normVal: number): void {
    const cx = kx + 7, cy = ky + 7, r = 7;
    drawCircleBorder(cx, cy, r);
    const angleDeg = 210 + normVal * 300;
    const rad = angleDeg * Math.PI / 180;
    const ex = Math.round(cx + r * Math.sin(rad));
    const ey = Math.round(cy - r * Math.cos(rad));
    drawLine(cx, cy, ex, ey);
}

function drawEnumSquare(kx: number, ky: number, options: string[] | null, enumIndex: number): void {
    fill_rect(kx, ky, KW, 1, 1);
    fill_rect(kx, ky + KW - 1, KW, 1, 1);
    fill_rect(kx, ky, 1, KW, 1);
    fill_rect(kx + KW - 1, ky, 1, KW, 1);
    const raw = options ? (options[enumIndex] ?? String(enumIndex)) : String(enumIndex);
    const [line1, line2] = enumSquareLines(raw);
    const inner = KW - 2;
    const totalH = 11;
    const startY = ky + 1 + Math.floor((inner - totalH) / 2);
    const l1w = fontWidth5x3(line1), l2w = fontWidth5x3(line2);
    fontPrint5x3(kx + 1 + Math.floor((inner - l1w) / 2), startY,     line1, 1);
    fontPrint5x3(kx + 1 + Math.floor((inner - l2w) / 2), startY + 6, line2, 1);
}

export function drawLongEnumCell(col: number, rowY: number, lblY: number, pvm: ParamVM): void {
    const kx    = col * CELL_W;
    const cellH = lblY + LBL_H - rowY;
    const ROW_H = 7;
    const startY = rowY + Math.floor((cellH - 3 * ROW_H) / 2);
    const opts  = pvm.options ?? [];
    const sel   = pvm.enumIndex;
    const maxW  = CELL_W - 4;

    for (let i = -1; i <= 1; i++) {
        const idx = sel + i;
        const y   = startY + (i + 1) * ROW_H;
        if (idx < 0 || idx >= opts.length) continue;
        const text = autoShorten(opts[idx], 7);
        const tw   = fontWidth(text);
        const tx   = kx + 2 + Math.max(0, Math.floor((maxW - tw) / 2));
        if (i === 0) {
            fill_rect(kx, y, CELL_W, ROW_H, 1);
            fontPrint(tx, y + 1, text, 0);
        } else {
            fontPrint(tx, y + 1, text, 1);
        }
    }
}

export function drawKnobWidget(col: number, rowY: number, pvm: ParamVM): void {
    const kx = col * CELL_W + Math.floor((CELL_W - KW) / 2);
    const ky = rowY;
    if (pvm.type === 'enum') {
        drawEnumSquare(kx, ky, pvm.options, pvm.enumIndex);
    } else {
        drawRegularKnob(kx, ky, pvm.normalizedValue);
    }
}
