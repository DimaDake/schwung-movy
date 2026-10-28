/* A variable-order Markov chain over tokens (plans/2026-10-28-generators-
 * learned-style-design.md §1): learned per request from the part and its
 * track's other clips, so a walk sounds like what is already there. Each
 * level keys its counts by a context the caller defines (the place in the
 * bar, the previous tokens); a draw falls back a level when its context was
 * never seen, and to the whole vocabulary at the bottom. */

import type { Rng } from '../rng.js';

/** A level's context for a token at `pos` after `prev` (most recent last);
 *  null when the history is too short for it. */
export type KeyFn = (prev: readonly string[], pos: number) => string | null;

export interface Chain { keys: KeyFn[]; tables: Map<string, Map<string, number>>[]; vocab: Map<string, number> }

export const HIST = 3;

export function chain(keys: KeyFn[]): Chain {
    return { keys, tables: keys.map(() => new Map()), vocab: new Map() };
}

function bump(m: Map<string, number>, tok: string, w: number): void { m.set(tok, (m.get(tok) ?? 0) + w); }

/** Adds `w` of `tok` under a level's context. */
export function add(c: Chain, level: number, key: string, tok: string, w: number): void {
    const t = c.tables[level];
    if (!t.has(key)) t.set(key, new Map());
    bump(t.get(key)!, tok, w);
}

/** Learns one sequence; a loop wraps, so its first tokens follow its last. */
export function learn(c: Chain, seq: readonly string[], pos: readonly number[], loop: boolean): void {
    const n = seq.length;
    for (let i = 0; i < n; i++) {
        const prev = loop && n > 1 ? Array.from({ length: Math.min(HIST, n - 1) }, (_, j) => seq[(i - Math.min(HIST, n - 1) + j + n) % n])
            : seq.slice(Math.max(0, i - HIST), i);
        c.keys.forEach((k, L) => { const key = k(prev, pos[i]); if (key !== null) add(c, L, key, seq[i], 1); });
        bump(c.vocab, seq[i], 1);
    }
}

/** Every token seen under a level, for smoothing: `f` names a token's
 *  neighbours, each added at `mass` of the token's own count. */
export function smooth(c: Chain, level: number, f: (tok: string) => string[], mass: number): void {
    for (const m of c.tables[level].values()) {
        for (const [tok, n] of [...m]) for (const x of f(tok)) if (x !== tok) bump(m, x, n * mass);
    }
}

/** A token at `pos` after `prev`, from `level` down. `temp` above 1 flattens
 *  the counts (freer), below 1 sharpens them (closer to the source); `weigh`
 *  biases a token (density) and may veto one with 0. */
export function draw(c: Chain, level: number, prev: readonly string[], pos: number, r: Rng, temp: number,
    weigh: (tok: string) => number = () => 1): string | null {
    for (let L = Math.min(level, c.keys.length - 1); L >= -1; L--) {
        let m: Map<string, number> | undefined = c.vocab;
        if (L >= 0) { const key = c.keys[L](prev, pos); m = key === null ? undefined : c.tables[L].get(key); }
        if (!m || !m.size) continue;
        const ws = [...m].map(([tok, n]) => [tok, Math.pow(n, 1 / temp) * weigh(tok)] as const).filter(([, w]) => w > 0);
        const total = ws.reduce((s, [, w]) => s + w, 0);
        if (total <= 0) continue;
        let x = r() * total;
        for (const [tok, w] of ws) { x -= w; if (x <= 0) return tok; }
        return ws[ws.length - 1][0];
    }
    return null;
}

/** LIKENESS 0..10 → the deepest level and the temperature: low recombines
 *  freely, high keeps the source's own phrases. */
export function likeness(v: number): { level: number; temp: number } {
    return { level: v <= 2 ? 0 : v <= 5 ? 1 : v <= 8 ? 2 : 3, temp: 1.8 - v * 0.12 };
}
