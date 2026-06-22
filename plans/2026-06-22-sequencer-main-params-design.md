# Sequencer Main Parameters Page — Design

**Date:** 2026-06-22
**Status:** Approved (brainstorming complete; ready for implementation plan)

## Summary

Add a global **Main Parameters** page to the movy sequencer, organized like the
chain/module parameter pages (knob-touch → top toast, big-font value cells). For
now it holds one page with four params — **Tempo, Swing, Root note, Key (scale)**
— but the architecture is built so additional pages can be added later.

Root and Key are global and affect **all chromatic tracks** (one shared keyboard
state). Tempo and Swing are engine-owned (musical truth lives in the Rust
engine). Swing is a genuinely new engine feature; everything else reuses existing
infrastructure.

## Entry / exit

- **Open:** `Shift + Step 5`, `Shift + Step 7`, or `Shift + Step 9`. Added to
  `shiftStepFunction` in `src/seq/router.ts`. Steps 5/7/9 are currently unused
  (6 = Metronome, 10 = Full Velocity, 15 = Double Loop, 16 = Quantize).
  - All three open the single page **for now**. They route through a
    `STEP → pageIndex` map (`{ 5: 0, 7: 0, 9: 0 }`) so mapping a step to a future
    page 1 / page 2 is a one-line change.
- **Exit:** the **Back** button (`MoveBack`). It restores the view the page was
  opened from. On open, capture `mainParamsOrigin` (mirrors the existing
  `browseOrigin` pattern); the Back handler in `src/midi/router.ts` (~line 191)
  gets a new branch: `if currentView === VIEW_MAIN_PARAMS → restore origin`.
- The page is a **latching** persistent view — a new
  `appState.currentView` value `VIEW_MAIN_PARAMS`, parallel to
  `VIEW_KNOBS` / `VIEW_KEYS` / `VIEW_CHAIN`.

## New / changed modules

| File | Role |
|---|---|
| `src/seq/main-page.ts` (new) | Page state: `selected` flag, `origin` view, `touchedKnob`, open/close helpers. Mirrors `src/seq/step-page.ts`. |
| `src/seq/main-page-vm.ts` (new) | Builds the page `ViewModel` from engine/keyboard state. Mirrors `src/seq/step-page-vm.ts`. |
| `src/seq/scales.ts` (new) | The curated scale set (13, incl. Chromatic) as `{ name, degrees: number[] }`. |
| `src/seq/router.ts` | `shiftStepFunction` opens the page on steps 5/7/9. |
| `src/midi/router.ts` | Knob-CC block routes to `mainPageKnob` when the page is active; Back handler restores origin. |
| `src/app/tick.ts` | Render dispatch: `VIEW_MAIN_PARAMS → renderKnobsView(buildMainPageVM())` (+ overlay when the Key list is open). |
| `src/seq/pads.ts` | `inScale` + root highlight anchor to `rootNote % 12` and the selected scale. |
| `src/keyboard/state.ts` | Add `scale` (scale index) to `keyboardState`. |
| `src/seq/persist.ts` | Ferry root + scale in the persisted UI state. |
| `engine/crates/seq-core/*` | Swing field + command + scheduler offset + persistence. |
| `engine/crates/movy-dsp/src/lib.rs` + `src/seq/constants.ts` | `ENGINE_VERSION` bump. |

## Parameters & rendering

Knobs 1–4 active; knobs 5–8 blank. ViewModel built by `main-page-vm.ts`,
rendered by the existing `renderKnobsView` / `drawKnobWidget`. Knob-touch →
`touchedKnob` drives the shared top toast and inverts the touched cell, exactly
as the step page does.

| Knob | Param | Cell render | Touch toast | Edit |
|---|---|---|---|---|
| 1 | **Tempo** | `renderStyle: 'preset'`, big-font integer | `Tempo  120 bpm` | ±1 BPM / detent, clamp 20–300 |
| 2 | **Swing** | `'preset'`, big-font `50%` | `Swing  50%` | ±1% / detent, clamp 50–80 |
| 3 | **Root** | `'preset'`, big-font note name (`C`, `F#`) | `Root  C` | ±1 semitone / detent |
| 4 | **Key** | enum cell (scale name); opens the full-screen scrollable enum overlay (`drawEnumOverlay`) like long enums | `Key  Major` | step through scales |

## State ownership & persistence

| Param | Owner | Edit path | Persist |
|---|---|---|---|
| Tempo | **Engine** — `clock.bpm_x100` (exists) | `bpm <x100>` | already in `persist.rs` |
| Swing | **Engine** — new `swing_pct` | `swing <pct>` | add to `persist.rs` |
| Root | **UI** — `keyboardState.rootNote` (base MIDI note) | reuse `changeRoot(±1, …)` | add to `src/seq/persist.ts` |
| Key | **UI** — `keyboardState.scale` (new index) | set scale index | add to `src/seq/persist.ts` |

