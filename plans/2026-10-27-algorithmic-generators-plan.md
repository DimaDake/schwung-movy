# Algorithmic generators: implementation plan

Design: `plans/2026-10-27-algorithmic-generators-design.md`. Executed inline on
`feature/ai-midi`. Every file in `src/gen/` stays under the 200-line limit;
tests live in `browser-test/logic/gen-*.mjs` (one module per subsystem, one
line each in `logic.mjs`'s two lists).

## Task 1: foundations (`src/gen/`)
- `types.ts` (Ev, Chord, Key, GenInput, Pick, KnobState), `rng.ts` (seeded
  mulberry32 + string hash).
- `theory/pc.ts`, `theory/templates.ts`, `theory/key.ts` (Krumhansl–Kessler,
  24 keys), `theory/chords.ts` (half-bar weighted template match, key prior,
  spans), `theory/roman.ts` (degree, function, diatonic chord at degree),
  `theory/category.ts` (chord / colour / approach / other, avoid notes),
  `theory/voicing.ts` (nearest voicing, smallest movement).
- Tests: `gen-theory.mjs` — known keys, chord spans of a I–V–vi–IV, power
  fifths, slash bass, categories, voicing movement.

## Task 2: harmony rules
- `analysis/sounding.ts` (per half-bar pitch-class weights of a set of clips,
  speed/transpose/loop window applied), `theory/freedom.ts` (locked / partial /
  free + pinned pcs), `theory/moves.ts` (§2.1 moves), `theory/connect.ts`
  (connection score, drop rule), `plan.ts` (target chord per half-bar from
  freedom + Harmony knob; locked fits).
- Tests: `gen-harmony.mjs` — the freedom table, each move on a I–V–vi–IV and a
  one-chord minor vamp, partial filtering against a pedal, connection drop,
  plan determinism.

## Task 3: analysis of the part
- `analysis/events.ts` (notes ↔ events, onsets within half a step), `analysis/
  groove.ts` (per-16th landing offsets, swing, grid detection), `analysis/
  drum-kit.ts` (pad roles: kick, snare/clap, hats, toms, perc — names, GM,
  pattern), `analysis/context.ts` (GenCtx: source, chords, key, freedom, role,
  groove, kit, loops).
- Tests: `gen-analysis.mjs`.

## Task 4: realise + knob stages
- `realise/line.ts`, `realise/chords.ts`, `realise/bass.ts`, `realise/index.ts`.
- `shape/` variation: tension (in realise), rhythm, density, range, length;
  drums: fill, ghosts, shift, accent, hats; quantize: timing, swing, grid,
  pitch fix, clean, embellish/ghosts, dynamics, length/fill.
- `knobs.ts`: definitions, step counts, labels, AI-mode live set.
- Tests: `gen-stages.mjs` — each stage's identity position and direction.

## Task 5: families and presets
- `families/` line, chord, bass/drone, phrase, rhythm, drum, quantize.
- `presets/` catalog (variation melodic, variation drums, quantize) with
  roles, freedom, class, default knobs.
- `generate.ts` (one option from ctx + preset + knobs), `guard.ts`.
- Tests: `gen-presets.mjs` — **every knob moves every preset × role**; guard.

## Task 6: selection and the sync API
- `select.ts` (classes per level, variety, ordering), `engine.ts`
  (`planRequest` / `runCandidate` / `finish` slices + `generateAll` wrapper).
- Tests: `gen-select.mjs` — counts, determinism, ladder order, same loop.

## Task 7: bench
- `scripts/gen-bench/algo.mjs`: run the engine on every case (3 options and
  6), score with `score.mjs`, compare per case with `default-x3`, dev/holdout
  halves, levels. Report `plans/gen-bench-results-2026-10-27-algo.md`.
- Tune on the dev half only; record the result against the gate in §8.

## Task 8: integration
- `seq/gen-mode.ts` + prefs `genMode` + Settings row GENERATOR MODE.
- `ai/job.ts`: algorithmic run sliced per tick (reads, analyse, candidates,
  select) — no key needed; AI path unchanged.
- `gen/preview-knobs.ts`: knob turns (coalesced regeneration, discards edits),
  touch strip via the header band (name left, value right), AI-mode live set.
- `ai/preview.ts`: route knob CCs and touches.
- Tests: `ai-job.mjs` / `ai-preview.mjs` additions, screenshot scenes (touch
  strip, Settings row), perf (one request and one regeneration).

## Task 9: docs and gates
- MANUAL (generators section + controls table), README bullet, CHANGELOG.
- `npm test`, `scripts/vdev.sh tier 3`, deploy, commit, push.
