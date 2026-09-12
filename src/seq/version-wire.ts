/* The BACKUPS menu's rows, from whichever half owns them.
 *
 * With `engpersist` on the index is the engine's file and never read here; the
 * rows arrive as text on a GET. They are CACHED because the page's viewmodel is
 * rebuilt every frame (app/tick.ts) and an engine GET blocks 3-5 ms — movy's
 * tick period is its MIDI sampling interval, so a per-frame read would be felt
 * under the fingers. Refreshed when the page opens and after anything that
 * changes the history. */

import { flagValue } from './flags.js';
import { readVersionIndex } from './version-store.js';
import type { VersionRec, VersionWhy } from './version-index.js';

const WHYS: VersionWhy[] = ['open', 'auto', 'exit', 'pre-wipe', 'pre-restore', 'adopted'];

let rows: VersionRec[] = [];

/** `n gen ms why clips ui ch`, one version per line, newest first. */
export function parseVersionRows(raw: string | null): VersionRec[] {
    if (!raw) return [];
    const out: VersionRec[] = [];
    for (const line of raw.split('\n')) {
        const t = line.split(' ');
        if (t.length < 7) continue;
        const n = +t[0], gen = +t[1], ms = +t[2], clips = +t[4];
        /* A row we cannot read is dropped rather than defaulted, exactly as the
         * file parser drops a record: an entry whose generation is unknown
         * cannot be ordered, and an unordered entry in a restore menu is worse
         * than an absent one. */
        if (!isFinite(n) || !isFinite(gen) || !isFinite(ms)) continue;
        if (WHYS.indexOf(t[3] as VersionWhy) < 0) continue;
        out.push({
            n, gen, ms, why: t[3] as VersionWhy,
            clips: isFinite(clips) ? clips : 0,
            ui: t[5] === '1', ch: t[6] === '1',
        });
    }
    return out;
}

export function refreshVersionRows(): void {
    if (typeof host_module_get_param !== 'function') return;
    rows = parseVersionRows(host_module_get_param('versions'));
}

export function resetVersionWire(): void {
    rows = [];
}

/** The menu's rows. The file is read only while the old path owns it. */
export function versionRows(uuid: string): VersionRec[] {
    return flagValue('engpersist') ? rows : readVersionIndex(uuid).v;
}
