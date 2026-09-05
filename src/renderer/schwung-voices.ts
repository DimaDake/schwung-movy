/* schwung-voices.ts — the module's own answer to "is this a drum rack?".
 *
 * movy has always answered from a private table: `movy_config.json`, fourteen
 * bundled configs and a four-module override list, with
 * `padScoping.concreteKeyTemplate` a verbatim re-spelling of the contract's own
 * `child_key_template`. Schwung #411 lets a module DECLARE the same facts, so
 * this reads them instead of movy guessing — and a module movy has never heard
 * of gets a drum layout on its own say-so.
 *
 * ABSENT IS A THIRD STATE, and it is the common one. All 100 captured fleet
 * modules declare nothing, and answering "chromatic" for them would put words
 * in their mouth — it would make "declared melodic" indistinguishable from
 * "never asked". `padLayout()` returns null there and every caller must fall
 * back to whatever movy did before, which is why nothing here throws or
 * defaults.
 *
 * THE NOTES ARE NOT CONTIGUOUS, and that is the whole reason this is a MAP
 * rather than a DrumConfig. movy's config shape says `padNoteStart` plus
 * `padCount` and derives every pad note by addition. voice-poc, the reference
 * module, declares 36, 38, 42, 60, 61, 62, 63 — three named drums and a
 * four-child level. Translated into start+count that reads as seven pads from
 * 36, so five of the seven would address the wrong voice and two would address
 * nothing. So the pad->note relation is carried as the module stated it.
 */
// @ts-ignore — absolute device path; external in the device build, aliased locally
import { padLayoutOf, focusParamOf, voicesOf, voiceIndexFromNote } from '/data/UserData/schwung/shared/param_pages/voices.mjs';

export interface Voice {
    index: number;
    level: string;
    childIndex: number | null;
    name: string;
    note: number;
    role: string | null;
}

export interface VoiceSurface {
    /** 'drums' | 'chromatic' | null — null means the module has not said. */
    layout: string | null;
    /** Ordered voices. Empty when the module declares none. */
    voices: Voice[];
    /** The param holding the focused voice, or null. */
    focusParam: string | null;
}

const EMPTY: VoiceSurface = { layout: null, voices: [], focusParam: null };

/** Read a module's declared performance surface. Never throws: a malformed
 *  contract is "has not said", the same as no contract at all. */
export function surfaceOf(hierarchy: any): VoiceSurface {
    if (!hierarchy) return EMPTY;
    try {
        return {
            layout: padLayoutOf(hierarchy) ?? null,
            voices: voicesOf(hierarchy) || [],
            focusParam: focusParamOf(hierarchy) ?? null,
        };
    } catch (_e) {
        return EMPTY;
    }
}

/** Has this module said it is a drum rack? Only a declaration counts. */
export function isDrumRack(s: VoiceSurface): boolean {
    return s.layout === 'drums' && s.voices.length > 0;
}

/** How many pads the rack has — the voice count, not a range. */
export function padCount(s: VoiceSurface): number { return s.voices.length; }

/** The note pad `i` plays, or null. Read from the declaration, never derived
 *  by adding an index to a start note. */
export function noteForPad(s: VoiceSurface, i: number): number | null {
    const v = s.voices[i];
    return v && Number.isFinite(v.note) ? v.note : null;
}

/** Which pad a note addresses, or null. */
export function padForNote(s: VoiceSurface, note: number): number | null {
    const i = voiceIndexFromNote(s.voices, note);
    return typeof i === 'number' ? i : null;
}

/** What the pad is called, for movy's own labels. */
export function labelForPad(s: VoiceSurface, i: number): string | null {
    const v = s.voices[i];
    return v && v.name ? v.name : null;
}
