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
    pub fn plan(&mut self, modules: &[String], cost_ns: &[u64], loaded: &[bool]) {
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
            match self.heads.iter().position(|&h| modules[h] == modules[c]) {
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
                if loaded[c] && modules[c] == modules[head] {
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

    fn run(mods: &[&str], costs: &[u64], lanes: usize) -> Planner {
        let m: Vec<String> = mods.iter().map(|s| s.to_string()).collect();
        let loaded = vec![true; mods.len()];
        let mut p = Planner::new(mods.len(), lanes);
        p.plan(&m, costs, &loaded);
        p
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
