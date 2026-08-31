import type { DrumConfig } from '../types/param.js';
import { trackColor } from '../seq/colors.js';
import { drumPadOfPhys } from './drum-grid.js';

export function drumPadLedColor(
    padNote:        number,
    padMin:         number,
    drumConfig:     DrumConfig,
    currentPhysPad: number,
    track:          number,
    isPlaying:      boolean,
): number {
    if (drumPadOfPhys(padNote, padMin, drumConfig) < 0) return Black;
    if (isPlaying)                    return NeonGreen; // sounding (seq or held)
    if (padNote === currentPhysPad)   return White;     // selected pad in rack
    return trackColor(track);
}