Tempo and Swing are mirrored into `seqState` from the engine `status` poll so the
cells show the live engine values.

## Engine changes — Swing (new feature)

- Add `swing_pct: u32` to the engine state + a `swing <pct>` command (clamp
  50–80).
- **Scheduler:** delay every **even-indexed 16th step** (steps 2, 4, 6 … within
  each beat). `TICKS_PER_STEP = 24` (PPQN 96 ⇒ 24 ticks per 16th).
  `delay_ticks = round((swing_pct − 50) / 30 · MAX_FRAC · TICKS_PER_STEP)`.
  - `swing_pct = 50` → 0 ticks (straight).
  - `swing_pct = 80` → max shuffle. `MAX_FRAC` is pinned during implementation so
    the off-beat lands ≈ 0.5–0.6 of the way to the next step at 80% (musical
    target; exact value chosen against `cargo test` assertions).
  - Odd-indexed steps are never delayed.
- Persist `swing_pct` in the engine save string (alongside `bpm`).
- **`ENGINE_VERSION` must be bumped** in both
  `engine/crates/movy-dsp/src/lib.rs` and `src/seq/constants.ts`
  (`build-dsp.sh` enforces the match).

## Root / Key affect all chromatic tracks

- `src/seq/scales.ts` defines the curated scale set (13) by degree set (semitone
  offsets from the root): **Major (Ionian), Minor (Aeolian), Dorian, Phrygian,
  Lydian, Mixolydian, Locrian, Harmonic Minor, Melodic Minor, Major Pentatonic,
  Minor Pentatonic, Blues, Chromatic.**
- `src/seq/pads.ts` today hardcodes the root highlight to pitch-class **C**
  (`semitone === 0`) and the scale to `MAJOR`. Change both:
  - root highlight (track color) anchors to `rootNote % 12`;
  - `inScale(pitch)` tests `((pitch − rootNote) mod 12)` against the selected
    scale's degree set.
- Because there is a single shared `keyboardState`, this is global across all
  four tracks automatically.
- **Root note transposes the layout**: changing root (±1 semitone via the knob)
  moves the layout base note `keyboardState.rootNote` and the highlight anchor
  together. The existing +/- octave buttons stay ±12. Bottom-left pad = the root.
- **Key is highlight-only**: it changes which pads light as in-scale; it never
  folds or constrains the pitches the pads play (chromatic layout is unchanged).

## Knob & view routing

- `src/midi/router.ts` knob-CC block (~line 125): add, ahead of the normal
  param-set path and in the same shape as the step-page intercept (~line 130):
  `if (mainPageActive()) { if (k < 4) mainPageKnob(k, delta); return; }`.
- `src/app/tick.ts` render dispatch: `VIEW_MAIN_PARAMS` →
  `renderKnobsView(buildMainPageVM())`, plus `drawEnumOverlay` when the Key list
  is open.
- Knob-touch events reuse the same touch mechanism the step page uses to set
  `touchedKnob`.

## Testing

- **`browser-test/logic.mjs`** — scale degree sets; `inScale` anchored to root;
  root transpose moves base + anchor; bpm/swing clamp + `bpm_x100` conversion;
  Main-page VM cells, toast text, blank knobs 5–8.
- **`browser-test/app-loop.mjs`** — Shift+Step 5/7/9 opens `VIEW_MAIN_PARAMS`;
  knob turns emit the correct `bpm` / `swing` / root commands; Back restores the
  prior view.
- **`browser-test/screenshot.mjs`** — new baselines: page with each of knobs 1–4
  touched (toast + inverted cell), and the Key scale overlay open.
- **`browser-test/perf.mjs`** — render + IPC cost of the new view stays within
  budget.
- **`engine` `cargo test`** — straight-vs-swung tick offsets (50% = 0, 80% =
  max, odd steps unaffected); swing persistence round-trip.
- **Device** (when `move.local` reachable) — `scripts/test-seq.sh` (tempo +
  swing + persistence), `scripts/test.sh` (param-UI e2e). Report DEVICE OFFLINE
  in CAPS if unreachable.

## Decisions / assumptions

- **Tempo is movy-engine-only** — it drives the sequencer's own clock, not
  Move's global host tempo.
- **±1 per detent** for tempo / swing / root (no fine/coarse modifier).
- **Key/scale is highlight-only** — never folds or constrains played notes.
- **One page now**, extensible to more via the `STEP → pageIndex` map.

## Out of scope

- Additional Main-Params pages (page 1, 2, …) beyond the single page.
- Scale-folding / scale-lock note input.
- Propagating tempo to Move's host transport.
- Per-track (non-global) root/key.
