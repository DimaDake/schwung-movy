# movy's own parameter pages — what they knew

movy drew module parameter pages itself until 2026-10-13, when Schwung's
`param_pages` became the only renderer (`plans/2026-10-13-schwung-pages-only.md`).
The code is preserved at tag **`movy-pages-final`** (`dde8937`), the last commit
where `schwunggrid=0` still drew movy's pages. Read any file there with
`git show movy-pages-final:<path>`, or check it out whole.

This page is the index into that code: what each technique solved, why, and
where it lives at the tag. Several of these were later reproduced upstream in
Schwung's planner; the movy versions are still the reference for the reasoning.

## How it fitted together

- **Model** (`src/model/index.ts`, `state.ts`, `store.ts`, `tick.ts`): the
  module's hierarchy became *banks* of eight `KnobParam`s (`knobParams[gi]`,
  `gi = bank * 8 + slot`). The model owned the knob engine (deltas, touch,
  overlays), a value mirror refreshed round-robin, and the bank index.
- **View model** (`src/model/viewmodel.ts`, `src/types/viewmodel.ts`): one
  `ParamVM` per cell with a `renderStyle` (`arc`, `switch`, `vbar`, `pan`,
  `preset`, `steps`, `items`, `wave`, `envstage`, `cut`, `xbox`) plus grouped
  visualisations (`envelopeLines`, `lfoViz`, `filterViz`, `eqViz`, `cutViz`,
  `wavViz`), the toast and the overlay.
- **Renderers** (`src/renderer/label.ts`, `knob.ts`, `envelope.ts`,
  `filter-curve.ts`, `eq-curve.ts`, `cut-curve.ts`, `wav-form.ts`,
  `lfo-wave.ts`, `pan-dial.ts`, `overlay.ts`): pure functions of the VM.
- **The seam** (`src/app/page-owner.ts` at the tag): `movyOwner` vs
  `delegateOwner`, chosen by `schwungGridMode()` (`src/renderer/schwung-grid.ts`).

## Page planning

- **Generic pages from any hierarchy** — `model/generic-pages.ts`,
  `hierarchy-walk.ts`, `level-extras.ts`. Nav-only levels expand recursively;
  a nested section is named `Parent/Child` with the parent shortened to fit; a
  level that repeats root renders once; orphan levels with knobs are swept in;
  a level's `params[]` continue onto `- 2`, `- 3` overflow pages after its
  bound knobs; unturnable params (`max <= min`) and non-knob types (`canvas`)
  are skipped. Tests at the tag: `browser-test/logic/model-hierarchy.mjs`,
  `browser-test/dump-replay.mjs` (layout invariants over every captured module,
  snapshot `dump-expect.json`).
- **Curated configs** — `model/config-pages.ts`, `src/modules/*.json`,
  `src/module-configs/*.json`. Still used: `model/config-hierarchy.ts`
  translates a config into Schwung's contract for the older drum racks.
- **Cell placement** — `model/page-layout.ts`: grouped graphics claim
  adjacent cells, and `pageSlotMap` re-maps physical knobs so a knob always
  drives the param shown at its position after an envelope rearrange (a
  knob→screen mapping bug class worth remembering for any custom layout).
- **The voice slot** — `model/page-rotation.ts` (full version): a kit's
  per-voice banks collapse into ONE seat in the jog rotation holding the voice
  the last pad picked; a pad only turns the page while you are on that seat;
  Shift+jog steps by section (`stepGroup`). The "leading run of pad banks" rule
  survives as `voiceRunLength`.
- **Page bar groups** — `bankGroups`: pages of one section drawn flush, a gap
  between sections (`renderer/header.ts` `drawBankBar` groups argument).

## Recognising what a parameter is

All in `src/model/` at the tag; each was detected from what the module reports,
never from a per-module table.

