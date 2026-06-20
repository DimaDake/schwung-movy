# Mr Drums Per-Pad Automation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use `- [ ]`.

**Goal:** Scope Mr Drums knob values, edits, and automation to the manually-focused
drum pad by addressing every pad-scoped param via its concrete `p<NN>_*` key, with
no Mr-Drums-specific literal in movy `.ts`.

**Architecture:** A movy-owned focused pad (`drumCurrentPad`, no longer seeded from
the DSP) + a pure `concreteKey(padScoping, pad, aliasKey)` helper drive all DSP
I/O (read/write/automation lane target). The dot/value resolve the same way, so a
pad switch naturally re-scopes them. Mr-Drums-specific facts live only in
`mrdrums.json`.

**Tech Stack:** TypeScript (esbuild → ui.js / dist/esm), node browser-test suites.

Spec: `movy/plans/2026-06-20-mrdrums-per-pad-automation.md`.

---

### Task 1: Types & config

**Files:** Modify `src/types/param.ts`, `src/modules/mrdrums.json`

- [ ] **Step 1:** Add to `src/types/param.ts`:
  - `KnobParam.automatable: boolean`
  - `BankConfig.global?: boolean`
  - `ModuleConfig.setOnLoad?: Record<string, string>`
  - `DrumConfig.padScoping?: { aliasPrefix: string; concreteKeyTemplate: string; padDigits: number }`
- [ ] **Step 2:** In `mrdrums.json`: add `drum.padScoping`
  (`{"aliasPrefix":"pad_","concreteKeyTemplate":"p{pad}_{suffix}","padDigits":2}`),
  top-level `"setOnLoad": {"ui_auto_select_pad": "off"}`, and `"global": true` on
  the `Global` bank.
- [ ] **Step 3:** `npm run typecheck` → 0 errors (new field on KnobParam will flag
  the two construction sites in hierarchy.ts; fixed in Task 3).

### Task 2: `concreteKey` pure helper (TDD)

**Files:** Create `src/model/pad-scope.ts`, `browser-test/logic.mjs` (add cases)

- [ ] **Step 1 (failing test):** In logic.mjs add a `pad-scope` block:
```js
const { concreteKey } = await import('../dist/esm/model/pad-scope.js');
const ps = { aliasPrefix:'pad_', concreteKeyTemplate:'p{pad}_{suffix}', padDigits:2 };
eq('pad-scope: alias→concrete', concreteKey(ps, 3, 'pad_vol'), 'p03_vol');
eq('pad-scope: non-pad passthrough', concreteKey(ps, 3, 'g_master_vol'), 'g_master_vol');
eq('pad-scope: no config passthrough', concreteKey(undefined, 3, 'pad_vol'), 'pad_vol');
const alt = { aliasPrefix:'v_', concreteKeyTemplate:'voice{pad}.{suffix}', padDigits:3 };
eq('pad-scope: generic template', concreteKey(alt, 7, 'v_cut'), 'voice007.cut');
```
- [ ] **Step 2:** `npm run build:browser && node browser-test/logic.mjs` → new cases FAIL (module missing).
- [ ] **Step 3 (impl):** Create `src/model/pad-scope.ts`:
```ts
import type { DrumConfig } from '../types/param.js';
type PadScoping = NonNullable<DrumConfig['padScoping']>;

/* Build the concrete per-pad key for a pad-scoped alias (e.g. pad 3 + "pad_vol"
 * → "p03_vol"). A key not carrying the alias prefix, or no scoping config,
 * passes through unchanged. The format is fully data-driven — no key-shape
 * literal is baked in here. */
export function concreteKey(ps: PadScoping | undefined, pad: number, key: string): string {
    if (!ps || !key.startsWith(ps.aliasPrefix)) return key;
    const suffix = key.slice(ps.aliasPrefix.length);
    const padStr = String(pad).padStart(ps.padDigits, '0');
    return ps.concreteKeyTemplate.replace('{pad}', padStr).replace('{suffix}', suffix);
}
```
- [ ] **Step 4:** rebuild + run → PASS.
- [ ] **Step 5:** Commit.

### Task 3: Stamp `automatable`, drop `ui_current_pad` seed, apply `setOnLoad`

**Files:** Modify `src/model/hierarchy.ts`

- [ ] **Step 1 (failing test):** In logic.mjs, boot mrdrums and assert a Global-bank
  numeric param is NOT automatable while a pad param is — via the viewmodel
  `automatable` flag (Task 5 wires the read; assert here once both land). Add:
