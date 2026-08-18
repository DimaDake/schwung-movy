# Set Lifecycle Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "which Set am I in, and am I live?" one owned fact instead of four scattered variables, so a Set resolving late can never load over work already in hand.

**Architecture:** One module (`set-session.ts`) owns a phase (`booting → loading → ready`, plus `switching`) and the Set identity. Loading and saving move into `set-load.ts` and `set-save.ts`. Input is refused until the engine is up and state is in it. Identity changes are decided by one question: does the incoming Set already have state? No → rename (carry the work), yes → switch (flush, load).

**Tech Stack:** TypeScript → esbuild bundle (`ui.js`), QuickJS on device, Rust engine over a param IPC. Tests are plain node scripts in `browser-test/`.

**Spec:** `docs/superpowers/specs/2026-08-18-set-lifecycle-design.md`

## Global Constraints

- **File size: hard limit 200 lines, target 50-100.** `persist.ts` is 227 today; every file this plan creates must land under the limit.
- **Comments explain WHY** (constraints, invariants, workarounds), never WHAT the code literally does.
- **No code duplication** — refactor into a shared location before proceeding.
- **On-disk format must not change.** `persist-store.ts`, `persist-blob.ts`, `set-context.ts`, `set-inherit.ts`, `ui-state.ts`, `chain-persist.ts` are not modified by this plan. Existing Sets on device must load exactly as they do now.
- **Every new test must be proven to fail with the fix removed.** A test that passes before the change is not a test.
- **Run `npm run build:browser` before any `.mjs` suite** — they run against `dist/esm`.
- **Full local gate before each commit:** `npm test` (six suites) + `npm run typecheck`, zero failures.
- Engine behaviour is untouched, so **`ENGINE_VERSION` does not change** in this plan.

---

## File Structure

| File | Responsibility | Fate |
|---|---|---|
| `src/seq/set-session.ts` | Phase, identity, transition rule. The only lifecycle owner. | **create** (~140) |
| `src/seq/set-load.ts` | One loading pass: read → push engine → apply UI → chains. | **create** (~70) |
| `src/seq/set-save.ts` | Autosave cadence, flush, save-retry. | **create** (~80) |
| `src/seq/persist.ts` | — | **delete** (227) |
| `src/app/tick.ts:244,313` | Calls `seqPersistTick()` | modify → `sessionTick()` |
| `src/app/unload.ts:48` | Calls `seqPersistFlush(true)` | modify → `sessionFlush(true)` |
| `src/midi/router.ts` | Input entry | modify — add the gate |
| `src/renderer/loading-view.ts` | The loading screen | **create** (~40) |
| `src/app/tick.ts` render dispatch | — | modify — draw loading when not ready |

Untouched: `set-context.ts`, `set-inherit.ts`, `persist-store.ts`, `persist-blob.ts`, `ui-state.ts`, `ui-dirty.ts`, `chain-persist.ts`.

---

### Task 0: Pin the pending window as repeatable evidence

The spec's step 0. The measurement has already been taken by hand from
`debug.log` (12 s simple, 59 s while browsing); this makes it repeatable so a
future firmware change that shortens or lengthens it is visible rather than
assumed.

**Files:**
- Create: `scripts/measure-pending-window.sh`

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
# measure-pending-window.sh — how long schwung runs on a synthetic
# `__pending-*` Set identity before Move materialises the real one.
#
# Movy's whole set lifecycle is built to need no answer to this (identity is
# never waited on), so this is evidence, not a dependency: if a firmware update
# makes the window minutes long, nothing breaks, and this shows it.
set -euo pipefail
HOST="${1:-move.local}"
ssh "ableton@$HOST" 'grep -E "SET_CHANGED: /data" /data/UserData/schwung/debug.log' \
  | sed -E 's/.*([0-9]{2}:[0-9]{2}:[0-9]{2})\.[0-9]+.*set_state\/([^ ]+) -> .*set_state\/(.*)$/\1 \2 -> \3/' \
  | awk '
      /__pending/ && $2 !~ /__pending/ { start=$1; sub(/:/," ",start); t0=$1; next }
      $4 !~ /__pending/ && t0 != "" {
          split(t0,a,":"); split($1,b,":");
          secs=(b[1]*3600+b[2]*60+b[3])-(a[1]*3600+a[2]*60+a[3]);
          printf "pending window: %s -> %s = %d s\n", t0, $1, secs; t0=""
      }'
