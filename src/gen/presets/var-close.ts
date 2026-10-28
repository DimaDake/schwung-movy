/* Variation, close to the source (the first group of the old ladder): the
 * source's rhythm and role, new notes from the new harmony. */

import { custom, K } from '../knobs.js';
import type { Preset } from '../preset.js';
import { rng } from '../rng.js';
import { nearestPitch, pc, stepScale } from '../theory/pc.js';
import { colourPcs } from '../theory/category.js';
import { spreadVoicing } from '../theory/voicing.js';
import type { Ev } from '../types.js';
import { finish, over, partEvs, someOf, targetAt } from './helpers.js';
import { rhythmStage } from '../shape/rhythm.js';

const LINES = ['lead', 'arpeggio', 'bass'] as const;
const CHORDS = ['pad', 'stabs'] as const;

export const NEXT: Preset = {
    id: 'v-next', name: 'NEXT CHORDS', task: 'variation', drum: false, cls: 'close',
    knobs: [K.harmony(1), K.changes(0), K.tension(4), K.rhythm(0), K.voices(1), K.range(5), K.length(5), K.density(5)],
    fit: (c) => (c.freedom === 'locked' ? 0.8 : 0.7),
    generate: (ctx, v, seed) => {
        const r = rng(seed);
        const out = over(ctx, partEvs(ctx), { h: v[0], changes: v[1], tension: v[2], rhythm: v[3], voices: v[4], range: v[5], r });
        return finish(ctx, out, { length: v[6], density: v[7], h: v[0], changes: v[1] }, r);
    },
};

/** Chords: an inversion up or down on the chosen events; lines: the contour
 *  mirrored there (where the source rose, it falls). */
export const REVOICE: Preset = {
    id: 'v-revoice', name: 'RE-VOICE', task: 'variation', drum: false, cls: 'close', roles: ['pad', 'stabs', 'lead', 'arpeggio', 'bass'], fit: () => 0.5,
    knobs: [K.amount(6), K.harmony(1), K.range(5), K.seed()],
    generate: (ctx, v, seed) => {
        const r = rng(seed + v[3] * 7919);
        const evs = partEvs(ctx);
        const sel = someOf(evs.length, v[0] / 10, r);
        const upward = r() < 0.5;
        const axis = ctx.mid;
        const chords = ctx.role?.kind === 'pad' || ctx.role?.kind === 'stabs';
        const moved: Ev[] = evs.map((e, i) => {
            if (!sel.has(i)) return e;
            const ps = e.voices.map((x) => x.pitch).sort((a, b) => a - b);
            if (chords && ps.length > 1) {
                if (upward) ps[0] += 12; else ps[ps.length - 1] -= 12;
            } else ps.forEach((p, j) => { ps[j] = 2 * axis - p; });
            ps.sort((a, b) => a - b);
            return { tick: e.tick, voices: e.voices.map((x, j) => ({ ...x, pitch: ps[j] })) };
        });
        return finish(ctx, over(ctx, moved, { h: v[1], range: v[2], pull: 0.15 }), {}, r);
    },
};

/** The rhythm kept, a new line walked over the target chord tones. */
export const NEWLINE: Preset = {
    id: 'v-newline', name: 'NEW LINE', task: 'variation', drum: false, cls: 'close', fit: () => 0.45, roles: [...LINES],
    knobs: [K.harmony(1), K.tension(3), custom('STEP', ['1', '2', '3', '4', '5', '6', '7'], 1), K.seed(),
        K.rhythm(0), K.changes(0), K.length(5), K.density(5)],
    generate: (ctx, v, seed) => {
        const r = rng(seed + v[3] * 7919);
        const evs = v[4] ? rhythmStage(ctx, partEvs(ctx), v[4], r) : partEvs(ctx);
        let prev = evs.length ? evs[0].voices[evs[0].voices.length - 1].pitch : ctx.mid;
        const out = evs.map((e, i) => {
            const T = targetAt(ctx, v[0], e.tick, v[5]);
            if (!T) return e;
            const tones = v[1] >= 5 ? [...T.pcs, ...colourPcs(T, ctx.key)] : T.pcs;
            const pool: number[] = [];
            /* A leap of up to seven chord tones reaches past the played
             * register: the pool runs a fourth beyond it either way. */
            for (let p = ctx.lo - 5; p <= ctx.hi + 5; p++) if (tones.includes(pc(p))) pool.push(p);
            if (!pool.length) return e;
            let j = pool.indexOf(nearestPitch(prev, pool.map(pc), ctx.lo - 5, ctx.hi + 5));
            const step = 1 + Math.floor(r() * (v[2] + 1));
            j = Math.max(0, Math.min(pool.length - 1, j + (r() < 0.5 ? -step : step) * (i === 0 ? 0 : 1)));
            const bassRoot = ctx.role?.kind === 'bass' && e.tick % 192 === 0;
            const p = bassRoot ? nearestPitch(pool[j], [T.root], ctx.lo - 5, ctx.hi + 5) : pool[j];
            prev = p;
            const d = p - e.voices[e.voices.length - 1].pitch;
            return { tick: e.tick, voices: e.voices.map((x) => ({ ...x, pitch: x.pitch + d })) };
        });
        return finish(ctx, out, { length: v[6], density: v[7], h: v[0], changes: v[5] }, r);
    },
};

