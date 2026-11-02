/* VELOCITY on Smart Quantize's TIGHT (plans/2026-11-01-generator-ux-design.md
 * §2.7): TIDY's EVEN and GROOVE's DYNAMICS on one centred knob, since one
 * flattens what the other exaggerates. */

import { dynamics, even } from './dynamics.js';
import type { Note } from '../types.js';

/** 0..10: 5 = as played, left = evened toward the median, right = the beat's accents. */
export function velocity(notes: Note[], v: number): Note[] {
    if (v < 5) return even(notes, (5 - v) * 2);
    if (v > 5) return dynamics(notes, (v - 5) * 2);
    return notes;
}
