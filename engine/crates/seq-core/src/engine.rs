//! The sequencer engine: transport + clock + per-tick note scheduling.
//! Pure logic — emits `OutEvent`s into a caller buffer; the FFI layer turns
//! them into host MIDI sends. One Engine instance == the whole 4-track
//! sequencer.

use crate::clip::Clip;
use crate::clock::Clock;
use crate::track::{Track, CLIPS_PER_TRACK, NUM_TRACKS};
use crate::{PPQN, TICKS_PER_STEP};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum OutEvent {
    NoteOn { track: u8, pitch: u8, vel: u8 },
    NoteOff { track: u8, pitch: u8 },
    /// Metronome click; `accent` marks the downbeat (bar start).
    Click { accent: bool },
}

struct RecPending {
    pitch: u8,
    vel: u8,
    start_tick: u32,
}

#[derive(Debug, Clone, Copy)]
struct Gate {
    track: u8,
    pitch: u8,
    ticks_left: u32,
}

pub struct Engine {
    pub clock: Clock,
    pub tracks: Vec<Track>,
    pub playing: bool,
    /// Track whose active clip the UI is watching (step LEDs / status).
    pub watch_track: usize,
    /// Pitch the watched step LEDs are filtered to (drum-lane view), or None
    /// for the melodic "all notes" view.
    pub watch_lane: Option<u8>,
    /// Note clipboard for copy/paste of steps and ranges, across tracks and
    /// clips. Ticks/steps are stored relative to the copy start.
    clipboard: Vec<ClipboardNote>,
    /// Recording state (live capture into the active clip).
    pub recording: bool,
    rec_track: usize,
    /// Count-in ticks remaining before capture begins (0 = not counting in).
    count_in_left: u32,
    pub metronome: bool,
    rec_pending: Vec<RecPending>,
    /// Per-tick master counter (clock.tick advances per audio block, so it
    /// can't time individual ticks; this increments inside service_tick).
    master_tick: u64,
    gates: Vec<Gate>,
}

#[derive(Clone, Copy)]
struct ClipboardNote {
    rel_step: u16,
    rel_tick: u32,
    gate: u32,
    pitch: u8,
    vel: u8,
}

impl Engine {
    pub fn new(sample_rate: u32, bpm_x100: u32) -> Self {
        Engine {
            clock: Clock::new(sample_rate, bpm_x100),
            tracks: (0..NUM_TRACKS).map(|_| Track::new()).collect(),
            playing: false,
            watch_track: 0,
            watch_lane: None,
            clipboard: Vec::new(),
            recording: false,
            rec_track: 0,
            count_in_left: 0,
            metronome: false,
            rec_pending: Vec::new(),
            master_tick: 0,
            gates: Vec::with_capacity(128),
        }
    }

    pub fn counting_in(&self) -> bool {
        self.count_in_left > 0
    }

    // ── Clip operations (Copy/Delete, manual §12) ─────────────────────────

    /// Duplicate the track's active clip into the next empty slot and select
    /// it (native Copy in Note mode). No-op if every slot is occupied.
    pub fn duplicate_clip(&mut self, track: usize) {
        if track >= NUM_TRACKS {
            return;
        }
        let src = self.tracks[track].active_clip;
        let mut dst = None;
        for off in 1..=CLIPS_PER_TRACK {
            let i = (src + off) % CLIPS_PER_TRACK;
            if !self.tracks[track].clips[i].exists() {
                dst = Some(i);
                break;
            }
        }
        if let Some(d) = dst {
            self.tracks[track].clips[d] = self.tracks[track].clips[src].clone();
            self.tracks[track].active_clip = d;
        }
    }

    pub fn delete_clip(&mut self, track: usize) {
        if track < NUM_TRACKS {
            self.tracks[track].active_mut().clear();
        }
    }

    pub fn select_clip(&mut self, track: usize, slot: usize) {
        if track < NUM_TRACKS && slot < CLIPS_PER_TRACK {
            self.tracks[track].active_clip = slot;
        }
    }

    pub fn delete_range(&mut self, track: usize, s0: u16, s1: u16, lane: Option<u8>) {
        if track < NUM_TRACKS {
            self.tracks[track].active_mut().delete_range(s0, s1, lane);
        }
    }

