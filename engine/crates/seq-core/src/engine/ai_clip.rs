//! AI MIDI (plans/2026-10-26-ai-midi-design.md §6.4): the UI reads a whole
//! track's clips to describe the Set to a language model (`ait:<t>`), and
//! writes a preview option back as one atomic clip replacement (`aiclip`).
//! The engine stays the only owner of clip truth; the UI holds candidates only.

use std::fmt::Write;

use super::Engine;
use crate::clip::{Note, MAX_NOTES, MAX_STEPS};
use crate::track::{CLIPS_PER_TRACK, NUM_TRACKS};
use crate::TICKS_PER_STEP;

/// ORIG + up to eight options (Variation; Smart Quantize uses three).
pub const AI_STASH_SLOTS: usize = 9;

/// One preview write: everything `aiclip` sets on a clip.
pub struct AiClipWrite<'a> {
    pub track: usize,
    pub slot: usize,
    pub len_steps: u16,
    pub scale_num: u8,
    pub scale_den: u8,
    pub quant: u8,
    pub notes: &'a [(u32, u32, u8, u8)],
}

/// `tick.gate.pitch.vel,...` (or `-`) → note tuples; malformed items are
/// skipped rather than failing the write, since the UI already validated.
pub fn parse_ai_notes(s: &str) -> Vec<(u32, u32, u8, u8)> {
    if s == "-" {
        return Vec::new();
    }
    s.split(',')
        .filter_map(|item| {
            let mut f = item.split('.').map(|v| v.parse::<i64>().ok());
            let (t, g, p, v) = (f.next()??, f.next()??, f.next()??, f.next()??);
            if t < 0 {
                return None;
            }
            Some((t as u32, g.max(0) as u32, p.clamp(0, 127) as u8, v.clamp(0, 127) as u8))
        })
        .collect()
}

impl Engine {
    /// `ait:<t>` payload: one line per existing clip. Pitches are STORED
    /// (untransposed) and the transpose travels alongside, so the UI can show
    /// sounding pitch while a round trip through `aiclip` stays exact.
    pub fn ai_track_dump(&self, t: usize) -> String {
        let mut s = String::new();
        if t >= NUM_TRACKS {
            return s;
        }
        for (slot, c) in self.tracks[t].clips.iter().enumerate() {
            if !c.exists() {
                continue;
            }
            if !s.is_empty() {
                s.push('\n');
            }
            let _ = write!(s, "{} {} {} {}/{} {} {}|", slot, c.length_steps, c.loop_start_steps,
                c.scale_num, c.scale_den, c.transpose, c.quant);
            for (i, n) in c.notes.iter().enumerate() {
                if i > 0 {
                    s.push(',');
                }
                let _ = write!(s, "{}.{}.{}.{}", n.tick, n.gate, n.pitch, n.vel);
            }
        }
        s
    }

    /// Copy the clip at (t, slot) — empty or not — into stash `k`.
    pub fn ai_stash_clip(&mut self, t: usize, slot: usize, k: usize) {
        if t < NUM_TRACKS && slot < CLIPS_PER_TRACK && k < AI_STASH_SLOTS {
            self.ai_stash[k] = Some(self.tracks[t].clips[slot].clone());
        }
    }

    /// Put stash `k` back at (t, slot); nothing stashed there = no change.
    pub fn ai_load_clip(&mut self, t: usize, slot: usize, k: usize) {
        if t >= NUM_TRACKS || slot >= CLIPS_PER_TRACK || k >= AI_STASH_SLOTS {
            return;
        }
        if let Some(c) = self.ai_stash[k].clone() {
            self.tracks[t].clips[slot] = c;
            self.dirty = true;
        }
    }

    pub fn ai_clear_stash(&mut self) {
        self.ai_stash.iter_mut().for_each(|s| *s = None);
    }

