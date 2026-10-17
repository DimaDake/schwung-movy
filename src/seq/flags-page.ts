/* Settings page: a scrolling list of actions, opened with Shift+Step 2 and
 * closed with Back.
 *
 * Jog scrolls the selection and the jog click acts on it. The knobs do
 * nothing here.
 *
 * Sibling of Set Params and Clip Params in the param-page.ts layer, so one Back
 * leaves all three and a track button closes them. No `active` flag lives here:
 * being open IS `currentView === VIEW_FLAGS` — see the note in main-page.ts for
 * what a second hand-synced copy of that fact costs. */

import { appState, VIEW_FLAGS } from '../app/state.js';

export const flagsPageState = {
    selected: 0,        // index into ACTION_ROWS
};

export function flagsPageActive(): boolean {
    return appState.currentView === VIEW_FLAGS;
}

/* BACKUPS opens the versions list, MIGRATE FROM MOVE re-runs the set
 * migration (migrate-action.ts).
 *
 * A LIST, not hardcoded rows: the FIRST version of BACKUPS added its row to
 * the jog's clamp and to the router but not to `flags-page-vm.ts`'s drawn
 * list, so it was selectable, clickable and undrawn — every screenshot stayed
 * byte-identical because the viewmodel never changed. Both `flagsRowCount`
 * below and the viewmodel walk this SAME array so that mistake needs the list
 * itself to be wrong, not two copies of it to agree. */
export const ACTION_ROWS = [
    { name: 'BACKUPS', hint: 'Older versions of this set. Restore one.' },
    /* Its hint and value are live (migrate-action.ts); these are the fallback. */
    { name: 'MIGRATE FROM MOVE', hint: 'Bring every Set over from Move.' },
] as const;

export function flagsRowCount(): number { return ACTION_ROWS.length; }

/** Which action row is selected. */
export function actionRowSelected(): number {
    const i = flagsPageState.selected;
    return i >= 0 && i < ACTION_ROWS.length ? i : -1;
}

export function backupsRowSelected(): boolean { return actionRowSelected() === 0; }
export function migrateRowSelected(): boolean { return actionRowSelected() === 1; }

/** Jog: move the selection. Clamped rather than wrapped, so the ends of a list
 *  that will grow stay findable by feel. */
export function flagsPageJog(delta: number): void {
    flagsPageState.selected =
        Math.max(0, Math.min(flagsRowCount() - 1, flagsPageState.selected + delta));
}

/** The selection is NOT reset on leaving — coming back to the page you were
 *  just on should land where you left it, the way a knob page keeps its bank. */
export function resetFlagsPage(): void {
    flagsPageState.selected = 0;
}
