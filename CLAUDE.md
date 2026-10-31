# CLAUDE.md — Movy

Movy is a **standalone** Schwung tool module for Ableton Move (since plan
WP8, `plans/2026-10-09-standalone-migration.md`): `module.json` says
`"standalone": true` and carries a `boot_target`. Opening it runs `standalone`
(`standalone/launch.sh`), which starts **`movy-host`** (`host/`, C, built from
schwung's C libraries at the pinned tag) in place of Move's software. movy-host
owns SPI, audio, display, LEDs and the power button, runs the UI (TypeScript →
`ui.js`) in its own QuickJS, and loads the **Rust engine** (`dsp.so`) through
`plugin_api_v2`. Design: `docs/standalone/movy-host.md`. Two doors run one
body: the Tools menu (schwung's `launch-standalone.sh`) and the boot picker
(`standalone/boot-entry.sh` → `standalone --boot`; movy-host then hands the
device to Schwung on a quit instead of exiting, `host/handover.h`).

WP9 deleted the overtake code: movy-host is the only host, and
`src/platform/standalone.ts` is the only file that names its globals
(`browser-test/source-rules.mjs` Rule 3; Rule 4 ratchets `typeof` gates at 0).
Old data is only ever READ (the one set migration, `set_migrate.rs`),
never deleted.

Device: `ableton@move.local`

**Plans:** Save all implementation plans to `movy/plans/` (not the repo root `plans/`).

---

## Schwung param pages — standing rules

Schwung's `param_pages` is the only implementation of a module's parameter
pages; movy's own renderer was retired 2026-10-13 (tag `movy-pages-final`,
`docs/movy-pages-knowhow.md`). `docs/schwung-page-migration.md` is the ledger
of how it got here. Three rules:

1. **A parameter-page feature belongs in Schwung's planner or in the
   movy↔Schwung seam**, never in a movy-drawn cell.
2. **A change Schwung needs is an upstream PR, never a local patch.** movy
   ships Schwung's JS (`param_pages` and what it imports) byte-for-byte from
   the PINNED tag (`scripts/build-schwung-js.sh` → `tools/movy/schwung/`,
   `plans/2026-10-13-pin-schwung-js.md`) and never edits that copy. Work
   against a fork branch, file the PR in parallel — do not wait on review —
   and the change reaches movy by bumping `scripts/lib/schwung-pin.sh` once it
   is in a tag. The local suites run the same pinned bytes.
3. **One reader of a module's declared page contract** (SP-20). `ui_hierarchy`,
   `ui_pages` and `module.json`'s `capabilities.ui_hierarchy` are three ways a
   module publishes ONE thing; `src/chain/hierarchy-source.ts` is the only place
   that reads any of them. Never add a key literal or a `loadModuleJson()` call
   elsewhere — `browser-test/logic/page-owner.mjs` greps for both. And every
   seam point asks `pageOwnerOf` (`src/app/page-owner.ts`) which page is under
   the knobs.

The local suites need the schwung repo for the pinned tree: `../schwung` by
default, or `SCHWUNG=/path`.

---

## Context discipline

A tool call is a full model turn — the whole conversation gets re-sent on
every one — so round-trip *count* is the cost, not output size. Optimize for
fewer calls, not smaller ones.

- **Batch independent shell calls into one message.** Firing them one at a
  time pays a full round trip each even when none depends on another's
  result.
- **Device work: one `ssh` round trip, not three.** The clear-log → act →
  check-log cycle run as three separate `ssh ableton@move.local` calls is the
  single most common device pattern in this repo's session history. Use
  `scripts/dev-probe.sh log` instead — it clears the log, optionally injects a
  MIDI event, polls for the pattern, and dumps matching lines inside one ssh
  call. `scripts/dev-probe.sh status` does the same for reachability + deployed
  `ui.js` md5 + log-enabled state.
- **Grep or read a line range before reading a whole file.** `Read` on an
  entire file is the most expensive call type per-invocation in this repo. If
  you're hunting one symbol, `grep -n` it first and read just that range.

---

## Sequencer (engine + UI)

The sequencer spans two layers; keep musical truth in the engine and only a
mirror in the UI.

- **Engine — `engine/` (Rust workspace):** `seq-core` (pure logic: clock,
  clips/notes, scheduler, recording, sessions, persistence — host-testable
  with `cargo test`) + `movy-dsp` (`cdylib` → `dsp.so`, implements schwung's
  `plugin_api_v2`; every FFI entry point catches panics so an engine bug can
  never abort movy-host). Spec/design: `plans/2026-06-12-sequencer-*.md`.
- **UI — `src/seq/`:** `engine.ts` (the only IPC: one batched `cmd`
  set_param/tick, and status read from movy-host's per-block snapshot,
  parsed in `engine-status.ts`), `state.ts` (mirror), `router.ts`
  (first-look MIDI dispatch — sequencer events never touch the param-page
  handlers) with `router-steps.ts` / `router-pads.ts` / `router-buttons.ts`
  holding the three halves it dispatches to (the step row, pads + held chord,
  and the modal/edit buttons; transport, encoders and arrows stay in
  `router.ts`, which also re-exports the others' public surface so callers keep
  one import site), `leds.ts`/`session.ts`/`render.ts` (cached LEDs, clip grid,
  Loop Overview strip), plus `loop-mode.ts`, `step-edit.ts`, `edit-ops.ts`,
  `pads.ts`, `persist.ts`, `colors.ts`, `constants.ts`.

### Hard rules (learned on device — do not relearn)

- **ENGINE_VERSION must match** between `engine/crates/movy-dsp/src/lib.rs`
  and `src/seq/constants.ts` (`build-dsp.sh` fails the build otherwise). The
  UI asks `ping` once at boot: another version is `ENGINE MISMATCH` (a dsp.so
  and ui.js from different builds), and there is no reload loop — movy-host
  loads its dsp.so before ui.js and never reloads it.
- **A redeployed `dsp.so` runs from the next movy OPEN, not before.** movy-host
  loads `dsp.so`, `ui.js` and `chain-host.so` when it starts; a movy-host that
  is running keeps what it started with (`deploy.sh` says so loudly). "Restart
  the stack" is now "restart movy-host" — close and reopen movy (the harness's
  `restart()`); no Move restart, no root. Bumping ENGINE_VERSION once for two
  different builds still hides a stale engine: both answer `ping` alike.