```js
// mrdrums focused pad defaults to 1 (no longer seeded from ui_current_pad=5)
const md = bootModel(MOCK_SYNTHS.mrdrums, 0, 'synth');
eq('mrdrums focus defaults to 1', md.getViewModel().drumCurrentPad, 1);
```
- [ ] **Step 2:** rebuild + run → FAIL (currently seeds 5).
- [ ] **Step 3 (impl):**
  - Delete the `if (s.moduleConfig.drum.currentPadParam) { … read padRaw … }`
    block (hierarchy.ts:52-55). Keep `s.drumCurrentPad = 1` (line 47) and
    `drumPadCount`.
  - After `s.moduleConfig = loadModuleConfig(...)` (line 43), apply setOnLoad:
```ts
if (s.moduleConfig?.setOnLoad) {
    for (const [k, v] of Object.entries(s.moduleConfig.setOnLoad)) {
        shadow_set_param(s.activeSlot, s.componentKey + ':' + k, v);
    }
}
```
  - In the **config path** param build (line 102 loop), compute and stamp
    `automatable`. Inside `for (const bank of …)`, after building `param`:
```ts
param.automatable = (type === 'float' || type === 'int')
    && max > min && !bank.global;
```
  - In the **generic path**, stamp `automatable` on both pushed params
    (filepath branch → `false`; numeric branch →
    `(type==='float'||type==='int') && max>min && !key.startsWith('g_')`).
    The `g_` heuristic stays ONLY here — a fallback for config-less modules; Mr
    Drums uses the config path, so it never hits this.
- [ ] **Step 4:** rebuild + run → PASS; `npm run typecheck` → 0 errors.
- [ ] **Step 5:** Commit.

### Task 4: `paramIoKey` + route all I/O through it; `KnobParamInfo.ioKey`

**Files:** Modify `src/model/store.ts`

- [ ] **Step 1 (failing test):** In logic.mjs, capture set_param keys when turning a
  knob on mrdrums focused at pad 1 → expect `synth:p01_vol`, not `synth:pad_vol`:
```js
const seen = [];
const origSet = globalThis.shadow_set_param;
globalThis.shadow_set_param = (s,k,v) => { seen.push(k); return origSet(s,k,v); };
const dm = bootModel(MOCK_SYNTHS.mrdrums, 0, 'synth');  // pad VOL is gi 1, page 0
dm.handleKnobDelta(1, 5);
globalThis.shadow_set_param = origSet;
eq('normal edit writes concrete key', seen.includes('synth:p01_vol'), true);
eq('normal edit avoids alias', seen.includes('synth:pad_vol'), false);
```
  (Add `synth:p01_vol`, `synth:p05_vol` to the mrdrums mock so reads resolve.)
- [ ] **Step 2:** rebuild + run → FAIL.
- [ ] **Step 3 (impl):** In store.ts:
  - Import `concreteKey`. Add:
```ts
export function paramIoKey(s: ModelState, p: KnobParam): string {
    return concreteKey(s.moduleConfig?.drum?.padScoping, s.drumCurrentPad, p.key);
}
```
  - Replace the four `s.componentKey + ':' + p.key` I/O sites
    (`applyKnobDelta` read-seed `:55` and write `:71`; `refreshOneParam` `:91`,
    `:99`) with `s.componentKey + ':' + paramIoKey(s, p)`.
  - `refreshOneParam` guard: `if (s.noRefreshKeys.has(paramIoKey(s, p))) return;`
  - `knobParamInfo`: add `ioKey: paramIoKey(s, p)` to the returned object; replace
    the inline `automatable` (`:38-40`) with `p.automatable`.
  - Add `ioKey: string` to the `KnobParamInfo` interface.
- [ ] **Step 4:** rebuild + run → PASS.
- [ ] **Step 5:** Commit.

### Task 5: Viewmodel reads stamped `automatable`

**Files:** Modify `src/model/viewmodel.ts`

- [ ] **Step 1 (failing test):** assert global param non-automatable on mrdrums:
```js
const vm = bootModel(MOCK_SYNTHS.mrdrums, 0, 'synth').getViewModel();
// Global bank is page 2; flip pages then read. Simpler: assert pad VOL automatable.
eq('pad VOL automatable', vm.rows[0][1].automatable, true);
```
- [ ] **Step 2:** rebuild + run → should already pass for VOL; then change the
  inline calc.
