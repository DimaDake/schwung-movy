/* DRUM MAP (plans/2026-10-29-generator-follow-ups.md #4, #10): a groove you
 * steer on two axes, as on Mutable Instruments Grids. GROOVE walks through
 * the genres (drum-maps.ts's nodes), blending each into the next; KICK,
 * SNARE and HATS are each voice's density on that groove. A voice plays its
 * strongest steps first (the groove's level, then Barlow's indispensability),
 * so its patterns nest: a density click adds or drops one hit. Between two
 * genres GROOVE trades the one's hits for the other's a hit at a time, the
 * velocities blending with it; at a genre and its own density the groove is
 * that genre's. */

import type { GenCtx } from '../analysis/context.js';
import type { KnobDef } from '../knobs.js';
import { choice, SEED } from '../create/common.js';
import { mix, type Rng, rng } from '../rng.js';
import type { Preset } from '../preset.js';
import { withFeel } from '../create/feel.js';
import { type Levels, MAP_ROLES, NODES } from '../shape/drum-maps.js';
import { IND } from '../shape/rhythm-map.js';
import { type Note, TPS } from '../types.js';
import { hit, pad } from './new-drums-kit.js';

/* The genres in the map's order, straight to broken, plain to busy. */
const PATH: Levels[] = NODES.flat().filter((n): n is Levels => n !== null);
/** GROOVE positions between one genre and the next. */
const BETWEEN = 8;
const GROOVES = (PATH.length - 1) * BETWEEN + 1;
const MAX = [8, 8, 16];

/** The levels at a GROOVE position: two genres blended. */
export function grooveAt(g: number): Levels {
    const a = Math.min(PATH.length - 2, Math.floor(g / BETWEEN)), t = g / BETWEEN - a;
    return MAP_ROLES.map((_, r) => PATH[a][r].map((x, s) => (1 - t) * x + t * PATH[a + 1][r][s]));
}

/** A voice's steps, strongest first. */
export const rankOf = (lv: number[]): number[] => lv.map((_, s) => s).sort((a, b) => lv[b] - lv[a] || IND[b] - IND[a]);

/* SEED (GROOVE's dice, §2.7): #1 plays each voice's strongest steps; another
 * seed may trade a voice's weakest hit for one of the next steps in its
 * ranking, as GROOVE let a step near its threshold play or not. The count
 * stays DENSITY's. */
function seeded(rank: number[], k: number, seed: number, role: number): number[] {
    const out = rank.slice(0, k);
    if (!seed || k < 1 || k >= rank.length) return out;
    const r = rng(mix(0x5EED, seed, role));
    if (r() < 0.75) out[k - 1] = rank[k + Math.floor(r() * Math.min(3, rank.length - k))];
    return out;
}

/** How many hits a genre gives a voice: its steps at level 5 or more. */
const own = (lv: number[]) => lv.filter((x) => x >= 5).length;

/* The genres by name where GROOVE stands on one (GROOVE's styles, merged in
 * from New Clip GROOVE, §2.7); between them, the position. */
const GENRES: [string, number, number][] = [['FOUR FLOOR', 0, 1], ['DISCO', 0, 2], ['BACKBEAT', 1, 0], ['2-STEP', 1, 1],
    ['BREAKBEAT', 1, 2], ['HALF TIME', 2, 0], ['TRAP', 2, 1], ['BROKEN BEAT', 2, 2]];
const NAMES = new Map(GENRES.map(([n, r, c]) => [PATH.indexOf(NODES[r][c]!), n]));

const GROOVE: KnobDef = { name: 'GROOVE', steps: () => GROOVES, def: () => 0,
    label: (v) => (v % BETWEEN === 0 && NAMES.has(v / BETWEEN) ? NAMES.get(v / BETWEEN)! : String(v + 1)),
    /* A take stands on a genre. */
    roll: (_c, r) => Math.floor(r() * PATH.length) * BETWEEN };

/* Where a take's densities are drawn: what most genres give each voice
 * (a knob is rolled alone, so it cannot see which genre GROOVE drew). */
const TAKE: [number, number][] = [[2, 5], [2, 3], [4, 12]];

/** A voice's density; it opens on the first genre's own. */
function density(role: number): KnobDef {
    const [lo, hi] = TAKE[role];
    return { name: ['KICK', 'SNARE', 'HATS'][role], steps: () => MAX[role] + 1, def: () => own(PATH[0][role]),
        label: (v) => String(v), roll: (_c, r) => lo + Math.floor(r() * (hi - lo + 1)) };
}

/** A voice's hits at GROOVE `g` and density `k`: the first genre's k
 *  strongest, traded one at a time for the next genre's (its weakest given
 *  up first, the other's strongest taken first), so each click moves a hit
 *  at most. */
export function hitsAt(g: number, role: number, k: number, seed = 0): number[] {
    const a = Math.min(PATH.length - 2, Math.floor(g / BETWEEN)), t = g / BETWEEN - a;
    const from = seeded(rankOf(PATH[a][role]), k, seed, role), to = seeded(rankOf(PATH[a + 1][role]), k, seed, role);
    const give = from.filter((s) => !to.includes(s)).reverse(), take = to.filter((s) => !from.includes(s));
    const n = Math.round(t * give.length);
    return [...from.filter((s) => !give.slice(0, n).includes(s)), ...take.slice(0, n)].sort((x, y) => x - y);
}

/** FILL (GROOVE's): the last beat of the clip on the snare or down the toms. */
function fillIn(ctx: GenCtx, out: Note[], kind: number, r: Rng): Note[] {
    if (!kind) return out;
    const bar = Math.ceil(ctx.len / 16) - 1;
    const from = (bar * 16 + 12) * TPS;
    const hat = pad(ctx, 'hat');
    const kept = out.filter((n) => n.tick < from || n.pitch === hat);
    const toms = ctx.kit?.by.tom ?? [];
    for (let s = 12; s < 16; s++) {
        const p = kind === 2 && toms.length ? toms[toms.length - 1 - Math.min(toms.length - 1, s - 12)] : pad(ctx, 'snare');
        hit(ctx, kept, p, bar * 16 + s, 70 + (s - 12) * 10 + r() * 6);
    }
    return kept;
}

export const DRUM_MAP: Preset = withFeel({
    id: 'n-drum-map', name: 'DRUM MAP', task: 'create', drum: true, cls: 'close',
    knobs: [GROOVE, density(0), density(1), density(2), choice('FILL', ['NONE', 'SNARE', 'TOMS'], [0, 0, 1, 2]), SEED],
    generate: (ctx, v, seed) => {
        const lv = grooveAt(v[0]);
        const out: Note[] = [];
        MAP_ROLES.forEach((role, r) => {
            const steps = hitsAt(v[0], r, v[1 + r], v[5]);
            for (let bar = 0; bar * 16 < ctx.len; bar++) {
                for (const s of steps) hit(ctx, out, pad(ctx, role), bar * 16 + s, 54 + lv[r][s] * 6 + (s % 4 === 0 ? 8 : 0));
            }
        });
        return fillIn(ctx, out, v[4], rng(mix(seed, v[5])));
    },
});
