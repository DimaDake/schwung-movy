/* Smart Double for melodic parts, the endings that change what is said: an
 * ECHO of a figure moved through the scale, a STYLE walk in the part's own
 * language, a STOP before the loop comes round, a TURN to a chord that leads
 * back to the first one. Only the seams change (shape/seams.ts). */

import type { GenCtx } from '../analysis/context.js';
import { fromEvents, isStrong, toEvents } from '../analysis/events.js';
import { count, custom, K } from '../knobs.js';
import type { Preset } from '../preset.js';
import { rng } from '../rng.js';
import { pitchFix } from '../shape/pitch.js';
import { chordPart, chordUnder, ENDING, gridIn, lineOf, nextEv, rewrite, SEAMS, seams, velOf } from '../shape/seams.js';
import { walk } from '../style/melodic.js';
import { allowedPcs } from '../theory/category.js';
import { riemann } from '../theory/moves.js';
import { chordOf, nearestPitch, pc, sameChord, stepScale } from '../theory/pc.js';
import { voiceLead } from '../theory/voicing.js';
import { type Chord, type Ev, type Note, TPS } from '../types.js';

const scene = (ctx: GenCtx) => ctx.plans[0]?.chords ?? ctx.srcChords;
const STEPS = [-3, -2, -1, 0, 1, 2, 3, 4];

/** The ending is the figure before it (or the clip's opening) again, moved
 *  through the scale: a sequence into the turn of the loop. */
export const ECHO: Preset = {
    id: 'x-echo', name: 'ECHO', task: 'double', drum: false, cls: 'rhythm', fit: () => 0.6,
    knobs: [ENDING, custom('STEP', STEPS.map((s) => (s > 0 ? '+' : '') + s), 5), custom('FROM', ['BEFORE', 'OPENING']), SEAMS],
    generate: (ctx, v) => rewrite(ctx, seams(ctx, v[0], v[3]), (s) => {
        const len = s.to - s.from;
        const at = v[2] ? 0 : s.from - len;
        const fig = ctx.src.filter((n) => n.tick >= at && n.tick < at + len)
            .map((n) => ({ ...n, tick: n.tick - at + s.from, pitch: stepScale(n.pitch, STEPS[v[1]], ctx.key) }));
        return pitchFix(ctx, fig, 4, scene(ctx));
    }),
};

/** The ending written new by the part's learned style (style/melodic.ts). */
export const STYLE_X: Preset = {
    id: 'x-style', name: 'STYLE', task: 'double', drum: false, cls: 'exp', roles: ['lead', 'arpeggio', 'bass', 'pad', 'stabs'],
    fit: () => 0.55,
    knobs: [ENDING, K.likeness(3), K.density(5), K.seed()],
    generate: (ctx, v, seed) => {
        const r = rng(seed + v[3] * 7919);
        return rewrite(ctx, seams(ctx, v[0]), (s) => {
            const len = s.to - s.from;
            const evs = walk(ctx, toEvents(ctx.src), v[1], v[2], len, r).filter((e) => e.tick < len)
                .map((e) => ({ ...e, tick: e.tick + s.from }));
            return pitchFix(ctx, fromEvents(evs, ctx.end), 6, scene(ctx));
        });
    },
};

/** The part drops out for the ending: silence, one held note or one short
 *  hit, then PICKUP notes step into the first note. */
export const STOP: Preset = {
    id: 'x-stop', name: 'STOP', task: 'double', drum: false, cls: 'exp', fit: () => 0.5,
    knobs: [ENDING, custom('KIND', ['STOP', 'HOLD', 'STAB']), count('PICKUP', 3, 1), SEAMS],
    generate: (ctx, v) => {
        const nx = nextEv(ctx);
        if (!nx) return [];
        return rewrite(ctx, seams(ctx, v[0], v[3]), (s, was) => {
            const vel = velOf(ctx, was);
            const pick = gridIn(s, 2 * TPS, v[2]);
            const free = pick[0] ?? s.to;
            const last = toEvents(ctx.src.filter((n) => n.tick < s.from)).pop();
            const hit = v[1] === 0 || !last || free <= s.from ? []
                : last.voices.map((x) => ({ tick: s.from, pitch: x.pitch, gate: v[1] === 1 ? free - s.from : TPS, vel }));
            const target = lineOf(ctx, nx);
            const ups = pick.map((t, i) => (chordPart(ctx)
                ? nx.voices.map((x) => ({ tick: t, pitch: x.pitch, gate: TPS, vel }))
                : [{ tick: t, pitch: stepScale(target, -(pick.length - i), ctx.key), gate: TPS * 2 - 4, vel }])).flat();
            return [...hit, ...ups];
        }, true);
    },
};

const MOVES = ['V7', 'IV', 'TRITONE', 'R', 'L', 'P'] as const;

/* The chord the ending turns to: one that leads back to the first chord
 * (its dominant, subdominant or tritone substitute), or a Tonnetz step from
 * the chord the ending sits on. */
function turnTo(move: string, under: Chord, first: Chord): Chord {
    if (move === 'V7') return chordOf(pc(first.root + 7), '7');
    if (move === 'IV') return chordOf(pc(first.root + 5), 'maj');
    if (move === 'TRITONE') return chordOf(pc(first.root + 1), '7');
    return ['maj', 'min', 'maj7', '7', 'm7'].includes(under.quality) ? riemann(under, move as 'R' | 'L' | 'P') : under;
}

/** The ending over a new chord, where no other track sets the scene's chords. */
export const TURN_X: Preset = {
    id: 'x-turn', name: 'TURN', task: 'double', drum: false, cls: 'exp', fit: () => 0.55,
    accepts: (ctx) => ctx.freedom === 'free' && ctx.srcChords.some((c) => c),
    knobs: [ENDING, custom('MOVE', MOVES), K.tension(4), SEAMS],
    generate: (ctx, v) => {
        const first = chordUnder(ctx, 0);
        if (!first) return [];
        const bass = ctx.role?.kind === 'bass';
        const on = (c: Chord, evs: Ev[]): Note[] => evs.flatMap((e) => {
            const ps = chordPart(ctx) ? voiceLead(e.voices.map((x) => x.pitch), c.pcs, [c.root, c.pcs[1]], ctx.lo - 5, ctx.hi + 5)
                : e.voices.map((x) => nearestPitch(x.pitch, bass && isStrong(e.tick) ? [c.root] : allowedPcs(c, ctx.key, v[2] / 10, isStrong(e.tick))));
            return e.voices.map((x, i) => ({ tick: e.tick + x.dt, pitch: ps[i] ?? x.pitch, gate: x.gate, vel: x.vel }));
        });
        return rewrite(ctx, seams(ctx, v[0], v[3]), (s, was) => {
            const under = chordUnder(ctx, s.from) ?? first;
            const evs = was.length ? toEvents(was) : [{ tick: s.from, voices: [{ pitch: ctx.mid, dt: 0, gate: s.to - s.from, vel: velOf(ctx, was) }] }];
            /* A move the ending already plays (a clip ending on the dominant,
             * a bass already on that root) gives way to the next: a turn
             * always turns. */
            const same = (ns: Note[]) => ns.every((n) => was.some((w) => w.tick === n.tick && w.pitch === n.pitch));
            for (let i = 0; i < MOVES.length; i++) {
                const c = turnTo(MOVES[(v[1] + i) % MOVES.length], under, first);
                const out = on(c, evs);
                if (!sameChord(c, under) && !same(out)) return out;
            }
            return was;
        });
    },
};
