/* Variation for drums, experimental: half/double-time feels, a Grids-style
 * pattern map (after Mutable Instruments' Grids: patterns blended by X and Y,
 * thresholded by a density per part), an Euclidean line, and DEVELOP. */

import type { GenCtx } from '../analysis/context.js';
import { strength } from '../analysis/events.js';
import { padFor, type PadRole } from '../analysis/kit.js';
import { count, custom, K } from '../knobs.js';
import type { Preset } from '../preset.js';
import { rng } from '../rng.js';
import { accent, dynamics } from '../shape/dynamics.js';
import { fill, ghosts, HAT_RATES, hats } from '../shape/drums.js';
import { euclid } from '../theory/pc.js';
import { levelsAt, MAP_ROLES, nearestNode, sourceLevels } from '../shape/drum-maps.js';
import { BAR, type Note, TPS } from '../types.js';

const at = (notes: Note[], pad: number, tick: number) => notes.some((n) => n.pitch === pad && Math.abs(n.tick - tick) < TPS / 2);

export const FEEL: Preset = {
    id: 'd-feel', name: 'FEEL', task: 'variation', drum: true, cls: 'exp', fit: () => 0.5,
    knobs: [custom('MODE', ['HALF TIME', 'DOUBLE HATS', 'BOTH'], 0), K.amount(8), K.dynamics(3), K.seed()],
    generate: (ctx, v, seed) => {
        const r = rng(seed + v[3] * 7919);
        const kit = ctx.kit!;
        let notes = ctx.src.map((n) => ({ ...n }));
        if (v[0] !== 1) {
            const sn = padFor(kit, 'snare', notes);
            const kk = padFor(kit, 'kick', notes);
            notes = notes.flatMap((n) => {
                const s = Math.round(n.tick / TPS) % 16;
                if (r() * 10 >= Math.max(1, v[1])) return [n];
                if (n.pitch === sn && (s === 4 || s === 12)) return s === 4 ? [] : [{ ...n, tick: n.tick - 4 * TPS }];
                if (n.pitch === kk && s !== 0 && s % 4 === 0) return [];
                return [n];
            });
        }
        if (v[0] !== 0) notes = hats(ctx, kit, notes, 3);
        return dynamics(notes, v[2]);
    },
};

const srcLevels = (c: GenCtx) => sourceLevels(c.src, MAP_ROLES.map((role) => padFor(c.kit!, role, c.src)), c.end);
const nodeOf = (c: GenCtx) => nearestNode(srcLevels(c));

