/* Builds the step parameter page's ViewModel from the held-step trig mirror.
 * These five params are intrinsic note properties (not chain params), so this
 * bypasses model/viewmodel.ts. Knob 1 velocity (vbar), 2 length (enum square),
 * 3 probability (enum square), 4 condition (big preset font), 5 invert (enum
 * square). Knobs 6-8 blank. */
import type { ViewModel, ParamVM } from '../types/viewmodel.js';
import { stepPageState } from './step-page.js';

/* Note-length values in ticks (TICKS_PER_STEP=24, whole note/bar=384). */
export const LENGTH_TICKS: number[] = [
    12, 24, 48, 96, 192,           // 1/32 1/16 1/8 1/4 1/2
    384, 768, 1152, 1536, 1920, 2304, 2688, 3072, 3456, 3840, 4224, // 1..11 bars
    4608, 4992, 5376, 5760, 6144,  // 12..16 bars
];
export const LENGTH_LABELS: string[] = [
    '1/32', '1/16', '1/8', '1/4', '1/2',
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16',
];

/* Probability enum: 100..10 by 10. */
export const PROB_VALUES: number[] = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10];
export const PROB_LABELS: string[] = PROB_VALUES.map((v) => v + '%');

/* Condition A:B enumeration, B up to 8: 1:1, 1:2, 2:2, 1:3.. */
export const COND_PAIRS: [number, number][] = (() => {
    const out: [number, number][] = [];
    for (let b = 1; b <= 8; b++) for (let a = 1; a <= b; a++) out.push([a, b]);
    return out;
})();
export const COND_LABELS: string[] = COND_PAIRS.map(([a, b]) => a + ':' + b);

/** Nearest length-list index for a gate in ticks. */
export function lengthIndexForTicks(ticks: number): number {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < LENGTH_TICKS.length; i++) {
        const d = Math.abs(LENGTH_TICKS[i] - ticks);
        if (d < bestD) { bestD = d; best = i; }
    }
    return best;
}
export function probIndexForPct(pct: number): number {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < PROB_VALUES.length; i++) {
        const d = Math.abs(PROB_VALUES[i] - pct);
        if (d < bestD) { bestD = d; best = i; }
    }
    return best;
}
export function condIndexFor(a: number, b: number): number {
    const i = COND_PAIRS.findIndex(([x, y]) => x === a && y === b);
    return i < 0 ? 0 : i;
}

export interface HeldTrig {
    holdVel: number; holdGate: number; holdGateMixed: boolean;
    holdProb: number; holdCondA: number; holdCondB: number; holdInvert: boolean;
}

function cell(p: Partial<ParamVM>): ParamVM {
    return {
        shortName: '', fullName: '', type: 'float', normalizedValue: 0,
        displayValue: '', touched: false, isLongEnum: false, options: null,
        enumIndex: 0, renderStyle: 'arc', automated: false, automatable: false,
        assigned: false, ...p,
    };
}

export function buildStepPageVM(h: HeldTrig): ViewModel {
    const lenIdx  = lengthIndexForTicks(h.holdGate);
    const probIdx = probIndexForPct(h.holdProb);
    const condIdx = condIndexFor(h.holdCondA, h.holdCondB);

    const vel = cell({
        shortName: 'VEL', fullName: 'Velocity', type: 'float', renderStyle: 'vbar',
        normalizedValue: Math.max(0, Math.min(1, h.holdVel / 127)),
        displayValue: String(h.holdVel),
    });
    const len = cell({
        // type 'len' → drawn as a stacked fraction (e.g. 1/4) by drawKnobWidget.
        shortName: 'LEN', fullName: 'Length', type: 'len', options: LENGTH_LABELS,
        enumIndex: lenIdx, displayValue: h.holdGateMixed ? '...' : LENGTH_LABELS[lenIdx],
    });
    const prob = cell({
        shortName: 'PROB', fullName: 'Probability', type: 'enum', options: PROB_LABELS,
        enumIndex: probIdx, displayValue: PROB_LABELS[probIdx],
    });
    const cond = cell({
        shortName: 'COND', fullName: 'Condition', type: 'cond', renderStyle: 'preset',
        enumIndex: condIdx, displayValue: COND_LABELS[condIdx],
    });
    const inv = cell({
        shortName: 'INV', fullName: 'Invert', type: 'enum', options: ['OFF', 'ON'],
        enumIndex: h.holdInvert ? 1 : 0, displayValue: h.holdInvert ? 'ON' : 'OFF',
    });

    // A touched/turned knob shows the shared top toast (full name + value),
    // exactly like editing a synth param on a module page.
    const cells = [vel, len, prob, cond, inv];
    const tk = stepPageState.touchedKnob;
    const toast = (tk >= 0 && tk < cells.length)
        ? { fullName: cells[tk].fullName, value: cells[tk].displayValue, browseHint: false }
        : null;

    return {
        moduleName: 'step', bankName: '', bankIndex: 0, bankCount: 1,
        rows: [[vel, len, prob, cond], [inv, null, null, null]],
        touchedSlot: null, toast, overlay: null, isEmpty: false,
        drumPadCount: 0, drumCurrentPad: 0, drumCurrentPhysPad: 0, isPadSpecific: false,
        // Not the automation-hold view: its params are intrinsic, not chain
        // lanes, so they must not be hidden by hiddenDuringHold.
        automationHeld: false, automationPoolFull: false,
        stepPagePresent: true, stepPageSelected: true,
    };
}
