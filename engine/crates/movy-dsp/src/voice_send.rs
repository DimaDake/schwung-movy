//! Per-pad sends: a drum module's own per-voice Send A / Send B, summed into
//! movy's SEND 1 / SEND 2.
//!
//! The module and the chain host already do all of the audio work — the module
//! renders each voice apart and publishes where its levels live
//! (`voice_send_params`), and the chain host polls them and keeps a pool
//! buffer per sending voice. `chain_drain_sends` hands those to whoever owns
//! the send buses. Schwung's shim calls it for its own slots; a movy chain is a
//! PRIVATE chain-host instance, so nobody did, and a pad's Send A knob wrote a
//! level nothing ever read. (`plans/2026-10-03-per-pad-sends.md`.)
//!
//! What movy owns, and what lives here: which chains drain at all, and which
//! chains count as FEEDING a bus. The second one is not a balance question.
//! `chain_colo` puts a bus on its feeders' lane, and only that lane may write
//! the bus buffer — so a chain whose pads send while it is not a feeder would
//! be two threads on one buffer. The feed is OBSERVED (a non-zero drained
//! block) rather than read from the levels, because a level is a module param
//! movy would have to poll per pad, while the drain is already the answer.
//!
//! Free of chain, host and FFI types, as `chain_colo` and `send_bus` are.

/// The module contract's cap: `voice_send_params` is refused above two. Entry
/// `k` is movy's send bus `k` — Send A → SEND 1, Send B → SEND 2. SEND 3 has no
/// per-pad source and is reached from the MIX page only.
pub const VOICE_SENDS: usize = 2;

/// 128 frames stereo — the chain's block, and `chain_drain_sends`' clamp.
const VOICE_SAMPLES: usize = 128 * 2;

/// How long a chain stays a feeder after its pads last sent anything, in
/// blocks (~2 s at 2.9 ms).
///
/// A drum pattern sends in bursts with silence between hits. Dropping out of
/// the feeder set at every gap would replan on every note, and each re-entry
/// costs the block it arrives on (see `observe`). Two seconds outlasts any
/// gap inside a groove and still lets an abandoned send release its lane.
pub const VOICE_HOLD_BLOCKS: u32 = 690;

/// Whether a `voice_send_params` answer declares at least one send.
///
/// The chain host refuses a malformed declaration on its own side, so this only
/// has to tell "declares something" from "declares nothing" — `""` (served,
/// nothing) and `[]` both mean no per-pad sends. Every valid entry carries
/// `{id}`, which is what is looked for.
pub fn declares(answer: &[u8]) -> bool {
    answer.windows(4).any(|w| w == b"{id}")
}

pub struct VoiceSends {
    /// Whether chain `c`'s module declares per-pad sends. Refreshed one chain
    /// per block by the caller's probe, because a synth swap is a plain param
    /// write that bumps no generation movy could watch.
    declares: Vec<bool>,
    /// Whether `scratch[c]` holds THIS block's drain. Decided before the render
    /// — the parallel path builds its task list up front.
    drained: Vec<bool>,
    /// Blocks left before chain `c` stops counting as a feeder of send `k`.
    hold: Vec<[u32; VOICE_SENDS]>,
    /// One pair of buffers per chain, owned by that chain — so the lane that
    /// renders it can drain into them with no synchronisation, by the same
    /// partition argument as the chain's own scratch.
    scratch: Vec<[Vec<i16>; VOICE_SENDS]>,
    probe: usize,
}

impl VoiceSends {
    pub fn new(chains: usize) -> Self {
        Self {
            declares: vec![false; chains],
            drained: vec![false; chains],
            hold: vec![[0; VOICE_SENDS]; chains],
            scratch: (0..chains)
                .map(|_| core::array::from_fn(|_| vec![0i16; VOICE_SAMPLES]))
                .collect(),
            probe: 0,
        }
    }

    /// The chain to ask about its declaration this block. Round-robin, one per
    /// block, so the cost is one `get_param` whatever the chain count.
    pub fn next_probe(&mut self) -> usize {
        let c = self.probe;
        self.probe = (self.probe + 1) % self.declares.len().max(1);
        c
    }

    /// Record a probe's answer. Answers whether a feed was dropped — a module
    /// swapped away from under a held feed must leave the feeder set now, not
    /// two seconds later, so the caller replans.
    pub fn set_declares(&mut self, c: usize, d: bool) -> bool {
        let Some(slot) = self.declares.get_mut(c) else { return false };
        *slot = d;
        if d {
            return false;
        }
        let was = self.hold[c].iter().any(|&h| h > 0);
        self.hold[c] = [0; VOICE_SENDS];
        was
    }

    pub fn declares_mask(&self) -> u16 {
        mask(self.declares.iter().copied())
    }

    /// Decide, before the render, whether chain `c` drains this block. Only a
    /// chain whose synth RENDERS: the chain host clears its voice mask only on
    /// a render, so draining a sleeping chain would resend its last block of
    /// pad audio every block for as long as it slept.
    pub fn plan(&mut self, c: usize, synth_rendered: bool) -> bool {
        let d = synth_rendered && self.declares.get(c).copied().unwrap_or(false);
        if let Some(x) = self.drained.get_mut(c) {
            *x = d;
        }
        d
    }

