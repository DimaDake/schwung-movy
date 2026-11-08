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
//! Idle --begin--> Pending --buffer--> Capturing --two passes--> Frozen --thaw--> Thawing --loaded--> Idle
//!                    |                   |  (stopped / another clip)              (chain reloads while
//!                    +-------------------+------> Idle (cancelled)                the loop keeps playing)
//! ```
//!
//! Every stage but Idle names the clip SLOT the loop is (being) recorded from:
//! the sequencer's freeze lock follows it (seq-core `engine/freeze_lock.rs`),
//! and the positions the bank is fed are `None` whenever the track plays any
//! other slot. Capturing keeps the chain live and audible; only Frozen and
//! Thawing play the loop instead.
//!
//! **Memory.** A loop is capped at `MAX_LOOP_SECONDS` and all of them together
//! at `MEM_BUDGET`; past either, `begin` refuses. Buffers are allocated and
//! freed on freeze_mem.rs's helper, never here: Pending is the wait.
//!
//! **Mute.** A muted frozen track fades out over `FADE_OUT_SECONDS` — a muted
//! live track's tails ring out after its last note, and a hard cut would not
//! — and back in over a few milliseconds.

use crate::freeze::{Capture, Frozen, LoopMap, Player};
use crate::freeze_mem::{Ask, FreezeMem, Gone};
use std::sync::Arc;

/// The longest loop a freeze records (seconds of audio): 10 MB of stereo.
pub const MAX_LOOP_SECONDS: f64 = 60.0;
/// Every loop together. A Move has ~370 MB free with a full Set loaded.
pub const MEM_BUDGET: usize = 128 << 20;
const FADE_OUT_SECONDS: f32 = 0.25;
const FADE_IN_SECONDS: f32 = 0.005;

/// Why a capture ended without freezing, for the UI's message.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cancel {
    /// The transport stopped, or the track stopped playing its clip.
    Stopped,
    /// The UI asked (Back).
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
    Pending { map: LoopMap, ticket: u32 },
    Capturing(Capture),
    Frozen(Player),
    Thawing(Player),
}

impl Stage {
    fn map(&self) -> Option<&LoopMap> {
        match self {
            Stage::Idle => None,
            Stage::Pending { map, .. } => Some(map),
            Stage::Capturing(c) => Some(c.map()),
            Stage::Frozen(p) | Stage::Thawing(p) => Some(p.frozen().map()),
        }
    }
}

pub struct FreezeBank {
    stages: Vec<Stage>,
    /// The clip slot each non-Idle track's loop belongs to.
    slots: Vec<Option<usize>>,
    /// The chain's params at the moment it froze, as `get_param` key/value
    /// pairs: what a save writes while the chain is unloaded, and what a thaw
    /// loads back. Empty for a track that is not frozen.
    snaps: Vec<Vec<(String, String)>>,
    /// This block's end-of-block loop position per track (`None` = not
    /// playing its frozen slot), the muted tracks, and the transport tempo.
    /// Set once per block, before render.
    pos: Vec<Option<f64>>,
    muted: u32,
    gain: Vec<f32>,
    bpm_x100: u32,
    tickets: u32,
    mem: FreezeMem,
}

impl FreezeBank {
    pub fn new(tracks: usize) -> Self {
        FreezeBank {
            stages: (0..tracks).map(|_| Stage::Idle).collect(),
            slots: vec![None; tracks],
            snaps: vec![Vec::new(); tracks],
            pos: vec![None; tracks],
            muted: 0,
            gain: vec![1.0; tracks],
            bpm_x100: 12_000,
            tickets: 0,
            mem: FreezeMem::new(),
        }
    }

    /// Spawn the memory helper. Off the audio thread (`ChainSlots::configure`).
    pub fn start(&mut self) {
        self.mem.start();
    }

