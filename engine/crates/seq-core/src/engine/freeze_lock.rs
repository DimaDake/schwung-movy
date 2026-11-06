//! Freeze's lock: a frozen track's loop was recorded from one clip, so that
//! clip must not change under it (movy-dsp `freeze_bank.rs`).
//!
//! The rule lives HERE, not in the UI: every way to change a track reaches the
//! engine as a command, and the UI's guards cover only the gestures they were
//! written for. movy-dsp sets a track's lock from the moment a capture is asked
//! for until the chain is back, and `command.rs` asks `refuses` before every
//! op. A refused op is counted, with its track, for the status line
//! (`frzr=<count>:<track>`), so the UI can say "UNFREEZE T3 FIRST" whichever
//! door the edit came through.
//!
//! What stays open on a frozen track: transport, launches and scenes (the loop
//! then plays only while its own slot does — `loop_position`), mute, clip
//! selection, copying FROM it. Undo keeps its clips as they are
//! (`keep_clips` / `put_back`).

use super::Engine;
use crate::clip::Clip;
use crate::track::{Track, NUM_TRACKS};

#[derive(Debug, Default, Clone)]
pub struct FreezeLock {
    slots: [Option<u8>; NUM_TRACKS],
    refused: u32,
    refused_track: usize,
}

/// Verbs whose first argument is a track and that change one of its clips.
/// `command.rs`'s `every_match_verb_is_classified` test keeps this list in
/// step with the dispatcher, like `is_undoable_edit`.
pub fn clip_edit_verb(verb: &str) -> bool {
    matches!(
        verb,
        "tog" | "addp" | "del" | "evel" | "elen" | "enudge" | "etrn" | "slen"
        | "eprob" | "econd" | "einv" | "ltog"
        | "clen" | "cscl" | "ctr" | "cq" | "dbl" | "loop"
        | "pst" | "cap"
        | "clipdel" | "clipdelat" | "clipdup" | "clippaste"
        | "aiclip" | "aiload"
        | "aset" | "asetr" | "aclr" | "aclrs" | "aclrstep"
        // per-voice drum mutes: the loop is one stereo signal, it cannot
        // honour them
        | "pmute" | "psolo"
    )
}

impl FreezeLock {
    /// The clip slot track `t`'s loop belongs to, while it is locked.
    pub fn slot(&self, t: usize) -> Option<usize> {
        self.slots.get(t).copied().flatten().map(usize::from)
    }

    pub fn set(&mut self, t: usize, slot: Option<usize>) {
        if let Some(s) = self.slots.get_mut(t) {
            *s = slot.map(|v| v as u8);
        }
    }

    pub fn any(&self) -> bool {
        self.slots.iter().any(Option::is_some)
    }

    fn refuse(&mut self, t: usize) {
        self.refused = self.refused.wrapping_add(1);
        self.refused_track = t;
    }

    /// `frzr=<count>:<track>`, or nothing before the first refusal. A pure
    /// read: the UI notices the count move.
    pub fn status(&self) -> String {
        if self.refused == 0 {
            return String::new();
        }
        format!(" frzr={}:{}", self.refused, self.refused_track)
    }

    /// Locked tracks' clips, taken before an undo restore.
    pub fn keep_clips(&self, tracks: &[Track]) -> Vec<(usize, Vec<Clip>)> {
        (0..NUM_TRACKS)
            .filter(|&t| self.slot(t).is_some())
            .filter_map(|t| tracks.get(t).map(|k| (t, k.clips.clone())))
            .collect()
    }

    pub fn put_back(&self, tracks: &mut [Track], kept: Vec<(usize, Vec<Clip>)>) {
        for (t, clips) in kept {
            if let Some(k) = tracks.get_mut(t) {
                k.clips = clips;
            }
        }
    }
}

