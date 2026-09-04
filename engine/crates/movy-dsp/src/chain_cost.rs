//! What each chain's `render_block` actually costs, per block.
//!
//! Every other benchmark in this repo measures the TOTAL render and divides by
//! the chain count (`scripts/measure-chain-cpu.sh`, `scripts/bench-chain-cpu.sh`),
//! which can only ever report a mean. The parallel-render design is bounded by
//! the *largest single chain* — a static partition cannot finish before its
//! biggest member, no matter how many workers it has — so a mean is exactly the
//! statistic that hides the thing that decides the design.
//!
//! The measurement lives on the render path rather than in a benchmark build
//! because the distribution only exists in a real, mixed set. A dedicated build
//! would measure twelve copies of one synth, which is the one arrangement
//! guaranteed to look balanced.

use std::time::Instant;

/// Per-chain render cost, accumulated over a window that a read closes.
pub struct CostMeter {
    ns: Vec<u64>,
    max_ns: Vec<u32>,
    blocks: u64,
    /// Worst SUM over a single block. Compared against the sum of the per-chain
    /// maxima, this says whether the expensive chains peak *together* or take
    /// turns — a partition built from per-chain maxima is pessimistic by exactly
    /// that difference.
    worst_block_ns: u64,
    this_block_ns: u64,
    /// WALL time of the whole chain render, including fan-out and join.
    ///
    /// The per-chain sums above cannot show a speedup: parallel render does the
    /// same total work, just at the same time. Wall time is the only number that
    /// says whether splitting the block actually made the block shorter.
    wall_ns: u64,
    wall_max_ns: u64,
    /// Exponential mean per chain, for the render planner.
    ///
    /// Separate from `ns` because `report()` deliberately resets its window so a
    /// benchmark can discard the load phase — planning must not lose its history
    /// every time a device script reads the log.
    plan_ns: Vec<u64>,
    /// The CPU page's numbers.
    ///
    /// Deliberately NOT `ns` / `max_ns` / `wall_max_ns`: reading `report()`
    /// closes that window, and a device benchmark closes it whenever it likes.
    /// A peak the user is looking at must not disappear because someone read a
    /// log, so these live on their own reset schedule (`ui_reset`, driven by the
    /// `cpurst` command the page issues when it opens).
    ui_synth_ns: Vec<u64>,
    ui_peak_ns: Vec<u32>,
    ui_wall_ns: u64,
    ui_wall_peak_ns: u32,
}

impl CostMeter {
    pub fn new(chains: usize) -> Self {
        Self {
            ns: vec![0; chains],
            max_ns: vec![0; chains],
            blocks: 0,
            worst_block_ns: 0,
            this_block_ns: 0,
            wall_ns: 0,
            wall_max_ns: 0,
            plan_ns: vec![0; chains],
            ui_synth_ns: vec![0; chains],
            ui_peak_ns: vec![0; chains],
            ui_wall_ns: 0,
            ui_wall_peak_ns: 0,
        }
    }

    /// Two vDSO clock reads bracket a render that costs tens of microseconds —
    /// ~0.02% of the frame. Cheap enough to leave permanently on, which is what
    /// keeps the numbers honest about sets people actually play.
    pub fn start(&self) -> Instant {
        Instant::now()
    }

    pub fn stop(&mut self, t0: Instant, chain: usize) {
        self.add_ns(chain, t0.elapsed().as_nanos() as u64);
    }

    /// Record a render that was timed elsewhere — the render pool times each
    /// chain on the helper that ran it, since the audio thread cannot bracket a
    /// call it did not make.
    pub fn add_ns(&mut self, chain: usize, dt: u64) {
        self.this_block_ns += dt;
        let Some(slot) = self.ns.get_mut(chain) else { return };
        *slot += dt;
        // 1/16 exponential mean: settles in a couple of hundred blocks (well
        // under a second) yet ignores the single expensive block a note-on
        // causes, which would otherwise flip the plan on every keypress.
        let p = &mut self.plan_ns[chain];
        *p = if *p == 0 { dt } else { *p - *p / 16 + dt / 16 };
        // Saturate rather than wrap: a 4.2 s single block is not a real reading,
        // but a wrapped one would read as ~0 and look like the cheapest chain.
        let capped = dt.min(u32::MAX as u64) as u32;
        if capped > self.max_ns[chain] {
            self.max_ns[chain] = capped;
        }
        if capped > self.ui_peak_ns[chain] {
            self.ui_peak_ns[chain] = capped;
        }
    }

