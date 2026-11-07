/* The whole-progression voicing search (plans/2026-10-29-chord-voicing-
 * engine.md): every candidate voicing of every chord (voicing-styles.ts),
 * and the notes chosen for the whole loop at once, a shortest path
 * (Viterbi). The cost is the voices' movement (Tymoczko's L1 voice leading),
 * the top note's distance from an anchor (Strudel's `anchor`, Muzik's lead
 * note) and mud under the low-interval limits. A loop is closed: its last
 * chord leads back into its first. */

import type { Chord, Key } from '../types.js';
import { type Cand, candidates, mud, type Style, STYLES } from './voicing-styles.js';
import { pc } from './pc.js';
import { opening } from './voicing-opening.js';

/** Sorted voice-by-voice distance: for two equal-sized chords the smallest
 *  total movement any assignment gives (Tymoczko's L1). */
function lead(a: number[], b: number[]): number {
    let s = Math.abs(a.length - b.length) * 6;
    for (let i = 0; i < Math.min(a.length, b.length); i++) s += Math.abs(a[i] - b[i]);
    return s;
}

/* MOTION: how the voicings move from chord to chord. Each weighs movement
 * against the anchor, and may move the anchor across the loop. */
export const MOTIONS = ['SMOOTH', 'TOP LINE', 'CLIMB', 'ARCH', 'FALL', 'PARALLEL'] as const;
export type Motion = typeof MOTIONS[number];

interface Weights { move: number; top: number; anchor: number; shape: number; glide: (f: number) => number }

function weights(m: Motion): Weights {
    switch (m) {
        case 'TOP LINE': return { move: 0.35, top: 0.8, anchor: 1.4, shape: 0, glide: () => 0 };
        case 'CLIMB': return { move: 0.5, top: 0.2, anchor: 1.2, shape: 0, glide: (f) => -4 + f * 10 };
        case 'ARCH': return { move: 0.5, top: 0.2, anchor: 1.2, shape: 0, glide: (f) => -3 + Math.sin(f * Math.PI) * 9 };
        case 'FALL': return { move: 0.5, top: 0.2, anchor: 1.2, shape: 0, glide: (f) => 5 - f * 10 };
        /* Planing: one shape slid along under the progression, as house and
         * dub stabs and Debussy do; the movement barely counts. */
        case 'PARALLEL': return { move: 0.08, top: 0, anchor: 0.5, shape: 30, glide: () => 0 };
        default: return { move: 1, top: 0.3, anchor: 0.35, shape: 0, glide: () => 0 };
    }
}

export interface VoiceOpts {
    style: number;          // STYLES index
    anchor: number;         // where the top note wants to be
    lo: number;             // nothing under this (the band's floor)
    hi: number;
    motion?: Motion;
    loop?: boolean;         // the last chord leads back into the first
    /** REGISTER as a ladder: the first chord opens on the voicing whose
     *  bottom note is nearest its `rung`-th chord tone up from E2, and the
     *  rest follow from there, so each click is the next inversion; under
     *  `lo` the low rungs meet at it. */
    rung?: number;
    /** Where each chord's top note wants to be, in place of `anchor`: a
     *  realiser follows the source's own top line this way. */
    anchors?: number[];
    /** A chord struck again keeps its voicing (default); a realiser lets it
     *  move with the source instead. */
    holdRepeats?: boolean;
}

/** One voicing per chord, all chosen together. Chords repeated back to back
 *  keep their voicing. */
export function voiceAll(chords: Chord[], k: Key, o: VoiceOpts): number[][] {
    /* Every take and every guard retry of a request voices the same
     * progression the same way: once (device: most of a take on a chord part). */
    const key = `${JSON.stringify(k)}|${JSON.stringify(o)}|${chords.map((c) => `${c.root} ${c.quality} ${c.pcs} ${c.bass}`).join(';')}`;
    let hit = voiced.get(key);
    if (!hit) {
        if (voiced.size >= VOICED_MAX) voiced.clear();
        hit = search(chords, k, o);
        voiced.set(key, hit);
    }
    return hit.map((v) => [...v]);
}

const VOICED_MAX = 64;
const voiced = new Map<string, number[][]>();

