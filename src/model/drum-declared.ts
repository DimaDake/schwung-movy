/* drum-declared.ts — the module's own drum rack, merged with movy's table.
 *
 * movy has always answered "is this drums, and what does each pad play?" from
 * `movy_config.json` — fourteen bundled configs plus a four-module override
 * list, which exist precisely because a module had no way to say. Schwung #411
 * gives it one, so a rack movy has never heard of can seat itself.
 *
 * A CONFIG ALWAYS WINS (plan 2026-09-30-drum-modules-schwung-pages.md, D4 as
 * revised 2026-10-03, the user's ruling): movy's bundled override, then a
 * module-shipped movy_config, then the module's declared drum surface. The
 * simpler rule to follow and to explain; the first version (declaration over
 * config) was tried and superseded. The config is a frozen legacy reader —
 * future modules are expected to declare, and those reach the declared branch.
 *
 * PURE, AND FREE OF SCHWUNG. It takes the surface as plain data, so `model/`
 * keeps its rule of importing nothing from `renderer/` and this stays testable
 * without a schwung checkout. Reading the contract is renderer/schwung-voices;
 * deciding what movy does with it is here.
 */
import type { DrumConfig } from '../types/param.js';
import { drumNoteOfPad } from '../keyboard/drum-grid.js';

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
    voices: { note: number; name: string; level: string }[];
    focusParam: string | null;
    /* The live-press param, carried past `effectiveDrumConfig` rather than INTO
     * it: `focus_press_param` is a hierarchy ROOT field, so a module need not
     * declare a drum layout to want to be told a finger did that. Folding it
     * into DrumConfig would silently skip every melodic module that declares
     * one. See ModelState.pressParam. */
    pressParam: string | null;
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
    config: DrumConfig | null,
): DrumConfig | null {
    /* D4: the config decides the whole drum setup — pads, notes, scoping, the
     * focus write. Nothing is merged in from the declaration: a half-and-half
     * rack is two sources disagreeing in one object. */
    if (config) return config;
    if (!declared || declared.layout !== 'drums' || !declared.voices.length) return null;

    const padNotes = declared.voices.map((v) => v.note);
    return {
        padCount: padNotes.length,
        /* Kept meaningful for the rawMidi path and for anything still reading
         * it, but NOT what pad notes are derived from — see padNotes. */
        padNoteStart: padNotes[0],
        rawMidi: false,
        padNotes,
        /* The module names the param holding its focused voice. */
        ...(declared.focusParam ? { currentPadParam: declared.focusParam } : {}),
        /* WHAT to write into it, which the two sources spell differently.
         *
         * A hand-written `currentPadParam` (a config's) is the template
         * shape's instance number, so movy writes the pad number. A declared
         * `focus_param` is the SIBLING shape, and its value is a LEVEL NAME —
         * "snare", never "2". movy wrote the pad number into both, so every
         * declared rack was told to focus a voice called "1", which is not a
         * level and which the module can only ignore. Carried per pad because
         * the levels are the module's own names in its own order. */
        ...(declared.focusParam
            ? { padFocusValues: declared.voices.map((v) => v.level) }
            : {}),
    };
}

/**
 * The declared voice each of the rack's pads plays, matched by NOTE — or null
 * for a pad no voice declares.
 *
 * By note, not by position, because a config that wins (D4) may number the
 * same voices differently: 9w9 declares 36..44, 46, 45 and movy's bundled
 * config plays 36 + i, so by position pad 10 would sound one voice while its
 * name, its page and its copied keys belonged to the other.
 */
export function padVoices<V extends { note: number }>(cfg: DrumConfig, voices: readonly V[]): (V | null)[] {
    const out: (V | null)[] = [];
    for (let pad = 1; pad <= cfg.padCount; pad++) {
        const note = drumNoteOfPad(pad, cfg);
        out.push(voices.find((v) => v.note === note) ?? null);
    }
    return out;
}
