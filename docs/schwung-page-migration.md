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
| SP-05 | `page` screenshot scenes — today `page` has zero pixel coverage | Sonnet | ✅ |
| SP-06 | Fork install script + runtime Schwung **version** floor | Sonnet | ✅ |
| SP-07 | Grid A/B cost harness, reproducible, both arms | Sonnet | ✅ |

### Phase 1 — blockers, hardest first

> **BEFORE SP-25 OR ANY ITEM BELOW: the device tier is already red on arrival.**
> `smoke#refresh-blocking` fails through its retry (`npm run test:device` exit 1)
> and has never passed on a first attempt in any recorded run. It **predates this
> migration** — see the Log entry of 2026-09-13 — so it is not yours, but it does
> mean the tier cannot tell you whether *your* change broke something until it is
> closed. Close it, or state in your item's Log entry that you ran the tier and
> `refresh-blocking` was the only red. Do not let a second red join it unnoticed.


| id | item | model | state |
| --- | --- | --- | --- |
| SP-25 | Level-shadowed `short_name` — build each cell from the def of the level that owns it | Sonnet | ⬜ |
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

**SP-25's id was assigned at Phase 0 close, and it executes before SP-10.** The
number is out of band on purpose: it records *when the id was assigned*, not when
the work runs.

**SP-25 — Level-shadowed `short_name` renders one page's label on another.**

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
  with `setSchwungGridMode()` (`src/renderer/schwung-grid.ts:100`); on device, set
  the flag. `MOVY_NO_SCHWUNG_GRID=1` still removes the layer from the bundle.
- **A file copy does not reload `param_pages`.** QuickJS caches modules per
  `shadow_ui` process and `shadow_load_ui_module` renames only `ui.js`, not its
  imports — so a fresh `voices.mjs` links against the cached old `page_plan.mjs`
  and fails with `Could not find export 'navLabelsOf'`. The stack must restart.
- **That failure is silent.** `shadow_ui`'s stderr is `/dev/null`; `debug.log`
  says only `shadow_load_ui_module returned false`. To see a real message, ship
  a throwaway `ui.js` that does the import inside `try { await import(...) }
  catch { console.log(...) }`.
- **An injected gesture reaches movy on CABLE 0 of the UI ring.** Movy sits
  behind the shadow UI, so `Shift` + a step button has to be injected into
  `/dev/shm/schwung-ui-midi` — the ring `shadow_ui` drains into
  `onMidiMessageInternal` — and the head byte's cable nibble decides whether it
  lands. Measured on the device 2026-09-13, movy on the Settings page, the same
  jog turn (CC 14, +1) injected twice with the screen confirmed static
  beforehand: head `0x2B` (cable 2) left the framebuffer **byte-identical**;
  head `0x0B` (cable 0) moved the selection down to *Param Pages*. Note-on is
  cable 0 too (`0x09`, with `0x08` for the release) — that is the pairing
  `Shift` + step needs, since the same step lights both. `schwung-midi-inject-ui.py`
  and `test-device/device-agent/ui-agent.py` both write cable 0;
  `scripts/inject-movy.py`, an untracked scratch file, claims in its docstring
  that reaching an overtaking tool needs cable 2 and is **wrong** — do not
  follow it. It stays untracked for that reason.
- **`Shift` + step opens a movy page, and the screen says which one.** `Shift`
  + step 2 is Settings; the gesture is global (it is not a page-local binding)
  so it is reachable whatever the current view, and the page it lands on prints
  its own name — which makes it the one gesture to reach for when confirming a
  gesture path by screenshot. A movy backgrounded under Move's own UI shows
  nothing.
- **Schwung floor today:** `SCHWUNG_FLOOR = '1.3.0'` in
  `src/renderer/schwung-floor.ts`, checked at runtime (SP-06). It is `main` at or
  past #405 / #411 / #414 / #415, plus 1.3.0 for the 128 KB param contract. Raise
  it when a feature depends on a newer Schwung, and say which feature in the
  commit — `browser-test/logic/schwung-floor.mjs` pins the value and goes red
  when it moves, on purpose.
- **The installed version is NOT in `release.json`.** `release.json` is the
  store descriptor fetched from GitHub (`store_utils.mjs:78`, `install.sh:907`)
  and cached under `tmp/`; measured on the device 2026-09-13, nothing named
  `release.json` exists anywhere under `/data/UserData`. What a host on the box
  reports is `/data/UserData/schwung/host/version.txt` — read by
  `getHostVersion()`, written by the installer, printed by
  `collect-diagnostics.sh`; it read **1.4.0**. `schwungVersion()` reads
  `release.json` first and falls back to that file, because with `release.json`
  alone every real device reads as "unknown", unknown reads as met, and the floor
  is inert. The fall-through has to be **total**: absent, corrupt, and
  *present-but-versionless* all reach the second rung. A `release.json` that
  parses without a `version` is the one that does not look like a failure — an
  early `return` there hands back `''`, skips the rung below it, and misses the
  fail-open default too, because `''` is "unreadable" and "unreadable" is met. It
  is pinned by the suite for that reason.
