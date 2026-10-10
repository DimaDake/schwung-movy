/* The SETS page (Shift+Step 1): movy's own Sets, and what the buttons do to
 * the one under the cursor.
 *
 * A param-page sibling, so Back, a track button and every other screen switch
 * close it with no code of its own. Row 0 is the [NEW] action; row i+1 is the
 * library's row i, in the engine's display order.
 *
 * Commands land on the engine's saver thread a few ticks later, so anything
 * that must follow one — moving the cursor to a Set just made, opening the Set
 * that replaces a deleted one — waits on the answer's `made` CHANGING (it is
 * sticky; ids are unique), never on the very next answer.
 *
 * The open Set's id arrives as an argument, as the BACKUPS page's does: this
 * module stays free of the set lifecycle, so it is testable without one. */

import { appState, VIEW_SETS } from '../app/state.js';
import { openParamPage, closeParamPage } from './param-page.js';
import { defaultSetName, dupName, libRefresh, libSend, libState, type LibRow } from './sets-lib.js';
import { setSourceMovy, wantSet } from './set-source.js';
import { deleteWhenLeft } from './set-lib-session.js';
import { textEntry } from '../renderer/text-entry-lib.js';
import { seqToast } from './render.js';

export const setsPageState = {
    selected: 0,
    confirming: false,
};

/* `made` as it stood when a new/dup went out, or null when none is in flight. */
let madeBefore: string | null = null;
/* The open Set to delete once its replacement (being made now) exists. */
let replaceThenDelete = '';
let pollIn = 0;

export function setsPageActive(): boolean { return appState.currentView === VIEW_SETS; }

function rows(): LibRow[] { return libState()?.rows ?? []; }

export function resetSetsPage(): void {
    setsPageState.selected = 0;
    setsPageState.confirming = false;
    madeBefore = null;
    replaceThenDelete = '';
}

export function openSetsPage(openId: string): void {
    resetSetsPage();
    if (setSourceMovy()) {
        libRefresh();
        /* Open on the Set that is open — it is what you came to act on. */
        const i = rows().findIndex((r) => r.id === openId);
        setsPageState.selected = i >= 0 ? i + 1 : 0;
    }
    openParamPage(VIEW_SETS);
}

/** Per tick while the page is up: read the answer at a cost that does not
 *  scale with frames, and finish whatever was waiting on it. */
export function setsPageTick(): boolean {
    if (!setSourceMovy()) return false;
    if (--pollIn > 0) return false;
    pollIn = madeBefore !== null ? 4 : 16;
    if (!libRefresh()) return false;
    const st = libState();
    if (st && madeBefore !== null && st.made && st.made !== madeBefore) {
        madeBefore = null;
        const i = st.rows.findIndex((r) => r.id === st.made);
        if (replaceThenDelete) {
            wantSet(st.made);
            deleteWhenLeft(replaceThenDelete);
            replaceThenDelete = '';
        } else if (i >= 0) {
            setsPageState.selected = i + 1;
        }
    }
    const max = rows().length;
    if (setsPageState.selected > max) setsPageState.selected = max;
    return true;
}

function send(cmd: string, awaitMade: boolean): void {
    if (awaitMade) madeBefore = libState()?.made ?? '';
    libSend(cmd);
    pollIn = 1;
}

export function setsPageJog(delta: number, shift: boolean): void {
    /* The confirm owns the wheel: a list that scrolled under it would delete
     * whatever the jog happened to land on. */
    if (setsPageState.confirming || !setSourceMovy()) return;
    const step = shift ? 8 : 1;
    setsPageState.selected = Math.max(0, Math.min(rows().length, setsPageState.selected + delta * step));
}

function target(): LibRow | null { return rows()[setsPageState.selected - 1] ?? null; }

/** Jog click. Returns true when the page should close (a Set was opened). */
export function setsPageClick(openId: string): boolean {
    if (!setSourceMovy()) return false;
    if (setsPageState.confirming) {
        setsPageState.confirming = false;
        const t = target();
        if (t) deleteSet(t, openId);
        return false;
    }
    if (setsPageState.selected === 0) {
        send('new ' + defaultSetName(new Date(), rows()), true);
        return false;
    }
    const t = target();
    if (!t) return false;
    if (t.id !== openId) wantSet(t.id);
    appState.currentView = closeParamPage();
    return true;
}

function deleteSet(t: LibRow, openId: string): void {
    if (t.id !== openId) {
        send('del ' + t.id, false);
        return;
    }
    /* The open Set: move off it first — the engine refuses to delete the Set
     * its saver has open, and a session left pointing at a deleted id would
     * autosave it straight back into existence. */
    const list = rows();
    const i = list.findIndex((r) => r.id === t.id);
    const next = list[i + 1] ?? list[i - 1];
    if (next) {
        wantSet(next.id);
        deleteWhenLeft(t.id);
    } else {
        replaceThenDelete = t.id;
        send('new ' + defaultSetName(new Date(), list), true);
    }
}

/** Back cancels an armed confirm; otherwise the param layer handles it. */
export function setsPageBack(): boolean {
    if (!setsPageState.confirming) return false;
    setsPageState.confirming = false;
    return true;
}

export type SetsButton = 'capture' | 'copy' | 'delete';

/** Capture renames, Copy duplicates, Delete arms the confirm — all on the Set
 *  under the cursor; nothing on [NEW]. */
export function setsPageButton(b: SetsButton): void {
    const t = target();
    if (!setSourceMovy() || !t || setsPageState.confirming) return;
    if (b === 'delete') { setsPageState.confirming = true; return; }
    if (b === 'copy') { send('dup ' + t.id + ' ' + dupName(t.name), true); return; }
    const te = textEntry();
    if (!te) { seqToast('RENAME NEEDS NEWER SCHWUNG'); return; }
    te.openTextEntry({
        title: 'Rename Set',
        initialText: t.name,
        onConfirm: (text: string) => {
            const name = text.trim();
            if (name && name !== t.name) send('rename ' + t.id + ' ' + name, false);
            appState.dirty = true;
        },
        onCancel: () => { appState.dirty = true; },
    });
}
