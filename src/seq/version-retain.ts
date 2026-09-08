/* Which version to drop when a set is at its limit.
 *
 * Pure — versions and `now` in, one `n` out — because the spread this produces
 * IS the feature, and a spread that can only be observed by filling a device
 * with a month of edits is a spread nobody will ever check.
 *
 * The shape is logarithmic, not even. A rule that simply thinned wherever the
 * gaps were smallest converges on an EVEN spread, which after a month means one
 * version a day and nothing fine-grained from the session you are actually in.
 * Buckets fix the shape; the gap rule then chooses within a bucket. */

import type { VersionRec } from './version-index.js';

export const MAX_VERSIONS = 32;

const HOUR = 3600_000;
/* Upper age bound of each bucket; the last is unbounded. */
export const BUCKET_MS = [HOUR, 24 * HOUR, 7 * 24 * HOUR, Infinity];
export const BUCKET_CAP = [8, 8, 8, 8];

/* Never dropped, whatever the ladder says. */
const KEEP_NEWEST = 3;
const PRE_WIPE_PROTECT_MS = 7 * 24 * HOUR;

/** Which bucket a version falls in. A missing, zero or future timestamp cannot
 *  be aged, so it goes in the oldest bucket — where it is ranked by generation
 *  like everything else. Ordering never touches the clock; only membership
 *  does. */
function bucketOf(r: VersionRec, now: number): number {
    const age = now - r.ms;
    if (!(r.ms > 0) || age < 0) return BUCKET_MS.length - 1;
    for (let i = 0; i < BUCKET_MS.length; i++) if (age <= BUCKET_MS[i]) return i;
    return BUCKET_MS.length - 1;
}

function isProtected(r: VersionRec, rank: number, now: number): boolean {
    if (rank >= 0 && rank < KEEP_NEWEST) return true;
    return r.why === 'pre-wipe' && r.ms > 0 && now - r.ms <= PRE_WIPE_PROTECT_MS;
}

/** The `n` to remove, or null when the list fits.
 *
 *  `list` is newest first (generation descending), as the index keeps it. */
export function versionToDrop(list: VersionRec[], now: number): number | null {
    if (list.length <= MAX_VERSIONS) return null;

    /* Because the caps sum to MAX_VERSIONS, being over the total always means
     * some bucket is over its own cap — there is no separate global rule. */
    const buckets: VersionRec[][] = BUCKET_MS.map(() => []);
    for (const r of list) buckets[bucketOf(r, now)].push(r);

    for (let b = 0; b < buckets.length; b++) {
        if (buckets[b].length <= BUCKET_CAP[b]) continue;
        const drop = pickWithin(buckets[b], list, now);
        if (drop !== null) return drop;
    }
    /* Every over-cap bucket is entirely protected — fall back to the oldest
     * unprotected version anywhere, so a capture is never refused for want of
     * room. */
    for (let i = list.length - 1; i >= 0; i--)
        if (!isProtected(list[i], i, now)) return list[i].n;
    return null;
}

/** Thin where it is densest: the interior version whose two neighbours are
 *  closest together. The bucket's ends are left alone — they anchor its span,
 *  and dropping them shrinks the range the bucket exists to cover. */
function pickWithin(rows: VersionRec[], list: VersionRec[], now: number): number | null {
    let best: number | null = null;
    let bestGap = Infinity;
    for (let i = 1; i < rows.length - 1; i++) {
        const r = rows[i];
        if (isProtected(r, list.indexOf(r), now)) continue;
        /* Clockless rows have no gap to measure; rank them by generation
         * instead, treating the oldest as the densest. Negated so a lower
         * generation compares as a smaller gap. */
        const gap = rows[i - 1].ms > 0 && rows[i + 1].ms > 0
            ? rows[i - 1].ms - rows[i + 1].ms
            : -r.gen;
        if (gap < bestGap) { bestGap = gap; best = r.n; }
    }
    if (best !== null) return best;
    /* No interior candidate survived the protections — take the bucket's oldest
     * unprotected row instead. */
    for (let i = rows.length - 1; i >= 0; i--)
        if (!isProtected(rows[i], list.indexOf(rows[i]), now)) return rows[i].n;
    return null;
}