```

- [ ] **Step 2: Run it against the device**

Run: `chmod +x scripts/measure-pending-window.sh && ./scripts/measure-pending-window.sh`
Expected: one or more `pending window: … = N s` lines. If the device log has been
cleared there will be no output — that is not a failure, just no evidence yet.

- [ ] **Step 3: Commit**

```bash
git add scripts/measure-pending-window.sh
git commit -m "tools: measure how long schwung runs on a pending Set identity"
```

---

### Task 1: `set-load.ts` — the loading pass, extracted

**Files:**
- Create: `src/seq/set-load.ts`
- Test: `browser-test/logic.mjs` (new block, after the existing `seq persistence` block)

**Interfaces:**
- Consumes: `resolveState(uuid, name)` from `set-inherit.js`; `readUiBlob(uuid)` from `persist-store.js`; `applyUiState(blob)` from `ui-state.js`; `requestLabelSync()` from `engine.js`; `BLANK_STATE` from `set-context.js`.
- Produces:
  - `setHasState(id: string): boolean`
  - `loadSet(id: string, name: string): { payload: string; gen: number }`
  - `pushState(payload: string): void`

- [ ] **Step 1: Write the failing test**

Add to `browser-test/logic.mjs`, after the `seq persistence` block closes:

```javascript
/* ── set-load ────────────────────────────────────────────────────────────── */
{
    _log('\nset-load:');
    const { installMockEngine, uninstallMockEngine } = await import('./mock-engine.mjs');
    const { setHasState, loadSet, pushState } =
        await import('../dist/esm/seq/set-load.js');
    const { uuidToStatePath } = await import('../dist/esm/seq/set-context.js');

    const SAVED = 'movy1\nbpm 14000\ncl 0 0 16 0 0:24:60:100\n';

    // A Set movy has never seen has no state — this is the question the whole
    // rename-vs-switch rule turns on, so it gets its own assertion.
    {
        installMockFs({});
        installMockEngine();
        eq('an unknown set has no state', setHasState('NEW'), false);
        uninstallMockEngine(); uninstallMockFs();
    }
    {
        installMockFs({ [uuidToStatePath('S1')]: SAVED });
        const eng = installMockEngine();
        eq('a saved set has state', setHasState('S1'), true);
        const got = loadSet('S1', 'Song One');
        eq('loadSet returns the payload', got.payload, SAVED);
        eq('loadSet pushed it into the engine', eng.stateBlob, SAVED);
        uninstallMockEngine(); uninstallMockFs();
    }
    {
        installMockFs({});
        const eng = installMockEngine();
        pushState('movy1\nbpm 12000\n');
        eq('pushState reaches the engine', eng.stateBlob, 'movy1\nbpm 12000\n');
        uninstallMockEngine(); uninstallMockFs();
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | tail -20`
Expected: FAIL — `Cannot find module '../dist/esm/seq/set-load.js'`

- [ ] **Step 3: Write the implementation**

Create `src/seq/set-load.ts`:

```typescript
/* Loading a Set into the live engine: one pass, no decisions.
 *
 * Whether to load at all is set-session's call — this module only knows how.
 * Keeping the two apart is what stops "load" from quietly acquiring the policy
 * that used to let a blank Set land on top of a live pattern. */

import { requestLabelSync } from './engine.js';
import { BLANK_STATE } from './set-context.js';
import { readBestState, readUiBlob } from './persist-store.js';
import { resolveState } from './set-inherit.js';
import { applyUiState } from './ui-state.js';

/** Does this Set already own state? The rename-vs-switch question. */
export function setHasState(id: string): boolean {
    return readBestState(id) !== null;
}

/* Blocking on purpose: the engine must hold the Set before input is accepted,
 * and this runs once per Set, not per tick. */
export function pushState(payload: string): void {
    if (typeof host_module_set_param_blocking === 'function')
        host_module_set_param_blocking('state', payload, 200);
    // The restore carries lane labels and assignments; without a re-sync the
    // automation registry stays empty — no dot, no held value, no read-back
    // suppression.
    requestLabelSync();
}

/** Read a Set's state, push it into the engine, and apply its UI blob. */
export function loadSet(id: string, name: string): { payload: string; gen: number } {
    const st = resolveState(id, name);
    pushState(st.payload);
    const ui = readUiBlob(id);
    if (ui && ui.length > 0) applyUiState(ui);
    return st;
}

export { BLANK_STATE };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | grep -E "set-load|✗" | head`
Expected: the four `set-load` assertions pass, no `✗`.

- [ ] **Step 5: Full gate and commit**

```bash
npm run typecheck && npm test 2>&1 | grep -E "ALL |✗"
git add src/seq/set-load.ts browser-test/logic.mjs
git commit -m "refactor: extract the Set loading pass, with no policy in it"
```

---

### Task 2: `set-save.ts` — autosave and flush, extracted

**Files:**
- Create: `src/seq/set-save.ts`
- Test: `browser-test/logic.mjs` (extend the block from Task 1)

**Interfaces:**
- Consumes: `writeStateBlob`, `writeUiBlob` from `persist-store.js`; `takeUiDirty`, `markUiStateDirty` from `ui-dirty.js`; `serializeUiState` from `ui-state.js`; `seqState` from `state.js`.
- Produces:
  - `saveSet(id: string, gen: number, force: boolean): { ok: boolean; wrote: boolean; gen: number }`
  - `resetSetSave(): void`

- [ ] **Step 1: Write the failing test**

Append inside the `set-load` block in `browser-test/logic.mjs`:

```javascript
    /* set-save: the engine's payload reaches disk, and an unchanged payload
     * is not rewritten — flash on this device is not free. */
    {
        const fs = installMockFs({});
        const eng = installMockEngine();
        const { saveSet, resetSetSave } = await import('../dist/esm/seq/set-save.js');
        const { seqState } = await import('../dist/esm/seq/state.js');
        const { readBestState } = await import('../dist/esm/seq/persist-store.js');
        resetSetSave();

        eng.stateBlob = 'movy1\nbpm 13000\n';
        seqState.dirty = true;
        const first = saveSet('S9', 0, true);
        eq('saveSet wrote', first.wrote, true);
        eq('and it is readable back', readBestState('S9').payload, 'movy1\nbpm 13000\n');

        const second = saveSet('S9', first.gen, true);
        eq('an unchanged payload is not rewritten', second.wrote, false);
        uninstallMockEngine(); uninstallMockFs();
    }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | tail -10`
Expected: FAIL — `Cannot find module '../dist/esm/seq/set-save.js'`

- [ ] **Step 3: Write the implementation**

Create `src/seq/set-save.ts`:

```typescript
/* Writing a Set to disk.
 *
 * Two rules survive from the old persist.ts and both were written against real
 * data loss:
 *
 *  - `host_module_get_param('state')` CLEARS the engine's dirty flag as a side
 *    effect of the read, so a write we fail to complete is one nothing will ask
 *    us for again. `saveRetry` outlives the engine-sourced mirror for exactly
 *    that reason.
 *  - An unchanged payload is not rewritten. Flash is not free. */

import { mlog } from '../log.js';
import { seqState } from './state.js';
import { markUiStateDirty, takeUiDirty } from './ui-dirty.js';
import { serializeUiState } from './ui-state.js';
import { writeStateBlob, writeUiBlob } from './persist-store.js';

let lastGoodPayload = '';
let saveRetry = false;

export function resetSetSave(): void {
    lastGoodPayload = '';
    saveRetry = false;
}

/** Mark the bytes currently in the engine as already durable under this id —
 *  used after a rename, where they were written by the rename itself. */
export function adoptSaved(payload: string): void {
    lastGoodPayload = payload;
    saveRetry = false;
}

export function saveNeeded(): boolean {
    return seqState.dirty || saveRetry;
}

/** Persist the engine's state (and the UI blob when dirty) under `id`.
 *  `force` skips the dirty mirror and asks the engine directly: that mirror is
 *  refreshed by a 24 Hz poll, so on the last save a Set will ever get — a
 *  switch-out or a teardown — a stale read is a lost edit. */
export function saveSet(
    id: string, gen: number, force = false,
): { ok: boolean; wrote: boolean; gen: number } {
    if ((takeUiDirty() || force) && !writeUiBlob(id, serializeUiState())) markUiStateDirty();
    if (!saveNeeded() && !force) return { ok: true, wrote: false, gen };
    if (typeof host_module_get_param !== 'function') return { ok: false, wrote: false, gen };

    const payload = host_module_get_param('state');
    if (payload === null) { saveRetry = true; return { ok: false, wrote: false, gen }; }
    seqState.dirty = false;
    if (payload === lastGoodPayload) { saveRetry = false; return { ok: true, wrote: false, gen }; }
    if (!writeStateBlob(id, payload, gen + 1)) {
        saveRetry = true;
        mlog('seq: SAVE FAILED — retrying');
        return { ok: false, wrote: false, gen };
    }
    lastGoodPayload = payload;
    saveRetry = false;
    mlog('seq: saved ' + payload.length + ' bytes (gen ' + (gen + 1) + ')');
    return { ok: true, wrote: true, gen: gen + 1 };
}

/** The bytes last known durable — what a rename carries to the new id. */
export function savedPayload(): string { return lastGoodPayload; }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | grep -E "saveSet|unchanged|✗" | head`
Expected: three assertions pass, no `✗`.

- [ ] **Step 5: Full gate and commit**

```bash
npm run typecheck && npm test 2>&1 | grep -E "ALL |✗"
git add src/seq/set-save.ts browser-test/logic.mjs
git commit -m "refactor: extract Set saving, keeping the retry and the no-rewrite rule"
```

---

### Task 3: `set-session.ts` — the phase machine and the one rule

This is the task the whole plan exists for. It replaces `persist.ts`.

**Files:**
- Create: `src/seq/set-session.ts`
- Delete: `src/seq/persist.ts`
- Modify: `src/app/tick.ts` (two call sites: line ~244 parked path, line ~313)
- Modify: `src/app/unload.ts:48`
- Test: `browser-test/logic.mjs` — rewrite the `seq persistence` block's F6/F6a/F6b against the new API

**Interfaces:**
- Consumes: `setHasState`, `loadSet`, `pushState` (Task 1); `saveSet`, `saveNeeded`, `adoptSaved`, `savedPayload`, `resetSetSave` (Task 2); `engineReady()`, `engineGeneration()` from `engine.js`; `readActiveSet()`, `rememberSet()` from `set-context.js`; `writeStateBlob`, `writeUiBlob`, `readUiBlob`, `readBestState` from `persist-store.js`; `resetUiState()` from `ui-state.js`.
- Produces:
  - `sessionReady(): boolean`
  - `sessionPhase(): 'booting' | 'loading' | 'ready' | 'switching'`
  - `currentSetUuid(): string`
  - `sessionTick(): void`
  - `sessionFlush(force?: boolean): void`
  - `resetSetSession(): void`

- [ ] **Step 1: Write the failing tests**

In `browser-test/logic.mjs`, replace the F6, F6a and F6b blocks with:

```javascript
    /* R1 — a Set that names itself late must not load over work in hand.
     * schwung runs on a synthetic `__pending-*` identity for 12-60 s while Move
     * materialises the real Set (docs/superpowers/specs/2026-08-18-…), and the
     * pads, steps and transport all work throughout. */
    {
        const { fs, eng } = bootSession({ [ACTIVE]: '__pending-13-3\nNew Set\n' });
        eq('R1 provisional identity adopted', currentSetUuid(), '__pending-13-3');
        eng.stateBlob = EDITED;                    // the user enters a pattern
        seqState.dirty = true;

        fs.files[ACTIVE] = 'NEW1\nSet 26\n';       // Move materialises it
        for (let i = 0; i < 200; i++) { seqEngineTick(); sessionTick(); }

        eq('R1 renamed to the real id', currentSetUuid(), 'NEW1');
        eq('R1 the pattern survived', eng.stateBlob, EDITED);
        eq('R1 and is on disk under it', readBestState('NEW1').payload, EDITED);
        eq('R1 the provisional dir is gone', readBestState('__pending-13-3'), null);
        teardownSession();
    }

    /* R2 — the counterpart: an incoming Set that HAS state is a real switch. */
    {
        const { fs, eng } = bootSession({ [ACTIVE]: '__pending-13-3\nNew Set\n' });
        eng.stateBlob = EDITED;
        seqState.dirty = true;
        fs.files[uuidToStatePath('S1')] = SAVED;
        fs.files[ACTIVE] = 'S1\nSong One\n';
        for (let i = 0; i < 200; i++) { seqEngineTick(); sessionTick(); }
        eq('R2 the saved set was restored', eng.stateBlob, SAVED);
        teardownSession();
    }

    /* R3 — provisional to a DIFFERENT provisional, which the device log shows
     * happening while the user browses Sets. Still a rename: carrying the work
     * forward can be undone, orphaning it cannot. */
    {
        const { fs, eng } = bootSession({ [ACTIVE]: '__pending-11-3\nNew Set\n' });
        eng.stateBlob = EDITED;
        seqState.dirty = true;
        fs.files[ACTIVE] = '__pending-10-2\nNew Set\n';
        for (let i = 0; i < 200; i++) { seqEngineTick(); sessionTick(); }
        eq('R3 followed the browse', currentSetUuid(), '__pending-10-2');
        eq('R3 the work came along', eng.stateBlob, EDITED);
        teardownSession();
    }

    /* R4 — the keyboard follows the same rule and needs no notes to do it. */
    {
        const { fs } = bootSession({ [ACTIVE]: '__pending-13-3\nNew Set\n' });
        keyboardState.mode = 1; keyboardState.layout = 1; keyboardState.scale = 3;
        fs.files[ACTIVE] = 'NEW2\nSet 27\n';
        for (let i = 0; i < 200; i++) { seqEngineTick(); sessionTick(); }
        eq('R4 still In Key', keyboardState.mode, 1);
        eq('R4 still Inline', keyboardState.layout, 1);
        keyboardState.mode = 0; keyboardState.layout = 0; keyboardState.scale = 0;
        teardownSession();
    }

    /* R5 — the phase gate. Nothing is live until the engine holds the Set. */
    {
        const { fs } = bootSession({ [ACTIVE]: 'S1\nSong One\n' }, { skipBoot: true });
        eq('R5 booting before the engine answers', sessionPhase(), 'booting');
        eq('R5 and not ready', sessionReady(), false);
        for (let i = 0; i < 200; i++) { seqEngineTick(); sessionTick(); }
        eq('R5 ready once loaded', sessionPhase(), 'ready');
        teardownSession();
    }

    /* R6 — a re-dlopened engine comes up EMPTY, so we are no longer ready by
     * definition and the Set is pushed back into it. */
    {
        const { eng } = bootSession({ [ACTIVE]: 'S1\nSong One\n', [uuidToStatePath('S1')]: SAVED });
        eq('R6 loaded', eng.stateBlob, SAVED);
        eng.stateBlob = null;                     // the reload lost everything
        resetSeqEngine();                          // …and comes back a new generation
        for (let i = 0; i < 300; i++) { seqEngineTick(); sessionTick(); }
        eq('R6 the set was pushed back', eng.stateBlob, SAVED);
        teardownSession();
    }
```

Add these helpers just above, replacing `boot`/`teardown` in that block:

```javascript
    const { sessionTick, sessionFlush, sessionPhase, sessionReady, currentSetUuid,
            resetSetSession } = await import('../dist/esm/seq/set-session.js');
    const { resetSetSave } = await import('../dist/esm/seq/set-save.js');

    const bootSession = (files, opts = {}) => {
        const fs = installMockFs(files);
        const eng = installMockEngine();
        resetSeqEngine(); resetSeqState(); resetSetSession(); resetSetSave(); resetStoreRotation();
        if (!opts.skipBoot) {
            for (let i = 0; i < 200; i++) { seqEngineTick(); sessionTick(); }
        }
        return { fs, eng };
    };
    const teardownSession = () => {
        uninstallMockEngine(); uninstallMockFs();
        resetSeqEngine(); resetSeqState(); resetSetSession(); resetSetSave(); resetStoreRotation();
    };
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | tail -10`
Expected: FAIL — `Cannot find module '../dist/esm/seq/set-session.js'`

- [ ] **Step 3: Write the implementation**

Create `src/seq/set-session.ts`:

```typescript
/* Which Set movy is in, and whether movy is live. The only owner of both.
 *
 * These used to be four variables in three files — `curUuid === null`,
 * `engineReady()`, `engineGeneration() === restoredGen`, and implicitly whether
 * a status poll had landed — so every caller reassembled the answer and the
 * combinations nobody thought about were where the bugs lived. One of them shipped
 * as #4/#5/#6: a Set resolving after the user had played into the engine pushed
 * that Set's state, which for a new Set is nothing, over the live pattern.
 *
 * Identity is DISCOVERED, not known at open. schwung runs on a synthetic
 * `__pending-<index>-<seq>` namespace for a measured 12-60 s while Move
 * materialises the real Set, and it can change more than once in that time. So
 * every identity change asks one question — does the incoming Set already have
 * state? — and never waits for anything. */

import { mlog } from '../log.js';
import { engineGeneration, engineReady } from './engine.js';
import { readActiveSet, rememberSet } from './set-context.js';
import { readBestState, readUiBlob, writeStateBlob, writeUiBlob } from './persist-store.js';
import { clearUiDirty, markUiStateDirty } from './ui-dirty.js';
import { resetUiState } from './ui-state.js';
import { loadSet, setHasState } from './set-load.js';
import { adoptSaved, resetSetSave, saveNeeded, saveSet, savedPayload } from './set-save.js';

export type Phase = 'booting' | 'loading' | 'ready' | 'switching';

const SAVE_TICKS = 600;      // ~3-8 s depending on load; the device tick is 63-205 Hz
const SET_POLL_TICKS = 96;   // ~0.5 s: catch a set switch, including on resume

let phase: Phase = 'booting';
let setId = '';
let setName = '';
let gen = 0;
/* The engine generation whose contents we authored. A re-dlopened engine comes
 * up EMPTY, so a generation we did not load into is not one we may save from. */
let loadedGen = -1;
let saveCountdown = SAVE_TICKS;
let pollCountdown = 1;

export function sessionPhase(): Phase { return phase; }
export function sessionReady(): boolean { return phase === 'ready'; }
export function currentSetUuid(): string { return setId; }

export function resetSetSession(): void {
    phase = 'booting';
    setId = ''; setName = ''; gen = 0; loadedGen = -1;
    saveCountdown = SAVE_TICKS; pollCountdown = 1;
    resetSetSave();
    clearUiDirty();
}

function filesAvailable(): boolean {
    return typeof host_read_file === 'function' && typeof host_write_file === 'function';
}

/* Carry the work in hand to a Set that has none of its own. The bytes are
 * written under the new id BEFORE the old directory is dropped, so a failure
 * leaves a harmless duplicate rather than a hole — and dropping it on success is
 * what keeps movy from growing schwung's collection of orphaned `__pending-*`
 * directories. */
function rename(toId: string, toName: string): void {
    const from = setId;
    const payload = savedPayload() || (readBestState(from)?.payload ?? '');
    if (payload && writeStateBlob(toId, payload, gen + 1)) {
        gen++;
        adoptSaved(payload);
        const ui = readUiBlob(from);
        if (ui) writeUiBlob(toId, ui);
    } else {
        /* Nothing durable yet — the live UI state is still this Set's, so make
         * sure the next save writes it out rather than assuming it is on disk. */
        markUiStateDirty();
    }
    setId = toId; setName = toName;
    mlog('seq: set renamed ' + from + ' -> ' + toId);
}

function enterLoading(id: string, name: string): void {
    phase = 'loading';
    const st = loadSet(id, name);
    setId = id; setName = name; gen = st.gen;
    adoptSaved(st.payload);
    if (!readUiBlob(id)) resetUiState();
    rememberSet(name, id);
    clearUiDirty();
    loadedGen = engineGeneration();
    phase = 'ready';
    mlog('seq: loaded set ' + id);
}

/* The one rule. An incoming Set with state of its own is a switch; one without
 * is this Set, newly named, and the work already in hand belongs to it. */
function identityChanged(id: string, name: string): void {
    if (setHasState(id)) {
        phase = 'switching';
        sessionFlush(true);
        enterLoading(id, name);
        return;
    }
    rename(id, name);
    rememberSet(name, id);
}

export function sessionFlush(force = false): void {
    if (!setId || !filesAvailable()) return;
    if (engineGeneration() !== loadedGen) return;   // not our engine — see the tick
    if (!saveNeeded() && !force) return;
    const r = saveSet(setId, gen, force);
    if (r.ok) gen = r.gen;
}

export function sessionTick(): void {
    if (!engineReady() || !filesAvailable()) {
        if (phase === 'ready') phase = 'booting';   // the engine went away
        return;
    }
    /* A generation we did not load into is an EMPTY engine: push the Set back
     * before anything can save from it. */
    if (phase === 'ready' && engineGeneration() !== loadedGen) {
        phase = 'loading';
        enterLoading(setId, setName);
        return;
    }
    if (--pollCountdown <= 0) {
        pollCountdown = SET_POLL_TICKS;
        const id = readActiveSet();
        if (id) {
            if (phase !== 'ready') enterLoading(id.uuid, id.name);
            else if (id.uuid !== setId) identityChanged(id.uuid, id.name);
        } else if (phase !== 'ready') {
            /* No answer yet and none needed: work under a provisional id and let
             * the rename carry it when one arrives. Never wait on identity — the
             * measured window is 12-60 s and unbounded above. */
            enterLoading('_pending', 'New Set');
        }
        if (phase !== 'ready') return;
    }
    if (--saveCountdown > 0) return;
    saveCountdown = SAVE_TICKS;
    sessionFlush();
}
```

- [ ] **Step 4: Rewire the callers and delete `persist.ts`**

In `src/app/tick.ts`, replace the import and both call sites:

```typescript
import { sessionTick } from '../seq/set-session.js';
```

Line ~244 (the parked path) and line ~313: `seqPersistTick()` → `sessionTick()`.

In `src/app/unload.ts:48`: `seqPersistFlush(true)` → `sessionFlush(true)`, importing
`sessionFlush` from `../seq/set-session.js`.

Then: `git rm src/seq/persist.ts` and fix every remaining import of it
(`grep -rn "seq/persist.js" src/ browser-test/`) to point at `set-session.js`
(`currentSetUuid`, `markUiStateDirty`) — `markUiStateDirty` is re-exported from
`ui-dirty.js`, so import it from there instead.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | grep -E "R[1-6] |✗" | head -20`
Expected: all `R1`–`R6` assertions pass, no `✗`.

- [ ] **Step 6: Prove the tests have teeth**

Temporarily invert the rule in `identityChanged` — call `enterLoading(id, name)`
unconditionally instead of `rename(...)` — rebuild, and run the suite.
Expected: `R1 the pattern survived`, `R1 and is on disk under it`, `R3 the work
came along` and `R4 still In Key` FAIL. Restore the rule and confirm green.

- [ ] **Step 7: Full gate and commit**

```bash
npm run typecheck && npm test 2>&1 | grep -E "ALL |✗"
git add -A src/seq src/app browser-test/logic.mjs
git commit -m "refactor: one owner for the Set lifecycle, one rule for identity"
```

---

### Task 4: The input gate and the loading screen

**Files:**
- Create: `src/renderer/loading-view.ts`
- Modify: `src/midi/router.ts` (top of `onMidiMessageInternal`)
- Modify: `src/app/tick.ts` (render dispatch)
- Test: `browser-test/app-loop.mjs`, `browser-test/screenshot.mjs`

**Interfaces:**
- Consumes: `sessionReady()`, `sessionPhase()` from `set-session.js`.
- Produces: `renderLoadingView(phase: string): void`

- [ ] **Step 1: Write the failing test**

Add to `browser-test/app-loop.mjs`:

```javascript
_log('\napp-loop: nothing is live until the Set is loaded');
{
    resetApp();
    const { sessionReady } = await import('../dist/esm/seq/set-session.js');
    const { seqState } = await import('../dist/esm/seq/state.js');

    /* A press before the engine holds the Set used to queue into a
     * not-yet-existing engine and flush on the very tick a blank state landed
     * on top of it. Now it is simply refused. */
    eq('gate: not ready at open', sessionReady(), false);
    const lenBefore = seqState.lenSteps;
    sendMidi([0x90, STEP_NOTE_BASE, 127]);
    sendMidi([0x80, STEP_NOTE_BASE, 0]);
    advance(2);
    eq('gate: the press entered nothing', seqState.lenSteps, lenBefore);
    eq('gate: and nothing was queued', engine.ops.filter((o) => o.startsWith('tog')).length, 0);

    /* Back must always work, or an engine that never boots traps the user. */
    sendMidi([0xB0, globalThis.MoveBack, 127]);
    advance(1);
    eq('gate: Back is never swallowed', globalThis.__exited === true, true);
}
```

Note: `resetApp()` must not run the boot loop for this test — call
`resetSetSession()` after it so the phase is `booting`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/app-loop.mjs 2>&1 | grep -E "gate:|✗" | head`
Expected: `gate: the press entered nothing` FAILS — the press is accepted today.

- [ ] **Step 3: Add the gate**

In `src/midi/router.ts`, immediately after `trackButtonPress(data)` near the top
of `onMidiMessageInternal`:

```typescript
    /* Nothing is live until the engine holds this Set. A press accepted before
     * then used to queue into an engine that did not exist yet and flush on the
     * very tick a blank state landed on top of it — the whole point of the
     * lifecycle rewrite. Back is exempt: an engine that never boots must not
     * trap the user inside movy. */
    if (!sessionReady()) {
        const isBack = (data[0] & 0xF0) === 0xB0 && data[1] === MoveBack;
        if (!isBack) return;
    }
```

- [ ] **Step 4: Add the loading screen**

Create `src/renderer/loading-view.ts`:

```typescript
/* The screen while movy is not yet live. Deliberately plain: this is a
 * two-to-five second state, and anything animated here competes for the tick
 * budget with the engine boot it is waiting for. */

import { W, H } from './layout.js';
import { fontPrint, fontWidth } from '../font/index.js';

export function renderLoadingView(phase: string): void {
    clear_screen();
    const label = phase === 'booting' ? 'STARTING ENGINE' : 'LOADING SET';
    fontPrint(Math.floor((W - fontWidth(label)) / 2), Math.floor(H / 2) - 3, label);
}
```

In `src/app/tick.ts`, at the top of the render dispatch (before the
`VIEW_MAIN_PARAMS` branch):

```typescript
    if (!sessionReady()) {
        renderLoadingView(sessionPhase());
        return;
    }
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run build:browser && node browser-test/app-loop.mjs 2>&1 | grep -E "gate:|✗" | head`
Expected: all four `gate:` assertions pass.

- [ ] **Step 6: Add the screenshot baseline**

Add a scene to `browser-test/screenshot.mjs` rendering `renderLoadingView('booting')`
and `renderLoadingView('loading')`, then:

```bash
node browser-test/screenshot.mjs --update
node browser-test/screenshot.mjs        # must pass clean afterwards
```

- [ ] **Step 7: Full gate and commit**

```bash
npm run typecheck && npm test 2>&1 | grep -E "ALL |✗"
git add src/midi/router.ts src/renderer/loading-view.ts src/app/tick.ts \
        browser-test/app-loop.mjs browser-test/screenshot.mjs browser-test/screenshots/baseline
git commit -m "feat: movy refuses input until the Set is actually loaded"
```

---

### Task 5: Device verification and docs

**Files:**
- Modify: `scripts/test-seq.sh`
- Modify: `MANUAL.md`

- [ ] **Step 1: Add the device assertion**

In `scripts/test-seq.sh`, after movy is opened but before the fixture settles,
inject a step press immediately and assert it left nothing behind:

```bash
# A press during boot must be refused, not queued. Before the gate it was
# buffered and flushed on the tick a blank state landed on top of it.
ts_tap_note 16
sleep 6
ts_ssh "cat '$(ts_seq_path)'" | qgrep -E '^cl 0 ' \
    && fail "a step pressed during boot entered a note" \
    || pass "a step pressed during boot was refused"
```

- [ ] **Step 2: Run the device suites**

```bash
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && ./scripts/test-all-device.sh \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```
Expected: `ALL DEVICE SUITES PASSED`. If the device is offline, report it to the
user in CAPS.

- [ ] **Step 3: Document the loading screen**

In `MANUAL.md`, in the section covering opening movy, add:

```markdown
When Movy opens it shows **STARTING ENGINE**, then **LOADING SET**, for a few
seconds. The pads and screen are inert until it is done: everything you play or
enter after that point belongs to the Set, and nothing before it can be lost.
```

- [ ] **Step 4: Commit**

```bash
git add scripts/test-seq.sh MANUAL.md
git commit -m "test(device): a step pressed during boot must leave no note"
```

---

## Self-Review

**Spec coverage**

| Spec requirement | Task |
|---|---|
| One owner, phase machine | 3 |
| Identity: rename vs switch, one question | 3 (`identityChanged`) |
| Provisional → provisional (browsing) | 3 (R3) |
| Never wait on identity | 3 (`_pending` path, no timeout anywhere) |
| Engine-generation guard folded into the phase | 3 (R6) |
| Gate all input, Back exempt | 4 |
| Loading screen | 4 |
| Deletes adopt/`engineHoldsClips`/`curUuid === null`/pre-ready queue | 3, 4 |
| Storage untouched | all — no file in the untouched list is modified |
| Step 0 measurement | 0 |
| Tests: logic, app-loop, screenshot, device, MANUAL | 1-5 |
| `persist.ts` split under 200 lines | 1, 2, 3 |

**Not covered by any task, deliberately:** the engine-absent degraded mode
(unlock the chain/knob pages when the engine is declared absent). It depends on
`bootState === 'absent'` in `engine.ts`, which this plan does not touch, and it
is a separate user-visible behaviour worth its own review. **Raise it with the
user before Task 4 ships** — until then, an absent engine leaves movy gated with
only Back working, which is safe but poor.

**Placeholders:** none — every step carries its code.

**Type consistency:** `sessionFlush(force?)`, `sessionTick()`, `sessionReady()`,
`sessionPhase()`, `currentSetUuid()`, `resetSetSession()` are used identically in
Tasks 3, 4 and 5. `saveSet(id, gen, force)` returns `{ ok, wrote, gen }` in Task 2
and is destructured as such in Task 3. `loadSet(id, name)` returns
`{ payload, gen }` in Task 1 and is used as such in Task 3.