- **The floor value stands as `1.3.0`** (ruling R13, 2026-09-13): it is derived
  from the fork branch this migration needs and is an *instrument's* constant —
  Phase 1 re-pins it when a feature starts needing a newer host. It is pinned by
  `browser-test/logic/schwung-floor.mjs`, which goes red when it moves.
- **"`src/renderer/` has no state" means the render FUNCTIONS are pure** (ruling
  R12, 2026-09-13). The `schwung-*` family has always held connection state —
  `schwung-lib.ts`'s availability latch, `schwung-grid.ts`'s mode and page cache,
  `schwung-editor.ts`, `knob-leds.ts` — and `schwung-floor.ts`'s memoized read is
  the same kind of thing. The part with teeth for pixels is that no *render
  function* reads host state, which is why the floor's reason is composed in
  `src/seq/flags-page-vm.ts` and not in `renderer/flags-view.ts`.
- **`schwungLibError()` carries no screen.** It says why the library is
  unavailable, and in production **nothing renders it** — only tests read it. The
  Settings row's *Param Pages* hint is where a reason reaches a person, composed
  in `src/seq/flags-page-vm.ts` (not in `renderer/flags-view.ts`, which is pure
  and would have to read host state to say it). SP-06 put the version reason
  there.

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
     another level (level shadowing; full account under **SP-25**, *Level-shadowed
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
`body` it does bite: **116 of the 165** baselines the suite carried before this
item's own two scenes differ (the 2026-09-13 re-measurement; the counting is in
*Closed* below). `GRID_BODY_RECT`'s
*value* is asserted in `browser-test/logic/schwung-page.mjs`; its *use* at the
`ctl.render` call is not. Add scenes that render a real Schwung-planned body.

**Closes when:** new `page` baselines exist, and removing the `rect` argument
from the `ctl.render` call turns them red.

**Needs:** SP-01, SP-03.

#### Closed 2026-09-13

Two scenes render Schwung's own body through `renderKnobsView`'s `bodyOverride`
— the same seam the device uses — over `test16`, which Schwung plans into two
pages (`Main` / `Main - 2`): `page_body` at index 0, `page_body_p2` after
`changePage(1)`. The second exists because movy draws the bank bar from
Schwung's `pageIndex`/`pageCount`, so a frozen `0` there is the Cause-A symptom
a screenshot can see. It does: the two baselines differ in **480 px — 127 on row
9**, which is the whole bank bar (`63 + 64`), and 353 across the two body bands
(rows 14-23/27-31 and 38-47/51-55), so the second scene asserts the body's
re-pagination and not the bar alone. The bar is **2 segments**, which is Schwung's
`pageCount` and not movy's 6 banks: the scene supplies `{index, count}` straight
from the page, and an instrumented run reads `pageCount=2`.

**Teeth proved.** Removing `rect: GRID_BODY_RECT` from the `ctl.render` call
reddens both new scenes (682 px, 758 px) and leaves all 165 other baselines
green — `movyBandLayout` reflows only when a rect is supplied (`const reflow =
!!o.rect`), so with none the body lands at y=9 on top of movy's bank bar (rows
9-27 move). That diff is the coverage §7 item 10 asked for, and it is the only
assertion in the repo that the rect is *used* rather than merely correct.

