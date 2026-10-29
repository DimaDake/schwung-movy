/* New Clip's whole-kit drum options (plans/2026-10-28-new-clip-design.md):
 * GROOVE plays a genre's pattern (drum-maps.ts's nodes), EUCLID KIT spreads
 * each voice evenly, BROKEN leans the kick on the band's accents and moves
 * the snare off its post, PERC writes the kit's other voices. */

import type { GenCtx } from '../analysis/context.js';
import { strength } from '../analysis/events.js';
import type { PadRole } from '../analysis/kit.js';
import { amount, bandSteps, choice, place, SEED } from '../create/common.js';
import type { Preset } from '../preset.js';
import { withFeel } from '../create/feel.js';
import { mix, type Rng, rng, shuffled } from '../rng.js';
import { NODES } from '../shape/drum-maps.js';
import { euclid } from '../theory/pc.js';
import { type Note, TPS } from '../types.js';

export const pad = (ctx: GenCtx, role: PadRole): number | null => ctx.kit?.by[role][0] ?? null;

export function hit(ctx: GenCtx, out: Note[], p: number | null, step: number, vel: number): void {
    if (p !== null && step < ctx.len) out.push({ tick: place(ctx, step), pitch: p, gate: TPS / 2, vel: Math.max(1, Math.min(127, Math.round(vel))) });
}

const GENRES: [string, number, number][] = [['FOUR FLOOR', 0, 1], ['DISCO', 0, 2], ['BACKBEAT', 1, 0], ['2-STEP', 1, 1],
    ['BREAKBEAT', 1, 2], ['HALF TIME', 2, 0], ['TRAP', 2, 1], ['BROKEN BEAT', 2, 2]];
const ROLES: PadRole[] = ['kick', 'snare', 'hat'];

function fill(ctx: GenCtx, out: Note[], kind: number, r: Rng): void {
    const bar = Math.ceil(ctx.len / 16) - 1;
    const toms = ctx.kit?.by.tom ?? [];
    for (let s = 12; s < 16; s++) {
        const p = kind === 2 && toms.length ? toms[toms.length - 1 - Math.min(toms.length - 1, s - 12)] : pad(ctx, 'snare');
        hit(ctx, out, p, bar * 16 + s, 70 + (s - 12) * 10 + r() * 6);
    }
}

export const GROOVE: Preset = withFeel({
    id: 'n-groove', name: 'GROOVE', task: 'create', drum: true, cls: 'close',
    knobs: [choice('STYLE', GENRES.map((g) => g[0])), amount('BUSY', 10, 3, 7), choice('FILL', ['NONE', 'SNARE', 'TOMS'], [0, 0, 1, 2]), SEED],
    generate: (ctx, v, seed) => {
        const r = rng(mix(seed, v[3]));
        const [, row, col] = GENRES[v[0]];
        const lv = NODES[row][col]!;
        const thr = 8 - v[1] * 0.7;
        const out: Note[] = [];
        for (let bar = 0; bar * 16 < ctx.len; bar++) {
            const fillBar = v[2] > 0 && (bar + 1) * 16 >= ctx.len;
            ROLES.forEach((role, i) => lv[i].forEach((L, s) => {
                if (fillBar && s >= 12 && role !== 'hat') return;
                if (L >= 9 || (L >= thr && r() < 0.55 + (L - thr) / 4)) hit(ctx, out, pad(ctx, role), bar * 16 + s, 58 + L * 6 + r() * 6);
            }));
        }
        if (v[2] > 0) fill(ctx, out, v[2], r);
        return out;
    },
});

export const EUCLID_KIT: Preset = withFeel({
    id: 'n-euclid-kit', name: 'EUCLID KIT', task: 'create', drum: true, cls: 'rhythm',
    knobs: [amount('KICK', 8, 3, 5), amount('SNARE', 4, 1, 2), amount('HATS', 16, 4, 12), amount('SHIFT', 7, 0, 3)],
    generate: (ctx, v, seed) => {
        const r = rng(seed);
        const voices: [PadRole, boolean[]][] = [['kick', euclid(v[0], 16, 0)], ['snare', euclid(v[1], 16, 4 + (v[3] % 3))],
            ['hat', euclid(v[2], 16, 2 + v[3])]];
        const out: Note[] = [];
        for (let bar = 0; bar * 16 < ctx.len; bar++) {
            for (const [role, on] of voices) on.forEach((x, s) => { if (x) hit(ctx, out, pad(ctx, role), bar * 16 + s, 70 + 45 * strength(s * TPS) + r() * 6); });
        }
        return out;
    },
});

