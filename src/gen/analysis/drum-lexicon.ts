/* What a drum voice is called, read as the part it plays.
 *
 * ONE VOCABULARY for every kind of text a rack offers about a pad: a declared
 * role (schwung's free-form `role` / `child_roles`: "kick", "hihat_open"), a
 * declared name ("HH Cl", "Kick 707", "Bass-drum"), and what the pad holds
 * right now (a sample's file name "KCK_01.wav", an enum label "Snare 2",
 * Forge's algorithm "Hat"). No module is named here: a rack movy has never
 * seen is read by the same words.
 *
 * Abbreviations count only as a whole word ("SD", "OH"); long words also
 * inside a run-together one ("hihatopen", "bassdrum"), so no two letters of a
 * longer name can pass for a voice.
 *
 * `rank` orders pads that share a role, 0 = the instrument itself: a kit's
 * snare comes before its clap, a closed hat before a shaker. */

import type { PadRole } from './kit.js';

export interface RoleHit { role: PadRole; rank: number }

/** The rank a bare membrane ("Drum") gets until the kit says which is the kick. */
export const MEMBRANE = 9;

/* [role, rank, whole words, words also matched inside a word]. First match
 * wins, so the order is the precedence: OPEN before HAT ("Open Hat"), hats
 * before CL ("HH Cl" is a closed hat, a lone "CL" a clave). */
const RULES: [PadRole, number, string[], string[]][] = [
    ['open', 0, ['OH', 'OHH', 'HHO', 'OPEN', 'OPN'], ['OPENHAT', 'OPENHH', 'HIHATOPEN', 'HATOPEN', 'HHOPEN']],
    ['hat', 1, ['PHH', 'PEDAL'], ['PEDALHAT', 'PEDALHH', 'FOOTHAT']],
    ['hat', 0, ['HH', 'CH', 'CHH', 'HHC', 'HAT', 'HATS', 'CLOSED'], ['HIHAT', 'CLOSEDHAT', 'CLOSEDHH', 'HHCLOSED']],
    ['kick', 0, ['BD', 'KD', 'KCK', 'KIK'], ['KICK', 'BASSDRUM', 'BASSDRM']],
    ['snare', 1, ['CP', 'CLP'], ['CLAP']],
    ['perc', 1, ['RS', 'RIM', 'RIMS'], ['RIMSHOT', 'SIDESTICK']],
    ['snare', 0, ['SD', 'SN', 'SNR'], ['SNARE']],
    ['cym', 0, ['CY', 'CYM', 'CR', 'RD', 'RIDE'], ['CYMBAL', 'CRASH', 'SPLASH', 'CHINA']],
    ['tom', 0, ['LT', 'MT', 'HT', 'FT', 'TOM', 'TOMS'], ['FLOORTOM', 'LOWTOM', 'HITOM']],
    ['tom', 1, ['LC', 'MC', 'HC'], ['CONGA', 'BONGO', 'TIMBAL', 'TABLA']],
    ['hat', 2, ['TAMB'], ['SHAKER', 'MARACA', 'CABASA', 'TAMBOURINE']],
    ['perc', 0, ['CB', 'CL', 'CLV', 'BELL', 'BLOCK', 'PERC'],
        ['COWBELL', 'CLAVE', 'WOODBLOCK', 'TRIANGLE', 'AGOGO', 'GUIRO', 'PERCUSSION']],
    ['perc', 2, ['FX', 'SFX', 'NOISE', 'ZAP'], []],
];

/* A name split into words: "HHOpen_02.wav" → HH OPEN 02; "BD707" → BD 707;
 * "hihat_closed" → HIHAT CLOSED. The folder and the extension go first. */
export function tokens(text: string): string[] {
    return text.replace(/^.*[\\/]/, '').replace(/\.(wav|aiff?|flac|mp3|ogg)$/i, '')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/([A-Za-z])(\d)/g, '$1 $2')
        .replace(/(\d)([A-Za-z])/g, '$1 $2')
        .toUpperCase()
        .split(/[^A-Z0-9]+/)
        .filter(Boolean);
}

/** The part a text names, or null when it names none. A sample's path is
 *  read by its file name, then by its folder (".../Kicks/01.wav"). */
export function roleOfText(text: string | null | undefined): RoleHit | null {
    if (!text) return null;
    const dir = text.replace(/[\\/][^\\/]*$/, '');
    return roleOfWords(tokens(text)) ?? (dir !== text ? roleOfWords(tokens(dir)) : null);
}

function roleOfWords(words: string[]): RoleHit | null {
    for (const [role, rank, whole, inner] of RULES) {
        if (words.some((w) => whole.includes(w) || inner.some((s) => w.includes(s)))) return { role, rank };
    }
    /* "Bass Drum" written apart is a kick; a lone "Drum" (Forge's membrane
     * algorithm) is a kick or a tom, and only the kit can say which. */
    if (words.includes('DRUM')) return { role: words.includes('BASS') ? 'kick' : 'tom', rank: words.includes('BASS') ? 0 : MEMBRANE };
    return null;
}
