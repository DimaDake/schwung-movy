# Track-chain LFO page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 5th track-chain page, **LFO**, exposing the current track's two schwung slot LFOs, with jog-click drill-down into a 2-bank (LFO 1 / LFO 2) editor.

**Architecture:** The LFO is a virtual 5th chain slot backed by a `Model`-conforming object (`createLfoModel`) stored at `trackModels[track][4]`. It reads/writes schwung slot-LFO params (`lfoN:*`) on the current track and emits the standard `ViewModel`, so it reuses the existing `VIEW_CHAIN`/`VIEW_KNOBS` rendering, jog/bank navigation, and per-track nav-state preservation with minimal router changes. No C/engine changes — the chain-host slot-LFO engine already exists.

**Tech Stack:** TypeScript (esbuild → `dist/esm`), node-based browser tests (`browser-test/*.mjs`), 128×64 1-bit framebuffer renderer.

## Global Constraints

- Design doc: `movy/plans/2026-07-11-track-lfo-page-design.md` (authoritative).
- Plans live in `movy/plans/` (per repo CLAUDE.md), not `docs/superpowers/plans/`.
- All movy source is under `movy/`; run all commands from `movy/`.
- Build before running `.mjs` tests: `npm run build:browser` refreshes `dist/esm`.
- LFO params are **not automatable** (`automatable: false` on every cell).
- No code duplication: reuse `paramCell` (`src/seq/param-vm.ts`), `countDetents` (`src/seq/detent.ts`), existing renderers.
- New rendering → screenshot test; new logic → logic test (repo rule).
- Slot-LFO param keys (per LFO `N∈{1,2}`, prefix `lfoN:`): `target`, `target_param`, `enabled`, `shape` (0–5), `polarity` (0/1), `sync` (0/1), `rate_hz` (0.1–20.0), `rate_div` (0–26), `depth` (−1..1), `phase_offset` (0..1), `retrigger` (0/1).
- Modulation-target filter = schwung's own: a component's `chain_params` entries of `type` `float`/`int`/`enum` only.
- Commit message trailer: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`. Use `git add <specific files>`, never `-A`.

---

### Task 1: LFO parameter definitions & helpers

**Files:**
- Create: `src/lfo/params.ts`
- Test: `browser-test/logic.mjs` (append a new test block)

**Interfaces:**
- Produces:
  - `LFO_SHAPES: string[]` (6 names), `LFO_DIVISIONS: string[]` (27 labels)
  - `RATE_HZ_MIN = 0.1`, `RATE_HZ_MAX = 20.0`, `RATE_HZ_FACTOR: number`
  - `LFO_BANK_COUNT = 2`
  - `lfoPrefix(lfoIdx: number): string` → `"lfo1:"`/`"lfo2:"`
  - `compLabel(target: string): string`
  - `interface TargetOption { label: string; target: string | null; param: string | null }`
  - `buildTargetOptions(track: number, lfoIdx: number): TargetOption[]` (index 0 = None)
  - `shortenTarget(compLabel: string, paramName: string): string`
  - `targetIndex(opts: TargetOption[], target: string, param: string): number`
  - `formatDepth(v: number): string`, `formatPhase(v: number): string`

- [ ] **Step 1: Write the failing test** — append to `browser-test/logic.mjs` (after the imports at top, add the import; place the test block near the end, before the final failure-count/exit):

Add import (top of file, with the other `../dist/esm` imports):
```js
import {
    buildTargetOptions, shortenTarget, targetIndex, formatDepth, formatPhase,
    LFO_SHAPES, LFO_DIVISIONS, compLabel,
} from '../dist/esm/lfo/params.js';
```

Test block:
```js
_log('\nTest: LFO param helpers');
{
    env.setParams({
        'synth:chain_params': JSON.stringify([
            { key: 'cutoff', name: 'Cutoff', type: 'float' },
            { key: 'reso',   name: 'Resonance', type: 'float' },
            { key: 'wave',   name: 'Wave', type: 'enum' },
            { key: 'label',  name: 'Label', type: 'string' },   // filtered out
        ]),
        'fx1:chain_params': JSON.stringify([
            { key: 'mix', name: 'Mix', type: 'float' },
        ]),
    });
    const opts = buildTargetOptions(0, 0);
    eq('target[0] is None', opts[0].label, 'None');
    eq('target[0] target null', opts[0].target, null);
    // Synth: Cutoff/Resonance/Wave (3) + FX1 Mix (1) + other-LFO params (3) = 7, +None = 8
    eq('target option count (string filtered)', opts.length, 8);
    eq('cutoff mapped', JSON.stringify(opts[1]), JSON.stringify({ label: shortenTarget(compLabel('synth'), 'Cutoff'), target: 'synth', param: 'cutoff' }));
    eq('no string-typed param', opts.some(o => o.param === 'label'), false);
    eq('other-LFO target present', opts.some(o => o.target === 'lfo2' && o.param === 'depth'), true);

    eq('shorten fits 11', shortenTarget('Syn', 'Resonance').length <= 11, true);
    eq('shorten format', shortenTarget('Syn', 'Cutoff'), 'Syn:Cutoff');

    eq('targetIndex finds mix', targetIndex(opts, 'fx1', 'mix') > 0, true);
    eq('targetIndex none→0', targetIndex(opts, '', ''), 0);

    eq('shapes count', LFO_SHAPES.length, 6);
    eq('divisions count', LFO_DIVISIONS.length, 27);
    eq('depth +65%', formatDepth(0.65), '+65%');
    eq('depth -65%', formatDepth(-0.65), '-65%');
    eq('depth 0%', formatDepth(0), '0%');
    eq('phase 180°', formatPhase(0.5), '180°');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `Cannot find module '.../dist/esm/lfo/params.js'` (build error / import failure).

- [ ] **Step 3: Write minimal implementation** — create `src/lfo/params.ts`:

```ts
/* LFO parameter model: names, ranges, target-list builder, and formatters for
 * the two schwung slot LFOs surfaced on movy's track-chain LFO page. Kept pure
 * (only reads shadow_get_param) so it is unit-testable and shared by the model
 * and the render/scene code. */

export const LFO_SHAPES = ['Sine', 'Tri', 'Saw', 'Square', 'S&H', 'Swishy'];

/* 27-entry division table, exact order/labels from schwung's lfo_common.h. */
export const LFO_DIVISIONS = [
    '16bar', '15bar', '14bar', '13bar', '12bar', '11bar', '10bar', '9bar',
    '8bar', '7bar', '6bar', '5bar', '4bar', '3bar', '2bar',
    '1/1', '1/1T', '1/2', '1/2T', '1/4', '1/4T', '1/8', '1/8T',
    '1/16', '1/16T', '1/32', '1/32T',
];

export const RATE_HZ_MIN = 0.1;
export const RATE_HZ_MAX = 20.0;
/* ~40 detents span 0.1–20 Hz multiplicatively (≈1.14×/detent): fine at low Hz,
 * coarse at high — perceptually even, so the knob is usable across the range. */
export const RATE_HZ_FACTOR = Math.pow(RATE_HZ_MAX / RATE_HZ_MIN, 1 / 40);

export const LFO_BANK_COUNT = 2;

export function lfoPrefix(lfoIdx: number): string { return 'lfo' + (lfoIdx + 1) + ':'; }

/* Short display tag for a target component (matches the schwung-side idea of a
 * compact component label). */
export function compLabel(target: string): string {
    switch (target) {
        case 'synth':    return 'Syn';
        case 'fx1':      return 'FX1';
        case 'fx2':      return 'FX2';
        case 'midi_fx1': return 'MF1';
        case 'midi_fx2': return 'MF2';
        case 'lfo1':     return 'LFO1';
        case 'lfo2':     return 'LFO2';
        default:         return target.slice(0, 4);
    }
}

/* Components whose params an LFO can target, in display order. */
const TARGET_COMPONENTS = ['synth', 'fx1', 'fx2', 'midi_fx1', 'midi_fx2'];

export interface TargetOption {
    label:  string;          // shortened "Syn:Cutoff" (or "None")
    target: string | null;   // component key, or null for None
    param:  string | null;   // param key, or null
}

/* "Comp:Param" shortened toward ~11 chars for the enum box; the overlay has
 * room for more but we keep one form. Param name is trimmed of whitespace and
 * truncated (the component tag is already short). */
export function shortenTarget(compTag: string, paramName: string): string {
    const maxParam = Math.max(1, 11 - compTag.length - 1); // 1 for ':'
    let p = paramName.replace(/\s+/g, '');
    if (p.length > maxParam) p = p.slice(0, maxParam);
    return compTag + ':' + p;
}

/* Flat target list for `lfoIdx` on `track`: None, then each loaded component's
 * float/int/enum chain_params (schwung's own modulatable filter), then the
 * other LFO's modulatable params. Rebuilt each time the overlay opens so it
 * always reflects currently-loaded modules. */
export function buildTargetOptions(track: number, lfoIdx: number): TargetOption[] {
    const opts: TargetOption[] = [{ label: 'None', target: null, param: null }];
    for (const comp of TARGET_COMPONENTS) {
        const raw = shadow_get_param(track, comp + ':chain_params');
        if (!raw) continue;
        let arr: Array<{ key?: string; name?: string; label?: string; type?: string }>;
        try { arr = JSON.parse(raw); } catch { continue; }
        for (const p of arr) {
            if (!p.key) continue;
            if (p.type !== 'float' && p.type !== 'int' && p.type !== 'enum') continue;
            opts.push({ label: shortenTarget(compLabel(comp), p.name || p.label || p.key), target: comp, param: p.key });
        }
    }
    const otherIdx = lfoIdx === 0 ? 1 : 0;
    const otherKey = 'lfo' + (otherIdx + 1);
    for (const [key, name] of [['depth', 'Depth'], ['rate_hz', 'Rate'], ['phase_offset', 'Phase']] as const) {
        opts.push({ label: shortenTarget(compLabel(otherKey), name), target: otherKey, param: key });
    }
    return opts;
}

/* Option index matching the stored target/param (0 = None / unmatched). */
export function targetIndex(opts: TargetOption[], target: string, param: string): number {
    if (!target) return 0;
    const i = opts.findIndex(o => o.target === target && o.param === param);
    return i >= 0 ? i : 0;
}

export function formatDepth(v: number): string {
    const pct = Math.round(v * 100);
    return (pct > 0 ? '+' : '') + pct + '%';
}

export function formatPhase(v: number): string {
    return Math.round(v * 360) + '°';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: PASS — the new "LFO param helpers" assertions all show ✓; `0 failures`.

- [ ] **Step 5: Commit**

```bash
git add src/lfo/params.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(lfo): LFO param definitions, target-list builder, formatters

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: LFO model (`createLfoModel`)

**Files:**
- Create: `src/lfo/model.ts`
- Test: `browser-test/logic.mjs` (append a second test block)

**Interfaces:**
- Consumes: `src/lfo/params.ts` (Task 1); `paramCell` from `src/seq/param-vm.ts`; `countDetents` from `src/seq/detent.ts`; `NAME_POLL_TICKS` from `src/model/constants.ts`; `Model` type from `src/model/index.ts`; `ViewModel`/`AutomationView` from `src/types/viewmodel.ts`.
- Produces: `createLfoModel(track: number): Model` — a `Model`-conforming object with 2 banks (bank 0 = LFO 1, bank 1 = LFO 2). Knob positions 0..7 = Target, Shape, Mode, Sync, Rate, Depth, Phase, Retrigger. Writes `lfoN:*` on `track`; auto-enables on a real Target.

- [ ] **Step 1: Write the failing test** — append to `browser-test/logic.mjs`:

Add import (top, with the other imports):
```js
import { createLfoModel } from '../dist/esm/lfo/model.js';
```

Test block:
```js
_log('\nTest: LFO model');
{
    const DETENT = 8; // detent.ts DETENT_DIV — raw delta per ±1 step
    function seedLfo() {
        env.setParams({
            'synth:chain_params': JSON.stringify([
                { key: 'cutoff', name: 'Cutoff', type: 'float' },
                { key: 'reso',   name: 'Resonance', type: 'float' },
            ]),
            'lfo1:shape': '0', 'lfo1:polarity': '0', 'lfo1:sync': '0',
            'lfo1:rate_hz': '1.0', 'lfo1:rate_div': '19', 'lfo1:depth': '0',
            'lfo1:phase_offset': '0', 'lfo1:retrigger': '0', 'lfo1:target': '', 'lfo1:target_param': '',
            'lfo2:shape': '1', 'lfo2:sync': '0', 'lfo2:rate_hz': '2.0', 'lfo2:depth': '0',
        });
    }

    seedLfo();
    const m = createLfoModel(0);
    m.tick();
    let vm = m.getViewModel();
    eq('lfo bankCount', vm.bankCount, 2);
    eq('lfo bank 0 name', vm.moduleName, 'LFO 1');
    eq('pos0 is TARGET', vm.rows[0][0].shortName, 'TARGET');
    eq('pos1 is SHAPE', vm.rows[0][1].shortName, 'SHAPE');
    eq('pos4 is RATE', vm.rows[1][0].shortName, 'RATE');
    eq('pos7 is RETRIG', vm.rows[1][3].shortName, 'RETRIG');
    eq('no LFO cell is automatable', [...vm.rows[0], ...vm.rows[1]].every(c => c && c.automatable === false), true);
    eq('getKnobParamInfo null (not automatable)', m.getKnobParamInfo(0), null);
    eq('componentKey', m.getComponentKey(), 'lfo');

    // Mode (polarity) inline enum toggles on one detent.
    m.handleKnobDelta(2, DETENT);
    eq('polarity set to Bipolar', env.params['lfo1:polarity'], '1');
    eq('mode display BI', m.getViewModel().rows[0][2].displayValue, 'BI');

    // Sync toggles Rate between Hz and division display.
    eq('rate shows Hz when free', m.getViewModel().rows[1][0].displayValue, '1.0 Hz');
    m.handleKnobDelta(3, DETENT);
    eq('sync set', env.params['lfo1:sync'], '1');
    eq('rate shows division when sync', m.getViewModel().rows[1][0].displayValue, '1/4');

    // Rate in sync mode: +1 detent → next division index.
    m.handleKnobDelta(4, DETENT);
    eq('rate_div incremented', env.params['lfo1:rate_div'], '20');
    // Back to free; rate up clamps at 20 Hz.
    m.handleKnobDelta(3, -DETENT);
    eq('sync cleared', env.params['lfo1:sync'], '0');
    m.handleKnobDelta(4, DETENT * 200);
    eq('rate_hz clamped ≤ 20', parseFloat(env.params['lfo1:rate_hz']) <= 20.0, true);
    m.handleKnobDelta(4, -DETENT * 400);
    eq('rate_hz clamped ≥ 0.1', parseFloat(env.params['lfo1:rate_hz']) >= 0.1, true);

    // Depth continuous, clamps to −1.
    m.handleKnobDelta(5, -1000);
    eq('depth clamped ≥ -1', parseFloat(env.params['lfo1:depth']) >= -1, true);
    eq('depth clamped exactly -1', parseFloat(env.params['lfo1:depth']), -1);

    // Target overlay: touch opens it, scroll+release commits + auto-enables.
    m.handleKnobTouch(0);
    vm = m.getViewModel();
    eq('overlay open on target', vm.overlay !== null, true);
    eq('overlay slot 0', vm.overlay.slot, 0);
    eq('overlay first option None', vm.overlay.options[0], 'None');
    m.handleKnobDelta(0, DETENT);       // select option 1 (first real target)
    m.handleKnobRelease(0);
    eq('target committed', env.params['lfo1:target'], 'synth');
    eq('target_param committed', env.params['lfo1:target_param'], 'cutoff');
    eq('auto-enabled on target', env.params['lfo1:enabled'], '1');
    eq('overlay closed', m.getViewModel().overlay, null);

    // Selecting None clears + disables.
    m.handleKnobTouch(0);
    m.handleKnobDelta(0, -DETENT * 10); // clamp to index 0 (None)
    m.handleKnobRelease(0);
    eq('target cleared', env.params['lfo1:target'], '');
    eq('disabled on None', env.params['lfo1:enabled'], '0');

    // Shape overlay commit.
    m.handleKnobTouch(1);
    m.handleKnobDelta(1, DETENT * 2);   // +2 shapes → index 2 (Saw)
    m.handleKnobRelease(1);
    eq('shape committed', env.params['lfo1:shape'], '2');

    // Retrigger hbar toggle.
    m.handleKnobDelta(7, DETENT);
    eq('retrigger on', env.params['lfo1:retrigger'], '1');

    // Bank change → LFO 2, writes hit lfo2:*.
    m.changePage(1);
    vm = m.getViewModel();
    eq('bank 1 name', vm.moduleName, 'LFO 2');
    eq('bank index', vm.bankIndex, 1);
    m.handleKnobDelta(2, DETENT);
    eq('lfo2 polarity written', env.params['lfo2:polarity'], '1');
    eq('lfo1 polarity untouched', env.params['lfo1:polarity'], '1'); // from earlier

    // Not empty; drum/file stubs safe.
    eq('lfo never empty', m.getViewModel().isEmpty, false);
    eq('getDrumConfig null', m.getDrumConfig(), null);
    eq('getFileBrowseTarget null', m.getFileBrowseTarget(), null);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `Cannot find module '.../dist/esm/lfo/model.js'`.

- [ ] **Step 3: Write minimal implementation** — create `src/lfo/model.ts`:

```ts
/* createLfoModel — a Model-conforming object for movy's virtual LFO chain slot.
 * Backs both banks (LFO 1 / LFO 2) of the current track's schwung slot LFOs,
 * reading/writing lfoN:* params and emitting the standard ViewModel so the
 * existing chain/knob renderers and router plumbing drive it unchanged.
 * Automation/drum/file surface area is stubbed (LFO params are not automatable). */

import type { Model } from '../model/index.js';
import type { ViewModel, ParamVM } from '../types/viewmodel.js';
import { paramCell as cell } from '../seq/param-vm.js';
import { countDetents } from '../seq/detent.js';
import { NAME_POLL_TICKS } from '../model/constants.js';
import {
    LFO_SHAPES, LFO_DIVISIONS, LFO_BANK_COUNT, RATE_HZ_MIN, RATE_HZ_MAX, RATE_HZ_FACTOR,
    lfoPrefix, compLabel, buildTargetOptions, shortenTarget, targetIndex, formatDepth, formatPhase,
    type TargetOption,
} from './params.js';

/* Continuous-knob sensitivity for the arc params (device delta ≈ ±1..3/tick).
 * Full sweep ≈ range / step ticks; tuned for feel on device. */
const DEPTH_STEP = 0.02;   // range 2.0 → ~100 ticks
const PHASE_STEP = 0.02;   // range 1.0 → ~50 ticks

interface LfoVals {
    target: string; targetParam: string;
    shape: number; polarity: number; sync: number;
    rateHz: number; rateDiv: number;
    depth: number; phase: number; retrigger: number;
}

const clampI = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const clampF = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function createLfoModel(track: number): Model {
    let bank = 0;                       // 0 or 1 → which LFO is shown
    let loaded = false;
    let dirty = true;
    let pollCountdown = NAME_POLL_TICKS;
    const vals: LfoVals[] = [blank(), blank()];
    const touched: number[] = [];
    const accum = new Array(8).fill(0) as number[];
    let overlay: { pos: number; kind: 'target' | 'shape'; options: string[]; selected: number; opts?: TargetOption[] } | null = null;

    function blank(): LfoVals {
        return { target: '', targetParam: '', shape: 0, polarity: 0, sync: 0,
            rateHz: 1.0, rateDiv: 19, depth: 0, phase: 0, retrigger: 0 };
    }

    function readLfo(lfoIdx: number): LfoVals {
        const g = (k: string) => shadow_get_param(track, lfoPrefix(lfoIdx) + k);
        return {
            target: g('target') || '',
            targetParam: g('target_param') || '',
            shape: clampI(parseInt(g('shape') || '0', 10) || 0, 0, LFO_SHAPES.length - 1),
            polarity: g('polarity') === '1' ? 1 : 0,
            sync: g('sync') === '1' ? 1 : 0,
            rateHz: clampF(parseFloat(g('rate_hz') || '1') || 1, RATE_HZ_MIN, RATE_HZ_MAX),
            rateDiv: clampI(parseInt(g('rate_div') || '19', 10) || 19, 0, LFO_DIVISIONS.length - 1),
            depth: clampF(parseFloat(g('depth') || '0') || 0, -1, 1),
            phase: clampF(parseFloat(g('phase_offset') || '0') || 0, 0, 1),
            retrigger: g('retrigger') === '1' ? 1 : 0,
        };
    }

    function load(): void {
        vals[0] = readLfo(0);
        vals[1] = readLfo(1);
        loaded = true;
    }

    function setP(lfoIdx: number, key: string, val: string): void {
        shadow_set_param(track, lfoPrefix(lfoIdx) + key, val);
    }

    /* Current target's compact label for the resting enum box. */
    function targetLabel(v: LfoVals): string {
        return v.target ? shortenTarget(compLabel(v.target), v.targetParam) : 'None';
    }

    function rateDisplay(v: LfoVals): string {
        return v.sync ? LFO_DIVISIONS[v.rateDiv] : v.rateHz.toFixed(1) + ' Hz';
    }
    function rateNorm(v: LfoVals): number {
        return v.sync
            ? v.rateDiv / (LFO_DIVISIONS.length - 1)
            : Math.log(v.rateHz / RATE_HZ_MIN) / Math.log(RATE_HZ_MAX / RATE_HZ_MIN);
    }

    function buildCells(v: LfoVals): ParamVM[] {
        return [
            cell({ shortName: 'TARGET', fullName: 'Target', type: 'enum', isLongEnum: true,
                options: [targetLabel(v)], enumIndex: 0, displayValue: targetLabel(v) }),
            cell({ shortName: 'SHAPE', fullName: 'Shape', type: 'enum', isLongEnum: true,
                options: LFO_SHAPES, enumIndex: v.shape, displayValue: LFO_SHAPES[v.shape],
                normalizedValue: v.shape / (LFO_SHAPES.length - 1) }),
            cell({ shortName: 'MODE', fullName: 'Mode', type: 'enum',
                options: ['UNI', 'BI'], enumIndex: v.polarity, displayValue: v.polarity ? 'BI' : 'UNI',
                normalizedValue: v.polarity }),
            cell({ shortName: 'SYNC', fullName: 'Sync', type: 'enum',
                options: ['FREE', 'SYNC'], enumIndex: v.sync, displayValue: v.sync ? 'SYNC' : 'FREE',
                normalizedValue: v.sync }),
            cell({ shortName: 'RATE', fullName: 'Rate', type: 'float', renderStyle: 'arc',
                displayValue: rateDisplay(v), normalizedValue: rateNorm(v) }),
            cell({ shortName: 'DEPTH', fullName: 'Depth', type: 'float', renderStyle: 'arc',
                displayValue: formatDepth(v.depth), normalizedValue: (v.depth + 1) / 2 }),
            cell({ shortName: 'PHASE', fullName: 'Phase', type: 'float', renderStyle: 'arc',
                displayValue: formatPhase(v.phase), normalizedValue: v.phase }),
            cell({ shortName: 'RETRIG', fullName: 'Retrigger', type: 'int', renderStyle: 'hbar',
                displayValue: v.retrigger ? 'On' : 'Off', normalizedValue: v.retrigger }),
        ];
    }

    function buildVM(): ViewModel {
        if (!loaded) load();
        const v = vals[bank];
        const cells = buildCells(v);
        const primary = touched.length > 0 ? touched[touched.length - 1] : -1;
        let toast: ViewModel['toast'] = null;
        if (primary >= 0 && primary < 8) {
            cells[primary].touched = true;
            toast = { fullName: cells[primary].fullName, value: cells[primary].displayValue, browseHint: false };
        }
        return {
            moduleName: 'LFO ' + (bank + 1),
            bankName: '',
            bankIndex: bank,
            bankCount: LFO_BANK_COUNT,
            rows: [cells.slice(0, 4), cells.slice(4, 8)],
            touchedSlot: primary >= 0 ? primary : null,
            toast,
            overlay: overlay ? { slot: overlay.pos, options: overlay.options, selected: overlay.selected } : null,
            isEmpty: false,
            drumPadCount: 0, drumCurrentPad: 0, drumCurrentPhysPad: 0, isPadSpecific: false,
            // LFO editing is independent of automation — never hide/held.
            automationHeld: false, automationPoolFull: false,
            stepPagePresent: false, stepPageSelected: false,
        };
    }

    function openOverlay(pos: number): void {
        const v = vals[bank];
        if (pos === 0) {
            const opts = buildTargetOptions(track, bank);
            overlay = { pos, kind: 'target', options: opts.map(o => o.label),
                selected: targetIndex(opts, v.target, v.targetParam), opts };
        } else if (pos === 1) {
            overlay = { pos, kind: 'shape', options: LFO_SHAPES.slice(), selected: v.shape };
        }
        accum[pos] = 0;
    }

    function commitOverlay(): void {
        if (!overlay) return;
        const v = vals[bank];
        if (overlay.kind === 'target' && overlay.opts) {
            const opt = overlay.opts[overlay.selected];
            if (!opt.target) {
                setP(bank, 'target', ''); setP(bank, 'target_param', ''); setP(bank, 'enabled', '0');
                v.target = ''; v.targetParam = '';
            } else {
                setP(bank, 'target', opt.target); setP(bank, 'target_param', opt.param!); setP(bank, 'enabled', '1');
                v.target = opt.target; v.targetParam = opt.param!;
            }
        } else if (overlay.kind === 'shape') {
            v.shape = overlay.selected;
            setP(bank, 'shape', String(v.shape));
        }
        overlay = null;
    }

    /* Discrete params: ±1 per detent, clamped. */
    function stepDiscrete(pos: number, delta: number): void {
        const n = countDetents(accum, pos, delta);
        if (n === 0) return;
        const v = vals[bank];
        if (pos === 1) { v.shape = clampI(v.shape + n, 0, LFO_SHAPES.length - 1); setP(bank, 'shape', String(v.shape)); }
        else if (pos === 2) { v.polarity = clampI(v.polarity + n, 0, 1); setP(bank, 'polarity', String(v.polarity)); }
        else if (pos === 3) { v.sync = clampI(v.sync + n, 0, 1); setP(bank, 'sync', String(v.sync)); }
        else if (pos === 4) {
            if (v.sync) { v.rateDiv = clampI(v.rateDiv + n, 0, LFO_DIVISIONS.length - 1); setP(bank, 'rate_div', String(v.rateDiv)); }
            else { v.rateHz = clampF(v.rateHz * Math.pow(RATE_HZ_FACTOR, n), RATE_HZ_MIN, RATE_HZ_MAX); setP(bank, 'rate_hz', v.rateHz.toFixed(4)); }
        } else if (pos === 7) { v.retrigger = clampI(v.retrigger + n, 0, 1); setP(bank, 'retrigger', String(v.retrigger)); }
    }

    function api(): Model {
        return {
            handleKnobDelta(k: number, delta: number): void {
                if (overlay && k === overlay.pos) {
                    const n = countDetents(accum, k, delta);
                    if (n !== 0) { overlay.selected = clampI(overlay.selected + n, 0, overlay.options.length - 1); dirty = true; }
                    return;
                }
                const v = vals[bank];
                if (k === 5) { v.depth = clampF(v.depth + delta * DEPTH_STEP, -1, 1); setP(bank, 'depth', v.depth.toFixed(4)); }
                else if (k === 6) { v.phase = clampF(v.phase + delta * PHASE_STEP, 0, 1); setP(bank, 'phase_offset', v.phase.toFixed(4)); }
                else if (k >= 1 && k <= 4 || k === 7) { stepDiscrete(k, delta); }
                // k === 0 (target) is overlay-only; a bare turn is ignored.
                dirty = true;
            },
            handleKnobTouch(k: number): void {
                if (overlay && k !== overlay.pos) { commitOverlay(); }
                const idx = touched.indexOf(k);
                if (idx >= 0) touched.splice(idx, 1);
                touched.push(k);
                if (k === 0 || k === 1) openOverlay(k);
                dirty = true;
            },
            handleKnobRelease(k?: number): boolean {
                if (overlay && (k === undefined || k === overlay.pos)) commitOverlay();
                if (k !== undefined) { const i = touched.indexOf(k); if (i >= 0) touched.splice(i, 1); }
                else touched.length = 0;
                dirty = true;
                return false;
            },
            getKnobPage(): number { return bank; },
            getBankCount(): number { return LFO_BANK_COUNT; },
            changePage(delta: number): void {
                if (overlay) return;
                const next = clampI(bank + delta, 0, LFO_BANK_COUNT - 1);
                if (next !== bank) { bank = next; touched.length = 0; dirty = true; }
            },
            getModuleName(): string { return 'LFO'; },
            reset(): void { bank = 0; touched.length = 0; overlay = null; accum.fill(0); loaded = false; pollCountdown = NAME_POLL_TICKS; dirty = true; },
            tick(): boolean {
                if (!loaded) { load(); dirty = true; }
                if (--pollCountdown <= 0) {
                    pollCountdown = NAME_POLL_TICKS;
                    // Re-sync from shadow (schwung's own UI may have changed a value)
                    // unless a knob/overlay is in flight (don't clobber the user).
                    if (touched.length === 0 && !overlay) {
                        const a = readLfo(0), b = readLfo(1);
                        if (JSON.stringify(a) !== JSON.stringify(vals[0]) || JSON.stringify(b) !== JSON.stringify(vals[1])) {
                            vals[0] = a; vals[1] = b; dirty = true;
                        }
                    }
                }
                const d = dirty; dirty = false; return d;
            },
            getViewModel(_auto?: import('../types/viewmodel.js').AutomationView): ViewModel { return buildVM(); },
            reload(): void { loaded = false; dirty = true; },
            getFileBrowseTarget(): null { return null; },
            clearFileOverlay(): void { /* no file params */ },
            setFileValue(_gi: number, _path: string): void { /* no file params */ },
            getComponentKey(): string { return 'lfo'; },
            getKnobParamInfo(_physK: number): null { return null; },     // not automatable
            setNoRefreshKeys(_keys: string[]): void { /* no automation lanes */ },
            paramRangeByKey(_key: string): null { return null; },
            hasLoadedParams(): boolean { return loaded; },
            getValueByKey(_key: string): null { return null; },
            getDrumConfig(): null { return null; },
            updateDrumPad(_pad: number, _physPad: number): void { /* not a drum */ },
        };
    }

    return api();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: PASS — the "LFO model" block all ✓; `0 failures`. (If TypeScript reports a missing `Model` member, add the stub with the exact name from `src/model/index.ts`'s return object.)

- [ ] **Step 5: Commit**

```bash
git add src/lfo/model.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(lfo): createLfoModel — 2-bank Model-conforming slot-LFO editor

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Chain config + init wiring

**Files:**
- Modify: `src/chain/config.ts`
- Modify: `src/app/init.ts:14-16` (the `trackModels` builder)
- Test: `browser-test/logic.mjs` (append a short block)

**Interfaces:**
- Consumes: `createLfoModel` (Task 2).
- Produces: `CHAIN_SLOTS` gains a 5th entry `{ componentKey: 'lfo', label: 'LFO', … }`; `LFO_CHAIN_INDEX: number` (= 4); `isLfoSlot(chainIndex: number): boolean`.

- [ ] **Step 1: Write the failing test** — append to `browser-test/logic.mjs`:

Add import (top):
```js
import { CHAIN_SLOTS, LFO_CHAIN_INDEX, isLfoSlot } from '../dist/esm/chain/config.js';
import { init } from '../dist/esm/app/init.js';
import { appState } from '../dist/esm/app/state.js';
```

Test block:
```js
_log('\nTest: LFO chain slot wiring');
{
    eq('CHAIN_SLOTS has 5 entries', CHAIN_SLOTS.length, 5);
    eq('slot 4 is LFO', CHAIN_SLOTS[4].componentKey, 'lfo');
    eq('LFO_CHAIN_INDEX', LFO_CHAIN_INDEX, 4);
    eq('isLfoSlot(4)', isLfoSlot(4), true);
    eq('isLfoSlot(1)', isLfoSlot(1), false);

    env.setParams({});
    init();
    eq('each track has 5 models', appState.trackModels[0].length, 5);
    eq('track model 4 is LFO', appState.trackModels[0][4].getComponentKey(), 'lfo');
    eq('track model 1 is a module', appState.trackModels[0][1].getComponentKey(), 'synth');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `LFO_CHAIN_INDEX`/`isLfoSlot` undefined, or `CHAIN_SLOTS has 5 entries` expected 5 got 4.

- [ ] **Step 3: Write minimal implementation**

In `src/chain/config.ts`, add the 5th `CHAIN_SLOTS` entry (after `fx2`) and the helpers (after the `CHAIN_SLOTS` array):
```ts
    { componentKey: 'fx2',      label: 'FX 2',    scanDir: 'audio_fx',         expectedType: 'audio_fx'        },
    { componentKey: 'lfo',      label: 'LFO',     scanDir: '',                 expectedType: ''                },
];

/* The LFO is a virtual last chain slot (no module to scan/swap) — it edits the
 * track's two schwung slot LFOs. */
export const LFO_CHAIN_INDEX = CHAIN_SLOTS.length - 1;
export function isLfoSlot(chainIndex: number): boolean { return chainIndex === LFO_CHAIN_INDEX; }
```
(Keep the existing `MASTER_FX_SLOTS` and `moduleReadKey` below unchanged.)

In `src/app/init.ts`, add the import and replace the `trackModels` builder:
```ts
import { createModel }  from '../model/index.js';
import { createLfoModel } from '../lfo/model.js';
import { appState, VIEW_CHAIN } from './state.js';
```
```ts
    appState.trackModels = Array.from({ length: 4 }, (_, slot) =>
        CHAIN_SLOTS.map((s, i) => isLfoSlot(i) ? createLfoModel(slot) : createModel(slot, s.componentKey)),
    );
```
And extend the existing `CHAIN_SLOTS` import to include `isLfoSlot`:
```ts
import { CHAIN_SLOTS, MASTER_FX_SLOTS, isLfoSlot } from '../chain/config.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: PASS — "LFO chain slot wiring" all ✓; `0 failures`.

- [ ] **Step 5: Commit**

```bash
git add src/chain/config.ts src/app/init.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(lfo): add LFO as 5th chain slot, wire per-track LFO model

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Router navigation — reach & drill the LFO slot

**Files:**
- Modify: `src/midi/router.ts` (import + chain-index clamps + browser-skip guards)
- Test: `browser-test/app-loop.mjs` (append a test block)

**Interfaces:**
- Consumes: `LFO_CHAIN_INDEX`, `isLfoSlot` (Task 3).
- Produces: jog/←→ chain nav reaches index 4; jog-click on the LFO slot drills `VIEW_CHAIN`→`VIEW_KNOBS`; the module browser is never opened for the LFO slot.

- [ ] **Step 1: Write the failing test** — append to `browser-test/app-loop.mjs`. Match the file's existing harness (it already imports `installEnv`, builds the app, and has `sendMidi`/`advance`/`eq` helpers and an `init()` path — mirror the nearest existing chain-nav test for setup).

```js
_log('\nTest: LFO chain slot reachable + drill');
{
    const { appState, VIEW_CHAIN, VIEW_KNOBS } = await import('../dist/esm/app/state.js');
    // (Re)initialise the app to a known state, matching the setup used by the
    // other chain-nav tests in this file.
    reinitApp();                              // helper already used above in this file
    appState.currentView = VIEW_CHAIN;
    appState.trackChainIndex[0] = 1;          // start on SYNTH

    // Jog right 3 detents: 1→2→3→4 (LFO).
    sendMidi([0xB0, 14, 1]); advance(1);
    sendMidi([0xB0, 14, 1]); advance(1);
    sendMidi([0xB0, 14, 1]); advance(1);
    eq('jog reaches LFO slot (index 4)', appState.trackChainIndex[0], 4);

    // Jog-click drills into the LFO detail (VIEW_KNOBS), never a browser.
    sendMidi([0xB0, 3, 127]); advance(1);
    eq('LFO jog-click drills to VIEW_KNOBS', appState.currentView, VIEW_KNOBS);
    eq('active model is the LFO', appState.trackModels[0][4].getComponentKey(), 'lfo');

    // Jog in detail scrolls banks LFO1↔LFO2.
    sendMidi([0xB0, 14, 1]); advance(1);
    eq('detail jog scrolls to LFO 2', appState.trackModels[0][4].getKnobPage(), 1);

    // Shift+jog-click on the LFO chain page also drills (no browser to swap).
    appState.currentView = VIEW_CHAIN;
    appState.shiftHeld = true;
    sendMidi([0xB0, 3, 127]); advance(1);
    eq('shift+click on LFO drills, no browser', appState.currentView, VIEW_KNOBS);
    appState.shiftHeld = false;
}
```

Note: if the file names its re-init helper differently (e.g. inline `init()` + `installEnv`), use that exact pattern from the nearest existing test rather than `reinitApp()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build:browser && node browser-test/app-loop.mjs`
Expected: FAIL — `jog reaches LFO slot` gets `3` (clamped at old max), or `shift+click` opens the browser (`VIEW_BROWSE`) instead of `VIEW_KNOBS`.

- [ ] **Step 3: Write minimal implementation** — in `src/midi/router.ts`:

Extend the config import (currently `import { CHAIN_SLOTS, MASTER_FX_SLOTS } from '../chain/config.js';`):
```ts
import { CHAIN_SLOTS, MASTER_FX_SLOTS, LFO_CHAIN_INDEX, isLfoSlot } from '../chain/config.js';
```

Raise the chain-index clamps (the jog-rotation `VIEW_CHAIN` block has this exact line twice; use replace-all):
- Replace `setChainIndex(Math.max(0, Math.min(3, chainIndex() + dir)));`
  with `setChainIndex(Math.max(0, Math.min(LFO_CHAIN_INDEX, chainIndex() + dir)));`
- In the Right-button `VIEW_CHAIN` branch, replace `else setChainIndex(Math.min(3, chainIndex() + 1));`
  with `else setChainIndex(Math.min(LFO_CHAIN_INDEX, chainIndex() + 1));`

Guard the browser in the jog-click `VIEW_CHAIN` branch. Replace:
```ts
            } else if (appState.currentView === VIEW_CHAIN) {
                const isEmpty = activeModel()?.getViewModel().isEmpty ?? false;
                if (appState.shiftHeld || isEmpty) {
                    openBrowser(CHAIN_SLOTS[chainIndex()], appState.activeSlot, () => activeModel()?.reload());
                    appState.browseOrigin = VIEW_CHAIN;
                } else {
                    appState.currentView = VIEW_KNOBS;
                    appState.dirty = true;
                }
```
with:
```ts
            } else if (appState.currentView === VIEW_CHAIN) {
                const isEmpty = activeModel()?.getViewModel().isEmpty ?? false;
                // The LFO slot has no module to add/swap — a click always drills.
                if (!isLfoSlot(chainIndex()) && (appState.shiftHeld || isEmpty)) {
                    openBrowser(CHAIN_SLOTS[chainIndex()], appState.activeSlot, () => activeModel()?.reload());
                    appState.browseOrigin = VIEW_CHAIN;
                } else {
                    appState.currentView = VIEW_KNOBS;
                    appState.dirty = true;
                }
```

Guard the browser in the jog-click `VIEW_KNOBS` fall-through. Replace:
```ts
            } else {
                // VIEW_KNOBS with no file param held → module browser.
                openBrowser(CHAIN_SLOTS[chainIndex()], appState.activeSlot, () => activeModel()?.reload());
                appState.browseOrigin = VIEW_KNOBS;
            }
```
with:
```ts
            } else if (!isLfoSlot(chainIndex())) {
                // VIEW_KNOBS with no file param held → module browser (the LFO
                // slot has no module to swap, so a click is a no-op there).
                openBrowser(CHAIN_SLOTS[chainIndex()], appState.activeSlot, () => activeModel()?.reload());
                appState.browseOrigin = VIEW_KNOBS;
            }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build:browser && node browser-test/app-loop.mjs`
Expected: PASS — the "LFO chain slot reachable + drill" block all ✓.

- [ ] **Step 5: Commit**

```bash
git add src/midi/router.ts browser-test/app-loop.mjs
git commit -m "$(cat <<'EOF'
feat(lfo): route chain nav + drill to the LFO slot (no module browser)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: LFO chain-page text + screenshot baselines

**Files:**
- Modify: `src/renderer/chain-view.ts` (LFO-specific jog toast)
- Modify: `browser-test/screenshot.mjs` (PRESETS + scenes)
- Create: `browser-test/screenshots/baseline/lfo_*.png` (via `--update`)

**Interfaces:**
- Consumes: `createLfoModel` (Task 2), `isLfoSlot` (Task 3), `renderChainView`/`renderKnobsView`.
- Produces: baselines `lfo_chain`, `lfo_lfo1`, `lfo_lfo2`, `lfo_target_overlay`, `lfo_shape_overlay`.

- [ ] **Step 1: Add the chain-view LFO toast** — in `src/renderer/chain-view.ts`, extend the config import and the final jog-toast line.

Import:
```ts
import { CHAIN_SLOTS, isLfoSlot } from '../chain/config.js';
```
Replace the last line of the non-empty path:
```ts
    if (jogTouched) drawJogToast('SHIFT+CLICK SWAP  CLICK OPEN');
```
with:
```ts
    if (jogTouched) drawJogToast(isLfoSlot(chainIndex) ? 'CLICK JOG: EDIT LFOS' : 'SHIFT+CLICK SWAP  CLICK OPEN');
```

- [ ] **Step 2: Add screenshot scenes** — in `browser-test/screenshot.mjs`:

Add the preset names to the `PRESETS` array (e.g. after `'chain_t4',`):
```js
    'lfo_chain', 'lfo_lfo1', 'lfo_lfo2', 'lfo_target_overlay', 'lfo_shape_overlay',
```

Import `createLfoModel` near the other dynamic imports (with `renderChainView`/`renderKnobsView`):
```js
const { createLfoModel } = await import('../dist/esm/lfo/model.js');
```

Add cases in the scene switch. Each seeds a minimal env so the target list has entries, builds the LFO model, and renders:
```js
        case 'lfo_chain':
        case 'lfo_lfo1':
        case 'lfo_lfo2':
        case 'lfo_target_overlay':
        case 'lfo_shape_overlay': {
            installEnv().setParams({
                'synth:chain_params': JSON.stringify([
                    { key: 'cutoff', name: 'Cutoff', type: 'float' },
                    { key: 'reso',   name: 'Resonance', type: 'float' },
                ]),
                'fx1:chain_params': JSON.stringify([{ key: 'mix', name: 'Mix', type: 'float' }]),
                'lfo1:sync': '0', 'lfo1:rate_hz': '2.0', 'lfo1:depth': '0.65', 'lfo1:shape': '0',
                'lfo2:sync': '1', 'lfo2:rate_div': '19', 'lfo2:shape': '3',
            });
            const lm = createLfoModel(0);
            lm.tick();
            if (preset === 'lfo_lfo2') lm.changePage(1);
            if (preset === 'lfo_target_overlay') lm.handleKnobTouch(0);
            if (preset === 'lfo_shape_overlay') lm.handleKnobTouch(1);
            if (preset === 'lfo_chain') lastRender = () => renderChainView(lm.getViewModel(), 4, false, 'T1', 'LFO');
            else lastRender = () => renderKnobsView(lm.getViewModel(), false, 0);
            lastRender();
            break;
        }
```
(If `installEnv` is not already imported in `screenshot.mjs`, it is — see the top imports; otherwise reuse the module-level `installEnv()` call it already makes and expose its `env`.)

- [ ] **Step 3: Generate baselines**

Run: `npm run build:browser && node browser-test/screenshot.mjs --update`
Expected: `updated` printed for each new `lfo_*` scene; new PNGs under `browser-test/screenshots/baseline/`.

- [ ] **Step 4: Verify baselines are stable**

Run: `node browser-test/screenshot.mjs`
Expected: `0 failures` (the just-generated baselines match). Visually open the 5 `lfo_*.png` files to confirm: chain page shows the 8 LFO widgets; `lfo_lfo1`/`lfo_lfo2` show 2-segment bank bar; overlays show the scrollable list.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/chain-view.ts browser-test/screenshot.mjs browser-test/screenshots/baseline/lfo_chain.png browser-test/screenshots/baseline/lfo_lfo1.png browser-test/screenshots/baseline/lfo_lfo2.png browser-test/screenshots/baseline/lfo_target_overlay.png browser-test/screenshots/baseline/lfo_shape_overlay.png
git commit -m "$(cat <<'EOF'
feat(lfo): LFO chain-page toast + screenshot baselines

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Full local suite, device verification, and finalize

**Files:** none (verification + optional device run).

- [ ] **Step 1: Run the full local suite**

Run:
```bash
npm test
node browser-test/app-loop.mjs
node browser-test/screenshot.mjs
node browser-test/perf.mjs
```
Expected: every suite reports `0 failures`. (`npm test` builds then runs the four `.mjs` suites; `perf.mjs` confirms no fill_rect/IPC regressions from the new page.)

- [ ] **Step 2: Device check (if `move.local` reachable)**

Run:
```bash
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null && ./scripts/test.sh || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```
Expected: `test.sh` passes (deploy + param-UI e2e). Then manually confirm on device: chain jog reaches **LFO**; jog-click drills; jog scrolls LFO 1 ↔ LFO 2; setting Target auto-enables and the target param audibly modulates; Rate flips between Hz and divisions with Sync; Retrigger resets phase on note-on.
**If the device is offline, report it to the user in CAPS.**

- [ ] **Step 3: Push**

```bash
git push
```

---

## Self-Review

**Spec coverage:**
- 5th chain page "LFO" → Task 3 (`CHAIN_SLOTS`+`isLfoSlot`), Task 4 (nav), Task 5 (toast/baseline). ✓
- Chain page = LFO 1, drill = LFO 1/2 banks → Task 2 (`bank`/`changePage`/2 banks), Task 4 (drill). ✓
- Per-track nav-state preservation → LFO model per track in `trackModels` + `trackChainIndex` (Task 3), reuses existing view routing. ✓
- 8 params + widgets (Target/Shape overlay, Mode/Sync inline enum, Rate dual-mode arc, Depth/Phase arc, Retrigger hbar) → Task 2 `buildCells`/`handleKnobDelta`. ✓
- Depth as regular knob (user override) → arc cell, `(depth+1)/2` norm, signed % display. ✓
- Target = flat shortened list, auto-enable, None disables → Task 1 `buildTargetOptions`/`shortenTarget`, Task 2 `openOverlay`/`commitOverlay`. ✓
- Modulatable filter = float/int/enum from `chain_params` → Task 1. ✓
- Rate well-scaled in both modes → Task 1 `RATE_HZ_FACTOR`, Task 2 `stepDiscrete`/`rateNorm`. ✓
- Not automatable → `automatable:false` cells + `getKnobParamInfo`→null (Task 2), asserted in tests. ✓
- No C/engine changes, `enabled` hidden → Task 2 (writes `enabled` implicitly; no C touched). ✓
- Tests: logic (Tasks 1-3), app-loop (Task 4), screenshot (Task 5), full suite + device (Task 6). ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step shows real assertions. ✓

**Type consistency:** `createLfoModel(track): Model` returns all 22 `Model` members with matching names/signatures (`handleKnobDelta`, `handleKnobTouch`, `handleKnobRelease`, `getKnobPage`, `getBankCount`, `changePage`, `getModuleName`, `reset`, `tick`, `getViewModel`, `reload`, `getFileBrowseTarget`, `clearFileOverlay`, `setFileValue`, `getComponentKey`, `getKnobParamInfo`, `setNoRefreshKeys`, `paramRangeByKey`, `hasLoadedParams`, `getValueByKey`, `getDrumConfig`, `updateDrumPad`). Param helpers exported from Task 1 are used with identical names in Tasks 2/5. `LFO_CHAIN_INDEX`/`isLfoSlot` defined in Task 3 and consumed in Tasks 4/5. ✓
