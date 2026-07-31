# Design — expose `ui_hierarchy` `params[]` entries (generic path)

**Date:** 2026-07-31
**Status:** approved (design), pending implementation plan
**Files:** `src/model/hierarchy.ts`, `src/model/hierarchy-walk.ts`,
`src/model/store.ts`, `src/model/tick.ts`, `src/midi/router.ts`
**Predecessor:** `plans/2026-07-25-hierarchy-full-traversal-design.md` (levels)

---

## 1. Problem

The osirus (Access Virus) module shows **Preset**, **Bank** and **ROM** (the
Virus model) selectors in schwung's native UI. None of the three are reachable
in movy.

Two independent causes.

### P1 — movy renders a level's `knobs[]`, never its `params[]`

Schwung's `ui_hierarchy` gives every level two arrays:

- `knobs[]` — the ≤8 keys the native UI binds to the encoders,
- `params[]` — the level's full list view: **param entries** (`{key, label}`)
  *and* **nav entries** (`{level, label}`) into sub-levels.

`loadHierarchy`'s generic path (and `buildLevelPages`) reads `knobs[]` for
pages and `params[]` only for nav edges and label metadata. Every param that a
module declares in a list but not on an encoder is therefore invisible in movy.

For osirus this hides `bank_index` (root, "Bank") and `rom_index` (settings,
"ROM"), plus 104 more — the module's own dump entry already records the
warning: *"108 chain_params not reachable in movy"*.

It is not an osirus quirk. Across the 76-module device dump plus the helm
fixture, **45 generic-path modules hide 721 params** this way (§7).

### P2 — preset/enum metadata is read once, before the module is ready

osirus loads its ROM asynchronously. At dump time it reported:

```
preset_count = 0            rom_index.options = ["(loading)"]
```

`loadHierarchy` reads `preset_count`/`preset_names` and each enum's `options`
exactly once, at module-load time. `buildPresetParam` returns `null` when the
count is 0, so the Preset knob is **silently dropped** and never reconsidered;
`rom_index` would render as a one-entry enum showing `(loading)` forever.

So P1 alone would give osirus Bank + ROM-as-placeholder, and still no Preset.
Both halves are needed to answer the original request.

### P3 (regression risk created by P1) — whole-array read-back

`refreshOneParam` (`store.ts:210`) round-robins the **entire** `knobParams`
array, one param per device tick (~205 Hz). A param's displayed value is
therefore up to `knobParams.length` ticks stale. P1 grows that array by ~40 %
(osirus 104 → 192 entries, minijv 408 → 568), which would slow on-screen
read-back for every module — a real usability regression, and the one thing
this change must not ship.

---

## 2. Design

### 2.1 Page composition (P1)

Per level, in hierarchy order, the page key list becomes:

```
keys(level) = knobs(level) ++ extraParams(level)

extraParams(level) = [ e.key for e in level.params
                       if e.key                      # not a nav entry
                       and e.key not in seen         # global dedupe
                       and e.key != root.list_param  # rendered as the Preset knob
                       and not e.key.startsWith('ui_') ]
```

`seen` is seeded with **every** `knobs[]` key from **every** level (a level's
`params[]` normally re-lists its own knobs, and levels overlap), then grows as
each level's extras are consumed, so a key appears on exactly one page.

Excluding `ui_*` matches the existing no-hierarchy `chain_params` fallback:
those keys are the module's internal UI state, not user-facing params.

Declaration order is preserved, so movy's pages read in the same order as the
native list view.

Metadata resolution is unchanged (`chain_params` → hierarchy `params[]` →
guessed). Only **6 keys fleet-wide** (`plaits.fm_preset`, four `sf2.*`,
`ducker.vel_sens`) have no `chain_params` entry; the existing `metaGuessed`
path (`meta-infer.ts`) already infers their type/range from the first value
read, and of those six only `ducker` and `sf2` are on the generic path.

**Config-path modules are untouched.** A module with a `ModuleConfig` returns
early, before this code: `signal, chordism, hush1, weird-dreams, sfz, essaim,
chiptune, mrdrums, plaits, 303, krautdrums, wurl` see no change at all.