| File | What it recognised | The lesson |
| --- | --- | --- |
| `toggle.ts` | booleans (0/1, Off/On, No/Yes) vs two-item *choices* (Free/Sync, Poly/Mono) vs momentary *actions* | an option list that puts "on" first must keep its box, or the switch shows the opposite of the module |
| `fader.ts`, `pan.ts` | loudness knobs (unity origin for a bipolar gain) and stereo position; kept disjoint | detection order stated, not implied |
| `envelope.ts`, `env-stage.ts` | an A/D/S/R group on one line → one envelope; a lone attack/decay → a ramp | partial envelopes (AD, AR, ASR) span fewer cells |
| `lfo-viz.ts`, `lfo-vm.ts`, `lfo-shapes.ts` | a module LFO's shape + phase drawn as one wave | encode rate/depth only as the bounded span partner; the shape must stay readable |
| `filter-viz.ts`, `filter-mode.ts`, `filter-vm.ts` | cutoff + resonance → a response curve; mode/slope enums by vocabulary | the off-page filter-mode search made the VM scale with module size (perf Test 8) |
| `eq-viz.ts`, `cut-viz.ts` | band gains → an EQ curve; low/high cut → one band-pass | overlapping corners must still MEET and shut the band at the extreme |
| `wave-viz.ts`, `wave-toggle.ts` | waveform pickers draw each option's glyph; oscillator on/off switches dotted when silent | every option maps to its OWN glyph (`uniqueShape`) |
| `wav-viz.ts`, `wav-peaks.ts` | a sampler's file + position → waveform with marker, loop brackets, grain-spray fences | peaks read in chunks per tick (the tick is the MIDI sampling interval), normalised by a gain |
| `trigger.ts` | one-shot actions: armed → fired → cooling badge | one sweep = one fire; the 700 ms re-arm is a gesture-end DEBOUNCE, drawn as a drain |
| `access.ts` | `access: "read"` readouts (dotted frame, not automatable) and `"write"` triggers | |
| `step-labels.ts`, `knob-step.ts` | octave/voice counts as framed signed numbers | |
| `meta-infer.ts`, `meta-retry.ts` | type/range guessed when no metadata, inferred from the first read; late preset/enum lists re-probed a bounded number of times | |
| `items-param.ts` | bank/soundfont/model selectors beside the preset knob | the on-screen position is not the module's index in a sparse list |

## Knob feel

- **Normalised sweep** — `model/knob-step.ts`: ~100 detents end to end
  whatever the units; params with ≤ 8 values take four clicks per step; the
  discarded remainder and a `.5` tie once made a CCW click do nothing on 257 of
  464 integer params — symmetry is a test, not an assumption.
- **Wide acceleration** — `knob_acceleration: "wide"` scaled a UNIT step, never
  the accumulated delta (a fast spin arrives as one big delta; multiplying it
  compounds twice).
- **Enum wire format learned on read** — `model/enum-value.ts`: a module that
  reads option NAMES vs one that reads INDICES, cached per param (`enumFmt`).

## Overlays and gestures

- **Enum overlay** — touch opened a scrollable list (with a waveform glyph
  gutter for wave pickers), turn scrolled, release committed; a re-scan on
  touch for item selectors, clamped because the list can shrink.
- **File overlay** — one pass over the folder; an entry matching the module's
  extension filter is taken as a file without `os.stat` (a thousand stats was
  the lag); labels built once when the overlay opens.
- **Held-step filter** — `renderer/label.ts` `hiddenDuringHold`: while a step
  is held, cells that cannot take a lock were dimmed. Not carried over (SU-8 in
  `docs/schwung-page-migration.md`).
- **Touch toast** — touching a knob put its full name and value in the header.

## Reading values

- **Round-robin refresh** — `model/store.ts` `refreshOneParam`: the current
  page plus a sweep window in ONE bulk round trip every `REFRESH_BULK_TICKS`
  (8); suppressed for `REFRESH_SUPPRESS_TICKS` after a turn; automation lanes
  and LFO-modulated params never read back (the feedback loop), but seeded
  once so a cell is never "...".
- **Short names** — `renderer/shorten.ts` `dedupShortNames`: colliding 5-char
  labels on one page made unique.

## Movy's own LFO and MIX pages

`src/lfo/model.ts`, `lfo/cells.ts` (phase on a 15° grid, a multiplicative rate
knob across 0.1–20 Hz, a target overlay committed on release) and
`src/mixer/mix-model.ts`, `mix-cells.ts` (the dB ladder walked continuously at a
module knob's rate). Schwung's LFO page and the MIX own-component source replace
them.

## Tests and tools at the tag

`browser-test/dump-replay.mjs` (+ `dump-expect.json`), `page-mode.mjs` (the
movy/Schwung A/B burn-down), the logic suites `model-paging`, `envelope`,
`filter-viz`, `wave-viz`, `eq-cut-wav`, `wav-peaks`, `trigger-badge`,
`items-select`, `pan-viz`, `graphics`, 104 movy-body screenshot scenes, the
device scenarios `items` and `module-contract`, `scripts/dump-movy-layout.mjs`
(per-module layout dumps in `docs/module-dump/modules/`) and the
`scripts/schwung-*-check.mjs` comparison probes.

## Found while retiring them

- **Preset and randomiser knobs on Schwung pages record no module snapshot.**
  movy's knob path called `recordPresetState` for params marked
  `capturesModuleState`; the Schwung page writer (`renderer/schwung-page-io.ts`
  `pageWriter`) records a plain param op only. This predates the retirement
  (Schwung pages were the default from 2026-10-08); `recordPresetState` is
  kept in `src/undo/record.ts` for the fix.
- **A slot set to None kept drawing the old module** on a Schwung page, because
  the kept instance goes on serving its hierarchy. Fixed in `pageOwnerOf`
  (an empty slot has no page).
