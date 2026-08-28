# Record launch quantization (punch-in into an empty slot)

## Report

> On Move native, with a beat playing, I arm a new track and press Record before
> the loop brace reaches zero. The record button flashes and recording starts at
> the top of the first bar, so everything stays in sync. On movy, pressing Record
> starts recording straight away, so the bars are out of sync when I stop and
> press play again.

## Root cause

`Engine::toggle_record` (engine/crates/seq-core/src/engine.rs) — the punch-in
branch added in fb52513:

```rust
} else {
    // Punch-in: record now (no count-in).
    if self.rec_empty_start {
        let start = self.tracks[track].clips[a].loop_start_ticks();
        self.tracks[track].pos_tick = start;   // <-- mid-bar jump
    }
    self.recording = true;                     // <-- capture starts mid-bar
}
```

For a take that starts from an **empty** clip while the transport is already
running, the new clip's tick 0 is planted wherever in the bar the Rec press
landed. From then on that track's playhead is permanently out of phase with the
master bar grid and with every other playing clip, so the recorded content sits
at an arbitrary offset inside the clip. Stopping and playing again re-seeds every
track to its loop start, which is when the offset becomes audible.

Nothing in the engine defers a record start to the bar grid. Every *other* way a
clip becomes the playing clip while running is already bar-quantized:

- `launch_clip` → `queued_slot`, resolved in `service_tick` at
  `master_tick % TICKS_PER_BAR == 0`
- `ensure_selected_playing` (note entry) → same, with a comment that says exactly
  why: "Queuing (rather than starting mid-bar) makes the clip start cleanly from
  its loop start on the next bar boundary, in sync with the metronome and the
  other playing clips."

Record punch-in is the one path that skipped it.

## Fix

Queue the record start the same way a clip launch is queued.

1. **Engine** — new field `pending_rec: bool`.
   - `toggle_record`, transport running + `rec_empty_start`: set
     `queued_slot = Some(a)` and `pending_rec = true` instead of setting
     `playing_slot`/`pos_tick`/`recording`. The old clip keeps playing until the
     boundary, exactly like a queued launch.
   - Overdub punch-in (clip already has notes) stays **immediate** — it is
     already in phase and Live/Move punch in on the spot.
   - Stopped-transport arm (`count_in_left = TICKS_PER_BAR`) unchanged.
   - `service_tick` bar boundary: after the existing queued-launch/pending-stop
     resolution, `pending_rec` → `recording = true`.
   - Second Rec press while pending cancels: clear `pending_rec` and the
     `queued_slot` it queued.
   - `stop()` clears `pending_rec`.

2. **Pre-roll grace** — `preroll_offset` currently only covers the count-in. A
   note played within half a step *before* the pending start must anchor at the
   take's tick 0 rather than be dropped outright; extend it with the distance to
   the next bar boundary while `pending_rec`. The queued launch resets
   `t.cycle = 1`, so pending notes captured before the boundary need their
   `start_cycle` re-based at the boundary or `commit_rec_note`'s lap count wraps
   and the gate pins to its limit.

3. **Status / UI** — report the pending state as `cin=1` (`cin` already means
   "armed but not capturing yet"), so `seqState.countingIn`, the REC LED and
   `rec-pass.ts`'s arm grouping all work unchanged.

4. **LED** — the REC button blinks while armed-and-waiting (pending record *or*
   count-in) and is solid while actually capturing, matching the native "record
   button flashes" the report describes. `blinkPhase()` in `leds.ts` already
   exists for this.

5. `ENGINE_VERSION` 0.47.0 → 0.48.0 (engine/crates/movy-dsp/src/lib.rs +
   src/seq/constants.ts) so a redeployed DSP hot-reloads.

## Tests

- seq-core: `punch_in_into_empty_slot_waits_for_the_bar` — transport running,
  press Rec mid-bar, assert not recording and no playhead jump; run to the
  boundary, assert recording, `playing_slot`, and `pos_tick == loop_start`.
  Remove the fix → the mid-bar assertion fails.
- seq-core: a note recorded after a mid-bar arm lands on the grid position it was
  played at relative to the master bar (the alignment the report is about).
- seq-core: overdub punch-in still records immediately (no regression).
- seq-core: second Rec press while pending cancels cleanly.
- Existing `punch_in_records_into_empty_slot_and_extends` is updated to run to
  the boundary first — it encoded the old behaviour.
- Local logic tests for `transportRecColor` blink states; screenshot baselines
  unaffected (LED only).
