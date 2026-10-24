//! Which tracks are frozen, capturing or thawing, and the audio-thread side
//! of each (plans/2026-10-23-stems-freeze-export-wifi.md, F3).
//!
//! `ChainSlots` owns one bank and asks it four things per block: whether a
//! chain must not render (frozen or thawing), what a frozen track sounds like
//! (`play`), what a capturing track just rendered (`tap`), and what a frozen
//! chain's params were (`snapshot`). Track `t` is chain slot `t`.
//!
//! The stages:
//!
//! ```text
//! Idle --begin--> Capturing --two passes--> Frozen --thaw--> Thawing --loaded--> Idle
//!                     |  (stopped / not playing)                 (chain reloads while
//!                     +--------------> Idle (cancelled)           the loop keeps playing)
//! ```
//!
//! Capturing keeps the chain live and audible; only Frozen and Thawing play
//! the loop instead. Nothing here allocates on the audio thread except where
//! noted (`begin` builds the capture buffer — see its doc).

use crate::freeze::{Capture, Frozen, LoopMap, Player};
use std::sync::Arc;

/// Why a capture ended without freezing, for the UI's message.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cancel {
    /// The transport stopped, or the track stopped playing its clip.
    Stopped,
    /// The UI asked (Back, or an edit to the capturing track).
    Asked,
    /// A whole-Set replace took the chain away.
    SetChanged,
}

impl Cancel {
    pub fn code(self) -> &'static str {
        match self {
            Cancel::Stopped => "stopped",
            Cancel::Asked => "asked",
            Cancel::SetChanged => "set",
        }
    }
}

/// What a block's `tap` concluded.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    /// Two passes are in: the track is Frozen from the next block. The caller
    /// snapshots the chain's params (`set_snapshot`) and unloads it.
    Captured,
    Cancelled(Cancel),
}

enum Stage {
    Idle,
    Capturing(Capture),
    Frozen(Player),
    Thawing(Player),
}

pub struct FreezeBank {
    stages: Vec<Stage>,
    /// The chain's params at the moment it froze, as `get_param` key/value
    /// pairs: what a save writes while the chain is unloaded, and what a thaw
    /// loads back. Empty for a track that is not frozen.
    snaps: Vec<Vec<(String, String)>>,
    /// This block's end-of-block loop position per track (`None` = not
    /// playing), and the transport tempo. Set once per block, before render.
    pos: Vec<Option<f64>>,
    bpm_x100: u32,
}

impl FreezeBank {
    pub fn new(tracks: usize) -> Self {
        FreezeBank {
            stages: (0..tracks).map(|_| Stage::Idle).collect(),
            snaps: vec![Vec::new(); tracks],
            pos: vec![None; tracks],
            bpm_x100: 12_000,
        }
    }

    /// Once per block, before render: where every track is.
    pub fn set_frame(&mut self, pos: impl Fn(usize) -> Option<f64>, bpm_x100: u32) {
        for (t, p) in self.pos.iter_mut().enumerate() {
            *p = pos(t);
        }
        self.bpm_x100 = bpm_x100;
    }

    /// Start capturing track `t` over a loop of `map`. Allocates the whole loop
    /// (calloc: the pages are faulted in as the capture writes them, spread over
    /// the capture rather than in this call). `false` unless the track is Idle.
    pub fn begin(&mut self, t: usize, map: LoopMap) -> bool {
        match self.stages.get(t) {
            Some(Stage::Idle) => {
                self.stages[t] = Stage::Capturing(Capture::new(map));
                true
            }
            _ => false,
        }
    }

    /// A loop read back from disk, for a track that opens frozen. `false`
    /// unless the track is Idle (a Set replace has just cleared the bank).
    pub fn install(&mut self, t: usize, frozen: Frozen, snap: Vec<(String, String)>) -> bool {
        if !matches!(self.stages.get(t), Some(Stage::Idle)) {
            return false;
        }
        self.stages[t] = Stage::Frozen(Player::new(frozen));
        self.snaps[t] = snap;
        true
    }

    /// A Frozen track's loop map and samples (shared), for the WAV writer and
    /// the manifest. `None` for any other stage — a thawing track is on its way
    /// back and is no longer saved as frozen.
    pub fn frozen_loop(&self, t: usize) -> Option<(LoopMap, Arc<Vec<i16>>)> {
        match self.stages.get(t) {
            Some(Stage::Frozen(p)) => Some((*p.frozen().map(), p.frozen().shared())),
            _ => None,
        }
    }

    /// Drop a capture in progress. `true` if there was one.
    pub fn cancel(&mut self, t: usize) -> bool {
        if matches!(self.stages.get(t), Some(Stage::Capturing(_))) {
            self.stages[t] = Stage::Idle;
            true
        } else {
            false
        }
    }

