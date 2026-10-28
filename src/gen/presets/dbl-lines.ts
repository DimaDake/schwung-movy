/* Smart Double for melodic parts, the endings that lead somewhere: a
 * TURNAROUND stepping into the clip's first note, a RUN up or down to it, a
 * CADENCE that lands and holds, a PUSH that anticipates the downbeat. Each
 * keeps the doubled clip and rewrites only its seams (shape/seams.ts). */

import { toEvents } from '../analysis/events.js';
import { count, custom, K } from '../knobs.js';
import type { Preset } from '../preset.js';
import { pitchFix } from '../shape/pitch.js';
import { chordPart, chordUnder, ENDING, gridIn, lineOf, nextEv, rewrite, SEAMS, seams, velOf } from '../shape/seams.js';
import { chordOf, nearestPitch, pc, stepScale } from '../theory/pc.js';
import { diatonic } from '../theory/roman.js';
import { voiceLead } from '../theory/voicing.js';
import { type Key, type Note, TPS } from '../types.js';
import type { GenCtx } from '../analysis/context.js';

const APPROACH = ['BELOW', 'ABOVE', 'ENCLOSE', 'CHROMATIC'] as const;
const scene = (ctx: GenCtx) => ctx.plans[0]?.chords ?? ctx.srcChords;

/* The note `k` onsets before the target on the way in. */
function approach(target: number, k: number, how: string, key: Key): number {
    if (how === 'ABOVE') return stepScale(target, k, key);
    if (how === 'CHROMATIC') return target - k;
    if (how === 'ENCLOSE') return k === 1 ? target - 1 : stepScale(target, k - 1, key);
    return stepScale(target, -k, key);
}

const onsets = (was: Note[]) => [...new Set(was.map((n) => n.tick))].sort((a, b) => a - b);

/** Up to eight of the ending's notes re-pitched to step into the first note. */
export const TURNAROUND: Preset = {
    id: 'x-turnaround', name: 'TURNAROUND', task: 'double', drum: false, cls: 'close', roles: ['lead', 'arpeggio', 'bass'],
    fit: () => 0.85,
    knobs: [ENDING, custom('APPROACH', APPROACH), K.tension(6), SEAMS],
    generate: (ctx, v) => {
        const nx = nextEv(ctx);
        if (!nx) return [];
        const target = lineOf(ctx, nx);
        return rewrite(ctx, seams(ctx, v[0], v[3]), (s, was) => {
            let ticks = onsets(was).slice(-8);
            if (ticks.length < 2) ticks = gridIn(s, 2 * TPS, 4);
            const vel = velOf(ctx, was);
            const notes = ticks.map((t, i) => ({ tick: t, pitch: approach(target, ticks.length - i, APPROACH[v[1]], ctx.key),
                gate: Math.max(TPS / 2, Math.round(((ticks[i + 1] ?? s.to) - t) * 0.9)), vel }));
            const kept = was.filter((n) => n.tick < ticks[0]);
            return [...kept, ...pitchFix(ctx, notes, 10 - v[2], scene(ctx))];
        });
    },
};

const RATES = [2 * TPS, TPS, (2 * TPS) / 3];

/** The ending replaced by a run into the first note. */
export const RUN: Preset = {
    id: 'x-run', name: 'RUN', task: 'double', drum: false, cls: 'rhythm', roles: ['lead', 'arpeggio', 'bass'], fit: () => 0.6,
    knobs: [ENDING, custom('RATE', ['8THS', '16THS', 'TRIPLETS'], 1), custom('DIRECTION', ['UP', 'DOWN', 'ARCH']),
        custom('NOTES', ['SCALE', 'CHORD', 'CHROMATIC'])],
    generate: (ctx, v) => {
        const nx = nextEv(ctx);
        if (!nx) return [];
        const target = lineOf(ctx, nx);
        return rewrite(ctx, seams(ctx, v[0]), (s, was) => {
            const ticks = gridIn(s, RATES[v[1]]);
            const n = ticks.length, vel = velOf(ctx, was);
            return ticks.map((t, i) => {
                const k = 1 + ((n - i - 1) % 7);
                const off = v[2] === 0 ? -k : v[2] === 1 ? k : Math.min(n - i, i + 1) % 8;
                const c = chordUnder(ctx, t);
                const p = v[3] === 2 ? target + off : stepScale(target, off, ctx.key);
                return { tick: t, pitch: v[3] === 1 && c ? nearestPitch(p, c.pcs) : p, gate: Math.round(RATES[v[1]] * 0.8),
                    vel: Math.round(vel * (0.7 + (0.3 * i) / Math.max(1, n - 1))) };
            });
        });
    },
};

