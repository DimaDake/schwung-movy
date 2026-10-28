/* The melodic style model (design 2026-10-28 §1): two chains learned from
 * the part and its track's other clips — the rhythm as inter-onset
 * intervals in steps, the line as intervals in scale steps — and a walk over
 * them for one phrase, repeated the way a real part repeats. Harmony is not
 * the model's: the caller realises the walk over the plan. */

import type { GenCtx } from '../analysis/context.js';
import { strength, toEvents } from '../analysis/events.js';
import type { Rng } from '../rng.js';
import { degreeIndex, stepScale } from '../theory/pc.js';
import { BAR, type Ev, type Note, TPS } from '../types.js';
import { type Chain, chain, draw, type KeyFn, learn, likeness, smooth } from './markov.js';

export interface MelodicModel { rhythm: Chain; pitch: Chain; gate: number; vel: number[] }

const cache = new WeakMap<GenCtx, MelodicModel>();
const step = (t: number) => Math.round(t / TPS);
const last = (p: readonly string[], n: number) => (p.length >= n ? p.slice(-n).join(',') : null);
const bucket = (tick: number) => { const s = strength(tick); return s >= 0.7 ? 2 : s >= 0.45 ? 1 : 0; };

/* Rhythm: the place in the beat always; deeper, the previous intervals and
 * the place in the bar, until the deepest level replays the source's bars. */
const RHYTHM_KEYS: KeyFn[] = [
    (_p, pos) => String(pos % 4),
    (p, pos) => (p.length ? `${pos % 4}|${last(p, 1)}` : null),
    (p, pos) => (p.length ? `${pos % 16}|${last(p, 1)}` : null),
    (p, pos) => (p.length >= 2 ? `${pos % 16}|${last(p, 2)}` : null),
];
const PITCH_KEYS: KeyFn[] = [() => '', (p) => last(p, 1), (p) => last(p, 2), (p) => last(p, 3)];

/** A clip's length when only its notes are known: whole bars. */
export const clipEnd = (notes: Note[]): number => Math.max(BAR, Math.ceil((Math.max(0, ...notes.map((n) => n.tick)) + 1) / BAR) * BAR);

export function melodicModel(ctx: GenCtx): MelodicModel {
    const hit = cache.get(ctx);
    if (hit) return hit;
    const rhythm = chain(RHYTHM_KEYS), pitch = chain(PITCH_KEYS);
    const gates: number[] = [];
    const vel = [0, 0, 0], vn = [0, 0, 0];
    for (const [notes, end] of [[ctx.src, ctx.end] as const, ...ctx.loops.map((n) => [n, clipEnd(n)] as const)]) {
        const evs = toEvents(notes);
        if (!evs.length) continue;
        const on = evs.map((e) => step(e.tick));
        const len = step(end);
        const iois = on.map((s, i) => String(Math.max(1, Math.min(16, (i + 1 < on.length ? on[i + 1] : on[0] + len) - s))));
        learn(rhythm, iois, on, true);
        const deg = evs.map((e) => degreeIndex(e.voices[e.voices.length - 1].pitch, ctx.key));
        learn(pitch, deg.map((d, i) => String(Math.max(-9, Math.min(9, deg[(i + 1) % deg.length] - d)))), on, true);
        evs.forEach((e, i) => {
            const b = bucket(e.tick);
            for (const v of e.voices) { gates.push(Math.min(1.5, v.gate / (Number(iois[i]) * TPS))); vel[b] += v.vel; vn[b]++; }
        });
    }
    /* The bottom level may leave the source's vocabulary by a neighbour: an
     * interval doubled, halved or nudged, a step either way or inverted. */
    smooth(rhythm, 0, (t) => { const n = Number(t); return [n * 2, n % 2 ? n : n / 2, n + 1, n - 1].filter((x) => x >= 1 && x <= 16).map(String); }, 0.15);
    smooth(pitch, 0, (t) => { const n = Number(t); return [n + 1, n - 1, -n].map(String); }, 0.2);
    const all = vel.reduce((s, x) => s + x, 0) / Math.max(1, vn.reduce((s, x) => s + x, 0)) || 96;
    const m = { rhythm, pitch, gate: gates.length ? [...gates].sort((a, b) => a - b)[gates.length >> 1] : 0.8,
        vel: vel.map((x, i) => (vn[i] ? x / vn[i] : all)) };
    cache.set(ctx, m);
    return m;
}

/** One phrase walked over the model (LIKENESS, DENSITY), repeated to the
 *  clip's end. Chord parts take the rhythm only and sound the source chord
 *  under each onset. */
export function walk(ctx: GenCtx, src: Ev[], like: number, density: number, phrase: number, r: Rng): Ev[] {
    if (!src.length) return [];
    const m = melodicModel(ctx);
    const { level, temp } = likeness(like);
    const bias = (density - 5) * 0.3;
    const chords = ctx.role?.kind === 'pad' || ctx.role?.kind === 'stabs';
    const lo = ctx.lo - 7, hi = ctx.hi + 7;
    const P = step(phrase);
    let s = step(src[0].tick) % P;
    let pitch = src[0].voices[src[0].voices.length - 1].pitch;
    const pi: string[] = [], pp: string[] = [];
    const ph: Ev[] = [];
    while (s < P) {
        const tok = draw(m.rhythm, level, pi, s, r, temp, (t) => Math.pow(Number(t), -bias)) ?? '4';
        const ioi = Number(tok);
        const tick = s * TPS;
        const gate = Math.max(TPS / 2, Math.round(m.gate * ioi * TPS));
        const vel = m.vel[bucket(tick)] + (r() - 0.5) * 8;
        const under = [...src].reverse().find((e) => e.tick <= tick) ?? src[0];
        ph.push({ tick, voices: chords ? under.voices.map((v) => ({ ...v, gate, vel: v.vel * (vel / m.vel[2]) }))
            : [{ pitch, dt: 0, gate, vel }] });
        pi.push(tok);
        if (!chords) {
            const d = draw(m.pitch, level, pp, s, r, temp) ?? '0';
            let q = stepScale(pitch, Number(d), ctx.key);
            if (q > hi || q < lo) q = stepScale(pitch, -Number(d), ctx.key);
            pitch = q;
            pp.push(d);
        }
        s += ioi;
    }
    const out: Ev[] = [];
    for (let off = 0; off < ctx.end; off += phrase) {
        for (const e of ph) if (e.tick + off < ctx.end) out.push({ tick: e.tick + off, voices: e.voices.map((v) => ({ ...v })) });
    }
    return out;
}
