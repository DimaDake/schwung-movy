import type { DrumConfig } from '../types/param.js';
import { C_DARKGREY, trackColor } from '../seq/colors.js';
import { drumPadOfPhys } from './drum-grid.js';

export function drumPadLedColor(
    padNote:        number,
    padMin:         number,
    drumConfig:     DrumConfig,
    currentPhysPad: number,
    track:          number,
    isPlaying:      boolean,
    isSilent:       boolean,
): number {
    if (drumPadOfPhys(padNote, padMin, drumConfig) < 0) return Black;
    /* Sounding and selected both outrank silenced, in that order: a muted voice
     * whose gate is open must still be green, and the pad the drum lane is
     * editing must stay white or the user cannot see where they are. Grey is
     * what a silenced voice looks like AT REST — that is the whole difference
     * between a mute you can read off the grid and one you have to remember. */
    if (isPlaying)                    return NeonGreen; // sounding (seq or held)
    if (padNote === currentPhysPad)   return White;     // selected pad in rack
    if (isSilent)                     return C_DARKGREY;
    return trackColor(track);
}
