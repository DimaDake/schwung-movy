# Session-mode pad rendering: native Move LED animation

Date: 2026-06-14
Status: Design (approved for spec review)

## Problem

Session mode (`src/seq/session.ts`) paints the 32-pad clip grid. Three defects:

1. **Empty selected slot shows grey on only one track.** The selected-empty
   highlight is gated by `track === seqState.watchTrack` (`session.ts:130`), so
   only the focused track's selected slot lights grey; the other three don't.
2. **Blinking is done manually in JS** via `pulseOn()` (`session.ts:100`), which
   toggles a cell between two colors on alternate engine ticks. It is coarse (no
   gradient), costs an LED send on every phase flip, and is inconsistent.
3. **Rendering differs between tracks** because of the `watchTrack` special case.

Goal: every track behaves identically (no active-track special case); empty
selected slots are grey on all tracks; clips with content that are playing pulse
smoothly between their track color and white; clips scheduled for launch pulse
(faster). The pulse must be performed **natively by Move**, not by JS.

## Key finding: Move's native LED animation

Move uses the Push 2 LED model (documented verbatim in
`schwung/src/schwung_host.c:2769-2777`): the **MIDI channel** of an LED note-on
selects a hardware animation. `schwung/src/shared/constants.mjs:633-649`:

```
NoAnimation 0x00   Trans24..2th 0x01-0x05   Pulse24..2th 0x06-0x0A   Blink24..2th 0x0B-0x0F
```

`setLED()` (the global movy uses) hardcodes channel 0 (`0x90`,
`input_filter.mjs:62`), which is exactly why all current blinking is manual.

The animation can be reached directly: movy's QuickJS context exposes the global
`move_midi_internal_send([cin, status, note, color])`
(`schwung/src/shadow/shadow_ui.js:3292`, exposed to overtake modules). Sending
`[0x09, 0x90 | channel, note, color]` lights `note` with the chosen animation.

### Two hardware constraints (verified by reading schwung)

1. **Overtake LED queue is active for movy** (`shadow_ui.js:3526` — movy has no
   `skip_led_clear`). It buffers LED sends and flushes **≤16 per tick**, **keyed
   by note number, last-writer-wins** (`shadow_ui.js:636,653,673`). The channel
   byte is preserved in the flushed message, but **only one (channel,color)
   survives per pad per tick.** We therefore cannot send a base color and an
   animation color for the same pad in the same tick.

2. **The animation channels are never used anywhere in schwung** — only defined.
   So the firmware's exact behavior is **unverified**: does `Pulse4th` pulse
   between the channel-0 base color and the animation-channel color (Push 2
   two-color model), or only between the animation color and black? This is
   resolved by an on-device spike before Part B is built (see below).

## Design

Two independent parts. Part A is pure logic (no hardware risk) and ships first.
Part B depends on the spike result.

### Part A — remove the active-track special case (logic only)

- `sessionCellColor()` is already a pure function of one cell's state — no change
  needed there for Part A.
- `sessionPaintGrid()` computes `isSel` as `st.selected === slot` for **every**
  track (drop the `&& track === seqState.watchTrack` clause at `session.ts:130`).
- Result: each track renders its own selected slot; empty selected → grey on all
  four tracks. This alone fixes defects 1 and 3.

Pressing a clip still retargets `watchTrack` (so the step view follows) — that
behavior in `sessionPad()` is unchanged; only the *rendering* stops depending on
`watchTrack`.

### Part B — native animation (replaces manual `pulseOn`)

State → animation table. Identical for all four tracks. Priority high→low:
queued > playing > selected > content > empty.

| Cell state                          | Color           | Channel         |
|-------------------------------------|-----------------|-----------------|
| empty, not selected                 | black           | NoAnimation 0x00|
| empty, selected                     | grey            | NoAnimation 0x00|
| content, stopped, not selected      | track color     | NoAnimation 0x00|
| content, stopped, selected (focus)  | base→white slow | Pulse2th 0x0A   |
| content, playing                    | base→white      | Pulse4th 0x09   |
| any, queued to launch               | base→white fast | Pulse8th 0x08   |

