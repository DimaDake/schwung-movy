/* voice-keys.ts — which of a drum module's keys belong to which pad (plan D16).
 *
 * On a drum track Move's step paste copies only the SELECTED voice: its notes,
 * and — through Schwung's `lane_voice_map.mjs` — only the automation on that
 * voice's own parameters. movy's engine owns the clipboard and knows lanes, not
 * keys, so the UI turns "pad 3's keys" into a lane mask at the copy.
 *
 * THE MAP IS SCHWUNG'S, NOT A SECOND COPY. Built by `laneVoiceMap` from the
 * module's declaration, pushed in at start-up (`app/globals.ts`) for the reason
 * `child-keys.ts` gives: `model/` imports nothing from `renderer/`. Its wire
 * form — "<note>:<key>,<key>;..." — is the one the chain parses. "" means NOT A
 * RACK, and a key two voices list (dr32's `ui_current_pad`) is nobody's: such a
 * key is the track's, and a voice paste leaves it alone.
 *
 * Indexed by PAD, through the declared voice list: movy's pad i is declared
 * voice i (`focusVoice`), and a bundled config may give that pad a different
 * NOTE than the declaration does (6w6), so the note is only the map's key.
 */

type MapReader = (hierarchy: any) => string;
let reader: MapReader | null = null;

export function setVoiceMapReader(fn: MapReader | null): void { reader = fn; }

/** Per declared voice, in pad order, the keys only that voice owns. Empty when
 *  the module is not a declared rack or nothing can read the map. */
export function voiceKeysOf(hierarchy: any, voices: readonly { note: number }[]): string[][] {
    if (!reader || !hierarchy || !voices.length) return [];
    let wire = '';
    try { wire = reader(hierarchy) || ''; } catch (_e) { return []; }
    if (!wire) return [];
    const byNote = new Map<number, string[]>();
    for (const part of wire.split(';')) {
        const c = part.indexOf(':');
        if (c > 0) byNote.set(Number(part.slice(0, c)), part.slice(c + 1).split(','));
    }
    return voices.map((v) => byNote.get(v.note) ?? []);
}
