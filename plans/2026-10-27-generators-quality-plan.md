# Generators Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measured, better generator replies (three different, usable,
harmony-led options), a model fallback, a GENERATORS creativity row in
Settings, and no user-facing "AI".

**Success measure (user):** quality = alignment with the real examples —
best-option recovery of the clean part (quantize-messy) and best-option
alignment with the real B (variation), gated on all three options usable and
different. Fit/groove are diagnostics only.

**Architecture:** A node bench in `scripts/gen-bench/` drives the shipped
`dist/esm/ai` code against real Gemini models on cases cut locally from real
MIDI (`.gen-data/`, git-ignored), scores options with pure functions, and
writes number-only reports to `plans/`. Prompt, reply format, temperature and
the default models change only where its numbers say so.

**Tech Stack:** TypeScript (QuickJS UI), node ESM scripts, logic suites in
`browser-test/logic/`.

**Spec:** `plans/2026-10-27-generators-quality-design.md`

## Global Constraints

- No model whose name contains `pro` is ever called (the runner refuses it).
- No dataset MIDI, song name or API key in git. Only `scripts/gen-bench/patterns/*.json` (our own) is musical content in the repo.
- Key only via `GEMINI_KEY_FILE` (a path) at run time.
- Code identifiers keep `ai` (`src/ai/`, `aiclip`, `ait:`); no ENGINE_VERSION bump.
- User-facing strings: `GEN` strip lead, `BUSY, TRY LATER`, `GENERATOR ERROR`, `NO API KEY` unchanged, Settings row `GENERATORS` = `SAFE`/`BALANCED`/`WILD` (default BALANCED), web page label `Movy Generators`.
- `src/` files ≤ 200 lines; `browser-test/` and `scripts/` suites ≤ ~600.
- The bench is not part of `npm test`; its pure parts are (logic suite `gen-bench.mjs`).
- Gates per CLAUDE.md: `npm test`, then `scripts/vdev.sh tier 3`; device offline → say so in CAPS. Settings row and strip change pixels → `node browser-test/screenshot.mjs --update` and doc assets.

## Review Focus

1. Fallback after the first model already answered 200 with unusable options — must NOT fall back (only 503/429/timeout do); test `fallback_only_on_busy`.
2. A level change on the Settings page while a request runs — the request keeps the level it was built with; test `level_read_once_per_request`.
3. Step-format replies with fractions (`12.25`), negative or past-the-end steps — converted and clamped exactly like ticks; test `steps_reply_converted_and_clamped`.
4. Inserting the GENERATORS row must keep MIGRATE FROM MOVE last and BACKUPS reachable as last-1 (device scenarios rely on it); test `migrate_row_stays_last`.
5. Fallback wait budget: first-model wait + fallback request must finish inside the job watchdog; test `fallback_fits_the_watchdog`.

---

### Task 1: MIDI reading, our patterns, case cutting (offline)

**Files:**
- Create: `scripts/gen-bench/midi.mjs` (SMF format 0/1 parser → notes in movy ticks, 96 per quarter; running status; meta/sysex skipped; note-on vel 0 = off)
- Create: `scripts/gen-bench/patterns/*.json` (8 idioms: techno, house, acid, dubchords, breaks, 2step, trap, arp — each a small multi-track Set in `AiTrackInput` shape)
- Create: `scripts/gen-bench/messify.mjs` (`messify(notes, deviations, seed)`: timing from a deviation list, neighbour-key mis-hits, velocity spread, one drop/double; seeded PRNG)
- Create: `scripts/gen-bench/fetch.mjs` (downloads Groove MIDI, Lakh+MidiCaps captions, GigaMIDI if reachable, into `.gen-data/src/`; reports missing sources)
- Create: `scripts/gen-bench/cases.mjs` (cuts `.gen-data/cases/*.json`: `{id, kind: 'quantize-messy'|'quantize-played'|'variation', genre, set: AiContextInput, reference: AiNote[]|null}`; ≥60% electronic; ~40 cases; deterministic seed)
- Modify: `.gitignore` (`.gen-data/`)
- Test: `browser-test/logic/gen-bench.mjs` (+ registration in `browser-test/logic.mjs`)

**Interfaces:**
- Produces: `parseMidi(buf: Uint8Array): { tpq, tracks: {name, channel, notes: AiNote[]}[] }` (ticks rescaled to 96/quarter); `messify(notes, deviations: number[], seed: number): AiNote[]`; case JSON shape above.

