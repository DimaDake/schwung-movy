# Step Parameter Page (2026-06-21)

## Overview

A new **"step"** parameter page, shown only during a parameter-lock session (a
held step — the existing `stepAutoMode` in `src/seq/step-edit.ts`). It exposes
five intrinsic per-trig note properties on the knobs:

| Knob | Param | Render | Default |
|---|---|---|---|
| 1 | Velocity | vertical bar (`vbar`), at chord **average** | (existing note vel) |
| 2 | Note length | enum square (`1/32 … 1/4, 1/2, 1, 2 … 16`) | (existing note gate) |
| 3 | Probability | enum square (`100% … 10%`, 10 steps) | 100% |
| 4 | Step condition | big preset-style font (`A:B`, B up to 8) | 1:1 |
| 5 | Invert condition | enum square (`OFF` / `ON`) | OFF |

Knobs 6–8 are blank. Velocity and note length already exist on the engine
`Note`; probability, step-condition, and invert are **new engine features** that
actually skip/play trigs during playback.

The page is the **first entry** of the param-page indicator in **both** the
chain view and the module knobs view, rendered as a **dotted** segment
(double-height + dotted when it is the selected page).

## Granularity

Trig attributes key on `(step, lane)` where `lane = Some(pitch)` for a drum lane
or `None` for melodic — exactly mirroring `Clip::note_matches` used by `evel` /
`slen`. The decision is **per trig**: all chord notes at a given step+lane share
one probability/condition/invert decision. Velocity and length remain **per
note** (a chord may hold differing values).

---

## A. Engine data model (`engine/crates/seq-core/src`)

- New sparse per-clip table on `Clip` (in `clip.rs`):
  ```rust
  pub struct Trig {
      pub step: u16,
      pub lane: Option<u8>, // Some(pitch)=drum lane, None=melodic — like note_matches
      pub prob: u8,         // 0..=100 (%)
      pub cond_a: u8,       // A in A:B (>=1)
      pub cond_b: u8,       // B in A:B (>=1)
      pub invert: bool,
  }
  pub trigs: Vec<Trig>,
  ```
  An absent `(step, lane)` entry means defaults: `prob=100, cond 1:1,
  invert=false`. Trig rows are created lazily on first non-default edit and may
  be pruned when they return to all-defaults (keeps the table sparse and
  persistence small). Cap with a `MAX_TRIGS` constant alongside `MAX_LOCKS`.
- Velocity (`Note.vel`) and length (`Note.gate`) already exist — no new note
  storage.
- **Cycle counter:** the engine tracks a per-clip 1-based play count that
  increments each time the clip's loop window wraps. It seeds condition
  evaluation. Reset on transport stop/clip (re)start so conditions are
  reproducible from the top.
