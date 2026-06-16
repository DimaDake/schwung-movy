//! Wire protocol: the UI batches ops into one `set_param("cmd", "op;op;…")`
//! per UI tick (the param channel coalesces — only the last write per audio
//! buffer survives — so ops must travel together). Each op is a short verb
//! plus space-separated integer args. Unknown ops are ignored so old engines
//! tolerate newer UIs.

use crate::engine::{Engine, OutEvent};
use crate::track::NUM_TRACKS;

/// Apply one batched command string. MIDI side effects (e.g. note-offs from
/// a stop) are pushed into `out`.
pub fn apply_batch(engine: &mut Engine, batch: &str, out: &mut Vec<OutEvent>) {
    for op in batch.split(';') {
        let op = op.trim();
        if !op.is_empty() {
            apply_op(engine, op, out);
            engine.dirty = true; // a UI command may have changed saved state
        }
    }
}

fn apply_op(engine: &mut Engine, op: &str, out: &mut Vec<OutEvent>) {
    let mut it = op.split_whitespace();
    let verb = it.next().unwrap_or("");
    let mut next = || it.next().and_then(|s| s.parse::<i64>().ok());

    match verb {
        "play" => engine.play(),
        "stop" => engine.stop(out),
        "bpm" => {
            if let Some(v) = next() {
                engine.clock.set_bpm_x100(v.clamp(0, u32::MAX as i64) as u32);
            }
        }
        "watch" => {
            if let Some(t) = next() {
                if (t as usize) < NUM_TRACKS {
                    engine.watch_track = t as usize;
                }
            }
        }
        // wlane <pitch|-1> — set the watched step-LED lane (-1 = melodic).
        "wlane" => {
            if let Some(p) = next() {
                engine.watch_lane = if (0..128).contains(&p) { Some(p as u8) } else { None };
            }
        }
        "mute" => {
            if let (Some(t), Some(m)) = (next(), next()) {
                if (t as usize) < NUM_TRACKS {
                    engine.tracks[t as usize].muted = m != 0;
                }
            }
        }
        // tog <track> <step> <p1> <v1> [<p2> <v2> ...] — melodic step toggle
        // (clear the step if it has notes, else place the chord).
        "tog" => {
            if let (Some(t), Some(s)) = (next(), next()) {
                let mut chord: Vec<(u8, u8)> = Vec::new();
                while let (Some(p), Some(v)) = (next(), next()) {
                    if (0..128).contains(&p) {
                        chord.push((p as u8, v.clamp(1, 127) as u8));
                    }
                }
                if (t as usize) < NUM_TRACKS {
                    let added = engine.tracks[t as usize]
                        .active_mut()
                        .toggle_step(s.clamp(0, 255) as u16, &chord);
                    engine.maybe_autostart(added);
                }
            }
        }
        // Note-edit gestures over an inclusive step range [s0,s1] (single
        // step: s0==s1; whole bar: 16-step range). p = lane pitch or -1 (all).
        // evel/elen/enudge <t> <s0> <s1> <p> <delta>; etrn <t> <s0> <s1> <p> <semitones>
        "evel" | "elen" | "enudge" | "etrn" => {
            if let (Some(t), Some(s0), Some(s1), Some(p), Some(d)) =
                (next(), next(), next(), next(), next())
            {
                if (t as usize) < NUM_TRACKS {
                    let lane = if (0..128).contains(&p) { Some(p as u8) } else { None };
                    let (a, b) = (s0.clamp(0, 255) as u16, s1.clamp(0, 255) as u16);
                    let clip = engine.tracks[t as usize].active_mut();
                    let dv = d as i32;
                    match verb {
                        "evel" => clip.adjust_velocity(a, b, lane, dv),
                        "elen" => clip.adjust_length(a, b, lane, dv),
                        "enudge" => clip.nudge(a, b, lane, dv),
                        _ => clip.transpose(a, b, lane, dv),
                    }
                }
            }
        }
        // hold <track> <step> — set the step-length query (step < 0 clears).
        "hold" => {
            if let (Some(t), Some(s)) = (next(), next()) {
                engine.set_held_query(if s < 0 { None } else { Some((t as usize, s.clamp(0, 255) as u16)) });
            }
        }
        // slen <t> <s0> <s1> <p> <ticks> — set absolute note length.
        "slen" => {
            if let (Some(t), Some(s0), Some(s1), Some(p), Some(tk)) =
                (next(), next(), next(), next(), next())
            {
                if (t as usize) < NUM_TRACKS {
                    let lane = if (0..128).contains(&p) { Some(p as u8) } else { None };
                    let (a, b) = (s0.clamp(0, 255) as u16, s1.clamp(0, 255) as u16);
                    engine.tracks[t as usize].active_mut().set_length(a, b, lane, tk.max(1) as u32);
                }
            }
        }
        // rec <t> — toggle recording on track (one-bar count-in).
        "rec" => {
            if let Some(t) = next() {
                engine.toggle_record(t as usize);
            }
        }
        // metro <0|1> — metronome on/off.
        "metro" => {
            if let Some(v) = next() {
                engine.set_metronome(v != 0);
            }
        }
        // quant <t> — quantize the active clip to the grid.
        "quant" => {
            if let Some(t) = next() {
                engine.quantize_active(t as usize);
            }
        }
        // non/nof <t> <pitch> [vel] — live pad note for recording capture.
        // The UI sounds the note directly; these only record.
        "non" => {
            if let (Some(t), Some(p), Some(v)) = (next(), next(), next()) {
                if (0..128).contains(&p) {
                    engine.live_note_on(t as usize, p as u8, v.clamp(1, 127) as u8);
                }
            }
        }
        "nof" => {
            if let (Some(t), Some(p)) = (next(), next()) {
                if (0..128).contains(&p) {
                    engine.live_note_off(t as usize, p as u8);
                }
            }
        }
        // del <t> <s0> <s1> <pitch|-1> — delete notes in range (step delete,
        // bar delete, or drum-pad delete with a pitch + full 0..255 range).
        "del" => {
            if let (Some(t), Some(s0), Some(s1), Some(p)) = (next(), next(), next(), next()) {
                let lane = if (0..128).contains(&p) { Some(p as u8) } else { None };
                engine.delete_range(t as usize, s0.clamp(0, 255) as u16, s1.clamp(0, 255) as u16, lane);
            }
        }
        "clipdup" => {
            if let Some(t) = next() {
                engine.duplicate_clip(t as usize);
            }
        }
        "clipdel" => {
            if let Some(t) = next() {
                engine.delete_clip(t as usize);
            }
        }
        "clipsel" => {
            if let (Some(t), Some(s)) = (next(), next()) {
                engine.select_clip(t as usize, s.max(0) as usize);
            }
        }
        // launch <t> <slot> — Session launch (or select-empty-stops).
        "launch" => {
            if let (Some(t), Some(s)) = (next(), next()) {
                engine.launch_clip(t as usize, s.max(0) as usize);
            }
        }
        // stoptrk <t> — stop a track's clip (quantized while running).
        "stoptrk" => {
            if let Some(t) = next() {
                engine.stop_track(t as usize);
            }
        }
        // Session clip copy/paste/delete by explicit slot.
        "clipcopy" => {
            if let (Some(t), Some(s)) = (next(), next()) {
                engine.copy_clip(t as usize, s.max(0) as usize);
            }
        }
        "clippaste" => {
            if let (Some(t), Some(s)) = (next(), next()) {
                engine.paste_clip(t as usize, s.max(0) as usize);
            }
        }
        "clipdelat" => {
            if let (Some(t), Some(s)) = (next(), next()) {
                engine.delete_clip_at(t as usize, s.max(0) as usize);
            }
        }
        // cpy <t> <s0> <s1> ; pst <t> <destStep> ; cpyclr
        "cpy" => {
            if let (Some(t), Some(s0), Some(s1)) = (next(), next(), next()) {
                engine.copy_steps(t as usize, s0.clamp(0, 255) as u16, s1.clamp(0, 255) as u16);
            }
        }
        "pst" => {
            if let (Some(t), Some(d)) = (next(), next()) {
                engine.paste_steps(t as usize, d.clamp(0, 255) as u16);
            }
        }
        "cpyclr" => engine.clear_clipboard(),
        // addp <t> <s0> <s1> <pitch> <vel> — add a pitch to every step in the
        // range that lacks it (Loop Mode: hold a bar + press a pad).
        "addp" => {
            if let (Some(t), Some(s0), Some(s1), Some(p), Some(v)) =
                (next(), next(), next(), next(), next())
            {
                if (t as usize) < NUM_TRACKS && (0..128).contains(&p) {
                    let added = engine.tracks[t as usize].active_mut().add_pitch_range(
                        s0.clamp(0, 255) as u16,
                        s1.clamp(0, 255) as u16,
                        p as u8,
                        v.clamp(1, 127) as u8,
                    );
                    engine.maybe_autostart(added > 0);
                }
            }
        }
        // loop <track> <startStep> <lenSteps> — set the loop window.
        "loop" => {
            if let (Some(t), Some(s), Some(l)) = (next(), next(), next()) {
                if (t as usize) < NUM_TRACKS && s >= 0 && l > 0 {
                    engine.tracks[t as usize]
                        .active_mut()
                        .set_loop(s as u16, l as u16);
                }
            }
        }
        // dbl <track> — double the loop (duplicate notes + double length).
        "dbl" => {
            if let Some(t) = next() {
                if (t as usize) < NUM_TRACKS {
                    engine.tracks[t as usize].active_mut().double_loop();
                }
            }
        }
        // ltog <track> <step> <pitch> <vel> — drum-lane per-pitch toggle.
        "ltog" => {
            if let (Some(t), Some(s), Some(p), Some(v)) = (next(), next(), next(), next()) {
                if (t as usize) < NUM_TRACKS && (0..128).contains(&p) {
                    let added = engine.tracks[t as usize].active_mut().toggle_step_pitch(
                        s.clamp(0, 255) as u16,
                        p as u8,
                        v.clamp(1, 127) as u8,
                    );
                    engine.maybe_autostart(added);
                }
            }
        }
        // Parameter automation. lane 0..8, val 0..=127.
        // alabel <t> <lane> <target:param> — assign a lane to a chain param.
        "alabel" => {
            let t = it.next().and_then(|s| s.parse::<i64>().ok());
            let lane = it.next().and_then(|s| s.parse::<i64>().ok());
            let label = it.next().unwrap_or("");
            if let (Some(t), Some(lane)) = (t, lane) {
                engine.auto_label(t as usize, lane as usize, label);
            }
        }
        "abase" => {
            if let (Some(t), Some(lane), Some(v)) = (next(), next(), next()) {
                engine.auto_base(t as usize, lane as usize, v.clamp(0, 127) as u8, out);
            }
        }
        "abaseq" => {
            if let (Some(t), Some(lane), Some(v)) = (next(), next(), next()) {
                engine.auto_base_quiet(t as usize, lane as usize, v.clamp(0, 127) as u8);
            }
        }
        "aset" => {
            if let (Some(t), Some(lane), Some(s), Some(v)) = (next(), next(), next(), next()) {
                engine.auto_set(
                    t as usize,
                    lane as usize,
                    s.clamp(0, 255) as u16,
                    v.clamp(0, 127) as u8,
                    out,
                );
            }
        }
        "aclr" => {
            if let (Some(t), Some(lane)) = (next(), next()) {
                engine.auto_clear(t as usize, lane as usize);
            }
        }
        "aclrs" => {
            if let (Some(t), Some(lane), Some(s)) = (next(), next(), next()) {
                engine.auto_clear_step(t as usize, lane as usize, s.clamp(0, 255) as u16);
            }
        }
        "aclrstep" => {
            if let (Some(t), Some(s)) = (next(), next()) {
                engine.auto_clear_step_all(t as usize, s.clamp(0, 255) as u16);
            }
        }
        // asetr <t> <lane> <s0> <s1> <val> — set a lane's lock over a step range.
        "asetr" => {
            if let (Some(t), Some(lane), Some(s0), Some(s1), Some(v)) =
                (next(), next(), next(), next(), next())
            {
                engine.auto_set_range(
                    t as usize,
                    lane as usize,
                    s0.clamp(0, 255) as u16,
                    s1.clamp(0, 255) as u16,
                    v.clamp(0, 127) as u8,
                    out,
                );
            }
        }
        _ => {} // forward compat
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn engine() -> Engine {
        Engine::new(44100, 12000)
    }

    #[test]
    fn batch_applies_in_order() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "tog 0 0 60 100;watch 1;bpm 14000", &mut out);
        assert_eq!(e.tracks[0].active().notes.len(), 1);
        assert_eq!(e.watch_track, 1);
        assert_eq!(e.clock.bpm_x100(), 14000);
    }

    #[test]
    fn tog_autostarts_transport() {
        let mut e = engine();
        let mut out = Vec::new();
        assert!(!e.playing);
        apply_batch(&mut e, "tog 0 4 62 90", &mut out);
        assert!(e.playing, "first note in empty clip must start transport");
        // Toggling the note away does not stop or restart anything.
        apply_batch(&mut e, "tog 0 4 62 90", &mut out);
        assert!(e.playing);
        assert!(e.tracks[0].active().notes.is_empty());
    }

    #[test]
    fn play_stop_roundtrip() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "play", &mut out);
        assert!(e.playing);
        apply_batch(&mut e, "stop", &mut out);
        assert!(!e.playing);
    }

    #[test]
    fn mute_per_track() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "mute 2 1", &mut out);
        assert!(e.tracks[2].muted);
        apply_batch(&mut e, "mute 2 0", &mut out);
        assert!(!e.tracks[2].muted);
    }

    #[test]
    fn malformed_and_unknown_ops_ignored() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "tog 0;;frobnicate 1 2 3; ;tog 9 0 60 100;tog 0 0 999 100", &mut out);
        assert!(e.tracks[0].active().notes.is_empty());
        assert!(!e.playing);
    }

    #[test]
    fn tog_places_chord() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "tog 0 2 60 100 64 90 67 80", &mut out);
        let notes = &e.tracks[0].active().notes;
        assert_eq!(notes.len(), 3);
        assert!(notes.iter().all(|n| n.step == 2));
        // Bare re-toggle clears the whole step.
        apply_batch(&mut e, "tog 0 2 72 100", &mut out);
        assert!(e.tracks[0].active().notes.is_empty());
    }

    #[test]
    fn ltog_toggles_one_lane() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "ltog 0 0 36 100;ltog 0 0 38 100", &mut out);
        assert_eq!(e.tracks[0].active().notes.len(), 2);
        apply_batch(&mut e, "ltog 0 0 36 100", &mut out);
        let notes = &e.tracks[0].active().notes;
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].pitch, 38);
    }

    #[test]
    fn note_edit_commands() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "tog 0 0 60 100", &mut out);
        apply_batch(&mut e, "evel 0 0 0 -1 -30", &mut out);
        assert_eq!(e.tracks[0].active().notes[0].vel, 70);
        apply_batch(&mut e, "etrn 0 0 0 -1 12", &mut out);
        assert_eq!(e.tracks[0].active().notes[0].pitch, 72);
        apply_batch(&mut e, "enudge 0 0 0 -1 5", &mut out);
        assert_eq!(e.tracks[0].active().notes[0].tick, 5);
        // Lane-restricted edit ignores other pitches.
        apply_batch(&mut e, "ltog 0 0 38 100", &mut out);
        apply_batch(&mut e, "evel 0 0 0 38 -50", &mut out);
        let snare = e.tracks[0].active().notes.iter().find(|n| n.pitch == 38).unwrap();
        assert_eq!(snare.vel, 50);
        assert_eq!(e.tracks[0].active().notes.iter().find(|n| n.pitch == 72).unwrap().vel, 70);
    }

    #[test]
    fn clip_copy_delete_commands() {
        let mut e = engine();
        let mut out = Vec::new();
        // Place notes, delete one step.
        apply_batch(&mut e, "tog 0 0 60 100;tog 0 4 62 100", &mut out);
        apply_batch(&mut e, "del 0 0 0 -1", &mut out);
        assert!(!e.tracks[0].active().step_has_notes(0));
        assert!(e.tracks[0].active().step_has_notes(4));

        // Duplicate the clip → next slot becomes active with the same notes.
        apply_batch(&mut e, "clipdup 0", &mut out);
        assert_eq!(e.tracks[0].active_clip, 1);
        assert!(e.tracks[0].active().step_has_notes(4));

        // Delete the active clip.
        apply_batch(&mut e, "clipdel 0", &mut out);
        assert!(!e.tracks[0].active().exists());

        // Drum-pad delete (pitch-filtered, whole clip) on a fresh slot.
        apply_batch(&mut e, "clipsel 0 0;clipdel 0", &mut out);
        apply_batch(&mut e, "ltog 0 0 36 100;ltog 0 8 36 100;ltog 0 4 38 100", &mut out);
        apply_batch(&mut e, "del 0 0 255 36", &mut out);
        assert!(e.tracks[0].active().notes.iter().all(|n| n.pitch == 38));
        assert_eq!(e.tracks[0].active().notes.len(), 1);
    }

    #[test]
    fn copy_paste_steps() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "tog 0 0 60 100;tog 0 2 64 110", &mut out);
        apply_batch(&mut e, "cpy 0 0 3", &mut out);   // copy steps 0-3
        apply_batch(&mut e, "pst 0 8", &mut out);     // paste at step 8
        assert!(e.tracks[0].active().step_has_notes(8));   // 0 → 8
        assert!(e.tracks[0].active().step_has_notes(10));  // 2 → 10
        let pasted = e.tracks[0].active().notes.iter().find(|n| n.step == 10).unwrap();
        assert_eq!(pasted.pitch, 64);
        assert_eq!(pasted.vel, 110);

        // Cross-track paste uses the same clipboard.
        apply_batch(&mut e, "pst 1 0", &mut out);
        assert!(e.tracks[1].active().step_has_notes(0));
        apply_batch(&mut e, "cpyclr;pst 1 4", &mut out); // cleared → no-op
        assert!(!e.tracks[1].active().step_has_notes(4));
    }

    #[test]
    fn loop_and_double_commands() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "tog 0 0 60 100;loop 0 0 16", &mut out);
        assert_eq!(e.tracks[0].active().length_steps, 16);
        apply_batch(&mut e, "dbl 0", &mut out);
        assert_eq!(e.tracks[0].active().length_steps, 32);
        assert!(e.tracks[0].active().step_has_notes(16));
        // Set a window starting at bar 1.
        apply_batch(&mut e, "loop 0 16 16", &mut out);
        assert_eq!(e.tracks[0].active().loop_start_steps, 16);
        assert_eq!(e.tracks[0].active().length_steps, 16);
    }

    #[test]
    fn slen_sets_note_length() {
        let mut e = Engine::new(44100, 12000);
        let mut out = Vec::new();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        apply_batch(&mut e, "slen 0 0 0 -1 96", &mut out); // 96 ticks = 4 steps
        let n = e.tracks[0].active().notes.iter().find(|n| n.tick == 0).unwrap();
        assert_eq!(n.gate, 96);
    }

    #[test]
    fn automation_commands_set_lane_lock_base() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "alabel 0 1 synth:cutoff", &mut out);
        assert!(e.tracks[0].lane_assigned[1]);
        assert_eq!(e.tracks[0].lane_label[1], "synth:cutoff");
        apply_batch(&mut e, "abase 0 1 64", &mut out);
        assert_eq!(e.tracks[0].lane_base[1], 64);
        // abase emits a live CC immediately (audition / stopped apply).
        assert!(out.iter().any(|x| matches!(x, OutEvent::Cc { track: 0, lane: 1, val: 64 })));
        // abaseq updates the base WITHOUT emitting a CC.
        out.clear();
        apply_batch(&mut e, "abaseq 0 1 30", &mut out);
        assert_eq!(e.tracks[0].lane_base[1], 30);
        assert!(out.is_empty());
        apply_batch(&mut e, "aset 0 1 5 90", &mut out);
        assert_eq!(e.tracks[0].active().lock_at(1, 5), Some(90));
        // aclrs removes one step's lock; the lane (and other steps) stay.
        apply_batch(&mut e, "aset 0 1 5 90;aset 0 1 6 80", &mut out);
        apply_batch(&mut e, "aclrs 0 1 5", &mut out);
        assert_eq!(e.tracks[0].active().lock_at(1, 5), None);
        assert_eq!(e.tracks[0].active().lock_at(1, 6), Some(80));
        assert!(e.tracks[0].lane_assigned[1]); // lane still assigned

        apply_batch(&mut e, "aclr 0 1", &mut out);
        assert!(!e.tracks[0].lane_assigned[1]);
        assert_eq!(e.tracks[0].active().lock_at(1, 6), None);

        // aclrstep removes every lane's lock at one step, leaving other steps.
        apply_batch(&mut e, "aset 0 0 3 50;aset 0 2 3 60;aset 0 1 9 70", &mut out);
        apply_batch(&mut e, "aclrstep 0 3", &mut out);
        assert_eq!(e.tracks[0].active().lock_at(0, 3), None);
        assert_eq!(e.tracks[0].active().lock_at(2, 3), None);
        assert_eq!(e.tracks[0].active().lock_at(1, 9), Some(70));

        // asetr sets a lane's lock across a whole bar (range), nothing outside it.
        apply_batch(&mut e, "asetr 0 0 16 31 99", &mut out);
        for s in 16..=31 {
            assert_eq!(e.tracks[0].active().lock_at(0, s), Some(99));
        }
        assert_eq!(e.tracks[0].active().lock_at(0, 15), None);
        assert_eq!(e.tracks[0].active().lock_at(0, 32), None);
    }

    #[test]
    fn status_reports_automation_fields() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "alabel 0 0 synth:a;alabel 0 2 synth:b", &mut out);
        e.tracks[0].active_mut().set_lock(2, 4, 50);
        apply_batch(&mut e, "hold 0 4", &mut out);
        let s = e.status();
        assert!(s.contains("alanes=05")); // lanes 0 and 2 assigned
        assert!(s.contains("aauto=04")); // lane 2 has a lock
        let hauto = s.split("hauto=").nth(1).unwrap().split(' ').next().unwrap();
        assert_eq!(hauto, "2:50");
    }

    #[test]
    fn wlane_filters_status_occupancy() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "ltog 0 0 36 100;ltog 0 4 38 100", &mut out);
        apply_batch(&mut e, "wlane 38", &mut out);
        assert_eq!(e.watch_lane, Some(38));
        let occ = e.status().split("occ=").nth(1).unwrap().to_string();
        assert_eq!(&occ[0..2], "08"); // only step 4 (snare lane)
        apply_batch(&mut e, "wlane -1", &mut out);
        assert_eq!(e.watch_lane, None);
        let occ = e.status().split("occ=").nth(1).unwrap().to_string();
        assert_eq!(&occ[0..2], "88"); // both lanes visible
    }
}
