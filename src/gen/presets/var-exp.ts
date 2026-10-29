/* Variation, experimental (the third group of the old ladder): the part's
 * core cell developed — sequenced, reversed, stretched, ornamented, answered
 * in another register — still over the scene's harmony. */

import { isStrong } from '../analysis/events.js';
import { custom, K } from '../knobs.js';
import type { Preset } from '../preset.js';
import { rng } from '../rng.js';
import { stepScale } from '../theory/pc.js';
import { BAR, BEAT, type Ev, HALF, TPS } from '../types.js';
import { onsetBounds } from '../guard.js';
import { finish, over, partEvs, someOf } from './helpers.js';

const LINE = ['lead', 'arpeggio', 'bass'] as const;
const CELLS = [BEAT, BEAT * 2, BAR, BAR * 2];
const STEPS = [-4, -3, -2, -1, 1, 2, 3, 4];

/** The opening cell repeated as a diatonic sequence (each repeat STEP scale
 *  steps on), reset when it would leave the register. */
export const MOTIF: Preset = {
    id: 'v-motif', name: 'MOTIF', task: 'variation', drum: false, cls: 'exp', fit: () => 0.5, roles: [...LINE],
    /* Only cells that fit twice: a cell as long as the clip is the clip. */
    knobs: [{ ...custom('CELL', ['1 BEAT', '2 BEATS', '1 BAR', '2 BARS'], 2), steps: (c) => Math.max(1, CELLS.filter((x) => x * 2 <= c.end).length),
        def: (c) => Math.min(2, Math.max(0, CELLS.filter((x) => x * 2 <= c.end).length - 1)) }, custom('STEP', STEPS.map((s) => (s > 0 ? '+' : '') + s), 5),
        K.harmony(2), K.tension(4)],
    generate: (ctx, v, seed) => {
        const evs = partEvs(ctx);
        const cell = CELLS[v[0]];
        const head = evs.filter((e) => e.tick < cell);
        const src = head.length ? head : evs.slice(0, 2);
        const out: Ev[] = [];
        let shift = 0;
        for (let off = 0, rep = 0; off < ctx.end; off += cell, rep++) {
            const sh = shift;
            const moved = src.map((e) => ({ tick: e.tick + off, voices: e.voices.map((x) => ({ ...x, pitch: stepScale(x.pitch, sh, ctx.key) })) }));
            if (moved.some((e) => e.voices.some((x) => x.pitch > ctx.hi + 9 || x.pitch < ctx.lo - 9))) {
                shift = 0;
                out.push(...src.map((e) => ({ tick: e.tick + off, voices: e.voices.map((x) => ({ ...x })) })));
            } else out.push(...moved);
            shift += STEPS[v[1]];
        }
        return finish(ctx, over(ctx, out.filter((e) => e.tick < ctx.end), { h: v[2], tension: v[3], pull: 0.1 }), {}, rng(seed));
    },
};

/** Pitches reversed inside each chosen span; the rhythm stays. */
export const RETRO: Preset = {
    id: 'v-retro', name: 'RETROGRADE', task: 'variation', drum: false, cls: 'exp', fit: () => 0.45, roles: [...LINE],
    knobs: [K.amount(7), custom('SPAN', ['HALF BAR', 'BAR', '2 BARS'], 1), K.harmony(1), K.range(5)],
    generate: (ctx, v, seed) => {
        const r = rng(seed);
        const evs = partEvs(ctx);
        const span = [HALF, BAR, BAR * 2][v[1]];
        const spans = Math.max(1, Math.ceil(ctx.end / span));
        const sel = someOf(spans, Math.max(0.1, v[0] / 10), r);
        const out = evs.map((e) => ({ tick: e.tick, voices: e.voices.map((x) => ({ ...x })) }));
        for (const s of sel) {
            const idx = out.map((e, i) => i).filter((i) => Math.floor(out[i].tick / span) === s);
            const pitches = idx.map((i) => out[i].voices.map((x) => x.pitch)).reverse();
            idx.forEach((i, j) => out[i].voices.forEach((x, k) => { x.pitch = pitches[j][Math.min(k, pitches[j].length - 1)]; }));
        }
        return finish(ctx, over(ctx, out, { h: v[2], range: v[3] }), {}, r);
    },
};

/** Half time (the first half stretched to fill) or double time (the whole
 *  part twice as fast, twice), from a chosen starting point. */
