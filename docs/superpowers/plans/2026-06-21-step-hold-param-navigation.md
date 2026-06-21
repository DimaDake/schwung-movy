# Step-hold Parameter Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** While a step is held, make the jog wheel, jog-press and Back navigate param pages / chain modules (so automation spans pages and modules) instead of editing note length or opening the module browser.

**Architecture:** Input-routing only — the held-step / step-auto state already persists across page/chain/module changes. (1) `seq/router.ts` stops consuming the jog wheel for `editLength`; (2) `midi/router.ts` jog-click suppresses the browser while a step is held. Limit hide+toast is already immediate via `poolIsFull`.

**Tech Stack:** TypeScript (src → ui.js via esbuild), browser-test `.mjs` harnesses (logic, app-loop).

**Test MIDI reference:** step button N = `[0x90, 16+N, 127]` / `[0x80, 16+N, 0]`; jog wheel +1 = `[0xB0, 14, 1]`; jog press = `[0xB0, 3, 127]`; Back = `[0xB0, 51, 127]`. Views: `VIEW_KNOBS`, `VIEW_CHAIN`, `VIEW_BROWSE` from `dist/esm/app/state.js`.

---

### Task 1: Jog wheel while holding a step switches param page (not note length)

**Files:**
- Modify: `src/seq/router.ts` (CC_WHEEL handler, ~line 203)
- Modify: `src/seq/step-edit.ts` (remove `editLength`, ~line 145)
- Test: `browser-test/app-loop.mjs`

- [ ] **Step 1: Write the failing test** — add before the file-browser test block in `browser-test/app-loop.mjs`. Needs `VIEW_CHAIN` import (already imported: `VIEW_KNOBS`; add `VIEW_CHAIN` to the import from `dist/esm/app/state.js`).

```js
/* ── step-hold: jog wheel switches param page, never note length ──────────── */
_log('\napp-loop: jog wheel while holding a step switches page (not length)');
{
    resetApp();
    appState.currentView = VIEW_KNOBS;
    const vm = () => appState.trackModels[0][appState.trackChainIndex[0]].getViewModel();
    const page0 = vm().bankIndex;
    sendMidi([0x90, 16, 127]);            // hold step 1
    engine.ops.length = 0;                // watch for any 'elen' length edit
    sendMidi([0xB0, 14, 1]);              // jog wheel +1
    eq('held-step jog switches page', vm().bankIndex, page0 + 1);
    eq('no note-length edit emitted', engine.ops.some(o => o.startsWith('elen')), false);
    sendMidi([0x80, 16, 0]);              // release step
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/app-loop.mjs 2>&1 | grep -iE "held-step jog|note-length|FAIL"`
Expected: FAIL — `held-step jog switches page` got `0` (wheel consumed by editLength) and `elen` was emitted.

- [ ] **Step 3: Remove the editLength call** in `src/seq/router.ts`. Change:

```ts
    if (d1 === CC_WHEEL) {
        if (editLength(decodeDelta(d2))) return true;
        if (loopHeld()) return loopWheel(decodeDelta(d2));
```
to (drop the editLength line; keep the rest of the block exactly as-is):
```ts
    if (d1 === CC_WHEEL) {
        // While a step is held the wheel navigates param pages (handled by the
        // normal jog path in midi/router); it no longer edits note length.
        if (loopHeld()) return loopWheel(decodeDelta(d2));
```
Then remove the now-unused `editLength` import on that file's import line (from `./step-edit.js`).

- [ ] **Step 4: Remove the `editLength` function** from `src/seq/step-edit.ts` (the whole `export function editLength(...) {...}` block, ~lines 144-151). Leave `editVelocity`, `editNudge`, etc. untouched.

- [ ] **Step 5: Run the test + typecheck**

Run: `npm run typecheck && npm run build:browser && node browser-test/app-loop.mjs 2>&1 | grep -iE "held-step jog|note-length|ALL APP|FAIL"`
Expected: both assertions PASS, `ALL APP-LOOP CHECKS PASSED`, zero TS errors.

