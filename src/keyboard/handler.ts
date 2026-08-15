import { portFor } from '../track/registry.js';
import { keyboardState, OCT_MIN, OCT_MAX } from './state.js';
import { noteSounded, noteReleased } from './held-notes.js';
import { emitNoteOff, releaseAllLive } from './release.js';
import { padColor, padPitch } from '../seq/pads.js';
import { C_GREEN } from '../seq/colors.js';
import { markUiStateDirty } from '../seq/ui-dirty.js';

/* Live pad note. Emits on the track's MIDI channel (0x9n) so it reaches that
 * track's chain slot, carrying real velocity. The caller supplies the final
 * velocity (Full Velocity is applied there). */
export function noteOn(padNote: number, padMin: number, track: number, vel: number): void {
    const midiNote = padPitch(track, padNote, padMin);
    if (midiNote < 0) return;              // dead pad: piano gap or out of range
    noteSounded(padNote, track, midiNote);
    keyboardState.lastPlayedNote = midiNote;
    portFor(track).sendMidi(MidiNoteOn, midiNote, vel);
    setLED(padNote, C_GREEN, true); // immediate green feedback before the next poll
}

/* The ledger — not the caller and not the currently active track — decides
 * which channel this off goes to. A track switch, module change, layout change
 * or view change between press and release must not be able to redirect it. */
export function noteOff(padNote: number, padMin: number): void {
    const n = noteReleased(padNote);
    if (n === undefined) return;
    emitNoteOff(n.track, n.pitch);
    setLED(padNote, padColor(padNote, padMin, n.track, false), true);
}

/* Set the global tonic's pitch class, wrapping at the octave edges (B↔C).
 * Pads are deliberately NOT painted here: app/tick.ts owns pad LEDs and is
 * track-aware (chromatic vs drum vs Session clip grid), so a root change
 * repaints on the next tick without ever overwriting a drum rack or clip grid. */
export function setRootPc(pc: number): void {
    releaseAllLive();
    keyboardState.rootPc = (((pc % 12) + 12) % 12);
    markUiStateDirty();
}

/* Shift one track's octave. Per-track by design: switching to a bass part
 * should not cost the lead track its register. */
export function changeOctave(track: number, delta: number): void {
    const t = track & 3;
    const next = Math.max(OCT_MIN, Math.min(OCT_MAX, keyboardState.octave[t] + delta));
    if (next === keyboardState.octave[t]) return;
    releaseAllLive();
    keyboardState.octave[t] = next;
    markUiStateDirty();
}
