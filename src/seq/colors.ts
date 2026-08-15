/* Move pad/step LED palette indices. These are fixed hardware-table values
 * (schwung/src/shared/constants.mjs), hardcoded here so seq modules don't
 * depend on injected globals and run unchanged in browser tests.
 *
 * The 4 track colors and their dim variants are a best-effort match to
 * native Move pending an LED sniff; the bright/dim pairing is what matters
 * for the step-LED semantics (manual §9.5). */

export const C_BLACK = 0;
export const C_WHITE = 120;
export const C_DARKGREY = 124; // "dim gray" — empty clip / bar outside loop
export const C_LIGHTGREY = 118; // schwung LightGrey ("dim white"): note-length tail — brighter than C_DARKGREY, distinct from colored track-dim
export const C_GREEN = 11;     // NeonGreen — playhead
export const C_REC_RED = 127;  // Red — recording indicator (same as track 0 color; index 1 renders pink)

/* Track colours: 4 groups of 4. Bright = playing/selected clip & chromatic
 * root; dim = empty in-loop step, and the unfocused tracks in the Session
 * view's step-row selector.
 *
 * Every row (one group's 4 tracks) and every column (the same track index
 * across groups) is pairwise distinct under normal vision AND both common
 * red-green deficiencies, judged with lightness de-weighted — at LED size a
 * pale blue and a royal blue read alike however far apart CIELAB puts them.
 * No two members of one hue family share a row or column, with blue and violet
 * counted as ONE family (CIELAB puts pure blue at 306° and electric violet at
 * 311°, which is exactly why they look the same on this hardware).
 *
 * `browser-test/track-colors.mjs` holds all of that, and also checks these
 * indices still mean what they mean in schwung's own palette — the table here
 * is a copy, and a copy can drift.
 *
 * Group 1 keeps Move's native track colours. */
export const TRACK_COLOR = [
    127, 7, 25, 125,      // G1 host: Red, Vivid Yellow, Bright Pink, Pure Blue
    15, 3, 44, 21,        // G2: Azure Blue, Bright Orange, Mint Green, Hot Magenta
    14, 23, 6, 9,         // G3: Cyan, Neon Pink, Ochre, Forest Green
    12, 47, 27, 5,        // G4: Teal Green, Sky Blue, Rust Red, Light Yellow
];
export const TRACK_COLOR_DIM = [
    67, 77, 113, 99,      // Brick, Olive, Mauve, Indigo
    93, 75, 89, 105,      // Deep Blue, Brown-Yellow, Muted Sea Green, Muted Violet
    89, 109, 75, 81,      // Muted Sea Green, Deep Magenta, Brown-Yellow, Dull Olive
    87, 17, 67, 77,       // Dark Teal, Navy, Brick, Olive
];

export function trackColor(track: number): number {
    return TRACK_COLOR[track & 15];
}

export function trackColorDim(track: number): number {
    return TRACK_COLOR_DIM[track & 15];
}

/* Native Move LED animation channels (Push-2 model: the note-on's MIDI channel
 * selects the hardware animation — schwung/src/shared/constants.mjs:633). The
 * channel is OR-ed into the 0x90 status byte; the firmware does the smooth
 * gradient, so we no longer toggle colors in JS. */
export const ANIM_NONE = 0x00;       // solid, no animation
export const ANIM_PULSE_FAST = 0x08; // Pulse8th — queued-to-launch (urgent)
export const ANIM_PULSE = 0x09;      // Pulse4th — playing clip
export const ANIM_PULSE_SLOW = 0x0A; // Pulse2th — selected clip (focus marker)

/* White-LED brightness levels (Back/arrows/etc. are not RGB). */
export const WHITE_OFF = 0;
export const WHITE_DIM = 16;
export const WHITE_BRIGHT = 124;