    /// Feed a capturing track this block's chain output (`None` when its chain
    /// did not render: it was silent). Audio thread.
    pub fn tap(&mut self, t: usize, block: Option<&[i16]>, frames: usize) -> Option<Outcome> {
        let Some(Stage::Capturing(cap)) = self.stages.get_mut(t) else { return None };
        let Some(end) = self.pos[t] else {
            self.stages[t] = Stage::Idle;
            return Some(Outcome::Cancelled(Cancel::Stopped));
        };
        match block {
            Some(b) => cap.feed(&b[..frames * 2], end),
            None => cap.feed_silence(frames, end),
        }
        if !cap.done() {
            return None;
        }
        let Stage::Capturing(cap) = std::mem::replace(&mut self.stages[t], Stage::Idle) else {
            unreachable!()
        };
        match cap.finish() {
            Ok(frozen) => {
                self.stages[t] = Stage::Frozen(Player::new(frozen));
                Some(Outcome::Captured)
            }
            Err(cap) => {
                self.stages[t] = Stage::Capturing(cap);
                None
            }
        }
    }

    /// Fill `out` with a frozen or thawing track's loop. `false` (and `out`
    /// untouched) for any other track. Audio thread.
    pub fn play(&mut self, t: usize, out: &mut [i16]) -> bool {
        let pos = self.pos.get(t).copied().flatten();
        match self.stages.get_mut(t) {
            Some(Stage::Frozen(p)) | Some(Stage::Thawing(p)) => {
                p.render(out, pos, self.bpm_x100);
                true
            }
            _ => false,
        }
    }

    /// The chain must not render: the loop stands in for it.
    pub fn silences_chain(&self, t: usize) -> bool {
        matches!(self.stages.get(t), Some(Stage::Frozen(_)) | Some(Stage::Thawing(_)))
    }

    pub fn capturing(&self, t: usize) -> bool {
        matches!(self.stages.get(t), Some(Stage::Capturing(_)))
    }

    /// Frozen, not on its way back.
    pub fn frozen(&self, t: usize) -> bool {
        matches!(self.stages.get(t), Some(Stage::Frozen(_)))
    }

    pub fn thawing(&self, t: usize) -> bool {
        matches!(self.stages.get(t), Some(Stage::Thawing(_)))
    }

    /// 0..=100 for a capturing track.
    pub fn progress(&self, t: usize) -> Option<u8> {
        match self.stages.get(t) {
            Some(Stage::Capturing(c)) => Some((c.progress() * 100.0) as u8),
            _ => None,
        }
    }

    pub fn set_snapshot(&mut self, t: usize, snap: Vec<(String, String)>) {
        if let Some(s) = self.snaps.get_mut(t) {
            *s = snap;
        }
    }

    pub fn snapshot(&self, t: usize) -> &[(String, String)] {
        self.snaps.get(t).map_or(&[], |s| s.as_slice())
    }

