# Movy Sequencer — Global Design & Implementation Plan

Companion to `2026-06-12-sequencer-features.md` (the v1 feature list). This is the global
design; each implementation step gets its own focused mini-design/plan before coding.

## 1. Architecture overview

Two-layer split, mirroring davebox's proven native-engine/JS-UI division, but with movy's
stricter layering:

```
┌─────────────────────────────────────────────────────────────────┐
│ movy ui.js  (TypeScript → QuickJS, runs inside shadow_ui)       │
│                                                                  │
│  existing, untouched:            new:                            │
│  ┌──────────────┐ ┌───────────┐  ┌──────────────────────────┐   │
│  │ model/ (knob │ │ renderer/ │  │ src/seq/  UI subsystem    │   │
│  │ params)      │ │ (params)  │  │  state mirror · buttons   │   │
│  └──────────────┘ └───────────┘  │  step/session LEDs ·      │   │
│         ▲               ▲        │  chromatic pads · strip    │   │
│         └── thin hooks ─┴────────┤  + toasts renderer        │   │
│                                  └────────────┬──────────────┘   │
│            shadow_set/get_param(0, "overtake_dsp:…")  ▼          │
├─────────────────────────────────────────────────────────────────┤
│ movy dsp.so  (Rust cdylib, plugin_api_v2, loaded as the         │
│ co-running "overtake DSP" — keeps ticking while shadow chain    │
│ slots render)                                                    │
│   clock (96 PPQN) · transport · clip store · scheduler ·        │
│   recorder · session/launch · metronome click · persistence     │
│           │ midi_send_internal(0x9n|track …)                    │
├───────────┴─────────────────────────────────────────────────────┤
│ schwung host → shadow_chain_dispatch_midi_to_slots              │
│   channel n → chain slot n (slot default channel = slot index)  │
└─────────────────────────────────────────────────────────────────┘
```

Verified host facts this design rests on:
- Interactive tools with a `dsp.so` get it loaded via the overtake-DSP path while the tool
  UI runs in shadow_ui (`startInteractiveTool` in schwung `shadow_ui.js`); UI addresses it
  with `shadow_set_param(0, "overtake_dsp:"+key, v)` / `shadow_get_param`. Schwung also
  passes `overtake_dsp:project_bpm` at launch.
- UI-originated and overtake-DSP-originated MIDI is dispatched to chain slots **by MIDI
  channel** (`shadow_midi.c: shadow_chain_dispatch_midi_to_slots`); slots default to
  channel = slot index (`shadow_chain_mgmt.c`).
- Step buttons are note events 16–31 with individually addressable LEDs; all transport/
  edit buttons (Play 85, Rec 86, Loop 58, Copy 60, Delete 119, Mute 88, Note/Session 50,
  +/− 55/54, arrows 62/63) reach the tool. Movy doesn't use any of them today except
  arrows/+/−.

## 2. Engine (Rust)

Location: `movy/engine/` — a cargo workspace with two crates:

- **`seq-core`** (pure `lib`, no FFI, no I/O): all sequencer logic — clock accumulator,
  transport, clip/note store, step operations, scheduler, recorder, session launcher,
  command/status (de)serialization. 100% host-testable with `cargo test`. This is the
  layer other projects could reuse.
- **`movy-dsp`** (`cdylib` → `dsp.so`): unsafe FFI boundary implementing `plugin_api_v2`
  (hand-written bindings against schwung's `plugin_api_v2.h`), param string dispatch,
  JSON persistence to disk, metronome click synthesis into the render buffer, MIDI emit
  via the host vtable. Thin; logic-free where possible.

Key engine decisions (davebox-informed, Move-aligned):
- **Clock**: 96 PPQN master tick, `ticks_per_step = 24` (1/16), integer accumulator in
  `render_block` (`tick_accum += frames*bpm*ppqn; while >= rate*60 { tick }`) — davebox's
  drift-free model.
- **Clip model is note-centric** (native Move records unquantized): each clip holds a list
  of notes `{tick, gate_ticks, pitch, vel, step_anchor}` plus `length_bars`,
  `loop` window. Step operations (toggle/LED occupancy/hold-edit) resolve through the
  step anchor so LED state and edits can't diverge (the rounding-invariant bug class
  davebox documents). Davebox's dual steps[]/notes[] model is deliberately not copied.
