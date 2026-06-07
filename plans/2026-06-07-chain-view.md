# Chain View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace movy's single-synth view with a full Schwung chain (MIDI FX → Synth → FX 1 → FX 2), each navigable as a page, with drill-in to full module params, shift+click module swapping, and jog-touch hint toasts.

**Architecture:** Four independent models (one per chain component) created at init; only the active one ticks per frame. `VIEW_CHAIN` is the new default. Jog click drills to `VIEW_KNOBS`; Back returns. All `shadow_get/set_param` calls are parameterized by `componentKey` (`midi_fx1 | synth | fx1 | fx2`). `VIEW_KEYS` is accessible via `MoveUp` from `VIEW_CHAIN` or `VIEW_KNOBS`.

**Tech Stack:** TypeScript, esbuild, Schwung shadow APIs (shadow_get/set_param), Move MIDI contract, Puppeteer screenshot tests (pixel-diff).

---

### Task 1: Chain slot config + layout constants + schwung type

**Files:**
- Create: `src/chain/config.ts`
- Modify: `src/renderer/layout.ts`
- Modify: `src/types/schwung.d.ts`

- [ ] **Step 1: Create `src/chain/config.ts`**

```typescript
export interface ChainSlot {
    componentKey: string;
    label:        string;
    scanDir:      string;
    expectedType: string;
}

export const CHAIN_SLOTS: ChainSlot[] = [
    { componentKey: 'midi_fx1', label: 'MIDI FX', scanDir: 'midi_fx',         expectedType: 'midi_fx'         },
    { componentKey: 'synth',    label: 'SYNTH',   scanDir: 'sound_generators', expectedType: 'sound_generator' },
    { componentKey: 'fx1',      label: 'FX 1',    scanDir: 'audio_fx',         expectedType: 'audio_fx'        },
    { componentKey: 'fx2',      label: 'FX 2',    scanDir: 'audio_fx',         expectedType: 'audio_fx'        },
];
```

- [ ] **Step 2: Add toast constants to `src/renderer/layout.ts`**

Append to the end of the file:
```typescript
export const TOAST_Y = 58;
export const TOAST_H = 6;
```

- [ ] **Step 3: Declare `MoveJogTouch` in `src/types/schwung.d.ts`**

Add after the `MoveKnob8Touch` line:
```typescript
declare const MoveJogTouch: number;  // NoteOn note for main encoder touch (= MoveKnob8Touch + 1)
```

- [ ] **Step 4: Typecheck**

```bash
cd /Users/dake/git/cld/movy && npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git -C /Users/dake/git/cld/movy add src/chain/config.ts src/renderer/layout.ts src/types/schwung.d.ts
git -C /Users/dake/git/cld/movy commit -m "$(cat <<'EOF'
feat: chain config, toast layout constants, MoveJogTouch

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Parameterize model by component key

**Files:**
- Modify: `src/model/state.ts`
- Modify: `src/model/hierarchy.ts`
- Modify: `src/model/store.ts`
- Modify: `src/model/viewmodel.ts`
- Modify: `src/model/index.ts`

- [ ] **Step 1: Add `componentKey` to `ModelState` in `src/model/state.ts`**

Add `componentKey: string` to the interface and factory:

```typescript
import type { KnobParam, ModuleConfig } from '../types/param.js';
import { KNOBS_PER_PAGE, NAME_POLL_TICKS } from './constants.js';

export interface EnumOverlay {
    slot:     number;
    gi:       number;
    options:  string[];
    selected: number;
}

export interface ModelState {
    activeSlot:         number;
    componentKey:       string;
    knobParams:         (KnobParam | null)[];
    knobValues:         (number | null)[];
    pendingDeltas:      number[];
    enumAccums:         number[];
    knobPage:           number;
    touchedSlots:       number[];
    longPressCountdown: number;
    enumOverlay:        EnumOverlay | null;
    activeModuleName:   string;
    moduleId:           string;
    moduleConfig:       ModuleConfig | null;
    bankNames:          string[];
    hierarchyKey:       string;
    pollCountdown:      number;
    refreshCountdown:   number;
    dirty:              boolean;
}