**The `body` figure in this entry was stale, and the two numbers it carried
measure the same thing at two suite sizes.** Counted: `ls
browser-test/screenshots/baseline/*.png | wc -l` is **167** today; **165** of
those pre-date this item's own two scenes (`git ls-tree --name-only
5dfd036:browser-test/screenshots/baseline | wc -l`, the commit before they
landed); and **149** was the suite size on 2026-09-05, where the original
measurement was taken (`docs/schwung-param-pages-findings.md`). Forcing the mode
to `body` for every scene reddens **116 of the 165** inherited baselines,
re-measured against the suite as it stands — that re-measurement is the figure
the entry now quotes, and the 149-baseline one is not comparable to it.

The scenes need a bundle built with `SCHWUNG=../schwung node build/browser.mjs`,
and are **skipped, not failed**, without one: `schwungPageFor` raises off the
stub, and a baseline written from a build that cannot render the body would be
a lie that stays green forever. `npm test` with no checkout therefore reports
`165 passed, 0 failed, 2 skipped`.

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

#### Closed 2026-09-13

`scripts/install-schwung-fork.sh <branch>` installed the fork's `param_pages`
through a staged swap and `restart_move_stack` ("down at 1.4s, new stack at
5.3s"), and the floor is live: with `host/version.txt` at 0.9.9 the Settings
row reads **NEEDS SCHWUNG 1.3.0 (HAVE 0.9.9)**; at 1.4.0 it reads its own hint
and renders nothing new. Full evidence and the three teeth-proofs are in the
Log; the review's fix round is there too.

**Two things this item's wording got wrong, and the ledger is where that gets
corrected.** It says the reason surfaces "through `schwungLibError()`", but
`schwungLibError()` **renders nowhere in production** — the reason reaches a
person through the Settings row's hint, composed in `src/seq/flags-page-vm.ts`
(Environment facts; R12 is why it is not composed in `renderer/flags-view.ts`).
And it implies `release.json` is where the installed version lives; it is not
(Environment facts — it is a store descriptor that is not on the box at all).
The floor therefore reads **two** rungs, `release.json` then
`host/version.txt`, and the *totality* of that fall-through is load-bearing
enough to be pinned by the suite.

The floor value is `1.3.0` and **stands** (R13). Raise it when a feature starts
needing a newer host, and say which feature in the commit: Phase 1 re-pins it.
It is pinned by `browser-test/logic/schwung-floor.mjs`, which goes red when it
moves — deliberately, because the brief's own five assertions do not
(Environment facts, and Log).

### SP-07 — the A/B cost harness

`scripts/grid-call-cost.mjs` and `scripts/measure-grid-cost.sh` exist untracked
and are already good: the first counts host calls per arm off device (a
`shadow_*_param` is a synchronous round-trip, so the call count *is* the
latency); the second reads `perf_ipc` on device while injecting one CC carrying
a real magnitude, because a flick is not sixty small turns. Both have **stale
usage lines** — they document `MOVY_SCHWUNG_GRID=off|page`, which no build
honours. Fix the arm selection, commit them, and make the off-device arm a
suite that fails on a regression rather than a script someone remembers to run.

Note the reason the device arm is a baseline rather than a gate, and it is NOT
that movy cannot be driven by script: it can. **This note said the opposite until
2026-09-13**, on the theory that `process_shadow_midi` dispatches cable 0 through
schwung's startup-cached handler; measured with framebuffer hashes, cable 0 on
`/dev/shm/schwung-ui-midi` drives movy's surface while it is overtaking, and cable
2 does nothing (see Environment facts). The real reason is reproducibility: the tick
rate swings 63-205 Hz with load, so the same gesture times differently run to run.
The off-device call count is load-independent, which is why it carries the burden.

**Closes when:** the same gesture run twice reproduces within noise, both arms
name which layer the time is in, and the off-device arm is in `npm test`.

**Closed 2026-09-13.** All three hold. The arms are selected for real —
`setSchwungGridMode(arm)` off device, the `schwunggrid` prefs flag plus a movy
reopen on it — and each arm now prints the mode it *resolved*, so the two-identical-
arms failure can never be mistaken for a finding again. The off-device arm is
`browser-test/grid-cost.mjs`, in `scripts.test`. The metric is the gesture
**premium** over each arm's own idle floor, not the ratio of window totals: the
totals ratio is dominated by the refresh both arms share and moves only 2.71 →
2.80 under the teeth mutation — no signal at all.

The budget is an **absolute ceiling** on the page arm's premium — **90 calls** —
measured at **+51** against an `off` arm at **−418**. Calling it a "ratio budget"
was wrong and is corrected here. `off`'s premium is negative *by construction*:
an input suppresses movy's refresh window and in `off` mode the gesture adds
nothing to replace it, so the denominator is floored at one call per gesture and
the comparison reduces to `pagePremium <= 90`. An absolute ceiling **does** drift
if the mock's page changes shape or the gesture changes — that is a re-measure
trigger, not a defect. It sits deliberately close because the regression it exists
to catch is a **doubling** of the page gesture's cost: 51 → 102, which is over 90.
A first version of the suite could not tell "the grid is free" from "the harness
measured nothing" (`checkRatio(0, 0)` was `0/1 = 0 <= budget`, green, and a tooth
actively encoded that a near-zero page premium passes); a non-positive page
premium now fails, and the suite asserts the page arm measured something before
the budget is assessed — the same void the `setcommit` defect below produced.

**The first version of this measurement was 2x wrong on one window, and both arms
carried the inflation.** `window_` advanced its own 300 ticks *after* `before()`,
and `playGesture` already advances `SETTLE_TICKS` itself, so the gesture window
spanned 600 ticks against a 300-tick idle floor and the subtraction removed half
a floor. It reported `off −63` / `page 397` against a budget of 550, which — with
the denominator floored at 1 — let a doubled page gesture report ≈448 and pass.
The tell was on the harness's own output: the gesture row's `calls/tick` read
0.90, a 600-tick count divided by 300. The span is now **measured** from a tick
counter, printed on both rows, and the child refuses to print a number (exit 4)
if the two disagree.

**The wrong window length was where the gate got its teeth, which is why the
budget had to be re-derived rather than kept.** On the **page arm** — the arm the
gate asserts on — a cost that scales with ticks adds equally to both windows and
so cancels out of the premium: the mutation the gate was first proven with,
`refreshOneParam` doing its work twice, adds 675 calls to the gesture window and
675 to the idle floor and moves page's premium 51 → 51, no longer tripping it.
That is the metric working: the premium answers "what did the *gesture* add", and
a uniform per-tick increase is not that.

**It is not a property of the metric in general, and the `off` arm is the
counterexample.** Under the same mutation `off` moved −418 → −851, because an
input in `off` mode SUPPRESSES movy's refresh window: the added cost lands mostly
on the idle side (675 there against ~242 on the gesture side) and the two do not
cancel. The cancellation holds only where the two windows' work is unaffected by
whether a gesture is in flight — which is true of the page arm and false of
`off`. Do not apply it to an arm whose gesture suppresses the floor.

The mutation that models the complaint — a host round trip per knob detent in the
page arm, i.e. the throttle gone — measures **1311** and leaves `off` untouched at
−418, page-only and gesture-only.

Two defects were found in the instruments themselves while closing this, and
both are the kind that produce a confident wrong number rather than an error:

- **`grid-call-cost.mjs` measured nothing at all.** `setFlag('setcommit', 0)` was
  missing, so the wall-clock-timed Set-commit press never completed under instant
  ticks, movy stayed in `settling`, and `router.ts:168`'s input gate refused every
  injected message — both arms reported the idle refresh and nothing on top. The
  fix ticks until `sessionReady()` and refuses to print a number if it never is.
- **`measure-grid-cost.sh`'s view-change guard could never pass.** `grep -c` exits
  1 on a zero count, so `|| echo 0` appended a second `0`; `moved` became the
  two-line `"0\n0"`, which is not `0`, so every clean sample was stamped `INVALID`
  — and every dirty one too, which is why it read as merely noisy. A guard that
  fires on all inputs is not a weaker guard, it is no guard: the mark carried no
  information and the numbers beside it could not be trusted or discarded on
  their merits. It now strips the newline and prints the offending lines.

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

#### The A/B baseline, 2026-09-13 (this is the "before" SP-13 compares against)

Taken with `./scripts/measure-grid-cost.sh off` then `... page`, device reachable,
movy sitting on track 0's `synth` page (`page` arm preflight: `schwung-body ok
track=0 ck=synth pages=2`; `off` arm preflight: `schwung-body mode=off` — both
arms prove the view they measured before measuring it). One representative
`perf_ipc` report per section, the same five sections on each arm:

| section | `off` period_ms | `page` period_ms |
| --- | --- | --- |
| idle | 4.9 (peak 10) | 5.0 (peak 15) |
| jog | 5.0 (peak 14) | 4.9 (peak 11) |
| jogflick | 4.9 (peak 10) | 4.9 (peak 9) |
| knob | 5.0 (peak 14) | 4.9 (peak 13) |
| knobflick | 5.0 (peak 14) | 4.8 (peak 10) |

`calls/tick=0.6` and `ipc_ms` 1.2–1.5 on **both** arms, every section; worst
`period_ms` seen anywhere is 5.1. No section was flagged `INVALID`.

**Read this honestly: the device arm does not separate the arms at this scale.**
That is not a null result about the grid — it is the reason the gate is off
device. `perf_ipc` reports an average over 120 ticks, the tick period here is
~5 ms with ~0.6 host calls/tick, and the module under it is a mock; a difference
of a few calls per gesture disappears into that average. The same gesture counted
in **host calls** separates the arms by +51 vs −418 (`off` lands below its own
idle floor because input suppresses movy's refresh window), which is a number the
device tier cannot produce and a laptop can. So SP-13's number is the off-device
count; these `period_ms` figures are the device half, recorded as the baseline
this item compares against after SP-12, and a post-SP-12 run that moves them by
less than the spread above is a null result rather than a pass.

---

## Log

Newest first. One line per closed item: id, date, commit, the evidence.

- 2026-09-13 — **THE DEVICE TIER IS RED, AND EVERY PHASE 0 COMMIT LANDED ON IT
  ANYWAY.** Found by the independent verification below, which ran the gate that
  Phase 0's own Log never reports running. `npm run test:device` **exit 1**: 15
  scenarios, 130 checks, **1 failed** — `smoke#refresh-blocking`, red through the
  retry (attempt 1 `15 ms max`, attempt 2 `179 ms max`, budget `REFRESH_MS_MAX =
  10`, and the check requires *every* `perf_refresh_ms` sample under it). `seq`
  was `⚠ FLAKY` on `capture-fixed-notes`, which does not block.

  **PHASE 0 DID NOT CAUSE IT, and the flake log proves that rather than asserting
  it.** `test-device/.flake-log.json` holds 8 runs, all today.
  `smoke#refresh-blocking` is **6 flaky of 6 runs — it has never once passed on a
  first attempt** — and the earliest of those, `c8a0e18` at 10:37, is **eleven
  commits before `bf94962`**, the schwung-page split. It hardened from flaky into
  a two-attempt `fail` at `7b570cd` (14:00), still before the Phase 0 plan
  existed. So the check is older than this phase and nothing in the phase moved
  it.

  **What IS a Phase 0 defect is that it was committed over.** Three Phase 0
  commits — `162ec36`, `e3c2525`, `39310b1` — each have a recorded `smoke`
  `status: "fail", attempts: 2` in the flake log. `CLAUDE.md` is explicit that a
  red exit is real *because* the retry already ran, and that the response is to
  fix it or report it to the user, never to wave it through. The Log's only trace
  of any of this is four words in the SP-07 entry — "`refresh-blocking` was not
  touched" — which records that the phase did not edit the check, not that the
  gate it belongs to was failing every time it ran. **A gate that is red and
  unmentioned is a gate that has stopped being read**, which is the exact failure
  mode the tier's own design notes warn about.

  **NOT FIXED HERE, and deliberately so.** It is not Phase 0 work, and the two
  ways out are different decisions with different costs: either `179 ms` is a
  real blocking stall on the first refresh after a cold tool open and wants
  debugging, or `REFRESH_MS_MAX = 10` — justified in `smoke.ts:54-58` as "one
  `shadow_get_param` measures ~3 ms, so 10 ms allows for shim jitter" — is simply
  not a budget the first refresh can meet, and wants re-deriving. `179 ms` is not
  shim jitter, so the first reading is the one to test first. **Whoever picks
  this up: a 100%-retry check is not a flake, it is an under-budgeted or
  genuinely-failing check wearing a flake's clothes.** Until it closes, the tier
  cannot be used as a gate for SP-25, because it is already red before SP-25
  writes a line.

