/* The version index — `sets/<uuid>/versions.json`.
 *
 * No host API lists a directory, so this file IS the list: a version the index
 * does not name is invisible, and a name the index carries for a directory that
 * is gone is dropped on read. Keeping the record parsing here, with no I/O, is
 * what lets the whole self-heal be tested without a filesystem. */

export type VersionWhy =
    'open' | 'auto' | 'exit' | 'pre-wipe' | 'pre-restore' | 'adopted';

const WHYS: VersionWhy[] = ['open', 'auto', 'exit', 'pre-wipe', 'pre-restore', 'adopted'];

export interface VersionRec {
    n: number;      // directory under v/, never reused
    gen: number;    // envelope generation — THE ORDERING KEY
    ms: number;     // Date.now() at capture, or 0 when unknown; display only
    why: VersionWhy;
    clips: number;  // how a user tells a real version from a blank one
    ui: boolean;    // whether v/<n>/ui-state.json exists
}

export interface VersionIndex { next: number; v: VersionRec[] }

function isRec(o: unknown): o is VersionRec {
    const r = o as VersionRec;
    return !!r && typeof r.n === 'number' && typeof r.gen === 'number'
        && typeof r.ms === 'number' && WHYS.indexOf(r.why) >= 0;
}

/** Parse, dropping anything unusable. An unreadable index reads as NO VERSIONS
 *  — never as permission to delete, which is the guard `collectDeadSets`
 *  applies to an unreadable Sets directory for the same reason. */
export function parseVersionIndex(raw: string | null): VersionIndex {
    if (!raw) return { next: 1, v: [] };
    let o: { next?: unknown; v?: unknown };
    try { o = JSON.parse(raw) as { next?: unknown; v?: unknown }; }
    catch { return { next: 1, v: [] }; }
    const list: VersionRec[] = Array.isArray(o.v)
        ? (o.v as unknown[]).filter(isRec).map((r) => ({
            n: r.n, gen: r.gen, ms: r.ms, why: r.why,
            clips: typeof r.clips === 'number' ? r.clips : 0,
            ui: r.ui === true,
        }))
        : [];
    list.sort((a, b) => b.gen - a.gen || b.n - a.n);
    /* `next` must outrank every n on disk. A truncated write that lost the
     * counter would otherwise hand the next capture a directory that already
     * exists — the one corruption self-heal cannot undo, because the old
     * version's files would be gone by the time anyone noticed. */
    let next = typeof o.next === 'number' && o.next >= 1 ? o.next : 1;
    for (const r of list) if (r.n >= next) next = r.n + 1;
    return { next, v: list };
}

export function serializeVersionIndex(idx: VersionIndex): string {
    return JSON.stringify({ next: idx.next, v: idx.v });
}

/** Clips in a payload. The one number the menu shows that says whether a
 *  version is worth restoring. */
export function countClips(payload: string): number {
    let n = 0;
    for (const line of payload.split('\n')) if (line.startsWith('cl ')) n++;
    return n;
}
