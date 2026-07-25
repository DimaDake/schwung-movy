# Design — full `ui_hierarchy` traversal (generic path)

**Date:** 2026-07-25
**Status:** approved (design), pending implementation plan
**Files:** `src/model/hierarchy.ts` (generic no-config path only)

---

## 1. Problem

Helm (`andree182/schwung-helm`, installed on the device, 161 chain_params,
31 hierarchy levels) renders **one** page in movy — Main, plus the Preset
page. Its 21 category levels (Oscillator 1/2, Filter, all four envelopes,
three LFOs, step sequencer, arpeggiator, delay, reverb, …) are unreachable.

The cause is not helm-specific. `loadHierarchy`'s generic path walks the
level graph with four rules that each drop levels:

| # | Rule (today) | Where | Effect |
|---|---|---|---|
| G1 | Nav entries are read from **either** `root.params` **or** `root.children`, never both (`hasNavEntries` → `navLevel`) | `hierarchy.ts:291-296` | helm's root lists one nav entry (`category_jump`, an empty items-picker level); its 21 real category links live under `children: "main"` and are never seen |
| G2 | A level renders its knobs **or** recurses into its children — `else if` | `hierarchy.ts:357-366` | dexed `operators` (6 knobs + nav to op1..op6), forge `Voice` (8 knobs + nav to Osc/Filter/Env/Mod/Setup), minijv `tone1` all render their own page and drop every sub-level |
| G3 | `depth > 2` cut-off | `hierarchy.ts:351` | deeper trees truncated (minijv is 4 levels deep) |
| G4 | When `navLevel !== rootLevel`, navLevel's own knobs are never rendered | `hierarchy.ts:294-296` | minijv `patch_main`'s 8 knobs vanish |

Measured against the 76-module dump (`docs/module-dump/device-dump.json`)
plus a live helm capture:

| module | pages today | pages after | levels |
|---|---|---|---|
| helm | 1 | ~29 | 31 |
| minijv | 7 | ~47 | 55 |
| dexed | 5 | ~23 | 24 |

Modules with a movy config (plaits, wurl, mrdrums, forge, …) are unaffected —
they never enter this code path.

---

## 2. Design

Replace the `hasNavEntries` / `navLevel` selection and `addLevelOrExpand`
with a single visited-guarded depth-first walk of the level graph:

```
visit(levelKey, parentName):
    if levelKey in visited: return
    visited.add(levelKey)
    lvl = allLevels[levelKey]; if !lvl: return

    keys = lvl.knobs → key list
    if keys non-empty and keys not already rendered:
        addLevel(label(lvl, parentName), keys)

    for entry in lvl.params where entry.level:      # always, not `else`
        visit(entry.level, lvl.name)
    if lvl.children:                                # always
        visit(lvl.children, lvl.name)
```

Seeded from `root`: root's knobs become **Main** exactly as today, then both
`root.params` nav entries **and** `root.children` are visited.

Decisions:

- **`children` normalisation.** The field is variously `null`, absent, or the
  literal string `"None"` (dexed dumps `"children": "None"`). All three are
  treated as absent.
- **No depth cap.** `visitedLevels` bounds the walk to the module's level
  count; cycles terminate. Approved: expose everything rather than cap
  (surge is already 31 pages today).
- **Dedupe by exact knob key-list, first occurrence wins.** A level whose
  knob key list equals one already rendered contributes no page. This is what
  keeps `root.children` aliases from producing a second identical page.
  Verified across all 77 modules: the only duplicate key-lists that exist are
  root↔alias pairs (16 modules, §3) and minijv `performance`↔`perf_main`
  (also a `children` alias). No module has two *genuinely distinct* pages
  sharing a key list, so global dedupe cannot collapse pages that a selector
  param distinguishes.
- **Page names:** the existing `levelNameToPrefix` (parent name abbreviated to
  6 chars) applied at every depth instead of only depth 1 — `Voice/Osc`,
  `Tone 1/Filter`, `Op 1/EG`. Levels needing more than 8 knobs keep the
  existing ` - N` suffix. Approved over full ancestor paths (header is 128 px,
  shared with the module name) and over bare names (minijv would show four
  pages called `Filter`).
- **`children`-reached levels are prefix-transparent.** Such a level stands in
  for its parent's menu (moog, helm and minijv all park root's menu there)
  rather than being a category, so it neither takes nor contributes a prefix.
  Without this every moog page would be renamed `main/Oscillator 1`. A level
  reached through a `params` nav entry does contribute its name as the prefix —
  that is what keeps `Mod/Pitch` and `Tone 1/Filter` apart.
