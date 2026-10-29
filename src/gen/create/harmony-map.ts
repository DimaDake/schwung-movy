/* HARMONY as a map (plans/2026-10-29-rhythm-harmony-maps.md): the named
 * loops and walks are seeds; the grammar (theory/grammar.ts) derives more
 * from them a rule at a time; the most plausible are kept, and all of them
 * laid on one line where each next loop is the closest to the last, so a
 * turn changes a chord, not the song. The diatonic loops come first and the
 * colour after them, as before. */

import type { Chord, Key } from '../types.js';
import { derive, distanceMatrix, plausible, progDistance, type Prog } from '../theory/grammar.js';

export interface Loop { label: string; chords: (Chord | null)[]; ext: boolean; seed?: number }

const DEPTH = 2;        // rules on a seed: two keeps every loop near a named one
const BEAM = 32;        // derivations kept at each depth, diatonic and colour each
const DERIVE_MAX = 8;   // longer seeds (a developed journey) are only themselves

const Q = ['maj', 'min', 'dim', 'aug', 'sus2', 'sus4', '5', 'maj7', '7', 'm7', 'm7b5'];
/* One character a chord: a map keys thousands of loops. */
const idOf = (cs: (Chord | null)[]) => {
    let s = '';
    for (const c of cs) s += String.fromCharCode(c ? 33 + c.root * 11 + Q.indexOf(c.quality) : 32);
    return s;
};

/** The seeds and their best derivations, at most `cap` together; a step
 *  (a yield) for each depth of rules, so a request spreads it over ticks. */
export function* grow(seeds: Loop[], k: Key, cap: number): Generator<void, Loop[], void> {
    const all = new Map<string, Loop & { score: number }>();
    for (const s of seeds) if (!all.has(idOf(s.chords))) all.set(idOf(s.chords), { ...s, score: Infinity });
    const named = new Map<string, number>();
    let frontier = seeds.filter((s) => s.chords.length <= DERIVE_MAX && s.chords.every((c) => c)).map((s) => ({ ...s, score: 0 }));
    for (let d = 1; d <= DEPTH && frontier.length; d++) {
        const fresh = new Map<string, Loop & { score: number }>();
        for (const f of frontier) {
            const root = f.label.split('+')[0];
            for (const [p, chroma] of derive(f.chords as Prog, k)) {
                const id = idOf(p);
                if (all.has(id) || fresh.has(id)) continue;
                fresh.set(id, { label: root, chords: p, ext: f.ext || chroma, score: plausible(p, k) - 0.2 * d });
            }
        }
        const ranked = [...fresh.values()].sort((a, b) => b.score - a.score);
        frontier = [...ranked.filter((x) => !x.ext).slice(0, BEAM), ...ranked.filter((x) => x.ext).slice(0, BEAM)];
        for (const x of frontier) {
            const n = (named.get(x.label) ?? 0) + 1;
            named.set(x.label, n);
            all.set(idOf(x.chords), { ...x, label: `${x.label}+${n}` });
        }
        yield;
    }
    /* Every seed, then the likeliest derivations; colour takes a third at most. */
    const list = [...all.values()];
    const keep = list.filter((x) => x.seed !== undefined);
    const rest = list.filter((x) => x.seed === undefined).sort((a, b) => b.score - a.score);
    let ext = keep.filter((x) => x.ext).length;
    for (const x of rest) {
        if (keep.length >= cap) break;
        if (x.ext && ext >= cap / 3) continue;
        if (x.ext) ext++;
        keep.push(x);
    }
    return keep.map(({ score: _, ...x }) => x);
}

/** A line through the loops: nearest next from the first (or from the one
 *  nearest `from`), then shortened by reversing stretches (2-opt). The
 *  distances are worked out once: the 2-opt asks for each many times. */
export function line<T extends { chords: (Chord | null)[] }>(xs: T[], k: Key, stride = 1, from?: T): T[] {
    const n = xs.length;
    if (n < 3) return xs;
    const m = distanceMatrix(xs.map((x) => x.chords), k, stride);
    let start = 0;
    if (from) {
        const f = xs.map((x) => progDistance(from.chords, x.chords, k, stride));
        start = f.indexOf(Math.min(...f));
    }
    const out = [start];
    const used = new Set(out);
    while (out.length < n) {
        const last = out[out.length - 1];
        let bi = -1;
        for (let i = 0; i < n; i++) if (!used.has(i) && (bi < 0 || m[last][i] < m[last][bi])) bi = i;
        out.push(bi);
        used.add(bi);
    }
    for (let pass = 0, better = true; better && pass < 4; pass++) {
        better = false;
        for (let i = 1; i < n - 2; i++) {
            for (let j = i + 1; j < n - 1; j++) {
                const a = out[i - 1], b = out[i], c = out[j], e = out[j + 1];
                if (m[a][c] + m[b][e] < m[a][b] + m[c][e] - 1e-9) {
                    for (let x = i, y = j; x < y; x++, y--) [out[x], out[y]] = [out[y], out[x]];
                    better = true;
                }
            }
        }
    }
    return out.map((i) => xs[i]);
}

/** The map: diatonic loops on a line from the first seed, then the colour
 *  on a line from the loop nearest where the diatonic one ended. */
export function* order<T extends { chords: (Chord | null)[]; ext?: boolean }>(xs: T[], k: Key, stride = 1): Generator<void, T[], void> {
    const plain = line(xs.filter((x) => !x.ext), k, stride);
    yield;
    return [...plain, ...line(xs.filter((x) => x.ext), k, stride, plain[plain.length - 1])];
}
