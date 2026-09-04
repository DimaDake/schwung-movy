/* The drum grid's geometry, in one place.
 *
 * Four callers need to know what a physical pad means on a drum track: live
 * input (drum-handler), the pad LEDs (keyboard/leds + app/tick), the map the
 * ENGINE answers pads from (track/pad-route) and the pad a freshly loaded
 * module starts focused on (model/hierarchy). Each worked it out for itself,
 * and the engine's copy was the MELODIC map — so one press on a movy drum track
 * sounded two voices: the drum note from the UI and a chromatic note from the
 * audio thread (kick pad, kick + cowbell).
 *
 * Two shapes exist. `rawMidi` modules take the pad note itself (the whole 8x4
 * grid, one note per pad); the rest expose a 4-wide rack in the grid's left
 * half, numbered bottom-left upwards, and play `padNoteStart + pad - 1`. */

import type { DrumConfig } from '../types/param.js';

/** Rack width for a non-`rawMidi` module: the grid's left half. */
export const DRUM_COLS = 4;

/** 1-based drum pad this physical pad addresses, or -1 for a pad that addresses
 *  none — a right-half column, or one past the module's pad count. */
export function drumPadOfPhys(physPad: number, padMin: number, cfg: DrumConfig): number {
    let pad: number;
    if (cfg.rawMidi) {
        pad = physPad - cfg.padNoteStart + 1;
    } else {
        const idx = physPad - padMin;
        const col = idx % 8;
        if (col >= DRUM_COLS) return -1;
        pad = Math.floor(idx / 8) * DRUM_COLS + col + 1;
    }
    return pad >= 1 && pad <= cfg.padCount ? pad : -1;
}

/** MIDI note a 1-based drum pad plays.
 *
 * THE DECLARED LIST WINS. A module that states its own voices (schwung #411)
 * may space their notes however it likes — voice-poc uses 36, 38, 42, 60..63 —
 * and the arithmetic below can only describe a contiguous run. Falling through
 * to it for a declared rack would send most of its pads to the wrong voice, so
 * `padNotes` is consulted first and answers on its own. */
export function drumNoteOfPad(pad: number, cfg: DrumConfig): number {
    const declared = cfg.padNotes;
    if (declared && pad >= 1 && pad <= declared.length) {
        const n = declared[pad - 1];
        if (Number.isFinite(n)) return n;
    }
    return cfg.padNoteStart + pad - 1;
}

/** MIDI note this physical pad plays, or -1 when it plays nothing. */
export function drumNoteOfPhys(physPad: number, padMin: number, cfg: DrumConfig): number {
    const pad = drumPadOfPhys(physPad, padMin, cfg);
    return pad < 0 ? -1 : drumNoteOfPad(pad, cfg);
}

/** Physical pad a 1-based drum pad sits on — the inverse of `drumPadOfPhys`,
 *  and what lets the focused pad be stated as a rack position and drawn as a
 *  grid LED without either side re-deriving the other's mapping. */
export function physPadOfDrumPad(pad: number, padMin: number, cfg: DrumConfig): number {
    if (cfg.rawMidi) return drumNoteOfPad(pad, cfg);
    return padMin + Math.floor((pad - 1) / DRUM_COLS) * 8 + ((pad - 1) % DRUM_COLS);
}

/** True while Shift makes the drum pads a SELECTOR rather than an instrument.
 *  Whether the selected pad also sounds is the module's call
 *  (`shiftSelectMidi`) and stays with the UI — the point here is only that the
 *  UI, not the engine, must answer the press, because the engine cannot see a
 *  held button. */
export function drumShiftSelect(shiftHeld: boolean, cfg: DrumConfig | null): boolean {
    return shiftHeld && cfg !== null;
}
