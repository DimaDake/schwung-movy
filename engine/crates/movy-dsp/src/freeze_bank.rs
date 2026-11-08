//! Which tracks are frozen, freezing or thawing, and the audio-thread side
//! of each (plans/2026-11-08-freeze-all-clips-design.md).
//!
//! A frozen track has one loop per non-empty clip slot, each recorded over
//! that clip's loop window (`RecWindow`). Whichever slot the track plays, its
//! loop plays; a slot without one is silence.
//!
//! `ChainSlots` owns one bank and asks it, per block: whether a chain must not
//! render (`silences_chain`: frozen or thawing), whether a loop is mixed in
//! the chain's place (`stands_in`, also true while the rest of a freeze
//! records unheard), what that loop sounds like (`play`), what a freezing
//! track just rendered (`tap`), and the chain's params (`snapshot`).
//!
//! ```text
//! Idle --begin_track--> Freezing --last clip--> Frozen --thaw--> Thawing --loaded--> Idle
//!                          |  (stopped / Back / Set change)
//!                          +------> Idle, every loop of the job freed
//! ```
//!
//! **A freeze is a job.** The clip playing (if any) is recorded first and
//! heard live; then, once its loop is in, that loop is heard while the chain
//! records every other clip unheard, one after another (movy-dsp lib.rs swaps
//! the track's playhead to each: seq-core `freeze_swap_in`). Stopped, every
//! clip is recorded with the output silenced.
//!
//! **Memory.** A loop is capped at `MAX_LOOP_SECONDS` and all of them together
//! at `MEM_BUDGET`, checked for the whole job up front. Buffers are allocated
//! and freed on freeze_mem.rs's helper, one clip at a time, never here.
//!
//! **Mute.** A muted frozen track fades out over `FADE_OUT_SECONDS` — a muted
//! live track's tails ring out after its last note, and a hard cut would not
//! — and back in over a few milliseconds.

use crate::freeze::{Capture, Frozen, LoopAt, LoopMap, Player};
use crate::freeze_mem::{Ask, FreezeMem, Gone};
use seq_core::engine::{LoopPos, RecWindow, TrackWindows};
use seq_core::track::CLIPS_PER_TRACK;
use std::sync::Arc;

/// The longest loop a freeze records (seconds of audio): 10 MB of stereo.
pub const MAX_LOOP_SECONDS: f64 = 60.0;
/// Every loop together: 16 tracks of eight 4-bar clips is ~180 MB, and a Move
/// has ~370 MB free with a full Set loaded (user, 2026-11-08).
pub const MEM_BUDGET: usize = 200 << 20;
const FADE_OUT_SECONDS: f32 = 0.25;
const FADE_IN_SECONDS: f32 = 0.005;

/// Why a freeze ended without freezing, for the UI's message.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cancel {
    /// The transport stopped, or the track stopped playing the clip recorded.
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
    /// Clip `slot`'s loop is in and `next` is the clip to record now: the
    /// caller lends the track's playhead to it.
    ClipDone { slot: usize, next: usize },
    /// The last clip is in: the track is Frozen from the next block. The
    /// caller snapshots the chain's params (`set_snapshot`) and unloads it.
    Captured,
    Cancelled(Cancel),
}

/// One clip a freeze records.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ClipJob {
    pub slot: usize,
    pub map: LoopMap,
    pub win: RecWindow,
}

enum Cur {
    /// No buffer asked for yet (the helper's queue was full): asked next block.
    Ask,
    Pending { ticket: u32 },
    Capturing(Capture),
}

struct Job {
    heard: Option<usize>,
    /// In recording order; `next` indexes the one recording now.
    todo: [Option<ClipJob>; CLIPS_PER_TRACK],
    next: usize,
    cur: Cur,
}

impl Job {
    fn clip(&self) -> Option<ClipJob> {
        self.todo.get(self.next).copied().flatten()
    }
}

