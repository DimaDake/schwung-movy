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

It prints `page-mode: N of M expected failures remain`. That number may shrink
and must never grow. If it grew, the last item regressed a sibling — stop. It
started at 13 (Phase 0) and **SP-11 took it to 6**; the remaining six are named
in `browser-test/page-mode-expected-fail.json`'s own note.

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

> **The device tier is GREEN — 15 scenarios, 130 checks, 0 failed.**
> `smoke#refresh-blocking` was red on arrival for every recorded run and is fixed
> (Log, 2026-09-13): the check was measuring a refresh that was not running, and
> grading it by a wall clock that could not tell a descheduled tick from a slow
> refresh. SP-25 starts on a gate that means something. Keep it that way.


| id | item | model | state |
| --- | --- | --- | --- |
| SP-25 | Level-shadowed `short_name` — build each cell from the def of the level that owns it | Sonnet | ✅ |
| SP-10 | Delegation boundary: ownership accessor + page identity | Opus | ✅ |
| SP-11 | Input ownership, incl. **Clear+knob must not delete the clip** | Opus | ✅ |
| SP-12 | Polling + LED ownership | Opus | ✅ |
| SP-13 | Per-tick cost: number, attribution, recommendation (**branch point**) | Opus | ✅ |
| SP-26 | **Bulk read for a delegated page** — SP-13's branch. The page reads ONE key per tick where movy's refresh read eight in one round trip | Opus | ✅ |
| SP-27 | **The per-tick CPU a delegated page costs** — what is left after SP-26 took the reads out: `tick_ms` 4.0–4.5 against `off`'s 1.7–2.0, with IPC accounting for 0.4 of it | Opus | ✅ |
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
| SU-7 | `io.getParams(keys)` — an optional BULK read for the staggered cursor and the reload check | — | ⬜ |

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
  `Shift` + step needs, since the same step lights both. `schwung-midi-inject-ui.py`,
  `test-device/device-agent/ui-agent.py` and `scripts/inject-any.py` all write
  cable 0. **`scripts/inject-movy.py` is DELETED** (2026-09-13): it was an
  untracked scratch file whose docstring claimed reaching an overtaking tool
  needs cable 2, it had **zero callers**, and leaving it untracked was never the
  mitigation it was taken for — an untracked file is still what a `grep` of
  `scripts/` turns up, and it stated the false premise more confidently than this
  entry states the correction. Its two genuine improvements were harvested into
  `inject-any.py` first: a per-status CIN (`0x09`/`0x08` for notes, which
  `inject-any.py` was getting wrong — it labelled every note-on as a control
  change and survived only because both are three-byte messages) and a ring-full
  error instead of a silent success. The cable-0 measurement is now recorded in
  `inject-any.py`'s own docstring, so the claim cannot come back a third time.
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

**⚠ THAT BASELINE MEASURED NOTHING, AND SP-13 FOUND OUT WHY (2026-09-16).**
`scripts/inject-any.py` read the status byte as hex and d1/d2 as **decimal**,
while `measure-grid-cost.sh` writes all three in hex — so `b0:0e:01`, the jog
detent that opens every run, died on `int('0e')` and **every inject failed**. A
failed inject does not stop the run: it removes the gesture and leaves five
sections of real numbers that are all the idle floor. That is why the table
above has five identical rows and why both arms read the same. The parser, the
`--dry-run` that lets a test check it, the `scp` that stops the device keeping a
copy of its own, and `browser-test/device-scripts.mjs` Test 18 all landed with
SP-13. **Only the `idle` row above was ever a measurement**; treat the other
four as absent. (The `INVALID: inject FAILED` line landed in SP-07's own fix
round, `32fe8c5`. Whether that table was sampled before it or beside it cannot
be recovered now — the rows are the idle floor either way, which is the point:
a guard that arrives after the number it would have voided does not void it
retroactively, so the number has to be re-taken. It has been.)

#### The A/B re-measured, 2026-09-16 (SP-13, after SP-12)

Same command, same device, working injector, three runs per arm alternating.
`page` preflight `schwung-body ok track=0 ck=synth pages=2`, `off` preflight
`schwung-body mode=off`. Section averages over every `perf_ipc` report in the
section; `n` is 28–56 reports per section.

| section | `off` calls/tick · ipc_ms · period_ms | `page` calls/tick · ipc_ms · period_ms |
| --- | --- | --- |
| idle | 0.60 · 1.22–1.45 · **4.89–5.00** | 3.00 · 6.44–6.54 · **9.11–9.48** |
| jog | 0.59 · 1.26–1.31 · 4.76–4.80 | *invalid — see below* |
| jogflick | 0.50 · 1.05–1.09 · 4.65–4.69 | *invalid* |
| knob | 0.50 · 1.02–1.06 · 4.65–4.67 | *invalid* |
| knobflick | 0.50 · 1.01–1.02 · 4.61–4.64 | *invalid* |

**The number: on a delegated page the device's tick period is 9.1–9.5 ms against
`off`'s 4.9–5.0 — it nearly DOUBLES, and it is sustained, not a transient.**
`tick_ms` goes 1.85 → 6.2–6.6. Measured directly as well: one jog, then 25 s of
`perf_ipc` reports, and every one of them reads 3.0 calls/tick / 9.1 ms with no
decay. The spread within an arm is ≤0.4 ms; the gap between the arms is 4.3 ms,
an order of magnitude outside it. This is not a null result.

`calls/tick=3.0` **double-counts**: `perf-probe` wraps both
`host_module_get_param` and the `shadow_get_param` the shim implements it over,
so `get overtake_dsp:* 1.4` and `mget ch0:* 1.3` are the same reads seen twice
(`ipc_ms` 6.5 > `tick_ms` 6.2 is the tell). The real figure is ~1.25 engine GETs
per tick, ~3.4 ms each — which is exactly the off-device count, from the other
instrument.

**The four `page` gesture sections are INVALID, and the run says so itself.**
Ten jog detents on a 2-page module walk off the end of `synth` onto `midi_fx1`,
whose contract is not ready — so the component stops being delegated, nothing
polls, and the sections come back at 0.50 calls/tick / 4.6 ms, *cheaper than
idle*, reading as "the gesture is free". `schwung-view` could not catch it (the
view never changes) so `sample()` now carries the body reason across sections
and flags it. A `page` gesture number on device needs a module with more pages
than the jog can cross; the gesture verdict stays off device, where it belongs.

#### The A/B after SP-26, 2026-09-17 — three runs per arm, alternating

Same command, same device, the tier's own fixture (plaits on track 0, so
`page` preflight `schwung-body ok track=0 ck=synth pages=2`, the same shape the
rows above were taken at). Every `perf_ipc` report in each `idle` section:

| section | `off` calls/tick · ipc_ms · tick_ms · period_ms | `page` calls/tick · ipc_ms · tick_ms · period_ms |
| --- | --- | --- |
| idle | 0.60 · 1.1–1.4 · 1.7–2.0 · **4.80–5.00** | 0.80 · 1.5–1.9 · 4.0–4.5 · **6.80–7.20** |

**The read cost is gone and the prediction held.** `calls/tick` 3.00 → 0.80
against `off`'s 0.60 — on the same double count, ~1.25 engine GETs a tick → ~0.1
— and `ipc_ms` 6.44–6.54 → 1.5–1.9 against `off`'s 1.1–1.4. The IPC premium a
delegated page charges is **+0.4 ms**, where SP-13 predicted ~+0.35 and measured
+5.1 before.

**What is left is not IPC, and that is SP-27.** The tick period is 6.80–7.20 ms
against `off`'s 4.80–5.00, a premium of **~2.0 ms**, and only 0.4 of it is in the
param channel: `tick_ms` is 4.0–4.5 against 1.7–2.0. That is CPU inside the
delegated page's own tick — the controller's tick and render, and movy's
`knobLevels` poll — and no amount of read batching touches it. It is a new item
rather than a re-opening of this one: the thing SP-13 attributed is fixed, and
what the measurement now shows is a different cost in a different layer. **Note
it is NOT the quiescing follow-on SP-13 floated** — that would have taken the
remaining reads, which are already down to ~0.1 a tick.

The four `page` gesture sections are still flagged `INVALID` for SP-13's reason
(ten jog detents walk off `synth` onto `midi_fx1`), so `idle` remains the row
that carries the comparison.

#### Off device after SP-26, 2026-09-17 — three runs per arm, zero spread

| arm | idle calls / trips per 600 ticks | gesture premium (calls) | mode resolved |
| --- | --- | --- | --- |
| `off` | 678 / **78** | −418 | off |
| `page` | 877 / **146** | +109 | page |

**The off-device instrument could not see this item until it was taught to.**
It counted `shadow_get_param`, one per param, so a page read one key at a time
and a page read eight in one bulk call scored the same — which is exactly why
SP-13's off-device row said "both arms read about the same NUMBER of params" and
had to send the verdict to the device. `browser-test/env.mjs` now serves
`shadow_get_params`/`shadow_set_params` over movy's own wire format (the device
has had them all along; without a stub every off-device suite took
`paramGetMany`'s per-key fallback, so movy's primary read path on device was
never exercised at all), and the instrument publishes BOTH counts: `calls` in
params, the unit every number in that file's history is in, and `trips` in
blocking round trips, which is the unit the device's tick period is set by.

