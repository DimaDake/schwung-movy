# Generic Module Multi-Level Parameter Pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make movy render all parameter banks from any module's `ui_hierarchy` as separate pages, with a preset selector knob (enum square style), and fix label shortening for long single-word names — all without requiring a custom JSON config.

**Architecture:** All changes are isolated to the no-config fallback path in `hierarchy.ts` plus small additive changes to `types/param.ts`, `model/state.ts`, `model/viewmodel.ts`, and `renderer/shorten.ts`. The custom `moduleConfig` path is untouched. New `bankNames: string[]` on `ModelState` carries page names from hierarchy to viewmodel. New `nameKey?: string` on `KnobParam` lets viewmodel fetch a live display value for the preset knob.

**Tech Stack:** TypeScript, esbuild (device bundle), browser screenshot tests (puppeteer + pixelmatch), SSH device tests.

---

### Task 1: Fix single-word label shortening

**Files:**
- Modify: `src/renderer/shorten.ts`

- [ ] **Step 1: Verify the bug**

```bash
cd movy && node -e "
function autoShorten(label, max) {
  const up = label.toUpperCase().replace(/_/g, ' ').trim();
  if (up.length <= max) return up;
  const words = up.split(/\s+/);
  if (words[0].length <= max) return words[0];
  const acronym = words.map(w => w[0]).join('');
  if (acronym.length <= max) return acronym;
  return up.replace(/\s+/g, '').substring(0, max);
}
console.log(autoShorten('Cutoff', 5));      // C  ← bug
console.log(autoShorten('Resonance', 5));   // R  ← bug
console.log(autoShorten('LFO Rate', 5));    // LFO  ← correct, unchanged
"
```

- [ ] **Step 2: Apply the fix**

Add one line to `src/renderer/shorten.ts` — a single-word early exit before the acronym step:

```typescript
export function autoShorten(label: string, maxChars: number): string {
    const up = label.toUpperCase().replace(/_/g, ' ').trim();
    if (up.length <= maxChars) return up;
    const words = up.split(/\s+/);
    if (words.length === 1) return words[0].substring(0, maxChars);   // ← add this
    if (words[0].length <= maxChars) return words[0];
    const acronym = words.map(w => w[0]).join('');
    if (acronym.length <= maxChars) return acronym;
    return up.replace(/\s+/g, '').substring(0, maxChars);
}
```

- [ ] **Step 3: Verify the fix**

```bash
node -e "
function autoShorten(label, max) {
  const up = label.toUpperCase().replace(/_/g, ' ').trim();
  if (up.length <= max) return up;
  const words = up.split(/\s+/);
  if (words.length === 1) return words[0].substring(0, max);
  if (words[0].length <= max) return words[0];
  const acronym = words.map(w => w[0]).join('');
  if (acronym.length <= max) return acronym;
  return up.replace(/\s+/g, '').substring(0, max);
}
console.log(autoShorten('Cutoff', 5));      // CUTOF
console.log(autoShorten('Resonance', 5));   // RESON
console.log(autoShorten('Portamento', 5));  // PORTA
console.log(autoShorten('LFO Rate', 5));    // LFO   (unchanged)
console.log(autoShorten('Filter Env', 5));  // FE    (unchanged)
"
```

Expected: `CUTOF`, `RESON`, `PORTA`, `LFO`, `FE`

- [ ] **Step 4: Build and run screenshot tests**

```bash
cd movy && npm run build:browser && cd browser-test && node screenshot.mjs
```

Expected: 0 failures. The existing mock synths use short labels (`"Freq"`, `"Atk"`, etc.) so no visible pixel change. If any test fails with a diff, run `node screenshot.mjs --update` then rerun — the fix is a strict improvement, a label mismatch just means a previously-wrong baseline.

- [ ] **Step 5: Commit**