- **Engine sets are queued, never waited on** (`src/host/param.ts`, the one
  door): movy-host's param queue is FIFO and loses nothing, so a write returns
  at once and `false` means only "no engine". Gets still wait for the next
  frame boundary; status is not a get — it is the audio thread's per-block
  snapshot (`host/status_snap.c`). `engine` `status` must stay a PURE read:
  movy-host calls it every block, so a field it drained (as `unop` once was)
  would reach a snapshot the UI might never see. (WP10; the overtake host's
  single-slot SHM, the `#<seq>` resend dedupe and the refusal counters are
  gone.)
- **Never scp over a dlopen'd `dsp.so` (or a running `movy-host`) in place** —
  overwriting a mapped file's inode corrupts its pages. `deploy.sh` ships
  scp-to-temp + `mv` (fresh inode); the store's atomic install does the same.
- Live pad notes are sounded **directly** through the track's port
  (`ch<N>:midi`) for zero latency; the engine only **records** them (no
  double trigger). Recorded notes are suppressed until the clip wraps.
- **Note-offs come from the ledger, never from current state.**
  `keyboard/held-notes.ts` records `padNote → { track, pitch }` at note-on;
  `noteOff`/`drumPadOff` take neither a track nor a `DrumConfig`. Deriving
  either at release time strands notes whenever the active track, module, or
  view changed mid-hold. All `0x8n` sends go through `release.ts:emitNoteOff`.
  `app/unload.ts` (`globalThis.onUnload`, called by the host on *every*
  teardown) releases the ledger plus the engine's open gates read from
  `seqState.activeNotes` — the DSP is unloaded right after, so nothing else
  can close them.