- [ ] **Step 3 (impl):** Replace viewmodel.ts:53-55 `const automatable = …g_…;`
  with `const automatable = p.automatable;`.
- [ ] **Step 4:** rebuild + run → PASS.
- [ ] **Step 5:** Commit.

### Task 6: Automation lane targets use `ioKey`

**Files:** Modify `src/seq/automation.ts`, `src/midi/router.ts`

- [ ] **Step 1 (failing test):** In the automation test block, assign a lane on
  mrdrums focused pad 1 and assert the chain mapping targets `synth:p01_vol`:
```js
// drive handleAutomationKnob via router knob-CC with a held step; assert
// shadow_set_param('knob_1_set', 'synth:p01_vol') was issued.
```
  (Mirror the existing automation test setup; assert the `knob_<n>_set` value.)
- [ ] **Step 2:** rebuild + run → FAIL (targets `synth:pad_vol`).
- [ ] **Step 3 (impl):**
  - `router.ts:124`: `(lane) => shadow_set_param(track, 'knob_'+(lane+1)+'_set', info.target+':'+info.ioKey)`.
  - `automation.ts`: in `assignLane` and `handleAutomationKnob`, build
    `tp = info.target + ':' + info.ioKey`; set registry `shortName: <concrete key>`
    (the part after the colon, i.e. `info.ioKey`). `automationKnobReleased` and
    `clearLaneForKnob` resolve `laneForParam(info.target + ':' + info.ioKey)`.
- [ ] **Step 4:** rebuild + run → PASS.
- [ ] **Step 5:** Commit.

### Task 7: Dot/value scope to focused pad (pad-aware `laneForKey`)

**Files:** Modify `src/app/tick.ts`

- [ ] **Step 1 (failing test):** In app-loop.mjs (has full tick/render), automate
  pad 1 VOL on a held step, confirm the VOL knob shows the dot
  (`automated`/`assigned`), switch focus to pad 2 (manual pad press), confirm the
  dot is gone and VOL shows its base.
- [ ] **Step 2:** rebuild + run → FAIL (dot persists across pads).
- [ ] **Step 3 (impl):** In `buildAutomationView(track)`, obtain the active param
  model's focused pad + padScoping + componentKey, and rewrite `laneForKey`:
```ts
import { concreteKey } from '../model/pad-scope.js';
// inside buildAutomationView, given `m = the model whose page is rendered`:
const ps  = m.getDrumConfig()?.padScoping;
const pad  = m.getViewModel().drumCurrentPad;
const ck   = m.getComponentKey();
const laneForKey = (key: string): number => {
    const tp = ck + ':' + concreteKey(ps, pad, key);
    for (let l = 0; l < 8; l++) if (reg[l] && reg[l]!.targetParam === tp) return l;
    return -1;
};
```
  Pass the active model into `buildAutomationView` (update the two call sites at
  tick.ts:202,208 to `buildAutomationView(appState.activeSlot, activeModel!)`).
  Ensure `getComponentKey()` exists on the model (it's used in router.ts:95).
- [ ] **Step 4:** rebuild + run → PASS.
- [ ] **Step 5:** Commit.

### Task 8: Full local suite + screenshots + device

- [ ] **Step 1:** `npm test` (build + logic + app-loop + screenshot + perf) → 0
  failures. If drum rendering changed, `node browser-test/screenshot.mjs --update`
  then re-run.
- [ ] **Step 2:** Device (per CLAUDE.md): reachability check, then `./scripts/test.sh`.
  Add/extend a per-pad automation assertion (CC lands on focused pad; switching
  pad clears the dot). If `move.local` unreachable, **report DEVICE OFFLINE in CAPS.**
- [ ] **Step 3:** Final commit + push.

---

## Self-review

- **Spec coverage:** focused-pad (T3) · concrete I/O read/write (T4) · automation
  target (T6) · dot scoping (T7) · `g_`→config (T3+T5) · template genericness
  (T2) · `setOnLoad` (T3) · tests (T2,4,5,6,7,8). All covered.
- **Type consistency:** `concreteKey(ps,pad,key)`, `paramIoKey(s,p)`,
  `KnobParamInfo.ioKey`, `KnobParam.automatable`, `BankConfig.global`,
  `DrumConfig.padScoping`, `ModuleConfig.setOnLoad` — used consistently across tasks.
- **Placeholders:** none — every code step shows code; Task 6/7 test stubs note the
  existing harness to mirror.
