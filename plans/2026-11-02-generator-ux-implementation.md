# Generator UX rework: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved generator UX design.

- Fixed knob slots.
- Plain-language names.
- Merges with a no-loss test.
- No SWING knob.
- No SAFE / BALANCED / WILD.
- SEED ordered close → far.
- New Clip adopts five Variation generators.
- Jog scrolls past the picks.
- New Clip options inside Step 14.
- Granular undo.

**Architecture:** The plan has three parts, and each leaves movy working and green.

- **Part A (Tasks 1–12)** is pure generator code under `src/gen/`, gated by the local suites.
  - Knob order inside a preset stays the generator's own business.
  - A new layout table (`src/gen/layout.ts`) maps the 8 hardware slots to knob names. This keeps `generate(v)` indices, `withSeed` and `withDrift` unchanged.
- **Part B (Tasks 13–14)** is the preview (`src/ai/`): scrolling and the Step 14 mix.
- **Part C (Task 15)** is granular undo: a session step stack in the UI.
  - It swaps notes with `aiclip`, as an option switch does.
  - It sits under one global undo entry per session, which the existing held group already produces.

Parts B and C touch preview input and engine round trips, so they are gated by the vdev tier.

**Tech Stack:** TypeScript (QuickJS on device), node logic suites (`browser-test/logic/*.mjs`), `browser-test/perf.mjs`, screenshot baselines, MkDocs manual.

**Spec:** `movy/plans/2026-11-01-generator-ux-design.md`. §4 is the knob-by-knob source of truth: every layout below is copied from it.

## Global Constraints

- **Source files under 200 lines.** Split rather than grow (`movy/CLAUDE.md`). `browser-test/` suites stay under about 600 lines.
- **Performance budgets in `browser-test/perf.mjs` hold.** Undo and redo do no regeneration (§5).
- **Slot roles:**
  - 1 WHAT, 2 HOW MUCH, 3 HARMONY (drums: second idea), 4 WHERE, 5 LENGTH (drums: HUMAN; Double: ENDING), 6 EXTRA, 7 FLAVOUR, 8 OVER TIME.
  - Per-pad drums keep DENSITY on 1. Quantize slot 1 is TIMING (HUMANIZE: LOOSE).
- **No SWING knob anywhere.** Parts are written straight; the engine's set swing (`swing_delay`) applies at playback.
- **Placement rules:**
  - SEED goes in 8.
  - DRIFT goes in 8 without SEED. With SEED it goes in 6, or in 7 when 6 holds SPACE or SEAMS.
  - DYNAMICS goes in 7 when free, else 6.
- **No knob is dropped while a slot is dark.**
- **Renames:**
  - Knobs: TENSION → COLOUR, CHANGES → CHORD RATE, PITCH FIX → FIX NOTES, SPARSE → SPACE, BUSY → DENSITY, VARY → DRIFT (New Clip).
  - Generators: RETROGRADE → BACKWARDS, ORNAMENT and EMBELLISH → DECORATE, PEDAL / DRONE MOVE → HOLD NOTE.
  - GATE, VOICING, VOICES and REGISTER keep their names.
- **Defaults do not move.** Every generator that survives keeps its default take unless §4 says otherwise.
- **Gates:**
  - Every task runs `npm test`: 0 failures, plus `npm run typecheck` (part of `npm test`).
  - UI rendering changes run `node browser-test/screenshot.mjs --update`, then `node scripts/site/build-assets.mjs`.
  - Parts B and C also run `scripts/vdev.sh tier 3`.
  - Finally: `./scripts/deploy.sh` when `move.local` answers ("deployed, not device-tested"). Say DEVICE OFFLINE in CAPS if not.
- **Commits:**
  - `git add <files>` only, never `-A`.
  - Each message says which tier gated it.
  - Each message ends with the session's `Co-Authored-By` and `Claude-Session` lines.
- **Node:** `export PATH=$HOME/.local/node/bin:$PATH` before `npm`.

## Review Focus

