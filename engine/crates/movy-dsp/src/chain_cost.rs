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
}

impl CostMeter {
    pub fn new(chains: usize) -> Self {
        Self {
            ns: vec![0; chains],
            max_ns: vec![0; chains],
            blocks: 0,
            worst_block_ns: 0,
            this_block_ns: 0,
        }
    }

    /// Two vDSO clock reads bracket a render that costs tens of microseconds —
    /// ~0.02% of the frame. Cheap enough to leave permanently on, which is what
    /// keeps the numbers honest about sets people actually play.
    pub fn start(&self) -> Instant {
        Instant::now()
    }

    pub fn stop(&mut self, t0: Instant, chain: usize) {
        let dt = t0.elapsed().as_nanos() as u64;
        self.this_block_ns += dt;
        let Some(slot) = self.ns.get_mut(chain) else { return };
        *slot += dt;
        // Saturate rather than wrap: a 4.2 s single block is not a real reading,
        // but a wrapped one would read as ~0 and look like the cheapest chain.
        let capped = dt.min(u32::MAX as u64) as u32;
        if capped > self.max_ns[chain] {
            self.max_ns[chain] = capped;
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

    /// `blocks=<n> worst=<ns> cost=<mean>/<max>,...` — one pair per chain,
    /// nanoseconds.
    ///
    /// **Reading resets the window.** Successive reads are disjoint, so a
    /// benchmark can throw away the load-and-warm-up phase instead of letting it
    /// dominate the mean for the rest of the run.
    pub fn report(&mut self) -> String {
        let div = self.blocks.max(1);
        let mut out = format!("blocks={} worst={} cost=", self.blocks, self.worst_block_ns);
        for i in 0..self.ns.len() {
            if i > 0 {
                out.push(',');
            }
            out.push_str(&format!("{}/{}", self.ns[i] / div, self.max_ns[i]));
        }
        self.reset();
        out
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
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_has_one_pair_per_chain_and_survives_zero_blocks() {
        let mut m = CostMeter::new(12);
        let r = m.report();
        assert!(r.starts_with("blocks=0 worst=0 cost="), "{r}");
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

    #[test]
    fn an_out_of_range_chain_is_ignored_not_panicked_on() {
        let mut m = CostMeter::new(2);
        let t = m.start();
        m.stop(t, 99);
        m.end_block();
        let r = m.report();
        assert_eq!(r.split("cost=").nth(1).unwrap().split(',').count(), 2, "{r}");
    }
}
