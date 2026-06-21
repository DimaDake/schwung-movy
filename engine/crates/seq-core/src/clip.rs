//! Note-centric clip store. Native Move records unquantized, so notes —
//! not steps — are the ground truth: each note carries its absolute tick
//! plus a `step` anchor used by all step operations and LED occupancy.
//! (Davebox's dual steps[]/notes[] model caused LED-vs-edit divergence; the
//! anchor makes that bug class impossible.)

use crate::{STEPS_PER_BAR, TICKS_PER_STEP};

pub const MAX_BARS: u16 = 16;
pub const MAX_STEPS: u16 = MAX_BARS * STEPS_PER_BAR as u16;
/// Hard cap on notes per clip (davebox used 512; same budget).
pub const MAX_NOTES: usize = 512;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Note {
    /// Start tick within the clip, [0, length_ticks).
    pub tick: u32,
    /// Duration in ticks (>= 1).
    pub gate: u32,
    pub pitch: u8,
    pub vel: u8,
    /// Step anchor — authoritative for step ops, LEDs, and step editing.
    pub step: u16,
    /// Just-recorded note: the scheduler skips it until the clip next wraps,
    /// so the take you just played doesn't double-trigger on the same pass
    /// (davebox suppress_until_wrap).
    pub suppress: bool,
}

/// Max automation locks per clip (8 lanes × generous step budget).
pub const MAX_LOCKS: usize = 1024;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Lock {
    /// Automation lane 0..8 (maps to chain knob lane / abs CC 102+lane).
    pub lane: u8,
    pub step: u16,
    /// 7-bit value (0..=127), scaled to the param range by the chain.
    pub val: u8,
}

/// Max trig-condition/probability entries per clip.
pub const MAX_TRIGS: usize = 1024;

/// Resolved per-trig properties (defaults when no row exists).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TrigProps {
    pub prob: u8,   // 0..=100 (%)
    pub cond_a: u8, // A in A:B (>=1)
    pub cond_b: u8, // B in A:B (>=1)
    pub invert: bool,
}

impl TrigProps {
    pub const DEFAULT: TrigProps = TrigProps { prob: 100, cond_a: 1, cond_b: 1, invert: false };
    fn is_default(&self) -> bool { *self == TrigProps::DEFAULT }
}

/// Sparse per-trig override, keyed (step, lane). lane = Some(pitch) for a drum
/// lane, None for the whole (melodic) step — mirrors `Clip::note_matches`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Trig {
    pub step: u16,
    pub lane: Option<u8>,
    pub props: TrigProps,
}

/// Trig condition truth: with 1-based pattern play count `cycle`, A:B plays when
/// `((cycle-1) mod B) + 1 == A`. `invert` flips the result. (1:1 always plays.)
pub fn condition_plays(a: u8, b: u8, invert: bool, cycle: u32) -> bool {
    let b = b.max(1) as u32;
    let plays = (cycle.wrapping_sub(1) % b) + 1 == a as u32;
    plays ^ invert
}

#[derive(Debug, Clone)]
pub struct Clip {
    pub notes: Vec<Note>,
    /// Sparse parameter-automation locks (p-lock model); unlocked steps play
    /// the lane base value (revert-to-base).
    pub locks: Vec<Lock>,
    /// Sparse per-trig probability/condition overrides (absent = defaults).
    pub trigs: Vec<Trig>,
    /// Loop window length in steps (16 per bar). 0 = empty slot (no clip).
    pub length_steps: u16,
    /// First step of the loop window (bar-aligned). Playback wraps inside
    /// [loop_start_steps, loop_start_steps + length_steps).
    pub loop_start_steps: u16,
}

impl Default for Clip {
    fn default() -> Self {
        Clip::new()
    }
}

impl Clip {
    pub fn new() -> Self {
        Clip {
            notes: Vec::new(),
            locks: Vec::new(),
            trigs: Vec::new(),
            length_steps: 0,
            loop_start_steps: 0,
        }
    }

    /// A clip "exists" once it has a length (created implicitly by the
    /// first note entry or recording, or explicitly via loop-length ops).
    pub fn exists(&self) -> bool {
        self.length_steps > 0
    }

    pub fn length_ticks(&self) -> u32 {
        self.length_steps as u32 * TICKS_PER_STEP
    }

    pub fn loop_start_ticks(&self) -> u32 {
        self.loop_start_steps as u32 * TICKS_PER_STEP
    }

    pub fn loop_end_ticks(&self) -> u32 {
        self.loop_start_ticks() + self.length_ticks()
    }

