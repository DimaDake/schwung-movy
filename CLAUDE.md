# CLAUDE.md — Movy

Movy is a Schwung **tool module** for Ableton Move. The UI (TypeScript →
`ui.js`) runs in the shadow-UI QuickJS context; it presents the active chain
slot's synth parameters on the 8 knobs and is also a **native-Move-style
4-track step sequencer**. The sequencer's musical engine is a **Rust DSP**
(`dsp.so`) that schwung loads as the co-running overtake DSP.

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
  never abort MoveOriginal). Spec/design: `plans/2026-06-12-sequencer-*.md`.
- **UI — `src/seq/`:** `engine.ts` (the only IPC: one batched `cmd`
  set_param/tick + a `status` poll), `state.ts` (mirror), `router.ts`
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
  UI probes `ping` and re-issues the DSP load until the version matches.
- **A redeployed `dsp.so` does NOT hot-reload — the stack must restart.** The
  shim dlopens the engine by path, and glibc returns the library already loaded
  under that path for as long as MoveOriginal lives, so the version gate above
  just loops: it re-issues the load and the shim answers with the old binary.
  `deploy.sh` therefore restarts the stack whenever the shipped `dsp.so`
  differs (`--no-restart` opts out, and says loudly that the old engine is
  still running). The restart must run **as root** — MoveOriginal is root's, so
  `restart-move.sh` as the `ableton` user pkills nothing and still exits 0.
  Bumping ENGINE_VERSION once for two different builds hides this completely:
  both answer `ping` with the same string, and the stale one looks current.
