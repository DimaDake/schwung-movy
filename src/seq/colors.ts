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
export const C_GREEN = 11;     // NeonGreen — playhead

/* Bright = playing/selected clip & chromatic root; dim = empty in-loop step. */
export const TRACK_COLOR = [127, 7, 14, 22];      // Red, VividYellow, Cyan, Purple
export const TRACK_COLOR_DIM = [67, 74, 90, 105]; // Brick, VeryDarkYellow, DeepTeal, MutedViolet

export function trackColor(track: number): number {
    return TRACK_COLOR[track & 3];
}

export function trackColorDim(track: number): number {
    return TRACK_COLOR_DIM[track & 3];
}

/* White-LED brightness levels (Back/arrows/etc. are not RGB). */
export const WHITE_OFF = 0;
export const WHITE_DIM = 16;
export const WHITE_BRIGHT = 124;
