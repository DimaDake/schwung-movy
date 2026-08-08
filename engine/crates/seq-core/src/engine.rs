//! The sequencer engine: transport + clock + per-tick note scheduling.
//! Pure logic — emits `OutEvent`s into a caller buffer; the FFI layer turns
//! them into host MIDI sends. One Engine instance == the whole 4-track
//! sequencer.

use crate::capture::{
    estimate_tempos, CapEvent, CapMode, CapWhy, CaptureRing, TempoGuess, CAPTURE_MAX_BARS,
};
use crate::clip::{Clip, Lock, MAX_STEPS};
use crate::clock::Clock;
use crate::track::{Track, CLIPS_PER_TRACK, NUM_TRACKS};
use crate::{PPQN, STEPS_PER_BAR, TICKS_PER_BAR, TICKS_PER_STEP};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum OutEvent {
    NoteOn { track: u8, pitch: u8, vel: u8 },
    NoteOff { track: u8, pitch: u8 },
    /// Metronome click; `accent` marks the downbeat (bar start).
    Click { accent: bool },
    /// Parameter automation: chain abs-CC 102+lane, value 0..=127.
    Cc { track: u8, lane: u8, val: u8 },
    /// MIDI transport out (schwung transport service): 0xFA on play,
    /// 0xF8 at 24 PPQN while playing, 0xFC on stop — so schwung's synced
    /// LFOs/params phase-lock to this sequencer's grid.
    Start,
    Stop,
    Clock,
    /// MovePlay (CC 85) toward Move's firmware — the always-on transport link
    /// (design §7 Phase 4). Two-phase toggle: press (val 127) then release
    /// (val 0). Fire-and-forget; never emitted from a transport-state change.
    MoveInject { val: u8 },
}

/// MovePlay press→release gap in audio frames (davebox `MOVE_PLAY_RELEASE_SAMPLES`,
/// ~50 ms at 44.1 kHz) — reused verbatim so Move sees a clean button tap.
const MOVE_PLAY_RELEASE_GAP: u64 = 2205;

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
    /// Retroactive capture input (Move manual §14.3). Runtime-only.
    capture: CaptureRing,
    /// A stopped capture's take, frame-stamped, kept while the overlay is up so
    /// the selector can re-derive it at any tempo without accumulating rounding.
    cap_take: Vec<CapEvent>,
    cap_take_first: u64,
    cap_track: usize,
    cap_guess: Option<TempoGuess>,
    cap_sel: usize,
    cap_mode: CapMode,
    cap_why: CapWhy,
    /// How far the fitted take had to be stretched, in per mille (fixed mode).
    cap_stretch_permille: i32,
    /// Bumped on every commit / selector change so the UI knows to re-read
    /// `capinfo` without polling it every tick.
    capture_gen: u32,
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
    /// True while we are emitting MIDI transport clock (between Start and Stop).
    /// Runtime-only edge tracker — never persisted.
    emitting_clock: bool,
    /// Per-track: the chain slot holds a drum module, so its pitches address
    /// pads rather than notes and clip transpose must not shift them. Set by
    /// the UI (`tdrum`), which owns module identity. Runtime-only: it is a
    /// property of the loaded module, re-sent on load and after any swap.
    track_drum: [bool; NUM_TRACKS],

    // --- external (Move native) clock follow — design §7 Phase 3 ---
    // All runtime-only (never persisted): they model Move's cable-0 transport,
    // delivered to movy-dsp's on_midi and forwarded here.
    /// Move's transport is running (between its 0xFA/first-tick and 0xFC).
    ext_running: bool,
    /// The next 0xF8 is the anchor tick — it seeds timing, no interval yet.
    ext_awaiting_first: bool,
    /// External 24-PPQN ticks counted since the anchor.
    ext_ticks: u64,
    /// `frame_now` at the last external tick (drives interval + staleness).
    ext_last_frame: u64,
    /// EMA-smoothed frames-per-external-tick (→ captured tempo).
    ext_interval: f64,
    /// Launch-quantize base: the external tick index of our bar-0 downbeat.
    ext_base: u64,
    /// `ext_base` is set — 0xFA anchors it; engaging mid-song sets it once.
    ext_base_set: bool,
    /// Monotonic audio-frame clock; advances once per block.
    frame_now: u64,
    /// Were we following on the previous block? (engage/disengage edges)
    was_following: bool,
    /// After a revert to internal clock, re-anchor emission at our next bar.
    resume_anchor_pending: bool,

    // --- always-on bidirectional transport link — design §7 Phase 4 ---
    // All runtime-only (never persisted). Injects fire ONLY from explicit
    // transport commands (request_play/request_stop), never state changes.
    /// movy Play issued while Move was stopped: hold silent until Move's 0xFA,
    /// or the 2-bar timeout starts us on the internal clock.
    pending_play: bool,
    /// `frame_now` deadline for the pending-start timeout fallback.
    pending_play_deadline: u64,
    /// Queued MovePlay toggles awaiting emission (each = one press+release).
    /// A counter, not a bool, so back-to-back toggles (start then cancel) both
    /// reach Move as distinct button taps.
    move_toggle_queue: u8,
    /// `frame_now` at which the in-flight toggle's release fires; 0 = no toggle
    /// currently pressed.
    inject_release_at: u64,
    /// User toggle (Set-page LINK cell): when false, the Play/Stop propagation
    /// above is disabled — movy's transport is independent of Move's (Phase 3
    /// clock-follow still applies). Persisted per set; default off.
    pub link_enabled: bool,
    /// Undo snapshots, addressed by the id the UI assigns. Runtime-only: the
    /// UI's stack is in-memory too, so persisting these would restore history
    /// for a stack that no longer exists.
    pub undo: crate::undo::UndoRing,
}

