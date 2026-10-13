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
Old data is only ever READ (the library's copy-import, the master import),
never deleted.

Device: `ableton@move.local`

**Plans:** Save all implementation plans to `movy/plans/` (not the repo root `plans/`).

---

## Schwung page migration — standing rules

**In force until Phase 4 of `docs/schwung-page-migration.md` closes.** Schwung's
`param_pages` is becoming the only implementation of a module's parameter pages;
movy's own page renderer is being deleted. Read
`docs/schwung-page-migration.md` (the ledger) before working any `SP-*`/`SU-*`
item, and update it when you finish one. The design and its rationale are in
`docs/superpowers/specs/2026-09-13-schwung-page-migration-design.md`.

Four rules, and they bind work that is not itself a migration item:

1. **No new features in movy's page renderer.** `label.ts`, `knob.ts`,
   `envelope.ts`, the curve renderers, `lfo-wave.ts`, `model/page-layout.ts`,
   `generic-pages.ts` and `config-pages.ts` are all scheduled for deletion. Fix
   bugs there; do not grow them. A parameter-page feature belongs in Schwung's
   planner or in the movy↔Schwung seam.
2. **A change Schwung needs is an upstream PR, never a local patch.** Work
   against a fork branch, record the minimum Schwung version the feature needs,
   and file the PR in parallel — do not wait on review, and do not vendor
   `param_pages` into movy.
3. **A delegated component is never dual-driven.** If Schwung owns a
   component's pages, movy must not also page it, poll it, draw its LEDs, or
   handle its knob input. Never read `getKnobPage()` or a `knobPage` index
   directly for a component that may be delegated — go through the ownership
   accessor. Fifteen ad-hoc seam checks in `src/midi/router.ts` are how eight
   symptoms and one clip-deleting data loss arrived.
4. **One reader of a module's declared page contract** (SP-20). `ui_hierarchy`,
   `ui_pages` and `module.json`'s `capabilities.ui_hierarchy` are three ways a
   module publishes ONE thing; `src/chain/hierarchy-source.ts` is the only place
   that reads any of them. Never add a key literal or a `loadModuleJson()` call
   elsewhere — `browser-test/logic/page-owner.mjs` greps for both.

Local suites are only meaningful for this work with a schwung checkout:
`SCHWUNG=../schwung npm test`. Without it every Schwung assertion is **skipped,
not failed**.

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
- **Who writes the Set files depends on the `engpersist` flag.** Off (today's
  default) the UI ferries persisted state through the param slot and writes it
  with `host_read_file`/`host_write_file` (`src/seq/persist-store.ts`). On, the
  engine reads and writes `seq-state.json` and `chains.json` itself, atomically,
  on its own thread, and the wire carries only commands (`set open|rename|blank|
  flush`). The engine has always HAD a filesystem — `chain_copy.rs` uses it —
  and the old wording that said otherwise is what
  `docs/superpowers/specs/2026-09-11-engine-owned-persistence-design.md` undoes.
  Both halves must never write at once; that is what the flag gates.

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

**No hardware, or a fast loop before the gate:** `scripts/vdev.sh tier 3` runs
every device scenario against virtual devices (fake-SPI movy-host in colima
containers, `docs/standalone/vdev.md`) in ~2 min. It is NOT the gate: the
device tier still judges every commit.

**Run `preflight` BEFORE the item, not after it.** It is `smoke` alone (~90 s)
and it answers "is the gate I am about to be judged by green right now". Three
times in one session the tier turned out to be red for its own reasons — a
partially cold chain, a check grading the wrong window, an arm that was noted
but never asserted — and each time an item had already spent an hour before
anyone found out.

**A gate may be GREEN or RED. "It did not run" is RED.**
`npm test` now stops at `browser-test/schwung-built.mjs` when the built bundle
carries no `param_pages`: without it every delegated-page assertion prints
SKIPPED and the run still ends `ALL LOGIC CHECKS PASSED`, which is a false green
that has bitten two sessions — and `page-mode.mjs` reports every expected-fail
label as FIXED, which instructs a maintainer to delete labels that are still
failing. `SCHWUNG=` is a **BUILD-time** alias, so it must be on the build;
`ALLOW_SKIPPED=1 npm test` is the deliberate, and loud, opt-out.

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

# 1a. Local (always) — replays all 76 dumped modules; asserts layout invariants
#     + a per-module snapshot (browser-test/dump-expect.json). After an
#     intentional layout change: node browser-test/dump-replay.mjs --update
node browser-test/dump-replay.mjs

# 1b. Local (always) — full init/tick/MIDI loop → setLED (drum grid, multi-step)
node browser-test/app-loop.mjs

# 2. Local (always) — framebuffer pixel-diff vs baselines (pure node, no browser)
node browser-test/screenshot.mjs

# 3. Local (always) — performance regression (fill_rect count, IPC call count, render time)
node browser-test/perf.mjs

# 3a. Local (always) — invariants on the device scripts themselves, so a device
#     suite cannot report "missing" for a log line that is present
node browser-test/device-scripts.mjs

# 4. Device (when reachable) — the whole tier in one process. It builds and
#    deploys dsp.so FIRST, so a Rust change is the one actually under test.
#    Red → see "Device gate" below.
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && npm run test:device \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
# If offline: report DEVICE OFFLINE to the user in CAPS

# 4a. The above plus the LED restore on the way out, including on Ctrl-C.
./scripts/test-all-device.sh [move.local]
```

### Device gate

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
5. **Device unreachable → say DEVICE OFFLINE in CAPS.**

**Build system:** All source lives in `src/` (TypeScript). `npm run build:device`
bundles everything to `ui.js` via esbuild (single ESM file, no stale-module
issues). `npm run build:browser` compiles to `dist/esm/` for browser tests.
Run `node build/device.mjs` before deploying; `scripts/deploy.sh` does this automatically.

**QuickJS module cache:** movy-host evaluates `ui.js` once per start, and the ES
modules it imports (the Schwung shared `.mjs` under
`/data/UserData/schwung/shared/*`, the only externals the esbuild bundle leaves)
are cached for that movy-host's lifetime — a swapped shared file runs from the
next movy open.

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

Two docs, two granularities — read them before editing to match their voice:

- **`MANUAL.md`** — the detailed how-to. Every feature/gesture gets explained in
  its section, and every control goes in the **Controls reference** tables
  (section 8). This is where a new gesture or page is documented step by step.
- **`README.md`** — the short marketing overview. Only **headline** features get
  a one-line bullet (in *Features*) with a single screenshot. Update the chain
  description / feature list when a headline capability lands; skip minor tweaks.

**Screenshots:** add them where they help, reusing the **test baselines** so the
docs stay in sync with what the UI actually renders. If a new UI state has no
screenshot yet, add a `browser-test/screenshot.mjs` scene for it first. Then:

```bash
node scripts/make-doc-assets.mjs <baseline-name> [<baseline-name> ...]
# 4× upscales browser-test/screenshots/baseline/<name>.png → docs/assets/<name>.png
```

Reference the result as `docs/assets/<name>.png` in the Markdown.

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
  straight-line sequence of blocks over shared mock globals (which is what
  `page-mode.mjs` re-runs per arm), so splitting it is a re-architecture and not
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

`src/font/glyphs.ts` contains the pixel font as a pre-rasterised glyph table.
`FONT_HEIGHT = 5`. Glyph format: `[advance, yOff, w, h, ...rowBytes]`
with bit0 = leftmost pixel per row. The original OTF has been removed;
the glyph data in `glyphs.ts` is the source of truth.
