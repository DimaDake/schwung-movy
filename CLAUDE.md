# CLAUDE.md — Movy

Movy is a Schwung **tool module** (no DSP) that runs inside the shadow-UI
QuickJS context on Ableton Move. It presents the 32 pads as a piano keyboard
and exposes the active chain slot's synth parameters on the 8 knobs.

Device: `ableton@move.local`

**Plans:** Save all implementation plans to `movy/plans/` (not the repo root `plans/`).

---

## Dev loop

Run tests in this order at the end of every task:

```bash
# 1. Local (always) — pixel-diff screenshot regression
node browser-test/screenshot.mjs

# 2. Device (when reachable) — deploy + automated MIDI/log test
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && ./scripts/test.sh \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
# If offline: report DEVICE OFFLINE to the user in CAPS
```

Other useful commands:

```bash
# Build + deploy ui.js to device
./scripts/deploy.sh [move.local]

# Full automated test — deploy, open movy, inject knob CCs, check log (PASS/FAIL)
./scripts/test.sh [move.local]

# Enable unified log (once per device boot; persists until cleared)
ssh ableton@move.local 'touch /data/UserData/schwung/debug_log_on'

# Live movy log tail
ssh ableton@move.local 'tail -f /data/UserData/schwung/debug.log | grep "\[movy\]"'

# Clear log
ssh ableton@move.local '> /data/UserData/schwung/debug.log'
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

## Source architecture

All source lives in `src/` (TypeScript). The device build bundles everything into
`ui.js`; the browser test build produces `dist/esm/` (bundled entry points with
code splitting). Never edit `ui.js` directly — it is a build artifact.

### File size limits

- **Hard limit: 200 lines.** If a file exceeds this, split it.
- **Target: 50–100 lines.** One clear responsibility per file.
- The limit exists so the relevant context for any change fits in one read.

### Directory responsibilities

```
src/
  types/         Shared interfaces only — no logic, no imports from src/
    param.ts       KnobParam, ModuleConfig, KnobSlot, BankConfig
    viewmodel.ts   ViewModel, ParamVM, ToastState, OverlayState
    schwung.d.ts   Ambient globals: fill_rect, shadow_*, setLED, decodeDelta,
                   constants (Black, MovePads, …) — device globals and QuickJS os

  model/         Knob/param state machine — no display calls
    constants.ts   Tick rates, grid sizes (NAME_POLL_TICKS, KNOBS_PER_PAGE, …)
    state.ts       ModelState interface + createModelState() factory
    hierarchy.ts   loadHierarchy() — fetches ui_hierarchy + chain_params → KnobParam[]
    store.ts       applyKnobDelta(), refreshKnobValues(), pollModuleName(), formatValue()
    tick.ts        processTick() — long-press timer, delta flush, poll/refresh scheduling
    viewmodel.ts   buildViewModel() — assembles ViewModel from ModelState
    index.ts       createModel(slot) public factory — composes all model pieces

  renderer/      Pure display functions — no state, no model imports
    layout.ts      Display constants (W=128, ROW0_Y, CELL_W, …)
    header.ts      drawInvertedHeader(), drawBankBar()
    knob.ts        drawKnobWidget(), drawArcKnob(), drawEnumKnob()
    label.ts       drawLabelCell(), drawKnobRow()
    overlay.ts     drawEnumOverlay() — full-screen scrollable enum list
    knob-view.ts   renderKnobsView(vm)
    keys-view.ts   renderKeysView(moduleName, rootNote, midiNoteName)
    browse-view.ts renderBrowseView(modules, browseIndex)

  modules/       Per-synth knob layout configs
    loader.ts      loadModuleConfig(id) — tryFile override → bundled CONFIGS → null
    plaits.json    Plaits OSC/MOD bank layout
    wurl.json      Wurl WURL/FX bank layout
    *.json         Add new synth configs here as JSON files

  keyboard/      Pad note-on/off, LED colours, root-note shifting
    notes.ts       midiNoteName(), PAD_MAP[]
    state.ts       keyboardState: { rootNote, held }
    leds.ts        padLedColor()
    handler.ts     noteOn(), noteOff(), releaseAllNotes(), changeRoot()

  browser/       Module browser (scan → select → load)
    state.ts       browserState: { modules[], browseIndex }
    handler.ts     openBrowser(), loadSelectedModule()

  midi/
    router.ts      onMidiMessageInternal() — routes by status byte to all handlers

  app/           Lifecycle and global wiring
    state.ts       appState: { model, activeSlot, currentView, shiftHeld, dirty, … }
    init.ts        init() — slot detection, model creation, reset
    tick.ts        tick() — LED init batch, model.tick(), render dispatch
    globals.ts     Assigns init/tick/onMidiMessageInternal to globalThis

  font/
    glyphs.ts      G[] glyph table (pixel font rasterised at 8pt)
    index.ts       FONT_HEIGHT, fontPrint(), fontWidth()
```

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

### Build commands

```bash
npm run build          # device bundle + browser modules
npm run build:device   # src/ → ui.js (esbuild, single ESM, external: schwung shared)
npm run build:browser  # src/ → dist/esm/ (bundled entry points, code splitting)
npm run typecheck      # tsc --noEmit, zero errors required
```

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
