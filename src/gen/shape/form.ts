/* FORM (design 2026-10-28 §5): a clip laid out in units by a phrase form —
 * the song forms (AABA, call and response, three and a turnaround, ABAC) and
 * two L-systems grown to the clip's length, which repeat without ever quite
 * settling into a loop. */

import { BAR, HALF } from '../types.js';

export const FORMS = ['AABA', 'ABAB', 'AAAB', 'ABAC', 'GROWTH', 'MIRROR'] as const;

/* GROWTH is the Fibonacci word (A→AB, B→A), MIRROR the Thue–Morse sequence
 * (A→AB, B→BA): both start on A, so the clip still opens on the source. */
const RULES: Record<string, Record<string, string>> = {
    GROWTH: { A: 'AB', B: 'A' },
    MIRROR: { A: 'AB', B: 'BA' },
};

/** The form's letters for `n` units: a song form repeated, an L-system
 *  rewritten from A until it is long enough. */
export function formString(name: string, n: number): string {
    const rule = RULES[name];
    if (!rule) return name.repeat(Math.ceil(n / name.length)).slice(0, n);
    let s = 'A';
    while (s.length < n) s = [...s].map((c) => rule[c] ?? c).join('');
    return s.slice(0, n);
}

export const UNITS = [HALF, BAR, 2 * BAR];
export const UNIT_NAMES = ['HALF BAR', '1 BAR', '2 BARS'];

/** Unit sizes that fit at least twice into `end` ticks. */
export const unitsFor = (end: number): number => Math.max(1, UNITS.filter((u) => 2 * u <= end).length);

/** The default unit: the largest that fits four times, else twice. */
export function defaultUnit(end: number): number {
    const four = UNITS.filter((u) => 4 * u <= end).length;
    return Math.max(0, (four || unitsFor(end)) - 1);
}

/** Items starting in unit `k`, moved to start at 0. */
export function unitOf<T extends { tick: number }>(items: T[], k: number, unit: number): T[] {
    return items.filter((x) => x.tick >= k * unit && x.tick < (k + 1) * unit).map((x) => ({ ...x, tick: x.tick - k * unit }));
}

/** Lays the letters' material out unit by unit; `material(letter, k)` gives
 *  a unit's items starting at 0. */
export function layout<T extends { tick: number }>(form: string, unit: number, end: number, material: (letter: string, k: number) => T[]): T[] {
    const out: T[] = [];
    [...form].forEach((letter, k) => {
        for (const x of material(letter, k)) if (x.tick < unit && k * unit + x.tick < end) out.push({ ...x, tick: k * unit + x.tick });
    });
    return out;
}
