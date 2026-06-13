//! Compact, dependency-free serialization of the sequencer's persistent
//! state (tempo, per-track selection/mute, clips + notes). Transport state
//! (playing/queued slots, recording, clock position) is deliberately not
//! saved — it always starts stopped, matching davebox's "loop cycle doesn't
//! persist" lesson.
//!
//! Line format (newline-separated):
//!   movy1
//!   bpm <bpm_x100>
//!   tk <track> <active_clip> <muted0|1>
//!   cl <track> <slot> <len_steps> <loop_start_steps> <notes>
//! where <notes> is `tick:gate:pitch:vel;…` (omitted when the clip is empty).
//! Unknown lines are ignored so the format can grow.

use crate::clip::Clip;
use crate::engine::Engine;

pub const FORMAT_TAG: &str = "movy1";

pub fn serialize(engine: &Engine) -> String {
    let mut s = String::with_capacity(1024);
    s.push_str(FORMAT_TAG);
    s.push('\n');
    s.push_str(&format!("bpm {}\n", engine.clock.bpm_x100()));
    for (ti, t) in engine.tracks.iter().enumerate() {
        s.push_str(&format!("tk {} {} {}\n", ti, t.active_clip, t.muted as u8));
        for (ci, c) in t.clips.iter().enumerate() {
            if !c.exists() {
                continue;
            }
            s.push_str(&format!("cl {} {} {} {} ", ti, ci, c.length_steps, c.loop_start_steps));
            for (i, n) in c.notes.iter().enumerate() {
                if i > 0 {
                    s.push(';');
                }
                s.push_str(&format!("{}:{}:{}:{}", n.tick, n.gate, n.pitch, n.vel));
            }
            s.push('\n');
        }
    }
    s
}

/// Replace the engine's persistent state from a serialized string. Returns
/// true if the format tag matched (a real load happened).
pub fn load(engine: &mut Engine, data: &str) -> bool {
    let mut lines = data.lines();
    if lines.next().map(str::trim) != Some(FORMAT_TAG) {
        return false;
    }
    // Reset all clips before applying.
    for t in &mut engine.tracks {
        for c in &mut t.clips {
            c.clear();
        }
        t.active_clip = 0;
        t.muted = false;
        t.playing_slot = None;
        t.queued_slot = None;
        t.pending_stop = false;
    }
    for line in lines {
        let mut it = line.split_whitespace();
        match it.next() {
            Some("bpm") => {
                if let Some(v) = it.next().and_then(|x| x.parse::<u32>().ok()) {
                    engine.clock.set_bpm_x100(v);
                }
            }
            Some("tk") => {
                let nums: Vec<usize> = it.filter_map(|x| x.parse().ok()).collect();
                if let [track, active, muted] = nums[..] {
                    if track < engine.tracks.len() {
                        engine.tracks[track].active_clip = active.min(7);
                        engine.tracks[track].muted = muted != 0;
                    }
                }
            }
            Some("cl") => load_clip(engine, &mut it),
            _ => {}
        }
    }
    true
}

fn load_clip<'a>(engine: &mut Engine, it: &mut impl Iterator<Item = &'a str>) {
    let track = it.next().and_then(|x| x.parse::<usize>().ok());
    let slot = it.next().and_then(|x| x.parse::<usize>().ok());
    let len = it.next().and_then(|x| x.parse::<u16>().ok());
    let lstart = it.next().and_then(|x| x.parse::<u16>().ok());
    let (Some(track), Some(slot), Some(len), Some(lstart)) = (track, slot, len, lstart) else {
        return;
    };
    if track >= engine.tracks.len() || slot >= 8 {
        return;
    }
    let clip = &mut engine.tracks[track].clips[slot];
    *clip = Clip::new();
    clip.set_loop(lstart, len);
    if let Some(notes) = it.next() {
        for tok in notes.split(';') {
            let parts: Vec<&str> = tok.split(':').collect();
            if parts.len() == 4 {
                if let (Ok(tick), Ok(gate), Ok(pitch), Ok(vel)) = (
                    parts[0].parse::<u32>(),
                    parts[1].parse::<u32>(),
                    parts[2].parse::<u8>(),
                    parts[3].parse::<u8>(),
                ) {
                    let step = ((tick + crate::TICKS_PER_STEP / 2) / crate::TICKS_PER_STEP) as u16;
                    clip.add_note_raw(step, tick, gate.max(1), pitch.min(127), vel.clamp(1, 127));
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_state() {
        let mut e = Engine::new(44100, 13000);
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.tracks[0].active_mut().toggle_step(4, &[(64, 90), (67, 80)]);
        e.tracks[2].clips[3].toggle_step(8, &[(48, 110)]);
        e.tracks[2].active_clip = 3;
        e.tracks[1].muted = true;
        e.tracks[0].active_mut().set_loop(0, 32);

        let s = serialize(&e);

        let mut e2 = Engine::new(44100, 12000);
        assert!(load(&mut e2, &s));
        assert_eq!(e2.clock.bpm_x100(), 13000);
        assert_eq!(e2.tracks[0].active().notes.len(), 3);
        assert_eq!(e2.tracks[0].active().length_steps, 32);
        assert!(e2.tracks[1].muted);
        assert_eq!(e2.tracks[2].active_clip, 3);
        assert!(e2.tracks[2].clips[3].step_has_notes(8));
        // Transport never persists.
        assert!(!e2.playing);
        assert_eq!(e2.tracks[0].playing_slot, None);
    }

    #[test]
    fn rejects_unknown_format() {
        let mut e = Engine::new(44100, 12000);
        assert!(!load(&mut e, "garbage\nbpm 9000\n"));
        assert_eq!(e.clock.bpm_x100(), 12000); // unchanged
    }

    #[test]
    fn load_clears_previous_state() {
        let mut e = Engine::new(44100, 12000);
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        // Load a state with no clips → track 0 should be empty after.
        assert!(load(&mut e, "movy1\nbpm 12000\n"));
        assert!(!e.tracks[0].active().exists());
    }
}