const LAND = ['ROOT', 'FIFTH', 'TONIC', 'DOMINANT'] as const;
const HOLD = [0.25, 0.5, 0.75, 1];

/** The ending lands on one note (or chord) and holds it; with BOTH the first
 *  half ends open on the dominant, a question the second half answers. */
export const CADENCE: Preset = {
    id: 'x-cadence', name: 'CADENCE', task: 'double', drum: false, cls: 'close', fit: () => 0.75,
    knobs: [ENDING, custom('LAND', LAND, 2), custom('HOLD', ['1/4', '1/2', '3/4', 'FULL'], 3), SEAMS],
    generate: (ctx, v) => rewrite(ctx, seams(ctx, v[0], v[3]), (s, was) => {
        const t0 = was.length ? Math.min(...was.map((n) => n.tick)) : s.from;
        const land = s.main ? LAND[v[1]] : v[1] === 3 ? 'TONIC' : 'DOMINANT';
        const c = chordUnder(ctx, t0);
        const gate = Math.max(TPS / 2, Math.round((s.to - t0) * HOLD[v[2]]));
        const before = toEvents(ctx.src.filter((n) => n.tick <= t0)).pop();
        const vel = velOf(ctx, was);
        if (chordPart(ctx) && before) {
            const to = land === 'TONIC' ? diatonic(ctx.key, 0) : land === 'DOMINANT' ? chordOf(pc(ctx.key.tonic + 7), '7') : c;
            if (!to) return was;
            const ps = voiceLead(before.voices.map((x) => x.pitch), to.pcs, [to.root, to.pcs[1]], ctx.lo - 5, ctx.hi + 5);
            return ps.map((p) => ({ tick: t0, pitch: p, gate, vel }));
        }
        const ref = before ? lineOf(ctx, before) : ctx.mid;
        const want = land === 'TONIC' ? ctx.key.tonic : land === 'DOMINANT' ? ctx.key.tonic + 7
            : land === 'FIFTH' ? c?.pcs[2] ?? c?.root ?? ctx.key.tonic : c?.root ?? ctx.key.tonic;
        return [{ tick: t0, pitch: nearestPitch(ref, [pc(want)]), gate, vel }];
    }),
};

const PUSH_TICKS = [TPS, 2 * TPS, 4 * TPS];

/** The ending a 16th to a beat early, the first note anticipated into the seam. */
export const PUSH: Preset = {
    id: 'x-push', name: 'PUSH', task: 'double', drum: false, cls: 'rhythm', fit: () => 0.6,
    knobs: [ENDING, custom('PUSH', ['1/16', '1/8', '1/4'], 1), count('ACCENT', 10, 4), SEAMS],
    generate: (ctx, v) => {
        const nx = nextEv(ctx);
        if (!nx) return [];
        const push = PUSH_TICKS[v[1]];
        const accent = (vel: number) => Math.min(127, vel + v[2] * 3);
        return rewrite(ctx, seams(ctx, v[0], v[3]), (s, was) => [
            ...was.map((n) => ({ ...n, tick: Math.max(s.from, n.tick - push), gate: Math.min(n.gate, push * 2) })),
            ...nx.voices.map((x) => ({ tick: s.to - push, pitch: x.pitch, gate: push, vel: accent(x.vel) })),
        ]);
    },
};