```bash
cd movy && git add src/renderer/shorten.ts
git commit -m "$(cat <<'EOF'
fix: truncate long single-word labels instead of collapsing to one letter

Cutoff → CUTOF, Resonance → RESON. Multi-word labels unaffected.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Add nameKey to KnobParam and bankNames to ModelState

**Files:**
- Modify: `src/types/param.ts`
- Modify: `src/model/state.ts`

- [ ] **Step 1: Add nameKey to KnobParam**

Full replacement of `src/types/param.ts`:

```typescript
export interface KnobSlot {
    key:   string;
    short: string;
    full:  string;
    type:  'float' | 'int' | 'enum';
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
    key:        string;
    label:      string;
    shortLabel: string | null;
    type:       'float' | 'int' | 'enum';
    min:        number;
    max:        number;
    step:       number;
    options:    string[] | null;
    nameKey?:   string;
}
```

- [ ] **Step 2: Add bankNames to ModelState**

Full replacement of `src/model/state.ts`:

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

export function createModelState(activeSlot: number): ModelState {
    return {
        activeSlot,
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

- [ ] **Step 3: Typecheck**

```bash
cd movy && npm run typecheck
```

Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add src/types/param.ts src/model/state.ts
git commit -m "$(cat <<'EOF'
feat: add KnobParam.nameKey and ModelState.bankNames type fields

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Update viewmodel to use bankNames and nameKey

**Files:**
- Modify: `src/model/viewmodel.ts`

- [ ] **Step 1: Rewrite viewmodel.ts**

Full replacement of `src/model/viewmodel.ts`:

```typescript
import type { ViewModel } from '../types/viewmodel.js';
import type { ModelState } from './state.js';
import { formatValue } from './store.js';
import { KNOBS_PER_PAGE, KNOBS_PER_ROW } from './constants.js';
import { autoShorten } from '../renderer/shorten.js';

export function buildViewModel(s: ModelState): ViewModel {
    const nBanks = Math.max(1, Math.ceil(s.knobParams.length / KNOBS_PER_PAGE));

    let bankName = '';
    if (s.bankNames.length > 1 && s.bankNames[s.knobPage]) {
        bankName = s.bankNames[s.knobPage];
    } else if (s.moduleConfig && s.moduleConfig.banks[s.knobPage]) {
        bankName = s.moduleConfig.banks[s.knobPage].name;
    } else if (nBanks > 1) {
        bankName = s.knobPage === 0 ? 'Main' : 'Page ' + s.knobPage;
    }

    const rows: ViewModel['rows'] = [[], []];
    for (let row = 0; row < 2; row++) {
        for (let col = 0; col < KNOBS_PER_ROW; col++) {
            const physK = row * KNOBS_PER_ROW + col;
            const gi    = s.knobPage * KNOBS_PER_PAGE + physK;
            const p     = s.knobParams[gi];
            if (!p) { rows[row].push(null); continue; }
            const v  = s.knobValues[gi];
            const nv = (p.min === p.max || v === null || v === undefined)
                ? 0
                : Math.max(0, Math.min(1, (v - p.min) / (p.max - p.min)));
            const enumIdx = (p.type === 'enum' && typeof v === 'number') ? Math.round(v) : 0;
            const dv = p.nameKey
                ? (shadow_get_param(s.activeSlot, 'synth:' + p.nameKey) ?? formatValue(p, v))
                : formatValue(p, v);
            rows[row].push({
                shortName:       p.shortLabel ? p.shortLabel.toUpperCase() : autoShorten(p.label, 5),
                fullName:        p.label,
                type:            p.type,
                normalizedValue: nv,
                displayValue:    dv,
                touched:         s.touchedSlots.includes(physK),
                isLongEnum:      p.type === 'enum' && (p.options?.length ?? 0) > 6,
                options:         p.options,
                enumIndex:       enumIdx,
            });
        }
    }

    const primary = s.touchedSlots.length > 0 ? s.touchedSlots[s.touchedSlots.length - 1] : -1;
    let toast: ViewModel['toast'] = null;
    if (primary >= 0) {
        const gi = s.knobPage * KNOBS_PER_PAGE + primary;
        const p  = s.knobParams[gi];
        if (p) {
            const tv = p.nameKey
                ? (shadow_get_param(s.activeSlot, 'synth:' + p.nameKey) ?? formatValue(p, s.knobValues[gi]))
                : formatValue(p, s.knobValues[gi]);
            toast = { fullName: p.label, value: tv };
        }
    }

    return {
        moduleName:  s.activeModuleName,
        bankName,
        bankIndex:   s.knobPage,
        bankCount:   nBanks,
        rows,
        touchedSlot: primary >= 0 ? primary : null,
        toast,
        overlay:     s.enumOverlay
            ? { slot: s.enumOverlay.slot, options: s.enumOverlay.options, selected: s.enumOverlay.selected }
            : null,
    };
}
```

- [ ] **Step 2: Typecheck**

```bash
cd movy && npm run typecheck
```

Expected: 0 errors

- [ ] **Step 3: Build and run screenshot tests**

```bash
npm run build:browser && cd browser-test && node screenshot.mjs
```

Expected: 0 failures (bankNames is empty everywhere until Task 5; nameKey unused; no visual change).

- [ ] **Step 4: Commit**

```bash
cd movy && git add src/model/viewmodel.ts
git commit -m "$(cat <<'EOF'
feat: use bankNames and nameKey in viewmodel

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Add multi-level mock synth and browser test scenarios

