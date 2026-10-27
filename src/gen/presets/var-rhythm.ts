/* Variation, rhythm and connections (the second group of the old ladder):
 * the source's notes and role, placed or joined differently. */

import { chordAt } from '../analysis/context.js';
import { isStrong, spanTo } from '../analysis/events.js';
import { custom, K } from '../knobs.js';
import { planAt } from '../plan.js';
import type { Preset } from '../preset.js';
import { rng } from '../rng.js';
import { displace } from '../shape/time.js';
import { colourPcs } from '../theory/category.js';
import { nearestPitch, pc, sameChord } from '../theory/pc.js';
import { onsetRange } from '../../ai/role.js';
import { type Ev, TPS } from '../types.js';
import { finish, over, partEvs, someOf, targetAt } from './helpers.js';

const SHIFTS = [-4, -3, -2, -1, 1, 2, 3, 4];

export const DISPLACE: Preset = {
    id: 'v-displace', name: 'DISPLACE', task: 'variation', drum: false, cls: 'rhythm', fit: () => 0.5,
    knobs: [K.amount(4), custom('SHIFT', SHIFTS.map((s) => (s > 0 ? '+' : '') + s + '/16'), 5), K.harmony(1), K.seed()],
    generate: (ctx, v, seed) => {
        const r = rng(seed + v[3] * 7919);
        const evs = partEvs(ctx);
        const sel = someOf(evs.length, Math.max(0.1, v[0] / 10), r);
        const moved = displace(evs, (i) => sel.has(i), SHIFTS[v[1]], ctx.end);
        /* Two onsets landing together merge: the earlier one keeps it. */
        const out = moved.filter((e, i) => i === 0 || e.tick !== moved[i - 1].tick);
        return finish(ctx, over(ctx, out, { h: v[2] }), { length: 5 }, r);
    },
};

/** Chord changes pushed early by a 32nd to a quarter, the way a played part
 *  leans into the next bar; the note keeps its end. */
export const ANTICIPATE: Preset = {
    id: 'v-anticipate', name: 'ANTICIPATE', task: 'variation', drum: false, cls: 'rhythm', fit: () => 0.6,
    knobs: [custom('PUSH', ['1/32', '1/16', '1/8', '1/4'], 2), K.harmony(1), K.length(6), K.tension(4)],
    generate: (ctx, v, seed) => {
        const push = [TPS / 2, TPS, TPS * 2, TPS * 4][v[0]];
        const out = over(ctx, partEvs(ctx), { h: v[1], tension: v[3] });
        const chords = planAt(ctx, v[1]).chords;
        const changes = out.map((e, i) => i > 0 && !sameChord(chordAt(chords, e.tick, ctx.k), chordAt(chords, e.tick - 1, ctx.k)));
        const any = changes.some((x) => x);
        const pushed = out.map((e, i) => {
            const hit = any ? changes[i] : e.tick % (TPS * 16) === 0 && e.tick > 0;
            if (!hit || !isStrong(e.tick)) return e;
            const t = Math.max(i > 0 ? out[i - 1].tick + TPS / 2 : 0, e.tick - push);
            return { tick: t, voices: e.voices.map((x) => ({ ...x, gate: x.gate + (e.tick - t) })) };
        });
        return finish(ctx, pushed, { length: v[2] }, rng(seed));
    },
};

/** Lines: passing and approach notes into the strong beats. Chords: a voice
 *  suspended over the change, resolving an 8th later. */
export const CONNECT: Preset = {
    id: 'v-connect', name: 'CONNECT', task: 'variation', drum: false, cls: 'rhythm', fit: () => 0.55,
    roles: ['lead', 'bass', 'arpeggio', 'stabs', 'pad'],
    knobs: [K.amount(5), K.harmony(1), K.tension(6), K.length(5)],
    generate: (ctx, v, seed) => {
        const r = rng(seed);
        const out = over(ctx, partEvs(ctx), { h: v[1], tension: v[2] });
        const max = ctx.role ? onsetRange(ctx.role, ctx.len)[1] : out.length * 2;
        const room = Math.max(0, max - out.length);
        const cands = out.map((e, i) => i).filter((i) => i > 0 && isStrong(out[i].tick) && spanTo(out, i - 1, ctx.end) >= TPS * 2);
        const sel = [...someOf(cands.length, v[0] / 10, r)].map((j) => cands[j]).slice(0, room);
        const add: Ev[] = [];
        for (const i of sel) {
            const e = out[i];
            const T = targetAt(ctx, v[1], e.tick);
            const prev = out[i - 1];
            const t = e.tick - (spanTo(out, i - 1, ctx.end) >= TPS * 4 ? TPS * 2 : TPS);
            if (e.voices.length > 1) {
                /* The voice that moves most into this chord holds the old note. */
                const held = prev.voices[prev.voices.length - 1];
                e.voices[e.voices.length - 1] = { ...e.voices[e.voices.length - 1], dt: TPS * 2 };
                add.push({ tick: e.tick, voices: [{ ...held, dt: 0, gate: TPS * 2 }] });
                continue;
            }
            const target = e.voices[0].pitch;
            const from = prev.voices[prev.voices.length - 1].pitch;
            const dir = target >= from ? -1 : 1;
            const chromatic = v[2] >= 7;
            const p = chromatic ? target + dir : nearestPitch(target + 2 * dir, T ? [...T.pcs, ...colourPcs(T, ctx.key)] : [pc(target)],
                target - 3, target + 3);
            if (t > prev.tick) add.push({ tick: t, voices: [{ pitch: p, dt: 0, gate: e.tick - t - 1, vel: Math.round(e.voices[0].vel * 0.8) }] });
        }
        return finish(ctx, [...out, ...add].sort((a, b) => a.tick - b.tick), { length: v[3] }, r);
    },
};
