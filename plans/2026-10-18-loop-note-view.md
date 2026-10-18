# Loop-mode note view (Push-style folded piano roll)

Approved 2026-10-18 from the pixel mock (scratchpad `mock2.png`).

## What

While Loop mode is on (Loop button latched or held, Track view), the screen
above the bar strip (rows 0-58) shows the watched clip's notes as a compact
piano roll; the Loop Overview strip (rows 60-63) stays as it is.

- **Folded pitches**: only pitches present in the clip get a row, low at the
  bottom. Row pitch = min(12, (59+1)/rows), note height = row pitch - 1.
  Rows sit on the bottom (next to the strip) when capped.
- **Time axis = the strip's**: same `from` bar, bar count and `segW` as
  `drawLoopStrip`, so bar boundaries line up with the segments (including the
  navigated "+" bar).
- **No header, no bar lines, no selected-bar mark** (the strip has it). The
  timed "Loop 1-4" announcement still flashes on change.
- **Knobs are inactive**: turns/touches are swallowed, knob LEDs off.
- **Playhead**: an inverted 1px column across the notes.

### Aggregation when pixels run out

- Vertical: > 30 present pitches → consecutive present pitches share a row
  (ceil(n/30) per row); a row lights where any of its pitches does.
- Horizontal: every note gets ≥ 1 px. A 1 px gap separates touching notes only
  when there is room. A column where ≥ 2 notes of the row meet is drawn
  HATCHED (every other pixel row) instead of solid — "many notes here" reads
  differently from one long note. (The mock's checkerboard costs one fill_rect
  per pixel; hatching is one per pixel row of a run.)

### Live recording + auto-extend

Recorded notes reach the clip only at release, so the engine also lists the
watched clip's pending (held) notes; the UI stretches them to the playhead
every tick. Auto-extend changes `len=`, which re-lays the view.

## Engine (seq-core `engine/note_view.rs`, ENGINE 0.102.0)

- status `nh=<hex>`: digest of watched track, active slot, clip notes
  (tick, gate, pitch) and pending note starts. Pure read, O(notes).
- get `notes`: `tick.gate.pitch` comma list; pending notes have gate `0`.

## UI

- `src/seq/note-layout.ts` — pure: notes + window → rows and runs
  (solid/hatched), column masks for the playhead.
- `src/seq/note-view.ts` — fetch on `nh` change (only in Loop mode, ≥ 100 ms
  apart), cache layout, full draw on repaint frames, per-tick playhead
  column restore/invert and pending-note growth.
- `app/tick.ts` — loop-mode branch in the view chain; persistent loop header
  removed. Router swallows knobs in Loop mode.

## Tests

- cargo: digest changes on edit/pending; `notes` format incl. pending.
- logic: layout folding, cap, aggregation, hatching, strip alignment.
- screenshots: bass / chords / drums / "+" bar / 16-bar dense / 60 pitches.
- perf: fill_rect budget for a dense full draw and a playhead tick.
