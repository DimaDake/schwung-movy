/* A single line (lead, arpeggio, drone, bass) over new chords: each note
 * keeps what it was — the chord member, the colour, the approach — and the
 * line keeps its contour, nearest to where it was going and inside its
 * register. A bass lands on the root where the chord changes. */

import type { GenCtx } from '../analysis/context.js';
import { chordAt } from '../analysis/context.js';
import { isStrong } from '../analysis/events.js';
import type { Chord, Ev } from '../types.js';
import { allowedPcs, categoryOf } from '../theory/category.js';
import { near, nearestPitch, pc, sameChord } from '../theory/pc.js';
import { bounds, mapColour, mapMember, memberOf, type RealiseOpts } from './common.js';

function choose(desired: number, pref: number[], allowed: number[], lo: number, hi: number): number {
    const a = pref.length ? nearestPitch(desired, pref, lo, hi) : -1;
    const b = nearestPitch(desired, allowed.length ? allowed : [pc(desired)], lo, hi);
    /* The mapped tone wins unless it would bend the contour by more than a
     * third: the line's shape is what makes it the same line. */
    return a >= 0 && Math.abs(a - desired) <= Math.abs(b - desired) + 3 ? a : b;
}

export function realiseLine(ctx: GenCtx, evs: Ev[], o: RealiseOpts, bass: boolean): Ev[] {
    const [lo, hi] = bounds(ctx, o.range);
    const pull = o.pull ?? 0.3;
    let prevSrc: number | null = null;
    let prevOut: number | null = null;
    let prevT: Chord | null = null;
    const out = evs.map((e) => ({ tick: e.tick, voices: e.voices.map((v) => ({ ...v })) }));
    out.forEach((e, i) => {
        const top = e.voices[e.voices.length - 1];
        const p = top.pitch;
        const S = chordAt(ctx.srcChords, e.tick, ctx.k);
        const T = chordAt(o.plan.chords, e.tick, ctx.k) ?? S;
        const strong = isStrong(e.tick);
        if (!T) { prevSrc = p; prevOut = p; return; }
        const allowed = allowedPcs(T, ctx.key, o.tension, strong);
        let pref: number[] = [];
        const changed = !sameChord(T, prevT);
        if (o.plan.pedal !== null && (bass || ctx.role?.kind === 'drone')) pref = [o.plan.pedal];
        else if (bass && (changed || i === 0) && strong) pref = [mapMember(o.plan.sit === 'inv' ? 0 : 0, T, o.plan.sit, true, ctx.key)];
        else if (S) {
            const cat = categoryOf(p, S, ctx.key);
            if (cat === 'chord') pref = [mapMember(memberOf(p, S), T, o.plan.sit, strong, ctx.key)];
            else if (cat === 'colour') { const q = mapColour(p, S, T); if (allowed.includes(q)) pref = [q]; }
            else if (!strong && o.tension >= 0.3) pref = [pc(p + near(S.root, T.root))];
        } else pref = [pc(p)];
        const shift = S ? near(S.root, T.root) : 0;
        const anchor = p + shift;
        const desired = prevOut === null || prevSrc === null ? anchor
            : (1 - pull) * (prevOut + (p - prevSrc) * o.range) + pull * anchor;
        const q = choose(desired, pref, allowed, lo, hi);
        const d = q - p;
        for (const v of e.voices) {
            v.pitch = v === top ? q : nearestPitch(v.pitch + d, T.pcs, lo - 12, hi);
        }
        prevSrc = p;
        prevOut = q;
        prevT = T;
    });
    return approaches(ctx, evs, out, o);
}

/* A source note that led by step into the next one still does: placed the
 * same interval from the next note's new pitch, if the tension admits it. */
function approaches(ctx: GenCtx, src: Ev[], out: Ev[], o: RealiseOpts): Ev[] {
    for (let i = 0; i + 1 < out.length; i++) {
        const a = src[i].voices[src[i].voices.length - 1].pitch;
        const b = src[i + 1].voices[src[i + 1].voices.length - 1].pitch;
        const S = chordAt(ctx.srcChords, src[i].tick, ctx.k);
        if (!S || isStrong(src[i].tick) || Math.abs(a - b) > 2 || a === b) continue;
        if (categoryOf(a, S, ctx.key) === 'chord') continue;
        const T = chordAt(o.plan.chords, out[i].tick, ctx.k) ?? S;
        const nextOut = out[i + 1].voices[out[i + 1].voices.length - 1].pitch;
        const q = nextOut + (a - b);
        if (o.tension >= 0.3 || allowedPcs(T, ctx.key, o.tension, false).includes(pc(q))) {
            const top = out[i].voices[out[i].voices.length - 1];
            top.pitch = q;
        }
    }
    return out;
}
