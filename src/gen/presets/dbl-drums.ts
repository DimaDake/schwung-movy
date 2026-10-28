/* Smart Double for drums: the pattern twice, its seams turned into the
 * connections a drummer plays into the next bar — a FILL, a PICKUP of a hit
 * or two, a snare ROLL, a REPEAT of the last slice, a BREAK, or the pattern's
 * own STYLE walked new (shape/seams.ts). */

import type { GenCtx } from '../analysis/context.js';
import { type PadRole, padFor } from '../analysis/kit.js';
import { count, custom, K } from '../knobs.js';
import type { Preset } from '../preset.js';
import { rng } from '../rng.js';
import { fill } from '../shape/drums.js';
import { ENDING, ENDING_STEPS, gridIn, rewrite, SEAMS, seams } from '../shape/seams.js';
import { drumWalk } from '../style/drums.js';
import { type Note, TPS } from '../types.js';

const pad = (ctx: GenCtx, role: PadRole) => padFor(ctx.kit!, role, ctx.src);
const hit = (tick: number, pitch: number, vel: number): Note => ({ tick, pitch, gate: TPS / 2, vel: Math.max(1, Math.min(127, Math.round(vel))) });
const widest = (ctx: GenCtx) => ENDING.steps(ctx) - 1;

export const FILL_X: Preset = {
    id: 'xd-fill', name: 'FILL', task: 'double', drum: true, cls: 'close', fit: () => 0.8,
    accepts: (ctx) => pad(ctx, 'snare') !== null || ctx.kit!.by.tom.length > 0,
    knobs: [ENDING, K.density(6), custom('PADS', ['SNARE', 'TOMS', 'BOTH'], 2), SEAMS],
    generate: (ctx, v, seed) => {
        const r = rng(seed);
        const use = (['snare', 'toms', 'both'] as const)[v[2]];
        return rewrite(ctx, seams(ctx, v[0], v[3]), (s, was) => fill(ctx, ctx.kit!, was, (s.to - s.from) / TPS, v[1] / 10, r, s.to, use));
    },
};

const PICKS: PadRole[][] = [['kick'], ['snare'], ['open'], ['kick', 'snare']];
const PUSHES = [TPS, 2 * TPS, 4 * TPS];

/** The pattern kept; one to three hits lead into the next downbeat. */
export const PICKUP_D: Preset = {
    id: 'xd-pickup', name: 'PICKUP', task: 'double', drum: true, cls: 'close', fit: () => 0.75,
    knobs: [custom('PADS', ['KICK', 'SNARE', 'OPEN HAT', 'KICK+SNARE'], 1), custom('PUSH', ['1/16', '1/8', '1/4'], 1),
        count('HITS', 3, 2), SEAMS],
    generate: (ctx, v) => rewrite(ctx, seams(ctx, widest(ctx), v[3]), (s, was) => {
        const pads = PICKS[v[0]].map((p) => pad(ctx, p)).filter((p): p is number => p !== null);
        if (!pads.length) return was;
        const ticks = gridIn(s, PUSHES[v[1]], Math.max(1, v[2]));
        const add = ticks.map((t, i) => hit(t, pads[i % pads.length], 85 + 30 * ((i + 1) / ticks.length)));
        return [...was.filter((n) => !ticks.includes(n.tick)), ...add];
    }),
};

/** A snare roll over the ending, at a RATE or accelerating, rising by CRESC. */
export const ROLL: Preset = {
    id: 'xd-roll', name: 'ROLL', task: 'double', drum: true, cls: 'rhythm', fit: () => 0.6,
    accepts: (ctx) => pad(ctx, 'snare') !== null,
    knobs: [ENDING, custom('RATE', ['8THS', '16THS', '32NDS', 'ACCEL'], 3), count('CRESC', 10, 6), SEAMS],
    generate: (ctx, v) => {
        const sn = pad(ctx, 'snare')!, kick = pad(ctx, 'kick');
        return rewrite(ctx, seams(ctx, v[0], v[3]), (s, was) => {
            const len = s.to - s.from;
            const ticks: number[] = [];
            for (let t = s.from; t < s.to;) {
                ticks.push(t);
                const p = (t - s.from) / len;
                t += v[1] === 3 ? (p < 0.5 ? 2 * TPS : p < 0.75 ? TPS : TPS / 2) : [2 * TPS, TPS, TPS / 2][v[1]];
            }
            const base = 105 - v[2] * 5;
            return [...was.filter((n) => n.pitch === kick && n.tick % (4 * TPS) === 0),
                ...ticks.map((t, i) => hit(t, sn, base + (v[2] * 6 * i) / Math.max(1, ticks.length - 1)))];
        });
    },
};

/** The slice just before the ending repeated through it, each repeat quieter
 *  by DECAY: a beat repeat into the turn. */
export const REPEAT: Preset = {
    id: 'xd-repeat', name: 'REPEAT', task: 'double', drum: true, cls: 'rhythm', fit: () => 0.55,
    knobs: [ENDING, custom('GRAIN', ['1/16', '1/8', '1/4'], 1), count('DECAY', 10, 3), SEAMS],
    generate: (ctx, v) => rewrite(ctx, seams(ctx, v[0], v[3]), (s) => {
        const g = PUSHES[v[1]];
        const slice = ctx.src.filter((n) => n.tick >= s.from - g && n.tick < s.from);
        const out: Note[] = [];
        for (let k = 0, t = s.from; t < s.to; k++, t += g) {
            for (const n of slice) out.push({ ...n, tick: n.tick - (s.from - g) + t, vel: Math.max(1, Math.round(n.vel * Math.pow(1 - v[2] * 0.04, k + 1))) });
        }
        return out;
    }),
};

const KEEP: (PadRole | null)[] = [null, 'kick', 'snare', 'hat'];
const PICK_ONE: (PadRole | null)[] = [null, 'snare', 'kick', 'open'];

/** The ending drops out to one part (or none), with one hit leading back in. */
export const BREAK_D: Preset = {
    id: 'xd-break', name: 'BREAK', task: 'double', drum: true, cls: 'exp', fit: () => 0.5,
    knobs: [ENDING, custom('KEEP', ['NOTHING', 'KICK', 'SNARE', 'HATS']), custom('PICKUP', ['NONE', 'SNARE', 'KICK', 'OPEN HAT'], 1), SEAMS],
    generate: (ctx, v) => rewrite(ctx, seams(ctx, v[0], v[3]), (s, was) => {
        const keep = KEEP[v[1]] ? ctx.kit!.by[KEEP[v[1]]!] : [];
        const p = PICK_ONE[v[2]] ? pad(ctx, PICK_ONE[v[2]]!) : null;
        const at = s.to - 2 * TPS;
        return [...was.filter((n) => keep.includes(n.pitch) && !(p !== null && n.tick === at)), ...(p !== null ? [hit(at, p, 110)] : [])];
    }),
};

/** The ending walked new from the pattern's learned style (style/drums.ts). */
export const STYLE_XD: Preset = {
    id: 'xd-style', name: 'STYLE', task: 'double', drum: true, cls: 'exp', fit: () => 0.55,
    knobs: [ENDING, K.likeness(3), K.density(6), K.seed()],
    generate: (ctx, v, seed) => {
        const r = rng(seed + v[3] * 7919);
        return rewrite(ctx, seams(ctx, v[0]), (s) => {
            const len = ENDING_STEPS[v[0]] * TPS;
            return drumWalk(ctx, v[1], v[2], len, r).filter((n) => n.tick < len).map((n) => ({ ...n, tick: n.tick + s.from }));
        });
    },
};
