# Held notes survive the record stop

**Date:** 2026-08-09
**Status:** design → implementation

## The bug

Record a clip, play a note, and press Rec to stop while the pad is still down:
the note is gone. Not shortened — erased.

`Engine::toggle_record` (`engine.rs`) discards every note still being held:

```rust
if self.recording || self.count_in_left > 0 {
    self.recording = false;
    self.count_in_left = 0;
    self.rec_pending.clear();   // ← the bug
    return;
}
```

A live note only becomes a clip note in `live_note_off`, which finalizes it out
of `rec_pending`. Clearing that list leaves the later note-off nothing to match,
and `live_note_off` returns early on `!self.recording` anyway. `Engine::stop`
has the same `clear()`, so stopping the transport mid-note loses it too.

The UI is not implicated: `router-pads.ts` sends `nof` unconditionally, so the
engine does receive the release.

## What clip length does today (not part of the bug)

A first take auto-extends bar-by-bar at the wrap, so a clip stopped mid-bar is
already bar-aligned. "Finish the bar" is therefore about capturing more
playing, not about fixing loop length — the same split Ableton Live makes, where
new Session clips are rounded to bars but the record toggle itself is immediate.

## Decision

Fix the loss; do not defer the stop.

Neither Live nor Move quantizes the record toggle to a bar line — Live finalizes
the held note at the stop point and Arrangement punch-out fires at explicit
markers, never at "the next bar". A blinking-Rec deferred punch-out would be
movy-specific new behaviour, and on its own it does not even fix this bug: a
note still held when the bar line arrives hits the same `clear()`. It is
recorded here as a possible later feature, not as part of this work.

One deliberate divergence from Live: the kept note ends at the **actual pad
release**, not at the stop point, clamped to the clip length. Truncating at the
stop point makes the common gesture — play the last chord, hit Rec — record a
~50 ms stub. Waiting for the release gives the note its performed length.

## Design

### Engine (`crates/seq-core/src/engine.rs`)

Two lists, not one:

- `rec_pending` — notes captured while recording. Unchanged.
- `rec_tail` — notes still down when recording ended, awaiting their release.

`toggle_record`'s stop branch moves `rec_pending` into `rec_tail` rather than
clearing it. Separate storage rather than a flag on the entry: a new recording
pushes fresh entries, and `rposition` would let a stale same-pitch entry from
the previous take linger for ever if they shared a list.

`live_note_off` searches `rec_pending`, then `rec_tail`. The `!self.recording`
early return goes away — an empty lookup already covers notes that were never
captured.

### Length

`RecPending` gains two fields:

- `start_cycle: u32` — the track's `cycle` when the note began. Elapsed becomes
  `(cycle - start_cycle) * span + (now - start_tick)`, which subsumes the
  existing wrap branch and stays correct across several passes.
- `slot: usize` — the clip the note was played into. A tail note outlives the
  recording state, so it must not be written to whatever `active_mut()` happens
  to point at when the pad is finally released. (The same latent bug exists
  today for a clip launched mid-record; it has simply never mattered.)

Gate is clamped to the clip length.

### Lifecycle of `rec_tail`

| Event | Tail notes |
|---|---|
| Pad released | Finalized with their real length — the main path |
| Transport stop (`Engine::stop`) | Finalized at the stop point; fixes Play-to-stop |
| New recording armed | Finalized first, so nothing leaks into the next take |
| Clip deleted or cleared | Dropped — the target no longer exists |
| One clip length elapsed | Finalized at full length |

The last rule bounds the state and keeps a never-released note from staying
invisible: when the rec track wraps back past the note's start position, the
engine writes it at full length and drops it, so it becomes audible on the next
pass like any recorded note. The check runs at the existing wrap branch and only
when `rec_tail` is non-empty.

### UI (`src/`)

`router-pads.ts` needs no change. `app/unload.ts` gains a call that sends `nof`
for every still-held pad before the DSP is unloaded, so closing movy mid-hold
resolves the tail into the state that `seqPersistFlush` then writes.

### Undo

No rework. Sequencer undo is snapshot-based: `rec-pass.ts` queues a `usnap`
before the engine sees `rec`, so restoring that snapshot removes a late tail
note along with the rest of the pass. This is asserted by a test rather than
assumed.

## Tests

`cargo test -p seq-core`:

- a note held across Rec-stop is recorded, with its performed length
- a note held across a transport stop is recorded, truncated at the stop
- the gate is clamped to the clip length
- re-arming finalizes the previous tail and does not inherit it
- a tail is written to the clip it was played into after a clip switch
- an unreleased tail is finalized at one clip length and dropped
- deleting the clip drops its tail

`browser-test/logic.mjs`: closing movy mid-hold sends `nof` to the engine.

Teeth: restore the `rec_pending.clear()` line and confirm the first test fails.

No LED, status-field or render changes, so no screenshot baselines move.
