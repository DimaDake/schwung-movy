/* Variation for held and low parts: a drone that moves by common tones, a
 * pedal under or inside a moving part, octave and walking bass, and a part
 * thinned to its strongest notes. */

import { chordAt } from '../analysis/context.js';
import { isStrong, spanTo, strength } from '../analysis/events.js';
import { custom, K } from '../knobs.js';
import { planAt } from '../plan.js';
import type { Preset } from '../preset.js';
import { rng } from '../rng.js';
import { nearestPitch, pc, sameChord } from '../theory/pc.js';
import { type Ev, HALF } from '../types.js';
import { finish, over, partEvs, someOf, targetAt } from './helpers.js';

/** A drone re-placed on every chord change: the root, fifth or third of the
 *  new chord, or the tone it shares with the old one (a pivot). */
export const DRONE: Preset = {
    id: 'v-drone', name: 'DRONE MOVE', task: 'variation', drum: false, cls: 'close', fit: () => 0.85, roles: ['drone'],
    knobs: [custom('NOTE', ['PIVOT', 'ROOT', 'FIFTH', 'THIRD'], 0), custom('SHARED', ['TIE', 'RESTRIKE'], 0),
        K.harmony(1), K.length(7)],
    generate: (ctx, v, seed) => {
        const src = partEvs(ctx);
        if (!src.length) return [];
        const proto = src[0].voices[0];
        const chords = planAt(ctx, v[2]).chords;
        const out: Ev[] = [];
        let prev = proto.pitch;
        let prevC = null as ReturnType<typeof chordAt>;
        for (let t = 0; t < ctx.end; t += HALF) {
            const c = chordAt(chords, t, ctx.k) ?? chordAt(ctx.srcChords, t, ctx.k);
            if (!c || (t > 0 && sameChord(c, prevC))) continue;
            const want = v[0] === 0 ? (c.pcs.includes(pc(prev)) ? [pc(prev)] : c.pcs) : [c.pcs[[0, 0, 2, 1][v[0]]] ?? c.pcs[0]];
            const p = nearestPitch(prev, want, ctx.lo - 5, ctx.hi + 5);
            prevC = c;
            /* A tone the new chord shares is held through the change (TIE)
             * or struck again with it (RESTRIKE). */
            if (v[1] === 0 && out.length && p === prev) { prev = p; continue; }
            prev = p;
            out.push({ tick: t, voices: [{ ...proto, pitch: prev, dt: 0, gate: HALF }] });
        }
        out.forEach((e, i) => { e.voices[0].gate = spanTo(out, i, ctx.end) - 2; });
        return finish(ctx, out, { length: v[3] }, rng(seed));
    },
};

/** A pedal: lines alternate with it, a bass returns to it, chords keep it as
 *  their top voice; the tonic, the key's fifth, or each chord's root. */
export const PEDAL: Preset = {
    id: 'v-pedal', name: 'PEDAL', task: 'variation', drum: false, cls: 'exp', fit: () => 0.5,
    knobs: [K.amount(5), custom('NOTE', ['TONIC', 'FIFTH', 'CHORD ROOT'], 0), K.harmony(1), K.range(5)],
    generate: (ctx, v, seed) => {
        const r = rng(seed);
        const out = over(ctx, partEvs(ctx), { h: v[2], range: v[3] });
        const sel = someOf(out.length, v[0] / 10, r);
        const kind = ctx.role?.kind;
        out.forEach((e, i) => {
            if (!sel.has(i)) return;
            if (kind === 'bass' && isStrong(e.tick)) return;
            const T = targetAt(ctx, v[2], e.tick);
            const ped = v[1] === 0 ? ctx.key.tonic : v[1] === 1 ? pc(ctx.key.tonic + 7) : T?.root ?? ctx.key.tonic;
            const top = e.voices[e.voices.length - 1];
            if (e.voices.length > 1) top.pitch = nearestPitch(top.pitch, [ped], top.pitch - 5, top.pitch + 5);
            else top.pitch = nearestPitch(kind === 'bass' ? ctx.lo : ctx.mid, [ped], ctx.lo - 3, ctx.hi + 3);
        });
        return finish(ctx, out, {}, r);
    },
};

/** Octave bass: chosen notes jump up an octave, by a pattern. */
export const OCTAVE: Preset = {
    id: 'v-octave', name: 'OCTAVE BASS', task: 'variation', drum: false, cls: 'rhythm', fit: () => 0.6, roles: ['bass'],
    knobs: [K.amount(5), custom('PATTERN', ['OFFBEATS', 'ALTERNATE', 'LAST', 'RANDOM'], 0), K.harmony(1), K.length(5)],
    generate: (ctx, v, seed) => {
        const r = rng(seed);
        const out = over(ctx, partEvs(ctx), { h: v[2] });
        const pick = (e: Ev, i: number) => (v[1] === 0 ? strength(e.tick) < 0.7 : v[1] === 1 ? i % 2 === 1
            : v[1] === 2 ? i % 4 === 3 : r() < 0.5);
        const cand = out.map((e, i) => i).filter((i) => pick(out[i], i));
        const sel = someOf(cand.length, Math.max(0.1, v[0] / 10), r);
        [...sel].forEach((j) => out[cand[j]].voices.forEach((x) => { x.pitch += x.pitch + 12 <= ctx.hi + 12 ? 12 : -12; }));
        return finish(ctx, out, { length: v[3] }, r);
    },
};

/** A walking approach into each chord change: the last notes before it step
 *  toward the new root, diatonic or chromatic. */
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
                    : nearestPitch(target + (out[i - j].voices[0].pitch > target ? 2 * j : -2 * j), T ? T.pcs.concat([pc(target + 2), pc(target - 2)]) : [pc(target)]);
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

