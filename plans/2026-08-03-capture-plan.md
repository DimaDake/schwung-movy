# Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retroactive note capture in movy — play the pads freely, press Capture, and keep what you just played as clip data, with a jog-driven tempo selector when the tempo is movy's to set.

**Architecture:** The Rust engine (`seq-core`) owns a rolling ring of live pad notes stamped with `frame_now`, a from-scratch onset-vs-grid tempo estimator, and the commit that writes a frozen take into a clip. The TypeScript UI owns the Capture button, the LED, and a full-screen overlay that reads a single new `status` field plus an on-demand `capinfo` string. Spec: `plans/2026-08-03-capture-design.md`.

**Tech Stack:** Rust (seq-core, host-tested with `cargo test`), TypeScript → `ui.js` (esbuild), node browser-test harness (`logic.mjs`, `screenshot.mjs`, `perf.mjs`), device e2e shell scripts.

## Global Constraints

- **No davebox code may be copied.** `schwung-davebox` is PolyForm Noncommercial 1.0.0 (*Required Notice: Copyright (c) 2026 Josh Gaines*); movy is MIT. Approach may be shared, expression may not — write the estimator from scratch with its own weights. Credit davebox as prior art in `CHANGELOG.md` only, worded so it does not imply code reuse.
- **File size:** hard limit 200 lines, target 50–100. Split rather than exceed.
- **Comments explain WHY**, never what the code literally does.
- **`ENGINE_VERSION` must match** between `engine/crates/movy-dsp/src/lib.rs` and `src/seq/constants.ts` — currently `0.28.0`, becomes `0.29.0` in Task 3 (both files, one commit).
- **Engine is allocation-averse on the audio thread**: the capture ring and the frozen take are `Vec`s allocated once in `Engine::new` with fixed capacity and never grown.
- **Prove every new test has teeth**: remove the fix, watch it fail, put it back.
- **Local test order** at the end of each task: `npm run build:browser`, then `node browser-test/logic.mjs`, `dump-replay.mjs`, `app-loop.mjs`, `screenshot.mjs`, `perf.mjs`; `(cd engine && cargo test)` for engine tasks. Cargo lives at `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin`.
- **Commit after every task**; never `git add -A`.

---

### Task 1: Capture ring

**Files:**
- Create: `engine/crates/seq-core/src/capture.rs`
- Modify: `engine/crates/seq-core/src/lib.rs` (add `pub mod capture;`)
- Modify: `engine/crates/seq-core/src/engine.rs` (field, `Engine::new`, `live_note_on`, `live_note_off`, `play`, `stop`, `watch` clear point)
- Test: inline `#[cfg(test)]` in `capture.rs` and `engine.rs`

**Interfaces:**
- Produces: `CapEvent { frame: u64, abs_tick: u32, clip_tick: u32, track: u8, on: bool, pitch: u8, vel: u8 }`; `CaptureRing::new()`, `push(&mut self, ev: CapEvent, gap_frames: u64)`, `clear(&mut self)`, `pending(&self, track: u8) -> usize`, `iter(&self) -> impl Iterator<Item = &CapEvent>`, `const CAP_MAX_EVENTS: usize = 512`.

