//! Which chains each render lane takes.
//!
//! A static partition cannot finish before its largest member, so the assignment
//! — not the worker count — is what parallel render actually costs. Lane 0 is
//! the audio thread itself; lanes 1.. are helper threads.
//!
//! **Chains that share a mapping share a lane.** Two chains holding one module
//! through one file share its whole `.data`/`.bss`
//! (`plans/2026-08-22-module-isolation.md`): six fleet modules mutate that state
//! from `render_block`, and twelve more reach the chain host's clock globals
//! through `get_clock_status`. Pinned to one lane they stay serial, exactly as
//! serial render was, and none of it can race.
//!
//! **Pinning is now the fallback, not the policy.** `chain_iso` gives every
//! duplicate its own copy of the module's `.so` first — `dlopen` keys on the
//! inode, so a copy is a separate mapping and a separate `.data` — and only the
//! duplicates it could NOT isolate arrive here still needing a lane to
//! themselves. That is what `pin_key` is: empty for a chain that shares nothing
//! with anyone, and the shared `<namespace>/<module>` otherwise. Grouping on it
//! rather than on the synth id also closes a hole, since two chains can share an
//! audio FX while running different synths — airwindows is an FX pack and the
//! module in the fleet most likely to appear twice in one set.
//!
//! The set this decides is twelve chains of ONE module. Pinned, they collapse
//! onto a single lane and return exactly 1.00x
//! (`twelve_shared_chains_cannot_be_split`); isolated, they spread across all of
//! them (`isolated_duplicates_spread_across_lanes`). Twelve drum tracks is a set
//! people build.
//!
//! **`pin_duplicates` can be turned off, and doing so is deliberately unsafe.**
//! (`chiso 0` is the safe way to put duplicates back on one lane: it re-pins
//! them rather than removing the pin.)
//! It exists because the equivalence oracle cannot otherwise see the hazard the
//! pinning exists to prevent: with duplicates pinned, two instances of one
//! module never render concurrently, so the oracle passes on that axis without
//! having tested it. `forge` is the proof — flagged by the static audit, and it
//! passed, because the measured set holds exactly one forge. Splitting the
//! duplicates is the only way to turn that vacuous pass into evidence, and it is
//! also the mechanism §5's tier 1 needs. It is off by default, never persisted,
//! and gated behind `chparallel` being on at all.
//!
//! Everything here is preallocated and reused: planning happens on the audio
//! thread, where an allocation is a realtime hazard.
//!
//! `scripts/lib/partition.mjs` prices the same policy against measured device
//! costs offline. This is the one that runs; the pair is kept from drifting by
//! `lpt_is_four_thirds_approximate`, which pins the same case as the JS suite.

/// Longest-processing-time-first over module groups, with reusable scratch.
pub struct Planner {
    /// First chain of each group — its module id identifies the group, so no
    /// module string is ever copied.
    heads: Vec<usize>,
    group_cost: Vec<u64>,
    order: Vec<usize>,
    lane_load: Vec<u64>,
    /// Chain indices per lane. `lanes[0]` runs on the audio thread.
    pub lanes: Vec<Vec<usize>>,
}

impl Planner {
    pub fn new(chains: usize, lane_count: usize) -> Self {
        Self {
            heads: Vec::with_capacity(chains),
            group_cost: Vec::with_capacity(chains),
            order: Vec::with_capacity(chains),
            lane_load: vec![0; lane_count.max(1)],
            lanes: (0..lane_count.max(1)).map(|_| Vec::with_capacity(chains)).collect(),
        }
    }

    pub fn lane_count(&self) -> usize {
        self.lanes.len()
    }

