/* Variation, new patterns from the part's own material: Live-style
 * Recombine, Euclidean re-spacing, and chord rhythms from a comping library. */

import { strength } from '../analysis/events.js';
import { count, custom, K } from '../knobs.js';
import type { Preset } from '../preset.js';
import { rng, shuffled } from '../rng.js';
import { euclid } from '../theory/pc.js';
import { BAR, type Ev, TPS } from '../types.js';
import { COMPS, nearestComp } from '../shape/rhythm.js';
import { dynamics } from '../shape/dynamics.js';
import { finish, over, partEvs } from './helpers.js';

const DIMS = ['PITCH', 'LENGTH', 'VELOCITY', 'POSITION'] as const;

/** One dimension of the part redistributed among its own notes: rotated by
 *  ROTATE, then SHUFFLE of it re-dealt (after Live 12's Recombine). */
export const RECOMBINE: Preset = {
    id: 'v-recombine', name: 'RECOMBINE', task: 'variation', drum: false, cls: 'rhythm', roles: ['pad', 'stabs', 'bass', 'arpeggio', 'lead'], fit: () => 0.45,
    knobs: [custom('DIM', DIMS, 0), count('ROTATE', 7, 1), K.amount(3), K.harmony(1)],
    generate: (ctx, v, seed) => {
        const r = rng(seed);
        const evs = partEvs(ctx);
        const n = evs.length;
        if (n < 2) return finish(ctx, over(ctx, evs, { h: v[3] }), {}, r);
        const rot = <T>(a: T[]) => a.map((_, i) => a[(i + v[1]) % n]);
        const deal = <T>(a: T[]) => {
            const k = Math.round(n * (v[2] / 10));
            const idx = shuffled(r, Array.from({ length: n }, (_, i) => i)).slice(0, k);
            const vals = shuffled(r, idx.map((i) => a[i]));
            const out = [...a];
            idx.forEach((i, j) => { out[i] = vals[j]; });
            return out;
        };
        const dim = DIMS[v[0]];
        let out: Ev[];
        if (dim === 'POSITION') {
            const gaps = evs.map((e, i) => (i + 1 < n ? evs[i + 1].tick : ctx.end + evs[0].tick) - e.tick);
            const g = deal(rot(gaps));
            let t = evs[0].tick;
            out = evs.map((e, i) => { const x = { tick: t, voices: e.voices }; t += g[i]; return x; }).filter((e) => e.tick < ctx.end);
        } else {
            const field = (e: Ev) => (dim === 'PITCH' ? e.voices.map((x) => x.pitch) : dim === 'LENGTH' ? e.voices.map((x) => x.gate) : e.voices.map((x) => x.vel));
            const vals = deal(rot(evs.map(field)));
            out = evs.map((e, i) => ({ tick: e.tick, voices: e.voices.map((x, j) => {
                const val = vals[i][Math.min(j, vals[i].length - 1)];
                return dim === 'PITCH' ? { ...x, pitch: val } : dim === 'LENGTH' ? { ...x, gate: val } : { ...x, vel: val };
            }) }));
        }
        return finish(ctx, over(ctx, out, { h: v[3] }), {}, r);
    },
};

/** The part's notes in order on an Euclidean rhythm of PULSES per bar. */
export const EUCLID: Preset = {
    id: 'v-euclid', name: 'EUCLID', task: 'variation', drum: false, cls: 'rhythm', fit: () => 0.45, roles: ['lead', 'arpeggio', 'bass', 'stabs'],
    knobs: [{ ...count('PULSES', 15, 5), steps: () => 16, def: (c) => Math.max(1, Math.min(15, Math.round((c.role?.perBar ?? 5))) + 1) - 1,
        label: (x: number) => String(x + 1) }, count('ROTATE', 15, 0), K.harmony(1), K.length(5)],
    generate: (ctx, v, seed) => {
        const evs = partEvs(ctx);
        if (!evs.length) return [];
        const pattern = euclid(v[0] + 1, 16, v[1]);
        const out: Ev[] = [];
        let j = 0;
        for (let bar = 0; bar * BAR < ctx.end; bar++) {
            pattern.forEach((on, s) => {
                const tick = bar * BAR + s * TPS;
                if (!on || tick >= ctx.end) return;
                const src = evs[j++ % evs.length];
                const gap = TPS * Math.max(1, 16 / (v[0] + 1));
                out.push({ tick, voices: src.voices.map((x) => ({ ...x, dt: 0, gate: Math.min(x.gate, gap) })) });
            });
        }
        return finish(ctx, over(ctx, out, { h: v[2] }), { length: v[3] }, rng(seed));
    },
};

export const COMP: Preset = {
    id: 'v-comp', name: 'COMP', task: 'variation', drum: false, cls: 'rhythm', fit: () => 0.6, roles: ['stabs', 'pad'],
    knobs: [{ ...custom('PATTERN', COMPS.map((c) => c[0])), def: (c) => nearestComp(partEvs(c)) }, K.harmony(1), K.changes(0), K.tension(5),
        K.voices(1), K.length(5), K.dynamics(3), K.range(5)],
    generate: (ctx, v, seed) => {
        const evs = over(ctx, partEvs(ctx), { h: v[1], changes: v[2], tension: v[3], voices: v[4], range: v[7] });
        if (!evs.length) return [];
        const steps = COMPS[v[0]][1];
        const pad = ctx.role?.kind === 'pad';
        const out: Ev[] = [];
        for (let bar = 0; bar * BAR < ctx.end; bar++) {
            steps.forEach((s, i) => {
                const tick = bar * BAR + s * TPS;
                if (tick >= ctx.end) return;
                const src = [...evs].reverse().find((e) => e.tick <= tick) ?? evs[0];
                const next = (steps[i + 1] ?? 16 + steps[0]) - s;
                const gate = pad ? next * TPS - 4 : Math.min(TPS * 2, next * TPS - 4);
                const accent = 0.75 + 0.25 * strength(tick);
                out.push({ tick, voices: src.voices.map((x) => ({ ...x, dt: 0, gate, vel: Math.round(x.vel * accent) })) });
            });
        }
        return dynamics(finish(ctx, out, { length: v[5] }, rng(seed)), v[6]);
    },
};
