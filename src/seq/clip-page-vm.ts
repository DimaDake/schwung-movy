/* Builds the Clip Params page ViewModel. Knob 0 SCALE (len-style box +
 * scrollable overlay), 1 LENGTH (big preset, 'N steps' toast), 2 TRANSPOSE
 * (big preset signed, '±N ct' toast). Mirrors main-page-vm conventions. */

import type { ViewModel } from '../types/viewmodel.js';
import { paramCell as cell } from './param-vm.js';
import { clipPageState } from './clip-page.js';
import { seqState } from './state.js';
import { MAX_STEPS } from './constants.js';
import { SCALE_LABELS, SCALE_RATIONALS, scaleCellText, scaleToastText } from './clip-scale.js';

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
    const length = cell({
        shortName: 'LENGTH', fullName: 'Length', renderStyle: 'preset',
        displayValue: String(len), normalizedValue: clamp01((len - 1) / (MAX_STEPS - 1)),
    });
    const transpose = cell({
        shortName: 'TRANSPOSE', fullName: 'Transpose', renderStyle: 'preset',
        displayValue: String(tr), normalizedValue: clamp01((tr + 36) / 72),
    });

    const cells = [scale, length, transpose];
    const tk = clipPageState.touchedKnob;
    let toast = null;
    if (tk >= 0 && tk < cells.length) {
        cells[tk].touched = true;
        const value = tk === 0 ? scaleToastText(sIdx)
            : tk === 1 ? len + ' steps'
            : (tr >= 0 ? '+' + tr : String(tr)) + ' ct';
        toast = { fullName: cells[tk].fullName, value, browseHint: false };
    }

    const overlay = clipPageState.scaleOverlay
        ? { slot: 0, options: SCALE_LABELS, selected: clipPageState.scaleSel }
        : null;

    return {
        moduleName: 'CLIP PARAMETERS', headerOverride: 'CLIP PARAMETERS',
        bankName: '', bankIndex: 0, bankCount: 1,
        rows: [[scale, length, transpose, null], [null, null, null, null]],
        touchedSlot: null, toast, overlay, isEmpty: false,
        drumPadCount: 0, drumCurrentPad: 0, drumCurrentPhysPad: 0, isPadSpecific: false,
        automationHeld: false, automationPoolFull: false,
        stepPagePresent: false, stepPageSelected: false,
    };
}