- **The engine writes the Set files; the UI writes only `ui-state.json`.** The
  engine reads and writes `seq-state.json`, `chains.json` and the version
  history itself, atomically, on its own thread, and the wire carries only
  commands (`set open|rename|blank|restore|keep|flush`). The UI never reads
  `state` back (the read clears the engine's dirty flag) and never writes the
  state file — two writers of one Set is the hazard
  `docs/persistence-hazards.md` records. It does not READ the state file
  either: a Set whose files will not parse is the engine's answer (`sbad=<uuid>`
  in the status). Chains are restored only from `chains.json`; `ui-state.json`
  carries no copy. The `engpersist` flag that once kept a UI-writer fallback
  is gone (2026-10-17).

### PErformance

PErformance is very important, make sure you think about it for implementation and add new and run existing performance tests for the new features


### Cost efficient usage

if you are opus or fable 5 try to optimize token usage and make it cost efficient while make sure the code is reviewed by you. if there is an option to use subagent, use it only if it reduces limit usage

### Build / deploy / test the engine

```bash
cd engine && cargo test            # pure seq-core logic (host)
./scripts/build-dsp.sh             # cross-compile aarch64 → dist/dsp.so (glibc <= 2.35)
./scripts/deploy.sh                # builds ui.js + dsp.so + movy-host, deploys to tools/movy (fresh inodes)
bash host/tests/run.sh             # movy-host unit tests + the boot-door test (in npm test); scripts/test-host-linux.sh under glibc
npm run test:device -- --scenario smoke   # one scenario (docs/standalone/movy-host.md)
npm run test:device                # device e2e, every scenario (builds + ships dsp.so, movy-host, ui.js)
./scripts/build-module.sh          # the store tarball (release build: MOVY_RELEASE=1, no UI_EVAL)
```

If movy-host wedges, the fallback exit (Shift + volume touch + jog click)
gives the device back to Move (or, at the boot door, to Schwung). From the
Tools menu a `kill` (TERM) does the same. **At the boot door a TERM is a STOP**
(rc 5, nothing starts, MoveLauncher shows "Move crashed"): recover with
`/etc/init.d/move stop; /etc/init.d/move start` as root. Never `kill -9` it at
the boot door: that pid is MoveLauncher's child, and only movy-host's own exit
path hands over.

---

## Dev loop

**One command, in the foreground, with one verdict: `./scripts/run-gate.sh`.**

```bash
./scripts/run-gate.sh preflight   # BEFORE starting an item: is the device gate itself green?
./scripts/run-gate.sh local       # build + every local suite
./scripts/run-gate.sh device      # the full tier
./scripts/run-gate.sh both        # local, then device
```

It finds the schwung checkout and exports `SCHWUNG=` for the BUILD (the trap
below), prints a heartbeat every 30 s so a live run cannot be mistaken for a
dead one, and ends with `VERDICT: GREEN` / `RED` / `DEVICE OFFLINE`. Two
sessions have ended a turn "waiting on the sweep" when the sweep was already
dead; a command that has not returned cannot be mistaken for one that has.

**Run `preflight` BEFORE the item, not after it.** It is `smoke` alone (~90 s)
and it answers "is the gate I am about to be judged by green right now". Three
times in one session the tier turned out to be red for its own reasons — a
partially cold chain, a check grading the wrong window, an arm that was noted
but never asserted — and each time an item had already spent an hour before
anyone found out.

**A gate may be GREEN or RED. "It did not run" is RED.** The browser build
resolves Schwung's JS to the pinned tag's tree, so it fails outright without the
schwung repo rather than testing a stub.

Run tests in this order at the end of every task:

Run `npm run build:browser` first (refreshes `dist/esm`), then in order
(or just `npm test`, which builds + runs all eight local suites — the six below
plus `track-colors.mjs` and `abi-parity.mjs`):