    // ── Note clipboard (copy/paste steps + ranges) ────────────────────────

    pub fn copy_steps(&mut self, track: usize, s0: u16, s1: u16) {
        if track >= NUM_TRACKS {
            return;
        }
        let base_tick = s0 as u32 * TICKS_PER_STEP;
        self.clipboard = self.tracks[track]
            .active()
            .notes
            .iter()
            .filter(|n| n.step >= s0 && n.step <= s1)
            .map(|n| ClipboardNote {
                rel_step: n.step - s0,
                rel_tick: n.tick.saturating_sub(base_tick),
                gate: n.gate,
                pitch: n.pitch,
                vel: n.vel,
            })
            .collect();
    }

    pub fn paste_steps(&mut self, track: usize, dest_step: u16) {
        if track >= NUM_TRACKS || self.clipboard.is_empty() {
            return;
        }
        let base_tick = dest_step as u32 * TICKS_PER_STEP;
        let cb = self.clipboard.clone();
        let clip = self.tracks[track].active_mut();
        for cn in cb {
            clip.add_note_raw(
                dest_step + cn.rel_step,
                base_tick + cn.rel_tick,
                cn.gate,
                cn.pitch,
                cn.vel,
            );
        }
    }

    pub fn clear_clipboard(&mut self) {
        self.clipboard.clear();
    }

    pub fn watched_clip(&self) -> &Clip {
        self.tracks[self.watch_track].active()
    }

    /// Start transport: native Move restarts clips from the loop start.
    pub fn play(&mut self) {
        for t in &mut self.tracks {
            t.pos_tick = t.active().loop_start_ticks();
        }
        self.clock.reset();
        self.master_tick = 0;
        self.playing = true;
    }

    /// Stop transport and release everything still sounding. Ends recording.
    pub fn stop(&mut self, out: &mut Vec<OutEvent>) {
        self.playing = false;
        self.recording = false;
        self.count_in_left = 0;
        self.rec_pending.clear();
        for g in self.gates.drain(..) {
            out.push(OutEvent::NoteOff {
                track: g.track,
                pitch: g.pitch,
            });
        }
    }

    // ── Recording (manual §14) ────────────────────────────────────────────

    /// Rec button: toggle recording on `track`. Starting arms a one-bar
    /// count-in (the metronome clicks; capture begins when it elapses) and
    /// starts the transport if stopped.
    pub fn toggle_record(&mut self, track: usize) {
        if track >= NUM_TRACKS {
            return;
        }
        if self.recording || self.count_in_left > 0 {
            self.recording = false;
            self.count_in_left = 0;
            self.rec_pending.clear();
            return;
        }
        self.rec_track = track;
        self.watch_track = track;
        // Ensure the target clip exists so its playhead advances (and a new
        // recording extends from one bar).
        self.tracks[track].active_mut().ensure_exists();
        if !self.playing {
            self.play();
        }
        self.count_in_left = crate::TICKS_PER_BAR;
    }

    pub fn set_metronome(&mut self, on: bool) {
        self.metronome = on;
    }

    /// Quantize the watched track's active clip to the step grid.
    pub fn quantize_active(&mut self, track: usize) {
        if track < NUM_TRACKS {
            self.tracks[track].active_mut().quantize();
        }
    }

    /// Record a live pad note-on. The UI sounds the note directly (zero
    /// latency); this only captures it for recording, so there's no double
    /// trigger. No-op unless recording this track.
    pub fn live_note_on(&mut self, track: usize, pitch: u8, vel: u8) {
        if track < NUM_TRACKS && self.recording && track == self.rec_track {
            self.rec_pending.push(RecPending {
                pitch,
                vel,
                start_tick: self.tracks[track].pos_tick,
            });
        }
    }

