/* Progressions derived, not listed (plans/2026-10-29-rhythm-harmony-maps.md):
 * rewrite rules after the generative grammars of tonal harmony (Steedman's
 * for the blues, 1984; Rohrmeier's syntax, 2011), each changing one chord of
 * a loop and keeping its length, so a progression and its derivation differ
 * by one chord (a seventh on or off is VOICING's, not a new loop). Diatonic rules first; the chromatic ones (a secondary
 * dominant, its tritone substitute, a chord borrowed from the parallel mode)
 * mark a loop as colour. A loop is scored by the corpus (walk.ts), and two
 * chords are measured apart after Lerdahl's chord distance (Tonal Pitch
 * Space, 2001): the roots' steps on the circle of fifths, the tones of the
 * second's basic space the first lacks, and the tones outside the key. */

import type { Chord, Key } from '../types.js';
import { chordOf, inKey, near, pc } from './pc.js';
import { degreeOf, diatonic } from './roman.js';
import { transition } from './walk.js';

export type Prog = Chord[];

const same = (a: Chord, b: Chord) => a.root === b.root && a.quality === b.quality;

/* Borrowed from the parallel mode, as semitones over the tonic: in major the
 * minor iv, bVI, bVII and bIII; in minor the Dorian IV, the harmonic V and
 * the Phrygian bII. */
const BORROWED: Record<'major' | 'minor', [number, Chord['quality']][]> = {
    major: [[5, 'min'], [8, 'maj'], [10, 'maj'], [3, 'maj']],
    minor: [[5, 'maj'], [7, 'maj'], [1, 'maj']],
};

/* The chords a key's rules reach, made once per key: a map derives from
 * thousands of loops and would otherwise build the same chords each time. */
interface Tables { scale: number; degree: number[]; logW: Float64Array; tri: Chord[]; sev: Chord[]; dom: Chord[]; sub: Chord[]; borrowed: Chord[] }
const TABLES = new Map<number, Tables>();
function tables(k: Key): Tables {
    const id = k.tonic * 2 + (k.minor ? 1 : 0);
    let t = TABLES.get(id);
    if (!t) {
        t = { scale: Array.from({ length: 12 }, (_, p) => (inKey(p, k) ? 1 << p : 0)).reduce((a, b) => a | b, 0),
            logW: Float64Array.from({ length: 49 }, (_, i) => Math.log((transition(k, Math.floor(i / 7), i % 7) || 2) + 1)), degree: Array.from({ length: 12 }, (_, p) => degreeOf(chordOf(p, 'maj'), k)),
            tri: Array.from({ length: 7 }, (_, d) => diatonic(k, d)), sev: Array.from({ length: 7 }, (_, d) => diatonic(k, d, true)),
            dom: Array.from({ length: 12 }, (_, r) => chordOf(r + 7, '7')), sub: Array.from({ length: 12 }, (_, r) => chordOf(r + 1, '7')),
            borrowed: BORROWED[k.minor ? 'minor' : 'major'].map(([s, q]) => chordOf(k.tonic + s, q)) };
        TABLES.set(id, t);
    }
    return t;
}

/** A chord's degree when all of it is in the key, else -1. */
/** A chord's pitch classes as twelve bits. */
const maskOf = (c: Chord) => { let m = 0; for (const p of c.pcs) m |= 1 << p; return m; };
const POP = Uint8Array.from({ length: 4096 }, (_, i) => { let n = 0; for (let x = i; x; x &= x - 1) n++; return n; });

/** A chord's degree when all of it is in the key, else -1. */
const degIn = (c: Chord, t: Tables) => ((maskOf(c) & ~t.scale) === 0 ? t.degree[c.root] : -1);

/** Every loop one rule away from `p`, and whether that rule is chromatic. */
export function derive(p: Prog, k: Key): [Prog, boolean][] {
    const t = tables(k);
    const out: [Prog, boolean][] = [];
    const put = (i: number, c: Chord, chroma: boolean) => {
        if (same(c, p[i]) || c.quality === 'dim') return;
        const q = [...p];
        q[i] = c;
        out.push([q, chroma]);
    };
    p.forEach((c, i) => {
        const next = p[(i + 1) % p.length];
        const d = degIn(c, t), dn = degIn(next, t);
        const own = c.pcs.length > 3 ? t.sev : t.tri;
        if (d >= 0) {
            /* A substitute a third away keeps two of the chord's tones (I↔vi, I↔iii, IV↔ii). */
            put(i, own[(d + 5) % 7], false);
            put(i, own[(d + 2) % 7], false);
            /* Mixture: the borrowed chord on (or a semitone from) this one's root, IV→iv, vi→bVI. */
            for (const b of t.borrowed) if (Math.abs(near(c.root, b.root)) <= 1) put(i, b, true);
        }
        /* The loop's first chord is its home: the rules that lead into a chord
         * work on the others. */
        if (i === 0) return;
        if (dn >= 0) {
            /* Preparation: the next chord's dominant, or its subdominant (plagal). */
            put(i, t.tri[(dn + 4) % 7], false);
            put(i, t.tri[(dn + 3) % 7], false);
        }
        /* Its secondary dominant (never V7 of the tonic again), or that
         * dominant's tritone substitute, which slides in by a semitone. */
        if (dn !== 0 && next.quality !== 'dim') put(i, t.dom[next.root], true);
        put(i, t.sub[next.root], true);
    });
    return out;
}

