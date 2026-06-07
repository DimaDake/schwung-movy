const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiNoteName(note: number): string {
    return NOTE_NAMES[note % 12] + (Math.floor(note / 12) - 1);
}

export const PAD_MAP: (number | null)[] = [
    /* row 0: pads 68-75 — white keys oct+0 */
     0,  2,  4,  5,  7,  9, 11, 12,
    /* row 1: pads 76-83 — black keys oct+0 */
     1,  3, null, 6,  8, 10, null, null,
    /* row 2: pads 84-91 — white keys oct+1 */
    12, 14, 16, 17, 19, 21, 23, 24,
    /* row 3: pads 92-99 — black keys oct+1 */
    13, 15, null, 18, 20, 22, null, null,
];
