# Hold-a-knob → assign LFO target — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Assign a module parameter as a slot-LFO modulation target by holding its knob 500 ms, cycling LFO1/LFO2 with the jog, and committing with a jog-click; show a `~` indicator on modulated params.

**Architecture:** A hold timer + assign-mode state machine (`src/lfo/assign-mode.ts`) drive a bottom toast; target read/writes go through `src/lfo/assign.ts` (blocking). `buildViewModel` marks `ParamVM.modulated`; `drawLabelCell` draws a tilde alongside the automation dot.

**Tech Stack:** TypeScript → dist/esm (esbuild), node browser tests, 128×64 framebuffer.

## Global Constraints

- Design: `movy/plans/2026-07-11-lfo-assign-gesture-design.md`. Run from `movy/`; build before `.mjs` tests.
- New importable dist/esm modules → add to `build/browser.mjs` entryPoints.
- Gesture only for `KnobParamInfo.automatable` params; toast only while the knob is held; assign → navigate to LFO chain page, remove → stay + transient toast.
- Toast text: not assigned `CLICK: MODULATE <LFOn>`; assigned `CLICK: REMOVE <LFOn> MOD`.
- Blocking writes (`shadow_set_param_timeout`) for target commit. Typecheck must pass. Commit trailer `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`; stage specific files.

---

### Task 1: `src/lfo/assign.ts` target helpers (reused by the LFO model)

**Files:** Create `src/lfo/assign.ts`; Modify `src/lfo/model.ts` (commit via helpers), `build/browser.mjs`; Test `browser-test/logic.mjs`.

**Interfaces — Produces:** `lfoTargetsParam(track,lfoIdx,comp,param):boolean`, `assignLfoTarget(track,lfoIdx,comp,param):void`, `clearLfoTarget(track,lfoIdx):void`.

- [ ] **Step 1: failing test** (append to logic.mjs; import at top):
```js
import { lfoTargetsParam, assignLfoTarget, clearLfoTarget } from '../dist/esm/lfo/assign.js';
```
```js
_log('\nTest: lfo assign helpers');
{
    env.setParams({});
    assignLfoTarget(0, 0, 'synth', 'cutoff');
    eq('target written', env.params['lfo1:target'], 'synth');
    eq('target_param written', env.params['lfo1:target_param'], 'cutoff');
    eq('enabled written', env.params['lfo1:enabled'], '1');
    eq('targets param true', lfoTargetsParam(0, 0, 'synth', 'cutoff'), true);
    eq('targets other false', lfoTargetsParam(0, 0, 'synth', 'reso'), false);
    eq('lfo2 not targeting', lfoTargetsParam(0, 1, 'synth', 'cutoff'), false);
    clearLfoTarget(0, 0);
    eq('target cleared', env.params['lfo1:target'], '');
    eq('enabled cleared', env.params['lfo1:enabled'], '0');
    eq('targets param false after clear', lfoTargetsParam(0, 0, 'synth', 'cutoff'), false);
}
```

- [ ] **Step 2: run → fails** (`Cannot find module .../lfo/assign.js`).

- [ ] **Step 3: implement** — `src/lfo/assign.ts`:
```ts
/* Slot-LFO target read/write helpers. Blocking writes for the multi-field
 * target commit — the overtake param SHM is a single slot, so consecutive
 * non-blocking writes clobber each other and the target never persists. */

function lfoKey(lfoIdx: number, key: string): string { return 'lfo' + (lfoIdx + 1) + ':' + key; }

function setBlocking(track: number, key: string, val: string): void {
    if (typeof shadow_set_param_timeout === 'function') shadow_set_param_timeout(track, key, val, 100);
    else shadow_set_param(track, key, val);
}

export function lfoTargetsParam(track: number, lfoIdx: number, comp: string, param: string): boolean {
    return !!comp
        && shadow_get_param(track, lfoKey(lfoIdx, 'target')) === comp
        && shadow_get_param(track, lfoKey(lfoIdx, 'target_param')) === param;
}

export function assignLfoTarget(track: number, lfoIdx: number, comp: string, param: string): void {
    setBlocking(track, lfoKey(lfoIdx, 'target'), comp);
    setBlocking(track, lfoKey(lfoIdx, 'target_param'), param);
    setBlocking(track, lfoKey(lfoIdx, 'enabled'), '1');
}

export function clearLfoTarget(track: number, lfoIdx: number): void {
    setBlocking(track, lfoKey(lfoIdx, 'target'), '');
    setBlocking(track, lfoKey(lfoIdx, 'target_param'), '');
    setBlocking(track, lfoKey(lfoIdx, 'enabled'), '0');
}
```
In `build/browser.mjs` add `resolve(root, 'src/lfo/assign.ts'),` (near lfo entries).

