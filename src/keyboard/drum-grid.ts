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
 * grid, one note per pad); the rest expose a rack numbered bottom-left
 * upwards, and play `padNoteStart + pad - 1`. */

import type { DrumConfig } from '../types/param.js';

/** Rack width for a non-`rawMidi` module: the grid's left half — or, for a
 *  rack of more than 16 pads, both halves, which is 32 pads (plan
 *  2026-09-30-drum-modules-schwung-pages.md, D10). Generic: dr32 is the rack
 *  that has them, not a case here. The right half has no drum function today;
 *  one added later gets an on/off switch that overlays this.
 *
 *  The rack is laid out as 4x4 banks, NOT as 8-wide rows: pads 1-16 fill the
 *  left half exactly as on a 16-pad module, and 17-32 then fill the right half
 *  the same way — so a 32-pad kit's first 16 voices sit where every other drum
 *  module puts them. */
export function drumCols(cfg: DrumConfig): number {
    return !cfg.rawMidi && cfg.padCount > 16 ? 8 : 4;
}

/** 1-based drum pad this physical pad addresses, or -1 for a pad that addresses
 *  none — a column past the rack's width, or one past the module's pad count. */
export function drumPadOfPhys(physPad: number, padMin: number, cfg: DrumConfig): number {
    let pad: number;
    if (cfg.rawMidi) {
        pad = physPad - cfg.padNoteStart + 1;
    } else {
        const idx = physPad - padMin;
        const col = idx % 8;
        if (col >= drumCols(cfg)) return -1;
        pad = Math.floor(col / 4) * 16 + Math.floor(idx / 8) * 4 + (col % 4) + 1;
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

/** The rack pad a note belongs to, or -1. The inverse of `drumNoteOfPad`, for
 *  naming a voice from the note the ENGINE keys on — a pad mute is stored per
 *  note, and the toast has to say which voice that is. */
export function drumPadOfNote(note: number, cfg: DrumConfig): number {
    for (let pad = 1; pad <= cfg.padCount; pad++) {
        if (drumNoteOfPad(pad, cfg) === note) return pad;
    }
    return -1;
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
    const i = pad - 1;
    return padMin + Math.floor((i % 16) / 4) * 8 + Math.floor(i / 16) * 4 + (i % 4);
}

/** True while Shift makes the drum pads a SELECTOR rather than an instrument.
 *  Whether the selected pad also sounds is the module's call
 *  (`shiftSelectMidi`) and stays with the UI — the point here is only that the
 *  UI, not the engine, must answer the press, because the engine cannot see a
 *  held button. */
export function drumShiftSelect(shiftHeld: boolean, cfg: DrumConfig | null): boolean {
    return shiftHeld && cfg !== null;
}
