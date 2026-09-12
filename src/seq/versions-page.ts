/* The BACKUPS page: a scrolled list of this Set's kept versions, and the one
 * gesture that puts one back.
 *
 * A restore replaces live work, so this is the only list on the device that
 * asks twice. Everything else here is the settings page's shape — jog scrolls,
 * Back leaves — because they are the same gesture and must not behave
 * differently under one wheel.
 *
 * The Set's uuid arrives as an argument rather than being read here. This
 * module would otherwise import the set lifecycle, which imports the capture
 * layer, which imports the store this reads. */

import { appState, VIEW_VERSIONS } from '../app/state.js';
import { openParamPage } from './param-page.js';
import { refreshVersionRows, versionRows } from './version-wire.js';
import { restorePending, restoreVersion } from './version-restore.js';
import { mlog } from '../log.js';

export const versionsPageState = {
    selected: 0,
    confirming: false,
};

export function versionsPageActive(): boolean {
    return appState.currentView === VIEW_VERSIONS;
}

export function openVersionsPage(): void {
    resetVersionsPage();
    /* Once, here: the page's viewmodel is rebuilt every frame and must not buy
     * an engine read per repaint. */
    refreshVersionRows();
    openParamPage(VIEW_VERSIONS);
}

export function resetVersionsPage(): void {
    versionsPageState.selected = 0;
    versionsPageState.confirming = false;
}

/** Jog scrolls one row; Shift+jog jumps eight, because 32 versions is eight
 *  screens of plain scrolling — the level-skip idiom the cursor pagination
 *  already established. */
export function versionsPageJog(delta: number, shift: boolean, uuid: string): void {
    /* The confirm owns the wheel while it is armed. A list that scrolled under
     * it would restore whatever the jog happened to land on. */
    if (versionsPageState.confirming) return;
    const max = Math.max(0, versionRows(uuid).length - 1);
    const step = shift ? 8 : 1;
    versionsPageState.selected =
        Math.max(0, Math.min(max, versionsPageState.selected + delta * step));
}

/** Jog click: the first press arms the confirm, the second performs the
 *  restore. Returns true when a restore actually happened, so the caller can
 *  re-enter the load path — this module does not import the lifecycle. */
export function versionsPageClick(uuid: string): boolean {
    const rec = versionRows(uuid)[versionsPageState.selected];
    if (!rec) return false;
    if (!versionsPageState.confirming) {
        versionsPageState.confirming = true;
        return false;
    }
    versionsPageState.confirming = false;
    if (restoreVersion(uuid, rec.n)) return true;
    /* With the engine owning the files the restore finishes on a later tick, so
     * "not done yet" is not a refusal — and a log line saying it was would send
     * the next reader hunting a failure that did not happen. */
    if (!restorePending()) mlog('versions: restore refused for ' + rec.n);
    return false;
}

/** Back cancels an armed confirm; otherwise the param layer handles it. */
export function versionsPageBack(): boolean {
    if (!versionsPageState.confirming) return false;
    versionsPageState.confirming = false;
    return true;
}