impl Engine {
    /// Whether `op` must not run because of a frozen track; counts the
    /// refusal. Called by `apply_op` before it dispatches.
    pub(crate) fn freeze_refuses(&mut self, verb: &str, first: Option<i64>) -> bool {
        if !self.freeze_lock.any() {
            return false;
        }
        let t = match verb {
            // a capture's tempo pick rewrites the clip it was committed to
            "capsel" => Some(self.cap_track),
            // arming only; a Rec press that ends a take is always allowed
            "rec" if !(self.recording || self.count_in_left > 0 || self.pending_rec) => {
                first.map(|t| t as usize)
            }
            v if clip_edit_verb(v) => first.map(|t| t as usize),
            _ => None,
        };
        match t {
            Some(t) if self.freeze_lock.slot(t).is_some() => {
                self.freeze_lock.refuse(t);
                true
            }
            _ => false,
        }
    }

    /// Whether track `t` is recording or armed to: a freeze waits for the take.
    pub fn recording_on(&self, t: usize) -> bool {
        t == self.rec_track && (self.recording || self.count_in_left > 0 || self.pending_rec)
    }

    /// Track `slot`'s clip length in CLOCK ticks: the clip's own ticks scaled
    /// by its speed (`den / num` clock ticks per clip tick). A frozen loop is
    /// laid out in clock time, since the sample clock is the clock's. `None`
    /// for an empty clip or one whose length the speed does not divide.
    pub fn freeze_len_ticks(&self, t: usize, slot: usize) -> Option<u32> {
        let clip = self.tracks.get(t)?.clips.get(slot)?;
        let len = clip.length_ticks() as u64;
        let (num, den) = (clip.scale_num.max(1) as u64, clip.scale_den.max(1) as u64);
        if len == 0 || !(len * den).is_multiple_of(num) {
            return None;
        }
        u32::try_from(len * den / num).ok()
    }

    /// What a loop was recorded from, as one number: the clip's notes, locks,
    /// trigs and shape (FNV-1a; playback-only fields such as `fired` left out).
    /// Saved with a frozen loop, so an open that finds another clip in the
    /// slot — a Set version restored from before the freeze — opens the track
    /// unfrozen rather than playing a loop of something else.
    pub fn clip_fingerprint(&self, t: usize, slot: usize) -> Option<u64> {
        let c = self.tracks.get(t)?.clips.get(slot)?;
        let mut h: u64 = 0xcbf2_9ce4_8422_2325;
        let mut eat = |v: u64| {
            for b in v.to_le_bytes() {
                h = (h ^ b as u64).wrapping_mul(0x0100_0000_01b3);
            }
        };
        eat(c.length_steps as u64);
        eat(c.loop_start_steps as u64);
        eat(((c.scale_num as u64) << 8) | c.scale_den as u64);
        eat(c.transpose as i64 as u64);
        eat(c.quant as u64);
        for n in &c.notes {
            eat(((n.tick as u64) << 32) | n.gate as u64);
            eat(((n.pitch as u64) << 24) | ((n.vel as u64) << 16) | n.step as u64);
        }
        for l in &c.locks {
            eat(((l.lane as u64) << 24) | ((l.step as u64) << 8) | l.val as u64);
        }
        for g in &c.trigs {
            let p = g.props;
            eat(((g.step as u64) << 48) | ((g.lane.map_or(255, u64::from)) << 40)
                | ((p.prob as u64) << 24) | ((p.cond_a as u64) << 16) | ((p.cond_b as u64) << 8) | p.invert as u64);
        }
        Some(h)
    }

    /// Where locked track `t` is inside its loop at the END of the last block,
    /// in clock ticks with the clock's sub-tick fraction (and the clip-scale
    /// accumulator's) included: what a frozen loop is indexed by. The integer
    /// clock makes it land on the same frame every pass. `None` while stopped,
    /// for an unlocked track, or while the track plays any OTHER slot than the
    /// one its loop came from — a scene or a launch elsewhere is silence.
    pub fn loop_position(&self, t: usize) -> Option<f64> {
        let slot = self.freeze_lock.slot(t)?;
        if !self.playing {
            return None;
        }
        let track = self.tracks.get(t)?;
        if track.playing_slot != Some(slot) {
            return None;
        }
        let clip = track.playing()?;
        let len = clip.length_ticks();
        if len == 0 {
            return None;
        }
        let num = clip.scale_num.max(1) as f64;
        let den = clip.scale_den.max(1) as f64;
        let frac = (track.scale_acc as f64 + self.clock.tick_fraction() * num) / den;
        let rel = (track.pos_tick as f64 - clip.loop_start_ticks() as f64 + frac).rem_euclid(len as f64);
        Some(rel * den / num)
    }
}