```bash
# 1. Local (always) — viewmodel/business logic assertions
# logic.mjs is only a RUNNER. The suites live in browser-test/logic/<subsystem>.mjs
# — add a test by editing the matching subsystem module, never the runner. A new
# subsystem needs a new module plus one line in each of the runner's two lists.
# browser-test/logic/harness.mjs is the shared kit and must stay the runner's
# first import: it installs the mock globals and owns the single failure counter,
# so new shared imports go in its preamble + export list, not per-suite.
node browser-test/logic.mjs

# 1b. Local (always) — full init/tick/MIDI loop → setLED (drum grid, multi-step)
node browser-test/app-loop.mjs

# 2. Local (always) — framebuffer pixel-diff vs baselines (pure node, no browser)
node browser-test/screenshot.mjs

# 3. Local (always) — performance regression (fill_rect count, IPC call count, render time)
node browser-test/perf.mjs

# 3a. Local (always) — invariants on the device scripts themselves, so a device
#     suite cannot report "missing" for a log line that is present
node browser-test/device-scripts.mjs

# 4. Integration — "Which tier gates" below picks one. Both build and deploy
#    dsp.so FIRST, so a Rust change is the one actually under test.
scripts/vdev.sh tier 3                  # default: the virtual device, red → fix
# Real device, REQUIRED for releases and hardware-bound work. Red → "Device gate".
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && npm run test:device \
  || echo "DEVICE OFFLINE — DEVICE TIER NOT RUN"
# Required but offline: report DEVICE OFFLINE to the user in CAPS; not done.

# 4a. The above plus the LED restore on the way out, including on Ctrl-C.
./scripts/test-all-device.sh [move.local]
```

### Which tier gates

Two integration tiers run the same scenarios through the same transport: the
**virtual device** (`scripts/vdev.sh tier 3`, fake-SPI movy-host in colima
containers, ~2 min, `docs/standalone/vdev.md`) and the **real device**
(`./scripts/run-gate.sh device`, ~9 min).

**The virtual device gates by default.** A red vdev tier is fixed, never
loaned: KNOWN-RED.md is the device's ledger only. Before trusting it, the
snapshot only supplies what movy does not ship: the modules (third-party,
from the store, not schwung's) and schwung's door scripts. movy's own schwung
JS and chain host are pinned and deployed into it like onto the box. A module
update needs no device tier, only a re-snapshot (`vdev.sh snapshot && vdev.sh
image`), so the vdev runs the same module builds the box does; a pin bump is
vdev-gated too, since the vdev runs the pinned C and JS natively.

**The real device tier is REQUIRED — green, or fixed until it is — for:**

- **every release** (`docs/RELEASING.md` step 6), whatever the vdev says;
- **audio, SPI and timing:** `host/spi.c`, `audio.c`, `frame_*`, `rt.c`,
  `placement.c`, the render pool / chain scheduling, anything the audio thread
  runs, MIDI latency;
- **performance and CPU:** any `perf_*`, CPU-meter or `measure-*` claim (vdev
  shares 4 vCPUs between shards, without RT priority);
- **the doors and the box's lifecycle:** `standalone/launch.sh`,
  `boot-entry.sh`, `host/handover.*`, `power.*`, `signals.*`, the boot target,
  harness launch/hold logic in `transport-standalone.ts` — and once after the
  device's installed schwung changes, since these doors (its
  `launch-standalone.sh`, boot targets, `schwung-entry.sh`) are all movy still
  takes from it;
- **what the container stands in for:** LEDs and the display on glass, the
  hardware MIDI path, uid/permission and file ownership (root vs ableton),
  store install/update paths, Move round trips;
- **anything the work itself says only hardware can prove**, or a vdev-only
  red/green you cannot explain.

**A bug reported on the device is not, by itself, a device-tier trigger.**
What decides is what the FIX touches, not where the bug was seen. A fix in
pure UI logic (repaint decisions, page planning, view state) that a local
test reproduces and that touches nothing on the list above is gated by the
vdev tier and then deployed, and no device run is needed. The device tier is
required only when the fix itself is in one of the areas above, or the bug
could not be reproduced off the device.

