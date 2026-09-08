/* When a version is kept.
 *
 * Five moments and nothing else. Anything driven by the autosave alone would
 * write history at flash-wearing speed for no benefit, since the rotation
 * already covers the crash case. The one that matters most is `open`: a
 * snapshot of what was on disk BEFORE movy can write anything, which costs a
 * single write per set open and turns "my set came up blank" from a data loss
 * into a menu entry. */

import { mlog } from '../log.js';
import { parseState } from './persist-blob.js';
import { readUiBlob } from './persist-store.js';
import { shadowPath, uuidToStatePath } from './set-context.js';
import { readVersionIndex, readVersionState, writeVersion } from './version-store.js';
import type { VersionWhy } from './version-index.js';

/** ~10 minutes. The autosave runs every few seconds forever, so `auto` needs a
 *  floor or the history is just the rotation with extra steps. */
const VERSION_MIN_MS = 600_000;

let lastAutoMs = 0;

export function resetVersionCapture(): void {
    lastAutoMs = 0;
}

function read(path: string): string | null {
    return (typeof host_read_file === 'function') ? host_read_file(path) : null;
}

/** Is this payload already the newest version? The autosave rewrites the same
 *  bytes whenever anything else in the set changed, and a menu full of
 *  identical entries hides the ones that differ. */
function alreadyNewest(uuid: string, payload: string): boolean {
    const idx = readVersionIndex(uuid);
    if (idx.v.length === 0) return false;
    const top = readVersionState(uuid, idx.v[0].n);
    return !!top && top.payload === payload;
}

export function captureVersion(
    uuid: string, why: VersionWhy, payload: string, gen: number,
    now: number = Date.now(),
): void {
    /* Unconditional for the two that precede a destructive act: what is about
     * to be overwritten may be the only copy, and "it looked the same as the
     * last version" is not a reason to find out otherwise afterwards. */
    const always = why === 'pre-wipe' || why === 'pre-restore';
    /* The open capture starts the auto cadence. Without this `lastAutoMs` is
     * still 0 when the first autosave lands ~8 s later, so a session opened and
     * played into records its second version within seconds of its first —
     * which is the rotation's job, not history's. */
    if (why === 'open') lastAutoMs = now;
    if (!always && alreadyNewest(uuid, payload)) return;
    if (!writeVersion(uuid, why, payload, gen, readUiBlob(uuid), now)) {
        /* Logged and dropped. The set's CURRENT state outranks its history, so
         * a capture never fails a save. */
        mlog('versions: ' + why + ' capture dropped for ' + uuid);
    }
}

export function captureAutoIfDue(
    uuid: string, payload: string, gen: number, now: number = Date.now(),
): void {
    if (lastAutoMs !== 0 && now - lastAutoMs < VERSION_MIN_MS) return;
    captureVersion(uuid, 'auto', payload, gen, now);
    /* Set even when the capture was skipped as a duplicate: the interval is
     * about how often we ASK, not how often we succeed. */
    lastAutoMs = now;
}

/** Seed a set's history from what earlier builds already wrote.
 *
 *  Returns the number adopted, and 0 when the set already has an index — this
 *  runs on every open and must be a no-op after the first.
 *
 *  Adoption COPIES. The shadows are live rotation slots: adopting them by
 *  reference would mean the history evaporates on the very next autosave. */
export function adoptExistingVersions(uuid: string, now: number = Date.now()): number {
    if (readVersionIndex(uuid).v.length > 0) return 0;

    const seen: string[] = [];
    const found: { payload: string; gen: number }[] = [];
    for (const path of [uuidToStatePath(uuid), shadowPath(uuid, 1), shadowPath(uuid, 2)]) {
        const p = parseState(read(path));
        if (!p || seen.indexOf(p.payload) >= 0) continue;
        seen.push(p.payload);
        found.push({ payload: p.payload, gen: p.gen });
    }
    if (found.length === 0) return 0;

    found.sort((a, b) => a.gen - b.gen);   // oldest gets the lowest n
    const ui = readUiBlob(uuid);
    let adopted = 0;
    for (let i = 0; i < found.length; i++) {
        /* Only the NEWEST adopted version gets the ui blob. There is exactly
         * one ui-state.json — it was never rotated — so giving an older
         * sequence today's chains would be a quiet lie. An older adopted
         * version restores the sequence alone and leaves the chains as they
         * are, which the menu shows as SEQ ONLY. */
        const isNewest = i === found.length - 1;
        if (writeVersion(uuid, 'adopted', found[i].payload, found[i].gen,
                         isNewest ? ui : null, 0)) adopted++;
    }
    if (adopted > 0) mlog('versions: adopted ' + adopted + ' for ' + uuid);
    return adopted;
}
