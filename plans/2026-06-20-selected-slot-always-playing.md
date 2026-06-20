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

When the freshly-filled slot joins playback, its playhead is **grid-aligned and
immediate**: seeded to the master bar/step phase so the clip is in sync with the
metronome and the other playing tracks. The note placed at step N sounds when
the global playhead next reaches step N (not from step 0, not queued to the next
bar).

## Design

### Engine: `seq-core/src/engine.rs`

New private helper enforcing the invariant for one track:

```rust
fn ensure_selected_playing(&mut self, track: usize) {
    if !self.playing || track >= NUM_TRACKS { return; }
    let slot = self.tracks[track].active_clip;
    // A note into the selected slot cancels any Session stop/queue on it.
    self.tracks[track].queued_slot = None;
    self.tracks[track].pending_stop = false;
    if self.tracks[track].playing_slot == Some(slot) { return; } // already playing — don't disturb its playhead
    self.tracks[track].playing_slot = Some(slot);
    // Grid-align: seed the playhead to the master bar/step phase so the clip is
    // in sync with the metronome and the other playing tracks.
    let len = self.tracks[track].clips[slot].length_ticks().max(1) as u64;
    let start = self.tracks[track].clips[slot].loop_start_ticks();
    self.tracks[track].pos_tick = start + (self.master_tick % len) as u32;
    self.tracks[track].last_auto_step = -1;
    self.tracks[track].auto_cur = [-1; 8];
}
```

Notes:
- `pos_tick`/`loop_start_ticks`/`length_ticks` are `u32`; `master_tick` is `u64`.
- Gated on `self.playing`, so the stopped case is a no-op — the no-autostart
  rule is preserved at the engine level.

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
- Transport running + `tog` into the empty selected slot → `playing_slot ==
  Some(active_clip)`.
- Grid-alignment: start transport, advance several steps, `tog` a note at the
  current step → the note fires in phase (verify via `advance_block` output),
  not restarted from step 0.
- `ltog` into the empty selected slot while playing → same.
- Existing `tog_does_not_autostart_transport` (stopped case) still passes.

Local + device per the task checklist:
- `npm test` (build:browser + logic/app-loop/screenshot/perf `.mjs`).
- `cd engine && cargo test`.
- Device `./scripts/test.sh` and `./scripts/test-seq.sh` when `move.local` is
  reachable (report in CAPS if offline).
