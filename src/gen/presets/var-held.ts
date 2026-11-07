/* Variation for held and low parts: a drone that moves by common tones, a
 * pedal under or inside a moving part, octave and walking bass, and a part
 * thinned to its strongest notes. */

import { chordAt, type GenCtx } from '../analysis/context.js';
import { isStrong, spanTo, strength } from '../analysis/events.js';
import { custom, K } from '../knobs.js';
import { planAt } from '../plan.js';
import type { Preset } from '../preset.js';
import { type Rng, rng } from '../rng.js';
import { nearestPitch, pc, sameChord, stepScale } from '../theory/pc.js';
import { type Ev, HALF } from '../types.js';
import { finish, over, partEvs, someOf, targetAt } from './helpers.js';

/* HOLD NOTE (§2.7): a held note in the music. On a drone it is re-placed on
 * every chord change (DRONE MOVE's): the root, fifth or third of the new
 * chord, or the tone it shares with the old one (a pivot), tied through or
 * struck again. On any other part it is a pedal (PEDAL's): lines alternate
 * with it, a bass returns to it, chords keep it as their top voice. */
const isDrone = (c: GenCtx) => c.role?.kind === 'drone';
const NOTES_OF = (c: GenCtx): string[] => (isDrone(c) ? ['PIVOT', 'ROOT', 'FIFTH', 'THIRD'] : ['TONIC', 'FIFTH', 'CHORD ROOT']);

function droneMove(ctx: GenCtx, note: number, tie: boolean, h: number): Ev[] {
    const src = partEvs(ctx);
    if (!src.length) return [];
    const proto = src[0].voices[0];
    const chords = planAt(ctx, h).chords;
    const out: Ev[] = [];
    let prev = proto.pitch;
    let prevC = null as ReturnType<typeof chordAt>;
    for (let t = 0; t < ctx.end; t += HALF) {
        const c = chordAt(chords, t, ctx.k) ?? chordAt(ctx.srcChords, t, ctx.k);
        if (!c || (t > 0 && sameChord(c, prevC))) continue;
        const want = note === 0 ? (c.pcs.includes(pc(prev)) ? [pc(prev)] : c.pcs) : [c.pcs[[0, 0, 2, 1][note]] ?? c.pcs[0]];
        const p = nearestPitch(prev, want, ctx.lo - 7, ctx.hi + 7);
        prevC = c;
        if (tie && out.length && p === prev) { prev = p; continue; }
        prev = p;
        out.push({ tick: t, voices: [{ ...proto, pitch: prev, dt: 0, gate: HALF }] });
    }
    out.forEach((e, i) => { e.voices[0].gate = spanTo(out, i, ctx.end) - 2; });
    return out;
}

function pedal(ctx: GenCtx, note: number, amount: number, h: number, range: number, r: Rng): Ev[] {
    const out = over(ctx, partEvs(ctx), { h, range });
    const sel = someOf(out.length, amount / 10, r);
    const kind = ctx.role?.kind;
    out.forEach((e, i) => {
        if (!sel.has(i)) return;
        if (kind === 'bass' && isStrong(e.tick)) return;
        const T = targetAt(ctx, h, e.tick);
        const ped = note === 0 ? ctx.key.tonic : note === 1 ? pc(ctx.key.tonic + 7) : T?.root ?? ctx.key.tonic;
        const top = e.voices[e.voices.length - 1];
        if (e.voices.length > 1) top.pitch = nearestPitch(top.pitch, [ped], top.pitch - 5, top.pitch + 5);
        else top.pitch = nearestPitch(kind === 'bass' ? ctx.lo : ctx.mid, [ped], ctx.lo - 5, ctx.hi + 5);
    });
    return out;
}

export const HOLD: Preset = {
    id: 'v-hold', name: 'HOLD NOTE', task: 'variation', drum: false, cls: 'close', fit: (c) => (isDrone(c) ? 0.85 : 0.5),
    seedAs: (_v, c) => (isDrone(c) ? 'v-drone' : 'v-pedal'),
    knobs: [{ name: 'NOTE', steps: (c) => NOTES_OF(c).length, def: () => 0, label: (v, c) => NOTES_OF(c)[v] ?? '' },
        K.amount(5), K.harmony(1), K.range(5), { ...K.length(5), def: (c) => (isDrone(c) ? 7 : 5) }, custom('SHARED', ['TIE', 'RESTRIKE'], 0)],
    generate: (ctx, v, seed) => {
        const r = rng(seed);
        const out = isDrone(ctx) ? droneMove(ctx, v[0], v[5] === 0, v[2]) : pedal(ctx, v[0], v[1], v[2], v[3], r);
        return out.length ? finish(ctx, out, { length: v[4] }, r) : [];
    },
};

/** A walking approach into each chord change: the last notes before it step
 *  toward the new root, diatonic (the scale's neighbours, so a Set's mode
 *  holds) or, at high TENSION, chromatic. */
export const WALK: Preset = {
    id: 'v-walk', name: 'WALK', task: 'variation', drum: false, cls: 'rhythm', fit: () => 0.55, roles: ['bass', 'lead'],
    knobs: [K.amount(6), K.tension(4), K.harmony(1), K.density(6)],
    generate: (ctx, v, seed) => {
        const r = rng(seed);
        const out = over(ctx, partEvs(ctx), { h: v[2], tension: v[1] });
        const n = Math.max(1, Math.round(1 + (v[0] / 10) * 3));
        for (let i = 1; i < out.length; i++) {
            if (!isStrong(out[i].tick)) continue;
            const target = out[i].voices[0].pitch;
            for (let j = 1; j <= n && i - j >= 0 && !isStrong(out[i - j].tick); j++) {
                const T = targetAt(ctx, v[2], out[i - j].tick);
                const p = v[1] >= 7 ? target + (out[i - j].voices[0].pitch > target ? j : -j)
                    : nearestPitch(target + (out[i - j].voices[0].pitch > target ? 2 * j : -2 * j), T ? T.pcs.concat([pc(stepScale(target, 1, ctx.key)), pc(stepScale(target, -1, ctx.key))]) : [pc(target)]);
                out[i - j].voices[0].pitch = p;
            }
        }
        return finish(ctx, out, { density: v[3], h: v[2] }, r);
    },
};

/** Only the strongest notes, held longer: the part's skeleton. */
export const THIN: Preset = {
    id: 'v-thin', name: 'THIN', task: 'variation', drum: false, cls: 'rhythm', fit: () => 0.5,
    knobs: [K.amount(5), K.harmony(1), K.length(7), K.range(5)],
    generate: (ctx, v, seed) => {
        const out = over(ctx, partEvs(ctx), { h: v[1], range: v[3] });
        return finish(ctx, out, { density: Math.max(0, 4 - Math.round(v[0] * 0.4)), length: v[2], h: v[1] }, rng(seed));
    },
};