    /// What `get_param(key)` answers for a chain that is unloaded because it
    /// is frozen. `None` when the track is not frozen or the key was not taken.
    pub fn snapshot_get(&self, t: usize, key: &str) -> Option<String> {
        if !self.silences_chain(t) {
            return None;
        }
        self.snaps.get(t)?.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone())
    }

    /// Frozen -> Thawing: the chain is being reloaded; the loop keeps playing.
    pub fn thaw(&mut self, t: usize) -> bool {
        if !self.frozen(t) {
            return false;
        }
        let Stage::Frozen(p) = std::mem::replace(&mut self.stages[t], Stage::Idle) else {
            unreachable!()
        };
        self.stages[t] = Stage::Thawing(p);
        true
    }

    /// Thawing -> Idle: the chain is back and takes over from the next block.
    /// Drops the loop (a free of its buffer, once, at a thaw).
    pub fn thawed(&mut self, t: usize) {
        if self.thawing(t) {
            self.stages[t] = Stage::Idle;
            self.snaps[t].clear();
        }
    }

    /// A whole-Set replace: nothing frozen survives into another Set (the
    /// Set's own frozen state is restored by the open, not carried over).
    /// Returns the tracks whose capture this cancelled.
    pub fn clear_all(&mut self) -> Vec<usize> {
        let mut cancelled = Vec::new();
        for (t, s) in self.stages.iter_mut().enumerate() {
            if matches!(s, Stage::Capturing(_)) {
                cancelled.push(t);
            }
            *s = Stage::Idle;
        }
        self.snaps.iter_mut().for_each(Vec::clear);
        cancelled
    }

    /// Tracks whose chain is unloaded behind a loop (frozen or thawing), as a
    /// bit mask, for the status line.
    pub fn frozen_mask(&self) -> u32 {
        self.stages.iter().enumerate().fold(0, |m, (t, s)| match s {
            Stage::Frozen(_) | Stage::Thawing(_) => m | (1 << t),
            _ => m,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use seq_core::TICKS_PER_BAR;

    const SR: u32 = 44_100;
    const BLOCK: usize = 128;

    fn map() -> LoopMap {
        LoopMap::new(TICKS_PER_BAR, 12_000, SR).unwrap()
    }

    /// Run blocks of a constant signal through a capturing track until it
    /// reports an outcome; returns it and how many blocks it took.
    fn run(bank: &mut FreezeBank, t: usize, playing: bool, limit: usize) -> (Option<Outcome>, usize) {
        let block = vec![1000i16; BLOCK * 2];
        let fpt = SR as f64 * 60.0 / (120.0 * seq_core::PPQN as f64);
        for n in 1..=limit {
            let frame = (n * BLOCK) as f64;
            bank.set_frame(|_| playing.then(|| (frame / fpt).rem_euclid(TICKS_PER_BAR as f64)), 12_000);
            if let Some(o) = bank.tap(t, Some(&block), BLOCK) {
                return (Some(o), n);
            }
        }
        (None, limit)
    }

    #[test]
    fn a_capture_freezes_after_two_passes_and_then_plays_the_loop() {
        let mut b = FreezeBank::new(16);
        assert!(b.begin(3, map()));
        assert!(!b.begin(3, map()), "already capturing");
        assert!(!b.silences_chain(3), "the chain stays live while it is captured");
        let (o, n) = run(&mut b, 3, true, 5_000);
        assert_eq!(o, Some(Outcome::Captured));
        assert!((n * BLOCK) as f64 >= 2.0 * 88_200.0);
        assert!(b.frozen(3) && b.silences_chain(3));
        assert_eq!(b.frozen_mask(), 1 << 3);
        let mut out = vec![0i16; BLOCK * 2];
        assert!(b.play(3, &mut out));
        assert!(out.iter().all(|&s| s == 1000), "plays what was captured");
        assert!(!b.play(4, &mut out), "an idle track is not played");
    }

    #[test]
    fn stopping_cancels_a_capture() {
        let mut b = FreezeBank::new(16);
        b.begin(0, map());
        run(&mut b, 0, true, 100);
        let (o, _) = run(&mut b, 0, false, 1);
        assert_eq!(o, Some(Outcome::Cancelled(Cancel::Stopped)));
        assert!(!b.capturing(0) && !b.silences_chain(0));
    }

    #[test]
    fn a_silent_block_is_captured_as_silence() {
        // An idle-gated chain did not render: its scratch is stale, so the
        // capture must record zeros, not whatever the buffer last held.
        let mut b = FreezeBank::new(16);
        b.begin(1, map());
        let fpt = SR as f64 * 60.0 / (120.0 * seq_core::PPQN as f64);
        let mut n = 0;
        loop {
            n += 1;
            let frame = (n * BLOCK) as f64;
            b.set_frame(|_| Some((frame / fpt).rem_euclid(TICKS_PER_BAR as f64)), 12_000);
            if b.tap(1, None, BLOCK).is_some() {
                break;
            }
        }
        let mut out = vec![7i16; BLOCK * 2];
        b.play(1, &mut out);
        assert!(out.iter().all(|&s| s == 0));
    }

    #[test]
    fn thaw_keeps_the_loop_until_the_chain_is_back() {
        let mut b = FreezeBank::new(16);
        b.begin(2, map());
        run(&mut b, 2, true, 5_000);
        b.set_snapshot(2, vec![("synth:state".into(), "blob".into())]);
        assert_eq!(b.snapshot_get(2, "synth:state").as_deref(), Some("blob"));
        assert!(b.thaw(2));
        assert!(!b.thaw(2), "already thawing");
        assert!(b.silences_chain(2), "still the loop while the chain reloads");
        let mut out = vec![0i16; BLOCK * 2];
        assert!(b.play(2, &mut out));
        b.thawed(2);
        assert!(!b.silences_chain(2) && b.snapshot(2).is_empty());
        assert_eq!(b.snapshot_get(2, "synth:state"), None);
    }

    #[test]
    fn a_set_change_clears_everything_and_names_the_cancelled_captures() {
        let mut b = FreezeBank::new(16);
        b.begin(0, map());
        run(&mut b, 0, true, 5_000); // frozen
        b.begin(5, map());           // capturing
        assert_eq!(b.clear_all(), vec![5]);
        assert_eq!(b.frozen_mask(), 0);
        assert!(!b.capturing(5));
    }

    #[test]
    fn cancel_only_touches_a_capture() {
        let mut b = FreezeBank::new(16);
        assert!(!b.cancel(0));
        b.begin(0, map());
        assert!(b.cancel(0));
        assert!(!b.capturing(0));
    }
}