- **Scheduler**: per master tick, emit notes whose effective tick matches; gate countdown
  fires note-offs; note-offs always emitted from `render_block` context.
- **Recording**: count-in countdown; incoming live notes timestamped at the current clip
  tick; `suppress_until_wrap` semantics for overdub (davebox); clip auto-extend while
  recording into an empty slot, second-half-of-last-bar rule on stop.
- **Session**: per-track `queued_clip` + `pending_stop`, resolved at bar boundaries
  (launch quantization = 1 bar); immediate launch + transport start when stopped.
- **Metronome**: click synthesized directly in `render_block` output (accent on beat 1).
  Risk spike in Step 0 confirms overtake-DSP audio is audible; fallback = click as MIDI
  note to a reserved channel.
- **Persistence**: serialized JSON (serde) to one state file under the movy module dir;
  dirty-flag + deferred save (never in the audio path), load at `create_instance`.
  Loop-cycle counters don't persist (davebox lesson).

## 3. UI ↔ engine protocol

- **Commands (UI → engine)**: all edits/gestures are encoded into a single batched
  `set_param("cmd", "<op>;<op>;…")` flush per UI tick. One blocking IPC per tick max —
  respects both the davebox "only the last set_param per buffer survives" coalescing
  constraint and movy's IPC budget (a blocking set_param costs 3–5 ms).
- **Status (engine → UI)**: one compact `get_param("status")` poll per N UI ticks
  (~80–100 Hz effective, davebox cadence): transport state, per-track playing/queued clip
  + current step, active-clip step-occupancy bitmap + bar summary, record/count-in state,
  clip-grid occupancy. UI keeps a mirror (`src/seq/state.ts`) updated from polls and
  optimistically from its own commands.
- Live pad notes are commands too (`non`/`nof` ops) — the engine emits them to the track
  and records them, giving engine-side timestamps (davebox pattern).

## 4. UI subsystem (TypeScript)

New `src/seq/` package, peer of `model/` and `renderer/`:

- `state.ts` — sequencer UI mirror (mode: note/session/loop, held steps, copy clipboard
  UI state, octave, toggles) + engine status mirror.
- `engine.ts` — command queue, batching/flush, status poll + parse. The only file that
  talks IPC for the sequencer.
- `buttons.ts` — handlers for transport/edit buttons, step buttons, session toggle.
- `pads-chromatic.ts` — Move chromatic layout: pad↔pitch mapping, octave, root/scale LED
  coloring (fixed C major), velocity pass-through; replaces the piano layout for melodic
  modules (drum modules keep `keyboard/drum-handler.ts`).
- `leds.ts` — all sequencer LED painting (step row, session grid, button LEDs) through a
  cached `setLED` layer (`lastSent` arrays + periodic resync, davebox `ui_leds.mjs`
  pattern), so redundant sends never hit the wire.
- `render.ts` — Loop Overview strip (bottom ~6 px rows) + sequencer toasts, reusing
  `renderer/overlay.ts` toast primitives.

**Thin connection to existing movy** (explicit requirement — param layer stays liftable):
- `midi/router.ts` is refactored from one flat switch into a small dispatch chain:
  sequencer handler gets first look at sequencer-owned events (steps, transport buttons,
  session-mode pads), everything else falls through to the existing knob/chain/keyboard
  handlers unchanged. Param model/renderer code is not modified — the sequencer only adds
  a post-render hook (strip + toast) and pad-LED ownership arbitration in `app/tick.ts`.
- Track-button handling stays shared: selecting a track switches both param pages and the
  sequencer's active track.
- Movy's keyboard/drum note sends become channel-aware (`0x90|activeTrack`) and route via
  the engine — fixing the latent always-channel-0 issue.

## 5. LED & screen ownership rules

- Note mode: pads = chromatic layout (or drum grid); step row = step LEDs; movy knob LEDs
  unchanged.
- Session mode: pads = clip grid; param pages stay on screen and knobs stay live.
- Loop mode: step row = bars; pads keep note layout.
- Pulsing LEDs (queued/stopping/selected-clip) driven by a UI-tick phase counter, not
  per-frame engine polls.
- Screen: param view untouched; strip occupies the bottom rows (y≈58–63, sharing space
  with the existing jog-toast line — toasts temporarily cover the strip, native-style).

