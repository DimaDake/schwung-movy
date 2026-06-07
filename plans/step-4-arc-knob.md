# Movy Step 4 — Arc Knob Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hollow-box placeholder knobs with arc knobs (float/int) and solid-square enum indicators, wire capacitive touch events to show a full-name toast in the header.

**Architecture:** All rendering logic lives in `ui.js` (inlined, re-evaluated fresh on each tool open — see CLAUDE.md). Browser tests use `view/renderer.mjs` and `view/model.mjs` as canonical split files; both must mirror changes made to `ui.js`. The ViewModel gains a `toast` field. The model gains `handleKnobRelease()`.

**Tech Stack:** QuickJS ES modules (device), plain HTML5 Canvas (browser tests), `fill_rect` pixel drawing (no line/arc primitives — arcs are rasterized by sampling sin/cos).

---

## Background

Steps 1–3 complete. Current state:
- `ui.js` — single inlined file: model + renderer + module configs (avoids QuickJS module cache issues)
- `view/model.mjs` / `view/renderer.mjs` — canonical sources for browser tests; must stay in sync with `ui.js`
- All tests pass: `./scripts/test.sh` (device) and `node browser-test/screenshot.mjs` (browser)
- Knobs currently render as hollow 10×10 boxes (`_drawKnobCell`)
- Touching a knob: `handleKnobTouch(k)` exists but capacitive NoteOn events (d1 < 10) are **discarded** in `onMidiMessageInternal`
- No `toast` field in ViewModel; no `handleKnobRelease()` in model

## Display geometry (128×64 px)

```
y= 0..7    Header bar — module_name  BANK_NAME
y= 8..10   Bank indicator bar
y=11..23   Knob area row 1  (13px)   ← KW=10, ky=rowY+1, box y=12..21
y=24..30   Label row 1  (7px)
y=31..43   Knob area row 2  (13px)
y=44..50   Label row 2
y=51..63   Reserved
```

Knob bounding box: `kx = col*32 + 11`, `ky = rowY + 1`, size 10×10.
Center: `(kx+4.5, ky+4.5)`, radius `4.0` for arc.

## Arc geometry

Angles measured **clockwise from 12 o'clock**. Formula:
```
x = cx + r * Math.sin(deg * π/180)
y = cy - r * Math.cos(deg * π/180)
```

