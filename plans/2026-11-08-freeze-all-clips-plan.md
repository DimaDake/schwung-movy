# Freeze v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a freeze records every clip of a track, behind a Shift + track menu,
with a waveform screen, black pads, a big unfreeze toast and Loop-mode cuts.

**Architecture:** seq-core owns the rule (whole-track lock, recorded windows,
loop position per slot, the capture "swap"); movy-dsp's bank holds one loop per
clip slot and sequences the captures; the UI only draws and asks.

**Tech Stack:** Rust (seq-core, movy-dsp), TypeScript UI, node test suites.

**Spec:** `plans/2026-11-08-freeze-all-clips-design.md` (approved).

## Global Constraints

- Loop cap 60 s per clip; all loops together **200 MB** (`MEM_BUDGET = 200 << 20`).
- Nothing on the audio thread allocates a loop buffer, frees one, does I/O or
  computes peaks (v1 discipline: `freeze_mem.rs`, `chain_reaper.rs`).
- `CLIPS_PER_TRACK = 8` (seq-core `track.rs`).
- Copy: menu rows `FREEZE T3` / `UNFREEZE T3`; unfreeze arm `CONFIRM? STOPS PLAY`;
  progress `FREEZING T3 2/5 40%`; big toast `T3 IS FROZEN` + `SHIFT + TRACK TO UNFREEZE`.
- ENGINE_VERSION bump to **0.119.0** in `engine/crates/movy-dsp/src/lib.rs` and
  `src/seq/constants.ts` (once, in the first engine task that lands).
- Files under `src/` stay ≤ 200 lines (router.ts / tick.ts already over: add
  call sites only, logic in `src/seq/freeze*.ts`).

## Review Focus

1. **Song mode / a scene fires while the unheard clips record** → the track's
   launch is deferred until the freeze ends, then applies on the next bar
   (Task 2 test `a_launch_during_a_swap_waits_for_the_swap_out`).
2. **Back in the middle of clip 3 of 5** → chain stays live, every loop freed,
   the track plays its original clip in phase (Task 5 test
   `back_mid_way_restores_the_heard_clip_in_phase_and_frees_every_loop`).
3. **Loop-mode end moved past the recorded end, then back inside** → refused,
   then accepted, the loop never plays unrecorded audio (Task 1 test
   `a_window_may_shrink_inside_the_recording_never_grow_past_it`).
4. **A version restore with the same synth but another preset** → opens live
   (Task 6 test `another_preset_opens_live`).
5. **A Set with 16 frozen tracks opens** → frozen, no synth load queued, peaks
   arrive without an audio-thread hitch (Task 7 test
   `peaks_are_computed_on_the_saver_thread`).

---

### Task 1: seq-core — whole-track lock, recorded windows, per-slot position

**Files:**
- Modify: `engine/crates/seq-core/src/engine/freeze_lock.rs`
- Modify: `engine/crates/seq-core/src/command.rs` (the refusal hook passes args)

**Interfaces:**
- Produces:
  - `pub struct RecWindow { pub start_ticks: u32, pub len_ticks: u32 }` (CLIP ticks)
  - `FreezeLock::set_track(t, windows: Option<[Option<RecWindow>; CLIPS_PER_TRACK]>)`
    (None = unlocked); `FreezeLock::locked(t) -> bool`; `FreezeLock::window(t, slot) -> Option<RecWindow>`
  - `pub struct LoopPos { pub slot: usize, pub pos: f64, pub win_start: f64, pub win_len: f64 }`
    — all in CLOCK ticks, measured from the RECORDED window start; `pos` lies in
    `[win_start, win_start + win_len)`.
  - `Engine::loop_position(t) -> Option<LoopPos>` (replaces the `f64` one):
    `None` while stopped, unlocked, or the playing slot has no recorded window.
  - `Engine::clip_fingerprint(t, slot)` no longer hashes `length_steps` /
    `loop_start_steps`; `Engine::clip_window(t, slot) -> Option<RecWindow>`.
  - `Engine::freeze_len_ticks` unchanged.