    /// Assign every chain with `loaded[c]` to a lane.
    ///
    /// `pin_key[c]` names the mapping chain `c` shares with another chain, and
    /// is EMPTY when it shares none — an empty key is its own group, never
    /// matched against another empty one. Matching them would put every isolated
    /// chain back on one lane, which is the exact outcome this change exists to
    /// undo. `cost_ns[c]` is the chain's recent mean render cost — zero before
    /// it has rendered, which degrades to an even split rather than a bad one.
    ///
    /// `pin_duplicates` is passed in rather than held as state so that rebuilding
    /// the planner — which `set_lanes` does on every lane change — cannot
    /// silently drop it and turn a split-duplicate measurement back into a
    /// pinned one that still reports itself as split.
    pub fn plan(
        &mut self,
        pin_key: &[String],
        cost_ns: &[u64],
        loaded: &[bool],
        pin_duplicates: bool,
    ) {
        self.heads.clear();
        self.group_cost.clear();
        self.order.clear();
        for l in self.lanes.iter_mut() {
            l.clear();
        }
        for w in self.lane_load.iter_mut() {
            *w = 0;
        }

        // Group by module. A linear scan over <= 12 chains beats a map, and
        // costs nothing to keep allocation-free.
        for c in 0..loaded.len() {
            if !loaded[c] {
                continue;
            }
            let existing = if pin_duplicates && !pin_key[c].is_empty() {
                self.heads.iter().position(|&h| pin_key[h] == pin_key[c])
            } else {
                None
            };
            match existing {
                Some(g) => self.group_cost[g] += cost_ns[c],
                None => {
                    self.heads.push(c);
                    self.group_cost.push(cost_ns[c]);
                }
            }
        }

        // Descending by cost. Ties break on the first chain index so a replan
        // with unchanged inputs produces an identical plan — an assignment that
        // reshuffled on its own would make a serial-vs-parallel comparison
        // irreproducible for reasons that have nothing to do with threads.
        self.order.extend(0..self.heads.len());
        let (cost, heads) = (&self.group_cost, &self.heads);
        self.order.sort_unstable_by(|&a, &b| cost[b].cmp(&cost[a]).then(heads[a].cmp(&heads[b])));

        for &g in self.order.iter() {
            // Least loaded, breaking ties on group count. The tiebreak is not
            // cosmetic: before any chain has rendered every cost is zero, and a
            // pure `<` on load would leave every lane equal and pile the whole
            // set onto lane 0 — which is the state the first parallel block
            // after a load runs in.
            let mut pick = 0;
            for l in 1..self.lane_load.len() {
                let better = (self.lane_load[l], self.lanes[l].len())
                    < (self.lane_load[pick], self.lanes[pick].len());
                if better {
                    pick = l;
                }
            }
            self.lane_load[pick] += self.group_cost[g];
            let head = self.heads[g];
            for c in 0..loaded.len() {
                // Unpinned, a group is exactly its head, so the membership test
                // has to be identity rather than module equality — otherwise
                // every duplicate is scheduled once per sibling.
                let member = if pin_duplicates && !pin_key[head].is_empty() {
                    pin_key[c] == pin_key[head]
                } else {
                    c == head
                };
                if loaded[c] && member {
                    self.lanes[pick].push(c);
                }
            }
        }
    }

