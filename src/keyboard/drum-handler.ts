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
    const fw = padFocusWrite(drumConfig, drumPad);
    if (fw) portFor(slot).setParam(componentKey + ':' + fw.key, fw.value);
    return drumPad;
}

/* The module-focus write a press of `drumPad` makes, or null. Shared with the
 * SCHWUNG page, which answers the controller's focus reads from what movy
 * wrote (plan D8), so the two cannot name different values.
 *
 * A declared `focus_param` takes the voice's LEVEL NAME; a hand-written
 * `currentPadParam` takes the instance number. Same key, two spellings — see
 * DrumConfig.padFocusValues. */
export function padFocusWrite(drumConfig: DrumConfig, drumPad: number): { key: string; value: string } | null {
    if (!drumConfig.currentPadParam) return null;
    return { key: drumConfig.currentPadParam,
             value: drumConfig.padFocusValues?.[drumPad - 1] ?? String(drumPad) };
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