- Min (7 o'clock): `210°` → pixel ~(3, 8) relative to box top-left  
- Max (5 o'clock): `210° + 300° = 510°` → pixel ~(7, 8)  
- Top (12 o'clock): `360°` → pixel ~(5, 1)
- Total sweep: **300°**

Rendering two passes:
1. **Track** (sparse): every `22°` → ~14 dots with visible gaps
2. **Fill** (dense): every `6°` up to `210° + normVal*300°` → solid coverage

---

## Files to modify

| File | Change |
|------|--------|
| `ui.js` | Add `_drawArcKnob`, `_drawEnumKnob`, rename `_drawKnobCell` → `_drawKnobWidget(col, rowY, pvm)`; update `_drawKnobRow`; add `toast` to `getViewModel()`; update `renderKnobsView` for toast header; wire knob touch/release in `onMidiMessageInternal`; add `handleKnobRelease()` to model |
| `view/renderer.mjs` | Same renderer changes (canonical for browser tests) |
| `view/model.mjs` | Same model changes (canonical for browser tests) |
| `browser-test/harness.mjs` | Wire `pointerdown` → `handleKnobTouch(k)`, `pointerup`/`pointercancel` → `handleKnobRelease()` |
| `browser-test/screenshots/baseline/*.png` | Regenerate with `--update` |

---

## Task 1 — Arc + enum knob rendering in `ui.js`

**Files:** Modify `ui.js`

- [ ] **Step 1.1: Replace `_drawKnobCell` with `_drawArcKnob`, `_drawEnumKnob`, `_drawKnobWidget`**

Find the `_drawKnobCell` function (~line 458) and replace it plus add the arc helpers:

```javascript
/* Arc knob: 300° sweep from 7-o'clock (min) to 5-o'clock (max).
 * Angles measured clockwise from 12 o'clock.
 * Two passes: sparse track (full sweep) + dense fill (0..normVal). */
function _drawArcKnob(kx, ky, normVal) {
    const cx = kx + 4.5;
    const cy = ky + 4.5;
    const r  = 4.0;
    const START = 210;
    const RANGE = 300;

    /* Sparse track — full 300° extent */
    for (let d = START; d <= START + RANGE; d += 22) {
        const rad = d * Math.PI / 180;
        fill_rect(Math.round(cx + r * Math.sin(rad)),
                  Math.round(cy - r * Math.cos(rad)), 1, 1, 1);
    }
    /* Dense fill — from start to current value */
    const fillEnd = START + normVal * RANGE;
    for (let d = START; d <= fillEnd; d += 6) {
        const rad = d * Math.PI / 180;
        fill_rect(Math.round(cx + r * Math.sin(rad)),
                  Math.round(cy - r * Math.cos(rad)), 1, 1, 1);
    }
    if (normVal > 0) {
        const rad = fillEnd * Math.PI / 180;
        fill_rect(Math.round(cx + r * Math.sin(rad)),
                  Math.round(cy - r * Math.cos(rad)), 1, 1, 1);
    }
}

/* Enum knob: solid filled square — visually distinct from arc */
function _drawEnumKnob(kx, ky) {
    fill_rect(kx + 1, ky + 1, _KW - 2, _KW - 2, 1);
}

/* Dispatch by param type */
function _drawKnobWidget(col, rowY, pvm) {
    const kx = col * _CELL_W + Math.floor((_CELL_W - _KW) / 2);
    const ky = rowY + 1;
    if (pvm.type === 'enum') {
        _drawEnumKnob(kx, ky);
    } else {
        _drawArcKnob(kx, ky, pvm.normalizedValue);
    }
}
```

- [ ] **Step 1.2: Update `_drawKnobRow` to pass `pvm` to widget**

Change the existing `_drawKnobRow` function (~line 473):

```javascript
function _drawKnobRow(params, rowY, lblY) {
    for (let col = 0; col < 4; col++) {
        const pvm = params[col];
        if (!pvm) continue;
        _drawKnobWidget(col, rowY, pvm);
        _drawLabelCell(col, lblY, pvm);
    }
}
```

- [ ] **Step 1.3: Verify renderer compiles (no syntax error)**

```bash
cd /Users/dake/git/cld/movy
node --input-type=module < /dev/null || true
# Syntax check the relevant section:
node -e "$(grep -A 40 'function _drawArcKnob' ui.js | head -50)"
```

Expected: no syntax error printed.

---

## Task 2 — Toast: full-name header on touch

**Files:** Modify `ui.js` (model section + renderer section)

- [ ] **Step 2.1: Add `toast` to `getViewModel()` in the model section of `ui.js`**

Find `getViewModel()` return statement (~line 330) and add `toast`:

```javascript
    function getViewModel() {
        const nBanks   = numBanks();
        const bankName = moduleConfig && moduleConfig.banks[knobPage]
            ? moduleConfig.banks[knobPage].name
            : (nBanks > 1 ? "PG" + (knobPage + 1) : "");

        const rows = [[], []];
        for (let row = 0; row < 2; row++) {
            for (let col = 0; col < KNOBS_PER_ROW; col++) {
                const physK = row * KNOBS_PER_ROW + col;
                const gi    = knobPage * KNOBS_PER_PAGE + physK;
                const p     = knobParams[gi];
                if (!p) { rows[row].push(null); continue; }
                const v  = knobValues[gi];
                const nv = (p.min === p.max || v === null || v === undefined)
                    ? 0
                    : Math.max(0, Math.min(1, (v - p.min) / (p.max - p.min)));
                rows[row].push({
                    shortName:       p.shortLabel || p.label.substring(0, 4).toUpperCase(),
                    fullName:        p.label,
                    type:            p.type,
                    normalizedValue: nv,
                    displayValue:    _formatValue(p, v),
                    touched:         (touchedSlot === physK),
                });
            }
        }

        /* Toast: shown in header when any knob is currently touched */
        let toast = null;
        if (touchedSlot >= 0) {
            const gi = knobPage * KNOBS_PER_PAGE + touchedSlot;
            const p  = knobParams[gi];
            if (p) toast = { fullName: p.label, value: _formatValue(p, knobValues[gi]) };
        }

        return {
            moduleName:  activeModuleName,
            bankName,
            bankIndex:   knobPage,
            bankCount:   nBanks,
            rows,
            touchedSlot: touchedSlot >= 0 ? touchedSlot : null,
            toast,
        };
    }
```

- [ ] **Step 2.2: Update `renderKnobsView` to show toast in header**

Find `renderKnobsView` (~line 483) and update the header block:

```javascript
function renderKnobsView(vm) {
    clear_screen();

    if (vm.toast) {
        _drawInvertedHeader(vm.toast.fullName, vm.toast.value);
    } else {
        const rightW   = vm.bankName ? fontWidth(vm.bankName) + 4 : 0;
        const maxNameW = _W - rightW - 4;
        let dispName   = vm.moduleName;
        while (dispName.length > 1 && fontWidth(dispName) > maxNameW) {
            dispName = dispName.slice(0, -1);
        }
        _drawInvertedHeader(dispName, vm.bankName);
    }

    _drawBankBar(vm.bankIndex, vm.bankCount);

    const hasParams = vm.rows[0].some(Boolean) || vm.rows[1].some(Boolean);
    if (!hasParams) {
        fontPrint(2, _ROW0_Y + 4, "No params", 1);
        return;
    }
    _drawKnobRow(vm.rows[0], _ROW0_Y, _LBL0_Y);
    _drawKnobRow(vm.rows[1], _ROW1_Y, _LBL1_Y);
}
```

---

## Task 3 — Wire capacitive knob touch/release events

**Files:** Modify `ui.js` (model section + MIDI handler section)

- [ ] **Step 3.1: Add `handleKnobRelease()` to the model in `ui.js`**

Find the `handleKnobTouch` method (~line 358) and add `handleKnobRelease` after it:

```javascript
        handleKnobTouch(k) {
            if (touchedSlot !== k) { touchedSlot = k; dirty = true; }
        },

        handleKnobRelease() {
            if (touchedSlot >= 0) { touchedSlot = -1; dirty = true; }
        },
```

- [ ] **Step 3.2: Wire NoteOn d1=0..7 to touch/release in `onMidiMessageInternal`**

Find the early-return guard for note-on d1 < 10 (~line 711):

```javascript
    if ((status & 0xF0) === 0x90 && d1 < 10) return;
```

Replace with:

```javascript
    /* Capacitive knob touch: NoteOn note=0..7, vel>0 = touch, vel=0 = release */
    if ((status & 0xF0) === 0x90 && d1 < 8) {
        if (d2 > 0) model.handleKnobTouch(d1);
        else        model.handleKnobRelease();
        return;
    }
    /* Notes 8-9: still ignore (e.g. main encoder touch) */
    if ((status & 0xF0) === 0x90 && d1 < 10) return;
```

---

## Task 4 — Sync changes to `view/renderer.mjs` and `view/model.mjs`

These files are the canonical sources for browser tests. Apply the same changes.

- [ ] **Step 4.1: Update `view/renderer.mjs`**

Apply the same changes as Tasks 1 and 2 renderer sections:
- Replace `drawKnobCell` with `drawArcKnob`, `drawEnumKnob`, `drawKnobWidget`
- Update `drawKnobRow` to pass `pvm`
- Update `renderKnobsView` to show toast

Constants in `view/renderer.mjs` use `KW` (not `_KW`), `CELL_W` (not `_CELL_W`), etc. Use the same names that already exist there.

- [ ] **Step 4.2: Update `view/model.mjs`**

Apply the same changes as Tasks 2 and 3 model sections:
- Add `toast` to `getViewModel()` return
- Add `handleKnobRelease()` method

---

## Task 5 — Wire touch in browser-test harness

**Files:** Modify `browser-test/harness.mjs`

- [ ] **Step 5.1: Wire `pointerdown` / `pointerup` to model touch events**

Find the virtual knob interaction loop (~line 65) and add touch calls:

```javascript
    el.addEventListener('pointerdown', e => {
        lastY = e.clientY;
        el.setPointerCapture(e.pointerId);
        el.classList.add('active');
        model.handleKnobTouch(k);        // ← add this line
    });
    el.addEventListener('pointermove', e => {
        if (!(e.buttons & 1)) return;
        const steps = Math.trunc(lastY - e.clientY);
        if (steps !== 0) { model.handleKnobDelta(k, steps); lastY = e.clientY; }
    });
    el.addEventListener('pointerup', () => {
        el.classList.remove('active');
        model.handleKnobRelease();       // ← add this line
    });
    el.addEventListener('pointercancel', () => {
        el.classList.remove('active');
        model.handleKnobRelease();       // ← add this line
    });
```

---

## Task 6 — Regenerate screenshot baselines and run tests

- [ ] **Step 6.1: Start local server and regenerate baselines**

```bash
cd /Users/dake/git/cld/movy/browser-test
node screenshot.mjs --update
```

Expected: `5 passed, 0 failed` and baseline PNGs updated in `screenshots/baseline/`.

- [ ] **Step 6.2: Verify baselines look correct**

Open the updated baselines and visually confirm:
- `plaits.png`: arc knobs for harmonics/timbre/morph/decay etc., solid box for engine (enum)
- `wurl.png`: arc knobs for all params
- `test_enum.png`: mix of arc and solid-box knobs

- [ ] **Step 6.3: Run device test**

```bash
cd /Users/dake/git/cld/movy
./scripts/test.sh
```

Expected: ALL CHECKS PASSED (same checks as before — arc rendering is visual only, not log-checked)

- [ ] **Step 6.4: Save plan and commit**

```bash
cp /Users/dake/.claude/plans/luminous-foraging-eagle.md /Users/dake/git/cld/plans/step-4-arc-knob.md
cd /Users/dake/git/cld/movy
git add ui.js view/renderer.mjs view/model.mjs browser-test/harness.mjs browser-test/screenshots/baseline/
git commit -m "feat(movy): arc knob rendering, enum square, touch toast"
```

---

## Verification

After completing all tasks:
1. `./scripts/test.sh` — all checks pass on device
2. `node browser-test/screenshot.mjs` — 5/5 pass (no pixel diff)
3. On hardware: open Plaits → OSC bank → float knobs show arc, engine shows solid square → touch a knob → header shows full name + value → release → header returns to module/bank name → jog wheel switches banks

---

## Remaining roadmap (not in scope here)

| Step | What |
|------|------|
| 5 | Enum overlay — half-screen list on long-press enum |
| 6 | Group widgets — filter (cut+res) and envelope (ADSR) |
| 7 | LEDs — row-2 amber, row-1 white |
| 8 | Jog click → module selector |

---

## Target architecture

```
movy/
  ui.js                  Schwung lifecycle only — init/tick/MIDI glue
  ui_font.mjs            (unchanged)

  view/
    model.mjs            All state + business logic; zero display calls
                         Exports: createModel(slot), model.update(event), model.getViewModel()
    renderer.mjs         Pure renderer: (ctx, ViewModel) → pixels
                         ctx = thin abstraction over fill_rect/fontPrint
                         Works identically in QuickJS and browser (Node/HTML)

  modules/
    index.mjs            Loader: finds and parses JSON config for active module
    plaits.json          Plaits bank/param config
    wurl.json            Wurl bank/param config
    (more per synth — or loaded from module's own directory)

  browser-test/
    index.html           Manual test harness — canvas at 5× scale, virtual knobs
    harness.mjs          Wires model + renderer to canvas context
    screenshot.test.mjs  Automated screenshot comparisons (Node + puppeteer)
```

### Module config JSON format

Each supported synth has a `.json` file defining banks with named 2-row grids.
Movy ships built-in configs in `modules/`; a synth can also include its own
`movy_config.json` in its module directory (takes priority).

```json
{
  "id": "plaits",
  "name": "Plaits",
  "banks": [
    {
      "name": "OSC",
      "rows": [
        [
          {"key": "engine",    "short": "ENGI", "full": "Engine",    "type": "enum"},
          {"key": "harmonics", "short": "HARM", "full": "Harmonics", "type": "float"},
          {"key": "timbre",    "short": "TIMB", "full": "Timbre",    "type": "float"},
          {"key": "morph",     "short": "MRPH", "full": "Morph",     "type": "float"}
        ],
        [
          {"key": "decay",     "short": "DCAY", "full": "Decay",     "type": "float"},
          {"key": "lpg_colour","short": "LPGC", "full": "LPG Color", "type": "float"},
          {"key": "fm_amount", "short": "FM",   "full": "FM Amount", "type": "float"},
          {"key": "aux_mix",   "short": "AUX",  "full": "Aux Mix",   "type": "float"}
        ]
      ]
    }
  ]
}
```

Row 0 = top physical knob row (knobs 1–4, LEDs white).
Row 1 = bottom physical knob row (knobs 5–8, LEDs amber).
Each row has exactly 4 params. Banks can have more than one page but two rows per bank page is the primary layout.

**Config loading priority:**
1. `<synth_module_dir>/movy_config.json` — synth provides its own layout
2. `<movy_dir>/modules/<module_id>.json` — movy ships a built-in config
3. Auto-generated from `ui_hierarchy` — fallback for unsupported synths

### ViewModel shape (contract between model and renderer)

```javascript
{
  moduleName: string,         // shown in header left
  bankName: string,           // shown in header right
  bankIndex: number,          // 0-based, for indicator bar
  bankCount: number,
  rows: [ParamVM[4], ParamVM[4]],  // always 2 rows × 4 cols
  touchedSlot: number|null,   // 0-7 currently touched knob (row*4+col)
  overlay: null | {           // long-enum dropdown
    slot: number,
    options: string[],
    selected: number,
  },
  toast: null | {             // full-name + value banner shown on touch
    fullName: string,
    value: string,
  },
}

ParamVM {
  shortName: string,          // ≤4 chars for label cell
  fullName: string,
  type: 'float'|'int'|'enum'|'empty',
  widgetType: 'knob'|'square'|'group_filter'|'group_env',
  normalizedValue: number,    // 0.0-1.0 for arc knob
  displayValue: string,       // formatted for under-knob label
  touched: boolean,
  enumLabel: string|null,
  groupType: string|null,     // 'filter'|'envelope'
  groupSlot: number|null,     // position within group
}
```

### Drawing context abstraction

The renderer imports NOTHING from Schwung globals directly. It receives a `ctx`:

```javascript
// On device (in ui.js):
const ctx = {
  fillRect: (x,y,w,h,v) => fill_rect(x,y,w,h,v),
  clear:    ()           => clear_screen(),
  print:    (x,y,s,v)   => fontPrint(x,y,s,v),
  printW:   (s)         => fontWidth(s),
  flush:    (buf)       => host_flush_display(buf),
};

// In browser (harness.mjs):
const ctx = new CanvasCtx(canvasEl, scale=5);
```

---

## Screen layout (128 × 64 px)

```
y= 0..7    Header bar (inverted): module_name        BANK_NAME
y= 8..10   Bank indicator: ███ ▄▄▄ ▄▄▄ ▄▄▄  (active=2px, others=1px bottom)
y=11..23   Knob row 1 — 4 × 32px cells, each with knob widget (12px) centered
y=24..30   Label row 1 — 4 short names, inverted on touch; show value on touch
y=31..43   Knob row 2 — same layout
y=44..50   Label row 2
y=51..63   RESERVED (13px) — for future sequence/transport UI
```

Knob widget (12 × 12 px, centered in 32px cell):
- `float`/`int`: arc from 210° to 330° clockwise, filled proportional to value
- `enum`/preset: filled rectangle, value text centered
- Touch state: label cell → inverted bg; toast replaces header

---

## Step breakdown

| Step | Status | What | Deliverables |
|------|--------|------|-------------|
| 1 | ✅ DONE | Architecture split | `view/model.mjs`, `view/renderer.mjs`, updated `ui.js` |
| 2 | ✅ DONE | Browser test harness | `browser-test/index.html`, `harness.mjs`, `mock-synth.mjs` |
| **3** | **← NOW** | **Module config system** | `modules/index.mjs`, `modules/plaits.json`, `modules/wurl.json` |
| 4 | | Knob widget rendering | Arc knob, square enum, value-on-touch, full-name toast |
| 5 | | Enum overlay | Half-screen list on long-enum touch |
| 6 | | Group widgets | Filter (cut+res) and envelope (ADSR) group renderers |
| 7 | | LEDs | Row-2 = amber, row-1 = white |
| 8 | | Jog click → module selector | Change MoveMainButton handler |

---

## Step 2 — Browser test harness

### Goal

Run the movy renderer in a browser on Mac, with:
- The 128×64 OLED display simulated as a canvas (scaled 5×)
- 8 virtual knobs the user can drag to send deltas to the model
- A synth preset selector (chooses mock data)
- A ViewModel inspector panel (shows param state without looking at display pixels)
- A single-command screenshot capture for visual regression tracking

No changes to any existing files. Step 2 is purely additive.

### Global-mocking strategy

`renderer.mjs` calls `fill_rect(...)` and `clear_screen()` as bare names. In browser
ES modules, bare names still resolve through the scope chain to `globalThis`. So
`harness.mjs` sets these before the first render and all modules pick them up:

```javascript
globalThis.fill_rect   = (x, y, w, h, v) => { ctx2d.fillStyle = v ? '#fff' : '#000'; ctx2d.fillRect(x,y,w,h); };
globalThis.clear_screen = () => { ctx2d.fillStyle = '#000'; ctx2d.fillRect(0,0,128,64); };
globalThis.shadow_get_param  = (slot, key) => mockState[key] ?? null;
globalThis.shadow_set_param  = (slot, key, val) => { mockState[key] = val; return true; };
globalThis.shadow_get_ui_slot = () => 0;
```

The canvas element is 128×64 px, scaled to 640×320 via CSS with `image-rendering: pixelated`.
This keeps fill_rect coordinates matching the real display 1:1.

### Files to create

#### `browser-test/index.html`

Layout:
```
┌─────────────────────────────────────────────────────┐
│ Movy Browser Test    Synth: [Test 8p ▼]  [Tick: ●] │
├─────────────────────────────────────────────────────┤
│ ┌────────── canvas 640×320 ───────────────────────┐ │
│ │  (movy display at 5× scale, black background)   │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ [K1 ↕] [K2 ↕] [K3 ↕] [K4 ↕]  ← drag up/down      │
│  name   name   name   name                          │
│ [K5 ↕] [K6 ↕] [K7 ↕] [K8 ↕]                       │
│  name   name   name   name                          │
│                                                     │
│ ViewModel: { moduleName: ..., rows: [...] }         │
└─────────────────────────────────────────────────────┘
```

Knob elements: `<div class="knob" id="knob-N">` with a small SVG arc indicator.
Virtual knob interaction: `pointerdown` → track `pointermove` vertical delta (1px = 1 step),
call `model.handleKnobDelta(k, steps)`. The indicator angle updates to reflect the
current `normalizedValue` from the latest ViewModel.

#### `browser-test/harness.mjs`

```javascript
import { createModel } from '../view/model.mjs';
import { renderKnobsView } from '../view/renderer.mjs';
import { MOCK_SYNTHS } from './mock-synth.mjs';

// 1. Set up globals (fill_rect, clear_screen, shadow_* — see above)
// 2. Create model: const model = createModel(0); model.reset();
// 3. Wire synth selector → swap mockState + trigger model reload
// 4. Wire 8 virtual knobs → model.handleKnobDelta(k, delta)
// 5. Tick loop: requestAnimationFrame → model.tick() → if dirty: renderKnobsView(vm)
// 6. After each render: update ViewModel inspector div
```

State object `mockState` is a flat map mirroring shadow_get_param's key space:
```javascript
let mockState = { ...MOCK_SYNTHS['test8'] };
// keys: "synth:name", "synth:ui_hierarchy", "synth:freq", ...
```

On tick, the model polls `synth:name` → triggers `loadHierarchy` which reads
`synth:ui_hierarchy` → params populate → display draws.

#### `browser-test/mock-synth.mjs`

Exports three mock presets as ready-to-use `mockState` objects:

| ID | Name | Params | Banks | Purpose |
|----|------|--------|-------|---------|
| `test8` | "Test 8" | 8 floats/ints | 1 | Baseline — fills one page |
| `test16` | "Test 16" | 16 params | 2 | Tests bank indicator + page nav |
| `test_enum` | "Enums" | 4 floats + 4 enums | 1 | Tests enum display (Step 4 prep) |

Each is a flat object:
```javascript
export const MOCK_SYNTHS = {
  test8: {
    "synth:name": "Test 8",
    "synth:ui_hierarchy": JSON.stringify({ levels: { root: { knobs: [...8 params...] } } }),
    "synth:freq":  "0.5",
    "synth:res":   "0.3",
    // ... etc
  },
  ...
};
```

### Serving (required for ES module imports)

ES modules don't work from `file://`. Serve from the movy root:
```bash
cd /Users/dake/git/cld/movy
python3 -m http.server 8080
# open http://localhost:8080/browser-test/
```

Document this in `browser-test/README.md` (a one-liner).

### Screenshot tests (structured, committed to repo)

Directory layout:
```
browser-test/
  index.html
  harness.mjs
  mock-synth.mjs
  screenshot.mjs          Capture + compare script (Node + Puppeteer)
  screenshots/
    baseline/             Committed PNG baselines (one per preset)
      test8.png
      test16.png
      test_enum.png
    actual/               .gitignored — written on each test run
      test8.png
      test16.png
      test_enum.png
  .gitignore              actual/
```

**`screenshot.mjs`** logic:
1. Spin up `python3 -m http.server` on a random port
2. Launch Puppeteer headless, load the harness page
3. For each mock preset: select it, wait one rAF, `canvas.screenshot({path: actual/PRESET.png})`
4. If `baseline/PRESET.png` exists: pixel-diff it (using `pixelmatch`), report pass/fail
5. If baseline missing: copy actual → baseline (first-run mode)
6. Exit 0 if all pass, 1 if any differ

Run:
```bash
node browser-test/screenshot.mjs          # compare against baseline
node browser-test/screenshot.mjs --update # overwrite baselines
```

Baseline PNGs are committed so diffs show up in PRs as visual review.

---

## Critical files (Step 2)

| File | Action |
|------|--------|
| `browser-test/index.html` | Create — page layout, canvas, 8 virtual knobs, ViewModel inspector |
| `browser-test/harness.mjs` | Create — global mocks, model wiring, tick loop |
| `browser-test/mock-synth.mjs` | Create — 3 mock synth presets as flat state maps |
| `browser-test/screenshot.mjs` | Create — Puppeteer capture + pixelmatch comparison |
| `browser-test/screenshots/baseline/*.png` | Captured on first run, committed |
| `browser-test/.gitignore` | Ignore `screenshots/actual/` |

No changes to `view/model.mjs`, `view/renderer.mjs`, `ui.js`, `ui_font.mjs`.

---

## Step 3 — Module config system

### Goal

Give each synth named banks with curated short/full param labels instead of
the auto-generated `PG1`/`PG2` names and 5-char label truncations.

Two real synths are supported at launch: **Plaits** and **Wurl**. All others
fall back to the existing auto-layout from `ui_hierarchy`.

### Source data (from repo inspection)

**Plaits** (`j3threejay/move-anything-plaits`):
- `ui_hierarchy.levels.root.knobs`: `["engine","harmonics","timbre","morph","decay","lpg_colour","fm_amount","aux_mix"]`
- All other params (from `chain_params`): `attack`, `timbre_mod`, `morph_mod`, `legato`, `velocity_sensitivity`, `octave_transpose`
- `engine` type=enum, 24 options: VA VCF, Phase Dist, 6-Op I...Hi-Hat
- All floats: min=0, max=1, step=0.01. `octave_transpose`: int min=-3 max=3.
- Param names for harmonics/timbre/morph are engine-dependent (`refreshes_labels:true`)

**Wurl** (`filliformes/wurl-move`):
- `ui_hierarchy.levels.root.knobs`: `["volume","tremolo","attack","decay","brightness","darken","bark","reverb"]`
- Additional params (from `chain_params`): `speaker`, `tune`
- All floats: min=0, max=1, step=0.01

### Config JSON format (finalized)

`null` slots in a row = empty cell (no param rendered).

```json
{
  "id": "plaits",
  "name": "Plaits",
  "banks": [
    {
      "name": "OSC",
      "rows": [
        [
          {"key":"engine",    "short":"ENGI","full":"Engine",    "type":"enum"},
          {"key":"harmonics", "short":"HARM","full":"Harmonics", "type":"float"},
          {"key":"timbre",    "short":"TIMB","full":"Timbre",    "type":"float"},
          {"key":"morph",     "short":"MRPH","full":"Morph",     "type":"float"}
        ],
        [
          {"key":"decay",     "short":"DCAY","full":"Decay",     "type":"float"},
          {"key":"lpg_colour","short":"LPGC","full":"LPG Color", "type":"float"},
          {"key":"fm_amount", "short":"FM",  "full":"FM Amount", "type":"float"},
          {"key":"aux_mix",   "short":"MIX", "full":"Aux Mix",   "type":"float"}
        ]
      ]
    },
    {
      "name": "MOD",
      "rows": [
        [
          {"key":"attack",               "short":"ATK", "full":"Attack",    "type":"float"},
          {"key":"timbre_mod",           "short":"TMOD","full":"Timbre Mod","type":"float"},
          {"key":"morph_mod",            "short":"MMOD","full":"Morph Mod", "type":"float"},
          {"key":"velocity_sensitivity", "short":"VEL", "full":"Vel Sens",  "type":"float"}
        ],
        [
          {"key":"legato",           "short":"LGTO","full":"Legato", "type":"enum"},
          {"key":"octave_transpose", "short":"OCT", "full":"Octave", "type":"int"},
          null,
          null
        ]
      ]
    }
  ]
}
```

Wurl has 1 bank "WURL" (8 main knobs) + bank "FX" (speaker, tune, 2×null).

### `modules/index.mjs` — Config loader

Inline all configs as `const CONFIGS = { plaits: {...}, wurl: {...} }`.
QuickJS does not support `import ... assert { type: 'json' }`, so JSON data
is inlined as JS literals.

On device: also check `host_read_file` for the synth's own `movy_config.json`
and a movy-installed override, returning the first that parses:
1. `<sound_generators_dir>/<moduleId>/movy_config.json`
2. Bundled `CONFIGS[moduleId]`
3. `null` → model uses auto-layout

```javascript
// modules/index.mjs

const MOVY_SG_ROOT = '/data/UserData/schwung/modules/sound_generators';

function tryFile(path) {
    if (typeof host_read_file !== 'function') return null;
    try {
        const s = host_read_file(path);
        if (s) return JSON.parse(s);
    } catch {}
    return null;
}

const CONFIGS = {
  plaits: { id:"plaits", name:"Plaits", banks:[...] },
  wurl:   { id:"wurl",   name:"Wurl",   banks:[...] },
};

export function loadModuleConfig(moduleId) {
    if (!moduleId) return null;
    return tryFile(`${MOVY_SG_ROOT}/${moduleId}/movy_config.json`)
        ?? CONFIGS[moduleId]
        ?? null;
}
```

### `view/model.mjs` changes

**New state variables:**
```javascript
let moduleId     = "";      // from shadow_get_param(slot, "synth:module")
let moduleConfig = null;    // loaded config or null
let chainParams  = {};      // key → {name,type,min,max,step,options}
```

**`loadHierarchy()` additions:**
1. Read `synth:module` → `moduleId`
2. Read `synth:chain_params` → parse into `chainParams` map (key → metadata)
3. Call `loadModuleConfig(moduleId)` → `moduleConfig`
4. If `moduleConfig`: build `knobParams` from config banks, merging `chainParams`
   for min/max/step/options. Config's `short` and `full` fields stored separately.
5. If no config: existing auto-layout from `ui_hierarchy` (unchanged path)

**`getViewModel()` changes:**
- `bankName`: from `moduleConfig.banks[knobPage].name` if config present; else `"PG"+(knobPage+1)` or `""`
- `shortName`: `p.shortLabel || (cp.name || p.label).substring(0,4).toUpperCase()`
- Null slots in rows emit `null` ParamVM entries (renderer treats them as empty)

**`numBanks()`:** unchanged logic (still `ceil(knobParams.length / 8)`); null slots count toward the total, keeping bank alignment correct.

**`applyKnobDelta()`:** skip null slots (check `if (!p) return`)

### `browser-test/mock-synth.mjs` additions

Add two new presets using real Plaits and Wurl param keys:

```javascript
plaits: {
  "synth:name":    "Plaits",
  "synth:module":  "plaits",
  "synth:ui_hierarchy": JSON.stringify({
    label: "Plaits",
    levels: { root: {
      label: "Plaits",
      knobs: ["engine","harmonics","timbre","morph","decay","lpg_colour","fm_amount","aux_mix"],
      params: [
        {key:"engine",    label:"Engine",    type:"enum"},
        {key:"harmonics", label:"Harmonics"},
        {key:"timbre",    label:"Timbre"},
        {key:"morph",     label:"Morph"},
        {key:"decay",     label:"Decay"},
        {key:"lpg_colour",label:"LPG Color"},
        {key:"fm_amount", label:"FM Amount"},
        {key:"aux_mix",   label:"Aux Mix"},
        {key:"attack",    label:"Attack"},
        {key:"timbre_mod",label:"Timbre Mod"},
        {key:"morph_mod", label:"Morph Mod"},
        {key:"legato",    label:"Legato",    type:"enum"},
        {key:"velocity_sensitivity",label:"Vel Sens"},
        {key:"octave_transpose",    label:"Octave"},
      ]
    }}
  }),
  "synth:chain_params": JSON.stringify([
    {key:"engine",    name:"Engine",    type:"enum",  options:["VA VCF","Phase Dist","6-Op I","6-Op II","6-Op III","Wave Terr","Str Mach","Chiptune","V. Analog","Waveshape","FM","Grain","Additive","Wavetable","Chord","Speech","Swarm","Noise","Particle","String","Modal","Bass Drum","Snare Drum","Hi-Hat"], default:"VA VCF"},
    {key:"harmonics", name:"Harmonics", type:"float", min:0,max:1,step:0.01,default:0.5},
    {key:"timbre",    name:"Timbre",    type:"float", min:0,max:1,step:0.01,default:0.5},
    {key:"morph",     name:"Morph",     type:"float", min:0,max:1,step:0.01,default:0.5},
    {key:"decay",     name:"Decay",     type:"float", min:0,max:1,step:0.01,default:0.5},
    {key:"lpg_colour",name:"LPG Color", type:"float", min:0,max:1,step:0.01,default:0.5},
    {key:"fm_amount", name:"FM",        type:"float", min:0,max:1,step:0.01,default:0},
    {key:"aux_mix",   name:"Mix",       type:"float", min:0,max:1,step:0.01,default:0},
    {key:"attack",    name:"Attack",    type:"float", min:0,max:1,step:0.01,default:0},
    {key:"timbre_mod",name:"Timbre Mod",type:"float", min:0,max:1,step:0.01,default:0},
    {key:"morph_mod", name:"Morph Mod", type:"float", min:0,max:1,step:0.01,default:0},
    {key:"legato",    name:"Legato",    type:"enum",  options:["off","on"],  default:"off"},
    {key:"velocity_sensitivity",name:"Vel Sens",type:"float",min:0,max:1,step:0.01,default:0.5},
    {key:"octave_transpose",    name:"Octave",  type:"int",  min:-3,max:3,default:0},
  ]),
  "synth:engine": "0",
  "synth:harmonics": "0.5",
  /* ... rest of param defaults */
},
```

Wurl preset: similar structure with `synth:module: "wurl"`.

### `browser-test/harness.mjs` change

Add to the global setup block:
```javascript
globalThis.host_read_file = () => null;   // no filesystem in browser
```

Add `<option value="plaits">Plaits</option>` and `<option value="wurl">Wurl</option>`
to the preset dropdown in `index.html`.

Screenshot tests: re-run with `--update` to regenerate all 5 baselines (3 existing
+ 2 new). Existing test8/test16/test_enum baselines will differ (auto-layout
unchanged for those IDs since they have no module config).

### Critical files (Step 3)

| File | Action |
|------|--------|
| `modules/index.mjs` | Create — config loader, bundled Plaits + Wurl configs |
| `view/model.mjs` | Modify — add chain_params reading, config integration, null slots |
| `browser-test/mock-synth.mjs` | Modify — add `plaits` and `wurl` presets |
| `browser-test/harness.mjs` | Modify — add `host_read_file = () => null` |
| `browser-test/index.html` | Modify — add plaits/wurl to preset dropdown |
| `browser-test/screenshots/baseline/*.png` | Regenerate with `--update` |
| `scripts/deploy.sh` | Modify — deploy `modules/` subdir |

---

## Verification

1. `cd /Users/dake/git/cld/movy && python3 -m http.server 8080`
2. Open `http://localhost:8080/browser-test/` — canvas shows movy display
3. Drag a virtual knob up/down — display updates, label shows value while dragging
4. Switch synth preset dropdown — display reloads with new module name + params
5. Select "Plaits" preset → header shows "Plaits / OSC", knobs labelled ENGI/HARM/TIMB/MRPH
6. Press bank-next → header shows "Plaits / MOD", knobs show ATK/TMOD/MMOD/VEL + LGTO/OCT + 2 empty
7. Select "Wurl" preset → header shows "Wurl / WURL" with correct 8 labels
8. `node browser-test/screenshot.mjs --update` — regenerates 5 baselines
9. `node browser-test/screenshot.mjs` — all 5 pass
