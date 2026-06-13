const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiNoteName(note: number): string {
    return NOTE_NAMES[note % 12] + (Math.floor(note / 12) - 1);
}
