# Enum Param Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow `enum` params to be assigned to automation lanes and record per-step locks, with the same knob feel as normal enum editing.

**Architecture:** Three surgical changes: (1) flip the `automatable` flag in `hierarchy.ts` to include `enum` types, (2) pre-scale the knob delta in `handleAutomationKnob` for enums so the 0-127 accumulator advances one option per `ENUM_DELTA_DIV` physical turns, (3) override `enumIndex` in `buildViewModel` so the enum square shows the locked option under a held step or live record. No engine changes.

**Tech Stack:** TypeScript (src/), Node.js tests (browser-test/logic.mjs), existing `MOCK_SYNTHS.test_enum` mock (4-option `mode`, 5-option `wave`).

---

### Task 1: Enable automatable flag for enum params

**Files:**
- Modify: `src/model/hierarchy.ts` (two `automatable` lines)
- Modify: `browser-test/logic.mjs` (add test section)

- [ ] **Step 1: Write the failing test**

Add this block near the bottom of `browser-test/logic.mjs`, before the final `if (failures)` check:

```javascript
/* ── automation: enum params are automatable ──────────────────────────────── */
_log('\nautomation: enum params are automatable:');
{
    const m = bootModel(MOCK_SYNTHS.test_enum);
    // knob 0 = mode (enum, 4 options, max=3 → automatable because max > min)
    const modeInfo = m.getKnobParamInfo(0);
    eq('4-option enum param is automatable', modeInfo?.automatable, true);
    // knob 2 = wave (enum, 5 options, max=4 → also automatable)
    const waveInfo = m.getKnobParamInfo(2);
    eq('5-option enum param is automatable', waveInfo?.automatable, true);
    // Confirm file params still non-automatable (sanity check — unrelated to this task).
    const fileM = bootModel(MOCK_SYNTHS.file_param);
    const fileInfo = fileM.getKnobParamInfo(0);
    eq('file param stays non-automatable', fileInfo?.automatable, false);
}
```

- [ ] **Step 2: Build and run — verify it fails**

```bash
cd movy && npm run build:browser && node browser-test/logic.mjs 2>&1 | grep -A2 "enum params are automatable"
```

Expected: `✗ 4-option enum param is automatable: expected true, got false`

- [ ] **Step 3: Enable enum in the config-path automatable flag**

In `src/model/hierarchy.ts`, find the line (around line 130) inside the `if (s.moduleConfig)` block:

```typescript
                        automatable: (type === 'float' || type === 'int') && max > min && !bank.global,
```

Change to:

```typescript
                        automatable: (type === 'float' || type === 'int' || type === 'enum') && max > min && !bank.global,
```

- [ ] **Step 4: Enable enum in the generic no-config path**

In `src/model/hierarchy.ts`, find the second occurrence (around line 332) inside the `for (const entry of bankEntries)` loop:

```typescript
                automatable: (type === 'float' || type === 'int') && max > min && !key.startsWith('g_'),
```

Change to:

```typescript
                automatable: (type === 'float' || type === 'int' || type === 'enum') && max > min && !key.startsWith('g_'),
```

- [ ] **Step 5: Build and run — verify it passes**

```bash
cd movy && npm run build:browser && node browser-test/logic.mjs 2>&1 | grep -A6 "enum params are automatable"
```

Expected: three `✓` lines, 0 failures in this section.

- [ ] **Step 6: Commit**