    /// Cost of the busiest lane — what a block takes, ignoring fan-out.
    pub fn makespan(&self) -> u64 {
        self.lane_load.iter().copied().max().unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run_with(keys: &[&str], costs: &[u64], lanes: usize, pin: bool) -> Planner {
        let m: Vec<String> = keys.iter().map(|s| s.to_string()).collect();
        let loaded = vec![true; keys.len()];
        let mut p = Planner::new(keys.len(), lanes);
        p.plan(&m, costs, &loaded, pin);
        p
    }

    fn run(mods: &[&str], costs: &[u64], lanes: usize) -> Planner {
        run_with(mods, costs, lanes, true)
    }

    /// The safety property. If this ever splits, two instances of one module
    /// render concurrently and share its file-scope state — the exact bug the
    /// grouping exists to make impossible.
    #[test]
    fn chains_sharing_a_mapping_never_split() {
        let p = run(&["obxd", "obxd", "helm"], &[100, 100, 100], 3);
        let with_obxd: Vec<_> =
            p.lanes.iter().filter(|l| l.contains(&0) || l.contains(&1)).collect();
        assert_eq!(with_obxd.len(), 1, "both obxd chains must share ONE lane: {:?}", p.lanes);
        assert_eq!(with_obxd[0], &vec![0, 1]);
    }

    /// The degenerate set, in the state isolation could not rescue: twelve
    /// chains all holding ONE file collapse onto one lane and buy nothing. This
    /// is what `chiso 0` measures, and what a failed copy falls back to.
    #[test]
    fn twelve_shared_chains_cannot_be_split() {
        let p = run(&["helm"; 12], &[100; 12], 3);
        assert_eq!(p.makespan(), 1200);
        assert_eq!(p.lanes.iter().filter(|l| !l.is_empty()).count(), 1);
    }

    /// Unpinned — `chpin 0`, the oracle's deliberately-unsafe stimulus, which
    /// splits duplicates WITHOUT copying them.
    #[test]
    fn unpinned_duplicates_land_on_different_lanes() {
        let p = run_with(&["helm"; 12], &[100; 12], 3, false);
        assert_eq!(p.makespan(), 400, "{:?}", p.lanes);
        assert!(p.lanes.iter().all(|l| l.len() == 4), "{:?}", p.lanes);
    }

    /// Unpinned scheduling must still schedule each chain exactly once. The
    /// membership test changes with the flag and with the key, and a group that kept matching by
    /// module id would place every duplicate once per sibling — three chains of
    /// one module would render nine times, which sounds like distortion rather
    /// than like a planner bug.
    #[test]
    fn unpinned_still_schedules_every_chain_exactly_once() {
        let p = run_with(&["obxd", "obxd", "obxd", "helm"], &[10, 10, 10, 10], 2, false);
        let mut seen: Vec<usize> = p.lanes.iter().flatten().copied().collect();
        seen.sort_unstable();
        assert_eq!(seen, vec![0, 1, 2, 3], "{:?}", p.lanes);
    }

    /// The point of module isolation, at the planner. Twelve chains of one
    /// module, each given its own copy of it, have nothing left to share — so
    /// every key is empty and all three lanes fill. Empty keys must NOT match
    /// each other; if they did this would read exactly like the pinned case and
    /// the copies would buy nothing.
    #[test]
    fn isolated_duplicates_spread_across_lanes() {
        let p = run(&[""; 12], &[100; 12], 3);
        assert_eq!(p.makespan(), 400, "{:?}", p.lanes);
        assert!(p.lanes.iter().all(|l| l.len() == 4), "{:?}", p.lanes);
    }

    /// A copy that failed leaves its chain sharing the installed file, and it
    /// has to be pinned to whatever else holds it while the isolated chains stay
    /// free. Mixed is the realistic state, not an edge case: it is what a full
    /// disk or a read-only module directory produces.
    #[test]
    fn a_chain_that_could_not_be_isolated_is_still_pinned() {
        let keys = ["sound_generators/helm", "", "", "sound_generators/helm"];
        let p = run(&keys, &[100; 4], 3);
        let together = p.lanes.iter().find(|l| l.contains(&0)).unwrap();
        assert!(together.contains(&3), "the two shared chains share a lane: {:?}", p.lanes);
        assert!(!together.contains(&1) && !together.contains(&2),
            "and the isolated ones are not dragged along: {:?}", p.lanes);
    }

    /// Sorting descending is what makes this LPT and not plain greedy. Fed
    /// ascending, an unsorted greedy strands the big item on a full lane (4);
    /// LPT places it first (3). A greedy that forgot to sort would still "work"
    /// and would quietly over-report the achievable speedup.
    #[test]
    fn sorts_descending_before_packing() {
        assert_eq!(run(&["a", "b", "c", "d"], &[1, 1, 1, 3], 2).makespan(), 3);
    }

    /// LPT is an approximation and the design is decided on its numbers, so the
    /// gap is pinned rather than assumed away: the optimum here is 6 (3+3 |
    /// 2+2+2) and LPT returns 7. Same case as browser-test/logic/partition.mjs.
    #[test]
    fn lpt_is_four_thirds_approximate() {
        assert_eq!(run(&["a", "b", "c", "d", "e"], &[3, 3, 2, 2, 2], 2).makespan(), 7);
    }

    /// Before anything has rendered every cost is zero. The plan must still
    /// spread the work rather than pile all of it onto lane 0 — that is the
    /// state the very first parallel block runs in.
    #[test]
    fn zero_costs_still_spread() {
        let p = run(&["a", "b", "c", "d", "e", "f"], &[0; 6], 3);
        assert!(p.lanes.iter().all(|l| l.len() == 2), "{:?}", p.lanes);
    }

    #[test]
    fn every_loaded_chain_lands_in_exactly_one_lane() {
        let m: Vec<String> = ["a", "b", "a", "c", "b", "d"].iter().map(|s| s.to_string()).collect();
        let loaded = [true, true, false, true, true, true];
        let mut p = Planner::new(6, 3);
        p.plan(&m, &[10, 20, 30, 40, 50, 60], &loaded, true);
        let mut seen: Vec<usize> = p.lanes.iter().flatten().copied().collect();
        seen.sort_unstable();
        assert_eq!(seen, vec![0, 1, 3, 4, 5], "an unloaded chain must not be scheduled");
    }

    /// Replanning must be idempotent — the scratch is reused, so a stale entry
    /// would show up as a chain scheduled twice.
    #[test]
    fn replanning_reuses_scratch_without_accumulating() {
        let m: Vec<String> = ["a", "b", "c"].iter().map(|s| s.to_string()).collect();
        let mut p = Planner::new(3, 2);
        for _ in 0..3 {
            p.plan(&m, &[5, 3, 1], &[true, true, true], true);
        }
        let seen: Vec<usize> = p.lanes.iter().flatten().copied().collect();
        assert_eq!(seen.len(), 3, "{:?}", p.lanes);
        assert_eq!(p.makespan(), 5);
    }

    #[test]
    fn empty_and_single_lane_are_not_special_cases() {
        let mut p = Planner::new(3, 3);
        p.plan(&[], &[], &[], true);
        assert!(p.lanes.iter().all(|l| l.is_empty()));
        assert_eq!(run(&["a", "b"], &[5, 5], 1).lanes, vec![vec![0, 1]]);
        assert_eq!(Planner::new(2, 0).lane_count(), 1, "zero lanes degrades to serial");
    }
}
