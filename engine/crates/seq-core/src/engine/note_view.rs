//! Loop-mode note view: the watched clip's notes, for the UI's folded piano
//! roll (`src/seq/note-view.ts`).
//!
//! The list is too big for the per-block status, so the status carries only a
//! digest (`nh=`) and the UI fetches `notes` when it moves. Held recording
//! notes are listed too, with gate 0: they reach the clip only at release, and
//! without them a live take would show nothing until the pad came up. The UI
//! grows them to the playhead itself, so the digest covers their START only and
//! does not change on every block of a hold.

use super::{Engine, RecPending};

const FNV_OFFSET: u32 = 0x811c_9dc5;
const FNV_PRIME: u32 = 0x0100_0193;

fn mix(h: u32, v: u32) -> u32 {
    v.to_le_bytes().iter().fold(h, |h, &b| (h ^ b as u32).wrapping_mul(FNV_PRIME))
}

impl Engine {
    fn watched_pending(&self) -> impl Iterator<Item = &RecPending> {
        let t = self.watch_track;
        let slot = self.tracks[t].active_clip;
        self.rec_pending
            .iter()
            .chain(self.rec_tail.iter())
            .filter(move |p| p.track == t && p.slot == slot)
    }

    /// The pitch a pending note will be STORED at (see `commit_rec_note`), so a
    /// held note lands on the same folded row its committed self will.
    fn pending_pitch(&self, p: &RecPending) -> u8 {
        (p.pitch as i32 - self.clip_transpose(p.track, p.slot)).clamp(0, 127) as u8
    }

    /// `nh=` payload. A pure read (status runs every block).
    pub fn note_view_hash(&self) -> u32 {
        let t = &self.tracks[self.watch_track];
        let mut h = mix(mix(FNV_OFFSET, self.watch_track as u32), t.active_clip as u32);
        for n in &t.active().notes {
            h = mix(mix(mix(h, n.tick), n.gate), n.pitch as u32);
        }
        for p in self.watched_pending() {
            h = mix(mix(h, p.start_tick.max(0) as u32), 0x100 | self.pending_pitch(p) as u32);
        }
        h
    }

    /// `notes` get: `tick.gate.pitch` per note, comma-separated; gate 0 = held.
    pub fn note_view_list(&self) -> String {
        let clip = self.tracks[self.watch_track].active();
        let mut s = String::with_capacity(clip.notes.len() * 12);
        let push = |s: &mut String, tick: u32, gate: u32, pitch: u8| {
            if !s.is_empty() {
                s.push(',');
            }
            s.push_str(&format!("{tick}.{gate}.{pitch}"));
        };
        for n in &clip.notes {
            push(&mut s, n.tick, n.gate, n.pitch);
        }
        for p in self.watched_pending() {
            push(&mut s, p.start_tick.max(0) as u32, 0, self.pending_pitch(p));
        }
        s
    }
}

#[cfg(test)]
mod tests {
    use crate::engine::Engine;

    fn engine() -> Engine {
        Engine::new(44100, 12000)
    }

    fn run_ticks(e: &mut Engine, ticks: u64) {
        let mut out = Vec::new();
        let start = e.clock.tick;
        while e.clock.tick < start + ticks {
            e.advance_block(128, &mut out);
        }
    }

    #[test]
    fn lists_the_watched_clip_only() {
        let mut e = engine();
        e.tracks[1].active_mut().toggle_step(2, &[(64, 100)]);
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.watch_track = 1;
        let gate = e.tracks[1].active().notes[0].gate;
        assert_eq!(e.note_view_list(), format!("48.{gate}.64"));
    }

    #[test]
    fn digest_moves_on_edit_and_track_switch() {
        let mut e = engine();
        let empty = e.note_view_hash();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        let one = e.note_view_hash();
        assert_ne!(empty, one);
        e.watch_track = 1;
        assert_ne!(e.note_view_hash(), one);
        e.watch_track = 0;
        assert_eq!(e.note_view_hash(), one, "a pure function of the clip");
    }

    #[test]
    fn a_held_recording_note_is_listed_with_gate_zero() {
        let mut e = engine();
        e.toggle_record(0);
        // Run past the one-bar count-in so the take is live.
        run_ticks(&mut e, crate::TICKS_PER_BAR as u64 + 1);
        assert!(e.recording);
        let before = e.note_view_hash();
        e.live_note_on(0, 62, 100);
        assert!(e.note_view_list().ends_with(".0.62"), "{}", e.note_view_list());
        let held = e.note_view_hash();
        assert_ne!(before, held);
        // Holding longer must not move the digest: the UI grows the note.
        run_ticks(&mut e, 4);
        assert_eq!(e.note_view_hash(), held);
        e.live_note_off(0, 62);
        assert!(!e.note_view_list().contains(".0.62"));
    }
}
