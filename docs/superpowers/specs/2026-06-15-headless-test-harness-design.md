# Headless app-loop test harness — design

**Date:** 2026-06-15
**Status:** Approved (pending spec review)

## Problem

The device end-to-end tests (`scripts/test-seq.sh`, `scripts/test.sh`) drive the
surface via MIDI inject but assert behavior **only from the debug log** —
engine loaded, `play=1`/`play=0`, autosave wrote a file, `seq: restored state`.
The hardware has no way to read back LED or pixel state.

Consequently the entire **LED-affordance layer is unverifiable on device**, and
it is also unverified locally: `browser-test/logic.mjs` calls modules in
isolation (`seqHandleMidi`, `drumPadOn`) with `setLED` stubbed to a no-op, and
the browser harness (`screenshot.mjs`) covers pixel rendering, not the LED grid
or the full input loop.

The recent drum-LED change (green = sequencer gate OR held pad; green beats
white-selected; per-tick repaint) is exactly this class of behavior: it could
only be checked by eyeballing the device, which cannot even assert LED values.

## Goal

Add a node-runnable harness that exercises the **real app loop** — `init()`,
`onMidiMessageInternal()`, `tick()` — against the existing mock engine and a
drum preset, capturing `setLED` calls so tests can assert the full
input → LED pipeline. Keep the existing device tests and extend them (to run
later) for the two new drum-sequencer features.

## Non-goals

- Pixel/screenshot assertions (already covered by `screenshot.mjs`).
- Reading LED state on the physical device (impossible; the local harness is
  the system of record for LED logic).
- Reworking the existing unit tests beyond a no-op refactor to share globals.

## Approach

A standalone `browser-test/app-loop.mjs`, plus extracting the duplicated global
stubs into a shared `browser-test/env.mjs`.

Rejected alternatives:
- **Extend `logic.mjs`** — already ~1830 lines of *pure-unit* tests over a shared
  `mockState`; `init()`/`tick()` mutate process-wide singletons (`appState`,
  `seqState`, `keyboardState`) and we capture `setLED` across many ticks. That
  stateful full-loop style would pollute the isolated unit tests.
- **Extend `harness.mjs`/`screenshot.mjs`** — canvas/rAF/browser-only; awkward
  for LED assertions and not node-CI runnable.

## Components

### 1. `browser-test/env.mjs` (shared, ~40 lines)

Exports `installEnv()` that assigns all Schwung globals required by the bundled
modules:

- Display: `fill_rect`, `clear_screen` (no-ops).
- Params: `shadow_get_param`, `shadow_set_param`, `shadow_get_ui_slot` over a
  module-local `mockState` (returned by `installEnv` so callers can swap presets).
- MIDI/host: `shadow_send_midi_to_dsp`, `host_read_file` (→ null), `host_write_file`.
- LEDs: `setLED`, `setButtonLED`.
- Constants: `MovePads` (the pad-note array), `MidiNoteOn`/`MidiNoteOff`,
  `decodeDelta`, and the RGB color globals **mirrored to the real palette
  indices** so assertions are meaningful: `NeonGreen = 11`, `White = 120`,
  `Black = 0` (matching `seq/colors.ts` `C_GREEN`/`C_WHITE`/`C_BLACK`).

`logic.mjs` is refactored to call `installEnv()` instead of its inline global
block. This is a **no-op refactor**: all existing logic checks must still pass
unchanged.

### 2. `browser-test/app-loop.mjs` (new)

A thin driver over the real app, exposing:

- `resetApp()` — load a drum preset into `mockState`, install the mock engine,
  call `init()`, and clear the captured-LED buffer.
- `sendMidi([status, d1, d2])` — call global `onMidiMessageInternal`.
- `advance(n = 1)` — call global `tick()` n times (drains engine boot/poll and
  repaints LEDs).
- `padColor(physPad)` — the last color passed to `setLED` for that pad note
  (undefined if never set).
- `engine.setStatus({ act, ... })` — inject the engine status string so a test
  can simulate the sequencer triggering a pad (`act=` lists sounding pitches per
  track), then `advance()` to let the poll land.

The harness owns a `setLED` capture map keyed by pad note, installed over the
`env.mjs` stub.

### 3. New coverage (assertions in `app-loop.mjs`)

Drum grid, driven through `init()` + `tick()` with a `mrdrums`-style preset:

- **Resting state:** a programmed-but-silent pad shows track color; the selected
  pad (`drumCurrentPhysPad`) shows white (120).
- **Green priority:** inject `act=` for a pad → that pad is green (11) even when
  it is the selected pad; clear `act=` and `advance()` → it reverts to
  white/track color.
- **Held-pad green:** `sendMidi(noteOn pad)` then `advance()` → pad is green;
  `noteOff` then `advance()` → reverts. (The case the recent change added;
  currently untested anywhere.)
- **Multi-step entry end-to-end:** through the real router + tick, select a drum
  lane, hold one step + press another → both register in occupancy and no
  `slen` length-gesture is emitted.

### 4. Device-test additions — `scripts/test-seq.sh` (run later)

- **Drum multi-step (option a):** the UI emits a `[movy]` log line on drum-lane
  step entry (`mlog` on the `ltog` path in `seq/router.ts` `toggleStep`), e.g.
  `seq: step <abs> lane <lane>`. The device test selects a drum track, holds
  step 1 + presses step 5, and asserts **two** such log lines for one lane —
  proving multi-step entry on hardware.
- **LED smoke:** drive a short drum pattern; assert no crash and expected
  transport behavior. LED *values* are not asserted on device (impossible) —
  the local harness is authoritative for LED logic.

### 5. Wiring

- `package.json`: add `"test:app": "node browser-test/app-loop.mjs"`.
- Update the test-order checklist in root `CLAUDE.md` and `movy/CLAUDE.md` to run
  `browser-test/app-loop.mjs` after `logic.mjs` (local, always; 0 failures
  required).

## Testing & success criteria

- `app-loop.mjs` runs under node with 0 failures and exits non-zero on failure
  (same convention as `logic.mjs`).
- The harness reproduces the recent drum-LED behavior: removing the
  `keyboardState.held` OR in `tick.ts` makes the held-pad-green assertion fail;
  reverting the `watchLane < 0` guard in `router.ts` makes the multi-step
  assertion fail. (Sanity check that the tests actually bite.)
- The `logic.mjs` refactor to `env.mjs` leaves all existing checks green.
- New `mlog` line on drum step entry does not change UI/engine behavior; local
  logic + screenshot + perf suites stay green.

## Risks / notes

- `init()` builds 4 tracks × CHAIN_SLOTS models; the mock `shadow_get_param`
  ignores slot, so every synth slot loads the same drum preset — acceptable for
  these assertions.
- Process-global singletons mean `resetApp()` must fully reset `appState`,
  `seqState`, `keyboardState`, and the captured-LED buffer between cases.
- Keep `app-loop.mjs` and `env.mjs` within the 200-line file limit; split if the
  harness grows.