In `src/lfo/model.ts`: import `{ assignLfoTarget, clearLfoTarget }` from `./assign.js`; delete the local `setPBlocking` function; replace the `commitOverlay` writes:
```ts
        if (overlay.opts) {
            const opt = overlay.opts[overlay.selected];
            if (!opt.target) {
                clearLfoTarget(track, bank);
                v.target = ''; v.targetParam = '';
            } else {
                assignLfoTarget(track, bank, opt.target, opt.param!);
                v.target = opt.target; v.targetParam = opt.param!;
            }
        }
```

- [ ] **Step 4: run → passes**; `npm run typecheck` → 0. (The existing "blocking writes" LFO test still passes — it captures `shadow_set_param_timeout`.)

- [ ] **Step 5: commit** (`src/lfo/assign.ts src/lfo/model.ts build/browser.mjs browser-test/logic.mjs`): `feat(lfo): shared slot-LFO target assign/clear helpers`.

---

### Task 2: `ParamVM.modulated` + `buildViewModel` detection

**Files:** Modify `src/types/viewmodel.ts`, `src/seq/param-vm.ts`, `src/model/viewmodel.ts`; Test `browser-test/logic.mjs`.

**Interfaces — Produces:** `ParamVM.modulated: boolean`; `buildViewModel` sets it from the track's `lfo1/lfo2` targets (track-chain components only).

- [ ] **Step 1: failing test** (append):
```js
_log('\nTest: buildViewModel marks modulated params');
{
    const { buildViewModel } = await import('../dist/esm/model/viewmodel.js');
    const kp = (key) => ({ key, label: key, shortLabel: null, type: 'float', min: 0, max: 1, step: 1,
        options: null, renderStyle: 'arc', automatable: true });
    const s = {
        activeSlot: 0, componentKey: 'synth', knobPage: 0, bankNames: [], moduleConfig: null,
        knobParams: [kp('cutoff'), kp('reso'), null, null, null, null, null, null],
        knobValues: [0, 0, null, null, null, null, null, null],
        enumFmt: [], fileValues: new Array(8).fill(null), touchedSlots: [],
        enumOverlay: null, fileOverlay: null, activeModuleName: 'X', moduleId: 'x', drumPadCount: 0,
        drumCurrentPad: 0, drumCurrentPhysPad: 0, noRefreshKeys: new Set(),
    };
    env.setParams({ 'lfo1:target': 'synth', 'lfo1:target_param': 'cutoff' });
    const vm = buildViewModel(s);
    eq('cutoff modulated', vm.rows[0][0].modulated, true);
    eq('reso not modulated', vm.rows[0][1].modulated, false);
    env.setParams({});   // no LFO target
    eq('none modulated when no target', buildViewModel(s).rows[0][0].modulated, false);
}
```

- [ ] **Step 2: run → fails** (`modulated` undefined).

- [ ] **Step 3: implement**

`src/types/viewmodel.ts` — add to `ParamVM` (after `assigned`):
```ts
    modulated:       boolean;   // an LFO targets this param → show the ~ mark
```
`src/seq/param-vm.ts` — add `modulated: false,` to the `paramCell` defaults object.

`src/model/viewmodel.ts` — import `paramIoKey`:
```ts
import { formatValue, paramIoKey } from './store.js';
```
After `nBanks`/before the cells loop, compute the target list once:
```ts
    // LFO modulation marks — track-chain modules only (master FX LFOs live in a
    // separate key space; the LFO page's own params aren't targets here).
    const lfoTargets: Array<[string, string]> = [];
    if (!s.componentKey.startsWith('master_fx')) {
        for (let i = 1; i <= 2; i++) {
            const t = shadow_get_param(s.activeSlot, 'lfo' + i + ':target') || '';
            if (t) lfoTargets.push([t, shadow_get_param(s.activeSlot, 'lfo' + i + ':target_param') || '']);
        }
    }
    const isModulated = (p: import('../types/param.js').KnobParam): boolean =>
        lfoTargets.length > 0 && lfoTargets.some(([t, tp]) => t === s.componentKey && tp === paramIoKey(s, p));
```
In the `rows[cell.line][cell.col] = { … }` object, add:
```ts
            modulated:       isModulated(p),
```

