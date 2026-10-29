/* New Clip's single lines (plans/2026-10-28-new-clip-design.md): MELODY
 * writes a phrase on a CONTOUR and answers it, RIFF repeats a short cell
 * through the chords, COUNTER moves where the band leaves room. Strong beats
 * take chord tones, the rest walk the scale, so a line is a line; MELODY and
 * COUNTER also land on each chord's guide tone and step into the next
 * (create/guide.ts), so they are heard to follow the changes. */

import type { GenCtx } from '../analysis/context.js';
import { strength } from '../analysis/events.js';
import { ACCENT } from '../analysis/band.js';
import { amount, choice, chordUnder, LINE_REGISTER as L, place, register, runPlan, SEED, velAt } from '../create/common.js';
import type { Preset } from '../preset.js';
import { withFeel } from '../create/feel.js';
import { onGuides } from '../create/guide.js';
import { choose, mix, rng, type Rng } from '../rng.js';
import { nearestPitch, stepScale } from '../theory/pc.js';
import { scaleUnder } from '../theory/category.js';
import { type Note, TPS } from '../types.js';
import type { Span } from '../create/phrase.js';
import { phraseOnsets, SHAPES } from '../create/phrase-rhythm.js';

const CONTOURS: ((x: number) => number)[] = [
    (x) => Math.sin(Math.PI * x), (x) => x, (x) => 1 - x, (x) => (Math.sin(2 * Math.PI * x) + 1) / 2,
    (x) => (Math.floor(x * 8) % 2 ? 0.8 : 0.25),
];
/* NARROW, MID and WIDE were a fifth, an octave and a twelfth: the takes stay
 * there, and the knob reaches a fourth and two octaves past them. */
const SPANS = [5, 7, 10, 12, 15, 19, 24];

function tone(ctx: GenCtx, tick: number, target: number, lo: number, hi: number): number {
    const c = chordUnder(ctx, runPlan(ctx), tick);
    return nearestPitch(target, strength(tick) >= 0.7 ? c.pcs : scaleUnder(ctx.key, c), lo, hi);
}

/** A phrase's onsets in steps: the downbeat, then each step by its weight. */
function rhythm(steps: number, density: number, r: Rng): number[] {
    const out = [0];
    for (let s = 1; s < steps; s++) if (r() < (density / 10) * (0.3 + strength(s * TPS))) out.push(s);
    return out;
}

/* With SPARSE above FULL the melody is written phrase by phrase into its
 * spans: each one's rhythm from a phrase shape (create/phrase-rhythm.ts), the
 * contour arching over the phrase, and spans of one length sharing their
 * rhythm, so an answer echoes its call and the silences recur. The landing
 * is laid after (create/land.ts). */
function phrased(ctx: GenCtx, v: number[], r: Rng, spans: readonly Span[], lo: number, hi: number): Note[] {
    const shape = SHAPES[Math.floor(r() * SHAPES.length)][1];
    const rhythms = new Map<number, number[]>();
    const out: Note[] = [];
    for (const s of spans) {
        const a = Math.round(s.start / TPS), n = Math.round(s.land / TPS) - a;
        let on = rhythms.get(n);
        if (!on) { on = phraseOnsets(n, a, v[1], shape, r); rhythms.set(n, on); }
        /* LONG TONES: a span that is only its landing gets one note to land. */
        if (n <= 0) on = [0];
        for (const k of on) {
            const t = ((a + k) % ctx.len) * TPS;
            out.push({ tick: t, pitch: tone(ctx, t, lo + CONTOURS[v[0]](n > 0 ? k / n : 0.5) * (hi - lo), lo, hi), gate: TPS, vel: velAt(t, 96, r) });
        }
    }
    return out;
}

export const MELODY: Preset = withFeel({
    id: 'n-melody', name: 'MELODY', task: 'create', drum: false, cls: 'exp',
    knobs: [choice('CONTOUR', ['ARCH', 'RISE', 'FALL', 'WAVE', 'ZIGZAG']), amount('DENSITY', 10, 3, 7),
        choice('RANGE', ['4TH', '5TH', '7TH', 'OCTAVE', '10TH', '12TH', '2 OCT'], [1, 2, 3, 3, 4, 5]), SEED],
    generate: (ctx, v, seed, spans) => {
        const r = rng(mix(seed, v[3]));
        const phrase = Math.min(32, ctx.len);
        const span = SPANS[v[2]];
        const lo = 72 - Math.round(span / 2), hi = lo + span;
        if (spans) return onGuides(ctx, runPlan(ctx), phrased(ctx, v, r, spans, lo, hi), lo, hi);
        const call = rhythm(phrase, v[1], r);
        const answer = rhythm(Math.min(8, phrase), v[1], r).map((s) => s + phrase - Math.min(8, phrase));
        const out: Note[] = [];
        const home = new Set<Note>();
        for (let off = 0; off < ctx.len; off += phrase) {
            /* The last phrase answers: its tail is new and lands home. */
            const last = off + phrase >= ctx.len && off > 0;
            const steps = last ? [...call.filter((s) => s < phrase - 8), ...answer] : call;
            steps.forEach((s, i) => {
                if (off + s >= ctx.len) return;
                const t = place(ctx, off + s);
                const target = lo + CONTOURS[v[0]](s / phrase) * span;
                const p = last && i === steps.length - 1 ? nearestPitch(target, [ctx.key.tonic], lo, hi) : tone(ctx, t, target, lo, hi);
                const n = { tick: t, pitch: p, gate: TPS, vel: velAt(t, 96, r) };
                if (last && i === steps.length - 1) home.add(n);
                out.push(n);
            });
        }
        return onGuides(ctx, runPlan(ctx), out, lo, hi, home);
    },
}, [3, 9], false, 'melody', ['BREATH', 'CALL+ANSWER']);

