# Staggered Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace bulk `refreshKnobValues()` (blocks ~186 ms per cycle) with `refreshOneParam()` — one `shadow_get_param` call per tick — so no tick ever blocks more than ~3 ms and knob turns feel immediate.

**Architecture:** A cursor field in `ModelState` advances one position per tick, reading a single param from the shim. An active-knob suppression window (100 ticks) prevents read-back races during fast knob use. Perf logging is moved to a per-window max (once per second) to avoid log spam.

**Tech Stack:** TypeScript (movy `src/model/`), Node.js (browser tests), Bash (device tests)

---

## File map

| File | Change |
|---|---|
| `src/model/constants.ts` | Add `REFRESH_SUPPRESS_TICKS = 100`; remove `KNOB_REFRESH_TICKS` |
| `src/model/state.ts` | Replace `refreshCountdown` with `refreshParamCursor` + `lastDeltaTick` |
| `src/model/store.ts` | Add `refreshOneParam(s, tickCount)`; remove `refreshKnobValues` |
| `src/model/tick.ts` | Call `refreshOneParam` every tick; track `lastDeltaTick`; remove old refresh block |
| `browser-test/perf.mjs` | Update test 2: 1-tick window, threshold → 2 |
| `scripts/test.sh` | Tighten `REFRESH_MS_MAX` from 500 → 10 |

---

## Task 1: Write the failing perf test

**Files:**
- Modify: `browser-test/perf.mjs:98-117`

- [ ] **Step 1.1: Update the GET count threshold and test window in perf.mjs**

Change the constant at the top and rewrite Test 2 to count GETs over a single
tick (not a 69-tick window). The threshold drops from 40 to 2 because staggered
refresh sends exactly one GET per tick.

In `browser-test/perf.mjs`, make these two changes:

Change line 27:
```javascript
const GET_PARAM_PER_REFRESH_MAX = 40;
```
to:
```javascript
const GET_PARAM_PER_REFRESH_MAX = 2;
```

Replace the entire Test 2 block (lines 98–117):

```javascript
/* ── Test 2: shadow_get_param calls per tick (staggered refresh) ─────────── */

_origLog('\nTest 2: shadow_get_param calls per tick — staggered refresh (test16)');

{
    mockState = { ...MOCK_SYNTHS.test16 };
    const model = createModel(0, 'synth');

    /* Tick 1 loads hierarchy (3 GETs) then calls refreshOneParam once (1 GET). */
    model.tick();

    /* Tick 2: only one refreshOneParam call expected.
     * pollModuleName fires at tick 344 — won't appear here. */
    getParamCount = 0;
    model.tick();

    check('shadow_get_param calls per tick', getParamCount, GET_PARAM_PER_REFRESH_MAX);
    _origLog(`    (baseline: ${getParamCount} calls per tick)`);
}
```

- [ ] **Step 1.2: Build browser bundle**

```bash
cd /Users/dake/git/cld/movy
npm run build:browser 2>&1 | tail -5
```

Expected: exits 0, produces `dist/esm/`.

- [ ] **Step 1.3: Run perf.mjs — expect FAIL**

```bash
cd /Users/dake/git/cld/movy
node browser-test/perf.mjs
```

Expected output (Test 2 fails, others pass):
```
Test 2: shadow_get_param calls per tick — staggered refresh (test16)
  ✗ shadow_get_param calls per tick  (16 exceeds 2)
  (baseline: 16 calls per tick)
```
Exit code 1. This confirms the test correctly catches the current behaviour before
the fix.

---

## Task 2: Update constants.ts

**Files:**
- Modify: `src/model/constants.ts`

- [ ] **Step 2.1: Add REFRESH_SUPPRESS_TICKS, keep KNOB_REFRESH_TICKS for now**

`KNOB_REFRESH_TICKS` is still imported by `tick.ts` — removing it before tick.ts
is updated would break typecheck. Keep it temporarily.

Replace the entire file:

```typescript
export const NAME_POLL_TICKS       = 344;  /* ~1 s at device tick rate */
export const KNOB_REFRESH_TICKS    = 69;   /* kept until tick.ts is updated — remove in Task 5 */
export const LONG_PRESS_TICKS      = 172;  /* ~0.5 s */
export const REFRESH_SUPPRESS_TICKS = 100; /* ticks of knob-idle before refresh resumes (~200 ms) */
export const KNOBS_PER_PAGE        = 8;
export const KNOBS_PER_ROW         = 4;
export const ENUM_DELTA_DIV        = 4;   /* physical turns needed per 1 enum step */
```