function search(chords: Chord[], k: Key, o: VoiceOpts): number[][] {
    if (!chords.length) return [];
    const s = STYLES[Math.max(0, Math.min(STYLES.length - 1, o.style))];
    const w = weights(o.motion ?? 'SMOOTH');
    const n = chords.length;
    const win = opening(chords[0], k, s, o);
    const anchorAt = (i: number) => o.anchors?.[i] ?? win.anchor + w.glide(n > 1 ? i / (n - 1) : 0);
    /* A comp strikes each chord several times: one search per chord and window. */
    const seen = new Map<string, (Cand & { cost: number })[]>();
    const cands = chords.map((c, i) => {
        const hi0 = win.hi + Math.max(0, Math.ceil(w.glide(n > 1 ? i / (n - 1) : 0)));
        const key = i === 0 ? '' : `${c.root} ${c.quality} ${c.pcs} ${c.bass} ${hi0} ${anchorAt(i)}`;
        const hit = key ? seen.get(key) : undefined;
        if (hit) return hit;
        const made = voicingsOf(c, i, hi0);
        if (key) seen.set(key, made);
        return made;
    });
    function voicingsOf(c: Chord, i: number, hi: number): (Cand & { cost: number })[] {
        /* Nothing fits the window (a five-voice stack over a high floor):
         * let it run up, never down under the floor. A chord the style has
         * no shape for (a quartal stack over a diminished chord) is a triad. */
        const fit = (st: Style) => {
            let cs = candidates(c, k, st, win.lo, hi);
            for (let up = 6; !cs.length && up <= 36; up += 6) cs = candidates(c, k, st, win.lo, hi + up);
            return cs;
        };
        let cs = fit(s);
        if (!cs.length) cs = fit(STYLES[1]);
        if (i === 0 && win.bottom !== null && cs.some((x) => x.notes[0] === win.bottom)) cs = cs.filter((x) => x.notes[0] === win.bottom);
        const a = anchorAt(i);
        return cs.map((x) => {
            const top = x.notes[x.notes.length - 1];
            const above = Math.max(0, top - a - 2);
            /* The root is the bass's note; a third or fifth under the chord is an
             * inversion, a seventh or a colour there blurs what chord it is. */
            const b = pc(x.notes[0]);
            const bottom = b === c.pcs[0] ? 0 : c.pcs.slice(1, 3).includes(b) ? 1 : 8;
            return { ...x, cost: w.anchor * (Math.abs(top - a) + above * 2) + 2 * mud(x.notes) + bottom };
        });
    }
    if (cands.some((cs) => !cs.length)) return chords.map(() => []);
    const step = (a: Cand, b: Cand) => w.move * lead(a.notes, b.notes)
        + w.top * Math.abs(a.notes[a.notes.length - 1] - b.notes[b.notes.length - 1])
        + (a.shape === b.shape ? 0 : w.shape);
    /* A loop is closed by trying its best few openings and adding the way
     * back from the last chord; a few is enough, the anchor already ranks them. */
    const starts = o.loop && n > 1
        ? cands[0].map((c, i) => [c.cost, i]).sort((x, y) => x[0] - y[0]).slice(0, 6).map((x) => x[1])
        : [-1];
    /* What a move costs does not depend on the opening: worked out once for
     * all of them. A chord struck again keeps its voicing, so it may only
     * follow the same notes: a comp strikes each chord several times a bar,
     * and comparing every pair there was most of a Variation (device lag,
     * 2026-11-07). */
    const same = chords.map((c, t) => t > 0 && o.holdRepeats !== false && c.root === chords[t - 1].root && c.quality === chords[t - 1].quality);
    const moves: (Float64Array | null)[] = [], twins: number[][][] = [];
    const pairs = new Map<Cand[], Map<Cand[], Float64Array>>();
    for (let t = 1; t < n; t++) {
        const prev = cands[t - 1], cur = cands[t];
        if (same[t]) {
            const at = new Map<string, number[]>();
            prev.forEach((p, i) => { const k = p.notes.join(); at.set(k, [...(at.get(k) ?? []), i]); });
            twins.push(cur.map((c) => at.get(c.notes.join()) ?? []));
            moves.push(null);
        } else {
            /* A progression that comes round again moves between the same voicings. */
            const row = pairs.get(prev) ?? new Map<Cand[], Float64Array>();
            pairs.set(prev, row);
            let m = row.get(cur);
            if (!m) {
                m = new Float64Array(prev.length * cur.length);
                for (let i = 0; i < prev.length; i++) for (let j = 0; j < cur.length; j++) m[i * cur.length + j] = step(prev[i], cur[j]);
                row.set(cur, m);
            }
            moves.push(m);
            twins.push([]);
        }
    }
    let best: { cost: number; path: number[] } | null = null;
    for (const s0 of starts) {
        let cost = cands[0].map((c, i) => (s0 < 0 || i === s0 ? c.cost : Infinity));
        const back: number[][] = [];
        for (let t = 1; t < n; t++) {
            const cur = cands[t], mv = moves[t - 1];
            const bk: number[] = [];
            /* Any other voicing of a repeat costs 1e6: from the cheapest. */
            let g = -1;
            if (!mv) cost.forEach((x, i) => { if (x !== Infinity && (g < 0 || x < cost[g])) g = i; });
            const nc = cur.map((c, j) => {
                let m = Infinity, arg = 0;
                if (mv) {
                    for (let i = 0; i < cost.length; i++) {
                        if (cost[i] === Infinity) continue;
                        const x = cost[i] + mv[i * cur.length + j];
                        if (x < m) { m = x; arg = i; }
                    }
                } else {
                    for (const i of twins[t - 1][j]) if (cost[i] !== Infinity && cost[i] < m) { m = cost[i]; arg = i; }
                    if (g >= 0 && !twins[t - 1][j].includes(g) && (cost[g] + 1e6 < m || (cost[g] + 1e6 === m && g < arg))) { m = cost[g] + 1e6; arg = g; }
                }
                bk.push(arg);
                return m + (same[t] ? 0 : c.cost);
            });
            back.push(bk);
            cost = nc;
        }
        let end = 0, endCost = Infinity;
        cost.forEach((x, j) => {
            const y = x + (s0 >= 0 ? step(cands[n - 1][j], cands[0][s0]) : 0);
            if (y < endCost) { endCost = y; end = j; }
        });
        if (best && best.cost <= endCost) continue;
        const path = [end];
        for (let t = n - 1; t > 0; t--) path.unshift(back[t - 1][path[0]]);
        best = { cost: endCost, path };
    }
    return best!.path.map((j, t) => cands[t][j].notes);
}