export const HALFTIME: Preset = {
    id: 'v-halftime', name: 'HALF/DOUBLE', task: 'variation', drum: false, cls: 'exp', fit: () => 0.5, roles: ['lead', 'arpeggio', 'bass', 'stabs'],
    knobs: [custom('SPEED', ['HALF', 'DOUBLE'], 0), custom('FROM', ['START', '1/4', '1/2', '3/4'], 0), K.harmony(1), K.length(5)],
    generate: (ctx, v, seed) => {
        const evs = partEvs(ctx);
        const from = (ctx.end * v[1]) / 4;
        const rotd = evs.map((e) => ({ tick: (e.tick - from + ctx.end) % ctx.end, voices: e.voices })).sort((a, b) => a.tick - b.tick);
        const k = v[0] === 0 ? 2 : 0.5;
        const out: Ev[] = [];
        const reps = v[0] === 0 ? 1 : 2;
        for (let rep = 0; rep < reps; rep++) {
            for (const e of rotd) {
                const t = Math.round(e.tick * k) + rep * (ctx.end / 2);
                if (t < ctx.end) out.push({ tick: Math.round(t / (TPS / 2)) * (TPS / 2), voices: e.voices.map((x) => ({ ...x, dt: 0, gate: Math.max(TPS / 2, Math.round(x.gate * k)) })) });
            }
        }
        const merged = out.sort((a, b) => a.tick - b.tick).filter((e, i, a) => i === 0 || e.tick !== a[i - 1].tick);
        return finish(ctx, over(ctx, merged, { h: v[2] }), { length: v[3] }, rng(seed));
    },
};

const KINDS = ['GRACE', 'TURN', 'MORDENT', 'RESTRIKE'] as const;

/** Ornaments on the strongest notes: a grace note, a turn, a mordent, or the
 *  note struck again on the off-16th. */
export const ORNAMENT: Preset = {
    id: 'v-ornament', name: 'ORNAMENT', task: 'variation', drum: false, cls: 'exp', fit: () => 0.45, roles: ['lead', 'arpeggio', 'stabs'],
    knobs: [K.amount(4), custom('KIND', KINDS, 0), K.harmony(1), K.tension(6)],
    generate: (ctx, v, seed) => {
        const r = rng(seed);
        const out = over(ctx, partEvs(ctx), { h: v[2], tension: v[3] });
        const max = onsetBounds(ctx)[1];
        const per = v[1] === 1 ? 3 : v[1] === 2 ? 2 : 1;
        const cands = out.map((e, i) => i).filter((i) => isStrong(out[i].tick) && out[i].tick >= TPS);
        const sel = [...someOf(cands.length, v[0] / 10, r)].map((j) => cands[j]).slice(0, Math.floor(Math.max(0, max - out.length) / per));
        const add: Ev[] = [];
        for (const i of sel) {
            const e = out[i];
            const top = e.voices[e.voices.length - 1];
            const p = top.pitch;
            const step = (n: number) => stepScale(p, n, ctx.key);
            const one = (t: number, pitch: number, g: number) => add.push({ tick: t, voices: [{ pitch, dt: 0, gate: g, vel: Math.round(top.vel * 0.75) }] });
            if (v[1] === 0) one(e.tick - TPS / 2, step(-1), TPS / 2 - 1);
            else if (v[1] === 1) { one(e.tick - TPS * 1.5, step(1), TPS / 2); one(e.tick - TPS, p, TPS / 2); one(e.tick - TPS / 2, step(-1), TPS / 2); }
            else if (v[1] === 2) { one(e.tick + TPS / 2, step(1), TPS / 2); one(e.tick + TPS, p, TPS / 2); top.gate = TPS / 2; }
            else add.push({ tick: e.tick + TPS * 2, voices: e.voices.map((x) => ({ ...x, dt: 0, gate: Math.min(x.gate, TPS * 2), vel: Math.round(x.vel * 0.8) })) });
        }
        const all = [...out, ...add.filter((e) => e.tick >= 0 && e.tick < ctx.end)].sort((a, b) => a.tick - b.tick);
        return finish(ctx, all.filter((e, i, a) => i === 0 || e.tick !== a[i - 1].tick), {}, r);
    },
};

const INTERVALS = [-24, -12, -7, 5, 7, 12, 24];

/** The answer in another register: from SPLIT on, the part moves by an
 *  octave, a fifth or a fourth, re-fitted to the chords there. */
export const REGISTER: Preset = {
    id: 'v-register', name: 'REGISTER', task: 'variation', drum: false, cls: 'exp', fit: () => 0.4, roles: ['lead', 'arpeggio', 'stabs', 'pad'],
    knobs: [custom('SPLIT', ['1/4', '1/2', '3/4'], 1), custom('INTERVAL', ['-2 OCT', '-OCT', '-5TH', '+4TH', '+5TH', '+OCT', '+2 OCT'], 5), K.harmony(1), K.range(5)],
    generate: (ctx, v, seed) => {
        const split = (ctx.end * (v[0] + 1)) / 4;
        const d = INTERVALS[v[1]];
        const evs = partEvs(ctx).map((e) => (e.tick < split ? e
            : { tick: e.tick, voices: e.voices.map((x) => ({ ...x, pitch: x.pitch + d })) }));
        return finish(ctx, over(ctx, evs, { h: v[2], range: v[3], pull: 0 }), {}, rng(seed));
    },
};
