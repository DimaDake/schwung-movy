# Generator Audition App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A private phone page (claude.ai Artifact) that plays generator cases, records Keep/Meh/Bad + reasons + fault marks into the Artifact database, and a bench pair (report + regression) that turns those ratings into generator fixes.

**Architecture:** A node exporter under `scripts/gen-bench/audition/` builds cases from the existing quality-bench builders (`paths.mjs`, `chains.mjs`, `loo.mjs`, `keep.mjs`), each with a deterministic `recipe` so it can be rebuilt at any later build. Cases are written as split JSON files published beside a single-page HTML app (WebAudio synth, canvas roll). Ratings live in the Artifact `db`; Claude dumps them with `ArtifactData list` to a JSON file that `report.mjs` and `regress.mjs` read.

**Tech Stack:** Node ESM (repo's `~/.local/node`), the built `dist/esm/gen/index.js`, vanilla JS + WebAudio + Canvas in the page (no CDN libraries), Artifact capabilities `db` + `user`.

**Spec:** `movy/plans/2026-11-07-gen-audition-design.md`

## Global Constraints

- Queue weights: **50% option sets / 30% bench-flagged / 20% blind pairs**; stratified so every generator appears early.
- Blind refs: **equal mix** of `kind: 'user'` and `kind: 'public'` scenes from `.gen-data/refs.json`.
- Rating values exactly `keep | meh | bad`. Reason chips exactly: `clash`, `too busy`, `too sparse`, `off-groove`, `boring`, `wrong register`, `doesn't fit scene`, `other`.
- Marks are `{ bar, beat }` (1-based) on the roll; optional, several allowed.
- Reveal only after the rating is written.
- Controls: hold-to-solo the part under test, mute per track chip, tempo slider (scene bpm, 120 when none), note roll with the part under test highlighted.
- First case audible within ~2 s on phone data: first case file ≤ 300 KB; files of 200 cases.
- Page: phone width, 16 px gutter, no horizontal scroll, colour tokens on `:root` with the dark-mode rules from the Artifact contract, explicit `body` background; no external scripts.
- Note format everywhere in cases: `[startBeat, durBeats, pitch, vel]` (beats, as `refs.json` and `sceneAt` use), rounded to 1/96.
- Every case carries `recipe` (enough to rebuild it) and `build` (git short sha of the export).
- File-size rule: scripts ≤ 200 lines each; tests in `browser-test/logic/gen-audition.mjs` (≤ 600).
- Gates: no integration surface → local suites only (`npm test`); say so in commits. Deploy at the end (`./scripts/deploy.sh`, "deployed, not device-tested"), or DEVICE OFFLINE.

## Review Focus

1. **A re-export must keep ratings attached**: the same recipe at the same build gives the same `id`; a different build gives a new `id` but the same `recipeKey`, so before/after pairs and the regression bench join on `recipeKey`. Test in Task 1.
2. **iOS Safari audio unlock**: AudioContext created/resumed inside the first tap; a locked context must not leave the page "playing" silently. Test in Task 4 (core: `needsUnlock` state), checked by hand on the phone.
3. **Rating twice / going back**: a second rating of the same case+option overwrites (doc id is deterministic), never duplicates. Test in Task 4.
4. **Empty or signed-out db**: `claude.use("db")` → `null` or a refused write must show "ratings not saving" and keep the queue usable, with ratings held in localStorage and flushed later. Test in Task 4.
5. **Options with fewer than six picks / a generator returning nothing**: the exporter skips empty options and never writes a case with zero playable options. Test in Task 2.

---

### Task 1: Case model

**Files:**
- Create: `scripts/gen-bench/audition/case.mjs`
- Create: `browser-test/logic/gen-audition.mjs` (+ one line in each of `browser-test/logic.mjs`'s two suite lists)

**Interfaces:**
- Consumes: `sceneAt`, `scaleOf` (`quality/scene.mjs`); `drumRoles` (`quality/relations.mjs`).
- Produces:
  - `sceneOf(set, slot, swap?) -> { len, bpm, key, tracks: { drums, bass, chords, lead } }` — notes as in Global Constraints; `drums` = kick+snare+hats+perc merged, original pitches kept.
  - `recipeKey(recipe) -> string` — stable JSON (sorted keys) → 12-hex FNV-1a hash.
  - `makeCase({ kind, recipe, build, scene, target, generator, knobs, options?, truth?, bench }) -> Case` where `Case.id = recipeKey(recipe) + '-' + build`, `Case.recipeKey = recipeKey(recipe)`.
  - `Case` fields: `id, recipeKey, kind ('set'|'flagged'|'blind'), build, recipe, scene, target ('drums'|'bass'|'chords'|'lead'), generator, knobs, options? [{ preset, knobs, notes, bench }], truth? ('real'|'gen'), bench: { ok, bad: string[] }`.

- [ ] **Step 1: Write the failing tests** in `gen-audition.mjs`:
  - `recipeKey` is order-independent: `recipeKey({a:1,b:2}) === recipeKey({b:2,a:1})`, length 12.
  - same recipe, two builds → same `recipeKey`, different `id`.
  - `sceneOf` on a 2-track set returns all four track keys, empty arrays for missing ones, notes rounded to 1/96, `bpm` = set.bpm.
- [ ] **Step 2: Run** `npm run build:browser && node browser-test/logic.mjs` — FAIL (module missing).
- [ ] **Step 3: Implement** `case.mjs`.
- [ ] **Step 4: Run** the same — PASS.
- [ ] **Step 5: Commit** `audition: case model (stable recipe keys)` — local suites.

### Task 2: Case sources (option sets, flagged, blind) + rebuild

**Files:**
- Create: `scripts/gen-bench/audition/sources.mjs`
- Test: `browser-test/logic/gen-audition.mjs`

**Interfaces:**
- Consumes: Task 1; `emptySet`, `buildPath`, `ROLE_PRESETS` (`paths.mjs`); `sceneA`, `sceneB` and the `request` shape of `chains.mjs` (export `request` from `chains.mjs` — one-word change, no behaviour change); `refSet`, `leaveOneOut` (`loo.mjs`); `judge`, `judgeRole` (`keep.mjs`); `base`, `clip`, `put` (`piece.mjs`).
- Produces:
  - `rebuild(G, recipe, bands, refs) -> Case | null` — the one builder; the exporter and the regression bench both call it.
  - Recipes:
    - `{ src: 'path', seed, order: number[], step: number }` — New Clip on `order[step]` after `order.slice(0, step)` were built; case kind `set`, options = the role's `ROLE_PRESETS` picks (all six when the role has none).
    - `{ src: 'chainB', seed, order, step }` — Variation into scene B; kind `set`.
    - `{ src: 'double', seed, track }`, `{ src: 'quantize', seed, track }` — kind `set`.
    - `{ src: 'loo', ref: refs[i].src, track, truth: 'real'|'gen' }` — kind `blind`; `gen` plays the first role option, `real` the ref part; options absent.
  - `flaggedRecipes(G, bands, refs, n) -> recipe[]` — `set` recipes whose kept take fails `judge` (bench `ok === false`), ordered by `bad.length` desc, then `n` first; exported as kind `flagged` (same recipe, `flagged: true` field).
  - `setRecipes(seeds) -> recipe[]`, `blindRecipes(refs) -> recipe[]` — the full pools (blind: every ref × track with a part, both truths, user/public alternating).

- [ ] **Step 1: Failing tests:**
  - `rebuild` twice on one `path` recipe → identical notes (determinism).
  - every `set` case has ≥ 1 option, every option has notes (Review Focus 5: a recipe whose generator returns nothing → `null`).
  - a `loo` `real` case's target notes equal the ref part (beats), a `gen` case's differ.
  - `blindRecipes` alternates `kind` user/public over its first 20.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** `sources.mjs` (reuse bench builders; no copy of their logic).
- [ ] **Step 4: Run** — PASS; `node scripts/gen-bench/quality/chains-run.mjs --label tmp` still prints the round-6 numbers (export-only change).
- [ ] **Step 5: Commit** `audition: case sources and rebuild from a recipe`.

### Task 3: Queue + exporter

**Files:**
- Create: `scripts/gen-bench/audition/queue.mjs`, `scripts/gen-bench/audition/export.mjs`
- Test: `browser-test/logic/gen-audition.mjs`

**Interfaces:**
- Consumes: Tasks 1–2; `writeMidi` (`quality/midi-write.mjs`).
- Produces:
  - `interleave(pools: { set, flagged, blind }, weights = { set: .5, flagged: .3, blind: .2 }, seed) -> Case[]` — weighted round-robin; within a pool, round-robin over `generator` so no generator repeats until all have appeared once.
  - CLI: `node scripts/gen-bench/audition/export.mjs [--label <sha>] [--limit N] [--first <ids.json>]` → `.gen-data/audition/<label>/`: `manifest.json` `{ build, files: ['cases-000.json', ...], counts }`, `cases-NNN.json` (200 cases each), `midi/<id>.mid`. `--first` puts before/after pairs of the given recipeKeys at the head (Task 6 writes that file).
- [ ] **Step 1: Failing tests:** `interleave` over 100/60/40 gives kind shares within ±5% of 50/30/20 in the first 50; first N (N = distinct generators) entries of the `set` stream have distinct generators; deterministic for one seed.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS; then `npm run build:browser && node scripts/gen-bench/audition/export.mjs --limit 400` writes the files, `cases-000.json` ≤ 300 KB.
- [ ] **Step 5: Commit** `audition: weighted queue and exporter`.

### Task 4: Page core (pure, node-tested)

**Files:**
- Create: `scripts/gen-bench/audition/page/core.js` (ESM, no DOM)
- Test: `browser-test/logic/gen-audition.mjs`

**Interfaces:**
- Produces:
  - `ratingDoc(c, option, rating, reasons, marks, text) -> { id, data }` — `id = c.id + '~' + (option ?? 'p')` (Review Focus 3); `data = { caseId, recipeKey, build, kind, generator, option, rating, reasons, marks, text, at }`.
  - `schedule(scene, fromBeat, toBeat, bpm, muted: Set, solo: string|null) -> [{ track, t, dur, pitch, vel }]` — events in seconds relative to `fromBeat`, loop-wrapped at `scene.len`; `solo` keeps only that track.
  - `markAt(xFrac, scene) -> { bar, beat }` (4/4, 1-based).
  - `outbox` helpers: `pending(list)`, `enqueue(list, doc)`, `drop(list, id)` — localStorage-backed retry list when db is null or a write rejects (Review Focus 4).
  - `nextIndex(queue, rated: Set<id>, from) -> number`.
- [ ] **Step 1: Failing tests:** `ratingDoc` same case+option twice → same id; `schedule` wraps a note at beat len-0.25 into the next loop; muted track absent; solo leaves one track; `markAt(0.51, {len: 8})` → `{bar: 2, beat: 1}`; outbox enqueue same id twice keeps one.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `audition: page core`.

### Task 5: The page + publish

**Files:**
- Create: `scripts/gen-bench/audition/page/index.html` (layout + CSS tokens), `page/app.js` (DOM, db, queue), `page/synth.js` (WebAudio voices + look-ahead scheduler), `page/roll.js` (canvas roll + marks)
- Create: `scripts/gen-bench/audition/publish.mjs` — copies `page/*` + the export's `manifest.json`/`cases-*.json` into `.gen-data/audition/site/`, inlines `core.js`/`app.js`/`synth.js`/`roll.js` into `index.html` (one page; cases stay separate files).

**Interfaces:**
- Consumes: Task 4 core; `manifest.json` + `cases-NNN.json` fetched by relative path.
- Produces: the published Artifact (icon `music`), capabilities `{ db: {}, user: {} }`; ratings collection `ratings`, doc ids from `ratingDoc`.

Behaviour (spec "The page"): tap-to-start (audio unlock, Review Focus 2); case header (kind badge hidden until reveal for `blind`, key, bpm); track chips (tap = mute, target outlined); hold Solo; roll with playhead, tap = add mark, tap a mark = remove; Keep/Meh/Bad bottom bar (thumb reach); Bad opens the chips + optional text; for `set`, a swipe/arrows strip over the options, each rated, a star toggle for the best (stored as reason `best`); after writing → reveal card (truth, generator, knobs, bench ok/bad metrics; "ear ≠ bench" badge when `bench.ok` and rating `bad`, or `!bench.ok` and `keep`); Next. Progress per kind, resume at first unrated (`nextIndex`), "ratings not saving" banner when db null/refused. Voices: kick (sine pitch drop), snare (noise + tone), hats (HP noise), perc (short tone by pitch), bass (saw+sine through LP), chords (detuned saw pad, slow attack), lead (pluck); target +3 dB; 100 ms look-ahead, 25 ms timer.

- [ ] **Step 1:** Load `artifact-design` skill; build the page; open `.gen-data/audition/site/index.html` locally in Chrome (claude-in-chrome or `npx http-server`) at 390 px width: plays, mutes, solo, mark, rating stored in the outbox (no db locally).
- [ ] **Step 2:** `node scripts/gen-bench/audition/publish.mjs` then Artifact publish `index.html` with `files` = the case files, `capabilities: { db: {}, user: {} }`.
- [ ] **Step 3: Verify** (artifact-capabilities rule): rate one case on the published page (the user, or ask them), then `ArtifactData list ratings` shows the doc with the expected fields.
- [ ] **Step 4: Commit** `audition: phone page and publish script` (the page sources + publish.mjs; never the `.gen-data` output) — local suites.

### Task 6: Act-on-ratings report

**Files:**
- Create: `scripts/gen-bench/audition/report.mjs`
- Test: `browser-test/logic/gen-audition.mjs`

**Interfaces:**
- Consumes: `.gen-data/audition/ratings.json` (Claude writes it from `ArtifactData list ratings`, all pages), the export's case files.
- Produces: `summarise(ratings, cases) -> { byGenerator: [{ generator, n, keep, meh, bad, reasons: {chip: n}, marks: [{caseId, bar, beat}], earVsBench: { benchOkUserBad, benchBadUserKeep } }], blind: { realKeep, genKeep } }`; CLI writes `.gen-data/audition/report.md` (generators sorted by bad share × n) and `first.json` (recipeKeys rated bad, for `export.mjs --first`).
- [ ] **Step 1: Failing tests:** two ratings of one case id (overwrite) count once; a `blind` rating counts under `blind` and its generator; earVsBench classes match the rule in Task 5.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `audition: ratings report`.

### Task 7: Regression bench (the user's ear as a gate)

**Files:**
- Create: `scripts/gen-bench/audition/regress.mjs`
- Modify: `browser-test/logic/gen-audition.mjs`

**Interfaces:**
- Consumes: `rebuild` (Task 2), `ratings.json`, case files.
- Produces: `compare(old: Case, now: Case) -> 'same'|'changed'` (target notes, or the rated option's notes, by `G.difference` < 0.02 = same); CLI prints and writes `.gen-data/audition/regress.md`: **"your Bads: changed N / still same M"**, **"your Keeps changed: K"** with each changed Keep listed for re-listening (not a failure, per spec), and exits 0. Real (`truth: 'real'`) blind cases are skipped.
- [ ] **Step 1: Failing tests:** a rebuilt recipe at the same build → `same`; a case with altered notes → `changed`; a `real` blind case is skipped.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Add the regress command to the bench run order in `plans/2026-11-07-generation-paths-bench.md` (a "Round 7: the ear" section with how to run). `npm test` green.
- [ ] **Step 6: Commit** `audition: regression bench on rated cases`; push; deploy (`./scripts/deploy.sh`, nothing in it ships — say "deployed, not device-tested") or DEVICE OFFLINE.

---

## The loop afterwards (not a task)

On "act on ratings": `ArtifactData list ratings` → `.gen-data/audition/ratings.json` → `report.mjs` → read rolls at the marks → fix generators as in the bench rounds → `regress.mjs` + the quality benches → `export.mjs --first first.json` → republish to the same artifact URL.
