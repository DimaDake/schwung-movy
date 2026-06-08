# Track Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the user to switch between all 4 Move tracks (T1–T4) while movy is running, using the hardware track buttons (CC 40–43), with chain slot and knob page preserved per track.

**Architecture:** Replace the single `chainModels: Model[]` + `chainIndex: number` with a 4×4 model grid (`trackModels: Model[][]`) and a per-track chain index array (`trackChainIndex: number[]`). All 16 models are created at init; only the active track's 4 models tick each frame. Track button CCs (40–43) update `activeSlot` directly. The chain-view renderer receives `activeSlot` to render the dynamic T1–T4 label.

**Tech Stack:** TypeScript, esbuild, puppeteer (screenshot tests)

**Spec:** `docs/superpowers/specs/2026-06-08-track-switching-design.md`

---

## File Map

| File | Change |
|------|--------|
| `src/app/state.ts` | Replace `chainModels`/`chainIndex` with `trackModels`/`trackChainIndex` |
| `src/app/init.ts` | Create 4×4 model grid; init `trackChainIndex = [1,1,1,1]` |
| `src/app/tick.ts` | Derive chain index from `trackChainIndex[activeSlot]`; pass `activeSlot` to `renderChainView` |
| `src/midi/router.ts` | Add CC 40–43 track button handler; extract `activeModel()`/`chainIndex()`/`setChainIndex()` helpers; update all model/index references |
| `src/renderer/chain-view.ts` | Add `activeSlot = 0` param; replace hardcoded `'T1'` with dynamic label |
| `browser-test/harness.mjs` | Update `__movy_renderChainView` to accept and forward `activeSlot` |
| `browser-test/screenshot.mjs` | Add `chain_t2` and `chain_t4` screenshot scenarios |

---

## Task 1: Restructure app state types

**Files:**
- Modify: `src/app/state.ts`

- [ ] **Step 1: Replace `chainModels`/`chainIndex` with `trackModels`/`trackChainIndex`**

Full replacement for `src/app/state.ts`:

```typescript
import type { Model } from '../model/index.js';

export const VIEW_KEYS   = 0;
export const VIEW_KNOBS  = 1;
export const VIEW_BROWSE = 2;
export const VIEW_CHAIN  = 3;

export const appState = {
    activeSlot:      0,
    currentView:     VIEW_CHAIN,
    shiftHeld:       false,
    dirty:           true,
    initLedIndex:    0,
    initLedsDone:    false,
    trackChainIndex: [1, 1, 1, 1] as number[],
    trackModels:     [] as Model[][],
    jogTouched:      false,
    browseOrigin:    VIEW_CHAIN as number,
};
```

---

## Task 2: Update init to create 4×4 model grid

**Files:**
- Modify: `src/app/init.ts`

- [ ] **Step 1: Replace chainModels creation with 4×4 grid**

Full replacement for `src/app/init.ts`:

```typescript
import { createModel }  from '../model/index.js';
import { appState, VIEW_CHAIN } from './state.js';
import { keyboardState } from '../keyboard/state.js';
import { browserState } from '../browser/state.js';
import { CHAIN_SLOTS } from '../chain/config.js';
import { mlog } from '../log.js';

export function init(): void {
    appState.activeSlot = (typeof shadow_get_ui_slot === 'function') ? shadow_get_ui_slot() : 0;
    mlog('init: activeSlot=' + appState.activeSlot);

    appState.trackModels = Array.from({ length: 4 }, (_, slot) =>
        CHAIN_SLOTS.map(s => createModel(slot, s.componentKey))
    );
    appState.trackChainIndex = [1, 1, 1, 1];
    appState.currentView  = VIEW_CHAIN;
    appState.shiftHeld    = false;
    appState.jogTouched   = false;
    appState.browseOrigin = VIEW_CHAIN;
    appState.dirty        = true;
    appState.initLedIndex = 0;
    appState.initLedsDone = false;

    for (const trackSlots of appState.trackModels) {
        for (const m of trackSlots) m.reset();
    }

    keyboardState.rootNote = 48;
    for (const k of Object.keys(keyboardState.held)) delete keyboardState.held[+k];

    browserState.modules      = [];
    browserState.browseIndex  = 0;
    browserState.componentKey = 'synth';
}
```

