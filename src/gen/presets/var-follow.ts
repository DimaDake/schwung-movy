/* FOLLOW: the part moved as a whole along the root motion from the source's
 * chords to the target's, by scale steps — diatonic planing for chords (one
 * shape slid through the key, as dub and house chord stabs move), a diatonic
 * sequence for lines. The closest a B part gets to its A while following a
 * new harmony. */

import type { GenCtx } from '../analysis/context.js';
import { chordAt } from '../analysis/context.js';
import { isStrong } from '../analysis/events.js';
import { custom, K } from '../knobs.js';
import { planAt } from '../plan.js';
import type { Preset } from '../preset.js';
import { rng } from '../rng.js';
import { allowedPcs } from '../theory/category.js';
import { nearestPitch, pc, scaleOf, stepScale } from '../theory/pc.js';
import { BAR, type Chord, type Ev } from '../types.js';
import { finish, partEvs } from './helpers.js';
import { rhythmStage } from '../shape/rhythm.js';
import { thicken } from '../shape/thicken.js';

/** Scale steps from one root to another, -3..+3 (nearest), or up/down only. */
export function rootSteps(ctx: GenCtx, s: Chord, t: Chord, dir: number): number {
    const sc = scaleOf(ctx.key);
    const a = sc.indexOf(s.root);
    const b = sc.indexOf(t.root);
    if (a < 0 || b < 0) return 0;
    const up = (b - a + 7) % 7;
    if (dir === 1) return up;
    if (dir === 2) return up === 0 ? 0 : up - 7;
    return up > 3 ? up - 7 : up;
}

function rootsMove(ctx: GenCtx): boolean {
    const t = ctx.plans[0]?.chords ?? [];
    return t.some((c, i) => {
        const s = ctx.srcChords.length ? ctx.srcChords[i % ctx.srcChords.length] : null;
        return !!c && !!s && c.root !== s.root;
    });
}

export const FOLLOW: Preset = {
    id: 'v-follow', name: 'FOLLOW', task: 'variation', drum: false, cls: 'close',
    knobs: [K.harmony(1), K.changes(0), K.tension(3), custom('DIRECTION', ['NEAREST', 'UP', 'DOWN'], 0), K.rhythm(0), K.voices(1),
        K.length(5), K.density(5)],
    /* When the roots move, sliding the part along them is how a B section is
     * most often made; when they do not, there is nothing to follow. */
    fit: (c) => (rootsMove(c) ? 0.9 : 0.3),
    generate: (ctx, v, seed) => {
        const r = rng(seed);
        const chords = planAt(ctx, v[0], v[1]).chords;
        const tension = v[2] / 10;
        const dir = v[3];
        /* A line moves by phrases: one shift per bar, read on its downbeat.
         * Chords plane one by one. */
        const line = !(ctx.role?.kind === 'pad' || ctx.role?.kind === 'stabs');
        let cur = 0;
        let curBar = -1;
        const src = v[4] ? rhythmStage(ctx, partEvs(ctx), v[4], r) : partEvs(ctx);
        const out: Ev[] = src.map((e) => {
            const at = line ? Math.floor(e.tick / BAR) * BAR : e.tick;
            const S = chordAt(ctx.srcChords, at, ctx.k);
            const T = chordAt(chords, at, ctx.k) ?? S;
            if (!S || !T) return e;
            if (!line || Math.floor(e.tick / BAR) !== curBar) {
                curBar = Math.floor(e.tick / BAR);
                /* NEAREST continues from where the part already is, but never
                 * walks away from its register: past a fourth either way costs
                 * more than a leap back. UP and DOWN measure from the source. */
                const base = rootSteps(ctx, S, T, dir);
                const cost = (n: number) => Math.abs(n - cur) + 1.5 * Math.max(0, Math.abs(n) - 3);
                cur = dir !== 0 ? base : [base - 7, base, base + 7].sort((a, b) => cost(a) - cost(b))[0];
            }
            const n = cur;
            const T2 = chordAt(chords, e.tick, ctx.k) ?? T;
            const strong = isStrong(e.tick);
            const ok = allowedPcs(T2, ctx.key, tension, strong);
            return { tick: e.tick, voices: e.voices.map((x) => {
                const p = stepScale(x.pitch, n, ctx.key);
                /* A planed voice that lands on a clash snaps by the least;
                 * TENSION decides what counts as one. */
                return { ...x, pitch: ok.includes(pc(p)) || e.voices.length > 1 && T2.pcs.includes(pc(p)) ? p : nearestPitch(p, ok) };
            }) };
        });
        const thick = v[5] !== 1 ? thicken(ctx, out, v[5] - 1, chords, tension) : out;
        return finish(ctx, thick, { length: v[6], density: v[7], h: v[0], changes: v[1] }, r);
    },
};