- [ ] **Step 4: run → passes**; typecheck → 0.

- [ ] **Step 5: commit** (`src/types/viewmodel.ts src/seq/param-vm.ts src/model/viewmodel.ts browser-test/logic.mjs`): `feat(lfo): mark params modulated by a slot LFO`.

---

### Task 3: `~` indicator in `drawLabelCell`

**Files:** Modify `src/renderer/label.ts`. (Verified by screenshots in Task 6.)

- [ ] **Step 1: implement** — in `src/renderer/label.ts`, add a helper above `drawLabelCell`:
```ts
/* Small drawn tilde (~5×3) — the modulation mark, mirror of the automation dot. */
function drawWaveMark(x: number, y: number, on: number): void {
    fill_rect(x,     y + 1, 1, 1, on);
    fill_rect(x + 1, y,     1, 1, on);
    fill_rect(x + 2, y,     1, 1, on);
    fill_rect(x + 2, y + 1, 1, 1, on);
    fill_rect(x + 3, y + 2, 1, 1, on);
    fill_rect(x + 4, y + 2, 1, 1, on);
}
```
Inside `drawLabelCell`, after the automation-dot block, add:
```ts
    // Modulation marker: a small tilde at the top-left of the text — coexists
    // with the automation dot (top-right). Inverted when the cell is filled.
    if (pvm.modulated) {
        const wx = Math.max(col * CELL_W, tx - 6);
        drawWaveMark(wx, lblY, pvm.touched ? 0 : 1);
    }
```

- [ ] **Step 2: build + typecheck** — `npm run build:browser && npm run typecheck` → 0. (No standalone test; Task 6 screenshots verify pixels.)

- [ ] **Step 3: commit** (`src/renderer/label.ts`): `feat(lfo): ~ modulation mark in the param label`.

---

### Task 4: `src/lfo/assign-mode.ts` gesture state machine

**Files:** Create `src/lfo/assign-mode.ts`; Modify `build/browser.mjs`; Test `browser-test/logic.mjs`.

**Interfaces — Produces:** `holdTouch(track,physK,info)`, `holdTurnCancel()`, `holdRelease(physK)`, `holdTick():boolean`, `assignActive():boolean`, `assignCycle(dir)`, `assignCommit():{assigned:boolean;lfoIdx:number}|null`, `assignToastText():string`, `resetAssignMode()`.

- [ ] **Step 1: failing test** (append; import at top `import { holdTouch, holdRelease, holdTurnCancel, holdTick, assignActive, assignCycle, assignCommit, assignToastText, resetAssignMode } from '../dist/esm/lfo/assign-mode.js';`):
```js
_log('\nTest: LFO assign-mode gesture');
{
    const info = (over = {}) => ({ gi: 0, key: 'cutoff', ioKey: 'cutoff', target: 'synth',
        value: 0, min: 0, max: 1, type: 'float', automatable: true, ...over });
    env.setParams({});
    resetAssignMode();

    // Non-automatable → never arms.
    holdTouch(0, 0, info({ automatable: false }));
    eq('non-automatable does not arm', holdTick(), false);

    // Automatable, but not yet 500ms → not active. (holdTick reads Date.now; we
    // can't fast-forward, so assert it does not activate immediately.)
    resetAssignMode();
    holdTouch(0, 0, info());
    eq('not active before 500ms', assignActive(), false);

    // Turning cancels the pending hold.
    holdTurnCancel();
    eq('turn cancels arm', holdTick(), false);

    // Simulate elapsed hold by back-dating: re-arm then force activation path via
    // repeated holdTick after monkey-patching Date.now.
    resetAssignMode();
    const realNow = Date.now;
    let t = 1000; Date.now = () => t;
    holdTouch(0, 0, info());
    t = 1400; eq('still not active at 400ms', holdTick(), false);
    t = 1600; eq('activates at ≥500ms', holdTick(), true);
    eq('active flag set', assignActive(), true);
    eq('toast = modulate LFO1', assignToastText(), 'CLICK: MODULATE <LFO1>');

    // Jog cycles LFO1 ↔ LFO2.
    assignCycle(1);
    eq('toast = modulate LFO2', assignToastText(), 'CLICK: MODULATE <LFO2>');

    // Commit assigns LFO2 to synth:cutoff and returns navigate info.
    const r = assignCommit();
    eq('commit assigned', JSON.stringify(r), JSON.stringify({ assigned: true, lfoIdx: 1 }));
    eq('lfo2 target written', env.params['lfo2:target'], 'synth');
    eq('mode exited after commit', assignActive(), false);

    // Re-arm on the same param: LFO2 already targets it → remove path.
    t = 2000; holdTouch(0, 0, info()); t = 2600;
    eq('re-activates', holdTick(), true);
    eq('starts on the assigned LFO2', assignToastText(), 'CLICK: REMOVE <LFO2> MOD');
    const r2 = assignCommit();
    eq('commit removed', JSON.stringify(r2), JSON.stringify({ assigned: false, lfoIdx: 1 }));
    eq('lfo2 target cleared', env.params['lfo2:target'], '');

    // Release cancels an active mode.
    t = 3000; holdTouch(0, 0, info()); t = 3600; holdTick();
    eq('active before release', assignActive(), true);
    holdRelease(0);
    eq('release cancels', assignActive(), false);
    Date.now = realNow;
}
```

