/* Chords (a pad, stabs) over new chords, voiced for the whole part at once
 * (theory/voicings.ts, plans/2026-10-29-generator-follow-ups.md #3): the
 * source's number of voices picks the stack, TENSION adds the seventh, then
 * the ninth, RANGE opens or closes it, and each chord's top note follows the
 * source's top line, so the part keeps its shape. A chord struck again keeps
 * its notes; the loop leads back into its first chord. */

import type { GenCtx } from '../analysis/context.js';
import { chordAt } from '../analysis/context.js';
import type { Chord, Ev } from '../types.js';
import { closeVoicing } from '../theory/voicing.js';
import { voiceAll } from '../theory/voicings.js';
import { nearestPitch, pc, sameChord } from '../theory/pc.js';
import { bounds, type RealiseOpts } from './common.js';

const sig = (e: Ev) => e.voices.map((v) => v.pitch).join(',');

/* STYLES positions (theory/voicing-styles.ts). */
const DUO = 0, TRIAD = 1, OPEN = 2, SHELL = 3, ADD9 = 4, SEVENTH = 5, DROP2 = 6, NEO_SOUL = 11;

function styleFor(voices: number, o: RealiseOpts): number {
    const want7 = o.tension >= 0.55 || o.plan.sit === '7th' || o.plan.sit === '9th';
    const want9 = o.tension >= 0.8 || o.plan.sit === '9th';
    const wide = o.range > 1.05;
    if (want7) return voices <= 3 ? SHELL : want9 && voices >= 5 ? NEO_SOUL : wide ? DROP2 : SEVENTH;
    if (voices <= 2) return DUO;
    if (want9 && voices >= 4) return ADD9;
    return wide ? OPEN : TRIAD;
}

/* Voice-leading prefers the window; this holds it: an octave in at a time.
 * Only a root put under the chord may go an octave below it. */
const fold = (p: number, lo: number, hi: number): number => {
    let q = p;
    while (q < lo && q + 12 <= Math.max(hi, lo + 12)) q += 12;
    while (q > hi && q - 12 >= lo) q -= 12;
    return q;
};

export function realiseChords(ctx: GenCtx, evs: Ev[], o: RealiseOpts): Ev[] {
    const [lo, hi] = bounds(ctx, o.range);
    const voices = Math.max(1, ...evs.map((e) => e.voices.length));
    /* One entry per run of a chord the source strikes alike: the chord, and
     * the source's top note there. Where the source moves over one chord (an
     * inversion climbing), the part moves with it. */
    const runs: Chord[] = [], tops: number[] = [], sigs: string[] = [];
    const at = evs.map((e) => {
        const T = chordAt(o.plan.chords, e.tick, ctx.k) ?? chordAt(ctx.srcChords, e.tick, ctx.k);
        if (!T) return -1;
        const s = sig(e);
        if (!runs.length || !sameChord(T, runs[runs.length - 1]) || s !== sigs[sigs.length - 1]) {
            runs.push(T); sigs.push(s); tops.push(Math.max(...e.voices.map((v) => v.pitch)));
        }
        return runs.length - 1;
    });
    const wrap = runs.length > 1 && sameChord(runs[0], runs[runs.length - 1]) && sigs[0] === sigs[sigs.length - 1];
    const n = wrap ? runs.length - 1 : runs.length;
    const voiced = voiceAll(runs.slice(0, n), ctx.key, { style: styleFor(voices, o), anchor: tops[0] ?? ctx.mid, anchors: tops.slice(0, n),
        lo, hi: Math.max(hi, lo + 18), loop: true, holdRepeats: false, motion: 'TOP LINE' });
    const bassPc = (T: Chord) => o.plan.pedal ?? (o.plan.sit === 'roots' ? T.pcs[0] : o.plan.sit === 'inv' ? T.pcs[1] : null);
    const full = voiced.map((v0, i) => {
        let v = [...v0];
        if (o.range < 0.95 && v.length >= 3) v = closeVoicing(runs[i].pcs, v.length, Math.round(v.reduce((a, b) => a + b, 0) / v.length));
        /* Two voices with a seventh are its guide tones: the shell without its root. */
        if (voices <= 2 && v.length > voices) v = v.filter((p) => pc(p) !== runs[i].pcs[0]).slice(-voices);
        /* More voices than the stack: the lowest notes again an octave up. */
        for (let j = 0; v.length && v.length < voices; j++) v.push(fold(v[j] + 12, lo, hi + 12));
        const b = bassPc(runs[i]);
        if (b !== null && v.length) {
            const low = nearestPitch(v[0] - 2, [b], lo - 12, v[0]);
            v[0] = Math.min(low, v[0]);
            if (pc(v[0]) !== b) v[0] = nearestPitch(v[0] - 12, [b], lo - 12, v[0]);
            v[0] = fold(v[0], lo - 12, hi);
        }
        return v.sort((x, y) => x - y);
    });
    return evs.map((e, i) => {
        const outE = { tick: e.tick, voices: e.voices.map((v) => ({ ...v })) };
        const v = at[i] < 0 ? null : full[at[i] % Math.max(1, n)];
        if (v?.length) outE.voices.forEach((x, j) => { x.pitch = v[Math.min(j, v.length - 1)]; });
        return outE;
    });
}
