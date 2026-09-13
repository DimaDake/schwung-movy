# Schwung page migration — ledger

**The single source of truth for where this migration is.** Design and rationale
live in `docs/superpowers/specs/2026-09-13-schwung-page-migration-design.md`;
symptom detail lives in `docs/schwung-param-pages-findings.md` and
`docs/schwung-releases-review-2026-09.md`. This file is *state*.

**Every session working this migration: read this file first, update it last.**
Write your own item plan into `plans/SP-<id>-<slug>.md` from the entry below —
do not expect one to be waiting for you, and do not trust a stale one over the
code. **Phase 0 is the exception: it already has a full plan at
`plans/2026-09-13-schwung-page-migration-phase-0.md`.**

**The burn-down is the real check, not this table.** Run:

```bash
SCHWUNG=../schwung node browser-test/page-mode.mjs
```

It prints `page-mode: N of 13 expected failures remain`. That number may shrink
and must never grow. If it grew, the last item regressed a sibling — stop.

---

## State

`✅ done · 🔨 in progress · ⬜ not started · 🚫 blocked`

### Phase 0 — infrastructure

| id | item | model | state |
| --- | --- | --- | --- |
| SP-01 | `app-loop` runs both modes; the 13 Cause-A failures become a named ledger | Sonnet | ✅ |
| SP-02 | Harness env leak: `createDumpBoot()` calls `installEnv()` twice | Sonnet | ✅ |
| SP-03 | Split `schwung-page.ts` (457 → ≤200/file) | Sonnet | ✅ |
| SP-04a | **Re-capture the module dump** — the committed one is 2026-07-15 | Sonnet | ✅ |
| SP-04 | Fleet sweep: 95 dump modules planned through Schwung's `page_plan` | Sonnet | ✅ |
| SP-05 | `page` screenshot scenes — today `page` has zero pixel coverage | Sonnet | ⬜ |
| SP-06 | Fork install script + runtime Schwung **version** floor | Sonnet | ⬜ |
| SP-07 | Grid A/B cost harness, reproducible, both arms | Opus | ⬜ |

### Phase 1 — blockers, hardest first

| id | item | model | state |
| --- | --- | --- | --- |
| SP-10 | Delegation boundary: ownership accessor + page identity | Opus | ⬜ |
| SP-11 | Input ownership, incl. **Clear+knob must not delete the clip** | Opus | ⬜ |
| SP-12 | Polling + LED ownership | Opus | ⬜ |
| SP-13 | Per-tick cost: number, attribution, recommendation (**branch point**) | Opus | ⬜ |
| SP-14 | Cause E — drum/voice pages | Opus | ⬜ |
| SP-15 | Cause D — contract lifecycle | Sonnet | ⬜ |
| SP-16 | Cause G — graphics return | Sonnet | ⬜ |
| SP-17 | Cause C/B — dives, header readout, footer hints | Sonnet | ⬜ |
| SP-18 | Decoration channel: dot vs tilde, p-lock highlight, held-step filter | Sonnet | ⬜ |
| SP-19 | Undo redraw + automation-follows-arc | Sonnet | ⬜ |
| SP-20 | `ui_hierarchy` ownership under Schwung's planner | Opus | ⬜ |

**Phase 1; id to be assigned at Phase 0 close — Level-shadowed `short_name`
renders one page's label on another.**

Found during SP-04a and **not fixable in Phase 0** — the fix changes what a user
sees, which is Phase 1 by the plan's Global Constraints. Phase 0 records it and
accommodates it in `KNOWN_COLLIDING_PAGES`; **that entry is a temporary
accommodation, not a resolution.**

What happens, on `jp8000`'s Performance page:

- `src/model/hierarchy.ts:108` — `absorbHierarchy` flattens **every** level's
  `params[]` into one `paramDefs` map, **last write wins**.
- `src/model/generic-pages.ts:156` — the cell is built from that flat
  `paramDefs[key]`, which carries no memory of which page declared it.
- `src/model/param-build.ts:52-57` — `declaredShortName` prefers the `def` over
  `chain_params` *deliberately*, so the shadowed value wins over the module's
  live metadata for this page.
- `src/renderer/shorten.ts:185` — the resulting `shortLabel` is non-null, so
  both cells are `locked`, and `collisionGroups` (`:142`) and `forceUnique`
  (`:165`) each `return` early on a locked entry. **The disambiguation
  machinery never runs.**

Reproduction (all confirmed against the 2026-09-13 dump and the committed
baseline):

