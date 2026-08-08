/* Quantization strengths and the Shift+Step 16 cycle.
 *
 * The cycle is 0 / the set default / 100 — off, your taste, dead on grid. From
 * any value it advances to the next higher candidate and wraps, so the button
 * always reads as "tighten" and one press from a knob-dialled value lands
 * somewhere predictable rather than throwing that value away. */

export const QUANT_VALUES: number[] = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
/* Ascending, unlike PROB_VALUES (which descends because full probability is the
 * resting state): here clockwise should tighten. The two never share a screen. */
export const QUANT_LABELS: string[] = QUANT_VALUES.map((v) => v + '%');

const clampPct = (v: number): number => Math.max(0, Math.min(100, Math.round(v)));

/** Index of the listed value nearest `pct` — the enum cell's selection. */
export function quantIndexForPct(pct: number): number {
    let best = 0;
    for (let i = 1; i < QUANT_VALUES.length; i++) {
        if (Math.abs(QUANT_VALUES[i] - pct) < Math.abs(QUANT_VALUES[best] - pct)) best = i;
    }
    return best;
}

/** Ascending 0 / default / 100, collapsed to two when the default is an end. */
export function quantCandidates(defPct: number): number[] {
    const d = clampPct(defPct);
    return d === 0 || d === 100 ? [0, 100] : [0, d, 100];
}

/** The next candidate strictly above `cur`, wrapping round to the lowest. */
export function nextQuantCandidate(cur: number, defPct: number): number {
    const c = quantCandidates(defPct);
    return c.find((v) => v > cur) ?? c[0];
}

/** Index of the candidate `pct` sits on, or -1 when it is off-cycle. */
export function candidateIndex(pct: number, defPct: number): number {
    return quantCandidates(defPct).indexOf(clampPct(pct));
}
