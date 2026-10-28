/* LOOPER: a locked loop after the Turing Machine and Mutable Instruments'
 * Marbles "déjà vu" (design 2026-10-28 §2). A register of LOOP clock steps
 * starts as the source's first steps (an onset or a rest, a scale degree);
 * each time a step comes round it is rewritten with a chance LOCK sets. Fully
 * locked, the source's opening loops against the bar (a polymeter where LOOP
 * does not divide 16); fully open, a new line every pass. The result is
 * realised over the plan like every line. */

import { strength } from '../analysis/events.js';
import { count, custom, K } from '../knobs.js';
import type { Preset } from '../preset.js';
import { rng } from '../rng.js';
import { degreeIndex, stepScale } from '../theory/pc.js';
import { type Ev, TPS } from '../types.js';
import { finish, over, partEvs } from './helpers.js';

const LOOPS = [3, 4, 5, 6, 7, 8, 12, 16];
const CLOCKS = [1, 2, 4];
/* LOCK → the chance a step is rewritten as it passes. */
const FLIP = [0.5, 0.36, 0.26, 0.19, 0.14, 0.1, 0.07, 0.045, 0.025, 0.01, 0];

interface Cell { on: boolean; d: number; vel: number }

const medianIoi = (evs: Ev[]) => {
    const g = evs.slice(1).map((e, i) => e.tick - evs[i].tick).sort((a, b) => a - b);
    return g.length ? g[g.length >> 1] / TPS : 4;
};
const clockOf = (evs: Ev[]) => { const m = medianIoi(evs); return m <= 1.5 ? 0 : m <= 3 ? 1 : 2; };

export const LOOPER: Preset = {
    id: 'v-looper', name: 'LOOPER', task: 'variation', drum: false, cls: 'exp', roles: ['lead', 'arpeggio', 'bass'], fit: () => 0.55,
    knobs: [count('LOCK', 10, 6), custom('LOOP', LOOPS.map(String), 5),
        { ...custom('CLOCK', ['1/16', '1/8', '1/4']), def: (c) => clockOf(partEvs(c)) },
        { ...count('SPREAD', 10, 4), def: (c) => Math.max(1, Math.min(10, Math.round((degreeIndex(c.hi, c.key) - degreeIndex(c.lo, c.key)) / 2))) },
        { ...K.density(5), def: (c) => Math.max(1, Math.min(10, Math.round(10 * partEvs(c).length * (CLOCKS[clockOf(partEvs(c))] * TPS) / c.end))) },
        K.harmony(1), K.tension(4), K.seed()],
    generate: (ctx, v, seed) => {
        const r = rng(seed + v[7] * 7919);
        const src = partEvs(ctx);
        if (!src.length) return [];
        const clock = CLOCKS[v[2]] * TPS;
        const n = LOOPS[v[1]];
        const mid = degreeIndex(ctx.mid, ctx.key);
        const top = (e: Ev) => e.voices[e.voices.length - 1];
        const reg: Cell[] = Array.from({ length: n }, (_, j) => {
            const t = j * clock;
            const hit = src.find((e) => Math.abs(e.tick - t) < clock / 2);
            const under = [...src].reverse().find((e) => e.tick <= t) ?? src[0];
            return { on: !!hit, d: degreeIndex(top(hit ?? under).pitch, ctx.key) - mid, vel: top(hit ?? under).vel };
        });
        const p = FLIP[v[0]];
        const pOn = v[4] / 10;
        const vel = src.reduce((s, e) => s + top(e).vel, 0) / src.length;
        const gates = src.map((e) => top(e).gate).sort((a, b) => a - b);
        const gate = Math.max(TPS / 2, Math.min(gates[gates.length >> 1], 2 * clock) - 2);
        const out: Ev[] = [];
        for (let i = 0, t = 0; t < ctx.end; i++, t += clock) {
            const k = i % n;
            if (r() < p) reg[k] = { on: r() < pOn, d: Math.round((r() * 2 - 1) * v[3]), vel: vel * (0.8 + 0.3 * strength(t)) };
            if (!reg[k].on) continue;
            out.push({ tick: t, voices: [{ pitch: stepScale(ctx.mid, reg[k].d, ctx.key), dt: 0, gate, vel: reg[k].vel }] });
        }
        return finish(ctx, over(ctx, out, { h: v[5], tension: v[6], r, pull: 0.5 }), {}, r);
    },
};