- [ ] **Step 6: Commit**

```bash
git add src/seq/router.ts src/seq/step-edit.ts browser-test/app-loop.mjs
git commit -m "Jog wheel navigates pages while holding a step (drop length-on-jog)"
```

---

### Task 2: Jog-press while holding a step suppresses the module browser

**Files:**
- Modify: `src/midi/router.ts` (jog-click handler, ~line 196-251)
- Test: `browser-test/app-loop.mjs`

- [ ] **Step 1: Write the failing test** — add after the Task 1 test.

```js
/* ── step-hold: jog-press suppresses the module browser ───────────────────── */
_log('\napp-loop: jog-press while holding a step never opens the browser');
{
    resetApp();
    // In the param page, jog-press normally opens the module browser; while a
    // step is held it must be a no-op.
    appState.currentView = VIEW_KNOBS;
    sendMidi([0x90, 16, 127]);            // hold step 1
    sendMidi([0xB0, 3, 127]);             // jog press
    eq('knobs+held jog-press stays in params', appState.currentView, VIEW_KNOBS);
    sendMidi([0x80, 16, 0]);

    // In the chain view, jog-press drills into the focused module's params.
    appState.currentView = VIEW_CHAIN;
    sendMidi([0x90, 16, 127]);
    sendMidi([0xB0, 3, 127]);
    eq('chain+held jog-press drills to params', appState.currentView, VIEW_KNOBS);
    eq('chain+held jog-press did not open browser', appState.currentView !== VIEW_BROWSE, true);
    sendMidi([0x80, 16, 0]);
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node browser-test/app-loop.mjs 2>&1 | grep -iE "jog-press|FAIL"`
Expected: FAIL — `knobs+held jog-press stays in params` got `VIEW_BROWSE` (current code opens the module browser).

- [ ] **Step 3: Add the held-step guard** at the top of the jog-click handler in `src/midi/router.ts`. Immediately after `if (d1 === MoveMainButton && d2 > 0) {` insert:

```ts
        // While a step is held, the jog click is navigation-only: drill from the
        // chain into the focused module's params, never open a browser (Back
        // returns to the chain). Lets one held step automate across modules.
        if (anyStepHeld()) {
            if (appState.currentView === VIEW_CHAIN) {
                appState.currentView = VIEW_KNOBS;
                appState.dirty = true;
            }
            return;
        }
```
Add the import at the top of `src/midi/router.ts`: `import { anyStepHeld } from '../seq/step-edit.js';` (place beside the other `../seq/*` imports).

- [ ] **Step 4: Run the test + typecheck**

Run: `npm run typecheck && npm run build:browser && node browser-test/app-loop.mjs 2>&1 | grep -iE "jog-press|ALL APP|FAIL"`
Expected: all three assertions PASS, `ALL APP-LOOP CHECKS PASSED`.

- [ ] **Step 5: Commit**

```bash
git add src/midi/router.ts browser-test/app-loop.mjs
git commit -m "Suppress module browser on jog-press while holding a step"
```

---

### Task 3: Back while holding a step returns to the chain view (regression guard)

**Files:**
- Test: `browser-test/app-loop.mjs`

This behaviour already works (`MoveBack` is not intercepted by the seq router); the test locks it so the feature isn't silently broken later.

- [ ] **Step 1: Write the guard test** — add after the Task 2 test.

```js
/* ── step-hold: Back returns to the chain view (feature relies on this) ────── */
_log('\napp-loop: Back while holding a step returns to chain view');
{
    resetApp();
    appState.currentView = VIEW_KNOBS;
    sendMidi([0x90, 16, 127]);            // hold step 1
    sendMidi([0xB0, 51, 127]);            // Back
    eq('Back while holding a step → chain view', appState.currentView, VIEW_CHAIN);
    sendMidi([0x80, 16, 0]);
}
```

- [ ] **Step 2: Run it (passes immediately — documents existing behaviour)**

