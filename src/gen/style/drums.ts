/* The drum style model (design 2026-10-28 §1): one chain over the pads struck
 * on each 16th, learned from the pattern and its track's other clips, keyed
 * by the step's place in the bar (finer the deeper the level) and the steps
 * before it. Each pad keeps the velocity, offset and length it was played
 * with at that place. */

import type { GenCtx } from '../analysis/context.js';
import type { Rng } from '../rng.js';
import { type Note, TPS } from '../types.js';
import { type Chain, chain, draw, type KeyFn, learn, likeness, smooth } from './markov.js';
import { clipEnd } from './melodic.js';

interface Feel { vel: number; dt: number; gate: number; n: number }
export interface DrumModel { steps: Chain; at: Map<string, Feel>; pad: Map<number, Feel> }

const cache = new WeakMap<GenCtx, DrumModel>();
const last = (p: readonly string[], n: number) => (p.length >= n ? p.slice(-n).join(',') : null);

const KEYS: KeyFn[] = [
    (_p, pos) => String(pos % 4),
    (p, pos) => (p.length ? `${pos % 8}|${last(p, 1)}` : null),
    (p, pos) => (p.length ? `${pos % 16}|${last(p, 1)}` : null),
    (p, pos) => (p.length >= 2 ? `${pos % 16}|${last(p, 2)}` : null),
];

function feel(m: Map<string | number, Feel>, k: string | number, n: Note, dt: number): void {
    const f = m.get(k) ?? { vel: 0, dt: 0, gate: 0, n: 0 };
    f.vel += n.vel; f.dt += dt; f.gate += n.gate; f.n++;
    m.set(k, f);
}

export function drumModel(ctx: GenCtx): DrumModel {
    const hit = cache.get(ctx);
    if (hit) return hit;
    const steps = chain(KEYS);
    const at = new Map<string, Feel>(), pad = new Map<number, Feel>();
    for (const [notes, end] of [[ctx.src, ctx.end] as const, ...ctx.loops.map((n) => [n, clipEnd(n)] as const)]) {
        const n = Math.round(end / TPS);
        const cells: Set<number>[] = Array.from({ length: n }, () => new Set());
        for (const x of notes) {
            const s = Math.round(x.tick / TPS);
            if (s < 0 || s >= n) continue;
            cells[s].add(x.pitch);
            feel(at as Map<string | number, Feel>, `${x.pitch}@${s % 16}`, x, x.tick - s * TPS);
            feel(pad as Map<string | number, Feel>, x.pitch, x, x.tick - s * TPS);
        }
        learn(steps, cells.map((c) => [...c].sort((a, b) => a - b).join('.')), cells.map((_, i) => i), true);
    }
    /* Every level may drop one pad of a step, so DENSITY has a lighter
     * choice to weigh wherever the pattern plays. */
    const lighter = (t: string) => (t ? t.split('.').map((_, i, a) => a.filter((__, j) => j !== i).join('.')) : []);
    KEYS.forEach((_, L) => smooth(steps, L, lighter, 0.1));
    const m = { steps, at, pad };
    cache.set(ctx, m);
    return m;
}

/** One phrase of steps walked over the model, repeated to the clip's end.
 *  DENSITY weighs a fuller step against a lighter one. */
export function drumWalk(ctx: GenCtx, like: number, density: number, phrase: number, r: Rng): Note[] {
    const m = drumModel(ctx);
    const { level, temp } = likeness(like);
    const k = (density - 5) * 0.45;
    const P = Math.round(phrase / TPS);
    const prev: string[] = [];
    const ph: Note[] = [];
    for (let s = 0; s < P; s++) {
        const tok = draw(m.steps, level, prev, s, r, temp, (t) => Math.pow(1 + (t ? t.split('.').length : 0), k)) ?? '';
        prev.push(tok);
        for (const p of tok ? tok.split('.').map(Number) : []) {
            const f = m.at.get(`${p}@${s % 16}`) ?? m.pad.get(p);
            if (!f) continue;
            ph.push({ tick: Math.max(0, s * TPS + Math.round(f.dt / f.n)), pitch: p, gate: Math.max(1, Math.round(f.gate / f.n)),
                vel: Math.round(f.vel / f.n + (r() - 0.5) * 10) });
        }
    }
    const out: Note[] = [];
    for (let off = 0; off < ctx.end; off += phrase) for (const n of ph) if (n.tick + off < ctx.end) out.push({ ...n, tick: n.tick + off });
    return out;
}
