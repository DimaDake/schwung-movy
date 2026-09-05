/* drum-declared.ts — the module's own drum rack, merged with movy's table.
 *
 * movy has always answered "is this drums, and what does each pad play?" from
 * `movy_config.json` — fourteen bundled configs plus a four-module override
 * list, which exist precisely because a module had no way to say. Schwung #411
 * gives it one, so a rack movy has never heard of can seat itself.
 *
 * DECLARATION WINS, THE TABLE IS THE FALLBACK. A module that has said nothing
 * is the common case — all 100 captured fleet modules — and it must keep
 * behaving exactly as it did, so this returns the override untouched there.
 * Where both exist the module is believed: the table was only ever movy's
 * guess at what the module now states outright.
 *
 * PURE, AND FREE OF SCHWUNG. It takes the surface as plain data, so `model/`
 * keeps its rule of importing nothing from `renderer/` and this stays testable
 * without a schwung checkout. Reading the contract is renderer/schwung-voices;
 * deciding what movy does with it is here.
 */
import type { DrumConfig } from '../types/param.js';

/*
 * THE READER IS PUSHED IN, NOT IMPORTED.
 *
 * Reading the contract needs Schwung's voices.mjs, and `model/` imports nothing
 * from `renderer/`. So the renderer registers its reader at start-up and the
 * model asks through this hook — the dependency points one way, and with the
 * grid switched off nobody registers, `readSurface` answers null, and every
 * module falls back to movy's table exactly as before.
 */
type SurfaceReader = (hierarchy: any) => DeclaredSurface | null;
let reader: SurfaceReader | null = null;

export function setSurfaceReader(fn: SurfaceReader | null): void { reader = fn; }

/** What the module declared, or null when nothing can read it. Never throws:
 *  a reader that fails is the same as no declaration. */
export function readSurface(hierarchy: any): DeclaredSurface | null {
    if (!reader || !hierarchy) return null;
    try { return reader(hierarchy); } catch (_e) { return null; }
}

/** The shape renderer/schwung-voices produces. Restated structurally rather
 *  than imported, to keep the layering one-way. */
export interface DeclaredSurface {
    layout: string | null;
    voices: { note: number; name: string }[];
    focusParam: string | null;
}

/**
 * The drum config movy should use for this module.
 *
 * Null when neither source describes a rack — the module said nothing and movy
 * has no entry — which is the answer for a plain synth and must stay null so
 * nothing downstream starts drawing pads for one.
 */
export function effectiveDrumConfig(
    declared: DeclaredSurface | null,
    fallback: DrumConfig | null,
): DrumConfig | null {
    if (!declared || declared.layout !== 'drums' || !declared.voices.length) return fallback;

    const padNotes = declared.voices.map((v) => v.note);
    return {
        /* Carried from the override where there is one, so a module that
         * declares its voices does not silently lose the facts movy knew and
         * the contract has no word for — pad scoping, the automatable-pad cap. */
        ...(fallback || {}),
        padCount: padNotes.length,
        /* Kept meaningful for the rawMidi path and for anything still reading
         * it, but NOT what pad notes are derived from — see padNotes. */
        padNoteStart: padNotes[0],
        rawMidi: fallback ? fallback.rawMidi : false,
        padNotes,
        /* The module names the param holding its focused voice; movy's own
         * `currentPadParam` said the same thing by hand. */
        currentPadParam: declared.focusParam || fallback?.currentPadParam,
    };
}
