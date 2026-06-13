/* Move chromatic pad layout (manual §9.1): a guitar-fretboard grid where a
 * pad is +1 semitone from the pad to its left and +5 semitones (a perfect
 * fourth) from the pad below it. padNote 68 is bottom-left (lowest); higher
 * rows are higher pitches.
 *
 * Coloring is fixed C-major (key/scale editing is out of scope): the root
 * note C uses the track color, other in-scale notes light gray, out-of-scale
 * pads stay dark. Held pads flash red.
 *
 * baseNote is the MIDI note of the bottom-left pad; the +/- buttons shift it
 * by an octave. */

import { C_BLACK, trackColor } from './colors.js';

const C_LIGHTGREY = 118; // schwung LightGrey — in-scale, non-root
const C_HELD = 1;        // schwung BrightRed — pad pressed

const COLS = 8;
const ROW_INTERVAL = 5;  // semitones per row going up (perfect fourth)
const MAJOR = [0, 2, 4, 5, 7, 9, 11]; // C-major scale degrees

export function chromaticPitch(padNote: number, padMin: number, baseNote: number): number {
    const idx = padNote - padMin;
    const row = Math.floor(idx / COLS);
    const col = idx % COLS;
    return baseNote + row * ROW_INTERVAL + col;
}

export function inScale(pitch: number): boolean {
    return MAJOR.includes(((pitch % 12) + 12) % 12);
}

export function chromaticPadColor(
    padNote: number,
    padMin: number,
    baseNote: number,
    track: number,
    held: boolean,
): number {
    if (held) return C_HELD;
    const pitch = chromaticPitch(padNote, padMin, baseNote);
    if (pitch < 0 || pitch > 127) return C_BLACK;
    const semitone = ((pitch % 12) + 12) % 12;
    if (semitone === 0) return trackColor(track); // root C
    return inScale(pitch) ? C_LIGHTGREY : C_BLACK;
}