- [ ] **Step 1: failing tests** in `freeze_lock.rs` tests:
  - `every_slot_of_a_frozen_track_refuses_edits`: lock T2 with windows for
    slots 0 and 3; `tog 2 …` with active clip 3 refused; `clipsel` to an EMPTY
    slot 5 then `tog` refused (a new clip on a frozen track is an edit).
  - `a_window_may_shrink_inside_the_recording_never_grow_past_it`: recorded
    window start 0 len 64 steps-worth of ticks; `loop 2 4 8` accepted (start
    later, shorter); `loop 2 0 32` (len 32 steps > 16 recorded? use the clip's
    real steps) refused and counted in `frzr`; `clen` shorter accepted, longer
    refused.
  - `loop_position_is_measured_from_the_recorded_start`: after `loop 2 4 8`
    on a 16-step recording at 1/1, `pos` runs from `4*TICKS_PER_STEP` and wraps
    at `12*TICKS_PER_STEP`; `win_start == 4*TPS`, `win_len == 8*TPS`. Repeat at
    `cscl 1 2` (clock ticks double).
  - `the_fingerprint_ignores_the_window`: `loop` change leaves the print.
- [ ] **Step 2:** `cd engine && cargo test -p seq-core freeze_lock` → FAIL.
- [ ] **Step 3:** implement. `freeze_refuses(verb, args)` gets the parsed
  integer args; `loop` / `clen` on a locked track are allowed only when the
  ACTIVE clip's new window `[s, s+l)` lies inside `window(t, active)`; every
  other clip-edit verb on a locked track is refused (track-level, any slot).
  `loop_position`: `offset = (cur_start - rec_start)` in clip ticks, `rel` as
  today within the CURRENT window, then `pos = (rel + offset) * den/num`,
  `win_start = offset*den/num`, `win_len = cur_len*den/num`.
- [ ] **Step 4:** `cargo test -p seq-core` → PASS (all 346+).
- [ ] **Step 5:** commit `Freeze v2: seq-core locks the whole track; windows may shrink`.

### Task 2: seq-core — the capture swap

The synth records the other clips while the track's real playhead is lent to
the capture. The heard loop's position is kept by movy-dsp meanwhile (Task 5).

**Files:** Modify `engine/crates/seq-core/src/engine.rs` (+ `engine/freeze_lock.rs`
for the swap flag).

