/* Melodic pad pitch + LED colour. Geometry comes entirely from the layout
 * module's pad map (keyboard/layouts.ts); this file only decides what colour a
 * pad's pitch deserves.
 *
 * Priority: dead > sounding > held/hold-overlay > root > in-scale > out.
 * Piano black keys take the darker in-scale tint, which is what makes the
 * keyboard shape readable on the grid. */

import { C_BLACK, C_GREEN, C_WHITE, C_DARKGREY, C_LIGHTGREY, trackColor } from './colors.js';
import { noteHeld } from './held.js';
import { inScaleFor } from './scales.js';
import { keyboardState, padMapFor } from '../keyboard/state.js';
import { isPianoBlack } from '../keyboard/layouts.js';

/** MIDI pitch this pad plays on `track`, or -1 for a dead pad. */
export function padPitch(track: number, padNote: number, padMin: number): number {
    return padMapFor(track)[padNote - padMin] ?? -1;
}

/* holdNotes: when non-null, those pitches show white instead of the lastHeld
 * set (step-hold overlay mode). null = normal mode using lastHeld. */
export function padColor(
    padNote:   number,
    padMin:    number,
    track:     number,
    isPlaying: boolean,
    holdNotes: number[] | null = null,
): number {
    const idx = padNote - padMin;
    const pitch = padMapFor(track)[idx] ?? -1;
    if (pitch < 0) return C_BLACK;
    if (isPlaying) return C_GREEN;
    const white = holdNotes !== null ? holdNotes.includes(pitch) : noteHeld(track, pitch);
    if (white) return C_WHITE;
    // Root = any pitch sharing the tonic's pitch class.
    if ((((pitch - keyboardState.rootPc) % 12) + 12) % 12 === 0) return trackColor(track);
    if (!inScaleFor(pitch, keyboardState.rootPc, keyboardState.scale)) return C_BLACK;
    return isPianoBlack(keyboardState.mode, keyboardState.layout, idx) ? C_DARKGREY : C_LIGHTGREY;
}
