/* The bottom jog hint ("CLICK JOG: …") is a hold gesture, like hold-a-knob →
 * LFO assign: it appears only after HOLD_MS of a finger resting on the jog
 * without turning it. Someone who grabs the jog to scroll never sees it flash;
 * someone who pauses, unsure what the jog does here, gets told. A turn (or
 * release, or leaving the view) clears it until the next touch. */

import { HOLD_MS } from '../model/constants.js';

const state = { pressMs: 0, shown: false };

/* Arm on touch; clear on release / turn / view change. Returns true when a
 * visible hint was cleared — the caller has to repaint without it. */
export function jogHintTouch(down: boolean): boolean {
    const was = state.shown;
    state.pressMs = down ? Date.now() : 0;
    state.shown   = false;
    return was;
}

/* Promote a HOLD_MS touch-without-turn to a visible hint. True on activation. */
export function jogHintTick(): boolean {
    if (state.shown || !state.pressMs) return false;
    if (Date.now() - state.pressMs < HOLD_MS) return false;
    state.shown = true;
    return true;
}

export function jogHintVisible(): boolean { return state.shown; }
