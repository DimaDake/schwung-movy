# Selected slot is always the playing slot (when transport runs)

Date: 2026-06-20

## Problem

We recently stopped auto-starting the transport when entering notes into a clip
(stopped → step entry must not start playback). That introduced a gap: when the
transport **is** running and you enter notes into a selected slot that was never
launched (or was stopped via Session-mode empty-slot select), the track stays
silent. The slot's `playing_slot` is `None`, and a track with `playing_slot ==
None` neither sounds nor advances its playhead (`engine.rs` playback loop skips
it).

## Desired behavior

While the transport is running, the track you are editing should have its
**selected (active) clip as its `playing_slot`** — the selected slot is always
the playing slot. Filling a never-launched / empty selected slot makes it
audible immediately. An empty clip stays "playing" and is simply silent (no
notes to fire), matching "no notes = nothing to play."

When the transport is **stopped**, nothing changes: note entry still does not
start playback (the recent behavior is preserved).

### Sync timing

When the freshly-filled slot joins playback it is **bar-quantized**, exactly
like a real Session clip launch: the slot is *queued* and starts cleanly from
its loop start on the next bar boundary, in sync with the metronome and the
other playing clips.

This replaces an earlier "grid-aligned immediate" approach (seed the playhead to
the current master phase). That phase math was provably exact, but starting
mid-bar means a note placed at a step the playhead has already passed stays
silent until the loop wraps — so the first pass feels out of sync, depending on
when in the bar the note was entered. Bar-quantizing removes that: the clip
always starts from the top on a downbeat and the placed note always plays in
time.

## Design

### Engine: `seq-core/src/engine.rs`

New helper enforcing the invariant for one track by queuing a bar-quantized
launch (reusing the existing bar-boundary resolution in `service_tick`):

```rust
pub fn ensure_selected_playing(&mut self, track: usize) {
    if !self.playing || track >= NUM_TRACKS { return; }
    let slot = self.tracks[track].active_clip;
    if self.tracks[track].playing_slot == Some(slot) {
        self.tracks[track].pending_stop = false; // a note keeps a playing slot alive
        return;
    }
    self.tracks[track].queued_slot = Some(slot);   // resolves to playing on the next bar
    self.tracks[track].pending_stop = false;
}
```

Notes:
- Gated on `self.playing`, so the stopped case is a no-op — the no-autostart
  rule is preserved at the engine level.
- `service_tick`'s bar-boundary handler already does the rest: on the next bar
  it sets `playing_slot = Some(slot)`, `pos_tick = loop_start`, and resets the
  automation cursor (`last_auto_step = -1`, `auto_cur = [-1; 8]`).
- Editing the slot that is already playing early-returns (no requantize); it
  only clears a `pending_stop` so the note keeps the slot alive.

### Engine: `seq-core/src/command.rs`

Call `engine.ensure_selected_playing(t)` at the end of the `tog` (melodic) and
`ltog` (drum lane) command arms, after the toggle is applied. These are the only
two step-entry commands (`router.ts` emits `tog`/`ltog`).

### UI

No UI change. Playback, the Session-grid `isPlaying` LED, and persistence all
already key off `playing_slot`; the UI only mirrors engine status.

## Edge cases

- Editing an already-playing slot → helper early-returns; playhead undisturbed.
- Clearing the last note → clip stays selected & "playing" but silent.
- Session-mode empty-slot select sets `pending_stop`; entering a note cancels it
  and starts playing the slot, grid-aligned.

## Tests

Rust unit (`command.rs` / `engine.rs`):
- Transport running + `tog` into the empty selected slot → `queued_slot ==
  Some(active_clip)` immediately, `playing_slot == None`; after advancing past
  the next bar → `playing_slot == Some(active_clip)`, `queued_slot == None`.
- `ltog` into the empty selected slot while playing → same queue behavior.
- Phase-lock (`engine.rs`): start a reference clip, advance into the bar, join a
  second clip via `tog`; every step-0 hit of the joined clip lands on a tick
  where the reference also hits (perfect bar sync, one bar later).
- Existing `tog_does_not_autostart_transport` (stopped case) still passes.

Local + device per the task checklist:
- `npm test` (build:browser + logic/app-loop/screenshot/perf `.mjs`).
- `cd engine && cargo test`.
- Device `./scripts/test.sh` and `./scripts/test-seq.sh` when `move.local` is
  reachable (report in CAPS if offline).
