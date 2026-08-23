/* Global Parameters page: the runtime flags as a scrolling list, opened with
 * Shift+Step 2 and closed with Back. Debug builds only (app/debug.ts).
 *
 * Jog scrolls the selection; knob 1 changes the selected flag's value. That
 * split is what lets the list grow past a screen without needing a knob per
 * row — the two other param pages map one knob per parameter and cannot.
 *
 * Sibling of Set Params and Clip Params in the param-page.ts layer, so one Back
 * leaves all three and a track button closes them. No `active` flag lives here:
 * being open IS `currentView === VIEW_FLAGS` — see the note in main-page.ts for
 * what a second hand-synced copy of that fact costs. */

import { appState, VIEW_FLAGS } from '../app/state.js';
import { FLAGS } from './flags-def.js';
import { flagValue, setFlag } from './flags.js';
import { countDetents } from './detent.js';

/** The knob that edits the selected flag. The others are blank on this page. */
export const FLAG_KNOB = 0;

export const flagsPageState = {
    selected: 0,        // index into FLAGS
};

const accum = [0];

export function flagsPageActive(): boolean {
    return appState.currentView === VIEW_FLAGS;
}

/** Drop the transient gesture state; the view switch belongs to param-page.ts.
 *  The selection is NOT reset — coming back to the page you were just on should
 *  land where you left it, the way a knob page keeps its bank. */
export function clearFlagsPage(): void {
    accum[0] = 0;
}

/** Jog: move the selection. Clamped rather than wrapped, so the ends of a list
 *  that will grow stay findable by feel. */
export function flagsPageJog(delta: number): void {
    const next = Math.max(0, Math.min(FLAGS.length - 1, flagsPageState.selected + delta));
    if (next === flagsPageState.selected) return;
    flagsPageState.selected = next;
    accum[0] = 0;   // a detent half-turned on the previous flag is not this one's
}

/** Knob 1: change the selected flag. Other knobs are inert — the page draws
 *  nothing under them, and a value that moved from a knob with no label on it
 *  would be a change nobody could attribute. */
export function flagsPageKnob(k: number, delta: number): void {
    if (k !== FLAG_KNOB) return;
    const n = countDetents(accum, 0, delta);
    if (n === 0) return;
    const def = FLAGS[flagsPageState.selected];
    if (!def) return;
    setFlag(def.key, flagValue(def.key) + n);
}

export function resetFlagsPage(): void {
    flagsPageState.selected = 0;
    clearFlagsPage();
}
