//! What the LAST block spent its time on, stage by stage and chain by chain,
//! for movy-host's glitch line (`host/glitch.c`).
//!
//! The CPU meter (`chain_cost`) keeps means and held peaks, which say a chain
//! is expensive but not what happened in the one block that clicked: a 16 ms
//! block every quarter second hides inside a mean, and a held peak cannot say
//! when it was set or what else ran with it. Only the stages that are NOT the
//! chain render (sequencer, Set service, module loads, LFO ticks, planning)
//! were untimed until now, and a block can be late in any of them.
//!
//! Overwritten every block and read only when movy-host has already decided
//! the frame was over budget, so the cost on a good block is a clock read
//! per stage and no formatting at all.

use std::time::Instant;

#[derive(Clone, Copy)]
pub enum Stage {
    /// Transport advance, sequencer events out, metronome.
    Seq,
    /// `service_set`: a Set open/save handed to the engine this block.
    Set,
    /// `service_loads`: the one queued module load released per block (dlopen).
    Load,
    /// LFO / MIDI-FX ticks for chains whose synth slept this block.
    Mod,
    /// Idle planning, the per-pad-send probe, the parallel replan.
    Plan,
    /// The chains themselves (wall time, serial or parallel).
    Render,
    /// Meters, the mix and send taps after the join.
    Mix,
    Send,
    Master,
}

const NAMES: [&str; 9] = ["seq", "set", "load", "mod", "plan", "render", "mix", "send", "master"];

#[derive(Default)]
pub struct BlockProf {
    ns: [u64; 9],
}

impl BlockProf {
    pub fn set(&mut self, s: Stage, ns: u64) {
        self.ns[s as usize] = ns;
    }

    /// Close the stage that ran since `t`, and start the next one from now.
    pub fn lap(&mut self, s: Stage, t: &mut Instant) {
        let now = Instant::now();
        self.ns[s as usize] = now.duration_since(*t).as_nanos() as u64;
        *t = now;
    }

    /// `seq=12 set=0 load=0 mod=3 ... top=3:obxd:5400,1:dexed:310` — µs. `top`
    /// is the three costliest chains of the block, `slot:module:us`, so the line
    /// names a module without the reader matching slot numbers to a Set.
    pub fn report(&self, chains: &[(usize, &str, u64)]) -> String {
        let mut s = String::with_capacity(160);
        for (i, n) in NAMES.iter().enumerate() {
            s.push_str(&format!("{}={} ", n, self.ns[i] / 1000));
        }
        s.push_str("top=");
        let mut top: Vec<_> = chains.iter().filter(|c| c.2 > 0).collect();
        top.sort_by(|a, b| b.2.cmp(&a.2));
        if top.is_empty() {
            s.push('-');
        }
        for (k, (slot, module, ns)) in top.iter().take(3).enumerate() {
            if k > 0 {
                s.push(',');
            }
            s.push_str(&format!("{}:{}:{}", slot, if module.is_empty() { "?" } else { module }, ns / 1000));
        }
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_names_every_stage_in_microseconds() {
        let mut p = BlockProf::default();
        p.set(Stage::Load, 15_900_000);
        let r = p.report(&[]);
        assert!(r.starts_with("seq=0 set=0 load=15900 mod=0 "), "{r}");
        assert!(r.ends_with("top=-"), "{r}");
    }

    #[test]
    fn top_is_the_three_costliest_chains_costliest_first() {
        let p = BlockProf::default();
        let r = p.report(&[(0, "dexed", 300_000), (3, "obxd", 5_400_000), (5, "", 900_000), (7, "x", 1_000), (9, "idle", 0)]);
        assert!(r.ends_with("top=3:obxd:5400,5:?:900,0:dexed:300"), "{r}");
    }
}