- [ ] Write tests: `midi_parses_running_status` (hand-built SMF bytes: two notes, running status → 2 notes with correct ticks at tpq 480 → 96), `midi_note_on_vel0_is_off`, `messify_is_deterministic` (same seed → same output), `messify_keeps_note_count_within_one`, `patterns_are_valid_sets` (every pattern JSON parses, has ≥2 tracks, notes inside clip length).
- [ ] Run `node browser-test/logic.mjs` → those FAIL (modules missing).
- [ ] Implement midi.mjs, messify.mjs, patterns, then fetch.mjs and cases.mjs.
- [ ] Run logic suite → PASS. Run `node scripts/gen-bench/fetch.mjs && node scripts/gen-bench/cases.mjs` → prints case counts by kind/genre and missing sources.
- [ ] Commit (bench code, patterns, .gitignore, test).

### Task 2: Structured harmony and scores

**Files:**
- Modify: `src/ai/harmony.ts` (add `sceneChords(clips, drum): { pcs: number[]; bass: number; name: string; root: number }[]` per master bar; `sceneHarmony` becomes a formatter over it — output byte-identical)
- Create: `scripts/gen-bench/score.mjs`
- Test: `browser-test/logic/gen-bench.mjs`, existing `ai-context.mjs` harmony tests stay green unchanged

**Interfaces:**
- Consumes: `sceneChords` from `dist/esm/ai/index.js`.
- Produces: `scoreOption(opt: AiNote[], ctx: { set, target, input: AiNote[], reference: AiNote[]|null, len }): { fit, groove, recovery|null, ideaKept, usable: boolean, reasons: string[] }`; `difference(a: AiNote[], b: AiNote[]): number` (0 same … 1 disjoint); `bAlignment(opt, a: AiNote[], b: AiNote[], len): number`; `scoreReply(options, ctx): { perOption, alignment: number|null /* best option */, gatePassed: boolean /* all usable and different */, minPairDiff, ladderOrdered: boolean }`.