---

## Task 3: Update state.ts

**Files:**
- Modify: `src/model/state.ts`

- [ ] **Step 3.1: Replace refreshCountdown with refreshParamCursor and lastDeltaTick**

`refreshParamCursor` is the index of the next param to read. `lastDeltaTick` is
the tick counter value when the last knob delta was applied; initialised to
`-(REFRESH_SUPPRESS_TICKS + 1)` so refresh is never suppressed at startup.

Replace the entire file:

```typescript
import type { KnobParam, ModuleConfig } from '../types/param.js';
import { KNOBS_PER_PAGE, NAME_POLL_TICKS, REFRESH_SUPPRESS_TICKS } from './constants.js';

export interface EnumOverlay {
    slot:     number;
    gi:       number;
    options:  string[];
    selected: number;
}

export interface ModelState {
    activeSlot:          number;
    componentKey:        string;
    knobParams:          (KnobParam | null)[];
    knobValues:          (number | null)[];
    pendingDeltas:       number[];
    enumAccums:          number[];
    knobPage:            number;
    touchedSlots:        number[];
    longPressCountdown:  number;
    enumOverlay:         EnumOverlay | null;
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
        pendingDeltas:       new Array(KNOBS_PER_PAGE).fill(0) as number[],
        enumAccums:          new Array(KNOBS_PER_PAGE).fill(0) as number[],
        knobPage:            0,
        touchedSlots:        [],
        longPressCountdown:  -1,
        enumOverlay:         null,
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

---

## Task 4: Update store.ts

**Files:**
- Modify: `src/model/store.ts`

- [ ] **Step 4.1: Add refreshOneParam, keep refreshKnobValues until tick.ts is updated**

`refreshOneParam` reads a single param at cursor position `i`, advances the
cursor, and sets `s.dirty` if the value changed. Suppression is checked here so
tick.ts does not need to know the threshold.

Replace the entire file:

```typescript
import type { KnobParam } from '../types/param.js';
import type { ModelState } from './state.js';
import { KNOBS_PER_PAGE, ENUM_DELTA_DIV, REFRESH_SUPPRESS_TICKS } from './constants.js';
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

    if (s.knobValues[gi] === null || s.knobValues[gi] === undefined) {
        const raw = shadow_get_param(s.activeSlot, s.componentKey + ':' + p.key);
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
    mlog('set slot=' + s.activeSlot + ' gi=' + gi + ' key=' + s.componentKey + ':' + p.key + ' val=' + valStr);
    const ok = p.key.startsWith('test_') ? true : shadow_set_param(s.activeSlot, s.componentKey + ':' + p.key, valStr);
    mlog('set_param returned ' + ok);
    s.dirty = true;
}