- 2026-09-13 — **PHASE 0 VERIFIED INDEPENDENTLY, and it holds.** A session that
  implemented none of it re-ran every exit criterion on a clean tree after the
  close-out commits. `SCHWUNG=../schwung npm test` exit 0; `npm test` without a
  checkout exit 0, with `page-mode`, `grid-cost`, `page_body` and `page_body_p2`
  each printing `SKIPPED` **by name** (a checkout-less green cannot be misread as
  coverage). `page-mode.mjs` prints `13 of 13` and was re-proved red in **both**
  directions — a dropped label reads `REGRESSION under page`, an added passing
  label reads `fixed under page … so delete it`, exit 1 each. `fleet-pages.mjs`
  plans all 95 modules through the real `planPages` with 0 invariant failures,
  census `["voice-poc"]`. `grid-cost.mjs` reproduces the committed pair exactly —
  page premium **51**, off **−418**, ceiling 90 — so the budget is a live
  measurement, not a copied constant. Dropping `rect: GRID_BODY_RECT` from
  `schwung-page-render.ts:112` reddens both scenes (**682 px** / **758 px**), and
  the two baselines carry real content and differ by the jog click (`P1…P8` vs
  `P9…P16`), so the bank index is Schwung's and not a frozen 0. Largest
  `schwung-page*.ts` is 142 lines. Dump `2026-09-13T16:33:12.253Z`, 95 = 95,
  `complete: true`. No `src/` change; the Phase 0 Global Constraint held
  throughout. **Phase 0 is closed. Next item is SP-25.**

