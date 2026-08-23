//! Which chains each render lane takes.
//!
//! A static partition cannot finish before its largest member, so the assignment
//! — not the worker count — is what parallel render actually costs. Lane 0 is
//! the audio thread itself; lanes 1.. are helper threads.
//!
//! **Whether two chains may share a lane is decided in `chain_pin`, not here.**
//! This file sees only `pin_key`: empty for a chain that may render anywhere,
//! and a shared `<namespace>/<module>` for one that must stay with its
//! siblings. Modules are assumed thread-safe, so keys are empty unless a module
//! is blacklisted or `chpin` is on — twelve chains of one module now spread
//! across every lane where they used to collapse onto one and return exactly
//! 1.00x. Twelve drum tracks is a set people build.
//!
//! Keeping the policy out of the planner is what makes it one decision in one
//! place. Grouping used to happen here on the synth id *and* be gated by a flag,
//! which could not express two chains sharing an audio FX while running
//! different synths — airwindows is an FX pack and the module in the fleet most
//! likely to appear twice in one set.
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
    /// `pin_key[c]` names what chain `c` must stay beside, and is EMPTY when it
    /// may render anywhere — an empty key is its own group, never matched
    /// against another empty one. Matching them would put every free chain back
    /// on one lane, which is the exact outcome pinning exists to avoid.
    /// `cost_ns[c]` is the chain's recent mean render cost — zero before it has
    /// rendered, which degrades to an even split rather than a bad one.
    pub fn plan(&mut self, pin_key: &[String], cost_ns: &[u64], loaded: &[bool]) {
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
            let existing = if pin_key[c].is_empty() {
                None
            } else {
                self.heads.iter().position(|&h| pin_key[h] == pin_key[c])
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
                // A free chain's group is exactly itself, so the membership test
                // has to be identity rather than key equality — otherwise every
                // empty-keyed chain would match every other and be scheduled
                // once per sibling.
                let member = if pin_key[head].is_empty() {
                    c == head
                } else {
                    pin_key[c] == pin_key[head]
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

    fn run(keys: &[&str], costs: &[u64], lanes: usize) -> Planner {
        let m: Vec<String> = keys.iter().map(|s| s.to_string()).collect();
        let loaded = vec![true; keys.len()];
        let mut p = Planner::new(keys.len(), lanes);
        p.plan(&m, costs, &loaded);
        p
    }

    /// The safety property. Chains `chain_pin` gave a shared key must never be
    /// split — that is the whole content of a pin.
    #[test]
    fn chains_sharing_a_key_never_split() {
        let p = run(&["sg/obxd", "sg/obxd", ""], &[100, 100, 100], 3);
        let with_obxd: Vec<_> =
            p.lanes.iter().filter(|l| l.contains(&0) || l.contains(&1)).collect();
        assert_eq!(with_obxd.len(), 1, "both obxd chains must share ONE lane: {:?}", p.lanes);
        assert_eq!(with_obxd[0], &vec![0, 1]);
    }

    /// The degenerate set, blacklisted (or `chpin 1`): twelve chains keyed alike
    /// collapse onto one lane and buy nothing. That is the cost of containment,
    /// stated as a plan.
    #[test]
    fn twelve_chains_with_one_key_cannot_be_split() {
        let p = run(&["sg/helm"; 12], &[100; 12], 3);
        assert_eq!(p.makespan(), 1200);
        assert_eq!(p.lanes.iter().filter(|l| !l.is_empty()).count(), 1);
    }

    /// The default, and the point of the revert. Twelve chains of one module,
    /// nothing blacklisted, so every key is empty and all three lanes fill.
    /// Empty keys must NOT match each other; if they did this would read exactly
    /// like the pinned case and the whole change would buy nothing.
    #[test]
    fn free_chains_spread_across_lanes() {
        let p = run(&[""; 12], &[100; 12], 3);
        assert_eq!(p.makespan(), 400, "{:?}", p.lanes);
        assert!(p.lanes.iter().all(|l| l.len() == 4), "{:?}", p.lanes);
    }

    /// Free scheduling must still schedule each chain exactly once. The
    /// membership test turns on whether the head's key is empty, and a group
    /// that kept matching key-to-key would place every free chain once per
    /// sibling — three chains would render nine times, which sounds like
    /// distortion rather than like a planner bug.
    #[test]
    fn free_chains_are_each_scheduled_exactly_once() {
        let p = run(&["", "", "", ""], &[10, 10, 10, 10], 2);
        let mut seen: Vec<usize> = p.lanes.iter().flatten().copied().collect();
        seen.sort_unstable();
        assert_eq!(seen, vec![0, 1, 2, 3], "{:?}", p.lanes);
    }

    /// Mixed is the realistic state, not an edge case: one blacklisted module
    /// held twice while everything else runs free.
    #[test]
    fn a_pinned_pair_does_not_drag_the_free_chains_along() {
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

    /// A free chain and a pinned one must never be merged just because both
    /// arrive at the same lane. The plan is the safety property; a lane holding
    /// a pinned group plus a passer-by is fine, a group that ABSORBED it is not.
    #[test]
    fn a_free_chain_is_never_absorbed_into_a_pinned_group() {
        let p = run(&["sg/helm", "", "sg/helm"], &[100, 100, 100], 2);
        let helm_lane = p.lanes.iter().position(|l| l.contains(&0)).unwrap();
        assert!(p.lanes[helm_lane].contains(&2));
        assert!(!p.lanes[helm_lane].contains(&1), "{:?}", p.lanes);
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
        p.plan(&m, &[10, 20, 30, 40, 50, 60], &loaded);
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
            p.plan(&m, &[5, 3, 1], &[true, true, true]);
        }
        let seen: Vec<usize> = p.lanes.iter().flatten().copied().collect();
        assert_eq!(seen.len(), 3, "{:?}", p.lanes);
        assert_eq!(p.makespan(), 5);
    }

    #[test]
    fn empty_and_single_lane_are_not_special_cases() {
        let mut p = Planner::new(3, 3);
        p.plan(&[], &[], &[]);
        assert!(p.lanes.iter().all(|l| l.is_empty()));
        assert_eq!(run(&["a", "b"], &[5, 5], 1).lanes, vec![vec![0, 1]]);
        assert_eq!(Planner::new(2, 0).lane_count(), 1, "zero lanes degrades to serial");
    }
}
