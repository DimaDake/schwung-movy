/* lane-value.ts — a parameter value ↔ the 7-bit number a lock stores.
 *
 * Continuous params are linear over [min, max] (`norm7` / `denorm7`), which is
 * also what the engine's lane write does (engine/crates/movy-dsp/src/
 * auto_lane.rs). Enums and booleans are STEPPED (drum-modules plan D14): the
 * 128 values split into n equal bins, option = ⌊v·n/128⌋ — the engine writes by
 * the same rule — and an option is stored at its bin's CENTRE, so the round
 * trip lands on the option it left from and never between two.
 *
 * Every conversion of a lane value goes through here: the base movy sends, the
 * seed a held turn starts from, the held arc, the live-take knob and the bases
 * a restored Set brings back. Two formulas in two places is how a lock drew one
 * option and played the next.
 */

/* What the conversion needs to know; a lane entry and a knob's info are both. */
export interface LaneShape {
    min: number;
    max: number;
    type: string;
    options?: string[] | null;
}

export function norm7(v: number, min: number, max: number): number {
    if (max <= min) return 0;
    return Math.max(0, Math.min(127, Math.round((v - min) / (max - min) * 127)));
}

export function denorm7(n: number, min: number, max: number): number {
    return min + (n / 127) * (max - min);
}

/** The option count of a stepped param, or 0 for a continuous one. A boolean
 *  is an int over exactly 0..1 — movy and Schwung both declare it that way —
 *  and steps in two bins; any other int stays linear. */
export function stepCount(e: LaneShape): number {
    if (e.type === 'enum') {
        if (e.options && e.options.length > 0) return e.options.length;
        return e.max >= e.min ? Math.round(e.max - e.min) + 1 : 0;
    }
    if ((e.type === 'int' || e.type === 'bool') && e.min === 0 && e.max === 1) return 2;
    return 0;
}

/** The bin centre of option `i` of `n`: ⌊v·n/128⌋ of it is `i` again. */
export function binCentre(i: number, n: number): number {
    const k = Math.max(0, Math.min(n - 1, Math.round(i)));
    return Math.min(127, Math.floor((2 * k + 1) * 64 / n));
}

/** The option a 7-bit value plays, for a stepped param of `n` options. */
export function binOf(v: number, n: number): number {
    return Math.max(0, Math.min(n - 1, Math.floor(Math.max(0, Math.min(127, v)) * n / 128)));
}

/** A parameter value → the 7-bit lane value that plays it. */
export function toLane7(value: number, e: LaneShape): number {
    const n = stepCount(e);
    return n > 0 ? binCentre(value - e.min, n) : norm7(value, e.min, e.max);
}

/** A 7-bit lane value → the parameter value it plays. */
export function fromLane7(v: number, e: LaneShape): number {
    const n = stepCount(e);
    return n > 0 ? e.min + binOf(v, n) : denorm7(v, e.min, e.max);
}

/** A held-step turn: `delta` detents from lane value `cur`. A stepped param
 *  moves one OPTION per detent (D14) — on the 7-bit scale a two-option switch
 *  would otherwise take 64 detents to flip. A continuous one moves one step of
 *  the 128 per detent, as it always has. */
export function stepLane7(cur: number, delta: number, e: LaneShape): number {
    const n = stepCount(e);
    if (n > 0) return binCentre(binOf(cur, n) + delta, n);
    return Math.max(0, Math.min(127, cur + delta));
}