- [ ] **Step 1: Write the failing tests in `capture.rs`**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn ev(frame: u64, track: u8, on: bool, pitch: u8) -> CapEvent {
        CapEvent { frame, abs_tick: 0, clip_tick: 0, track, on, pitch, vel: 100 }
    }

    #[test]
    fn pending_counts_note_ons_for_one_track() {
        let mut r = CaptureRing::new();
        r.push(ev(0, 0, true, 60), 1000);
        r.push(ev(10, 0, false, 60), 1000);
        r.push(ev(20, 1, true, 62), 1000);
        assert_eq!(r.pending(0), 1);
        assert_eq!(r.pending(1), 1);
        assert_eq!(r.pending(2), 0);
    }

    #[test]
    fn silence_longer_than_the_gap_starts_a_new_take() {
        let mut r = CaptureRing::new();
        r.push(ev(0, 0, true, 60), 1000);
        r.push(ev(500, 0, true, 62), 1000);
        assert_eq!(r.pending(0), 2);
        r.push(ev(2000, 0, true, 64), 1000); // 1500 frames of silence > gap
        assert_eq!(r.pending(0), 1, "stale input dropped, fresh take begins");
    }

    #[test]
    fn overflow_drops_the_oldest_event() {
        let mut r = CaptureRing::new();
        for i in 0..(CAP_MAX_EVENTS as u64 + 10) {
            r.push(ev(i, 0, true, 60), u64::MAX);
        }
        assert_eq!(r.len(), CAP_MAX_EVENTS);
        assert_eq!(r.iter().next().unwrap().frame, 10, "oldest 10 dropped");
    }

    #[test]
    fn clear_empties_the_ring() {
        let mut r = CaptureRing::new();
        r.push(ev(0, 0, true, 60), 1000);
        r.clear();
        assert_eq!(r.pending(0), 0);
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd engine && cargo test -p seq-core capture`
Expected: FAIL — `unresolved module` / `CaptureRing not found`.

- [ ] **Step 3: Implement `capture.rs`**

```rust
//! Retroactive capture: a rolling ring of live pad input, kept whether or not
//! the transport runs, so Capture can turn what was just played into clip data
//! (Move manual §14.3). Transient — never serialized.

/// Fixed ring capacity. Notes only (no CC), so one phrase is ~2 events per
/// note; 512 covers far more than the gap timer will ever keep alive.
pub const CAP_MAX_EVENTS: usize = 512;

#[derive(Clone, Copy)]
pub struct CapEvent {
    /// Monotonic audio-frame stamp — the only clock that runs while stopped.
    pub frame: u64,
    /// Absolute master tick at arrival (overdub placement while playing).
    pub abs_tick: u32,
    /// The track's playhead position within its clip at arrival.
    pub clip_tick: u32,
    pub track: u8,
    pub on: bool,
    pub pitch: u8,
    pub vel: u8,
}

pub struct CaptureRing {
    events: Vec<CapEvent>,
    head: usize,
    len: usize,
    last_frame: u64,
}

impl CaptureRing {
    pub fn new() -> Self {
        CaptureRing {
            events: Vec::with_capacity(CAP_MAX_EVENTS),
            head: 0,
            len: 0,
            last_frame: 0,
        }
    }

    pub fn len(&self) -> usize { self.len }
    pub fn is_empty(&self) -> bool { self.len == 0 }

    pub fn clear(&mut self) {
        self.head = 0;
        self.len = 0;
    }

    /// Append one event. `gap_frames` of silence since the last one means the
    /// buffered input is stale — it belongs to a phrase the player has already
    /// moved on from, so it is dropped rather than glued onto the new take.
    pub fn push(&mut self, ev: CapEvent, gap_frames: u64) {
        if self.len > 0 && ev.frame.saturating_sub(self.last_frame) > gap_frames {
            self.clear();
        }
        self.last_frame = ev.frame;
        if self.events.len() < CAP_MAX_EVENTS {
            self.events.push(ev);
            self.len += 1;
            return;
        }
        let slot = (self.head + self.len) % CAP_MAX_EVENTS;
        self.events[slot] = ev;
        if self.len == CAP_MAX_EVENTS {
            self.head = (self.head + 1) % CAP_MAX_EVENTS;
        } else {
            self.len += 1;
        }
    }

    pub fn iter(&self) -> impl Iterator<Item = &CapEvent> {
        (0..self.len).map(move |i| &self.events[(self.head + i) % CAP_MAX_EVENTS])
    }

    /// Note-ons buffered for one track — drives the Capture LED and the
    /// "nothing to capture" guard.
    pub fn pending(&self, track: u8) -> usize {
        self.iter().filter(|e| e.track == track && e.on).count()
    }
}
```

Note the `push` growth path: the `Vec` fills to capacity once on the first 512 events and is indexed in place forever after — no reallocation on the audio thread.

- [ ] **Step 4: Run to verify it passes**

Run: `cd engine && cargo test -p seq-core capture`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire it into `Engine`**

In `lib.rs` add `pub mod capture;`. In `engine.rs`:

```rust
use crate::capture::{CapEvent, CaptureRing};
```

Add the field next to `rec_pending` (it is the same family of state):

```rust
    /// Retroactive capture input (Move manual §14.3). Runtime-only.
    capture: CaptureRing,
```

Initialize in `Engine::new` with `capture: CaptureRing::new(),`.

Add the gap helper and the push, next to `live_note_on`:

```rust
    /// Silence after which buffered input is a finished phrase rather than the
    /// take in progress: two bars, but never so short that a slow ballad
    /// self-clears mid-phrase nor so long that a jam from minutes ago returns.
    fn capture_gap_frames(&self) -> u64 {
        let sr = self.clock.sample_rate() as u64;
        let bar = sr * 60 * 4 * 100 / self.clock.bpm_x100().max(1) as u64;
        (2 * bar).clamp(2 * sr, 8 * sr)
    }

    /// Buffer a live pad note for a later Capture. Armed input is excluded —
    /// the record path is already writing it, and a count-in belongs to the
    /// take about to be recorded.
    fn capture_push(&mut self, track: usize, pitch: u8, vel: u8, on: bool) {
        if track >= NUM_TRACKS { return; }
        if self.count_in_left > 0 { return; }
        if self.recording && track == self.rec_track { return; }
        let gap = self.capture_gap_frames();
        let ev = CapEvent {
            frame: self.frame_now,
            abs_tick: self.master_tick as u32,
            clip_tick: self.tracks[track].pos_tick,
            track: track as u8,
            on,
            pitch,
            vel,
        };
        self.capture.push(ev, gap);
    }
```

Call it at the top of `live_note_on` (`self.capture_push(track, pitch, vel, true);`) and `live_note_off` (`self.capture_push(track, pitch, 0, false);`), before their existing recording guards.

Clear the ring in `play()`, in `stop()`, and in the `watch` command arm (`command.rs`) via a new `pub fn capture_clear(&mut self) { self.capture.clear(); }`.

- [ ] **Step 6: Write the engine-level tests**

Add to `engine.rs` tests:

```rust
    #[test]
    fn live_notes_buffer_for_capture_while_idle() {
        let mut e = Engine::new(44100, 12000);
        e.live_note_on(0, 60, 100);
        e.live_note_off(0, 60);
        assert_eq!(e.capture_pending(0), 1);
    }

    #[test]
    fn armed_input_is_not_buffered() {
        let mut e = Engine::new(44100, 12000);
        let mut out = Vec::new();
        e.play(&mut out);
        e.toggle_record(0);            // playing → punch-in, recording now
        e.live_note_on(0, 60, 100);
        assert_eq!(e.capture_pending(0), 0, "the record path owns armed input");
    }

    #[test]
    fn transport_edges_and_track_select_clear_the_buffer() {
        let mut e = Engine::new(44100, 12000);
        let mut out = Vec::new();
        e.live_note_on(0, 60, 100);
        e.play(&mut out);
        assert_eq!(e.capture_pending(0), 0);
        e.live_note_on(0, 60, 100);
        e.stop(&mut out);
        assert_eq!(e.capture_pending(0), 0);
        e.live_note_on(0, 60, 100);
        apply_batch(&mut e, "watch 1", &mut out);
        assert_eq!(e.capture_pending(0), 0);
    }
```

Add the accessor `pub fn capture_pending(&self, track: usize) -> usize { self.capture.pending(track as u8) }`.

- [ ] **Step 7: Run the engine suite**

Run: `cd engine && cargo test`
Expected: PASS, no regressions.

- [ ] **Step 8: Commit**

```bash
git add engine/crates/seq-core/src/capture.rs engine/crates/seq-core/src/lib.rs engine/crates/seq-core/src/engine.rs engine/crates/seq-core/src/command.rs plans/2026-08-03-capture-design.md plans/2026-08-03-capture-plan.md
git commit -m "Buffer live pad notes for capture"
```

---

### Task 2: Tempo estimator

**Files:**
- Modify: `engine/crates/seq-core/src/capture.rs` (add the estimator + tests)

**Interfaces:**
- Consumes: nothing from Task 1 beyond the module.
- Produces: `pub struct TempoGuess { pub cands: [u32; 3], pub best: usize, pub n: usize }` and `pub fn estimate_tempos(onsets: &[u64], span: u64, sample_rate: u32) -> Option<TempoGuess>` — `onsets` are frame stamps relative to the first note, `span` the take's full frame duration. `None` when there is not enough rhythm (fewer than 3 onsets).

- [ ] **Step 1: Write the failing tests**

```rust
    /// Onsets for `beats` eighth-notes at `bpm`, in frames.
    fn eighths(bpm: f64, beats: usize, sr: u32) -> Vec<u64> {
        let fpb = sr as f64 * 60.0 / bpm;
        (0..beats).map(|i| (i as f64 * fpb / 2.0) as u64).collect()
    }

    #[test]
    fn recovers_the_played_tempo() {
        let on = eighths(100.0, 16, 44100);
        let g = estimate_tempos(&on, *on.last().unwrap(), 44100).unwrap();
        assert_eq!(g.cands[g.best], 100);
    }

    #[test]
    fn offers_the_half_and_double_time_partners() {
        let on = eighths(100.0, 16, 44100);
        let g = estimate_tempos(&on, *on.last().unwrap(), 44100).unwrap();
        assert_eq!(g.n, 3);
        assert_eq!(g.cands, [50, 100, 200], "ascending, partners included");
    }

    #[test]
    fn candidates_stay_inside_the_dial_range_and_stay_full() {
        // 240 doubles to 480 (out of range) — the third slot must be backfilled,
        // never left empty, so the selector always has something to scroll.
        let on = eighths(240.0, 16, 44100);
        let g = estimate_tempos(&on, *on.last().unwrap(), 44100).unwrap();
        assert_eq!(g.n, 3);
        assert!(g.cands.iter().all(|&b| (40..=250).contains(&b)));
        assert!(g.cands.windows(2).all(|w| w[0] < w[1]), "ascending, no dupes");
    }

    #[test]
    fn two_notes_are_not_a_tempo() {
        assert!(estimate_tempos(&[0, 22050], 22050, 44100).is_none());
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd engine && cargo test -p seq-core capture`
Expected: FAIL — `estimate_tempos` not found.

- [ ] **Step 3: Implement the estimator**

```rust
/// Candidate-tempo search range. Matches the tempo the Set page will accept, so
/// Capture never suggests a BPM the user cannot then dial by hand.
const BPM_MIN: u32 = 40;
const BPM_MAX: u32 = 250;

pub struct TempoGuess {
    /// Ascending, always `n` entries filled from index 0.
    pub cands: [u32; 3],
    /// Index into `cands` of the best-scoring tempo.
    pub best: usize,
    pub n: usize,
}

/// Score how well `onsets` (frames, relative to the first note) sit on a 1/16
/// grid at each integer BPM, and return the three tempos worth offering.
///
/// Grid fit alone cannot pick a winner: evenly spaced input fits a whole family
/// of tempos exactly (120 in quarters is 90 in dotted eighths is 160 in
/// triplets), so two weak tie-breakers decide between them — whether the take
/// spans a whole number of bars, and how far the tempo is from a comfortable
/// 120. Both are small enough that a genuinely better grid fit always wins.
pub fn estimate_tempos(onsets: &[u64], span: u64, sample_rate: u32) -> Option<TempoGuess> {
    if onsets.len() < 3 { return None; }
    let sr = sample_rate as f64;
    let span = span.max(1) as f64;

    let score_at = |bpm: u32| -> f64 {
        let fpb = sr * 60.0 / bpm as f64;
        let fit = onsets
            .iter()
            .map(|&o| {
                let beats = o as f64 / fpb;
                (beats - (beats * 4.0).round() / 4.0).abs()
            })
            .sum::<f64>()
            / onsets.len() as f64;
        let bars = span / fpb / 4.0;
        let bar_err = (bars - bars.round()).abs();
        let octave = (bpm as f64 / 120.0).ln().abs();
        fit + 0.02 * bar_err + 0.02 * octave
    };

    let scores: Vec<f64> = (BPM_MIN..=BPM_MAX).map(score_at).collect();

    // Local minima, best first. Tempos within 5% of one another are the same
    // tempo heard twice, so only the better of the pair survives.
    let mut minima: Vec<(u32, f64)> = Vec::new();
    for (i, &s) in scores.iter().enumerate() {
        let lo = i == 0 || scores[i - 1] >= s;
        let hi = i + 1 == scores.len() || scores[i + 1] > s;
        if lo && hi { minima.push((BPM_MIN + i as u32, s)); }
    }
    minima.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
    let mut distinct: Vec<u32> = Vec::new();
    for (bpm, _) in minima {
        if distinct.iter().all(|&d| ratio(d, bpm) >= 1.05) { distinct.push(bpm); }
    }
    let best_bpm = *distinct.first()?;

    // The half- and double-time readings of the winner are what a player
    // actually reaches for; offer them before any lesser local minimum.
    let mut picked = vec![best_bpm];
    for partner in [best_bpm / 2, best_bpm * 2] {
        if (BPM_MIN..=BPM_MAX).contains(&partner)
            && picked.iter().all(|&p| ratio(p, partner) >= 1.05)
        {
            picked.push(partner);
        }
    }
    for &d in &distinct {
        if picked.len() >= 3 { break; }
        if picked.iter().all(|&p| ratio(p, d) >= 1.05) { picked.push(d); }
    }

    let n = picked.len().min(3);
    picked.truncate(n);
    picked.sort_unstable();
    let mut cands = [0u32; 3];
    cands[..n].copy_from_slice(&picked);
    let best = picked.iter().position(|&b| b == best_bpm).unwrap_or(0);
    Some(TempoGuess { cands, best, n })
}

fn ratio(a: u32, b: u32) -> f64 {
    let (a, b) = (a as f64, b as f64);
    if a > b { a / b } else { b / a }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd engine && cargo test -p seq-core capture`
Expected: PASS. If `recovers_the_played_tempo` lands on a partner instead of 100, adjust the octave weight (0.02) — not the test — and record why in the comment.

- [ ] **Step 5: Commit**

```bash
git add engine/crates/seq-core/src/capture.rs
git commit -m "Estimate a take's tempo from how its onsets fit the grid"
```

---

### Task 3: Commit while the transport runs

**Files:**
- Modify: `engine/crates/seq-core/src/engine.rs` (`capture_commit`, status field)
- Modify: `engine/crates/seq-core/src/command.rs` (`cap`, `capclr`)
- Modify: `engine/crates/movy-dsp/src/lib.rs` (`ENGINE_VERSION`)
- Modify: `src/seq/constants.ts` (`ENGINE_VERSION`)

**Interfaces:**
- Consumes: `CaptureRing`, `Engine::capture_pending` (Task 1).
- Produces: `pub fn capture_commit(&mut self, track: usize) -> bool`; commands `cap <t>` and `capclr <t>`; status field `cap=<pending>.<gen>`.

- [ ] **Step 1: Write the failing tests in `engine.rs`**

```rust
    #[test]
    fn capture_overdubs_at_the_position_it_was_heard() {
        let mut e = Engine::new(44100, 12000);
        let mut out = Vec::new();
        apply_batch(&mut e, "tog 0 4 60 100", &mut out);   // clip has notes
        e.play(&mut out);
        e.advance_block(44100 / 4, &mut out);              // roll a little
        let at = e.tracks[0].pos_tick;
        e.live_note_on(0, 67, 100);
        e.live_note_off(0, 67);
        let before = e.tracks[0].active().notes.len();
        assert!(e.capture_commit(0));
        let n = e.tracks[0].active().notes.last().unwrap();
        assert_eq!(e.tracks[0].active().notes.len(), before + 1);
        assert_eq!(n.pitch, 67);
        assert!(n.tick.abs_diff(at) <= TICKS_PER_STEP, "lands where it was heard");
    }

    #[test]
    fn capture_into_an_empty_playing_clip_grows_it_to_whole_bars() {
        let mut e = Engine::new(44100, 12000);
        let mut out = Vec::new();
        e.play(&mut out);
        for _ in 0..5 {                                     // ~5 s of phrase
            e.live_note_on(0, 60, 100);
            e.live_note_off(0, 60);
            e.advance_block(44100, &mut out);
        }
        assert!(e.capture_commit(0));
        let len = e.tracks[0].active().length_steps;
        assert!(len % STEPS_PER_BAR as u16 == 0, "whole bars, got {len}");
        assert!(len > STEPS_PER_BAR as u16, "grew past one bar");
    }

    #[test]
    fn capture_consumes_the_buffer() {
        let mut e = Engine::new(44100, 12000);
        let mut out = Vec::new();
        e.play(&mut out);
        e.live_note_on(0, 60, 100);
        e.live_note_off(0, 60);
        assert!(e.capture_commit(0));
        assert_eq!(e.capture_pending(0), 0);
        assert!(!e.capture_commit(0), "nothing left to capture");
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd engine && cargo test -p seq-core capture_`
Expected: FAIL — `capture_commit` not found.

- [ ] **Step 3: Implement the playing path**

In `engine.rs`:

```rust
    /// Turn buffered input into clip data on the active clip of `track`.
    /// Returns false when there was nothing to keep.
    ///
    /// While the transport runs the take lands where it was heard: an empty
    /// clip is laid out from the first played note and grown to whole bars
    /// (the manual's "the first played note aligns with the start of the clip"),
    /// a clip that already has notes is overdubbed and keeps its length.
    pub fn capture_commit(&mut self, track: usize) -> bool {
        if track >= NUM_TRACKS || self.capture.pending(track as u8) == 0 {
            return false;
        }
        if self.playing {
            let wrote = self.capture_commit_playing(track);
            if wrote {
                self.capture.clear();
                self.capture_gen = self.capture_gen.wrapping_add(1);
                self.dirty = true;
            }
            return wrote;
        }
        false // stopped path lands in Task 4
    }

    fn capture_commit_playing(&mut self, track: usize) -> bool {
        let a = self.tracks[track].active_clip;
        self.tracks[track].active_mut().ensure_exists();
        let fresh = self.tracks[track].active().notes.is_empty();
        let span = self.tracks[track].active().length_ticks().max(1);
        let first = self
            .capture
            .iter()
            .find(|e| e.track == track as u8 && e.on)
            .map(|e| (e.abs_tick, e.clip_tick));
        let Some((first_abs, first_ct)) = first else { return false };

        let now_abs = self.master_tick as u32;
        let evs: Vec<CapEvent> = self.capture.iter().copied().collect();
        let transpose = self.active_clip_transpose(track);
        let mut wrote = false;
        let mut span_end = 0u32;
        let mut used = vec![false; evs.len()];

        for i in 0..evs.len() {
            let ev = evs[i];
            if ev.track != track as u8 || !ev.on { continue; }
            let end = evs[i + 1..]
                .iter()
                .enumerate()
                .find(|(j, o)| {
                    o.track == ev.track && !o.on && o.pitch == ev.pitch && !used[i + 1 + j]
                })
                .map(|(j, o)| { used[i + 1 + j] = true; o.abs_tick });
            let gate = end.unwrap_or(now_abs).saturating_sub(ev.abs_tick).max(1);
            // A first take is laid out unwrapped from where the phrase began, so
            // a phrase longer than the clip extends it instead of folding back
            // onto itself; an overdub wraps into the existing loop.
            let tick = if fresh {
                first_ct + ev.abs_tick.saturating_sub(first_abs)
            } else {
                ev.clip_tick % span
            };
            let stored = (ev.pitch as i32 - transpose).clamp(0, 127) as u8;
            self.tracks[track].active_mut().record_note(tick, gate, stored, ev.vel);
            span_end = span_end.max(tick + gate);
            wrote = true;
        }

        if fresh && wrote {
            let bar = TICKS_PER_BAR;
            let bars = span_end.div_ceil(bar).max(1);
            let len = (bars * STEPS_PER_BAR as u32).min(MAX_STEPS as u32) as u16;
            self.tracks[track].clips[a].length_steps = len;
        }
        wrote
    }
```

Add the fields `capture_gen: u32` (init 0) beside `capture`, and extend `status()` with `cap={}.{}` carrying `self.capture.pending(self.watch_track as u8)` and `self.capture_gen`.

In `command.rs`:

```rust
        // cap <t> — commit buffered live input into t's active clip.
        "cap" => {
            if let Some(t) = next() {
                engine.capture_commit(t.clamp(0, NUM_TRACKS as i64 - 1) as usize);
            }
        }
        // capclr <t> — drop buffered input (Shift+Capture).
        "capclr" => {
            let _ = next();
            engine.capture_clear();
        }
```

Bump `ENGINE_VERSION` to `"0.29.0"` in `engine/crates/movy-dsp/src/lib.rs` and `'0.29.0'` in `src/seq/constants.ts`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd engine && cargo test`
Expected: PASS.

- [ ] **Step 5: Prove the teeth**

Comment out the `if fresh && wrote` length block, re-run: `capture_into_an_empty_playing_clip_grows_it_to_whole_bars` must fail. Restore it.

- [ ] **Step 6: Commit**

```bash
git add engine/crates/seq-core/src/engine.rs engine/crates/seq-core/src/command.rs engine/crates/movy-dsp/src/lib.rs src/seq/constants.ts
git commit -m "Capture buffered notes into a playing clip"
```

---

### Task 4: Commit while stopped, and the selector

**Files:**
- Modify: `engine/crates/seq-core/src/engine.rs` (frozen take, `write_take`, stopped commit, `capture_select`, `capture_done`, `capture_info`)
- Modify: `engine/crates/seq-core/src/command.rs` (`capsel`, `capdone`)
- Modify: `engine/crates/movy-dsp/src/lib.rs` (`get_param("capinfo")`)

**Interfaces:**
- Consumes: `estimate_tempos` (Task 2), `capture_commit` (Task 3).
- Produces: `pub fn capture_select(&mut self, idx: usize)`, `pub fn capture_done(&mut self)`, `pub fn capture_info(&self) -> String` formatted as
  `mode=<sel|fix|none> cands=<b,b,b> idx=<i> det=<bpm> why=<ext|notes|> bars=<n> stretch=<permille>`;
  commands `capsel <i>`, `capdone`.

- [ ] **Step 1: Write the failing tests**

```rust
    /// Play `n` notes at `bpm` into the buffer with the transport stopped.
    fn play_take(e: &mut Engine, bpm: f64, n: usize, out: &mut Vec<OutEvent>) {
        let step = (44100.0 * 60.0 / bpm / 2.0) as u32;   // eighth notes
        for _ in 0..n {
            e.live_note_on(0, 60, 100);
            e.live_note_off(0, 60);
            e.advance_block(step, out);
        }
    }

    #[test]
    fn stopped_capture_sets_the_tempo_and_rolls() {
        let mut e = Engine::new(44100, 12000);
        let mut out = Vec::new();
        play_take(&mut e, 100.0, 16, &mut out);
        assert!(e.capture_commit(0));
        assert_eq!(e.clock.bpm_x100(), 10000, "the detected tempo is applied");
        assert!(e.playing, "the take plays back immediately");
        assert!(e.capture_info().starts_with("mode=sel"));
    }

    #[test]
    fn selecting_another_candidate_retimes_the_take() {
        let mut e = Engine::new(44100, 12000);
        let mut out = Vec::new();
        play_take(&mut e, 100.0, 16, &mut out);
        assert!(e.capture_commit(0));
        let len_at_100 = e.tracks[0].active().length_steps;
        e.capture_select(2);                                  // 200 BPM
        assert_eq!(e.clock.bpm_x100(), 20000);
        assert!(e.tracks[0].active().length_steps > len_at_100,
                "same performance, twice as many bars");
    }

    #[test]
    fn an_external_clock_fits_the_take_to_the_existing_tempo() {
        let mut e = Engine::new(44100, 12000);
        let mut out = Vec::new();
        e.on_external_realtime(0xFA, &mut out);               // Move is clocking us
        play_take(&mut e, 100.0, 16, &mut out);
        assert!(e.capture_commit(0));
        assert_eq!(e.clock.bpm_x100(), 12000, "tempo is not ours to change");
        let info = e.capture_info();
        assert!(info.starts_with("mode=fix"), "{info}");
        assert!(info.contains("why=ext"), "{info}");
    }

    #[test]
    fn a_clip_with_notes_fits_rather_than_retempos() {
        let mut e = Engine::new(44100, 12000);
        let mut out = Vec::new();
        apply_batch(&mut e, "tog 0 0 48 100", &mut out);
        play_take(&mut e, 100.0, 16, &mut out);
        assert!(e.capture_commit(0));
        assert_eq!(e.clock.bpm_x100(), 12000);
        assert!(e.capture_info().contains("why=notes"));
    }

    #[test]
    fn the_fit_picks_the_closest_candidate_so_the_stretch_is_minimal() {
        let mut e = Engine::new(44100, 12000);   // set runs at 120
        let mut out = Vec::new();
        e.on_external_realtime(0xFA, &mut out);
        play_take(&mut e, 58.0, 16, &mut out);   // played at half time
        assert!(e.capture_commit(0));
        let info = e.capture_info();
        // 116 is a candidate (double of 58) and only 3.4% from 120; fitting via
        // 58 itself would stretch by 107%.
        let permille: i32 = info
            .split_whitespace()
            .find_map(|kv| kv.strip_prefix("stretch="))
            .unwrap()
            .parse()
            .unwrap();
        assert!(permille.abs() < 100, "minimal stretch, got {permille}‰");
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd engine && cargo test -p seq-core stopped_capture`
Expected: FAIL — `capture_info` not found / commit returns false while stopped.

- [ ] **Step 3: Implement**

Frozen-take state on `Engine`:

```rust
    /// A stopped capture's take, kept frame-stamped so the selector can
    /// re-derive it at any tempo without accumulating rounding.
    cap_take: Vec<CapEvent>,
    cap_take_first: u64,
    cap_take_span: u64,
    cap_guess: Option<TempoGuess>,
    cap_sel: usize,
    cap_track: usize,
    /// Selector is on screen (free tempo) vs a fixed-tempo explanation.
    cap_mode: CapMode,
    /// Why the tempo was fixed, for the overlay copy.
    cap_why: CapWhy,
    cap_stretch_permille: i32,
```

`CapMode { None, Select, Fixed }` and `CapWhy { None, Ext, Notes }` live in `capture.rs`.

The stopped branch of `capture_commit`:

```rust
        // Stopped: freeze the take, then decide whether the tempo is ours.
        self.cap_take = self.capture.iter().copied().filter(|e| e.track == track as u8).collect();
        let Some(first) = self.cap_take.iter().find(|e| e.on).map(|e| e.frame) else {
            return false;
        };
        let last = self.cap_take.last().map(|e| e.frame).unwrap_or(first);
        self.cap_take_first = first;
        self.cap_take_span = last.saturating_sub(first).max(1);
        self.cap_track = track;

        let onsets: Vec<u64> = self.cap_take.iter().filter(|e| e.on)
            .map(|e| e.frame - first).collect();
        self.cap_guess = estimate_tempos(&onsets, self.cap_take_span, self.clock.sample_rate());

        let clip_has_notes = !self.tracks[track].active().notes.is_empty();
        let existing = self.clock.bpm_x100() / 100;
        // Move detects a tempo for a fresh take only. An overdub inherits the
        // clip's grid, and under an external clock the tempo is not ours at all.
        self.cap_why = if self.ext_running { CapWhy::Ext }
                       else if clip_has_notes { CapWhy::Notes }
                       else { CapWhy::None };

        let (grid_bpm, set_tempo) = match (self.cap_why, &self.cap_guess) {
            (CapWhy::None, Some(g)) => { self.cap_sel = g.best; (g.cands[g.best], true) }
            (CapWhy::None, None)    => { self.cap_sel = 0; (existing.max(1), false) }
            (_, Some(g)) => {
                // Closest candidate to the tempo we must live with — with the
                // half/double partners in the list, that is the minimal stretch.
                let i = (0..g.n).min_by(|&a, &b| {
                    ratio(g.cands[a], existing).partial_cmp(&ratio(g.cands[b], existing)).unwrap()
                }).unwrap_or(0);
                self.cap_sel = i;
                (g.cands[i], false)
            }
            (_, None) => { self.cap_sel = 0; (existing.max(1), false) }
        };
        self.cap_stretch_permille = if grid_bpm > 0 {
            ((existing as i64 * 1000 / grid_bpm as i64) - 1000) as i32
        } else { 0 };
        self.cap_mode = if set_tempo && self.cap_guess.as_ref().map_or(0, |g| g.n) > 1 {
            CapMode::Select
        } else if self.cap_why != CapWhy::None {
            CapMode::Fixed
        } else {
            CapMode::None
        };

        let wrote = self.capture_write_take(track, grid_bpm, set_tempo, clip_has_notes);
        if wrote {
            self.tracks[track].playing_slot = Some(self.tracks[track].active_clip);
            self.play(&mut Vec::new());   // ring the take back immediately
            self.capture.clear();
            self.capture_gen = self.capture_gen.wrapping_add(1);
            self.dirty = true;
        }
        wrote
```

`capture_write_take(track, grid_bpm, set_tempo, keep_length)` wipes the clip's notes when `!keep_length`, converts each event's frame offset to ticks at `frames_per_tick = sample_rate * 60 / (grid_bpm * TICKS_PER_STEP * 4)`, inserts notes (wrapping into the loop when `keep_length`), sets the length to whole bars otherwise, and applies `grid_bpm` to `self.clock` when `set_tempo`.

`capture_select(idx)` clamps to the guess, re-runs `capture_write_take` at the new candidate with `set_tempo = true`, and bumps `capture_gen`. `capture_done()` clears `cap_mode`, `cap_take` and bumps `capture_gen`. `capture_push` returns early while `cap_mode != CapMode::None` — the selector owns the take.

`capture_info()` renders the string in the Interfaces block. `movy-dsp/src/lib.rs` gains `"capinfo" => Some(self.engine.capture_info()),` next to `"status"`. `command.rs` gains `capsel` and `capdone`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd engine && cargo test`
Expected: PASS.

- [ ] **Step 5: Prove the teeth**

Force `cap_why` to `CapWhy::None` unconditionally; `an_external_clock_fits_the_take_to_the_existing_tempo` and `a_clip_with_notes_fits_rather_than_retempos` must fail. Restore.

- [ ] **Step 6: Commit**

```bash
git add engine/crates/seq-core/src/engine.rs engine/crates/seq-core/src/capture.rs engine/crates/seq-core/src/command.rs engine/crates/movy-dsp/src/lib.rs
git commit -m "Capture while stopped: detect a tempo, or fit to the one we have"
```

---

### Task 5: Button, LED, and UI state

**Files:**
- Create: `src/seq/capture.ts`
- Modify: `src/seq/engine.ts` (`parseStatus` → `cap`), `src/seq/state.ts` (mirror fields), `src/seq/router.ts` (CC 52), `src/seq/buttons.ts` (`captureLedColor`), `src/seq/leds.ts` (pass the pending flag)
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Consumes: status `cap=<pending>.<gen>`, `get_param("capinfo")` (Task 4).
- Produces: `captureState { overlay: 'none'|'select'|'fixed', cands: number[], idx: number, detected: number, why: 'ext'|'notes'|'', bars: number, stretchPermille: number }`; `captureOverlayActive()`, `captureCommit(track)`, `captureClear(track)`, `captureJog(delta)`, `captureDismiss()`, `capturePollTick()`.

- [ ] **Step 1: Write the failing tests in `logic.mjs`**

```js
// Capture LED: lit only while there is something to keep.
assertEq(captureLedColor(0), WHITE_OFF, 'capture LED dark with an empty buffer');
assertEq(captureLedColor(3), WHITE_BRIGHT, 'capture LED lit with buffered notes');

// Status carries the pending count and the generation.
parseStatusForTest('play=1 cap=4.7');
assertEq(seqState.capPending, 4, 'pending parsed');
assertEq(seqState.capGen, 7, 'generation parsed');

// Shift+Capture clears rather than commits.
resetSeqEngine();
seqHandleMidi([0xB0, 52, 127], true);
assert(peekSeqCmdQueue().some((c) => c.startsWith('capclr')), 'shift+capture clears');
resetSeqEngine();
seqHandleMidi([0xB0, 52, 127], false);
assert(peekSeqCmdQueue().some((c) => c.startsWith('cap ')), 'capture commits');
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `captureLedColor` takes no argument / `capPending` undefined.

- [ ] **Step 3: Implement**

`src/seq/state.ts`: add `capPending: 0, capGen: -1`. `parseStatus`: `else if (key === 'cap') { const [p, g] = val.split('.').map(Number); seqState.capPending = p || 0; seqState.capGen = g || 0; }`.

`src/seq/buttons.ts`:

```ts
/** Capture: lit whenever there is buffered input worth keeping (Move parity). */
export function captureLedColor(pending: number): number {
    return pending > 0 ? WHITE_BRIGHT : WHITE_OFF;
}
```

`src/seq/leds.ts` passes `seqState.capPending`.

`src/seq/capture.ts` owns the overlay mirror: on a `capGen` change it does one `host_module_get_param('capinfo')` and parses it into `captureState`; `captureJog(delta)` moves `idx` within `cands`, sends `capsel <i>`, and calls `scheduleTempoOverride(cands[idx] * 100)` so Move's Link tempo follows; `captureDismiss()` sends `capdone` and clears the overlay.

`src/seq/router.ts` handles `CC_CAPTURE = 52` on press: Shift → `capclr <t>` + toast `CAPTURE CLEARED`; otherwise `capPending === 0` → toast `NOTHING TO CAPTURE`, else `cap <t>`.

- [ ] **Step 4: Run to verify it passes**

Run: `node browser-test/logic.mjs`
Expected: PASS.

- [ ] **Step 5: Run the whole local suite**

Run: `npm test`
Expected: all suites 0 failures.

- [ ] **Step 6: Commit**

```bash
git add src/seq/capture.ts src/seq/state.ts src/seq/engine.ts src/seq/router.ts src/seq/buttons.ts src/seq/leds.ts browser-test/logic.mjs
git commit -m "Wire the Capture button, its LED, and the capture mirror"
```

---

### Task 6: The overlay

**Files:**
- Create: `src/seq/capture-vm.ts`, `src/renderer/capture-overlay.ts`
- Modify: `src/app/tick.ts` (draw dispatch), `src/midi/router.ts` (dismiss intercept)
- Test: `browser-test/screenshot.mjs` (two scenes + baselines), `browser-test/logic.mjs` (vm)

**Interfaces:**
- Consumes: `captureState` (Task 5).
- Produces: `buildCaptureVM(): CaptureVM { mode, values: string[], selIdx, header: string, caption: string }`; `drawCaptureOverlay(vm: CaptureVM): void`.

- [ ] **Step 1: Write the failing tests**

In `logic.mjs`:

```js
// Selector: three tempos, the applied one highlighted, bars in the header.
setCaptureStateForTest({ overlay: 'select', cands: [85, 120, 170], idx: 1, bars: 4 });
let cvm = buildCaptureVM();
assertEq(cvm.values.join('|'), '85|120|170', 'all candidates offered');
assertEq(cvm.selIdx, 1, 'applied candidate highlighted');
assertEq(cvm.header, '4 BARS', 'bar count in the header');

// Fixed: no choice, an explanation instead.
setCaptureStateForTest({ overlay: 'fixed', cands: [120], idx: 0, detected: 117,
                         why: 'ext', stretchPermille: 26 });
cvm = buildCaptureVM();
assertEq(cvm.header, 'EXT SYNC', 'reason in the header');
assertEq(cvm.values.join('|'), '117|120', 'played tempo → set tempo');
assert(cvm.caption.includes('3%'), 'stretch rounded for the caption');
```

In `screenshot.mjs`, one scene per variant rendering `drawCaptureOverlay(buildCaptureVM())` over a knobs view.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `buildCaptureVM` not found.

- [ ] **Step 3: Implement the view model and the renderer**

`capture-vm.ts` maps `captureState` to the VM: header is `'<n> BARS'` in select mode, `'EXT SYNC'` / `'CLIP HAS NOTES'` in fixed mode; caption is `'JOG PICKS TEMPO'` or `'FITTED TO SET · STRETCHED <n>%'` (`Math.round(|permille| / 10)`); `values` is the candidate list, or `[detected, existing]` in fixed mode with `selIdx` on the existing one.

`capture-overlay.ts` clears the screen, draws the inverted header via `drawHeader('CAPTURE', vm.header, true)`, lays the values out centred on one row with `fontWidthBig` and 10 px gutters, fills a solid box (value width + 4 px padding, `BIG_FONT_HEIGHT + 4` tall) behind `vm.selIdx` and prints those digits with colour 0, prints an `→` between the pair in fixed mode, and prints the caption in the small font at the bottom.

`app/tick.ts` draws it last, above the leave modal's tier:

```ts
if (captureOverlayActive()) drawCaptureOverlay(buildCaptureVM());
```

`midi/router.ts` intercepts before everything else, in the same shape as the leave modal: jog turn → `captureJog(delta)`; any other **press** (button, pad, knob touch) → `captureDismiss()` and return, swallowing it; releases fall through so no hold is left stranded.

- [ ] **Step 4: Run to verify it passes**

Run: `node browser-test/logic.mjs && node browser-test/screenshot.mjs --update && node browser-test/screenshot.mjs`
Expected: PASS; inspect the two new baselines before keeping them.

- [ ] **Step 5: Run the whole local suite**

Run: `npm test`
Expected: all suites 0 failures, `perf.mjs` within budget.

- [ ] **Step 6: Commit**

```bash
git add src/seq/capture-vm.ts src/renderer/capture-overlay.ts src/app/tick.ts src/midi/router.ts browser-test/logic.mjs browser-test/screenshot.mjs browser-test/screenshots/baseline/capture_*.png
git commit -m "Show the capture tempo selector on screen"
```

---

### Task 7: Device test and docs

**Files:**
- Modify: `scripts/test-seq.sh` (capture leg), `MANUAL.md`, `README.md`, `CHANGELOG.md`
- Create: `docs/assets/capture_select.png` (from the baseline)

- [ ] **Step 1: Add the device leg**

Buffer a take with engine commands (`non`/`nof` with sleeps between), send `cap 0`, then read `status` and assert `len` is a whole number of bars and `play=1`. Engine commands, not MIDI inject — inject to overtake is device-state-flaky, and each ssh round trip is ~0.5 s.

- [ ] **Step 2: Run the device suite**

```bash
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && ./scripts/test-seq.sh \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```
If offline, report **DEVICE OFFLINE** to the user in caps.

- [ ] **Step 3: Update the docs**

`MANUAL.md`: a Capture section in §5 with the screenshot, entries in the §8 Controls reference (**Capture**, **Shift + Capture**, jog during the overlay), and **remove the "No capture" bullet** from §7 Limitations vs Move. `README.md`: one feature bullet. `CHANGELOG.md`: the entry plus the davebox prior-art credit — prior art, not code reuse.

```bash
node scripts/make-doc-assets.mjs capture_select
```

- [ ] **Step 4: Commit**

```bash
git add scripts/test-seq.sh MANUAL.md README.md CHANGELOG.md docs/assets/capture_select.png
git commit -m "Document capture and cover it on device"
git push
```

---

## Self-Review

**Spec coverage:** ring + gap + clear points → Task 1; estimator → Task 2; playing commit → Task 3; stopped commit, fixed-tempo fit, selector state, `capinfo` → Task 4; button, LED, mirror → Task 5; overlay, dismissal → Task 6; device test + docs → Task 7. Licensing is a global constraint and is restated in Task 7's changelog step. Timing-accuracy is documented in the spec and needs no code.

**Placeholders:** none — every code step carries real code; Task 4's `capture_write_take` and Task 6's renderer are described by their exact inputs, outputs and layout numbers rather than pasted in full, because both are mechanical given the surrounding signatures.

**Type consistency:** `capture_pending` (Task 1) is used by Task 3's guard and Task 5's LED; `TempoGuess.cands/best/n` (Task 2) is consumed in Task 4; `cap=<pending>.<gen>` (Task 3) is parsed in Task 5; `capinfo`'s keys (Task 4) map one-to-one onto `captureState` (Task 5) and then `CaptureVM` (Task 6).
