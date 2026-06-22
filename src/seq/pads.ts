/* Move chromatic pad layout (manual §9.1): a guitar-fretboard grid where a
 * pad is +1 semitone from the pad to its left and +5 semitones (a perfect
 * fourth) from the pad below it. padNote 68 is bottom-left (lowest); higher
 * rows are higher pitches.
 *
 * Coloring: root C = track color, sounding = green, last-held set = white,
 * other in-scale notes light gray, out-of-scale pads stay dark.
 *
 * baseNote is the MIDI note of the bottom-left pad; the +/- buttons shift it
 * by an octave. */

import { C_BLACK, C_GREEN, C_WHITE, trackColor } from './colors.js';
import { noteHeld } from './held.js';
import { inScaleFor } from './scales.js';

const C_LIGHTGREY = 118; // schwung LightGrey — in-scale, non-root

const COLS = 8;
const ROW_INTERVAL = 5;  // semitones per row going up (perfect fourth)

export function chromaticPitch(padNote: number, padMin: number, baseNote: number): number {
    const idx = padNote - padMin;
    const row = Math.floor(idx / COLS);
    const col = idx % COLS;
    return baseNote + row * ROW_INTERVAL + col;
}

export function inScale(pitch: number, baseNote: number, scaleIdx: number): boolean {
    return inScaleFor(pitch, baseNote, scaleIdx);
}

/* holdNotes: when non-null, those pitches show white instead of the lastHeld
 * set (step-hold overlay mode). null = normal mode using lastHeld. */
export function chromaticPadColor(
    padNote: number,
    padMin: number,
    baseNote: number,
    track: number,
    isPlaying: boolean,
    holdNotes: number[] | null = null,
    scaleIdx = 0,
): number {
    const pitch = chromaticPitch(padNote, padMin, baseNote);
    if (pitch < 0 || pitch > 127) return C_BLACK;
    if (isPlaying) return C_GREEN;
    const white = holdNotes !== null ? holdNotes.includes(pitch) : noteHeld(track, pitch);
    if (white) return C_WHITE;
    // Root = any pitch sharing the layout base note's pitch class (the musical
    // tonic; root transposes the layout, so base == tonic).
    if ((((pitch - baseNote) % 12) + 12) % 12 === 0) return trackColor(track);
    return inScale(pitch, baseNote, scaleIdx) ? C_LIGHTGREY : C_BLACK;
}