"base→white" relies on the firmware's two-color model: the cell's solid track
color (set on a prior tick while stopped) is the base; the animation message
sends `white` on the pulse channel and the firmware breathes between them.

**Why one message per pad suffices.** A cell only enters an animated state from a
solid state (e.g. stopped→playing), and the solid frame already established the
base color on channel 0 on an earlier tick. So the transition emits exactly one
new message (the animation), and the per-tick/per-note queue collision never
occurs. To stay correct even on a fast empty→playing transition (where no solid
track-color frame was emitted), the LED cache does a **one-tick base handshake**:
if the desired base differs from the last base sent for that note, send the base
on channel 0 this tick and the animation next tick.

### Fallback (if the spike shows single-color pulse only)

If Move pulses only color↔black (not base↔anim), playing/queued cells pulse
**white↔black** (chosen 2026-06-14): track color still shows solid when stopped;
playing/queued flash white natively. The table's "base→white" entries become
"white on the pulse channel" with no base dependency.

## Components

| File                       | Change |
|----------------------------|--------|
| `src/seq/colors.ts`        | Add `ANIM_NONE=0, ANIM_PULSE_SLOW=0x0A, ANIM_PULSE=0x09, ANIM_PULSE_FAST=0x08` mirrored from schwung constants. |
| `src/seq/led-cache.ts`     | `cachedSetAnimLED(note, color, channel)`; cache key `(color,channel)`; base-handshake; emit via `move_midi_internal_send` with `setLED` fallback when the global is absent (browser). |
| `src/seq/session.ts`       | `sessionCellColor` returns `{color, channel}`; delete `pulseOn()`; drop `watchTrack` gate; `sessionPaintGrid` uses the anim setter. |
| `src/seq/leds.ts`          | Pass the anim setter into `sessionPaintGrid`; Session branch unchanged otherwise. |
| `src/types/schwung.d.ts`   | Declare `move_midi_internal_send(data: number[]): void`. |

## Testing

- **logic.mjs** — truth table for `sessionCellColor` across all 6 states × 4
  tracks, asserting `{color, channel}` and proving no `watchTrack` dependency.
- **screenshot.mjs** — not affected: the session clip grid is LED-only (no
  `fill_rect`); the screen shows the master FX chain. Run it (expect 0 failures),
  but no baseline update is needed.
- **perf.mjs** — assert the grid emits ≤1 message per pad per tick (no manual
  double-write) and total Session-frame sends ≤ the 16/tick flush cap.
- **Device** — the spike, then `test-seq.sh` for the session e2e, then a manual
  pass watching the pulse on hardware.

## Plan of record (sequencing)

1. Write + review this spec.
2. **Part A** (logic only): drop the `watchTrack` special case; grey empty slot on
   all tracks. Local tests green.
3. **Spike on device**: light a few pads with `Pulse4th`/`Pulse8th` over assorted
   base colors via `move_midi_internal_send`; confirm whether the pulse is
   track↔white (two-color) or color↔black (single-color). If `move.local` is
   offline, report DEVICE OFFLINE in caps and pause Part B.
4. **Part B**: implement the animation cache + table per the spike result (or the
   white↔black fallback), update tests/baselines, device-verify.

## Spike result (2026-06-15)

Device-confirmed on `move.local`: the firmware uses the **two-color model** —
`Pulse4th`/`Pulse8th` pulse between the channel-0 base color and the
animation-channel color, i.e. **track color ↔ white** as designed. The white↔black
fallback was not needed. Grey empty-selected slots verified on all four tracks.
Implemented and shipped with the primary mapping.

## Risks

- Two-color model unverified → mitigated by the spike before Part B.
- 16-LED/tick flush cap: a cold Session frame wants 32 pad updates; the existing
  `FRAME_BUDGET` cache already spreads cold frames over ticks, and steady-state
  changes are few. Perf test guards this.
- Device offline blocks the spike; Part A is independent and ships regardless.
