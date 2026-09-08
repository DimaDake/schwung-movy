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
import { readBestState, writeStateBlob, writeUiBlob } from './persist-store.js';
import { captureVersion } from './version-capture.js';
import { readVersionIndex, readVersionState, readVersionUi } from './version-store.js';

export function restoreVersion(uuid: string, n: number, now: number = Date.now()): boolean {
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
