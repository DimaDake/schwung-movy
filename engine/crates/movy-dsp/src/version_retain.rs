//! Which version to drop when a Set is at its limit.
//!
//! Pure — versions and `now` in, one `n` out. A port of `version-retain.ts`,
//! kept shape-for-shape: the spread it produces IS the feature, and the shape
//! is logarithmic on purpose. A rule that simply thinned wherever the gaps were
//! smallest converges on an EVEN spread, which after a month means one version
//! a day and nothing fine-grained from the session you are actually in. Buckets
//! fix the shape; the gap rule then chooses within a bucket.

use crate::version_index::{VersionRec, Why};

pub const MAX_VERSIONS: usize = 32;

const HOUR: u64 = 3600_000;
/// Upper age bound of each bucket; the last is unbounded.
const BUCKET_MS: [u64; 4] = [HOUR, 24 * HOUR, 7 * 24 * HOUR, u64::MAX];
const BUCKET_CAP: [usize; 4] = [8, 8, 8, 8];

/// Never dropped, whatever the ladder says.
const KEEP_NEWEST: usize = 3;
const PRE_WIPE_PROTECT_MS: u64 = 7 * 24 * HOUR;

fn bucket_of(r: &VersionRec, now: u64) -> usize {
    if r.ms == 0 || r.ms > now {
        return BUCKET_MS.len() - 1;
    }
    let age = now - r.ms;
    for (i, bound) in BUCKET_MS.iter().enumerate() {
        if age <= *bound {
            return i;
        }
    }
    BUCKET_MS.len() - 1
}

fn is_protected(r: &VersionRec, rank: usize, now: u64) -> bool {
    if rank < KEEP_NEWEST {
        return true;
    }
    r.why == Why::PreWipe && r.ms > 0 && now >= r.ms && now - r.ms <= PRE_WIPE_PROTECT_MS
}

fn rank_of(list: &[VersionRec], n: u32) -> usize {
    list.iter().position(|r| r.n == n).unwrap_or(usize::MAX)
}

/// The `n` to remove, or None when the list fits.
///
/// `list` is newest first (generation descending), as the index keeps it.
pub fn version_to_drop(list: &[VersionRec], now: u64) -> Option<u32> {
    if list.len() <= MAX_VERSIONS {
        return None;
    }

    /* Because the caps sum to MAX_VERSIONS, being over the total always means
     * some bucket is over its own cap — there is no separate global rule. */
    let mut buckets: [Vec<&VersionRec>; 4] = Default::default();
    for r in list {
        buckets[bucket_of(r, now)].push(r);
    }

    for (b, rows) in buckets.iter().enumerate() {
        if rows.len() <= BUCKET_CAP[b] {
            continue;
        }
        if let Some(n) = pick_within(rows, list, now) {
            return Some(n);
        }
    }
    /* Every over-cap bucket is entirely protected — fall back to the oldest
     * unprotected version anywhere, so a capture is never refused for room. */
    list.iter().enumerate().rev()
        .find(|(i, r)| !is_protected(r, *i, now))
        .map(|(_, r)| r.n)
}

