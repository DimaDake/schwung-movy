# Scene Launching & Song Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Launch a whole column of the Session grid across all 16 tracks, and sequence those columns into a looping song built live by holding Shift and pressing scenes.

**Architecture:** The song is **engine state**. `seq-core` owns the scene list, the scene-length maths, the bar countdown and the one-bar-ahead queueing; it reuses the existing per-track `queued_slot` / `pending_stop` fields, so the Session grid's queued-and-stopping pulses light up with no new LED code. The UI keeps a read-only mirror fed by a new `song=` status field, owns only the Shift+scene gesture, and paints the scene row and a bottom-row readout.

**Tech Stack:** Rust (`engine/crates/seq-core`, host-testable with `cargo test`), TypeScript → `ui.js` (QuickJS shadow-UI context), Node test harnesses in `browser-test/`.

**Spec:** `movy/plans/2026-09-01-scene-launch-song-mode-design.md`

## Global Constraints

- **Scene count is 8** — `CLIPS_PER_TRACK` in `engine/crates/seq-core/src/track.rs`. Track count is 16 (`NUM_TRACKS`).
- **Scenes live on the ODD step buttons as printed** (buttons 1,3,5…15), which are **0-indexed 0,2,4…14**. Scene *n* = 0-indexed step `2n` = clip slot `n`. Even 0-indexed steps are inert.
- **Bars come from `STEPS_PER_BAR = 16`** (`engine/crates/seq-core/src/lib.rs`). `Clip::length_steps` is `u16`.
- **Every new engine verb must be classified.** `command.rs` has `clears_capture`, `is_undoable_edit` and `is_control_verb`; the test `every_match_verb_is_classified` fails if a verb is in none. `song` and `songadd` are **control** verbs (transport/selection, not undoable) and **do** clear capture.
- **Status is space-separated `key=value`.** A value may never contain a space. `song=` uses `:` and `,` only.
- **Persisted lines are newline-separated, whitespace-split, and unknown lines are ignored** (`persist.rs`). The new `sg` line is omitted when there is no song, so old saves and old builds both stay valid.
- **Pulsing LEDs put the lit colour in `anim`, never in `base`** — firmware that ignores the base once a pulse channel is set must still show the colour (rule stated in `src/seq/leds.ts`).
- **`ENGINE_VERSION` must be bumped exactly once** for this whole feature, in **both** `engine/crates/movy-dsp/src/lib.rs` and `src/seq/constants.ts` (`build-dsp.sh` fails the build otherwise). Do it once, in Task 3. Bumping it twice for two builds hides a stale-`dsp.so` bug completely.
- **Never `git add -A`.** Add the named files only.
- **Commit message trailer** for every commit in this plan:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  ```

---

### Task 1: Scene launching in the engine

Launch a whole column across all 16 tracks. A track whose slot in that column is empty **stops** — a scene is a full snapshot of what plays. This is the plain existing stop path (`pending_stop` → `playing_slot = None` at the bar boundary, with `service_tick`'s existing note-off flush closing the gates). **No new gating is added:** no mute, no all-notes-off, no per-track silencing layer.

**Files:**
- Modify: `engine/crates/seq-core/src/engine.rs` (add `scene_bars` + `launch_scene` next to `launch_clip`, ~line 603-625)
- Test: `engine/crates/seq-core/src/engine.rs` (`#[cfg(test)] mod tests` at the bottom of the same file — this codebase keeps tests inline)

**Interfaces:**
- Consumes: `Engine::launch_clip`, `Engine::start_transport`, `Track::{clips, active_clip, playing_slot, queued_slot, pending_stop}`, `crate::STEPS_PER_BAR`, `track::{NUM_TRACKS, CLIPS_PER_TRACK}`.
- Produces:
  - `pub fn scene_bars(&self, slot: usize) -> u32`
  - `pub fn launch_scene(&mut self, slot: usize)`

- [ ] **Step 1: Write the failing tests**

Append to the `mod tests` block at the bottom of `engine/crates/seq-core/src/engine.rs`. Find the existing helpers first — this file's tests build engines with a local `fn e()`-style helper; match whatever the neighbouring tests do for construction and for adding a note (search for `fn a_note_less_clip_that_is_already_the_playing_slot_still_launches_on_the_bar` and copy its setup idiom).

```rust
#[test]
fn a_scene_launches_every_track_in_its_column() {
    let mut e = Engine::new();
    // Clips in column 2 on two tracks, plus one on a third track in a
    // DIFFERENT column so we can prove that track gets stopped, not left.
    e.tracks[0].clips[2].length_steps = 16;
    e.tracks[5].clips[2].length_steps = 16;
    e.tracks[9].clips[0].length_steps = 16;
    e.tracks[9].playing_slot = Some(0);

    e.launch_scene(2);

    // Stopped → immediate, and the transport starts.
    assert!(e.playing, "a scene launched from stopped starts the transport");
    assert_eq!(e.tracks[0].playing_slot, Some(2));
    assert_eq!(e.tracks[5].playing_slot, Some(2));
    // Track 9 has nothing in column 2: a scene is a snapshot, so it stops.
    assert_eq!(e.tracks[9].playing_slot, None,
               "an empty slot in the column stops that track");
    // Every track's edit target follows the scene.
    assert_eq!(e.tracks[9].active_clip, 2);
}

#[test]
fn a_scene_launched_while_running_is_bar_quantized() {
    let mut e = Engine::new();
    e.tracks[0].clips[0].length_steps = 16;
    e.tracks[0].clips[3].length_steps = 16;
    e.tracks[4].clips[0].length_steps = 16; // nothing in column 3 → stops
    e.play();
    assert!(e.playing);

    e.launch_scene(3);

    assert_eq!(e.tracks[0].queued_slot, Some(3), "queued, not switched mid-bar");
    assert_eq!(e.tracks[0].playing_slot, Some(0), "still on the old clip until the bar");
    assert!(e.tracks[4].pending_stop, "an empty slot queues a stop, not an instant cut");
}

#[test]
fn a_scene_lasts_as_long_as_its_longest_clip_rounded_up_to_bars() {
    let mut e = Engine::new();
    assert_eq!(e.scene_bars(0), 1, "an empty scene is one bar");

    e.tracks[0].clips[0].length_steps = 16; // 1 bar
    e.tracks[1].clips[0].length_steps = 48; // 3 bars
    e.tracks[2].clips[0].length_steps = 20; // 1.25 bars → 2
    assert_eq!(e.scene_bars(0), 3, "the longest clip sets the length");

    e.tracks[1].clips[0].length_steps = 0;  // no longer exists
    assert_eq!(e.scene_bars(0), 2, "20 steps rounds up to 2 bars");

    assert_eq!(e.scene_bars(99), 1, "an out-of-range slot is one bar, not a panic");
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd engine && cargo test -p seq-core scene
```
Expected: FAIL — `no method named 'scene_bars' found` / `no method named 'launch_scene' found`.

- [ ] **Step 3: Implement `scene_bars` and `launch_scene`**

Insert into `impl Engine` in `engine/crates/seq-core/src/engine.rs`, directly **after** `launch_clip` (so the two sit together — a scene is a column of launches):

```rust
    /// How many bars a scene lasts: the longest clip in that column, rounded
    /// up to whole bars, minimum 1. Rounding up is what keeps every scene
    /// switch on the same 1-bar launch grid `service_tick` already resolves
    /// against, which is in turn what makes the one-bar-ahead pulse exact.
    pub fn scene_bars(&self, slot: usize) -> u32 {
        if slot >= CLIPS_PER_TRACK {
            return 1;
        }
        let mut bars = 1;
        for t in &self.tracks {
            let c = &t.clips[slot];
            if c.exists() {
                let b = (c.length_steps as u32 + crate::STEPS_PER_BAR - 1)
                    / crate::STEPS_PER_BAR;
                if b > bars {
                    bars = b;
                }
            }
        }
        bars
    }

    /// Launch a whole column: every track's clip in `slot`. A track whose slot
    /// is empty STOPS — a scene is a full snapshot of what plays, so what is
    /// not in the column goes quiet.
    ///
    /// Deliberately the same per-track mechanics as `launch_clip`, reusing
    /// `queued_slot` / `pending_stop` rather than inventing a scene-level
    /// queue. That is what makes the Session grid's queued and stopping pulses
    /// light up for a scene with no LED work of its own — and what stops the
    /// empty case needing any gating beyond `playing_slot = None`, since
    /// `service_tick` already flushes the gates of a track it is not servicing.
    pub fn launch_scene(&mut self, slot: usize) {
        if slot >= CLIPS_PER_TRACK {
            return;
        }
        let playing = self.playing;
        let mut any_clip = false;
        for t in &mut self.tracks {
            t.active_clip = slot;
            let exists = t.clips[slot].exists();
            any_clip |= exists;
            if playing {
                if exists {
                    t.queued_slot = Some(slot);
                    t.pending_stop = false;
                } else {
                    t.pending_stop = true;
                    t.queued_slot = None;
                }
            } else {
                t.playing_slot = if exists { Some(slot) } else { None };
                t.queued_slot = None;
                t.pending_stop = false;
            }
        }
        if !playing && any_clip {
            self.start_transport();
        }
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd engine && cargo test -p seq-core scene
```
Expected: PASS (3 tests).

