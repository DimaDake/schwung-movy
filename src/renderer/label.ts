import type { ParamVM } from '../types/viewmodel.js';
import { fontPrint } from '../font/index.js';
import { drawKnobWidget } from './knob.js';
import { CELL_W, LBL_H } from './layout.js';

export function drawLabelCell(col: number, lblY: number, pvm: ParamVM): void {
    fill_rect(col * CELL_W, lblY, CELL_W, LBL_H, 1);
    const text = pvm.touched ? pvm.displayValue : pvm.shortName;
    fontPrint(col * CELL_W + 1, lblY + 1, text, 0);
}

export function drawKnobRow(params: (ParamVM | null)[], rowY: number, lblY: number): void {
    for (let col = 0; col < 4; col++) {
        const pvm = params[col];
        if (!pvm) continue;
        drawKnobWidget(col, rowY, pvm);
        drawLabelCell(col, lblY, pvm);
    }
}
