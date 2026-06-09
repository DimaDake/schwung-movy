# File Parameter Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add generic file/wav parameter support: knob renders current filename like an enum, touch opens a directory overlay for quick selection (commit on release), and jog-click opens a full-screen file browser with `..` navigation.

**Architecture:** New `'file'` KnobParam type detected from `chain_params type: "filepath"`. Model stores file paths in parallel `fileValues[]`. Both enum and file overlays produce the same `OverlayState` shape consumed by the unchanged `drawEnumOverlay` renderer. Full browser is a new `VIEW_FILE_BROWSE` with its own state and renderer, wired into the existing router and tick loop.

**Tech Stack:** TypeScript, esbuild bundle, QuickJS globals (`os.readdir`, `os.stat`, `shadow_get_param`, `shadow_set_param`), browser-test harness (`node browser-test/logic.mjs`)

---

### Task 1: Add `'file'` type to KnobParam and `browseHint` to ToastState

**Files:**
- Modify: `src/types/param.ts`
- Modify: `src/types/viewmodel.ts`

- [ ] **Step 1: Update param types**

Replace the contents of `src/types/param.ts`:

```typescript
export interface KnobSlot {
    key:            string;
    short:          string;
    full:           string;
    type:           'float' | 'int' | 'enum' | 'file';
    render?:        'arc' | 'hbar' | 'vbar';
    options?:       string[];
    min?:           number;
    max?:           number;
    fileRoot?:      string;
    fileFilter?:    string[];
    fileStartPath?: string;
}

export interface BankConfig {
    name: string;
    rows: (KnobSlot | null)[][];
}

export interface ModuleConfig {
    id:    string;
    name:  string;
    banks: BankConfig[];
}

export interface KnobParam {
    key:            string;
    label:          string;
    shortLabel:     string | null;
    type:           'float' | 'int' | 'enum' | 'file';
    min:            number;
    max:            number;
    step:           number;
    options:        string[] | null;
    nameKey?:       string;
    renderStyle:    'arc' | 'hbar' | 'vbar';
    fileRoot?:      string;
    fileFilter?:    string[];
    fileStartPath?: string;
}
```

- [ ] **Step 2: Add `browseHint` to ToastState in viewmodel.ts**

In `src/types/viewmodel.ts`, change `ToastState` to:

```typescript
export interface ToastState {
    fullName:   string;
    value:      string;
    browseHint: boolean;
}
```

- [ ] **Step 3: Build to verify types compile**

```bash
cd movy && npm run build 2>&1 | tail -20
```

Expected: build succeeds (or only errors in files not yet updated — fix those by adding `browseHint: false` to the one existing `toast = { ... }` in `src/model/viewmodel.ts`).

- [ ] **Step 4: Commit**

```bash
cd movy && git add src/types/param.ts src/types/viewmodel.ts src/model/viewmodel.ts
git commit -m "feat(types): add 'file' KnobParam type and browseHint to ToastState"
```

---

### Task 2: Add `FileOverlay` and `fileValues` to ModelState

**Files:**
- Modify: `src/model/state.ts`

- [ ] **Step 1: Add FileOverlay interface and new fields to ModelState**

In `src/model/state.ts`, add the `FileOverlay` interface and extend `ModelState` and `createModelState`:

```typescript
import type { KnobParam, ModuleConfig } from '../types/param.js';
import { KNOBS_PER_PAGE, NAME_POLL_TICKS, REFRESH_SUPPRESS_TICKS } from './constants.js';

export interface EnumOverlay {
    slot:     number;
    gi:       number;
    options:  string[];
    selected: number;
}

export interface FileOverlay {
    slot:     number;
    gi:       number;
    items:    string[];   // absolute paths, filtered + sorted
    selected: number;     // index into items
    original: string;     // path at touch time
    accum:    number;     // fractional delta accumulator
}

export interface ModelState {
    activeSlot:          number;
    componentKey:        string;
    knobParams:          (KnobParam | null)[];
    knobValues:          (number | null)[];
    fileValues:          (string | null)[];
    pendingDeltas:       number[];
    enumAccums:          number[];
    knobPage:            number;
    touchedSlots:        number[];
    longPressCountdown:  number;
    enumOverlay:         EnumOverlay | null;
    fileOverlay:         FileOverlay | null;
    activeModuleName:    string;
    moduleId:            string;
    moduleConfig:        ModuleConfig | null;
    bankNames:           string[];
    hierarchyKey:        string;
    pollCountdown:       number;
    refreshParamCursor:  number;
    lastDeltaTick:       number;
    dirty:               boolean;
}

export function createModelState(activeSlot: number, componentKey: string): ModelState {
    return {
        activeSlot,
        componentKey,
        knobParams:          [],
        knobValues:          [],
        fileValues:          [],
        pendingDeltas:       new Array(KNOBS_PER_PAGE).fill(0) as number[],
        enumAccums:          new Array(KNOBS_PER_PAGE).fill(0) as number[],
        knobPage:            0,
        touchedSlots:        [],
        longPressCountdown:  -1,
        enumOverlay:         null,
        fileOverlay:         null,
        activeModuleName:    '—',
        moduleId:            '',
        moduleConfig:        null,
        bankNames:           [],
        hierarchyKey:        '',
        pollCountdown:       NAME_POLL_TICKS,
        refreshParamCursor:  0,
        lastDeltaTick:       -(REFRESH_SUPPRESS_TICKS + 1),
        dirty:               false,
    };
}
```