    pub fn drained(&self, c: usize) -> bool {
        self.drained.get(c).copied().unwrap_or(false)
    }

    /// Chain `c`'s two buffers as raw pointers, for whichever thread renders
    /// the chain. Not cleared here: `render_pool::drain_voices` clears them on
    /// that thread — the audio thread must not touch a buffer a lane is about
    /// to own.
    pub fn raw_ptrs(&mut self, c: usize) -> [*mut i16; VOICE_SENDS] {
        let s = &mut self.scratch[c];
        core::array::from_fn(|k| s[k].as_mut_ptr())
    }

    pub fn buf(&self, c: usize, k: usize) -> &[i16] {
        &self.scratch[c][k]
    }

    /// Fold one block's drain into the feed state. `peaks[k]` is the drained
    /// block's peak for send `k`; a chain that did not drain this block passes
    /// zeros, which only ages its hold.
    ///
    /// Answers whether the feeder set CHANGED — the caller's replan trigger, and
    /// only on a change: a pattern riding the send every block must not replan
    /// every block (`a_send_gain_crossing_zero_forces_a_replan`'s twin rule).
    pub fn observe(&mut self, c: usize, peaks: [i32; VOICE_SENDS]) -> bool {
        let Some(h) = self.hold.get_mut(c) else { return false };
        let mut changed = false;
        for k in 0..VOICE_SENDS {
            let before = h[k] > 0;
            if peaks[k] > 0 {
                h[k] = VOICE_HOLD_BLOCKS;
            } else {
                h[k] = h[k].saturating_sub(1);
            }
            changed |= before != (h[k] > 0);
        }
        changed
    }

    /// Chains currently feeding send `k` through their pads, as a mask over
    /// chain index — what `chain_colo::feeders` ORs in.
    pub fn feeds(&self, k: usize) -> u16 {
        mask(self.hold.iter().map(|h| h.get(k).is_some_and(|&x| x > 0)))
    }
}

fn mask(bits: impl Iterator<Item = bool>) -> u16 {
    bits.take(16).enumerate().fold(0u16, |m, (i, b)| if b { m | (1 << i) } else { m })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_declaration_is_any_entry_carrying_the_id_token() {
        assert!(declares(br#"["{id}_send_a","{id}_send_b"]"#));
        assert!(declares(br#"["{id}_send1"]"#));
        assert!(!declares(b""), "served-but-empty is no sends");
        assert!(!declares(b"[]"));
    }

    /// The bug the drain gate exists for: the chain host's voice mask is only
    /// cleared by a render, so a sleeping chain must not drain.
    #[test]
    fn only_a_rendering_chain_that_declares_drains() {
        let mut v = VoiceSends::new(4);
        assert!(!v.plan(1, true), "nothing declared yet");
        v.set_declares(1, true);
        assert!(!v.plan(1, false), "a sleeping synth's pool buffers are last block's");
        assert!(!v.drained(1));
        assert!(v.plan(1, true));
        assert!(v.drained(1));
        assert!(!v.plan(2, true), "declaration is per chain");
    }

    #[test]
    fn a_sending_pad_makes_its_chain_a_feeder_of_that_bus_only() {
        let mut v = VoiceSends::new(4);
        assert!(v.observe(3, [0, 900]), "entering the feeder set is a change");
        assert_eq!(v.feeds(0), 0);
        assert_eq!(v.feeds(1), 1 << 3);
    }

    /// A groove sends in bursts. Leaving the feeder set at every gap would
    /// replan on every hit.
    #[test]
    fn the_feed_outlasts_the_gaps_between_hits_and_then_releases() {
        let mut v = VoiceSends::new(2);
        v.observe(0, [500, 0]);
        for _ in 0..VOICE_HOLD_BLOCKS - 1 {
            assert!(!v.observe(0, [0, 0]), "a gap is not a feeder change");
        }
        assert_eq!(v.feeds(0), 1);
        assert!(v.observe(0, [0, 0]), "the hold ran out: that IS a change");
        assert_eq!(v.feeds(0), 0);
    }

    #[test]
    fn riding_the_send_every_block_never_reports_a_change() {
        let mut v = VoiceSends::new(1);
        v.observe(0, [1, 1]);
        for _ in 0..1000 {
            assert!(!v.observe(0, [700, 300]));
        }
    }

    /// A Simian swapped for a synth with no pads must leave the feeder set at
    /// once, or its bus stays pinned to that lane for two seconds of nothing.
    #[test]
    fn losing_the_declaration_drops_a_held_feed_and_says_so() {
        let mut v = VoiceSends::new(2);
        v.set_declares(1, true);
        v.observe(1, [10, 10]);
        assert!(v.set_declares(1, false));
        assert_eq!(v.feeds(0) | v.feeds(1), 0);
        assert!(!v.set_declares(1, false), "nothing held, nothing to replan");
    }

    #[test]
    fn the_probe_visits_every_chain_in_turn() {
        let mut v = VoiceSends::new(3);
        let seen: Vec<usize> = (0..6).map(|_| v.next_probe()).collect();
        assert_eq!(seen, vec![0, 1, 2, 0, 1, 2]);
    }
}