```
perf_main   key_mode  label "Key Mode"  short_name "KeyMd"
perf_main   arp_mode  label "Arp Mode"  short_name "ArpMd"
perf_setup  key_mode  label "Key Mode"  short_name "Mode"
perf_arp    arp_mode  label "Arp Mode"  short_name "Mode"
```

`perf_setup` and `perf_arp` come **after** `perf_main` in `ui_hierarchy.levels`,
so the flattening overwrites both. The rendered page is
`["MODE","SPLIT","DETUNE","VOICES","ARP","MODE","BEAT","BPM"]` — two knobs a
user cannot tell apart, produced from labels the module never gave them.
`VOICES` and `DETUNE` sit on that same page at six characters, so the width
budget was never the constraint; the module's own `KeyMd`/`ArpMd` fit it.

**`jp8000` is the only module in the fleet with this shape**, and these are its
only two affected keys. This is **not** the helm case: helm's
`stutter_sync`/`stutter_resample_sync` carry identical `name: "Stutter Sync"` and
no `short_name` at all, so only upstream can fix them. jp8000 is the opposite —
distinct, correctly-declared labels that movy discards. Filing an upstream PR
against jp8000 would be filing it against names it already ships right.

The fix is to build each cell from the def of the level that **owns** it rather
than from the flattened map. Prefer a test that fails on the shadowing first —
this is a rendering change with a one-line symptom already pinned above.

### Phase 2 — parity

| id | item | model | state |
| --- | --- | --- | --- |
| SP-21 | Metadata correction overlay (ranges + enum lists only) + the audit | Sonnet | ⬜ |
| SP-22 | Cut-curve viz kind (SU-5, or a documented movy exception) | Sonnet | ⬜ |
| SP-23 | Font parity + enum-overlay double-draw | Sonnet | ⬜ |
| SP-24 | movy-only page kinds verified against a Schwung body | Sonnet | ⬜ |

### Phase 3–4

| id | item | model | state |
| --- | --- | --- | --- |
| SP-30 | Default-on: flip, device tier, docs, release, **stated revert path** | Sonnet | ⬜ |
| SP-40 | Delete `body` and the `.off` stand-ins | Sonnet | ⬜ |
| SP-41 | Delete `off`, movy's page renderer, model page planning. **No return** | Opus | ⬜ |

### Upstream — all Opus

| id | item | PR | state |
| --- | --- | --- | --- |
| SU-1 | Viz gate per-cell or held-only, not "any decorations exist" | — | ⬜ |
| SU-2 | `decorations` gains a modulation bit | — | ⬜ |
| SU-3 | Voice declaration for caller-supplied racks | — | ⬜ |
| SU-4 | Non-enum dive intents (filepath, canvas) | — | ⬜ |
| SU-5 | Cut-curve viz kind | — | ⬜ |
| SU-6 | The 15-vs-16 widget band that offsets label rows by one row | — | ⬜ |

---

## Environment facts a fresh session needs

- **The fleet dump is `2026-09-13T16:33:12.253Z`, 95 modules, `complete: true`**
  (SP-04a). The July capture it replaces had 76, so 19 modules — including
  movy's own four drum kits (`6w6`, `8w8`, `9w9`, `cw78`) and the voice
  reference `voice-poc` — were simply absent from every fleet reading taken
  before that date. One module, `audio_fx--gesture-test`, is captured
  `load_timeout`: its directory holds a `module.json` and no `.so`
  (`dsp_size: 0`), so it is an incomplete install left on the device, not a
  module that stalled the collector.
- **The real planner runs offline.** `SCHWUNG=/path/to/schwung node build/browser.mjs`
  makes `build/browser.mjs:268` resolve `/data/UserData/schwung/shared/param_pages/*`
  to the checkout instead of `browser-test/stubs/schwung-param-pages.mjs` (which
  throws on import, deliberately). Without `SCHWUNG` every Schwung assertion is
  skipped, not failed — a green run proves nothing.
- **The local schwung checkout is not on `main`.** `git -C schwung status` reads
  `movy-min-host-1.1.0 … behind 23`, and `git pull` refuses to fast-forward.
  Read upstream with `git -C schwung show origin/main:<path>` rather than
  trusting the working tree.
- **`MOVY_SCHWUNG_GRID=off|page` is STALE.** It appears in the usage lines of
  `scripts/grid-call-cost.mjs` and `scripts/measure-grid-cost.sh`, but no build
  honours it — the mode became the `schwunggrid` flag. Off device, select a mode
  with `setSchwungGridMode()` (`src/renderer/schwung-grid.ts:89`); on device, set
  the flag. `MOVY_NO_SCHWUNG_GRID=1` still removes the layer from the bundle.