1. **Undo while a knob turn is still pending regeneration.** Undo must first close the gesture as its own step, then restore that step's exact notes. A pending regeneration must never land on top afterwards. Test in Task 15.
2. **Undo after commit when the clip changed meanwhile.** Cases: the Set switched, the engine reloaded, the clip was deleted or pasted over, or a newer session ran on it. Reopening must not happen; undo behaves as plain history (the stored entry's `uswap`). Test in Task 15.
3. **Scrolling where some extra generators were refused by the guard.** They never appear, the strip never shows an empty cell, and the jog stops at the last real option. Test in Task 13.
4. **HARMONY values that don't fit.** A loop longer than four chords, long names (`F#M7B5`) and rests (`-`) must fit the header's value field. Test in Task 8.
5. **A parked session.** Leaving a clip and coming back keeps its scroll position and its undo steps. An Undo pressed on another clip never moves the parked session. Test in Task 15.

---

## Part A: generator code

### Task 1: Record the merge baseline

**Files:**
- Create: `scripts/gen-bench/record-merge-baseline.mjs`
- Create: `browser-test/data/gen-merge-baseline.json` (generated, committed)
- Create: `browser-test/logic/gen-merges.mjs` (new suite; one line in each of `browser-test/logic.mjs`'s two suite lists)

**Interfaces:**
- Produces:
  - `REMOVED`, the ids recorded:
    - Quantize: `q-tidy`, `q-groove`, `q-full`, `q-invert`, `qd-tidy`, `qd-groove`, `qd-full`.
    - Variation: `v-anticipate`, `v-spread`, `v-register`, `v-octave`, `v-pedal`, `v-drone`, `d-turn`, `d-euclid`.
    - Double and New Clip: `x-turn`, `xd-pickup`, `n-groove`.
  - The same recording also stores the default takes of the merged survivors: `q-tight`, `qd-tight`, `q-mode`, `v-displace`, `v-revoice`, `v-bassline`, `d-fill`, `d-grids`, `x-turnaround`, `xd-fill`, `n-drum-map`, plus `n-chords` and `n-pad` (Task 8 shifts their map positions).
  - The baseline JSON is `{ [presetId]: { [fixtureKey]: Note[] } }`. `fixtureKey` is `role/scene/task` for `fixtureInput`, `create/drum|melodic/locked/1` for `createInput`, and `messy:role` for Quantize.
  - The test helper in `gen-merges.mjs` is `noLoss(id: string, ctx, notes): boolean`: `difference(baseline, notes) < MIN_PAIR`.

- [ ] **Step 1:** Write the recorder.
  - It walks every fixture each listed preset `serves` (the same fixtures `gen-quality.mjs` uses: `fixtureInput(role, {task, scene})` for each role in `PARTS` and each scene `locked|partial|free`, `messy(...)` for Quantize, `createInput` for New Clip).
  - It writes each default take with `generateOption(ctx, p, defaults(p, ctx)).notes`.
- [ ] **Step 2:** Run it before any other change.

  ```bash
  npm run build:browser && node scripts/gen-bench/record-merge-baseline.mjs
  ```

  Expected: the JSON is written with all 31 ids, and each has at least one fixture.
- [ ] **Step 3:** Add the suite with one test, `merge_baseline_complete`.

  ```js
  ok('merge_baseline_complete', REMOVED.every((id) => Object.keys(B[id] ?? {}).length > 0));
  ```

- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit (local suites gate).

### Task 2: Quantize merges (TIGHT, MODE)

**Files:**
- Modify: `src/gen/presets/quant-melodic.ts` (TIGHT 8 knobs; delete TIDY, GROOVE, FULL)
- Modify: `src/gen/presets/quant-drums.ts` (drum TIGHT; delete TIDY_D, GROOVE_D, FULL_D)
- Modify: `src/gen/presets/quant-mutate.ts` (MODE gains MIRROR and PIVOT; delete INVERT)
- Create: `src/gen/shape/velocity.ts`
- Modify: `src/gen/presets/catalog.ts`
- Test: `browser-test/logic/gen-merges.mjs`

**Interfaces:**
- Produces: `velocity(notes: Note[], v: number): Note[]`, with `v` in 0..10.
  - 5 = as played.
  - Below 5 = `even(notes, (5 - v) * 2)`.
  - Above 5 = `dynamics(notes, (v - 5) * 2)`.
  - Both come from `shape/dynamics.ts`.
- Knobs, by name:
  - TIGHT (melodic): TIMING(10), DENSITY(5), PITCH FIX(def as today), GRID(scene), LENGTH(5), VELOCITY(5), CLEAN(0), FEEL(STRAIGHT).
  - TIGHT (drums): TIMING(10), DENSITY(5), CLEAN(3), GRID(scene), VELOCITY(5), FEEL(STRAIGHT).
  - MODE: TIMING, MODE (today's 8 + `MIRROR`), WHERE, DYNAMICS, PIVOT. PIVOT is live only when MODE = MIRROR. MIRROR uses TIGHT's default pitch fix.
  - Names are renamed in Task 5. Use today's names here.

- [ ] **Step 1: Write the failing no-loss tests.**

  ```js
  // the removed ids map to merged knob states; 'q-tidy' at TIDY's defaults:
  noLoss('q-tidy', ctx, turnAll(ctx, by('q-tight'), { CLEAN: 5, VELOCITY: 2, LENGTH: 6 }))      // EVEN 6 ⇒ VELOCITY 5-3
  noLoss('q-groove', ctx, turnAll(ctx, by('q-tight'), { TIMING: 9, VELOCITY: 8, FEEL: 'SCENE' })) // DYNAMICS 60 % ⇒ 5+3
  noLoss('qd-tidy', ...{ CLEAN: 8, VELOCITY: 3 }); noLoss('qd-groove', ...{ TIMING: 9, VELOCITY: 8 })
  noLoss('q-invert', ctx, turnAll(ctx, by('q-mode'), { MODE: 'MIRROR', WHERE: '2ND HALF', PIVOT: 'MID' }))
  noLoss('q-tight', ctx, defaultTake(by('q-tight')))   // TIGHT's own default unchanged
  ```

  - `turnAll(ctx, p, byName)` sets knobs by name (a label string picks that label's position), then calls `regenerate`.
  - Each test runs on every baseline fixture of the removed id.
  - **FULL has no single equivalent.** Its test asserts only that `q-full` and `qd-full` are gone from `PRESETS`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL (no VELOCITY knob).
- [ ] **Step 3:** Implement the knobs above.
  - Removed presets leave `LISTED` and `SEEDED`.
  - Quantize SWING is not created on TIGHT: pass swing 0 to `timing(...)`.
- [ ] **Step 4:** Run `npm test`. Expected: PASS. If a mapping misses `MIN_PAIR`, stop and report it to the user (spec §2.7). Don't loosen the test.
- [ ] **Step 5:** Commit.

### Task 3: Variation melodic merges

**Files:**
- Modify: `src/gen/presets/var-rhythm.ts`: DISPLACE gains MODE (SHIFT, PUSH), LENGTH and TENSION; ANTICIPATE is deleted.
- Modify: `src/gen/presets/var-close.ts`: RE-VOICE gains SPREAD, TOP and SPLIT; SPREAD is deleted.
- Modify: `src/gen/presets/var-exp.ts`: REGISTER is deleted.
- Modify: `src/gen/presets/var-bass.ts`: BASSLINE PATTERN gains OCTAVE BASS's figures (OFFBEATS, ALTERNATE, LAST, RANDOM octave jumps) as positions after today's nine.
- Modify: `src/gen/presets/var-held.ts`: HOLD NOTE replaces PEDAL and DRONE; OCTAVE BASS is deleted.
- Modify: `src/gen/presets/catalog.ts`
- Test: `browser-test/logic/gen-merges.mjs`

**Interfaces:**
- DISPLACE knobs: MODE(SHIFT), AMOUNT(4), HARMONY, SHIFT (in PUSH mode its positions are PUSH's 1/32…1/4, labelled so), LENGTH(5), TENSION(4), SEED, DRIFT.
- RE-VOICE knobs:
  - SPREAD, with an `AS IS` position at 0 as the default, so today's RE-VOICE default is unchanged.
  - AMOUNT(6), HARMONY, SPLIT, TOP, RANGE, TENSION, SEED.
  - SPLIT's positions: `OFF` (default) or 1/4, 1/2, 3/4 × REGISTER's INTERVAL moves.
- HOLD NOTE knobs: NOTE (PIVOT, ROOT, FIFTH, THIRD, TONIC, CHORD ROOT), AMOUNT, HARMONY, RANGE, LENGTH, SHARED, SEED, DRIFT.
  - Roles: `drone`, plus PEDAL's roles.
  - Default NOTE: PIVOT on a drone, TONIC elsewhere.
- Dropped knobs (per §4) sit at their default inside the generator: SPREAD's RHYTHM, CHANGES, VOICES and LENGTH; RE-VOICE's DRIFT; OCTAVE BASS's AMOUNT, SEED and DRIFT.

- [ ] **Step 1: Write the failing no-loss tests.** One per removed id:
  - `v-anticipate` → DISPLACE {MODE: PUSH, SHIFT: '1/8', LENGTH: 6, TENSION: 4}
  - `v-spread` → RE-VOICE {SPREAD: 'DROP 2', TOP: 'HOLD', AMOUNT: 10}
  - `v-register` → RE-VOICE {SPLIT: '1/2 +OCT'}
  - `v-octave` → BASSLINE {PATTERN: 'OFFBEATS'}
  - `v-pedal` → HOLD NOTE {NOTE: 'TONIC', AMOUNT: 5}
  - `v-drone` → HOLD NOTE {NOTE: 'PIVOT', SHARED: 'TIE', LENGTH: 7}

  Also: `noLoss` on every survivor's own default (`v-displace`, `v-revoice`, `v-bassline`).
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement the knobs above.
- [ ] **Step 4:** Run `npm test`. Expected: PASS. If a mapping fails, report it; don't force it.
- [ ] **Step 5:** Commit.

### Task 4: Drum Variation, Double and New Clip merges

**Files:**
- Modify: `src/gen/presets/var-drums.ts`: FILL gains WHERE (END, EVERY BAR) with SIZE positions 1 BEAT … 1 BAR; TURNAROUND is deleted.
- Modify: `src/gen/presets/var-drums-exp.ts`: GRIDS's map gains Euclidean nodes (one per PAD × PULSES ∈ {3,5,7} × ROTATE ∈ {0,2}) at Y = 100 %; drum EUCLID is deleted.
- Modify: `src/gen/presets/dbl-lines.ts`: TURNAROUND's knob becomes MOVE = BELOW, ABOVE, ENCLOSE, CHROMATIC, V7, IV, TRITONE, R, L, P, plus a HARMONY knob (`K.harmony(1)`); Task 8 hides it where it doesn't apply.
- Modify: `src/gen/presets/dbl-melodic.ts`: TURN is deleted.
- Modify: `src/gen/presets/dbl-drums.ts`: Double FILL's PADS gains KICK, OPEN HAT and KICK+SNARE; FILL gains PUSH; DENSITY's lowest positions are PICKUP's HITS 1–3. PICKUP is deleted.
- Modify: `src/gen/presets/new-drums-map.ts`: DRUM MAP gains FILL (NONE, SNARE, TOMS) and SEED; GROOVE's eight genre patterns are added as map nodes where missing.
- Modify: `src/gen/presets/new-drums-kit.ts`: GROOVE is deleted.
- Modify: `src/gen/presets/catalog.ts`
- Test: `browser-test/logic/gen-merges.mjs`

- [ ] **Step 1: Write the failing no-loss tests.**
  - `d-turn` → FILL {WHERE: 'END', SIZE: '1 BEAT'}
  - `d-euclid` → GRIDS at its Euclidean node for PERC/5/2
  - `x-turn` → TURNAROUND {MOVE: 'V7'}
  - `xd-pickup` → FILL {PADS: 'SNARE', PUSH: '1/8', DENSITY: HITS 2}
  - `n-groove` → DRUM MAP at the FOUR FLOOR node
  - The survivors' own defaults stay unchanged.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement the knobs above.
- [ ] **Step 4:** Run `npm test`. Expected: PASS, or report the failing merge.
- [ ] **Step 5:** Commit.

### Task 5: Renames, no SWING, DRIFT on New Clip

**Files:**
- Modify: `src/gen/knobs.ts`: `K.tension` is named COLOUR, `K.changes` CHORD RATE and `K.pitchFix` FIX NOTES. `K.swing` is deleted.
- Modify: `src/gen/create/sparse.ts`: `sparseKnob` is named SPACE.
- Modify: `src/gen/create/feel.ts`:
  - The row is GATE, DRIFT, (STRUM | DYNAMICS), SPACE for melodic, and DRIFT, DYNAMICS, HUMAN for drums.
  - `vary()` and SWING are deleted.
  - DRIFT runs after the feel via `driftNotes`.
  - `OwnKnob.at` keeps 1 | 2 (VARY's and SWING's old places).
- Modify: `src/gen/drift.ts`: export `driftNotes(ctx: GenCtx, notes: Note[], d: number, seed: number, chords: (Chord | null)[]): Note[]` (today's private `drift`). Drop the `create` exclusion in `catalog.ts`'s `drifts`, since New Clip now gets DRIFT from `withFeel`.
- Modify: preset names: `v-retro` BACKWARDS, `v-ornament` and `q-embellish` DECORATE (knob EMBELLISH on any survivor becomes AMOUNT).
- Modify: Variation HATS (`var-drums.ts`): SWING is deleted.
- Modify: every test and bench file that names an old knob or preset. There are about 40 lines: `grep -rn "TENSION\|CHANGES\|PITCH FIX\|SPARSE\|VARY\|'SWING'\|RETROGRADE\|ORNAMENT\|EMBELLISH" browser-test scripts/gen-bench`.
- Modify: `site/manual/generators.md`: knob table and New Clip section, with the new names and SWING removed.
- Test: `browser-test/logic/gen-engine.mjs`

- [ ] **Step 1: Write the failing tests.**

  ```js
  ok('no_preset_has_a_swing_knob', G.PRESETS.every((p) => !p.knobs.some((k) => k.name === 'SWING')));
  ok('no_old_knob_names', G.PRESETS.every((p) => p.knobs.every((k) => !['TENSION', 'CHANGES', 'PITCH FIX', 'SPARSE', 'VARY', 'BUSY'].includes(k.name))));
  ok('new_clip_has_drift', G.PRESETS.filter((p) => p.task === 'create').every((p) => p.knobs.some((k) => k.name === 'DRIFT')));
  // a New Clip default writes off-16ths exactly on the grid: the set's swing applies at playback
  ok('new_clip_writes_straight', createDefaults().every((n) => n.tick % 12 === 0 || isTriplet(n)));
  ```

- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement and update the references. Then sweep every knob's value labels for any other theory word (e.g. MORDENT, DOMINANT, TRITONE, R/L/P) and list the candidates in the commit message for the user, without renaming them (§2.6). Defaults stay unchanged except for swing: every default had VARY = 0 and SWING at the scene's, so record in the commit that defaults on a swung scene now come out straight. That is intended.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 6: Knob sets per §4

**Files:**
- Modify: `src/gen/presets/new-chords.ts`:
  - STABS gains `DENSITY` via `patternDense(ctx, STAB_MAP, v[0], d)`.
  - PAD's MOTION leaves the knobs and is fixed at SMOOTH; PATTERN becomes a knob of its own rather than an `OwnKnob`.
- Modify: `src/gen/presets/new-melody.ts`:
  - MELODY, RIFF and COUNTER gain HARMONY. Use the same create HARMONY knob CHORDS uses; `withFeel` already reads `hk`.
  - COUNTER's MOTION becomes DENSITY: 11 positions; 0–3 = STEPS, 4–7 = MIXED, 8–10 = LEAPS, and density of motion rises within each band.
- Modify: `src/gen/presets/quant-melodic.ts` and `quant-mutate.ts`: SHAPED and SHIFT gain DENSITY(5).
- Modify: `src/gen/presets/var-drums-exp.ts`: FEEL and GRIDS keep SEED (today they have it, so no change). Confirm only.
- Test: `browser-test/logic/gen-create.mjs`, `gen-quantize.mjs`

- [ ] **Step 1: Write the failing tests.**
  - `stabs_density_thins_and_fills`: n(0) < n(5) < n(10) on the locked fixture.
  - `pad_has_no_motion_knob`.
  - `melody_riff_counter_follow_harmony`: two HARMONY positions give different pitch sets.
  - `counter_density_reaches_leaps`: the largest interval at DENSITY 10 exceeds the one at 0.
  - `shaped_shift_density_centred`: DENSITY 5 is the default take.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement the knobs above.
- [ ] **Step 4:** Run `npm test`. Expected: PASS. The knob property test in `gen-engine.mjs` ("every knob moves the output") must stay green.
- [ ] **Step 5:** Commit.

### Task 7: The layout table and the preview's slot mapping

**Files:**
- Create: `src/gen/layout.ts` (data plus two functions; split into `layout-data.ts` if it passes 200 lines)
- Modify: `src/ai/preview-knobs.ts`: hardware knob `i` resolves to `slotKnob(preset, i)`. `knobLevels()` is per slot. Touch, turn and the strip go through the slot. A slot with `null` is dark and swallows its turn.
- Test: create `browser-test/logic/gen-layout.mjs` and register it.

**Interfaces:**
- Produces:
  - `LAYOUTS: Record<string, (string | null)[]>`: preset id → 8 knob names or `null`, exactly as §4's "After" lines. HARMONY† is listed as `'HARMONY'`, since Task 8 decides when it shows.
  - `DROPPED: Record<string, string[]>`: §4's dropped knobs (RE-VOICE: DRIFT; DRUM MAP: DRIFT; adopted New Clip rows per Task 12).
  - `slotKnob(p: Preset, slot: number): number | null`: the index into `p.knobs`.
  - `ROLE: Record<string, number>`: knob name → role slot, from §2.1's table (WHAT names → 1, DENSITY/AMOUNT/NOTES/LIKENESS → 2, …).
  - `EXCEPT: Record<string, string[]>`: preset id → knob names allowed off their role slot. Listed: per-pad DENSITY on 1, Quantize TIMING on 1, and each `?` resolution in §4.

- [ ] **Step 1: Write the failing tests.**

  ```js
  for (const p of G.PRESETS) {
      const L = G.LAYOUTS[p.id];
      ok(`layout_exists_${p.id}`, L && L.length === 8);
      ok(`layout_names_real_knobs_${p.id}`, L.every((n) => n === null || p.knobs.some((k) => k.name === n)));
      const missing = p.knobs.map((k) => k.name).filter((n) => !L.includes(n));
      ok(`only_listed_knobs_dropped_${p.id}`, missing.every((n) => (G.DROPPED[p.id] ?? []).includes(n)));
      ok(`nothing_dropped_while_dark_${p.id}`, !missing.length || !L.includes(null));
      ok(`slot_roles_${p.id}`, L.every((n, s) => n === null || G.ROLE[n] === undefined || G.ROLE[n] === s + 1 || (G.EXCEPT[p.id] ?? []).includes(n)));
  }
  eq('seed_on_8_drift_on_6_or_7', ...)   // every preset with both: SEED at 7 (0-based), DRIFT at 5 or 6
  ```

  In `ai-preview-knobs.mjs`, add `hardware_knob_follows_layout`: turning knob 3 (0-based 2) on a CHORDS option changes HARMONY.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement `layout.ts` from §4 and the mapping in `preview-knobs.ts`. `knobLive(ctx, p, v, i)` keeps taking the knob index.
- [ ] **Step 4:** Run `npm test` and `node browser-test/screenshot.mjs --update` (the knob LEDs move). Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 8: HARMONY, plain and in reach

**Files:**
- Create: `src/gen/theory/chord-label.ts`
- Modify: `src/gen/knobs.ts` (`K.harmony` label; `steps` is 1 when the knob doesn't apply)
- Modify: `src/gen/plan.ts`, `src/gen/create/plans.ts`, `src/gen/theory/develop.ts`, `src/gen/presets/dbl-evolve.ts` (bold moves at the far end)
- Modify: `src/gen/create/pattern-knob.ts` and `src/gen/create/plans.ts` (left ends: held chord, tonic loop)
- Test: `browser-test/logic/gen-maps.mjs`, `gen-theory.mjs`

**Interfaces:**
- Produces:
  - `chordsLabel(chords: (Chord | null)[], maxW: number): string`. Unique consecutive chords are named in movy's chord spelling (`AM`, `F`, `C`, `G7`), rests as `-`. It shows the first four, and adds `…` when there are more or the text would pass `maxW` pixels (`fontWidth`). `maxW` is the width `seqHeaderAnnounce` gives a value.
  - `harmonyApplies(ctx: GenCtx): boolean`. True on `create` for melodic parts. True on `variation` when `ctx.freedom !== 'locked'` or the role kind is `bass`, `pad` or `stabs`. False otherwise.
  - `HarmonyPlan.bold?: true`. Bold plans come only from `harmonicMoves(…, true)`, minus the plans the non-bold call already gives. They sit after every other plan, and `defaultHarmony` and `KnobDef.roll` never return one.
- Locked Variation SITS plans keep their word labels (AS PLAYED, ROOTS…), because their chords are identical.
- CHORDS and PAD:
  - PATTERN position 0 = one strike per chord change, held.
  - HARMONY position 0 (create, not locked) = the tonic chord (i in minor) for the whole loop.
  - Every other position moves +1. Defaults point at the same figure and loop as before.
- The `wild` parameter leaves `harmonicMoves`, `journey` and `createPlans`. Each builds both sets and appends the bold ones.

- [ ] **Step 1: Write the failing tests.**

  ```js
  eq('harmony_label_is_chords', label(planOf(['Am','F','C','G'])), 'AM F C G');
  ok('harmony_label_fits', fontWidth(chordsLabel(eightLongNames, W_VALUE)) <= W_VALUE && chordsLabel(eightLongNames, W_VALUE).endsWith('…'));
  eq('harmony_label_rest', chordsLabel([am, null, f, null], 999), 'AM - F -');
  ok('harmony_hidden_on_locked_lead', G.knobLive(lockedLeadCtx, nextChords, defs, hk) === false);
  ok('bold_moves_last_and_never_default', ctx.plans.findIndex((p) => p.bold) > ctx.plans.findLastIndex((p) => !p.bold) - 1 && !ctx.plans[defaultHarmony(ctx)].bold);
  eq('chords_pattern_zero_is_held', strikesPerChange(chordsAt(PATTERN, 0)), 1);
  eq('harmony_zero_is_tonic', uniqueChords(planAt(ctx, 0).chords).length, 1);
  ok('defaults_unchanged', noLoss('n-chords', …) && noLoss('n-pad', …));   // baseline extended in Task 1's recorder for n-chords, n-pad
  ```

- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement the items above. On the far end of EVOLVE's MOVE, bold evolutions are appended the same way.
- [ ] **Step 4:** Run `npm test` and `node browser-test/perf.mjs`. The harmony-map stage stays within budget even though it builds both move sets. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 9: Remove SAFE / BALANCED / WILD

**Files:**
- Modify: `src/gen/types.ts`: delete `GenLevel`, `GEN_LEVELS` and `GenInput.level`.
- Modify: `src/gen/preset.ts`: delete `LEVEL_SHIFT`; `defaults` is `k.def` clamped.
- Modify: `src/gen/select.ts`: `slotsFor(task, count)` returns BALANCED's rows; `selectOptions(cands, task, count)`.
- Modify: `src/gen/engine.ts`, `src/ai/job.ts`, `src/ai/job-types.ts`, `src/ai/job-algo.ts`: drop `level`.
- Delete: `src/seq/gen-level.ts`.
- Modify: `src/seq/prefs.ts` (the stored pref is ignored and never written), `src/seq/flags-page.ts`, `flags-page-vm.ts`, `src/midi/router.ts` (the GENERATORS row leaves Settings).
- Modify: `browser-test/gen-fixtures.mjs` (drop the `level` option) and every test passing `level`.
- Modify: `site/manual/generators.md` (remove "How bold") and the Settings page in `site/manual/` and `site/reference/controls.md`.

- [ ] **Step 1: Write the failing test** in `gen-engine.mjs`:

  ```js
  ok('no_level_anywhere', !('level' in G.prepare(fixtureInput('lead')).input) && typeof G.GEN_LEVELS === 'undefined');
  ```

  In the flags-page suite, add: `settings_has_no_generators_row`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement the removals above.
- [ ] **Step 4:** Run `npm test`, `node browser-test/screenshot.mjs --update`, then `node scripts/site/build-assets.mjs`. Expected: PASS. The Settings baseline changes.
- [ ] **Step 5:** Commit.

### Task 10: SEED, ordered close → far

**Files:**
- Create: `src/gen/seed-order.ts`
- Modify: `src/gen/knobs.ts`: `K.seed()` has 16 steps and a `seed: true` flag on `KnobDef`. New Clip's own SEED knobs (`new-melody.ts`, `new-drums-*.ts`) get the flag too.
- Modify: `src/ai/preview-knobs.ts`: a SEED knob's position `v` is mapped through `seedOrder` before `regenerate`. The order is built on the first touch or turn of that SEED knob, `SEED_PER_TICK` takes a tick, and the strip shows `...` until it is ready.
- Test: `browser-test/logic/gen-drift.mjs` (seed section), `browser-test/perf.mjs`

**Interfaces:**
- Produces:
  - `SEED_TAKES = 16` and `SEED_PER_TICK = 4`.
  - `seedOrder(ctx, p, knobs, seedIdx): Generator<void, number[], void>` yields the raw seed values sorted by `difference(take(raw), take(0))` ascending. Raw 0 is first, always. Equal distances keep raw order.
  - The order is cached per option until a non-SEED knob of that option turns (then rebuilt lazily).

- [ ] **Step 1: Write the failing tests.**

  ```js
  eq('seed_zero_is_default_take', order[0], 0);
  ok('seed_order_monotonic', dists.every((d, i) => i === 0 || d >= dists[i - 1]));
  ok('seed_turn_back_returns_same_notes', sig(at(5)) === sig(at(5, afterTurningTo(9))));
  ```

  In `perf.mjs`, add `seed_order_slice_ms`: one `SEED_PER_TICK` slice within the per-tick generation budget used for option slices.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement the items above.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 11: Quantize DENSITY's right half adds quiet notes

**Files:**
- Modify: `src/gen/presets/quant-melodic.ts`: `dense()` left of 5 = `densityStage` thinning, as today; right of 5 = DECORATE's added-note code (the passing/neighbour insertion behind EMBELLISH), with count = `(v - 5)` notes per bar at ×0.6 velocity.
- Modify: `src/gen/shape/drum-density.ts` (unchanged right side: gap fills at ×0.7). Confirm only.
- Test: `browser-test/logic/gen-quality.mjs`

- [ ] **Step 1: Write the failing test.** `quant_density_right_adds_quiet_notes`:
  - At v = 8 there are more notes than at v = 5.
  - Every added note's velocity is below the median.
  - Every original note is still there.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement the change above.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 12: New Clip adopts HOLD NOTE, PULSE, WALK, LOOPER, HARMONIZE, FOLLOW

**Files:**
- Create: `src/gen/create/seed-part.ts`
- Create: `src/gen/presets/new-adopted.ts`
- Modify: `src/gen/create/takes.ts`: `selectCreate` keeps every generator (today's 8 in catalogue order, then the adopted ones in the order above) and drops only takes the guard refused. `fresh` still prefers a take unlike recent ones.
- Modify: `src/gen/engine.ts`: New Clip's `todo` lists today's 8 presets' takes first.
- Modify: `src/gen/layout.ts`: add the adopted rows from §4.1's table, with their `DROPPED`.
- Test: `browser-test/logic/ai-new-clip.mjs`, `gen-create.mjs`, `browser-test/perf.mjs`

**Interfaces:**
- Produces:
  - `seedPart(ctx: GenCtx, kind: 'root' | 'line', bars: number): Note[]`. `root` = chord roots on the pattern map's default bass figure. `line` = chord tones on `patternAt(ctx, COMP_MAP, default)`.
  - `adopt(base: Preset, id: string, seed: 'root' | 'line', knobs: KnobDef[], accepts?: (ctx) => boolean): Preset`. It returns a `task: 'create'` preset whose `generate` builds `seedPart`, runs `base.generate` on a ctx copy with `src` set to it, and is wrapped by `withFeel` (GATE, DRIFT, DYNAMICS, SPACE).
  - Seeds per generator: HOLD NOTE, PULSE and WALK use `root`; LOOPER, HARMONIZE and FOLLOW use `line`.
  - HARMONIZE and FOLLOW `accepts` only when another melodic track plays. Their source is that track's clip, as Variation FOLLOW reads it today.

- [ ] **Step 1: Write the failing tests.**
  - `new_clip_shows_every_generator`: on the melodic `createInput`, the picks' ids include all 8 plus `HOLD NOTE`, `PULSE`, `WALK` and `LOOPER`.
  - `harmonize_follow_only_with_a_melody`: absent on an empty scene, present when the lead fixture plays on another track.
  - `adopted_parts_fit_the_scene`: `rubs(…) === 0` on the locked scene, using `scripts/gen-bench/quality/musical.mjs`.
  - In `perf.mjs`, `new_clip_full_set_ticks`: the slice count is at most 1.75 × today's, and the first 8 options are complete before any adopted take runs.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement the items above.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit (local suites gate). Update the New Clip section of `site/manual/generators.md`.

---

## Part B: preview

### Task 13: Scrolling past the picks

**Files:**
- Modify: `src/gen/engine.ts`:
  - `finishRequest` returns `{ picks, extras }`. `generateAll` returns `{ picks, extras, ctx, dropped }`, so existing callers reading `.picks` are unchanged.
  - `extras` = the best take of every serving preset not among the picks, from `req.done` (already generated and guard-accepted).
  - Order is stable: by class `close`, `rhythm`, `exp`, then by `name`.
  - New Clip and Double: `picks` is everything and `extras` is empty.
  - **My call** (spec §6 leaves the "working" display to the builder): extras need no lazy generation or `...`, because the request already runs every serving preset to pick from.
- Modify: `src/ai/job-algo.ts`, `src/ai/job-types.ts`: `AiPreviewInput.options` = picks then extras; `picksCount: number`.
- Modify: `src/ai/preview.ts`: `previewSwitch` reaches `options.length`. `previewLabels()` numbers every option.
- Modify: `src/ai/preview-render.ts`:
  - `drawPreviewStrip(index, labels, picks)` shows a window.
  - While index ≤ `picks` the window is ORIG plus the picks, as today. Beyond them it scrolls to keep the boxed cell visible.
  - The last cell reads `MORE` while options lie past the window.
- Modify: `site/reference/controls.md` and `site/manual/generators.md` (jog past the picks).
- Test: `browser-test/logic/ai-preview.mjs`, `ai-sessions.mjs`, a `screenshot.mjs` scene `preview_strip_scrolled`

- [ ] **Step 1: Write the failing tests.**
  - `extras_are_stable`: two runs on one fixture give the same extras order.
  - `extras_skip_refused`: a preset whose default is refused by the guard is absent, and no label is empty.
  - `jog_stops_at_last_option`.
  - `strip_shows_more_while_more`.
  - `parked_session_keeps_scroll`: park on option picks+2, leave the clip, come back, and the index is unchanged.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement the items above.
- [ ] **Step 4:** Run `npm test` and `node browser-test/screenshot.mjs --update`, then `node scripts/site/build-assets.mjs`. Then run `scripts/vdev.sh tier 3`. Expected: PASS and GREEN.
- [ ] **Step 5:** Commit (vdev tier). Deploy.

### Task 14: Step 14 gives New Clip options inside Variation

**Files:**
- Modify: `src/gen/engine.ts`: `startRequest` on `variation` also starts a `create` sub-request (`req.create`) on the same input with `source: null`.
  - Its `todo` holds only the role-matched New Clip generators:
    - bass → BASS;
    - pad or stabs → CHORDS, PAD;
    - lead or arpeggio → MELODY, ARP;
    - drone → HOLD NOTE;
    - drums → DRUM MAP.
  - It also holds one neighbouring role: bass ↔ RIFF, chords ↔ STABS, lead ↔ COUNTER, drums ↔ BROKEN.
  - `stepRequest` steps the variation request, then the sub-request.
  - `finishRequest` puts the role-matched New Clip pick at pick slot 3 (0-based 2) and the neighbouring one as the last pick, replacing Variation's 3rd and 6th. The replaced Variation picks go to the head of `extras`.
- Modify: `src/ai/job-types.ts`: `gen.picks[i]` gains `ctx: GenCtx`, since a New Clip option needs its own context.
- Modify: `src/ai/preview-knobs.ts`: `Opt` carries its own `ctx`, and every `ctx` use reads `o.ctx`.
- Modify: `src/ai/gestures.ts`: unchanged entry. The hold toast still says `VARIATION` on a track with clips. Confirm only.
- Test: `browser-test/logic/ai-job.mjs`, `ai-preview-knobs.mjs`

- [ ] **Step 1: Write the failing tests.**
  - `step14_has_role_matched_new_clip`: on the bass fixture, picks[2] is BASS from task `create`.
  - `step14_has_neighbour_last`: picks[5] is RIFF.
  - `step14_drums_get_drum_map`.
  - `new_clip_option_knobs_use_own_ctx`: turning HARMONY on picks[2] regenerates from its create ctx (its HARMONY steps match the create ctx's plans).
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement the items above. In `perf.mjs`, add `step14_request_ticks`: at most today's variation count plus 3 × `TAKES` slices.
- [ ] **Step 4:** Run `npm test` and `scripts/vdev.sh tier 3`. Expected: PASS and GREEN.
- [ ] **Step 5:** Commit (vdev tier). Deploy.

---

## Part C: granular undo

### Task 15: Undo and redo through the session

**Files:**
- Create: `src/ai/session-undo.ts` (the step stack, pure, no IPC)
- Modify: `src/ai/preview.ts`: record steps, apply them, commit as a step, reopen.
- Modify: `src/ai/preview-knobs.ts`: `knobsSnapshot()` / `knobsApply(snap)`. A knob gesture ends on knob release or `STRIP_TTL` with no turn, and its end calls `onStep`.
- Modify: `src/undo/apply.ts`:
  - `undoOnce` asks `aiUndo()` first.
  - With no open session and the top entry carrying `aiSession`, it calls `aiReopen(entry)` instead of applying the entry.
  - `redoOnce` mirrors this through `aiRedo()`.
  - `endAllPreviews('undo')` stays only for the case where no session claims the press.
- Modify: `src/undo/types.ts`: `UndoEntry.aiSession?: { key: string; id: number }`.
- Modify: `src/ai/sessions.ts`: `lastSession: Map<string, Open>` (clip key → its most recent session). A new run on the clip replaces it.
- Modify: `site/reference/controls.md` (Undo and Shift + Undo in the preview; Undo after keeping reopens it).
- Test: create `browser-test/logic/ai-session-undo.mjs` and register it.

**Interfaces:**
- Produces (`session-undo.ts`):
  - `interface Step { index: number; options: AiNote[][]; knobs: number[][]; clip: AiNote[] }`. `clip` = the notes showing after the step, read back with the existing clip dump for a hand edit, or the option's notes otherwise.
  - `class SessionUndo { push(s: Step): void; undo(): Step | null; redo(): Step | null; atStart(): boolean; atEnd(): boolean }`.
  - `SESSION_CAP = 128`. Past the cap, the oldest step merges into the first.
  - A push after an undo drops the redo side.
- Behaviour, by spec §2.4 and the worked example in §3:
  - **Steps:** a knob gesture, a hand edit on the clip (the existing `seq` edit path closing while a session is open), and an option switch.
  - **Undo in the preview** applies the previous step: `aiclip` with its `clip`, then the index and knobs restored, with no regeneration. At the first step it goes to ORIG with the preview open.
  - **One more Undo** closes the preview and applies the session's global entry (the held group's `uswap`), so the clip is as before.
  - **Shift + Undo** walks forward. At the end it commits again.
  - **Commit** pushes the global entry with `aiSession` set (today's `releaseHold(true)` plus the field).
  - **Undo after commit** reopens on the committed step, if `lastSession.get(key)?.id === entry.aiSession.id`, the Set uuid and engine generation are unchanged, and the clip still exists. Otherwise the entry applies as plain history.
  - **Reopening** pops the entry and keeps it on the session, so a later commit pushes it back unchanged and a close-by-undo applies it.
  - **A pending knob turn** (`pending` in `preview-knobs.ts`) is ended as its own step before the undo applies, and its regeneration is cancelled.
  - **A new session on the clip** strips `aiSession` from the previous session's entry, so it becomes plain history.

- [ ] **Step 1: Write the failing tests.** Use the mock engine (`browser-test/mock-engine.mjs`), and walk §3's worked example exactly:

  ```js
  // New Clip → option 3 → turn DENSITY → edit step 5 → turn GATE → jog click
  undo(); ok('reopens_on_committed', aiSessionOpen() && previewIndex() === 3 && clipHasStep5Edit() && gateTurned());
  undo(); ok('gate_back', !gateTurned() && clipHasStep5Edit());
  undo(); ok('edit_gone', !clipHasStep5Edit());
  undo(); ok('density_back', densityAtDefault());
  undo(); eq('option_switch_back', previewIndex(), 2);
  undo(); undo(); eq('orig_preview_open', previewIndex(), 0); ok('still_open', aiSessionOpen());
  undo(); ok('closed_clip_as_before', !aiSessionOpen() && clipEquals(before));
  redo(); /* … forward through the same steps … */ ok('redo_reaches_commit', !aiSessionOpen() && clipEquals(committed));
  ok('undo_does_not_regenerate', regenerateCalls === 0);
  ```

  Review Focus tests:
  - `undo_during_pending_turn_restores_exact`.
  - `no_reopen_after_set_switch`, `no_reopen_after_clip_deleted`, `no_reopen_after_newer_session`.
  - `parked_session_keeps_undo_steps`.
  - `undo_on_other_clip_leaves_parked_session`.
  - `cap_merges_oldest`: 130 pushes give 128 steps, and the first still restores ORIG.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement the items above. In `perf.mjs`, add `session_undo_step_ms`: an undo inside a session costs no more than an option switch (the same `aiclip` path).
- [ ] **Step 4:** Run `npm test` and `scripts/vdev.sh tier 3`. Expected: PASS and GREEN.
- [ ] **Step 5:** Commit (vdev tier). Deploy (`./scripts/deploy.sh`, "deployed, not device-tested", or DEVICE OFFLINE in CAPS).

---

## Order and gates

- Tasks run in order 1 → 15. Task 1 must run before any generator code changes.
- Tasks 1–12 are gated by `npm test` (plus screenshots where noted).
- Tasks 13–15 are gated by `npm test` and `scripts/vdev.sh tier 3`.
- No task needs the device tier: none touches audio, SPI, timing, LEDs on glass or the doors. A scoped `npm run test:device -- --scenario ai,smoke` runs before the next release (§5).
