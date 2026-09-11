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

/* The settings list ends with rows that are not flags — BACKUPS opens the
 * versions list, MIGRATE TRACKS re-runs the schwung migration. They sit LAST so
 * they never move when the flag list changes between debug and release builds,
 * and each is an ACTION: knob 1 does nothing on it, the jog click does
 * something else entirely.
 *
 * A LIST, not a hardcoded row: the FIRST version of BACKUPS added its row to
 * the jog's clamp and to the router but not to `flags-page-vm.ts`'s drawn
 * list, so it was selectable, clickable and undrawn — every screenshot stayed
 * byte-identical because the viewmodel never changed. Both `flagsRowCount`
 * below and the viewmodel walk this SAME array so that mistake needs the list
 * itself to be wrong, not two copies of it to agree. */
export const ACTION_ROWS = [
    { name: 'BACKUPS', hint: 'Older versions of this set. Restore one.' },
    { name: 'MIGRATE TRACKS', hint: 'Pull tracks 1-4 out of Schwung. Reloads the set.' },
] as const;

/* Rows are counted through here rather than off `visibleFlags()` directly, so
 * a clamp cannot forget an action row exists. */
export function flagsRowCount(): number { return visibleFlags().length + ACTION_ROWS.length; }

/** Which action row is selected, or -1 when a flag is. */
export function actionRowSelected(): number {
    const i = flagsPageState.selected - visibleFlags().length;
    return i >= 0 && i < ACTION_ROWS.length ? i : -1;
}

/** Kept for callers that only ever cared about the first action row. */
export function backupsRowSelected(): boolean { return actionRowSelected() === 0; }

/** Drop the transient gesture state; the view switch belongs to param-page.ts.
 *  The selection is NOT reset — coming back to the page you were just on should
 *  land where you left it, the way a knob page keeps its bank. */
export function clearFlagsPage(): void {
    accum[0] = 0;
}

/** Jog: move the selection. Clamped rather than wrapped, so the ends of a list
 *  that will grow stay findable by feel. */
export function flagsPageJog(delta: number): void {
    const next = Math.max(0, Math.min(flagsRowCount() - 1, flagsPageState.selected + delta));
    if (next === flagsPageState.selected) return;
    flagsPageState.selected = next;
    accum[0] = 0;   // a detent half-turned on the previous flag is not this one's
}

/** Knob 1: change the selected flag. Other knobs are inert — the page draws
 *  nothing under them, and a value that moved from a knob with no label on it
 *  would be a change nobody could attribute. */
export function flagsPageKnob(k: number, delta: number): void {
    if (k !== FLAG_KNOB) return;
    if (actionRowSelected() >= 0) return;   // an action row has no value to turn
    const n = countDetents(accum, 0, delta);
    if (n === 0) return;
    /* The VISIBLE list: the page draws it, so it is also what the selection
     * indexes. Reading the raw table here would edit a flag the user cannot
     * see — and a different one than the row they are looking at. */
    const def = visibleFlags()[flagsPageState.selected];
    if (!def) return;
    setFlag(def.key, clampFlag(def, flagValue(def.key) + n));
}

export function resetFlagsPage(): void {
    flagsPageState.selected = 0;
    clearFlagsPage();
}