/* The weights of a move the corpus table does not count, as log(w + 1). */
const LOG_SAME = Math.log(13), LOG_RESOLVES = Math.log(31), LOG_COLOUR = Math.log(11);

/** How a loop sounds to a listener of the corpus: the mean of its moves'
 *  log weights, the last chord leading back to the first. */
export function plausible(p: Prog, k: Key): number {
    const t = tables(k);
    let s = 0;
    p.forEach((c, i) => {
        const n = p[(i + 1) % p.length];
        const a = degIn(c, t), b = degIn(n, t);
        if (same(c, n)) s += LOG_SAME;
        else if (a >= 0 && b >= 0) s += t.logW[a * 7 + b];
        /* A dominant seventh that falls a fifth or slides a semitone into its
         * chord is where it is heard as one; a borrowed chord is common enough. */
        else if (c.quality === '7' && (pc(c.root - n.root) === 7 || pc(c.root - n.root) === 1)) s += LOG_RESOLVES;
        else s += LOG_COLOUR;
    });
    return s / p.length;
}

const fifths = (a: number, b: number) => { const f = pc((b - a) * 7); return Math.min(f, 12 - f); };

/** Lerdahl's δ(x→y), made symmetric: the root's circle-of-fifths steps,
 *  the basic-space tones (root, root+fifth, the chord) one has and the other
 *  lacks, and how far outside the key the two sit apart. */
export function chordDistance(a: Chord, b: Chord, k: Key): number {
    if (same(a, b)) return 0;
    const ra = 1 << a.root, rb = 1 << b.root;
    const fa = ra | (1 << (a.pcs[2] ?? a.root)), fb = rb | (1 << (b.pcs[2] ?? b.root));
    const ca = maskOf(a), cb = maskOf(b);
    const kk = POP[ra ^ rb] + POP[fa ^ fb] + POP[ca ^ cb];
    const sc = tables(k).scale;
    return fifths(a.root, b.root) + kk / 2 + Math.abs(POP[ca & ~sc & 4095] - POP[cb & ~sc & 4095]);
}

/** Two loops apart: the chords that differ, each by how far; every
 *  `stride`-th slot only, where a chord spans several. */
export function progDistance(a: (Chord | null)[], b: (Chord | null)[], k: Key, stride = 1): number {
    let s = 0;
    for (let i = 0; i < Math.max(a.length, b.length); i += stride) {
        const x = a[i % a.length], y = b[i % b.length];
        s += x && y ? chordDistance(x, y, k) : x === y ? 0 : 6;
    }
    return s;
}

/** Every pair of loops apart, as `progDistance` measures them, in one go:
 *  the loops' chords numbered, each pair of chords measured once. */
export function distanceMatrix(xs: (Chord | null)[][], k: Key, stride = 1): Float64Array[] {
    const ids = new Map<string, number>();
    const chords: Chord[] = [];
    const num = (c: Chord | null) => {
        if (!c) return -1;
        const key = c.root + c.quality;
        let i = ids.get(key);
        if (i === undefined) { i = chords.length; ids.set(key, i); chords.push(c); }
        return i;
    };
    const len = Math.max(...xs.map((x) => x.length));
    const w = Math.ceil(len / stride);
    const rows = xs.map((x) => { const r = new Int16Array(w); for (let j = 0; j < w; j++) r[j] = num(x[(j * stride) % x.length]); return r; });
    const u = chords.length;
    const cd = new Float64Array(u * u);
    for (let i = 0; i < u; i++) for (let j = 0; j < u; j++) cd[i * u + j] = chordDistance(chords[i], chords[j], k);
    const m = xs.map(() => new Float64Array(xs.length));
    for (let i = 0; i < xs.length; i++) {
        for (let j = i + 1; j < xs.length; j++) {
            const a = rows[i], b = rows[j];
            let s = 0;
            for (let t = 0; t < a.length; t++) s += a[t] >= 0 && b[t] >= 0 ? cd[a[t] * u + b[t]] : a[t] === b[t] ? 0 : 6;
            m[i][j] = m[j][i] = s;
        }
    }
    return m;
}