#[cfg(test)]
mod tests {
    use crate::command::apply_batch;
    use crate::engine::Engine;

    const RATE: u32 = 44100;
    const FRAMES: u32 = 128;

    fn locked(len_steps: u16, num: u8, den: u8) -> Engine {
        let mut e = Engine::new(RATE, 12000);
        let mut out = Vec::new();
        apply_batch(&mut e, &format!("tog 2 0 60 100;clen 2 {len_steps};cscl 2 {num} {den}"), &mut out);
        e.freeze_lock.set(2, Some(0));
        e
    }

    fn assert_follows_clock(e: &mut Engine, len_clock: f64) {
        let mut out = Vec::new();
        let fpt = RATE as f64 * 60.0 / (120.0 * crate::PPQN as f64);
        for n in 1..=4000u32 {
            e.advance_block(FRAMES, &mut out);
            let want = ((n * FRAMES) as f64 / fpt).rem_euclid(len_clock);
            let got = e.loop_position(2).unwrap();
            let d = (got - want).rem_euclid(len_clock);
            assert!(d.min(len_clock - d) < 1e-6, "block {n}: {got} vs {want}");
        }
    }

    #[test]
    fn loop_position_follows_the_clock_to_the_sample_and_wraps() {
        let mut e = locked(16, 1, 1);
        assert_eq!(e.loop_position(2), None, "stopped");
        assert!(e.play_alone(2));
        assert!(!e.play_alone(2), "already running");
        assert!(e.tracks[0].playing_slot.is_none(), "only the frozen track plays");
        assert_follows_clock(&mut e, crate::TICKS_PER_BAR as f64);
        assert_eq!(e.loop_position(0), None, "an unlocked track");
    }

    /// Reviewed on device: at 1/4 speed every block looked like a jump (clip
    /// ticks against a loop laid out in clock time) and a capture sat at 0%.
    #[test]
    fn a_slow_clip_reports_clock_ticks_over_its_clock_length() {
        for (num, den) in [(1u8, 4u8), (1, 8), (3, 4), (3, 2), (4, 1)] {
            let mut e = locked(16, num, den);
            let len = e.freeze_len_ticks(2, 0).unwrap();
            assert_eq!(len as u64, crate::TICKS_PER_BAR as u64 * den as u64 / num as u64);
            assert!(e.play_alone(2));
            assert_follows_clock(&mut e, len as f64);
        }
    }

    #[test]
    fn another_slot_playing_is_no_position() {
        let mut e = locked(16, 1, 1);
        let mut out = Vec::new();
        apply_batch(&mut e, "play", &mut out);
        e.advance_block(FRAMES, &mut out);
        assert!(e.loop_position(2).is_some());
        e.tracks[2].playing_slot = Some(1);
        assert_eq!(e.loop_position(2), None, "a scene moved the track to another clip");
    }