- **Engine sets must be blocking** (`host_module_set_param_blocking`): the
  `overtake_dsp:` param SHM is a single slot, so non-blocking writes (and even
  schwung's own DSP-load request) are routinely lost.
- **Never scp over a dlopen'd `dsp.so` in place** — overwriting a mapped
  `.so`'s inode corrupts its pages and crashes MoveOriginal. `deploy.sh`
  ships it scp-to-temp + `mv` (fresh inode).
- Live pad notes are sounded **directly** (`shadow_send_midi_to_dsp`,
  channel = track) for zero latency; the engine only **records** them (no
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
./scripts/deploy.sh                # builds ui.js + dsp.so, deploys both (atomic .so)
npm run test:device                # device e2e, every scenario (builds + ships dsp.so and ui.js)
```

If MoveOriginal dies, recover with the davebox restart sequence (root SSH;
the user must run it): stop `move-launcher`, pkill the schwung stack, start
`move-launcher`.

---

## Dev loop

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
#    A clean run exits 0: there is no known-red check in this tier. A failed
#    scenario is retried by cause before it counts, so a red exit is real —
#    see "The device tier is a gate, and it retries itself".
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && npm run test:device \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
# If offline: report DEVICE OFFLINE to the user in CAPS

# 4a. The above plus the LED restore on the way out, including on Ctrl-C.
./scripts/test-all-device.sh [move.local]
```

### The device tier is `test-device/`

One process, one connection to the device, one report. `npm run test:device`
runs every scenario; `--scenario <name>` runs one. A clean run exits **0** —
there is no known-red check in it, and if one ever becomes permanent it is
either fixed or taken out of the sweep, never left red. A gate that is red by
design is a gate people stop reading.

The tier **builds and deploys `dsp.so` before any scenario runs**, so a Rust
change is the one actually under test. It restarts the stack only when the
bytes changed, and a failed build aborts the run instead of falling through to
the engine already on the device. `--no-engine` skips it for UI-only iteration
and says so loudly.

**New device tests go in `test-device/scenarios/`.** The bash tier is closed to
additions and `browser-test/device-scripts.mjs` enforces it — a new
`scripts/test-*.sh` fails `npm test`. The list may shrink, never grow.

What is still bash, and why:

| script | why it is still here |
| --- | --- |
| `test-seq.sh` | its scenario (`test-device/scenarios/seq.ts`) is green and in the sweep as of 2026-09-13; this is now a duplicate kept only until `scripts/lib/test-set.sh` goes. Retire it with that. |
| `test-chains.sh`, `test-cpu.sh`, `test-voice-slot.sh` | never in `MIGRATION.md`'s scope, and not in the sweep either. Migrate on next touch. |
| `test-fixture-selftest.sh` | it tests `scripts/lib/test-set.sh`, which outlives the suites: fourteen non-test scripts (`measure-*`, `bench-*`, `dev-probe`) still source it. |

### What the harness can do

Everything below is in `test-device/`; reach for it before writing anything new.

- **Gestures** — `dev.tap.cc/note/knob/jog`, `dev.hold*` for real holds,
  `dev.selectTrack`. One inject is one ssh round trip (~0.5 s), so a
  press/release pair sent as two injects is a **>500 ms hold** and movy reads it
  as a different gesture. Use the helpers; they deliver a whole gesture at once.
- **Waits** — `until(bus, what, read, pred)` and `bus.frames(n)`. Wait on the
  thing itself, in **device frames**, never on a wall clock: the tick rate
  swings 63-205 Hz with load, so any fixed sleep reading async state is a race.
  The one exception is behaviour whose SPEC is a wall clock (the jog hint's
  1 s hold) — and that check then has to defend its own timing.
- **Reads** — `probe` (movy's own ViewModel), `dev.param.get/set` (engine
  params), `dev.logLines` (debug.log, always as a before/after delta),
  `Display` (the real framebuffer, `/dev/shm/schwung-display`).
- **Engine** — `deployEngine()` (build + deploy + conditional restart),
  `restartStack()`.

### Rules that were each paid for once

- **A restart must run as root and be verified.** MoveOriginal is root, so
  `restart-move.sh` as `ableton` is EPERM, `|| true` swallows it, and the script
  exits **0** with the old engine still running (measured: pid 7515 unchanged).
  `scripts/lib/restart-stack.py` is the one body both tiers use; it fails unless
  the process actually went away and a new one came back. Never confirm a
  restart by asking whether `schwung-testd` answers — testd does not go down
  with the stack, so it answers instantly and the no-op reports green.
- **A redeployed `dsp.so` is not the running one** until that restart happens,
  and it must go to a fresh inode (`scp` to a temp name + `mv`) — overwriting a
  mapped `.so` corrupts its pages and crashes MoveOriginal.
- **`dev.selectTrack(n)` taps a group-relative track button.** There are four,
  addressing the focused group of four, so it is right only while that group is
  0. With the focus on track 9, `selectTrack(2)` selects track **10**. The
  16-track selector (hold Session + step) is not a drop-in: it commits the
  switch and stays in Session view, where the pads are the clip grid, and its
  press also runs `captureClear()` and `releaseAllLive()`.
- **Sampling a periodic value a fixed number of times asks "was I lucky".**
  Poll to a deadline instead — "did it move within 6 s" has one answer. And park
  the base mid-range first: a 0..1 param modulated at depth 0.9 from near a rail
  spends most of its cycle clamped and reads as frozen while working perfectly.
- **A `logLines` check must be a delta**, opened before the gesture. `debug.log`
  persists across runs, so an absolute read is satisfied by the last run.
- **Assert audibility, not a proxy** — the synth's real param value moving, not
  a repopulated host cache.
- **The playhead only advances with a playing clip that HAS notes** (`len>0` in
  `status`); an empty clip freezes `step`/`pos` at 0 even at `play=1`.
- **MIDI-inject to overtake drops notes and CCs unpredictably.** Build scenes
  with engine commands (`tog`/`clen`/`aset`/`clipdel`) and read `status`/`diag`
  back, rather than driving every setup gesture through the surface.
- **Never `kill -9` `shadow_ui`** — MoveOriginal does not respawn it and the
  device UI stays broken until a reboot.
- **`pgrep -f "<script>"` matches the polling loop that is waiting on it.** A
  wait written as `until ! pgrep -f "test-device/run.mjs"; do sleep 5; done`
  carries the pattern in its OWN command line, so `pgrep` keeps finding the loop
  itself: once the real process is gone the loop never exits, and a later
  `pgrep` "confirms" a tier that finished minutes ago. It cost a session a
  stalled wait and a wrong reading of what was still running (2026-09-19). Wait
  on the child's own exit (`... ; echo done` in a `run_in_background` command),
  or match something the loop does not contain — `pgrep -f "node .*test-device"`
  still matches itself, so prefer the exit status over any `pgrep` pattern.

### The fixture

`test-device/fixture.ts` (`fixture.ensure`) puts the device into the state in
`scripts/fixtures/device-set/`: plaits on track 0, a drum module on track 1,
fixed clips, a seeded automation lane. It applies the state and then **reads it
back** — a scenario never runs on unconfirmed state, which is what makes the
sweep order-independent. Tracks 1-16 are all movy chains, verified via
`chloadedlog`; the four schwung shadow slots are seeded too, as the legacy
material the `migrate` scenario pulls from. A scenario that names an instrument
must ask `fixtureSynth(track)`, never hard-code `plaits`.

Move's firmware owns set switching, so the fixture lands on whichever set is
active and the previous contents are **not** preserved.

`scripts/lib/test-set.sh` is the bash half of the same job and the two must stay
in sync by hand until the last bash suite is gone. After changing it, run
`./scripts/test-fixture-selftest.sh` — a fixture that quietly did nothing makes
every suite look clean while running on whatever the device happened to hold.

### The device tier is a gate, and it retries itself

Local suites cover correctness; the device covers integration (MIDI routing,
IPC, display). Both must be green before a commit — `npm test` (which includes
`npm run typecheck` over `test-device/`, and the harness's own host-only
selftests) and the device tier.

The tier retries a failed scenario itself, by cause, so a race and a break do
not look alike:

| outcome | what it means | what you do |
| --- | --- | --- |
| `✓` | passed first time | nothing |
| `✓` + `infra-retried` | the ssh or the socket dropped and the retry landed | nothing; the link, not movy |
| `⚠ FLAKY` | failed, then passed on the retry | exit 0, but it is **recorded**: see the ledger below |
| `✗` | failed twice | a real failure — **do not commit** |

So a red tier is a red tier. It is not "flaky, probably fine": the retry already
ran and it stayed red. Read the first line of the failure, which carries
`actual, want expected` and a path to the artifact; the evidence is already on
disk, so a second run buys nothing a `.test-out/<scenario>.md` does not.

`⚠ FLAKY` does not block the commit, but it is not free either — every flake
lands in `test-device/.flake-log.json` (last 50 runs, gitignored). `npm run
test:device -- --flakes` prints what has needed a second attempt and how often,
per scenario and per check id. A check that flakes in a few runs out of twenty
is a named race worth an issue and a fix, not a reason to distrust the tier.

`! wait near budget` is the leading indicator: a wait that resolved at ~70%+ of
its frame budget passed *this* time. It is next month's flake, and cheaper to
widen or fix now.

Only two escapes: **DEVICE OFFLINE in caps** when the device is unreachable, and
`--no-retry` for debugging one scenario (it says so on stdout, because one
attempt halves what the run means).

```bash
# Useful commands
./scripts/deploy.sh [move.local]              # build + deploy ui.js AND dsp.so
./scripts/deploy.sh --release [move.local]    # the bundle that SHIPS
npm run test:device -- --scenario smoke       # one scenario
npm run test:device -- --flakes               # what has needed a retry lately
npm run test:device -- --no-retry             # one attempt, for debugging a race
node scripts/grab-screen.mjs /tmp/shot.png    # the live screen as a PNG
ssh ableton@move.local 'touch /data/UserData/schwung/debug_log_on'   # once per boot
ssh ableton@move.local 'tail -f /data/UserData/schwung/debug.log | grep "\[movy\]"'
```

**Build system:** All source lives in `src/` (TypeScript). `npm run build:device`
bundles everything to `ui.js` via esbuild (single ESM file, no stale-module
issues). `npm run build:browser` compiles to `dist/esm/` for browser tests.
Run `node build/device.mjs` before deploying; `scripts/deploy.sh` does this automatically.

**QuickJS module cache:** `shadow_load_ui_module` re-evaluates `ui.js` fresh on
every tool open, but ES modules **imported by** `ui.js` are cached for the entire
`shadow_ui` process lifetime (shadow_ui ignores SIGTERM; SIGKILL kills it without
respawn). The esbuild bundle avoids this: all movy logic is inlined at build time,
leaving only the Schwung shared imports external (`/data/UserData/schwung/shared/*`).

**Never `kill -9` the shadow_ui process** — MoveOriginal (its parent) does not
respawn it, so the device UI breaks until a full reboot.

---

## Device tests

See **The device tier is `test-device/`** above — that section is the whole
story. `test-device/MIGRATION.md` is the recipe for moving a remaining bash
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

## shadow_ui.js MIDI contract

These facts are stable across Schwung versions. Knowing them avoids re-reading
the 16 000-line `schwung/src/shadow/shadow_ui.js`.

**Knob CC routing (CC 71–78):**
- Hardware knob turns arrive as CC71-78. The shadow UI does NOT forward them
  directly to the module.
- Instead: `overtakeKnobDelta[k] += decodeDelta(d2)` (accumulated, not
  forwarded).
- On each `tick()`, for each k where delta ≠ 0:
  ```
  ccVal = delta > 0 ? Math.min(delta, 63) : Math.max(128 + delta, 65)
  overtakeModuleCallbacks.onMidiMessageInternal([0xB0, 71 + k, ccVal])
  overtakeKnobDelta[k] = 0
  ```
- Decoded back in movy: `decodeDelta(ccVal)` from `shared/input_filter.mjs`.

**All other MIDI:**  forwarded directly as `onMidiMessageInternal(data)`.

**Guard:** the entire overtake block runs only when:
```
view === VIEWS.OVERTAKE_MODULE && overtakeModuleLoaded &&
overtakeModuleCallbacks && !overtakeInitPending
```

**Targeted greps** (instead of reading the file):
```bash
# Knob accumulation + flush:
grep -n "overtakeKnobDelta\|KNOB_CC_START" schwung/src/shadow/shadow_ui.js

# Overtake MIDI routing block start:
grep -n "OVERTAKE_MODULE\|overtakeInitPending\|overtakeModuleCallbacks.onMidi" \
    schwung/src/shadow/shadow_ui.js

# open_tool_cmd handler + shm offsets:
grep -n "open_tool_cmd\|offOpenToolCmd" \
    schwung/src/shadow/shadow_ui.js schwung/schwung-manager/shmconfig.go
```

---

## Host APIs available in JS context

```javascript
shadow_get_ui_slot()                          // → int  currently focused chain slot (0-3)
shadow_get_param(slot, "synth:ui_hierarchy")  // → JSON string or null
shadow_get_param(slot, "synth:<key>")         // → string value or null
shadow_set_param(slot, "synth:<key>", valStr) // → bool (true = IPC accepted)
shadow_send_midi_to_dsp([status, d1, d2])     // inject MIDI to active slot's DSP
host_exit_module()                            // exit movy, return to shadow UI
```

`ui_hierarchy` JSON shape (from `CLAUDE.md` in the schwung repo):
```json
{
  "levels": {
    "root": {
      "knobs": ["param_key1", "param_key2", ...],
      "params": [{"key": "param_key", "label": "Label"}, ...]
    }
  }
}
```
Param metadata (min/max/step/type) comes from `shadow_get_param(slot, "synth:chain_params")`.

---

## open_tool_cmd protocol

The only way to open a tool programmatically (the device harness does this
through `test-device/bus.ts`'s `openTool`, which is how every scenario opens and
reopens movy):

```python
import mmap, json
with open("/data/UserData/schwung/open_tool_cmd.json", "w") as f:
    f.write(json.dumps({"file_path": "/", "tool_id": "movy"}))
with open("/dev/shm/schwung-control", "r+b") as f:
    mm = mmap.mmap(f.fileno(), 0)  # use 0 — file is 64 bytes, explicit size fails
    mm[56] = 1                     # offOpenToolCmd = 56 (shmconfig.go)
    mm.close()
```

---

## Known gotchas

**Pad range overlaps knob CC range.**  
Pad note range is `d1 = 68–99`. Knob CC range is `d1 = 71–78` (inside pads).
In `onMidiMessageInternal`, the pad handler must `return` only inside the
`note-on` / `note-off` branches — not unconditionally. If `return` is at the
bottom of the pad block, CC71-78 are silently swallowed before the knob handler
runs.

**`mmap` size on `/dev/shm/schwung-control`.**  
The shm file is 64 bytes. `mmap.mmap(f.fileno(), 256)` raises
`ValueError: mmap length is greater than file size`. Always use `mmap(f, 0)`.

**`decodeDelta` for re-encoded knob CCs.**  
The shadow UI re-encodes accumulated deltas: 1-63 = clockwise, 65-127 =
counter-clockwise. `decodeDelta` from `shared/input_filter.mjs` handles this.
Do not treat the raw `d2` value as a delta directly.

---

## Font

`src/font/glyphs.ts` contains the pixel font as a pre-rasterised glyph table.
`FONT_HEIGHT = 5`. Glyph format: `[advance, yOff, w, h, ...rowBytes]`
with bit0 = leftmost pixel per row. The original OTF has been removed;
the glyph data in `glyphs.ts` is the source of truth.