- **A file copy does not reload `param_pages`.** QuickJS caches modules per
  `shadow_ui` process and `shadow_load_ui_module` renames only `ui.js`, not its
  imports — so a fresh `voices.mjs` links against the cached old `page_plan.mjs`
  and fails with `Could not find export 'navLabelsOf'`. The stack must restart.
- **That failure is silent.** `shadow_ui`'s stderr is `/dev/null`; `debug.log`
  says only `shadow_load_ui_module returned false`. To see a real message, ship
  a throwaway `ui.js` that does the import inside `try { await import(...) }
  catch { console.log(...) }`.
- **Schwung floor today:** `main` at or past #405 / #411 / #414 / #415, plus
  1.3.0 for the 128 KB param contract. SP-06 turns this into a runtime check.
- **`schwungLibError()` already exists** (`schwung-lib.ts`) and carries the
  reason the Settings row is stuck on MOVY. SP-06 extends it to a *version*
  reason, not just an availability one.

---

## Item detail

Each entry: what the item is, where it lives, what closes it, what it needs
first. Read the design spec for *why*.

### SP-01 — `app-loop` runs both modes

`browser-test/app-loop.mjs` (2713 lines) is the gate for this feature and runs
one mode. It has no `ok(label, cond)`; assertions go through
`eq(label, actual, expected)` and `fail()` increments `failures`
(`app-loop.mjs:62-69`). Parameterise the schwung-sensitive blocks over
`off`/`page` via `setSchwungGridMode()`, and land the 13 known Cause-A failures
as a **named** expected-fail list in its own file, so a listed check that starts
passing must be removed from the list and an unlisted check that fails is a hard
error. The 13 labels are quoted verbatim in
`docs/schwung-param-pages-findings.md` §3 Cause A.

**Closes when:** `SCHWUNG=../schwung node browser-test/page-mode.mjs` exits 0 and
prints `page-mode: 13 of 13 expected failures remain`; deleting one label from
the list makes the run exit 1.

**Done as an arm rather than an internal parameterisation.** The 2713 lines are
top-level straight-line blocks, so `app-loop.mjs` learned to take its mode from
`MOVY_APP_LOOP_GRID` and to print its failed labels, and `page-mode.mjs` spawns
it once per arm. Both directions were proved red before the commit.

**Needs:** nothing. **Do first.**

### SP-02 — the harness env leak

`browser-test/dump-boot.mjs:95` calls `installEnv()` a second time. From that
suite onward the param globals belong to the new env while `env.setParams` still
feeds the harness's own, so a later suite that boots a model reads whatever the
dump left behind. `browser-test/logic.mjs:79` documents it and works around it by
ordering `run_schwung_page` before `run_undo_params`. Fix the leak; restore the
natural ordering. §7 warns this may turn other suites red — that is the point,
so do it alone and in one commit.

**Closes when:** `run_schwung_page` sits beside `run_schwung_grid`, the
work-around comment is gone, and `npm test` is green.

**Needs:** nothing. Independent of SP-01.

**Closed.** `installEnv()` now returns the live env (`browser-test/env.mjs`), and
`browser-test/logic/env-identity.mjs` asserts the property directly, through the
real second caller. Removing the ordering turned **`undo-params`** red — not on
an assertion but as a `TypeError`: `undo-core` and `undo-restore` ended their
cleanup with `delete globalThis.shadow_get_param`, and the *only* thing that ever
put it back was `createDumpBoot()`'s repointing `installEnv()` call. That is the
same defect at one remove, so both suites now call `env.restoreParamGlobals()`
(the idiom `restoreSetParamTimeout` already set) instead of deleting. The
ordering was also doing real work for `run_schwung_page`: with the leak restored
but the ordering left in place, it passes; move it beside its sibling with the
leak restored and `the model carries the press param` fails. Both directions are
recorded in `task-2-report.md`.

**The rule this leaves behind, for the next suite author:**

> **A suite cleanup must RESTORE, never delete. Nothing reinstalls the globals
> for you.**

The removed second `installEnv()` was a full re-install of *every* global
`env.mjs` assigns — the param pair, `shadow_get_ui_slot`, the engine and file
stubs, the whole device. Every `delete` a suite left behind used to be repaired
by it, so removing it took away the reset path for *all* of them at once, not
just the ones that were caught. Each stub that a suite may take away therefore
wants a named restorer on `env` (`restoreParamGlobals`, `restoreUiSlot`,
`restoreSetParamTimeout`, and `uninstallMockEngine`, which already restores the
engine trio) — and the calling site uses it.

