/* Smart Quantize that mutates a drum clip (plans/2026-10-29-quantize-mutations.md):
 * the kit's own hits, on the grid, some moved to a neighbouring step, some
 * rolled into ratchets, or played looser. The downbeat kick and the backbeat
 * snare stay where the player put them. */

import { padFor } from '../analysis/kit.js';
import { count, custom, K } from '../knobs.js';
import type { Preset } from '../preset.js';
import { mix, rng } from '../rng.js';
import { humanize, ratchet } from '../shape/mutate.js';
import { BAR, type Note, TPS } from '../types.js';
import { RATES, tightSrc } from './quant-mutate.js';

const MOVES = [[-1, 1], [-2, 2], [-2, -1, 1, 2]];

export const MUTATE_D: Preset = {
    id: 'qd-mutate', name: 'MUTATE', task: 'quantize', drum: true, cls: 'exp', fit: () => 0.5,
    knobs: [K.timing(10), count('AMOUNT', 10, 3), custom('MOVE', ['1/16', '1/8', 'EITHER'], 0), K.seed()],
    generate: (ctx, v) => {
        const r = rng(mix(ctx.seed, v[3], 0x646d));
        const kick = ctx.kit ? padFor(ctx.kit, 'kick', ctx.src) : null, snare = ctx.kit ? padFor(ctx.kit, 'snare', ctx.src) : null;
        const post = (n: Note) => { const s = Math.round((n.tick % BAR) / TPS); return (n.pitch === kick && s === 0) || (n.pitch === snare && (s === 4 || s === 12)); };
        const taken = new Set<string>();
        const out = tightSrc(ctx, v[0]).map((n) => {
            const roll = r(), m = MOVES[v[2]][Math.floor(r() * MOVES[v[2]].length)];
            if (post(n) || roll >= v[1] / 10) return { ...n };
            const t = Math.max(0, Math.min(ctx.end - TPS, Math.round(n.tick / TPS + m) * TPS));
            return { ...n, tick: t };
        });
        /* Two hits of one pad on one step are one hit. */
        return out.filter((n) => { const k = `${n.pitch}.${n.tick}`; if (taken.has(k)) return false; taken.add(k); return true; });
    },
};

const PADS = ['HATS', 'SNARE', 'ANY'] as const;

export const RATCHET_D: Preset = {
    id: 'qd-ratchet', name: 'RATCHET', task: 'quantize', drum: true, cls: 'rhythm', fit: () => 0.55,
    knobs: [K.timing(10), count('AMOUNT', 10, 3), custom('RATE', RATES.map((x) => x[0]), 0), custom('PAD', PADS, 0)],
    generate: (ctx, v) => {
        const role = v[3] === 0 ? 'hat' : v[3] === 1 ? 'snare' : null;
        const p = role && ctx.kit ? padFor(ctx.kit, role, ctx.src) : null;
        const pick = (n: Note) => role === null || n.pitch === p;
        return ratchet(tightSrc(ctx, v[0]), v[1], RATES[v[2]][1], 3, rng(mix(ctx.seed, 0x6472)), ctx.end, pick, 2 * TPS);
    },
};

export const HUMANIZE_D: Preset = {
    id: 'qd-humanize', name: 'HUMANIZE', task: 'quantize', drum: true, cls: 'close', fit: () => 0.55,
    knobs: [count('LOOSE', 10, 3), count('VELOCITY', 10, 5), count('LENGTH', 10, 0), K.seed()],
    generate: (ctx, v) => humanize(tightSrc(ctx, 10), v[0], v[1], v[2], rng(mix(ctx.seed, v[3], 0x6468)), ctx.end),
};