- [ ] **Step 2: run → fails** (`Cannot find module .../lfo/assign-mode.js`).

- [ ] **Step 3: implement** — `src/lfo/assign-mode.ts`:
```ts
/* Hold-a-knob → assign it as a slot-LFO target. A 500ms hold (no turn) of an
 * automatable module param opens assign mode: a bottom toast, jog cycles
 * LFO1/LFO2, jog-click commits (assign or remove). Mode lives only while the
 * knob is held. Pure state + shadow target IO; navigation is done by the router. */

import type { KnobParamInfo } from '../model/store.js';
import { assignLfoTarget, clearLfoTarget, lfoTargetsParam } from './assign.js';

const HOLD_MS = 500;

interface Held { track: number; physK: number; info: KnobParamInfo; pressMs: number; }
const state = { held: null as Held | null, active: false, lfoSel: 0 };

export function holdTouch(track: number, physK: number, info: KnobParamInfo | null): void {
    state.active = false;
    state.held = (info && info.automatable) ? { track, physK, info, pressMs: Date.now() } : null;
}

export function holdTurnCancel(): void { state.held = null; if (state.active) resetAssignMode(); }

export function holdRelease(physK: number): void {
    if (state.held && state.held.physK !== physK) return;
    state.held = null;
    if (state.active) resetAssignMode();
}

/* Promote a 500ms hold-without-turn to assign mode. Returns true on activation. */
export function holdTick(): boolean {
    if (state.active || !state.held) return false;
    if (Date.now() - state.held.pressMs < HOLD_MS) return false;
    state.active = true;
    const { track, info } = state.held;
    state.lfoSel = lfoTargetsParam(track, 0, info.target, info.ioKey) ? 0
        : lfoTargetsParam(track, 1, info.target, info.ioKey) ? 1 : 0;
    return true;
}

export function assignActive(): boolean { return state.active; }

export function assignCycle(_dir: number): void { if (state.active) state.lfoSel ^= 1; }

export function assignCommit(): { assigned: boolean; lfoIdx: number } | null {
    if (!state.active || !state.held) return null;
    const { track, info } = state.held;
    const lfoIdx = state.lfoSel;
    const already = lfoTargetsParam(track, lfoIdx, info.target, info.ioKey);
    if (already) clearLfoTarget(track, lfoIdx);
    else assignLfoTarget(track, lfoIdx, info.target, info.ioKey);
    resetAssignMode();
    return { assigned: !already, lfoIdx };
}

export function assignToastText(): string {
    if (!state.active || !state.held) return '';
    const { track, info } = state.held;
    const name = 'LFO' + (state.lfoSel + 1);
    return lfoTargetsParam(track, state.lfoSel, info.target, info.ioKey)
        ? 'CLICK: REMOVE <' + name + '> MOD'
        : 'CLICK: MODULATE <' + name + '>';
}

export function resetAssignMode(): void { state.held = null; state.active = false; state.lfoSel = 0; }
```
In `build/browser.mjs` add `resolve(root, 'src/lfo/assign-mode.ts'),`.