#[derive(Default)]
struct Track {
    loops: [Option<Player>; CLIPS_PER_TRACK],
    wins: [Option<RecWindow>; CLIPS_PER_TRACK],
    job: Option<Job>,
    thawing: bool,
    /// The chain's params at the moment it froze, as `get_param` key/value
    /// pairs: what a save writes while the chain is unloaded, and what a thaw
    /// loads back. Empty for a track that is not frozen.
    snap: Vec<(String, String)>,
    /// This block's end-of-block position (the track's real playhead) and,
    /// during a job, where the heard loop is (carried by lib.rs while the
    /// playhead is lent to a capture). Set once per block, before render.
    pos: Option<LoopPos>,
    heard_at: Option<LoopAt>,
    /// The block a freeze ended in: the playhead is still lent to the last
    /// clip until lib.rs gives it back after the mix, so this block plays the
    /// heard loop from where it was. Cleared by the next `set_frame`.
    ending: Option<(usize, LoopAt)>,
    gain: f32,
}

fn at_of(p: LoopPos) -> LoopAt {
    LoopAt { pos: p.pos, win_start: p.win_start, win_len: p.win_len }
}

impl Track {
    fn has_loops(&self) -> bool {
        self.loops.iter().any(Option::is_some)
    }

    fn frozen(&self) -> bool {
        self.job.is_none() && !self.thawing && self.has_loops()
    }

    fn bytes(&self) -> usize {
        let loops: usize = self.loops.iter().flatten().map(|p| p.frozen().map().bytes()).sum();
        let todo: usize = self.job.as_ref().map_or(0, |j| {
            j.todo[j.next..].iter().flatten().map(|c| c.map.bytes()).sum()
        });
        loops + todo
    }
}

pub struct FreezeBank {
    tracks: Vec<Track>,
    muted: u32,
    bpm_x100: u32,
    tickets: u32,
    mem: FreezeMem,
}

impl FreezeBank {
    pub fn new(tracks: usize) -> Self {
        FreezeBank {
            tracks: (0..tracks).map(|_| Track { gain: 1.0, ..Track::default() }).collect(),
            muted: 0,
            bpm_x100: 12_000,
            tickets: 0,
            mem: FreezeMem::new(),
        }
    }

    /// Spawn the memory helper. Off the audio thread (`ChainSlots::configure`).
    pub fn start(&mut self) {
        self.mem.start();
    }

    /// Once per block, before render: where every track is, where each heard
    /// loop is, which tracks are muted, and any capture buffer that arrived.
    pub fn set_frame(&mut self, pos: impl Fn(usize) -> Option<LoopPos>,
                     heard_at: impl Fn(usize) -> Option<LoopAt>, muted: u32, bpm_x100: u32) {
        for (t, k) in self.tracks.iter_mut().enumerate() {
            k.pos = pos(t);
            k.heard_at = if k.job.is_some() { heard_at(t) } else { None };
            k.ending = None;
        }
        self.muted = muted;
        self.bpm_x100 = bpm_x100;
        for t in 0..self.tracks.len() {
            if matches!(self.tracks[t].job, Some(Job { cur: Cur::Ask, .. })) {
                self.ask(t);
            }
        }
        let tracks = &mut self.tracks;
        self.mem.poll(|a, buf| {
            let Some(job) = tracks.get_mut(a.track).and_then(|k| k.job.as_mut()) else { return Some(buf) };
            let (Cur::Pending { ticket }, Some(c)) = (&job.cur, job.clip()) else { return Some(buf) };
            if *ticket != a.ticket {
                return Some(buf); // cancelled meanwhile: freed again
            }
            match Capture::with_buf(c.map, buf) {
                Ok(cap) => {
                    job.cur = Cur::Capturing(cap);
                    None
                }
                Err(buf) => Some(buf),
            }
        });
    }

    /// Ask the helper for the buffer of track `t`'s current clip.
    fn ask(&mut self, t: usize) {
        let Some(job) = self.tracks[t].job.as_mut() else { return };
        let Some(c) = job.clip() else { return };
        self.tickets = self.tickets.wrapping_add(1);
        job.cur = if self.mem.request(Ask { track: t, ticket: self.tickets, samples: c.map.frames() * 2 }) {
            Cur::Pending { ticket: self.tickets }
        } else {
            Cur::Ask
        };
    }