- [ ] Write tests: `scene_chords_match_harmony_text` (same fixture as ai-context: bar 1 C with pcs [0,4,7], bar 2 Am), `fit_rewards_chord_tones_not_key` (an out-of-key chord tone of a borrowed chord scores higher than an in-key strong-beat clash), `fit_forgives_weak_chromatic_passing` (C–C#–D on offbeats over C major ≥ 0.9), `groove_follows_scene_onsets_not_grid` (a swung part matching swung drums scores higher than straight), `usable_flags_empty_last_half`, `difference_identical_is_zero`, `recovery_perfect_on_reference`, `b_alignment_prefers_real_b_over_copy_of_a` (B itself scores ≈1, a copy of A ≈0).
- [ ] Run → FAIL. Implement. Run → PASS (and `ai-context.mjs` unchanged-green).
- [ ] Commit.

### Task 3: Runner, cache, report

**Files:**
- Create: `scripts/gen-bench/run.mjs` (CLI `--models a,b --cases glob --level L --variant V --repeat N`), `scripts/gen-bench/report.mjs`
- Test: `browser-test/logic/gen-bench.mjs`

**Interfaces:**
- Produces: `assertModelAllowed(name)` (throws on `/pro/i`); `cacheKey(model, body, run): string` (sha256); report rows `{model, level, variant, n, alignment (headline), gate%, fit, groove, recovery, ideaKept1/2/3, p50ms, p90ms, fail%}` written to `plans/gen-bench-results-<date>-<label>.md` — numbers and model names only.
- Runner builds prompts via `buildContext`/`buildPrompt`/`buildRequest` from `dist/esm/ai`, validates via `validateOptions`, throttles per model, retries 503 ×2 with backoff, records failures.

- [ ] Write tests: `pro_models_refused` (`gemini-pro-latest`, `gemini-3.1-pro-preview` throw; `gemini-flash-latest` ok), `cache_key_stable_and_distinct`, `report_has_no_note_data` (rendered report string contains no `[` note arrays and no case ids).
- [ ] Run → FAIL. Implement. Run → PASS.
- [ ] Commit.

### Task 4: Baseline measurement (live)

- [ ] `npm run build:browser`; run the bench on the current prompt, BALANCED, all 8 non-Pro models from the design §4, 1 run per case.
- [ ] Commit `plans/gen-bench-results-2026-10-27-baseline.md`. Ledger the headline numbers.

### Task 5: Prompt, reply format, creativity levels, temperature

**Files:**
- Modify: `src/ai/prompt.ts` (split ladders into `src/ai/ladders.ts` to stay ≤200), `src/ai/validate.ts`, `src/ai/provider.ts`, `src/ai/context.ts` only if a variant needs it
- Test: `browser-test/logic/ai-validate.mjs`

**Interfaces:**
- Produces: `export type GenLevel = 'SAFE' | 'BALANCED' | 'WILD'`; `buildPrompt(task, context, { len, drum, level })`; `LEVEL_TEMPERATURE: Record<GenLevel, number>` (SAFE 0.7, BALANCED 1.0, WILD 1.3 start values); `buildRequest(cfg, p, temperature = 1.0)`; `validateOptions` accepts notes as `[step, lenSteps, pitch, vel]` when the prompt asked for steps (`ctx.units: 'steps'|'ticks'`), converting `tick = round(step*24)`.
- Variants (each A/B'd on the bench vs. baseline, kept only above repeat-run spread): V1 steps reply; V2 harmony wording (design §5); V3 checkable difference/coverage rules; V4 level temperature.

- [ ] Write tests: `steps_reply_converted_and_clamped` (`[12.25, 1, 60, 100]` → tick 294 gate 24; `-1` dropped; past end dropped), `prompt_has_no_scale_rule` (no `/fits? the key|in (the )?scale/i`; says chords of the other tracks), `levels_shift_the_ladder` (SAFE option 1 text ≠ WILD option 1 text; BALANCED == today's ladder text), `temperature_per_level` (request body temperature 0.7/1.0/1.3).
- [ ] Run → FAIL. Implement. Run → PASS.
- [ ] Bench each variant (finalists ×3 repeats); keep winners; commit code + `plans/gen-bench-results-2026-10-27-variants.md`.

### Task 6: Fallback model

**Files:**
- Create: `src/ai/models.ts` (`modelChain(cfg): string[]` — configured/primary first, fallback second, deduped; `FALLBACK_WAIT_S`)
- Modify: `src/ai/config.ts` (`AiConfig.models: string[]` replaces `model`), `src/ai/job.ts` (on BUSY with a next model: start it, keep the screen running), `src/ai/http-job.ts` (per-request timeout), `settings-schema.json` (Model field help: "blank = automatic")
- Test: `browser-test/logic/ai-job.mjs`, `ai-config.mjs`

- [ ] Write tests: `fallback_only_on_busy` (503 → second request to the fallback model; 200 with garbage → MSG_ERROR, no second request), `fallback_both_busy_shows_busy`, `model_field_replaces_primary_keeps_fallback`, `fallback_fits_the_watchdog` (first wait + fallback timeout < watchdog), `level_read_once_per_request`.
- [ ] Run → FAIL. Implement. Run → PASS. Default models from the Task 4/5 numbers. Commit.

### Task 7: GENERATORS row in Settings

**Files:**
- Create: `src/seq/gen-level.ts` (`genLevel(): GenLevel`, `genLevelTurn(delta): boolean`, `genLevelLabel()`, `resetGenLevel()`)
- Modify: `src/seq/prefs.ts` (`readPrefGenLevel`/`writePrefGenLevel`, optional key, default BALANCED), `src/seq/flags-page.ts` (row 1 `GENERATORS`, hint "How bold the generators are. Turn knob 1."; `genRowSelected`; backups/migrate indexes from the list, not literals), `src/seq/flags-page-vm.ts`, `src/midi/router.ts` (knob 1 on the row), `src/ai/job.ts` (reads `genLevel()` when building the request)
- Test: a flags-page logic suite (`browser-test/logic/` existing flags suite), `screenshot.mjs` scene `flags_generators`

- [ ] Write tests: `gen_level_turn_clamps` (BALANCED +1 → WILD, +1 → stays WILD, −2 → SAFE), `gen_level_persists` (written to prefs, read back after reset), `migrate_row_stays_last`, `generators_row_drawn` (vm row 1 name/value).
- [ ] Run → FAIL. Implement. Run → PASS. Screenshot `--update`, add scene. Commit.

### Task 8: Rename user-facing AI → generators

**Files:** `src/ai/preview-render.ts` (`GEN`), `src/ai/provider.ts` (`BUSY, TRY LATER`, `GENERATOR ERROR`), `src/ai/job.ts`, `settings-schema.json` (`Movy Generators`), tests that pin strings, `MANUAL.md`, `README.md`, `CHANGELOG.md`, screenshot baselines + `docs/assets` via `make-doc-assets.mjs`.

- [ ] Write/adjust tests first: `strip_lead_reads_gen`, classify strings, `no_ai_in_user_strings` (grep `src/ai/*.ts` string literals shown on screen for `/\bAI\b/` → none).
- [ ] Run → FAIL. Rename. Screenshots `--update`; doc assets. Run → PASS. Commit.

### Task 9: Final run, defaults, docs, gates

- [ ] Finalists ×3 at all three levels; commit `plans/gen-bench-results-2026-10-27-final.md`.
- [ ] MANUAL: GENERATORS row, fallback, harmony behaviour; CHANGELOG.
- [ ] `npm test` green; `scripts/vdev.sh tier 3` green (pre-existing midi-out WIP excepted and named); deploy if `move.local` reachable, else DEVICE OFFLINE in CAPS. Commit + push.
