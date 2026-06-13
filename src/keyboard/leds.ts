import type { DrumConfig } from '../types/param.js';
import { trackColor } from '../seq/colors.js';

export function drumPadLedColor(
    padNote:        number,
    padMin:         number,
    drumConfig:     DrumConfig,
    rootNote:       number,
    currentPhysPad: number,
    track:          number,
    isPlaying:      boolean,
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
    if (isPlaying)                    return NeonGreen; // sounding (seq or held)
    if (padNote === currentPhysPad)   return White;     // selected pad in rack
    return trackColor(track);
}
