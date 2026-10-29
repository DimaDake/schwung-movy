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

const LADDER_FROM = 40;

/** The window, the anchor and the first chord's bottom note for a rung. */
function opening(c: Chord, k: Key, s: Style, o: VoiceOpts): { lo: number; hi: number; anchor: number; bottom: number | null } {
    const none = { lo: o.lo, hi: o.hi, anchor: o.anchor, bottom: null };
    if (o.rung === undefined) return none;
    const triad = c.pcs.slice(0, 3);
    let rung = LADDER_FROM;
    for (let i = 0; !triad.includes(pc(rung)) || i++ < o.rung; rung++) { /* the rung-th chord tone */ }
    const target = Math.max(rung, o.lo);
    let cs = candidates(c, k, s, o.lo, 108);
    if (!cs.length) cs = candidates(c, k, STYLES[1], o.lo, 108);
    /* A rung stands on a chord tone, not on a seventh or a colour. */
    const plain = cs.filter((x) => triad.includes(pc(x.notes[0])));
    const pool = plain.length ? plain : cs;
    if (!pool.length) return none;
    const bottom = pool.map((x) => x.notes[0]).sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b)[0];
    const anchor = Math.min(...pool.filter((x) => x.notes[0] === bottom).map((x) => x.notes[x.notes.length - 1]));
    const lo = Math.max(o.lo, bottom - 7);
    return { lo, hi: Math.max(anchor + 7, lo + 18), anchor, bottom };
}

/** One voicing per chord, all chosen together. Chords repeated back to back
 *  keep their voicing. */
export function voiceAll(chords: Chord[], k: Key, o: VoiceOpts): number[][] {
    if (!chords.length) return [];
    const s = STYLES[Math.max(0, Math.min(STYLES.length - 1, o.style))];
    const w = weights(o.motion ?? 'SMOOTH');
    const n = chords.length;
    const win = opening(chords[0], k, s, o);
    const anchorAt = (i: number) => o.anchors?.[i] ?? win.anchor + w.glide(n > 1 ? i / (n - 1) : 0);
    const cands = chords.map((c, i) => {
        /* Nothing fits the window (a five-voice stack over a high floor):
         * let it run up, never down under the floor. A chord the style has
         * no shape for (a quartal stack over a diminished chord) is a triad. */
        const hi = win.hi + Math.max(0, Math.ceil(w.glide(n > 1 ? i / (n - 1) : 0)));
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
    });
    if (cands.some((cs) => !cs.length)) return chords.map(() => []);
    const step = (a: Cand, b: Cand) => w.move * lead(a.notes, b.notes)
        + w.top * Math.abs(a.notes[a.notes.length - 1] - b.notes[b.notes.length - 1])
        + (a.shape === b.shape ? 0 : w.shape);
    /* A loop is closed by trying its best few openings and adding the way
     * back from the last chord; a few is enough, the anchor already ranks them. */
    const starts = o.loop && n > 1
        ? cands[0].map((c, i) => [c.cost, i]).sort((x, y) => x[0] - y[0]).slice(0, 6).map((x) => x[1])
        : [-1];
    let best: { cost: number; path: number[] } | null = null;
    for (const s0 of starts) {
        let cost = cands[0].map((c, i) => (s0 < 0 || i === s0 ? c.cost : Infinity));
        const back: number[][] = [];
        for (let t = 1; t < n; t++) {
            const same = o.holdRepeats !== false && chords[t].root === chords[t - 1].root && chords[t].quality === chords[t - 1].quality;
            const prev = cands[t - 1], cur = cands[t];
            const bk: number[] = [];
            const nc = cur.map((c, j) => {
                let m = Infinity, arg = 0;
                prev.forEach((p, i) => {
                    if (cost[i] === Infinity) return;
                    /* A repeated chord keeps its voicing. */
                    const x = cost[i] + (same ? (lead(p.notes, c.notes) ? 1e6 : 0) : step(p, c));
                    if (x < m) { m = x; arg = i; }
                });
                bk.push(arg);
                return m + (same ? 0 : c.cost);
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