export function createModelState(activeSlot: number, componentKey: string): ModelState {
    return {
        activeSlot,
        componentKey,
        knobParams:         [],
        knobValues:         [],
        pendingDeltas:      new Array(KNOBS_PER_PAGE).fill(0) as number[],
        enumAccums:         new Array(KNOBS_PER_PAGE).fill(0) as number[],
        knobPage:           0,
        touchedSlots:       [],
        longPressCountdown: -1,
        enumOverlay:        null,
        activeModuleName:   '—',
        moduleId:           '',
        moduleConfig:       null,
        bankNames:          [],
        hierarchyKey:       '',
        pollCountdown:      NAME_POLL_TICKS,
        refreshCountdown:   0,
        dirty:              false,
    };
}
```

- [ ] **Step 2: Parameterize all prefix lookups in `src/model/hierarchy.ts`**

Replace every hardcoded `'synth'` prefix. The 7 affected lines (by line number from original):

Line 30 — module id:
```typescript
s.moduleId = shadow_get_param(s.activeSlot, s.componentKey + '_module') || '';
```

Line 34 — chain_params:
```typescript
const chainParamsRaw = shadow_get_param(s.activeSlot, s.componentKey + ':chain_params');
```

Line 43 — ui_hierarchy:
```typescript
const raw = shadow_get_param(s.activeSlot, s.componentKey + ':ui_hierarchy');
```

Line 134 — preset count:
```typescript
const countRaw = shadow_get_param(s.activeSlot, s.componentKey + ':' + countParam);
```

Line 140 — preset names bulk:
```typescript
const namesRaw = shadow_get_param(s.activeSlot, s.componentKey + ':preset_names');
```

Line 144 — preset names probe:
```typescript
if (!allNames && shadow_get_param(s.activeSlot, s.componentKey + ':preset_name_0') !== null) {
```

Line 147 — preset name per index:
```typescript
allNames.push(shadow_get_param(s.activeSlot, s.componentKey + ':preset_name_' + i) ?? String(i));
```

- [ ] **Step 3: Parameterize `src/model/store.ts`**

Replace the 7 hardcoded `'synth:'` references:

```typescript
import type { KnobParam } from '../types/param.js';
import type { ModelState } from './state.js';
import { KNOBS_PER_PAGE, ENUM_DELTA_DIV } from './constants.js';
import { mlog } from '../log.js';

export function formatValue(p: KnobParam, v: number | null | undefined): string {
    if (v === null || v === undefined) return '...';
    if (p.type === 'enum') {
        if (p.options && p.options[Math.round(v)]) return p.options[Math.round(v)].substring(0, 5);
        return String(Math.round(v));
    }
    if (p.type === 'int') return String(Math.round(v));
    const range = (p.max - p.min) || 1;
    return Math.round((v - p.min) / range * 100) + '%';
}

export function applyKnobDelta(s: ModelState, physK: number, delta: number): void {
    const gi = s.knobPage * KNOBS_PER_PAGE + physK;
    const p  = s.knobParams[gi];
    if (!p) return;

    const prefix = s.componentKey + ':';
    if (s.knobValues[gi] === null || s.knobValues[gi] === undefined) {
        const raw = shadow_get_param(s.activeSlot, prefix + p.key);
        if (raw === null && !p.key.startsWith('test_')) return;
        const v = parseFloat(raw ?? '');
        s.knobValues[gi] = (raw === null || isNaN(v)) ? p.min : v;
    }

    const scaled = p.type === 'enum' ? delta / ENUM_DELTA_DIV : delta * p.step;
    let newVal = (s.knobValues[gi] as number) + scaled;
    newVal = Math.max(p.min, Math.min(p.max, newVal));
    if (p.type === 'int') newVal = Math.round(newVal);
    s.knobValues[gi] = newVal;

    const valStr = (p.type === 'float') ? newVal.toFixed(4) : String(Math.round(newVal));
    mlog('set slot=' + s.activeSlot + ' gi=' + gi + ' key=' + prefix + p.key + ' val=' + valStr);
    const ok = p.key.startsWith('test_') ? true : shadow_set_param(s.activeSlot, prefix + p.key, valStr);
    mlog('set_param returned ' + ok);
    s.dirty = true;
}

export function refreshKnobValues(s: ModelState): void {
    const prefix = s.componentKey + ':';
    for (let gi = 0; gi < s.knobParams.length; gi++) {
        const p = s.knobParams[gi];
        if (!p) continue;
        const raw = shadow_get_param(s.activeSlot, prefix + p.key);
        if (raw !== null) {
            const v = parseFloat(raw);
            if (!isNaN(v)) s.knobValues[gi] = v;
        }
    }
}

export function pollModuleName(s: ModelState): void {
    const name = shadow_get_param(s.activeSlot, s.componentKey + ':name')
              || shadow_get_param(s.activeSlot, s.componentKey + '_module')
              || '—';
    if (name !== s.activeModuleName) {
        s.activeModuleName = name;
        s.hierarchyKey = '';
        s.dirty = true;
    }
}
```

- [ ] **Step 4: Parameterize `src/model/viewmodel.ts`**

Replace the `'synth:' + p.nameKey` lookup (appears twice):

```typescript
const dv = p.nameKey
    ? (shadow_get_param(s.activeSlot, s.componentKey + ':' + p.nameKey) ?? formatValue(p, v))
    : formatValue(p, v);
```

And in the toast section:
```typescript
const tv = p.nameKey
    ? (shadow_get_param(s.activeSlot, s.componentKey + ':' + p.nameKey) ?? formatValue(p, s.knobValues[gi]))
    : formatValue(p, s.knobValues[gi]);
```

- [ ] **Step 5: Update `createModel` signature in `src/model/index.ts`**

Change the factory function signature and update the one `'synth:'` set call:

```typescript
export function createModel(slot: number, componentKey = 'synth') {
    const s = createModelState(slot, componentKey);
    // ... rest unchanged except:
```

In `handleKnobRelease`, replace line 67:
```typescript
shadow_set_param(s.activeSlot, s.componentKey + ':' + p.key, String(s.enumOverlay.selected));
```

- [ ] **Step 6: Build and typecheck**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && npm run typecheck
```

Expected: 0 errors, `dist/esm/` updated.

- [ ] **Step 7: Run screenshot tests (all still passing — synth model default unchanged)**

```bash
cd /Users/dake/git/cld/movy && node browser-test/screenshot.mjs
```

Expected: 0 failures (default `componentKey = 'synth'` preserves existing behavior).

- [ ] **Step 8: Commit**

```bash
git -C /Users/dake/git/cld/movy add src/model/state.ts src/model/hierarchy.ts src/model/store.ts src/model/viewmodel.ts src/model/index.ts
git -C /Users/dake/git/cld/movy commit -m "$(cat <<'EOF'
refactor: parameterize model by componentKey

All shadow_get/set_param calls now use s.componentKey prefix
instead of hardcoded 'synth:'. Default remains 'synth'.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: ViewModel `isEmpty` + chain-view renderer

**Files:**
- Modify: `src/types/viewmodel.ts`
- Modify: `src/model/viewmodel.ts`
- Create: `src/renderer/chain-view.ts`
- Modify: `src/renderer/knob-view.ts`
- Modify: `build/browser.mjs`

- [ ] **Step 1: Add `isEmpty` to `ViewModel` in `src/types/viewmodel.ts`**

```typescript
export interface ViewModel {
    moduleName:  string;
    bankName:    string;
    bankIndex:   number;
    bankCount:   number;
    rows:        (ParamVM | null)[][];
    touchedSlot: number | null;
    toast:       ToastState | null;
    overlay:     OverlayState | null;
    isEmpty:     boolean;
}
```

- [ ] **Step 2: Set `isEmpty` in `src/model/viewmodel.ts`**

At the end of `buildViewModel`, in the return object add:
```typescript
isEmpty: s.moduleId === '' && s.activeModuleName === '—',
```

- [ ] **Step 3: Create `src/renderer/chain-view.ts`**

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

export function renderChainView(vm: ViewModel, chainIndex: number, jogTouched: boolean): void {
    clear_screen();

    const slot = CHAIN_SLOTS[chainIndex] ?? CHAIN_SLOTS[1];

    if (vm.isEmpty) {
        drawHeader('T1', slot.label, false);
        const msg = 'CLICK JOG: ADD MODULE';
        fontPrint(Math.max(0, Math.floor((W - fontWidth(msg)) / 2)), 28, msg, 1);
        if (jogTouched) drawJogToast('SHIFT+CLICK SWAP  CLICK OPEN');
        return;
    }

    if (vm.toast) {
        drawHeader(vm.toast.fullName, vm.toast.value, true);
    } else {
        const leftW    = fontWidth('T1') + 4;
        const maxRight = W - leftW - 4;
        let right = vm.moduleName;
        while (right.length > 1 && fontWidth(right) > maxRight) right = right.slice(0, -1);
        drawHeader('T1', right, false);
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

- [ ] **Step 4: Add `jogTouched` param + bottom toast to `src/renderer/knob-view.ts`**

```typescript
import type { ViewModel } from '../types/viewmodel.js';
import { fontPrint, fontWidth } from '../font/index.js';
import { drawHeader, drawBankBar } from './header.js';
import { drawKnobRow } from './label.js';
import { drawEnumOverlay } from './overlay.js';
import { W, ROW0_Y, LBL0_Y, ROW1_Y, LBL1_Y, TOAST_Y, TOAST_H } from './layout.js';

function drawJogToast(text: string): void {
    fill_rect(0, TOAST_Y, W, TOAST_H, 1);
    const tw = fontWidth(text);
    const tx = Math.max(1, Math.floor((W - tw) / 2));
    fontPrint(tx, TOAST_Y + 1, text, 0);
}

export function renderKnobsView(vm: ViewModel, jogTouched = false): void {
    clear_screen();

    if (vm.toast) {
        drawHeader(vm.toast.fullName, vm.toast.value, true);
    } else {
        const rightW   = vm.bankName ? fontWidth(vm.bankName) + 4 : 0;
        const maxNameW = W - rightW - 4;
        let dispName   = vm.moduleName;
        while (dispName.length > 1 && fontWidth(dispName) > maxNameW) {
            dispName = dispName.slice(0, -1);
        }
        drawHeader(dispName, vm.bankName || null, false);
    }

    drawBankBar(vm.bankIndex, vm.bankCount);

    const hasParams = vm.rows[0].some(Boolean) || vm.rows[1].some(Boolean);
    if (!hasParams) {
        fontPrint(2, ROW0_Y + 4, 'No params', 1);
    } else {
        drawKnobRow(vm.rows[0], ROW0_Y, LBL0_Y);
        drawKnobRow(vm.rows[1], ROW1_Y, LBL1_Y);
    }

    if (vm.overlay) drawEnumOverlay(vm);
    if (jogTouched) drawJogToast('CLICK JOG: SWAP MODULE');
}
```

- [ ] **Step 5: Add `chain-view.ts` to browser build entry points in `build/browser.mjs`**

```javascript
entryPoints: [
    resolve(root, 'src/model/index.ts'),
    resolve(root, 'src/renderer/knob-view.ts'),
    resolve(root, 'src/renderer/keys-view.ts'),
    resolve(root, 'src/renderer/browse-view.ts'),
    resolve(root, 'src/renderer/chain-view.ts'),
],
```

- [ ] **Step 6: Build and typecheck**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && npm run typecheck
```

Expected: 0 errors, `dist/esm/renderer/chain-view.js` appears.

- [ ] **Step 7: Commit**

```bash
git -C /Users/dake/git/cld/movy add src/types/viewmodel.ts src/model/viewmodel.ts src/renderer/chain-view.ts src/renderer/knob-view.ts build/browser.mjs
git -C /Users/dake/git/cld/movy commit -m "$(cat <<'EOF'
feat: chain-view renderer, isEmpty on ViewModel, jog toast on knobs-view

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: App state, init, tick

**Files:**
- Modify: `src/app/state.ts`
- Modify: `src/app/init.ts`
- Modify: `src/app/tick.ts`

- [ ] **Step 1: Rewrite `src/app/state.ts`**

```typescript
import type { Model } from '../model/index.js';

export const VIEW_KEYS   = 0;
export const VIEW_KNOBS  = 1;
export const VIEW_BROWSE = 2;
export const VIEW_CHAIN  = 3;

export const appState = {
    activeSlot:   0,
    currentView:  VIEW_CHAIN,
    shiftHeld:    false,
    dirty:        true,
    initLedIndex: 0,
    initLedsDone: false,
    chainIndex:   1,
    chainModels:  [] as Model[],
    jogTouched:   false,
    browseOrigin: VIEW_CHAIN as number,
};
```

- [ ] **Step 2: Rewrite `src/app/init.ts`**

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

    appState.chainModels  = CHAIN_SLOTS.map(s => createModel(appState.activeSlot, s.componentKey));
    appState.chainIndex   = 1;
    appState.currentView  = VIEW_CHAIN;
    appState.shiftHeld    = false;
    appState.jogTouched   = false;
    appState.browseOrigin = VIEW_CHAIN;
    appState.dirty        = true;
    appState.initLedIndex = 0;
    appState.initLedsDone = false;

    for (const m of appState.chainModels) m.reset();

    keyboardState.rootNote = 48;
    for (const k of Object.keys(keyboardState.held)) delete keyboardState.held[+k];

    browserState.modules      = [];
    browserState.browseIndex  = 0;
    browserState.componentKey = 'synth';
}
```

- [ ] **Step 3: Rewrite `src/app/tick.ts`**

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

    const activeModel = appState.chainModels[appState.chainIndex];
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
            renderChainView(vm, appState.chainIndex, appState.jogTouched);
            updateKnobLEDs(vm);
        } else {
            const browseTitle = CHAIN_SLOTS[appState.chainIndex]?.label ?? 'Module';
            renderBrowseView(browserState.modules, browserState.browseIndex, browseTitle);
        }
        appState.dirty = false;
    }
}
```

- [ ] **Step 4: Add optional `title` param to `src/renderer/browse-view.ts`**

Change signature:
```typescript
export function renderBrowseView(modules: { name: string }[], browseIndex: number, title = 'Module'): void {
    clear_screen();
    drawHeader(title, null, true);
    // ... rest unchanged
```

- [ ] **Step 5: Build device bundle and typecheck**

```bash
cd /Users/dake/git/cld/movy && npm run build && npm run typecheck
```

Expected: 0 errors, `ui.js` updated.

- [ ] **Step 6: Commit**

```bash
git -C /Users/dake/git/cld/movy add src/app/state.ts src/app/init.ts src/app/tick.ts src/renderer/browse-view.ts
git -C /Users/dake/git/cld/movy commit -m "$(cat <<'EOF'
feat: app wiring for chain view (state, init, tick)

VIEW_CHAIN is now default. Four models created at init.
Only active model ticks per frame.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Browser state/handler + MIDI router

**Files:**
- Modify: `src/browser/state.ts`
- Modify: `src/browser/handler.ts`
- Modify: `src/midi/router.ts`

- [ ] **Step 1: Add `componentKey` to `src/browser/state.ts`**

```typescript
export const browserState = {
    modules:      [] as { id: string; name: string }[],
    browseIndex:  0,
    componentKey: 'synth',
};
```

- [ ] **Step 2: Rewrite `src/browser/handler.ts`**

```typescript
import { browserState } from './state.js';
import { appState, VIEW_BROWSE } from '../app/state.js';
import { CHAIN_SLOTS } from '../chain/config.js';

const MODULES_BASE = '/data/UserData/schwung/modules';

function scanModules(chainIndex: number): { id: string; name: string }[] {
    const slot   = CHAIN_SLOTS[chainIndex];
    const dir    = `${MODULES_BASE}/${slot.scanDir}`;
    const result: { id: string; name: string }[] = [];
    try {
        const [entries] = os.readdir(dir) as [string[], number];
        if (!Array.isArray(entries)) return result;
        for (const entry of entries) {
            if (entry === '.' || entry === '..') continue;
            try {
                const raw = host_read_file(`${dir}/${entry}/module.json`);
                if (!raw) continue;
                const json = JSON.parse(raw) as {
                    id?: string; name?: string;
                    component_type?: string;
                    capabilities?: { component_type?: string };
                };
                const ct = json.component_type || json.capabilities?.component_type;
                if (ct === slot.expectedType) {
                    result.push({ id: json.id || entry, name: json.name || entry });
                }
            } catch {}
        }
    } catch {}
    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
}

export function openBrowser(activeSlot: number, chainIndex: number): void {
    const slot = CHAIN_SLOTS[chainIndex];
    browserState.componentKey = slot.componentKey;
    browserState.modules      = scanModules(chainIndex);
    browserState.browseIndex  = 0;
    const activeId = shadow_get_param(activeSlot, slot.componentKey + '_module') || '';
    const idx = browserState.modules.findIndex(m => m.id === activeId);
    if (idx >= 0) browserState.browseIndex = idx;
    appState.currentView = VIEW_BROWSE;
    appState.dirty = true;
}

export function loadSelectedModule(activeSlot: number): void {
    if (browserState.modules.length === 0) return;
    const mod = browserState.modules[browserState.browseIndex];
    shadow_set_param(activeSlot, browserState.componentKey + ':module', mod.id);
    appState.currentView = appState.browseOrigin;
    appState.dirty = true;
    const idx = CHAIN_SLOTS.findIndex(s => s.componentKey === browserState.componentKey);
    if (idx >= 0) appState.chainModels[idx]?.reload();
}
```

- [ ] **Step 3: Rewrite `src/midi/router.ts`**

```typescript
import { appState, VIEW_KEYS, VIEW_KNOBS, VIEW_BROWSE, VIEW_CHAIN } from '../app/state.js';
import { keyboardState } from '../keyboard/state.js';
import { browserState } from '../browser/state.js';
import { noteOn, noteOff, changeRoot, releaseAllNotes } from '../keyboard/handler.js';
import { openBrowser, loadSelectedModule } from '../browser/handler.js';
import { mlog } from '../log.js';

const PAD_MIN      = MovePads[0];
const PAD_MAX      = MovePads[MovePads.length - 1];
const KNOB_CC_BASE = MoveKnob1;
const NUM_KNOBS    = 8;

export function onMidiMessageInternal(data: number[]): void {
    if (!data || data.length < 3) return;
    const status = data[0];
    const d1     = data[1];
    const d2     = data[2];

    /* Capacitive knob touch: NoteOn note=0..7 */
    if ((status & 0xF0) === 0x90 && d1 < 8) {
        const active = appState.chainModels[appState.chainIndex];
        if (d2 > 0) active?.handleKnobTouch(d1);
        else        active?.handleKnobRelease(d1);
        return;
    }

    /* Main encoder (jog) touch: note=8 */
    if ((status & 0xF0) === 0x90 && d1 === MoveJogTouch) {
        if (appState.currentView === VIEW_CHAIN || appState.currentView === VIEW_KNOBS) {
            appState.jogTouched = d2 > 0;
            appState.dirty = true;
        }
        return;
    }

    /* Other encoder touch (volume knob = note 9) — ignore */
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
        appState.chainModels[appState.chainIndex]?.handleKnobDelta(k, delta);
        return;
    }

    if ((status & 0xF0) !== 0xB0) return;

    /* Shift */
    if (d1 === MoveShift) { appState.shiftHeld = d2 > 0; return; }

    /* Back */
    if (d1 === MoveBack && d2 > 0) {
        appState.jogTouched = false;
        if (appState.currentView === VIEW_BROWSE) {
            appState.currentView = appState.browseOrigin;
            appState.dirty = true;
        } else if (appState.currentView === VIEW_KEYS) {
            appState.currentView = VIEW_CHAIN;
            appState.dirty = true;
        } else if (appState.currentView === VIEW_KNOBS) {
            appState.currentView = VIEW_CHAIN;
            appState.dirty = true;
        } else {
            /* VIEW_CHAIN → exit */
            releaseAllNotes();
            host_exit_module();
        }
        return;
    }

    /* MoveMainButton = jog click */
    if (d1 === MoveMainButton && d2 > 0) {
        if (appState.currentView === VIEW_BROWSE) {
            loadSelectedModule(appState.activeSlot);
        } else if (appState.currentView === VIEW_CHAIN) {
            if (appState.shiftHeld) {
                openBrowser(appState.activeSlot, appState.chainIndex);
                appState.browseOrigin = VIEW_CHAIN;
            } else {
                appState.currentView = VIEW_KNOBS;
                appState.dirty = true;
            }
        } else if (appState.currentView === VIEW_KNOBS) {
            openBrowser(appState.activeSlot, appState.chainIndex);
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
                appState.chainIndex = Math.max(0, Math.min(3, appState.chainIndex + (delta > 0 ? 1 : -1)));
                mlog('chain chainIndex=' + appState.chainIndex);
            } else if (appState.currentView === VIEW_KNOBS) {
                appState.chainModels[appState.chainIndex]?.changePage(delta > 0 ? 1 : -1);
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
            appState.chainIndex = Math.max(0, appState.chainIndex - 1);
        } else if (appState.currentView === VIEW_KNOBS) {
            appState.chainModels[appState.chainIndex]?.changePage(-1);
        }
        appState.dirty = true;
        return;
    }
    if (d1 === MoveRight && d2 > 0) {
        if (appState.currentView === VIEW_CHAIN) {
            appState.chainIndex = Math.min(3, appState.chainIndex + 1);
        } else if (appState.currentView === VIEW_KNOBS) {
            appState.chainModels[appState.chainIndex]?.changePage(1);
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

- [ ] **Step 4: Build full bundle and typecheck**

```bash
cd /Users/dake/git/cld/movy && npm run build && npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 5: Run screenshot tests**

```bash
cd /Users/dake/git/cld/movy && node browser-test/screenshot.mjs
```

Expected: 0 failures (browser tests don't exercise router).

- [ ] **Step 6: Commit**

```bash
git -C /Users/dake/git/cld/movy add src/browser/state.ts src/browser/handler.ts src/midi/router.ts
git -C /Users/dake/git/cld/movy commit -m "$(cat <<'EOF'
feat: browser multi-type scan + full chain navigation in router

Chain view nav: jog/arrows cycle slots, click drills to knobs,
shift+click opens browser. Back returns to chain. MoveUp → keys view.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Browser test harness + screenshots

**Files:**
- Modify: `browser-test/harness.mjs`
- Modify: `browser-test/mock-synth.mjs`
- Modify: `browser-test/screenshot.mjs`

- [ ] **Step 1: Update `browser-test/harness.mjs`**

Make four targeted changes to the harness:

**a) Add `renderChainView` import** (after the existing imports):
```javascript
import { renderChainView } from '../dist/esm/renderer/chain-view.js';
```

**b) Replace the single model with 4 chain models** (replace the `const model = createModel(0);` line and `loadPreset` function):
```javascript
const COMPONENT_KEYS = ['midi_fx1', 'synth', 'fx1', 'fx2'];
const chainModels    = COMPONENT_KEYS.map(k => createModel(0, k));
const model          = chainModels[1];   /* synth — backwards compat for existing test code */
globalThis.__movy_model = model;

function loadPreset(id) {
    mockState = { ...MOCK_SYNTHS[id] };
    for (const m of chainModels) { m.reset(); m.reload(); }
}
```

**c) Add chain-view render globals** (after `__movy_renderBrowseView`):
```javascript
globalThis.__movy_renderChainView = (chainIndex, jogTouched) => {
    const m  = chainModels[chainIndex ?? 1];
    const vm = m.getViewModel();
    renderChainView(vm, chainIndex ?? 1, jogTouched ?? false);
};

globalThis.__movy_renderKnobsJogToast = () => {
    const vm = model.getViewModel();
    renderKnobsView(vm, true);
};
```

All other harness code (`knob drag handlers`, `btn-prev/next`, `tick()`, `updateKnobWidgets`, etc.) is unchanged — they already reference `model` which is still the synth model alias.

- [ ] **Step 2: Add chain view mocks to `browser-test/mock-synth.mjs`**

No new mock entries needed. `chain_synth` and `chain_jog_toast` use `test8` (which has `synth:*` keys but no `fx1:*` keys — so fx1 model will be empty). The existing mocks are sufficient.

- [ ] **Step 3: Add chain view presets to `browser-test/screenshot.mjs`**

Update the `PRESETS` array:
```javascript
const PRESETS = [
    'test8', 'test16', 'test_enum', 'plaits', 'wurl',
    'enum_overlay', 'knob_toast', 'no_params', 'keys_view', 'browse_view',
    'obxd_preset_page', 'obxd_main_page', 'obxd_filter_page',
    'lfo_prefix',
    'chain_synth', 'chain_empty', 'chain_jog_toast', 'knobs_jog_toast',
];
```

Add entries to `syntheticPresets`:
```javascript
const syntheticPresets = {
    enum_overlay:     'plaits',
    knob_toast:       'test8',
    no_params:        'no_params',
    keys_view:        'test8',
    browse_view:      'test8',
    obxd_preset_page: 'obxd_like',
    obxd_main_page:   'obxd_like',
    obxd_filter_page: 'obxd_like',
    chain_synth:      'test8',
    chain_empty:      'test8',   /* fx1 model sees no fx1:* keys → isEmpty */
    chain_jog_toast:  'test8',
    knobs_jog_toast:  'test8',
};
```

Add the new `else if` branches in the rendering section (after the existing `else if (preset === 'obxd_filter_page')` block):

```javascript
} else if (preset === 'chain_synth') {
    await page.evaluate(() => {
        globalThis.__movy_renderChainView?.(1, false);  /* synth, no toast */
    });
} else if (preset === 'chain_empty') {
    await page.evaluate(() => {
        globalThis.__movy_renderChainView?.(2, false);  /* fx1 = empty slot */
    });
} else if (preset === 'chain_jog_toast') {
    await page.evaluate(() => {
        globalThis.__movy_renderChainView?.(1, true);   /* synth + jog toast */
    });
} else if (preset === 'knobs_jog_toast') {
    await page.evaluate(() => {
        globalThis.__movy_renderKnobsJogToast?.();
    });
}
```

- [ ] **Step 4: Build browser modules**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser
```

Expected: `dist/esm/renderer/chain-view.js` present, 0 errors.

- [ ] **Step 5: Regenerate baselines (all 18 presets)**

```bash
cd /Users/dake/git/cld/movy && node browser-test/screenshot.mjs --update
```

Expected: 18 baselines saved/updated. Visually inspect the 4 new screenshots:
- `chain_synth.png` — "T1" header + module name + 4-segment bar at slot 1 + test8 knobs
- `chain_empty.png` — "T1" header + "FX 1" + centered "CLICK JOG: ADD MODULE"
- `chain_jog_toast.png` — same as chain_synth + bottom inverted bar with "SHIFT+CLICK SWAP  CLICK OPEN"
- `knobs_jog_toast.png` — existing knobs view + bottom inverted bar with "CLICK JOG: SWAP MODULE"

- [ ] **Step 6: Run screenshot tests (0 failures)**

```bash
cd /Users/dake/git/cld/movy && node browser-test/screenshot.mjs
```

Expected: 18 passed, 0 failed.

- [ ] **Step 7: Check device reachability and run device tests**

```bash
cd /Users/dake/git/cld/movy && ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && ./scripts/test.sh \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```

- [ ] **Step 8: Commit**

```bash
git -C /Users/dake/git/cld/movy add browser-test/harness.mjs browser-test/screenshot.mjs browser-test/screenshots/baseline/
git -C /Users/dake/git/cld/movy commit -m "$(cat <<'EOF'
test: add chain view screenshot baselines (chain_synth, chain_empty, chain_jog_toast, knobs_jog_toast)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 9: Push**

```bash
git -C /Users/dake/git/cld/movy push
```
