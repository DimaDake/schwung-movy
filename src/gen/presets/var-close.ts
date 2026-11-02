/* Variation, close to the source (the first group of the old ladder): the
 * source's rhythm and role, new notes from the new harmony. */

import type { GenCtx } from '../analysis/context.js';
import { custom, K } from '../knobs.js';
import type { Preset } from '../preset.js';
import { type Rng, rng } from '../rng.js';
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

/* RE-VOICE takes SPREAD and REGISTER in (§2.7). AMOUNT inverts chords (a
 * line: mirrors its contour) on the chosen events; SPLIT moves the part from
 * a point on by an interval (REGISTER's answer in another register); SPREAD
 * opens chords into drop voicings, TOP leading the top voice on its own. */
const INTERVALS: [string, number][] = [['-2 OCT', -24], ['-OCT', -12], ['-5TH', -7], ['+4TH', 5], ['+5TH', 7], ['+OCT', 12], ['+2 OCT', 24]];
const SPLITS = ['OFF', ...['1/4', '1/2', '3/4'].flatMap((q) => INTERVALS.map(([n]) => `${q} ${n}`))];
const splitOf = (v: number): [number, number] | null => (v ? [Math.floor((v - 1) / INTERVALS.length) + 1, INTERVALS[(v - 1) % INTERVALS.length][1]] : null);

function revoiced(ctx: GenCtx, evs: Ev[], amount: number, r: Rng): Ev[] {
    const sel = someOf(evs.length, amount / 10, r);
    const upward = r() < 0.5;
    const axis = ctx.mid;
    const chords = ctx.role?.kind === 'pad' || ctx.role?.kind === 'stabs';
    return evs.map((e, i) => {
        if (!sel.has(i)) return e;
        const ps = e.voices.map((x) => x.pitch).sort((a, b) => a - b);
        if (chords && ps.length > 1) {
            if (upward) ps[0] += 12; else ps[ps.length - 1] -= 12;
        } else ps.forEach((p, j) => { ps[j] = 2 * axis - p; });
        ps.sort((a, b) => a - b);
        return { tick: e.tick, voices: e.voices.map((x, j) => ({ ...x, pitch: ps[j] })) };
    });
}

function spread(ctx: GenCtx, out: Ev[], drop: number, topMode: number, h: number): void {
    let top = -1;
    for (const e of out) {
        let ps = e.voices.map((x) => x.pitch).sort((a, b) => a - b);
        ps = drop === 0 ? ps : spreadVoicing(ps, drop, ctx.lo - 12);
        const T = targetAt(ctx, h, e.tick, 0);
        if (T && top >= 0 && ps.length > 1 && topMode < 2) {
            const want = topMode === 0 && T.pcs.includes(pc(top)) ? top : nearestPitch(top, T.pcs, top - 2, top + 2);
            if (!ps.slice(0, -1).includes(want)) ps[ps.length - 1] = want;
            ps.sort((a, b) => a - b);
        }
        top = ps[ps.length - 1];
        e.voices.forEach((x, j) => { x.pitch = ps[j]; });
    }
}

export const REVOICE: Preset = {
    id: 'v-revoice', name: 'RE-VOICE', task: 'variation', drum: false, cls: 'close', roles: ['pad', 'stabs', 'lead', 'arpeggio', 'bass'],
    fit: (c) => (c.role?.kind === 'pad' || c.role?.kind === 'stabs' ? 0.55 : 0.5),
    knobs: [K.amount(6), K.harmony(1), K.range(5), K.seed(), custom('SPREAD', ['AS IS', 'CLOSE', 'DROP 2', 'DROP 2+4', 'WIDE'], 0),
        custom('TOP', ['HOLD', 'STEP', 'FREE'], 0), custom('SPLIT', SPLITS, 0), K.tension(5)],
    generate: (ctx, v, seed) => {
        const r = rng(seed + v[3] * 7919);
        let evs = v[0] > 0 ? revoiced(ctx, partEvs(ctx), v[0], r) : partEvs(ctx);
        const sp = splitOf(v[6]);
        if (sp) {
            const at = (ctx.end * sp[0]) / 4;
            evs = evs.map((e) => (e.tick < at ? e : { tick: e.tick, voices: e.voices.map((x) => ({ ...x, pitch: x.pitch + sp[1] })) }));
        }
        /* Each source pulled as it was: a re-voicing toward the old register, a split not at all. */
        const pull = v[0] > 0 ? 0.15 : sp ? 0 : undefined;
        const out = over(ctx, evs, { h: v[1], range: v[2], tension: v[7], pull });
        if (v[4] > 0) spread(ctx, out, v[4] - 1, v[5], v[1]);
        return finish(ctx, out, {}, r);
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