**Deferred — every remaining site that takes away an `env`-installed global
without putting it back.** Survey, not guess (rerun it after a suite lands):

```bash
grep -rn "delete globalThis" browser-test/ | grep -v node_modules
```

Latent, because nothing after them reads those globals *directly* today: the
next suite that does fails, and for some of them it fails **silently** rather
than red — the bundle guards `shadow_get_ui_slot` with
`typeof … === 'function' ? shadow_get_ui_slot() : 0`, so a model renders on
track 0 instead of throwing, and a `host_read_file` that answers `null` reads as
a module that ships no `movy_config.json`. Not fixed here — outside SP-02's
scope, and each is a one-line change at the matching site:

- `shadow_get_param` / `shadow_set_param` — `quantize.mjs:241-242`, `:298`,
  `:368-369`; `undo-params.mjs:253-254`, `:305-306`. The largest group, and the
  same fix as the two suites already repaired.
- The same pair, **restore-what-was-found-then-delete** shape —
  `track-migrate.mjs:30-31`, `set-settling.mjs:274`. These put back a *previous*
  stub, so they are only as good as whoever set that stub; with nothing there,
  the delete stands.
- The `host_module_*` trio — `seq-engine.mjs:174-176`, deleted on purpose (that
  block asserts there is no engine at all, so a restorer would be the wrong fix
  there and the block wants a scoped save/restore); `host_module_set_param_blocking`
  alone at `set-restore-loss.mjs:258` and `track-migrate.mjs:356`;
  `host_module_get_param` alone at `track-migrate.mjs:358`.
- `host_write_file` — `seq-engine.mjs:357`, and `mock-fs.mjs:48` (see below).
- `move_midi_internal_send` — `app-loop.mjs:1983`; `move_midi_inject_to_move` —
  `set-settling.mjs:153` (restore-then-delete shape). `app-loop.mjs` is its own
  process, so that one only matters within it, but it is the same defect.
- `browser-test/mock-fs.mjs:46-50` (`uninstallMockFs`) is the odd one — not a
  `delete` of everything: it deletes `host_write_file` and then leaves
  `host_read_file = () => null`, where `installEnv` had put the module-layout
  server. Same class, worse shape (a wrong stub rather than a missing one), and
  the most likely to bite next, since `host_read_file` is how a self-describing
  module's `movy_config.json` is read.

The two `shadow_get_ui_slot` sites were on this list and are **fixed** in this
task's follow-up commit, via `env.restoreUiSlot()`:
`browser-test/logic/undo-restore.mjs:150`, `browser-test/logic/track-watch.mjs:85`.

### SP-03 — split `schwung-page.ts`

457 lines against the repo's hard 200-line limit, and every Phase-1 item edits
it. Natural seams already visible in the file: controller construction
(`:111`), the contract tri-state and `refreshLoaded()` (`:171-190`), the
placeholder retry (`RETRY_TICKS 12` / `RETRY_LIMIT 60`, `:224-237`), and
`render()`. Pure refactor — no behaviour change.

**Closes when:** no file over 200 lines, `npm test` green, and the
`schwung-page` logic suite unchanged.

**Needs:** SP-01 (so a regression is visible in both modes).

### SP-04a — re-capture the module dump

**The committed dump's `generated_at` is 2026-07-15** — before Schwung #405/#411
existed, so before a module could declare voices or widgets at all. Every fleet
statement of the form "no module declares X" read off it is a claim about a
two-month-old fleet. Re-capture before drawing any conclusion from SP-04, and
re-baseline `dump-replay` only where the fleet genuinely moved — never with
`--update` to make it quiet.

**Closes when:** `generated_at` is current, `complete: true`, and the
voice-declaration count (below) is recorded either way.

**Needs:** a reachable device. `ping move.local` always fails (ICMP blocked) —
probe with `./scripts/dev-probe.sh status`.

**Outcome (2026-09-13):** re-captured — `2026-09-13T16:33:12.253Z`, **95
modules, `complete: true`**, no MIDI-inject wedge afterwards. The fleet grew by
19 modules in two months, and **every** shared module that moved carries an
upstream version bump, so the `dump-replay` diffs are the fleet moving, not movy
(proved by replaying the *old* dump through the current code: 0 failures). Two
harness defects surfaced that the July dump could not show, and both are fixed
here: `browser-test/dump-boot.mjs` never served the `OVERRIDES_MODULE_FILE`
configs, so the four drum kits replayed against the very layout the override
exists to replace; and `dump-replay.mjs`'s fleet-wide `*_EXPECTED` lists were
re-spliced from the suite's own measured additions. `dump-expect.json` was
regenerated for the widened fleet and **`dump-replay` is green over all 95
modules** — see the note under SP-04.

