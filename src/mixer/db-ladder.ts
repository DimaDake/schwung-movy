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
 * thing nobody reports and everybody notices.
 *
 * The two walk it at different RATES, which is deliberate. The gesture is a
 * coarse fader on the master encoder: one detent, one dB. The MIX page is eight
 * knobs on a param page and has to feel like the param pages either side of it,
 * so it steps continuously (`stepAmpDb`). Same curve, same landmarks, same
 * value — only the granularity differs. */

import { CONTINUOUS_TICK_FRAC } from '../model/constants.js';

export const VOL_MIN = 0;
export const VOL_MAX = 4;
const DB_MIN  = -48;   // quietest audible position; one step below it is silence
const DB_STEP = 1;
const DB_MAX  = 20 * Math.log10(VOL_MAX);
/** The fader's ceiling, in dB: VOL_MAX, i.e. 12 dB of headroom above unity. */
export const VOL_TOP_DB = DB_MAX;
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

/* ── Where a level sits, and how far one CC unit moves it ─────────────────
 *
 * A control's travel is a dB SPAN, from the floor up to whatever that control's
 * maximum is: the fader keeps 12 dB of headroom above unity, a send stops at
 * unity. Both are drawn and stepped against their own span, which is why
 * `topDb` is a parameter rather than a constant — a send normalized against the
 * fader's span drew four fifths of an arc at its maximum and read as stuck. */

/** Position on a control's travel, 0..1 — the fill, and the unity mark on it. */
export function dbFrac(amp: number, topDb: number): number {
    if (amp <= 0) return 0;
    const db = 20 * Math.log10(amp);
    return Math.min(1, Math.max(0, (db - DB_MIN) / (topDb - DB_MIN)));
}

/** A send's ceiling, in dB: unity. */
export const SEND_TOP_DB = 0;

/** The inverse of `dbFrac`: a position on the travel back to an amplitude.
 *  Position 0 is silence, which is where the floor and everything under it
 *  land — the two are one CC unit apart and a lane has no value between them. */
export function fracToAmp(frac: number, topDb: number): number {
    if (frac <= 0) return 0;
    const db = DB_MIN + Math.min(1, frac) * (topDb - DB_MIN);
    return Math.min(VOL_MAX, Math.pow(10, db / 20));
}

export const volumeFrac = (amp: number): number => dbFrac(amp, DB_MAX);
/** A send's own travel: silence to unity, so 0 dB is the far end of the arc. */
export const sendFrac = (amp: number): number => dbFrac(amp, SEND_TOP_DB);
export const UNITY_FRAC = volumeFrac(1);
/** Ladder index → the same travel, for the slider the volume gesture draws. */
export function idxToFrac(i: number): number { return volumeFrac(idxToAmp(i)); }

/* The MIX page walks the ladder CONTINUOUSLY, at a module knob's own rate.
 *
 * Stepping index by index made a knob turn arrive in whole-dB jumps — a small
 * turn did nothing, then the level leapt a dB — which is what was reported as
 * "too sensitive". One CC unit now moves a mixer control by the same fraction
 * of its travel that `perDetentStep` moves a module knob (MIN_STEP_RANGE_FRAC ×
 * ARC_DELTA_SCALE), so the whole page feels like the pages either side of it.
 *
 * The result is snapped to a whole number of steps, so the landmarks stay
 * reachable: a level restored off-grid — from a set file, or from an automation
 * write — would otherwise carry its offset through every turn and 0.0 dB would
 * never come back, which is the bug pan had at its centre. Snapping to the STEP
 * rather than to the readout's 0.1 dB is what makes the travel exact: rounding
 * a 0.24 dB step to a tenth threw the remainder away on every tick and a send
 * took 240 of them to cross a 200-tick range. */

/** Amplitude after `ticks` CC units, on a control whose travel tops out at
 *  `topDb`. Below the floor is silence, and the floor itself is a stop on the
 *  way there — a fader that skips from -47.9 dB to -INF has no bottom end. */
export function stepAmpDb(amp: number, ticks: number, topDb: number): number {
    if (ticks === 0) return amp;
    const floorAmp = idxToAmp(1);
    if (amp <= 0) return ticks > 0 ? floorAmp : 0;
    const step = (topDb - DB_MIN) * CONTINUOUS_TICK_FRAC;
    const db = 20 * Math.log10(amp);
    const next = Math.round((db + step * ticks) / step) * step;
    if (next < DB_MIN) return db > DB_MIN ? floorAmp : 0;
    if (next >= topDb) return Math.min(VOL_MAX, Math.pow(10, topDb / 20));
    return Math.pow(10, next / 20);
}