**Files:**
- Modify: `browser-test/mock-synth.mjs`
- Modify: `browser-test/screenshot.mjs`

- [ ] **Step 1: Add obxd_like mock synth**

In `browser-test/mock-synth.mjs`, add this entry to `MOCK_SYNTHS` (before the closing `};`):

```javascript
    obxd_like: {
        "synth:name":   "OB-Xd",
        "synth:ui_hierarchy": JSON.stringify({
            modes: null,
            levels: {
                root: {
                    list_param:  "preset",
                    count_param: "preset_count",
                    name_param:  "preset_name",
                    knobs: ["cutoff","resonance","filter_env","attack","decay","sustain","release","octave_transpose"],
                    params: [
                        { level: "global", label: "Global" },
                        { level: "filter", label: "Filter" },
                    ],
                },
                global: {
                    knobs:  ["volume","tune","portamento","unison"],
                    params: ["volume","tune","portamento","unison"],
                },
                filter: {
                    knobs:  ["cutoff","resonance","filter_env","key_follow"],
                    params: ["cutoff","resonance","filter_env","key_follow"],
                },
            },
        }),
        "synth:chain_params": JSON.stringify([
            { key: "preset",           name: "Preset",     type: "int",   min: 0,  max: 9999 },
            { key: "cutoff",           name: "Cutoff",     type: "float", min: 0,  max: 1 },
            { key: "resonance",        name: "Resonance",  type: "float", min: 0,  max: 1 },
            { key: "filter_env",       name: "Filter Env", type: "float", min: 0,  max: 1 },
            { key: "attack",           name: "Attack",     type: "float", min: 0,  max: 1 },
            { key: "decay",            name: "Decay",      type: "float", min: 0,  max: 1 },
            { key: "sustain",          name: "Sustain",    type: "float", min: 0,  max: 1 },
            { key: "release",          name: "Release",    type: "float", min: 0,  max: 1 },
            { key: "octave_transpose", name: "Octave",     type: "int",   min: -3, max: 3 },
            { key: "volume",           name: "Volume",     type: "float", min: 0,  max: 1 },
            { key: "tune",             name: "Tune",       type: "float", min: 0,  max: 1 },
            { key: "portamento",       name: "Portamento", type: "float", min: 0,  max: 1 },
            { key: "unison",           name: "Unison",     type: "int",   min: 0,  max: 1 },
            { key: "key_follow",       name: "Key Follow", type: "float", min: 0,  max: 1 },
        ]),
        "synth:preset_count":     "5",
        "synth:preset_name":      "Init",
        "synth:preset":           "0",
        "synth:cutoff":           "0.70",
        "synth:resonance":        "0.30",
        "synth:filter_env":       "0.50",
        "synth:attack":           "0.10",
        "synth:decay":            "0.50",
        "synth:sustain":          "0.70",
        "synth:release":          "0.30",
        "synth:octave_transpose": "0",
        "synth:volume":           "0.80",
        "synth:tune":             "0.50",
        "synth:portamento":       "0.00",
        "synth:unison":           "0",
        "synth:key_follow":       "0.50",
    },
```