const CELLS = [4, 8, 6, 16];
const OFFSETS = [0, 0, 2, 4, 7, -1, 1, 3];
const CENTRE = [36, 48, 60, 72, 84];

export const RIFF: Preset = withFeel({
    id: 'n-riff', name: 'RIFF', task: 'create', drum: false, cls: 'rhythm',
    knobs: [choice('CELL', ['1 BEAT', '2 BEATS', '3/8', '1 BAR'], [1, 1, 2, 3]), amount('NOTES', 6, 2, 4), register([L.LOW, L.MID, L.MID, L.HIGH], L.labels), SEED],
    generate: (ctx, v, seed) => {
        const r = rng(mix(seed, v[3]));
        const cell = CELLS[v[0]];
        const n = Math.max(2, Math.min(cell, v[1]));
        const at = [0, ...choose(r, cell - 1, n - 1).map((s) => s + 1)];
        const deg = at.map((_, i) => (i === 0 ? 0 : OFFSETS[Math.floor(r() * OFFSETS.length)]));
        const out: Note[] = [];
        for (let off = 0; off < ctx.len; off += cell) {
            at.forEach((s, i) => {
                if (off + s >= ctx.len) return;
                const t = place(ctx, off + s);
                const c = chordUnder(ctx, runPlan(ctx), off * TPS);
                const root = nearestPitch(CENTRE[v[2]], [c.root], CENTRE[v[2]] - 6, CENTRE[v[2]] + 6);
                const p = stepScale(root, deg[i], ctx.key);
                out.push({ tick: t, pitch: nearestPitch(p, strength(t) >= 0.7 ? c.pcs : scaleUnder(ctx.key, c)), gate: TPS, vel: velAt(t, 100, r) });
            });
        }
        return out;
    },
}, [2, 7], false, 'line', ['BREATH']);

const RATE = [4, 2, 3, 1];
const MOVES = [[1, -1], [1, -1, 2, -2, 3], [2, -2, 4, -3, 5]];

export const COUNTER: Preset = withFeel({
    id: 'n-counter', name: 'COUNTER', task: 'create', drum: false, cls: 'exp',
    knobs: [choice('RATE', ['QUARTERS', '8THS', 'DOTTED', '16THS'], [1, 0, 1, 2]), choice('MOTION', ['STEPS', 'MIXED', 'LEAPS'], [0, 1, 1, 2]),
        register([L.MID, L.MID, L.HIGH], L.labels), SEED],
    generate: (ctx, v, seed) => {
        const r = rng(mix(seed, v[3]));
        const centre = [43, 55, 64, 72, 84][v[2]];
        const loud = new Set(ctx.band.filter((h) => h.w >= ACCENT).map((h) => Math.round(h.tick / TPS)));
        let p = nearestPitch(centre, chordUnder(ctx, runPlan(ctx), 0).pcs);
        let dir = 1;
        const out: Note[] = [];
        for (let s = 0; s < ctx.len; s += RATE[v[0]]) {
            /* Room is where the band is quiet: it answers, it does not double. */
            if (s % 16 !== 0 && (loud.has(s) ? r() < 0.75 : r() < 0.2)) continue;
            const t = place(ctx, s);
            const m = MOVES[v[1]][Math.floor(r() * MOVES[v[1]].length)];
            if (p > centre + 9) dir = -1; else if (p < centre - 7) dir = 1; else if (r() < 0.25) dir = -dir;
            p = stepScale(p, dir * Math.abs(m), ctx.key);
            const c = chordUnder(ctx, runPlan(ctx), t);
            p = nearestPitch(p, strength(t) >= 0.7 ? c.pcs : scaleUnder(ctx.key, c));
            out.push({ tick: t, pitch: p, gate: TPS, vel: velAt(t, 88, r) });
        }
        return onGuides(ctx, runPlan(ctx), out, centre - 9, centre + 12);
    },
}, [4, 9], false, 'counter', ['BREATH', 'CALL+ANSWER']);
