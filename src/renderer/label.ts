import type { ParamVM, ViewModel, LfoVizVM } from '../types/viewmodel.js';
import { fontPrint, fontWidth } from '../font/index.js';
import { drawKnobWidget } from './knob.js';
import { drawEnvelope } from './envelope.js';
import { drawLfoWave } from './lfo-wave.js';
import { CELL_W, LBL_H, ROW0_Y, LBL0_Y, ROW1_Y, LBL1_Y } from './layout.js';

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
    // Automation marker: a 2×2 dot just past the top-right of the text (clamped
    // inside the cell; inverted when the cell is filled by the touched value).
    if (pvm.automated) {
        const cellRight = col * CELL_W + CELL_W;
        const dx = Math.min(tx + tw + 1, cellRight - 2);
        fill_rect(dx, lblY, 2, 2, pvm.touched ? 0 : 1);
    }
}

/* While a step is held, only automatable params are editable; at the 8-lane
 * limit, only already-assigned lanes are shown. */
function hiddenDuringHold(pvm: ParamVM, held: boolean, poolFull: boolean): boolean {
    if (!held) return false;
    if (!pvm.automatable) return true;
    return poolFull && !pvm.assigned;
}

export function drawKnobRow(
    params: (ParamVM | null)[], rowY: number, lblY: number,
    held = false, poolFull = false, env = false, lfoViz: LfoVizVM | null = null,
): void {
    // An envelope line draws one graphic across all four cells; an LFO viz group
    // draws a waveform across its two cells (startCol..+1). Either replaces those
    // knob widgets; the label cells (touch/value/automation) are unchanged.
    if (env) drawEnvelope(rowY, params);
    else if (lfoViz) drawLfoWave(rowY, lfoViz);
    for (let col = 0; col < 4; col++) {
        const pvm = params[col];
        if (!pvm) continue;
        if (hiddenDuringHold(pvm, held, poolFull)) continue;
        const inViz = !!lfoViz && col >= lfoViz.startCol && col < lfoViz.startCol + 2;
        if (!env && !inViz) drawKnobWidget(col, rowY, pvm);
        drawLabelCell(col, lblY, pvm);
    }
}

// Renders both knob rows or a "No params" fallback when all slots are empty
export function drawKnobParams(vm: ViewModel): void {
    const hasParams = vm.rows[0].some(Boolean) || vm.rows[1].some(Boolean);
    if (!hasParams) {
        fontPrint(2, ROW0_Y + 4, 'No params', 1);
    } else {
        const viz0 = vm.lfoViz?.find(g => g.line === 0) ?? null;
        const viz1 = vm.lfoViz?.find(g => g.line === 1) ?? null;
        drawKnobRow(vm.rows[0], ROW0_Y, LBL0_Y, vm.automationHeld, vm.automationPoolFull, !!vm.envelopeLines?.[0], viz0);
        drawKnobRow(vm.rows[1], ROW1_Y, LBL1_Y, vm.automationHeld, vm.automationPoolFull, !!vm.envelopeLines?.[1], viz1);
    }
}
