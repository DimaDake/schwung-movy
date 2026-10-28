/* PULSE and HARMONIZE: two B-section moves electronic music leans on. PULSE
 * keeps the rhythm and plays it on one tone of each chord (the pumping root
 * of techno and house); HARMONIZE thickens a line in parallel diatonic thirds
 * or sixths, fitted to the chords. */

import { chordAt } from '../analysis/context.js';
import { custom, K } from '../knobs.js';
import { planAt } from '../plan.js';
import type { Preset } from '../preset.js';
import { rng } from '../rng.js';
import { nearestPitch, pc, stepScale } from '../theory/pc.js';
import type { Ev } from '../types.js';
import { finish, partEvs } from './helpers.js';
import { rhythmStage } from '../shape/rhythm.js';
import { dynamics } from '../shape/dynamics.js';

export const PULSE: Preset = {
    id: 'v-pulse', name: 'PULSE', task: 'variation', drum: false, cls: 'close', roles: ['bass', 'arpeggio', 'lead', 'stabs'],
    fit: (c) => (c.role?.kind === 'bass' || c.role?.kind === 'arpeggio' ? 0.65 : 0.4),
    knobs: [custom('NOTE', ['ROOT', 'FIFTH', 'THIRD'], 0), custom('OCTAVE', ['LOW', 'MIDDLE', 'HIGH', 'OCTAVE UP'], 0), K.harmony(1), K.length(5),
        K.rhythm(0), K.changes(0), K.density(5), K.dynamics(0)],
    generate: (ctx, v, seed) => {
        const r = rng(seed);
        const chords = planAt(ctx, v[2], v[5]).chords;
        const span = Math.max(12, ctx.hi - ctx.lo);
        const anchor = ctx.lo + Math.round((span * v[1]) / 2);
        const src = v[4] ? rhythmStage(ctx, partEvs(ctx), v[4], r) : partEvs(ctx);
        const out: Ev[] = src.map((e) => {
            const T = chordAt(chords, e.tick, ctx.k) ?? chordAt(ctx.srcChords, e.tick, ctx.k);
            if (!T) return e;
            const tone = T.pcs[[0, 2, 1][v[0]]] ?? T.pcs[0];
            const p = nearestPitch(anchor, [tone], ctx.lo - 7, ctx.hi + 12);
            return { tick: e.tick, voices: e.voices.map((x, i) => ({ ...x, pitch: i === 0 ? p : nearestPitch(p + 12 * i, [tone]) })) };
        });
        return dynamics(finish(ctx, out, { length: v[3], density: v[6], h: v[2], changes: v[5] }, r), v[7]);
    },
};

const INTERVALS = [2, 5, -2, -5, 9];

export const HARMONIZE: Preset = {
    id: 'v-harmonize', name: 'HARMONIZE', task: 'variation', drum: false, cls: 'close', roles: ['lead', 'arpeggio'],
    /* A line that already plays two notes at times takes a second voice; a
     * strictly single line would stop being one (the role rule). */
    accepts: (c) => !!c.role && c.role.voices > 1.1,
    fit: () => 0.7,
    knobs: [custom('INTERVAL', ['3RD UP', '6TH UP', '3RD DOWN', '6TH DOWN', '10TH UP'], 0), K.amount(10), K.harmony(1), K.tension(4)],
    generate: (ctx, v, seed) => {
        const r = rng(seed);
        const chords = planAt(ctx, v[2]).chords;
        const out: Ev[] = partEvs(ctx).map((e) => {
            const T = chordAt(chords, e.tick, ctx.k) ?? chordAt(ctx.srcChords, e.tick, ctx.k);
            const top = e.voices[e.voices.length - 1];
            const S = chordAt(ctx.srcChords, e.tick, ctx.k);
            /* The line itself follows the new chord by its member first. */
            const lead = T && S && S.pcs.includes(pc(top.pitch)) ? nearestPitch(top.pitch, [T.pcs[Math.min(S.pcs.indexOf(pc(top.pitch)), T.pcs.length - 1)]])
                : T ? nearestPitch(top.pitch, [...T.pcs]) : top.pitch;
            if (r() * 10 >= v[1] || !T) return { tick: e.tick, voices: [{ ...top, pitch: lead }] };
            let second = stepScale(lead, INTERVALS[v[0]], ctx.key);
            if (v[3] < 5 && !T.pcs.includes(pc(second))) second = nearestPitch(second, T.pcs, second - 2, second + 2);
            const ps = [lead, second].sort((a, b) => a - b);
            return { tick: e.tick, voices: ps.map((p) => ({ ...top, pitch: p })) };
        });
        return finish(ctx, out, {}, r);
    },
};