### SP-04 — the fleet sweep

`docs/module-dump/device-dump.json` carries all 95 real modules with
`chain_params`, `module_json`, `ui_hierarchy`, `movy_config` and `params` —
everything Schwung's planner needs, with no device. `dump-replay.mjs` replays
*movy's* model, the layer Schwung bypasses, so it is structurally blind to
re-pagination. The sibling suite plans each module through `page_plan` and
asserts what a user can navigate.

**Two things were measured on 2026-09-13 against the JULY capture, and they
change what this item is for. Both need re-running over the fresh fleet — the
counts below are the old one's (76 modules / 72 with a hierarchy):**

1. **The static invariants already pass.** `planPages()` over all 76 modules:
   **72 clean, 0 duplicate page names, 0 empty knobs pages, 0 throws**, 4
   warnings — all `no ui_hierarchy — paginated from chain_params`
   (`branchage`, `belt-in`, `po32-drum`, `smack-in`). **The 9W9 class is fixed
   upstream.** So this suite is a regression guard, and each invariant must be
   shown able to fail rather than asserted to work.
2. **Zero of 72 modules with a hierarchy declare voices to Schwung.**
   `voicesOf(hierarchy)` returns `[]` for every one, `mrdrums` and `forge`
   included. **That is Cause E reproduced offline, with no device** — and it
   locates the gap: `voices.mjs`'s own comment describes an mrdrums root with
   `child_count: 16` / `child_key_template: "p{index}_{key}"`, while the dumped
   mrdrums root carries only `name`, `params`, `knobs`. The library is ready;
   the captured fleet predates the declaration. SP-04a settles it: the fresh
   fleet is 95 / 82 and the count is **one** (see SP-14). `voices.mjs` and
   `page_plan.mjs` are byte-identical to `origin/main`, so this is not an
   artefact of the stale local branch.

Note `voicesOf` takes the **hierarchy itself**, not an options object — passing
`{ hierarchy }` returns `[]` and looks exactly like a real answer.

**Closes when:** the suite runs the whole dump green, each invariant has been
shown to fail when broken, and the voice census is baselined.

**Outcome (2026-09-13):** `browser-test/fleet-pages.mjs` + `fleet-expect.json`,
in `npm test` after `dump-replay`. Against the 95-module dump: **94 plannable, 0
duplicate kind+name, 0 keys-less knobs pages, 0 unnamed pages, 0 throws**, 13
warnings baselined (`no ui_hierarchy — paginated from chain_params` ×12, plus
`hank` → `no "root" level — starting at "main"`), and `gesture-test` baselined as
**unplannable** — it carries no `chain_params` at all, a module-side shape, so
failing on it would make the suite red on arrival.

**The teeth are on synthetic page lists, not the dump, and that is measured, not
assumed.** `planPages` repairs every corruption the dump can carry — it
disambiguates duplicate page names itself (`"Sync"` → `"Sync - 2"`,
`page_plan.mjs:703`), **omits** an all-empty knobs page rather than emitting it,
and derives a level name from its key. Renaming a level in `genera`, emptying
`genera.sync`'s knobs and blanking a name each left all three invariants green.
So `checkPages(pages, slotKeys)` is exported and pure, and the suite runs it
against every real plan while the proofs feed it directly. **Those proofs now
live in the suite and run on every `npm test`** — five synthetic cases through
the same `ok`/`fail` reporting, 3 reds that fire and 2 merely-unusual greens that
must not. They are deliberately not behind a `--selftest` flag: the real fleet is
well-formed and only ever exercises the passing path, so a `checkPages` hollowed
out to `return []` would leave every suite green — pinned by making exactly that
edit (3 teeth red, the 95-module sweep still clean, exit 1) and restoring it. The
census has real teeth — mutating `voiceDeclaring` to `["mrdrums"]` exits 1.

**A truncated capture cannot read as green.** The invariants only ever see the
modules that are PRESENT, so a dump that silently lost some passes all of them;
one pruned copy (`mrdrums` removed, `complete: false`) proved it. The suite now
asserts `dump.complete` and `dump.modules.length === dump.module_count` before
the sweep — through `fail()`, not a throw, so the rest of the report still
prints — and prints `generated_at` on the header line so staleness sits beside
completeness. Both branches were shown firing on a pruned copy in an isolated
tree. **Warning TEXT is compared, not just a module's presence**: a presence-only
check let an upstream rewording, a gained warning and a dropped one all read
green, so the baseline stored text nothing read back.

