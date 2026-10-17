/* The BACKUPS menu's rows.
 *
 * The index is the engine's file (version_store.rs) and never read here; the
 * rows arrive as text on a GET. They are CACHED because the page's viewmodel is
 * rebuilt every frame (app/tick.ts) and an engine GET blocks 3-5 ms — movy's
 * tick period is its MIDI sampling interval, so a per-frame read would be felt
 * under the fingers. Refreshed when the page opens and after anything that
 * changes the history. */

import { paramGet } from '../host/param.js';

export type VersionWhy =
    'open' | 'auto' | 'exit' | 'pre-wipe' | 'pre-restore' | 'adopted';

export interface VersionRec {
    n: number;      // directory under v/, never reused
    gen: number;    // envelope generation — THE ORDERING KEY
    ms: number;     // capture time, or 0 when unknown; display only
    why: VersionWhy;
    clips: number;  // how a user tells a real version from a blank one
    ui: boolean;    // whether the version kept a ui-state.json
    ch: boolean;    // whether the version kept a chains.json
}

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
    rows = parseVersionRows(paramGet('versions'));
}

export function resetVersionWire(): void {
    rows = [];
}

/** The menu's rows, as of the last refresh. */
export function versionRows(): VersionRec[] {
    return rows;
}
