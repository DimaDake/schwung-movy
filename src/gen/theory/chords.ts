/* Chords from sounding pitch classes: template scoring per half-bar with root
 * and bass weight and a light key prior, then gaps held from the chord before
 * (a sustained pad between attacks is still that chord). */

import type { Segment } from '../analysis/sounding.js';
import type { Chord, Key, Quality } from '../types.js';
import { chordOf, pc, scaleOf, TEMPLATES } from './pc.js';

const QUALITIES = Object.keys(TEMPLATES) as Quality[];

/* A seventh or a bare fifth must earn its place: a triad that explains the
 * same notes is the simpler reading. */
const COST: Record<Quality, number> = { maj: 0, min: 0, dim: 0.08, aug: 0.12, sus2: 0.06, sus4: 0.06, 5: 0.05,
    maj7: 0.04, 7: 0.04, m7: 0.04, m7b5: 0.08 };

export function scoreChord(w: number[], total: number, bass: number, root: number, q: Quality, key: Key | null): number {
    const iv = TEMPLATES[q];
    const tones = iv.map((i) => pc(root + i));
    let inside = 0;
    for (const t of tones) inside += w[t] * (t === root ? 1.15 : 1);
    let outside = 0;
    for (let i = 0; i < 12; i++) if (!tones.includes(i)) outside += w[i];
    /* Every template tone should be heard: a missing third is what makes a
     * fifth a power chord, a missing seventh makes a triad. */
    const missing = tones.filter((t) => w[t] <= total * 0.02).length;
    let s = (inside - 0.65 * outside) / total - missing * 0.22 - COST[q];
    if (bass >= 0) s += pc(bass) === root ? 0.12 : tones.includes(pc(bass)) ? 0.03 : -0.05;
    if (key) {
        const sc = scaleOf(key);
        if (tones.every((t) => sc.includes(t))) s += 0.06;
    }
    return s;
}

export function detectChord(seg: Segment, key: Key | null): Chord | null {
    if (seg.total <= 0) return null;
    let best: Chord | null = null;
    let bestS = -1e9;
    for (let root = 0; root < 12; root++) {
        if (seg.w[root] <= 0) continue;   // a chord whose root never sounds is a guess too far
        for (const q of QUALITIES) {
            const s = scoreChord(seg.w, seg.total, seg.bass, root, q, key);
            if (s > bestS) { bestS = s; best = chordOf(root, q, seg.bass >= 0 ? seg.bass : root); }
        }
    }
    if (best && best.quality === '5' && key) {
        /* A bare fifth in a key reads as the diatonic triad on that root. */
        const third = scaleOf(key).find((t) => pc(t - best!.root) === 3 || pc(t - best!.root) === 4);
        if (third !== undefined) best = chordOf(best.root, pc(third - best.root) === 3 ? 'min' : 'maj', best.bass);
    }
    return best;
}

/** One chord per segment; empty segments hold the chord before (or the first
 *  one, for a scene that starts on a rest). All null when nothing sounds. */
export function chordsOf(segs: Segment[], key: Key | null): (Chord | null)[] {
    const raw = segs.map((s) => detectChord(s, key));
    const first = raw.find((c) => c) ?? null;
    let last = first;
    return raw.map((c) => { if (c) last = c; return c ?? last; });
}

/** A single pitch class (a drone, a lone bass) as the diatonic chord built on
 *  it, or the key's tonic when it is foreign to the key. */
export function chordOnPc(p: number, key: Key): Chord {
    const sc = scaleOf(key);
    const i = sc.indexOf(pc(p));
    if (i < 0) return chordOf(key.tonic, key.minor ? 'min' : 'maj');
    const third = pc(sc[(i + 2) % 7] - sc[i]);
    const fifth = pc(sc[(i + 4) % 7] - sc[i]);
    return chordOf(sc[i], fifth === 6 ? 'dim' : third === 3 ? 'min' : 'maj');
}
