/* Pad → pitch mapping for every melodic pad layout. This is the one place the
 * grid geometry lives: note-on, LED colouring, the Keys view and the step-hold
 * overlay all read the map this builds, so no two of them can disagree about
 * what a pad plays.
 *
 * Grid: 8 columns × 4 rows, index = padNote - PAD_MIN, index 0 = bottom-left,
 * row 0 = bottom. A value of -1 marks a dead pad — a piano gap, or a pitch
 * outside MIDI 0..127. Dead pads are silent and unlit; they are never clamped
 * to a playable note, which would put two pads on the same pitch. */

import { SCALES } from '../seq/scales.js';

export const COLS = 8;
export const ROWS = 4;
export const PAD_COUNT = COLS * ROWS;

export const MODE_CHROMATIC = 0;
export const MODE_IN_KEY = 1;
export const MODE_NAMES = ['Chromatic', 'In Key'];

/* Layout options depend on mode: there is no Inline for Chromatic, and no Piano
 * for In Key (a piano keyboard is chromatic by construction). Both lists are
 * length 2, so the selected index survives a mode flip without reindexing. */
export const LAYOUT_FOURTHS = 0;
export const LAYOUT_PIANO = 1;
export const LAYOUT_INLINE = 1;
const LAYOUTS_CHROMATIC = ['Fourths', 'Piano'];
const LAYOUTS_IN_KEY = ['Fourths', 'Inline'];

export function layoutNames(mode: number): string[] {
    return mode === MODE_IN_KEY ? LAYOUTS_IN_KEY : LAYOUTS_CHROMATIC;
}

const CHROM_ROW_STEP = 5;   // a perfect fourth per row — the guitar fretboard
const CHROM_ROOT_COL = 3;   // root on the 4th pad, leaving 3 pads below it
const KEY_ROW_STEP = 3;     // a fourth measured in scale degrees (Push's In Key)

const PIANO_WHITE = [0, 2, 4, 5, 7, 9, 11, 12];
/* Blacks sit above the white note they lead into (C# above D), so cols 0, 3
 * and 7 have no black key above them. */
const PIANO_BLACK = [-1, 1, 3, -1, 6, 8, 10, -1];

/** Scale-degree index → pitch, wrapping into higher (or lower) octaves. */
export function degreeToPitch(base: number, degrees: number[], i: number): number {
    const len = degrees.length;
    const oct = Math.floor(i / len);
    return base + oct * 12 + degrees[i - oct * len];
}

export function buildPadMap(mode: number, layout: number, scaleIdx: number, base: number): Int16Array {
    const map = new Int16Array(PAD_COUNT);
    const degrees = (SCALES[scaleIdx] ?? SCALES[0]).degrees;
    for (let i = 0; i < PAD_COUNT; i++) {
        const row = (i / COLS) | 0;
        const col = i % COLS;
        let pitch: number;
        if (mode === MODE_IN_KEY) {
            const step = layout === LAYOUT_INLINE ? degrees.length : KEY_ROW_STEP;
            pitch = degreeToPitch(base, degrees, row * step + col);
        } else if (layout === LAYOUT_PIANO) {
            const off = (row & 1) ? PIANO_BLACK[col] : PIANO_WHITE[col];
            pitch = off < 0 ? -1 : base + (row >> 1) * 12 + off;
        } else {
            pitch = base + row * CHROM_ROW_STEP + col - CHROM_ROOT_COL;
        }
        map[i] = (pitch < 0 || pitch > 127) ? -1 : pitch;
    }
    return map;
}

/** True for a piano black key — the only pad that takes the darker LED tint. */
export function isPianoBlack(mode: number, layout: number, padIdx: number): boolean {
    if (mode !== MODE_CHROMATIC || layout !== LAYOUT_PIANO) return false;
    return (((padIdx / COLS) | 0) & 1) === 1;
}