- [ ] **Step 2: Build to verify**

```bash
cd movy && npm run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd movy && git add src/model/state.ts
git commit -m "feat(model): add FileOverlay and fileValues to ModelState"
```

---

### Task 3: Test scaffolding — mock synth + os mock

**Files:**
- Modify: `browser-test/mock-synth.mjs`
- Modify: `browser-test/logic.mjs`

- [ ] **Step 1: Add `file_param` mock synth to mock-synth.mjs**

Add to the `MOCK_SYNTHS` export object in `browser-test/mock-synth.mjs`:

```javascript
file_param: {
    "synth:name": "SamplerTest",
    "synth:chain_params": JSON.stringify([
        { key: "sample", name: "Sample", type: "filepath",
          root: "/data/UserData/Samples", filter: [".wav"],
          start_path: "/data/UserData/Samples" },
        { key: "vol", name: "Volume", type: "float", min: 0, max: 1, step: 0.01 },
    ]),
    "synth:ui_hierarchy": JSON.stringify({ levels: { root: {
        knobs: ["sample", "vol"],
    }}}),
    "synth:sample": "/data/UserData/Samples/kick.wav",
    "synth:vol":    "0.8",
},
```

- [ ] **Step 2: Add `os` mock and `mockFsEntries` to logic.mjs**

Add to the `/* ── Mock globals ──` section in `browser-test/logic.mjs`, after the existing mock assignments:

```javascript
let mockFsEntries = {};   // path → string[] of filenames

globalThis.os = {
    readdir: (path) => [mockFsEntries[path] ?? [], 0],
    stat:    (path) => {
        // treat paths without an extension as directories
        const mode = path.lastIndexOf('.') > path.lastIndexOf('/') ? 0x8000 : 0x4000;
        return [{ mode }, 0];
    },
};
```

- [ ] **Step 3: Write a failing test for file param detection**

Add to `browser-test/logic.mjs` (before the summary block):

```javascript
/* ── file param detection ─────────────────────────────────────────────────── */

_log('\nTest: file param detected from chain_params type:filepath');

{
    const m = bootModel(MOCK_SYNTHS.file_param);
    const vm = m.getViewModel();
    const sampleKnob = vm.rows[0][0];
    eq('file_param: sample knob type = file', sampleKnob?.type, 'file');
    eq('file_param: vol knob type = float',   vm.rows[0][1]?.type, 'float');
}
```

- [ ] **Step 4: Run test to verify it fails**

```bash
cd movy && node browser-test/logic.mjs 2>&1 | grep -A2 "file param detected"
```

Expected: `✗ file_param: sample knob type = file: expected "file", got ...`

- [ ] **Step 5: Commit scaffolding**

```bash
cd movy && git add browser-test/mock-synth.mjs browser-test/logic.mjs
git commit -m "test: add file_param mock synth and os mock for file overlay tests"
```

---

### Task 4: Detect `type: "filepath"` in hierarchy.ts and init fileValues

**Files:**
- Modify: `src/model/hierarchy.ts`

- [ ] **Step 1: Add `parseFilter` helper and filepath detection in the generic path**

In `src/model/hierarchy.ts`, add the `parseFilter` helper immediately after the imports:

```typescript
function parseFilter(filter: unknown): string[] {
    if (!filter) return [];
    const vals = Array.isArray(filter) ? filter as unknown[] : [filter];
    return (vals as string[])
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
        .map(v => v.toLowerCase().startsWith('.') ? v.toLowerCase() : '.' + v.toLowerCase());
}
```

- [ ] **Step 2: In the generic path, add filepath handling before normal param construction**

In the loop `for (const key of entry.keys)` (around line 233), after:
```typescript
        const cp  = cpMap[key]       ?? {};
        const def = paramDefs[key]   ?? knobInline[key] ?? {};
        const type    = cp.type    || def.type    || 'float';
```

Add immediately after `const type = ...`:

```typescript
        if (type === 'filepath') {
            s.knobParams.push({
                key,
                label:      String(cp.name ?? def.label ?? key),
                shortLabel: null,
                type:       'file',
                min: 0, max: 0, step: 0,
                options:    null,
                renderStyle: 'arc',
                fileRoot:      String(cp.root      ?? '/data/UserData'),
                fileFilter:    parseFilter(cp.filter),
                fileStartPath: String(cp.start_path ?? cp.root ?? '/data/UserData'),
            });
            continue;
        }
```

- [ ] **Step 3: Init fileValues alongside knobValues in both exit paths**

In the custom config early-return block (after `mlog('loadHierarchy: config for ...')`), change:
```typescript
        s.knobValues = new Array(s.knobParams.length).fill(null) as (number | null)[];
        s.dirty = true;
        return;
```
to:
```typescript
        s.knobValues = new Array(s.knobParams.length).fill(null) as (number | null)[];
        s.fileValues = new Array(s.knobParams.length).fill(null) as (string | null)[];
        s.dirty = true;
        return;
```