    pub fn clear(&mut self) {
        self.notes.clear();
        self.locks.clear();
        self.trigs.clear();
        self.length_steps = 0;
        self.loop_start_steps = 0;
    }

    /// Resolved trig props for a note at (step, pitch): the most specific row
    /// wins — a (step, Some(pitch)) row, else a (step, None) row, else defaults.
    pub fn governing_trig(&self, step: u16, pitch: u8) -> TrigProps {
        if let Some(t) = self.trigs.iter().find(|t| t.step == step && t.lane == Some(pitch)) {
            return t.props;
        }
        self.trigs.iter()
            .find(|t| t.step == step && t.lane.is_none())
            .map_or(TrigProps::DEFAULT, |t| t.props)
    }

    fn edit_trig(&mut self, s0: u16, s1: u16, lane: Option<u8>, f: impl Fn(&mut TrigProps)) {
        for step in s0..=s1 {
            let idx = self.trigs.iter().position(|t| t.step == step && t.lane == lane);
            let mut props = idx.map_or(TrigProps::DEFAULT, |i| self.trigs[i].props);
            f(&mut props);
            match idx {
                Some(i) if props.is_default() => { self.trigs.swap_remove(i); }
                Some(i) => { self.trigs[i].props = props; }
                None if props.is_default() => {}
                None if self.trigs.len() < MAX_TRIGS => {
                    self.trigs.push(Trig { step, lane, props });
                }
                None => {}
            }
        }
    }

    pub fn set_trig_prob(&mut self, s0: u16, s1: u16, lane: Option<u8>, pct: u8) {
        self.edit_trig(s0, s1, lane, |p| p.prob = pct.min(100));
    }
    pub fn set_trig_cond(&mut self, s0: u16, s1: u16, lane: Option<u8>, a: u8, b: u8) {
        self.edit_trig(s0, s1, lane, |p| { p.cond_a = a.max(1); p.cond_b = b.max(1); });
    }
    pub fn set_trig_invert(&mut self, s0: u16, s1: u16, lane: Option<u8>, inv: bool) {
        self.edit_trig(s0, s1, lane, |p| p.invert = inv);
    }

    /// Upsert a lock for (lane, step). Caps at MAX_LOCKS (drops new ones over).
    pub fn set_lock(&mut self, lane: u8, step: u16, val: u8) {
        if let Some(l) = self.locks.iter_mut().find(|l| l.lane == lane && l.step == step) {
            l.val = val;
            return;
        }
        if self.locks.len() < MAX_LOCKS {
            self.locks.push(Lock { lane, step, val });
        }
    }

    pub fn lock_at(&self, lane: u8, step: u16) -> Option<u8> {
        self.locks.iter().find(|l| l.lane == lane && l.step == step).map(|l| l.val)
    }

    /// Effective automation value at `step` for `lane`, given the lane `base`.
    /// Pure, position-deterministic form of the latch rule: scan backward
    /// cyclically within the loop window — the first lock found governs (it
    /// latched forward with no interrupting note), a note found first means the
    /// latch was already broken → base. Mirrors the engine's forward recurrence
    /// in steady state and is the test oracle for it.
    pub fn effective_at(&self, lane: u8, step: u16, base: u8) -> u8 {
        let len = self.length_steps;
        if len == 0 {
            return base;
        }
        let start = self.loop_start_steps;
        let rel = step.wrapping_sub(start) as i32;
        for d in 0..len as i32 {
            let off = (rel - d).rem_euclid(len as i32) as u16;
            let s = start + off;
            if let Some(v) = self.lock_at(lane, s) {
                return v;
            }
            if self.step_has_notes(s) {
                return base;
            }
        }
        base
    }

    pub fn clear_lane(&mut self, lane: u8) {
        self.locks.retain(|l| l.lane != lane);
    }

    /// Any lock on `lane`? Drives lane release: a lane no clip locks is freed.
    pub fn has_lock_on_lane(&self, lane: u8) -> bool {
        self.locks.iter().any(|l| l.lane == lane)
    }

    /// Remove a single lane's lock at one step (the rest of the lane stays).
    pub fn clear_lock(&mut self, lane: u8, step: u16) {
        self.locks.retain(|l| !(l.lane == lane && l.step == step));
    }

    /// Remove every lane's lock at one step (clear all automation on a step).
    pub fn clear_step_locks(&mut self, step: u16) {
        self.locks.retain(|l| l.step != step);
    }