**Deliberately NOT pinned: each module's plan shape.** `planPages` returns a
`fingerprint` this suite does not use, and a hierarchy corrupted to *add* a page
would stay green. That is out of scope on purpose — pinning every module's exact
page count turns a legitimate upstream planner change into a red suite for a
whole session, and the job here is the invariants a **user** can navigate, not
the planner's output. The completeness assertion above is what guards against
silent truncation. (Noted in the suite beside the loop so it is not re-raised.)

**The census is baselined, not asserted** (`voice-poc`, 1 module — see SP-14).
One declarer is Cause E, a module-side fact; a red build for it would make every
session red for something no session can fix. A *change* is what is loud.

**One correction to this item's own brief:** it gives the SCHWUNG import as a
raw `join(process.env.SCHWUNG, …)`. Dynamic `import()` resolves a relative
specifier against the *importing file*, not the cwd, so `SCHWUNG=../schwung`
resolved to `movy/schwung/` and threw `ERR_MODULE_NOT_FOUND` — the briefed
`--update` line would have died before writing a baseline. The suite calls
`resolve()` first, which is how `build/browser.mjs` resolves the same variable.

**State against the 2026-09-13 fleet (SP-04a).** `dump-replay` is **GREEN over
all 95 modules** (`SCHWUNG=../schwung node browser-test/dump-replay.mjs`, exit
0), and the `dump-expect.json` baseline is regenerated. The six checks that were
red against the widened fleet — none of them a movy regression — are closed:

1. **`dump-expect.json` was stale.** 52 of the failures were the baseline not
   knowing the 19 new modules and the changed ones. Regenerated with
   `--update`, which writes all 95 snapshots and exits 1 on the checks below.
2. **The six checks that a baseline could not fix** — each was the *check*
   meeting a newly-dumped module, and each is fixed at the check:
   - `6w6` / `8w8` / `9w9` / `cw78`: `VM styles every detected wave/stage cell`.
     `collectWaveCells` detected on a synthetic 8-per-page chunking of the flat
     param list, then compared against the VM styled on the rotation's SEATS.
     The chunking was not the problem — banks are 8-aligned, so the two agree on
     where pages start; the *page set* was. `pageRotation` collapses a kit's
     leading voice run into one seat, so the jog reaches one voice and the count
     missed the other seven. It now walks `forEachRenderedPage` (dump-boot.mjs):
     the rotation for ordinary pages, then the voice run BY PAD, which is how a
     player reaches a sibling voice. Detection and the styled count come off the
     same page in the same visit, so the assertion compares the detectors against
     the renderer on identical input; what it can still catch is a detected cell
     `planPageLayout` gives no knob. **Teeth proved twice**: forcing the wave
     branch to `'arc'` reddens 15 modules, and forcing the envstage branch to
     `'arc'` reddens 16 including all four kits (each `8 detected, 0 styled`).
     `mrdrums` detects **zero** cells before and after — it has no wave or stage
     cell to style, so it was never passing *because* of the bug.
   - `jp8000`: duplicate short name `MODE` on the new `Performance` page. **This
     one is a movy defect, not an upstream one** — the module declares distinct
     `KeyMd`/`ArpMd` on that page and movy overwrites them with `Mode` from
     another level (level shadowing; full account under *Level-shadowed
     `short_name`* in Phase 1). It is added to `KNOWN_COLLIDING_PAGES` as a
     **temporary Phase 0 accommodation**, because fixing it changes what a user
     sees and that is Phase 1 work — **not** as a resolution, and **not** on
     helm's `Stutter` precedent, which is the opposite shape.
   - `midiverb`: `unit_list` index 0 is labelled `"* Midiverb"` while
     `chain_params.unit.options` says `"Midiverb"`. **`unit_list` is the
     authoritative source**: `unit` is an items-level cell (the level declares
     `items_param: "unit_list"` + `select_param: "unit"`), `items-param.ts` reads
     its options from that live list and uses labels verbatim, and the asterisk
     is the *selection marker* — index 0 is starred and `unit` reads `"0"`. So
     movy is rendering the right source, and `checkEnumOptionsMatchModule` now
     compares an items cell against the list it was built from
     (`itemListLabels(entry.params[p.itemsKey])`) instead of skipping it. That
     also gives dexed/obxd/nam something to compare — their select keys have no
     `chain_params` entry, so the old code fell through. **What it proves is
     narrower than "these modules are now covered"**: the check re-parses the
     same bytes the model parsed and takes `p.itemsKey` from the model itself,
     so a *wrong* `items_param` stays invisible — it would read the same wrong
     key and agree. It catches divergence between the rendered options and the
     source movy actually read, nothing more. **Teeth proved**: stripping the
     marker in `items-param.ts` turns exactly that one check red.