const DIAL = ['-', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+'];

/* GRIDS (design 2026-10-28 §6): X and Y move across a map whose first node is
 * this pattern and whose others are the genres' patterns (shape/drum-maps.ts);
 * KICK, SNARE and HATS set how much of each part's level plays, CHAOS shakes
 * the levels. Pads outside the three parts play as they did. */
export const GRIDS: Preset = {
    id: 'd-grids', name: 'GRIDS', task: 'variation', drum: true, cls: 'exp', fit: () => 0.55,
    knobs: [{ ...count('X', 10, 5), label: (x: number) => x * 10 + '%', def: (c) => nodeOf(c)[0] },
        { ...count('Y', 10, 0), label: (x: number) => x * 10 + '%', def: (c) => nodeOf(c)[1] },
        custom('KICK', DIAL, 5), custom('SNARE', DIAL, 5), custom('HATS', DIAL, 5), count('CHAOS', 10, 2), K.dynamics(4), K.seed()],
    generate: (ctx, v, seed) => {
        const r = rng(seed + v[7] * 7919);
        const kit = ctx.kit!;
        const pads = MAP_ROLES.map((role) => padFor(kit, role, ctx.src));
        const lv = levelsAt(v[0] / 10, v[1] / 10, srcLevels(ctx));
        const out: Note[] = ctx.src.filter((n) => !pads.includes(n.pitch));
        pads.forEach((pad, ri) => {
            if (pad === null) return;
            const mine = ctx.src.filter((n) => n.pitch === pad);
            const proto = mine[0] ?? { tick: 0, gate: TPS / 2, pitch: pad, vel: 100 };
            const vel = mine.length ? mine.reduce((s, n) => s + n.vel, 0) / mine.length : proto.vel;
            /* A part's dial is its threshold: at 5 a level over 4.5 plays. */
            const thr = 9.5 - v[2 + ri] * 0.95;
            for (let t = 0; t < ctx.end; t += TPS) {
                const s = Math.round(t / TPS) % 16;
                const level = lv[ri][s] + (r() - 0.5) * v[5] * 0.7;
                if (level <= 0 || level <= thr) continue;
                const was = mine.find((n) => Math.abs(n.tick - t) < TPS / 2);
                out.push({ ...proto, tick: was?.tick ?? t, vel: Math.round(was?.vel ?? vel * (0.6 + 0.4 * Math.min(9, level) / 9)) });
            }
        });
        return dynamics(out, v[6]);
    },
};

export const EUCLID_D: Preset = {
    id: 'd-euclid', name: 'EUCLID', task: 'variation', drum: true, cls: 'exp', fit: () => 0.45,
    knobs: [{ ...count('PULSES', 15, 4), label: (x: number) => String(x + 1) }, count('ROTATE', 15, 2), custom('PAD', ['PERC', 'TOM', 'SNARE', 'HAT'], 0), K.dynamics(3)],
    generate: (ctx, v) => {
        const kit = ctx.kit!;
        const role = (['perc', 'tom', 'snare', 'hat'] as const)[v[2]];
        const pad = padFor(kit, role, ctx.src) ?? padFor(kit, 'perc', ctx.src) ?? padFor(kit, 'snare', ctx.src) ?? kit.pads[0];
        const proto = ctx.src.find((n) => n.pitch === pad) ?? { tick: 0, gate: TPS / 2, pitch: pad, vel: 90 };
        const pattern = euclid(v[0] + 1, 16, v[1]);
        const out = ctx.src.filter((n) => n.pitch !== pad);
        for (let t = 0; t < ctx.end; t += TPS) {
            if (pattern[Math.round(t / TPS) % 16]) out.push({ ...proto, tick: t, vel: Math.round(proto.vel * (0.7 + 0.3 * strength(t))) });
        }
        return dynamics(out, v[3]);
    },
};

export const DEVELOP_D: Preset = {
    id: 'd-develop', name: 'DEVELOP', task: 'variation', drum: true, cls: 'exp', fit: () => 0.55,
    knobs: [K.amount(3), custom('FILL', ['NONE', '1/16 X2', '1/16 X4', '1 BEAT', '2 BEATS', '1 BAR'], 2), count('GHOSTS', 10, 3),
        custom('SHIFT', ['NONE', '-1/16', '+1/16', '+2/16'], 0), K.density(5), custom('ACCENT', ['FLAT', '-2', '-1', 'AS IS', '+1', '+2', 'HARD'], 3),
        custom('HATS', ['AS IS', ...HAT_RATES], 0), K.seed()],
    generate: (ctx, v, seed) => {
        const r = rng(seed + v[7] * 7919);
        const kit = ctx.kit!;
        let notes = ctx.src.map((n) => ({ ...n }));
        if (v[6] > 0) notes = hats(ctx, kit, notes, v[6] - 1);
        const moves = Math.round(notes.length * (v[0] / 10) * 0.3);
        for (let i = 0; i < moves; i++) {
            const n = notes[Math.floor(r() * notes.length)];
            if (!n || strength(n.tick) >= 0.85) continue;
            const t = n.tick + (r() < 0.5 ? -1 : 1) * TPS;
            if (t >= 0 && t < ctx.end && !at(notes, n.pitch, t)) n.tick = t;
        }
        const sn = padFor(kit, 'snare', notes);
        if (v[3] > 0 && sn !== null) {
            const d = [0, -1, 1, 2][v[3]] * TPS;
            notes = notes.map((n) => (n.pitch === sn && n.tick % BAR !== 0 && n.tick + d >= 0 && n.tick + d < ctx.end ? { ...n, tick: n.tick + d } : n));
        }
        notes = ghosts(ctx, kit, notes, v[2], 'snare', 32, r);
        if (v[4] < 5) notes = notes.filter((n) => strength(n.tick) >= 0.7 || r() * 5 < v[4]);
        else if (v[4] > 5) notes = ghosts(ctx, kit, notes, (v[4] - 5) * 2, 'hat', 50, r);
        notes = fill(ctx, kit, notes, [0, 2, 4, 4, 8, 16][v[1]], 0.6, r);
        return accent(notes, [0, 3, 4, 5, 6, 7, 10][v[5]]);
    },
};
