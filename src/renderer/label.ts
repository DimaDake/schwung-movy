import type { ParamVM } from '../types/viewmodel.js';
import { fontPrint, fontWidth } from '../font/index.js';
import { drawKnobWidget } from './knob.js';
import { CELL_W, LBL_H } from './layout.js';

export function drawLabelCell(col: number, lblY: number, pvm: ParamVM): void {
    const knobCenterX = col * CELL_W + Math.floor(CELL_W / 2);
    const text = pvm.touched ? pvm.displayValue : pvm.shortName;
    const tw   = fontWidth(text);
    const tx   = knobCenterX - Math.floor(tw / 2);
    if (pvm.touched) {
        fill_rect(col * CELL_W, lblY, CELL_W, LBL_H, 1);
        fontPrint(tx, lblY + 1, text, 0);
    } else {
        fontPrint(tx, lblY + 1, text, 1);
    }
}

export function drawKnobRow(params: (ParamVM | null)[], rowY: number, lblY: number): void {
    for (let col = 0; col < 4; col++) {
        const pvm = params[col];
        if (!pvm) continue;
        drawKnobWidget(col, rowY, pvm);
        drawLabelCell(col, lblY, pvm);
    }
}
