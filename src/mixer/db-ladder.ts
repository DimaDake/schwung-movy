/* The fader ladder, shared by the hold-track+volume gesture and the MIX page.
 *
 * schwung stores a level as a linear amplitude, 0-4 with 1.0 = unity, and movy's
 * own mixer uses the same scale. A fixed linear step is unusable as a fader:
 * 0.05 is 0.1 dB near the top of the range and 6 dB from 0.10 to 0.05, so the
 * quiet half of the travel — the half a mixer is actually used in — is five
 * detents wide and the last one drops straight to silence. Reported from the
 * field as "it's adjustable down to about -8.5 dB, then completely cuts off the
 * sound".
 *
 * So a gesture walks a dB ladder instead and converts on write: one detent is
 * one dB anywhere in the range. Index 0 is true silence, index 1 is DB_MIN, and
 * unity lands exactly on index 49 — the same value the encoder can always
 * return to.
 *
 * It lives here rather than inside the gesture because the MIX page's VOL and
 * send knobs walk the same ladder. Two copies would drift, and a fader that
 * feels different depending on which control you reached for is the kind of
 * thing nobody reports and everybody notices. */

export const VOL_MIN = 0;
export const VOL_MAX = 4;
const DB_MIN  = -48;   // quietest audible position; one step below it is silence
const DB_STEP = 1;
const DB_MAX  = 20 * Math.log10(VOL_MAX);
export const VOL_STEPS = Math.ceil((DB_MAX - DB_MIN) / DB_STEP) + 1;

export function idxToAmp(i: number): number {
    if (i <= 0) return VOL_MIN;
    const db = DB_MIN + (Math.min(i, VOL_STEPS) - 1) * DB_STEP;
    return Math.min(VOL_MAX, Math.pow(10, db / 20));
}

export function ampToIdx(a: number): number {
    if (a <= VOL_MIN) return 0;
    const db = 20 * Math.log10(a);
    if (db <= DB_MIN) return 1;
    return Math.min(VOL_STEPS, Math.round((db - DB_MIN) / DB_STEP) + 1);
}

/* Position on the ladder, 0..1 — the slider fill and its unity mark, so the
 * drawn travel matches what the knob does. */
export function idxToFrac(i: number): number { return Math.min(1, Math.max(0, i / VOL_STEPS)); }
export function volumeFrac(amp: number): number { return idxToFrac(ampToIdx(amp)); }
export const UNITY_FRAC = volumeFrac(1);
