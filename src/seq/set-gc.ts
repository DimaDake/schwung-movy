/* Collecting state for Sets that no longer exist.
 *
 * Deleting a Set in Move takes `UserLibrary/Sets/<uuid>` with it but leaves
 * movy's `sets/<uuid>/` behind, unreachable and permanent — on the device this
 * was written against, 11 state directories backed 6 live Sets, one dead one
 * holding 1474 bytes of sequence and 16 KB of UI state.
 *
 * No host API lists a directory, so the set of uuids movy knows about comes
 * from `name-index.json`, which has recorded every Set it has loaded since the
 * index existed. That makes this a best-effort sweep rather than a complete
 * one, which is the right trade for something that deletes files. */

import { mlog } from '../log.js';
import {
    MOVE_SETS_DIR, fileExists, isProvisionalUuid, loadNameIndex, removeSetState, saveNameIndex,
} from './set-context.js';

/** Remove state for every indexed Set whose Move Set is gone. `keep` is the
 *  live Set, which is never collected whatever the index says about it. */
export function collectDeadSets(keep: string): number {
    /* The guard that makes this safe: an unreadable Sets directory answers "no
     * set exists" for every uuid, and acting on that answer would delete all of
     * them. Nothing is collected unless Move's own directory is there to be
     * asked. */
    if (!fileExists(MOVE_SETS_DIR)) return 0;

    const idx = loadNameIndex();
    let removed = 0;
    let changed = false;
    for (const name in idx) {
        const uuid = idx[name];
        if (!uuid || uuid === keep) continue;
        /* A provisional id names a pad, not a Set: Move has no directory for it
         * and never will, so "missing from Sets/" says nothing about it. */
        if (isProvisionalUuid(uuid)) continue;
        if (fileExists(MOVE_SETS_DIR + '/' + uuid)) continue;
        if (removeSetState(uuid)) removed++;
        delete idx[name];
        changed = true;
    }
    if (changed) saveNameIndex(idx);
    if (removed > 0) mlog('seq: collected ' + removed + ' deleted set(s)');
    return removed;
}