- [ ] **Step 4: run → passes**; typecheck → 0.

- [ ] **Step 5: commit** (`src/lfo/assign-mode.ts build/browser.mjs browser-test/logic.mjs`): `feat(lfo): assign-mode gesture state machine`.

---

### Task 5: router + app/tick wiring

**Files:** Modify `src/midi/router.ts`, `src/app/tick.ts`; Test `browser-test/app-loop.mjs`.

- [ ] **Step 1: failing test** (append to app-loop.mjs):
```js
_log('\napp-loop: hold-knob → assign LFO target');
{
    const { appState, VIEW_CHAIN, VIEW_KNOBS } = await import('../dist/esm/app/state.js');
    const { resetAssignMode } = await import('../dist/esm/lfo/assign-mode.js');
    // Melodic synth so knob 0 is an automatable param.
    engine.reset();
    env.setParams(MOCK_SYNTHS.test8);
    resetSeqState(); resetSeqEngine();
    globalThis.init();
    appState.trackChainIndex[0] = 1;      // synth
    appState.currentView = VIEW_KNOBS;
    advance(4);
    resetAssignMode();

    const realNow = Date.now; let t = 10000; Date.now = () => t;
    sendMidi([0x90, 0, 100]);             // touch knob 0
    advance(1);
    t = 10600; advance(1);                // > 500ms → assign mode activates in tick
    const { assignActive } = await import('../dist/esm/lfo/assign-mode.js');
    eq('assign mode active after hold', assignActive(), true);

    sendMidi([0xB0, 3, 127]);             // jog-click → assign LFO1
    advance(1);
    eq('assigned: navigated to LFO slot', appState.trackChainIndex[0], 4);
    eq('assigned: on chain view', appState.currentView, VIEW_CHAIN);
    eq('assign mode exited', assignActive(), false);
    Date.now = realNow;
}
```

- [ ] **Step 2: run → fails** (`assign mode active after hold` false — no wiring).

- [ ] **Step 3: implement**

`src/midi/router.ts` — import:
```ts
import { holdTouch, holdRelease, holdTurnCancel, assignActive, assignCycle, assignCommit } from '../lfo/assign-mode.js';
```
Knob touch — after `automationKnobTouched(d1);`:
```ts
            holdTouch(appState.activeSlot, d1, info);   // arm hold-to-modulate
```
Knob release — in the `else` branch, after the existing lines:
```ts
            holdRelease(d1);
```
Knob CC turn — at the very start of the `if ((status & 0xF0) === 0xB0 && d1 >= KNOB_CC_BASE …)` block body (right after `const k`/`const delta`):
```ts
        holdTurnCancel();   // a knob turn cancels a pending / active hold
```
Jog rotation — first line inside `if (delta !== 0) {`:
```ts
            if (assignActive()) { assignCycle(delta); appState.dirty = true; return; }
```
Jog click — first line inside `if (d1 === MoveMainButton && d2 > 0) {`:
```ts
        if (assignActive()) {
            const r = assignCommit();
            if (r) {
                if (r.assigned) {
                    // Navigate to the assigned LFO on the chain page.
                    appState.trackChainIndex[appState.activeSlot] = LFO_CHAIN_INDEX;
                    appState.currentView = VIEW_CHAIN;
                    const lm = appState.trackModels[appState.activeSlot]?.[LFO_CHAIN_INDEX];
                    if (lm) lm.changePage(r.lfoIdx - lm.getKnobPage());
                } else {
                    seqToast('LFO' + (r.lfoIdx + 1) + ' mod removed');
                }
                appState.dirty = true;
            }
            return;
        }
```
Back button — at the start of the Back handler (`if (d1 === MoveBack && d2 > 0)` or equivalent), add `holdTurnCancel();` so Back also cancels an active hold. (Find the existing Back branch; insert as its first statement.)

`src/app/tick.ts` — imports:
```ts
import { holdTick, assignActive, assignToastText } from '../lfo/assign-mode.js';
import { drawJogToast } from '../renderer/overlay.js';
```
Near `stepAutoTick();` at the top of `tick()`:
```ts
    if (holdTick()) appState.dirty = true;   // 500ms knob-hold → LFO assign mode
```
Inside the render block, just before `if (toastShowing) drawSeqToast();`:
```ts
        if (assignActive()) { drawJogToast(assignToastText()); jogToastShown = true; }
```

