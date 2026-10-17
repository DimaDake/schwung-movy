/* The step parameter page's value tables (length, probability, condition) and
 * its view model. The five params are intrinsic note properties, not chain
 * params; `step-params-contract.ts` turns them into Schwung's cells. */
import type { ViewModel } from '../types/viewmodel.js';
import { headerOnlyVM } from './header-vm.js';

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


/* The step page's view model: Schwung draws its five cells from the virtual
 * contract (SP-54), so movy contributes the header and the "step is a page of
 * its own" flag the bank bar reads. */
export function buildStepPageVM(): ViewModel {
    return { ...headerOnlyVM('step'), headerOverride: undefined,
             stepPagePresent: true, stepPageSelected: true };
}