At the end of the function (generic path), change:
```typescript
    s.knobValues = new Array(s.knobParams.length).fill(null) as (number | null)[];
    mlog('loadHierarchy: ' + s.knobParams.filter(Boolean).length + ' params, ' + bankEntries.length + ' banks');
    s.dirty = true;
```
to:
```typescript
    s.knobValues = new Array(s.knobParams.length).fill(null) as (number | null)[];
    s.fileValues = new Array(s.knobParams.length).fill(null) as (string | null)[];
    mlog('loadHierarchy: ' + s.knobParams.filter(Boolean).length + ' params, ' + bankEntries.length + ' banks');
    s.dirty = true;
```

- [ ] **Step 4: Build and run tests**

```bash
cd movy && npm run build 2>&1 | tail -5 && node browser-test/logic.mjs 2>&1 | grep -E "✓|✗|PASSED|FAILED"
```

Expected: the `file param detected` test now passes; all others still pass.

- [ ] **Step 5: Commit**

```bash
cd movy && git add src/model/hierarchy.ts
git commit -m "feat(hierarchy): detect chain_params type:filepath and create 'file' KnobParam"
```

---

### Task 5: Handle `'file'` type in store.ts

**Files:**
- Modify: `src/model/store.ts`

- [ ] **Step 1: Add early return in applyKnobDelta for file params**

In `applyKnobDelta`, add immediately after `const p = s.knobParams[gi]; if (!p) return;`:

```typescript
    if (p.type === 'file') return;
```

- [ ] **Step 2: Read string value in refreshOneParam for file params**

In `refreshOneParam`, add a branch before the existing `const raw = shadow_get_param(...)` line:

```typescript
    if (p.type === 'file') {
        const path = shadow_get_param(s.activeSlot, s.componentKey + ':' + p.key);
        if (path !== s.fileValues[i]) {
            s.fileValues[i] = path;
            s.dirty = true;
        }
        return;
    }
```

- [ ] **Step 3: Return `'...'` for file in formatValue**

In `formatValue`, add before the existing `if (p.type === 'enum')` check:

```typescript
    if (p.type === 'file') return '...';
```

- [ ] **Step 4: Build and run all tests**

```bash
cd movy && npm run build 2>&1 | tail -5 && node browser-test/logic.mjs 2>&1 | grep -E "✓|✗|PASSED|FAILED"
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd movy && git add src/model/store.ts
git commit -m "feat(store): handle file param type in refresh, delta, and formatValue"
```

---

### Task 6: File overlay — touch, delta, release, and model helpers

**Files:**
- Modify: `src/model/index.ts`

- [ ] **Step 1: Add file helpers at top of index.ts**

Add these functions directly after the import block in `src/model/index.ts`:

```typescript
function fileBasename(path: string): string {
    const i = path.lastIndexOf('/');
    return i >= 0 ? path.slice(i + 1) : path;
}

function fileDirname(path: string): string {
    if (!path) return '/';
    const i = path.lastIndexOf('/');
    if (i <= 0) return '/';
    return path.slice(0, i);
}

function scanFiles(dir: string, filter: string[]): string[] {
    try {
        const [entries] = (os as { readdir(p: string): [string[], number] }).readdir(dir);
        if (!Array.isArray(entries)) return [];
        return entries
            .filter(n => n !== '.' && n !== '..' && !n.startsWith('.'))
            .filter(n => {
                if (filter.length === 0) return true;
                const lower = n.toLowerCase();
                return filter.some(ext => lower.endsWith(ext));
            })
            .sort()
            .map(n => dir + '/' + n);
    } catch { return []; }
}
```

- [ ] **Step 2: Clear fileOverlay on touch; open file overlay for 'file' params**

In `handleKnobTouch(k)`, add `if (s.fileOverlay) { s.fileOverlay = null; s.dirty = true; }` right after the existing `if (s.enumOverlay)` clear, and add the file overlay block after the existing `longPressCountdown` assignment:

```typescript
        handleKnobTouch(k: number): void {
            if (s.enumOverlay) { s.enumOverlay = null; s.dirty = true; }
            if (s.fileOverlay) { s.fileOverlay = null; s.dirty = true; }
            const idx = s.touchedSlots.indexOf(k);
            if (idx >= 0) s.touchedSlots.splice(idx, 1);
            s.touchedSlots.push(k);
            s.dirty = true;
            const gi = s.knobPage * KNOBS_PER_PAGE + k;
            const p  = s.knobParams[gi];
            if (p && p.type === 'enum' && p.options && p.options.length > 6) {
                s.enumOverlay = { slot: k, gi, options: p.options, selected: Math.round((s.knobValues[gi] ?? 0) as number) };
                s.enumAccums[k] = 0;
            }
            if (p && p.type === 'file') {
                const currentPath = s.fileValues[gi] ?? '';
                const scanDir     = currentPath ? fileDirname(currentPath) : (p.fileStartPath ?? '/data/UserData');
                const items       = scanFiles(scanDir, p.fileFilter ?? []);
                if (items.length > 0) {
                    const selIdx = currentPath ? items.indexOf(currentPath) : 0;
                    s.fileOverlay = {
                        slot: k, gi, items,
                        selected: selIdx >= 0 ? selIdx : 0,
                        original: currentPath, accum: 0,
                    };
                }
            }
            s.longPressCountdown = -1;
        },
```