- [ ] **Step 4: run → passes** — `npm run build:browser && node browser-test/app-loop.mjs`; typecheck → 0; `node browser-test/logic.mjs` still green.

- [ ] **Step 5: commit** (`src/midi/router.ts src/app/tick.ts browser-test/app-loop.mjs`): `feat(lfo): wire hold-to-modulate gesture + assign toast`.

---

### Task 6: screenshots

**Files:** Modify `browser-test/screenshot.mjs`; new baselines.

- [ ] **Step 1** — add scenes `lfo_mod_mark` (a synth param modulated → `~`) and `lfo_mod_and_auto` (same param also automated → `~` + dot), plus `lfo_assign_toast` (assign toast over a param page). In `PRESETS` add the three names; in `BASE` map each to `test8`. Add a case:
```js
        case 'lfo_mod_mark':
        case 'lfo_mod_and_auto': {
            loadPreset('test8');
            for (let i = 0; i < 6; i++) chainModels[1].tick();
            env.setParams({ ...env.params, 'lfo1:target': 'synth', 'lfo1:target_param': chainModels[1].getKnobParamInfo(0).ioKey });
            const auto = preset === 'lfo_mod_and_auto' ? autoView() : undefined;
            lastRender = () => renderKnobsView(chainModels[1].getViewModel(auto), false, 0);
            lastRender();
            break;
        }
        case 'lfo_assign_toast': {
            loadPreset('test8');
            for (let i = 0; i < 6; i++) chainModels[1].tick();
            const { holdTouch, holdTick, assignToastText, resetAssignMode } = await import('../dist/esm/lfo/assign-mode.js');
            const realNow = Date.now; let t = 1000; Date.now = () => t;
            resetAssignMode();
            holdTouch(0, 0, chainModels[1].getKnobParamInfo(0)); t = 1600; holdTick();
            Date.now = realNow;
            const { drawJogToast } = await import('../dist/esm/renderer/overlay.js');
            lastRender = () => { renderKnobsView(chainModels[1].getViewModel(), false, 0); drawJogToast(assignToastText()); };
            lastRender();
            break;
        }
```
(`autoView()` and `loadPreset`/`chainModels` already exist in the harness. If `getKnobParamInfo(0)` is null before ticks settle, the 6-tick warmup fixes it.)

- [ ] **Step 2** — `npm run build:browser && node browser-test/screenshot.mjs --update`; then `node browser-test/screenshot.mjs` → `0 failed`. Eyeball: `~` at top-left of the param label; `lfo_mod_and_auto` shows `~` (left) and the dot (right); `lfo_assign_toast` shows `CLICK: MODULATE <LFO1>` at the bottom.

- [ ] **Step 3: commit** the harness + new baselines: `test(lfo): modulation-mark + assign-toast screenshots`.

---

### Task 7: full suite, device, finalize

- [ ] **Step 1** — `npm test && node browser-test/app-loop.mjs && node browser-test/screenshot.mjs && node browser-test/perf.mjs && npm run typecheck` → all green / exit 0. (Confirm perf: the 4 extra `shadow_get_param` reads per build don't regress the perf thresholds.)
- [ ] **Step 2** — device: `ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null && { npm run build:device; ./scripts/test.sh; } || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"`. Then manually: hold a synth param knob 0.5 s → toast; jog cycles LFO1/LFO2; jog-click assigns and jumps to the LFO page; the param shows `~`; hold again → remove. **If offline, report in CAPS.**
- [ ] **Step 3** — `git push`.

---

## Self-Review

**Spec coverage:** hold gesture (Task 4/5), 500 ms + automatable gate (Task 4), toast text + jog cycle (Task 4/5), assign→navigate / remove→stay (Task 5), `~` indicator coexisting with dot (Task 2/3), target IO blocking (Task 1), tests (all), device (Task 7). ✓

**Placeholders:** none — full code for both new modules and every edit.

**Type consistency:** `KnobParamInfo` fields (`target`,`ioKey`,`automatable`) used consistently; assign-mode API names identical across Tasks 4/5; `assignCommit()` returns `{assigned,lfoIdx}` consumed verbatim in the router and tests; `ParamVM.modulated` defined (Task 2), set (Task 2), read (Task 3).
