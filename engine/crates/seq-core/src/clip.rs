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

#[derive(Debug, Clone)]
pub struct Clip {
    pub notes: Vec<Note>,
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
        self.length_steps = 0;
        self.loop_start_steps = 0;
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
    fn note_cap_enforced() {
        let mut c = Clip::new();
        for s in 0..MAX_STEPS {
            c.toggle_step(s, &[(60, 100), (61, 100)]);
        }
        assert!(c.notes.len() <= MAX_NOTES);
    }
}