- [ ] **Step 3: Route delta through fileOverlay**

In `handleKnobDelta(k, delta)`, add a file overlay branch right after the existing enum overlay block (after the `return;` that ends the enum block):

```typescript
            if (s.fileOverlay && k === s.fileOverlay.slot) {
                s.fileOverlay.accum += delta / ENUM_DELTA_DIV;
                const step = Math.trunc(s.fileOverlay.accum);
                if (step !== 0) {
                    s.fileOverlay.accum -= step;
                    const n    = s.fileOverlay.items.length;
                    const next = Math.max(0, Math.min(n - 1, s.fileOverlay.selected + step));
                    if (next !== s.fileOverlay.selected) {
                        s.fileOverlay.selected = next;
                        s.dirty = true;
                    }
                }
                return;
            }
```

- [ ] **Step 4: Commit fileOverlay on release**

In `handleKnobRelease(k?)`, add right after the existing enum overlay commit block (the `if (s.enumOverlay && ...)` block):

```typescript
            if (s.fileOverlay && (k === undefined || k === s.fileOverlay.slot)) {
                const p = s.knobParams[s.fileOverlay.gi];
                if (p && s.fileOverlay.items.length > 0) {
                    const path = s.fileOverlay.items[s.fileOverlay.selected];
                    s.fileValues[s.fileOverlay.gi] = path;
                    shadow_set_param(s.activeSlot, s.componentKey + ':' + p.key, path);
                }
                s.fileOverlay = null;
            }
```

- [ ] **Step 5: Add model helper methods**

Add these to the returned object of `createModel`, after `reload()`:

```typescript
        getFileBrowseTarget(): { key: string; gi: number; root: string; filter: string[]; startPath: string; currentPath: string | null } | null {
            const primary = primarySlot();
            if (primary < 0) return null;
            const gi = s.knobPage * KNOBS_PER_PAGE + primary;
            const p  = s.knobParams[gi];
            if (!p || p.type !== 'file') return null;
            return {
                key:         p.key,
                gi,
                root:        p.fileRoot      ?? '/data/UserData',
                filter:      p.fileFilter    ?? [],
                startPath:   p.fileStartPath ?? '/data/UserData',
                currentPath: s.fileValues[gi] ?? null,
            };
        },

        clearFileOverlay(): void { s.fileOverlay = null; s.dirty = true; },

        setFileValue(gi: number, path: string): void {
            if (gi >= 0 && gi < s.fileValues.length) {
                s.fileValues[gi] = path;
                s.dirty = true;
            }
        },

        getComponentKey(): string { return s.componentKey; },
```

- [ ] **Step 6: Write tests for file overlay in logic.mjs**

Add to `browser-test/logic.mjs` after the file param detection test:

```javascript
/* ── file overlay behavior ────────────────────────────────────────────────── */

_log('\nTest: file overlay opens on touch with dir scan');

{
    mockFsEntries['/data/UserData/Samples'] = ['hat.wav', 'kick.wav', 'snare.wav'];
    const m  = bootModel(MOCK_SYNTHS.file_param);
    for (let i = 0; i < 20; i++) m.tick();  // let refreshOneParam pick up fileValues
    m.handleKnobTouch(0);
    const vm = m.getViewModel();
    eq('file overlay: 3 items',         vm.overlay?.options.length, 3);
    eq('file overlay: slot = 0',        vm.overlay?.slot, 0);
    eq('file overlay: selected = kick', vm.overlay?.options[vm.overlay.selected], 'kick.wav');
}

_log('\nTest: file overlay scrolls with knob delta');

{
    mockFsEntries['/data/UserData/Samples'] = ['hat.wav', 'kick.wav', 'snare.wav'];
    const m = bootModel(MOCK_SYNTHS.file_param);
    for (let i = 0; i < 20; i++) m.tick();
    m.handleKnobTouch(0);
    m.handleKnobDelta(0, 4);  // ENUM_DELTA_DIV=4 → 1 step
    eq('file overlay: moved to snare', m.getViewModel().overlay?.selected, 2);
    m.handleKnobDelta(0, -4);
    eq('file overlay: moved back to kick', m.getViewModel().overlay?.selected, 1);
}

_log('\nTest: file overlay commits on release');

{
    mockFsEntries['/data/UserData/Samples'] = ['hat.wav', 'kick.wav', 'snare.wav'];
    const m = bootModel({ ...MOCK_SYNTHS.file_param });
    for (let i = 0; i < 20; i++) m.tick();
    m.handleKnobTouch(0);
    m.handleKnobDelta(0, 8);  // 2 steps → hat.wav (index 0 + 2 = 2 → snare… wait, sorted: hat[0], kick[1], snare[2]; current=kick → idx 1; +2 → idx 3 clamped to 2 = snare)
    m.handleKnobRelease(0);
    eq('file overlay: committed to shadow', mockState['synth:sample'], '/data/UserData/Samples/snare.wav');
    eq('file overlay: dismissed',          m.getViewModel().overlay, null);
}
```

- [ ] **Step 7: Build and run tests**

```bash
cd movy && npm run build 2>&1 | tail -5 && node browser-test/logic.mjs 2>&1 | grep -E "✓|✗|PASSED|FAILED"
```