**Needs:** SP-02 (the env leak corrupts multi-module boots). SP-04a is closed —
the fleet sweep now starts from a current capture.

### SP-05 — `page` screenshot scenes

`schwungGridEnabled()` is `mode === 'body'`, so under `page` it is false and no
baseline renders Schwung's body — `screenshot` passes **vacuously**. Under
`body` it does bite: 111 of 149 baselines differ. `GRID_BODY_RECT`'s *value* is
asserted in `browser-test/logic/schwung-page.mjs`; its *use* at the `ctl.render`
call is not. Add scenes that render a real Schwung-planned body.

**Closes when:** new `page` baselines exist, and removing the `rect` argument
from the `ctl.render` call turns them red.

**Needs:** SP-01, SP-03.

### SP-06 — fork install + version floor

Consequence of the fork-and-pin decision. One script that installs a fork
branch's `param_pages` onto the device *with the restart* the QuickJS module
cache requires (a copy is not enough — see Environment facts). Plus a runtime
**version** floor: `schwungLibAvailable()` answers availability, not vintage, so
a Schwung with all six files but an older `page_plan` link-errors into
"unavailable" with a confusing reason. Record the floor per feature and surface
it through `schwungLibError()`.

**Closes when:** installing a fork branch and reopening movy shows the fork's
behaviour; an under-floor Schwung pins to MOVY and the Settings hint says which
version is needed.

**Needs:** nothing.

### SP-07 — the A/B cost harness

`scripts/grid-call-cost.mjs` and `scripts/measure-grid-cost.sh` exist untracked
and are already good: the first counts host calls per arm off device (a
`shadow_*_param` is a synchronous round-trip, so the call count *is* the
latency); the second reads `perf_ipc` on device while injecting one CC carrying
a real magnitude, because a flick is not sixty small turns. Both have **stale
usage lines** — they document `MOVY_SCHWUNG_GRID=off|page`, which no build
honours. Fix the arm selection, commit them, and make the off-device arm a
suite that fails on a regression rather than a script someone remembers to run.

Note the reason the device arm is passive: an injected control CC reaches
schwung's cached cable-0 handler, not movy, so movy's surface cannot be driven
by script while overtaking. That is why the off-device call-count arm carries
the burden.

**Closes when:** the same gesture run twice reproduces within noise, both arms
name which layer the time is in, and the off-device arm is in `npm test`.

**Needs:** SP-01.

### SP-14 — Cause E, and where its gap actually is

The findings offered three possible homes for the fix (movy reads `bank.pad` and
tells the planner · a Schwung fallback · the modules declare their racks the
`voice-poc` way). SP-04's measurement narrows it: **Schwung's `voicesOf` is ready
and no module feeds it.** Since decision 2 keeps third-party module repos off the
critical path, the movy-side translation is the candidate to cost first —
movy already knows these racks from `bank.pad` in `src/module-configs/` (6w6,
8w8, 9w9, cw78, none of which are in the dump at all) and from `movy_config.json`
on device.

**The census against the 2026-09-13 fleet (SP-04a): `voicesOf()` returns 7 voices
for exactly ONE of the 82 modules with a hierarchy — `voice-poc`**, a
purpose-built reference module that is itself new since July. It is the only
module in the fleet that feeds Schwung, and it is not a rack movy has to serve:
its 7 are 3 role-named levels (`kick`/`snare`/`hat`) plus a 4-child `pads` level.
Every rack movy actually pages still declares **zero** — `mrdrums`, `forge`,
`essaim`, `tablor` and movy's own `6w6`/`8w8`/`9w9`/`cw78` (the last four carry
no `ui_hierarchy` at all and are paged from `chain_params`). So Cause E is
unchanged in substance: **the fix stays on movy's side**, and `voice-poc` becomes
the fixture that proves the declaration `voicesOf` wants is expressible. Also
still true of `mrdrums`: its captured root carries only `name`, `params`,
`knobs`.

**This number is now a gate input, not a reading.** SP-04's fleet sweep
baselines it (`browser-test/fleet-expect.json` → `voiceDeclaring: ["voice-poc"]`)
and `npm test` fails when it moves in either direction, so a module that starts
or stops declaring is loud rather than something the next reader has to notice.
Re-baselining is a deliberate act (`--update`) and is what this item's fixture
work should be checking against.

The bar is "no dramatic regression", and drum racks are a large part of how movy
is used: today every page shows at once and a pad press does not move the page,
while the header *does* name the right pad, because that half is movy's.

