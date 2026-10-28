/* Variation: an arpeggio re-patterned over the target chords, and DEVELOP —
 * the eight-knob generator that does a little of everything. */

import { chordAt } from '../analysis/context.js';
import { custom, K, tensionOfKnob } from '../knobs.js';
import { planAt } from '../plan.js';
import type { Preset } from '../preset.js';
import { rng, shuffled } from '../rng.js';
import { colourPcs } from '../theory/category.js';
import { nearestPitch, pc, sameChord } from '../theory/pc.js';
import { type Ev, TPS } from '../types.js';
import { finish, over, partEvs, someOf, targetAt } from './helpers.js';

const PATTERNS = ['UP', 'DOWN', 'UP-DOWN', 'DOWN-UP', 'CONVERGE', 'RANDOM'] as const;
const RATES = [TPS * 2, TPS, (TPS * 2) / 3, TPS / 2];

function order(tones: number[], pat: number, r: () => number): number[] {
    const up = [...tones].sort((a, b) => a - b);
    if (pat === 0) return up;
    if (pat === 1) return [...up].reverse();
    if (pat === 2) return [...up, ...up.slice(1, -1).reverse()];
    if (pat === 3) return [...[...up].reverse(), ...up.slice(1, -1)];
    if (pat === 4) { const o: number[] = []; for (let i = 0, j = up.length - 1; i <= j; i++, j--) { o.push(up[i]); if (j !== i) o.push(up[j]); } return o; }
    return shuffled(r, up);
}

export const ARP: Preset = {
    id: 'v-arp', name: 'ARP', task: 'variation', drum: false, cls: 'close', fit: () => 0.8, roles: ['arpeggio'],
    knobs: [custom('PATTERN', PATTERNS, 0), { ...custom('RATE', ['1/8', '1/16', '1/16T', '1/32'], 1),
        def: (c) => { const g = c.role ? c.role.lenSteps : 1; return g >= 1.6 ? 0 : 1; } },
    custom('OCTAVES', ['1', '2', '3', '4'], 1), K.harmony(1)],
    generate: (ctx, v, seed) => {
        const r = rng(seed);
        const src = partEvs(ctx);
        if (!src.length) return [];
        const rate = RATES[v[1]];
        const chords = planAt(ctx, v[3]).chords;
        const lo = ctx.lo;
        const hi = Math.max(ctx.hi, lo + 12 * (v[2] + 1));
        const out: Ev[] = [];
        let seq: number[] = [];
        let i = 0;
        let last: ReturnType<typeof chordAt> = null;
        for (let t = src[0].tick % rate; t < ctx.end; t += rate) {
            const c = chordAt(chords, t, ctx.k) ?? chordAt(ctx.srcChords, t, ctx.k);
            if (!c) continue;
            if (!sameChord(c, last) || !seq.length) {
                const tones: number[] = [];
                for (let p = lo; p <= Math.min(hi, lo + 12 * (v[2] + 1)); p++) if (c.pcs.includes(pc(p))) tones.push(p);
                seq = order(tones, v[0], r);
                last = c;
            }
            const proto = src[Math.floor(i % src.length)].voices[0];
            out.push({ tick: Math.round(t), voices: [{ pitch: seq[i % seq.length], dt: 0, gate: Math.max(2, Math.round(rate * 0.8)), vel: proto.vel }] });
            i++;
        }
        return finish(ctx, out, {}, r);
    },
};

/** Everything at once, gently: AMOUNT re-picks pitches from the chord tones,
 *  RHYTHM reshapes the onsets (shape/rhythm.ts), CHANGES moves the chords more
 *  often, then the tension, density and range stages. */
export const DEVELOP: Preset = {
    id: 'v-develop', name: 'DEVELOP', task: 'variation', drum: false, cls: 'exp', fit: () => 0.55,
    knobs: [K.amount(4), K.harmony(1), K.changes(1), K.tension(5), K.rhythm(2), K.density(5), K.range(5), K.seed()],
    generate: (ctx, v, seed) => {
        const r = rng(seed + v[7] * 7919);
        let out = over(ctx, partEvs(ctx), { h: v[1], changes: v[2], tension: v[3], rhythm: v[4], range: v[6], r });
        const pick = someOf(out.length, v[0] / 10, r);
        out = out.map((e, i) => {
            if (!pick.has(i) || e.voices.length > 1) return e;
            const T = targetAt(ctx, v[1], e.tick, v[2]);
            if (!T) return e;
            const tones = tensionOfKnob(v[3]) >= 0.5 ? [...T.pcs, ...colourPcs(T, ctx.key)] : T.pcs;
            const x = e.voices[0];
            const alt = tones.filter((p) => p !== pc(x.pitch));
            const want = alt.length ? alt[Math.floor(r() * alt.length)] : pc(x.pitch);
            return { tick: e.tick, voices: [{ ...x, pitch: nearestPitch(x.pitch, [want], ctx.lo - 5, ctx.hi + 5) }] };
        });
        return finish(ctx, out, { density: v[5], h: v[1], changes: v[2] }, r);
    },
};
