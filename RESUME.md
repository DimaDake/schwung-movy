# RESUME — Movy embeds Schwung's UI

Parked 2026-08-31; merged up to movy `v0.31.0` and pushed 2026-09-04.
Working end to end on hardware behind a build flag.

Read `docs/plans/2026-08-31-movy-embeds-schwung-ui-status.md` first — it has the
split of duties, the six known gaps, and every device-found defect with its
cause. This file is just how to get back to a running build.

---

## The two checkouts

| | |
| --- | --- |
| **schwung** | `/Volumes/ExtFS/charlesvestal/github/schwung-parent/schwung/.claude/worktrees/param-pages-embeddable`<br>branch `worktree-param-pages-embeddable`, pushed, merged up to main 2026-09-04 (9 ahead, 0 behind). **See below — movy no longer needs it.** |

### The schwung branch is no longer load-bearing (2026-09-04)

The param_pages groundwork this branch was cut for **is already on schwung
main**, upstreamed as #373 (`let a tool embed the real knob grid`) and #377
(`a readout looked exactly like a control`). Main is now a strict SUPERSET of
this branch's export surface: everything the branch exports plus
`drawReadoutFrame` / `drawReadoutMark`, a `readOnly` argument on
`drawEnumSquare`, and options on `drawFooter`.

movy imports exactly four symbols — `renderPageMovy`, `BAND_H`,
`createController`, `LAYOUT_MOVY` — and all four are on main with the same
shape. **Verified by building movy against a clean worktree of schwung
`origin/main` and running all six checks: every one passed, and
`schwung-grid-delta` reported identical measurements (1383 px / 16.9%).**

So the "this couples movy to an unreleased Schwung branch" objection is gone:
point `SCHWUNG` at any schwung checkout on main and the experiment builds. The
merge above was still done so the branch is not stale, but it exists now only
for its docs and the `025c4c06` chrome refactor — not because movy needs it.

The merge's two conflicts (`page_controller.mjs`, `render_page_movy.mjs`) were
both one hunk, both resolved to main's side: main only ADDED `revalue` and the
readout-mark call, which this branch had never carried.
| **movy** | `/Volumes/ExtFS/charlesvestal/github/schwung-parent/schwung-movy-embed`<br>branch `schwung-grid-delta`, tracking `fork/schwung-grid-delta` on `charlesvestal/schwung-movy` (a fork of `DimaDake/schwung-movy`) |

**Both are pushed now.** movy has two remotes: `origin` = DimaDake's upstream
(read-only for us), `fork` = charlesvestal's fork, which is what the branch
tracks. Open a PR from `charlesvestal:schwung-grid-delta` when the maintenance
question below is answered.

### Merged up to v0.31.0 (2026-09-04)

Upstream had moved 54 commits — scenes & song mode, a CPU meter page, per-voice
drums, ENGINE 0.62.0. **Merged, not rebased**, and deliberately: the branch
already carries two merges of `origin/main`, so a rebase would replay 11 commits
over 54 and re-resolve the same conflicts per commit. The merge was textually
clean (`git merge-tree` exit 0) — only 5 of our 19 files are also touched
upstream, and the whole `src/renderer/schwung-*.ts` layer is ours alone.

The one thing worth re-checking after any future merge: upstream's new views get
their own branch in `tick.ts`. `VIEW_CPU` and `VIEW_FLAGS` sit ABOVE the two
`schwungBodyFor` call sites in the else-if chain, so the flag cannot intercept
them. A new view added BELOW those sites would silently hand movy's own screen
to the Schwung planner, which has nothing to plan for it.

---

## Get it building

```bash
export SCHWUNG=/Volumes/ExtFS/charlesvestal/github/schwung-parent/schwung/.claude/worktrees/param-pages-embeddable

cd /Volumes/ExtFS/charlesvestal/github/schwung-parent/schwung-movy-embed
npm install
npm run build:browser
```

`SCHWUNG` is not optional. movy imports Schwung's `param_pages` by its absolute
DEVICE path (`/data/UserData/schwung/shared/param_pages/...`), which the device
build leaves external and the browser build resolves via that variable. Without
it the import falls back to a stub that THROWS when called — deliberately, so a
stubbed grid cannot render blank and look like success.

---

## The checks

All in the movy checkout, all need `SCHWUNG` set. Each fails on the mutation of
the bug it was written for — do not trust one that has never failed.