- [ ] **Step 5: Run the whole engine suite for regressions**

```bash
cd engine && cargo test
```
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add engine/crates/seq-core/src/engine.rs
git commit -m "$(cat <<'EOF'
seq: a scene is a column, launched the same way a clip is

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Song state and scheduling

The song sequences scenes and loops. It is stored as the **raw press list** (`[1,2,2,3]`); consecutive duplicates fold into `(scene, reps)` entries only at scheduling time, so the stored form stays the literal gesture — the same list the screen reads out and persistence saves.

**Files:**
- Modify: `engine/crates/seq-core/src/engine.rs` (struct fields + `Engine::new`; `play`; `stop`; `launch_clip`; `service_tick`; new song methods)
- Modify: `engine/crates/seq-core/src/command.rs` (`clears_capture`, `is_control_verb`, dispatch arms)
- Test: `engine/crates/seq-core/src/engine.rs` (inline `mod tests`)

**Interfaces:**
- Consumes: `Engine::{scene_bars, launch_scene, start_transport, capture, playing, master_tick, tracks}` from Task 1, `crate::TICKS_PER_BAR`.
- Produces:
  - `pub song: Vec<u8>` (public field — Task 3's `persist.rs` writes and reads it directly)
  - `pub fn song_entry_at(&self, i: usize) -> Option<(usize, u32)>` — `(scene, repeat count)` of the run starting at raw index `i`
  - `pub fn song_next_pos(&self, i: usize) -> usize` — raw index of the next entry, wrapping to 0
  - `pub fn song_pos(&self) -> usize` — raw index of the first press of the entry now playing
  - `pub fn song_start(&mut self, slot: usize)`
  - `pub fn song_add(&mut self, slot: usize)`
  - `pub fn clear_song(&mut self)`
  - Commands: `song <slot>`, `songadd <slot>`

- [ ] **Step 1: Write the failing tests**

Append to `mod tests` in `engine/crates/seq-core/src/engine.rs`:

```rust
/// Advance the engine by whole bars, servicing every tick, so the song's
/// bar-boundary scheduler runs exactly as it does on device.
#[cfg(test)]
fn run_bars(e: &mut Engine, bars: u32) {
    let mut out = Vec::new();
    for _ in 0..(bars * crate::TICKS_PER_BAR) {
        e.service_tick(&mut out);
    }
}

#[test]
fn a_song_folds_repeated_presses_into_one_longer_entry() {
    let mut e = Engine::new();
    e.song_start(1);
    e.song_add(2);
    e.song_add(2);
    e.song_add(3);
    assert_eq!(e.song, vec![1, 2, 2, 3]);
    assert_eq!(e.song_entry_at(0), Some((1, 1)));
    assert_eq!(e.song_entry_at(1), Some((2, 2)), "two presses of 2 are one entry, twice as long");
    assert_eq!(e.song_entry_at(3), Some((3, 1)));
    assert_eq!(e.song_next_pos(1), 3, "the entry after the doubled 2 starts at press 3");
    assert_eq!(e.song_next_pos(3), 0, "the last entry wraps to the first");
}

#[test]
fn a_song_arms_the_next_scene_exactly_one_bar_early_and_loops() {
    let mut e = Engine::new();
    // Two 1-bar scenes on track 0.
    e.tracks[0].clips[0].length_steps = 16;
    e.tracks[0].clips[1].length_steps = 16;

    e.song_start(0);          // from stopped: starts the transport immediately
    e.song_add(1);
    assert!(e.playing);
    assert_eq!(e.tracks[0].playing_slot, Some(0));

    // The scheduler runs at the FIRST boundary (tick 0) and, with a one-bar
    // entry, arms on the same boundary it starts — which is one bar of warning.
    run_bars(&mut e, 0);
    let mut out = Vec::new();
    e.service_tick(&mut out); // tick 0 = the first bar boundary
    assert_eq!(e.tracks[0].queued_slot, Some(1),
               "the next scene is queued a full bar before it plays");

    run_bars(&mut e, 1);
    assert_eq!(e.tracks[0].playing_slot, Some(1), "scene 2 fell in on the bar");
    assert_eq!(e.song_pos(), 1);
    assert_eq!(e.tracks[0].queued_slot, Some(0), "and scene 1 is queued again — the song loops");

    run_bars(&mut e, 1);
    assert_eq!(e.tracks[0].playing_slot, Some(0));
    assert_eq!(e.song_pos(), 0);
}

#[test]
fn a_two_bar_scene_holds_for_two_bars() {
    let mut e = Engine::new();
    e.tracks[0].clips[0].length_steps = 32; // 2 bars
    e.tracks[0].clips[1].length_steps = 16;
    e.song_start(0);
    e.song_add(1);

    let mut out = Vec::new();
    e.service_tick(&mut out);            // bar 0: entry starts, 2 bars to go
    assert_eq!(e.tracks[0].queued_slot, None, "nothing queued yet — two bars left");
    run_bars(&mut e, 1);                 // bar 1
    assert_eq!(e.tracks[0].queued_slot, Some(1), "one bar to go → armed");
    run_bars(&mut e, 1);                 // bar 2
    assert_eq!(e.tracks[0].playing_slot, Some(1));
}

#[test]
fn a_repeated_scene_plays_twice_as_long_without_retriggering() {
    let mut e = Engine::new();
    e.tracks[0].clips[0].length_steps = 16;
    e.tracks[0].clips[1].length_steps = 16;
    e.song_start(0);
    e.song_add(0);   // scene 1 twice → two bars
    e.song_add(1);

    let mut out = Vec::new();
    e.service_tick(&mut out);            // bar 0 of the doubled entry
    assert_eq!(e.tracks[0].queued_slot, None,
               "a doubled scene does not re-queue itself between reps");
    run_bars(&mut e, 1);                 // bar 1 — one to go
    assert_eq!(e.tracks[0].queued_slot, Some(1));
    run_bars(&mut e, 1);
    assert_eq!(e.tracks[0].playing_slot, Some(1), "the doubled scene held for two bars");
}

#[test]
fn a_one_entry_song_never_relaunches_itself() {
    let mut e = Engine::new();
    e.tracks[0].clips[0].length_steps = 16;
    e.song_start(0);

    let mut out = Vec::new();
    e.service_tick(&mut out);
    run_bars(&mut e, 3);
    // Re-launching would reset the track's `cycle` every bar, so an A:B trig
    // condition could never reach B.
    assert_eq!(e.tracks[0].queued_slot, None, "a song of one scene just keeps looping");
    assert!(e.tracks[0].cycle > 1, "the play count keeps counting across the wrap");
}

#[test]
fn play_restarts_the_song_from_the_top() {
    let mut e = Engine::new();
    e.tracks[0].clips[0].length_steps = 16;
    e.tracks[0].clips[1].length_steps = 16;
    e.song_start(0);
    e.song_add(1);
    let mut out = Vec::new();
    e.service_tick(&mut out);
    run_bars(&mut e, 1);
    assert_eq!(e.song_pos(), 1, "moved on to the second scene");

    e.stop(&mut out);
    assert_eq!(e.song, vec![0, 1], "stopping keeps the song");
    e.play();
    assert_eq!(e.song_pos(), 0, "play restarts the arrangement from the beginning");
    assert_eq!(e.tracks[0].playing_slot, Some(0));
}

#[test]
fn launching_a_clip_by_hand_deletes_the_song() {
    let mut e = Engine::new();
    e.tracks[0].clips[0].length_steps = 16;
    e.tracks[0].clips[1].length_steps = 16;
    e.song_start(0);
    e.song_add(1);
    assert!(!e.song.is_empty());

    e.launch_clip(0, 1);

    assert!(e.song.is_empty(), "taking the wheel ends the arrangement");
    assert_eq!(e.tracks[0].playing_slot, Some(0), "what was playing keeps playing");
}

#[test]
fn song_add_before_any_song_does_nothing() {
    let mut e = Engine::new();
    e.song_add(3);
    assert!(e.song.is_empty(), "an append with no song to append to is inert");
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd engine && cargo test -p seq-core song
```
Expected: FAIL — `no method named 'song_start'`, `no field 'song'`, etc.

- [ ] **Step 3: Add the song fields to `Engine`**

In the `pub struct Engine` declaration in `engine/crates/seq-core/src/engine.rs`, add:

```rust
    /// Song mode: the raw sequence of scene presses, e.g. `[1,2,2,3]`. Empty =
    /// no song. Consecutive duplicates fold into one entry with a repeat count
    /// only at scheduling time (`song_entry_at`), so this stays the literal
    /// gesture the user made — the same list the screen reads out and
    /// persistence stores, with no second representation to keep in sync.
    pub song: Vec<u8>,
    /// Raw index in `song` of the first press of the entry now playing.
    song_pos: usize,
    /// Master bar on which the current entry started. `None` until the song's
    /// first scene actually falls in, which is the boundary its launch
    /// resolves on.
    song_start_bar: Option<u64>,
    /// The next entry is already queued — its one-bar pulse is showing.
    song_armed: bool,
```

In `Engine::new`, initialise them:

```rust
            song: Vec::new(),
            song_pos: 0,
            song_start_bar: None,
            song_armed: false,
```

- [ ] **Step 4: Implement the song methods**

Add to `impl Engine`, after `launch_scene` from Task 1:

```rust
    /// Raw index of the first press of the entry now playing.
    pub fn song_pos(&self) -> usize {
        self.song_pos
    }

    /// The entry starting at raw index `i`: `(scene, repeat count)`. Pressing
    /// the same scene twice in a row is one entry that plays twice as long, so
    /// a run of identical presses folds here rather than being stored folded.
    pub fn song_entry_at(&self, i: usize) -> Option<(usize, u32)> {
        let scene = *self.song.get(i)? as usize;
        let reps = self.song[i..]
            .iter()
            .take_while(|&&s| s as usize == scene)
            .count() as u32;
        Some((scene, reps))
    }

    /// Raw index of the entry after the one starting at `i`, wrapping to the
    /// start of the song — that wrap is what makes a song loop.
    pub fn song_next_pos(&self, i: usize) -> usize {
        match self.song_entry_at(i) {
            Some((_, reps)) => {
                let n = i + reps as usize;
                if n >= self.song.len() { 0 } else { n }
            }
            None => 0,
        }
    }

    /// Forget the song. What is playing keeps playing — only the sequencing
    /// stops.
    pub fn clear_song(&mut self) {
        self.song.clear();
        self.song_pos = 0;
        self.song_start_bar = None;
        self.song_armed = false;
    }

    /// Start a new song from one scene — the first Shift+scene press of a hold.
    /// It launches straight away (bar-quantized like any clip launch) so the
    /// song starts before the user has finished building it.
    pub fn song_start(&mut self, slot: usize) {
        if slot >= CLIPS_PER_TRACK {
            return;
        }
        self.clear_song();
        self.song.push(slot as u8);
        self.launch_scene(slot);
    }

    /// Append a scene to the song being built. It does NOT launch: the song is
    /// already running and will reach this scene in order. Appending to the
    /// entry now playing lengthens it on this pass too, because the entry's
    /// total is derived from the list every bar rather than latched at entry.
    pub fn song_add(&mut self, slot: usize) {
        if slot >= CLIPS_PER_TRACK || self.song.is_empty() {
            return;
        }
        self.song.push(slot as u8);
    }

    /// One bar boundary of the song scheduler. Called from `service_tick`
    /// AFTER the queue-resolution block, which is load-bearing twice over: the
    /// entry we are leaving has already had its successor fall in on this very
    /// boundary, and a one-bar entry must be able to arm on the same boundary
    /// it starts without us resolving the launch we just made.
    fn song_bar(&mut self) {
        if self.song.is_empty() || !self.playing {
            return;
        }
        let bar = self.master_tick / crate::TICKS_PER_BAR as u64;
        let start = *self.song_start_bar.get_or_insert(bar);

        // Advance first. The launch armed a bar ago resolved on this boundary,
        // before we ran, so the entry that was current is now behind us.
        if let Some((scene, reps)) = self.song_entry_at(self.song_pos) {
            if (bar - start) as u32 >= self.scene_bars(scene) * reps {
                self.song_pos = self.song_next_pos(self.song_pos);
                self.song_start_bar = Some(bar);
                self.song_armed = false;
            }
        }

        // Then arm. One bar to go → queue what comes next, so the Session grid
        // shows it queued for a full bar before it happens. A one-bar entry
        // arms on the boundary it starts, which is exactly one bar of warning.
        let start = self.song_start_bar.unwrap_or(bar);
        let Some((scene, reps)) = self.song_entry_at(self.song_pos) else {
            return;
        };
        let total = self.scene_bars(scene) * reps;
        if !self.song_armed && (bar - start) as u32 + 1 >= total {
            self.song_armed = true;
            let next = self.song_next_pos(self.song_pos);
            if let Some((next_scene, _)) = self.song_entry_at(next) {
                /* Identical scenes either side of the boundary: a repeat, or a
                 * one-entry song wrapping onto itself. Re-launching would
                 * restart every clip and reset each track's `cycle`, so an A:B
                 * trig condition would never reach B. */
                if next_scene != scene {
                    self.launch_scene(next_scene);
                }
            }
        }
    }
```

- [ ] **Step 5: Wire the scheduler into `service_tick`**

In `service_tick` in `engine/crates/seq-core/src/engine.rs`, find the bar-boundary block that begins:

```rust
        if self.master_tick % crate::TICKS_PER_BAR as u64 == 0 {
            for t in &mut self.tracks {
                if let Some(slot) = t.queued_slot.take() {
```

and ends with the `if self.pending_rec {` sub-block. Add `self.song_bar();` as the **last statement inside that `if`**, after the `pending_rec` block closes:

```rust
            }
            /* The song advances only once the queue above has resolved: the
             * scene it armed a bar ago has just fallen in, and a one-bar entry
             * has to be able to arm the next one on this same boundary without
             * that launch being resolved by the loop we just ran. */
            self.song_bar();
        }
```

- [ ] **Step 6: Make `play` and `launch_clip` song-aware**

Replace the body of `pub fn play(&mut self)` in `engine/crates/seq-core/src/engine.rs` with:

```rust
    pub fn play(&mut self) {
        /* A song owns what plays: Play restarts the arrangement from the top
         * rather than resuming each track's own selection. */
        if let Some((scene, _)) = self.song_entry_at(0) {
            self.song_pos = 0;
            self.song_start_bar = None;
            self.song_armed = false;
            for t in &mut self.tracks {
                t.active_clip = scene;
                t.playing_slot = if t.clips[scene].exists() { Some(scene) } else { None };
                t.queued_slot = None;
                t.pending_stop = false;
            }
            self.capture.clear();
            self.start_transport();
            return;
        }
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
```

At the top of `pub fn launch_clip`, immediately after the bounds check, add:

```rust
        /* Launching a clip by hand is taking the wheel: the arrangement stops
         * being an arrangement. What is playing keeps playing — only the
         * sequencing stops. */
        self.clear_song();
```

In `pub fn stop`, after `self.capture.clear();`, add:

```rust
        /* The song survives a stop — Play replays it from the top — but the
         * cursor into it does not. */
        self.song_pos = 0;
        self.song_start_bar = None;
        self.song_armed = false;
```

- [ ] **Step 7: Add the commands and classify them**

In `engine/crates/seq-core/src/command.rs`, add the dispatch arms next to `"launch"`:

```rust
        // song <slot> — start a NEW song from this scene and launch it.
        "song" => {
            if let Some(s) = next() {
                engine.song_start(s.max(0) as usize);
            }
        }
        // songadd <slot> — append a scene to the song being built.
        "songadd" => {
            if let Some(s) = next() {
                engine.song_add(s.max(0) as usize);
            }
        }
```

In `fn clears_capture`, add to the `whole-clip and session gestures` group:

```rust
        | "clipsel" | "launch" | "stoptrk" | "song" | "songadd"
```

In `fn is_control_verb`, add to the transport group:

```rust
        "play" | "stop" | "rec" | "metro" | "link" | "minject" | "launch" | "stoptrk"
        | "song" | "songadd"
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
cd engine && cargo test -p seq-core song
```
Expected: PASS (8 tests).

- [ ] **Step 9: Run the whole engine suite**

```bash
cd engine && cargo test
```
Expected: PASS, 0 failures — including `every_match_verb_is_classified`, which proves the two new verbs are classified.

- [ ] **Step 10: Commit**

```bash
git add engine/crates/seq-core/src/engine.rs engine/crates/seq-core/src/command.rs
git commit -m "$(cat <<'EOF'
seq: a song is the order you pressed the scenes in

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Report the song and persist it with the Set

**Files:**
- Modify: `engine/crates/seq-core/src/engine.rs` (`status()` format string + `song_state()`)
- Modify: `engine/crates/seq-core/src/persist.rs` (`serialize` + the load reset + a `sg` arm)
- Modify: `engine/crates/movy-dsp/src/lib.rs` (`ENGINE_VERSION` bump)
- Modify: `src/seq/constants.ts` (`ENGINE_VERSION` bump — must match)
- Test: `engine/crates/seq-core/src/engine.rs`, `engine/crates/seq-core/src/persist.rs` (inline `mod tests`)

**Interfaces:**
- Consumes: `Engine::{song, song_pos, clear_song}` from Task 2.
- Produces: status field `song=<pos>:<csv>` or `song=-`; persisted line `sg <n> <n> …`.

- [ ] **Step 1: Write the failing tests**

Append to `mod tests` in `engine/crates/seq-core/src/engine.rs`:

```rust
#[test]
fn status_reports_the_song_and_where_we_are_in_it() {
    let mut e = Engine::new();
    let s = e.status();
    let song = s.split("song=").nth(1).unwrap().split(' ').next().unwrap();
    assert_eq!(song, "-", "no song reads as a dash, never as an empty value");

    e.tracks[0].clips[1].length_steps = 16;
    e.tracks[0].clips[2].length_steps = 16;
    e.song_start(1);
    e.song_add(2);
    e.song_add(2);
    let s = e.status();
    let song = s.split("song=").nth(1).unwrap().split(' ').next().unwrap();
    assert_eq!(song, "0:1,2,2");
    assert!(!song.contains(' '), "a status value may never contain a space");
}
```

Append to `mod tests` in `engine/crates/seq-core/src/persist.rs` (match the neighbouring round-trip tests' idiom for building and reloading an engine):

```rust
#[test]
fn a_song_survives_a_save_and_load() {
    let mut e = Engine::new();
    e.tracks[0].clips[1].length_steps = 16;
    e.tracks[0].clips[3].length_steps = 16;
    e.song_start(1);
    e.song_add(3);
    e.song_add(3);

    let blob = serialize(&e);
    assert!(blob.contains("sg 1 3 3\n"));

    let mut loaded = Engine::new();
    assert!(deserialize(&mut loaded, &blob));
    assert_eq!(loaded.song, vec![1, 3, 3], "the arrangement comes back with the Set");
}

#[test]
fn a_save_with_no_song_writes_no_line_and_clears_a_stale_one() {
    let mut e = Engine::new();
    let blob = serialize(&e);
    assert!(!blob.contains("sg "), "no song, no line — old builds keep reading this");

    let mut loaded = Engine::new();
    loaded.tracks[0].clips[0].length_steps = 16;
    loaded.song_start(0);
    assert!(deserialize(&mut loaded, &blob));
    assert!(loaded.song.is_empty(), "loading a songless Set clears the previous song");
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd engine && cargo test -p seq-core song
```
Expected: FAIL — `status_reports_the_song_and_where_we_are_in_it` panics on `nth(1).unwrap()` (no `song=` in the string); the persist tests fail on the missing `sg` line.

- [ ] **Step 3: Add `song=` to `status()`**

In `engine/crates/seq-core/src/engine.rs`, append ` song={}` to the end of the `status()` format string (just after `cap={}.{}`), and add the argument as the **last** one, after `self.capture_gen,`:

```rust
            self.song_state(),
```

Add the helper next to `session_state`:

```rust
    /// `song=` — the raw scene list and which entry is playing, e.g.
    /// `1:1,2,2,3` (on the entry that starts at press 1). `-` when there is no
    /// song. Never contains a space: status is space-separated key=value.
    fn song_state(&self) -> String {
        if self.song.is_empty() {
            return "-".to_string();
        }
        let mut out = String::with_capacity(2 + self.song.len() * 2);
        out.push_str(&self.song_pos.to_string());
        out.push(':');
        for (i, s) in self.song.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            out.push_str(&s.to_string());
        }
        out
    }
```

- [ ] **Step 4: Persist the song**

In `engine/crates/seq-core/src/persist.rs`:

Extend the module's format doc comment, after the `cp` line:

```
//!   sg <scene> <scene> …            (the song's raw scene presses; omitted when none)
```

In `serialize`, after the `link` line is pushed and **before** the `for (ti, t) in engine.tracks…` loop:

```rust
    /* The song is Set-level, like tempo — one line, omitted when there is no
     * song so older builds (and songless Sets) are byte-identical to before. */
    if !engine.song.is_empty() {
        s.push_str("sg");
        for scene in &engine.song {
            s.push(' ');
            s.push_str(&scene.to_string());
        }
        s.push('\n');
    }
```

In `deserialize`, in the reset block that runs before lines are applied (next to `engine.link_enabled = false;`):

```rust
    // A Set with no `sg` line has no song — including one loaded over a Set
    // that did.
    engine.clear_song();
```

And add the load arm next to `Some("link")`:

```rust
            Some("sg") => {
                engine.song = it
                    .filter_map(|x| x.parse::<u8>().ok())
                    .filter(|s| (*s as usize) < crate::track::CLIPS_PER_TRACK)
                    .collect();
            }
```

- [ ] **Step 5: Bump `ENGINE_VERSION` — once, for the whole feature**

Find the current value and bump the minor component in **both** files. They must match exactly or `build-dsp.sh` fails.

```bash
grep -n "ENGINE_VERSION" engine/crates/movy-dsp/src/lib.rs src/seq/constants.ts
```

Edit both to the same new value (e.g. `0.44.0` → `0.45.0`).

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd engine && cargo test
```
Expected: PASS, 0 failures.

- [ ] **Step 7: Commit**

```bash
git add engine/crates/seq-core/src/engine.rs engine/crates/seq-core/src/persist.rs \
        engine/crates/movy-dsp/src/lib.rs src/seq/constants.ts
git commit -m "$(cat <<'EOF'
seq: the song is part of the Set, and the engine says where it is

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The UI mirror and the Shift+scene gesture

**Files:**
- Create: `src/seq/song.ts`
- Modify: `src/seq/state.ts` (mirror fields + `songFromStr`)
- Modify: `src/seq/engine.ts` (`parseStatus` arm)
- Modify: `src/seq/router-steps.ts` (the scene-row branch)
- Modify: `src/midi/router.ts` (tell `song.ts` when Shift moves)
- Modify: `src/app/input-reset.ts`, `src/app/init.ts` (reset the gesture)
- Create: `browser-test/logic/song.mjs`
- Modify: `browser-test/logic.mjs` (one import line + one entry in `SUITES`)

**Interfaces:**
- Consumes: engine verbs `song <slot>` / `songadd <slot>` and status field `song=` from Tasks 2-3; `seqCmd` from `src/seq/engine.ts`; `seqState` from `src/seq/state.ts`.
- Produces (all from `src/seq/song.ts`):
  - `export const NUM_SCENES = 8`
  - `export function sceneForStep(step: number): number` — scene index, or `-1` for an inert step
  - `export function songShift(down: boolean): void`
  - `export function songSceneStep(step: number, on: boolean): void`
  - `export function resetSong(): void`
  - From `src/seq/state.ts`: `seqState.songScenes: number[]`, `seqState.songPos: number`, `export function songFromStr(s: string): void`

- [ ] **Step 1: Write the failing test suite**

Create `browser-test/logic/song.mjs`:

```javascript
/* browser-test/logic/song.mjs — scene launching and Song mode: the Shift+scene
 * gesture, the `song=` mirror, the scene row's LEDs and the bottom-row readout.
 *
 * Run by browser-test/logic.mjs.
 */

import { eq, ok, lastMusicalOp, seqEngineTick, resetSeqEngine, _log } from './harness.mjs';

export async function run() {
    _log('\nsong mode:');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { seqHandleMidi } = await import('../../dist/esm/seq/router.js');
    const { seqState, resetSeqState, songFromStr } = await import('../../dist/esm/seq/state.js');
    const { parseStatusForTest } = await import('../../dist/esm/seq/engine.js');
    const { sceneForStep, songShift, resetSong, NUM_SCENES } =
        await import('../../dist/esm/seq/song.js');

    const engine = installMockEngine();
    const reset = () => { resetSeqEngine(); resetSeqState(); resetSong(); engine.reset(); };
    const lastOp = () => lastMusicalOp(engine.ops);
    reset(); seqEngineTick();

    /* ── the scene row: odd step buttons as printed = 0-indexed even ──────── */
    eq('step 1 (0-indexed 0) is scene 1', sceneForStep(0), 0);
    eq('step 3 (0-indexed 2) is scene 2', sceneForStep(2), 1);
    eq('step 15 (0-indexed 14) is scene 8', sceneForStep(14), 7);
    eq('an even 0-indexed step is inert', sceneForStep(1), -1);
    eq('step 16 is inert', sceneForStep(15), -1);
    eq('there are eight scenes', NUM_SCENES, 8);

    /* ── building a song: first press of a hold replaces, later ones append ── */
    reset(); seqEngineTick();
    seqState.sessionMode = true;
    songShift(true);
    seqHandleMidi([0x90, 16 + 0, 127], true);   // Shift + step 1 → scene 0
    seqEngineTick();
    eq('the first Shift+scene starts a new song', lastOp(), 'song 0');

    seqHandleMidi([0x90, 16 + 0, 0], true);
    seqHandleMidi([0x90, 16 + 2, 127], true);   // Shift + step 3 → scene 1
    seqEngineTick();
    eq('a later press in the same hold appends', lastOp(), 'songadd 1');

    seqHandleMidi([0x90, 16 + 2, 0], true);
    seqHandleMidi([0x90, 16 + 2, 127], true);   // the same scene again
    seqEngineTick();
    eq('pressing the same scene twice appends it twice', lastOp(), 'songadd 1');

    /* A NEW Shift hold starts a NEW song — that is the only way to replace one. */
    seqHandleMidi([0x90, 16 + 2, 0], true);
    songShift(false);
    songShift(true);
    seqHandleMidi([0x90, 16 + 4, 127], true);
    seqEngineTick();
    eq('a new Shift hold starts a new song', lastOp(), 'song 2');

    /* An inert even step emits nothing at all. */
    reset(); seqEngineTick();
    seqState.sessionMode = true;
    songShift(true);
    seqHandleMidi([0x90, 16 + 1, 127], true);
    seqEngineTick();
    ok('an inert step emits no command', lastOp() !== 'song 0' && !String(lastOp()).startsWith('song'));

    /* Outside Session view Shift+step keeps its old meaning (Metronome). */
    reset(); seqEngineTick();
    seqState.sessionMode = false;
    songShift(true);
    seqHandleMidi([0x90, 16 + 5, 127], true);
    seqEngineTick();
    eq('Shift+Step 6 is still the metronome in Track view', lastOp(), 'metro 1');

    /* ── the mirror ──────────────────────────────────────────────────────── */
    reset();
    songFromStr('-');
    eq('no song parses to an empty list', seqState.songScenes.length, 0);
    songFromStr('1:1,2,2,3');
    eq('the scene list comes through', seqState.songScenes.join(','), '1,2,2,3');
    eq('so does the position', seqState.songPos, 1);
    parseStatusForTest('play=1 song=2:0,7');
    eq('parseStatus reads song=', seqState.songScenes.join(','), '0,7');
    eq('parseStatus reads the position', seqState.songPos, 2);
    parseStatusForTest('play=1 song=-');
    eq('a dash clears the mirror', seqState.songScenes.length, 0);

    uninstallMockEngine();
}
```

Register it in `browser-test/logic.mjs` — add the import beside the other `seq_` imports:

```javascript
import { run as run_song } from './logic/song.mjs';
```

and add `run_song,` to the `SUITES` array, immediately after `run_seq_session,`.

- [ ] **Step 2: Run the suite to verify it fails**

```bash
npm run build:browser && node browser-test/logic.mjs
```
Expected: FAIL — `Cannot find module '../../dist/esm/seq/song.js'`.

- [ ] **Step 3: Add the mirror to `state.ts`**

In `src/seq/state.ts`, add to the `seqState` interface next to the `/* session mode */` group:

```typescript
    /* song mode — mirror of the engine's `song=` (src/seq/song.ts owns the gesture) */
    songScenes: number[];        // raw press list, e.g. [1,2,2,3]
    songPos: number;             // index in songScenes of the entry now playing
```

Add to the initialiser next to `session: emptySession(),`:

```typescript
        songScenes: [],
        songPos: 0,
```

Add the parser next to `sessionFromStr`:

```typescript
/* Parse the engine's `song=` value: `-` for no song, else `<pos>:<csv>` where
 * pos is the RAW index of the first press of the entry now playing. */
export function songFromStr(s: string): void {
    if (!s || s === '-') {
        seqState.songScenes = [];
        seqState.songPos = 0;
        return;
    }
    const colon = s.indexOf(':');
    seqState.songPos = Number(s.slice(0, colon)) || 0;
    seqState.songScenes = s.slice(colon + 1).split(',')
        .map(Number)
        .filter((n) => n >= 0 && n < 8);
}
```

In `src/seq/engine.ts`, add the import to the existing `./state.js` import list (`songFromStr`) and add the arm to `parseStatus` next to `sess`:

```typescript
        else if (key === 'song') songFromStr(val);
```

- [ ] **Step 4: Create `src/seq/song.ts`**

```typescript
/* Song mode: hold Shift in Session view and press scenes to build an
 * arrangement out of them.
 *
 * Only the GESTURE lives here. The engine owns the song itself — the sequence,
 * the scene lengths, the bar countdown and the switching — and this module
 * reads it back from the `song=` mirror in state.ts. Keeping the schedule in
 * the engine is what lets a scene change land on the same bar boundary that
 * already resolves clip launches, instead of on whichever UI tick noticed.
 *
 * The eight scenes sit on the step buttons printed 1,3,5…15 — 0-indexed
 * 0,2,4…14 — one per clip column. The even ones are inert. */

import { seqCmd } from './engine.js';
import { appState } from '../app/state.js';
import { C_BLACK, C_GREEN, ANIM_NONE, ANIM_PULSE } from './colors.js';

export const NUM_SCENES = 8;

/* Declared here rather than imported from leds.ts: leds.ts imports this module
 * to paint the row, and a type import back would tie the two together for no
 * gain. session.ts keeps its own copy for the same reason. */
export interface SceneLed { base: number; anim: number; channel: number; }

/* Whether this Shift hold has already placed its first scene. The FIRST press
 * of a hold REPLACES the song and every later press appends, so one hold is
 * one song — and a bare Shift press with no scene leaves a running song alone.
 * Shift is reached for constantly; it must never be the thing that destroys an
 * arrangement. */
let holdStarted = false;

/* Steps whose PRESS the scene row consumed, so their release is consumed too.
 * A bit per step rather than "Shift is still down": releasing Shift before the
 * finger leaves the button would otherwise drop that release into the track
 * selector, which would switch tracks off a press that never meant to. */
let scenePresses = 0;

/** Shift went down or up. */
export function songShift(down: boolean): void {
    if (down) holdStarted = false;
}

/** The scene a step button addresses, or -1 when the step is inert. */
export function sceneForStep(step: number): number {
    if (step < 0 || step >= NUM_SCENES * 2 || step % 2 !== 0) return -1;
    return step >> 1;
}

/** A press or release on the scene row. The row consumes both either way. */
export function songSceneStep(step: number, on: boolean): void {
    const bit = 1 << step;
    if (!on) {
        scenePresses &= ~bit;
        return;
    }
    scenePresses |= bit;
    const scene = sceneForStep(step);
    if (scene < 0) return;              // an inert step is consumed, and does nothing
    if (holdStarted) {
        seqCmd('songadd ' + scene);
    } else {
        seqCmd('song ' + scene);
        holdStarted = true;
    }
    appState.dirty = true;
}

/** True when this release belongs to a press the scene row already consumed. */
export function songSceneReleasePending(step: number): boolean {
    return (scenePresses & (1 << step)) !== 0;
}

/* The scene row's LEDs. A scene the song uses PULSES, so the whole arrangement
 * reads as queued at a glance rather than only the scene that happens to be
 * next. The lit colour goes in `anim`, never in `base`: firmware that ignores
 * the base once a pulse channel is set must still show the colour (leds.ts). */
export function sceneStepLed(step: number, songScenes: number[]): SceneLed {
    const scene = sceneForStep(step);
    if (scene < 0) return { base: C_BLACK, anim: C_BLACK, channel: ANIM_NONE };
    if (songScenes.indexOf(scene) >= 0) {
        return { base: C_BLACK, anim: C_GREEN, channel: ANIM_PULSE };
    }
    return { base: C_GREEN, anim: C_GREEN, channel: ANIM_NONE };
}

export function resetSong(): void {
    holdStarted = false;
    scenePresses = 0;
}
```

- [ ] **Step 5: Route the gesture**

In `src/seq/router-steps.ts`, add the import:

```typescript
import { songSceneStep, songSceneReleasePending } from './song.js';
```

and insert this branch **immediately before** the `if (trackSelectActive()) {` block:

```typescript
    /* Shift in Session view turns the row into the scene launcher: the eight
     * clip columns on the step buttons printed 1,3,5…15. Above the track
     * selector, which keeps the row on unshifted presses — Shift is what
     * changes what the row means. The release of a press this row consumed
     * belongs to it too, even if Shift came up in between. */
    if ((seqState.sessionMode && shiftHeld) || (!on && songSceneReleasePending(button))) {
        songSceneStep(button, on);
        return;
    }
```

In `src/midi/router.ts`, add `import { songShift } from '../seq/song.js';` and extend the Shift line (currently `if (d1 === MoveShift) { appState.shiftHeld = d2 > 0; return; }`):

```typescript
    if (d1 === MoveShift) { appState.shiftHeld = d2 > 0; songShift(d2 > 0); return; }
```

In `src/app/input-reset.ts` and `src/app/init.ts`, add `resetSong();` (imported from `../seq/song.js`) next to the existing `appState.shiftHeld = false;` line in each.

- [ ] **Step 6: Run the suite to verify it passes**

```bash
npm run build:browser && node browser-test/logic.mjs
```
Expected: PASS — `ALL LOGIC CHECKS PASSED`.

- [ ] **Step 7: Prove the test has teeth**

Temporarily change `holdStarted = true;` in `songSceneStep` to `holdStarted = false;`, rebuild, re-run. Expected: the `a later press in the same hold appends` check FAILS. Revert the change and re-run to green.

- [ ] **Step 8: Commit**

```bash
git add src/seq/song.ts src/seq/state.ts src/seq/engine.ts src/seq/router-steps.ts \
        src/midi/router.ts src/app/input-reset.ts src/app/init.ts \
        browser-test/logic/song.mjs browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
seq: hold Shift in Session view and the step row is the scenes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: The scene row's LEDs

**Files:**
- Modify: `src/seq/leds.ts` (`paintSceneRow` + the Session branch of `seqLedsTick`)
- Modify: `browser-test/logic/song.mjs` (LED assertions)
- Modify: `browser-test/app-loop.mjs` (end-to-end assertion through the real app loop)

**Interfaces:**
- Consumes: `sceneStepLed` from `src/seq/song.ts` (Task 4), `seqState.songScenes` (Task 4), `cachedSetAnimLED` / `STEP_NOTE_BASE` / `NUM_STEP_BUTTONS` from the existing LED layer.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing LED tests**

Append to `browser-test/logic/song.mjs`, before `uninstallMockEngine();`:

```javascript
    /* ── the scene row's LEDs ────────────────────────────────────────────── */
    const { sceneStepLed } = await import('../../dist/esm/seq/song.js');
    const { C_BLACK, C_GREEN, ANIM_NONE, ANIM_PULSE } =
        await import('../../dist/esm/seq/colors.js');

    const inert = sceneStepLed(1, []);
    eq('an inert step is black', inert.base, C_BLACK);
    eq('and carries no animation', inert.channel, ANIM_NONE);

    const idle = sceneStepLed(0, []);
    eq('a scene not in the song is solid green', idle.base, C_GREEN);
    eq('solid means no animation channel', idle.channel, ANIM_NONE);

    const used = sceneStepLed(4, [1, 2, 2, 3]);   // step 4 → scene 2, in the song
    eq('a scene the song uses pulses', used.channel, ANIM_PULSE);
    eq('the lit colour is in anim, never in base', used.anim, C_GREEN);
    eq('so a base-ignoring firmware still shows it', used.base, C_BLACK);

    const unused = sceneStepLed(0, [1, 2, 2, 3]);  // step 0 → scene 0, not in the song
    eq('a scene outside the song stays solid', unused.channel, ANIM_NONE);
```

Append to `browser-test/app-loop.mjs`, in the same style as its neighbouring Session-view assertions (find the block that enters Session view via `CC_NOTE_SESSION` and copy its idiom for entering the view and ticking):

```javascript
/* Shift in Session view: the step row is the scene launcher, not the track
 * selector. Asserted through the real app loop because this is the layer the
 * device cannot read back — a scene row that never reaches setLED looks
 * identical to one painted in the wrong colours. */
{
    resetSeqState();
    seqState.sessionMode = true;
    seqState.songScenes = [1];
    onMidiMessageInternal([0xB0, 49, 127]);       // Shift down (MoveShift)
    tick();
    check('scene row: step 1 lights for scene 1', ledByPad[STEP_NOTE_BASE + 0] !== 0);
    check('scene row: step 2 is inert (black)', ledByPad[STEP_NOTE_BASE + 1] === 0);
    onMidiMessageInternal([0xB0, 49, 0]);         // Shift up
    tick();
}
```

Before writing that block, confirm the Shift CC number and the `check`/assert helper name actually used by `app-loop.mjs`:

```bash
grep -n "MoveShift" src/midi/*.ts src/app/*.ts | head -3
grep -n "^function check\|const check\|function ok(" browser-test/app-loop.mjs | head -3
```

Use whatever those report; do not assume `49` or `check`.

- [ ] **Step 2: Run to verify they fail**

```bash
npm run build:browser && node browser-test/logic.mjs && node browser-test/app-loop.mjs
```
Expected: FAIL — `sceneStepLed` assertions pass already (it was written in Task 4), but the app-loop check fails because nothing paints the row.

If the logic assertions also fail, `sceneStepLed` was not exported correctly in Task 4 — fix that first.

- [ ] **Step 3: Paint the row**

In `src/seq/leds.ts`, add the import:

```typescript
import { sceneStepLed } from './song.js';
```

Add the painter next to `paintTrackSelector`:

```typescript
/* The 16 step buttons as the scene launcher — Shift held in Session view. The
 * eight scenes sit on the buttons printed 1,3,5…15; the rest are inert. Shares
 * cachedSetAnimLED with the track selector it replaces, so the two swap inside
 * ONE cache and no seqLedsInvalidate edge is needed: that hazard only exists
 * between the cachedSetLED and cachedSetAnimLED maps, which are independent. */
function paintSceneRow(): void {
    for (let i = 0; i < NUM_STEP_BUTTONS; i++) {
        const led = sceneStepLed(i, seqState.songScenes);
        cachedSetAnimLED(STEP_NOTE_BASE + i, led.base, led.anim, led.channel);
    }
}
```

In `seqLedsTick`, replace `paintTrackSelector();` inside the `if (seqState.sessionMode) {` branch with:

```typescript
        if (shiftHeld) paintSceneRow(); else paintTrackSelector();
```

- [ ] **Step 4: Run to verify they pass**

```bash
npm run build:browser && node browser-test/logic.mjs && node browser-test/app-loop.mjs
```
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add src/seq/leds.ts browser-test/logic/song.mjs browser-test/app-loop.mjs
git commit -m "$(cat <<'EOF'
seq: every scene the song uses pulses, so the arrangement reads at a glance

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: The song band on screen

An inverted bottom-row readout, Session view only: `SONG 1 2 2 3`, scene numbers 1-based to match the step buttons, with the entry now playing boxed. It is visible while Shift is held in Session view (so it appears the instant you press Shift, empty at first) or whenever a song is active, and it repaints only when its content changes.

**Files:**
- Modify: `src/seq/song.ts` (`songBandTokens`, `songBandVisible`)
- Modify: `src/seq/render.ts` (`drawSongBand`, `songBandTick`, `resetSongBand`)
- Modify: `src/app/tick.ts` (hook-up)
- Modify: `browser-test/logic/song.mjs` (token/window assertions)
- Modify: `browser-test/screenshot.mjs` (two new scenes)
- Modify: `browser-test/perf.mjs` (steady-state assertion)

**Interfaces:**
- Consumes: `seqState.{songScenes, songPos, sessionMode}`, `appState.shiftHeld`, `fontWidth`/`fontPrint` from `src/font/index.js`, `W` from `src/renderer/layout.js`.
- Produces:
  - `export interface SongToken { label: string; current: boolean; }`
  - `export function songBandTokens(scenes: number[], pos: number, maxW: number, width: (s: string) => number): { tokens: SongToken[]; leading: boolean }`
  - `export function songBandVisible(): boolean`
  - From `render.ts`: `export function songBandTick(viewRepainted: boolean): void`, `export function resetSongBand(): void`

- [ ] **Step 1: Write the failing tests**

Append to `browser-test/logic/song.mjs`, before `uninstallMockEngine();`:

```javascript
    /* ── the bottom-row readout ──────────────────────────────────────────── */
    const { songBandTokens } = await import('../../dist/esm/seq/song.js');
    /* A stand-in for fontWidth: every label two pixels per character, so the
     * window maths is checked rather than the font's metrics. */
    const w2 = (s) => s.length * 2;

    const short = songBandTokens([0, 1, 1, 2], 1, 1000, w2);
    eq('scene numbers are 1-based, matching the step buttons',
       short.tokens.map((t) => t.label).join(' '), '1 2 2 3');
    eq('both presses of the current entry are marked',
       short.tokens.map((t) => (t.current ? '*' : '.')).join(''), '.**.');
    ok('a song that fits has no leading ellipsis', short.leading === false);

    const first = songBandTokens([0, 1, 2], 0, 1000, w2);
    eq('the first entry is the current one at pos 0',
       first.tokens.map((t) => (t.current ? '*' : '.')).join(''), '*..');

    /* Overflow: the current entry and the one after it must stay on screen,
     * and the window fills leftward with as much history as fits. */
    const many = [0, 1, 2, 3, 4, 5, 6, 7];
    const win = songBandTokens(many, 6, 12, w2);   // 12px ≈ 4 two-px labels + gaps
    ok('the current entry survives the window',
       win.tokens.some((t) => t.current && t.label === '7'));
    ok('so does the entry after it',
       win.tokens.some((t) => t.label === '8'));
    ok('a windowed song says so', win.leading === true);
    ok('the window really is smaller than the song', win.tokens.length < many.length);

    eq('an empty song has no tokens', songBandTokens([], 0, 1000, w2).tokens.length, 0);
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run build:browser && node browser-test/logic.mjs
```
Expected: FAIL — `songBandTokens is not a function`.

- [ ] **Step 3: Implement the tokens and the visibility rule**

Append to `src/seq/song.ts`:

```typescript
import { seqState } from './state.js';

export interface SongToken { label: string; current: boolean; }

/* Where the current entry ends: a run of identical presses is ONE entry, so
 * both `2`s of `1 2 2 3` are highlighted together. */
function entryEnd(scenes: number[], pos: number): number {
    let i = pos;
    while (i < scenes.length && scenes[i] === scenes[pos]) i++;
    return i;
}

/* The song as display tokens, windowed to `maxW` pixels so the entry now
 * playing and the one after it are always on screen — you should never have to
 * guess where in the arrangement you are. The window then fills leftward with
 * as much history as fits, so what you just heard stays visible too.
 *
 * `width` is injected rather than imported so this is testable without the
 * font, and so the caller measures with the same function it draws with. */
export function songBandTokens(
    scenes: number[], pos: number, maxW: number, width: (s: string) => number,
): { tokens: SongToken[]; leading: boolean } {
    if (scenes.length === 0) return { tokens: [], leading: false };
    const p = Math.min(Math.max(pos, 0), scenes.length - 1);
    const curFrom = p;
    const curTo = entryEnd(scenes, p);
    /* The last index that MUST be visible: the end of the entry after the
     * current one, or the end of the song when the current entry is last. */
    const must = Math.min(scenes.length, entryEnd(scenes, Math.min(curTo, scenes.length - 1))) - 1;

    const label = (i: number) => String(scenes[i] + 1);
    const GAP = 2;
    let from = must;
    let used = width(label(must));
    while (from > 0) {
        const next = used + GAP + width(label(from - 1));
        if (next > maxW) break;
        used = next;
        from--;
    }
    /* The current entry outranks history: if the window could not reach back to
     * it, drop history entirely and start there. */
    if (from > curFrom) from = curFrom;

    const tokens: SongToken[] = [];
    for (let i = from; i <= must; i++) {
        tokens.push({ label: label(i), current: i >= curFrom && i < curTo });
    }
    return { tokens, leading: from > 0 };
}

/* The band shows while Shift is held in Session view — so it appears the
 * instant you press Shift, empty, telling you the row has become the scenes —
 * and for as long as a song is active. Outside Session view it never draws. */
export function songBandVisible(): boolean {
    if (!seqState.sessionMode) return false;
    return appState.shiftHeld || seqState.songScenes.length > 0;
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npm run build:browser && node browser-test/logic.mjs
```
Expected: PASS.

- [ ] **Step 5: Draw the band**

Append to `src/seq/render.ts` (it already imports `fontPrint` and `W`; add `fontWidth` to the font import and import from `./song.js` and `../app/state.js`):

```typescript
/* Song band: the bottom row in Session view. Inverted, like the header
 * announcement — `SONG` then the scene numbers in the order they were pressed,
 * with the entry now playing boxed out of the band so you can see where in the
 * arrangement you are.
 *
 * Unlike the Loop strip this does NOT repaint every tick: nothing in it moves
 * between scene changes. songBandTick draws only when the content changed or
 * the view underneath was repainted over it. */
const SONG_Y = 55;      // band top; the display is 64 tall and the band is 9
const SONG_GAP = 2;

let lastSongSig = '';

function songBandSig(): string {
    return seqState.songScenes.join(',') + '@' + seqState.songPos;
}

export function drawSongBand(): void {
    fill_rect(0, SONG_Y, W, 9, 1);              // inverted band
    let x = 2;
    fontPrint(x, SONG_Y + 1, 'SONG', 0);
    x += fontWidth('SONG') + SONG_GAP * 2;
    const avail = W - x - 2;
    const { tokens, leading } = songBandTokens(
        seqState.songScenes, seqState.songPos, avail, fontWidth);
    if (leading) {
        fontPrint(x, SONG_Y + 1, '.', 0);
        x += fontWidth('.') + SONG_GAP;
    }
    for (const t of tokens) {
        const w = fontWidth(t.label);
        if (x + w > W - 1) break;
        if (t.current) {
            /* Boxed rather than a second inversion: the band is already
             * inverted, so the current entry is a hole punched back through it. */
            fill_rect(x - 1, SONG_Y, w + 2, 9, 0);
            fontPrint(x, SONG_Y + 1, t.label, 1);
        } else {
            fontPrint(x, SONG_Y + 1, t.label, 0);
        }
        x += w + SONG_GAP;
    }
}

/** Draw the band if it needs drawing. `viewRepainted` is true on a tick whose
 *  frame redrew the view underneath, which paints over the band. */
export function songBandTick(viewRepainted: boolean): void {
    if (!songBandVisible()) { lastSongSig = ''; return; }
    const sig = songBandSig();
    if (!viewRepainted && sig === lastSongSig) return;
    lastSongSig = sig;
    drawSongBand();
}

export function resetSongBand(): void { lastSongSig = ''; }
```

- [ ] **Step 6: Hook it into the app tick**

In `src/app/tick.ts`:

1. Add `songBandTick` to the existing import from `../seq/render.js` (the one at line ~70 that already pulls `drawLoopStrip, drawLoopHeader, drawSeqToast, drawSeqHeader`).
2. Declare `let viewRepainted = false;` immediately before the big render condition (`if (modelDirty || masterDirty || appState.dirty || …) {`).
3. Set `viewRepainted = true;` as the first statement inside that block.
4. After the existing Loop-strip block at the end of the tick, add:

```typescript
    /* Song band: Session view only, and drawn on its own schedule — on the
     * frames the view underneath repainted over it, and otherwise only when
     * the arrangement or the position in it changed. A running song must cost
     * nothing per tick. */
    if (engineReady() && !seqToastActive() && !jogToastShown && !isBrowseView
        && !captureOverlayActive()) {
        songBandTick(viewRepainted);
    }
```

- [ ] **Step 7: Add the screenshot baselines**

In `browser-test/screenshot.mjs`, add two entries to `PRESETS` after `'loop_strip_midclip', 'loop_strip_outside', 'loop_header',`:

```javascript
    'song_band', 'song_band_overflow',
```

and the two cases beside `case 'loop_header':`, importing `drawSongBand` and `resetSongBand` from `../dist/esm/seq/render.js` alongside the existing `drawLoopStrip` import:

```javascript
        case 'song_band': {
            // Session view with a four-scene song, playing the doubled second
            // scene: `SONG 1 2 2 3` with both 2s boxed as one entry.
            resetSeqState(); resetSongBand();
            seqState.sessionMode = true;
            seqState.songScenes = [0, 1, 1, 2];
            seqState.songPos = 1;
            lastRender = () => { renderKnobsView(model.getViewModel()); drawSongBand(); };
            lastRender();
            break;
        }
        case 'song_band_overflow': {
            // A song longer than the row: the window keeps the current entry
            // and the next one on screen behind a leading ellipsis.
            resetSeqState(); resetSongBand();
            seqState.sessionMode = true;
            seqState.songScenes = [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3];
            seqState.songPos = 9;
            lastRender = () => { renderKnobsView(model.getViewModel()); drawSongBand(); };
            lastRender();
            break;
        }
```

- [ ] **Step 8: Generate and eyeball the baselines**

```bash
npm run build:browser && node browser-test/screenshot.mjs --update
```

Then **look at** `browser-test/screenshots/baseline/song_band.png` and `song_band_overflow.png` and confirm: the band is at the bottom, `SONG` is legible, the current entry is boxed, and the overflow case shows a leading `.` with the current entry visible. If the text collides with the band edges, adjust `SONG_Y` / `SONG_GAP` and regenerate.

- [ ] **Step 9: Add the steady-state performance assertion**

In `browser-test/perf.mjs`, add a check in the same style as its neighbours (read the file first and follow its existing threshold/report idiom):

```javascript
/* A running song must cost nothing per tick. The band's content only changes on
 * a scene switch, so a steady tick with the view already painted must not draw. */
{
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const { songBandTick, resetSongBand } = await import('../dist/esm/seq/render.js');
    resetSeqState(); resetSongBand();
    seqState.sessionMode = true;
    seqState.songScenes = [0, 1, 1, 2];
    seqState.songPos = 1;

    let rects = 0;
    const prev = globalThis.fill_rect;
    globalThis.fill_rect = () => { rects++; };
    songBandTick(true);            // the view repainted → the band must redraw
    const afterFirst = rects;
    for (let i = 0; i < 100; i++) songBandTick(false);
    globalThis.fill_rect = prev;

    if (afterFirst === 0) { console.log('FAIL: the song band never drew'); process.exitCode = 1; }
    else if (rects !== afterFirst) {
        console.log(`FAIL: song band drew ${rects - afterFirst} rect(s) over 100 idle ticks`);
        process.exitCode = 1;
    } else {
        console.log('PASS: song band is free when nothing changed');
    }
}
```

- [ ] **Step 10: Run everything**

```bash
npm test
```
Expected: all eight suites PASS, 0 failures.

- [ ] **Step 11: Commit**

```bash
git add src/seq/song.ts src/seq/render.ts src/app/tick.ts \
        browser-test/logic/song.mjs browser-test/screenshot.mjs browser-test/perf.mjs \
        browser-test/screenshots/baseline/song_band.png \
        browser-test/screenshots/baseline/song_band_overflow.png
git commit -m "$(cat <<'EOF'
seq: the bottom row says what the song is and where it is

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Recording across a scene switch, docs, and the device suite

**Files:**
- Modify: `engine/crates/seq-core/src/engine.rs` (one test)
- Modify: `MANUAL.md` (a subsection in §5 and rows in §8)
- Modify: `README.md` (one Features bullet)
- Modify: `CHANGELOG.md`
- Modify: `scripts/test-seq.sh` (device checks)

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the recording test**

Recording already targets `rec_track`'s *playing* slot and extends it bar by bar, so a scene switch should carry the take into the new clip with no new code. Pin it. Append to `mod tests` in `engine/crates/seq-core/src/engine.rs`, matching the neighbouring recording tests' idiom for arming and feeding notes (search for `fn recording_stores_untransposed_pitch` and copy its setup):

```rust
#[test]
fn a_take_follows_the_song_into_the_next_scene() {
    let mut e = Engine::new();
    e.tracks[0].clips[0].length_steps = 16;
    e.tracks[0].clips[1].length_steps = 16;
    e.song_start(0);
    e.song_add(1);

    let mut out = Vec::new();
    e.service_tick(&mut out);
    e.rec(0);                              // arm recording on track 0
    run_bars(&mut e, 1);

    assert_eq!(e.tracks[0].playing_slot, Some(1), "the song moved on");
    assert_eq!(e.tracks[0].active_clip, 1,
               "and the take follows into the clip that is now playing");
}
```

Check `rec`'s real signature first — it may take a count-in argument:

```bash
grep -n "pub fn rec" engine/crates/seq-core/src/engine.rs
```

Adjust the call to match.

- [ ] **Step 2: Run it**

```bash
cd engine && cargo test -p seq-core a_take_follows
```
Expected: PASS (no production change needed). **If it fails**, that is a real finding — the scene switch is stranding the take. Fix it in `song_bar`/`launch_scene` before continuing, and say so in the commit message.

- [ ] **Step 3: Document it in MANUAL.md**

Add a subsection to §5 immediately after the `### Tracks and groups` section (find it with `grep -n "^### Tracks and groups" MANUAL.md`):

```markdown
### Scenes & Song mode

A **scene** is a column of the clip grid — the same clip slot on all 16 tracks,
not just the four you can see. **Hold Shift in Session view** and the step row
becomes the scene launcher: the eight buttons printed **1, 3, 5 … 15** are
scenes 1-8, and the even ones are dark because they do nothing.

Pressing a scene launches that whole column. Tracks with a clip there start it
(on the next bar, like any clip launch); **tracks with an empty slot stop** — a
scene is a snapshot of what plays, so what is not in the column goes quiet.

**Building a song.** Keep holding Shift and press more scenes. The first press
of a hold starts a new song; every press after it adds to the end. Press the
same scene twice and it plays twice as long. Let Shift go and the song is what
you pressed — it plays through in order and then **loops**.

Each scene lasts as long as its longest clip, rounded up to whole bars. One bar
before a switch the next scene's clips start flashing in the grid, the same way
a clip you have just launched flashes while it waits for the bar.

The bottom of the screen shows `SONG` and the scene numbers, with the one
playing boxed. It appears as soon as you press Shift in Session view and stays
up while a song is running.

**Ending a song.** Launch any clip by hand and the song is gone — what is
playing keeps playing, it just stops moving on by itself. Pressing Shift and a
scene again starts a fresh song.

Stop and Play restarts the song from the beginning. The song is saved with your
Set.

You can record while a song plays; the take follows the song into whichever
clip is playing on the track you are recording.
```

Add to the `### Shift + Step shortcuts` table in §8 (find it with `grep -n "^### Shift + Step shortcuts" MANUAL.md`) — match the table's existing column layout:

```markdown
| Shift + Step 1/3/5/7/9/11/13/15 | Scenes 1-8 — launch a column, or build a song (Session view only) |
```

- [ ] **Step 4: Document it in README.md**

Add one bullet to the `## Features` list, in the sequencer group:

```markdown
- **Scenes & Song mode** — hold Shift in Session view to launch a whole column
  across all 16 tracks, or press several scenes to build a looping song. Each
  scene plays for as long as its longest clip; press one twice to hold it twice
  as long.
```

- [ ] **Step 5: Add a CHANGELOG entry**

Add to the top (unreleased) section of `CHANGELOG.md`, matching the file's existing entry style:

```markdown
### Added
- **Scene launching** — Shift + the odd step buttons in Session view launches a
  whole clip column across all 16 tracks. Empty slots stop their track.
- **Song mode** — keep holding Shift and press more scenes to build a looping
  arrangement. A repeated scene plays twice as long; the next scene is queued a
  bar early with the usual launch flash; the song is saved with the Set and
  restarts from the top on Play. Launching a clip by hand ends it.
```

- [ ] **Step 6: Extend the device suite**

In `scripts/test-seq.sh`, add a check before the final summary block, following the file's existing `pass`/`fail`/`qgrep` idiom. Build the song with **engine commands**, not MIDI injection — the harness notes in `CLAUDE.md` are explicit that inject to overtake is state-flaky for this, and `seqCmd` is the reliable path:

```bash
# Song mode: two one-bar scenes sequenced. Driven with engine commands (MIDI
# inject to overtake drops events unpredictably), and read back from `status`,
# so this asserts the ENGINE's arrangement rather than the gesture that builds
# it — browser-test/logic/song.mjs is the authoritative proof of the gesture.
seq_cmd "song 0"
seq_cmd "songadd 1"
SONG=$(seq_status_field song)
if [[ "$SONG" == 0:0,1 ]]; then
    pass "Song built: two scenes reported as $SONG"
else
    fail "Song reported '$SONG'; expected '0:0,1'"
fi
```

Read the top of `scripts/test-seq.sh` first and use whatever helpers it actually defines for sending a command and reading a status field — the names above are placeholders for that file's real ones:

```bash
grep -n "^seq_cmd\|^seq_status\|host_module_get_param\|seqCmd" scripts/test-seq.sh | head -10
```

- [ ] **Step 7: Run the full local gate**

```bash
cd engine && cargo test && cd .. && npm test
```
Expected: `cargo test` 0 failures; all eight local suites PASS.

- [ ] **Step 8: Run the device suites if the device is reachable**

```bash
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && ./scripts/test-seq.sh \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```

`test-seq.sh` builds and deploys `dsp.so`, which this feature changes, so it must be the suite that runs. Device tests are flaky by design note: run the suite **once**. If it fails, check the output for a real regression in scene/song behaviour; if it points elsewhere, report the failure to the user and move on. **If the device is offline, report that to the user in CAPS.**

- [ ] **Step 9: Commit and push**

```bash
git add engine/crates/seq-core/src/engine.rs MANUAL.md README.md CHANGELOG.md scripts/test-seq.sh
git commit -m "$(cat <<'EOF'
docs: scenes and songs, and the device echo for them

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
git push
```

---

## Self-review notes

Checked against the spec:

- §1 truth in the engine → Tasks 1-3 (all state and scheduling in `seq-core`; the UI only mirrors).
- §2 scene launching, empty-slot stop with no extra gating, scene length → Task 1.
- §3 scheduling, repeats, the same-scene guard, loop, play/stop, clip-launch deletion → Task 2.
- §4 the Shift gesture, first-press-replaces, the scene row's three LED states → Tasks 4-5.
- §5 the screen band, visibility rule, overflow window, bare digits, repaint-on-change → Task 6.
- §6 persistence → Task 3.
- §7 recording → Task 7 Step 1.
- §8 testing → the cargo tests are spread across Tasks 1-3 and 7; `logic/song.mjs` across 4-6; app-loop in 5; screenshot and perf in 6; the device suite in 7.

**Deviation from the spec, deliberate:** the spec named a `scene <slot>` command. There is none. `song <slot>` replaces the song and launches the scene, which for a single press is identical behaviour — the spec's own §3 argues a one-scene song *is* a hand-launched scene. A separate verb would be dead surface with a third classification to keep correct. Update the spec's §2 command line to match when this ships.
