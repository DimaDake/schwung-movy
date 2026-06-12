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
}

#[derive(Debug, Clone)]
pub struct Clip {
    pub notes: Vec<Note>,
    /// Loop length in steps (16 per bar). 0 = empty slot (no clip).
    pub length_steps: u16,
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

    pub fn clear(&mut self) {
        self.notes.clear();
        self.length_steps = 0;
    }

    /// Ensure the clip exists and is at least one bar long (implicit clip
    /// creation on first content, native behavior).
    pub fn ensure_exists(&mut self) {
        if self.length_steps == 0 {
            self.length_steps = STEPS_PER_BAR as u16;
        }
    }

    pub fn notes_at_step(&self, step: u16) -> impl Iterator<Item = &Note> {
        self.notes.iter().filter(move |n| n.step == step)
    }

    pub fn step_has_notes(&self, step: u16) -> bool {
        self.notes.iter().any(|n| n.step == step)
    }

    /// Native step toggle: a step containing notes is cleared; an empty step
    /// gets the given pitches placed on the grid with a one-step gate.
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
        self.ensure_exists();
        // Steps beyond the current loop extend it to that bar (native: adding
        // notes to a bar past the end keeps it as part of the loop).
        if step >= self.length_steps {
            self.length_steps = ((step / STEPS_PER_BAR as u16) + 1) * STEPS_PER_BAR as u16;
        }
        for &(pitch, vel) in pitches {
            if self.notes.len() >= MAX_NOTES {
                break;
            }
            self.notes.push(Note {
                tick: step as u32 * TICKS_PER_STEP,
                gate: TICKS_PER_STEP,
                pitch,
                vel,
                step,
            });
        }
        true
    }

    /// 256-bit step occupancy as 64 hex chars (4 steps per char, step 0 =
    /// MSB of the first char) for the UI's step LEDs.
    pub fn occupancy_hex(&self) -> String {
        let mut bits = [0u8; 32];
        for n in &self.notes {
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
    fn note_cap_enforced() {
        let mut c = Clip::new();
        for s in 0..MAX_STEPS {
            c.toggle_step(s, &[(60, 100), (61, 100)]);
        }
        assert!(c.notes.len() <= MAX_NOTES);
    }
}