    /// Finalize a recorded note (start → now) into the clip on note-off,
    /// handling loop wrap. No-op unless recording this track.
    pub fn live_note_off(&mut self, track: usize, pitch: u8) {
        if track >= NUM_TRACKS || !self.recording || track != self.rec_track {
            return;
        }
        if let Some(idx) = self.rec_pending.iter().rposition(|p| p.pitch == pitch) {
            let p = self.rec_pending.swap_remove(idx);
            let now = self.tracks[track].pos_tick;
            let span = self.tracks[track].active().length_ticks().max(1);
            let gate = if now >= p.start_tick {
                now - p.start_tick
            } else {
                span - p.start_tick + now
            };
            self.tracks[track].active_mut().record_note(p.start_tick, gate.max(1), pitch, p.vel);
        }
    }

    /// Called by note entry: native auto-starts the transport when the
    /// first note lands in an empty clip while stopped.
    pub fn maybe_autostart(&mut self, notes_added: bool) {
        if notes_added && !self.playing {
            self.play();
        }
    }

    /// Advance one audio block; pushes due MIDI into `out`.
    pub fn advance_block(&mut self, frames: u32, out: &mut Vec<OutEvent>) {
        let fired = self.clock.advance(frames);
        if !self.playing {
            return;
        }
        for _ in 0..fired {
            self.service_tick(out);
        }
    }

    fn service_tick(&mut self, out: &mut Vec<OutEvent>) {
        // Metronome / count-in click on beat boundaries (PPQN = one beat).
        if (self.count_in_left > 0 || self.metronome) && self.master_tick % PPQN as u64 == 0 {
            out.push(OutEvent::Click {
                accent: self.master_tick % (PPQN as u64 * 4) == 0,
            });
        }
        self.master_tick += 1;
        // Count-in elapses → capture begins.
        if self.count_in_left > 0 {
            self.count_in_left -= 1;
            if self.count_in_left == 0 {
                self.recording = true;
            }
        }

        // Note-offs first so a same-pitch note starting this tick retriggers.
        let mut i = 0;
        while i < self.gates.len() {
            self.gates[i].ticks_left -= 1;
            if self.gates[i].ticks_left == 0 {
                let g = self.gates.swap_remove(i);
                out.push(OutEvent::NoteOff {
                    track: g.track,
                    pitch: g.pitch,
                });
            } else {
                i += 1;
            }
        }

        for ti in 0..NUM_TRACKS {
            let muted = self.tracks[ti].muted;
            let clip = self.tracks[ti].active();
            if !clip.exists() {
                continue;
            }
            let pos = self.tracks[ti].pos_tick;
            if !muted {
                let len = self.tracks[ti].active().notes.len();
                for ni in 0..len {
                    let n = self.tracks[ti].active().notes[ni];
                    // Skip notes just recorded this pass (suppress_until_wrap).
                    if n.tick == pos && !n.suppress {
                        out.push(OutEvent::NoteOn {
                            track: ti as u8,
                            pitch: n.pitch,
                            vel: n.vel,
                        });
                        self.gates.push(Gate {
                            track: ti as u8,
                            pitch: n.pitch,
                            ticks_left: n.gate.max(1),
                        });
                    }
                }
            }
            // Advance + wrap inside the loop window [start, start+len). On
            // wrap, recorded notes become audible for the next pass. While
            // recording into this track, the clip extends bar-by-bar (up to
            // 16) instead of wrapping — native "length extends until stop".
            let start = self.tracks[ti].active().loop_start_ticks();
            let end = self.tracks[ti].active().loop_end_ticks();
            let recording_here = self.recording && ti == self.rec_track;
            let t = &mut self.tracks[ti];
            t.pos_tick += 1;
            if t.pos_tick >= end {
                let bar = crate::STEPS_PER_BAR as u16;
                let clip = t.active_mut();
                if recording_here && clip.loop_start_steps + clip.length_steps + bar <= crate::clip::MAX_STEPS {
                    clip.set_loop(clip.loop_start_steps, clip.length_steps + bar);
                } else {
                    t.pos_tick = start;
                    t.active_mut().release_suppressed();
                }
            }
        }
    }