export const BROKEN: Preset = withFeel({
    id: 'n-broken', name: 'BROKEN', task: 'create', drum: true, cls: 'exp',
    knobs: [amount('DENSITY', 10, 4, 7), amount('SYNC', 10, 2, 7), amount('GHOSTS', 10, 0, 5), SEED],
    generate: (ctx, v, seed) => {
        const r = rng(mix(seed, v[3]));
        const band = new Set(bandSteps(ctx).slice(0, 4));
        /* One two-bar phrase, played through the clip: a broken beat repeats. */
        const one: Note[] = [];
        for (let bar = 0; bar < 2; bar++) {
            const w = Array.from({ length: 16 }, (_, s) => strength(s * TPS) + (v[1] / 10) * (1 - strength(s * TPS)) * r() + (band.has(s) ? 0.4 : 0));
            const kicks = [0, ...w.map((x, s) => [x, s]).filter(([, s]) => s !== 0 && s !== 4 && s !== 12)
                .sort((a, b) => b[0] - a[0]).slice(0, 1 + Math.round(v[0] / 3)).map((x) => x[1])];
            for (const s of kicks) hit(ctx, one, pad(ctx, 'kick'), bar * 16 + s, s === 0 ? 118 : 96 + r() * 12);
            const late = r() < v[1] / 14;
            for (const s of [4, late ? 13 : 12]) hit(ctx, one, pad(ctx, 'snare'), bar * 16 + s, 108);
            for (let g = 0; g < Math.round(v[2] * 0.6); g++) hit(ctx, one, pad(ctx, 'snare'), bar * 16 + 1 + 2 * Math.floor(r() * 8), 38 + r() * 12);
            const rate = v[0] >= 7 ? 1 : 2;
            for (let s = 0; s < 16; s += rate) if (r() > (10 - v[0]) * 0.035) hit(ctx, one, pad(ctx, 'hat'), bar * 16 + s, 62 + 30 * strength(s * TPS));
        }
        const out: Note[] = [];
        for (let off = 0; off < ctx.end; off += 32 * TPS) {
            for (const n of one) if (n.tick + off < ctx.end) out.push({ ...n, tick: n.tick + off });
        }
        return out;
    },
});

const ACCENTS = ['FLAT', 'DOWNBEAT', 'RANDOM'] as const;

/** The kit's other voices first; a kit with none plays its hats and snare. */
function percPads(ctx: GenCtx): number[] {
    const by = ctx.kit?.by;
    if (!by) return [];
    const rest = [...by.perc, ...by.tom, ...by.open, ...by.cym];
    return rest.length ? rest : [...by.hat, ...by.snare];
}

export const PERC: Preset = withFeel({
    id: 'n-perc', name: 'PERC', task: 'create', drum: true, cls: 'exp',
    knobs: [amount('DENSITY', 10, 3, 6), amount('PADS', 4, 2, 3), choice('ACCENT', ACCENTS, [0, 1, 1, 2]), SEED],
    generate: (ctx, v, seed) => {
        const r = rng(mix(seed, v[3]));
        const pads = shuffled(r, percPads(ctx)).slice(0, Math.max(1, v[1]));
        const out: Note[] = [];
        if (!v[0]) return out;
        pads.forEach((p, i) => {
            const on = euclid(Math.max(1, Math.round(v[0] * 0.5) + i), 16, Math.floor(r() * 16));
            for (let bar = 0; bar * 16 < ctx.len; bar++) on.forEach((x, s) => {
                if (!x) return;
                const vel = v[2] === 0 ? 96 : v[2] === 1 ? 70 + 45 * strength(s * TPS) : 60 + r() * 55;
                hit(ctx, out, p, bar * 16 + s, vel);
            });
        });
        return out;
    },
});
