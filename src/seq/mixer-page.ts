/* mixer-page.ts — the Session mixer's lifecycle: hold Session, see the faders.
 *
 * Only from a LATCHED Session view: the first press of an unlatched Session is
 * already the Session peek, and stacking a second meaning on its hold would
 * make the peek open the mixer. Opened once the press has been held
 * MIXER_HOLD_MS with nothing done under it (a step selecting a track or a pad
 * launching a clip makes it a modifier press, and it stays one); closed by the
 * release, back to Session.
 *
 * Being open IS `currentView === VIEW_MIXER`, like the param pages — no flag
 * to fall out of step with the view the tick draws. */

import { appState, VIEW_MIXER } from '../app/state.js';
import { momentaryCancel, momentaryPlainHold } from './momentary.js';
import { CC_NOTE_SESSION } from './constants.js';

/* Shorter than the momentary's 500 ms revert threshold on purpose: the mixer
 * is the thing this hold is FOR, so it should not feel like a timeout. */
export const MIXER_HOLD_MS = 300;

let armed = false;
let origin = VIEW_MIXER;

export function mixerPageActive(): boolean {
    return appState.currentView === VIEW_MIXER;
}

/** A Session press. `latched`: Session was already showing before it. */
export function mixerHoldArm(latched: boolean): void {
    armed = latched;
}

/** Per tick: open once the hold has matured. True when it opened. */
export function mixerHoldTick(nowMs: number): boolean {
    if (!armed || mixerPageActive()) return false;
    if (!momentaryPlainHold(CC_NOTE_SESSION, nowMs, MIXER_HOLD_MS)) {
        /* Released or used: this press is not a mixer press any more. A
         * premature check (not yet held long enough) leaves it armed. */
        if (!momentaryPlainHold(CC_NOTE_SESSION, nowMs, 0)) armed = false;
        return false;
    }
    armed = false;
    origin = appState.currentView;
    appState.currentView = VIEW_MIXER;
    /* The press is spent on the mixer: its release must only close it, never
     * read as a tap (Session -> Note) or run the peek's restore. */
    momentaryCancel(CC_NOTE_SESSION);
    appState.dirty = true;
    return true;
}

/** The Session release. True when it closed the mixer (the press is spent). */
export function mixerRelease(): boolean {
    armed = false;
    if (!mixerPageActive()) return false;
    appState.currentView = origin;
    appState.dirty = true;
    return true;
}

/* The meters move every block, the knobs only when turned, so the page asks
 * for its own frames — at most one per METER_FRAME_MS, the cap the canvas
 * pages already run at, and only when the engine's numbers changed. */
const METER_FRAME_MS = 33;
let lastMeter = '';
let lastMeterMs = -Infinity;

export function mixerMeterDue(nowMs: number, raw: string): boolean {
    if (!mixerPageActive() || raw === lastMeter || nowMs - lastMeterMs < METER_FRAME_MS) return false;
    lastMeter = raw;
    lastMeterMs = nowMs;
    return true;
}

export function resetMixerPage(): void {
    armed = false;
    if (mixerPageActive()) appState.currentView = origin;
}