In trips the page arm's idle floor goes **753 → 146**; the 78 beside it is what
`off` pays for movy's own refresh. In calls it goes 753 → 877, because the batch
reads a few MORE params than the cursor did — which is the whole trade, and the
reason the premium ceiling had to be re-derived (43 → 109 measured, ceiling
64 → 163) rather than kept.

~67 of those 146 trips are an artefact of the MOCK, not a cost the device pays:
a key the device does not serve answers `""` (the shim replies with an error and
a zeroed buffer) and `""` is cached like any other value, where the env's store
answers `null` — and **a null is never cached**, on purpose (below).

#### Off device, 2026-09-16 — five runs per arm, zero spread

| arm | idle / 600 ticks | gesture / 600 ticks | premium | mode resolved |
| --- | --- | --- | --- | --- |
| `off` | 678 (1.13/tick) | 260 (0.43/tick), 20 sets | **−418** | off |
| `page` | 753 (1.25/tick) | 796 (1.33/tick), 40 sets | **+43** | page |

Identical on all five runs of each arm. `SP-12's four predictions: three held
exactly` — page idle 678 → 753, `off` untouched at −418 / 678, and the ceiling
of 90 being far too loose. **The fourth did not**: the page premium is not 7.

**7 was an artefact of the harness's own clock.** Schwung throttles its
`setParam` on `Date.now` (`SETPARAM_THROTTLE_MS = 20`), parking a missed write
in `pendingWrite`; the harness fired all 20 gestures inside a millisecond of
wall clock, so 16 of the 20 writes collapsed into their neighbours and the page
arm wrote 4 where `off` wrote 20. `grid-call-cost.mjs` now spaces the gestures
40 ms apart on a virtual clock (`GESTURE_GAP_MS`, published as `gap=` on the
machine line and asserted by the suite). The same 20 gestures then write 40 —
two per gesture, the throttled write plus the release flush — and the premium is
**43**. `off` is −418 either way, which is what says this models Schwung's
throttle and not something of movy's.

`browser-test/grid-cost.mjs`'s ceiling is re-derived to **64**: above every
observed run (43, zero spread) and strictly below the doubling it exists to
catch (86), at the midpoint of that window rounded down.

#### The attribution

Every host call in both windows, bucketed by call site (five stack frames above
the wrapper), both arms:

| arm / window | site | calls / 600 ticks |
| --- | --- | --- |
| `off` idle | `refreshBatch → getMany → paramGetMany` | 675 |
| `off` gesture | same, suppressed by input | 234 (+20 sets) |
| `page` idle | Schwung's staggered read cursor → `getParam` | **600 (1/tick)** |
| `page` idle | `reloadIfChanged → load → getParam` | **150 (2 per 8 ticks)** |
| both | `pollModuleName` + `refreshModulatedKeys` | 3 |

**The cost is not how many parameters are read. It is that the delegated page
reads them ONE AT A TIME.** movy's `refreshOneParam` went through
`paramGetMany` — one bulk `shadow_get_params` round trip for a whole page of
eight keys, measured on device at `bget 0.1` + `mget ch0:* 0.0` per tick.
Schwung's controller has **no bulk read at all**: `page_controller.mjs:526` is
`io.getParam || (() => null)` and the cursor is deliberately one key per tick
(`:315`, sized against a schwung SLOT read at ~2.8 ms). On a movy CHAIN that
read is an engine GET at ~3.4 ms, and `src/host/param.ts:paramGetMany`'s own
comment is the whole story: *"A single engine GET blocks ~3-5 ms on device and a
param page refreshes eight knobs at a time; done one by one that is ~40 ms."*
The reload check on its divider of 8 adds 0.25 GETs/tick on top.

#### The recommendation

**The migration continues as planned.** SP-14 onward is unaffected: nothing
here is a reason to stop, and the cost is in one identified place rather than
spread through the design — the delegation boundary did its job, and SP-12's
own account of the per-tick poll was accurate; what it could not see is that
the read it added is un-batched.

**But SP-30 (default-on) cannot pass on this number.** A 4.9 → 9.1 ms tick is
movy's MIDI sampling interval halving, which is the original complaint
(swallowed jog detents) in its own units.

So SP-13 opens **SP-26 — bulk read for a delegated page**, Opus, in parallel,
blocking SP-30 and nothing else:

1. **Movy side, no upstream wait** (decision 3): movy owns the `io` object it
   hands the controller, so `io.getParam` can be served from a per-tick prefetch
   of the drawn page's keys — one `paramGetMany` round trip for the page instead
   of one GET per tick. The correctness question SP-26 has to answer is
   staleness against writes in flight, and it has SP-12's settle window
   (`s.settleUntil`) to answer it with.
2. **Upstream, in parallel: SU-7** — `io.getParams(keys) → values[]`, optional,
   used by the staggered cursor and by `reloadIfChanged`, falling back to
   per-key where a host does not supply it. `MOD_FAST_READS_PER_TICK`'s own
   comment already names the same want ("the real fix ... is publishing
   effective values in shared memory").

Re-measure SP-26 with this section's exact commands; the `idle` rows above are
its "before".

**Outcome (2026-09-17): SP-26 is closed and 1 was enough — SU-7 was not needed
to get the number.** The read premium is +0.4 ms against the ~+0.35 predicted
here. What blocks SP-30 now is **SP-27**, the ~1.9 ms of per-tick CPU this
measurement could not see behind the reads. SU-7 stays open on its own merits:
every OTHER embedder of `page_controller` still reads one key per tick, and a
host-side cache is movy's answer, not the library's.

---

### SP-26 — bulk read for a delegated page

**Closed 2026-09-17.** movy owns the `io` object it hands Schwung's controller,
so `io.getParam` is served from `src/renderer/schwung-page-cache.ts`: an EPOCH
cache in front of the track's port. Every `FILL_TICKS` (8 — the divider
`reloadIfChanged` already runs on, and the one Schwung's own host paces its
round trips with) the epoch advances and ONE `port.getMany()` refills every
tracked key; a read inside the epoch is a map lookup. Nothing about Schwung
changed: it still asks one key at a time, and it still gets an answer no older
than one fill — which is FRESHER than the cursor it replaces, because the cursor
reached a given cell once per rotation (~10 ticks on an eight-knob page).

**The tracked set is LEARNED, not predicted.** The keys asked in the last two
epochs are the batch. Predicting from `ctl.page.keys` would mean re-deriving
Schwung's `fullKey` template resolution for child levels — a second
implementation of the thing this migration exists to remove — and would still
miss `:base`, `:effective`, `preset_name`, `ui_hierarchy` and `chain_params`.
Learning covers all of them and self-corrects on a page change; the price is one
rotation of live reads when a page is first drawn, which is what every rotation
cost before.

**THE STALE-WRITE HAZARD IS ANSWERED AT THE PORT, BY PULL.** On a delegated page
movy is the writer — the knob under the hand (`io.setParam`), the sequencer, an
automation lane, undo, the drum handler — and every one of them goes through the
one memoized `portFor(track)`. `EnginePort` therefore logs the key of each write
with a sequence number (`writeSeq()` / `writesSince(seq)`, optional on
`TrackPort`), and the cache drains that log before it serves ANY value. One rule
covers every writer including its own, and nothing is subscribed, so a mode
change that throws every `SchwungPage` away leaves no listener behind. A write to
`k` drops `k` and `k:*` (the `:base` and `:effective` faces Schwung reads);
a write to `<ck>:module` drops everything, because a module swap changes every
value on the page; a log overrun drops everything, which is the safe direction.

**A NULL IS NEVER CACHED, AND THAT RULE WAS PAID FOR.** `null` is the channel
saying it did not answer — the state the controller's tri-state exists to re-ask
about — while `""` is a real answer and is cached like any other. The first
version cached both, and the burn-down went **6 → 7**: a module that arrived in
the slot while the grid was off screen was read as having NO hierarchy, so the
controller paginated `chain_params` into ONE page and `shift+jog: plain jog steps
one page` had nowhere to go. That is the fifth time in this branch a latched
verdict has come from collapsing those three answers into two, and the first time
one has come from collapsing them **in time** rather than in value. A re-plan
(`createPageContract.reload()`) drops the cache outright for the same reason: the
cache ages in PAGE TICKS, a page is ticked only while the grid is on screen
(SP-12), so a page that has been away knows nothing about how old its values are.

**Bulky values stay out of the batch.** `SHADOW_PARAM_VALUE_LEN` is 128 KB for
the whole bulk response and the fleet's heaviest contract (minijv) is 39 KB of
`ui_hierarchy` plus 45 KB of `chain_params`; an overflowing response makes
`paramGetMany` fall back to N single reads, which is correct and is exactly
today's cost. A key whose last value exceeded 16 KB is therefore read live, and
everything else rides the batch (plaits: 2.3 KB for both contract keys).
`SHADOW_BULK_MAX_ITEMS` is 64, so the batch is capped at 48.

**The numbers are in the SP-13 section above, in the same shape as the two rows
they join.** Device: tick period **9.11–9.48 → 6.80–7.20 ms** against `off`'s
4.80–5.00, `ipc_ms` **6.44–6.54 → 1.5–1.9** against 1.1–1.4, `calls/tick`
3.0 → 0.8. Off device: idle round trips **753 → 146**. SP-13's prediction — the
read premium falling from +4.3 ms to ~+0.35 — **held, at +0.4 ms measured**.