Run: `node browser-test/app-loop.mjs 2>&1 | grep -iE "Back while holding|ALL APP|FAIL"`
Expected: PASS, `ALL APP-LOOP CHECKS PASSED`.

- [ ] **Step 3: Commit**

```bash
git add browser-test/app-loop.mjs
git commit -m "Lock Back→chain while holding a step (regression guard)"
```

---

### Task 4: The limit toast appears immediately at 8 lanes

**Files:**
- Modify: `browser-test/app-loop.mjs` (extend the existing "pool-full toast wins the bottom rows" test)

`poolFull` is already derived live from `poolIsFull`, so the toast and hiding fire on the 8th assign. This adds the missing assertion that the toast TEXT is drawn (not just that the strip yields).

- [ ] **Step 1: Add a failing assertion** — in the existing `app-loop: pool-full toast wins the bottom rows over the loop strip` block, capture `fontPrint` text and assert the toast string. Replace the `fill_rect` capture section with one that also captures `fontPrint`:

```js
    const rects = [];
    const texts = [];
    const origFR = globalThis.fill_rect;
    const origFP = globalThis.fontPrint;
    globalThis.fill_rect = (x, y, w, h, v) => rects.push([x, y, w, h, v]);
    globalThis.fontPrint = (x, y, s, c) => { texts.push(String(s)); };
    advance(1);
    globalThis.fill_rect = origFR;
    globalThis.fontPrint = origFP;
    const stripDrawn = rects.some(([x, y, w, h, v]) => x === 0 && y === 60 && w === 128 && h === 4 && v === 0);
    eq('loop strip suppressed under pool-full toast', stripDrawn, false);
    eq('pool-full toast text shown immediately', texts.some(t => t.includes('FULL')), true);
```

- [ ] **Step 2: Run to verify it passes** (the toast already renders at 8 lanes; this assertion documents/locks it)

Run: `npm run build:browser && node browser-test/app-loop.mjs 2>&1 | grep -iE "pool-full toast text|loop strip suppressed|ALL APP|FAIL"`
Expected: both PASS. If `fontPrint` is not a capturable global in env.mjs, fall back to asserting via the existing `diagAutoRender`/`vm.automationPoolFull` instead (check `appState`-level flag), but env.mjs defines `fontPrint` as a no-op global so the override works.

- [ ] **Step 3: Commit**

```bash
git add browser-test/app-loop.mjs
git commit -m "Lock immediate pool-full toast at 8 lanes"
```

---

### Task 5: Full local suite + device verification

- [ ] **Step 1: Full local suite**

Run: `npm test` (build + logic + app-loop + screenshot + perf). Expected: all PASSED.

- [ ] **Step 2: Deploy + device sanity** (UI-only; engine unchanged — stays v0.18.0)

Run: `ssh -o ConnectTimeout=5 ableton@move.local echo ok && ./scripts/deploy.sh move.local || echo "DEVICE OFFLINE — report in CAPS"`

- [ ] **Step 3: Manual device check (report results):** hold a step → jog across param pages; jog-press from chain to drill into a module's params; Back to the chain; automate params on two pages / two modules; assign 8 lanes → confirm other knobs hide and the "8 AUTOMATION LANES — FULL" toast shows immediately.

- [ ] **Step 4: Commit any baseline updates** if screenshot baselines changed (none expected — no render-function changes).

---

## Self-Review

- **Spec coverage:** Req 1 (jog→page) = Task 1; Req 2 (jog-press suppress browser + Back) = Tasks 2,3; Req 3 (across pages/modules) = enabled by Tasks 1–2, exercised in Task 5; Req 4 (immediate hide+toast) = Task 4. ✓
- **Placeholders:** none (all code shown; MIDI values fixed at top).
- **Type consistency:** `anyStepHeld` (existing export from `step-edit.ts`), `editLength` removed from both its definition and its caller, `poolIsFull`-derived `automationPoolFull` unchanged. ✓
- **Ambiguity:** jog-press in VIEW_KNOBS = no-op (confirmed); VIEW_CHAIN = drill to VIEW_KNOBS. ✓