export function refreshOneParam(s: ModelState, tickCount: number): void {
    if (s.knobParams.length === 0) return;
    if (tickCount - s.lastDeltaTick < REFRESH_SUPPRESS_TICKS) return;

    const i = s.refreshParamCursor % s.knobParams.length;
    s.refreshParamCursor = (i + 1) % s.knobParams.length;

    const p = s.knobParams[i];
    if (!p) return;

    const raw = shadow_get_param(s.activeSlot, s.componentKey + ':' + p.key);
    if (raw === null) return;
    const newVal = parseFloat(raw);
    if (!isNaN(newVal) && newVal !== s.knobValues[i]) {
        s.knobValues[i] = newVal;
        s.dirty = true;
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

---

## Task 5: Update tick.ts

**Files:**
- Modify: `src/model/tick.ts`

- [ ] **Step 5.1: Replace old refresh block with refreshOneParam; track lastDeltaTick**

Key changes:
- Import `refreshOneParam` instead of `refreshKnobValues`; remove `KNOB_REFRESH_TICKS` import
- After the pendingDeltas flush, if any delta was applied, set `s.lastDeltaTick = _perfTickCount`
- Reset `s.refreshParamCursor = 0` on hierarchy reload
- Remove the `if (--s.refreshCountdown <= 0)` block; call `refreshOneParam` unconditionally
- Perf log: track per-window max refresh time (logs once per second alongside tick rate)

Replace the entire file:

```typescript
import type { ModelState } from './state.js';
import { loadHierarchy } from './hierarchy.js';
import { applyKnobDelta, refreshOneParam, pollModuleName } from './store.js';
import { KNOBS_PER_PAGE, NAME_POLL_TICKS } from './constants.js';
import { mlog } from '../log.js';

/* Module-level perf counters — not in ModelState to avoid interface churn. */
let _perfTickCount    = 0;
let _perfSampleMs     = 0;
let _perfRefreshMaxMs = 0;

export function processTick(s: ModelState): boolean {
    if (s.hierarchyKey !== s.activeModuleName) {
        s.knobPage = 0;
        loadHierarchy(s);
        s.refreshParamCursor = 0;
    }

    let hadDelta = false;
    for (let k = 0; k < KNOBS_PER_PAGE; k++) {
        if (s.pendingDeltas[k] !== 0) {
            applyKnobDelta(s, k, s.pendingDeltas[k]);
            s.pendingDeltas[k] = 0;
            hadDelta = true;
        }
    }
    if (hadDelta) s.lastDeltaTick = _perfTickCount;

    if (s.longPressCountdown > 0) {
        s.longPressCountdown--;
        if (s.longPressCountdown === 0) {
            const k = s.touchedSlots.length > 0 ? s.touchedSlots[s.touchedSlots.length - 1] : -1;
            if (k >= 0) {
                const gi = s.knobPage * KNOBS_PER_PAGE + k;
                const p  = s.knobParams[gi];
                if (p && p.type === 'enum' && p.options) {
                    s.enumOverlay = {
                        slot:     k,
                        gi,
                        options:  p.options,
                        selected: Math.round((s.knobValues[gi] ?? 0) as number),
                    };
                    s.dirty = true;
                }
            }
            s.longPressCountdown = -1;
        }
    }

    if (--s.pollCountdown <= 0) {
        s.pollCountdown = NAME_POLL_TICKS;
        pollModuleName(s);
    }

    if (s.knobParams.length > 0) {
        const t0 = Date.now();
        refreshOneParam(s, _perfTickCount);
        const ms = Date.now() - t0;
        if (ms > _perfRefreshMaxMs) _perfRefreshMaxMs = ms;
    }

    _perfTickCount++;
    if (_perfTickCount % NAME_POLL_TICKS === 0) {
        const now = Date.now();
        if (_perfSampleMs > 0) {
            const rate = Math.round(NAME_POLL_TICKS * 1000 / (now - _perfSampleMs));
            mlog('perf_tick_rate=' + rate);
            mlog('perf_refresh_ms=' + _perfRefreshMaxMs + ' params=' + s.knobParams.filter(Boolean).length);
            _perfRefreshMaxMs = 0;
        }
        _perfSampleMs = now;
    }

    const wasDirty = s.dirty;
    s.dirty = false;
    return wasDirty;
}
```

---

## Task 6: Remove dead code

**Files:**
- Modify: `src/model/store.ts` (remove `refreshKnobValues`)
- Modify: `src/model/constants.ts` (remove `KNOB_REFRESH_TICKS`)

- [ ] **Step 6.1: Remove refreshKnobValues from store.ts**

The function is no longer imported anywhere. Delete it. The final `store.ts`
is exactly the file written in Task 4, Step 4.1 (which does not include
`refreshKnobValues`). No further change needed — Task 4 already wrote the
clean version.

Verify it is absent:
```bash
grep -n "refreshKnobValues" /Users/dake/git/cld/movy/src/model/store.ts
```
Expected: no output.

- [ ] **Step 6.2: Remove KNOB_REFRESH_TICKS from constants.ts**

Replace the entire file:

```typescript
export const NAME_POLL_TICKS        = 344;  /* ~1 s at device tick rate */
export const LONG_PRESS_TICKS       = 172;  /* ~0.5 s */
export const REFRESH_SUPPRESS_TICKS = 100;  /* ticks of knob-idle before refresh resumes (~200 ms) */
export const KNOBS_PER_PAGE         = 8;
export const KNOBS_PER_ROW          = 4;
export const ENUM_DELTA_DIV         = 4;    /* physical turns needed per 1 enum step */
```

- [ ] **Step 6.3: Verify KNOB_REFRESH_TICKS is gone**

```bash
grep -rn "KNOB_REFRESH_TICKS" /Users/dake/git/cld/movy/src/
```
Expected: no output.

---

## Task 7: Build, typecheck, run tests

**Files:** none changed

- [ ] **Step 7.1: Build browser bundle**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser 2>&1 | tail -5
```
Expected: exits 0.

- [ ] **Step 7.2: Typecheck**

```bash
cd /Users/dake/git/cld/movy && npm run typecheck 2>&1
```
Expected: exits 0, zero errors.

If typecheck fails, the most likely cause is a stale import:
- `tick.ts` importing `KNOB_REFRESH_TICKS` → check Task 5 was applied correctly
- `tick.ts` importing `refreshKnobValues` → check Task 5 was applied correctly
- `state.ts` using `refreshCountdown` → check Task 3 was applied correctly

- [ ] **Step 7.3: Run perf tests — expect PASS**

```bash
cd /Users/dake/git/cld/movy && node browser-test/perf.mjs
```

Expected output:
```
Test 1: fill_rect calls per renderKnobsView (test16, 8 arc knobs)
  ✓ fill_rect calls  (520 <= 1500)
  (baseline: 520 calls)

Test 2: shadow_get_param calls per tick — staggered refresh (test16)
  ✓ shadow_get_param calls per tick  (1 <= 2)
  (baseline: 1 calls per tick)

Test 3: renderKnobsView median time — Node.js V8 (no-op fill_rect)
  ✓ median renderKnobsView time  (0.003ms <= 2ms)
  (baseline: 0.003ms median, ...)

Test 4: fill_rect calls per renderKnobsView (test_enum)
  ✓ fill_rect calls (enum view)  (512 <= 1500)
  (baseline: 512 calls)

ALL PERF CHECKS PASSED
```

- [ ] **Step 7.4: Run screenshot tests**

```bash
cd /Users/dake/git/cld/movy && node browser-test/screenshot.mjs
```

Expected: same pass/fail count as before this change (the staggered refresh
does not affect rendering). If new failures appear, the change accidentally
affected rendering — investigate before committing.

- [ ] **Step 7.5: Commit the implementation**

```bash
cd /Users/dake/git/cld/movy
git add src/model/constants.ts src/model/state.ts src/model/store.ts src/model/tick.ts browser-test/perf.mjs
git commit -m "$(cat <<'EOF'
perf: staggered refresh — one shadow_get_param per tick

Replaces bulk refreshKnobValues() (blocks ~186 ms per cycle for 62-param
synths) with refreshOneParam() — one blocking GET per tick. No single tick
blocks more than ~3 ms; MIDI, LEDs, and display run between every GET.

Active-knob suppression (REFRESH_SUPPRESS_TICKS=100) avoids read-back races
during fast knob use.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Tighten device test threshold

**Files:**
- Modify: `scripts/test.sh:195`

- [ ] **Step 8.1: Lower REFRESH_MS_MAX from 500 to 10**

In `scripts/test.sh`, find the line:
```bash
REFRESH_MS_MAX=500
```
and replace it with:
```bash
REFRESH_MS_MAX=10
```

Also update the comment block just above it:
```bash
# Refresh blocking: each tick now calls refreshOneParam() — one shadow_get_param.
# Baseline: ~3 ms per GET. Threshold 10 ms allows for shim jitter.
REFRESH_MS_MAX=10
```

- [ ] **Step 8.2: Run device tests (if reachable)**

```bash
cd /Users/dake/git/cld/movy
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && ./scripts/test.sh \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```

Expected: all checks pass, including:
```
✓ Tick rate N ticks/sec >= 100 (threshold)
✓ Refresh blocking N ms max <= 10 ms (threshold)
```

The `perf_refresh_ms=` value should now be 0–5 ms (one GET) instead of 178–316 ms
(62 GETs). The tick rate may drop slightly from ~270 to ~180–200 Hz due to the
per-tick GET overhead — still well above the 100 ticks/sec threshold.

- [ ] **Step 8.3: Commit device threshold change**

```bash
cd /Users/dake/git/cld/movy
git add scripts/test.sh
git commit -m "$(cat <<'EOF'
test: tighten REFRESH_MS_MAX 500→10 ms after staggered refresh

Each tick now does one shadow_get_param (~3 ms) instead of N sequential
calls. The 10 ms threshold catches any regression back to bulk polling.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push
```
