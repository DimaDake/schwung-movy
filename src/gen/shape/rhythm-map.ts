/* PATTERN as a map, not a list (plans/2026-10-29-rhythm-harmony-maps.md):
 * one knob that walks through every comp a part may play, a click at a time.
 *
 * Each figure is a FLAVOUR: a ranking of the bar's sixteen steps, its own
 * steps first, then the rest by Barlow's indispensability (how much a step
 * holds up the 4/4 metre). Density k plays the top k steps, so the patterns
 * of a flavour are nested, as on Mutable Instruments Grids: each click adds
 * one onset to the last, and at the figure's own size it is the figure. The
 * flavours are laid end to end as a serpentine (sparse to dense, then dense
 * to sparse through the next), the next flavour the one closest at the turn,
 * so the whole knob moves one onset a click except where two flavours meet,
 * and there they share most of their steps. A pattern already on the map is
 * not repeated. */

import { euclid } from '../theory/pc.js';

/* Barlow's indispensability for sixteen steps of 2·2·2·2: the downbeat,
 * then beat 3, beat 4, beat 2, the off-beat eighths, and the sixteenths last;
 * the step before a beat outranks the one after it (it leads into it). */
const IND = [15, 0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7];

const byWeight = (a: number, b: number) => IND[b] - IND[a];

/** A figure's ranking of the bar: its own steps (strongest first), then the rest. */
export function ranking(core: readonly number[]): number[] {
    const own = [...new Set(core)].sort(byWeight);
    return [...own, ...IND.map((_, s) => s).filter((s) => !own.includes(s)).sort(byWeight)];
}

/** Steps two patterns do not share: the moves between them, one onset a move. */
const apart = (a: number[], b: number[]) => a.filter((x) => !b.includes(x)).length + b.filter((x) => !a.includes(x)).length;

const sorted = (r: number[], k: number) => r.slice(0, k).sort((a, b) => a - b);

/** Euclidean figures (Bjorklund) that fill the space between the named ones. */
export function euclids(list: [number, number][]): number[][] {
    return list.map(([k, rot]) => euclid(k, 16, rot).map((on, s) => (on ? s : -1)).filter((s) => s >= 0));
}

export interface RhythmMap {
    steps: number[][];      // per position: the onsets of one bar
    takes: number[];        // the positions where a named figure sits whole
}

/** The map through `figs` from `lo` to `hi` onsets a bar, at most `cap` long.
 *  The first `named` figures are where a take may land. */
export function rhythmMap(figs: number[][], named: number, lo: number, hi: number, cap = 128): RhythmMap {
    const ranks = figs.map(ranking);
    const order = [0];
    let end = hi;
    while (order.length < figs.length) {
        const last = ranks[order[order.length - 1]];
        let best = -1, d = Infinity;
        ranks.forEach((r, i) => {
            if (order.includes(i)) return;
            const x = apart(sorted(last, end), sorted(r, end));
            if (x < d) { d = x; best = i; }
        });
        order.push(best);
        end = end === hi ? lo : hi;
    }
    const steps: number[][] = [], takes: number[] = [];
    const at = new Map<string, number>();
    order.forEach((f, j) => {
        const ks = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
        for (const k of j % 2 ? ks.reverse() : ks) {
            const s = sorted(ranks[f], k);
            const id = s.join();
            const take = f < named && k === new Set(figs[f]).size;
            if (!at.has(id) && steps.length < cap) { at.set(id, steps.length); steps.push(s); }
            if (take && at.has(id)) takes.push(at.get(id)!);
        }
    });
    return { steps, takes: [...new Set(takes)] };
}
