import type { ParamVM } from '../types/viewmodel.js';
import { CELL_W, KW } from './layout.js';

function drawArcKnob(kx: number, ky: number, normVal: number): void {
    const cx = kx + 4.5;
    const cy = ky + 4.5;
    const r  = 4.0;
    const START = 210;
    const RANGE = 300;
    for (let d = START; d <= START + RANGE; d += 22) {
        const rad = d * Math.PI / 180;
        fill_rect(Math.round(cx + r * Math.sin(rad)), Math.round(cy - r * Math.cos(rad)), 1, 1, 1);
    }
    const fillEnd = START + normVal * RANGE;
    for (let d = START; d <= fillEnd; d += 6) {
        const rad = d * Math.PI / 180;
        fill_rect(Math.round(cx + r * Math.sin(rad)), Math.round(cy - r * Math.cos(rad)), 1, 1, 1);
    }
    if (normVal > 0) {
        const rad = fillEnd * Math.PI / 180;
        fill_rect(Math.round(cx + r * Math.sin(rad)), Math.round(cy - r * Math.cos(rad)), 1, 1, 1);
    }
}

function drawEnumKnob(kx: number, ky: number): void {
    fill_rect(kx + 1, ky + 1, KW - 2, KW - 2, 1);
}

export function drawKnobWidget(col: number, rowY: number, pvm: ParamVM): void {
    const kx = col * CELL_W + Math.floor((CELL_W - KW) / 2);
    const ky = rowY + 1;
    if (pvm.type === 'enum') {
        drawEnumKnob(kx, ky);
    } else {
        drawArcKnob(kx, ky, pvm.normalizedValue);
    }
}