### 2.2 Page naming

`addLevel` currently names a multi-page level `X - 1`, `X - 2`, … With extras,
many single-page levels become multi-page, so every module's first page would
gain a `- 1` suffix — a visible change on modules that are fine today.

**Change:** page 1 keeps the bare level name; numbering starts at `- 2`.

```
Oscillators          (knobs)
Oscillators - 2      (extras 1-8)
Oscillators - 3      (extras 9-16)
```

This alters existing names only for the 11 levels fleet-wide that already
exceed 8 knobs (eucalypso `lane1..4`, impressive-chords/breakbeat/rex/freak/
mrdrums roots, surge `scene`), and it makes those read better too.

### 2.3 Page-first read-back (P3)

`refreshOneParam` alternates:

- **even ticks** — advance a cursor over the *current page's* 8 slots,
- **odd ticks** — advance the existing global cursor over `knobParams`.

On-screen values then refresh in ~16 ticks (< 0.2 s) regardless of module size,
versus ~104 ticks for osirus today; off-page values still converge in the
background so a page switch shows fresh values quickly. Suppression rules
(`REFRESH_SUPPRESS_TICKS`, `noRefreshKeys`, `modulatedKeys`) are unchanged, and
the double-refresh of a param that is both on-page and at the global cursor is
harmless (same read, idempotent).

Net effect: on-screen read-back gets **faster than today for every module**,
which is what makes the page growth safe.

### 2.4 Async metadata re-resolution (P2)

`processTick` already polls the module name every `NAME_POLL_TICKS`. Add a
**bounded, latching re-resolve** on that same poll — no new timer:

```
unsettled(s) = (root declared list_param/count_param  and  no presetParam built)
            or (any rendered enum has options == null or a placeholder set)

placeholder set = exactly one option, matching /^\(.*\)$/   e.g. ["(loading)"]
```

