/* Builds the Clip Params page ViewModel. Knob 0 SCALE (len-style box +
 * scrollable overlay), 1 LENGTH (big preset, 'N steps' toast), 2 TRANSPOSE
 * (big preset signed, '±N ct' toast), 3 QUANT (enum square, '%' toast).
 * Mirrors main-page-vm conventions. */

import type { ViewModel } from '../types/viewmodel.js';
import { paramCell as cell } from './param-vm.js';
import { clipPageState } from './clip-page.js';
import { seqState } from './state.js';
import { appState, trackIsDrum } from '../app/state.js';
import { MAX_STEPS } from './constants.js';
import { SCALE_LABELS, SCALE_RATIONALS, scaleCellText, scaleToastText } from './clip-scale.js';
import { QUANT_LABELS, quantIndexForPct } from './quant.js';

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

export function buildClipPageVM(): ViewModel {
    const sIdx = seqState.clipScaleIdx;
    const len = seqState.lenSteps;
    const tr = seqState.clipTranspose;

    // normalizedValue drives the under-knob LED brightness (knobs 0-2 lit):
    // scale over its 8 values, length over 1..MAX_STEPS, transpose over ±36.
    const scale = cell({
        shortName: 'SCALE', fullName: 'Scale', type: 'len',
        displayValue: scaleCellText(sIdx),
        normalizedValue: SCALE_RATIONALS.length > 1 ? sIdx / (SCALE_RATIONALS.length - 1) : 0,
    });
    // shortName ≤5 chars (under-knob label); fullName carries the full word in
    // the toast above.
    const length = cell({
        shortName: 'LEN', fullName: 'Length', renderStyle: 'preset',
        displayValue: String(len), normalizedValue: clamp01((len - 1) / (MAX_STEPS - 1)),
    });
    // A drum track's pitches are pad addresses, so transpose can't apply (the
    // engine ignores it there): show the cell as unavailable rather than
    // offering a control whose value would never be heard.
    const isDrum = trackIsDrum(appState.activeTrack.index);
    const transpose = cell({
        shortName: 'TRANS', fullName: 'Transpose', renderStyle: 'preset',
        displayValue: isDrum ? 'n/a' : String(tr),
        normalizedValue: isDrum ? 0 : clamp01((tr + 36) / 72),
    });

    // Same enum-square treatment as the step page's PROB cell — a percentage
    // picked off a fixed list.
    const q = seqState.clipQuant;
    const quant = cell({
        shortName: 'QUANT', fullName: 'Clip Quantize', type: 'enum',
        options: QUANT_LABELS, enumIndex: quantIndexForPct(q),
        displayValue: q + '%', normalizedValue: clamp01(q / 100),
    });

    const cells = [scale, length, transpose, quant];
    const tk = clipPageState.touchedKnob;
    let toast = null;
    if (tk >= 0 && tk < cells.length) {
        cells[tk].touched = true;
        const value = tk === 0 ? scaleToastText(sIdx)
            : tk === 1 ? len + ' steps'
            : tk === 3 ? q + '%'
            : isDrum ? 'n/a on drums'
            : (tr >= 0 ? '+' + tr : String(tr)) + ' ct';
        toast = { fullName: cells[tk].fullName, value, browseHint: false };
    }

    const overlay = clipPageState.scaleOverlay
        ? { slot: 0, options: SCALE_LABELS, selected: clipPageState.scaleSel, shapeIds: null }
        : null;

    return {
        moduleName: 'CLIP PARAMETERS', headerOverride: 'CLIP PARAMETERS',
        bankName: '', bankIndex: 0, bankCount: 1,
        rows: [[scale, length, transpose, quant], [null, null, null, null]],
        touchedSlot: null, toast, overlay, isEmpty: false,
        drumPadCount: 0, drumCurrentPad: 0, drumCurrentPhysPad: 0, drumPadName: '', isPadScoped: false,
        automationHeld: false, automationPoolFull: false,
        stepPagePresent: false, stepPageSelected: false,
    };
}
