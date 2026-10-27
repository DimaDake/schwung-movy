/* Velocity stages: DYNAMICS blends what was played toward the groove's
 * accents (downbeats up, off-16ths down); ACCENT spreads or flattens the
 * accents already there; EVEN pulls every note toward the part's median. */

import { strength } from '../analysis/events.js';
import type { Note } from '../types.js';

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 90; };
const clampV = (v: number) => Math.max(1, Math.min(127, Math.round(v)));

/** 0..10: 0 = as played, 10 = the accent template outright. */
export function dynamics(notes: Note[], v: number): Note[] {
    if (v <= 0 || !notes.length) return notes;
    const m = median(notes.map((n) => n.vel));
    const a = v / 10;
    return notes.map((n) => ({ ...n, vel: clampV(n.vel * (1 - a) + (m * 0.7 + m * 0.55 * strength(n.tick)) * a) }));
}

/** 0..10, 5 = as is: below flattens toward the median, above exaggerates the
 *  difference from it along the metre. */
export function accent(notes: Note[], v: number): Note[] {
    if (v === 5 || !notes.length) return notes;
    const m = median(notes.map((n) => n.vel));
    if (v < 5) return notes.map((n) => ({ ...n, vel: clampV(m + (n.vel - m) * (v / 5)) }));
    const k = (v - 5) / 5;
    return notes.map((n) => ({ ...n, vel: clampV(n.vel + (n.vel - m) * k + (strength(n.tick) - 0.5) * 40 * k) }));
}

/** 0..10: 0 = as played, 10 = every note at the median. */
export function even(notes: Note[], v: number): Note[] {
    if (v <= 0 || !notes.length) return notes;
    const m = median(notes.map((n) => n.vel));
    return notes.map((n) => ({ ...n, vel: clampV(n.vel + (m - n.vel) * (v / 10)) }));
}
