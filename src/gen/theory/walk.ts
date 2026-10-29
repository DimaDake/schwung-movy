/* Progressions walked, not listed (plans/2026-10-29-chord-voicing-engine.md):
 * a first-order Markov chain over the key's scale degrees, weighted after the
 * pop and rock corpus counts (de Clercq & Temperley's RS200: I, IV, V and vi
 * carry most of it; IV→I and V→vi are as common as V→I; iii is rare). A walk
 * is a loop, so it must also lead from its last chord back to its first. The
 * temperature flattens the weights: a hotter walk takes the rarer turns.
 * Chromatic colour on top of a walk — a secondary dominant or its tritone
 * substitute before a chord — sits at the end of HARMONY (create/plans.ts). */

import type { Rng } from '../rng.js';
import type { Chord, Key } from '../types.js';
import { chordOf } from './pc.js';
import { degreeOf, diatonic } from './roman.js';

/* Row: from a degree (0 = tonic), the weight of each next degree. */
const MAJOR = [
    [0, 8, 4, 30, 28, 26, 0],
    [10, 0, 4, 20, 50, 12, 0],
    [10, 10, 0, 30, 10, 40, 0],
    [35, 10, 5, 0, 35, 12, 0],
    [50, 5, 5, 15, 0, 25, 0],
    [8, 20, 7, 40, 25, 0, 0],
    [80, 0, 10, 0, 0, 10, 0],
];
/* Natural minor; the ii° is left out (no place for a loop to sit). */
const MINOR = [
    [0, 0, 18, 25, 12, 25, 18],
    [0, 0, 0, 0, 0, 0, 0],
    [15, 0, 0, 20, 5, 30, 30],
    [35, 0, 10, 0, 20, 15, 15],
    [45, 0, 5, 15, 0, 25, 10],
    [15, 0, 15, 20, 10, 0, 35],
    [35, 0, 35, 5, 5, 20, 0],
];

const table = (k: Key) => (k.minor ? MINOR : MAJOR);

function draw(r: Rng, w: number[], temp: number): number {
    const ws = w.map((x) => (x > 0 ? Math.pow(x, 1 / temp) : 0));
    let x = r() * ws.reduce((a, b) => a + b, 0);
    for (let i = 0; i < ws.length; i++) { x -= ws[i]; if (x <= 0 && ws[i] > 0) return i; }
    return ws.findIndex((y) => y > 0);
}

/** A loop of `len` degrees: opens on the tonic (or the relative), never
 *  repeats a chord back to back, moves through at least `len - 1` chords,
 *  and its last chord leads back to its first. Null when no try passes. */
export function walkDegrees(k: Key, len: number, r: Rng, temp: number): number[] | null {
    const t = table(k);
    for (let tries = 0; tries < 60; tries++) {
        const out = [r() < 0.75 ? 0 : 5];
        while (out.length < len) out.push(draw(r, t[out[out.length - 1]], temp));
        const closes = t[out[len - 1]][out[0]] >= 10;
        if (closes && new Set(out).size >= Math.min(len - 1, 5)) return out;
    }
    return null;
}

/** `count` different walks, each seeded from `seed`. */
export function walks(k: Key, len: number, count: number, r: Rng, temp: number): Chord[][] {
    const out: Chord[][] = [];
    const seen = new Set<string>();
    for (let i = 0; i < count * 8 && out.length < count; i++) {
        const d = walkDegrees(k, len, r, temp);
        if (!d || seen.has(d.join())) continue;
        seen.add(d.join());
        out.push(d.map((x) => diatonic(k, x)));
    }
    return out;
}

/** In each four chords, the one that best becomes the dominant seventh of
 *  the chord after it (V7/vi before vi), or with `tritone` that dominant's
 *  substitute a tritone away, which slides in by a semitone. Never the
 *  tonic, nor before the tonic or a diminished chord, so the loop keeps its
 *  home; the best is the one that keeps most of its own notes. */
export function secondary(p: (Chord | null)[], k: Key, tritone: boolean): (Chord | null)[] {
    const out = [...p];
    const sub = (i: number): Chord | null => {
        const c = p[i], next = p[(i + 1) % p.length];
        if (!c || !next) return null;
        /* The tritone substitute is at home before the tonic (bII7-I); a plain
         * secondary dominant there would only be V7 again. */
        const home = degreeOf(next, k) === 0;
        if (degreeOf(c, k) === 0 || degreeOf(next, k) < 0 || (home && !tritone) || next.quality === 'dim') return null;
        const d = chordOf(next.root + (tritone ? 1 : 7), '7');
        return d.root === c.root && d.quality === c.quality ? null : d;
    };
    for (let at = 0; at < p.length; at += 4) {
        let best = -1, keep = -1;
        for (let i = at; i < Math.min(p.length, at + 4); i++) {
            const d = sub(i);
            if (!d) continue;
            const kept = d.pcs.filter((x) => p[i]!.pcs.includes(x)).length;
            if (kept > keep) { keep = kept; best = i; }
        }
        if (best >= 0) out[best] = sub(best);
    }
    return out;
}