Expected: file overlay tests pass; all others still pass.

- [ ] **Step 8: Commit**

```bash
cd movy && git add src/model/index.ts browser-test/logic.mjs
git commit -m "feat(model): file overlay open/scroll/commit, getFileBrowseTarget, clearFileOverlay, setFileValue"
```

---

### Task 7: ViewModel — file overlay mapping and browseHint toast

**Files:**
- Modify: `src/model/viewmodel.ts`

- [ ] **Step 1: Add basename helper**

Add at top of `src/model/viewmodel.ts`, after imports:

```typescript
function basename(path: string): string {
    const i = path.lastIndexOf('/');
    return i >= 0 ? path.slice(i + 1) : path;
}
```

- [ ] **Step 2: Map fileOverlay → OverlayState and file display value**

In `buildViewModel`, change the `const dv = ...` computation inside the rows loop from:

```typescript
            const dv = p.nameKey
                ? (shadow_get_param(s.activeSlot, s.componentKey + ':' + p.nameKey) ?? formatValue(p, v))
                : formatValue(p, v);
```

to:

```typescript
            const dv = p.type === 'file'
                ? (s.fileValues[gi] ? basename(s.fileValues[gi] as string) : '—')
                : p.nameKey
                    ? (shadow_get_param(s.activeSlot, s.componentKey + ':' + p.nameKey) ?? formatValue(p, v))
                    : formatValue(p, v);
```

- [ ] **Step 3: Set browseHint in toast**

Change the toast block from:

```typescript
        if (p) {
            const tv = p.nameKey
                ? (shadow_get_param(s.activeSlot, s.componentKey + ':' + p.nameKey) ?? formatValue(p, s.knobValues[gi]))
                : formatValue(p, s.knobValues[gi]);
            toast = { fullName: p.label, value: tv };
        }
```

to:

```typescript
        if (p) {
            let tv: string;
            if (p.type === 'file') {
                tv = s.fileValues[gi] ? basename(s.fileValues[gi] as string) : '—';
            } else if (p.nameKey) {
                tv = shadow_get_param(s.activeSlot, s.componentKey + ':' + p.nameKey) ?? formatValue(p, s.knobValues[gi]);
            } else {
                tv = formatValue(p, s.knobValues[gi]);
            }
            toast = { fullName: p.label, value: tv, browseHint: p.type === 'file' };
        }
```

- [ ] **Step 4: Map fileOverlay to OverlayState (identical shape to enumOverlay)**

Change the `overlay:` line in the return value from:

```typescript
        overlay:     s.enumOverlay
            ? { slot: s.enumOverlay.slot, options: s.enumOverlay.options, selected: s.enumOverlay.selected }
            : null,
```

to:

```typescript
        overlay: s.enumOverlay
            ? { slot: s.enumOverlay.slot, options: s.enumOverlay.options, selected: s.enumOverlay.selected }
            : s.fileOverlay
            ? { slot: s.fileOverlay.slot, options: s.fileOverlay.items.map(p => basename(p).slice(0, 12)), selected: s.fileOverlay.selected }
            : null,
```

- [ ] **Step 5: Fix the existing non-file toast to include `browseHint: false`**

If not already done in Task 1, ensure any other `toast = { fullName, value }` assignments in the file have `browseHint: false`.

- [ ] **Step 6: Write tests**

Add to `browser-test/logic.mjs`:

```javascript
/* ── viewmodel: file display value and browseHint ─────────────────────────── */

_log('\nTest: file knob displayValue = basename of current path');

{
    const m = bootModel(MOCK_SYNTHS.file_param);
    for (let i = 0; i < 20; i++) m.tick();
    const vm = m.getViewModel();
    eq('file knob displayValue = kick.wav', vm.rows[0][0]?.displayValue, 'kick.wav');
}

_log('\nTest: browseHint = true when file param is primary touched slot');

{
    mockFsEntries['/data/UserData/Samples'] = ['kick.wav'];
    const m = bootModel(MOCK_SYNTHS.file_param);
    for (let i = 0; i < 20; i++) m.tick();
    m.handleKnobTouch(0);
    eq('toast.browseHint = true',            m.getViewModel().toast?.browseHint, true);
    eq('toast.fullName = Sample',            m.getViewModel().toast?.fullName, 'Sample');
}

_log('\nTest: browseHint = false for non-file param touch');

{
    const m = bootModel(MOCK_SYNTHS.test8);
    m.handleKnobTouch(0);
    eq('toast.browseHint = false for float', m.getViewModel().toast?.browseHint, false);
}
```

- [ ] **Step 7: Build and run tests**

```bash
cd movy && npm run build 2>&1 | tail -5 && node browser-test/logic.mjs 2>&1 | grep -E "✓|✗|PASSED|FAILED"
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
cd movy && git add src/model/viewmodel.ts browser-test/logic.mjs
git commit -m "feat(viewmodel): file overlay → OverlayState, file display value, browseHint toast"
```

---

### Task 8: Render `browseHint` toast in knob-view

**Files:**
- Modify: `src/renderer/knob-view.ts`

- [ ] **Step 1: Replace jog toast logic with browseHint priority**