    /// Replace a clip wholesale. Locks and trig overrides go with the old
    /// notes: their step anchors described notes that no longer exist (§6.4).
    pub fn ai_replace_clip(&mut self, w: &AiClipWrite) {
        if w.track >= NUM_TRACKS || w.slot >= CLIPS_PER_TRACK || w.len_steps == 0 {
            return;
        }
        let len_steps = w.len_steps.min(MAX_STEPS);
        let len_ticks = len_steps as u32 * TICKS_PER_STEP;
        let c = &mut self.tracks[w.track].clips[w.slot];
        c.notes.clear();
        c.locks.clear();
        c.trigs.clear();
        c.length_steps = len_steps;
        c.loop_start_steps = 0;
        c.scale_num = w.scale_num.max(1);
        c.scale_den = w.scale_den.max(1);
        c.quant = w.quant.min(100);
        let mut notes: Vec<Note> = w.notes.iter()
            .filter(|n| n.0 < len_ticks)
            .take(MAX_NOTES)
            .map(|&(tick, gate, pitch, vel)| Note {
                tick,
                gate: gate.clamp(1, len_ticks - tick),
                pitch: pitch.min(127),
                vel: vel.clamp(1, 127),
                step: (((tick + TICKS_PER_STEP / 2) / TICKS_PER_STEP) as u16).min(len_steps - 1),
                suppress: false,
                fired: false,
            })
            .collect();
        notes.sort_by_key(|n| (n.tick, n.pitch));
        c.notes = notes;
        self.dirty = true;
    }
}

#[cfg(test)]
mod tests {
    use crate::command::apply_batch;
    use crate::engine::Engine;

    fn engine() -> Engine {
        Engine::new(44100, 12000)
    }

    fn cmd(e: &mut Engine, s: &str) {
        let mut out = Vec::new();
        apply_batch(e, s, &mut out);
    }

    #[test]
    fn dump_lists_only_nonempty_slots() {
        let mut e = engine();
        cmd(&mut e, "aiclip 2 3 16 1 1 0 0.24.60.100,48.24.64.90");
        let d = e.ai_track_dump(2);
        assert_eq!(d, "3 16 0 1/1 0 0|0.24.60.100,48.24.64.90");
        assert_eq!(e.ai_track_dump(1), "");
    }

