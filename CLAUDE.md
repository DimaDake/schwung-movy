# CLAUDE.md — Movy

Movy is a Schwung **tool module** for Ableton Move. The UI (TypeScript →
`ui.js`) runs in the shadow-UI QuickJS context; it presents the active chain
slot's synth parameters on the 8 knobs and is also a **native-Move-style
4-track step sequencer**. The sequencer's musical engine is a **Rust DSP**
(`dsp.so`) that schwung loads as the co-running overtake DSP.

Device: `ableton@move.local`

**Plans:** Save all implementation plans to `movy/plans/` (not the repo root `plans/`).

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
- The engine has no filesystem; the UI ferries persisted state via
  `host_read_file`/`host_write_file` (`src/seq/persist.ts`).

### PErformance

PErformance is very important, make sure you think about it for implementation and add new and run existing performance tests for the new features


### Cost efficient usage

if you are opus or fable 5 try to optimize token usage and make it cost efficient while make sure the code is reviewed by you. if there is an option to use subagent, use it only if it reduces limit usage

### Build / deploy / test the engine

```bash
cd engine && cargo test            # pure seq-core logic (host)
./scripts/build-dsp.sh             # cross-compile aarch64 → dist/dsp.so (glibc <= 2.35)
./scripts/deploy.sh                # builds ui.js + dsp.so, deploys both (atomic .so)
./scripts/test-seq.sh              # device e2e: transport, steps, record, session, persistence
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

# 4. Device (when reachable) — deploy + automated MIDI/log test + perf timing
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && ./scripts/test.sh \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
# If offline: report DEVICE OFFLINE to the user in CAPS

# 4b. Every device suite at once (each one is independent — any subset, any order)
./scripts/test-all-device.sh [move.local]
```

### Device tests run against a fixture state

Every device script starts with `test_set_begin` (from `scripts/lib/test-set.sh`),
which puts the device into the known state in `scripts/fixtures/device-set/`:
plaits on track 0, a drum module on track 1, fixed clips, and a seeded
automation lane. It applies the state and then **reads it back** — a suite never
runs on unconfirmed state. Move's firmware owns set switching, so the fixture is
applied to whichever set is active; the previous contents are not preserved.

This is what makes the suites order-independent. Before it, `test-unload.sh`
deleted the clip `test-reselect.sh` needed, and step presses toggled whatever a
previous run had left.

On the way out, every suite restarts the Move stack (`test_set_end`, trapped on
`EXIT INT TERM`). Device tests leave movy open in overtake owning the LEDs and
suppressing Move's own LED writes, so without the restart the pads and step
buttons stay dark afterwards and the hardware looks broken. It costs ~10 s;
`test-all-device.sh` suppresses the per-suite restarts and does one at the end.

**Writing a device test:** source the library, call `test_set_begin`, add
`trap test_set_end EXIT INT TERM`, and use
`ts_tap_cc` / `ts_tap_note` / `ts_tap_two_steps` for gestures. Each inject is
its own ssh round trip (~0.5 s), so a press/release pair driven as two injects
is a >500 ms hold — long enough that movy reads it as a different gesture (a
held step becomes an automation hold that enters no note; a held track button is
momentary and reverts on release). The helpers deliver a whole gesture in one
device-side script. See `scripts/fixtures/README.md` for the fixture format and
the device behaviours it works around.

Other useful commands:

```bash
# Build + deploy ui.js to device
./scripts/deploy.sh [move.local]

# Same, but the bundle that SHIPS — the Settings page then lists only the two
# flags marked `release`. ui.js reloads on tool OPEN, so reopen movy to see it.
./scripts/deploy.sh --release [move.local]

# Full automated test — deploy, open movy, inject knob CCs, check log (PASS/FAIL)
./scripts/test.sh [move.local]

# Device e2e: step automation stays audible after a real module reselect
./scripts/test-reselect.sh [move.local]

# Device e2e: the bottom CLICK JOG hint only appears after a ~1 s jog hold
# (asserts on the real framebuffer's toast band, not the log)
node scripts/test-jog-hint.mjs [move.local]

# Device e2e: closing Movy mid-sequence releases every sounding note.
# Fills all 16 steps first — one note on one step is silent for most of the
# loop, so a teardown sampled at random would find no open gate and prove
# nothing. Asserts '[movy] unload: released N' with N > 0.
./scripts/test-unload.sh [move.local]

# Capture the device's live screen as a PNG — verify what the Move actually
# shows instead of inferring it from log lines. Drive the UI with
# ../schwung-midi-inject-ui.py first (cc 40-43 tracks, cc 3 jog click,
# cc 14 jog turn, cc 71-78 knobs), then grab.
node scripts/grab-screen.mjs /tmp/shot.png [move.local] [scale]

# Enable unified log (once per device boot; persists until cleared)
ssh ableton@move.local 'touch /data/UserData/schwung/debug_log_on'

# Live movy log tail
ssh ableton@move.local 'tail -f /data/UserData/schwung/debug.log | grep "\[movy\]"'

# Clear log
ssh ableton@move.local '> /data/UserData/schwung/debug.log'
```

### Device-test harness gotchas

- Playhead only advances with a **playing clip that has notes** (`len>0` in
  `status`); an empty clip freezes `step`/`pos` at 0 even when `play=1`.
- MIDI-inject to overtake is device-state-flaky (notes vs CCs drop unpredictably),
  so **build test scenes with engine commands** via `seqCmd`: `tog`/`clen`/`aset`/
  `clipdel`; read `status`/`diag` via `host_module_get_param`.
- Verify **audibility** (the synth's real param value moving), not a proxy like a
  repopulated host cache. Full context: automation-reselect fix + engine-command
  method are in `CHANGELOG.md` and the session's `project_reselect-synthparams-cache` note.

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

The only way to open a tool programmatically (used by `scripts/test.sh`):

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