/// How far apart two tempos are, as a ratio >= 1 — direction-agnostic, so a
/// candidate above and below the target compare fairly.
fn cand_ratio(a: u32, b: u32) -> f64 {
    let (a, b) = (a as f64, b.max(1) as f64);
    if a > b { a / b } else { b / a }
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
            capture: CaptureRing::new(),
            capture_gen: 0,
            cap_take: Vec::new(),
            cap_take_first: 0,
            cap_track: 0,
            cap_guess: None,
            cap_sel: 0,
            cap_mode: CapMode::None,
            cap_why: CapWhy::None,
            cap_stretch_permille: 0,
            master_tick: 0,
            dirty: false,
            gates: Vec::with_capacity(128),
            held_query: None,
            rng_state: 0x9E3779B97F4A7C15,
            swing_pct: 50,
            emitting_clock: false,
            track_drum: [false; NUM_TRACKS],
            ext_running: false,
            ext_awaiting_first: false,
            ext_ticks: 0,
            ext_last_frame: 0,
            ext_interval: 0.0,
            ext_base: 0,
            ext_base_set: false,
            frame_now: 0,
            was_following: false,
            resume_anchor_pending: false,
            pending_play: false,
            pending_play_deadline: 0,
            move_toggle_queue: 0,
            inject_release_at: 0,
            link_enabled: false,
            undo: crate::undo::UndoRing::new(),
        }
    }

    /// Mark a track's slot as holding a drum module (UI-owned — see `track_drum`).
    pub fn set_track_drum(&mut self, track: usize, drum: bool) {
        if track < NUM_TRACKS {
            self.track_drum[track] = drum;
        }
    }

    pub fn track_is_drum(&self, track: usize) -> bool {
        track < NUM_TRACKS && self.track_drum[track]
    }

    /// Clip transpose in effect for a track's clip — 0 on a drum track, whose
    /// pitches are pad addresses. Single source of truth for every site that
    /// applies or undoes transpose (emit, live record, step entry), so the
    /// three can never disagree about what a stored pitch means.
    pub fn clip_transpose(&self, track: usize, slot: usize) -> i32 {
        if self.track_is_drum(track) {
            return 0;
        }
        self.tracks
            .get(track)
            .and_then(|t| t.clips.get(slot))
            .map_or(0, |c| c.transpose as i32)
    }

    /// `clip_transpose` for the track's active (edited) clip.
    pub fn active_clip_transpose(&self, track: usize) -> i32 {
        if track >= NUM_TRACKS {
            return 0;
        }
        self.clip_transpose(track, self.tracks[track].active_clip)
    }

    /// Ticks to delay an odd-indexed 16th step (the off-beat) for swing.
    /// 0 at 50% (straight) … TICKS_PER_STEP/2 (12) at 80%. Even steps: 0.
    /// Swing delay (clip-ticks) for a note on `step`, anchored to real 16th
    /// notes so scaled clips swing the 16th feel rather than their (faster or
    /// slower) step grid. A clip step lands on real-16th index `step*den/num`;
    /// swing applies only when that is an odd integer (an off-beat 16th), and
    /// the delay is a fraction of a real 16th (= num/den clip-steps).
    fn swing_delay(&self, step: u16, scale_num: u8, scale_den: u8) -> u32 {
        if self.swing_pct <= 50 {
            return 0;
        }
        let (num, den) = (scale_num.max(1) as u32, scale_den.max(1) as u32);
        let numer = step as u32 * den;
        if numer % num != 0 || (numer / num) % 2 == 0 {
            return 0; // not an off-beat 16th (on-beat, or a sub-16th position)
        }
        let sixteenth_ticks = num * TICKS_PER_STEP / den;
        (self.swing_pct - 50) * sixteenth_ticks / 60
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
            // The playhead is back at the loop start, so every note is owed
            // another turn — stale per-pass flags would silence the first pass.
            if let Some(slot) = t.playing_slot {
                t.clips[slot].release_pass_flags();
            }
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
        self.capture.clear();
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
        self.capture.clear();
        for t in &mut self.tracks {
            t.last_auto_step = -1;
            t.auto_cur = [-1; 8];
        }
        self.flush_gates(out);
    }

    /// Release every note still sounding (all open gates → NoteOff).
    fn flush_gates(&mut self, out: &mut Vec<OutEvent>) {
        for g in self.gates.drain(..) {
            out.push(OutEvent::NoteOff {
                track: g.track,
                pitch: g.pitch,
            });
        }
    }

    /// Release every note still sounding on one track, leaving other tracks
    /// alone. Mute uses this so silencing a track takes effect now rather than
    /// whenever the current gate happens to expire.
    pub fn flush_track_gates(&mut self, track: usize, out: &mut Vec<OutEvent>) {
        let mut gi = 0;
        while gi < self.gates.len() {
            if self.gates[gi].track as usize == track {
                let g = self.gates.swap_remove(gi);
                out.push(OutEvent::NoteOff {
                    track: g.track,
                    pitch: g.pitch,
                });
                continue; // re-examine the element swapped into this slot
            }
            gi += 1;
        }
    }

    /// Queue a MovePlay toggle: press next `advance_block`, release after the
    /// davebox-verified gap. Fire-and-forget — only ever called from a
    /// transport command (design §7 Phase 4 no-feedback-loop invariant).
    fn queue_move_play_toggle(&mut self) {
        self.move_toggle_queue = self.move_toggle_queue.saturating_add(1);
    }

    /// Transport-button Play under the always-on Move link (design §7 Phase 4):
    /// if Move already runs, start now (Phase 3 bar-quantized join); otherwise
    /// toggle Move and hold silent until its 0xFA (~1-bar Link grid), with a
    /// 2-bar timeout fallback onto the internal clock.
    pub fn request_play(&mut self, out: &mut Vec<OutEvent>) {
        let _ = out;
        if !self.link_enabled {
            // Link off: independent transport, just play (Phase 3 clock-follow
            // still engages if Move happens to be running).
            self.play();
            return;
        }
        if self.ext_running {
            self.play();
            return;
        }
        self.queue_move_play_toggle();
        self.pending_play = true;
        let frames_per_bar =
            self.clock.sample_rate() as u64 * 60 * 4 * 100 / self.clock.bpm_x100() as u64;
        self.pending_play_deadline = self.frame_now + 2 * frames_per_bar;
    }

    /// Transport-button Stop under the always-on Move link. A pending-start
    /// cancels (toggling Move back, since it may already be starting);
    /// otherwise stop, and if Move is running toggle it to stop too.
    pub fn request_stop(&mut self, out: &mut Vec<OutEvent>) {
        if !self.link_enabled {
            self.stop(out);
            return;
        }
        if self.pending_play {
            self.pending_play = false;
            self.queue_move_play_toggle(); // Move may already be starting: toggle back
            return;
        }
        self.stop(out);
        if self.ext_running {
            self.queue_move_play_toggle();
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

    // ── Retroactive capture (manual §14.3) ───────────────────────────────

    /// Silence after which buffered input is a finished phrase rather than the
    /// take in progress: two bars, but never so short that a slow ballad
    /// self-clears mid-phrase nor so long that a jam from minutes ago returns.
    fn capture_gap_frames(&self) -> u64 {
        let sr = self.clock.sample_rate() as u64;
        (2 * self.capture_bar_frames()).clamp(2 * sr, 8 * sr)
    }

    /// One bar in audio frames at the current tempo.
    fn capture_bar_frames(&self) -> u64 {
        self.clock.sample_rate() as u64 * 60 * 4 * 100 / (self.clock.bpm_x100().max(1) as u64)
    }

    /// Buffer a live pad note for a later Capture. Armed input is excluded —
    /// the record path is already writing it, and a count-in belongs to the
    /// take about to be recorded.
    fn capture_push(&mut self, track: usize, pitch: u8, vel: u8, on: bool) {
        if track >= NUM_TRACKS || self.count_in_left > 0 {
            return;
        }
        // The post-capture overlay owns the frozen take: anything played while
        // auditioning candidates would otherwise be glued onto the next commit.
        if self.cap_mode != CapMode::None {
            return;
        }
        if self.recording && track == self.rec_track {
            return;
        }
        // Coming round the loop and playing over a spot you already covered
        // means you are redoing that part, not adding to it — so the earlier
        // pass goes and Capture takes the one you are playing now. Positions
        // that don't collide keep accumulating, so a phrase that crosses the
        // loop end survives intact (clearing at the wrap itself would eat it).
        // The cycle check is what keeps a chord — several notes at one position
        // in the same pass — from clearing itself.
        let here = self.tracks[track].pos_tick;
        let cycle = self.tracks[track].cycle;
        if on && self.playing {
            let stale = self.capture.iter().any(|e| {
                e.on
                    && e.track == track as u8
                    && e.cycle != cycle
                    && e.clip_tick.abs_diff(here) < TICKS_PER_STEP
            });
            if stale {
                self.capture.clear();
            }
        }
        let gap = self.capture_gap_frames();
        let window = CAPTURE_MAX_BARS as u64 * self.capture_bar_frames();
        let ev = CapEvent {
            frame: self.frame_now,
            abs_tick: self.master_tick as u32,
            clip_tick: here,
            cycle,
            track: track as u8,
            on,
            pitch,
            vel,
        };
        self.capture.push(ev, gap, window);
    }

    /// Drop buffered input: Shift+Capture, a transport edge, or a track change
    /// (Move parity — all three clear the Capture LED).
    pub fn capture_clear(&mut self) {
        self.capture.clear();
    }

    pub fn capture_pending(&self, track: usize) -> usize {
        self.capture.pending(track as u8)
    }

    /// Turn buffered input into clip data on the active clip of `track`.
    /// Returns false when there was nothing to keep.
    pub fn capture_commit(&mut self, track: usize) -> bool {
        if track >= NUM_TRACKS {
            return false;
        }
        if self.capture.pending(track as u8) == 0 {
            // Nothing to write, but the press still consumes: orphan note-offs
            // left buffered would otherwise ride along into the next take. The
            // buffer only ever holds the current track's input anyway — a track
            // change clears it.
            self.capture.clear();
            return false;
        }
        let wrote = if self.playing {
            self.capture_commit_playing(track)
        } else {
            self.capture_commit_stopped(track)
        };
        // Pressing Capture consumes the buffer whether or not anything could be
        // written: input that failed to land once will not land any better on
        // the next press, and leaving it buffered means the next take starts
        // with someone else's notes in it.
        self.capture.clear();
        if wrote {
            self.capture_gen = self.capture_gen.wrapping_add(1);
            self.dirty = true;
        }
        wrote
    }

    /// Capture with the transport stopped: freeze the take, work out a tempo
    /// for it, write it into the clip and roll so it plays back at once.
    ///
    /// Move detects a tempo for a fresh take only. An overdub inherits the
    /// clip's grid, and under an external clock the tempo is not ours at all —
    /// in both those cases the take is fitted to the tempo that already exists,
    /// through whichever candidate sits closest to it (so, with the half- and
    /// double-time readings in the list, the smallest possible stretch).
    fn capture_commit_stopped(&mut self, track: usize) -> bool {
        self.cap_take = self
            .capture
            .iter()
            .copied()
            .filter(|e| e.track == track as u8)
            .collect();
        let Some(first) = self.cap_take.iter().find(|e| e.on).map(|e| e.frame) else {
            return false;
        };
        let last = self.cap_take.last().map(|e| e.frame).unwrap_or(first);
        self.cap_take_first = first;
        self.cap_track = track;

        let onsets: Vec<u64> = self
            .cap_take
            .iter()
            .filter(|e| e.on)
            .map(|e| e.frame - first)
            .collect();
        let span = last.saturating_sub(first);
        self.cap_guess = estimate_tempos(&onsets, span, self.clock.sample_rate());

        let clip_has_notes = !self.tracks[track].active().notes.is_empty();
        let existing = (self.clock.bpm_x100() / 100).max(1);
        self.cap_why = if self.ext_running {
            CapWhy::Ext
        } else if clip_has_notes {
            CapWhy::Notes
        } else {
            CapWhy::None
        };
        let free = self.cap_why == CapWhy::None;

        let grid_bpm = match &self.cap_guess {
            Some(g) if free => {
                self.cap_sel = g.best;
                g.cands[g.best]
            }
            Some(g) => {
                let i = (0..g.n)
                    .min_by(|&a, &b| {
                        cand_ratio(g.cands[a], existing)
                            .partial_cmp(&cand_ratio(g.cands[b], existing))
                            .unwrap_or(core::cmp::Ordering::Equal)
                    })
                    .unwrap_or(0);
                self.cap_sel = i;
                g.cands[i]
            }
            None => {
                self.cap_sel = 0;
                existing
            }
        };
        self.cap_stretch_permille = (existing as i64 * 1000 / grid_bpm.max(1) as i64) as i32 - 1000;
        let candidates = self.cap_guess.as_ref().map_or(0, |g| g.n);
        self.cap_mode = if free && candidates > 1 {
            CapMode::Select
        } else if !free {
            CapMode::Fixed
        } else {
            CapMode::None
        };

        let wrote = self.capture_write_take(grid_bpm, free, clip_has_notes);
        if wrote {
            self.play();
        } else {
            self.cap_mode = CapMode::None;
            self.cap_take.clear();
        }
        wrote
    }

    /// Write the frozen take into the track's active clip at `grid_bpm`.
    /// `set_tempo` applies that tempo to the transport; `keep_length` overdubs
    /// into the existing loop instead of resizing the clip to the take.
    /// Re-runnable: the selector calls it once per candidate.
    fn capture_write_take(&mut self, grid_bpm: u32, set_tempo: bool, keep_length: bool) -> bool {
        let track = self.cap_track;
        let a = self.tracks[track].active_clip;
        self.tracks[track].active_mut().ensure_exists();
        let frames_per_tick =
            self.clock.sample_rate() as f64 * 60.0 / (grid_bpm.max(1) as f64 * PPQN as f64);
        let span_ticks = self.tracks[track].active().length_ticks().max(1);
        let loop_start = self.tracks[track].active().loop_start_ticks();
        let len_steps = self.tracks[track].active().length_steps;
        if !keep_length {
            self.tracks[track]
                .active_mut()
                .delete_range(0, MAX_STEPS - 1, None);
        }

        let take = core::mem::take(&mut self.cap_take);
        let first = self.cap_take_first;
        let transpose = self.active_clip_transpose(track);
        let mut used = vec![false; take.len()];
        let mut span_end = 0u32;
        let mut wrote = false;

        for i in 0..take.len() {
            let ev = take[i];
            if !ev.on {
                continue;
            }
            let off = take[i + 1..].iter().enumerate().find_map(|(j, o)| {
                let k = i + 1 + j;
                if !o.on && o.pitch == ev.pitch && !used[k] {
                    used[k] = true;
                    Some(o.frame)
                } else {
                    None
                }
            });
            let to_ticks = |f: u64| (f as f64 / frames_per_tick).round() as u32;
            let start = to_ticks(ev.frame - first);
            let gate = off
                .map(|f| to_ticks(f.saturating_sub(ev.frame)).max(1))
                .unwrap_or(TICKS_PER_STEP);
            let tick = if keep_length {
                loop_start + start % span_ticks
            } else {
                start
            };
            let mut step = ((tick + TICKS_PER_STEP / 2) / TICKS_PER_STEP) as u16;
            if keep_length {
                step = step.min(len_steps.saturating_sub(1));
            }
            let stored = (ev.pitch as i32 - transpose).clamp(0, 127) as u8;
            self.tracks[track]
                .active_mut()
                .add_note_raw(step, tick, gate, stored, ev.vel);
            span_end = span_end.max(start + gate);
            wrote = true;
        }
        self.cap_take = take;

        if !keep_length && wrote {
            let bars = span_end.div_ceil(TICKS_PER_BAR).max(1);
            let len = (bars * STEPS_PER_BAR).min(MAX_STEPS as u32) as u16;
            self.tracks[track].clips[a].length_steps = len;
        }
        if set_tempo {
            self.clock.set_bpm_x100(grid_bpm * 100);
        }
        wrote
    }

    /// Apply another tempo candidate from the post-capture selector, re-deriving
    /// the take so the performance keeps its real-time feel at every tempo.
    pub fn capture_select(&mut self, idx: usize) {
        if self.cap_mode != CapMode::Select {
            return;
        }
        let Some(bpm) = self
            .cap_guess
            .as_ref()
            .filter(|g| idx < g.n)
            .map(|g| g.cands[idx])
        else {
            return;
        };
        self.cap_sel = idx;
        self.capture_write_take(bpm, true, false);
        self.capture_gen = self.capture_gen.wrapping_add(1);
        self.dirty = true;
    }

    /// Dismiss the post-capture overlay and release the frozen take.
    pub fn capture_done(&mut self) {
        if self.cap_mode == CapMode::None {
            return;
        }
        self.cap_mode = CapMode::None;
        self.cap_take.clear();
        self.capture_gen = self.capture_gen.wrapping_add(1);
    }

    /// Overlay detail, read once per `capture_gen` change (the per-tick status
    /// poll only carries the pending count and that generation).
    pub fn capture_info(&self) -> String {
        let mode = match self.cap_mode {
            CapMode::Select => "sel",
            CapMode::Fixed => "fix",
            CapMode::None => "none",
        };
        let why = match self.cap_why {
            CapWhy::Ext => "ext",
            CapWhy::Notes => "notes",
            CapWhy::None => "",
        };
        let cands = match (&self.cap_guess, self.cap_mode) {
            (Some(g), CapMode::Select) => g.cands[..g.n]
                .iter()
                .map(|b| b.to_string())
                .collect::<Vec<_>>()
                .join(","),
            // Fixed mode shows "played → set", not a list to scroll.
            _ => String::new(),
        };
        let det = self
            .cap_guess
            .as_ref()
            .map(|g| g.cands[self.cap_sel.min(g.n.saturating_sub(1))])
            .unwrap_or(0);
        let bars = (self.tracks[self.cap_track].active().length_steps as u32)
            .div_ceil(STEPS_PER_BAR)
            .max(1);
        format!(
            "mode={mode} cands={cands} idx={} det={det} bpm={} why={why} bars={bars} stretch={}",
            self.cap_sel,
            self.clock.bpm_x100() / 100,
            self.cap_stretch_permille,
        )
    }

    /// Capture into a running transport: the take lands where it was heard.
    /// An empty clip is laid out from the first played note and grown to whole
    /// bars (the manual's "the first played note aligns with the start of the
    /// clip"); a clip that already has notes is overdubbed and keeps its length.
    fn capture_commit_playing(&mut self, track: usize) -> bool {
        let a = self.tracks[track].active_clip;
        self.tracks[track].active_mut().ensure_exists();
        let fresh = self.tracks[track].active().notes.is_empty();
        let span = self.tracks[track].active().length_ticks().max(1);
        let loop_start = self.tracks[track].active().loop_start_ticks();
        let Some(first_abs) = self
            .capture
            .iter()
            .find(|e| e.track == track as u8 && e.on)
            .map(|e| e.abs_tick)
        else {
            return false;
        };

        let now_abs = self.master_tick as u32;
        // Where in the transport's bar the phrase began — the phase a
        // bar-quantized launch has to preserve.
        let first_phase = first_abs % TICKS_PER_BAR;
        let evs: Vec<CapEvent> = self.capture.iter().copied().collect();
        let transpose = self.active_clip_transpose(track);
        let mut used = vec![false; evs.len()];
        let mut span_end = 0u32;
        let mut wrote = false;

        for i in 0..evs.len() {
            let ev = evs[i];
            if ev.track != track as u8 || !ev.on {
                continue;
            }
            let end = evs[i + 1..].iter().enumerate().find_map(|(j, o)| {
                let k = i + 1 + j;
                if o.track == ev.track && !o.on && o.pitch == ev.pitch && !used[k] {
                    used[k] = true;
                    Some(o.abs_tick)
                } else {
                    None
                }
            });
            let gate = end.unwrap_or(now_abs).saturating_sub(ev.abs_tick).max(1);
            // A first take keeps the phase it was played at: the transport's
            // bar grid already exists, so a phrase that started on beat three
            // has to come back on beat three, not slide onto step 1. From there
            // it is laid out unwrapped, so a phrase longer than the clip extends
            // it instead of folding back onto itself. (A capture made while
            // STOPPED is the other case — no grid exists yet, so there the first
            // note does define the start.) An overdub wraps into the loop that
            // already exists.
            let tick = if fresh {
                loop_start + first_phase + ev.abs_tick.saturating_sub(first_abs)
            } else {
                ev.clip_tick % span
            };
            let stored = (ev.pitch as i32 - transpose).clamp(0, 127) as u8;
            // Unsuppressed, unlike live recording: suppression is there so a note
            // you have only just played does not double-trigger as the playhead
            // reaches it, but a captured note was played in the past. Anything
            // now ahead of the playhead — a phrase that ran over the loop end —
            // has to sound this time round rather than wait for the next repeat.
            let step = ((tick + TICKS_PER_STEP / 2) / TICKS_PER_STEP) as u16;
            self.tracks[track]
                .active_mut()
                .add_note_raw(step, tick, gate, stored, ev.vel);
            span_end = span_end.max(tick + gate);
            wrote = true;
        }

        if fresh && wrote {
            let bars = span_end.div_ceil(TICKS_PER_BAR).max(1);
            let len = (bars * STEPS_PER_BAR).min(MAX_STEPS as u32) as u16;
            self.tracks[track].clips[a].length_steps = len;
        }
        if wrote {
            if fresh {
                // A first take has no grid of its own to fall into, so it gets
                // the transport's: launched on the bar like any other clip, so
                // it lines up with the other tracks. ensure_selected_playing is
                // not enough — a note-less clip is already the playing slot, so
                // it would no-op and the take would start wherever the playhead
                // had got to. The tempo stays the transport's throughout; only a
                // capture made while stopped ever sets one.
                self.tracks[track].queued_slot = Some(a);
                self.tracks[track].pending_stop = false;
            } else {
                // An overdub belongs to the pass already running — the manual's
                // "the captured material will then be added to the clip".
                self.ensure_selected_playing(track);
            }
        }
        wrote
    }

    /// Record a live pad note-on. The UI sounds the note directly (zero
    /// latency); this only captures it for recording, so there's no double
    /// trigger. No-op unless recording this track.
    pub fn live_note_on(&mut self, track: usize, pitch: u8, vel: u8) {
        self.capture_push(track, pitch, vel, true);
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
        self.capture_push(track, pitch, 0, false);
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
            let stored = (pitch as i32 - self.active_clip_transpose(track)).clamp(0, 127) as u8;
            self.tracks[track].active_mut().record_note(p.start_tick, gate.max(1), stored, p.vel);
        }
    }

    /// Follow is automatic (design §7 Phase 3): engaged while we play and
    /// Move's transport runs.
    fn follow_active(&self) -> bool {
        self.playing && self.ext_running
    }

    /// Move's cable-0 transport, delivered by the shim to movy-dsp on_midi.
    /// Follow is automatic: engaged while we play and Move's transport runs
    /// (design §7 Phase 3). Engage/disengage edges are handled in
    /// advance_block; this only maintains the external-clock model.
    pub fn on_external_realtime(&mut self, status: u8, out: &mut Vec<OutEvent>) {
        match status {
            0xFA => {
                // Linked transport (design §7 Phase 4): Move's Play starts movy
                // (and resolves a movy-initiated pending-start) — only when the
                // link is enabled. Note: play() sets ext_base=0 via the anchor
                // below, so bar 0 stays anchored.
                if self.link_enabled && !self.playing {
                    self.pending_play = false;
                    self.play();
                }
                self.ext_running = true;
                self.ext_awaiting_first = true;
                self.ext_ticks = 0;
                self.ext_base = 0;
                self.ext_base_set = true; // FA anchors bar 0; engage must not re-quantize
                self.ext_last_frame = self.frame_now;
                if self.playing {
                    // Both transports start the bar together.
                    self.flush_gates(out);
                    self.start_transport();
                }
            }
            0xFB => self.ext_running = true,
            0xFC => {
                // Linked transport: Move's Stop stops movy (only when the link
                // is enabled; staleness never stops it — that reverts to the
                // internal clock, handled in advance_block). Stop first, while
                // gates are still known, then drop the source.
                if self.link_enabled && self.playing {
                    self.stop(out);
                }
                self.ext_running = false;
            }
            0xF8 => {
                if !self.ext_running {
                    // Attached mid-song (no 0xFA): tempo is right immediately,
                    // bar alignment arrives with the next 0xFA.
                    self.ext_running = true;
                    self.ext_awaiting_first = true;
                }
                if self.ext_awaiting_first {
                    self.ext_awaiting_first = false;
                    self.ext_ticks = 0;
                } else {
                    self.ext_ticks += 1;
                    let delta = (self.frame_now - self.ext_last_frame) as f64;
                    let sr = self.clock.sample_rate() as f64;
                    // Accept only intervals inside 20–999 BPM at 24 PPQN.
                    if delta >= 60.0 * sr / (999.0 * 24.0) && delta <= 60.0 * sr / (20.0 * 24.0) {
                        self.ext_interval = if self.ext_interval <= 0.0 {
                            delta
                        } else {
                            self.ext_interval + 0.25 * (delta - self.ext_interval)
                        };
                        // Continuous capture: the UI shows Move's tempo and a
                        // revert keeps playing at it.
                        let bpm = (60.0 * 100.0 * sr / (self.ext_interval * 24.0)).round() as u32;
                        self.clock.set_bpm_x100(bpm);
                    }
                }
                self.ext_last_frame = self.frame_now;
            }
            _ => {}
        }
    }

    /// Advance one audio block; pushes due MIDI into `out`.
    pub fn advance_block(&mut self, frames: u32, out: &mut Vec<OutEvent>) {
        self.frame_now += frames as u64;

        // Drain the MovePlay inject (design §7 Phase 4): press one block, then
        // release after the davebox gap; the next queued toggle follows once
        // the release has fired. Render-context only, so injects reach Move.
        if self.inject_release_at == 0 && self.move_toggle_queue > 0 {
            self.move_toggle_queue -= 1;
            out.push(OutEvent::MoveInject { val: 127 });
            self.inject_release_at = self.frame_now + MOVE_PLAY_RELEASE_GAP;
        } else if self.inject_release_at > 0 && self.frame_now >= self.inject_release_at {
            self.inject_release_at = 0;
            out.push(OutEvent::MoveInject { val: 0 });
        }

        // Pending-start timeout: Move never answered our MovePlay — start on the
        // internal clock anyway (davebox fallback, design §7 Phase 4).
        if self.pending_play && self.frame_now >= self.pending_play_deadline {
            self.pending_play = false;
            self.play();
        }

        // Staleness: Move wedged without 0xFC must not freeze the playhead
        // (0.5 s, mirrors schwung's transport service).
        if self.ext_running
            && self.ext_last_frame > 0
            && self.frame_now - self.ext_last_frame > self.clock.sample_rate() as u64 / 2
        {
            self.ext_running = false;
        }

        // Follow engage/disengage edges (design §7 Phase 3).
        let following = self.follow_active();
        if following && !self.was_following {
            // Close the internal clock session; schwung's transport service
            // switches to Move's clock.
            if self.emitting_clock {
                self.emitting_clock = false;
                out.push(OutEvent::Stop);
            }
            self.resume_anchor_pending = false;
            if !self.ext_base_set {
                // Joined an already-running Move: launch-quantize to Move's
                // next bar so we start on the downbeat (0xFA anchors base 0
                // itself). 96 ext ticks = one 4/4 bar at 24 PPQN.
                self.ext_base = (self.ext_ticks / 96 + 1) * 96;
                self.ext_base_set = true;
                self.start_transport();
            }
        } else if !following && self.was_following {
            // Move stopped (or we did): resume the internal accumulator from
            // the current position; re-anchor emission at our next bar.
            self.clock.reset();
            self.clock.tick = self.master_tick;
            self.ext_base_set = false;
            if self.playing {
                self.resume_anchor_pending = true;
            }
        }
        self.was_following = following;

        let fired: u64 = if following {
            // Playhead target from Move's ticks: 24 → 96 PPQN, plus a
            // block-interpolated fraction, clamped to one beat per block.
            let mut abs = self.ext_ticks * 4;
            if self.ext_interval > 0.0 {
                let frac =
                    ((self.frame_now - self.ext_last_frame) as f64 / self.ext_interval).min(1.0);
                abs += (frac * 4.0) as u64;
            }
            abs.saturating_sub(self.ext_base * 4)
                .saturating_sub(self.master_tick)
                .min(96)
        } else {
            self.clock.advance(frames) as u64
        };

        // Internal transport edges (play/stop arrive via commands between
        // blocks) so Start/Stop always pair correctly. Suppressed while
        // following — a revert re-anchors at the bar boundary in the loop.
        if self.playing && !self.emitting_clock && !following && !self.resume_anchor_pending {
            self.emitting_clock = true;
            out.push(OutEvent::Start);
        } else if !self.playing && self.emitting_clock {
            self.emitting_clock = false;
            out.push(OutEvent::Stop);
        }
        if !self.playing {
            return;
        }
        for _ in 0..fired {
            // After reverting to internal clock, re-open the session (0xFA)
            // at movy's own next bar boundary so LFOs re-lock to our grid.
            if self.resume_anchor_pending
                && !following
                && self.master_tick % crate::TICKS_PER_BAR as u64 == 0
            {
                self.resume_anchor_pending = false;
                self.emitting_clock = true;
                out.push(OutEvent::Start);
            }
            // 96-PPQN master clock -> 24-PPQN MIDI clock, emitted before the
            // tick is serviced so 0xF8 aligns with that tick's notes. Silent
            // while following (Move's clock drives the slots instead).
            if self.emitting_clock && !following && self.master_tick % 4 == 0 {
                out.push(OutEvent::Clock);
            }
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
                    // Stale per-pass flags from an earlier playing pass would
                    // silence the first bar of the take we just launched.
                    t.clips[slot].release_pass_flags();
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
                    let (snum, sden) = (
                        self.tracks[ti].clips[slot].scale_num,
                        self.tracks[ti].clips[slot].scale_den,
                    );
                    let quant = self.tracks[ti].clips[slot].quant.min(100) as i64;
                    let clip_end = self.tracks[ti].clips[slot].loop_end_ticks();
                    let clip_span = self.tracks[ti].clips[slot].length_ticks().max(1);
                    // Per-tick decision cache: (note.step, governing-lane) -> play?
                    // so a chord on one trig shares a single condition+probability
                    // decision (all notes play or all skip). Few notes fire per
                    // tick, so a small Vec scan is cheap.
                    let mut decided: Vec<((u16, Option<u8>), bool)> = Vec::new();
                    for ni in 0..len {
                        let n = self.tracks[ti].clips[slot].notes[ni];
                        // Non-destructive quantization scales how far a note
                        // sits from its `step` anchor: full strength lands it
                        // on the grid (what the old destructive quantize did),
                        // zero leaves the tick that was played. Swing is added
                        // at full weight either way — it is a groove control,
                        // not a quantization one, and scaling it here would
                        // silently disable the SWING knob for programmed
                        // patterns, which sit exactly on the anchor.
                        let anchor = n.step as u32 * TICKS_PER_STEP;
                        let dev = n.tick as i64 - anchor as i64;
                        let half = if dev >= 0 { 50 } else { -50 };
                        let pulled = dev - (dev * quant + half) / 100;
                        let mut fire_tick = (anchor as i64 + pulled
                            + self.swing_delay(n.step, snum, sden) as i64)
                            .max(0) as u32;
                        // A note played just before a bar line anchors to the
                        // next bar's downbeat, which at full strength lands on
                        // the loop end — i.e. the loop start. Interpolating
                        // toward the UNwrapped target and wrapping the result
                        // keeps partial strengths from sweeping the note
                        // backwards through the whole bar.
                        if fire_tick >= clip_end {
                            fire_tick -= clip_span;
                        }
                        if fire_tick != pos || n.suppress || n.fired {
                            continue;
                        }
                        // Claimed before the trig decision: a note that rolls
                        // "skip" has still had its turn this pass.
                        self.tracks[ti].clips[slot].notes[ni].fired = true;
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
                        let emit_pitch =
                            (n.pitch as i32 + self.clip_transpose(ti, slot)).clamp(0, 127) as u8;
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
                        self.tracks[ti].clips[slot].release_pass_flags();
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

    /// Serialize the whole persistent state for the undo ring. Same bytes the
    /// autosave uses, so one format serves both and cannot drift.
    pub fn undo_snapshot(&self) -> String {
        crate::persist::serialize(self)
    }

    /// Restore a snapshot **without stopping the music**.
    ///
    /// Transport is deliberately absent from the serialized format (see
    /// `persist.rs`), so `persist::load` clears the playing/queued slots on its
    /// way through. That is right for a set load and wrong for an undo: fixing
    /// a mistake mid-jam must not silence the tracks. So the fields `load`
    /// clobbers are carried across it by hand.
    ///
    /// `link_enabled` is restored to its **live** value, not the snapshot's:
    /// the transport link is not a musical edit and is excluded from undo.
    pub fn undo_restore(&mut self, blob: &str) -> bool {
        let live_link = self.link_enabled;
        let transport: Vec<(Option<usize>, Option<usize>, bool)> = self
            .tracks
            .iter()
            .map(|t| (t.playing_slot, t.queued_slot, t.pending_stop))
            .collect();

        if !crate::persist::load(self, blob) {
            return false;
        }

        self.link_enabled = live_link;
        for (t, (playing, queued, pending)) in self.tracks.iter_mut().zip(transport) {
            t.playing_slot = playing;
            t.queued_slot = queued;
            t.pending_stop = pending;
            /* A restore that shortens (or removes) the clip under the playhead
             * can leave pos_tick past its end, where the wrap test never fires
             * and the track plays silence forever. */
            let len = t.playing().map(|c| c.length_ticks()).unwrap_or(0);
            if len == 0 {
                t.pos_tick = 0;
            } else if t.pos_tick >= len {
                t.pos_tick %= len;
            }
        }
        /* The UI's autosave only writes when the engine reports dirty; without
         * this an undo is silently dropped at the next save. */
        self.dirty = true;
        true
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
            "play={} tick={} bpm={} ext={} link={} trk={} step={} pos={} len={} lstart={} rec={} cin={} metro={} dirty={} sess={} act={} mute={} hlen={} hnotes={} occ={} alanes={:02x} aauto={:02x} hauto={} hvel={} hgate={} hgmix={} hprob={} hcond={}:{} hinv={} hlmax={} swing={} csc={}/{} ctr={} cap={}.{}",
            self.playing as u8,
            self.master_tick,
            self.clock.bpm_x100(),
            self.follow_active() as u8,
            self.link_enabled as u8,
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
            self.capture.pending(self.watch_track as u8),
            self.capture_gen,
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

    /// 125 BPM at 24 PPQN / 44100 Hz = exactly 882 frames per external tick.
    const EXT_TICK_FRAMES: u32 = 882;

    /// Feed `n` external ticks with real frame spacing.
    fn run_ext_ticks(e: &mut Engine, n: u32, out: &mut Vec<OutEvent>) {
        for _ in 0..n {
            let mut left = EXT_TICK_FRAMES;
            while left > 0 {
                let step = left.min(FRAMES);
                e.advance_block(step, out);
                left -= step;
            }
            e.on_external_realtime(0xF8, out);
        }
    }

    /* ── undo restore ─────────────────────────────────────────────────────
     * The point of these is that undo does NOT behave like a set load. The
     * shared serialization makes the content half trivially right; what has to
     * be proven is everything persist::load deliberately throws away. */

    /// A playing engine with one 16-step clip of notes on track 0.
    fn playing_engine() -> Engine {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "tog 0 0 60 100;tog 0 4 62 100;clen 0 16", &mut out);
        apply_batch(&mut e, "play", &mut out);
        run_ticks(&mut e, 4);
        e
    }

    #[test]
    fn undo_restore_keeps_transport_running() {
        let mut e = playing_engine();
        let snap = e.undo_snapshot();
        let (playing, slot) = (e.playing, e.tracks[0].playing_slot);
        assert!(playing && slot.is_some(), "fixture must be playing");

        let mut out = Vec::new();
        apply_batch(&mut e, "tog 0 8 64 100", &mut out);
        assert!(e.undo_restore(&snap));

        assert!(e.playing, "undo stopped the transport");
        assert_eq!(e.tracks[0].playing_slot, slot, "undo dropped the playing slot");
    }

    #[test]
    fn undo_restore_keeps_link_setting() {
        let mut e = playing_engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "link 0", &mut out);
        let snap = e.undo_snapshot(); // snapshot taken with link OFF
        apply_batch(&mut e, "link 1", &mut out);

        assert!(e.undo_restore(&snap));
        assert!(e.link_enabled, "undo must not revert the transport link");
    }

    #[test]
    fn undo_restore_wraps_playhead_past_shortened_clip() {
        let mut e = playing_engine();
        let mut out = Vec::new();
        // Snapshot a SHORT clip, then grow it and park the playhead past the
        // short length. Restoring must pull the playhead back into range.
        apply_batch(&mut e, "clen 0 4", &mut out);
        let snap = e.undo_snapshot();
        apply_batch(&mut e, "clen 0 16", &mut out);
        e.tracks[0].pos_tick = TICKS_PER_STEP * 12;

        assert!(e.undo_restore(&snap));
        let len = e.tracks[0].playing().map(|c| c.length_ticks()).unwrap_or(0);
        assert!(len > 0, "clip should still exist");
        assert!(
            e.tracks[0].pos_tick < len,
            "playhead {} left past clip end {}",
            e.tracks[0].pos_tick,
            len
        );
    }

    #[test]
    fn undo_restore_sets_dirty() {
        let mut e = playing_engine();
        let snap = e.undo_snapshot();
        let mut out = Vec::new();
        apply_batch(&mut e, "tog 0 8 64 100", &mut out);
        e.dirty = false; // as if the autosave had just read `state`

        assert!(e.undo_restore(&snap));
        assert!(e.dirty, "an undone edit must still be persisted");
    }

    #[test]
    fn undo_restore_rejects_a_foreign_blob() {
        let mut e = playing_engine();
        assert!(!e.undo_restore("not-a-movy-blob\n"));
    }

    #[test]
    fn undo_restore_round_trips_content() {
        let mut e = playing_engine();
        let before = e.undo_snapshot();
        let mut out = Vec::new();
        apply_batch(&mut e, "tog 0 8 64 100;clipdel 0 0", &mut out);
        let after = e.undo_snapshot();
        assert_ne!(before, after, "the edit must have changed something");

        assert!(e.undo_restore(&before));
        assert_eq!(e.undo_snapshot(), before, "undo did not restore the state");
        assert!(e.undo_restore(&after));
        assert_eq!(e.undo_snapshot(), after, "redo did not restore the state");
    }

    #[test]
    fn ext_tempo_is_captured_into_engine_bpm() {
        let mut e = engine(); // 120.00 BPM internally
        let mut out = Vec::new();
        e.on_external_realtime(0xFA, &mut out);
        e.on_external_realtime(0xF8, &mut out); // anchor tick 0
        run_ext_ticks(&mut e, 24, &mut out);
        let bpm = e.clock.bpm_x100();
        assert!((12450..=12550).contains(&bpm), "captured {bpm}, want ~12500");
    }

    #[test]
    fn move_play_starts_movy_when_stopped() {
        // With the link ON, Move's Play starts movy (design §7 Phase 4).
        let mut e = engine();
        e.link_enabled = true;
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        let mut out = Vec::new();
        e.on_external_realtime(0xFA, &mut out);
        e.on_external_realtime(0xF8, &mut out);
        run_ext_ticks(&mut e, 8, &mut out);
        assert!(e.playing, "linked transport: Move Play starts movy");
        assert!(out.iter().any(|x| matches!(x, OutEvent::NoteOn { .. })));
        assert!(out.iter().all(|x| !matches!(x, OutEvent::MoveInject { .. })),
                "state-change never injects");
    }

    #[test]
    fn follow_locks_playhead_to_ext_ticks() {
        let mut e = engine();
        e.play();
        let mut out = Vec::new();
        e.on_external_realtime(0xFA, &mut out);
        e.on_external_realtime(0xF8, &mut out);
        run_ext_ticks(&mut e, 24, &mut out); // one external beat
        // 24 ext ticks × 4 = 96 master ticks, ± the interpolated tail.
        assert!((92..=100).contains(&e.master_tick), "master {}", e.master_tick);
    }

    #[test]
    fn no_internal_clock_emission_while_following() {
        let mut e = engine();
        e.play();
        let mut out = Vec::new();
        e.advance_block(FRAMES, &mut out); // internal Start fires first
        out.clear();
        e.on_external_realtime(0xFA, &mut out);
        e.on_external_realtime(0xF8, &mut out);
        run_ext_ticks(&mut e, 48, &mut out);
        let stops = out.iter().filter(|x| matches!(x, OutEvent::Stop)).count();
        assert_eq!(stops, 1, "internal session closed exactly once on engage");
        assert!(out.iter().all(|x| !matches!(x, OutEvent::Clock | OutEvent::Start)));
    }

    #[test]
    fn fa_reanchors_pattern_and_flushes_gates() {
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.play();
        // A toggled step's gate is TICKS_PER_STEP (24), so run only 10 ticks —
        // the note is still sounding when Move's FA re-anchors.
        let _ = run_ticks(&mut e, 10); // internal playback, gate open
        let mut out = Vec::new();
        e.on_external_realtime(0xFA, &mut out);
        assert!(out.contains(&OutEvent::NoteOff { track: 0, pitch: 60 }));
        assert_eq!(e.master_tick, 0);
        assert!(e.playing);
    }

    #[test]
    fn engaging_mid_song_waits_for_moves_next_bar() {
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        let mut out = Vec::new();
        // Move already running, unanchored, 10 ticks into wherever.
        e.on_external_realtime(0xF8, &mut out);
        run_ext_ticks(&mut e, 10, &mut out);
        e.play();
        // Up to the bar boundary (96 ext ticks) movy holds at 0…
        run_ext_ticks(&mut e, 40, &mut out);
        assert_eq!(e.master_tick, 0, "waits for Move's bar");
        // …then starts on the downbeat.
        run_ext_ticks(&mut e, 50, &mut out);
        assert!(e.master_tick > 0, "started after Move's bar boundary");
        assert!(out.iter().any(|x| matches!(x, OutEvent::NoteOn { .. })));
    }

    #[test]
    fn stale_ext_reverts_to_internal_with_bar_anchored_emission() {
        // Under the always-on link (design §7 Phase 4) an explicit 0xFC now
        // STOPS movy — only a *stale* clock (Move wedged, no 0xFC) is treated
        // as a glitch and reverts to internal-clock, keep-playing. This is the
        // former move_stop_reverts_… test, retargeted onto the staleness path
        // that now owns the revert behavior; its bar-anchored-emission
        // assertions are preserved.
        let mut e = engine();
        e.play();
        let mut out = Vec::new();
        e.on_external_realtime(0xFA, &mut out);
        e.on_external_realtime(0xF8, &mut out);
        run_ext_ticks(&mut e, 48, &mut out); // half a bar in (~192 master ticks)
        out.clear();
        let before = e.master_tick;
        // No 0xFC: Move's clock simply goes stale. Drive blocks directly, long
        // enough to cross the 0.5 s staleness window AND movy's next bar (384).
        let mut ev = Vec::new();
        for _ in 0..700 {
            e.advance_block(FRAMES, &mut ev);
        }
        assert!(e.master_tick > before, "keeps playing after Move's clock goes stale");
        // Start re-emitted exactly once, at our next bar boundary, then clocks.
        let starts = ev.iter().filter(|x| matches!(x, OutEvent::Start)).count();
        assert_eq!(starts, 1);
        assert!(ev.iter().any(|x| matches!(x, OutEvent::Clock)));
    }

    #[test]
    fn stale_ext_clock_reverts_like_a_stop() {
        let mut e = engine();
        e.play();
        let mut out = Vec::new();
        e.on_external_realtime(0xFA, &mut out);
        e.on_external_realtime(0xF8, &mut out);
        run_ext_ticks(&mut e, 24, &mut out);
        let frozen = e.master_tick;
        // 1 s of silence (> 0.5 s staleness) then internal blocks.
        let mut left = 44100u32;
        while left > 0 { let s = left.min(FRAMES); e.advance_block(s, &mut out); left -= s; }
        assert!(e.master_tick > frozen, "revived on internal clock");
    }

    // ── Phase 4: always-on bidirectional transport link (design §7 Phase 4) ──

    #[test]
    fn move_stop_stops_movy() {
        let mut e = engine();
        e.link_enabled = true;
        e.play();
        let mut out = Vec::new();
        e.on_external_realtime(0xFA, &mut out);
        run_ext_ticks(&mut e, 8, &mut out);
        e.on_external_realtime(0xFC, &mut out);
        assert!(!e.playing, "linked transport: Move Stop stops movy");
        assert!(out.iter().all(|x| !matches!(x, OutEvent::MoveInject { .. })));
    }

    #[test]
    fn movy_play_injects_and_waits_for_moves_fa() {
        let mut e = engine();
        e.link_enabled = true;
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        let mut out = Vec::new();
        e.request_play(&mut out);                 // Move not running
        assert!(!e.playing, "pending-start: silent until Move's FA");
        // Press + (after the release gap) release, from advance_block.
        e.advance_block(FRAMES, &mut out);
        assert!(out.iter().any(|x| matches!(x, OutEvent::MoveInject { val: 127 })));
        let mut left = 44100u32; // > release gap
        while left > 0 { let s = left.min(FRAMES); e.advance_block(s, &mut out); left -= s; }
        assert!(out.iter().any(|x| matches!(x, OutEvent::MoveInject { val: 0 })));
        // Move answers with FA -> movy starts.
        e.on_external_realtime(0xFA, &mut out);
        assert!(e.playing);
    }

    #[test]
    fn pending_start_times_out_to_internal_clock() {
        let mut e = engine();
        e.link_enabled = true;
        let mut out = Vec::new();
        e.request_play(&mut out);
        // 2 bars at 120 BPM = 4 s = 176400 frames; run 5 s.
        let mut left = 5 * 44100u32;
        while left > 0 { let s = left.min(FRAMES); e.advance_block(s, &mut out); left -= s; }
        assert!(e.playing, "timeout fallback: play internally if Move never starts");
        assert!(out.iter().any(|x| matches!(x, OutEvent::Start)), "internal clock session opened");
    }

    #[test]
    fn movy_stop_injects_when_move_running_and_cancels_pending() {
        let mut e = engine();
        e.link_enabled = true;
        let mut out = Vec::new();
        // Case A: playing + Move running -> stop injects a toggle.
        e.on_external_realtime(0xFA, &mut out);
        e.request_play(&mut out);                 // Move running: starts (quantized), no inject
        assert!(out.iter().all(|x| !matches!(x, OutEvent::MoveInject { .. })));
        e.request_stop(&mut out);
        e.advance_block(FRAMES, &mut out);
        assert!(!e.playing);
        assert!(out.iter().any(|x| matches!(x, OutEvent::MoveInject { val: 127 })));
        // Case B: cancel during pending-start toggles Move back.
        let mut e = engine();
        e.link_enabled = true;
        let mut out = Vec::new();
        e.request_play(&mut out);                 // pending, inject armed
        e.request_stop(&mut out);                 // cancel
        let mut left = 44100u32;
        while left > 0 { let s = left.min(FRAMES); e.advance_block(s, &mut out); left -= s; }
        assert!(!e.playing);
        let presses = out.iter().filter(|x| matches!(x, OutEvent::MoveInject { val: 127 })).count();
        assert_eq!(presses, 2, "start toggle + cancel toggle");
    }

    // ── Link toggle OFF (default): Phase 3 semantics, no Play/Stop propagation ──

    #[test]
    fn link_off_movy_play_starts_without_inject() {
        let mut e = engine(); // link_enabled defaults false
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        let mut out = Vec::new();
        e.request_play(&mut out);
        assert!(e.playing, "link off: Play starts movy immediately");
        e.advance_block(FRAMES, &mut out);
        assert!(out.iter().all(|x| !matches!(x, OutEvent::MoveInject { .. })),
                "link off: no MovePlay inject");
    }

    #[test]
    fn link_off_move_fa_does_not_start_movy() {
        // Phase 3 behavior retained while the link is off: Move's Play does not
        // start a stopped movy.
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        let mut out = Vec::new();
        e.on_external_realtime(0xFA, &mut out);
        run_ext_ticks(&mut e, 96, &mut out);
        assert_eq!(e.master_tick, 0);
        assert!(out.iter().all(|x| !matches!(x, OutEvent::NoteOn { .. })));
    }

    #[test]
    fn link_off_move_fc_keeps_movy_playing() {
        // Phase 3 revert-keeps-playing: with the link off, Move's Stop does not
        // stop movy (it reverts to the internal clock and keeps going).
        let mut e = engine();
        e.play();
        let mut out = Vec::new();
        e.on_external_realtime(0xFA, &mut out);
        e.on_external_realtime(0xF8, &mut out);
        run_ext_ticks(&mut e, 24, &mut out);
        e.on_external_realtime(0xFC, &mut out);
        assert!(e.playing, "link off: Move Stop leaves movy playing");
    }

    #[test]
    fn clock_emits_start_then_24ppqn_ticks() {
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.play();
        // One beat = 96 master ticks; expect 0xFA once, then 96/4 = 24 clocks.
        let ev = run_ticks(&mut e, 96);
        let starts = ev.iter().filter(|x| matches!(x, OutEvent::Start)).count();
        let clocks = ev.iter().filter(|x| matches!(x, OutEvent::Clock)).count();
        assert_eq!(starts, 1);
        assert_eq!(clocks, 24);
        // The anchor tick precedes the first note of the pattern.
        let first_clock = ev.iter().position(|x| matches!(x, OutEvent::Clock)).unwrap();
        let first_note = ev
            .iter()
            .position(|x| matches!(x, OutEvent::NoteOn { .. }))
            .unwrap();
        assert!(first_clock < first_note);
    }

    #[test]
    fn clock_stop_emits_stop_once_and_goes_silent() {
        let mut e = engine();
        e.play();
        let _ = run_ticks(&mut e, 8);
        let mut out = Vec::new();
        e.stop(&mut out);
        // Stop is edge-detected in advance_block, so run one more block.
        e.advance_block(FRAMES, &mut out);
        let stops = out.iter().filter(|x| matches!(x, OutEvent::Stop)).count();
        assert_eq!(stops, 1);
        out.clear();
        for _ in 0..50 {
            e.advance_block(FRAMES, &mut out);
        }
        assert!(out.iter().all(|x| !matches!(x, OutEvent::Clock | OutEvent::Start)));
    }

    #[test]
    fn clock_exact_count_across_many_blocks() {
        let mut e = engine();
        e.play();
        // 4 beats = 384 master ticks -> exactly 96 clocks regardless of
        // block-boundary alignment (integer accumulator guarantees this).
        let ev = run_ticks(&mut e, 384);
        let clocks = ev.iter().filter(|x| matches!(x, OutEvent::Clock)).count();
        assert_eq!(clocks, 96);
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
    fn swing_anchors_to_real_16ths_under_scale() {
        let mut e = engine();
        e.swing_pct = 80;
        // 1X: off-beats are the odd steps (unchanged behaviour).
        assert_eq!(e.swing_delay(0, 1, 1), 0);
        assert!(e.swing_delay(1, 1, 1) > 0);
        // 2X: steps are 32nds; only the real off-beat 16ths (2,6,10,…) swing.
        assert_eq!(e.swing_delay(0, 2, 1), 0); // on-beat 16th
        assert_eq!(e.swing_delay(1, 2, 1), 0); // 32nd, not a 16th
        assert!(e.swing_delay(2, 2, 1) > 0);   // off-beat 16th
        assert_eq!(e.swing_delay(4, 2, 1), 0); // on-beat 16th (4/2 even)
        assert!(e.swing_delay(6, 2, 1) > 0);
        // Magnitude scales to a real 16th (2 clip-steps at 2X).
        assert_eq!(e.swing_delay(2, 2, 1), e.swing_delay(1, 1, 1) * 2);
        // 1/2X: no clip-step lands on an off-beat 16th, so nothing swings.
        assert_eq!(e.swing_delay(1, 1, 2), 0);
        assert_eq!(e.swing_delay(2, 1, 2), 0);
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

    // A drum track's pitches are pad addresses, not notes: shifting them moves
    // the hit to a different voice (or off the pad range entirely, silencing
    // it). Clip transpose must be inert there — see the three sites below.
    #[test]
    fn drum_track_ignores_clip_transpose_on_emit() {
        let mut e = engine();
        e.set_track_drum(0, true);
        e.tracks[0].active_mut().set_loop(0, 16);
        e.tracks[0].active_mut().toggle_step(0, &[(36, 100)]); // kick pad
        e.tracks[0].active_mut().transpose = -12;
        e.play();
        let out = run_ticks(&mut e, 4);
        let on = out.iter().find_map(|x| match x {
            OutEvent::NoteOn { pitch, .. } => Some(*pitch),
            _ => None,
        });
        assert_eq!(on, Some(36)); // the kick, not 24
    }

    #[test]
    fn drum_track_gate_matches_untransposed_pitch() {
        let mut e = engine();
        e.set_track_drum(0, true);
        e.tracks[0].active_mut().set_loop(0, 16);
        e.tracks[0].active_mut().toggle_step(0, &[(36, 100)]);
        e.tracks[0].active_mut().transpose = -12;
        e.play();
        let out = run_ticks(&mut e, 4 + TICKS_PER_STEP as u64 * 2);
        let off = out.iter().find_map(|x| match x {
            OutEvent::NoteOff { pitch, .. } => Some(*pitch),
            _ => None,
        });
        assert_eq!(off, Some(36)); // note-off must close the voice that opened
    }

    #[test]
    fn drum_track_records_pad_pitch_verbatim() {
        let mut e = engine();
        e.set_track_drum(0, true);
        e.tracks[0].active_mut().set_loop(0, 16);
        e.tracks[0].active_mut().transpose = 5;
        e.play();
        e.toggle_record(0);
        e.live_note_on(0, 38, 100); // snare pad
        e.tracks[0].pos_tick += 4;
        e.live_note_off(0, 38);
        // No transpose is re-added at emit, so none may be subtracted here.
        assert_eq!(e.tracks[0].active().notes.last().unwrap().pitch, 38);
    }

    #[test]
    fn melodic_track_still_transposes_after_drum_guard() {
        let mut e = engine();
        e.set_track_drum(0, true);
        e.set_track_drum(0, false); // flips back when a melodic module loads
        e.tracks[0].active_mut().set_loop(0, 16);
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.tracks[0].active_mut().transpose = 12;
        e.play();
        let out = run_ticks(&mut e, 4);
        let on = out.iter().find_map(|x| match x {
            OutEvent::NoteOn { pitch, .. } => Some(*pitch),
            _ => None,
        });
        assert_eq!(on, Some(72));
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
        // Transport clock (Start/Clock) rides the stream now; the mute
        // guarantee is only about musical output.
        assert!(!ev.iter().any(|x| matches!(
            x,
            OutEvent::NoteOn { .. } | OutEvent::NoteOff { .. }
        )));
        assert!(e.tracks[0].pos_tick > 0);
    }

    #[test]
    fn mute_flushes_that_tracks_gates() {
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.tracks[1].active_mut().toggle_step(0, &[(64, 100)]);
        e.play();
        let ev = run_ticks(&mut e, 2); // note-ons fired, gates still open
        // Precondition: both tracks are actually playing, or the "untouched"
        // assertion below would pass vacuously.
        assert!(
            ev.iter().any(|x| matches!(x, OutEvent::NoteOn { track: 0, .. })),
            "track 0 must be sounding"
        );
        assert!(
            ev.iter().any(|x| matches!(x, OutEvent::NoteOn { track: 1, .. })),
            "track 1 must be sounding"
        );

        let mut out = Vec::new();
        apply_batch(&mut e, "mute 0 1", &mut out);
        assert!(
            out.contains(&OutEvent::NoteOff { track: 0, pitch: 60 }),
            "muting flushes that track's open gate immediately"
        );
        assert!(
            !out.iter().any(|x| matches!(x, OutEvent::NoteOff { track: 1, .. })),
            "other tracks' gates are untouched"
        );

        // The flushed gate is gone, so it must not emit a second off later.
        let after = run_ticks(&mut e, 48);
        assert!(
            !after.iter().any(|x| matches!(x, OutEvent::NoteOff { track: 0, pitch: 60 })),
            "flushed gate does not fire a duplicate note-off"
        );
    }

    #[test]
    fn unmute_emits_nothing() {
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.play();
        let _ = run_ticks(&mut e, 2);
        let mut out = Vec::new();
        apply_batch(&mut e, "mute 0 1", &mut out);
        out.clear();
        apply_batch(&mut e, "mute 0 0", &mut out);
        assert!(
            !out.iter().any(|x| matches!(x, OutEvent::NoteOff { .. })),
            "unmuting releases nothing"
        );
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
        // After stop, nothing plays. A single Stop transport event is emitted
        // on the play→stop edge; no musical events follow.
        let ev = run_ticks(&mut e, 50);
        assert!(!ev.iter().any(|x| matches!(
            x,
            OutEvent::NoteOn { .. } | OutEvent::NoteOff { .. }
        )));
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

    /// Play `n` eighth notes at `bpm` into the capture buffer, transport
    /// stopped. `ext` keeps an external clock alive across the take (it goes
    /// stale after 0.5 s of silence).
    fn play_take(e: &mut Engine, bpm: f64, n: usize, ext: bool) {
        let mut out = Vec::new();
        let step = (RATE as f64 * 60.0 / bpm / 2.0) as u32;
        for _ in 0..n {
            e.live_note_on(0, 60, 100);
            e.live_note_off(0, 60);
            // An external clock must arrive at a plausible 24 PPQN rate (here
            // 120 BPM): the engine reads its tempo from the tick interval.
            let chunk_size = if ext { RATE * 60 / (120 * 24) } else { RATE / 8 };
            let mut left = step;
            while left > 0 {
                let chunk = left.min(chunk_size);
                e.advance_block(chunk, &mut out);
                if ext {
                    e.on_external_realtime(0xF8, &mut out);
                }
                left -= chunk;
            }
        }
    }

    fn info_field(info: &str, key: &str) -> String {
        info.split_whitespace()
            .find_map(|kv| kv.strip_prefix(&format!("{key}=")))
            .unwrap_or("")
            .to_string()
    }

    #[test]
    fn a_long_take_keeps_only_the_last_few_bars() {
        // Playing without pause never leaves a gap, so nothing but the age
        // window bounds the take. Before it existed, a minute of noodling
        // captured as a 16-bar clip pinned at the note cap — nothing like the
        // phrase the player had just finished.
        let mut e = engine();
        play_take(&mut e, 120.0, 240, false); // 240 eighths at 120 BPM = 60 s
        assert!(e.capture_commit(0));
        let bars = e.tracks[0].active().length_steps / crate::STEPS_PER_BAR as u16;
        // The window bounds the take; the clip then rounds up to whole bars
        // around the last note's gate, so the window plus one bar is the ceiling.
        assert!(
            bars <= crate::capture::CAPTURE_MAX_BARS as u16 + 1,
            "captured {bars} bars of history; the window is {}",
            crate::capture::CAPTURE_MAX_BARS
        );
        assert!(bars >= 1, "the recent phrase is still there");
        assert!(
            e.tracks[0].active().notes.len() < 128,
            "no longer pinned at the note cap"
        );
    }

    #[test]
    fn stopped_capture_sets_the_tempo_and_rolls() {
        let mut e = engine();
        play_take(&mut e, 100.0, 16, false);
        assert!(e.capture_commit(0));
        assert_eq!(e.clock.bpm_x100(), 10000, "the detected tempo is applied");
        assert!(e.playing, "the take plays back immediately");
        assert_eq!(info_field(&e.capture_info(), "mode"), "sel");
        assert!(
            e.tracks[0].active().notes.iter().all(|n| !n.suppress),
            "a stopped capture is meant to be heard at once"
        );
    }

    #[test]
    fn selecting_another_candidate_retimes_the_take() {
        let mut e = engine();
        play_take(&mut e, 100.0, 16, false);
        assert!(e.capture_commit(0));
        let len_at_100 = e.tracks[0].active().length_steps;
        let notes_at_100 = e.tracks[0].active().notes.len();
        e.capture_select(2); // 200 BPM
        assert_eq!(e.clock.bpm_x100(), 20000);
        assert_eq!(
            e.tracks[0].active().notes.len(),
            notes_at_100,
            "re-derived, not appended"
        );
        assert!(
            e.tracks[0].active().length_steps > len_at_100,
            "same performance, twice as many bars"
        );
    }

    #[test]
    fn an_external_clock_fits_the_take_to_the_existing_tempo() {
        let mut e = engine();
        let mut out = Vec::new();
        e.on_external_realtime(0xFA, &mut out); // Move is clocking us
        play_take(&mut e, 100.0, 16, true);
        let before = e.clock.bpm_x100();
        assert!(e.capture_commit(0));
        assert_eq!(e.clock.bpm_x100(), before, "tempo is not ours to change");
        let info = e.capture_info();
        assert_eq!(info_field(&info, "mode"), "fix", "{info}");
        assert_eq!(info_field(&info, "why"), "ext", "{info}");
    }

    #[test]
    fn a_clip_with_notes_fits_rather_than_retempos() {
        let mut e = engine();
        let mut out = Vec::new();
        crate::command::apply_batch(&mut e, "tog 0 0 48 100", &mut out);
        play_take(&mut e, 100.0, 16, false);
        assert!(e.capture_commit(0));
        assert_eq!(e.clock.bpm_x100(), 12000);
        let info = e.capture_info();
        assert_eq!(info_field(&info, "why"), "notes", "{info}");
        assert!(
            e.tracks[0].active().notes.iter().any(|n| n.pitch == 48),
            "the overdub keeps what was already there"
        );
    }

    #[test]
    fn the_fit_picks_the_closest_candidate_so_the_stretch_is_minimal() {
        let mut e = engine(); // set runs at 120
        let mut out = Vec::new();
        e.on_external_realtime(0xFA, &mut out);
        play_take(&mut e, 58.0, 16, true); // played at half time
        assert!(e.capture_commit(0));
        // 116 is a candidate (double of 58) and only 3.4% from 120; fitting
        // through 58 itself would stretch the take by 107%.
        let info = e.capture_info();
        let permille: i32 = info_field(&info, "stretch").parse().unwrap();
        assert!(permille.abs() < 100, "minimal stretch, got {permille}‰ — {info}");
    }

    #[test]
    fn the_selector_owns_the_take_until_it_is_dismissed() {
        let mut e = engine();
        play_take(&mut e, 100.0, 16, false);
        assert!(e.capture_commit(0));
        e.live_note_on(0, 72, 100); // noodling while the overlay is up
        assert_eq!(e.capture_pending(0), 0, "the frozen take is not disturbed");
        e.capture_done();
        assert_eq!(info_field(&e.capture_info(), "mode"), "none");
        e.live_note_on(0, 72, 100);
        assert_eq!(e.capture_pending(0), 1, "buffering resumes once dismissed");
    }

    #[test]
    fn capture_overdubs_at_the_position_it_was_heard() {
        let mut e = engine();
        let mut out = Vec::new();
        crate::command::apply_batch(&mut e, "tog 0 4 60 100", &mut out); // clip has notes
        e.play();
        run_ticks(&mut e, 6 * TICKS_PER_STEP as u64);
        let at = e.tracks[0].pos_tick;
        e.live_note_on(0, 67, 100);
        e.live_note_off(0, 67);
        let before = e.tracks[0].active().notes.len();
        let len_before = e.tracks[0].active().length_steps;
        assert!(e.capture_commit(0));
        assert_eq!(e.tracks[0].active().notes.len(), before + 1);
        let n = *e.tracks[0].active().notes.last().unwrap();
        assert_eq!(n.pitch, 67);
        assert!(
            n.tick.abs_diff(at) <= TICKS_PER_STEP,
            "landed at {}, heard at {at}",
            n.tick
        );
        assert_eq!(
            e.tracks[0].active().length_steps,
            len_before,
            "an overdub keeps the clip's length"
        );
    }

    #[test]
    fn capture_into_an_empty_playing_clip_grows_it_to_whole_bars() {
        let mut e = engine();
        e.play();
        // A phrase that runs past one bar: 5 notes, one bar apart.
        for _ in 0..5 {
            e.live_note_on(0, 60, 100);
            e.live_note_off(0, 60);
            run_ticks(&mut e, crate::TICKS_PER_BAR as u64);
        }
        assert!(e.capture_commit(0));
        let len = e.tracks[0].active().length_steps;
        assert_eq!(len % crate::STEPS_PER_BAR as u16, 0, "whole bars, got {len}");
        assert!(len > crate::STEPS_PER_BAR as u16, "grew past one bar, got {len}");
    }

    #[test]
    fn capture_consumes_the_buffer() {
        let mut e = engine();
        e.play();
        e.live_note_on(0, 60, 100);
        e.live_note_off(0, 60);
        assert!(e.capture_commit(0));
        assert_eq!(e.capture_pending(0), 0);
        assert!(!e.capture_commit(0), "nothing left to capture");
    }

    #[test]
    fn capture_consumes_the_buffer_even_when_it_writes_nothing() {
        // Only note-offs buffered for this track: there is nothing to write, but
        // the press still has to leave the buffer empty or those orphans ride
        // along into whatever is played next.
        let mut e = engine();
        e.play();
        e.live_note_off(0, 60);
        assert!(!e.capture_commit(0), "nothing to write");
        assert!(e.capture.is_empty(), "but the buffer is consumed");
    }

    #[test]
    fn live_notes_buffer_for_capture_while_idle() {
        let mut e = engine();
        e.live_note_on(0, 60, 100);
        e.live_note_off(0, 60);
        assert_eq!(e.capture_pending(0), 1);
    }

    #[test]
    fn armed_input_is_not_buffered() {
        let mut e = engine();
        e.play();
        e.toggle_record(0); // punch-in: recording immediately, no count-in
        assert!(e.recording);
        e.live_note_on(0, 60, 100);
        assert_eq!(e.capture_pending(0), 0, "the record path owns armed input");
    }

    #[test]
    fn captured_notes_sound_in_the_pass_they_were_captured_in() {
        // Jam across the loop end and capture just after it: the notes played
        // before the wrap sit AHEAD of the playhead now, so they must sound this
        // time round. Writing them suppressed (which is right for live
        // recording, where you have only just played the note) made the take
        // silent until the next repeat.
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.tracks[0].active_mut().set_loop(0, 16);
        e.play();
        run_ticks(&mut e, 14 * TICKS_PER_STEP as u64);
        e.live_note_on(0, 67, 100);          // late in the bar
        e.live_note_off(0, 67);
        run_ticks(&mut e, 4 * TICKS_PER_STEP as u64);   // over the loop end
        assert!(e.capture_commit(0), "the pre-wrap phrase is still buffered");
        // Run to just before the next wrap: step 14 comes round inside this pass.
        let ev = run_ticks(&mut e, 13 * TICKS_PER_STEP as u64);
        assert!(
            ev.iter().any(|x| matches!(x, OutEvent::NoteOn { pitch: 67, .. })),
            "the captured note played in this pass, not the next one"
        );
    }

    #[test]
    fn an_empty_clip_captured_while_playing_launches_on_the_bar() {
        // Transport running, nothing in this clip yet: the take keeps the
        // transport's tempo and falls in on the bar like any other clip launch,
        // rather than starting wherever the playhead happened to be.
        let mut e = engine();
        e.play();
        let bpm = e.clock.bpm_x100();
        run_ticks(&mut e, 5 * TICKS_PER_STEP as u64);   // mid-bar
        e.live_note_on(0, 67, 100);
        e.live_note_off(0, 67);
        e.live_note_on(0, 69, 100);
        e.live_note_off(0, 69);
        assert!(e.capture_commit(0));
        assert_eq!(e.clock.bpm_x100(), bpm, "the transport's tempo is kept");
        let a = e.tracks[0].active_clip;
        assert_eq!(
            e.tracks[0].queued_slot, Some(a),
            "queued, not started mid-bar"
        );
        let first = e.tracks[0].active().notes.iter().map(|n| n.tick).min().unwrap();
        assert_eq!(
            first,
            e.tracks[0].active().loop_start_ticks() + 5 * TICKS_PER_STEP,
            "the take keeps the phase it was played at, not snapped to step 1"
        );
        // On the next bar the launch fires and the clip plays from its start.
        run_ticks(&mut e, crate::TICKS_PER_BAR as u64);
        assert_eq!(e.tracks[0].playing_slot, Some(a));
    }

    #[test]
    fn a_note_less_clip_that_is_already_the_playing_slot_still_launches_on_the_bar() {
        // The clip exists (it was created, or its notes were deleted) but holds
        // nothing, so it is already this track's playing slot and its playhead
        // is running. Without a re-launch the take lands wherever the playhead
        // had got to and never lines up with the bar.
        let mut e = engine();
        e.tracks[0].active_mut().ensure_exists();
        e.play();
        let bpm = e.clock.bpm_x100();
        run_ticks(&mut e, 5 * TICKS_PER_STEP as u64);   // mid-bar
        assert!(e.tracks[0].pos_tick > 0, "the playhead really is mid-bar");
        e.live_note_on(0, 67, 100);
        e.live_note_off(0, 67);
        assert!(e.capture_commit(0));
        assert_eq!(e.clock.bpm_x100(), bpm, "the transport's tempo is kept");
        let a = e.tracks[0].active_clip;
        assert_eq!(e.tracks[0].queued_slot, Some(a), "re-launched on the bar");
        let first = e.tracks[0].active().notes.iter().map(|n| n.tick).min().unwrap();
        assert_eq!(
            first,
            e.tracks[0].active().loop_start_ticks() + 5 * TICKS_PER_STEP,
            "the take keeps the phase it was played at, not snapped to step 1"
        );
    }

    #[test]
    fn capturing_into_a_selected_slot_launches_it() {
        // The slot you jammed over is the one you expect to hear afterwards,
        // even if the track was playing something else (or nothing).
        let mut e = engine();
        e.play();
        e.tracks[0].active_clip = 2;
        e.tracks[0].playing_slot = None;
        e.live_note_on(0, 60, 100);
        e.live_note_off(0, 60);
        assert!(e.capture_commit(0));
        assert_eq!(
            e.tracks[0].queued_slot, Some(2),
            "the captured slot is launched, bar-quantized like step entry"
        );
    }

    #[test]
    fn replaying_the_same_spot_next_time_round_drops_the_earlier_pass() {
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.tracks[0].active_mut().set_loop(0, 16);
        e.play();
        run_ticks(&mut e, 2 * TICKS_PER_STEP as u64);
        e.live_note_on(0, 67, 100);
        e.live_note_off(0, 67);
        assert_eq!(e.capture_pending(0), 1);
        // All the way round to the same spot, and play there again.
        run_ticks(&mut e, crate::TICKS_PER_BAR as u64);
        e.live_note_on(0, 69, 100);
        assert_eq!(
            e.capture_pending(0), 1,
            "the earlier pass over this spot went; only the new note is buffered"
        );
    }

    #[test]
    fn a_phrase_that_crosses_the_loop_end_survives() {
        // The old rule cleared at the wrap itself, which ate everything played
        // in the run-up to it — exactly the phrase you most want to keep.
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.tracks[0].active_mut().set_loop(0, 16);
        e.play();
        run_ticks(&mut e, 14 * TICKS_PER_STEP as u64);
        e.live_note_on(0, 67, 100);           // late in the bar
        e.live_note_off(0, 67);
        run_ticks(&mut e, 4 * TICKS_PER_STEP as u64);  // over the loop end
        e.live_note_on(0, 69, 100);           // early in the next bar
        e.live_note_off(0, 69);
        assert_eq!(e.capture_pending(0), 2, "both halves of the phrase are kept");
    }

    #[test]
    fn a_chord_does_not_clear_itself() {
        // Every note of a chord lands at one position in one pass; only an
        // earlier pass counts as "you played over that again".
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.tracks[0].active_mut().set_loop(0, 16);
        e.play();
        run_ticks(&mut e, 2 * TICKS_PER_STEP as u64);
        e.live_note_on(0, 60, 100);
        e.live_note_on(0, 64, 100);
        e.live_note_on(0, 67, 100);
        assert_eq!(e.capture_pending(0), 3, "the whole chord is buffered");
    }

    #[test]
    fn deliberate_editing_clears_the_buffer() {
        // Every gesture that means "I am building this clip on purpose" drops
        // the free playing that came before it, so a later Capture cannot drop
        // old notes into a clip that has since been edited by hand.
        let mut out = Vec::new();
        for op in [
            "rec 0", "tog 0 0 60 100", "del 0 0 15 -1", "quant 0", "clen 0 32",
            "dbl 0", "clipdel 0 0", "launch 0 1", "evel 0 0 0 -1 5", "aset 0 0 64",
        ] {
            let mut e = engine();
            e.live_note_on(0, 60, 100);
            assert_eq!(e.capture_pending(0), 1, "{op}: precondition");
            crate::command::apply_batch(&mut e, op, &mut out);
            assert_eq!(e.capture_pending(0), 0, "{op} left buffered input behind");
        }
    }

    #[test]
    fn housekeeping_traffic_does_not_clear_the_buffer() {
        // The UI emits these while you are only playing: a step-length query,
        // and the automation base syncs that follow any knob read or lane
        // allocation. Clearing on them wiped the buffer mid-phrase.
        let mut out = Vec::new();
        for op in ["hold 0 4", "hold 0 -1", "abase 0 0 64", "abaseq 0 0 64", "alabel 0 0 x:y"] {
            let mut e = engine();
            e.live_note_on(0, 60, 100);
            crate::command::apply_batch(&mut e, op, &mut out);
            assert_eq!(e.capture_pending(0), 1, "{op} threw away live input");
        }
    }

    #[test]
    fn playing_the_pads_does_not_clear_the_buffer() {
        // The inverse of the rule above: the input itself must survive, or
        // nothing would ever be capturable.
        let mut e = engine();
        let mut out = Vec::new();
        crate::command::apply_batch(&mut e, "non 0 60 100;nof 0 60;non 0 64 100", &mut out);
        assert_eq!(e.capture_pending(0), 2);
    }

    #[test]
    fn transport_edges_and_track_select_clear_the_buffer() {
        let mut e = engine();
        let mut out = Vec::new();
        e.live_note_on(0, 60, 100);
        e.play();
        assert_eq!(e.capture_pending(0), 0, "starting clears");
        e.live_note_on(0, 60, 100);
        e.stop(&mut out);
        assert_eq!(e.capture_pending(0), 0, "stopping clears");
        e.live_note_on(0, 60, 100);
        crate::command::apply_batch(&mut e, "watch 1", &mut out);
        assert_eq!(e.capture_pending(0), 0, "a track button clears");
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

    /// Clip-position tick at which pitch 60 fires. Same technique as
    /// `swing_delays_offbeat_steps_only`: 8-frame blocks so at most one tick
    /// elapses per block, and status `tick=` is post-increment, so the note
    /// fired while pos was (tick - 1).
    fn quant_fire_tick(step: u16, nudge: i32, quant: u8, swing: u32) -> u64 {
        let mut e = Engine::new(44100, 12000);
        e.swing_pct = swing;
        e.tracks[0].active_mut().toggle_step(step, &[(60, 100)]);
        e.tracks[0].active_mut().nudge(step, step, None, nudge);
        e.tracks[0].active_mut().quant = quant;
        e.play();
        let mut out = Vec::new();
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
        panic!("note never fired (quant {quant})");
    }

    #[test]
    fn quant_100_snaps_to_grid() {
        assert_eq!(quant_fire_tick(2, 7, 100, 50), (2 * TICKS_PER_STEP) as u64);
    }

    #[test]
    fn quant_0_plays_raw_timing() {
        assert_eq!(quant_fire_tick(2, 7, 0, 50), (2 * TICKS_PER_STEP + 7) as u64);
    }

    #[test]
    fn quant_scales_deviation_and_leaves_swing_alone() {
        // Swing is a groove control, not a quantization one. Scaling it with
        // strength would make the SWING knob inert for programmed patterns,
        // which sit exactly on the anchor and so have no deviation to scale.
        let swing = (66 - 50) * TICKS_PER_STEP / 60;   // 6 ticks on an off-beat 16th
        assert_eq!(quant_fire_tick(1, 5, 0, 66), (TICKS_PER_STEP + 5 + swing) as u64);
        assert_eq!(quant_fire_tick(1, 5, 100, 66), (TICKS_PER_STEP + swing) as u64);
        assert_eq!(quant_fire_tick(1, 5, 60, 66), (TICKS_PER_STEP + 2 + swing) as u64);
    }

    #[test]
    fn quant_50_lands_midway_toward_grid() {
        assert_eq!(quant_fire_tick(2, 8, 50, 50), (2 * TICKS_PER_STEP + 4) as u64);
    }

    #[test]
    fn quant_pulls_early_note_forward() {
        // Rounding has to work in both directions: a note before its anchor
        // moves later as strength rises.
        assert_eq!(quant_fire_tick(2, -8, 50, 50), (2 * TICKS_PER_STEP - 4) as u64);
    }

    #[test]
    fn quant_change_mid_pass_does_not_double_trigger() {
        // The note sounds quantized at step 2; dropping strength moves its
        // target later within the same pass. Without `fired` it sounds twice.
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(2, &[(60, 100)]);
        e.tracks[0].active_mut().nudge(2, 2, None, 9);
        e.tracks[0].active_mut().quant = 100;
        e.play();
        let mut out = Vec::new();
        while e.clock.tick <= (2 * TICKS_PER_STEP + 3) as u64 {
            e.advance_block(8, &mut out);
        }
        e.tracks[0].active_mut().quant = 0;
        while e.clock.tick <= (3 * TICKS_PER_STEP) as u64 {
            e.advance_block(8, &mut out);
        }
        let ons = out.iter()
            .filter(|ev| matches!(ev, OutEvent::NoteOn { pitch: 60, .. }))
            .count();
        assert_eq!(ons, 1, "the note had already sounded this pass");
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