---

## Task 3: Update tick to use new state shape

**Files:**
- Modify: `src/app/tick.ts`

- [ ] **Step 1: Replace chainModels/chainIndex references; pass activeSlot to renderChainView**

Full replacement for `src/app/tick.ts`:

```typescript
import { appState, VIEW_KEYS, VIEW_KNOBS, VIEW_BROWSE, VIEW_CHAIN } from './state.js';
import { keyboardState } from '../keyboard/state.js';
import { browserState } from '../browser/state.js';
import { CHAIN_SLOTS } from '../chain/config.js';
import { padLedColor } from '../keyboard/leds.js';
import { midiNoteName } from '../keyboard/notes.js';
import { renderKnobsView } from '../renderer/knob-view.js';
import { renderKeysView }  from '../renderer/keys-view.js';
import { renderBrowseView } from '../renderer/browse-view.js';
import { renderChainView } from '../renderer/chain-view.js';
import { updateKnobLEDs }  from '../renderer/knob-leds.js';

const PAD_MIN        = MovePads[0];
const PAD_MAX        = MovePads[MovePads.length - 1];
const LED_INIT_BATCH = 8;

export function tick(): void {
    if (!appState.initLedsDone) {
        const total = PAD_MAX - PAD_MIN + 1;
        const end   = Math.min(appState.initLedIndex + LED_INIT_BATCH, total);
        for (let i = appState.initLedIndex; i < end; i++) {
            setLED(PAD_MIN + i, padLedColor(PAD_MIN + i, PAD_MIN), true);
        }
        appState.initLedIndex = end;
        if (appState.initLedIndex >= total) { appState.initLedsDone = true; appState.dirty = true; }
        return;
    }

    const chainIdx    = appState.trackChainIndex[appState.activeSlot];
    const activeModel = appState.trackModels[appState.activeSlot]?.[chainIdx];
    const modelDirty  = activeModel?.tick() ?? false;

    if (modelDirty || appState.dirty) {
        if (appState.currentView === VIEW_KEYS) {
            renderKeysView(activeModel?.getModuleName() ?? '—', keyboardState.rootNote, midiNoteName);
        } else if (appState.currentView === VIEW_KNOBS) {
            const vm = activeModel!.getViewModel();
            renderKnobsView(vm, appState.jogTouched);
            updateKnobLEDs(vm);
        } else if (appState.currentView === VIEW_CHAIN) {
            const vm = activeModel!.getViewModel();
            renderChainView(vm, chainIdx, appState.jogTouched, appState.activeSlot);
            updateKnobLEDs(vm);
        } else {
            const browseTitle = CHAIN_SLOTS[chainIdx]?.label ?? 'Module';
            renderBrowseView(browserState.modules, browserState.browseIndex, browseTitle);
        }
        appState.dirty = false;
    }
}
```

---

## Task 4: Add track button handler and update router

**Files:**
- Modify: `src/midi/router.ts`

- [ ] **Step 1: Rewrite router with track button CC handler and helper functions**

Full replacement for `src/midi/router.ts`:

```typescript
import { appState, VIEW_KEYS, VIEW_KNOBS, VIEW_BROWSE, VIEW_CHAIN } from '../app/state.js';
import { keyboardState } from '../keyboard/state.js';
import { browserState } from '../browser/state.js';
import { noteOn, noteOff, changeRoot, releaseAllNotes } from '../keyboard/handler.js';
import { openBrowser, loadSelectedModule } from '../browser/handler.js';
import { mlog } from '../log.js';

const PAD_MIN        = MovePads[0];
const PAD_MAX        = MovePads[MovePads.length - 1];
const KNOB_CC_BASE   = MoveKnob1;
const NUM_KNOBS      = 8;
const JOG_TOUCH      = MoveKnob8Touch + 1;  /* note 8 = main encoder touch */
const TRACK_CC_START = 40;                   /* MoveRow4 → slot 3 */
const TRACK_CC_END   = 43;                   /* MoveRow1 → slot 0 */

function activeModel() {
    return appState.trackModels[appState.activeSlot]?.[appState.trackChainIndex[appState.activeSlot]];
}

function chainIndex(): number { return appState.trackChainIndex[appState.activeSlot]; }
function setChainIndex(i: number): void { appState.trackChainIndex[appState.activeSlot] = i; }

export function onMidiMessageInternal(data: number[]): void {
    if (!data || data.length < 3) return;
    const status = data[0];
    const d1     = data[1];
    const d2     = data[2];

    /* Capacitive knob touch: NoteOn note=0..7 */
    if ((status & 0xF0) === 0x90 && d1 < 8) {
        if (d2 > 0) activeModel()?.handleKnobTouch(d1);
        else        activeModel()?.handleKnobRelease(d1);
        return;
    }

    /* Main encoder (jog) touch: note=8 */
    if ((status & 0xF0) === 0x90 && d1 === JOG_TOUCH) {
        if (appState.currentView === VIEW_CHAIN || appState.currentView === VIEW_KNOBS) {
            appState.jogTouched = d2 > 0;
            appState.dirty = true;
        }
        return;
    }

    /* Other encoder touch (note 9) — ignore */
    if ((status & 0xF0) === 0x90 && d1 < 10) return;

    /* Pad notes */
    if (d1 >= PAD_MIN && d1 <= PAD_MAX) {
        if ((status & 0xF0) === 0x90 && d2 > 0) { noteOn(d1, PAD_MIN, PAD_MAX);  return; }
        if ((status & 0xF0) === 0x80 || ((status & 0xF0) === 0x90 && d2 === 0)) {
            noteOff(d1, PAD_MIN); return;
        }
    }

    /* Knob CC (71–78) */
    if ((status & 0xF0) === 0xB0 && d1 >= KNOB_CC_BASE && d1 < KNOB_CC_BASE + NUM_KNOBS) {
        const k     = d1 - KNOB_CC_BASE;
        const delta = decodeDelta(d2);
        mlog('knobCC k=' + k + ' d2=' + d2 + ' delta=' + delta);
        activeModel()?.handleKnobDelta(k, delta);
        return;
    }

    if ((status & 0xF0) !== 0xB0) return;

    /* Track buttons (CC 40–43): newSlot = 43 - d1  →  CC43=slot0, CC40=slot3 */
    if (d1 >= TRACK_CC_START && d1 <= TRACK_CC_END && d2 > 0) {
        const newSlot = TRACK_CC_END - d1;
        if (newSlot !== appState.activeSlot) {
            appState.activeSlot = newSlot;
            appState.jogTouched = false;
        }
        appState.dirty = true;
        return;
    }

    /* Shift */
    if (d1 === MoveShift) { appState.shiftHeld = d2 > 0; return; }

    /* Back */
    if (d1 === MoveBack && d2 > 0) {
        appState.jogTouched = false;
        if (appState.currentView === VIEW_BROWSE) {
            appState.currentView = appState.browseOrigin;
            appState.dirty = true;
        } else if (appState.currentView === VIEW_KEYS || appState.currentView === VIEW_KNOBS) {
            appState.currentView = VIEW_CHAIN;
            appState.dirty = true;
        } else {
            releaseAllNotes();
            host_exit_module();
        }
        return;
    }

    /* Jog click */
    if (d1 === MoveMainButton && d2 > 0) {
        if (appState.currentView === VIEW_BROWSE) {
            loadSelectedModule(appState.activeSlot);
        } else if (appState.currentView === VIEW_CHAIN) {
            const isEmpty = activeModel()?.getViewModel().isEmpty ?? false;
            if (appState.shiftHeld || isEmpty) {
                openBrowser(appState.activeSlot, chainIndex());
                appState.browseOrigin = VIEW_CHAIN;
            } else {
                appState.currentView = VIEW_KNOBS;
                appState.dirty = true;
            }
        } else if (appState.currentView === VIEW_KNOBS) {
            openBrowser(appState.activeSlot, chainIndex());
            appState.browseOrigin = VIEW_KNOBS;
        } else if (appState.currentView === VIEW_KEYS) {
            appState.currentView = VIEW_CHAIN;
            appState.dirty = true;
        }
        return;
    }

    /* Jog rotation */
    if (d1 === MoveMainKnob) {
        const delta = decodeDelta(d2);
        if (delta !== 0) {
            if (appState.currentView === VIEW_CHAIN) {
                setChainIndex(Math.max(0, Math.min(3, chainIndex() + (delta > 0 ? 1 : -1))));
                mlog('chain chainIndex=' + chainIndex());
            } else if (appState.currentView === VIEW_KNOBS) {
                activeModel()?.changePage(delta > 0 ? 1 : -1);
            } else if (appState.currentView === VIEW_BROWSE) {
                browserState.browseIndex = Math.max(0, Math.min(browserState.modules.length - 1, browserState.browseIndex + delta));
            }
            appState.dirty = true;
        }
        return;
    }

    /* Left/Right — page nav in VIEW_KNOBS; chain-slot nav in VIEW_CHAIN */
    if (d1 === MoveLeft && d2 > 0) {
        if (appState.currentView === VIEW_CHAIN) {
            setChainIndex(Math.max(0, chainIndex() - 1));
        } else if (appState.currentView === VIEW_KNOBS) {
            activeModel()?.changePage(-1);
        }
        appState.dirty = true;
        return;
    }
    if (d1 === MoveRight && d2 > 0) {
        if (appState.currentView === VIEW_CHAIN) {
            setChainIndex(Math.min(3, chainIndex() + 1));
        } else if (appState.currentView === VIEW_KNOBS) {
            activeModel()?.changePage(1);
        }
        appState.dirty = true;
        return;
    }

    /* Up → VIEW_KEYS from CHAIN or KNOBS */
    if (d1 === MoveUp && d2 > 0) {
        if (appState.currentView === VIEW_CHAIN || appState.currentView === VIEW_KNOBS) {
            appState.currentView = VIEW_KEYS;
            appState.dirty = true;
        } else if (appState.currentView === VIEW_KEYS) {
            changeRoot(1, PAD_MIN, PAD_MAX);
        }
        return;
    }
    if (d1 === MoveDown && d2 > 0 && appState.currentView === VIEW_KEYS) {
        changeRoot(-1, PAD_MIN, PAD_MAX);
        return;
    }
}
```