While `unsettled(s)` and `s.metaRetries < META_RETRY_LIMIT` (8 polls; `NAME_POLL_TICKS`
is 344 ticks ≈ 1-2 s each, so ~10 s of grace), re-read the count/options; if either changed, rebuild the
hierarchy (`s.hierarchyKey = ''` so `processTick`'s existing reload path runs)
and reset `knobPage` only if the page count shrank below it. When it settles or
the limit is hit, latch off — the counter resets on genuine module change, the
same trigger that clears `paramGestures`.

Cost when settled: one extra `shadow_get_param` per poll on modules that
declare a preset list, zero once latched.

The exact predicate is confirmed against the device before implementation (§6).

### 2.5 Shift + jog skips banks

`bankEntries` gains `group: number` — the index of the level that produced the
page. Pages from the same level share a group; `s.bankGroups: number[]` is
built alongside `s.bankNames`.

`model/index.ts` gains `changePageGroup(delta)`: from the current page, walk to
the first page whose group differs in direction `delta`, clamped at the ends.

`midi/router.ts`, `VIEW_KNOBS` + `MoveMainKnob`: when `appState.shiftHeld`,
call `changePageGroup(dir)` and bypass the step-page-at-bank-0 interplay (a
shifted jog is an explicit "next section" gesture, not a step-page entry).
Shift is currently unread on that path, so nothing is displaced. Left/Right
buttons keep ±1 paging.

### 2.6 File split (`hierarchy.ts` is 424 lines)

The hard limit is 200 (`CLAUDE.md`). This change adds to the longest file in
`src/model/`, so it splits along the seam that already exists in the code:

| file | contents |
|---|---|
| `hierarchy.ts` | `loadHierarchy` orchestration: fetch, config path, generic path, page accumulation |
| `param-build.ts` | `chain_params`/hierarchy metadata → `KnobParam` (the two near-identical build loops, unified) |
| `preset-param.ts` | `buildPresetParam` + the placeholder/unsettled predicate |
| `hierarchy-walk.ts` | unchanged role: level graph → ordered pages, now emitting `group` and extras |

No behaviour change from the split itself — `dump-replay` gates that.

---

## 3. What the user sees

- **osirus**: Main … Settings as today, each followed by `- 2`/`- 3` pages
  carrying the params the native list shows; Bank on Main's overflow, ROM on
  Settings' overflow, and a working named **Preset** knob once the ROM loads.
- **Every generic module**: same first pages as today, extra pages appended.
- **Shift + jog**: jumps level to level instead of page to page.
- **Everything**: on-screen values track the device faster than before.

---

## 4. Non-goals

- No change to config-path modules, and no new per-module configs.
- No change to the level graph walk itself (that shipped 2026-07-25).
- No automation/persistence changes: lanes are keyed by param key
  (`automation.ts`), never by page/slot index, so inserting pages cannot
  strand a persisted lane.
- No new navigation UI beyond shift+jog (no page-picker overlay).

---

## 5. Testing

| level | what |
|---|---|
| `dump-replay.mjs` | primary vehicle — replays all 77 modules. New invariants: every `params[]`-declared key is reachable; no key rendered twice within a module; `bankGroups` contiguous and aligned with `bankNames`. Snapshot regenerated with `--update` (large, expected diff). |
| `logic.mjs` | extras dedupe/order/exclusions; `- 2` naming; `changePageGroup` at both ends and across single-page groups; page-first refresh cursor; the unsettled predicate + retry latch (mock `shadow_get_param` flipping `preset_count` 0 → N and `options` `["(loading)"]` → real list). |
| `screenshot.mjs` | new baselines: an overflow page, a `- 2` header, osirus Preset/Bank/ROM. |
| `perf.mjs` | `loadHierarchy` cost and per-tick cost on the worst case (minijv, 51 → 71 pages); assert per-tick work does not grow with page count. |
| `app-loop.mjs` | shift+jog group skip through the MIDI router. |
| device | `./scripts/test.sh`, `./scripts/test-seq.sh`; osirus loaded on a track showing Preset/Bank/ROM with real names. |

Each fix is proven by removing it and watching the new test fail
(`feedback_verify-teeth-and-baseline`).

---

## 6. Device validation — measured

Run on `move.local` with osirus on slot 0's synth (`scripts/probe-async-meta.mjs`,
which subscribes for values and re-reads chain_params after a settle delay):

| key | immediately after load | after 15 s |
|---|---|---|
| `preset_count` (value) | **128** | 128 |
| `preset_names` (value) | unset — knob polls `preset_name` live | unset |
| `preset` (chain_params) | int 0..127 | int 0..127 |
| `bank_index` (chain_params) | int **0..0** | int **0..1** |
| `rom_index` (chain_params) | enum **["(loading)"]** | enum **["Virus A","Virus B","Virus C"]** |
| chain_params republished? | **no** — 156 entries throughout, no push | no |

Three consequences, all folded into the design:

1. **The dump was wrong about presets.** It recorded `preset_count: 0` because
   the capture ran mid-load; on device it reads 128 straight away, so
   `buildPresetParam` resolves and osirus's named Preset knob was always
   available. §2.4's preset branch is still needed for modules that genuinely
   report 0 at first, but it is not what osirus needed.
2. **`bank_index` widens after load.** A degenerate range is therefore not
   permanent, and §2.1's skip must be revisited — so the picker records the keys
   it dropped (`ModelState.degenerateKeys`) and §2.4 re-checks them. Without
   that, Bank would only reappear as a side effect of `rom_index` settling in
   the same rebuild, which is accidental coupling, not a design.
3. **Nothing is republished**, so polling is the only available trigger. The
   retry stays as designed.

Verified on the real screen after deploying (`scripts/grab-screen.mjs`): osirus
loads as **161 params / 25 banks** (was 104 / 13); the Preset page shows a live
preset number, `MAIN - 2` carries **BANK**, and `SETTINGS` shows **ROM = VIR A**
— the settled Virus model name, not the placeholder. Shift+jog logged
`changePageGroup 16→17→19→22→24`, skipping overflow pages.

---