    /// Set one lane's lock to `val` for every step in [s0, s1] (whole-bar set).
    pub fn set_lock_range(&mut self, lane: u8, s0: u16, s1: u16, val: u8) {
        let mut step = s0;
        while step <= s1 {
            self.set_lock(lane, step, val);
            step += 1;
        }
    }

    /// Bitmask of lanes (bit `lane`) that have ≥1 lock — drives the UI dots.
    pub fn automated_lanes(&self) -> u8 {
        self.locks.iter().fold(0u8, |m, l| m | (1u8 << (l.lane & 7)))
    }

    /// (lane, val) pairs at `step` — for the held-step display.
    pub fn locks_at_step(&self, step: u16) -> impl Iterator<Item = (u8, u8)> + '_ {
        self.locks.iter().filter(move |l| l.step == step).map(|l| (l.lane, l.val))
    }

    /// Ensure the clip exists and is at least one bar long (implicit clip
    /// creation on first content, native behavior).
    pub fn ensure_exists(&mut self) {
        if self.length_steps == 0 {
            self.length_steps = STEPS_PER_BAR as u16;
        }
    }

    /// Set the loop window from a bar-aligned start and length (clamped to
    /// 16 bars total and at least one bar).
    pub fn set_loop(&mut self, start_steps: u16, len_steps: u16) {
        let bar = STEPS_PER_BAR as u16;
        let start = (start_steps / bar) * bar;
        let len = len_steps.max(bar);
        let start = start.min(MAX_STEPS - bar);
        self.loop_start_steps = start;
        self.length_steps = len.min(MAX_STEPS - start);
    }

    /// Double the loop: copy the window's notes into the following window and
    /// double the length (native Double Loop; capped at 16 bars).
    pub fn double_loop(&mut self) {
        if self.length_steps == 0 {
            return;
        }
        let len = self.length_steps;
        let start = self.loop_start_steps;
        if start + len * 2 > MAX_STEPS {
            return; // would exceed 16 bars
        }
        let span_ticks = len as u32 * TICKS_PER_STEP;
        let win_start = start;
        let win_end = start + len;
        let copies: Vec<Note> = self
            .notes
            .iter()
            .filter(|n| n.step >= win_start && n.step < win_end)
            .map(|n| Note {
                tick: n.tick + span_ticks,
                gate: n.gate,
                pitch: n.pitch,
                vel: n.vel,
                step: n.step + len,
                suppress: false,
            })
            .collect();
        for n in copies {
            if self.notes.len() >= MAX_NOTES {
                break;
            }
            self.notes.push(n);
        }
        self.length_steps = len * 2;
    }

    /// Create the clip if needed and grow the loop window's end to include
    /// `step`'s bar (native: adding notes past the loop end extends it).
    fn extend_to_step(&mut self, step: u16) {
        self.ensure_exists();
        let bar = STEPS_PER_BAR as u16;
        let end_of_bar = (step / bar + 1) * bar;
        if end_of_bar > self.loop_start_steps + self.length_steps {
            self.length_steps = (end_of_bar - self.loop_start_steps).min(MAX_STEPS - self.loop_start_steps);
        }
    }

    pub fn notes_at_step(&self, step: u16) -> impl Iterator<Item = &Note> {
        self.notes.iter().filter(move |n| n.step == step)
    }

    pub fn step_has_notes(&self, step: u16) -> bool {
        self.notes.iter().any(|n| n.step == step)
    }

    fn push_note(&mut self, step: u16, pitch: u8, vel: u8) {
        if self.notes.len() >= MAX_NOTES {
            return;
        }
        self.extend_to_step(step);
        self.notes.push(Note {
            tick: step as u32 * TICKS_PER_STEP,
            gate: TICKS_PER_STEP,
            pitch,
            vel,
            step,
            suppress: false,
        });
    }

    /// Record a live note at an explicit tick/gate, suppressed until the clip
    /// next wraps so the just-played take doesn't double-trigger this pass.
    pub fn record_note(&mut self, tick: u32, gate: u32, pitch: u8, vel: u8) {
        if self.notes.len() >= MAX_NOTES {
            return;
        }
        let bar = STEPS_PER_BAR as u32;
        let step = ((tick + TICKS_PER_STEP / 2) / TICKS_PER_STEP) as u16;
        self.extend_to_step(step.min((MAX_STEPS as u32 - bar) as u16));
        self.notes.push(Note { tick, gate: gate.max(1), pitch, vel, step, suppress: true });
    }

    /// Clear the suppress flag on all notes (called when the clip wraps).
    pub fn release_suppressed(&mut self) {
        for n in &mut self.notes {
            n.suppress = false;
        }
    }

    /// Quantize every note's start to the nearest step (Shift+Step 16, full
    /// strength for v1).
    pub fn quantize(&mut self) {
        for n in &mut self.notes {
            let step = (n.tick + TICKS_PER_STEP / 2) / TICKS_PER_STEP;
            n.tick = step * TICKS_PER_STEP;
            n.step = step as u16;
        }
    }

    /// Melodic step toggle: a step containing any notes is cleared; an empty
    /// step gets the given pitches (a chord) placed with a one-step gate.
    /// Returns true if notes were added (relevant for transport auto-start).
    pub fn toggle_step(&mut self, step: u16, pitches: &[(u8, u8)]) -> bool {
        if step >= MAX_STEPS {
            return false;
        }
        if self.step_has_notes(step) {
            self.notes.retain(|n| n.step != step);
            return false;
        }
        if pitches.is_empty() {
            return false;
        }
        for &(pitch, vel) in pitches {
            self.push_note(step, pitch, vel);
        }
        true
    }

    /// Drum-lane toggle: toggle just `pitch` at `step` (add if that pitch is
    /// absent, remove if present), leaving other pitches in the step alone.
    /// Returns true if the note was added.
    pub fn toggle_step_pitch(&mut self, step: u16, pitch: u8, vel: u8) -> bool {
        if step >= MAX_STEPS {
            return false;
        }
        if let Some(i) = self.notes.iter().position(|n| n.step == step && n.pitch == pitch) {
            self.notes.remove(i);
            return false;
        }
        self.push_note(step, pitch, vel);
        true
    }

    /// 256-bit step occupancy as 64 hex chars (4 steps per char, step 0 =
    /// MSB of the first char) for the UI's step LEDs. When `lane` is set,
    /// only notes of that pitch count (drum-lane view); when None, any note
    /// marks the step (melodic view).
    pub fn occupancy_hex_lane(&self, lane: Option<u8>) -> String {
        let mut bits = [0u8; 32];
        for n in &self.notes {
            if let Some(p) = lane {
                if n.pitch != p {
                    continue;
                }
            }
            let s = n.step as usize;
            if s < 256 {
                bits[s / 8] |= 0x80 >> (s % 8);
            }
        }
        let mut out = String::with_capacity(64);
        for b in bits {
            out.push_str(&format!("{b:02x}"));
        }
        out
    }

    pub fn occupancy_hex(&self) -> String {
        self.occupancy_hex_lane(None)
    }

    // ── Step / note property editing (hold-step gestures, manual §11) ──────
    // All operate on notes whose step anchor is in the inclusive range
    // [s0, s1]; a single step uses s0 == s1, a whole bar uses the 16-step
    // range. `lane` (Some(pitch)) restricts the edit to a drum lane.

    fn note_matches(n: &Note, s0: u16, s1: u16, lane: Option<u8>) -> bool {
        n.step >= s0 && n.step <= s1 && lane.map_or(true, |p| n.pitch == p)
    }

    pub fn adjust_velocity(&mut self, s0: u16, s1: u16, lane: Option<u8>, delta: i32) {
        for n in &mut self.notes {
            if Clip::note_matches(n, s0, s1, lane) {
                n.vel = (n.vel as i32 + delta).clamp(1, 127) as u8;
            }
        }
    }

    pub fn transpose(&mut self, s0: u16, s1: u16, lane: Option<u8>, semitones: i32) {
        for n in &mut self.notes {
            if Clip::note_matches(n, s0, s1, lane) {
                n.pitch = (n.pitch as i32 + semitones).clamp(0, 127) as u8;
            }
        }
    }

    /// Lengthen/shorten gates, capped so a note never overruns the next note
    /// of the same pitch (native rule), and never past the clip end.
    pub fn adjust_length(&mut self, s0: u16, s1: u16, lane: Option<u8>, delta: i32) {
        let clip_end = self.length_ticks();
        // Snapshot (tick,pitch) so the cap can scan without borrow conflicts.
        let others: Vec<(u32, u8)> = self.notes.iter().map(|n| (n.tick, n.pitch)).collect();
        for n in &mut self.notes {
            if !Clip::note_matches(n, s0, s1, lane) {
                continue;
            }
            let mut cap = clip_end.saturating_sub(n.tick);
            for &(t, p) in &others {
                if p == n.pitch && t > n.tick {
                    cap = cap.min(t - n.tick);
                }
            }
            let g = (n.gate as i32 + delta).clamp(1, cap.max(1) as i32);
            n.gate = g as u32;
        }
    }

    /// Length in whole steps (rounded up, min 1) of the note anchored at `step`,
    /// or 0 if no note there. Uses the first matching pitch.
    pub fn note_len_steps_at(&self, step: u16) -> u16 {
        self.notes
            .iter()
            .find(|n| n.step == step)
            .map(|n| ((n.gate + TICKS_PER_STEP - 1) / TICKS_PER_STEP).max(1) as u16)
            .unwrap_or(0)
    }

    /// Set the gate of matching notes to an absolute tick length, capped at the
    /// clip end and the next same-pitch note (mirrors adjust_length's caps).
    pub fn set_length(&mut self, s0: u16, s1: u16, lane: Option<u8>, ticks: u32) {
        let clip_end = self.length_ticks();
        let others: Vec<(u32, u8)> = self.notes.iter().map(|n| (n.tick, n.pitch)).collect();
        for n in &mut self.notes {
            if !Clip::note_matches(n, s0, s1, lane) {
                continue;
            }
            let mut cap = clip_end.saturating_sub(n.tick);
            for &(t, p) in &others {
                if p == n.pitch && t > n.tick {
                    cap = cap.min(t - n.tick);
                }
            }
            n.gate = ticks.clamp(1, cap.max(1));
        }
    }

    /// Remove notes whose step anchor is in [s0, s1] (optionally only the
    /// given pitch — drum-pad delete). Used by Delete gestures.
    pub fn delete_range(&mut self, s0: u16, s1: u16, lane: Option<u8>) {
        self.notes
            .retain(|n| !Clip::note_matches(n, s0, s1, lane));
    }

    /// Push a note with an explicit tick/gate (used by paste, which preserves
    /// the source notes' sub-step offset and length).
    pub fn add_note_raw(&mut self, step: u16, tick: u32, gate: u32, pitch: u8, vel: u8) {
        if self.notes.len() >= MAX_NOTES || step >= MAX_STEPS {
            return;
        }
        self.extend_to_step(step);
        self.notes.push(Note { tick, gate, pitch, vel, step, suppress: false });
    }

    /// Add `pitch` to every step in [s0, s1] that doesn't already have it
    /// (Loop Mode "add a note to every step in a bar"). Returns added count.
    pub fn add_pitch_range(&mut self, s0: u16, s1: u16, pitch: u8, vel: u8) -> usize {
        let mut added = 0;
        for step in s0..=s1.min(MAX_STEPS - 1) {
            let present = self.notes.iter().any(|n| n.step == step && n.pitch == pitch);
            if !present {
                self.push_note(step, pitch, vel);
                added += 1;
            }
        }
        added
    }

    /// Sub-step nudge: shift a note's tick within ±one step of its anchor,
    /// keeping the step anchor fixed (davebox note-offset model — the LED and
    /// the audible position never diverge). Clamped to the clip bounds.
    pub fn nudge(&mut self, s0: u16, s1: u16, lane: Option<u8>, delta: i32) {
        let clip_end = self.length_ticks();
        for n in &mut self.notes {
            if !Clip::note_matches(n, s0, s1, lane) {
                continue;
            }
            let anchor = n.step as i32 * TICKS_PER_STEP as i32;
            let lo = (anchor - TICKS_PER_STEP as i32).max(0);
            let hi = (anchor + TICKS_PER_STEP as i32).min(clip_end.saturating_sub(1) as i32);
            n.tick = (n.tick as i32 + delta).clamp(lo, hi) as u32;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trig_defaults_when_absent() {
        let c = Clip::new();
        let t = c.governing_trig(5, 60);
        assert_eq!((t.prob, t.cond_a, t.cond_b, t.invert), (100, 1, 1, false));
    }

    #[test]
    fn set_and_read_trig_props_over_range() {
        let mut c = Clip::new();
        c.set_trig_prob(0, 3, None, 50);
        c.set_trig_cond(0, 3, None, 2, 4);
        c.set_trig_invert(0, 3, None, true);
        let t = c.governing_trig(2, 60);
        assert_eq!((t.prob, t.cond_a, t.cond_b, t.invert), (50, 2, 4, true));
        let u = c.governing_trig(9, 60);
        assert_eq!((u.prob, u.cond_a, u.cond_b, u.invert), (100, 1, 1, false));
    }

    #[test]
    fn drum_lane_trig_is_pitch_specific() {
        let mut c = Clip::new();
        c.set_trig_prob(0, 0, Some(36), 25);
        assert_eq!(c.governing_trig(0, 36).prob, 25);
        assert_eq!(c.governing_trig(0, 38).prob, 100);
    }

    #[test]
    fn lane_specific_trig_overrides_step_wide() {
        let mut c = Clip::new();
        c.set_trig_prob(0, 0, None, 80);
        c.set_trig_prob(0, 0, Some(36), 10);
        assert_eq!(c.governing_trig(0, 36).prob, 10);
        assert_eq!(c.governing_trig(0, 38).prob, 80);
    }

    #[test]
    fn trig_pruned_when_back_to_defaults() {
        let mut c = Clip::new();
        c.set_trig_prob(0, 0, None, 50);
        assert_eq!(c.trigs.len(), 1);
        c.set_trig_prob(0, 0, None, 100);
        assert!(c.trigs.is_empty());
    }

    #[test]
    fn condition_truth_table() {
        for n in 1..=5 { assert!(condition_plays(1, 1, false, n)); }
        assert!(condition_plays(1, 2, false, 1));
        assert!(!condition_plays(1, 2, false, 2));
        assert!(condition_plays(1, 2, false, 3));
        assert!(!condition_plays(2, 2, false, 1));
        assert!(condition_plays(2, 2, false, 2));
        assert!(condition_plays(2, 4, false, 2));
        assert!(condition_plays(2, 4, false, 6));
        assert!(!condition_plays(2, 4, false, 3));
        assert!(condition_plays(4, 7, false, 4));
        assert!(condition_plays(4, 7, false, 11));
        assert!(!condition_plays(4, 7, false, 5));
        assert!(!condition_plays(1, 2, true, 1));
        assert!(condition_plays(1, 2, true, 2));
    }

    #[test]
    fn toggle_adds_then_removes() {
        let mut c = Clip::new();
        assert!(c.toggle_step(0, &[(60, 100)]));
        assert!(c.exists());
        assert_eq!(c.length_steps, 16);
        assert_eq!(c.notes.len(), 1);
        assert_eq!(c.notes[0].tick, 0);
        assert_eq!(c.notes[0].gate, TICKS_PER_STEP);
        // Toggle again removes all notes at the step.
        assert!(!c.toggle_step(0, &[(60, 100)]));
        assert!(c.notes.is_empty());
    }

    #[test]
    fn toggle_chord_clears_whole_step() {
        let mut c = Clip::new();
        c.toggle_step(4, &[(60, 100), (64, 90), (67, 80)]);
        assert_eq!(c.notes.len(), 3);
        // A bare toggle (any pitches) clears all three.
        c.toggle_step(4, &[(72, 100)]);
        assert!(c.notes.is_empty());
    }

    #[test]
    fn empty_pitches_on_empty_step_is_noop() {
        let mut c = Clip::new();
        assert!(!c.toggle_step(3, &[]));
        assert!(!c.exists());
    }

    #[test]
    fn step_beyond_loop_extends_to_bar() {
        let mut c = Clip::new();
        c.toggle_step(0, &[(60, 100)]);
        assert_eq!(c.length_steps, 16);
        c.toggle_step(20, &[(62, 100)]); // bar 2
        assert_eq!(c.length_steps, 32);
    }

    #[test]
    fn occupancy_hex_marks_steps() {
        let mut c = Clip::new();
        c.toggle_step(0, &[(60, 100)]);
        c.toggle_step(7, &[(61, 100)]);
        let hex = c.occupancy_hex();
        assert_eq!(hex.len(), 64);
        // step 0 = bit 7 of byte 0, step 7 = bit 0 → byte 0 = 0x81
        assert_eq!(&hex[0..2], "81");
        assert_eq!(&hex[2..4], "00");
    }

    #[test]
    fn toggle_step_pitch_is_per_pitch() {
        let mut c = Clip::new();
        // Two lanes (drum pitches) share step 4.
        assert!(c.toggle_step_pitch(4, 36, 100));
        assert!(c.toggle_step_pitch(4, 38, 100));
        assert_eq!(c.notes.len(), 2);
        // Removing one lane leaves the other.
        assert!(!c.toggle_step_pitch(4, 36, 100));
        assert_eq!(c.notes.len(), 1);
        assert_eq!(c.notes[0].pitch, 38);
    }

    #[test]
    fn occupancy_lane_filters_by_pitch() {
        let mut c = Clip::new();
        c.toggle_step_pitch(0, 36, 100); // kick lane
        c.toggle_step_pitch(4, 38, 100); // snare lane
        // Snare lane sees only step 4.
        let snare = c.occupancy_hex_lane(Some(38));
        assert_eq!(&snare[0..2], "08"); // step 4 = bit 3 of byte 0
        // Kick lane sees only step 0.
        let kick = c.occupancy_hex_lane(Some(36));
        assert_eq!(&kick[0..2], "80");
        // Melodic view (None) sees both.
        let all = c.occupancy_hex_lane(None);
        assert_eq!(&all[0..2], "88");
    }

    #[test]
    fn set_loop_window_is_bar_aligned_and_clamped() {
        let mut c = Clip::new();
        c.set_loop(20, 40); // start bar 1 (step 16), len 40 → clamps to bars
        assert_eq!(c.loop_start_steps, 16);
        assert_eq!(c.length_steps, 40);
        // Minimum one bar.
        c.set_loop(0, 0);
        assert_eq!(c.length_steps, STEPS_PER_BAR as u16);
    }

    #[test]
    fn double_loop_copies_notes_and_doubles_length() {
        let mut c = Clip::new();
        c.toggle_step(0, &[(60, 100)]);
        c.toggle_step(8, &[(62, 100)]);
        assert_eq!(c.length_steps, 16);
        c.double_loop();
        assert_eq!(c.length_steps, 32);
        // Originals plus copies one bar later.
        assert!(c.step_has_notes(0) && c.step_has_notes(8));
        assert!(c.step_has_notes(16) && c.step_has_notes(24));
        assert_eq!(c.notes.len(), 4);
    }

    #[test]
    fn double_loop_capped_at_16_bars() {
        let mut c = Clip::new();
        c.set_loop(0, 8 * STEPS_PER_BAR as u16); // 8 bars
        c.toggle_step(0, &[(60, 100)]);
        c.double_loop(); // → 16 bars
        assert_eq!(c.length_steps, 16 * STEPS_PER_BAR as u16);
        c.double_loop(); // would be 32 bars → refused
        assert_eq!(c.length_steps, 16 * STEPS_PER_BAR as u16);
    }

    #[test]
    fn adjust_velocity_clamps() {
        let mut c = Clip::new();
        c.toggle_step(0, &[(60, 100)]);
        c.adjust_velocity(0, 0, None, 20);
        assert_eq!(c.notes[0].vel, 120);
        c.adjust_velocity(0, 0, None, 50); // clamp to 127
        assert_eq!(c.notes[0].vel, 127);
        c.adjust_velocity(0, 0, None, -200); // clamp to 1
        assert_eq!(c.notes[0].vel, 1);
    }

    #[test]
    fn transpose_shifts_pitch() {
        let mut c = Clip::new();
        c.toggle_step(0, &[(60, 100)]);
        c.transpose(0, 0, None, 12);
        assert_eq!(c.notes[0].pitch, 72);
    }

    #[test]
    fn adjust_length_caps_at_next_same_pitch() {
        let mut c = Clip::new();
        c.toggle_step(0, &[(60, 100)]);   // gate = TICKS_PER_STEP (24)
        c.toggle_step(2, &[(60, 100)]);   // same pitch two steps later
        c.adjust_length(0, 0, None, 1000); // try to grow hugely
        // Capped to reach (not pass) the next C at tick 48.
        let first = c.notes.iter().find(|n| n.tick == 0).unwrap();
        assert_eq!(first.gate, 2 * TICKS_PER_STEP);
    }

    #[test]
    fn nudge_keeps_step_anchor() {
        let mut c = Clip::new();
        c.toggle_step(4, &[(60, 100)]);
        let anchor = c.notes[0].step;
        c.nudge(4, 4, None, 5);
        assert_eq!(c.notes[0].step, anchor); // anchor unchanged
        assert_eq!(c.notes[0].tick, 4 * TICKS_PER_STEP + 5);
        // Can't nudge beyond ±one step from the anchor.
        c.nudge(4, 4, None, 1000);
        assert!(c.notes[0].tick <= 5 * TICKS_PER_STEP);
    }

    #[test]
    fn range_edits_cover_a_bar() {
        let mut c = Clip::new();
        c.toggle_step(0, &[(60, 50)]);
        c.toggle_step(8, &[(62, 50)]);
        c.adjust_velocity(0, 15, None, 10); // whole bar
        assert!(c.notes.iter().all(|n| n.vel == 60));
    }

    #[test]
    fn set_length_sets_absolute_gate() {
        let mut c = Clip::new();
        c.toggle_step(0, &[(60, 100)]);            // gate = TICKS_PER_STEP
        c.set_length(0, 0, None, 4 * TICKS_PER_STEP);
        let n = c.notes.iter().find(|n| n.tick == 0).unwrap();
        assert_eq!(n.gate, 4 * TICKS_PER_STEP);
    }

    #[test]
    fn lock_set_upsert_and_read() {
        let mut c = Clip::new();
        c.set_lock(2, 4, 100);
        c.set_lock(2, 4, 120); // upsert same lane+step
        assert_eq!(c.lock_at(2, 4), Some(120));
        assert_eq!(c.lock_at(2, 5), None);
        assert_eq!(c.locks.len(), 1);
    }

    #[test]
    fn automated_lanes_bitmask() {
        let mut c = Clip::new();
        c.set_lock(0, 0, 10);
        c.set_lock(3, 8, 20);
        assert_eq!(c.automated_lanes(), 0b0000_1001);
    }

    #[test]
    fn clear_lane_removes_only_that_lane() {
        let mut c = Clip::new();
        c.set_lock(1, 0, 10);
        c.set_lock(2, 0, 20);
        c.clear_lane(1);
        assert_eq!(c.lock_at(1, 0), None);
        assert_eq!(c.lock_at(2, 0), Some(20));
    }

    #[test]
    fn locks_at_step_lists_pairs() {
        let mut c = Clip::new();
        c.set_lock(0, 6, 11);
        c.set_lock(5, 6, 99);
        c.set_lock(0, 7, 1);
        let mut got: Vec<(u8, u8)> = c.locks_at_step(6).collect();
        got.sort_unstable();
        assert_eq!(got, vec![(0, 11), (5, 99)]);
    }

    #[test]
    fn note_cap_enforced() {
        let mut c = Clip::new();
        for s in 0..MAX_STEPS {
            c.toggle_step(s, &[(60, 100), (61, 100)]);
        }
        assert!(c.notes.len() <= MAX_NOTES);
    }

    #[test]
    fn effective_at_latches_until_note_or_lock() {
        let mut c = Clip::new();
        // One-bar clip: note at step 0 (extends length to 16), lock 100 at step 4.
        c.toggle_step(0, &[(60, 100)]);
        c.set_lock(0, 4, 100);
        // base = 40 (resting value)
        assert_eq!(c.effective_at(0, 0, 40), 40); // note at step 0 → base
        assert_eq!(c.effective_at(0, 3, 40), 40); // before the lock → base (carry of base)
        assert_eq!(c.effective_at(0, 4, 40), 100); // lock
        assert_eq!(c.effective_at(0, 9, 40), 100); // latch holds (no note, no later lock)
        assert_eq!(c.effective_at(0, 15, 40), 100); // still holds to end of bar
    }

    #[test]
    fn effective_at_note_on_other_step_reverts_to_base() {
        let mut c = Clip::new();
        c.toggle_step(0, &[(60, 100)]); // note step 0
        c.toggle_step(8, &[(62, 100)]); // note step 8 (different step) ends the latch
        c.set_lock(0, 4, 100);
        assert_eq!(c.effective_at(0, 7, 40), 100); // latch from lock 4 still on
        assert_eq!(c.effective_at(0, 8, 40), 40); // note on step 8 reverts to base
        assert_eq!(c.effective_at(0, 12, 40), 40); // stays base after the interrupting note
    }

    #[test]
    fn effective_at_lock_wins_over_same_step_note() {
        let mut c = Clip::new();
        c.toggle_step(0, &[(60, 100)]); // note AND lock on step 0
        c.set_lock(0, 0, 90);
        assert_eq!(c.effective_at(0, 0, 40), 90); // co-located lock wins (note doesn't end it)
        assert_eq!(c.effective_at(0, 5, 40), 90); // latches forward
    }

    #[test]
    fn effective_at_carries_across_loop_boundary() {
        let mut c = Clip::new();
        c.toggle_step(0, &[(60, 100)]); // length 16; note at step 0
        c.set_lock(0, 14, 77);
        // Going backward cyclically from step 2: 2,1,0 — the note at step 0 ends
        // the latch before reaching lock 14 → base at step 2.
        assert_eq!(c.effective_at(0, 2, 40), 40);
        // Remove the note: now the lock at 14 wraps to govern step 2.
        c.notes.clear();
        assert_eq!(c.effective_at(0, 2, 40), 77); // carries across the boundary
    }

    #[test]
    fn effective_at_no_locks_is_base() {
        let mut c = Clip::new();
        c.toggle_step(0, &[(60, 100)]);
        assert_eq!(c.effective_at(0, 5, 40), 40);
    }
}