---

## Task 5: Update chain-view renderer signature

**Files:**
- Modify: `src/renderer/chain-view.ts`

- [ ] **Step 1: Add `activeSlot` param and replace hardcoded `'T1'`**

Full replacement for `src/renderer/chain-view.ts`:

```typescript
import type { ViewModel } from '../types/viewmodel.js';
import { fontPrint, fontWidth } from '../font/index.js';
import { drawHeader, drawBankBar } from './header.js';
import { drawKnobRow } from './label.js';
import { drawEnumOverlay } from './overlay.js';
import { W, ROW0_Y, LBL0_Y, ROW1_Y, LBL1_Y, TOAST_Y, TOAST_H } from './layout.js';
import { CHAIN_SLOTS } from '../chain/config.js';

function drawJogToast(text: string): void {
    fill_rect(0, TOAST_Y, W, TOAST_H, 1);
    const tw = fontWidth(text);
    const tx = Math.max(1, Math.floor((W - tw) / 2));
    fontPrint(tx, TOAST_Y + 1, text, 0);
}

export function renderChainView(vm: ViewModel, chainIndex: number, jogTouched: boolean, activeSlot = 0): void {
    clear_screen();

    const slot       = CHAIN_SLOTS[chainIndex] ?? CHAIN_SLOTS[1];
    const trackLabel = 'T' + (activeSlot + 1);

    if (vm.isEmpty) {
        drawHeader(trackLabel, slot.label, false);
        drawBankBar(chainIndex, 4);
        const msg = 'CLICK JOG: ADD MODULE';
        fontPrint(Math.max(0, Math.floor((W - fontWidth(msg)) / 2)), 28, msg, 1);
        if (jogTouched) drawJogToast('CLICK: ADD MODULE');
        return;
    }

    if (vm.toast) {
        drawHeader(vm.toast.fullName, vm.toast.value, true);
    } else {
        const leftW    = fontWidth(trackLabel) + 4;
        const maxRight = W - leftW - 4;
        let right = vm.moduleName;
        while (right.length > 1 && fontWidth(right) > maxRight) right = right.slice(0, -1);
        drawHeader(trackLabel, right, false);
    }

    drawBankBar(chainIndex, 4);

    const hasParams = vm.rows[0].some(Boolean) || vm.rows[1].some(Boolean);
    if (!hasParams) {
        fontPrint(2, ROW0_Y + 4, 'No params', 1);
    } else {
        drawKnobRow(vm.rows[0], ROW0_Y, LBL0_Y);
        drawKnobRow(vm.rows[1], ROW1_Y, LBL1_Y);
    }

    if (vm.overlay) drawEnumOverlay(vm);
    if (jogTouched) drawJogToast('SHIFT+CLICK SWAP  CLICK OPEN');
}
```