```bash
cd movy && git add src/model/hierarchy.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat: mark enum params as automatable

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Scale enum delta in handleAutomationKnob

Without scaling, a 4-option enum (max=3) on the 0-127 accumulator needs ~42 raw turns per option. ENUM_DELTA_DIV = 4 means 4 physical turns per step in normal editing; we match that here.

**Files:**
- Modify: `src/seq/automation.ts` (one insertion before `accumLive` call)
- Modify: `browser-test/logic.mjs` (add test section)

- [ ] **Step 1: Write the failing test**

Add this block after Task 1's test block in `browser-test/logic.mjs`:

```javascript
/* ── automation: enum delta scaling matches ENUM_DELTA_DIV feel ──────────── */
_log('\nautomation: enum delta scaling:');
{
    const { resetAutomation, handleAutomationKnob } = await import('../dist/esm/seq/automation.js');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');

    // 4-option enum: options=[LP,BP,HP,Notch], max=3, base at option 0.
    const info = {
        gi: 0, key: 'mode', ioKey: 'mode', target: 'synth',
        value: 0, min: 0, max: 3, type: 'enum', automatable: true,
    };

    resetAutomation(); resetSeqEngine(); resetSeqState();
    seqState.stepAutoMode = true; seqState.holdStep = 0;

    // 4 turns of delta=+1 should advance the 0-127 accumulator by ~1 enum step.
    // effDelta per turn = max(1, round(1 * 127/3/4)) = max(1, 11) = 11.
    // After 4 turns: accumulator = 44, which denorms to ~1.04 → option 1 (BP).
    for (let i = 0; i < 4; i++) handleAutomationKnob(0, 0, info, +1, () => true);
    const q = peekSeqCmdQueue();
    const lastAset = q.filter((o) => o.startsWith('aset 0 0 0 ')).at(-1);
    const v = parseInt(lastAset?.split(' ').at(-1) ?? '0');
    // With scaling: 4 * 11 = 44 in the accumulator.
    // Without scaling (old): 4 * 1 = 4 (would fail the > 10 check).
    eq('4 enum turns produce a value > 10 (scaling applied)', v > 10, true);
    eq('4 enum turns land near one enum-step on 0-127 scale (40-48)', v >= 40 && v <= 48, true);
}
```

- [ ] **Step 2: Build and run — verify it fails**

```bash
cd movy && npm run build:browser && node browser-test/logic.mjs 2>&1 | grep -A6 "enum delta scaling"
```

Expected: `✗ 4 enum turns produce a value > 10 (scaling applied): expected true, got false`

- [ ] **Step 3: Add ENUM_DELTA_DIV import to automation.ts**

In `src/seq/automation.ts`, find the existing import from `../model/constants.js` (if present) or add one. The current imports at the top of the file are:

```typescript
import type { KnobParamInfo } from '../model/store.js';
import { seqCmd, requestLabelSync } from './engine.js';
import { seqState } from './state.js';
import { seqToast } from './render.js';
import { beginStepAutomation, heldRange } from './step-edit.js';
import { aliasFromConcrete, type PadScoping } from '../model/pad-scope.js';
```

Add the constants import after the first line:

```typescript
import type { KnobParamInfo } from '../model/store.js';
import { ENUM_DELTA_DIV } from '../model/constants.js';
import { seqCmd, requestLabelSync } from './engine.js';
import { seqState } from './state.js';
import { seqToast } from './render.js';
import { beginStepAutomation, heldRange } from './step-edit.js';
import { aliasFromConcrete, type PadScoping } from '../model/pad-scope.js';
```

- [ ] **Step 4: Insert enum delta scaling before accumLive**

In `src/seq/automation.ts`, find this line (around line 207) inside `handleAutomationKnob`:

```typescript
    const next = accumLive(track, lane, ctx, seed, delta);
```

Replace with:

```typescript
    // Enum params work on a 0-127 accumulator but need ENUM_DELTA_DIV physical
    // turns per option step, matching applyKnobDelta's feel. Scale the raw delta
    // to the 0-127 range proportionally; Math.sign guard ensures a non-zero
    // delta always produces at least ±1 movement (for large-option enums).
    const effDelta = (info.type === 'enum' && info.max > info.min)
        ? Math.max(Math.sign(delta), Math.round(delta * 127 / info.max / ENUM_DELTA_DIV))
        : delta;
    const next = accumLive(track, lane, ctx, seed, effDelta);
```

- [ ] **Step 5: Build and run — verify it passes**

```bash
cd movy && npm run build:browser && node browser-test/logic.mjs 2>&1 | grep -A6 "enum delta scaling"
```

Expected: two `✓` lines, 0 new failures.

Also run the full logic suite to confirm no regressions:

```bash
node browser-test/logic.mjs 2>&1 | tail -5
```

Expected: `0 failures`

- [ ] **Step 6: Commit**

```bash
cd movy && git add src/seq/automation.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat: scale enum delta in automation to match ENUM_DELTA_DIV feel

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Fix enumIndex in viewmodel for held/live automation

`enumIndex` is used by the enum square renderer to display the option name in the knob cell. Currently it always reflects the base value; under held-step or live-record automation it should show the locked option.

**Files:**
- Modify: `src/model/viewmodel.ts` (change `const enumIdx` to `let` + two additions)
- Modify: `browser-test/logic.mjs` (add test section)

- [ ] **Step 1: Write the failing test**

Add this block after Task 2's test block in `browser-test/logic.mjs`:

```javascript
/* ── automation: enum enumIndex follows held/live lock in viewmodel ──────── */
_log('\nautomation: enum enumIndex in viewmodel:');
{
    const m = bootModel(MOCK_SYNTHS.test_enum);
    // knob 0 = mode (enum, options: ["LP","BP","HP","Notch"]), base = 0 (LP)
    const modeKey = m.getKnobParamInfo(0)?.key;  // 'mode'

    // Held-step lock at option 2 (HP). heldValues carries the DENORMALIZED
    // value (as built by buildAutomationView in app/tick.ts).
    const heldAuto = {
        assignedLanes: 0b1, activeLanes: 0b1, held: true, poolFull: false,
        heldValues: new Map([[0, 2]]),   // lane 0 locked to value=2 (HP)
        liveValues: new Map(),
        laneForKey: (key) => (key === modeKey ? 0 : -1),
    };
    const heldPv = m.getViewModel(heldAuto).rows[0][0];
    eq('held enum: enumIndex = 2 (HP)', heldPv?.enumIndex, 2);
    eq('held enum: displayValue = "HP"', heldPv?.displayValue, 'HP');

    // Live-record lock at option 3 (Notch).
    const liveAuto = {
        assignedLanes: 0b1, activeLanes: 0b1, held: false, poolFull: false,
        heldValues: new Map(), liveValues: new Map([[0, 3]]),
        laneForKey: (key) => (key === modeKey ? 0 : -1),
    };
    const livePv = m.getViewModel(liveAuto).rows[0][0];
    eq('live enum: enumIndex = 3 (Notch)', livePv?.enumIndex, 3);
    eq('live enum: displayValue = "Notch"', livePv?.displayValue, 'Notch');

    // Base (no automation) still shows the base value (0 = LP).
    const basePv = m.getViewModel().rows[0][0];
    eq('base enum: enumIndex = 0 (LP)', basePv?.enumIndex, 0);
}
```

- [ ] **Step 2: Build and run — verify it fails**

```bash
cd movy && npm run build:browser && node browser-test/logic.mjs 2>&1 | grep -A8 "enum enumIndex in viewmodel"
```

Expected: `✗ held enum: enumIndex = 2 (HP): expected 2, got 0`

- [ ] **Step 3: Change `const enumIdx` to `let` in viewmodel.ts**

In `src/model/viewmodel.ts`, find (around line 45):

```typescript
            const enumIdx = (p.type === 'enum' && typeof v === 'number') ? Math.round(v) : 0;
```

Change `const` to `let`:

```typescript
            let enumIdx = (p.type === 'enum' && typeof v === 'number') ? Math.round(v) : 0;
```

- [ ] **Step 4: Override enumIdx in the held-step branch**

In `src/model/viewmodel.ts`, find the held-step block (around lines 62-66):

```typescript
            if (auto.held && lane >= 0 && auto.heldValues.has(lane)) {
                const hv = auto.heldValues.get(lane) as number;
                touched = true;
                displayValue = formatValue(p, hv);
                arcValue = renorm(hv);
            } else if (!auto.held && lane >= 0 && auto.liveValues.has(lane)) {
```

Change to:

```typescript
            if (auto.held && lane >= 0 && auto.heldValues.has(lane)) {
                const hv = auto.heldValues.get(lane) as number;
                touched = true;
                displayValue = formatValue(p, hv);
                arcValue = renorm(hv);
                if (p.type === 'enum') enumIdx = Math.round(hv);
            } else if (!auto.held && lane >= 0 && auto.liveValues.has(lane)) {
```

- [ ] **Step 5: Override enumIdx in the live-record branch**

In `src/model/viewmodel.ts`, find the live branch (around lines 67-72):

```typescript
            } else if (!auto.held && lane >= 0 && auto.liveValues.has(lane)) {
                const lv = auto.liveValues.get(lane) as number;
                touched = true;
                displayValue = formatValue(p, lv);
                arcValue = renorm(lv);
            }
```

Change to:

```typescript
            } else if (!auto.held && lane >= 0 && auto.liveValues.has(lane)) {
                const lv = auto.liveValues.get(lane) as number;
                touched = true;
                displayValue = formatValue(p, lv);
                arcValue = renorm(lv);
                if (p.type === 'enum') enumIdx = Math.round(lv);
            }
```

- [ ] **Step 6: Build and run — verify it passes**

```bash
cd movy && npm run build:browser && node browser-test/logic.mjs 2>&1 | grep -A8 "enum enumIndex in viewmodel"
```

Expected: five `✓` lines.

Run the full suite:

```bash
node browser-test/logic.mjs 2>&1 | tail -5
```

Expected: `0 failures`

- [ ] **Step 7: Commit**

```bash
cd movy && git add src/model/viewmodel.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat: update enumIndex in viewmodel for held/live automation

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Full test run and push

- [ ] **Step 1: Run the full local test suite**

```bash
cd movy && npm test 2>&1 | tail -20
```

Expected: all four suites pass (logic, app-loop, screenshot, perf), `0 failures`.

- [ ] **Step 2: Check device reachability and run device tests**

```bash
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && (cd movy && ./scripts/test.sh) \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```

- [ ] **Step 3: Push**

```bash
cd movy && git push
```
