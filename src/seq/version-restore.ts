/* Putting a version back.
 *
 * The restored bytes go out through `writeStateBlob`, the same writer the
 * autosave uses, rather than a hand-rolled write of the three copies. That is
 * not just reuse: it writes a verified SHADOW FIRST and the canonical file
 * last, which is the property a restore needs. There is no fsync and no rename
 * here, so a canonical write can be torn by a power cut — and a restore that
 * wrote the canonical file first and gave up when it failed would leave the
 * blank the user was escaping as the best copy on disk, silently undoing
 * itself. Shadow-first means whatever survives the crash is the rescue.
 *
 * The generation bump below is what makes the restore win an ordinary read. A
 * hand-copy that does NOT bump it loses to a newer blank in a shadow — that is
 * what a device showed, and it is why MANUAL.md tells anyone recovering by hand
 * to overwrite every copy. */

import { mlog } from '../log.js';
import { flagValue } from './flags.js';
import { refreshVersionRows } from './version-wire.js';
import { readBestState, writeStateBlob, writeUiBlob } from './persist-store.js';
import { captureVersion } from './version-capture.js';
import { readVersionIndex, readVersionState, readVersionUi } from './version-store.js';

/* A restore cannot be awaited: the saver is another thread and this host has no
 * sleep. So the press sends the command and a later tick collects the answer —
 * the same shape settling uses for module loads. */
let pending: { uuid: string; tries: number } | null = null;

/* ~2.5 s at the tick rate this runs at. A restore is a handful of file
 * operations; a bound this loose only ever fires when something is wrong, and
 * firing is what stops the page waiting forever. */
const RESTORE_TRIES = 60;

function restoreViaEngine(uuid: string, n: number): boolean {
    if (typeof host_module_set_param_blocking !== 'function') return false;
    host_module_set_param_blocking('set', 'restore ' + n, 200);
    pending = { uuid, tries: 0 };
    return false;   // nothing to reload yet — restoreTick says when
}

/** True on the tick a restore completed: the caller re-enters the load. */
export function restoreTick(): boolean {
    if (!pending) return false;
    const v = typeof host_module_get_param === 'function'
        ? host_module_get_param('vui') : null;
    if (v === null || v === 'pending') {
        if (++pending.tries < RESTORE_TRIES) return false;
        mlog('versions: restore never answered — giving up');
        pending = null;
        return false;
    }
    const { uuid } = pending;
    pending = null;
    refreshVersionRows();
    if (v === 'failed') {
        mlog('versions: the engine refused the restore');
        return false;
    }
    /* The version's ui half, written to the UI's own file: that half is ours
     * (spec §5), and the reload that follows applies it the way an ordinary
     * load would. `none` means the version carried none — an adopted older
     * sequence — and the chains stay as they are. */
    if (v !== 'none' && v.length > 0) writeUiBlob(uuid, v);
    return true;
}

/** Is a restore in flight? `restoreVersion` answers false on the press with the
 *  flag on, and without this the page reads that as a refusal and says so. */
export function restorePending(): boolean {
    return pending !== null;
}

export function resetVersionRestore(): void {
    pending = null;
}

export function restoreVersion(uuid: string, n: number, now: number = Date.now()): boolean {
    /* Engine-owned: it holds the files, so it takes the pre-restore capture,
     * bumps the generation above everything on disk and hands the ui half
     * back. Nothing below this line may run as well — two writers of one Set
     * are what the flag exists to keep apart. */
    if (flagValue('engpersist')) return restoreViaEngine(uuid, n);
    const rec = readVersionIndex(uuid).v.find((r) => r.n === n);
    const src = rec ? readVersionState(uuid, n) : null;
    if (!rec || !src) {
        mlog('versions: cannot restore ' + n + ' of ' + uuid);
        return false;
    }

    /* Before anything is overwritten: a mis-press must not cost the live take,
     * so a restore is itself undoable. */
    const cur = readBestState(uuid);
    if (cur) captureVersion(uuid, 'pre-restore', cur.payload, cur.gen, now);

    /* Above every copy AND every version, so nothing on disk can outrank the
     * restore — including the pre-restore capture just taken. */
    let top = cur ? cur.gen : 0;
    for (const r of readVersionIndex(uuid).v) if (r.gen > top) top = r.gen;
    const gen = top + 1;
    if (!writeStateBlob(uuid, src.payload, gen)) {
        mlog('versions: restore of ' + n + ' did not reach disk');
        return false;
    }

    /* Only when the version HAS a ui half. An adopted older sequence has none,
     * and overwriting the chains with nothing would be worse than the wipe this
     * feature exists to undo. */
    const ui = rec.ui ? readVersionUi(uuid, n) : null;
    if (ui !== null && ui !== '') writeUiBlob(uuid, ui);

    mlog('versions: restored ' + n + ' of ' + uuid + ' at gen ' + gen);
    return true;
}
