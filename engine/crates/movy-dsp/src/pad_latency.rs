//! Pad to sound, measured where both hosts look alike (`padlat`).
//!
//! From the block a live pad note reaches the engine (`on_midi`, which the
//! shim and movy-host both call before that frame's render) to the first block
//! its chain renders above `LOUD`. A harness polling the output from outside
//! cannot measure this fairly: each poll is a param round trip, and movy-host
//! answers params at the next frame boundary while the shim answers sooner, so
//! the outside number was the poll's cost, not the pad's (WP7 T6, 2026-10-10).
//!
//! 1 means the note sounded in the very render that followed it. One note is
//! in flight at a time; a note that never sounds is dropped after `GIVE_UP`.
//! Diagnostic only: two compares a block while armed, nothing otherwise.

const LOUD: i32 = 64;
const GIVE_UP: u64 = 1000;
const KEEP: usize = 32;

pub struct PadLatency {
    armed: Option<(u64, usize)>,
    ring: [u16; KEEP],
    n: usize,
}

impl PadLatency {
    pub const fn new() -> Self {
        PadLatency { armed: None, ring: [0; KEEP], n: 0 }
    }

    /// A pad note-on reached `chain` while `block` blocks had rendered.
    pub fn note_on(&mut self, block: u64, chain: usize) {
        if self.armed.is_none() {
            self.armed = Some((block, chain));
        }
    }

    /// After each render: `block` is the count including it.
    pub fn after_render(&mut self, block: u64, peak_of: impl Fn(usize) -> i32) {
        let Some((at, chain)) = self.armed else { return };
        let waited = block.saturating_sub(at);
        if peak_of(chain) > LOUD {
            self.ring[self.n % KEEP] = waited.min(u16::MAX as u64) as u16;
            self.n += 1;
            self.armed = None;
        } else if waited > GIVE_UP {
            self.armed = None;
        }
    }

    pub fn clear(&mut self) {
        *self = PadLatency::new();
    }

    /// `n=<count> med=<blocks> max=<blocks> last=<csv>`, the last `KEEP`.
    pub fn report(&self) -> String {
        let k = self.n.min(KEEP);
        let mut v: Vec<u16> = (0..k).map(|i| self.ring[(self.n - k + i) % KEEP]).collect();
        let last = v.iter().map(|x| x.to_string()).collect::<Vec<_>>().join(",");
        v.sort_unstable();
        let med = v.get(k / 2).copied().unwrap_or(0);
        let max = v.last().copied().unwrap_or(0);
        format!("n={} med={} max={} last={}", self.n, med, max, last)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_blocks_to_the_first_loud_one_on_that_chain() {
        let mut p = PadLatency::new();
        p.note_on(100, 2);
        p.after_render(101, |c| if c == 2 { 10 } else { 30000 });   // another chain is loud
        p.after_render(102, |_| 10);
        p.after_render(103, |c| if c == 2 { 5000 } else { 0 });
        assert_eq!(p.report(), "n=1 med=3 max=3 last=3");
    }

    #[test]
    fn a_second_note_does_not_restart_the_clock() {
        let mut p = PadLatency::new();
        p.note_on(10, 0);
        p.note_on(11, 0);
        p.after_render(11, |_| 9999);
        assert_eq!(p.report(), "n=1 med=1 max=1 last=1");
    }

    #[test]
    fn a_silent_note_is_given_up_and_the_next_one_measures() {
        let mut p = PadLatency::new();
        p.note_on(0, 0);
        p.after_render(GIVE_UP + 1, |_| 0);
        p.note_on(GIVE_UP + 5, 0);
        p.after_render(GIVE_UP + 6, |_| 9999);
        assert_eq!(p.report(), "n=1 med=1 max=1 last=1");
    }

    #[test]
    fn keeps_the_last_few_and_clears() {
        let mut p = PadLatency::new();
        for i in 0..40u64 {
            p.note_on(i * 10, 0);
            p.after_render(i * 10 + 1 + (i % 3), |_| 9999);
        }
        assert!(p.report().starts_with("n=40 med=2 max=3 last="));
        p.clear();
        assert_eq!(p.report(), "n=0 med=0 max=0 last=");
    }
}
