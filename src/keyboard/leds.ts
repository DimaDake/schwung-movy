import { PAD_MAP } from './notes.js';
import { keyboardState } from './state.js';

export function padLedColor(padNote: number, padMin: number): number {
    const offset = PAD_MAP[padNote - padMin];
    if (offset === null || offset === undefined) return Black;
    if (keyboardState.held[padNote] !== undefined) return BrightRed;
    const semitone = offset % 12;
    if (semitone === 0) return NeonGreen;
    if (semitone === 1 || semitone === 3 || semitone === 6 ||
        semitone === 8 || semitone === 10) return DarkGrey;
    return White;
}
