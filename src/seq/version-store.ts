/* Reading and writing a set's kept versions.
 *
 * The write ORDER is the durability rule and the only subtle thing here: the
 * version's files land first, the index entry second. A crash between them
 * leaves a directory nothing names — harmless, and collected on the next
 * capture — where the other order would leave the menu offering a version whose
 * files do not exist. Same discipline as shadow-before-canonical in
 * persist-store.ts, for the same reason. */

import { mlog } from '../log.js';
import { parseState, wrapState } from './persist-blob.js';
import { safeWrite } from './persist-store.js';
import {
    fileExists, versionDir, versionStatePath, versionUiPath, versionsIndexPath,
} from './set-context.js';
import {
    countClips, parseVersionIndex, serializeVersionIndex,
    type VersionIndex, type VersionWhy,
} from './version-index.js';
import { versionToDrop } from './version-retain.js';

function read(path: string): string | null {
    return (typeof host_read_file === 'function') ? host_read_file(path) : null;
}

/** The index, with entries whose files are gone dropped. Self-healing on READ
 *  rather than on a sweep: there is no directory listing, so the index is the
 *  only place the discrepancy can be noticed at all. */
export function readVersionIndex(uuid: string): VersionIndex {
    const idx = parseVersionIndex(read(versionsIndexPath(uuid)));
    const live = idx.v.filter((r) => fileExists(versionStatePath(uuid, r.n)));
    if (live.length !== idx.v.length) {
        idx.v = live;
        safeWrite(versionsIndexPath(uuid), serializeVersionIndex(idx));
    }
    return idx;
}

export function readVersionState(uuid: string, n: number): { payload: string; gen: number } | null {
    const p = parseState(read(versionStatePath(uuid, n)));
    return p ? { payload: p.payload, gen: p.gen } : null;
}

export function readVersionUi(uuid: string, n: number): string | null {
    return read(versionUiPath(uuid, n));
}

/** Keep `payload` (and `ui`, when there is one) as a new version.
 *
 *  Returns false when nothing durable was written — the caller logs and carries
 *  on, because a capture that fails must never block the save it rode in on. */
export function writeVersion(
    uuid: string, why: VersionWhy, payload: string, gen: number,
    ui: string | null, now: number,
): boolean {
    const idx = readVersionIndex(uuid);
    const n = idx.next;
    if (typeof host_ensure_dir === 'function') host_ensure_dir(versionDir(uuid, n));
    if (!safeWrite(versionStatePath(uuid, n), wrapState(payload, gen))) {
        mlog('versions: capture failed for ' + uuid + ' (' + why + ')');
        return false;
    }
    let hasUi = false;
    if (ui !== null && ui !== '') hasUi = safeWrite(versionUiPath(uuid, n), ui);

    idx.next = n + 1;
    idx.v.unshift({ n, gen, ms: now, why, clips: countClips(payload), ui: hasUi });
    idx.v.sort((a, b) => b.gen - a.gen || b.n - a.n);
    if (!safeWrite(versionsIndexPath(uuid), serializeVersionIndex(idx))) {
        mlog('versions: index write failed for ' + uuid);
        return false;
    }
    pruneVersions(uuid, now);
    return true;
}

/** Drop versions until the set is within its limit. One at a time, because the
 *  ladder re-evaluates after every removal — which bucket a version sits in
 *  depends on the ones around it. */
export function pruneVersions(uuid: string, now: number): void {
    for (let guard = 0; guard < 8; guard++) {
        const idx = readVersionIndex(uuid);
        const n = versionToDrop(idx.v, now);
        if (n === null) return;
        if (typeof host_remove_dir === 'function') host_remove_dir(versionDir(uuid, n));
        idx.v = idx.v.filter((r) => r.n !== n);
        if (!safeWrite(versionsIndexPath(uuid), serializeVersionIndex(idx))) return;
        mlog('versions: pruned ' + n + ' from ' + uuid);
    }
}