- 2026-09-13 — **HAZARD LEFT IN THE TREE, and untracked is not the mitigation it
  was taken for.** `scripts/inject-movy.py` is untracked on purpose because its
  docstring is **wrong** — it asserts that a cable-0 injection reaches the host UI
  and that an overtaking tool needs cable 2, which the device measurement in
  Environment facts refutes (head `0x0B` moved movy's selection; `0x2B` left the
  framebuffer byte-identical). But an untracked file is not an invisible one: it
  sits in the working tree, it is what a `grep` or an `ls scripts/` turns up, and
  it states the false premise more confidently than the ledger states the
  correction. It is the same false premise commit `ac1e50d` had to chase out of
  the rest of the tooling. **It should be deleted, or its docstring corrected in
  place and the file committed — leaving it as-is re-seeds the thing that cost a
  measurement session.** Flagged, not acted on: deleting an untracked file is not
  reversible from git.

- 2026-09-13 — **Phase 0 close-out, fix round 2 — the assertion that could not
  fail, and the reader `uninstallMockFs` downgraded.** No `src/` change; the
  Phase 0 Global Constraint holds. Commit: this one —
  `Phase 0 close-out fix round 2: an assertion that can fail, and the reader the
  mock fs gives back`. (1) **`env-identity.mjs`'s reachability check now
  discriminates.** It asked about forge's `movy_config.json`, which BOTH readers
  serve — the dump boot snapshots that path (`dump-boot.mjs:131-132`) and serves
  every `/tools/movy/configs/<id>.json` override out of the same
  `src/module-configs` copy `env.mjs` reads — so it stayed **green** with
  `env.restoreHostGlobals()` commented out, claiming a discrimination it did not
  make. It now asks about `sound_generators/padkeys/movy_config.json`: `padkeys`
  is a synthetic module id that exists only as a browser-test fixture, so the
  dump boot's lookup answers null for it where `serveModuleLayout` answers the
  fixture. **Teeth, measured, all three states:** round-1 assertion with round-1
  `mock-fs.mjs` → **18** reds and this check green; fixed assertion, same
  `mock-fs.mjs` → **19** reds with this check among them — that is the movement
  this round asked for, and reverting only `mock-fs.mjs` is what isolates it;
  finished tree → **13**, because (2) repairs six of the downstream
  `items-select` failures the mutation had been producing. Restored, `logic.mjs`
  is 0 reds, exit 0. (2) **`uninstallMockFs` gives the harness's reader back
  instead of downgrading it.** It assigned `() => null` under the comment
  "logic.mjs's default stub" — a reader that does not exist. `host_read_file` has
  exactly one installer, `env.mjs:191`'s `(path) => serveModuleLayout(path)`,
  which is what serves a module its shipped layout, so every uninstall took that
  away for good and round 1 removed the accidental repair (the next
  `createDumpBoot()` reassigning the global). Now `installMockFs` captures the
  prior global and `uninstallMockFs` puts it back, **deleting** it when there was
  none; the capture is taken by the OUTERMOST install only, because suites
  genuinely nest (`set-session.mjs` holds four outstanding at once —
  `:285`/`:309`/`:332`/`:645`) and a capture per install would make the innermost
  mock, not the harness's reader, what the last uninstall restores. The same
  false belief is corrected where else it is written down in
  `browser-test/logic/drums.mjs` (the `padkeys` swap and the factory-kit block,
  `:246`); no behaviour there changed. (3) **The pagination probe's KNOWN RED
  block gained the precondition it was missing** — verified against both builds
  rather than assumed: the recorded `FAIL: the lock mark is not at the locked
  cell…` line needs a `SCHWUNG`-built `dist/esm`, and without one the stub throws
  on import, `schwungLib()` (`schwung-lib.ts:134`) re-raises it, and the throw
  lands at the script's `schwungLayout(preset)` call
  (`schwung-pagination-check.mjs:143`) as an uncaught stack trace. The note names
  those two call sites instead of numbering them, because writing it moved them
  (`:129`/`:106` → `:143`/`:120`). The exit status is 1 either way, so it is the
  line, not the code, that needs the build.
  (4) `RESUME.md` no longer files that probe among the checks that "each fail on
  the mutation of the bug it was written for": the listing marks it KNOWN RED and
  a paragraph below it carries the caveat and points here, at SP-03's entry.
  (5) The round-1 entry below and this one now carry their commits. Evidence:
  `npm test` exit 0 both with `SCHWUNG=../schwung` and bare,
  `page-mode: 13 of 13 expected failures remain`, `ALL LOGIC CHECKS PASSED`.