/// Thin where it is densest: the interior version whose two neighbours are
/// closest together. The bucket's ends anchor its span and are left alone.
fn pick_within(rows: &[&VersionRec], list: &[VersionRec], now: u64) -> Option<u32> {
    let mut best: Option<u32> = None;
    let mut best_gap = i64::MAX;
    for i in 1..rows.len().saturating_sub(1) {
        let r = rows[i];
        if is_protected(r, rank_of(list, r.n), now) {
            continue;
        }
        /* Clockless rows have no gap to measure; rank them by generation
         * instead, treating the oldest as the densest. Negated so a lower
         * generation compares as a smaller gap. */
        let gap = if rows[i - 1].ms > 0 && rows[i + 1].ms > 0 {
            rows[i - 1].ms as i64 - rows[i + 1].ms as i64
        } else {
            -(r.gen as i64)
        };
        if gap < best_gap {
            best_gap = gap;
            best = Some(r.n);
        }
    }
    if best.is_some() {
        return best;
    }
    /* No interior candidate survived the protections — take the bucket's
     * oldest unprotected row instead. */
    rows.iter().rev()
        .find(|r| !is_protected(r, rank_of(list, r.n), now))
        .map(|r| r.n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::version_index::Why;

    const NOW: u64 = 1788892154000;
    const HOUR: u64 = 3600_000;

    fn rec(n: u32, ms: u64, why: Why) -> VersionRec {
        VersionRec { n, gen: n, ms, why, clips: 1, ui: false, ch: false }
    }

    /// `count` versions, newest first, spaced `step` apart.
    fn ladder(count: u32, step: u64) -> Vec<VersionRec> {
        (0..count).map(|i| rec(count - i, NOW - u64::from(i) * step, Why::Auto)).collect()
    }

    #[test]
    fn a_list_within_the_cap_drops_nothing() {
        assert_eq!(version_to_drop(&ladder(32, 60_000), NOW), None);
    }

    #[test]
    fn over_the_cap_something_goes() {
        assert!(version_to_drop(&ladder(33, 60_000), NOW).is_some());
    }

    /* The three newest are never dropped, whatever the ladder says: the
     * session you are IN is the one you are most likely to want back. */
    #[test]
    fn the_three_newest_are_protected() {
        let list = ladder(40, 60_000);
        let n = version_to_drop(&list, NOW).expect("drops one");
        assert!(![list[0].n, list[1].n, list[2].n].contains(&n));
    }

    /* A pre-wipe capture is the only copy of what the user asked to destroy.
     * For a week it outranks the ladder.
     *
     * The control arm is what makes this an assertion rather than a hope: an
     * earlier version of this test protected a row the ladder would never have
     * picked anyway, and passed with the protection deleted. Here the first
     * call names the row as the ladder's first choice, and the second shows the
     * flag moving it out of reach. */
    #[test]
    fn a_recent_pre_wipe_survives_a_full_list() {
        let mut list = ladder(33, HOUR / 2);
        list[5].ms = list[4].ms - 1000;
        assert_eq!(version_to_drop(&list, NOW), Some(list[4].n), "control: the densest row");
        list[4].why = Why::PreWipe;
        let n = version_to_drop(&list, NOW).expect("drops one");
        assert_ne!(n, list[4].n, "a pre-wipe inside the week is not thinned");
    }

    /* Thinning happens where the list is DENSEST, and never at a bucket's
     * ends: they anchor the span the bucket exists to cover.
     *
     * What is dropped is the row whose NEIGHBOURS are closest together, not the
     * row that moved: pulling list[5] up to a second behind list[4] closes the
     * gap AROUND list[4], so list[4] is the one the bucket can spare. Verified
     * against `versionToDrop` in version-retain.ts on this exact fixture — the
     * port has to agree with the ladder users already have on disk. */
    #[test]
    fn thins_the_densest_interior_first() {
        let mut list = ladder(33, HOUR / 2);
        list[5].ms = list[4].ms - 1000;
        let n = version_to_drop(&list, NOW).expect("drops one");
        assert_eq!(n, list[4].n);
    }

    /* A missing, zero or future timestamp cannot be aged, so it lands in the
     * oldest bucket and is ranked by generation like everything else.
     * Ordering never touches the clock; only membership does. */
    #[test]
    fn clockless_rows_still_thin() {
        let list: Vec<VersionRec> = (0..40).map(|i| rec(40 - i, 0, Why::Adopted)).collect();
        assert!(version_to_drop(&list, NOW).is_some());
    }

    #[test]
    fn future_timestamps_still_thin() {
        let list: Vec<VersionRec> =
            (0..40).map(|i| rec(40 - i, NOW + HOUR, Why::Auto)).collect();
        assert!(version_to_drop(&list, NOW).is_some());
    }

    /* A capture is never refused for want of room: when every over-cap bucket
     * is entirely protected, the oldest unprotected row ANYWHERE goes.
     *
     * The fixture is the only shape that reaches that branch: 26 pre-wipes
     * inside the hour put bucket 0 over its cap of 8 with nothing in it that
     * may be dropped, while the seven month-old rows sit under their own cap
     * and so are never considered by the bucket loop at all. Cross-checked
     * against version-retain.ts, which drops the same row. */
    #[test]
    fn a_fully_protected_bucket_falls_back_to_the_oldest() {
        let mut list: Vec<VersionRec> =
            (0..26).map(|i| rec(100 - i, NOW - u64::from(i) * 60_000, Why::PreWipe)).collect();
        list.extend((0..7).map(|i| rec(20 - i, NOW - 30 * 24 * HOUR - u64::from(i) * 60_000, Why::Auto)));
        let n = version_to_drop(&list, NOW).expect("drops one");
        assert_eq!(n, list[list.len() - 1].n);
    }
}