    /// What every loop holds, plus every clip a job has still to record.
    pub fn bytes(&self) -> usize {
        self.tracks.iter().map(Track::bytes).sum()
    }

    /// Start freezing track `t`: every clip of `clips`, `heard` (the clip
    /// playing now, if any) first. Refuses (with the status code) a busy
    /// track, any clip over `MAX_LOOP_SECONDS`, and a job that would take the
    /// loops past `MEM_BUDGET` — all before a single buffer is asked for.
    pub fn begin_track(&mut self, t: usize, heard: Option<usize>, clips: &[ClipJob]) -> Result<(), &'static str> {
        let Some(k) = self.tracks.get(t) else { return Err("nochain") };
        if k.job.is_some() || k.has_loops() {
            return Err("busy");
        }
        if clips.is_empty() || heard.is_some_and(|h| !clips.iter().any(|c| c.slot == h)) {
            return Err("noclip");
        }
        if clips.iter().any(|c| c.map.seconds() > MAX_LOOP_SECONDS) {
            return Err("long");
        }
        if self.bytes() + clips.iter().map(|c| c.map.bytes()).sum::<usize>() > MEM_BUDGET {
            return Err("mem");
        }
        let mut todo = [None; CLIPS_PER_TRACK];
        let order = clips.iter().filter(|c| Some(c.slot) == heard).chain(clips.iter().filter(|c| Some(c.slot) != heard));
        for (i, c) in order.take(CLIPS_PER_TRACK).enumerate() {
            todo[i] = Some(*c);
        }
        let k = &mut self.tracks[t];
        k.wins = [None; CLIPS_PER_TRACK];
        for c in clips {
            k.wins[c.slot] = Some(c.win);
        }
        k.job = Some(Job { heard, todo, next: 0, cur: Cur::Ask });
        k.gain = 1.0;
        self.ask(t);
        Ok(())
    }

    /// A track opening frozen: its loops read back from disk. `false` unless
    /// the track is Idle (a Set replace has just cleared the bank).
    pub fn install_track(&mut self, t: usize, loops: Vec<(usize, Frozen, RecWindow)>, snap: Vec<(String, String)>) -> bool {
        let Some(k) = self.tracks.get_mut(t) else { return false };
        if k.job.is_some() || k.has_loops() || loops.is_empty() {
            return false;
        }
        for (slot, f, w) in loops {
            if slot < CLIPS_PER_TRACK {
                k.loops[slot] = Some(Player::new(f));
                k.wins[slot] = Some(w);
            }
        }
        k.snap = snap;
        k.gain = 1.0;
        true
    }

    /// The windows track `t` is locked to — every clip of a job, every loop
    /// of a frozen or thawing track — or `None` when it is free.
    pub fn windows(&self, t: usize) -> Option<TrackWindows> {
        let k = self.tracks.get(t)?;
        (k.job.is_some() || k.has_loops()).then_some(k.wins)
    }

    /// The clip a job heard first (and plays the loop of meanwhile).
    #[cfg(test)]
    pub fn heard(&self, t: usize) -> Option<usize> {
        self.tracks.get(t)?.job.as_ref()?.heard
    }

    /// A Frozen track's loops — slot, map, samples (shared), window — for
    /// the WAV writer and the manifest. Empty for any other stage: a thawing
    /// track is on its way back and is no longer saved as frozen.
    pub fn frozen_loops(&self, t: usize) -> Vec<(usize, LoopMap, Arc<Vec<i16>>, RecWindow)> {
        let Some(k) = self.tracks.get(t).filter(|k| k.frozen()) else { return Vec::new() };
        k.loops.iter().enumerate().filter_map(|(s, p)| {
            let p = p.as_ref()?;
            Some((s, *p.frozen().map(), p.frozen().shared(), k.wins[s]?))
        }).collect()
    }

    /// Back to Idle, every buffer freed off the audio thread.
    fn retire(&mut self, t: usize) {
        let k = &mut self.tracks[t];
        if let Some(Job { cur: Cur::Capturing(c), .. }) = k.job.take() {
            self.mem.retire(Gone::Buf(c.into_buf()));
        }
        for p in k.loops.iter_mut().filter_map(Option::take) {
            self.mem.retire(Gone::Shared(p.into_shared()));
        }
        k.wins = [None; CLIPS_PER_TRACK];
        k.thawing = false;
        k.gain = 1.0;
    }

    /// Drop a freeze in progress, every loop it recorded included. `true` if
    /// there was one.
    pub fn cancel(&mut self, t: usize) -> bool {
        if self.capturing(t) {
            self.retire(t);
            true
        } else {
            false
        }
    }

    /// Feed a freezing track this block's chain output (`None` when its chain
    /// did not render: it was silent). Audio thread.
    pub fn tap(&mut self, t: usize, block: Option<&[i16]>, frames: usize) -> Option<Outcome> {
        let k = self.tracks.get_mut(t)?;
        let job = k.job.as_mut()?;
        let clip = job.clip()?;
        /* The playhead must be on the clip being recorded: anything else is
         * the transport stopping (or a stop reaching the track). */
        let Some(p) = k.pos.filter(|p| p.slot == clip.slot) else {
            self.retire(t);
            return Some(Outcome::Cancelled(Cancel::Stopped));
        };
        let Cur::Capturing(cap) = &mut job.cur else { return None };
        let end = p.pos - p.win_start;
        match block {
            Some(b) => cap.feed(&b[..frames * 2], end),
            None => cap.feed_silence(frames, end),
        }
        if !cap.done() {
            return None;
        }
        let Cur::Capturing(cap) = std::mem::replace(&mut job.cur, Cur::Ask) else { unreachable!() };
        let frozen = match cap.finish() {
            Ok(f) => f,
            Err(cap) => {
                job.cur = Cur::Capturing(cap);
                return None;
            }
        };
        k.loops[clip.slot] = Some(Player::new(frozen));
        job.next += 1;
        match job.clip() {
            Some(n) => {
                self.ask(t);
                Some(Outcome::ClipDone { slot: clip.slot, next: n.slot })
            }
            None => {
                if let (Some(h), Some(a)) = (job.heard, k.heard_at) {
                    k.ending = Some((h, a));
                }
                k.job = None;
                Some(Outcome::Captured)
            }
        }
    }

    /// Fill `out` with track `t`'s loop where a loop stands in for its chain,
    /// faded by its mute. `false` (and `out` untouched) for any other track.
    /// Audio thread.
    pub fn play(&mut self, t: usize, out: &mut [i16]) -> bool {
        if !self.stands_in(t) {
            return false;
        }
        let target = if self.muted & (1 << t) != 0 { 0.0 } else { 1.0 };
        let bpm = self.bpm_x100;
        let k = &mut self.tracks[t];
        let g0 = k.gain;
        if target == 0.0 && g0 == 0.0 {
            out.fill(0);
            return true;
        }
        /* The heard loop's position is lib.rs's anchor — absent in the very
         * block the heard loop lands in, when the real playhead is still on
         * the heard clip and says where it is. */
        let (slot, at) = match (&k.job, k.pos, k.ending) {
            (_, _, Some((h, a))) => (Some(h), Some(a)),
            (Some(j), p, None) => (j.heard, k.heard_at.or(p.filter(|p| Some(p.slot) == j.heard).map(at_of))),
            (None, Some(p), None) => (Some(p.slot), Some(at_of(p))),
            (None, None, None) => (None, None),
        };
        match slot.and_then(|s| k.loops.get_mut(s)?.as_mut()) {
            Some(p) => p.render(out, at, bpm),
            None => out.fill(0),
        }
        if target == 1.0 && g0 == 1.0 {
            return true;
        }
        let sr = seq_core_sample_rate(k).max(1) as f32;
        let step = 1.0 / (sr * if target == 0.0 { FADE_OUT_SECONDS } else { FADE_IN_SECONDS });
        let mut g = g0;
        for f in out.chunks_exact_mut(2) {
            g = if target == 0.0 { (g - step).max(0.0) } else { (g + step).min(1.0) };
            f[0] = (f[0] as f32 * g) as i16;
            f[1] = (f[1] as f32 * g) as i16;
        }
        k.gain = g;
        true
    }

    /// The chain must not render: the loops stand in for it.
    pub fn silences_chain(&self, t: usize) -> bool {
        self.tracks.get(t).is_some_and(|k| k.job.is_none() && k.has_loops())
    }

    /// A loop is mixed in the chain's place: frozen, thawing, or a job whose
    /// heard clip is in (the chain keeps rendering the rest, unheard).
    pub fn stands_in(&self, t: usize) -> bool {
        self.tracks.get(t).is_some_and(|k| match &k.job {
            Some(j) => j.heard.is_some_and(|h| k.loops[h].is_some()),
            None => k.has_loops(),
        })
    }

    /// A freeze is being recorded.
    pub fn capturing(&self, t: usize) -> bool {
        self.tracks.get(t).is_some_and(|k| k.job.is_some())
    }

    /// Frozen, not on its way back.
    pub fn frozen(&self, t: usize) -> bool {
        self.tracks.get(t).is_some_and(Track::frozen)
    }

    pub fn thawing(&self, t: usize) -> bool {
        self.tracks.get(t).is_some_and(|k| k.thawing)
    }

    /// A job's progress: clips done, clips in all, and the current clip's
    /// percent (0 while its buffer is on its way).
    pub fn progress(&self, t: usize) -> Option<(u8, u8, u8)> {
        let j = self.tracks.get(t)?.job.as_ref()?;
        let total = j.todo.iter().flatten().count() as u8;
        let pct = match &j.cur {
            Cur::Capturing(c) => (c.progress() * 100.0) as u8,
            _ => 0,
        };
        Some((j.next as u8, total, pct))
    }

    pub fn set_snapshot(&mut self, t: usize, snap: Vec<(String, String)>) {
        if let Some(k) = self.tracks.get_mut(t) {
            k.snap = snap;
        }
    }

    pub fn snapshot(&self, t: usize) -> &[(String, String)] {
        self.tracks.get(t).map_or(&[], |k| k.snap.as_slice())
    }

    /// What `get_param(key)` answers for a chain that is unloaded because it
    /// is frozen. `None` when the track is not frozen or the key was not taken.
    pub fn snapshot_get(&self, t: usize, key: &str) -> Option<String> {
        if !self.silences_chain(t) {
            return None;
        }
        self.tracks.get(t)?.snap.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone())
    }

    /// Frozen -> Thawing: the chain is being reloaded; the loops keep playing.
    pub fn thaw(&mut self, t: usize) -> bool {
        if !self.frozen(t) {
            return false;
        }
        self.tracks[t].thawing = true;
        true
    }

    /// Thawing -> Idle: the chain is back and takes over from the next block.
    pub fn thawed(&mut self, t: usize) {
        if self.thawing(t) {
            self.retire(t);
            self.tracks[t].snap.clear();
        }
    }

    /// A whole-Set replace: nothing frozen survives into another Set (the
    /// Set's own frozen state is restored by the open, not carried over).
    /// Returns the tracks whose freeze this cancelled.
    pub fn clear_all(&mut self) -> Vec<usize> {
        let mut cancelled = Vec::new();
        for t in 0..self.tracks.len() {
            if self.capturing(t) {
                cancelled.push(t);
            }
            self.retire(t);
            self.tracks[t].snap.clear();
        }
        cancelled
    }

    /// Tracks whose chain is unloaded behind loops (frozen or thawing), as a
    /// bit mask, for the status line.
    pub fn frozen_mask(&self) -> u32 {
        (0..self.tracks.len()).fold(0, |m, t| if self.silences_chain(t) { m | (1 << t) } else { m })
    }
}

/// Any loop's sample rate: they all share the host's.
fn seq_core_sample_rate(k: &Track) -> u32 {
    k.loops.iter().flatten().next().map_or(44_100, |p| p.frozen().map().sample_rate())
}

#[cfg(test)]
#[path = "freeze_bank_tests.rs"]
mod tests;