- 2026-09-13 — **Phase 0 close-out: the id it owed, and the ordering SP-02 moved
  rather than removed.** Commit `6951261`. No `src/` change; the Phase 0 Global
  Constraint holds.
  (1) **SP-25 assigned** — the level-shadowing defect Phase 0 found and could not
  fix now has its id, is the first row of the Phase 1 table, and executes before
  SP-10; the `KNOWN_COLLIDING_PAGES` entry is recorded there as a temporary
  accommodation, not a resolution. (2) **The dump boot's host leak is closed.**
  `createDumpBoot()` overwrote `globalThis.os` and `globalThis.host_read_file`
  and nothing put them back, so every suite after a boot ran on the dump's stubs —
  `browser-test/logic.mjs` had an eleven-line comment holding `run_env_identity`
  between two fixed ranges, and that comment is now deleted along with the
  constraint it described. `browser-test/dump-boot.mjs` captures the prior pair at
  the first boot (`harness.mjs` replaces `os` with its own readdir-backed one
  after `installEnv()`, so installing-time capture restores a stub that cannot
  list a directory) and exposes `env.restoreHostGlobals()` beside
  `env.restoreParamGlobals()`/`env.restoreUiSlot()`; the two dump-driven logic
  suites call it in cleanup and `run_env_identity` now sits **first** in the suite
  list. **Teeth, measured:** with the restorer call removed, `logic.mjs` goes red
  in 18 checks — the new identity assertion plus 17 in `items-select` — which is
  what makes the front position a claim rather than an accident. (3) Two stale
  citations corrected in this file and `browser-test/screenshot.mjs`
  (`setSchwungGridMode` `:89`→`:100`, `schwungActiveFor` `:129`→`:138`), and the
  SP-05 `body` figure reconciled to **116 of the 165** with its counting method.
  (4) `scripts/schwung-pagination-check.mjs` kept red and now *recorded* red — see
  SP-03's Log entry below. Evidence: `npm test` exit 0 both with and without
  `SCHWUNG=../schwung`, `page-mode: 13 of 13 expected failures remain`.