Note: no `synth:preset_name_0` is provided — this triggers the no-names path (enum square with nameKey, no overlay).

- [ ] **Step 2: Add screenshot scenarios to PRESETS and syntheticPresets**

In `browser-test/screenshot.mjs`, extend `PRESETS`:

```javascript
const PRESETS = [
    'test8', 'test16', 'test_enum', 'plaits', 'wurl',
    'enum_overlay', 'knob_toast', 'no_params', 'keys_view', 'browse_view',
    'obxd_preset_page', 'obxd_main_page', 'obxd_filter_page',
];
```

Extend `syntheticPresets`:

```javascript
const syntheticPresets = { enum_overlay: 'plaits', knob_toast: 'test8',
                           no_params: 'no_params', keys_view: 'test8',
                           browse_view: 'test8',
                           obxd_preset_page: 'obxd_like',
                           obxd_main_page:   'obxd_like',
                           obxd_filter_page: 'obxd_like' };
```

- [ ] **Step 3: Add view state handlers**

In the `if/else if` chain after the `browse_view` handler, add:

```javascript
        } else if (preset === 'obxd_preset_page') {
            /* page 0 = dedicated Preset page */
            await page.evaluate(() => { globalThis.__movy_forceRender?.(); });
        } else if (preset === 'obxd_main_page') {
            /* page 1 = Main (root.knobs) */
            await page.evaluate(() => {
                globalThis.__movy_model?.changePage(1);
                globalThis.__movy_forceRender?.();
            });
        } else if (preset === 'obxd_filter_page') {
            /* page 3 = Filter (shows Cutoff/Resonance with fixed labels) */
            await page.evaluate(() => {
                globalThis.__movy_model?.changePage(3);
                globalThis.__movy_forceRender?.();
            });
        }
```

- [ ] **Step 4: Save interim baselines (pre-feature)**

```bash
cd movy && npm run build:browser && cd browser-test && node screenshot.mjs --update
```

Expected: 3 new PNG files saved for obxd_* scenarios. These will be incorrect until Task 5 lands — they get re-updated then. This step just ensures the harness wiring is correct (no crash).

- [ ] **Step 5: Commit**

```bash
cd movy && git add browser-test/mock-synth.mjs browser-test/screenshot.mjs browser-test/screenshots/baseline/obxd_preset_page.png browser-test/screenshots/baseline/obxd_main_page.png browser-test/screenshots/baseline/obxd_filter_page.png
git commit -m "$(cat <<'EOF'
test: add obxd_like mock synth and multi-level screenshot scenarios

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Implement multi-level hierarchy parsing

**Files:**
- Modify: `src/model/hierarchy.ts`

This task replaces the no-config fallback path (currently lines 76–99) with full multi-level parsing. The custom `moduleConfig` path (lines 51–74) is preserved exactly.

- [ ] **Step 1: Rewrite hierarchy.ts**

Full replacement of `src/model/hierarchy.ts`:

```typescript
import type { KnobParam } from '../types/param.js';
import type { ModelState } from './state.js';
import { loadModuleConfig } from '../modules/loader.js';
import { mlog } from '../log.js';
import { KNOBS_PER_PAGE } from './constants.js';

interface HierParam {
    key?: string; label?: string; level?: string;
    type?: string; min?: number; max?: number; step?: number; options?: string[];
}
interface HierLevel {
    knobs?: (string | HierParam)[];
    params?: (string | HierParam)[];
    list_param?: string; count_param?: string; name_param?: string;
    items_param?: string; select_param?: string;
}