**Interfaces:**
- Produces:
  - `Engine::freeze_swap_in(t, slot) -> bool`: track `t` plays `slot` from its
    loop start NOW (the same resets a queued launch does at a bar: factor that
    block of `service_tick` into `Track::launch_now(slot)`), `active_clip`
    unchanged, gates of `t` closed first. Sets `freeze_lock.swapped(t) = true`.
  - While `swapped(t)`: `service_tick` leaves `t`'s `queued_slot`,
    `pending_stop`, `pending_select` untouched (they resolve after swap-out).
  - `Engine::freeze_swap_out(t, slot: Option<usize>, rel_clock: u64)`: clears the
    flag; `Some(slot)` → plays `slot` with `pos_tick`/`scale_acc` set so
    `loop_position(t).pos == rel_clock` (+ the clock's fraction):
    `pos - win_start_clip = (rel*num)/den`, `scale_acc = (rel*num)%den`;
    `None` → `playing_slot = None`.
  - `Engine::play_alone_slot(t, slot) -> bool` (v1's `play_alone` takes a slot).
  - `Engine::clock_ticks_f64() -> f64`: `master_tick + clock.tick_fraction()`.
- [ ] **Step 1: failing tests** (`engine.rs` tests):
  `swap_in_plays_the_slot_from_its_loop_start_now`,
  `a_launch_during_a_swap_waits_for_the_swap_out`,
  `swap_out_lands_the_heard_clip_in_phase` (play slot 0 at 1/1 and at 1/2 speed,
  note `loop_position` vs `clock_ticks_f64` relation, swap in slot 1 for N
  blocks, swap out with the computed rel; `loop_position(t)` matches an
  un-swapped reference engine within 1e-6).
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** `cargo test` PASS.
- [ ] **Step 5:** commit.

### Task 3: movy-dsp `freeze.rs` — a player inside a window

**Files:** Modify `engine/crates/movy-dsp/src/freeze.rs`.

**Interfaces:**
- `Player::render(&mut self, out, at: Option<LoopAt>, bpm_x100)` where
  `pub struct LoopAt { pub pos: f64, pub win_start: f64, pub win_len: f64 }`
  (clock ticks, as `LoopPos` minus the slot). The cursor wraps at the window's
  end frame back to its start frame — inside the block, never by a resync.
- `pub fn peaks(samples: &[i16], cols: usize) -> Vec<u8>`: max |sample| of each
  column scaled to 0..=255 (used OFF the audio thread, Task 7).
- [ ] **Step 1: failing tests:** `a_sub_window_plays_the_recorded_frames_bit_for_bit`
  (window = frames [W0, W1) of a ramp buffer; three passes at rate 1 equal the
  ramp slice repeated, no frame outside it), `a_block_across_the_window_end_wraps_inside_it`,
  `peaks_of_a_ramp`.
- [ ] **Steps 2–4:** FAIL → implement → `cargo test -p movy-dsp freeze::` PASS.
- [ ] **Step 5:** commit.

### Task 4: movy-dsp `freeze_bank.rs` — one loop per clip, a job per track

**Files:** Modify `freeze_bank.rs`, `freeze_bank_tests.rs`.

**Interfaces:**
- Per track: `loops: [Option<Player>; CLIPS_PER_TRACK]`, `windows` (the
  `RecWindow` each loop was recorded over), a `Job` while freezing:
  `{ heard: Option<usize>, todo: [Option<(usize, LoopMap)>; 8], next: usize, cur: Pending|Capturing }`.
- `begin_track(t, heard: Option<usize>, clips: &[(usize, LoopMap, RecWindow)]) -> Result<(), &'static str>`:
  refuses `busy`, `long` (any clip > 60 s), `mem` (sum + `bytes()` > 200 MB)
  BEFORE asking for any buffer; orders `heard` first, then slot order. One
  buffer requested at a time (the next is asked when the current finishes).
- `set_frame(pos: impl Fn(usize) -> Option<LoopPos>, heard_at: impl Fn(usize) -> Option<LoopAt>, muted, bpm)`.
- `tap(t, block, frames) -> Option<Outcome>`; `Outcome::{ClipDone { slot, next: Option<usize> }, Captured, Cancelled(_)}`
  — `ClipDone` tells movy-dsp to swap the next slot in.
- `stands_in(t) -> bool`: a loop is mixed instead of the chain (Frozen,
  Thawing, or a Job whose heard loop is done). `silences_chain(t)`: Frozen/Thawing only.
- `play(t, out)` picks `loops[pos.slot]` (Frozen) or `loops[heard]` at
  `heard_at` (Job); no loop for the slot → silence.
- `progress(t) -> Option<(u8 done, u8 total, u8 pct)>`; `frozen_loops(t)` for
  the writer; `install_track(t, loops, windows, snap)`.
- [ ] **Step 1: failing tests:** `begin_refuses_over_200_mb_before_any_buffer`,
  `the_heard_clip_is_recorded_first_then_slot_order`,
  `a_finished_heard_loop_stands_in_while_the_rest_record`,
  `cancel_frees_every_loop_of_the_job` (count `Gone` retired), `an_empty_slot_plays_silence`.
- [ ] **Steps 2–4**, **Step 5:** commit.

### Task 5: movy-dsp — orchestration (`lib.rs`, `chain_slots.rs`)

**Files:** Modify `lib.rs` (`freeze_track`, `render`, `frz`/`frzx`/`unfrz`),
`chain_slots.rs` (freeze section), `lib_freeze_tests.rs`. Bump ENGINE to 0.119.0.

**Behaviour:**
- `freeze_track(t)`: refusals as v1 (`noclip` = no non-empty clip, `muted`,
  `rec`, `speed` per clip); builds `(slot, LoopMap, RecWindow)` for every
  non-empty clip; playing → `heard = playing_slot` (must be non-empty).
  Stopped → `heard = None`, each clip via `play_alone_slot` with the output
  silenced (`freeze_silent`, v1).
- On `ClipDone{next: Some(k)}` with a heard loop: record the heard anchor
  (`heard_pos` at this block end, `clock_ticks_f64()`), `freeze_swap_in(t, k)`.
  Heard position each block = `(anchor_pos - win_start + (clock_now - anchor_clock)).rem_euclid(win_len) + win_start`.
  Stopped: `play_alone_slot(t, k)` again.
- Mix: `freeze_tap` runs before the mix; then for `stands_in(t)` the loop
  OVERWRITES the scratch (chain still renders while the job runs).
- `Captured`: snapshot + retire chain (v1 `freeze_finish`), then
  `freeze_swap_out(t, heard, rel)` (playing) or stop (stopped).
- Cancel (Back / stop / Set change): `freeze_swap_out(t, heard, current heard rel)`,
  every loop retired, chain stays.
- `freeze_admits` stays: a locked/job track takes only note-offs.
- Status `frzc=<t>:<done>/<total>:<pct>`.
- [ ] **Step 1: failing tests** (`lib_freeze_tests.rs`, fake chain as v1's
  tests): `freezing_three_clips_while_playing_ends_frozen_with_three_loops`,
  `back_mid_way_restores_the_heard_clip_in_phase_and_frees_every_loop`,
  `stopped_records_every_clip_silently_and_stops_again`,
  `a_scene_after_the_freeze_plays_that_clips_loop`.
- [ ] **Steps 2–4**; `cargo test` all PASS. **Step 5:** commit.

### Task 6: persistence — manifest v3, chain fingerprint

**Files:** `freeze_files.rs`, `chain_slots.rs` (`freeze_manifest`,
`freeze_install`), `lib.rs` (open path).

- Manifest `movy-freeze 3`: per track one line
  `T <track> <bpm_x100> <rate> <chain_print hex> <modules>`, then per clip
  `C <track> <slot> <len_ticks> <frames> <win_start> <win_len> <clip_print hex>`.
  WAV `freeze/t<T>-s<S>.wav`. v2 manifests are no manifest (open live).
- `chain_print`: FNV-1a over the snapshot pairs sorted by key (the same pairs
  `chain_state::slot_params(doc, t)` returns at open).
- Open: track frozen only if modules + chain_print match and every non-empty
  clip has a `C` line with matching clip_print and a recorded window containing
  its current window; else opens live (log why).
- [ ] **Step 1: failing tests:** `manifest_v3_round_trips`, `another_preset_opens_live`,
  `a_clip_added_after_the_freeze_opens_live`, `a_shrunk_window_opens_frozen`.
- [ ] **Steps 2–5.**

### Task 7: peaks for the waveform

**Files:** `freeze_files.rs` (compute on read and on the `Freeze` write job,
saver thread), `set_saver.rs` (hand peaks back like `take_frozen`), `lib.rs`
(store `peaks[t][slot]: Vec<u8>`, 256 cols; answer get `frzpk <t>:<slot>` →
`<win_start> <win_len> <len> <hex peaks>`, ticks in clock units), and the
status field `frzp=<seq>` bumped when any peaks change.
- [ ] **Step 1: failing tests:** `peaks_are_computed_on_the_saver_thread`
  (the audio-side call path never calls `peaks()`: assert via the job result),
  `frzpk_answers_the_window_and_peaks`.
- [ ] **Steps 2–5.**

### Task 8: UI — the track menu

**Files:** Create `src/seq/track-menu.ts` (state: open track, armed),
`src/seq/track-menu-vm.ts`; modify `src/renderer/flags-view.ts`
(`renderFlagsView(vm, title = 'SETTINGS')`), `src/app/leave-modal.ts` (drop
the `freeze` kind), `src/midi/router.ts` (Shift + track button → open menu for
that track, active track unchanged; jog click / Back), `src/app/tick.ts`
(draw it over everything), `src/seq/freeze.ts` (drop `freezeTrackTap`).
- Row: `FREEZE T3` (hint `Records every clip. Saves CPU.`) or `UNFREEZE T3`
  (hint `Brings the synth back.`). Unfreeze while playing: first click arms
  (`CONFIRM? STOPS PLAY` as the value), second click sends `unfrz`. Moving off
  the row or Back disarms.
- [ ] **Step 1: failing logic tests** (`browser-test/logic/freeze.mjs`):
  `shift + track opens the menu for that track and leaves the active track`,
  `jog click on FREEZE sends frz 4`, `unfreeze while playing needs two clicks`,
  `double tap no longer opens anything`. Screenshot baseline `track_menu`.
- [ ] **Steps 2–5** (`npm test`; `node browser-test/screenshot.mjs --update`
  for the new baseline only).

### Task 9: UI — capture and frozen LEDs

**Files:** `src/seq/freeze-busy.ts`, `src/seq/freeze-pads.ts`, `src/app/tick.ts`,
`src/seq/led-cache.ts`, `src/seq/freeze.ts` (parse `frzc` with `done/total`).
- Busy: pads show the scrolling animation (`frozenPadColor`) — ONLY while
  busy; toast `FREEZING T3 2/5 40%`.
- Frozen track: pads black (0).
- Old-branch idea 2: busy writes go through the caches as sent; at busy end do
  NOT reset `initLedsDone`; each painter repaints from its cache diff.
- [ ] **Step 1: failing tests:** logic `a frozen track's pads are black`,
  `pads animate only while busy`; perf `busy end repaints in at most two frames`
  (existing perf harness, LED count per tick).
- [ ] **Steps 2–5.**

### Task 10: UI — the waveform screen

**Files:** Create `src/seq/freeze-wave.ts` (fetches `frzpk` on `frzp` change
or slot/window change, keeps per track/slot), `src/renderer/frozen-view.ts`
(rewrite: header `T3 FROZEN`, bank bar, waveform of the PLAYABLE part —
columns of the peaks between `win_start` and `win_start+win_len` stretched to
the screen width — and a 1-px playhead from the track's position; `EMPTY CLIP`
for a slot without a loop; no instruction text).
- Playhead: the finest per-track position the status already carries; the
  renderer stays pure (`renderFrozenView(vm)`).
- Repaint: the wave only on data change; the playhead column only when it moves
  (perf).
- [ ] **Step 1: failing tests:** screenshot `frozen_view` (update baseline),
  `frozen_view_cut` (window shrunk), logic `the waveform shows only the playable part`,
  perf `frozen view frame cost` (fill_rect count bound).
- [ ] **Steps 2–5.**

### Task 11: UI — the big toast and the doors

**Files:** Create `src/renderer/big-toast.ts`, `src/seq/freeze-toast.ts`;
modify `src/seq/freeze.ts` (`freezeGuard` and `frzr` → big toast),
`src/midi/router.ts` (knob touch 0–7 and jog press on a frozen track off MIX →
big toast; old-branch idea 1: a frozen track focused/just frozen leaves its
module page for the chain level, except MIX; idea 3: browser guard uses
`browsedTrack()` from `src/browser/state.ts` — port from commit `20ae77ad`).
- ~1.5 s (TTL in ticks via the existing toast clock), centred, two lines.
- [ ] **Step 1: failing tests:** logic `knob touch on a frozen track shows the big toast`,
  `MIX slot knob touch does not`, `a step press shows the same big toast`,
  `a frozen track focused inside a synth page goes to the chain level`,
  `send FX pick in the browser while a frozen track is focused` (port);
  screenshot `freeze_big_toast`.
- [ ] **Steps 2–5.**

### Task 12: UI — Loop mode on a frozen track

**Files:** `src/seq/router.ts` (the step guard lets Loop-mode window gestures
through to the engine), `src/seq/loop-mode.ts` if it guards itself.
- The engine decides (Task 1); a refusal comes back as `frzr` → big toast.
- [ ] **Step 1: failing test:** logic `loop mode sends loop on a frozen track`.
- [ ] **Steps 2–5.**

### Task 13: docs, device scenario, gates

**Files:** `site/manual/sounds.md` (*Freezing a track*), `site/reference/controls.md`,
`CHANGELOG.md` [Unreleased], `test-device/scenarios/freeze.ts` (a two-clip
track, freeze while playing, scene to clip 2 plays its loop, Loop-mode cut, unfreeze),
`node scripts/site/build-assets.mjs`.
- [ ] `npm test`, `cargo test`, `scripts/vdev.sh tier 3`, device tier
  `freeze,smoke,mutes,sets` (audio thread changed → device required).
- [ ] Commit, push to main, `./scripts/deploy.sh`.
