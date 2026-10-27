/* Variation: an arpeggio re-patterned over the target chords, and DEVELOP —
 * the eight-knob generator that does a little of everything. */

import { chordAt } from '../analysis/context.js';
import { custom, K, tensionOfKnob } from '../knobs.js';
import { planAt } from '../plan.js';
import type { Preset } from '../preset.js';
import { rng, shuffled } from '../rng.js';
import { colourPcs } from '../theory/category.js';
import { nearestPitch, pc, sameChord } from '../theory/pc.js';
import { displace } from '../shape/time.js';
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
    custom('OCTAVES', ['1', '2', '3'], 1), K.harmony(1)],
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
 *  RHYTHM moves onsets (anticipate → displace → shuffle the gaps), then the
 *  harmony, tension, density, range and length stages. */
export const DEVELOP: Preset = {
    id: 'v-develop', name: 'DEVELOP', task: 'variation', drum: false, cls: 'exp', fit: () => 0.55,
    knobs: [K.amount(4), K.harmony(1), K.tension(5), custom('RHYTHM', ['KEEP', 'PUSH 1', 'PUSH 2', 'PUSH 3', 'SHIFT 1', 'SHIFT 2',
        'SHIFT 3', 'SHUFFLE 1', 'SHUFFLE 2', 'SHUFFLE 3'], 4), K.density(5), K.range(5), K.length(5), K.seed()],
    generate: (ctx, v, seed) => {
        const r = rng(seed + v[7] * 7919);
        let evs = partEvs(ctx);
        const rh = v[3];
        if (rh > 0 && evs.length > 1) {
            const share = 0.15 + ((rh - 1) % 3) * 0.15;
            const sel = someOf(evs.length, share, r);
            if (rh <= 3) evs = displace(evs, (i) => sel.has(i) && i > 0, -1, ctx.end);
            else if (rh <= 6) evs = displace(evs, (i) => sel.has(i), r() < 0.5 ? 1 : 2, ctx.end);
            else {
                const gaps = evs.map((e, i) => (i + 1 < evs.length ? evs[i + 1].tick : ctx.end + evs[0].tick) - e.tick);
                const sh = shuffled(r, gaps);
                let t = evs[0].tick;
                evs = evs.map((e, i) => { const x = { tick: t, voices: e.voices }; t += sel.has(i) ? sh[i] : gaps[i]; return x; })
                    .filter((e) => e.tick < ctx.end);
            }
            evs = evs.sort((a, b) => a.tick - b.tick).filter((e, i, a) => i === 0 || e.tick !== a[i - 1].tick);
        }
        let out = over(ctx, evs, { h: v[1], tension: v[2], range: v[5] });
        const pick = someOf(out.length, v[0] / 10, r);
        out = out.map((e, i) => {
            if (!pick.has(i) || e.voices.length > 1) return e;
            const T = targetAt(ctx, v[1], e.tick);
            if (!T) return e;
            const tones = tensionOfKnob(v[2]) >= 0.5 ? [...T.pcs, ...colourPcs(T, ctx.key)] : T.pcs;
            const x = e.voices[0];
            const alt = tones.filter((p) => p !== pc(x.pitch));
            const want = alt.length ? alt[Math.floor(r() * alt.length)] : pc(x.pitch);
            return { tick: e.tick, voices: [{ ...x, pitch: nearestPitch(x.pitch, [want], ctx.lo - 3, ctx.hi + 3) }] };
        });
        return finish(ctx, out, { density: v[4], length: v[6], h: v[1] }, r);
    },
};