**The tests, and which half each holds.**
- `browser-test/logic/schwung-page.mjs`, restated in ROUND TRIPS (the old
  budget counted params, which is the one unit this item does not move — 80
  before, 125 after, while the real cost fell): a settled page stays under 54
  trips over 64 ticks, measured at 36. Tooth: `FILL_TICKS = 1` → 144.
- Same file, the hazard, at the level it lives at: a write through the port is
  visible on the very next read, and takes the parameter's `:base` with it.
  Tooth: remove the drain from `get()` → all four reds. It is asserted on the
  cache rather than through the page because through the page it would race
  Schwung's settle window against the fill divider, and a check that passes
  because two timers lined up is not one. What ties it to the page is
  structural (below).
- Same file, the control: a change movy did NOT make waits for the fill and is
  then picked up — without it every check above passes with no cache at all.
  And the null rule: a key nobody serves reads as no answer, and the value that
  arrives is seen at once. Tooth: cache the null → that check reddens.
- `browser-test/logic/page-owner.mjs`, structural: `schwung-page-io.ts` reads
  only through the cache. A `port.getParam` left in the io returns the identical
  VALUE and pays the old price forever, so only a grep can hold it. Tooth: put
  one back → red.
- `browser-test/grid-cost.mjs`: the page arm's idle floor in round trips, ceiling
  **219** (measured 146, doubling 292, midpoint rounded down). This is SP-26's
  own gate and the premium above is structurally unable to be it — the idle cost
  is in BOTH windows and subtracts out. Tooth: bypass the cache → 753 trips, red,
  **while the premium check stays green at 43**, which is the demonstration.

### SP-27 — the per-tick CPU a delegated page costs

Opened by SP-26's own measurement, which is what SP-13's instrument could only
see once the reads were out of the way. With the IPC premium down to +0.4 ms the
delegated page's tick period is still 6.80–7.20 ms against `off`'s 4.80–5.00,
and `tick_ms` is **4.0–4.5 against 1.7–2.0**. So ~1.9 ms per tick is CPU inside
the delegated page — Schwung's controller tick and render, plus movy's
`knobLevels` poll — and no amount of read batching touches it.

**It is not SP-13's quiescing follow-on**, which would have taken the remaining
reads: those are already ~0.1 a tick. Whether SP-30 can pass on 6.9 ms is this
item's question, not SP-26's: 6.9 ms is a 40% longer MIDI sampling interval than
`off`, against the 90% SP-13 measured.

#### The answer, 2026-09-17 — the reload re-planned the whole module every 8 ticks

**The cost is `load()`, and it was doing the entire job in order to discard it.**
`reloadIfChanged` runs on a divider (~every 8 ticks) so a module swap or a preset
that republishes its contract is noticed while the grid stands on a page. It
answered that question by parsing both contract strings, walking the hierarchy,
planning every page, resolving each page's viz and hashing the result — and then
returning at `planned.fingerprint === s.fingerprint`, which in a steady state is
EVERY time.

**The fingerprint is taken over `[hierarchy, chainParams, mode]` and nothing
else** (`page_plan.mjs:586`), so the raw bytes of those same three inputs answer
the identical question before any of the work. That is what makes the fix an
equivalence rather than an approximation, and it is why `visible_if` is
untouched: a condition is driven by a VALUE, which moves without the declaration
moving, and the fingerprint has never been able to see it — `conditionKeys` and
`replanIfCondition`/`flushReplan` are that path, and they still run.

A second cost rode on the first. `fingerprintOf` memoises on object IDENTITY,
with a comment noting that the controller assigns `hierarchy`/`chainParams` from
`parse()` and never mutates them — but `load()` re-`parse()`d on every reload, so
the memo never hit and the full FNV hash over the stringified contract ran each
time. Reusing the parsed objects restores it.

**WHY NOBODY HAD SEEN IT: every instrument ran the best case.** The off-device
suite used `hier_params_overflow_two_levels` (11 params, 2 levels) and the device
A/B used plaits (14 params, 1 level). minijv is 433 params and 57 levels — the
LARGEST in the fleet, a 31x/57x ratio — and the discarded work scales with the
module while the CADENCE does not. Measured in node on the page arm:

| arm | module | mean tick | p50 | p99 | contract re-derivations / 2000 ticks |
| --- | --- | --- | --- | --- | --- |
| `off` | plaits | 0.0116 ms | 0.0091 | 0.0288 | **0** |
| `off` | minijv | 0.0117 ms | 0.0092 | 0.0277 | **0** |
| `page` | plaits | 0.0270 ms | 0.0125 | 0.1365 | 500 |
| `page` | minijv | **0.3660 ms** | 0.0137 | **3.0231** | 500 |

The tell is the p50/p99 split: the median tick was always cheap and one tick in
eight cost 2.8 ms, uniformly, gap of exactly 8. A mean smears that across every
tick and a median hides it completely, which is why the new instrument keeps the
whole distribution. And `off` is FLAT in module size — 0.0116 against 0.0117 for
a 31x bigger module — which is the standard this item was measured against.

After the fix, on the same runs:

| arm | module | mean tick | p99 | re-derivations |
| --- | --- | --- | --- | --- |
| `page` | plaits | 0.0161 ms | 0.0366 | **0** |
| `page` | minijv | **0.0158 ms** | **0.0359** | **0** |

**A delegated page is now flat in module size too** — minijv costs what plaits
costs — and the page arm's premium over `off` falls from 31x to ~1.4x. In node
that is 23x on the mean and 84x on the tail.

#### On device, 2026-09-17 — 67.5 ms a tick to 3.0, and `off` is 1.9

The A/B that matters, both arms freshly loaded, minijv on track 0, `schwunggrid`
at `page`, sampled after the arrival transient (`perf_ipc`, every reading in a
20 s window):

| controller | `tick_ms` | `period_ms` | `ctlreload` phase |
| --- | --- | --- | --- |
| before | 67.5–67.7 | 70.3–70.4 | **65.1** |
| after | **3.0–3.1** | **5.8–5.9** | **0.8** |
| (`off` arm, same module) | 1.9 | 4.9 | — |

**22x on the tick, 81x on the phase itself, and the MIDI sampling interval goes
70.4 ms to 5.9 ms against movy's own 4.9.** A delegated page was ticking at
**13 Hz**; it ticks at ~170 Hz now. That is the complaint in its own units: at
13 Hz the grid drops jog detents and knob CCs wholesale, which is what "very
laggy" was.

**The off-device instrument predicted the device ratio almost exactly** — 0.366
→ 0.0158 ms is 23x in node, 67.5 → 3.0 is 22x on device — which is the argument
for keeping a node instrument at all. The ABSOLUTE numbers do not transfer (the
device is ~185x slower on this work: 0.366 x 185 = 67.7) but the ratio did, on
both arms.

**AND THE COST WAS NEVER WHERE `perf_phase` COULD SEE IT.** It reported
`rest=0.6 seqengine=0.5 ...` summing to ~1.3 ms against a `tick_ms` of 70, so 69
ms sat outside every named phase: `VIEW_CHAIN` — the view movy OPENS on — had no
phases at all, and the delegated page's poll had none either. Four new phases
(`pagepoll`, `ctlpoll`, `ctlreload`, `ctltick`, plus `render`/`buildvm`/`leds` on
`VIEW_CHAIN`) are what turned "the tick is slow" into `ctlreload=65.1`. An
unmeasured phase is where a cost hides, and this one hid in the open for the
whole migration.

#### The measurement trap that cost four readings, written down so it is not paid twice

