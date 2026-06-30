//! The sequencer engine: transport + clock + per-tick note scheduling.
//! Pure logic — emits `OutEvent`s into a caller buffer; the FFI layer turns
//! them into host MIDI sends. One Engine instance == the whole 4-track
//! sequencer.

use crate::clip::{Clip, Lock};
use crate::clock::Clock;
use crate::track::{Track, CLIPS_PER_TRACK, NUM_TRACKS};
use crate::{PPQN, TICKS_PER_STEP};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum OutEvent {
    NoteOn { track: u8, pitch: u8, vel: u8 },
    NoteOff { track: u8, pitch: u8 },
    /// Metronome click; `accent` marks the downbeat (bar start).
    Click { accent: bool },
    /// Parameter automation: chain abs-CC 102+lane, value 0..=127.
    Cc { track: u8, lane: u8, val: u8 },
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
    /// Automation locks captured alongside `clipboard`, steps stored relative
    /// to the copy start so an empty (note-less) step's automation copies too.
    lock_clipboard: Vec<Lock>,
    /// Width in steps of the last `copy_steps` source range, so a paste replaces
    /// the destination span even when the source had no notes.
    clipboard_span: u16,
    /// Whole-clip clipboard for Session copy/paste.
    clip_clipboard: Option<Clip>,
    /// Recording state (live capture into the active clip).
    pub recording: bool,
    rec_track: usize,
    /// True when recording started into a clip with no notes (first take);
    /// false during overdub. Auto-extend is suppressed on overdub.
    rec_empty_start: bool,
    /// Count-in ticks remaining before capture begins (0 = not counting in).
    count_in_left: u32,
    pub metronome: bool,
    rec_pending: Vec<RecPending>,
    /// Per-tick master counter (clock.tick advances per audio block, so it
    /// can't time individual ticks; this increments inside service_tick).
    master_tick: u64,
    /// Set by edit commands, cleared when the state is serialized for saving.
    /// The UI polls it to know when to write the autosave file.
    pub dirty: bool,
    gates: Vec<Gate>,
    /// (track, step) the UI is holding, for the step-length readout. None = not held.
    held_query: Option<(usize, u16)>,
    /// Free-running PRNG state for trig probability rolls (xorshift64*).
    rng_state: u64,
    /// Off-beat shuffle amount, percent (50 = straight … 80 = max). Applied by
    /// the scheduler to odd-indexed 16th steps. UI-set via the `swing` command.
    pub swing_pct: u32,
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
            lock_clipboard: Vec::new(),
            clipboard_span: 0,
            clip_clipboard: None,
            recording: false,
            rec_track: 0,
            rec_empty_start: false,
            count_in_left: 0,
            metronome: false,
            rec_pending: Vec::new(),
            master_tick: 0,
            dirty: false,
            gates: Vec::with_capacity(128),
            held_query: None,
            rng_state: 0x9E3779B97F4A7C15,
            swing_pct: 50,
        }
    }

    /// Ticks to delay an odd-indexed 16th step (the off-beat) for swing.
    /// 0 at 50% (straight) … TICKS_PER_STEP/2 (12) at 80%. Even steps: 0.
    fn swing_delay(&self, step: u16) -> u32 {
        if self.swing_pct <= 50 || step % 2 == 0 {
            return 0;
        }
        (self.swing_pct - 50) * TICKS_PER_STEP / 60
    }

    /// xorshift64* → a 0..=99 percent roll. Free-running (Elektron-style).
    fn roll_pct(&mut self) -> u8 {
        let mut x = self.rng_state;
        x ^= x >> 12; x ^= x << 25; x ^= x >> 27;
        self.rng_state = x;
        ((x.wrapping_mul(0x2545F4914F6CDD1D) >> 33) % 100) as u8
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

    /// Free any assigned lane that no clip on the track locks any more (after a
    /// clip delete or automation clear). A lane with zero locks anywhere is
    /// inert — its base equals the static param value — so it's released back to
    /// the 8-lane pool, matching "clear lanes not used on other clips".
    fn free_unused_lanes(&mut self, track: usize) {
        if track >= NUM_TRACKS {
            return;
        }
        for lane in 0..8 {
            if !self.tracks[track].lane_assigned[lane] {
                continue;
            }
            let used = self.tracks[track]
                .clips
                .iter()
                .any(|c| c.has_lock_on_lane(lane as u8));
            if !used {
                self.tracks[track].lane_assigned[lane] = false;
                self.tracks[track].lane_label[lane].clear();
                self.tracks[track].lane_base[lane] = 0;
                self.tracks[track].auto_cur[lane] = -1;
            }
        }
    }

    pub fn delete_clip(&mut self, track: usize) {
        if track < NUM_TRACKS {
            self.tracks[track].active_mut().clear();
            self.free_unused_lanes(track);
        }
    }

    /// Delete a specific clip slot (Session: hold Delete + clip pad).
    pub fn delete_clip_at(&mut self, track: usize, slot: usize) {
        if track < NUM_TRACKS && slot < CLIPS_PER_TRACK {
            self.tracks[track].clips[slot].clear();
            self.free_unused_lanes(track);
        }
    }

    /// Copy a whole clip to the clip clipboard (Session Copy).
    pub fn copy_clip(&mut self, track: usize, slot: usize) {
        if track < NUM_TRACKS && slot < CLIPS_PER_TRACK {
            self.clip_clipboard = Some(self.tracks[track].clips[slot].clone());
        }
    }

    /// Paste the clip clipboard into a slot (overwrites) and select it.
    pub fn paste_clip(&mut self, track: usize, slot: usize) {
        if track >= NUM_TRACKS || slot >= CLIPS_PER_TRACK {
            return;
        }
        if let Some(c) = self.clip_clipboard.clone() {
            self.tracks[track].clips[slot] = c;
            self.tracks[track].active_clip = slot;
            self.free_unused_lanes(track);
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
            self.free_unused_lanes(track);
        }
    }

    // ── Note clipboard (copy/paste steps + ranges) ────────────────────────

    pub fn copy_steps(&mut self, track: usize, s0: u16, s1: u16) {
        if track >= NUM_TRACKS {
            return;
        }
        self.clipboard_span = s1 - s0 + 1;
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
        self.lock_clipboard = self.tracks[track]
            .active()
            .locks
            .iter()
            .filter(|l| l.step >= s0 && l.step <= s1)
            .map(|l| Lock { lane: l.lane, step: l.step - s0, val: l.val })
            .collect();
    }

    pub fn paste_steps(&mut self, track: usize, dest_step: u16) {
        if track >= NUM_TRACKS || self.clipboard_span == 0 {
            return;
        }
        let span = self.clipboard_span;
        // Replace, not merge: clear the destination span (notes + locks) first.
        {
            let clip = self.tracks[track].active_mut();
            clip.delete_range(dest_step, dest_step + span - 1, None);
            for s in dest_step..dest_step + span {
                clip.clear_step_locks(s);
            }
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
        let lb = self.lock_clipboard.clone();
        let clip = self.tracks[track].active_mut();
        for l in lb {
            clip.set_lock(l.lane, dest_step + l.step, l.val);
        }
    }

    pub fn clear_clipboard(&mut self) {
        self.clipboard.clear();
        self.lock_clipboard.clear();
    }

    pub fn watched_clip(&self) -> &Clip {
        self.tracks[self.watch_track].active()
    }

    /// Flip transport on and reset the clock, seeding each track's playhead
    /// to its playing clip's loop start. Leaves playing_slot selections
    /// untouched (used by both Play and Session launch).
    fn start_transport(&mut self) {
        for t in &mut self.tracks {
            let start = t.playing().map_or(0, |c| c.loop_start_ticks());
            t.pos_tick = start;
            t.last_auto_step = -1; // re-emit automation from step 0 on (re)start
            t.auto_cur = [-1; 8];
            t.cycle = 1;           // restart the A:B trig-condition play count
            t.scale_acc = 0;       // phase-align the clip-scale accumulator
        }
        self.clock.reset();
        self.master_tick = 0;
        self.playing = true;
    }

    /// Play button / auto-start: every track plays its selected clip (native
    /// "Play starts all selected clips"), restarting from the loop start.
    pub fn play(&mut self) {
        for t in &mut self.tracks {
            t.playing_slot = if t.active().exists() {
                Some(t.active_clip)
            } else {
                None
            };
            t.queued_slot = None;
            t.pending_stop = false;
        }
        self.start_transport();
    }

    /// While the transport runs, entering a note into the selected slot launches
    /// that slot — bar-quantized like a real clip launch — so the selected slot
    /// becomes the playing slot. Queuing (rather than starting mid-bar) makes
    /// the clip start cleanly from its loop start on the next bar boundary, in
    /// sync with the metronome and the other playing clips (the queue resolves
    /// in `service_tick`). No-op when stopped (preserves the
    /// no-autostart-on-note-entry rule). Editing the slot that is already
    /// playing must not requantize it — just cancel any pending stop so the note
    /// keeps it alive.
    pub fn ensure_selected_playing(&mut self, track: usize) {
        if !self.playing || track >= NUM_TRACKS {
            return;
        }
        let slot = self.tracks[track].active_clip;
        if self.tracks[track].playing_slot == Some(slot) {
            self.tracks[track].pending_stop = false;
            return;
        }
        self.tracks[track].queued_slot = Some(slot);
        self.tracks[track].pending_stop = false;
    }

    /// Session launch / empty-slot select. Always selects the slot. An
    /// existing clip launches (queued to the next bar while running, immediate
    /// + transport start when stopped); an empty slot stops the track (native:
    /// selecting an empty slot stops the playing clip).
    pub fn launch_clip(&mut self, track: usize, slot: usize) {
        if track >= NUM_TRACKS || slot >= CLIPS_PER_TRACK {
            return;
        }
        self.tracks[track].active_clip = slot;
        let exists = self.tracks[track].clips[slot].exists();
        if self.playing {
            if exists {
                self.tracks[track].queued_slot = Some(slot);
                self.tracks[track].pending_stop = false;
            } else {
                self.tracks[track].pending_stop = true;
                self.tracks[track].queued_slot = None;
            }
        } else if exists {
            self.tracks[track].playing_slot = Some(slot);
            self.start_transport();
        } else {
            self.tracks[track].playing_slot = None;
        }
    }

    /// Stop a track's clip — at the next bar while running, immediately when
    /// stopped (used when pressing an empty slot in Session mode).
    pub fn stop_track(&mut self, track: usize) {
        if track >= NUM_TRACKS {
            return;
        }
        if self.playing {
            self.tracks[track].pending_stop = true;
        } else {
            self.tracks[track].playing_slot = None;
        }
    }

    /// Stop transport and release everything still sounding. Ends recording.
    pub fn stop(&mut self, out: &mut Vec<OutEvent>) {
        self.playing = false;
        self.recording = false;
        self.count_in_left = 0;
        self.rec_pending.clear();
        for t in &mut self.tracks {
            t.last_auto_step = -1;
            t.auto_cur = [-1; 8];
        }
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
        self.rec_empty_start = self.tracks[track].active().notes.is_empty();
        let was_playing = self.playing;
        // Ensure the selected clip exists and is the slot this track plays/records
        // into, clearing any pending stop / queued launch left by selecting an
        // empty slot in Session mode. Without this, punch-in recording into a
        // freshly created empty clip never captures (playing_slot stayed None or
        // pointed at the old clip) and never auto-extends.
        let a = self.tracks[track].active_clip;
        self.tracks[track].active_mut().ensure_exists();
        self.tracks[track].playing_slot = Some(a);
        self.tracks[track].queued_slot = None;
        self.tracks[track].pending_stop = false;
        if !was_playing {
            self.play();                       // seeds playheads + starts transport
            self.count_in_left = crate::TICKS_PER_BAR;
        } else {
            // Punch-in: record now (no count-in). For a just-created empty clip,
            // seed this track's playhead to the clip start so capture begins at
            // bar 1 and auto-extends; an overdub keeps its current position.
            if self.rec_empty_start {
                let start = self.tracks[track].clips[a].loop_start_ticks();
                self.tracks[track].pos_tick = start;
            }
            self.recording = true;
        }
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
            // Store the pad's concert pitch minus the clip transpose, so playback
            // (which re-adds transpose at emit) reproduces exactly what the pad
            // played. Keeps recorded notes aligned with the untransposed pads.
            let transpose = self.tracks[track].active().transpose as i32;
            let stored = (pitch as i32 - transpose).clamp(0, 127) as u8;
            self.tracks[track].active_mut().record_note(p.start_tick, gate.max(1), stored, p.vel);
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
        // Bar boundary: metronome click + resolve queued launches / stops
        // (1-bar launch quantization).
        if self.master_tick % PPQN as u64 == 0
            && (self.count_in_left > 0 || self.metronome)
        {
            out.push(OutEvent::Click {
                accent: self.master_tick % (PPQN as u64 * 4) == 0,
            });
        }
        if self.master_tick % crate::TICKS_PER_BAR as u64 == 0 {
            for t in &mut self.tracks {
                if let Some(slot) = t.queued_slot.take() {
                    t.playing_slot = Some(slot);
                    t.active_clip = slot;
                    t.pos_tick = t.clips[slot].loop_start_ticks();
                    t.last_auto_step = -1;
                    t.auto_cur = [-1; 8];
                    t.cycle = 1;
                }
                if t.pending_stop {
                    t.pending_stop = false;
                    t.playing_slot = None;
                }
            }
        }
        // Gate countdown now lives in step_tick (scaled per track), which only
        // runs for a track playing an existing clip. Flush hanging note-offs for
        // any track that is not (stopped/cleared) so notes never stick.
        let mut gi = 0;
        while gi < self.gates.len() {
            let t = self.gates[gi].track as usize;
            let serviced = self.tracks[t]
                .playing_slot
                .map(|s| self.tracks[t].clips[s].exists())
                .unwrap_or(false);
            if serviced {
                gi += 1;
            } else {
                let g = self.gates.swap_remove(gi);
                out.push(OutEvent::NoteOff { track: g.track, pitch: g.pitch });
            }
        }
        self.master_tick += 1;
        // Count-in elapses → capture begins.
        if self.count_in_left > 0 {
            self.count_in_left -= 1;
            if self.count_in_left == 0 {
                self.recording = true;
            }
        }

        // No clip playback (and no playhead advance) during the count-in: the
        // pre-roll bar only clicks; playback starts cleanly from loop-start on
        // the tick the count-in reaches 0. Each track runs `step_tick` 0..N
        // times this master tick, where N is set by the clip's playback scale
        // accumulator (faster clips advance several ticks, slower ones skip).
        if self.count_in_left == 0 {
            for ti in 0..NUM_TRACKS {
                let Some(slot) = self.tracks[ti].playing_slot else {
                    continue;
                };
                if !self.tracks[ti].clips[slot].exists() {
                    continue;
                }
                let (num, den) = {
                    let c = &self.tracks[ti].clips[slot];
                    (c.scale_num.max(1) as u32, c.scale_den.max(1) as u32)
                };
                self.tracks[ti].scale_acc += num;
                while self.tracks[ti].scale_acc >= den {
                    self.tracks[ti].scale_acc -= den;
                    self.step_tick(ti, out);
                }
            }
        }
    }

    /// One sequencer tick for a single playing track: emit due notes, advance +
    /// wrap the playhead, latch parameter automation. Driven 0..N times per
    /// master tick by the clip-scale accumulator (see service_tick).
    fn step_tick(&mut self, ti: usize, out: &mut Vec<OutEvent>) {
        let Some(slot) = self.tracks[ti].playing_slot else {
            return;
        };
        if !self.tracks[ti].clips[slot].exists() {
            return;
        }
        // Count this track's note gates down at the clip's scaled rate (this fn
        // runs N times per master tick), emitting note-offs first so a same-pitch
        // note starting this tick retriggers. Keeping the whole note lifecycle on
        // the scaled clock makes gate length scale with the clip speed.
        let mut gi = 0;
        while gi < self.gates.len() {
            if self.gates[gi].track == ti as u8 {
                self.gates[gi].ticks_left -= 1;
                if self.gates[gi].ticks_left == 0 {
                    let g = self.gates.swap_remove(gi);
                    out.push(OutEvent::NoteOff { track: g.track, pitch: g.pitch });
                    continue; // re-examine the element swapped into this slot
                }
            }
            gi += 1;
        }
        {
            let muted = self.tracks[ti].muted;
            let pos = self.tracks[ti].pos_tick;
            if !muted {
                    let len = self.tracks[ti].clips[slot].notes.len();
                    let cycle = self.tracks[ti].cycle;
                    // Per-tick decision cache: (note.step, governing-lane) -> play?
                    // so a chord on one trig shares a single condition+probability
                    // decision (all notes play or all skip). Few notes fire per
                    // tick, so a small Vec scan is cheap.
                    let mut decided: Vec<((u16, Option<u8>), bool)> = Vec::new();
                    for ni in 0..len {
                        let n = self.tracks[ti].clips[slot].notes[ni];
                        // Swing shifts an off-beat step's note later within its
                        // own cell (delay < TICKS_PER_STEP, so it never collides
                        // with the next step). Recorded micro-timed notes keep
                        // their stored tick + the step-parity offset.
                        let fire_tick = n.tick + self.swing_delay(n.step);
                        if fire_tick != pos || n.suppress {
                            continue;
                        }
                        let clip = &self.tracks[ti].clips[slot];
                        let lane_key = if clip.trigs.iter()
                            .any(|t| t.step == n.step && t.lane == Some(n.pitch))
                        { Some(n.pitch) } else { None };
                        let key = (n.step, lane_key);
                        let play = if let Some(&(_, p)) = decided.iter().find(|(k, _)| *k == key) {
                            p
                        } else {
                            let tp = clip.governing_trig(n.step, n.pitch);
                            let cond = crate::clip::condition_plays(tp.cond_a, tp.cond_b, tp.invert, cycle);
                            let p = cond && (tp.prob >= 100 || self.roll_pct() < tp.prob);
                            decided.push((key, p));
                            p
                        };
                        if !play {
                            continue;
                        }
                        // Non-destructive clip transpose: shift only the emitted
                        // pitch (and its gate, so note-off matches); stored notes
                        // and live pads stay at concert pitch.
                        let emit_pitch = (n.pitch as i32
                            + self.tracks[ti].clips[slot].transpose as i32)
                            .clamp(0, 127) as u8;
                        out.push(OutEvent::NoteOn { track: ti as u8, pitch: emit_pitch, vel: n.vel });
                        self.gates.push(Gate {
                            track: ti as u8,
                            pitch: emit_pitch,
                            ticks_left: n.gate.max(1),
                        });
                    }
                }
                // Advance + wrap inside the loop window [start, start+len). On
                // wrap, recorded notes become audible for the next pass. While
                // recording into this track, the clip extends bar-by-bar (up to
                // 16) instead of wrapping — native "length extends until stop".
                let start = self.tracks[ti].clips[slot].loop_start_ticks();
                let end = self.tracks[ti].clips[slot].loop_end_ticks();
                let recording_here = self.recording && ti == self.rec_track;
                let bar = crate::STEPS_PER_BAR as u16;
                self.tracks[ti].pos_tick += 1;
                if self.tracks[ti].pos_tick >= end {
                    let c = &mut self.tracks[ti].clips[slot];
                    // "Record until stop" grows a fresh clip bar by bar — but a
                    // sub-bar length is a deliberate LENGTH-knob choice, so only
                    // auto-grow bar-aligned clips and leave custom lengths fixed.
                    if recording_here && self.rec_empty_start
                        && c.length_steps % bar == 0
                        && c.loop_start_steps + c.length_steps + bar <= crate::clip::MAX_STEPS
                    {
                        c.set_loop(c.loop_start_steps, c.length_steps + bar);
                    } else {
                        self.tracks[ti].pos_tick = start;
                        self.tracks[ti].clips[slot].release_suppressed();
                        self.tracks[ti].cycle = self.tracks[ti].cycle.wrapping_add(1);
                    }
                }
                // Parameter automation: emit on step entry (revert-to-base).
                let cur = (self.tracks[ti].pos_tick / TICKS_PER_STEP) as i32;
                if cur != self.tracks[ti].last_auto_step {
                    self.tracks[ti].last_auto_step = cur;
                    self.emit_automation(ti, slot, cur as u16, out);
                }
        }
    }

    /// Emit automation CCs for `track` entering `step` (the latch). Each
    /// assigned lane resolves to: its lock at this step (a new automation
    /// point), else base if a note is anchored here (a note on a step other
    /// than the latch origin ends it), else the carried value (latch holds).
    /// Emits only when the value changes; carry persists across the loop
    /// boundary because `auto_cur` is not reset on wrap.
    fn emit_automation(&mut self, track: usize, slot: usize, step: u16, out: &mut Vec<OutEvent>) {
        for lane in 0..8u8 {
            if !self.tracks[track].lane_assigned[lane as usize] {
                continue;
            }
            let base = self.tracks[track].lane_base[lane as usize];
            let v: u8 = {
                let clip = &self.tracks[track].clips[slot];
                if let Some(lv) = clip.lock_at(lane, step) {
                    lv
                } else if clip.step_has_notes(step) {
                    base
                } else {
                    let cur = self.tracks[track].auto_cur[lane as usize];
                    if cur >= 0 { cur as u8 } else { base }
                }
            };
            if v as i16 != self.tracks[track].auto_cur[lane as usize] {
                self.tracks[track].auto_cur[lane as usize] = v as i16;
                out.push(OutEvent::Cc { track: track as u8, lane, val: v });
            }
        }
    }

    pub fn set_held_query(&mut self, q: Option<(usize, u16)>) {
        self.held_query = q;
    }

    // ── Parameter automation commands (lane 0..8, val 0..=127) ─────────────

    pub fn auto_label(&mut self, track: usize, lane: usize, label: &str) {
        if track < NUM_TRACKS && lane < 8 {
            self.tracks[track].lane_assigned[lane] = true;
            self.tracks[track].lane_label[lane] = label.to_string();
        }
    }

    pub fn auto_base(&mut self, track: usize, lane: usize, val: u8, out: &mut Vec<OutEvent>) {
        if track < NUM_TRACKS && lane < 8 {
            self.tracks[track].lane_base[lane] = val;
            if self.tracks[track].lane_assigned[lane] {
                out.push(OutEvent::Cc { track: track as u8, lane: lane as u8, val });
            }
        }
    }

    /// Set the lane base WITHOUT emitting a CC. The UI uses this when the user
    /// edits the original value via the normal param path (which already applied
    /// it to the synth) — the base only needs to update so playback reverts to
    /// it on un-locked steps.
    pub fn auto_base_quiet(&mut self, track: usize, lane: usize, val: u8) {
        if track < NUM_TRACKS && lane < 8 {
            self.tracks[track].lane_base[lane] = val;
        }
    }

    pub fn auto_set(&mut self, track: usize, lane: usize, step: u16, val: u8, out: &mut Vec<OutEvent>) {
        if track < NUM_TRACKS && lane < 8 {
            self.tracks[track].active_mut().set_lock(lane as u8, step, val);
            // Audition: apply now (stopped) / refresh (playing) for the edited lane.
            if self.tracks[track].lane_assigned[lane] {
                out.push(OutEvent::Cc { track: track as u8, lane: lane as u8, val });
            }
        }
    }

    /// Set one lane's lock for every step in [s0, s1] (hold-a-bar set). Emits a
    /// single audition CC with the value if the lane is assigned.
    pub fn auto_set_range(&mut self, track: usize, lane: usize, s0: u16, s1: u16, val: u8, out: &mut Vec<OutEvent>) {
        if track < NUM_TRACKS && lane < 8 {
            self.tracks[track].active_mut().set_lock_range(lane as u8, s0, s1, val);
            if self.tracks[track].lane_assigned[lane] {
                out.push(OutEvent::Cc { track: track as u8, lane: lane as u8, val });
            }
        }
    }

    pub fn auto_clear(&mut self, track: usize, lane: usize) {
        if track < NUM_TRACKS && lane < 8 {
            for c in &mut self.tracks[track].clips {
                c.clear_lane(lane as u8);
            }
            self.tracks[track].lane_assigned[lane] = false;
            self.tracks[track].lane_label[lane].clear();
        }
    }

    /// Remove one lane's lock at a single step (active clip). The step reverts
    /// to base; the lane is freed if that was its last lock across all clips.
    pub fn auto_clear_step(&mut self, track: usize, lane: usize, step: u16) {
        if track < NUM_TRACKS && lane < 8 {
            self.tracks[track].active_mut().clear_lock(lane as u8, step);
            self.free_unused_lanes(track);
        }
    }

    /// Remove all lanes' locks at a single step (active clip) — clear all
    /// automation on that step. Any lane left with no locks anywhere is freed.
    pub fn auto_clear_step_all(&mut self, track: usize, step: u16) {
        if track < NUM_TRACKS {
            self.tracks[track].active_mut().clear_step_locks(step);
            self.free_unused_lanes(track);
        }
    }

    /// All lanes' labels for every track, for the UI to rebuild its registry +
    /// re-apply chain knob mappings after a load. Format: tracks ',', lanes '.',
    /// each label or '-'.
    pub fn auto_labels(&self) -> String {
        let mut out = String::new();
        for (ti, t) in self.tracks.iter().enumerate() {
            if ti > 0 {
                out.push(',');
            }
            for lane in 0..8 {
                if lane > 0 {
                    out.push('.');
                }
                let l = &t.lane_label[lane];
                out.push_str(if l.is_empty() { "-" } else { l });
            }
        }
        out
    }

    fn held_len_steps(&self) -> u16 {
        match self.held_query {
            Some((t, step)) if t < NUM_TRACKS => self.tracks[t].active().note_len_steps_at(step),
            _ => 0,
        }
    }

    /// Held-step readout: (avg velocity, gate ticks of first note, mixed-gate
    /// flag). lane filtered by watch_lane (None = melodic). Zeros when no step
    /// held / empty.
    fn held_note_stats(&self) -> (u8, u32, bool) {
        let Some((t, step)) = self.held_query else { return (0, 0, false); };
        if t >= NUM_TRACKS { return (0, 0, false); }
        let lane = self.watch_lane;
        let clip = self.tracks[t].active();
        let mut sum: u32 = 0;
        let mut count: u32 = 0;
        let mut gate0: Option<u32> = None;
        let mut mixed = false;
        for n in clip.notes.iter().filter(|n| n.step == step && lane.map_or(true, |p| n.pitch == p)) {
            sum += n.vel as u32;
            count += 1;
            match gate0 {
                None => gate0 = Some(n.gate),
                Some(g) if g != n.gate => mixed = true,
                _ => {}
            }
        }
        if count == 0 { return (0, 0, false); }
        ((sum / count) as u8, gate0.unwrap_or(0), mixed)
    }

    /// Max gate ticks the held note can grow to (cap by next note / clip end),
    /// 0 when none — lets the UI flag "can't be longer (blocked by next note)".
    fn held_max_gate(&self) -> u32 {
        match self.held_query {
            Some((t, step)) if t < NUM_TRACKS => {
                self.tracks[t].active().held_note_max_gate(step, self.watch_lane)
            }
            _ => 0,
        }
    }

    /// Resolved trig props at the held step (lane = watch_lane), defaults otherwise.
    fn held_trig(&self) -> crate::clip::TrigProps {
        match self.held_query {
            Some((t, step)) if t < NUM_TRACKS => {
                let pitch = self.watch_lane.unwrap_or(0);
                self.tracks[t].active().governing_trig(step, pitch)
            }
            _ => crate::clip::TrigProps::DEFAULT,
        }
    }

    /// `hnotes=` payload: dot-separated pitches in the held step, empty when no step held.
    fn held_notes_state(&self) -> String {
        match self.held_query {
            Some((t, step)) if t < NUM_TRACKS => {
                let mut pitches: Vec<u8> = self.tracks[t]
                    .active()
                    .notes_at_step(step)
                    .map(|n| n.pitch)
                    .collect();
                pitches.sort_unstable();
                pitches.dedup();
                pitches.iter().enumerate().fold(String::new(), |mut s, (i, p)| {
                    if i > 0 { s.push('.'); }
                    s.push_str(&p.to_string());
                    s
                })
            }
            _ => String::new(),
        }
    }

    /// Compact status string the UI polls (space-separated key=value; the
    /// UI ignores unknown keys, so this can grow freely).
    pub fn status(&self) -> String {
        let wt = &self.tracks[self.watch_track];
        let clip = wt.active();
        let alanes = wt
            .lane_assigned
            .iter()
            .enumerate()
            .fold(0u8, |m, (i, &a)| if a { m | (1 << i) } else { m });
        let aauto = clip.automated_lanes();
        let hauto = match self.held_query {
            Some((t, step)) if t < NUM_TRACKS => {
                let mut v: Vec<(u8, u8)> = self.tracks[t].active().locks_at_step(step).collect();
                v.sort_unstable();
                v.iter().enumerate().fold(String::new(), |mut s, (i, (l, val))| {
                    if i > 0 {
                        s.push('.');
                    }
                    s.push_str(&format!("{l}:{val}"));
                    s
                })
            }
            _ => String::new(),
        };
        let (hvel, hgate, hgmix) = self.held_note_stats();
        let htp = self.held_trig();
        let hlmax = self.held_max_gate();
        format!(
            "play={} tick={} bpm={} trk={} step={} pos={} len={} lstart={} rec={} cin={} metro={} dirty={} sess={} act={} mute={} hlen={} hnotes={} occ={} alanes={:02x} aauto={:02x} hauto={} hvel={} hgate={} hgmix={} hprob={} hcond={}:{} hinv={} hlmax={} swing={} csc={}/{} ctr={}",
            self.playing as u8,
            self.master_tick,
            self.clock.bpm_x100(),
            self.watch_track,
            wt.current_step(),
            wt.pos_tick,
            clip.length_steps,
            clip.loop_start_steps,
            self.recording as u8,
            (self.count_in_left > 0) as u8,
            self.metronome as u8,
            self.dirty as u8,
            self.session_state(),
            self.active_notes_state(),
            self.mute_state(),
            self.held_len_steps(),
            self.held_notes_state(),
            clip.occupancy_hex_lane(self.watch_lane),
            alanes,
            aauto,
            hauto,
            hvel,
            hgate,
            hgmix as u8,
            htp.prob,
            htp.cond_a,
            htp.cond_b,
            htp.invert as u8,
            hlmax,
            self.swing_pct,
            clip.scale_num,
            clip.scale_den,
            clip.transpose,
        )
    }

    /// `mute=` payload: one '0'/'1' per track (track 0 first).
    fn mute_state(&self) -> String {
        let mut out = String::with_capacity(4);
        for t in &self.tracks {
            out.push(if t.muted { '1' } else { '0' });
        }
        out
    }

    /// `act=` payload: 4 comma-separated tracks, each dot-separated ascending
    /// pitches currently sounding. Derived from the open gates, which are
    /// exactly the sequenced notes still ringing — live pad notes are sounded
    /// by the UI directly and never become gates, so they are excluded here.
    fn active_notes_state(&self) -> String {
        let mut out = String::with_capacity(48);
        for t in 0..NUM_TRACKS {
            if t > 0 {
                out.push(',');
            }
            let mut pitches: Vec<u8> = self
                .gates
                .iter()
                .filter(|g| g.track as usize == t)
                .map(|g| g.pitch)
                .collect();
            pitches.sort_unstable();
            pitches.dedup();
            for (i, p) in pitches.iter().enumerate() {
                if i > 0 {
                    out.push('.');
                }
                out.push_str(&p.to_string());
            }
        }
        out
    }

    /// Per-track Session grid state for the UI: tracks joined by ',', each
    /// `EE.P.Q.S` — EE = 2-hex bitmap of occupied slots, P/Q/S = playing /
    /// queued / selected slot (digit, or '-' for none).
    fn session_state(&self) -> String {
        let slot = |o: Option<usize>| o.map_or('-', |s| (b'0' + s as u8) as char);
        let mut out = String::with_capacity(40);
        for (i, t) in self.tracks.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            let mut exist = 0u8;
            for (s, c) in t.clips.iter().enumerate() {
                if c.exists() {
                    exist |= 1 << s;
                }
            }
            out.push_str(&format!(
                "{:02x}.{}.{}.{}",
                exist,
                slot(t.playing_slot),
                slot(t.queued_slot),
                (b'0' + t.active_clip as u8) as char
            ));
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command::apply_batch;
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

    // Playhead tick after `master_ticks` master ticks at the given scale, using
    // a 2-bar loop (768 ticks) so none of the cases wrap.
    fn pos_after(scale_num: u8, scale_den: u8, master_ticks: u64) -> u32 {
        let mut e = engine();
        e.tracks[0].active_mut().set_loop(0, 32);
        e.tracks[0].active_mut().scale_num = scale_num;
        e.tracks[0].active_mut().scale_den = scale_den;
        e.play();
        run_ticks(&mut e, master_ticks);
        e.tracks[0].pos_tick
    }

    #[test]
    fn status_reports_clip_scale_and_transpose() {
        let mut e = engine();
        e.tracks[0].active_mut().set_loop(0, 16);
        e.tracks[0].active_mut().scale_num = 3;
        e.tracks[0].active_mut().scale_den = 2;
        e.tracks[0].active_mut().transpose = -7;
        let s = e.status();
        assert!(s.contains("csc=3/2"), "{s}");
        assert!(s.contains("ctr=-7"), "{s}");
    }

    #[test]
    fn scale_changes_playhead_rate() {
        assert_eq!(pos_after(1, 1, 48), 48); // 1X  → 1:1
        assert_eq!(pos_after(2, 1, 48), 96); // 2X  → 2 ticks per master tick
        assert_eq!(pos_after(1, 2, 48), 24); // 1/2X → 1 tick per 2 master ticks
        assert_eq!(pos_after(3, 4, 48), 36); // 3/4X → 36 ticks
    }

    // Master tick at which a 1-step note (gate 24) at the given scale note-offs.
    fn note_off_master_tick(scale_num: u8, scale_den: u8) -> usize {
        let mut e = engine();
        e.tracks[0].active_mut().set_loop(0, 16);
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.tracks[0].active_mut().scale_num = scale_num;
        e.tracks[0].active_mut().scale_den = scale_den;
        e.play();
        let mut out = Vec::new();
        for m in 0..400 {
            out.clear();
            e.service_tick(&mut out);
            if out.iter().any(|x| matches!(x, OutEvent::NoteOff { track: 0, pitch: 60 })) {
                return m;
            }
        }
        panic!("no note-off within range");
    }

    #[test]
    fn stopped_track_flushes_hanging_notes() {
        let mut e = engine();
        e.tracks[0].active_mut().set_loop(0, 16);
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.play();
        let mut out = Vec::new();
        e.service_tick(&mut out); // emits NoteOn(60); gate active for ~24 ticks
        assert!(out.iter().any(|x| matches!(x, OutEvent::NoteOn { pitch: 60, .. })));
        // Stop the track mid-note (Session stop): step_tick no longer runs, so
        // the gate would hang — the safety flush must note it off instead.
        e.tracks[0].playing_slot = None;
        out.clear();
        e.service_tick(&mut out);
        assert!(out.iter().any(|x| matches!(x, OutEvent::NoteOff { track: 0, pitch: 60 })));
        assert!(e.gates.is_empty());
    }

    #[test]
    fn note_gate_scales_with_clip_scale() {
        // At 2X the note lifecycle runs twice as fast, so a 1-step note lasts
        // half the real-time (master ticks) of the 1X note.
        assert_eq!(note_off_master_tick(1, 1), 24);
        assert_eq!(note_off_master_tick(2, 1), 12);
    }

    #[test]
    fn transpose_shifts_emitted_pitch_only() {
        let mut e = engine();
        e.tracks[0].active_mut().set_loop(0, 16);
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.tracks[0].active_mut().transpose = 12;
        e.play();
        let out = run_ticks(&mut e, 4);
        let on = out.iter().find_map(|x| match x {
            OutEvent::NoteOn { pitch, .. } => Some(*pitch),
            _ => None,
        });
        assert_eq!(on, Some(72)); // 60 + 12, emitted only
        assert_eq!(e.tracks[0].active().notes[0].pitch, 60); // stored pitch untouched
    }

    #[test]
    fn live_record_captures_at_scaled_position() {
        let mut e = engine();
        e.tracks[0].active_mut().set_loop(0, 16);
        e.tracks[0].active_mut().scale_num = 2; // 2X: playhead advances 2 ticks/master tick
        e.tracks[0].active_mut().scale_den = 1;
        e.play();
        e.toggle_record(0);                 // punch-in (already playing → no count-in)
        let mut out = Vec::new();
        for _ in 0..3 { e.service_tick(&mut out); }
        let start = e.tracks[0].pos_tick;
        assert_eq!(start, 6);               // 2 ticks per master tick over 3 ticks
        e.live_note_on(0, 64, 100);
        e.live_note_off(0, 64);
        let n = e.tracks[0].active().notes.iter().find(|n| n.pitch == 64).unwrap();
        assert_eq!(n.tick, start);          // captured at the scaled playhead position
    }

    #[test]
    fn recording_stores_untransposed_pitch() {
        let mut e = engine();
        e.tracks[0].active_mut().set_loop(0, 16);
        e.tracks[0].active_mut().transpose = 5;
        e.play();
        e.toggle_record(0); // punch-in (already playing → no count-in)
        e.live_note_on(0, 67, 100); // pad plays raw 67
        e.tracks[0].pos_tick += 4;
        e.live_note_off(0, 67);
        // Stored as 67 - 5 = 62, so emit re-adds 5 -> 67 (matches the pad).
        assert_eq!(e.tracks[0].active().notes.last().unwrap().pitch, 62);
    }

    #[test]
    fn condition_skips_trig_on_off_cycle() {
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.tracks[0].active_mut().set_loop(0, 16);
        e.tracks[0].active_mut().set_trig_cond(0, 0, None, 2, 2); // 2:2
        e.play();
        let ev1 = run_ticks(&mut e, 16 * TICKS_PER_STEP as u64);
        assert!(!ev1.iter().any(|x| matches!(x, OutEvent::NoteOn { pitch: 60, .. })),
            "cycle 1 should be silent for 2:2");
        let ev2 = run_ticks(&mut e, 16 * TICKS_PER_STEP as u64);
        assert!(ev2.iter().any(|x| matches!(x, OutEvent::NoteOn { pitch: 60, .. })),
            "cycle 2 should sound for 2:2");
    }

    #[test]
    fn probability_zero_never_plays() {
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.tracks[0].active_mut().set_loop(0, 16);
        e.tracks[0].active_mut().set_trig_prob(0, 0, None, 0);
        e.play();
        let ev = run_ticks(&mut e, 16 * TICKS_PER_STEP as u64 * 4);
        assert!(!ev.iter().any(|x| matches!(x, OutEvent::NoteOn { .. })), "0% never plays");
    }

    #[test]
    fn chord_shares_one_probability_decision() {
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100), (64, 100)]);
        e.tracks[0].active_mut().set_loop(0, 16);
        e.tracks[0].active_mut().set_trig_prob(0, 0, None, 50);
        e.play();
        let ev = run_ticks(&mut e, 16 * TICKS_PER_STEP as u64 * 8);
        let n60 = ev.iter().filter(|x| matches!(x, OutEvent::NoteOn { pitch: 60, .. })).count();
        let n64 = ev.iter().filter(|x| matches!(x, OutEvent::NoteOn { pitch: 64, .. })).count();
        assert_eq!(n60, n64, "chord notes must share the same play/skip decision");
    }

    #[test]
    fn status_reports_held_trig_props() {
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(3, &[(60, 90), (64, 110)]);
        e.tracks[0].active_mut().set_trig_prob(3, 3, None, 40);
        e.tracks[0].active_mut().set_trig_cond(3, 3, None, 2, 3);
        e.set_held_query(Some((0, 3)));
        let s = e.status();
        assert!(s.contains(" hvel=100"), "avg of 90,110 = 100; got: {s}");
        assert!(s.contains(" hgmix=0"), "same gate not mixed; got: {s}");
        assert!(s.contains(" hprob=40"), "{s}");
        assert!(s.contains(" hcond=2:3"), "{s}");
        assert!(s.contains(" hinv=0"), "{s}");
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

    /// Advance `ticks` master ticks one block at a time; for each of tracks 0
    /// and 1, collect the master-tick values (in steps since `start`) at which
    /// it emits a NoteOn. Both observed in one pass (same engine instance).
    fn fire_steps(e: &mut Engine, ticks: u64) -> (Vec<u64>, Vec<u64>) {
        let mut out = Vec::new();
        let start = e.clock.tick;
        let (mut p0, mut p1) = (Vec::new(), Vec::new());
        while e.clock.tick < start + ticks {
            out.clear();
            let before = e.clock.tick;
            e.advance_block(FRAMES, &mut out);
            if e.clock.tick == before {
                continue;
            }
            let at_step = (e.clock.tick - 1 - start) / TICKS_PER_STEP as u64;
            if out.iter().any(|x| matches!(x, OutEvent::NoteOn { track: 0, .. })) {
                p0.push(at_step);
            }
            if out.iter().any(|x| matches!(x, OutEvent::NoteOn { track: 1, .. })) {
                p1.push(at_step);
            }
        }
        (p0, p1)
    }

    /// Joining the transport by entering a note bar-quantizes the new clip: it
    /// starts a bar later but every one of its step-0 hits lands exactly on a
    /// tick where an already-playing reference clip also hits — perfect bar
    /// sync, regardless of how far into the bar the note was entered.
    #[test]
    fn note_join_is_phase_locked_to_a_playing_clip() {
        let mut e = engine();
        let mut out = Vec::new();
        e.tracks[1].active_mut().toggle_step(0, &[(62, 100)]);
        e.play();
        let target = e.clock.tick + 5 * TICKS_PER_STEP as u64;
        while e.clock.tick < target {
            e.advance_block(FRAMES, &mut out);
        }
        apply_batch(&mut e, "tog 0 0 60 100", &mut out);
        let (p0, p1) = fire_steps(&mut e, 3 * crate::TICKS_PER_BAR as u64);
        assert!(!p0.is_empty(), "the joined clip eventually plays");
        assert!(
            p0.iter().all(|s| p1.contains(s)),
            "joined clip fires in lockstep with the reference: p0={p0:?} p1={p1:?}"
        );
    }

    // Collect (lane, val) CCs for track 0 from an event list.
    fn ccs0(ev: &[OutEvent]) -> Vec<(u8, u8)> {
        ev.iter().filter_map(|x| match x {
            OutEvent::Cc { lane, val, track: 0 } => Some((*lane, *val)),
            _ => None,
        }).collect()
    }

    #[test]
    fn automation_latches_forward_emitting_on_change_only() {
        let mut e = engine();
        // Lane 0 assigned, base 40; note at step 0; lock 100 at step 2.
        e.tracks[0].lane_assigned[0] = true;
        e.tracks[0].lane_base[0] = 40;
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.tracks[0].active_mut().set_lock(0, 2, 100);
        e.play();
        // Run one full bar (16 steps) + slack into step 0 of the next pass.
        let ev = run_ticks(&mut e, 16 * TICKS_PER_STEP as u64 + 2);
        let ccs = ccs0(&ev);
        // Only three emits across 16+ steps: base 40 at step 0, lock 100 at step
        // 2 (then 100 latches with no per-step re-emit through step 15), and base
        // 40 again at step 0 of pass 2 where the note reverts the latch.
        assert_eq!(ccs, vec![(0, 40), (0, 100), (0, 40)], "latch should emit on change only");
    }

    #[test]
    fn automation_reverts_to_base_on_note_at_other_step() {
        let mut e = engine();
        e.tracks[0].lane_assigned[0] = true;
        e.tracks[0].lane_base[0] = 40;
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.tracks[0].active_mut().toggle_step(8, &[(62, 100)]); // note step 8
        e.tracks[0].active_mut().set_lock(0, 2, 100);
        e.play();
        let ev = run_ticks(&mut e, 16 * TICKS_PER_STEP as u64 + 2);
        let ccs = ccs0(&ev);
        // step0 → base 40, step2 → 100, step8 note → back to base 40.
        assert_eq!(ccs, vec![(0, 40), (0, 100), (0, 40)]);
    }

    #[test]
    fn automation_carries_across_loop_boundary() {
        let mut e = engine();
        e.tracks[0].lane_assigned[0] = true;
        e.tracks[0].lane_base[0] = 40;
        // No notes → nothing interrupts; lock 77 at step 14.
        e.tracks[0].active_mut().set_lock(0, 14, 77);
        // Give the clip a length so it plays (set_loop one bar) without notes.
        e.tracks[0].active_mut().set_loop(0, 16);
        e.play();
        // Two full bars: after the lock at 14 the value 77 must persist past the
        // wrap (no re-revert to base at step 0 of the second pass).
        let ev = run_ticks(&mut e, 32 * TICKS_PER_STEP as u64 + 2);
        let ccs = ccs0(&ev);
        // First pass: base 40 (seed at step 0), then 77 at step 14. Second pass:
        // value stays 77 across the boundary → no further CC.
        assert_eq!(ccs, vec![(0, 40), (0, 77)]);
    }

    #[test]
    fn automation_matches_effective_at_oracle_in_steady_state() {
        let mut e = engine();
        e.tracks[0].lane_assigned[0] = true;
        let base = 40u8;
        e.tracks[0].lane_base[0] = base;
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.tracks[0].active_mut().toggle_step(8, &[(62, 100)]);
        e.tracks[0].active_mut().set_lock(0, 2, 100);
        e.tracks[0].active_mut().set_lock(0, 10, 55);
        let clip = e.tracks[0].active().clone();
        e.play();
        // First full bar reaches steady state (the carry settles). Then at every
        // tick of the second bar the applied value (auto_cur) must equal the
        // oracle for the step the playhead is in — no alignment assumptions.
        run_ticks(&mut e, 16 * TICKS_PER_STEP as u64);
        for _ in 0..16 * TICKS_PER_STEP as u64 {
            run_ticks(&mut e, 1);
            let step = e.tracks[0].current_step();
            assert_eq!(e.tracks[0].auto_cur[0], clip.effective_at(0, step, base) as i16,
                "step {step} mismatch vs oracle");
        }
    }

    #[test]
    fn no_cc_for_unassigned_lane() {
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.tracks[0].active_mut().set_lock(0, 0, 50); // lock but lane unassigned
        e.play();
        let ev = run_ticks(&mut e, TICKS_PER_STEP as u64 + 2);
        assert!(!ev.iter().any(|x| matches!(x, OutEvent::Cc { .. })));
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
    fn copy_paste_carries_locks_even_without_notes() {
        use crate::command::apply_batch;
        let mut e = engine();
        let mut out = Vec::new();
        // Lock on step 1 with NO note there; note on step 0.
        apply_batch(&mut e, "tog 0 0 60 100", &mut out);
        e.tracks[0].active_mut().set_lock(2, 1, 77);
        apply_batch(&mut e, "cpy 0 0 3", &mut out);   // copy steps 0-3 (locks + notes)
        apply_batch(&mut e, "pst 0 8", &mut out);     // paste at step 8
        assert_eq!(e.tracks[0].active().lock_at(2, 9), Some(77)); // step 1 → 9
        assert!(e.tracks[0].active().step_has_notes(8));          // step 0 → 8
    }

    #[test]
    fn paste_steps_replaces_destination() {
        let mut e = engine();
        // Source: note at step 0. Destination step 4 already has a note.
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.tracks[0].active_mut().toggle_step(4, &[(62, 100)]);
        e.copy_steps(0, 0, 0);          // copy one step
        e.paste_steps(0, 4);            // paste-replace at step 4
        // Step 4 now holds ONLY the source's pitch (62 replaced by 60), not both.
        let at4: Vec<u8> = e.tracks[0].active().notes.iter()
            .filter(|n| n.step == 4).map(|n| n.pitch).collect();
        assert_eq!(at4, vec![60], "destination replaced, not merged");
    }

    #[test]
    fn paste_steps_empty_source_clears_destination() {
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(2, &[(62, 100)]); // dest has a note
        e.copy_steps(0, 0, 0);          // step 0 is empty → empty clipboard
        e.paste_steps(0, 2);            // replace step 2 with empty
        assert!(!e.tracks[0].active().step_has_notes(2), "empty source clears the dest step");
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
    fn launch_when_stopped_is_immediate() {
        let mut e = engine();
        e.tracks[1].clips[2].toggle_step(0, &[(60, 100)]);
        e.launch_clip(1, 2);
        assert!(e.playing);
        assert_eq!(e.tracks[1].playing_slot, Some(2));
        assert_eq!(e.tracks[1].active_clip, 2);
        // Only track 1 plays; others stay silent.
        assert_eq!(e.tracks[0].playing_slot, None);
        let ev = run_ticks(&mut e, 2);
        assert!(ev.contains(&OutEvent::NoteOn { track: 1, pitch: 60, vel: 100 }));
    }

    #[test]
    fn launch_while_running_is_bar_quantized() {
        let mut e = engine();
        e.tracks[0].clips[0].toggle_step(0, &[(60, 100)]);
        e.tracks[0].clips[3].toggle_step(0, &[(67, 100)]);
        e.launch_clip(0, 0); // immediate (stopped)
        // Queue clip 3 mid-bar; it must not switch until the next bar.
        run_ticks(&mut e, TICKS_PER_STEP as u64 * 2);
        e.launch_clip(0, 3);
        assert_eq!(e.tracks[0].playing_slot, Some(0));
        assert_eq!(e.tracks[0].queued_slot, Some(3));
        // Advance to the next bar boundary → clip 3 takes over.
        run_ticks(&mut e, crate::TICKS_PER_BAR as u64);
        assert_eq!(e.tracks[0].playing_slot, Some(3));
        assert_eq!(e.tracks[0].queued_slot, None);
    }

    #[test]
    fn empty_slot_selects_and_stops_track() {
        let mut e = engine();
        e.tracks[2].clips[0].toggle_step(0, &[(60, 100)]);
        e.launch_clip(2, 0);
        run_ticks(&mut e, 4);
        // Select an empty slot 5: selects it and stops the track at next bar.
        e.launch_clip(2, 5);
        assert_eq!(e.tracks[2].active_clip, 5);
        assert!(e.tracks[2].pending_stop);
        run_ticks(&mut e, crate::TICKS_PER_BAR as u64);
        assert_eq!(e.tracks[2].playing_slot, None);
    }

    #[test]
    fn session_status_reports_grid() {
        let mut e = engine();
        e.tracks[0].clips[0].toggle_step(0, &[(60, 100)]);
        e.tracks[0].clips[1].toggle_step(0, &[(62, 100)]);
        e.launch_clip(0, 0);
        let s = e.status();
        let sess = s.split("sess=").nth(1).unwrap().split(' ').next().unwrap();
        let t0 = sess.split(',').next().unwrap();
        // slots 0 and 1 exist → bitmap 0x03; playing 0; queued -; selected 0.
        assert_eq!(t0, "03.0.-.0");
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
    fn status_reports_active_notes_during_playback() {
        let mut e = engine();
        // One note on track 0 at step 0, then start playback (play() selects
        // the active clip as the playing slot).
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.play();
        // Advance just past the note's trigger so its gate is open.
        let _ = run_ticks(&mut e, 2);
        let s = e.status();
        let act = s.split("act=").nth(1).unwrap().split(' ').next().unwrap();
        // Format: 4 comma-separated tracks, dot-separated pitches; track 0 sounds 60.
        assert_eq!(act.split(',').next().unwrap(), "60");
    }

    #[test]
    fn active_notes_clear_when_stopped() {
        let mut e = engine();
        let mut out = Vec::new();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.play();
        let _ = run_ticks(&mut e, 2);
        e.stop(&mut out); // stop drains gates (silences) → active set empties
        let s = e.status();
        let act = s.split("act=").nth(1).unwrap().split(' ').next().unwrap();
        assert_eq!(act, ",,,"); // all four tracks empty
    }

    #[test]
    fn empty_clip_does_not_advance_position() {
        let mut e = engine();
        e.play();
        let _ = run_ticks(&mut e, 10);
        assert_eq!(e.tracks[0].pos_tick, 0);
    }

    #[test]
    fn hold_query_reports_note_length_in_steps() {
        let mut e = engine();
        let mut out = Vec::new();
        e.tracks[0].active_mut().toggle_step(2, &[(60, 100)]);
        e.tracks[0].active_mut().set_length(2, 2, None, 4 * TICKS_PER_STEP); // 4 steps
        crate::command::apply_batch(&mut e, "hold 0 2", &mut out);
        let s1 = e.status();
        let hlen = s1.split("hlen=").nth(1).unwrap().split(' ').next().unwrap();
        assert_eq!(hlen, "4");
        crate::command::apply_batch(&mut e, "hold 0 -1", &mut out); // clear
        let s2 = e.status();
        let hlen0 = s2.split("hlen=").nth(1).unwrap().split(' ').next().unwrap();
        assert_eq!(hlen0, "0");
    }

    #[test]
    fn hold_query_reports_step_pitches() {
        let mut e = engine();
        let mut out = Vec::new();
        e.tracks[0].active_mut().toggle_step(3, &[(60, 100), (64, 90), (67, 80)]);
        crate::command::apply_batch(&mut e, "hold 0 3", &mut out);
        let s = e.status();
        let hnotes = s.split("hnotes=").nth(1).unwrap().split(' ').next().unwrap();
        assert_eq!(hnotes, "60.64.67");
        // Empty step → empty hnotes
        crate::command::apply_batch(&mut e, "hold 0 5", &mut out); // step 5 has no notes
        let s2 = e.status();
        let hn2 = s2.split("hnotes=").nth(1).unwrap().split(' ').next().unwrap();
        assert_eq!(hn2, "");
        // No hold → empty
        crate::command::apply_batch(&mut e, "hold 0 -1", &mut out);
        let s3 = e.status();
        let hn3 = s3.split("hnotes=").nth(1).unwrap().split(' ').next().unwrap();
        assert_eq!(hn3, "");
    }

    #[test]
    fn status_reports_watched_pos_tick() {
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.play();
        let _ = run_ticks(&mut e, 5);
        let s = e.status();
        let pos = s.split("pos=").nth(1).unwrap().split(' ').next().unwrap();
        assert_eq!(pos.parse::<u32>().unwrap(), e.tracks[e.watch_track].pos_tick);
    }

    #[test]
    fn record_while_playing_skips_count_in() {
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.play();              // transport already running
        e.toggle_record(0);
        assert!(e.recording, "records immediately");
        assert!(!e.counting_in(), "no count-in while already playing");
    }

    #[test]
    fn record_while_stopped_arms_count_in() {
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.toggle_record(0);
        assert!(e.counting_in(), "stopped: arms the count-in");
        assert!(!e.recording, "recording begins only after the count-in");
    }

    #[test]
    fn clips_silent_during_count_in_then_play() {
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.toggle_record(0); // arms a one-bar count-in, starts transport
        // Most of the count-in bar: no clip NoteOn (clicks are a different event).
        let during = run_ticks(&mut e, crate::TICKS_PER_BAR as u64 - 4);
        assert!(!during.iter().any(|x| matches!(x, OutEvent::NoteOn { .. })),
                "no clip notes during count-in");
        // Cross the count-in boundary: the step-0 note plays.
        let after = run_ticks(&mut e, 8);
        assert!(after.iter().any(|x| matches!(x, OutEvent::NoteOn { pitch: 60, .. })),
                "note plays once count-in ends");
    }

    #[test]
    fn status_reports_mute_flags() {
        use crate::command::apply_batch;
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "mute 1 1", &mut out);
        let s = e.status();
        let m = s.split("mute=").nth(1).unwrap().split(' ').next().unwrap();
        assert_eq!(m, "0100"); // track 1 muted
    }

    #[test]
    fn first_recording_auto_extends_clip() {
        // Empty clip: recording should extend bar-by-bar on each loop.
        let mut e = engine();
        e.toggle_record(0); // count-in
        run_ticks(&mut e, crate::TICKS_PER_BAR as u64 + 1); // start recording
        assert!(e.recording);
        assert_eq!(e.tracks[0].active().length_steps, crate::STEPS_PER_BAR as u16);
        // Run one full bar: pos_tick should hit end → clip extends to 2 bars.
        run_ticks(&mut e, crate::TICKS_PER_BAR as u64);
        assert_eq!(e.tracks[0].active().length_steps, crate::STEPS_PER_BAR as u16 * 2);
    }

    #[test]
    fn overdub_does_not_auto_extend_clip() {
        // Clip already has a note → overdub should NOT extend on wrap.
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]); // place a note first
        assert_eq!(e.tracks[0].active().notes.len(), 1);
        let initial_len = e.tracks[0].active().length_steps;
        e.toggle_record(0); // count-in; rec_empty_start = false (has notes)
        run_ticks(&mut e, crate::TICKS_PER_BAR as u64 + 1); // start recording
        assert!(e.recording);
        // Run one full bar: clip should NOT extend.
        run_ticks(&mut e, crate::TICKS_PER_BAR as u64);
        assert_eq!(e.tracks[0].active().length_steps, initial_len);
    }

    #[test]
    fn punch_in_records_into_empty_slot_and_extends() {
        // Transport already running, then record a NEW clip into an empty slot
        // (Session punch-in). The slot must become the track's playing/recording
        // clip — capture works and it auto-extends like any first recording.
        let mut e = engine();
        e.tracks[1].active_mut().toggle_step(0, &[(48, 100)]); // some other track playing
        e.play();
        assert!(e.playing);

        e.launch_clip(0, 2); // select empty slot 2 while running (sets pending_stop)
        assert!(e.tracks[0].active().notes.is_empty());

        e.toggle_record(0); // punch-in (no count-in)
        assert!(e.recording);
        assert_eq!(e.tracks[0].playing_slot, Some(2), "empty slot not made the playing clip");
        assert!(!e.tracks[0].pending_stop, "pending stop from empty-slot select not cleared");

        // A live note is captured into the new clip.
        e.live_note_on(0, 60, 110);
        run_ticks(&mut e, 2 * TICKS_PER_STEP as u64);
        e.live_note_off(0, 60);
        assert_eq!(e.tracks[0].clips[2].notes.len(), 1, "note not recorded into the empty slot");

        // Crossing the end auto-extends the new clip bar-by-bar.
        let before = e.tracks[0].clips[2].length_steps;
        run_ticks(&mut e, crate::TICKS_PER_BAR as u64);
        assert!(e.tracks[0].clips[2].length_steps > before, "new clip did not auto-extend");
    }

    #[test]
    fn swing_delays_offbeat_steps_only() {
        // Returns the clip-position tick at which the note on `step` fires.
        // Advances in 8-frame chunks (≈0.03 ticks each, so ≤1 tick fires per
        // chunk) and reads the master tick from status. status `tick=` is
        // post-increment, and the note fires while pos == master_tick - 1, so
        // the firing position is (status tick − 1).
        fn fire_tick(swing: u32, step: u16) -> u64 {
            let mut e = Engine::new(44100, 12000);
            e.swing_pct = swing;
            let mut out = Vec::new();
            apply_batch(&mut e, &format!("tog 0 {step} 60 100"), &mut out);
            e.play();
            for _ in 0..5000 {
                out.clear();
                e.advance_block(8, &mut out);
                if out.iter().any(|ev| matches!(ev, OutEvent::NoteOn { pitch: 60, .. })) {
                    let st = e.status();
                    let tick = st.split_whitespace()
                        .find_map(|kv| kv.strip_prefix("tick="))
                        .and_then(|v| v.parse::<u64>().ok())
                        .expect("status has tick=");
                    return tick - 1;
                }
            }
            panic!("note on step {step} never fired (swing {swing})");
        }
        // Straight: step 0 at tick 0, step 1 at tick 24.
        assert_eq!(fire_tick(50, 0), 0);
        assert_eq!(fire_tick(50, 1), 24);
        // Swing 80: even step unchanged, odd step delayed 12 ticks.
        assert_eq!(fire_tick(80, 0), 0);
        assert_eq!(fire_tick(80, 1), 24 + 12);
    }

    #[test]
    fn status_reports_swing() {
        let mut e = Engine::new(44100, 12000);
        e.swing_pct = 66;
        assert!(e.status().contains("swing=66"));
    }
}
