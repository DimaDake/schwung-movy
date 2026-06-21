import type { ParamVM } from '../types/viewmodel.js';
import { CELL_W, KW } from './layout.js';
import { fontPrint5x3, fontWidth5x3 } from '../font/index5x3.js';
import { fontPrint, fontWidth, FONT_HEIGHT } from '../font/index.js';
import { fontPrintBig, fontWidthBig, BIG_FONT_HEIGHT } from '../font/big.js';
import { enumSquareLines } from './shorten.js';

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

function drawArcKnob(kx: number, ky: number, normVal: number): void {
    const cx = kx + 7, cy = ky + 7, r = 7;
    drawCircleBorder(cx, cy, r);
    const angleDeg = 210 + normVal * 300;
    const rad = angleDeg * Math.PI / 180;
    const ex = Math.round(cx + r * Math.sin(rad));
    const ey = Math.round(cy - r * Math.cos(rad));
    drawLine(cx, cy, ex, ey);
}

/* Horizontal bar: fills left→right — used for binary (on/off) params */
function drawHorzBar(kx: number, ky: number, normVal: number): void {
    fill_rect(kx + 1, ky + 5, 14, 1, 1);
    fill_rect(kx + 1, ky + 10, 14, 1, 1);
    fill_rect(kx + 1, ky + 5, 1, 6, 1);
    fill_rect(kx + 14, ky + 5, 1, 6, 1);
    const fillW = Math.round(normVal * 12);
    if (fillW > 0) fill_rect(kx + 2, ky + 6, fillW, 4, 1);
}

/* Vertical bar: fills bottom→up — used for mix/volume params in module configs */
function drawVertBar(kx: number, ky: number, normVal: number): void {
    fill_rect(kx + 5, ky + 1, 6, 1, 1);
    fill_rect(kx + 5, ky + 14, 6, 1, 1);
    fill_rect(kx + 5, ky + 1, 1, 14, 1);
    fill_rect(kx + 10, ky + 1, 1, 14, 1);
    const fillH = Math.round(normVal * 12);
    if (fillH > 0) fill_rect(kx + 6, ky + 2 + (12 - fillH), 4, fillH, 1);
}

function drawEnumSquare(kx: number, ky: number, options: string[] | null, enumIndex: number): void {
    fill_rect(kx, ky, KW, 1, 1);
    fill_rect(kx, ky + KW - 1, KW, 1, 1);
    fill_rect(kx, ky, 1, KW, 1);
    fill_rect(kx + KW - 1, ky, 1, KW, 1);
    const raw = options ? (options[enumIndex] ?? String(enumIndex)) : String(enumIndex);
    const [line1, line2] = enumSquareLines(raw);
    const inner  = KW - 2;
    const totalH = line2.length > 0 ? 11 : 5;
    const startY = ky + 1 + Math.floor((inner - totalH) / 2);
    const l1w = fontWidth5x3(line1);
    fontPrint5x3(kx + 1 + Math.floor((inner - l1w) / 2), startY, line1, 1);
    if (line2.length > 0) {
        const l2w = fontWidth5x3(line2);
        fontPrint5x3(kx + 1 + Math.floor((inner - l2w) / 2), startY + 6, line2, 1);
    }
}

/* Preset knob: the 1-based preset number rendered big in the Nokia font, no
 * frame, centered across the full cell (using the side margins beyond the
 * 16px box). Falls back to the small font if the number is too wide (>=4
 * digits) so it always fits. */
function drawPresetValue(cellX: number, ky: number, pvm: ParamVM): void {
    const num = pvm.type === 'enum'
        ? pvm.enumIndex + 1
        : Number(pvm.displayValue);
    // Numeric → render the number; non-numeric (e.g. condition "2:3") → the text.
    const text = Number.isFinite(num) ? String(Math.round(num)) : (pvm.displayValue || '—');
    const bw = fontWidthBig(text);
    if (bw <= CELL_W) {
        fontPrintBig(cellX + Math.floor((CELL_W - bw) / 2),
                     ky + Math.floor((KW - BIG_FONT_HEIGHT) / 2), text, 1);
    } else {
        const sw = fontWidth(text);
        fontPrint(cellX + Math.floor((CELL_W - sw) / 2),
                  ky + Math.floor((KW - FONT_HEIGHT) / 2), text, 1);
    }
}

export function drawKnobWidget(col: number, rowY: number, pvm: ParamVM): void {
    const kx = col * CELL_W + Math.floor((CELL_W - KW) / 2);
    const ky = rowY;
    if (pvm.renderStyle === 'preset') {
        drawPresetValue(col * CELL_W, ky, pvm);
    } else if (pvm.type === 'file') {
        drawEnumSquare(kx, ky, [pvm.displayValue], 0);
    } else if (pvm.type === 'enum') {
        drawEnumSquare(kx, ky, pvm.options, pvm.enumIndex);
    } else if (pvm.renderStyle === 'hbar') {
        drawHorzBar(kx, ky, pvm.normalizedValue);
    } else if (pvm.renderStyle === 'vbar') {
        drawVertBar(kx, ky, pvm.normalizedValue);
    } else {
        drawArcKnob(kx, ky, pvm.normalizedValue);
    }
}
