import type { DrumConfig } from '../types/param.js';

export function drumPadLedColor(
    padNote:        number,
    padMin:         number,
    drumConfig:     DrumConfig,
    rootNote:       number,
    currentPhysPad: number,
): number {
    let drumPad: number;
    if (drumConfig.rawMidi) {
        drumPad = padNote - drumConfig.padNoteStart + 1;
    } else {
        const padIdx = padNote - padMin;
        const col    = padIdx % 8;
        const row    = Math.floor(padIdx / 8);
        if (col >= 4) return Black;
        drumPad = row * 4 + col + 1;
    }
    if (drumPad < 1 || drumPad > drumConfig.padCount) return Black;
    if (padNote === currentPhysPad) return NeonGreen;
    return White;
}