- 2026-09-13 — **Task 8, fix round 1 — the measured window was 2x wrong on one
  side and the budget was re-derived from scratch.** `window_` advanced its own
  300 ticks *after* `before()`, and `playGesture` already advances `SETTLE_TICKS`,
  so the gesture window spanned 600 ticks against a 300-tick idle floor: the
  subtraction removed half a floor, and the columns said so (the gesture row's
  `calls/tick` was `269/300`). Both arms carried the inflation, which is why it
  read as healthy; the consequence was that `pagePremium <= 550` passed a page
  gesture **doubled** in true cost at ≈448. The span is now measured from a tick
  counter, printed on both rows, and the child exits 4 rather than print a number
  if they disagree; `perTick` divides by the span it actually measured. Re-measured
  pair: `off −418`, `page +51` (idle 678 both arms, 600 ticks each side,
  deterministic across runs). Budget **90**, not kept at 550 — it must catch the
  doubling at 102, so it sits at 1.76x the measurement, which the determinism
  affords. **The nominated mutation no longer has teeth, and that is the metric
  working:** `refreshOneParam` doing its work twice (`src/model/store.ts`) adds
  675 calls to *both* equal-span windows and moves page's premium 51 → 51. The
  mutation that models the complaint — `globalThis.shadow_get_param(slot,
  "synth:chain_params")` per knob detent in the page arm's knob loop, i.e. the
  throttle gone — is **RED at 1311** (page-only, gesture-only; `off` untouched at
  −418), restored by `cp`, rebuilt on both sides of the copy, **GREEN at 51**.
  Pinned teeth moved to the measured pair, including one for the *doubling*
  itself. **M1 closed:** `checkRatio(0, 0)` was `0/1 = 0 <= budget` → green, and a
  tooth encoded that a near-zero page premium passes — the exact void the
  `setcommit` defect produced below. A non-positive page premium now fails
  (`checkRatio` plus an assertion in `main()`), pinned by two teeth. **Prose
  corrected in three places** (suite header, this ledger's SP-07 line, the task
  report's §2.1): the ratio framing is *nominal*, the check is an **absolute
  ceiling**, and an absolute ceiling does drift if the mock's page changes shape
  — a re-measure trigger, not a defect. Also: the 400-tick ready guard is **not a
  duration**, and the first version of this line said it was. It claimed 400 ticks
  had to outlast a 1.5 s wall-clock Set-commit press "by orders of magnitude" —
  but the harness disables that press itself (`setFlag('setcommit', 0)` above, and
  `set-commit.ts:153` returns on that flag before `phase = 'waiting'`), so the
  press never enters the state machine; and 400 microsecond-ticks is ~0.4 ms
  against 1.5 s, which is short by three orders of magnitude rather than clear by
  them. What the loop is actually sized against is the settle running to
  completion at all (it promotes in a handful of ticks; the child logs `set ready
  after 3ms`), and the only wall-clock bound left on that path is `CAP_MS = 10000`
  in `set-settle.ts:24` — a backstop for a migration that never resolves, which
  promotes rather than blocks and cannot fire inside 400 mock ticks. If the loop
  ever IS too short the failure is the child's exit 3, a refusal rather than a
  plausible figure. And `measure-grid-cost.sh`'s `inject` now writes an explicit
  `INVALID` line to the artifact when the ssh fails, instead of leaving a section
  header with nothing under it. No device tier re-run: nothing here reaches the
  device and `measure-grid-cost.sh`'s sections do not depend on its sibling's
  window length.

- 2026-09-13 — **SP-07 closed, and the device A/B baseline is in under SP-13.**
  Both scripts could not do what they claimed. `grid-call-cost.mjs` counted
  nothing: without `setFlag('setcommit', 0)` the Set-commit press — which is
  wall-clock timed — never completed under instant ticks, movy stayed in
  `settling`, and the input gate refused every injected message, so both arms
  reported the idle refresh and nothing on top. It now ticks until
  `sessionReady()` and **refuses to print a number** rather than print that one.
  `measure-grid-cost.sh`'s view-change guard could never pass (a `grep -c` of
  zero exits 1, so `|| echo 0` made `moved` the two-line `"0\n0"`): every sample,
  clean or not, was stamped `INVALID`. It strips the newline now and prints the
  offending lines. **Teeth, and the metric was changed because the first one had
  none:** a ratio of window *totals* is dominated by the refresh both arms share
  and moves 2.71 → 2.80 under the teeth mutation — no signal — so the committed
  metric is the gesture **premium** over each arm's own idle floor. Suite guard
  realpath-hardened — Task 5's version silently did nothing under a symlinked
  path and exited 0. **The premium pair and the budget first recorded here (397
  vs −63, budget 550) were wrong** — one window was twice the other's span — and
  are superseded by the fix round below; the device `period_ms` figures in the
  SP-13 section are unaffected and stand. Rebuild on *both* sides of any `src/`
  mutation, since the child reads `dist/esm` and a mutation that is never rebuilt
  reaches nothing.
  Both `npm test` modes green (`SCHWUNG=../schwung`, and SKIPPED without it).
  **Device baseline, both arms, in the SP-13 section:** `period_ms` 4.8–5.1 and
  `calls/tick=0.6` on *both*, i.e. the device tier does not separate the arms at
  this scale — recorded as the before-value, and the reason the gate is the
  load-independent host-call count. `scripts/inject-movy.py` stays untracked, per
  the ruling; `refresh-blocking` was not touched.