    #[test]
    fn dump_roundtrips_through_replace() {
        let mut e = engine();
        cmd(&mut e, "aiclip 0 0 32 1 2 50 0.12.36.127,96.6.38.80,200.10.42.64");
        let line = e.ai_track_dump(0);
        let (head, notes) = line.split_once('|').unwrap();
        let f: Vec<&str> = head.split(' ').collect();
        let sc: Vec<&str> = f[3].split('/').collect();
        cmd(&mut e, &format!("aiclip 0 5 {} {} {} {} {}", f[1], sc[0], sc[1], f[5], notes));
        let again = e.ai_track_dump(0);
        let lines: Vec<&str> = again.lines().collect();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].split_once(' ').unwrap().1, lines[1].split_once(' ').unwrap().1);
    }

    #[test]
    fn replace_creates_empty_slot_clip() {
        let mut e = engine();
        assert!(!e.tracks[4].clips[6].exists());
        cmd(&mut e, "aiclip 4 6 64 1 1 0 -");
        let c = &e.tracks[4].clips[6];
        assert!(c.exists());
        assert_eq!(c.length_steps, 64);
        assert!(c.notes.is_empty());
    }

    #[test]
    fn replace_clears_locks_and_trigs() {
        let mut e = engine();
        cmd(&mut e, "aiclip 0 0 16 1 1 0 0.24.60.100");
        {
            let c = &mut e.tracks[0].clips[0];
            c.set_lock(0, 0, 5);
            c.set_trig_prob(0, 0, None, 50);
        }
        assert!(!e.tracks[0].clips[0].locks.is_empty());
        cmd(&mut e, "aiclip 0 0 16 1 1 0 24.24.62.100");
        let c = &e.tracks[0].clips[0];
        assert!(c.locks.is_empty());
        assert!(c.trigs.is_empty());
        assert_eq!(c.notes[0].pitch, 62);
        assert_eq!(c.notes[0].step, 1);
    }

    #[test]
    fn replace_clamps_out_of_range() {
        let mut e = engine();
        // len 16 steps = 384 ticks: tick 400 dropped, gate 0 -> 1,
        // vel 0 -> 1, gate past the end clipped to the clip.
        cmd(&mut e, "aiclip 1 0 16 1 1 0 400.10.60.100,0.0.61.0,380.50.62.200");
        let c = &e.tracks[1].clips[0];
        assert_eq!(c.notes.len(), 2);
        let n0 = c.notes.iter().find(|n| n.pitch == 61).unwrap();
        assert_eq!((n0.gate, n0.vel), (1, 1));
        let n1 = c.notes.iter().find(|n| n.pitch == 62).unwrap();
        assert_eq!((n1.gate, n1.vel, n1.step), (4, 127, 15));
    }

    #[test]
    fn replace_is_one_undo() {
        let mut e = engine();
        cmd(&mut e, "aiclip 0 0 16 1 1 0 0.24.60.100");
        cmd(&mut e, "usnap 7;aiclip 0 0 16 1 1 0 0.24.72.100");
        assert_eq!(e.tracks[0].clips[0].notes[0].pitch, 72);
        cmd(&mut e, "uswap 7 8");
        assert_eq!(e.tracks[0].clips[0].notes[0].pitch, 60);
    }

    #[test]
    fn stash_and_load_restore_a_clip_exactly() {
        let mut e = engine();
        cmd(&mut e, "aiclip 0 2 32 1 2 70 0.24.60.100");
        e.tracks[0].clips[2].set_lock(0, 3, 9);
        e.tracks[0].clips[2].transpose = 5;
        cmd(&mut e, "aistash 0 2 0;aiclip 0 2 16 1 1 0 0.24.72.100");
        assert!(e.tracks[0].clips[2].locks.is_empty());
        cmd(&mut e, "aistash 0 2 1;aiload 0 2 0");
        let c = &e.tracks[0].clips[2];
        assert_eq!((c.length_steps, c.quant, c.transpose, c.locks.len()), (32, 70, 5, 1));
        assert_eq!(c.notes[0].pitch, 60);
        cmd(&mut e, "aiload 0 2 1");
        assert_eq!(e.tracks[0].clips[2].notes[0].pitch, 72);
    }

    #[test]
    fn eighth_variation_option_stashes_and_ninth_is_refused() {
        let mut e = engine();
        cmd(&mut e, "aiclip 0 0 16 1 1 0 0.24.67.100;aistash 0 0 8;aiclip 0 0 16 1 1 0 0.24.72.100;aiload 0 0 8");
        assert_eq!(e.tracks[0].clips[0].notes[0].pitch, 67);
        cmd(&mut e, "aistash 0 0 9;aiclip 0 0 16 1 1 0 0.24.60.100;aiload 0 0 9");
        assert_eq!(e.tracks[0].clips[0].notes[0].pitch, 60);
    }

    #[test]
    fn stash_of_an_empty_slot_loads_back_empty() {
        let mut e = engine();
        cmd(&mut e, "aistash 3 4 0;aiclip 3 4 16 1 1 0 0.24.60.100;aiload 3 4 0");
        assert!(!e.tracks[3].clips[4].exists());
    }

    #[test]
    fn load_without_stash_and_after_clear_is_a_noop() {
        let mut e = engine();
        cmd(&mut e, "aiclip 0 0 16 1 1 0 0.24.60.100;aiload 0 0 2");
        assert_eq!(e.tracks[0].clips[0].notes.len(), 1);
        cmd(&mut e, "aistash 0 0 1;aiclr;aiload 0 0 1");
        assert_eq!(e.tracks[0].clips[0].notes.len(), 1);
    }

    #[test]
    fn dump_under_value_cap() {
        let mut e = engine();
        let notes: Vec<String> = (0..512)
            .map(|i| format!("{}.{}.{}.{}", 6143 - i, 6143, 127, 127))
            .collect();
        let s = notes.join(",");
        for slot in 0..8 {
            cmd(&mut e, &format!("aiclip 0 {slot} 256 1 1 100 {s}"));
        }
        assert!(e.ai_track_dump(0).len() < 131072);
    }
}