export function loadHierarchy(s: ModelState): void {
    s.knobParams   = [];
    s.knobValues   = [];
    s.moduleConfig = null;
    s.bankNames    = [];
    s.hierarchyKey = s.activeModuleName;

    mlog('loadHierarchy: slot=' + s.activeSlot + ' module=' + s.activeModuleName);
    s.moduleId = shadow_get_param(s.activeSlot, 'synth_module') || '';

    /* chain_params → cpMap for type/min/max/step/options/name lookups */
    const cpMap: Record<string, HierParam & { name?: string }> = {};
    const chainParamsRaw = shadow_get_param(s.activeSlot, 'synth:chain_params');
    if (chainParamsRaw) {
        try {
            const arr = JSON.parse(chainParamsRaw) as Array<{ key?: string }>;
            for (const cp of arr) { if (cp.key) cpMap[cp.key] = cp; }
            mlog('loadHierarchy: chain_params ' + arr.length + ' entries');
        } catch (e) { mlog('chain_params parse error: ' + e); }
    }

    const raw = shadow_get_param(s.activeSlot, 'synth:ui_hierarchy');
    if (!raw) {
        mlog('loadHierarchy: ui_hierarchy null — using test params');
        s.knobParams = [
            { key: 'test_a', label: 'TestA', shortLabel: null, type: 'float', min: 0, max: 1,   step: 0.02, options: null },
            { key: 'test_b', label: 'TestB', shortLabel: null, type: 'int',   min: 0, max: 127, step: 1,    options: null },
        ];
        s.knobValues = [0.5, 64];
        s.dirty = true;
        return;
    }

    /* Parse ui_hierarchy — build paramDefs (from .params arrays) and knobInline
     * (from inline object knobs) for label/type fallback lookups */
    const paramDefs:  Record<string, HierParam> = {};
    const knobInline: Record<string, HierParam> = {};
    let allLevels: Record<string, HierLevel> = {};
    try {
        const hier = JSON.parse(raw) as { levels?: Record<string, HierLevel> };
        allLevels = hier.levels ?? {};
        for (const lvl of Object.values(allLevels)) {
            if (lvl.params) {
                for (const p of lvl.params) {
                    if (typeof p === 'object' && p.key) paramDefs[p.key] = p;
                }
            }
            if (lvl.knobs) {
                for (const k of lvl.knobs) {
                    if (typeof k === 'object' && k.key) knobInline[k.key] = k;
                }
            }
        }
    } catch (e) { mlog('ui_hierarchy parse error: ' + e); }

    s.moduleConfig = loadModuleConfig(s.moduleId);

    /* ── Custom config path (Plaits, Wurl, etc.) ─────────────────────────── */
    if (s.moduleConfig) {
        for (const bank of s.moduleConfig.banks) {
            for (const row of bank.rows) {
                for (const slot of row) {
                    if (!slot?.key) { s.knobParams.push(null); continue; }
                    const cp   = cpMap[slot.key]   ?? {};
                    const hier = paramDefs[slot.key] ?? {};
                    const type = slot.type || cp.type || hier.type || 'float';
                    const options = cp.options ?? hier.options ?? null;
                    let min  = cp.min  != null ? cp.min  : (hier.min  != null ? hier.min  : 0);
                    let max  = cp.max  != null ? cp.max  : (hier.max  != null ? hier.max  : 1);
                    let step = cp.step != null ? cp.step : (hier.step != null ? hier.step : (type === 'float' ? 0.01 : 1));
                    if (type === 'enum') { min = 0; max = options ? options.length - 1 : 127; step = 1; }
                    s.knobParams.push({
                        key:        slot.key,
                        label:      slot.full || cp.name || hier.label || slot.key,
                        shortLabel: slot.short ?? null,
                        type:       type as KnobParam['type'],
                        options, min, max, step,
                    });
                }
            }
        }
        mlog('loadHierarchy: config for ' + s.moduleId + ', ' + s.moduleConfig.banks.length + ' banks');
        s.knobValues = new Array(s.knobParams.length).fill(null) as (number | null)[];
        s.dirty = true;
        return;
    }

    /* ── Generic no-config path: parse all levels ────────────────────────── */
    const rootLevel = allLevels['root'] || Object.values(allLevels)[0] || null;
    if (!rootLevel) { s.dirty = true; return; }

    function toKey(k: string | HierParam): string | null {
        return typeof k === 'string' ? k : (k.key ?? null);
    }

    /* Level → display label map from root.params navigation entries */
    const levelLabel: Record<string, string> = {};
    if (Array.isArray(rootLevel.params)) {
        for (const p of rootLevel.params) {
            if (typeof p === 'object' && p.level && p.label) levelLabel[p.level] = p.label;
        }
    }

    /* Preset detection */
    let presetParam: KnobParam | null = null;
    const listParam  = rootLevel.list_param;
    const countParam = rootLevel.count_param;
    const nameParam  = rootLevel.name_param;
    let presetSeparate = false;

    if (listParam && countParam) {
        const countRaw    = shadow_get_param(s.activeSlot, 'synth:' + countParam);
        const presetCount = countRaw ? parseInt(countRaw) : 0;
        if (presetCount > 0) {
            let allNames: string[] | null = null;

            /* Strategy 1: bulk JSON array */
            const namesRaw = shadow_get_param(s.activeSlot, 'synth:preset_names');
            if (namesRaw) { try { allNames = JSON.parse(namesRaw) as string[]; } catch {} }

            /* Strategy 2: per-index query */
            if (!allNames && shadow_get_param(s.activeSlot, 'synth:preset_name_0') !== null) {
                allNames = [];
                for (let i = 0; i < presetCount; i++) {
                    allNames.push(shadow_get_param(s.activeSlot, 'synth:preset_name_' + i) ?? String(i));
                }
            }

            presetParam = {
                key: listParam, label: 'Preset', shortLabel: null,
                type: 'enum', min: 0, max: presetCount - 1, step: 1,
                options: allNames,
                nameKey: allNames ? undefined : (nameParam ?? undefined),
            };
            presetSeparate = (rootLevel.knobs ?? []).length >= KNOBS_PER_PAGE;
        }
    }

    /* Bank page accumulator: each entry is KNOBS_PER_PAGE keys (null = empty slot) */
    const bankEntries: Array<{ name: string; keys: (string | null)[] }> = [];

    function addPage(name: string, keys: (string | null)[]): void {
        const padded = keys.slice(0, KNOBS_PER_PAGE);
        while (padded.length < KNOBS_PER_PAGE) padded.push(null);
        bankEntries.push({ name, keys: padded });
    }

    function addLevel(label: string, keys: string[]): void {
        const pages = Math.max(1, Math.ceil(keys.length / KNOBS_PER_PAGE));
        for (let i = 0; i < pages; i++) {
            addPage(
                pages === 1 ? label : label + ' - ' + (i + 1),
                keys.slice(i * KNOBS_PER_PAGE, (i + 1) * KNOBS_PER_PAGE),
            );
        }
    }

    /* Dedicated Preset page before Main when Main is full */
    if (presetParam && presetSeparate) addPage('Preset', [listParam!]);

    /* Main page from root.knobs (with preset prepended if there's room) */
    let rootKeys = (rootLevel.knobs ?? []).map(toKey).filter((k): k is string => k !== null);
    if (presetParam && !presetSeparate) rootKeys = [listParam!, ...rootKeys];
    if (rootKeys.length > 0) addLevel('Main', rootKeys);

    /* Sub-levels from root.params order — skip navigation-only levels (no knobs) */
    if (Array.isArray(rootLevel.params)) {
        for (const entry of rootLevel.params) {
            if (typeof entry !== 'object' || !entry.level) continue;
            const lvl = allLevels[entry.level];
            if (!lvl || !Array.isArray(lvl.knobs) || lvl.knobs.length === 0) continue;
            const keys = lvl.knobs.map(toKey).filter((k): k is string => k !== null);
            if (keys.length > 0) addLevel(levelLabel[entry.level] || entry.level, keys);
        }
    }

    /* Build s.knobParams and s.bankNames from bankEntries */
    s.bankNames = bankEntries.map(e => e.name);
    for (const entry of bankEntries) {
        for (const key of entry.keys) {
            if (!key) { s.knobParams.push(null); continue; }
            if (key === listParam && presetParam) { s.knobParams.push(presetParam); continue; }

            const cp  = cpMap[key]       ?? {};
            const def = paramDefs[key]   ?? knobInline[key] ?? {};
            const type    = cp.type    || def.type    || 'float';
            const options = cp.options ?? def.options ?? null;
            let min  = cp.min  != null ? cp.min  : (def.min  != null ? def.min  : 0);
            let max  = cp.max  != null ? cp.max  : (def.max  != null ? def.max  : 1);
            let step = cp.step != null ? cp.step : (def.step != null ? def.step : (type === 'float' ? 0.02 : 1));
            if (type === 'enum') { min = 0; max = options ? options.length - 1 : 127; step = 1; }
            s.knobParams.push({
                key,
                label:      cp.name || def.label || key,
                shortLabel: null,
                type:       type as KnobParam['type'],
                options, min, max, step,
            });
        }
    }

    s.knobValues = new Array(s.knobParams.length).fill(null) as (number | null)[];
    mlog('loadHierarchy: ' + s.knobParams.filter(Boolean).length + ' params, ' + bankEntries.length + ' banks');
    s.dirty = true;
}
```

- [ ] **Step 2: Typecheck**

```bash
cd movy && npm run typecheck
```

Expected: 0 errors

- [ ] **Step 3: Build browser bundle**

```bash
npm run build:browser
```

Expected: success, no errors or warnings

- [ ] **Step 4: Update all screenshot baselines**

```bash
cd browser-test && node screenshot.mjs --update
```

Expected: all 13 baselines updated. Visually verify the 3 new ones look correct:
- `obxd_preset_page.png` — should show 1 enum-square knob labeled "PRESE" (or "PREST") with "Init" displayed, 7 empty slots, bank bar with 4 segments, header shows "OB-Xd" and "Preset"
- `obxd_main_page.png` — should show 8 arc knobs (Cutoff, Resonance, Filter Env, Attack, Decay, Sustain, Release, Octave), header shows "OB-Xd" and "Main"
- `obxd_filter_page.png` — should show 4 arc knobs labeled "CUTOF", "RESON", "FE", "KEY F", header shows "OB-Xd" and "Filter"

Also verify that `test8`, `test16` baselines still look correct (test8: 8 knobs with no bank name; test16: 8 knobs on page 1, now labeled "Main - 1").

- [ ] **Step 5: Run screenshot tests**

```bash
node screenshot.mjs
```

Expected: `13 passed, 0 failed`

- [ ] **Step 6: Device tests**

```bash
cd /Users/dake/git/cld/movy
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && ./scripts/test.sh \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```

- [ ] **Step 7: Commit**

```bash
git add src/model/hierarchy.ts browser-test/screenshots/baseline/
git commit -m "$(cat <<'EOF'
feat: parse all ui_hierarchy levels as separate parameter pages

Generic modules now show one page per level (Global, Filter, etc.) from
the module's ui_hierarchy. Preset selector detected via list_param/count_param
and rendered as an enum square knob on a dedicated page when Main is full.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Final build and push

- [ ] **Step 1: Full build (device + browser)**

```bash
cd movy && npm run build
```

Expected: both bundles succeed with no errors

- [ ] **Step 2: Run all screenshot tests**

```bash
cd browser-test && node screenshot.mjs
```

Expected: 13 passed, 0 failed

- [ ] ] **Step 3: Device tests**

```bash
cd /Users/dake/git/cld/movy
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && ./scripts/test.sh \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```

- [ ] **Step 4: Push**

```bash
git push
```