/** Call and response: the start stays, the rest answers it, moved by scale
 *  steps, the last note landing on the chord's root. */
export const ANSWER: Preset = {
    id: 'v-answer', name: 'ANSWER', task: 'variation', drum: false, cls: 'close', fit: () => 0.55,
    knobs: [custom('SPLIT', ['1/4', '1/2', '3/4'], 1), custom('STEP', ['-3', '-2', '-1', '+1', '+2', '+3'], 3),
        K.harmony(1), K.tension(4), K.rhythm(0), K.changes(0), K.length(5), K.density(5)],
    generate: (ctx, v, seed) => {
        const r = rng(seed);
        const evs = partEvs(ctx);
        const split = Math.round((ctx.end * (v[0] + 1)) / 4 / 96) * 96;
        const steps = [-3, -2, -1, 1, 2, 3][v[1]];
        const call = evs.filter((e) => e.tick < split);
        const answer: Ev[] = [];
        for (let off = split; off < ctx.end; off += split) {
            for (const e of call) {
                if (e.tick + off >= ctx.end) continue;
                answer.push({ tick: e.tick + off, voices: e.voices.map((x) => ({ ...x, pitch: stepScale(x.pitch, steps, ctx.key) })) });
            }
        }
        /* RHYTHM reshapes the answer only: the call stays as played. */
        const ans = v[4] ? rhythmStage(ctx, answer, v[4], r).filter((e) => e.tick >= split) : answer;
        const out = over(ctx, [...call, ...ans], { h: v[2], changes: v[5], tension: v[3], pull: 0.15 });
        const last = out[out.length - 1];
        const T = last ? targetAt(ctx, v[2], last.tick, v[5]) : null;
        if (last && T && last.voices.length === 1) last.voices[0].pitch = nearestPitch(last.voices[0].pitch, [T.root], ctx.lo - 3, ctx.hi + 3);
        return finish(ctx, out, { length: v[6], density: v[7], h: v[2], changes: v[5] }, r);
    },
};

/** Chords opened up (drop voicings) with the top voice led on its own: held
 *  as a common tone, moved by step, or free. */
export const SPREAD: Preset = {
    id: 'v-spread', name: 'SPREAD', task: 'variation', drum: false, cls: 'close', fit: () => 0.55, roles: [...CHORDS],
    knobs: [custom('SPREAD', ['CLOSE', 'DROP 2', 'DROP 2+4', 'WIDE'], 1), custom('TOP', ['HOLD', 'STEP', 'FREE'], 0),
        K.harmony(1), K.tension(5), K.rhythm(0), K.changes(0), K.voices(1), K.length(5)],
    generate: (ctx, v, seed) => {
        const r = rng(seed);
        const out = over(ctx, partEvs(ctx), { h: v[2], changes: v[5], tension: v[3], rhythm: v[4], voices: v[6], r });
        let top = -1;
        for (const e of out) {
            let ps = e.voices.map((x) => x.pitch).sort((a, b) => a - b);
            ps = v[0] === 0 ? ps : spreadVoicing(ps, v[0], ctx.lo - 12);
            const T = targetAt(ctx, v[2], e.tick, v[5]);
            if (T && top >= 0 && ps.length > 1 && v[1] < 2) {
                const want = v[1] === 0 && T.pcs.includes(pc(top)) ? top : nearestPitch(top, T.pcs, top - 2, top + 2);
                if (!ps.slice(0, -1).includes(want)) ps[ps.length - 1] = want;
                ps.sort((a, b) => a - b);
            }
            top = ps[ps.length - 1];
            e.voices.forEach((x, j) => { x.pitch = ps[j]; });
        }
        return finish(ctx, out, { length: v[7] }, r);
    },
};
