/* The groove: where each 16th of the bar lands in the scene (the other
 * tracks' median onset there, so their swing or push is the pocket), how much
 * swing a part was played with, and which grid explains it best. */

import { BAR, type Note, TPS } from '../types.js';

export const GRIDS = ['1/8', '1/8T', '1/16', '1/16T', '1/32'] as const;
export type GridId = typeof GRIDS[number];
export const GRID_TICKS: Record<GridId, number> = { '1/8': 48, '1/8T': 32, '1/16': 24, '1/16T': 16, '1/32': 12 };

export interface Groove {
    land: number[];     // 16 landing offsets (ticks) from each straight 16th
    swing: number;      // the part's own swing, 0..0.5 of a 16th (50 %..75 %)
    grid: GridId;       // the grid the part was played on
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

export function landing(others: Note[]): number[] {
    const at = (s: number) => others.map((n) => n.tick % BAR).filter((t) => Math.abs(t - s * TPS) <= TPS / 2)
        .map((t) => t - s * TPS);
    return Array.from({ length: 16 }, (_, s) => { const d = at(s); return d.length >= 2 ? median(d) : 0; });
}

/** Swing as the late shift of off-beat 16ths against on-beat ones. */
export function swingOf(notes: Note[]): number {
    const offs = (odd: number) => notes.filter((n) => Math.round(n.tick / TPS) % 2 === odd)
        .map((n) => n.tick - Math.round(n.tick / TPS) * TPS);
    const on = offs(0);
    const off = offs(1);
    if (off.length < 2) return 0;
    const sw = (median(off) - (on.length ? median(on) : 0)) / TPS;
    return Math.max(0, Math.min(0.5, sw));
}

/** Where a straight grid point lands with swing applied (16th-note swing on
 *  the 1/16 family, 8th-note swing on 1/8). */
export function gridTarget(tick: number, grid: GridId, swing: number): number {
    const g = GRID_TICKS[grid];
    const i = Math.round(tick / g);
    let t = i * g;
    if ((grid === '1/16' || grid === '1/32') && Math.round(t / TPS) % 2 === 1 && t % TPS === 0) t += swing * TPS;
    if (grid === '1/8' && i % 2 === 1) t += swing * 2 * TPS;
    return t;
}

/** The grid with the least error, a finer grid paying for its extra freedom. */
export function detectGrid(notes: Note[], swing: number): GridId {
    if (!notes.length) return '1/16';
    let best: GridId = '1/16';
    let bestCost = 1e9;
    for (const g of GRIDS) {
        const err = notes.reduce((s, n) => s + Math.abs(n.tick - gridTarget(n.tick, g, swing)), 0) / notes.length;
        const cost = err + 2.2 * (TPS / GRID_TICKS[g]) + (g.endsWith('T') ? 1.5 : 0);
        if (cost < bestCost - 1e-9) { bestCost = cost; best = g; }
    }
    return best;
}

export function grooveOf(part: Note[], others: Note[]): Groove {
    const swing = swingOf(part);
    return { land: landing(others), swing, grid: detectGrid(part, swing) };
}
