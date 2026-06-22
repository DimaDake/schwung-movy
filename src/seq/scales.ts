/* Selectable musical scales for the Main Params "Key" knob. Degrees are
 * semitone offsets from the root (0..11). Global across all chromatic tracks;
 * drives in-scale pad highlighting only — never folds the chromatic layout. */

export interface Scale {
    name:    string;
    degrees: number[];
}

export const SCALES: Scale[] = [
    { name: 'Major',      degrees: [0, 2, 4, 5, 7, 9, 11] },
    { name: 'Minor',      degrees: [0, 2, 3, 5, 7, 8, 10] },
    { name: 'Dorian',     degrees: [0, 2, 3, 5, 7, 9, 10] },
    { name: 'Phrygian',   degrees: [0, 1, 3, 5, 7, 8, 10] },
    { name: 'Lydian',     degrees: [0, 2, 4, 6, 7, 9, 11] },
    { name: 'Mixolydian', degrees: [0, 2, 4, 5, 7, 9, 10] },
    { name: 'Locrian',    degrees: [0, 1, 3, 5, 6, 8, 10] },
    { name: 'Harm Min',   degrees: [0, 2, 3, 5, 7, 8, 11] },
    { name: 'Mel Min',    degrees: [0, 2, 3, 5, 7, 9, 11] },
    { name: 'Maj Penta',  degrees: [0, 2, 4, 7, 9] },
    { name: 'Min Penta',  degrees: [0, 3, 5, 7, 10] },
    { name: 'Blues',      degrees: [0, 3, 5, 6, 7, 10] },
    { name: 'Chromatic',  degrees: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
];

export const SCALE_NAMES: string[] = SCALES.map((s) => s.name);

/** True if `pitch` is in `scaleIdx` anchored to `root` (any octave of root). */
export function inScaleFor(pitch: number, root: number, scaleIdx: number): boolean {
    const s = SCALES[scaleIdx] ?? SCALES[0];
    const deg = (((pitch - root) % 12) + 12) % 12;
    return s.degrees.includes(deg);
}