- [ ] **Step 2: Run typecheck — must pass with zero errors**

```bash
cd /Users/dake/git/cld/movy && npm run typecheck
```

Expected: `0 errors`

---

## Task 6: Build browser bundle and update harness

**Files:**
- Modify: `browser-test/harness.mjs` (line 174)

- [ ] **Step 1: Build browser bundle**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser
```

Expected: exits 0, `dist/esm/` updated.

- [ ] **Step 2: Update `__movy_renderChainView` in harness to accept `activeSlot`**

In `browser-test/harness.mjs`, replace the `__movy_renderChainView` block (lines 174–178):

Old:
```javascript
globalThis.__movy_renderChainView = (chainIndex, jogTouched) => {
    const m  = chainModels[chainIndex ?? 1];
    const vm = m.getViewModel();
    renderChainView(vm, chainIndex ?? 1, jogTouched ?? false);
};
```

New:
```javascript
globalThis.__movy_renderChainView = (chainIndex, jogTouched, activeSlot) => {
    const m  = chainModels[chainIndex ?? 1];
    const vm = m.getViewModel();
    renderChainView(vm, chainIndex ?? 1, jogTouched ?? false, activeSlot ?? 0);
};
```

---

## Task 7: Add screenshot tests for T2 and T4 labels

**Files:**
- Modify: `browser-test/screenshot.mjs`

- [ ] **Step 1: Add `chain_t2` and `chain_t4` to the PRESETS list**

In `browser-test/screenshot.mjs`, replace the `PRESETS` array (lines 31–37):

Old:
```javascript
const PRESETS = [
    'test8', 'test16', 'test_enum', 'plaits', 'wurl',
    'enum_overlay', 'knob_toast', 'no_params', 'keys_view', 'browse_view',
    'obxd_preset_page', 'obxd_main_page', 'obxd_filter_page',
    'lfo_prefix',
    'chain_synth', 'chain_empty', 'chain_jog_toast', 'knobs_jog_toast',
];
```

New:
```javascript
const PRESETS = [
    'test8', 'test16', 'test_enum', 'plaits', 'wurl',
    'enum_overlay', 'knob_toast', 'no_params', 'keys_view', 'browse_view',
    'obxd_preset_page', 'obxd_main_page', 'obxd_filter_page',
    'lfo_prefix',
    'chain_synth', 'chain_empty', 'chain_jog_toast', 'knobs_jog_toast',
    'chain_t2', 'chain_t4',
];
```

- [ ] **Step 2: Add `chain_t2` and `chain_t4` to `syntheticPresets` and add render handlers**

In `browser-test/screenshot.mjs`, in the `syntheticPresets` object (lines 108–117), add two entries:

Old:
```javascript
const syntheticPresets = { enum_overlay: 'plaits', knob_toast: 'test8',
                           no_params: 'no_params', keys_view: 'test8',
                           browse_view: 'test8',
                           obxd_preset_page: 'obxd_like',
                           obxd_main_page:   'obxd_like',
                           obxd_filter_page: 'obxd_like',
                           chain_synth:      'test8',
                           chain_empty:      'test8',
                           chain_jog_toast:  'test8',
                           knobs_jog_toast:  'test8' };