    /// Once per block, before render: where every track is, which are muted,
    /// and any capture buffer that has arrived.
    pub fn set_frame(&mut self, pos: impl Fn(usize) -> Option<f64>, muted: u32, bpm_x100: u32) {
        for (t, p) in self.pos.iter_mut().enumerate() {
            *p = pos(t);
        }
        self.muted = muted;
        self.bpm_x100 = bpm_x100;
        let stages = &mut self.stages;
        self.mem.poll(|a, buf| {
            let map = match stages.get(a.track) {
                Some(Stage::Pending { map, ticket }) if *ticket == a.ticket => *map,
                _ => return Some(buf), // cancelled meanwhile: freed again
            };
            match Capture::with_buf(map, buf) {
                Ok(c) => {
                    stages[a.track] = Stage::Capturing(c);
                    None
                }
                Err(buf) => Some(buf),
            }
        });
    }

    /// What every loop and capture holds now, in bytes.
    pub fn bytes(&self) -> usize {
        self.stages.iter().filter_map(Stage::map).map(LoopMap::bytes).sum()
    }

    /// Start freezing track `t`'s clip `slot` over a loop of `map`: Pending
    /// until its buffer arrives. Refuses (with the status code) a busy track,
    /// a loop over `MAX_LOOP_SECONDS`, and one that would take the loops past
    /// `MEM_BUDGET`.
    pub fn begin(&mut self, t: usize, map: LoopMap, slot: usize) -> Result<(), &'static str> {
        if !matches!(self.stages.get(t), Some(Stage::Idle)) {
            return Err("busy");
        }
        if map.seconds() > MAX_LOOP_SECONDS {
            return Err("long");
        }
        if self.bytes() + map.bytes() > MEM_BUDGET {
            return Err("mem");
        }
        self.tickets = self.tickets.wrapping_add(1);
        if !self.mem.request(Ask { track: t, ticket: self.tickets, samples: map.frames() * 2 }) {
            return Err("busy");
        }
        self.stages[t] = Stage::Pending { map, ticket: self.tickets };
        self.slots[t] = Some(slot);
        Ok(())
    }

    /// A loop read back from disk, for a track that opens frozen. `false`
    /// unless the track is Idle (a Set replace has just cleared the bank).
    pub fn install(&mut self, t: usize, frozen: Frozen, snap: Vec<(String, String)>, slot: usize) -> bool {
        if !matches!(self.stages.get(t), Some(Stage::Idle)) {
            return false;
        }
        self.stages[t] = Stage::Frozen(Player::new(frozen));
        self.slots[t] = Some(slot);
        self.snaps[t] = snap;
        self.gain[t] = 1.0;
        true
    }

    /// The clip slot track `t` is locked to: every stage but Idle.
    pub fn locked_slot(&self, t: usize) -> Option<usize> {
        self.slots.get(t).copied().flatten()
    }

    /// A Frozen track's loop map, samples (shared) and clip slot, for the WAV
    /// writer and the manifest. `None` for any other stage — a thawing track
    /// is on its way back and is no longer saved as frozen.
    pub fn frozen_loop(&self, t: usize) -> Option<(LoopMap, Arc<Vec<i16>>, usize)> {
        match self.stages.get(t) {
            Some(Stage::Frozen(p)) => Some((*p.frozen().map(), p.frozen().shared(), self.slots[t]?)),
            _ => None,
        }
    }

    /// Back to Idle, its buffer freed off the audio thread.
    fn retire(&mut self, t: usize) {
        match std::mem::replace(&mut self.stages[t], Stage::Idle) {
            Stage::Capturing(c) => self.mem.retire(Gone::Buf(c.into_buf())),
            Stage::Frozen(p) | Stage::Thawing(p) => self.mem.retire(Gone::Shared(p.into_shared())),
            Stage::Idle | Stage::Pending { .. } => {}
        }
        self.slots[t] = None;
        self.gain[t] = 1.0;
    }

    /// Drop a capture in progress (or one still waiting for its buffer).
    /// `true` if there was one.
    pub fn cancel(&mut self, t: usize) -> bool {
        if self.capturing(t) {
            self.retire(t);
            true
        } else {
            false
        }
    }

    /// Feed a capturing track this block's chain output (`None` when its chain
    /// did not render: it was silent). Audio thread.
    pub fn tap(&mut self, t: usize, block: Option<&[i16]>, frames: usize) -> Option<Outcome> {
        if !self.capturing(t) {
            return None;
        }
        let Some(end) = self.pos[t] else {
            self.retire(t);
            return Some(Outcome::Cancelled(Cancel::Stopped));
        };
        let Some(Stage::Capturing(cap)) = self.stages.get_mut(t) else { return None };
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

    /// Fill `out` with a frozen or thawing track's loop, faded by its mute.
    /// `false` (and `out` untouched) for any other track. Audio thread.
    pub fn play(&mut self, t: usize, out: &mut [i16]) -> bool {
        let pos = self.pos.get(t).copied().flatten();
        let target = if self.muted & (1 << t) != 0 { 0.0 } else { 1.0 };
        let (bpm, g0) = (self.bpm_x100, self.gain[t]);
        let Some(Stage::Frozen(p) | Stage::Thawing(p)) = self.stages.get_mut(t) else { return false };
        if target == 0.0 && g0 == 0.0 {
            out.fill(0);
            return true;
        }
        let map = *p.frozen().map();
        p.render(out, pos.map(|x| crate::freeze::LoopAt::whole(x, &map)), bpm);
        if target == 1.0 && g0 == 1.0 {
            return true;
        }
        let sr = p.frozen().map().sample_rate().max(1) as f32;
        let step = 1.0 / (sr * if target == 0.0 { FADE_OUT_SECONDS } else { FADE_IN_SECONDS });
        let mut g = g0;
        for f in out.chunks_exact_mut(2) {
            g = if target == 0.0 { (g - step).max(0.0) } else { (g + step).min(1.0) };
            f[0] = (f[0] as f32 * g) as i16;
            f[1] = (f[1] as f32 * g) as i16;
        }
        self.gain[t] = g;
        true
    }

    /// The chain must not render: the loop stands in for it.
    pub fn silences_chain(&self, t: usize) -> bool {
        matches!(self.stages.get(t), Some(Stage::Frozen(_)) | Some(Stage::Thawing(_)))
    }

    /// Capturing, or waiting for the buffer to capture into.
    pub fn capturing(&self, t: usize) -> bool {
        matches!(self.stages.get(t), Some(Stage::Capturing(_)) | Some(Stage::Pending { .. }))
    }

    /// Frozen, not on its way back.
    pub fn frozen(&self, t: usize) -> bool {
        matches!(self.stages.get(t), Some(Stage::Frozen(_)))
    }

    pub fn thawing(&self, t: usize) -> bool {
        matches!(self.stages.get(t), Some(Stage::Thawing(_)))
    }

    /// 0..=100 for a capturing track (0 while its buffer is on its way).
    pub fn progress(&self, t: usize) -> Option<u8> {
        match self.stages.get(t) {
            Some(Stage::Capturing(c)) => Some((c.progress() * 100.0) as u8),
            Some(Stage::Pending { .. }) => Some(0),
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
    pub fn thawed(&mut self, t: usize) {
        if self.thawing(t) {
            self.retire(t);
            self.snaps[t].clear();
        }
    }

    /// A whole-Set replace: nothing frozen survives into another Set (the
    /// Set's own frozen state is restored by the open, not carried over).
    /// Returns the tracks whose capture this cancelled.
    pub fn clear_all(&mut self) -> Vec<usize> {
        let mut cancelled = Vec::new();
        for t in 0..self.stages.len() {
            if self.capturing(t) {
                cancelled.push(t);
            }
            self.retire(t);
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
#[path = "freeze_bank_tests.rs"]
mod tests;