In `renderKnobsView`, change:

```typescript
    if (jogTouched) drawJogToast('CLICK JOG: SWAP MODULE');
```

to:

```typescript
    if (vm.toast?.browseHint) drawJogToast('JOG: BROWSE');
    else if (jogTouched)      drawJogToast('CLICK JOG: SWAP MODULE');
```

- [ ] **Step 2: Build and run all tests (screenshot baseline update needed if UI changed)**

```bash
cd movy && npm run build 2>&1 | tail -5 && node browser-test/logic.mjs 2>&1 | tail -3
```

The screenshot baseline for `VIEW_KNOBS` with a touched knob will need updating since the jog-toast condition changed. Run:

```bash
cd movy && node browser-test/screenshot.mjs --update 2>&1 | tail -5
node browser-test/screenshot.mjs 2>&1 | tail -3
```

Expected: 0 failures.

- [ ] **Step 3: Commit**

```bash
cd movy && git add src/renderer/knob-view.ts
git commit -m "feat(renderer): show JOG: BROWSE toast when file param is touched"
```

---

### Task 9: Add `VIEW_FILE_BROWSE`, `FileBrowserState` to app/state and wire tick/init

**Files:**
- Modify: `src/app/state.ts`
- Modify: `src/app/tick.ts`
- Modify: `src/app/init.ts`

- [ ] **Step 1: Add VIEW_FILE_BROWSE and FileBrowserState to app/state.ts**

In `src/app/state.ts`, add:

```typescript
import type { Model } from '../model/index.js';

export const VIEW_KEYS        = 0;
export const VIEW_KNOBS       = 1;
export const VIEW_BROWSE      = 2;
export const VIEW_CHAIN       = 3;
export const VIEW_FILE_BROWSE = 4;

export interface FileBrowserItem {
    name:  string;
    path:  string;
    isDir: boolean;
}

export interface FileBrowserState {
    paramSlot:     number;
    componentKey:  string;
    paramKey:      string;
    gi:            number;
    root:          string;
    filter:        string[];
    currentDir:    string;
    items:         FileBrowserItem[];
    selectedIndex: number;
}

export const appState = {
    activeSlot:        0,
    currentView:       VIEW_CHAIN,
    shiftHeld:         false,
    dirty:             true,
    initLedIndex:      0,
    initLedsDone:      false,
    trackChainIndex:   [1, 1, 1, 1] as number[],
    trackView:         [3, 3, 3, 3] as number[],
    trackModels:       [] as Model[][],
    jogTouched:        false,
    browseOrigin:      VIEW_CHAIN as number,
    fileBrowserState:  null as FileBrowserState | null,
};
```

- [ ] **Step 2: Add `renderFileBrowseView` dispatch in tick.ts**

In `src/app/tick.ts`, add the import and the render case:

```typescript
import { renderFileBrowseView } from '../renderer/file-browse-view.js';
```

In the render dispatch block, change the `else {` branch (currently renders `renderBrowseView`) to:

```typescript
        } else if (appState.currentView === VIEW_FILE_BROWSE) {
            if (appState.fileBrowserState) renderFileBrowseView(appState.fileBrowserState);
        } else {
            const browseTitle = CHAIN_SLOTS[chainIdx]?.label ?? 'Module';
            renderBrowseView(browserState.modules, browserState.browseIndex, browseTitle);
        }
```

Also add `VIEW_FILE_BROWSE` to the imports from `'./state.js'`:
```typescript
import { appState, VIEW_KEYS, VIEW_KNOBS, VIEW_BROWSE, VIEW_CHAIN, VIEW_FILE_BROWSE } from './state.js';
```

- [ ] **Step 3: Init fileBrowserState in init.ts**

In `src/app/init.ts`, add inside `init()`:

```typescript
    appState.fileBrowserState = null;
```

- [ ] **Step 4: Build**

```bash
cd movy && npm run build 2>&1 | tail -5
```

Expected: fails on missing `renderFileBrowseView` import (renderer not yet created) — that's fine, will be fixed in Task 10. If you want it to compile now, create a stub:

```bash
echo 'import type { FileBrowserState } from "../app/state.js"; export function renderFileBrowseView(_: FileBrowserState): void {}' > src/renderer/file-browse-view.ts
npm run build 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
cd movy && git add src/app/state.ts src/app/tick.ts src/app/init.ts src/renderer/file-browse-view.ts
git commit -m "feat(app): add VIEW_FILE_BROWSE, FileBrowserState, and tick/init wiring"
```

---

### Task 10: Implement `renderFileBrowseView`

**Files:**
- Modify: `src/renderer/file-browse-view.ts`

- [ ] **Step 1: Write full renderer**

Replace `src/renderer/file-browse-view.ts`:

