/* DENSITY for drums, 5 = as is (user, 2026-11-01: Smart Quantize should thin
 * or fill a part). Pad by pad, not by tick: a tick holds the kick and the
 * hat together, and thinning it would drop the kick with the hat. Thinner
 * drops the weakest hits (metre, then loudness) and never a pad's last one;
 * denser plays each pad more of what it already does, a quieter hit half way
 * into its widest gaps. */

import { strength } from '../analysis/events.js';
import type { Rng } from '../rng.js';
import { type Note, TPS } from '../types.js';

const weight = (n: Note) => strength(n.tick) * 2 + n.vel / 127;

function thin(notes: Note[], share: number, r: Rng): Note[] {
    const left = new Map<number, number>();
    for (const n of notes) left.set(n.pitch, (left.get(n.pitch) ?? 0) + 1);
    let drop = Math.round(notes.length * share);
    const gone = new Set<Note>();
    for (const n of [...notes].map((n) => ({ n, w: weight(n) + r() * 0.05 })).sort((a, b) => a.w - b.w).map((x) => x.n)) {
        if (drop <= 0) break;
        if (left.get(n.pitch)! <= 1) continue;
        left.set(n.pitch, left.get(n.pitch)! - 1);
        gone.add(n);
        drop--;
    }
    return notes.filter((n) => !gone.has(n));
}

function fill(notes: Note[], share: number, end: number): Note[] {
    const out = [...notes];
    for (const pitch of new Set(notes.map((n) => n.pitch))) {
        const hits = notes.filter((n) => n.pitch === pitch).sort((a, b) => a.tick - b.tick);
        const taken = new Set(hits.map((n) => Math.round(n.tick / TPS)));
        const gaps = hits.map((n, i) => ({ n, span: (hits[i + 1]?.tick ?? hits[0].tick + end) - n.tick }))
            .filter((g) => g.span >= 2 * TPS).sort((a, b) => b.span - a.span || a.n.tick - b.n.tick);
        for (const { n, span } of gaps.slice(0, Math.max(1, Math.round(hits.length * share)))) {
            const step = (Math.round(n.tick / TPS) + Math.round(span / TPS / 2)) % Math.round(end / TPS);
            if (taken.has(step)) continue;
            taken.add(step);
            out.push({ ...n, tick: step * TPS, vel: Math.max(1, Math.round(n.vel * 0.7)) });
        }
    }
    return out.sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
}

/** v 0..10, 5 = as is. */
export function drumDensity(notes: Note[], v: number, end: number, r: Rng): Note[] {
    if (v === 5 || !notes.length) return notes;
    return v < 5 ? thin(notes, ((5 - v) / 5) * 0.75, r) : fill(notes, ((v - 5) / 5) * 1.2, end);
}
