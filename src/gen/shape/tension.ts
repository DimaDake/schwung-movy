/* TENSION as a dial rather than four switches (bench 2026-10-29, plans/
 * 2026-10-29-generator-quality-metrics.md: 88% of its clicks changed nothing,
 * since the realiser only moved notes that were already off the chord). From
 * 5 up, each click turns more of the part's chord tones into colour tones —
 * the weak beats first, then the strong — and from 5 down, more of its
 * outside notes onto chord tones. The order is fixed per part, so every
 * position holds the one below it plus a few notes: turning walks, never jumps.
 * Only the top voice moves: a melody's note, a chord's top extension. */

import { chordAt, type Prog } from '../analysis/context.js';
import type { GenCtx } from '../analysis/context.js';
import { strength } from '../analysis/events.js';
import { hash } from '../rng.js';
import { categoryOf, colourPcs } from '../theory/category.js';
import { nearestPitch, pc } from '../theory/pc.js';
import type { Ev } from '../types.js';

/* At most this far from the note it replaces: a colour tone next door. */
const REACH = 3;

export function tensionStage(ctx: GenCtx, evs: Ev[], chords: Prog, t: number): Ev[] {
    if (Math.abs(t - 0.5) < 1e-6 || !evs.length) return evs;
    const out = evs.map((e) => ({ tick: e.tick, voices: e.voices.map((v) => ({ ...v })) }));
    const top = (e: Ev) => e.voices.reduce((a, b) => (b.pitch > a.pitch ? b : a));
    const rank = (e: Ev) => strength(e.tick) * 1e6 + (hash(String(e.tick)) % 1e6);
    if (t > 0.5) {
        const cands = out.flatMap((e) => {
            const T = chordAt(chords, e.tick, ctx.k);
            const v = top(e);
            if (!T || categoryOf(v.pitch, T, ctx.key) !== 'chord') return [];
            const col = colourPcs(T, ctx.key).filter((c) => !e.voices.some((x) => pc(x.pitch) === c));
            const q = col.length ? nearestPitch(v.pitch, col) : -1;
            return q >= 0 && Math.abs(q - v.pitch) <= REACH ? [{ e, v, q }] : [];
        }).sort((a, b) => rank(a.e) - rank(b.e));
        const n = Math.ceil(((t - 0.5) / 0.5) * cands.length);
        for (const c of cands.slice(0, n)) c.v.pitch = c.q;
    } else {
        const cands = out.flatMap((e) => {
            const T = chordAt(chords, e.tick, ctx.k);
            const v = top(e);
            return T && categoryOf(v.pitch, T, ctx.key) !== 'chord' ? [{ v, T, e }] : [];
        }).sort((a, b) => rank(b.e) - rank(a.e));
        const n = Math.ceil(((0.5 - t) / 0.5) * cands.length);
        for (const c of cands.slice(0, n)) c.v.pitch = nearestPitch(c.v.pitch, c.T.pcs);
    }
    return out;
}
