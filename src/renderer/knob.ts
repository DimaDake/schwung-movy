import type { ParamVM } from '../types/viewmodel.js';
import { CELL_W, KW } from './layout.js';
import { fontPrint5x3, fontWidth5x3 } from '../font/index5x3.js';
import { enumSquareLines } from './shorten.js';

/* Horizontal bar (row 0 / knobs 1-4): fills left→right with value */
function drawHorzBar(kx: number, ky: number, normVal: number): void {
    fill_rect(kx + 1, ky + 5, 14, 1, 1);   // top border
    fill_rect(kx + 1, ky + 10, 14, 1, 1);  // bottom border
    fill_rect(kx + 1, ky + 5, 1, 6, 1);    // left border
    fill_rect(kx + 14, ky + 5, 1, 6, 1);   // right border
    const fillW = Math.round(normVal * 12);
    if (fillW > 0) fill_rect(kx + 2, ky + 6, fillW, 4, 1);
}

/* Vertical bar (row 1 / knobs 5-8): fills bottom→up with value */
function drawVertBar(kx: number, ky: number, normVal: number): void {
    fill_rect(kx + 5, ky + 1, 6, 1, 1);    // top border
    fill_rect(kx + 5, ky + 14, 6, 1, 1);   // bottom border
    fill_rect(kx + 5, ky + 1, 1, 14, 1);   // left border
    fill_rect(kx + 10, ky + 1, 1, 14, 1);  // right border
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

export function drawKnobWidget(col: number, rowY: number, pvm: ParamVM, row: 0 | 1): void {
    const kx = col * CELL_W + Math.floor((CELL_W - KW) / 2);
    const ky = rowY;
    if (pvm.type === 'enum') {
        drawEnumSquare(kx, ky, pvm.options, pvm.enumIndex);
    } else if (row === 0) {
        drawHorzBar(kx, ky, pvm.normalizedValue);
    } else {
        drawVertBar(kx, ky, pvm.normalizedValue);
    }
}