    /// The synth stage of one block, for the chains that render in two calls.
    ///
    /// A chain that does not split — `chidle 0`, or a module whose chain host
    /// does not export the FX trio — renders everything inside `render_block`,
    /// so its synth cost IS its total and the FX segment comes out empty. That
    /// is why the meter needs no branch for CPU Optimize being off.
    pub fn add_synth_ns(&mut self, chain: usize, dt: u64) {
        let Some(p) = self.ui_synth_ns.get_mut(chain) else { return };
        *p = if *p == 0 { dt } else { *p - *p / 16 + dt / 16 };
    }

    /// Wall time of one block's whole chain render.
    pub fn add_wall(&mut self, dt: u64) {
        self.wall_ns += dt;
        if dt > self.wall_max_ns {
            self.wall_max_ns = dt;
        }
        self.ui_wall_ns =
            if self.ui_wall_ns == 0 { dt } else { self.ui_wall_ns - self.ui_wall_ns / 16 + dt / 16 };
        let capped = dt.min(u32::MAX as u64) as u32;
        if capped > self.ui_wall_peak_ns {
            self.ui_wall_peak_ns = capped;
        }
    }

    /// Close one block. Only called when at least one chain rendered, so the
    /// mean is over blocks that had work in them.
    pub fn end_block(&mut self) {
        self.blocks += 1;
        if self.this_block_ns > self.worst_block_ns {
            self.worst_block_ns = self.this_block_ns;
        }
        self.this_block_ns = 0;
    }

    /// `blocks=<n> worst=<ns> wall=<mean>/<max> cost=<mean>/<max>,...` —
    /// nanoseconds, one `cost` pair per chain.
    ///
    /// `wall` stays ahead of `cost=` because `measure-chain-balance.sh` reads
    /// the chain pairs as everything after `cost=`.
    ///
    /// **Reading resets the window.** Successive reads are disjoint, so a
    /// benchmark can throw away the load-and-warm-up phase instead of letting it
    /// dominate the mean for the rest of the run.
    pub fn report(&mut self) -> String {
        let div = self.blocks.max(1);
        let mut out = format!(
            "blocks={} worst={} wall={}/{} cost=",
            self.blocks,
            self.worst_block_ns,
            self.wall_ns / div,
            self.wall_max_ns
        );
        for i in 0..self.ns.len() {
            if i > 0 {
                out.push(',');
            }
            out.push_str(&format!("{}/{}", self.ns[i] / div, self.max_ns[i]));
        }
        self.reset();
        out
    }

    /// Per-chain cost the render planner should assume. Survives `report()`.
    pub fn plan_ns(&self) -> &[u64] {
        &self.plan_ns
    }

    /// `(total mean, synth mean, held peak)` in nanoseconds, for one chain.
    pub fn ui_costs(&self, chain: usize) -> (u64, u64, u32) {
        (
            self.plan_ns.get(chain).copied().unwrap_or(0),
            self.ui_synth_ns.get(chain).copied().unwrap_or(0),
            self.ui_peak_ns.get(chain).copied().unwrap_or(0),
        )
    }

    /// `(mean, held peak)` of the whole chain render, in nanoseconds.
    pub fn ui_wall(&self) -> (u64, u32) {
        (self.ui_wall_ns, self.ui_wall_peak_ns)
    }

    /// Clear the held peaks. The means are left alone — they settle in a couple
    /// of hundred blocks, and blanking them would make the page open on zeros.
    pub fn ui_reset(&mut self) {
        for v in self.ui_peak_ns.iter_mut() {
            *v = 0;
        }
        self.ui_wall_peak_ns = 0;
    }