    #[test]
    fn every_clip_edit_on_a_frozen_track_is_refused_and_counted() {
        let mut e = locked(16, 1, 1);
        let before = e.tracks[2].clips.clone();
        let mut out = Vec::new();
        let ops = [
            "tog 2 4 62 100", "addp 2 0 3 64 100", "del 2 0 15 -1", "evel 2 0 15 -1 5",
            "elen 2 0 15 -1 5", "enudge 2 0 15 -1 5", "etrn 2 0 15 -1 5", "slen 2 0 15 -1 12",
            "eprob 2 0 15 -1 50", "econd 2 0 15 -1 1 2", "einv 2 0 15 -1 1", "ltog 2 8 64 100",
            "clen 2 32", "cscl 2 1 4", "ctr 2 5", "cq 2 50", "dbl 2", "loop 2 0 8",
            "pst 2 0", "clipdel 2", "clipdelat 2 0", "clipdup 2", "clippaste 2 0",
            "aiclip 2 0 16 1 1 0 -", "aiload 2 0 0", "aset 2 0 0 64", "asetr 2 0 0 3 64",
            "aclr 2 0", "aclrs 2 0 0", "aclrstep 2 0",
        ];
        for op in ops {
            apply_batch(&mut e, op, &mut out);
        }
        assert_eq!(e.tracks[2].clips.len(), before.len());
        for (a, b) in e.tracks[2].clips.iter().zip(&before) {
            assert_eq!(format!("{a:?}"), format!("{b:?}"), "a frozen clip changed");
        }
        assert_eq!(e.freeze_lock.status(), format!(" frzr={}:2", ops.len()));
        apply_batch(&mut e, "tog 1 0 60 100", &mut out);
        assert!(e.tracks[1].active().exists(), "other tracks edit as ever");
    }

    #[test]
    fn a_frozen_drum_track_refuses_per_voice_mutes() {
        let mut e = locked(16, 1, 1);
        let mut out = Vec::new();
        apply_batch(&mut e, "pmute 2 36 1;psolo 2 38", &mut out);
        assert!(e.tracks[2].pad_solo.is_none());
        assert!(e.freeze_lock.status().contains("frzr=2:2"));
    }

    #[test]
    fn rec_cannot_arm_a_frozen_track_and_a_keyboard_records_nothing() {
        let mut e = locked(16, 1, 1);
        let mut out = Vec::new();
        apply_batch(&mut e, "rec 2", &mut out);
        assert!(!e.recording_on(2), "armed a frozen track");
        e.rec_track = 2;
        e.recording = true;
        let pitches = |e: &Engine| e.tracks[2].clips[0].notes.iter().map(|n| (n.tick, n.pitch)).collect::<Vec<_>>();
        let notes = pitches(&e);
        apply_batch(&mut e, "play;non 2 64 100", &mut out);
        e.advance_block(FRAMES * 40, &mut out);
        apply_batch(&mut e, "nof 2 64", &mut out);
        assert_eq!(pitches(&e), notes, "a live note landed in the frozen clip");
    }

    #[test]
    fn the_fingerprint_follows_the_clip_not_its_playback() {
        let mut e = locked(16, 1, 1);
        let f = e.clip_fingerprint(2, 0).unwrap();
        let mut out = Vec::new();
        apply_batch(&mut e, "play", &mut out);
        e.advance_block(FRAMES * 400, &mut out);
        assert_eq!(e.clip_fingerprint(2, 0), Some(f), "playback moved it");
        e.freeze_lock.set(2, None);
        apply_batch(&mut e, "tog 2 4 64 100", &mut out);
        assert_ne!(e.clip_fingerprint(2, 0), Some(f));
    }

    #[test]
    fn capture_commit_and_its_tempo_pick_are_refused() {
        let mut e = locked(16, 1, 1);
        let mut out = Vec::new();
        e.cap_track = 2;
        apply_batch(&mut e, "cap 2;capsel 1", &mut out);
        assert!(e.freeze_lock.status().contains("frzr=2:2"));
    }

    /// Reviewed: `uswap` restored the whole sequencer, so undoing an edit made
    /// before the freeze changed the frozen clip under its loop.
    #[test]
    fn undo_restores_everything_but_a_frozen_tracks_clips() {
        let mut e = Engine::new(RATE, 12000);
        let mut out = Vec::new();
        apply_batch(&mut e, "tog 2 0 60 100;tog 1 0 60 100", &mut out);
        let snap = e.undo_snapshot();
        apply_batch(&mut e, "tog 2 4 64 100;tog 1 4 64 100", &mut out);
        let frozen = format!("{:?}", e.tracks[2].clips);
        e.freeze_lock.set(2, Some(0));
        assert!(e.undo_restore(&snap));
        assert_eq!(format!("{:?}", e.tracks[2].clips), frozen, "undo changed the frozen clip");
        assert!(!e.tracks[1].active().step_has_notes(4), "the other track was undone");
    }
}
