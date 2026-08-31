import { portFor } from '../track/registry.js';
import { engineOwnsPads } from '../track/pad-route.js';
import type { DrumConfig } from '../types/param.js';
import { keyboardState } from './state.js';
import { drumNoteOfPad, drumPadOfPhys } from './drum-grid.js';
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
    const drumPad = drumPadOfPhys(physPad, padMin, drumConfig);
    if (drumPad < 0) return null;
    const midiNote = drumNoteOfPad(drumPad, drumConfig);

    const suppressMidi = shiftHeld && !drumConfig.shiftSelectMidi;
    if (!suppressMidi) {
        keyboardState.lastPlayedNote = midiNote;
        // Track the sounding pad so the drum grid lights it green while held
        // (a shift-select makes no sound, so it must not register as playing).
        noteSounded(physPad, slot, midiNote);
        /* The ledger entry above is recorded either way; only the SEND is
         * skipped. When the engine owns the pads it has already sounded this
         * note from the audio thread, and a second copy from here doubles it --
         * which is what the melodic path (keyboard/handler.ts) has always
         * checked and this one did not. */
        if (!engineOwnsPads(slot)) {
            portFor(slot).sendMidi(MidiNoteOn, midiNote, shiftHeld ? 1 : vel);
        }
    }
    if (drumConfig.currentPadParam) {
        portFor(slot).setParam(componentKey + ':' + drumConfig.currentPadParam, String(drumPad));
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