```

New:
```javascript
const syntheticPresets = { enum_overlay: 'plaits', knob_toast: 'test8',
                           no_params: 'no_params', keys_view: 'test8',
                           browse_view: 'test8',
                           obxd_preset_page: 'obxd_like',
                           obxd_main_page:   'obxd_like',
                           obxd_filter_page: 'obxd_like',
                           chain_synth:      'test8',
                           chain_empty:      'test8',
                           chain_jog_toast:  'test8',
                           knobs_jog_toast:  'test8',
                           chain_t2:         'test8',
                           chain_t4:         'test8' };
```

- [ ] **Step 3: Add render handlers for `chain_t2` and `chain_t4`**

In `browser-test/screenshot.mjs`, after the `knobs_jog_toast` handler block (after line 178, before the canvas capture block), add:

Old (the block immediately after `knobs_jog_toast`):
```javascript
        } else if (preset === 'knobs_jog_toast') {
            await page.evaluate(() => {
                globalThis.__movy_renderKnobsJogToast?.();
            });
        }
```

New:
```javascript
        } else if (preset === 'knobs_jog_toast') {
            await page.evaluate(() => {
                globalThis.__movy_renderKnobsJogToast?.();
            });
        } else if (preset === 'chain_t2') {
            await page.evaluate(() => {
                globalThis.__movy_renderChainView?.(1, false, 1);  /* synth slot, T2 */
            });
        } else if (preset === 'chain_t4') {
            await page.evaluate(() => {
                globalThis.__movy_renderChainView?.(1, false, 3);  /* synth slot, T4 */
            });
        }
```

- [ ] **Step 4: Create baselines for the two new test cases**

```bash
cd /Users/dake/git/cld/movy && node browser-test/screenshot.mjs --update
```

Expected: all presets listed including `chain_t2` and `chain_t4`, output shows `saved baseline` or `updated` for the two new ones, all others show `ok`.

- [ ] **Step 5: Run screenshot tests — must pass**

```bash
cd /Users/dake/git/cld/movy && node browser-test/screenshot.mjs
```

Expected: `N passed, 0 failed` (N = previous count + 2)

---

## Task 8: Full test suite, commit, and push

- [ ] **Step 1: Run perf tests**

```bash
cd /Users/dake/git/cld/movy && node browser-test/perf.mjs
```

Expected: exits 0, no threshold violations.

- [ ] **Step 2: Run device tests if reachable**

```bash
cd /Users/dake/git/cld/movy && ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && ./scripts/test.sh \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```

If offline, report `DEVICE OFFLINE` to the user.

- [ ] **Step 3: Commit**

```bash
cd /Users/dake/git/cld/movy && git add \
  src/app/state.ts \
  src/app/init.ts \
  src/app/tick.ts \
  src/midi/router.ts \
  src/renderer/chain-view.ts \
  browser-test/harness.mjs \
  browser-test/screenshot.mjs \
  browser-test/screenshots/baseline/chain_t2.png \
  browser-test/screenshots/baseline/chain_t4.png \
  && git commit -m "$(cat <<'EOF'
feat: track switching via T1-T4 hardware buttons

All 4 tracks are now live (16 models created at init). Track buttons
(CC 40-43) update activeSlot; chain slot and knob page are preserved
per track on switch. Chain view header shows T1-T4 dynamically.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Push**

```bash
cd /Users/dake/git/cld/movy && git push
```
