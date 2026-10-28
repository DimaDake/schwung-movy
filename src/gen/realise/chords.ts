/* Chords (a pad, stabs) over new chords: the same number of voices, each
 * moving as little as it can, the source's own voice motion carried over (an
 * inversion that climbed still climbs), a repeated chord repeated. TENSION
 * adds the seventh, then the ninth; RANGE opens or closes the voicing. */

import type { GenCtx } from '../analysis/context.js';
import { chordAt } from '../analysis/context.js';
import type { Chord, Ev } from '../types.js';
import { closeVoicing, spreadVoicing, voiceLead } from '../theory/voicing.js';
import { nearestPitch, pc, sameChord } from '../theory/pc.js';
import { colourPcs } from '../theory/category.js';
import { bounds, ninthOf, type RealiseOpts, seventhOf } from './common.js';

function tones(ctx: GenCtx, T: Chord, o: RealiseOpts): { pcs: number[]; required: number[] } {
    const third = T.pcs[1] ?? T.pcs[0];
    const pcs = [...T.pcs];
    const required = [third, T.pcs[0], T.pcs[2] ?? T.pcs[0]];
    const want7 = o.tension >= 0.55 || o.plan.sit === '7th' || o.plan.sit === '9th';
    if (want7) { const s = seventhOf(T, ctx.key); if (!pcs.includes(s)) pcs.push(s); required.splice(1, 0, s); }
    if (o.tension >= 0.8 || o.plan.sit === '9th') {
        const n = ninthOf(T);
        if (colourPcs(T, ctx.key).includes(n) || o.tension >= 0.9) { pcs.push(n); required.splice(2, 0, n); }
    }
    return { pcs: [...new Set(pcs)], required: [...new Set(required)] };
}

const sig = (e: Ev) => e.voices.map((v) => v.pitch).join(',');

export function realiseChords(ctx: GenCtx, evs: Ev[], o: RealiseOpts): Ev[] {
    const [lo, hi] = bounds(ctx, o.range);
    let prevOut: number[] | null = null;
    let prevSrc: Ev | null = null;
    let prevT: Chord | null = null;
    return evs.map((e) => {
        const src = e.voices.map((v) => v.pitch);
        const S = chordAt(ctx.srcChords, e.tick, ctx.k);
        const T = chordAt(o.plan.chords, e.tick, ctx.k) ?? S;
        const outE = { tick: e.tick, voices: e.voices.map((v) => ({ ...v })) };
        if (!T) { prevOut = src; prevSrc = e; return outE; }
        let v: number[];
        if (prevOut && prevSrc && sig(prevSrc) === sig(e) && sameChord(T, prevT)) v = [...prevOut];
        else {
            const { pcs, required } = tones(ctx, T, o);
            const anchor = prevOut && prevSrc && prevSrc.voices.length === e.voices.length
                ? prevOut.map((p, i) => p + (src[i] - prevSrc!.voices[i].pitch)) : src;
            v = src.length >= 1 ? voiceLead(anchor, pcs, required, lo, hi) : closeVoicing(pcs, 3, ctx.mid);
            if (o.range > 1.05) v = spreadVoicing(v, Math.round((o.range - 1) * 3), lo - 12);
            else if (o.range < 0.95 && v.length >= 3) v = closeVoicing(pcs, v.length, Math.round(v.reduce((a, b) => a + b, 0) / v.length));
            const bassPc = o.plan.pedal ?? (o.plan.sit === 'roots' ? T.pcs[0] : o.plan.sit === 'inv' ? T.pcs[1] : null);
            if (bassPc !== null && v.length) {
                const b = nearestPitch(v[0] - 2, [bassPc], lo - 12, v[0]);
                v[0] = Math.min(b, v[0]);
                if (pc(v[0]) !== bassPc) v[0] = nearestPitch(v[0] - 12, [bassPc], 0, v[0]);
            }
        }
        v.sort((a, b) => a - b);
        outE.voices.forEach((x, i) => { x.pitch = v[Math.min(i, v.length - 1)]; });
        prevOut = v;
        prevSrc = e;
        prevT = T;
        return outE;
    });
}