- **Persistence:** serialize `trigs` alongside `locks` in `persist.rs`
  (round-trips through the UI's `host_read_file`/`host_write_file`).

## B. Engine playback logic

At each trig fire point (a note about to be scheduled at its step), evaluate the
trig for that `(step, lane)` **once** before emitting any of its notes:

1. **Condition.** With 1-based cycle count `N`:
   `play = ((N - 1) mod B) + 1 == A`. `invert` flips `play`. `1:1` is always
   true. Validated against the manual examples:
   - `1:2` → true on plays 1, 3, 5, …
   - `2:2` → 2, 4, 6, …
   - `2:4` → 2, 6, 10, …
   - `4:7` → 4, 11, 18, …
2. **Probability.** If the condition passed, roll a free-running engine PRNG
   (simple xorshift in engine state, seeded at engine start — Elektron-style
   non-determinism); play iff `roll_percent < prob`. `prob == 100` always plays;
   `prob == 0` never plays.
3. The pass/fail decision governs **all** chord notes at that `(step, lane)`.

## C. Engine commands (UI → engine, batched, mirroring `evel`)

New verbs in `command.rs` (range form `<s0> <s1>` like the existing edit ops):

- `eprob <track> <s0> <s1> <lane> <pct>` — set probability for the trigs in range.
- `econd <track> <s0> <s1> <lane> <a> <b>` — set condition.
- `einv  <track> <s0> <s1> <lane> <0|1>` — set invert.

Reused for the step page (no new command needed):

- **Velocity:** the step-page velocity knob drives the existing
  `evel <track> <s0> <s1> <lane> <delta>` by delta. This preserves a chord's
  relative spread; turning fully clockwise clamps every note to 127 — i.e. it
  **sets the maximum for all notes even when they started at different
  velocities** (the explicit requirement). `evel` already clamps `[1,127]`.
- **Note length:** the step-page length knob maps the chosen enum value to
  absolute ticks and issues `slen <track> <s0> <s1> <lane> <ticks>`, which sets
  every matching note to that exact length ("set all to picked value"). `...` is
  shown when notes differ but the edit still flattens them to the picked value.

**Status read-back.** Extend the held-step `hold` status report so the UI can
display the current values on the step page: held-step velocity (chord average),
length (or a "mixed" marker), probability, condition (A,B), and invert. These
feed the step page's ViewModel each status poll.

## D. UI — page model & memory (`src/app/state.ts`, `src/seq/*`)

- A **virtual** `STEP_PAGE` exists only while a parameter-lock session is active
  (`seqState.stepAutoMode`). When active it is **prepended as page index 0** to
  the page indicator in both views.
- **Page memory.** `appState` gains `lastSessionStepPage: boolean`.
  - On session start (`beginStepAutomation`): if `lastSessionStepPage` is true,
    select the step page; otherwise keep the last-selected module page (the
    existing `currentPage`).
  - On session end (`endStepAutomation`): set
    `lastSessionStepPage = (selected page === STEP_PAGE)`.
  This matches the rule: by default the last-selected page reopens, but because
  the step page does not exist outside a session, a dedicated flag carries the
  "step page was open" state across sessions.
- **Navigation.** Jog cycles `[step] + banks` in knobs view and `[step] +
  slots` in chain view. Index 0 (step page) is folded into the existing
  `changePage` (knobs) and chain-slot-switch handlers; leaving index 0 resumes
  normal bank/slot navigation.

## E. UI — rendering (`src/renderer`)

- **Page indicator** (`drawBankBar` in `src/renderer/header.ts` — both
  `renderChainView` and `renderKnobsView` call it): add a `dottedFirst` mode.
  When a session is
  active, render one extra leading segment **dotted** (alternating pixels),
  height 1 normally and **height 2 (still dotted) when it is the selected
  page**. Module/slot segments are unchanged. Both `renderChainView` and
  `renderKnobsView` pass the flag while a session is active.
- **Title:** the header shows `step` when the step page is the selected page.
- **Knob layout:** top row only (`Vel`, `Len`, `Prob`, `Cond`, then `Inv` wraps
  to the next cell; bottom-row remainder blank). Render styles per the table
  above; all primitives already exist in `renderer/knob.ts`
  (`vbar`, enum square, `preset` big font). `1:2` fits the 32px `CELL_W` in the
  big font (which covers `:`).
- **Step page ViewModel:** a small dedicated builder (these are not chain
  params, so `buildViewModel`'s param-page path is bypassed). It assembles the
  five `ParamVM` cells from the held-step status read-back. Mixed length →
  `...`; velocity bar sits at the chord average (no special mixed glyph).

## F. UI — knob routing (`src/seq/router.ts`, `src/seq/step-edit.ts`)

- When the selected page is `STEP_PAGE`, knob turns route to new step-param
  handlers, **not** `handleAutomationKnob` (these are intrinsic note properties,
  not chain-automation lanes — no lane is assigned).
  - Velocity knob → `evel` (delta).
  - Length knob → enum index → `slen` (absolute ticks).
  - Probability / condition / invert knobs → `eprob` / `econd` / `einv`
    (absolute).
- Tap (knob touched, never turned) on the step page is a no-op.

## G. Tests

- **cargo (`engine/`):** Trig table set/get/clear and pruning; condition truth
  table for the manual examples (`1:1, 1:2, 2:2, 2:4, 4:7`); probability bounds
  (0% never, 100% always) with a seeded PRNG; persistence round-trip; a chord
  shares one decision (all notes play or all skip).
- **logic.mjs:** step-page ViewModel (five params, correct styles, `...` length
  on mixed, average velocity); page-memory rule (reopen step page iff last
  session ended on it, else last module page); page list prepends the step page
  only while a session is active.
- **app-loop.mjs:** hold a step → step page selected per memory; jog cycles
  `step + banks/slots`; knob turns emit the new commands (`evel`/`slen`/`eprob`/
  `econd`/`einv`) and **not** automation `aset`.
- **screenshot.mjs:** new baselines for the step page (each render style + the
  dotted/selected indicator) in both chain and knobs views (`--update` first).
- **perf.mjs:** step-page render stays within the fill_rect / IPC / timing
  budget.
- **Device (`./scripts/test-seq.sh`):** set a condition and a probability on a
  step, confirm playback skips/plays accordingly across cycles, and that the
  values persist across a reload.

## Out of scope

- Per-note (rather than per-trig) probability/condition.
- Microtiming / retrig / other Elektron trig features not requested.
