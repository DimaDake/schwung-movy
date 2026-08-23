//! Which chains each render lane takes.
//!
//! A static partition cannot finish before its largest member, so the assignment
//! — not the worker count — is what parallel render actually costs. Lane 0 is
//! the audio thread itself; lanes 1.. are helper threads.
//!
//! **Same-module chains share a lane.** Two chains holding one module share its
//! `dlopen` mapping and therefore its whole `.data`/`.bss`
//! (`plans/2026-08-22-module-isolation.md`): six fleet modules mutate that state
//! from `render_block`, and twelve more reach the chain host's clock globals
//! through `get_clock_status`. Pinned to one lane they stay serial, exactly as
//! today, and none of it can race. It costs makespan — 6.7% on a varied set,
//! 27.6% on four distinct modules across twelve chains — and that is the price
//! of not auditing 93 module repos before the first prototype runs.
//!
//! **This is the floor, not the design.** Pinning is applied to every duplicate,
//! and only ~18 of 78 audio modules need it: all four duplicated modules in the
//! 2.23x measurement were on neither hazard list, so every pin there protected
//! against nothing. The tiering that replaces it — run clean duplicates free,
//! pin flagged ones, copy only a flagged module that dominates the set — is
//! §5 of `plans/2026-08-23-parallel-render-prototype.md`. It matters most on the
//! set this cannot help at all: twelve chains of one module return exactly 1.00x,
//! which `twelve_of_one_module_cannot_be_split` pins as a fact rather than a
//! target.
//!
//! **`pin_duplicates` can be turned off, and doing so is deliberately unsafe.**
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
    /// `modules[c]` is the chain's module id and `cost_ns[c]` its recent mean
    /// render cost — zero before it has rendered, which degrades to an even
    /// split rather than a bad one.
    ///
    /// `pin_duplicates` is passed in rather than held as state so that rebuilding
    /// the planner — which `set_lanes` does on every lane change — cannot
    /// silently drop it and turn a split-duplicate measurement back into a
    /// pinned one that still reports itself as split.
    pub fn plan(
        &mut self,
        modules: &[String],
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
            let existing = if pin_duplicates {
                self.heads.iter().position(|&h| modules[h] == modules[c])
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
                let member =
                    if pin_duplicates { modules[c] == modules[head] } else { c == head };
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

    fn run_with(mods: &[&str], costs: &[u64], lanes: usize, pin: bool) -> Planner {
        let m: Vec<String> = mods.iter().map(|s| s.to_string()).collect();
        let loaded = vec![true; mods.len()];
        let mut p = Planner::new(mods.len(), lanes);
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
    fn same_module_chains_never_split() {
        let p = run(&["obxd", "obxd", "helm"], &[100, 100, 100], 3);
        let with_obxd: Vec<_> =
            p.lanes.iter().filter(|l| l.contains(&0) || l.contains(&1)).collect();
        assert_eq!(with_obxd.len(), 1, "both obxd chains must share ONE lane: {:?}", p.lanes);
        assert_eq!(with_obxd[0], &vec![0, 1]);
    }

    /// The degenerate set that decides whether pinning could be the whole
    /// answer: twelve of one module collapse onto one lane and buy nothing.
    #[test]
    fn twelve_of_one_module_cannot_be_split() {
        let p = run(&["helm"; 12], &[100; 12], 3);
        assert_eq!(p.makespan(), 1200);
        assert_eq!(p.lanes.iter().filter(|l| !l.is_empty()).count(), 1);
    }

    /// Unpinned, the same set is what parallel render would look like if the
    /// audit in §5 is right about every module in it — and it is the stimulus
    /// the oracle needs, since a pinned duplicate never races anything.
    #[test]
    fn unpinned_duplicates_land_on_different_lanes() {
        let p = run_with(&["helm"; 12], &[100; 12], 3, false);
        assert_eq!(p.makespan(), 400, "{:?}", p.lanes);
        assert!(p.lanes.iter().all(|l| l.len() == 4), "{:?}", p.lanes);
    }

    /// Unpinned scheduling must still schedule each chain exactly once. The
    /// membership test changes with the flag, and a group that kept matching by
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