Say in the commit message which tier gated the change.

**Run only what the change can actually break (user, 2026-10-30).** Size
the gate to the risk, not to the file list above. The list says *which tier*
can see a change; it does not demand the whole tier.

- **Device tier: scoped by default.** Run `smoke` plus the scenarios that
  exercise the changed behaviour (`npm run test:device -- --scenario
  power,smoke`; a power-off path → `power`, send routing → `sends`, frame
  stats → `testbus`). A change to a file every scenario passes through (the
  audio thread, SPI, `midi_in`/`midi_out`) still only needs a scoped run when
  the change cannot alter what those paths do: added logging or counters, a
  measurement, a branch that runs only on an error path. `smoke` proves the
  path still runs. Name the scenarios in the commit message (`device tier:
  testbus,smoke`) with one line on why that is enough.
- **The full device tier** is for releases, schwung version moves, changes to
  the harness or fixture themselves, and changes that really do alter shared
  behaviour (timing, scheduling, routing, launch/hold).
- **The vdev tier** is not needed when a scoped device run already covers the
  change. Run it when the change reaches integration behaviour (MIDI routing,
  IPC, display, persistence) and no device run is planned.
- **Code changes with no integration surface** (pure engine logic, a script, a
  log line covered by a unit test) need only the local suites, plus `smoke` if
  the change ships in movy-host or dsp.so.

**Deploy at the end of every code change, even a vdev-gated one.** Once the
gate is green: `ssh -o ConnectTimeout=3 ableton@move.local true &&
./scripts/deploy.sh`, so the box always runs the latest build and anything
the vdev cannot see shows up in real use. A deploy is not a gate: say "deployed,
not device-tested" when the device tier was not run. If movy is open there,
`deploy.sh` says so: it runs the new build from the next open. Unreachable →
say so (DEVICE OFFLINE, in CAPS) in the report.

### Device gate

When the device tier is required (**Which tier gates** above):
`npm run test:device` (or `./scripts/run-gate.sh device`). Detail — harness
API, fixture, retries, flake ledger, rules learned on device — is in
`test-device/README.md`; read it before writing or debugging a scenario.