- 2026-09-13 — **SP-06, review fix round 1** — two of the findings were defects
  in the instrument, not the prose. **F2, a short-circuit hole in the version
  chain:** a `release.json` that *parses* but carries no `version` returned its
  empty string, which is neither a version nor "unreadable", so it skipped the
  `host/version.txt` rung **and** the fail-open default — and the device that
  carries both files is exactly where that leaves the floor inert. The chain now
  falls through on an empty string like an absent or corrupt one. **F6, an
  assertion that could not fail:** the added `ok('the floor reads release.json
  and reports its reason')` was vacuous — `harness.mjs`'s `ok(label, cond)`
  defaults `cond` to `true` — so it was deleted, and the hole it was standing in
  front of is now pinned by three assertions that all read the *second* rung
  (`release.json` versionless, absent, and the host file alone). **Teeth, two
  mutations, each restored by `cp` (never `git checkout`):** restoring the
  short-circuit red `a versionless release.json falls through to the host
  version`; deleting the `version.txt` rung red all three at once — the rung
  that answers in production, invisible to every other assertion in the file.
  Both re-ran green after the copy, `diff` identical. **Also:** F5 (the
  read-once comment claimed a read on the draw path the implementation does not
  make), F4 (why `atLeast` is a deliberate copy of upstream's `compareVersions`
  rather than an import), F3 (garbage version strings fail *closed*, and what
  the two failure directions cost), F10 (the installer's staged-swap comment
  said atomic; the pair is not), and F1 — the mechanism sentence below is
  corrected. **The cable question is settled on the device** (Environment
  facts): `Shift` + step reaches movy on cable **0** of `/dev/shm/schwung-ui-midi`,
  measured as `0x2B` byte-identical against `0x0B` moving the row, so
  `scripts/inject-movy.py`'s cable-2 docstring is refuted and the script stays
  untracked. Commit: this one — `fix: the floor's fall-through, and an assertion
  that could not fail`.
- 2026-09-13 — **SP-06 ✅** — `SCHWUNG_FLOOR = '1.3.0'` in
  `src/renderer/schwung-floor.ts`, and `schwungGridMode()` pins to `off` on an
  under-floor host the same way it does when the library is missing.
  `scripts/install-schwung-fork.sh movy-min-host-1.1.0` installed the fork's
  `param_pages` (583cc175 → `param_pages.new` → rename swap → `restart_move_stack`,
  "down at 1.4s, new stack at 5.3s"). The version is read from `release.json`
  **first** and `/data/UserData/schwung/host/version.txt` **second**, because
  `release.json` does not exist on a real device (Environment facts) and with it
  alone every device reads as "unknown", unknown reads as met, and the floor is
  inert. The gate and the hint read `schwungFloorMetOnce`/`schwungFloorReasonOnce`
  — `schwungGridMode` is asked on every rendered frame and every knob event, and a
  `host_read_file` there is what Schwung's own read budget forbids; installing a
  Schwung restarts the stack, so a per-process answer is a per-host answer.
  **Device evidence, 2026-09-13**, movy reopened through `open_tool_cmd`: Settings
  row 1 reads **PARAM PAGES MOVY** with its own hint ("WHO DRAWS MODULE KNOBS. PAGE
  RE-PAGINATES.") at version 1.4.0; with `host/version.txt` set to **0.9.9** the
  same row reads **NEEDS SCHWUNG 1.3.0 (HAVE 0.9.9)**, wrapping to two lines of the
  124 px band; restoring 1.4.0 restores the row's own hint — so the floor is live
  on the device, and a floor-meeting device renders nothing new. **Teeth: three
  mutations, each captured red, restored by copy, and re-run green** —
  `SCHWUNG_FLOOR = '99.0.0'` (the brief's own Step 8 mutation) and a lexicographic
  `atLeast`, which red `browser-test/logic/schwung-floor.mjs`; and dropping the
  floor term from the mode gate, which red `browser-test/logic/schwung-grid.mjs`.
  **None of the brief's five assertions detects the floor being RAISED**, which is
  Step 8's mutation and the one that matters: four of the five feed
  `SCHWUNG_FLOOR` back into the reader that compares against it, so all five stay
  green at `'99.0.0'` — measured, not assumed. Two of them *do* red when the floor
  is LOWERED (`an old Schwung fails the floor` and `and the reason names the
  floor`, measured at `'0.1.0'`), so the suite is not uniformly blind; it is blind
  in the direction that hides a raise. The value pin and a numeric-compare case
  were added for it, and the pin is what makes Step 8's stated procedure
  reproduce. Two other brief gaps: `build/browser.mjs` needed the
  new module as an **entry point** (it does not glob), and the hint is composed in
  `src/seq/flags-page-vm.ts`, not `renderer/flags-view.ts` — the renderer is pure
  and `schwungLibError()` renders nowhere in production.
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
  **`schwung-pagination-check.mjs` is a known-red stand-alone probe.**
  Disposition recorded here because the failure was otherwise only in this Log
  line, where the next person to run it cannot tell a known state from a new
  break. It is **not in any gate and not in the device sweep** (`npm test` does
  not call it; the device tier's `browser-test/device-scripts.mjs` does not know
  it), so it is unwatched rather than hazardous — and it is **left red on
  purpose**: it exits 1 with `FAIL: the lock mark is not at the locked cell: 0/4
  pixels lit at (97,9) for slot 3`, which is a rendering symptom, so fixing it
  changes what a user sees and is Phase 1 by the Global Constraint — not Phase 0
  work and not debugged here. Two things make it a *known* state rather than a
  new break: **it was red before this task** — verified by reverting to `66e71a9`
  and re-running, byte-identical in both states — and the script's own header
  carries the same facts and points back to this entry. Read the header before
  treating its red as news.
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