    /// Compact status string the UI polls (space-separated key=value; the
    /// UI ignores unknown keys, so this can grow freely).
    pub fn status(&self) -> String {
        let wt = &self.tracks[self.watch_track];
        let clip = wt.active();
        format!(
            "play={} tick={} bpm={} trk={} step={} len={} lstart={} rec={} cin={} metro={} occ={}",
            self.playing as u8,
            self.master_tick,
            self.clock.bpm_x100(),
            self.watch_track,
            wt.current_step(),
            clip.length_steps,
            clip.loop_start_steps,
            self.recording as u8,
            (self.count_in_left > 0) as u8,
            self.metronome as u8,
            clip.occupancy_hex_lane(self.watch_lane)
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::TICKS_PER_STEP;

    const RATE: u32 = 44100;
    const FRAMES: u32 = 128;

    fn engine() -> Engine {
        Engine::new(RATE, 12000)
    }

    /// Run blocks until `ticks` master ticks have elapsed; collect events.
    fn run_ticks(e: &mut Engine, ticks: u64) -> Vec<OutEvent> {
        let mut out = Vec::new();
        let start = e.clock.tick;
        while e.clock.tick < start + ticks {
            e.advance_block(FRAMES, &mut out);
        }
        out
    }

    #[test]
    fn plays_note_at_step_and_releases() {
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.play();
        let ev = run_ticks(&mut e, TICKS_PER_STEP as u64 + 2);
        assert!(ev.contains(&OutEvent::NoteOn { track: 0, pitch: 60, vel: 100 }));
        assert!(ev.contains(&OutEvent::NoteOff { track: 0, pitch: 60 }));
        let on = ev.iter().position(|x| matches!(x, OutEvent::NoteOn { .. })).unwrap();
        let off = ev.iter().position(|x| matches!(x, OutEvent::NoteOff { .. })).unwrap();
        assert!(on < off);
    }

    #[test]
    fn four_tracks_play_simultaneously() {
        let mut e = engine();
        for t in 0..4 {
            e.tracks[t].active_mut().toggle_step(0, &[(60 + t as u8, 100)]);
        }
        e.play();
        let ev = run_ticks(&mut e, 4);
        for t in 0..4u8 {
            assert!(
                ev.contains(&OutEvent::NoteOn { track: t, pitch: 60 + t, vel: 100 }),
                "track {t} missing"
            );
        }
    }

    #[test]
    fn loop_wraps_and_replays() {
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.play();
        // 2 bars + slack: the step-0 note must fire twice.
        let ev = run_ticks(&mut e, 16 * TICKS_PER_STEP as u64 + 4);
        let ons = ev
            .iter()
            .filter(|x| matches!(x, OutEvent::NoteOn { .. }))
            .count();
        assert_eq!(ons, 2);
    }

    #[test]
    fn muted_track_is_silent_but_advances() {
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.tracks[0].muted = true;
        e.play();
        let ev = run_ticks(&mut e, 8);
        assert!(ev.is_empty());
        assert!(e.tracks[0].pos_tick > 0);
    }

    #[test]
    fn stop_releases_held_gates() {
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.play();
        let _ = run_ticks(&mut e, 2); // note on fired, gate still open
        let mut out = Vec::new();
        e.stop(&mut out);
        assert!(out.contains(&OutEvent::NoteOff { track: 0, pitch: 60 }));
        // After stop, nothing plays.
        let ev = run_ticks(&mut e, 50);
        assert!(ev.is_empty());
    }

    #[test]
    fn play_restarts_from_clip_start() {
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.play();
        let _ = run_ticks(&mut e, 30);
        let mut out = Vec::new();
        e.stop(&mut out);
        e.play();
        assert_eq!(e.tracks[0].pos_tick, 0);
        let ev = run_ticks(&mut e, 2);
        assert!(ev.contains(&OutEvent::NoteOn { track: 0, pitch: 60, vel: 100 }));
    }

    #[test]
    fn playback_wraps_inside_loop_window() {
        let mut e = engine();
        // Content in bars 0 and 1; loop window = bar 1 only.
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);  // bar 0
        e.tracks[0].active_mut().toggle_step(16, &[(64, 100)]); // bar 1
        e.tracks[0].active_mut().set_loop(16, 16);              // loop = bar 1
        e.play();
        assert_eq!(e.tracks[0].pos_tick, 16 * TICKS_PER_STEP);  // starts at window
        let ev = run_ticks(&mut e, 16 * TICKS_PER_STEP as u64 + 4);
        // Only the bar-1 note (64) plays; the bar-0 note (60) is outside.
        assert!(ev.iter().any(|x| matches!(x, OutEvent::NoteOn { pitch: 64, .. })));
        assert!(!ev.iter().any(|x| matches!(x, OutEvent::NoteOn { pitch: 60, .. })));
    }

    #[test]
    fn recording_captures_live_notes_after_count_in() {
        let mut e = engine();
        e.toggle_record(0); // arms: count-in starts, transport plays
        assert!(e.playing);
        assert!(e.counting_in());
        assert!(!e.recording);
        // Run through the one-bar count-in (no capture yet).
        run_ticks(&mut e, crate::TICKS_PER_BAR as u64 + 1);
        assert!(e.recording);
        assert!(!e.counting_in());
        // Play a live note for ~2 steps.
        e.live_note_on(0, 60, 100);
        run_ticks(&mut e, 2 * TICKS_PER_STEP as u64);
        e.live_note_off(0, 60);
        assert_eq!(e.tracks[0].active().notes.len(), 1);
        let n = e.tracks[0].active().notes[0];
        assert_eq!(n.pitch, 60);
        assert_eq!(n.vel, 100);
        assert!(n.gate >= TICKS_PER_STEP); // ~2 steps long
        assert!(n.suppress); // not replayed until the clip wraps
    }

    #[test]
    fn count_in_and_metronome_emit_clicks() {
        let mut e = engine();
        e.toggle_record(0);
        // The count-in bar produces 4 beat clicks, one accented (downbeat).
        let cin = run_ticks(&mut e, crate::TICKS_PER_BAR as u64);
        assert_eq!(cin.iter().filter(|x| matches!(x, OutEvent::Click { .. })).count(), 4);
        // Metronome on, run another bar: 4 clicks, 1 accent.
        e.set_metronome(true);
        let bar = run_ticks(&mut e, crate::TICKS_PER_BAR as u64);
        assert_eq!(bar.iter().filter(|x| matches!(x, OutEvent::Click { .. })).count(), 4);
        assert_eq!(
            bar.iter().filter(|x| matches!(x, OutEvent::Click { accent: true })).count(),
            1
        );
    }

    #[test]
    fn toggle_record_twice_stops() {
        let mut e = engine();
        e.toggle_record(0);
        run_ticks(&mut e, crate::TICKS_PER_BAR as u64 + 1);
        assert!(e.recording);
        e.toggle_record(0);
        assert!(!e.recording);
    }

    #[test]
    fn quantize_snaps_notes_to_grid() {
        let mut e = engine();
        let mut out = Vec::new();
        // Place a note then nudge it off-grid.
        e.tracks[0].active_mut().toggle_step(2, &[(60, 100)]);
        e.tracks[0].active_mut().nudge(2, 2, None, 7);
        assert_ne!(e.tracks[0].active().notes[0].tick % TICKS_PER_STEP, 0);
        apply_quant(&mut e, &mut out);
        assert_eq!(e.tracks[0].active().notes[0].tick % TICKS_PER_STEP, 0);
        assert_eq!(e.tracks[0].active().notes[0].step, 2);
    }

    fn apply_quant(e: &mut Engine, _out: &mut Vec<OutEvent>) {
        e.quantize_active(0);
    }

    #[test]
    fn status_reports_watched_clip() {
        let mut e = engine();
        e.watch_track = 2;
        e.tracks[2].active_mut().toggle_step(3, &[(60, 100)]);
        let s = e.status();
        assert!(s.contains("play=0"));
        assert!(s.contains("trk=2"));
        assert!(s.contains("len=16"));
        let occ = s.split("occ=").nth(1).unwrap();
        assert_eq!(&occ[0..2], "10"); // step 3 = bit 4 of byte 0
    }

    #[test]
    fn empty_clip_does_not_advance_position() {
        let mut e = engine();
        e.play();
        let _ = run_ticks(&mut e, 10);
        assert_eq!(e.tracks[0].pos_tick, 0);
    }
}