1. **Green, or `⚠ FLAKY`** (passed on the tier's own retry): commit. Say so if FLAKY.
2. **Red: re-run just those scenarios once** — `npm run test:device -- --scenario a,b`.
   Green now → it was device state, not a bug; say so and move on.
3. **Still red → fix it.** If it is shown to predate your change (red on the
   pre-change build, or the change provably not reaching the device), you may
   commit past it **only by adding a row to `KNOWN-RED.md`**. A row older than
   2 days turns the tier red until it is fixed or the user extends it.
4. **Before a gate run, the device must be clean:** restart the stack after
   anything that churns modules (`dump-modules.sh` now does it itself). When the
   tier prints `SCHWUNG CHANGED`, re-check what movy still takes from the
   installed schwung (shared JS, chain modules) before suspecting movy.
5. **Device unreachable → say DEVICE OFFLINE in CAPS.** Work that requires
   the device tier is then not done, and a release does not ship.

**Build system:** All source lives in `src/` (TypeScript). `npm run build:device`
bundles everything to `ui.js` via esbuild (single ESM file, no stale-module
issues). `npm run build:browser` compiles to `dist/esm/` for browser tests.
Run `node build/device.mjs` before deploying; `scripts/deploy.sh` does this automatically.

**Schwung's JS is pinned, not the device's.** ui.js imports
`/data/UserData/schwung/{shared,shadow}/*` (the only externals the esbuild
bundle leaves), and movy-host resolves every such import to the copy movy
ships, `tools/movy/schwung/`, built from the pinned tag (`host/module_path.c`;
the first log lines say `schwung js pinned at <tag>`). The installed schwung's
copy is never read, so a schwung upgrade on the device does not change movy's
pages; a pin bump does. QuickJS caches the modules for that movy-host's
lifetime: a redeployed copy runs from the next movy open.

---

## Device tests

See **Device gate** above for the rules and `test-device/README.md` for the
rest. `test-device/MIGRATION.md` is the recipe for moving a remaining bash
suite across, including when to stop and escalate;
`test-device/MIGRATION-STATUS.md` is where each one stands. A retired script is
deleted in the same commit as the scenario that replaces it.

`docs/persistence-hazards.md` records what the migration turned up about saving
and restoring Sets: two bugs fixed, two open and pinned by tests. Read it before
touching `set-save.ts`, `set-load.ts` or `ui-state.ts`.

## Releasing

`docs/RELEASING.md` is the procedure — changelog reconciliation, the version
and `ENGINE_VERSION` bumps, doc assets, gates, the store-path verification, and
when the upstream catalog needs a PR.

Every release ships an announcement at `docs/discord-v<X.Y.Z>.md`, capped at
Discord's 2000 characters. `scripts/build-module.sh` refuses to build the
tarball without it, so it gets written while the release is still being
prepared rather than after it is already public.

## Documentation

**Update the user docs for any significant, user-facing change** — a new
feature, page, gesture, control, or a behaviour change a user would notice. Part
of the task, like tests and the commit. (Purely internal/dev-only changes —
refactors, test infra, perf fixes with no visible effect — don't need doc
edits.)

Two places, two granularities — read them before editing to match their voice:

- **The website, `site/`** (MkDocs Material, `mkdocs.yml`, published to
  <https://dimadake.github.io/schwung-movy/> by `.github/workflows/pages.yml`)
  is the manual. A feature or gesture goes in its chapter under `site/manual/`;
  every control also goes in `site/reference/controls.md`. Write it the way an
  instrument manual does: what to press, what you see (a screenshot or
  diagram), and one musical use only where it is real and obvious. **No design
  rationale, internals, timing numbers or history** — those belong in `docs/`
  and `plans/`. Behaviour that is identical to Move's own firmware goes inside a
  collapsed `??? move "Works like Move: …"` block so a Move owner can skip it.
- **`README.md`** — the short landing page. Only **headline** features get a
  bullet. `MANUAL.md` is only a pointer to the website now; do not grow it back.

**Images.** Screens are the **test baselines**, so the site shows what the UI
really draws: reference `assets/screens/<baseline>.png` in a page (add a
`browser-test/screenshot.mjs` scene first if the state has none). Diagrams —
the Move panel with LED states, pad layouts, step-row maps, the signal flow —
are generated from movy's own source in `scripts/site/figures.mjs`. Then:

```bash
node scripts/site/build-assets.mjs          # exports referenced screens 4x + regenerates diagrams
node scripts/site/build-assets.mjs --check  # (in npm test) fails if anything is stale
pip install -r scripts/site/requirements.txt && mkdocs serve   # preview at :8000
```

After `screenshot.mjs --update`, rerun `build-assets.mjs` or `npm test` fails.

---

## Source architecture

All source lives in `src/` (TypeScript). The device build bundles everything into
`ui.js`; the browser test build produces `dist/esm/` (bundled entry points with
code splitting). Never edit `ui.js` directly — it is a build artifact.

### File size limits

- **Hard limit: 200 lines.** If a file exceeds this, split it.
- **Target: 50–100 lines.** One clear responsibility per file.
- The limit exists so the relevant context for any change fits in one read.
- **`browser-test/` is covered too, at a looser ~600-line ceiling** (a suite is
  one coherent subsystem, so 200 would shred it). It was exempt by omission,
  and `logic.mjs` quietly reached 12,620 lines — 63× the src limit — becoming
  the most-edited and most-expensive-to-read file in the repo.
- **`test-device/` gets the same ~600-line ceiling as `browser-test/`, for the
  same reason.** Scenarios run 273–583 lines (`mutes.ts` 583,
  `module-contract.ts` 518, `migrate.ts` 484) — one suite is one coherent
  subsystem. Said explicitly rather than left to inference.
- **`browser-test/app-loop.mjs` is a named EXCEPTION at 3560 lines** — 5.9× the
  ceiling, recorded 2026-09-19 so the next agent is not blocked finding it. It is
  PRE-EXISTING and it is not what the ceiling is about: the file is one
  straight-line sequence of blocks over shared mock globals, so splitting it is a
  re-architecture and not
  a tidy-up. The 2026-09-19 branch added +306 lines to it, all real coverage
  (SP-31's two latch checks and SP-37's label checks). **What it costs is the
  read**: after `logic.mjs`'s history it is the most expensive file in the repo
  to open, so the next change that needs to understand it should split the
  SP-31/SP-37 blocks into a sibling module first — the exception is for the
  file as it stands, not a licence to keep growing it.

### Directory responsibilities

Run `ls src/` for the current layout — the boundaries below are what matters.

### Key boundaries

- **`model/` never calls display functions** (`fill_rect`, `clear_screen`, `fontPrint`).
  Renderers read a `ViewModel`; they never touch `ModelState`.
- **`renderer/` has no state.** Every render function is pure: same inputs → same
  pixels. State lives in `model/` and `app/state.ts`.
- **`src/types/` has no imports from the rest of `src/`.** Other files import from
  types; types never import back.
- **Module configs are JSON files** in `src/modules/*.json`. Add a new synth by
  dropping a JSON file there and registering it in `loader.ts`. The schema matches
  `ModuleConfig` in `src/types/param.ts`.

### Adding a new synth config

1. Create `src/modules/<id>.json` following the `ModuleConfig` shape.
2. In `src/modules/loader.ts`, add an import and register in `CONFIGS`.
3. Run `npm run build:device` — the JSON is bundled in automatically.

---

## movy-host's JS surface

The globals movy calls are declared in `src/platform/host-globals.d.ts` and
registered by `host/globals*.c`; `browser-test/host-globals.json` is the
manifest (`SCHWUNG=../schwung node scripts/host-globals.mjs --write`) and
`browser-test/host-globals.mjs` proves movy-host answers every entry. The
callbacks movy-host calls into ui.js are `init`, `tick`,
`onMidiMessageInternal`, `onUnload` and `onPowerButton` (`src/app/globals.ts`).
Design: `docs/standalone/movy-host.md`; the device harness's bus:
`docs/standalone/testbus.md`.

**Knob CCs 71–78 arrive accumulated:** movy-host sums a tick's detents and
re-encodes them (`host/deltas.c`): 1-63 = clockwise, 65-127 =
counter-clockwise. Decode with `decodeDelta` (`shared/input_filter.mjs`); never
treat the raw `d2` as a delta.

---

## Known gotchas

**Pad range overlaps knob CC range.**  
Pad note range is `d1 = 68–99`. Knob CC range is `d1 = 71–78` (inside pads).
In `onMidiMessageInternal`, the pad handler must `return` only inside the
`note-on` / `note-off` branches — not unconditionally. If `return` is at the
bottom of the pad block, CC71-78 are silently swallowed before the knob handler
runs.

---

## Font

`src/font/glyphs.ts` is Schwung's param-page font (`font4x5.mjs`, the
"Elektron" letterforms), so movy's chrome and the Schwung pages draw one
alphabet. It is GENERATED: `node scripts/gen-font-from-schwung.mjs <path to the
PINNED tag's font4x5.mjs>` (a bump of `schwung-pin.sh` may redraw letters —
`browser-test/logic/font-parity.mjs` fails on drift). `FONT_HEIGHT = 5`,
uppercase only (`index.ts` folds lowercase), the 1px gap is inside each
advance. Glyph format: `[advance, yOff, w, h, ...rowBytes]`, bit0 = leftmost.
`; $ @ [ ] { } | ~` and the backtick are movy's own additions (`G4_EXTRA`),
because font4x5 draws nothing for them. The 3×5 enum-square face
(`glyphs5x3.ts`) and the Nokia big-value face are separate and unchanged.