## 6. Build, deploy, test

- **Build**: `cargo build --release --target aarch64-unknown-linux-gnu` → `dsp.so` copied
  next to `ui.js` (toolchain already present for schwung builds; Docker fallback like
  davebox). `npm run build:device` unchanged for the UI. New `scripts/build-dsp.sh`.
- **Deploy**: `scripts/deploy.sh` additionally ships `dsp.so`.
- **Tests** (all local-first):
  - `cargo test` in `seq-core` — clock math, scheduler, step ops, recording, loop ops,
    launch quantization, command/status round-trips.
  - `browser-test/logic.mjs` — seq UI state machine against a **mock engine** (the mock
    implements the same cmd/status protocol; protocol unit-tested on both sides).
  - `browser-test/screenshot.mjs` — Loop Overview states + toasts baselines.
  - `browser-test/perf.mjs` — new budgets: ≤1 blocking set_param per tick, status-poll
    cadence, LED sends per tick after cache, strip fill_rect count.
  - Device: `scripts/test.sh` extended — inject Play/steps/pads CCs, assert engine state
    via `get_param` log lines (sequencer plays notes, transport advances).

## 7. Risks / open verifications (front-loaded in Step 0)

1. **Tool-with-dsp load path**: movy launches with `skip_file_browser`; verify `dsp.so`
   is picked up and the UI keeps full shadow_* access. (Code-read says yes.)
2. **Overtake-DSP audio audibility** for the metronome click (davebox is MIDI-only and
   never exercised this). Fallback: MIDI click to a track.
3. **Slot channel defaults on the actual device** (config may override channel=slot).
4. **set_param/get_param throughput + coalescing** on the `overtake_dsp:` path at the
   planned cadences.
5. LED throughput with 32 pads + 16 steps + buttons changing under playback (cache +
   budget tests; davebox survived, so should we).

## 8. Implementation plan (each step: mini-design → code → tests green → commit/push → device verify when reachable)

- **Step 0 — Integration spike**: engine skeleton (workspace, FFI bindings, no-op
  plugin), cross-compile + deploy, prove on device: dsp.so loads, tick counter via
  `get_param`, channel-addressed note audible on each of the 4 tracks, click audible from
  render_block, IPC cadence measurements. *Deliverable: risk list resolved.*
- **Step 1 — UI scaffolding**: `src/seq/` skeleton, router dispatch-chain refactor (no
  behavior change), engine.ts cmd/status plumbing + mock engine in the test harness.
- **Step 2 — Engine core + first sound**: clock/transport/clip store/scheduler; Play
  button; basic step toggle + basic step LEDs; 4 tracks sequencing simultaneously.
- **Step 3 — Step sequencing complete**: full step LED semantics, bar navigation +
  toasts, chords, drum-lane step filtering, loop auto-extend by navigation.
- **Step 4 — Pads**: chromatic layout + octave + real velocity + Full Velocity toggle;
  channel-aware live notes through the engine.
- **Step 5 — Loop Mode**: bars-on-steps, loop length gestures, Loop+wheel, double loop.
- **Step 6 — Step property editing**: velocity/length/nudge/transpose, multi-step hold,
  held-step notes on pads, per-bar variants in Loop Mode.
- **Step 7 — Copy & delete**: step/range copy-paste, bar copy, clip duplicate/delete,
  drum-pad note delete, clipboard cancel.
- **Step 8 — Recording**: count-in + metronome + toggle, record/overdub, clip
  auto-extend, stop rules, quantize action.
- **Step 9 — Session mode**: grid LEDs (all six states), launch/stop with quantization,
  scenes, slot selection → Note-mode targeting, session copy/delete.
- **Step 10 — Screen**: Loop Overview strip + remaining toasts (screenshot baselines).
- **Step 11 — Persistence**: autosave/load, versioned state format.
- **Step 12 — Hardening**: perf budgets enforced in perf.mjs, LED cache audit, device
  e2e in test.sh, docs (DESIGN.md/CLAUDE.md updates).

Order rationale: Step 0 kills the integration unknowns before any feature work; steps 2–9
each end in a user-testable behavior slice; screen work (10) is deferred because LEDs are
the primary interface; persistence (11) waits until the state format stops churning.