```bash
node scripts/schwung-app-check.mjs           # the REAL app loop renders Schwung
node scripts/schwung-page-kinds-check.mjs    # preset/items/knobs all draw
node scripts/schwung-interaction-check.mjs   # knobs + clicks reach the controller
node scripts/schwung-knob-feel-check.mjs     # knob travel matches movy's
node scripts/schwung-late-contract-check.mjs # late module, empty slot, failed read
node scripts/schwung-pagination-check.mjs    # lanes follow parameters, not slots
node scripts/schwung-grid-delta.mjs          # measurement: how different the grids are
```

movy's own suite, which must stay green with the flag OFF:

```bash
node browser-test/screenshot.mjs   # 149 baselines
node browser-test/app-loop.mjs
node browser-test/logic.mjs
node browser-test/dump-replay.mjs
```

Also `node browser-test/perf.mjs` and `node browser-test/device-scripts.mjs`.

(`abi-parity.mjs` and `track-colors.mjs` skip: they want a schwung checkout at
megadake's own hardcoded `/Users/dake/git/cld/schwung`. Pre-existing.)

Schwung's suite, from the worktree:

```bash
for t in tests/host/*.sh; do bash "$t" >/dev/null 2>&1 || echo "FAIL $t"; done
```
213 pass at park.

---

## The switch

```
MOVY_SCHWUNG_GRID=page    Schwung plans and draws the module pages
MOVY_SCHWUNG_GRID=off     stock movy, byte-identical (the default)
```

It is a build-time define, not a runtime setting, so an ordinary build cannot
ship the experiment by forgetting a call.

**`off` is free now — but it was not, and the reason is worth keeping.** The
define makes the grid's code unreachable, and unreachable is not absent:
esbuild keeps an EXTERNAL import whatever the importing code does, so a
flag-off `ui.js` still carried a top-level

    import { renderPageMovy, BAND_H } from
      "/data/UserData/schwung/shared/param_pages/render_page_movy.mjs"

— 13.5 KB of dead widget code and, far worse, a LOAD-TIME dependency on a
Schwung new enough to serve that file. On an older one an *ordinary* movy would
not start at all.

A define could not fix it; the modules had to leave the graph.
`src/renderer/schwung-{body,page}.off.ts` are surface-identical stand-ins that
import nothing from Schwung and throw if ever called, and `build/device.mjs`
swaps them in when `MOVY_SCHWUNG_GRID` is `off`. Those two are the only
importers of param_pages, so they take the whole layer with them.

Measured after the fix: flag off 528.8 KB, flag on 537.5 KB — the experiment
weighs 8.7 KB and **zero** param_pages references survive an off build.
Confirmed on device both ways: off boots clean and draws movy's own grid
(`schwung-body mode=off`, 0 errors); on draws Schwung's.

What still separates a flag-off build from stock movy is ~4.5 KB of movy's OWN
code with no external dependency — `schwung-grid.ts` (the registry),
`schwung-flag.ts`, the two stubs, and the seam in `tick.ts`/`router.ts` — plus
an esbuild alpha-rename of `mode` to `mode2`. That is the cost of the seam
itself, and it is defensible; the load-time dependency was not.

**Any device suite silently reverts the flag.** `scripts/test.sh` calls
`deploy.sh`, which rebuilds `ui.js` with no `MOVY_SCHWUNG_GRID` in the
environment — so a test run leaves the device on `mode = true ? "off" : "off"`.
Rebuild and redeploy with `MOVY_SCHWUNG_GRID=page ./scripts/build-module.sh`
after any device suite, and confirm with

    ssh ableton@move.local 'grep -oE "mode = true . \"[a-z]+\" : \"off\"" \
      /data/UserData/schwung/modules/tools/movy/ui.js'

---

## Deploy

Schwung first — movy's device build imports the shared library from it, so a
stale host means missing exports.

```bash
cd $SCHWUNG
./scripts/build.sh
./scripts/install.sh local --skip-modules --skip-confirmation
```

If `build.sh` fails on the Link SDK, the submodule is not initialised in this
worktree (worktrees do not inherit submodules):

```bash
git submodule update --init --recursive libs/link
```

Then movy — the WHOLE module, not just `ui.js`:

```bash
cd /Volumes/ExtFS/charlesvestal/github/schwung-parent/schwung-movy-embed
MOVY_SCHWUNG_GRID=page ./scripts/build-module.sh
scp dist/movy-module.tar.gz ableton@move.local:/data/UserData/m.tar.gz
ssh ableton@move.local "cd /data/UserData/schwung/modules/tools \
  && tar -xzf /data/UserData/m.tar.gz && rm -f /data/UserData/m.tar.gz"
```

**Ship `dsp.so` and `module.json` with `ui.js` whenever the movy source has
moved.** A `ui.js`-only deploy is only safe while the installed `dsp.so` came
from the same tree — that assumption failed once already, when the device was
running an engine 65 commits behind the UI, and any oddity would have been
unattributable.

`scripts/build-module.sh` needs the Rust cross-target:
`rustup target add aarch64-unknown-linux-gnu` (the Homebrew linker is already
installed).

---

## The device

Running branch builds of BOTH. Rollback:

- **movy** → `/data/UserData/movy-backup-20260828/` holds the v0.29.0 `dsp.so`,
  `module.json` and `ui.js.pre-schwung-grid`. Copy them back into
  `/data/UserData/schwung/modules/tools/movy/` (renaming the ui file).
- **schwung** → reinstall whatever build you want. The device had no
  `version.txt` before this work, so its previous state was never recorded.

Do not leave a backup inside `modules/tools/` — it carries a `module.json` and
the scanner lists it as a second Movy. That is what caused the duplicate Tools
entry; the backup lives outside the scanned tree now.

Diagnostics, if the grid is not taking the frame:

```bash
ssh ableton@move.local "touch /data/UserData/schwung/debug_log_on"
ssh ableton@move.local "grep -E 'schwung-body|schwung-view' /data/UserData/schwung/debug.log | tail"
```

`schwung-body` names which of its early returns it took (`mode=`, `no-model`,
`step-page-selected`, `not-ready track= ck= pages=`, or `ok`). `schwung-view`
reports the view, session mode and masterDetail — that line is what identified
the wrong-view bug in one shot.

---

## Where to pick up

Not more features. The next question is whether movy WANTS this: it deletes
their knob renderer's reason to exist, couples their look to Schwung's release
cadence, and re-paginates every module. The technical case is made and
measured; the maintenance case is megadake's to make.

### The unrouted gestures are routed (2026-09-04)

All three are done, plus the enum peek nobody had noticed was missing:

- **Back** follows Schwung's ladder — hint, peek, picker, menu, then exit. Only
  `exit` reaches movy's own Back.
- **The section picker** is Shift+click, Schwung's own idiom. On `VIEW_KNOBS`
  only: `VIEW_CHAIN`'s Shift+click is movy's module browser, and the plain
  no-knob-held click is the browser on both views. Schwung's fourth ladder rung
  would have taken a gesture people use for one they have never had.
- **A divable param** opens `schwung-editor.ts` — movy's screen, Schwung's
  `drawEnumList`, committed through `ctl.commitEnum` so the index-vs-name wire
  format stays the controller's problem.
- **The enum peek** now draws at all: `render()` calls
  `ctl.renderOverlays(ctx, {clearScreen})`, and the controller REFUSES to draw
  an overlay without a clearScreen, so omitting the argument was the same as
  having no overlays.

Click and Back are not reimplemented — movy calls Schwung's `applyInput`, so
they cannot drift. Knobs deliberately do not: its knob intent carries a
DIRECTION and moves one detent per call, which is the magnitude bug
`schwung-knob-feel-check` exists to catch.

**A Schwung bug came out of this.** `drawEnumList` took a ctx, used it for the
header and footer, then called `drawMenuList` WITHOUT it — so the list body
drew through the `fill_rect`/`print` globals. Both surfaces are the device in
the shadow UI, so it looked right and stayed wrong; movy crashed on `print is
not defined`. Fixed in the schwung branch (75aa0f98's neighbour, commit
`75cf51ad`); it was the only such call site in the engine.

### Merged to schwung main again (2026-09-04, later)

Brought in module-supplied widgets (#405) — `frame_ctx`, `widget_registry`,
`sprite_rle` — plus #402's relative-CC decode fix. 247 host suites.

**Custom widgets now work in movy.** The library does everything except
registration; `src/renderer/schwung-widgets.ts` does that from `reload()`, when
the contract arrives. Two traps are recorded in it and in its check:

- `shadow_load_ui_module` evaluates canvas.js into MOVY'S OWN GLOBALS, so a
  script that assigns `tick` would replace movy's silently. Saved and restored,
  throwing path included.
- The registry is MODULE STATE. Importing `widget_registry.mjs` by a different
  specifier gives a second instance with its own empty map — the widget
  registers, `isWidgetAvailable` says yes, and `vizGroups()` still comes back
  empty. movy's binding re-exports the registry so there is one door.

### Modules declare their own drum rack (2026-09-04, later still)

Merged schwung main again for #411 (`pad_layout`, voices, focused voice) and
#410/#412 (param cards). 253 host suites.

**movy now learns a rack from the module, with nothing configured.** A model
served only `voice-poc`'s contract — no entry in movy's table — comes out of
`loadHierarchy` with 7 pads, a pad count the header icon follows, pad 2 playing
the declared 38, and the header naming the focused pad ("Kick", "Snare",
"Tom Lo") instead of repeating a level name that never moved.

Three things worth keeping:

- **The pads are a MAP, not a range.** voice-poc declares 36, 38, 42, 60-63.
  movy's `padNoteStart + pad - 1` reads that as 36..42 — five pads to the wrong
  voice, two to none. `DrumConfig.padNotes` carries the declared list and
  `drumNoteOfPad` consults it first; that is the single place a pad becomes a
  note, so live input, the LEDs, the engine's pad map and the load-time focus
  all follow from one change.
- **Declaration wins, movy's table is the fallback, and silence changes
  nothing.** `effectiveDrumConfig` hands back the very object it was given for
  an undeclared module — all 100 captured fleet modules. The evidence is that
  dump-replay (80 modules) and the 149 screenshot baselines did not move.
- **The reader is PUSHED into the model.** `model/` imports nothing from
  `renderer/`, so `globals.ts` hands it `surfaceOf` at start-up. With the grid
  off that is the `.off` stand-in and every module falls back, so this needs no
  flag of its own.

**Confirmed on device against voice-poc** (2026-09-04): 7-pad rack, the header's
pad minimap, and the focused pad named — `Kick` / `Snare` / `Hat` / `Tom Lo` —
with no entry in movy's table.

Both display bugs found there were the same shape: a fact that only movy's own
table could express. `isPadScoped` gated the minimap on
`moduleConfig.banks[page].padSpecific`, so the icon never drew for precisely the
modules that declare instead of being tabled; and the pad name was routed
through `bankName`, which is the PAGE label and is drawn only by the module
page, so the chain view — the view movy OPENS on — never saw it. `drumPadName`
is its own field now and both headers take it.

`src/module-configs/{6w6,8w8,9w9,cw78}.json` are now the fallback for modules
that have not declared yet. Delete each one as its module lands its
declaration. **The 9w9 installed on the device does NOT declare** (no
`pad_layout`, `focus_param` or `child_notes` in its module.json), so it still
runs on the override and shows none of this.

**Still unwired: `focus_param`.** The module names the param holding its focused
voice; movy keeps pad focus authoritative on purpose (see the note in
hierarchy.ts about the DSP's playback-drifted pad leaking in). Making them
follow each other is the "jump to pads" half and is a behaviour change, not a
translation.

**Not surfaced anywhere: which NOTE a pad plays.** The declaration has it and
`drumNoteOfPad` triggers with it, but nothing displays it.

### Two device bugs, one fixed

- **p-locks invisible** — fixed. `lastAutoView` was assigned only in the
  VIEW_KNOBS branch, so on VIEW_CHAIN (the view movy opens on) Schwung was
  rendered with a stale or absent automation view.
- **knobs "update once a second"** — NOT fixed, and not reproducible in the
  harness. Through the real app loop the value is exactly right (18 detents ->
  0.090, 1.00x movy) and the frame repaints (817 px). On the device three
  injected turns changed 0 px. It needs device evidence, not more local work.
  Note the injected turns carried no knob TOUCH note (inject-ui.py sends CC
  only), which is the first thing to rule out.

A separate, provable knob bug was fixed on the way: `knobTurn` clamped the
detent count at 32 while the shadow UI encodes up to 63, so a flick lost half
its travel (0.80x at 40, 0.51x at 63).

### Opened, merged, and where it stands (2026-09-04)

- **schwung**: the `enum_list` ctx fix is UPSTREAM — charlesvestal/schwung#415,
  squashed to main as `a6fc6235`.
- **movy**: DimaDake/schwung-movy#18, ready for review. Read-only access there;
  the merge is megadake's call and always was.
- **9w9**: athousanddetails/schwung-9W9#3 built from source (Docker cross-build)
  and installed on the device. Declares 11 voices.

**movy now builds against plain schwung `main`.** Verified by building against a
clean `origin/main` worktree: all 19 suites pass. The
`worktree-param-pages-embeddable` branch is therefore REDUNDANT — it is 3 behind
main and its only unique content was the fix that just landed. Left in place,
not deleted.

### What is actually left

Not gestures any more. The open questions are the two the measurement raised —
whether Schwung's pagination is wanted (7 of 18 pages get different parameters)
and whether the ~19.5% restyle is — plus `forge` and `signal`, for which
Schwung's planner produces NO knob page at all. That last one is a real gap and
nobody has looked at it.