## 7. Affected modules (generic path)

45 modules of the 76-module dump, plus helm from the fixture set. "New" = params
newly reachable; pages before → after.

| module | new | pages | | module | new | pages |
|---|---|---|---|---|---|---|
| osirus | 106 | 13 → 24 | | tapescam | 3 | 1 → 2 |
| forge | 106 | 12 → 30 | | spectra | 2 | 5 → 6 |
| surge | 103 | 31 → 50 | | granular | 2 | 5 → 6 |
| minijv | 90 | 51 → 71 | | structor | 2 | 4 → 5 |
| euclidrum | 63 | 10 → 19 | | genera | 2 | 3 → 4 |
| dexed | 41 | 23 → 29 | | dissolver | 2 | 3 → 4 |
| helm | 32 | 30 → 34 | | cloudseed | 2 | 1 → 2 |
| eucalypso | 32 | 11 → 13 | | chowtape | 2 | 1 → 2 |
| aphex | 19 | 9 → 16 | | war_bells | 1 | 10 → 11 |
| ottx | 14 | 2 → 5 | | fizzik | 1 | 10 → 11 |
| obxd | 13 | 12 → 15 | | mrsample | 1 | 7 → 7 |
| magneto | 13 | 6 → 9 | | palette | 1 | 6 → 7 |
| smack | 8 | 3 → 4 | | granny | 1 | 6 → 6 |
| dragonfly-hall | 8 | 1 → 2 | | filter | 1 | 4 → 5 |
| superarp | 7 | 5 → 7 | | vocoder | 1 | 1 → 2 |
| denis | 6 | 8 → 10 | | mverb | 1 | 1 → 2 |
| superboom | 4 | 5 → 6 | | ducker | 1 | 1 → 2 |
| verglas | 4 | 3 → 4 | | velocity_scale | 1 | 1 → 1 |
| usefulity | 4 | 1 → 2 | | psxverb | 1 | 1 → 1 |
| ambiotica | 4 | 1 → 2 | | nam | 1 | 1 → 1 |
| sf2 | 4 | 1 → 1 | | freeverb | 1 | 1 → 1 |
| linein | 3 | 6 → 6 | | chord | 1 | 1 → 1 |
| belt | 3 | 3 → 3 | | | | |
| pushnpull | 3 | 2 → 3 | | **total** | **721** | **323 → 454** |

Unaffected (config path): `signal, chordism, hush1, weird-dreams, sfz, essaim,
chiptune, mrdrums, plaits, 303, krautdrums, wurl`.

### 7.1 Per-module audit (final task)

The generic rule is assumed to improve every module in this table, but that is
an assumption, not a verified fact — a module may expose a param that is
meaningless on a knob (an internal index, a read-only status, a `min == max`
stub such as osirus `bank_index` before its ROM loads), or land a page whose
short names are unreadable.

The implementation plan's last task walks **every** module in §7, renders its
resulting pages from the dump, and classifies each as *improved*, *neutral*, or
*worse*. Anything classified worse gets a concrete alternative proposed
(exclusion rule, per-module config, or upstream fix) rather than being shipped
as-is. The audit output is written to
`docs/module-dump/params-exposure-audit.md`.

---

## 8. Risks

| risk | mitigation |
|---|---|
| Read-back slows with bigger param arrays | §2.3 page-first cursor — measured in `perf.mjs` |
| Page-count growth makes navigation tedious | §2.5 shift+jog group skip |
| Short-name collisions on dense new pages | `dedupShortNames` already resolves per page with a forced last-resort pass; `dump-replay`'s uniqueness invariant gates the result and `KNOWN_COLLIDING_PAGES` documents anything upstream-unfixable |
| A newly exposed param is useless or dangerous on a knob | §7.1 audit before merge |
| Retry loop never settles on a module that always reports a placeholder | `META_RETRY_LIMIT` latches it off after ~8 s |
| `dump-expect.json` diff is large enough to hide a real regression | invariants (not just the snapshot) assert reachability/uniqueness; the snapshot diff is reviewed per module in §7.1 |
