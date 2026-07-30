/* Melodic pad pitch + LED colour. Geometry comes entirely from the layout
 * module's pad map (keyboard/layouts.ts); this file only decides what colour a
 * pad's pitch deserves.
 *
 * Priority: dead > sounding > held/hold-overlay > root > in-scale > out.
 * The piano grid needs three visible levels rather than two: its gap pads play
 * nothing and stay dark, so an out-of-key pad — which does play — is lit dimly
 * to tell the two apart. Which row a pad is in already says white key or black
 * key, so no extra tint is spent on that. */

import { C_BLACK, C_GREEN, C_WHITE, C_DARKGREY, C_LIGHTGREY, trackColor } from './colors.js';
import { noteHeld } from './held.js';
import { inScaleFor } from './scales.js';
import { keyboardState, padMapFor } from '../keyboard/state.js';
import { isPianoLayout } from '../keyboard/layouts.js';

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
    if (!inScaleFor(pitch, keyboardState.rootPc, keyboardState.scale)) {
        return isPianoLayout(keyboardState.mode, keyboardState.layout) ? C_DARKGREY : C_BLACK;
    }
    return C_LIGHTGREY;
}