    /// Forget the planning history too. Only for teardown: the costs belong to
    /// chain instances that no longer exist, and a plan built from a dead set
    /// would put the wrong chains on the wrong lanes.
    pub fn reset_all(&mut self) {
        self.reset();
        for v in self.plan_ns.iter_mut() {
            *v = 0;
        }
        for v in self.ui_synth_ns.iter_mut() {
            *v = 0;
        }
        // The mean too, not just the peak `ui_reset` clears: these costs belong
        // to chain instances that no longer exist, and the page would open on
        // the last set's numbers.
        self.ui_wall_ns = 0;
        self.ui_reset();
    }

    pub fn reset(&mut self) {
        for v in self.ns.iter_mut() {
            *v = 0;
        }
        for v in self.max_ns.iter_mut() {
            *v = 0;
        }
        self.blocks = 0;
        self.worst_block_ns = 0;
        self.this_block_ns = 0;
        self.wall_ns = 0;
        self.wall_max_ns = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_has_one_pair_per_chain_and_survives_zero_blocks() {
        let mut m = CostMeter::new(12);
        let r = m.report();
        assert!(r.starts_with("blocks=0 worst=0 wall=0/0 cost="), "{r}");
        let pairs = r.split("cost=").nth(1).unwrap();
        assert_eq!(pairs.split(',').count(), 12, "{r}");
        // Dividing by a zero block count must not panic — a report can be taken
        // before anything has rendered.
        assert!(pairs.split(',').all(|p| p == "0/0"), "{r}");
    }

    #[test]
    fn reading_closes_the_window() {
        let mut m = CostMeter::new(2);
        let t = m.start();
        m.stop(t, 0);
        m.end_block();
        assert!(m.report().starts_with("blocks=1 "));
        assert!(
            m.report().starts_with("blocks=0 "),
            "a second read must see a fresh window, not the same one again"
        );
    }

    /// `measure-chain-balance.sh` takes the per-chain pairs as everything after
    /// `cost=`, so a field appended after it would be parsed as chain 0's cost
    /// and silently corrupt every balance measurement.
    #[test]
    fn wall_is_reported_before_the_chain_pairs() {
        let mut m = CostMeter::new(2);
        m.add_ns(0, 700);
        m.add_wall(1000);
        m.end_block();
        let r = m.report();
        assert!(r.contains("wall=1000/1000"), "{r}");
        assert_eq!(r.split("cost=").nth(1).unwrap(), "700/700,0/0", "{r}");
    }

    /// The planner reads costs on the audio thread; device benchmarks read
    /// `report()` whenever they like. If a read wiped the planning history the
    /// plan would collapse to "all costs zero" — an even split — every time
    /// someone looked at the log, which is invisible unless asserted.
    #[test]
    fn reading_the_report_does_not_wipe_the_planning_costs() {
        let mut m = CostMeter::new(2);
        for _ in 0..64 {
            m.add_ns(0, 1000);
        }
        m.end_block();
        let before = m.plan_ns()[0];
        assert!(before > 0);
        m.report();
        assert_eq!(m.plan_ns()[0], before, "report() must not touch the plan costs");
        m.reset_all();
        assert_eq!(m.plan_ns()[0], 0, "teardown must");
    }

    /// One expensive block must not carry the plan. A note-on costs several
    /// times a steady block, and a plan that followed the last block would move
    /// chains between lanes on every keypress.
    ///
    /// A 1/16 mean cannot *ignore* a spike — it takes 1/16 of it, so a 100x
    /// block does move it. What it guarantees, and what the plan needs, is that
    /// no single block dominates and that the mean returns to the steady value.
    #[test]
    fn the_planning_mean_is_not_carried_by_one_block() {
        let mut m = CostMeter::new(1);
        for _ in 0..200 {
            m.add_ns(0, 1000);
        }
        let steady = m.plan_ns()[0];
        assert!((900..=1100).contains(&steady), "settled at {steady}, expected ~1000");

        m.add_ns(0, 100_000);
        let peak = m.plan_ns()[0];
        assert!(peak < 100_000 / 10, "one block took the mean to {peak} of a 100000 spike");

        for _ in 0..200 {
            m.add_ns(0, 1000);
        }
        let after = m.plan_ns()[0];
        assert!((900..=1100).contains(&after), "did not decay back: {after}");
    }

    #[test]
    fn an_out_of_range_chain_is_ignored_not_panicked_on() {
        let mut m = CostMeter::new(2);
        let t = m.start();
        m.stop(t, 99);
        m.end_block();
        let r = m.report();
        assert_eq!(r.split("cost=").nth(1).unwrap().split(',').count(), 2, "{r}");
    }

    /// The whole reason the page has its own numbers: `report()` belongs to
    /// whichever device script is measuring, and it may fire at any moment. A
    /// peak the page is holding must not vanish because someone read the log.
    #[test]
    fn the_held_peak_survives_a_report_and_clears_only_on_its_own_reset() {
        let mut m = CostMeter::new(2);
        m.add_ns(0, 5_000);
        m.add_ns(0, 90_000);
        m.end_block();
        assert_eq!(m.ui_costs(0).2, 90_000, "the worst block is held");
        m.report();
        assert_eq!(m.ui_costs(0).2, 90_000, "a benchmark's read must not clear it");
        m.ui_reset();
        assert_eq!(m.ui_costs(0).2, 0, "cpurst clears it");
    }

    /// The bar draws a synth segment and an FX segment. The synth mean is its
    /// own signal, on the same 1/16 settling as the total.
    #[test]
    fn the_synth_mean_is_separate_from_the_total() {
        let mut m = CostMeter::new(1);
        for _ in 0..200 {
            m.add_ns(0, 1000);
            m.add_synth_ns(0, 600);
        }
        let (total, synth, _) = m.ui_costs(0);
        assert!((900..=1100).contains(&total), "total settled at {total}");
        assert!((540..=660).contains(&synth), "synth settled at {synth}");
        assert!(synth < total, "the synth is a part of the whole, not the whole");
    }

    /// A chain asleep under `chidle` builds no task at all, so nothing measures
    /// it. Feeding a zero is what makes the mean say "this costs nothing now" —
    /// without it the planner keeps budgeting a lane for a silent chain and the
    /// meter draws a bar for a chain that is rendering nothing.
    ///
    /// The mean FLOORS rather than reaching zero: `p - p/16` stops moving once
    /// `p < 16`, which is 15 ns — below the microsecond the page draws in.
    #[test]
    fn a_block_a_chain_did_not_work_in_decays_its_mean() {
        let mut m = CostMeter::new(1);
        for _ in 0..300 {
            m.add_ns(0, 800_000);
        }
        assert!(m.plan_ns()[0] > 700_000);
        for _ in 0..300 {
            m.add_ns(0, 0);
        }
        assert!(m.plan_ns()[0] < 16, "did not decay: {}", m.plan_ns()[0]);
        assert!(m.ui_costs(0).0 < 16, "the page's mean must decay with it");
    }

    /// The wall is the capacity bar. Same two numbers, same reset.
    #[test]
    fn the_wall_has_a_held_peak_too() {
        let mut m = CostMeter::new(1);
        for _ in 0..200 {
            m.add_wall(1_000_000);
        }
        m.add_wall(2_500_000);
        let (mean, peak) = m.ui_wall();
        assert!((900_000..=1_200_000).contains(&mean), "wall mean {mean}");
        assert_eq!(peak, 2_500_000, "the worst block is what the notch marks");
        m.report();
        assert_eq!(m.ui_wall().1, 2_500_000, "and it survives a benchmark read");
        m.ui_reset();
        assert_eq!(m.ui_wall().1, 0);
    }

    /// Teardown means the chains are gone. Everything about them goes with them,
    /// including the page's numbers — otherwise the meter draws the last set.
    #[test]
    fn reset_all_clears_the_page_numbers_too() {
        let mut m = CostMeter::new(1);
        m.add_ns(0, 40_000);
        m.add_synth_ns(0, 20_000);
        m.add_wall(50_000);
        m.reset_all();
        assert_eq!(m.ui_costs(0), (0, 0, 0));
        assert_eq!(m.ui_wall(), (0, 0));
    }
}
