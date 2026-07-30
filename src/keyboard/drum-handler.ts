import type { DrumConfig } from '../types/param.js';
import { keyboardState } from './state.js';
import { noteSounded, noteReleased } from './held-notes.js';
import { emitNoteOff } from './release.js';

export function drumPadOn(
    physPad:      number,
    padMin:       number,
    shiftHeld:    boolean,
    drumConfig:   DrumConfig,
    componentKey: string,
    slot:         number,
    vel:          number,
): number | null {
    let midiNote: number;
    let drumPad:  number;
    if (drumConfig.rawMidi) {
        midiNote = physPad;
        drumPad  = midiNote - drumConfig.padNoteStart + 1;
    } else {
        const padIdx = physPad - padMin;
        const col    = padIdx % 8;
        const row    = Math.floor(padIdx / 8);
        if (col >= 4) return null;
        drumPad  = row * 4 + col + 1;
        midiNote = drumConfig.padNoteStart + drumPad - 1;
    }
    if (drumPad < 1 || drumPad > drumConfig.padCount) return null;

    const suppressMidi = shiftHeld && !drumConfig.shiftSelectMidi;
    if (!suppressMidi) {
        keyboardState.lastPlayedNote = midiNote;
        // Track the sounding pad so the drum grid lights it green while held
        // (a shift-select makes no sound, so it must not register as playing).
        noteSounded(physPad, slot, midiNote);
        shadow_send_midi_to_dsp([MidiNoteOn | slot, midiNote, shiftHeld ? 1 : vel]);
    }
    if (drumConfig.currentPadParam) {
        shadow_set_param(slot, componentKey + ':' + drumConfig.currentPadParam, String(drumPad));
    }
    return drumPad;
}

/* Release takes no config: the pitch and channel come from the ledger. Deriving
 * them from the live DrumConfig stranded the note whenever the module changed
 * between press and release (the melodic/drum branches compute different
 * notes). Pads that never sounded — a shift-select, an out-of-grid press — are
 * simply absent from the ledger. */
export function drumPadOff(physPad: number): void {
    const n = noteReleased(physPad);
    if (n === undefined) return;
    emitNoteOff(n.track, n.pitch);
}