```typescript
import type { FileBrowserState } from '../app/state.js';
import { fontPrint, FONT_HEIGHT } from '../font/index.js';
import { drawHeader } from './header.js';
import { W, HEADER_H } from './layout.js';

export function renderFileBrowseView(state: FileBrowserState): void {
    clear_screen();

    const dir = state.currentDir;
    const dirLabel = dir.length > 18 ? '...' + dir.slice(-15) : dir;
    drawHeader(dirLabel, null, true);

    const LIST_TOP = HEADER_H + 2;
    const LIST_BOT = 64;
    const rowH     = FONT_HEIGHT + 2;

    const { items, selectedIndex } = state;
    if (items.length === 0) {
        fontPrint(2, LIST_TOP, 'No files', 1);
        return;
    }

    const visible  = Math.floor((LIST_BOT - LIST_TOP) / rowH);
    const halfVis  = Math.floor(visible / 2);
    const startIdx = Math.max(0, Math.min(selectedIndex - halfVis, items.length - visible));

    for (let i = 0; i < visible; i++) {
        const idx = startIdx + i;
        if (idx >= items.length) break;
        const item  = items[idx];
        const label = item.isDir ? '>' + item.name : item.name;
        const y     = LIST_TOP + i * rowH;
        if (idx === selectedIndex) {
            fill_rect(0, y - 1, W, rowH, 1);
            fontPrint(2, y, label, 0);
        } else {
            fontPrint(2, y, label, 1);
        }
    }
}
```

- [ ] **Step 2: Build**

```bash
cd movy && npm run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Update screenshot baselines if needed**

```bash
cd movy && node browser-test/screenshot.mjs 2>&1 | tail -3
```

If failures: `node browser-test/screenshot.mjs --update && node browser-test/screenshot.mjs`

- [ ] **Step 4: Commit**

```bash
cd movy && git add src/renderer/file-browse-view.ts
git commit -m "feat(renderer): add renderFileBrowseView — header + scrollable list, no footer"
```

---

### Task 11: File browser logic — openFileBrowser, navigate, activate

**Files:**
- Create: `src/browser/file-handler.ts`

- [ ] **Step 1: Create browser/file-handler.ts**

```typescript
import type { FileBrowserItem, FileBrowserState } from '../app/state.js';
import { appState, VIEW_FILE_BROWSE } from '../app/state.js';

function isDir(path: string): boolean {
    try {
        const [st] = (os as { stat(p: string): [{ mode: number }, number] }).stat(path);
        return (st.mode & 0xF000) === 0x4000;
    } catch { return false; }
}

function basename(path: string): string {
    const i = path.lastIndexOf('/');
    return i >= 0 ? path.slice(i + 1) : path;
}

function dirname(path: string): string {
    if (!path) return '/';
    const i = path.lastIndexOf('/');
    if (i <= 0) return '/';
    return path.slice(0, i);
}

function scanDir(dir: string, root: string, filter: string[]): FileBrowserItem[] {
    const items: FileBrowserItem[] = [];
    if (dir !== root) {
        items.push({ name: '..', path: dirname(dir), isDir: true });
    }
    try {
        const [entries] = (os as { readdir(p: string): [string[], number] }).readdir(dir);
        if (!Array.isArray(entries)) return items;
        const fileItems: FileBrowserItem[] = [];
        const dirItems:  FileBrowserItem[] = [];
        for (const name of entries) {
            if (name === '.' || name === '..') continue;
            const path  = dir + '/' + name;
            const d     = isDir(path);
            if (!d && filter.length > 0) {
                const lower = name.toLowerCase();
                if (!filter.some(ext => lower.endsWith(ext))) continue;
            }
            (d ? dirItems : fileItems).push({ name, path, isDir: d });
        }
        dirItems.sort((a, b)  => a.name.localeCompare(b.name));
        fileItems.sort((a, b) => a.name.localeCompare(b.name));
        items.push(...dirItems, ...fileItems);
    } catch {}
    return items;
}

export function openFileBrowser(
    paramSlot:    number,
    componentKey: string,
    paramKey:     string,
    gi:           number,
    root:         string,
    filter:       string[],
    startPath:    string,
    currentPath:  string | null,
): void {
    const startDir = currentPath ? dirname(currentPath) : (startPath || root);
    const items    = scanDir(startDir, root, filter);

    let selectedIndex = 0;
    if (currentPath) {
        const idx = items.findIndex(it => it.path === currentPath);
        if (idx >= 0) selectedIndex = idx;
    }

    appState.fileBrowserState = {
        paramSlot, componentKey, paramKey, gi,
        root, filter, currentDir: startDir,
        items, selectedIndex,
    };
    appState.currentView = VIEW_FILE_BROWSE;
    appState.dirty = true;
}

export function navigateFileBrowser(delta: number): void {
    const state = appState.fileBrowserState;
    if (!state) return;
    state.selectedIndex = Math.max(0, Math.min(state.items.length - 1, state.selectedIndex + delta));
    appState.dirty = true;
}