**Needs:** SP-04 (the census is its fixture), SP-10.

### SP-13 — the branch point, stated precisely

Not a gate. SP-13 produces three things: **a number** (calls/tick and ipc_ms per
arm, on a movy chain with a heavy module — mini JV is the reproducer), **an
attribution** (which layer the time is in; attribution is exactly what failed
last time), and **a recommendation**. If the delegation boundary did not recover
the cost, SP-13 opens a scoped investigation and the remaining Phase 1 items
continue in parallel. It does not stop the migration.

---

## Log

Newest first. One line per closed item: id, date, commit, the evidence.

- 2026-09-13 — **SP-03 ✅** — `schwung-page.ts` 457 → 124 lines, split into four
  modules along the seams Phase 1 edits: `schwung-page-io.ts` (57, the injected
  `io`), `schwung-page-contract.ts` (98, the tri-state, `refreshLoaded()`, the
  retry budget), `schwung-page-render.ts` (124, `render()`, `knobParamInfo()`,
  the decoration pass) and `schwung-page-input.ts` (142, the knob turn/touch,
  the click and Back ladders, `focusVoice`). **A fourth module beyond the plan's
  three**, because the binding with only io/contract/render moved out still came
  to ~196 lines and the gestures are a responsibility of their own.
  **No behaviour change:** every code line moved verbatim (a whitespace-stripped
  set-diff of before vs after loses nothing but the five glue statements), the
  `SchwungPage` surface is the same 18 members, and the seam is staged so
  `schwung-page.ts` remains the new files' **sole importer** — which is what
  keeps `build/device.mjs`'s `/\/schwung-(body|page|editor|widgets|voices|lib)\.js$/`
  swap taking the whole layer out (their names deliberately do not match it).
  Evidence: `npm test` exit 0 with `SCHWUNG=../schwung`, `page-mode: 13 of 13
  expected failures remain` (baseline 13 of 13), `npm run typecheck` exit 0,
  `wc -l` every file ≤ 200, and `scripts/schwung-off-is-free.mjs` **PASS** — the
  one assertion that a new module pulled `param_pages` back into a flag-off
  build. Also re-ran the eight host `scripts/schwung-*-check.mjs` suites that
  drive `createSchwungPage` directly: all eight pass.
  **`schwung-pagination-check.mjs` is red, and was red before this task** —
  verified by reverting to `66e71a9` and re-running: `FAIL: the lock mark is not
  at the locked cell: 0/4 pixels lit at (97,9) for slot 3`, byte-identical in
  both states. It is not in the `npm test` chain and has no caller in the repo.
- 2026-09-13 — **SP-02 ✅** — `installEnv()` is idempotent, so the param globals
  belong to one env per process; the work-around ordering in `logic.mjs` is gone
  and `run_schwung_page` sits beside `run_schwung_grid`. **`undo-params` went red
  when the work-around was removed** (a `TypeError`, not an assertion): it read
  `shadow_get_param` directly and depended on `createDumpBoot()` resurrecting the
  global that `undo-core` and `undo-restore` had deleted. Both now restore via
  `env.restoreParamGlobals()`. Evidence: `ALL LOGIC CHECKS PASSED`,
  `page-mode: 13 of 13 expected failures remain`, and the new suite red both when
  `env.mjs` is stashed and when only the guard is removed. Commit: this one —
  `test: one env per process, and the suite order that was hiding a second one`.
  **Follow-up commit (review fix round 1):** `env.restoreUiSlot()` added and used
  at `undo-restore.mjs:150` / `track-watch.mjs:85` (the same delete, and it fails
  *silently*), the deferred list above rebuilt from a survey, and
  `env-identity.mjs`'s dump-boot check given a condition it can fail on.
  Same evidence, re-run: `npm test` exit 0, `page-mode: 13 of 13`.
- 2026-09-13 — spec approved and committed (`c4b6775`); ledger created.
- 2026-09-13 — **SP-01 ✅** — `app-loop.mjs` runs as an arm (`MOVY_APP_LOOP_GRID`,
  and `MOVY_APP_LOOP_LABELS=1` prints its failed labels), and
  `browser-test/page-mode.mjs` spawns it twice and ratchets the `page` arm
  against `browser-test/page-mode-expected-fail.json`. Evidence:
  `page-mode: 13 of 13 expected failures remain` with `SCHWUNG=../schwung`, the
  `off` arm clean, and both teeth directions exiting 1. Commit: this one —
  `test: the page-mode burn-down, ratcheted on labels rather than a count`.
