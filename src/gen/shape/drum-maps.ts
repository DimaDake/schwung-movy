/* GRIDS' method without Grids' data (design 2026-10-28 §6): a 3×3 map of
 * patterns, each a level 0-9 per 16th for kick, snare and hats, read at X/Y
 * by blending the four nodes around it. The first node is the source's own
 * pattern; the rest are written here from each genre's usual pattern (Grids'
 * own tables are GPL, and movy does not copy them). */

import type { Note } from '../types.js';
import { TPS } from '../types.js';

export const MAP_ROLES = ['kick', 'snare', 'hat'] as const;
export type Levels = number[][];        // [role][step 0..15], 0..9

const L = (k: string, s: string, h: string): Levels => [k, s, h].map((x) => [...x].map(Number));

/* Rows run from straight to broken, columns from plain to busy. */
export const NODES: (Levels | null)[][] = [
    [null,
        L('9000900090009000', '0000900000009000', '2282228222822282'),      // four on the floor
        L('9000900090009000', '0000900300009003', '7575757575757575')],     // disco
    [L('9000000090300000', '0000900000009000', '8060806080608060'),         // backbeat
        L('9000000000900000', '0000900000009000', '8040608040608050'),      // 2-step
        L('9080000000980000', '0000900604009006', '7070707070707070')],     // breakbeat
    [L('9000000000060000', '0000000090000000', '8080808080808080'),         // half time
        L('9000000500900000', '0000000090000000', '9595959599599595'),      // trap
        L('9000003000900300', '0000900000049000', '6060806060608060')],     // broken beat
];

/** The source as a node: a step's level is the share of bars that hit it. */
export function sourceLevels(notes: Note[], pads: (number | null)[], end: number): Levels {
    const bars = Math.max(1, Math.round(end / (16 * TPS)));
    return pads.map((pad) => {
        const lv = Array(16).fill(0);
        if (pad === null) return lv;
        for (const n of notes) if (n.pitch === pad) lv[Math.round(n.tick / TPS) % 16] += 9 / bars;
        return lv.map((x) => Math.min(9, x));
    });
}

/** Levels at X, Y (each 0..1 across the map), the four nodes around blended. */
export function levelsAt(x: number, y: number, src: Levels): Levels {
    const fx = x * 2, fy = y * 2;
    const c0 = Math.min(1, Math.floor(fx)), r0 = Math.min(1, Math.floor(fy));
    const tx = fx - c0, ty = fy - r0;
    const node = (r: number, c: number) => NODES[r][c] ?? src;
    return MAP_ROLES.map((_, role) => Array.from({ length: 16 }, (__, s) =>
        (1 - tx) * (1 - ty) * node(r0, c0)[role][s] + tx * (1 - ty) * node(r0, c0 + 1)[role][s]
        + (1 - tx) * ty * node(r0 + 1, c0)[role][s] + tx * ty * node(r0 + 1, c0 + 1)[role][s]));
}

/** The map position (X, Y knob steps) of the genre node closest to the
 *  source that still differs from it: where GRIDS opens. */
export function nearestNode(src: Levels): [number, number] {
    const hits = (l: Levels) => l.map((row) => row.map((x) => x > 4.5));
    const a = hits(src);
    let best: [number, number] = [5, 0], bestD = 1e9;
    NODES.forEach((row, r) => row.forEach((node, c) => {
        if (!node) return;
        const b = hits(node);
        let both = 0, any = 0;
        a.forEach((ra, i) => ra.forEach((x, s) => { if (x || b[i][s]) any++; if (x && b[i][s]) both++; }));
        const d = 1 - both / Math.max(1, any);
        if (d >= 0.3 && d < bestD) { bestD = d; best = [c * 5, r * 5]; }
    }));
    return best;
}
