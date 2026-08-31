/* Settings page: the runtime flags as a scrolling list, opened with Shift+Step 2
 * and closed with Back.
 *
 * A release build lists only the settings marked `release` (flags-visible.ts);
 * a debug build lists every flag, which is what the page was originally for.
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
import { clampFlag } from './flags-def.js';
import { visibleFlags } from './flags-visible.js';
import { flagValue, setFlag } from './flags.js';
import { setHostMode, setSetHost } from '../track/host-mode.js';
import { countDetents } from './detent.js';

/** The knob that edits the selected flag. The others are blank on this page. */
export const FLAG_KNOB = 0;

export const flagsPageState = {
    selected: 0,        // index into visibleFlags(), not the raw table
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
    const next = Math.max(0, Math.min(visibleFlags().length - 1, flagsPageState.selected + delta));
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
    /* The VISIBLE list: the page draws it, so it is also what the selection
     * indexes. Reading the raw table here would edit a flag the user cannot
     * see — and a different one than the row they are looking at. */
    const def = visibleFlags()[flagsPageState.selected];
    if (!def) return;
    const next = clampFlag(def, flagValue(def.key) + n);
    /* Not a plain setFlag: changing a track's host has to release what is
     * sounding on it FIRST, while its port still resolves to the host that
     * played it. `host-mode.ts` owns that order. */
    if (def.key === 'chtracks') { setHostMode(next); return; }
    if (def.key === 'chtrackset') { setSetHost(next); return; }
    setFlag(def.key, next);
}

export function resetFlagsPage(): void {
    flagsPageState.selected = 0;
    clearFlagsPage();
}