- **Label precedence: `level.name` → nav-entry label → `level.label` → key.**
  Most modules carry a level's display name on the *parent's* nav entry, so the
  label map must be collected from every level's nav entries, not just the
  root's. Nav label beats the level's own `label` because that is the name movy
  shows today: 24 levels across dexed/linein/minijv/obxd/sf2/sfz/nam disagree
  between the two, and preferring the level's own label would rename them all.
  The own-`label` fallback matters for the 11 levels reached only via
  `children`, which no nav entry names (minijv `patch_main` → `Patch`).
- **Orphan sweep.** After the walk, any level with knobs that no edge reached is
  appended (prefix-free, declaration order). In the fleet this is only minijv's
  `performance`, `perf_main` and `part_selector`; without it those 9 params stay
  permanently invisible and the reachability invariant in §4 could not be
  universal.
- **Main keeps its name.** For the 16 modules where a level exactly duplicates
  root, the retained page is root's, labelled `Main` — not renamed to the
  module's own label (`Patch`, `Console`, `BOOM`). Consistency across modules
  beats per-module labels.

Everything downstream is unchanged: pages are still fixed `KNOBS_PER_PAGE`
slices of `s.knobParams`, param metadata still resolves through the same
`cpMap`/`paramDefs` precedence, and `automatable` is untouched.

---

## 3. No usability regressions

The change only ever *adds* pages, except for one case: 16 modules publish a
level whose knob list is an exact copy of `root.knobs`, and movy renders both
today — i.e. these modules currently show a **duplicate page**:

| module | duplicate level | module | duplicate level |
|---|---|---|---|
| genera | `genera` | dissolver | `Dissolver` |
| denis | `Oscillators` | granular | `Granular` |
| essaim | `Global` | magneto | `Main` |
| fizzik | `Patch` | palette | `Console` |
| krautdrums | `Kraut` | spectra | `Main` |
| signal | `generate` | structor | `Structor` |
| weird-dreams | `Voice` | superboom | `BOOM` |
| mrdrums* | `pad_settings` | verglas | `Verglas` |

\* mrdrums has a movy config and never reaches this path.

Removing the duplicate is the intended improvement; no parameter becomes
unreachable, because the identical key list is still on Main.

Risks checked and cleared:

- **Persisted automation is safe.** Lanes are keyed by `target:ioKey` param
  strings (`src/seq/automation.ts:126`), not by global knob index, so shifted
  indices cannot break saved sets. Same for LFO `modulatedKeys`.
- **Per-tick cost is unchanged.** `refreshOneParam` is a round-robin cursor —
  one `shadow_get_param` per tick regardless of param count. Only
  `buildViewModel`'s `allValues` map is O(N), pure JS with no IPC.

Gate (enforced by tests, §4): **no param key that is reachable today may
become unreachable**, and any page that disappears must be an exact-duplicate
key list of a page that remains.

---

## 4. Testing

1. **`browser-test/dump-replay.mjs`** — add the live helm capture as a 77th
   dump entry so helm becomes a permanent regression case. Then `--update`
   and review the snapshot diff module by module; that diff is the review of
   this change.
2. **New permanent invariants** in dump-replay:
   - **every knob key declared in any hierarchy level is reachable on some
     page.** Derived from the raw `ui_hierarchy`, so it is independent of the
     walk it guards (not a test of the code against itself). Scoped to modules
     without a movy config, which curate a subset on purpose;
   - the shown-key set per module (add `shownKeys` to the snapshot) — the
     `--update` diff then makes any lost key visible and reviewable.
3. **One-time regression gate:** compare pre-change and post-change snapshots
   and assert every module's shown-key set is a superset of the old one.
4. **`browser-test/logic.mjs`** — unit cases for the four structural shapes:
   root-with-`children`-nav (helm), knobs+children on one level (dexed),
   depth-3 nesting (minijv), duplicate alias level (chiptune).
5. **`browser-test/perf.mjs`** — a helm-sized module (≈400 params) asserted
   against the existing render/IPC budgets.
6. **`browser-test/screenshot.mjs`** — a helm page baseline; new short-name
   collisions may need entries in `KNOWN_COLLIDING_PAGES`.
7. **Device** — deploy and walk helm's pages on slot 2 (`scripts/test.sh`),
   confirming pages render and knobs move real params.

## 5. Out of scope

- A page-jump overlay for long page lists (helm 29, minijv 47 pages remain
  sequential prev/next). Worth a follow-up; not needed to fix the bug.
- Per-unit pad-style scoping for dexed operators / minijv tones
  (`docs/module-dump/IMPROVEMENTS.md` B2) — orthogonal, config-driven.