export function activateFileBrowserItem(): void {
    const state = appState.fileBrowserState;
    if (!state) return;
    const item = state.items[state.selectedIndex];
    if (!item) return;

    if (item.isDir) {
        const newDir = item.path;
        state.items      = scanDir(newDir, state.root, state.filter);
        state.currentDir = newDir;
        state.selectedIndex = 0;
        appState.dirty = true;
    } else {
        shadow_set_param(state.paramSlot, state.componentKey + ':' + state.paramKey, item.path);
        const chainIdx = appState.trackChainIndex[state.paramSlot];
        appState.trackModels[state.paramSlot]?.[chainIdx]?.setFileValue(state.gi, item.path);
        appState.fileBrowserState = null;
        appState.currentView      = appState.browseOrigin;
        appState.dirty = true;
    }
}
```

- [ ] **Step 2: Build**

```bash
cd movy && npm run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd movy && git add src/browser/file-handler.ts
git commit -m "feat(browser): add openFileBrowser, navigateFileBrowser, activateFileBrowserItem"
```

---

### Task 12: Wire file browser into the MIDI router

**Files:**
- Modify: `src/midi/router.ts`

- [ ] **Step 1: Add imports**

Add to the imports in `src/midi/router.ts`:

```typescript
import { openFileBrowser, navigateFileBrowser, activateFileBrowserItem } from '../browser/file-handler.js';
```

And add `VIEW_FILE_BROWSE` to the state import:

```typescript
import { appState, VIEW_KEYS, VIEW_KNOBS, VIEW_BROWSE, VIEW_CHAIN, VIEW_FILE_BROWSE } from '../app/state.js';
```

- [ ] **Step 2: Handle jog touch — don't set jogTouched for VIEW_FILE_BROWSE**

The existing jog-touch handler checks `VIEW_CHAIN || VIEW_KNOBS`. No change needed — file browse is excluded by default.

- [ ] **Step 3: Add VIEW_FILE_BROWSE to Back handler**

Change the `MoveBack` block from:

```typescript
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
```

to:

```typescript
    if (d1 === MoveBack && d2 > 0) {
        appState.jogTouched = false;
        if (appState.currentView === VIEW_BROWSE) {
            appState.currentView = appState.browseOrigin;
            appState.dirty = true;
        } else if (appState.currentView === VIEW_FILE_BROWSE) {
            appState.fileBrowserState = null;
            appState.currentView      = appState.browseOrigin;
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
```

- [ ] **Step 4: Dispatch jog click for VIEW_FILE_BROWSE and file params in VIEW_KNOBS**

Change the `MoveMainButton` block from:

```typescript
    if (d1 === MoveMainButton && d2 > 0) {
        if (appState.currentView === VIEW_BROWSE) {
            loadSelectedModule(appState.activeSlot);
        } else if (appState.currentView === VIEW_CHAIN) {
            ...
        } else if (appState.currentView === VIEW_KNOBS) {
            openBrowser(appState.activeSlot, chainIndex());
            appState.browseOrigin = VIEW_KNOBS;
        } else if (appState.currentView === VIEW_KEYS) {
            appState.currentView = VIEW_CHAIN;
            appState.dirty = true;
        }
        return;
    }
```

to:

```typescript
    if (d1 === MoveMainButton && d2 > 0) {
        if (appState.currentView === VIEW_BROWSE) {
            loadSelectedModule(appState.activeSlot);
        } else if (appState.currentView === VIEW_FILE_BROWSE) {
            activateFileBrowserItem();
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
            const fileTarget = activeModel()?.getFileBrowseTarget() ?? null;
            if (fileTarget) {
                activeModel()?.clearFileOverlay();
                openFileBrowser(
                    appState.activeSlot,
                    activeModel()!.getComponentKey(),
                    fileTarget.key,
                    fileTarget.gi,
                    fileTarget.root,
                    fileTarget.filter,
                    fileTarget.startPath,
                    fileTarget.currentPath,
                );
                appState.browseOrigin = VIEW_KNOBS;
            } else {
                openBrowser(appState.activeSlot, chainIndex());
                appState.browseOrigin = VIEW_KNOBS;
            }
        } else if (appState.currentView === VIEW_KEYS) {
            appState.currentView = VIEW_CHAIN;
            appState.dirty = true;
        }
        return;
    }
```

- [ ] **Step 5: Add jog rotation for VIEW_FILE_BROWSE**

In the `MoveMainKnob` block, add:

```typescript
        } else if (appState.currentView === VIEW_FILE_BROWSE) {
            navigateFileBrowser(delta);
```

So the full block reads:

```typescript
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
            } else if (appState.currentView === VIEW_FILE_BROWSE) {
                navigateFileBrowser(delta);
            }
            appState.dirty = true;
        }
        return;
    }
```

- [ ] **Step 6: Build and run all tests**

```bash
cd movy && npm run build 2>&1 | tail -5 && node browser-test/logic.mjs 2>&1 | tail -5
```

Expected: build succeeds, all logic tests pass.

- [ ] **Step 7: Run screenshot tests**

```bash
cd movy && node browser-test/screenshot.mjs 2>&1 | tail -3
```

Expected: 0 failures (or update baselines if any rendering changed).

- [ ] **Step 8: Commit**

```bash
cd movy && git add src/midi/router.ts
git commit -m "feat(router): wire VIEW_FILE_BROWSE and file-param jog-click dispatch"
```

---

### Task 13: Device test and final push

**Files:**
- No new files

- [ ] **Step 1: Run all local tests**

```bash
cd movy && node browser-test/logic.mjs && node browser-test/screenshot.mjs && node browser-test/perf.mjs
```

Expected: 0 failures across all three.

- [ ] **Step 2: Check device reachability and run device test**

```bash
cd movy && ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null && ./scripts/test.sh || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```

If device is online, expected: test passes. If offline: report to user in CAPS.

- [ ] **Step 3: Push**

```bash
cd movy && git push
```
