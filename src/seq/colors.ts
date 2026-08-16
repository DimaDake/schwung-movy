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
export const C_REC_RED = 127;  // Red — recording indicator (index 1 renders pink)

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
 * A track colour ALSO paints the chromatic root pad, whose neighbours are the
 * grey in-scale pads (C_LIGHTGREY) and white held pads. Two classes of colour
 * are barred outright because on this hardware they read as white there no
 * matter what CIELAB says — measured on device, not derived:
 *   - cool hues (LAB 145°–310°) above L 45. Azure Blue sits 80 from white by
 *     the numbers and was still indistinguishable from a lit in-scale pad.
 *   - pastels (L > 65 with chroma under 0.7·L), whatever their hue.
 * That is why no cyan / mint / teal / sky / azure appears below.
 *
 * `browser-test/track-colors.mjs` holds all of that, and also checks these
 * indices still mean what they mean in schwung's own palette — the table here
 * is a copy, and a copy can drift. */
export const TRACK_COLOR = [
    3, 27, 23, 20,        // G1: Bright Orange, Rust Red, Neon Pink, Electric Violet
    26, 16, 5, 10,        // G2: Light Magenta, Royal Blue, Light Yellow, Dull Green
    125, 7, 28, 21,       // G3: Pure Blue, Vivid Yellow, Burnt Orange, Hot Magenta
    85, 25, 18, 6,        // G4: Dark Grass Green, Bright Pink, Blue-Violet, Ochre
];
/* Each dim shares its bright partner's hue family and is clearly darker, so a
 * dim step still says which track it belongs to. All 16 are distinct: the
 * Session step row shows every track at once, the unfocused ones dimmed. */
export const TRACK_COLOR_DIM = [
    65, 111, 105, 99,     // Deep Red, Dusty Rose, Muted Violet, Indigo
    19, 95, 78, 77,       // Violet, Dark Blue, Dark Olive, Olive
    107, 83, 75, 22,      // Dark Purple, Dark Olive Green, Brown-Yellow, Purple
    87, 35, 17, 73,       // Dark Teal, Mauve, Navy, Dull Yellow
];

/* A third, darker tier for the ONE place that shows twelve dim colours at once:
 * the Session view's track selector. Everywhere else `dim` is either a single
 * track's colour (the watched track's empty in-loop steps, where it marks the
 * loop window and must stay legible) or four muted track buttons.
 *
 * It is not a uniform step down. The dim tier's real problem here was spread,
 * not level — it ranged L 9 to L 33, and a row reads as bright as its brightest
 * members. So each entry is capped at its dim partner's lightness: the ten that
 * already sat low are unchanged, and the six outliers come down to meet them.
 * Mean lightness 21.3 → 15.7, spread 8.3 → 4.6. */
export const TRACK_COLOR_DIMMER = [
    65, 111, 105, 99,     // Deep Red, Dusty Rose, Muted Violet, Indigo
    115, 95, 80, 81,      // Dusky Mauve, Dark Blue, Very Dark Green, Dull Olive
    107, 83, 75, 109,     // Dark Purple, Dark Olive Green, Brown-Yellow, Deep Magenta
    87, 113, 93, 78,      // Dark Teal, Mauve, Deep Blue, Dark Olive
];

export function trackColor(track: number): number {
    return TRACK_COLOR[track & 15];
}

export function trackColorDim(track: number): number {
    return TRACK_COLOR_DIM[track & 15];
}

export function trackColorDimmer(track: number): number {
    return TRACK_COLOR_DIMMER[track & 15];
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