**A swapped `.mjs` under `shared/` is NOT loaded until the stack restarts, and
every reading before that is the OLD file reporting as the new one.** movy's own
CLAUDE.md says it — `shadow_load_ui_module` re-evaluates `ui.js` on every tool
open, but the ES modules it IMPORTS are cached for the whole `shadow_ui` process
lifetime — and `param_pages` is external to movy's bundle (`external:
['/data/UserData/schwung/*']` in `build/device.mjs`), so it is exactly such an
import. Reopening movy, which is what every other device measurement in this file
relies on, does not reload it.

The failure is silent and it looks like a RESULT: patched and original measured
67 ms and 70 ms, a plausible 4% with the spread of two arms that were the same
program. The tell, in hindsight, was that a fix proven to remove the work
off-device moved nothing at all. `ssh root@move.local python3 -` with
`scripts/lib/restart-stack.py` is the fix — the same body the device tier uses,
which fails loudly unless the process actually went away and a new one came back.
Restart between arms, or do not compare them.

**THE FIX IS UPSTREAM, in `page_controller.mjs`.** movy owns the `io` it hands
the controller (SP-26) but not the reload cadence, so there is no movy-side
version of this — and there should not be: every other embedder of
`page_controller` pays the same cost, and `load()` is byte-identical between the
schwung the device runs and upstream `origin/main`. Branch
`perf/page-reload-skip-unchanged-contract`, with
`tests/host/test_page_reload_skips_unchanged_contract.sh` asserting BOTH
directions — a steady reload re-derives nothing, and a republished hierarchy, a
changed `chain_params` and a different component each still re-plan.

**NEW INSTRUMENTS, because the old ones structurally could not see this.**
`scripts/grid-call-cost.mjs` counts host CALLS, and its header explains at length
why calls and not milliseconds — sound reasoning that has an end, and SP-26 is
where it was reached. `scripts/grid-tick-cpu.mjs` measures the other half: per-tick
CPU as a distribution, a V8 self-time profile behind `--prof`, and a count of
contract re-derivations. `browser-test/dump-fixture.mjs` builds its fixtures from
`docs/module-dump/device-dump.json`, so `minijv` is minijv's own metadata replayed
rather than a mock shaped like it.

**THE GATE IS A COUNT, NOT A DURATION.** `grid-cost.mjs` asserts that a steady
delegated page re-derives minijv's contract ZERO times — an invariant, where
milliseconds would be flaky, and with the fixture's shape asserted beside it so a
mock that silently shrank cannot pass quietly. Teeth: without the fix it measures
150 over 600 ticks and reddens.


## Log

Newest first. One line per closed item: id, date, commit, the evidence.

- 2026-09-17 — **SP-27 ✅ — the delegated page re-planned the whole module every
  8 ticks and threw the result away; minijv's tick is 23x cheaper.** Reported as
  "schwung pages are very laggy on minijv compared to movy pages", and that is
  the shape of the answer: `off` is FLAT in module size (0.0116 ms on plaits,
  0.0117 on minijv — 14 params against 433) where the delegated page was 13x
  more expensive on the big module. Root cause in `load()`: `planPages` runs
  unconditionally and is discarded at `planned.fingerprint === s.fingerprint`,
  and the fingerprint is over `[hierarchy, chainParams, mode]` ONLY — so the raw
  bytes answer the same question before the work. Comparing them first is an
  equivalence, not a heuristic. `page`/minijv mean tick **0.3660 → 0.0158 ms**,
  p99 **3.0231 → 0.0359**, contract re-derivations **500 → 0** per 2000 ticks; a
  delegated page is now flat in module size, like movy's own. Full account under
  **SP-27** in the item detail.

  **ON DEVICE: `tick_ms` 67.5 → 3.0, `period_ms` 70.4 → 5.9 against `off`'s
  4.9** — a delegated page on minijv was ticking at **13 Hz** and now ticks at
  ~170 Hz. The node instrument predicted the ratio (23x there, 22x here) while
  the absolute numbers are ~185x apart, which is the case for keeping it.

  **THE COST WAS INVISIBLE TO `perf_phase`**, which named 1.3 ms of a 70 ms
  tick: `VIEW_CHAIN` — the view movy opens on — carried no phases, and neither
  did the delegated page's poll. Four new phases turned "the tick is slow" into
  `ctlreload=65.1`, and they stay.

  **AND A SWAPPED `param_pages` FILE IS NOT LOADED UNTIL THE STACK RESTARTS.**
  QuickJS caches the modules `ui.js` imports for the whole `shadow_ui` process
  life, and `param_pages` is external to the bundle — so reopening movy, which
  every other device measurement here relies on, reloads nothing. Four readings
  were taken before this was noticed and all four were the old file; they read
  as a plausible 4% difference rather than as an error. Restart with
  `scripts/lib/restart-stack.py` as root between arms, or do not compare them.

  **THE FIX IS UPSTREAM AND THE MEASUREMENT WAS THE HARD PART.** schwung branch
  `perf/page-reload-skip-unchanged-contract`; `load()` is byte-identical between
  the schwung the device runs and `origin/main`, so one patch serves both, and
  every other embedder of `page_controller` pays this today. movy owns the `io`
  but not the reload cadence, so there is no movy-side version of it.

  **EVERY EXISTING INSTRUMENT RAN THE BEST CASE**, which is why SP-27 could sit
  open as "~1.9 ms of CPU" with no attribution: off-device used an 11-param
  2-level mock, the device A/B used plaits (14 params, 1 level), and the cost
  scales with the module while the CADENCE does not. `scripts/grid-tick-cpu.mjs`
  and `browser-test/dump-fixture.mjs` are new — the fixture is built from
  `docs/module-dump/device-dump.json`, so `minijv` is minijv's own 433 params and
  57 levels replayed rather than a mock shaped like it. The p50/p99 split is what
  found it: the median tick was always cheap and one tick in eight cost 2.8 ms,
  at a uniform gap of exactly 8.

  **Gates.** `SCHWUNG=../schwung npm test` exit 0 (167 screenshots, page-mode 6
  of 6, grid-cost green at both existing ceilings plus the new one); schwung
  `tests/host` 298 pass with the same 14 pre-existing failures as the unpatched
  tree; new `test_page_reload_skips_unchanged_contract.sh` 6 of 6, with the two
  steady-state checks proven to fail (40 and 10 parses) against the unfixed
  controller and the four change-detection checks passing both ways by design.
  `grid-cost.mjs`'s new check measures 150 re-derivations and reddens with the
  fix removed. Device: the A/B above, taken with a stack restart between arms.

- 2026-09-17 — **SP-26 ✅ — the delegated page reads a page at a time, and the
  tick came back 2.3 ms.** SP-13's branch, closed on the number it opened for:
  device tick period **9.11–9.48 → 6.80–7.20 ms** against `off`'s 4.80–5.00,
  `ipc_ms` **6.44–6.54 → 1.5–1.9** against 1.1–1.4, `calls/tick` 3.0 → 0.8. The
  read premium SP-13 attributed — +4.3 ms, ~1.25 blocking engine GETs a tick —
  is **+0.4 ms**, against the ~+0.35 it predicted. Full account under **SP-26**
  in the item detail; both new measurement tables sit beside SP-13's own in its
  section, so all three readings read side by side.

  **HOW.** movy owns the `io` it hands the controller, so `io.getParam` is served
  from an epoch cache (`src/renderer/schwung-page-cache.ts`) that one
  `port.getMany()` refills every 8 ticks — the divider `reloadIfChanged` already
  runs on. The tracked set is LEARNED from what the controller actually asks, not
  predicted from `ctl.page.keys`: predicting would mean re-deriving Schwung's
  `fullKey` child-level templates in movy, which is the second implementation
  this migration exists to delete, and would still miss `:base`, `:effective`,
  `preset_name` and the two contract keys. Freshness improves rather than
  degrades — every tracked key is refreshed every 8 ticks where the cursor
  reached a given cell once per ~10-tick rotation.

  **THE STALE-WRITE HAZARD IS ANSWERED AT THE PORT, BY PULL.** movy is the writer
  on a delegated page — the knob under the hand, the sequencer, a lane, undo, the
  drum handler — and all of them go through the one memoized `portFor(track)`.
  `EnginePort` logs each write's key behind a sequence number and the cache
  drains that log before serving ANY value, so one rule covers every writer
  including `io.setParam`'s own, and nothing is subscribed — a mode change that
  drops every `SchwungPage` leaves no listener behind. A write to `k` takes
  `k:base`/`k:effective` with it; a write to `<ck>:module` takes everything,
  because a module swap changes every value on the page.

  **A NULL IS NEVER CACHED, AND THE BURN-DOWN IS WHAT SAID SO.** The first
  version cached a no-answer alongside a real one and the burn-down went **6 →
  7**: a module that arrived while the grid was off screen read as having NO
  hierarchy, the controller paginated `chain_params` into ONE page, and
  `shift+jog: plain jog steps one page` had nowhere to go. `null` is the channel
  declining to answer — the state the tri-state re-asks about — where `""` is a
  real answer and is cached like any other. Fifth latched verdict in this branch
  from collapsing those three into two, and the first collapsed **in time**
  rather than in value. A re-plan drops the cache outright for the same reason:
  the cache ages in PAGE TICKS, and a page is ticked only while the grid is on
  screen (SP-12), so a page that has been away knows nothing about how old its
  values are. The burn-down is back at **6 of 6** with the original fixture
  ordering — no fixture was adjusted to get there.

  **THE OFF-DEVICE INSTRUMENT COULD NOT SEE THIS ITEM UNTIL IT WAS TAUGHT TO,
  and that is a finding about the harness.** It counted `shadow_get_param`, one
  per param, so eight keys in one bulk call and eight keys one at a time scored
  the same — which is precisely why SP-13's off-device row read "both arms read
  about the same NUMBER of params" and the verdict had to go to the device.
  `browser-test/env.mjs` now serves `shadow_get_params`/`shadow_set_params` over
  movy's own wire format; without them every off-device suite took
  `paramGetMany`'s per-key fallback, so **movy's primary read path on device was
  never exercised off device at all**. `scripts/grid-call-cost.mjs` publishes
  both counts — `calls` (params, the unit its whole history is in) and `trips`
  (round trips, the unit the tick period is in) — and the page arm's idle floor
  is **753 → 146 trips**, against the 78 `off` pays for its own refresh. In
  calls it goes 753 → 877: the batch reads a few more params than the cursor
  did, which is the trade, and is why the premium ceiling was re-derived
  (43 → 109 measured; 64 → **163**, the same midpoint-of-the-doubling rule)
  rather than kept.

  **THE NEW GATE IS THE IDLE FLOOR IN TRIPS, ceiling 219**, because a gesture
  PREMIUM is structurally unable to hold this: the idle cost sits in both windows
  and subtracts out exactly. Proved by mutation — bypassing the cache puts the
  floor back at **753** and reddens the new check while the premium check stays
  green at 43.

  **Teeth proved on every new check and restored**: `FILL_TICKS = 1` (144 trips
  over 64 ticks), the drain removed from `get()` (four hazard reds), the null
  cached (the arrival-is-seen-at-once red), a `port.getParam` put back in the io
  (both structural reds), and the cache bypassed end to end (753 trips).

  **WHAT IS LEFT IS NOT IPC, and it is a new item rather than this one
  re-opened.** At 0.4 ms of IPC premium the page's tick is still 6.8–7.2 ms
  against 4.8–5.0, and `tick_ms` is 4.0–4.5 against 1.7–2.0 — ~1.9 ms of CPU
  inside the delegated page's own tick. **SP-27** takes it. It is explicitly NOT
  SP-13's quiescing follow-on, which would have taken reads that are already down
  to ~0.1 a tick.

  **SP-30 is not unblocked by this number alone.** 6.9 ms is a 40% longer MIDI
  sampling interval than `off`, against the 90% SP-13 measured — the complaint's
  cause is gone and its magnitude is halved, but the gap is still four times the
  within-arm spread. SP-27 is what SP-30 should now wait on.

  **Gates.** `SCHWUNG=../schwung npm test` exit 0 (167 screenshots passed, 0
  failed — no pixel moved); `page-mode` **6 of 6**; `grid-cost` green at both
  re-derived ceilings; device tier **15 scenarios · 130 checks · 0 failed**, two
  `⚠ FLAKY` (`automation`, the known cold-chain-fixture hazard, and
  `module-contract`) and `engine: unchanged`. The device was left with
  `schwunggrid` back at 0. MANUAL.md / README.md untouched: the default build is
  `off`, where none of this is visible — SP-30 is the item that documents the
  mode when it becomes the default.

- 2026-09-16 — **SP-13 ✅ — the number is 9.1 ms, the attribution is the
  un-batched read, and the migration continues.** Branch point, not a gate: the
  full numbers, both arms, are in the SP-13 item detail above, in the same shape
  as the baseline they replace. Three things this session had to correct before
  it could report anything.

  **THE DEVICE HALF OF THE A/B HAD NEVER DELIVERED A GESTURE.**
  `scripts/inject-any.py` parsed the status byte as hex and d1/d2 as **decimal**
  — since the day it was written (`5bed7be`) — while its only caller writes all
  three in hex. `b0:0e:01` died on `int('0e')`, so every inject in every run
  failed. A failed inject does not abort the run: it removes the gesture and
  leaves five sections of real numbers that are all the idle floor. The
  2026-09-13 baseline's five identical rows were that, and the honest-sounding
  note under them ("the device arm does not separate the arms at this scale")
  was right about the `idle` row for a reason that had nothing to do with scale
  — before SP-12 the delegated page's cursor did not run — and vacuous about the
  other four. Fixed at the parser (uniform hex, with `--dry-run` so the grammar
  can be tested off device), at the supply chain (`measure-grid-cost.sh` now
  **scp**s the injector every run — nothing else deployed it, and the device had
  been holding a hand-copied one since 2026-09-04), and at the suite
  (`device-scripts.mjs` Test 18 parses the script's own tokens through the
  injector and compares the DECODED BYTES, because `b0:47:20` parses under both
  radices and means two different knobs). Teeth proved three ways: the decimal
  parser reddens it, a parser that decodes without throwing but as decimal
  reddens only the byte check, and removing the `scp` reddens the supply check.

  **A SAMPLE CAN LEAVE THE PAGE IT IS MEASURING, AND THE OLD GUARD COULD NOT SEE
  IT.** With the injects landing, the `page` arm's four gesture sections came
  back at 0.50 calls/tick against an idle of 3.00 — *cheaper than idle*, which
  reads as "the gesture is free". It was not: ten jog detents on a 2-page module
  walk off the end of `synth` onto `midi_fx1`, whose contract is not ready, so
  the component stops being delegated and nothing polls. `schwung-view` cannot
  catch that (the view never changes), and a section that strays and STAYS
  strayed logs nothing of its own — so `sample()` now carries the last
  `schwung-body` reason ACROSS sections and flags any that is not the one the
  preflight proved. It flags exactly those four and leaves `idle` clean.

  **THE FOURTH SP-12 PREDICTION DID NOT HOLD, AND THE HARNESS'S OWN CLOCK IS
  WHY.** Page idle 678 → 753, `off` untouched at −418 / 678, the ceiling far too
  loose: all three held to the call, five runs each, zero spread. The premium is
  **43**, not 7. Schwung throttles its `setParam` on `Date.now`
  (`SETPARAM_THROTTLE_MS = 20`) and parks the miss in `pendingWrite`; the
  harness fired all 20 gestures inside a millisecond, so 16 of the page arm's 20
  writes collapsed into their neighbours. `grid-call-cost.mjs` now spaces them
  40 ms apart on a virtual clock — 40 and not 20 because the throttle compares
  `>=` and a measurement sitting on its own boundary is not one — and the arm
  writes 40, two per gesture: the throttled write plus the release flush. `off`
  is −418 with the spacing and without it, which is what says this models
  Schwung's throttle rather than something of movy's. The cadence is published
  as `gap=` on the machine line and **asserted**, because a harness that
  silently got faster again is the one regression that makes the number BETTER.
  The ceiling is re-derived to **64**: above every observed run (43) and
  strictly below the doubling it exists to catch (86), at the midpoint of that
  window rounded down — not a round number, which is what 90 was.

  **THE NUMBER.** On device, on a delegated page, the tick period is **9.11–9.48
  ms against `off`'s 4.89–5.00** — sustained, not a transient (one jog, then 25 s
  of reports, every one of them 3.0 calls/tick / 9.1 ms with no decay). Spread
  within an arm ≤0.4 ms; the gap is 4.3 ms. The tick period IS movy's MIDI
  sampling interval, so this is the original complaint — swallowed jog detents —
  in its own units.

  **THE ATTRIBUTION, from call-site bucketing on both arms rather than from
  reasoning.** `off`'s floor is 675 calls through
  `refreshBatch → paramGetMany` — **one bulk round trip for eight keys**.
  `page`'s 753 is 600 single-key reads from Schwung's staggered cursor (1/tick)
  plus 150 from `reloadIfChanged` on its divider of 8. The cost is not how many
  parameters are read; it is that the delegated page reads them ONE AT A TIME.
  `page_controller.mjs:526` is `io.getParam || (() => null)` — the controller
  has no bulk read at all, and its cursor is sized against a schwung SLOT read
  at ~2.8 ms, where a movy CHAIN read is an engine GET at ~3.4 ms.
  `src/host/param.ts:paramGetMany`'s own comment predicted this exactly.

  **THE RECOMMENDATION.** The migration continues as planned — SP-14 onward is
  unaffected, and the cost is in one identified place rather than spread through
  the design. **SP-30 (default-on) cannot pass on this number**, so SP-13 opens
  **SP-26** (movy-side per-tick prefetch through the `io` object movy already
  owns) with **SU-7** upstream (`io.getParams`) in parallel. Both are in the
  tables above; SP-26 blocks SP-30 and nothing else.

  **No `src/` or `engine/` change** — this item is a measurement, and the code
  it touched is the instruments that produce it (`scripts/inject-any.py`,
  `scripts/measure-grid-cost.sh`, `scripts/grid-call-cost.mjs`) plus the two
  suites that pin them (`browser-test/grid-cost.mjs`,
  `browser-test/device-scripts.mjs`).

  **Gates.** `SCHWUNG=../schwung npm test` exit 0 (167 screenshots passed, 0
  failed — no pixel moved); `page-mode` **6 of 6**; `grid-cost` green at the new
  ceiling; device tier **15 scenarios · 130 checks · 0 failed**, no flakes,
  `engine: unchanged, no restart`. The device was left with `schwunggrid` back
  at 0 and movy reopened on it, which is what the tier expects. MANUAL.md /
  README.md untouched: nothing here is user-visible.

- 2026-09-16 — **SP-12 ✅ — one reader, one LED writer, and the poll that had to
  move first.** `refreshOneParam` and `updateKnobLEDs` both stop for a delegated
  component, and neither could stop until the poll did.

  **WHAT GATES THEM IS `owner.delegated`, asked ONCE per tick.** `app/tick.ts`
  resolves `pageOwnerOf(activeModel)` a single time and that one answer decides
  three things: `activeModel.tick(!owner.delegated)` (the new `refreshValues`
  argument on `processTick`, gating ONLY the value refresh — the name poll, the
  modulation re-read and the metadata retry stay, because they are how a module
  swap is noticed at all), whether Schwung's page is polled and drawn, and which
  of the two lights the ring. `model/` may not import `app/`, so the answer is
  pushed down, the way `setNoRefreshKeys` already was.

  **THE NAIVE VERSION OF THIS ITEM IS A DEADLOCK, and it is the whole reason
  `src/app/page-poll.ts` exists.** `refreshOneParam` sets `dirty`
  unconditionally, so movy's repaint cadence WAS the refresh — and the repaint
  was the only caller of `owner.poll()`. Stop the refresh and: no refresh → model
  never dirty → no frame → no poll → the page never reads → its values freeze →
  nothing dirties. Measured, not reasoned: before the poll moved out of the
  render branch, a parameter changed behind both readers' backs was picked up by
  movy in the `off` arm and by **nobody** in the `page` arm. So the poll runs
  once per tick, and the drawn cells' own values (plus the page identity, because
  jogging to a page with the same numbers still changes every label) are what
  asks for the frame back.

  **THE POLL IS NOT UNCONDITIONAL, and that is deliberate.**
  `schwung-page-contract.ts` spends a finite retry budget with no recovery once
  spent (Cause D, SP-15). Polling regardless of view would burn it down while
  movy sat on the sequencer and the page would be given up before the user ever
  opened it. `moduleGridOnScreen()` is the guard, and **`app/tick.ts` derives the
  BODY from the same expression** — one computation, two uses, so "polled" and
  "drawn" cannot drift apart. Ordering is load-bearing in the other direction
  too: the poll comes BEFORE the body is asked for, because the body is what
  readiness gates and the poll is what resolves readiness. Gating the poll on the
  body instead looks exactly like the feature being off — proved by mutation, the
  burn-down collapses to **0 of 6** because nothing delegates at all.

  **WHO DRIVES THE LEDS: Schwung supplies the values, movy stays the one
  writer.** Schwung ships `knob_leds.mjs`, but its only caller is
  `shadow_ui_param_pages.mjs` — the shadow UI's own host, not the controller — so
  an embedder gets no LED writes from `createController`. `SchwungPage` gains
  `knobLevels()`: the eight drawn cells normalised through Schwung's **own**
  `normalizedOf` (the reading a knob arc, a modulation dot and an indicator LED
  all take, and not `fractionOf`), `null` for unbound or unread, which is an
  unlit knob. `knob-leds.ts` gains `updateKnobLEDsFrom(levels)` beside
  `updateKnobLEDs(vm)`, sharing one `writeKnobRow` — one ramp, one diff cache,
  one frame LED budget, one `knobLED k=` log line. A second writer on eight LEDs
  is exactly how a knob strands itself on a colour it no longer shows, and
  keeping `lastKnobColor` single is what makes leaving a delegated page relight
  the row instead of inheriting it. `lightKnobRow(vm, body)` is one helper for
  both screens, for the same reason `schwungBodyFor` is.

  **A COST DEFECT THIS ITEM CREATED AND THEN FIXED, and the fix is the
  interesting half.** `createPageContract.tick()` called `ctl.reloadIfChanged()`
  every tick — a full contract read, asking whether the module was swapped. That
  was survivable only because the tick was rare; making the poll per-tick turned
  it into the page's largest standing cost. Measured in
  `scripts/grid-call-cost.mjs`: the `page` arm idled at **3.00 host calls/tick**
  with it there. It is now on a divider of **8** — Schwung's own host paces the
  identical question the same way and says why ("~2.8 ms ... for an edge that
  fires once") — giving **1.25 calls/tick**, against the **1.13** of the movy
  refresh it replaces. The delay it buys is at most 8 ticks before a departed
  module hands the frame back.

  **The tests, and which half each holds.**
  - `browser-test/app-loop.mjs`, last block, **both arms**, fixture `test16`:
    `movy re-reads the params only when movy owns the page` is ONE label whose
    expectation is `!delegated`, so it is the gate itself in both arms; `the
    drawn page is read whoever owns it` is its partner, without which the first
    passes just as well with nothing reading at all. Then the ring: jog one page
    — under `page` that moves Schwung's index and leaves movy's bank alone, so a
    row lit from movy's model would not move — and the eight LEDs must equal the
    colours of the DRAWN cells, computed from the live store and the drawn keys
    so it is neither reader's cache.
  - The movy-owned half is in the same block: Main Params still lights its row
    and **takes it back** from the module page. Tooth: suppressing LED work by
    VIEW rather than by OWNER (dropping the `updateKnobLEDs` on the
    VIEW_MAIN_PARAMS branch) reddens `and the row left the module page behind` in
    **both** arms — the row stranded on the module page's colours, which is the
    LED-ownership hazard in one line.
  - `browser-test/logic/page-owner.mjs`, structural, the SP-10/SP-11 idiom:
    `.poll()` appears only in `app/page-poll.ts`; `app/tick.ts` never calls
    `activeModel?.tick()` with no argument; and `knob-leds.js` is **imported**
    only by `app/tick.ts`. That last rule is asked of the IMPORT and not the
    call because the first version was asked of the call and an alias
    (`updateKnobLEDs as _u`) walked straight past it — it stayed green on the
    tooth, which is how that was found.
  - `browser-test/logic/page-owner.mjs`, unit: the two LED sources light the same
    colours for the same normalised values, and an unbound cell is dark rather
    than sitting at the bottom of its range.
  - `browser-test/logic/schwung-page.mjs`: a settled page stays inside one read a
    tick plus the paced poll — 80 reads over 64 ticks; with the divider at 1 it
    is 192, and the check goes red.

  **Teeth proved on every new check and restored**: the three page-arm app-loop
  reds were red before the implementation (`expected false, got true`; `expected
  0.9, got 0`; the ring showing movy's page-1 values); afterwards each was
  re-reddened by its own mutation — `tick(true)`, `updateKnobLEDs(vm)` on both
  module branches (which shows the row going to `[124,124,124,124,75,75,75,75]`,
  i.e. not merely the wrong parameters but a DEAD row, because movy has stopped
  reading them), a second `.poll()` caller, `activeModel?.tick()`, an aliased
  LED import, one ramp for both sources, an unbound cell lit at minimum,
  `knobLevels` answering 0, `RELOAD_POLL_TICKS = 1`, and the poll gated behind
  the body.

  **One fixture correction, and it is not a burn-down win.** The file-browse
  block swaps the module under a cached page and gestured immediately; SP-12 made
  the resulting re-plan visible (the stale plan used to just keep answering), so
  the block was measuring the RE-PLAN rather than who takes the click, and
  `chain page: file-param jog click opens file browser` flipped green for the
  wrong reason. The fixture now waits the contract out, bounded, and the label is
  red again. **The burn-down stands at 6 of 6** — Cause C is untouched and stays
  SP-17 / SU-4's.

  **Gates.** `SCHWUNG=../schwung npm test` exit 0 (167 screenshots passed, 0
  failed — no pixel moved, so no baseline was regenerated); `page-mode` **6 of 6,
  ledger up to date**; device tier **15 scenarios · 130 checks · 0 failed**, no
  flakes, `engine: unchanged, no restart`. The tier runs with `schwunggrid` OFF,
  so what it proves is the movy-owned half on real hardware — `smoke` reports
  `updateKnobLEDs ran — 8 knobs logged, 8 lit` and `refresh-blocking` PASS at a
  5 ms median.

  **MANUAL.md / README.md untouched, and that is a call rather than an
  oversight**: the DEFAULT build is `off`, where nothing about this is visible.
  What changed is visible only under `schwunggrid = page`, and SP-30 is the item
  that documents that mode when it becomes the default.

  **What SP-13 should expect to see move.** Off device, `grid-call-cost.mjs`:
  page premium **51 → 7**, page idle floor **678 → 753 / 600 ticks** (1.13 →
  1.25 calls/tick), `off` unchanged at **−418 / 678**. Read them together or
  they mislead — the old 678 was movy's refresh alone, with the delegated page
  polled only on a repaint that a steady movy never asks for, so its read cursor
  never advanced. The page is genuinely read now, for 0.12 calls/tick more than
  the refresh it replaced. On device, re-run `./scripts/measure-grid-cost.sh off`
  then `page` against the 2026-09-13 `period_ms` table above; a move smaller than
  that spread is a null result, not a pass. And SP-13 owns re-deriving
  `grid-cost.mjs`'s ceiling, which at 90 is now 13x the measurement.

- 2026-09-14 — **SP-11 ✅ — input ownership, and the clip survives Clear+knob.**
  The burn-down went **13 → 6** and the guarantee in the design's bold line is
  now a check that runs in both arms on every `npm test`.

  **CLEAR + KNOB IS A KNOB GESTURE, WHATEVER IT FOUND — that is the whole fix,
  and the old code made it conditional on a lookup.** `router.ts`'s touch branch
  read `if (deleteActive() && info)`, so when the owner named no parameter for
  that knob the branch fell through, `markDeleteActed()` never ran, and letting
  go of Clear ran `clipdel`. A knob with nothing under it is not exotic: any
  page that does not fill all 8 cells has one, and a delegated page answers null
  for every knob until its contract resolves. It now consumes the gesture
  unconditionally and clears the lane only when there is one — plus the same
  mark on the RELEASE, for the ordering where Clear goes down after the touch.

  **The test is `app-loop.mjs`'s `Clear + a knob never deletes the clip`, and it
  was red in BOTH arms before the fix** (`expected false, got true`) — this was
  never only a delegation bug, which is why the fixture is a two-parameter
  module where knob 7 is blank on either planner. Three checks: the empty knob,
  a live knob, and a plain Clear tap that must still delete the clip, so the
  guard cannot be a mute button on the feature. Teeth re-proved after the fix by
  restoring `&& info`: red again, both arms.

  **Six burn-down labels fell to ONE ordering change.** Schwung's door block ran
  before movy's own in-flight gestures, and a knob under the hand is one of the
  conditions that ladder takes a click on — so assign mode could never be
  committed (`assigned: navigated to LFO slot`, `assigned: on chain view`,
  `assign mode exited`, `LFO page shows the assigned target (not None)`,
  `module touch cleared on return`) and a held-step click never drilled from the
  chain into the params (`chain+held jog-press drills to params`). Assign mode
  and a held step are now decided above the door, with the reason at the site.

  **What else moved to the owner:** the step-page-at-bank-0 test on the jog
  (`pageOwnerOf(m).pageIndex === 0` — reading movy's bank meant a jog on page 3
  hopped to the step page), both Left/Right arrows, master-detail paging, and
  the assign-mode jump to the LFO page. `handleKnobTouch(d1, !owner.delegated)`
  stops movy opening its OWN enum / file dive over the cell someone else drew —
  the touch is still recorded, because the release, the header readout and the
  file-browse gesture all read it. `getFileBrowseTarget(keyAt?)` takes the drawn
  key from the caller (`model/` may not import `app/`), resolves it BY KEY —
  movy's gi is meaningless under another planner — and answers null when the
  drawn cell is not a file param.

  **The structural check is where the teeth are, again.** `logic/page-owner.mjs`
  now also fails if any file outside the five page *implementations* calls
  `.changePage(` / `.getKnobPage(` on a receiver that is not an owner, and if
  `router.ts` contains `getFileBrowseTarget()` or `handleKnobTouch(d1)` with no
  page named. All four mutations were run and each reddened exactly its own
  check, naming the file and the line.

  **One KNOWN EXEMPTION, named in the test so it is not mistaken for coverage:**
  Shift+jog's `changePageGroup` still goes straight to movy's model. Schwung's
  pages have no group, so routing it through the owner would page a delegated
  page by one and turn a passing app-loop check red — the burn-down must never
  grow. The section jump is Schwung's Shift+click picker: SP-17.

  **The six that remain, and why none of them is one line.** Five are Cause C —
  a filepath dive has no editor in Schwung, so under `page` the controller takes
  the click and movy's file browser is never reached (SP-17 / SU-4). This item
  fixes WHICH parameter that browser would open, not who gets the click, and
  says so. The sixth, `held-step jog switches page`, is a **fixture limit, not a
  movy defect**: the suite's module (mrdrums) is four movy banks and a SINGLE
  Schwung page, so in the `page` arm the jog has nowhere to go — measured,
  `pageCount 1, delegated true`. Swapping that block's module for a multi-page
  one makes the label pass and **poisons every later block**: the page cache is
  keyed by `(track, component)`, outlives `init()`, and its contract does not
  re-resolve after a module swap — not with a cache drop, not with 200 ticks
  (`select leaves the file browser` goes red). That is Cause D reproduced
  offline, and it is **SP-15's** to fix; the note in
  `page-mode-expected-fail.json` carries it so the next session does not re-find
  it. Two checks were re-phrased through the accessor rather than through movy's
  bank index (`held-step jog switches page`, `shift+jog: plain jog steps one
  page`) — in the `off` arm the accessor IS movy's bank, so they are the same
  checks they were; in the `page` arm they finally ask about the page on screen.

  **Gates.** `SCHWUNG=../schwung npm test` exit 0 (167 screenshots passed, 0
  failed — no pixel moved, so no baseline was regenerated); `page-mode` **6 of
  6, ledger up to date**; device tier **15 scenarios · 130 checks · 0 failed**,
  no flakes, `engine: unchanged, no restart`. The device tier runs with the
  `schwunggrid` flag OFF, so what it proves is that the movy-owned paths are
  untouched — the `page` arm's coverage is the burn-down, and that is the
  arrangement until SP-30 flips the default.

  **MANUAL.md updated** (§8 Controls reference, the Delete/Clear row): the clip
  surviving Clear + an empty knob is visible in the DEFAULT build, not only
  under `page`, so it is a behaviour change a user would notice. README
  untouched — not a headline feature.

  **What SP-12 and SP-13 build on.**
  - **SP-12 (polling + LEDs):** nothing in the input path polls any more, so
    `owner.poll()` has exactly one caller left to gain (`tick.ts`), and
    `owner.delegated` — now proven at the input sites — is the same gate that
    stops `refreshOneParam` and `updateKnobLEDs`. Note that `owner.knobParamInfo`
    is what the LED ring must ask: the touch, the turn, the lane and the
    Clear gesture all take their parameter from it already.
  - **SP-13 (cost):** this item added no per-tick work — the owner calls it
    introduces are all on the gesture path, one per input event — so the
    2026-09-13 A/B baseline still stands as the "before". Re-measure after
    SP-12 with `scripts/measure-grid-cost.sh`.

- 2026-09-14 — **SP-10 ✅ — the delegation boundary exists, and it is one
  object.** `src/app/page-owner.ts` is now the only place in movy that decides
  whether Schwung owns a component's pages. `pageRefOf(model)` is the page
  identity — `{track: appState.activeTrack.index, componentKey}` — and
  `pageOwnerOf(model)` returns a `PageOwner` with the two implementations §3 of
  the design asks for: `movyOwner` (movy plans, pages and answers) and
  `delegateOwner` (Schwung's page, holding a movy owner as its fallback). It
  answers `ref`, `claimed`, `delegated`, `page`, `pageIndex`, `pageCount`,
  `reason`, `poll()`, `knobParamInfo(slot)` and `changePage(delta)`.

  **What was there before was the same seven lines written seven times.** Every
  seam point re-derived ownership — `schwungActiveFor(appState.activeTrack.index,
  m.getComponentKey ? m.getComponentKey() : 'synth')` — with **four different
  component-key fallbacks between them** (`'synth'`, `'(none)'`, `?? 'synth'`,
  and one with no guard at all), plus two
  `schwungChangePage(...) || m?.changePage(dir)` pairs. Migrated: `knobInfoFor`,
  knob touch, knob release, drum-pad voice focus, knob turn, Back, jog click and
  both jog-paging branches in `src/midi/router.ts`; `schwungBodyFor` and
  `schwungBankFor` in `src/app/tick.ts`. `schwungActiveFor` and
  `schwungChangePage` are **deleted** from `schwung-grid.ts`, which is now only
  the mode and the `(track, component)` page cache — `schwungPageFor` has exactly
  one caller in `src/`.

  **CLAIMED IS NOT DELEGATED, and that distinction is the one the old code
  smeared.** A page is built while its module is still loading, so there is a
  window where Schwung is the intended owner and its contract has not resolved.
  `tick.ts` needs that window to keep ticking the page; every gesture needs it to
  stay with movy. `schwungActiveFor`'s `ready ? p : null` said the second half at
  each site and `schwungPageFor` said the first at one, which is why `tick.ts`
  had to call both. One owner says both: `claimed` gates the poll, `delegated`
  and `page` gate every answer, and the pre-ready window falls through to the
  SAME movy owner object the movy-owned case uses, so the two cannot drift.

  **One deliberate narrowing, and it can only ever reduce what Schwung takes.**
  `isMovyOwnComponent()` (new, in `chain/config.ts` beside `isMasterComponent`)
  says the mix page and the two LFO pages are movy's own — no module declares
  them, so there is nothing for a planner to plan. They were claimed before this:
  a controller was built per `(track, component)` and its contract never
  resolved, so the right answer came back for the wrong reason. Their new log
  reason is `movy-page ck=<key>`, and `scripts/measure-grid-cost.sh:157`'s
  preflight regex learned it in the same commit — a reason that regex cannot
  match reads as "no schwung-body line at all" and ABORTS the measurement.

  **The test with teeth is structural, because the defect is a site that was
  never written to ask.** `browser-test/logic/page-owner.mjs` walks `src/**/*.ts`
  and fails if `schwungActiveFor(`/`schwungChangePage(`/`schwungPageFor(` appears
  outside `schwung-grid.ts` and `page-owner.ts`, with a stale-allowlist check —
  the idiom `logic/tracks-refs.mjs:120` already uses for slot-addressed param
  reads. **Proved red both ways**: it was red before the migration (`router.ts`
  and `tick.ts` both named those functions), and restoring ONE jog site to the
  old `schwungChangePage(...) || m?.changePage(dir)` turns it red again, naming
  the file. The behaviour half is proved too — making `delegateOwner.changePage`
  fall through to movy reddens exactly the two checks that pin the divergence
  (`changePage moves Schwung's page` / `and leaves movy's bank alone`), which is
  the disagreement the accessor exists to stop: the two planners page
  differently, so a site moving movy's bank while Schwung draws moves an index
  nothing displays.

  **Behaviour is unchanged and that is the claim being made**, not a hope:
  `SCHWUNG=../schwung npm test` exit 0 (167 screenshots passed, 0 failed — no
  pixel moved, so no baseline was regenerated), `page-mode` still **13 of 13**,
  device tier **15 scenarios · 130 checks · 0 failed**, no flakes, engine
  unchanged. The `schwung-body` log tokens are preserved verbatim because the
  device A/B greps them.

  **What SP-11, SP-12 and SP-13 build on.**
  - **SP-11 (input):** `owner.page` is the one handle for forwarding a gesture,
    and `owner.knobParamInfo` already gives Clear+knob the same key the page is
    showing. Two sites are DELIBERATELY LEFT for it and named here so they are
    not missed: `router.ts:892` and `:933` still read
    `(m?.getKnobPage?.() ?? 0) === 0` — the step-page-at-bank-0 interplay and the
    Left/Right arrows — because changing them changes the step-page jog, which is
    SP-11's listed scope. Each is one line: `pageOwnerOf(m).pageIndex === 0` and
    `pageOwnerOf(m).changePage(±1)`. `model/index.ts`'s `getFileBrowseTarget`
    reads `s.knobPage` and cannot be fixed in place — `model/` may not import
    `app/`, so the target has to be passed in.
  - **SP-12 (polling + LEDs):** `owner.poll()` is where a delegated page's own
    read cursor runs, and `owner.delegated` is the gate that stops movy's
    `refreshOneParam` and `updateKnobLEDs` for the same component. The rule is
    already expressible in one condition instead of fifteen.
  - **SP-13 (cost):** the boundary removed one duplicated
    `schwungGridMode()` + `schwungPageFor()` pair per knob turn (the turn site
    asked twice: once for `spk`, once inside `knobInfoFor`). That is the only
    cost this item moved; re-measure with `scripts/measure-grid-cost.sh` after
    SP-12, against the 2026-09-13 baseline recorded above.

  **One finding recorded, not fixed:** `schwungPageFor` builds every page on
  `portFor(trackIndex)`, so a `master_fx*` component's page is read from
  `ch<track>:master_fx…`, which does not exist — master FX pages are claimed and
  their contract can never resolve. `componentPort()` is the function that
  already knows better. Fixing it would ENABLE delegation of a surface with no
  device coverage, so it is left for SP-14/SP-20 rather than smuggled in here.

  MANUAL.md / README.md untouched: this is an internal seam with no user-visible
  change — no new feature, page, gesture or control, and the docs granularity
  rule asks for none.

- 2026-09-14 — **SP-25 ✅ — level-shadowed `short_name`, and the fix that
  almost broke a second module.** Root cause exactly as pinned: `absorbHierarchy`
  (`model/hierarchy.ts:108`) flattens every level's `params[]` into one
  `paramDefs` map, last-write-wins, so `generic-pages.ts:156` built jp8000's
  `Performance` page (owned by `perf_main`, which declares `key_mode` → "KeyMd"
  and `arp_mode` → "ArpMd") from whatever `perf_setup`/`perf_arp` (both
  `short_name: "Mode"`) wrote last. Fixed by building each cell from the def of
  the level that OWNS its page first: `hierarchy-walk.ts` gains `levelOwnDefs`
  (a level's own `.params`/`.knobs` object entries, never merged across
  levels), `buildLevelPages` carries it on every returned page, and
  `generic-pages.ts` threads a `defs` map through `bankEntries` instead of
  reading the flattened map directly.

  **The flattened map (`paramDefs`/`knobInline`) was NOT deleted — a first cut
  that dropped it reddened `audio_fx--filter` in `dump-replay`, and that fleet
  check is what caught it before it shipped.** `filter`'s `root` level lists
  `lfo_rate_div` in its own `knobs[]` but declares no object entry for it — only
  the child `lfo` level does (`short_name: "Div"`) — so `root` is deliberately
  *inheriting* a declaration it never redeclares, the same pattern `env_amount`
  uses between `root` and `envelope`. That is the opposite shape from jp8000,
  where the colliding levels each carry their OWN full redeclaration with a
  DIFFERENT value. The final read is layered:
  `entry.defs[key] ?? paramDefs[key] ?? knobInline[key] ?? {}` — the owning
  level's own object entry wins when it exists, and the pre-existing flattened
  map still serves the inheritance case when it doesn't. Re-running the full
  95-module `dump-replay` after layering the fallback back in showed exactly
  one snapshot line move in the entire fleet (jp8000's Performance page, MODE/
  MODE → KEYMD/ARPMD) — confirmed by diffing the regenerated
  `dump-expect.json` before trusting it.

  **Teeth, both directions, on a synthetic fixture shaped like jp8000's
  (`MOCK_SYNTHS.level_shadowed_short_name`, `browser-test/mock-synth.mjs`):** a
  level that owns a page and declares distinct short_names, plus sibling levels
  visited LATER (so they write LAST into the flat map) that redeclare the same
  keys colliding. The new check in `browser-test/logic/model-hierarchy.mjs`
  failed red against the unmodified code (`key_mode`/`arp_mode` both read back
  "Mode", the exact jp8000 symptom) and passed green after the fix; it also
  asserts the sibling levels' OWN pages still read correctly, as a guard that
  scoping to the owning level doesn't regress the pages that were already right
  by coincidence of write order.

  **`KNOWN_COLLIDING_PAGES`'s jp8000 entry is removed** (`dump-replay.mjs`) —
  verified, not assumed: `SCHWUNG=../schwung node browser-test/dump-replay.mjs`
  is green over all 95 modules with the entry gone, jp8000's Performance page
  now reading `["KEYMD","SPLIT","DETUNE","VOICES","ARP","ARPMD","BEAT","BPM"]`
  with no accommodation. `config-pages.ts:67` reads the same kind of flattened
  map for movy-config modules and was deliberately left untouched — no known
  repro (none of `KNOWN_COLLIDING_PAGES`'s remaining four entries are a
  config-path module) and out of this item's pinned scope; noted here as an
  unverified parallel shape for whoever next touches that file.

  No screenshot baseline touches jp8000 (confirmed by grep before starting), so
  none needed regenerating; `screenshot.mjs` reports its usual 167 passed, 0
  failed. `npm test` exit 0. Device tier: 15 scenarios, 130 checks, 0 failed, no
  flakes — unaffected, since this is a label-only change to the generic
  parameter-page path and the engine did not rebuild (`engine: unchanged, no
  restart`). MANUAL.md/README.md not touched: a corrected label on one
  third-party module's page is not a new feature, page, gesture or control by
  the docs granularity rule.

- 2026-09-13 — **THE RED GATE IS GREEN, and the check was the thing that was
  broken — twice over.** `npm run test:device` now exits 0. Neither defect was in
  movy, and neither was Phase 0's: the check has failed since it was ported from
  bash in `3c296a1`.

  **Defect 1 — the window measured a movy with nothing to refresh.** The two jog
  turns in `smoke.ts` move the CHAIN cursor (`chain chainIndex=2`, then `3`), and
  `loadHierarchy` answers each empty slot with `ui_hierarchy null — no params`.
  The perf settle sat *after* those turns, so every sample in it read
  `perf_refresh_ms=0 params=0` — `refreshOneParam` had no populated param to read,
  measured nothing, and reported the best possible number for it. The window is
  now taken **before** the jog. Re-selecting track 0 afterwards does not work and
  the comment says why: track 0 is already active, so `dev.selectTrack(0)` is a
  no-op (`track: active=0 chain=0` with no `loadHierarchy` behind it) and the
  chain cursor stays where the jog left it. Measured before: 0 of 5 samples with
  `params>0`. After: 4 samples, `[5,5,5,4]`.

  **Defect 2 — the one non-zero sample was a descheduled tick, not a refresh.**
  `perf_refresh_ms` is a `Date.now()` delta around `refreshOneParam()`
  (`src/model/tick.ts:141-147`) on the shadow-UI QuickJS thread, which is **not
  realtime**, so the number includes any time that thread spent parked. Requiring
  every sample under 10 ms asserted that the OS never deschedules it for longer —
  not a property movy has, or that the check meant to assert. Evidence, 424
  samples over a full tier run: 5 exceed 10 ms (27, 35, 166, 237, 339, 458), every
  one lands in the `seq` window with the sequencer PLAYING and step-recording, and
  each sits beside a `perf_ipc` line reporting `peak_period` 239-351 ms — the
  whole TICK stalled. The decisive one is `perf_refresh_ms=166 params=0`: a
  refresh with no populated param to read cannot spend 166 ms working. The check
  now asserts the **median** of samples with `params>0`, with
  `REFRESH_MIN_SAMPLES = 3` so "measured nothing" FAILS rather than passes.

  **A startup stall is fine and is now explicitly tolerated.** The first sample
  after a cold open is 157-181 ms while the module is still loading (`peak=112`
  host calls in that tick, tick rate recovering to ~218 Hz immediately after).
  That is loading, not blocking, and the median ignores it — which is the point:
  the old check failed on exactly that sample.

  **TEETH, all three directions, two of them on the device.** (1) *Broken refresh
  path:* `refreshBatch`'s one `port.getMany(keys)` replaced by
  `keys.map(k => port.getParam(k))` — the bulk batching coming undone, which is
  the regression this check exists for — moved **every** sample to `[40,40,38,39,
  37]`, median 39, **red**. That is why the median keeps the teeth the max was
  supposed to have: a real regression moves every sample, a descheduled tick moves
  one. (2) *Measuring nothing:* the intermediate run, before the window moved,
  failed with `only 0 of 5 sample(s) had params>0` — so the void is loud now
  instead of green. (3) *Outlier tolerance:* median `[5,5,5,458]` = 5 and
  `[5,5,339,458]` = 5, while `[40,40,38,39,37]` = 39. Restored via `cp`, never
  `git checkout`.

  **Full tier after the fix: 15 scenarios, 130 checks, 0 failed.** The Phase 1
  warning above the state table is lifted — SP-25 starts on a green gate.

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

- 2026-09-13 — **FIXED (below, same day): `scripts/inject-movy.py` is deleted and
  its good parts live in `inject-any.py`.** The original finding, kept for the
  reasoning: **hazard left in the tree, and untracked is not the mitigation it
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
