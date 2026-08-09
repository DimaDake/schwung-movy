# Background Mode (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let movy keep sequencing (and emitting Phase 1 clock, so synced LFOs stay locked) while parked in the background under Move's native UI, entered by pressing Back at movy's root view and exited with Shift+Back.

**Architecture:** Two first-class schwung host additions — a `suspend_self_managed` capability (the module owns the Back button and decides when to suspend) plus a `host_suspend_overtake()` JS host function, and a `globalThis.overtakeParked` signal the host sets around each parked module's `tick()`. Movy adopts them: its root-view Back calls `host_suspend_overtake()` (releasing live notes first), its `tick()` skips all display/LED work while `overtakeParked` is set (the DSP keeps playing on its own), and a new `onResume()` hook forces a full repaint on return. The schwung changes are upstreamable but stay on a local worktree branch; **no upstream PR without asking.**

**Tech Stack:** schwung shadow UI (QuickJS JS, `src/shadow/shadow_ui.js`), movy UI (TypeScript → `ui.js` via esbuild), movy Rust engine (unchanged in Phase 2), device e2e over SSH.

## Global Constraints

- **Schwung base:** branch off `origin/main` in a **git worktree** (local `schwung/main` has diverged — ahead 859 / behind 1002; every seam in this plan was verified against `origin/main`). Do not edit the primary `schwung/` checkout.
- **No upstream PR** for the schwung changes without asking the user first. Deploy to device for testing only.
- **Movy = its own git repo:** follow `movy/CLAUDE.md` — branch (never work on the default branch directly), never `git add -A`, commit trailer `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`, commit + push at the end.
- **ENGINE_VERSION is unchanged** in Phase 2 (no `engine/` change). Do not touch `engine/crates/movy-dsp/src/lib.rs` or `src/seq/constants.ts` version constants.
- **Movy file-size limits:** hard 200 lines, target 50–100, one responsibility per file (`movy/CLAUDE.md`).
- **Movy `model/` never calls display functions; `renderer/` has no state; `src/types/` imports nothing from `src/`.**
- **Performance is first-class:** the parked path must skip the per-frame ViewModel build + LED diffs. Local perf test (`browser-test/perf.mjs`) must stay green and gain a parked-tick assertion.
- **Movy test discipline (run at the end of every task that changes movy, in order):**
  ```bash
  cd movy
  npm run build:browser
  node browser-test/logic.mjs      # 0 failures
  node browser-test/app-loop.mjs   # 0 failures
  node browser-test/screenshot.mjs # 0 failures
  node browser-test/perf.mjs       # 0 failures
  ```
  (or `npm test`). `npm run typecheck` must be zero errors. Device tests only in Task 8.
- **Update user docs** (`MANUAL.md` always, `README.md` for the headline) for this user-facing feature — Task 7.
- **On-device paths:** shadow UI = `/data/UserData/schwung/shadow/shadow_ui.js`; reloading it requires a schwung-stack restart (root SSH, user-run — same sequence as MoveOriginal recovery). Device host version at plan time: `0.11.4`.
- **Graceful degradation invariant:** movy declares **only** `suspend_self_managed` (never `suspend_keeps_js` directly). A host that understands it derives keeps-JS from it; an old host ignores it and movy falls back to a plain exit. Movy must guard every new host call with `typeof host_suspend_overtake === 'function'` and read the signal as `globalThis.overtakeParked` (never a bare identifier — an unset global identifier throws in QuickJS).

---

## File Structure

**Schwung (worktree off `origin/main`):**
- Modify `src/shadow/shadow_ui.js` — one file, four edit clusters:
  - global decl + capability parse + park-entry field + resets (Task 1)
  - `host_suspend_overtake()` definitions + deletes (Task 1)
  - Back-intercept pass-through (Task 2)
  - parked-tick `overtakeParked` signal (Task 2)

**Movy (`movy/`):**
- Modify `src/types/schwung.d.ts` — ambient decls for `host_suspend_overtake` + `overtakeParked` (Task 3)
- Modify `module.json` — add `suspend_self_managed` capability, bump `version` (Task 3)
- Modify `src/midi/router.ts` — root-Back suspend gesture (Task 4)
- Modify `src/app/tick.ts` — parked-tick early return + `invalidateLedCachesOnResume()` export (Tasks 5, 6)
- Create `src/app/resume.ts` — `onResume()` hook (Task 6)
- Modify `src/app/globals.ts` — wire `globalThis.onResume` (Task 6)
- Modify `browser-test/app-loop.mjs` — suspend-gesture, parked-skip, resume tests (Tasks 4, 5, 6)
- Modify `browser-test/perf.mjs` — parked-tick zero-draw assertion (Task 5)
- Modify `MANUAL.md`, `README.md` — background-mode docs (Task 7)
- Modify `scripts/test-seq.sh` — device background-mode assertion (Task 8)

---

## Task 1: Schwung — `host_suspend_overtake()` + `suspend_self_managed` capability

**Files:**
- Create worktree: `schwung/` → `../schwung-bgmode` off `origin/main`
- Modify: `src/shadow/shadow_ui.js` (in the worktree)

**Interfaces:**
- Produces: JS global `host_suspend_overtake()` (calls `suspendOvertakeMode()`); module capability `suspend_self_managed` (parsed into `overtakeSuspendSelfManaged`, and implies `overtakeSuspendKeepsJs`); park-entry field `selfManaged` restored on resume. Task 2 consumes `overtakeSuspendSelfManaged`; movy (Task 4) consumes `host_suspend_overtake`.

- [ ] **Step 1: Create the worktree off origin/main**

```bash
cd /Users/dake/git/cld/schwung
git fetch origin
git worktree add ../schwung-bgmode -b feat/suspend-self-managed origin/main
cd ../schwung-bgmode
git log --oneline -1   # expect bde822df (or newer origin/main tip)
```

- [ ] **Step 2: Add the `overtakeSuspendSelfManaged` global**

In `src/shadow/shadow_ui.js`, find:

```js
let overtakeSuspendKeepsJs = false; // Current module opted in to JS-alive suspend
```

Add immediately after it:

```js
let overtakeSuspendSelfManaged = false; // Module owns Back; suspends via host_suspend_overtake()
```

- [ ] **Step 3: Parse the capability in `loadOvertakeModule` (implies keeps-JS)**

Find (inside `loadOvertakeModule`):

```js
        overtakeSuspendKeepsJs = !!(moduleInfo.capabilities && moduleInfo.capabilities.suspend_keeps_js);
```

Replace with:

```js
        overtakeSuspendKeepsJs = !!(moduleInfo.capabilities && moduleInfo.capabilities.suspend_keeps_js);
        /* suspend_self_managed: the module uses Back for its own navigation and
         * calls host_suspend_overtake() when it decides to park. It implies
         * keeps-JS — the closure must stay alive to keep deciding + ticking. An
         * older host that predates this capability simply ignores it, so the
         * module degrades to a plain exit on Back. */
        overtakeSuspendSelfManaged = !!(moduleInfo.capabilities && moduleInfo.capabilities.suspend_self_managed);
        if (overtakeSuspendSelfManaged) overtakeSuspendKeepsJs = true;
```

- [ ] **Step 4: Reset the flag alongside every `overtakeSuspendKeepsJs = false`**

There are two reset sites. Find each line:

```js
    overtakeSuspendKeepsJs = false;
```

...in `exitOvertakeMode` (the un-indented one, ~line 3048) and in the `suspendOvertakeMode` success path (the 8-space-indented one, ~line 3121). After **each**, add a matching reset at the same indentation:

```js
    overtakeSuspendSelfManaged = false;
```

(For the indented one inside `suspendOvertakeMode`, use 8-space indent to match its neighbors.)

- [ ] **Step 5: Persist `selfManaged` in the park entry and restore it on resume**

In `suspendOvertakeMode`, find the park-entry object literal:

```js
        suspendedOvertakes[overtakeModuleId] = {
            id: overtakeModuleId,
            path: overtakeModulePath,
            callbacks: overtakeModuleCallbacks,
            ledNotes: ledNotesSnapshot,
            ledCCs: ledCCsSnapshot,
            dspPath: currentSlot0DspPath,
            shimGet: globalThis.host_module_get_param,
            shimSet: globalThis.host_module_set_param,
            shimSetBlocking: globalThis.host_module_set_param_blocking
        };
```

Add a `selfManaged` field (after `dspPath`):

```js
            dspPath: currentSlot0DspPath,
            selfManaged: overtakeSuspendSelfManaged,
```

Then in `resumeOvertakeModule`, find:

```js
    overtakeSuspendKeepsJs = true;
```

Add after it:

```js
    overtakeSuspendSelfManaged = !!parked.selfManaged;
```

- [ ] **Step 6: Define `host_suspend_overtake()` at both host-fn install sites**

Two sites install the module-facing host functions. In each, find the `host_exit_module` definition and add `host_suspend_overtake` right after it.

Site A — in `loadOvertakeModule` (~line 3525):

```js
        globalThis.host_exit_module = function() {
            debugLog("host_exit_module called by overtake module");
            if (toolOvertakeActive) {
                exitToolOvertake();
            } else {
                exitOvertakeMode();
            }
        };
```

Add after it (same 8-space indent):

```js
        globalThis.host_suspend_overtake = function() {
            debugLog("host_suspend_overtake called by overtake module");
            suspendOvertakeMode();
        };
```

Site B — in the reconnect path (~line 5516):

```js
            globalThis.host_exit_module = function() {
                debugLog("host_exit_module called by overtake module (reconnect)");
                if (toolOvertakeActive) {
                    exitToolOvertake();
                } else {
                    exitOvertakeMode();
                }
            };
```

Add after it (same 12-space indent):

```js
            globalThis.host_suspend_overtake = function() {
                debugLog("host_suspend_overtake called by overtake module (reconnect)");
                suspendOvertakeMode();
            };
```

- [ ] **Step 7: Delete `host_suspend_overtake` wherever `host_exit_module` is deleted**

Three cleanup sites delete `host_exit_module`. Find each:

```js
    delete globalThis.host_exit_module;
```

(at ~2309, ~3289, ~3668). After **each**, add at matching indentation:

```js
    delete globalThis.host_suspend_overtake;
```

- [ ] **Step 8: Syntax-check the file**

Run: `node --check src/shadow/shadow_ui.js`
Expected: no output (exit 0). Any parse error means a mis-matched edit — fix before continuing.

- [ ] **Step 9: Grep-verify the edits landed consistently**

Run:
```bash
grep -n "overtakeSuspendSelfManaged" src/shadow/shadow_ui.js
grep -c "host_suspend_overtake" src/shadow/shadow_ui.js
```
Expected: `overtakeSuspendSelfManaged` appears at the global decl, the parse (+`if`), 2 resets, the park-entry field, and the resume restore (≈7 lines). `host_suspend_overtake` count ≥ 5 (2 defs + 3 deletes; more if debug strings counted).

- [ ] **Step 10: Commit (schwung worktree)**

```bash
git add src/shadow/shadow_ui.js
git commit -m "$(cat <<'EOF'
feat(shadow): host_suspend_overtake() + suspend_self_managed capability

A self-managed overtake module owns the Back button and suspends itself via
host_suspend_overtake(); the capability implies keeps-JS and is ignored by
older hosts (module degrades to plain exit).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Schwung — Back pass-through for self-managed + `overtakeParked` signal

**Files:**
- Modify: `src/shadow/shadow_ui.js` (worktree)

**Interfaces:**
- Consumes: `overtakeSuspendSelfManaged` (Task 1).
- Produces: JS global `globalThis.overtakeParked` — `true` only during a parked module's `tick()`, `false` otherwise. Movy (Task 5) reads it.

- [ ] **Step 1: Gate the Back intercept so self-managed modules receive plain Back**

Find the Back-handling block (~line 15241):

```js
        if ((status & 0xF0) === 0xB0 && d1 === MoveBack && d2 > 0 && overtakeSuspendKeepsJs && !coRunUiActive()) {
            if (hostShiftHeld) {
                debugLog("HOST: Shift+Back → full exit (suspend_keeps_js module)");
                if (toolOvertakeActive) exitToolOvertake();
                else exitOvertakeMode();
            } else {
                debugLog("HOST: Back → suspend (module parks in background)");
                suspendOvertakeMode();
            }
            return;
        }
```

Replace the whole block with:

```js
        if ((status & 0xF0) === 0xB0 && d1 === MoveBack && d2 > 0 && overtakeSuspendKeepsJs && !coRunUiActive()) {
            if (hostShiftHeld) {
                debugLog("HOST: Shift+Back → full exit (suspend_keeps_js module)");
                if (toolOvertakeActive) exitToolOvertake();
                else exitOvertakeMode();
                return;
            }
            if (!overtakeSuspendSelfManaged) {
                debugLog("HOST: Back → suspend (module parks in background)");
                suspendOvertakeMode();
                return;
            }
            /* suspend_self_managed: the module owns plain Back for its own
             * navigation and calls host_suspend_overtake() when it decides to
             * park. Fall through to its onMidiMessageInternal (Shift+Back above
             * is still the host's universal full-exit). */
        }
```

- [ ] **Step 2: Set `overtakeParked` around the parked-tick loop**

Find the parked-tick block in `globalThis.tick` (~line 14019). It looks like:

```js
        const parkedIds = Object.keys(suspendedOvertakes);
        if (parkedIds.length > 0) {
            const _noop = function() {};
            const _saved = {
```

Add the signal set right after the `if (parkedIds.length > 0) {` line:

```js
        const parkedIds = Object.keys(suspendedOvertakes);
        if (parkedIds.length > 0) {
            /* Signal to each parked module's tick() that it is running blind in
             * the background (draw calls below are no-ops). Modules read
             * globalThis.overtakeParked to skip display/LED work while parked. */
            globalThis.overtakeParked = true;
            const _noop = function() {};
            const _saved = {
```

Then find the `finally` that restores the display globals (~line 14061):

```js
            } finally {
                for (const k in _saved) globalThis[k] = _saved[k];
```

Insert the reset as the first statement in that `finally`:

```js
            } finally {
                globalThis.overtakeParked = false;
                for (const k in _saved) globalThis[k] = _saved[k];
```

- [ ] **Step 3: Syntax-check**

Run: `node --check src/shadow/shadow_ui.js`
Expected: exit 0, no output.

- [ ] **Step 4: Grep-verify**

Run:
```bash
grep -n "overtakeParked" src/shadow/shadow_ui.js
grep -n "overtakeSuspendSelfManaged" src/shadow/shadow_ui.js | grep -i back
```
Expected: `overtakeParked` set to `true` (before the loop) and `false` (in the finally). `overtakeSuspendSelfManaged` referenced in the Back block.

- [ ] **Step 5: Commit (schwung worktree)**

```bash
git add src/shadow/shadow_ui.js
git commit -m "$(cat <<'EOF'
feat(shadow): pass Back to self-managed modules + overtakeParked signal

Self-managed modules get plain Back (Shift+Back stays host full-exit); the
parked-tick loop sets globalThis.overtakeParked so a backgrounded module can
skip its display/LED work.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Movy — ambient declarations + `suspend_self_managed` capability

**Files:**
- Create branch in movy repo
- Modify: `src/types/schwung.d.ts`, `module.json`

**Interfaces:**
- Produces: TS ambient decls `host_suspend_overtake()` and `var overtakeParked` (consumed by Tasks 4–6); `module.json` capability `suspend_self_managed`.

- [ ] **Step 1: Create the movy feature branch**

```bash
cd /Users/dake/git/cld/movy
git checkout -b feat/background-mode
```

- [ ] **Step 2: Add ambient declarations**

In `src/types/schwung.d.ts`, find:

```ts
declare function host_exit_module(): void;
```

Add after it:

```ts
/* Background mode (Phase 2). host_suspend_overtake() parks movy under Move's
 * native UI; it is ABSENT on hosts that predate the capability, so always
 * guard with `typeof host_suspend_overtake === 'function'`. overtakeParked is
 * set true by the host only while a parked module's tick() runs — read it as
 * `globalThis.overtakeParked` (a bare unset global identifier throws). */
declare function host_suspend_overtake(): void;
declare var overtakeParked: boolean | undefined;
```

- [ ] **Step 3: Add the capability and bump the version**

In `module.json`, find the `capabilities` object:

```json
    "capabilities": {
        "skip_led_clear": true,
        "claims_master_knob": true
    }
```

Replace with:

```json
    "capabilities": {
        "skip_led_clear": true,
        "claims_master_knob": true,
        "suspend_self_managed": true
    }
```

Then bump `"version"` to the next minor above the current `main` release (Phase 1 shipped `0.23.0`, so use `"0.24.0"` unless `main` is already higher — check with `git log main -- module.json` and pick the next minor).

- [ ] **Step 4: Typecheck**

Run: `cd /Users/dake/git/cld/movy && npm run typecheck`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/types/schwung.d.ts module.json
git commit -m "$(cat <<'EOF'
feat(movy): declare background-mode host API + suspend_self_managed capability

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Movy — root-view Back suspends (with stuck-note release)

**Files:**
- Modify: `src/midi/router.ts:269-272`
- Test: `browser-test/app-loop.mjs`

**Interfaces:**
- Consumes: `host_suspend_overtake` decl (Task 3), existing `releaseAllNotes(track)`.
- Produces: root-view Back → `host_suspend_overtake()` when present, else `host_exit_module()`; live notes released first.

- [ ] **Step 1: Write the failing test in app-loop.mjs**

Add near the end of `browser-test/app-loop.mjs`, before the final summary:

```js
_log('\napp-loop: root-view Back suspends when host supports it');
{
    resetApp();
    appState.currentView = VIEW_CHAIN;           // root view
    // Physically hold a pad so we can prove notes are released on suspend.
    sendMidi([0x90, PAD_KICK, 100]);
    let suspended = 0;
    globalThis.host_suspend_overtake = () => { suspended++; };
    sendMidi([0xB0, MoveBack, 127]);
    eq('root Back called host_suspend_overtake', suspended, 1);
    eq('held pad released before suspend', Object.keys(keyboardState.held).length, 0);
    delete globalThis.host_suspend_overtake;
}

_log('\napp-loop: root-view Back exits when host lacks background mode');
{
    resetApp();
    appState.currentView = VIEW_CHAIN;
    let exited = 0;
    const realExit = globalThis.host_exit_module;
    globalThis.host_exit_module = () => { exited++; };
    delete globalThis.host_suspend_overtake;      // simulate old host
    sendMidi([0xB0, MoveBack, 127]);
    eq('root Back fell back to host_exit_module', exited, 1);
    globalThis.host_exit_module = realExit;
}
```

This needs `keyboardState` and `MoveBack` in scope. Add to the imports block near the top of the file (after the existing `dist/esm` imports):

```js
const { keyboardState } = await import('../dist/esm/keyboard/state.js');
```

`MoveBack` and `PAD_KICK` are already available (`MoveBack` from the env mock globals; `PAD_KICK` is a top-of-file const). If `MoveBack` is undefined in the harness, add `const MoveBack = globalThis.MoveBack;` near `PAD_KICK`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/app-loop.mjs`
Expected: the two new blocks FAIL (`suspended` is 0 / `host_exit_module` is called instead) — the router still calls `host_exit_module()` unconditionally at root.

- [ ] **Step 3: Implement the suspend gesture**

In `src/midi/router.ts`, find the root-view Back branch:

```js
        } else {
            releaseAllNotes(appState.activeSlot);
            host_exit_module();
        }
```

Replace with:

```js
        } else {
            // Root view. Release live notes first: once parked, movy stops
            // receiving MIDI, so a held pad would hang across the suspend edge.
            releaseAllNotes(appState.activeSlot);
            // Background mode: Back parks movy (sequencer + Phase 1 clock keep
            // running under Move's native UI; Shift+Back is the host's full
            // exit). Absent on older hosts → plain exit, unchanged behaviour.
            if (typeof host_suspend_overtake === 'function') {
                host_suspend_overtake();
            } else {
                host_exit_module();
            }
        }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node browser-test/app-loop.mjs`
Expected: both new blocks PASS; 0 total failures.

- [ ] **Step 5: Full local suite + typecheck**

Run:
```bash
npm run typecheck
npm run build:browser
node browser-test/logic.mjs && node browser-test/app-loop.mjs && node browser-test/screenshot.mjs && node browser-test/perf.mjs
```
Expected: 0 failures across all four.

- [ ] **Step 6: Commit**

```bash
git add src/midi/router.ts browser-test/app-loop.mjs
git commit -m "$(cat <<'EOF'
feat(movy): root-view Back parks movy in the background

Releases live notes across the suspend edge; falls back to exit on hosts
without background mode.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Movy — skip display/LED work while parked

**Files:**
- Modify: `src/app/tick.ts` (top of `tick()`)
- Test: `browser-test/app-loop.mjs`, `browser-test/perf.mjs`

**Interfaces:**
- Consumes: `globalThis.overtakeParked` (Task 2/3), existing `seqEngineTick()`, `seqPersistTick()`.
- Produces: while parked, `tick()` returns after engine sync + persist, emitting zero draw/LED calls.

- [ ] **Step 1: Write the failing test in app-loop.mjs**

Add before the final summary:

```js
_log('\napp-loop: parked tick does no LED work, resumes engine sync');
{
    resetApp();
    advance(4);                                   // let LEDs settle
    let ledWrites = 0;
    const realSetLED = globalThis.setLED;
    globalThis.setLED = (n, c) => { ledWrites++; realSetLED(n, c); };
    const beforeUi = (await import('../dist/esm/seq/engine.js')).uiTick();
    globalThis.overtakeParked = true;
    advance(8);
    eq('parked: zero LED writes', ledWrites, 0);
    const afterUi = (await import('../dist/esm/seq/engine.js')).uiTick();
    eq('parked: engine still ticked (uiTick advanced)', afterUi - beforeUi, 8);
    globalThis.overtakeParked = false;
    globalThis.setLED = realSetLED;
}
```

`uiTick` is exported from `src/seq/engine.ts`. (The dynamic import is cached, so it is cheap; or add `uiTick` to the top-of-file engine import.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/app-loop.mjs`
Expected: `parked: zero LED writes` FAILS (tick still paints LEDs — `overtakeParked` is not yet honoured).

- [ ] **Step 3: Implement the parked early-return**

In `src/app/tick.ts`, find the top of `tick()`:

```js
export function tick(): void {
    seqEngineTick();
    stepAutoTick(); // promote a long single-step hold to step-automation mode
```

Replace with:

```js
export function tick(): void {
    // Keep the engine mirror synced first (flushes any queued command, polls
    // status) — the mock/real engine reports transport + step state regardless
    // of whether we are on screen.
    seqEngineTick();
    // Parked in the background: Move's native UI is on screen and the host
    // no-ops our draw calls. The DSP keeps sequencing + emitting Phase 1 clock
    // on its own, so the JS side only has to stay synced (above) and keep
    // autosaving. Skip the whole render + LED pipeline — this saves the
    // per-frame ViewModel build and LED diffs. onResume() forces a full repaint
    // when we return, so nothing on screen is stale.
    if (globalThis.overtakeParked === true) {
        seqPersistTick();
        return;
    }
    stepAutoTick(); // promote a long single-step hold to step-automation mode
```

- [ ] **Step 4: Run to verify it passes**

Run: `node browser-test/app-loop.mjs`
Expected: both assertions PASS.

- [ ] **Step 5: Add the perf guard**

In `browser-test/perf.mjs`, find where a normal tick's `fill_rect` count is asserted (the harness counts `fill_rect` calls per tick). Add a parked-tick case that asserts zero draw calls. Pattern (adapt to the file's existing helpers for counting and ticking):

```js
_log('\nperf: parked tick draws nothing');
{
    resetPerf();                 // or the file's equivalent reset
    globalThis.overtakeParked = true;
    const before = fillRectCount();   // the harness's fill_rect counter
    tick();
    eq('parked tick: 0 fill_rect', fillRectCount() - before, 0);
    globalThis.overtakeParked = false;
}
```

If `perf.mjs` does not expose a per-tick counter helper, mirror the counting pattern it already uses for its baseline render assertion. The invariant to encode: **a parked tick performs no `fill_rect`.**

- [ ] **Step 6: Full local suite**

Run:
```bash
npm run typecheck && npm run build:browser
node browser-test/logic.mjs && node browser-test/app-loop.mjs && node browser-test/screenshot.mjs && node browser-test/perf.mjs
```
Expected: 0 failures.

- [ ] **Step 7: Commit**

```bash
git add src/app/tick.ts browser-test/app-loop.mjs browser-test/perf.mjs
git commit -m "$(cat <<'EOF'
perf(movy): skip render + LED work while parked in the background

Parked ticks only sync the engine mirror and autosave; the DSP keeps playing.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Movy — `onResume()` forces a full repaint on return

**Files:**
- Modify: `src/app/tick.ts` (add `invalidateLedCachesOnResume()` export)
- Create: `src/app/resume.ts`
- Modify: `src/app/globals.ts`
- Test: `browser-test/app-loop.mjs`

**Interfaces:**
- Consumes: module-local LED caches in `tick.ts` (`chromaticCache`, `drumCache`, `lastActiveSlot`, `drumRepaintTicks`), `appState`, `seqLedsInvalidate()`.
- Produces: `invalidateLedCachesOnResume(): void` (tick.ts), `onResume(): void` (resume.ts), `globalThis.onResume` wired in globals.ts.

- [ ] **Step 1: Write the failing test in app-loop.mjs**

Add before the final summary:

```js
_log('\napp-loop: onResume invalidates caches and repaints');
{
    resetApp();
    advance(6);
    // Park, advance blind, then resume.
    globalThis.overtakeParked = true;
    advance(8);
    globalThis.overtakeParked = false;
    let ledWrites = 0;
    const realSetLED = globalThis.setLED;
    globalThis.setLED = (n, c) => { ledWrites++; realSetLED(n, c); };
    globalThis.onResume();
    eq('onResume set dirty', appState.dirty, true);
    eq('onResume reset init-LEDs flag', appState.initLedsDone, false);
    advance(3);
    if (ledWrites > 0) ok('resume repainted LEDs'); else fail('resume repainted LEDs', 'no LED writes after resume');
    globalThis.setLED = realSetLED;
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/app-loop.mjs`
Expected: FAILS with `globalThis.onResume is not a function` (not wired yet).

- [ ] **Step 3: Add the cache-invalidation export to tick.ts**

In `src/app/tick.ts`, add this exported function (place it after the module-local cache declarations `chromaticCache` / `drumCache` / `lastActiveSlot` / `drumRepaintTicks` so it closes over them, e.g. just above `export function tick()`):

```js
/* Return from background: the host restored the suspend-time LED snapshot to
 * hardware, but the sequencer advanced while we were parked, so every on-change
 * LED cache is now stale. Drop them all and force a full repaint so the first
 * active frame repaints the pads, knob LEDs, and screen from current state. */
export function invalidateLedCachesOnResume(): void {
    chromaticCache.fill(0);
    drumCache.fill(0);
    seqLedsInvalidate();
    lastActiveSlot = -1;      // re-open the drum-repaint window on the next tick
    drumRepaintTicks = 0;
    appState.drumActive = false;
    appState.initLedsDone = false;
    appState.initLedIndex = 0;
    appState.dirty = true;
}
```

(`seqLedsInvalidate` is already imported in tick.ts. `chromaticCache`/`drumCache` are `const` Uint8Arrays — `.fill(0)` mutates them. `lastActiveSlot`/`drumRepaintTicks` are module-level `let`, reassignable here.)

- [ ] **Step 4: Create the onResume hook**

Create `src/app/resume.ts`:

```ts
import { invalidateLedCachesOnResume } from './tick.js';
import { mlog } from '../log.js';

/* Called by the host once each time movy returns from background (parked →
 * resumed). init() is NOT re-run. Our on-change LED/screen caches went stale
 * while the sequencer advanced under Move's native UI, so force a full repaint. */
export function onResume(): void {
    mlog('resume from background');
    invalidateLedCachesOnResume();
}
```

- [ ] **Step 5: Wire onResume into globals**

In `src/app/globals.ts`:

```ts
import { init } from './init.js';
import { tick } from './tick.js';
import { onMidiMessageInternal } from '../midi/router.js';

Object.assign(globalThis, { init, tick, onMidiMessageInternal });
```

Replace with:

```ts
import { init } from './init.js';
import { tick } from './tick.js';
import { onMidiMessageInternal } from '../midi/router.js';
import { onResume } from './resume.js';

Object.assign(globalThis, { init, tick, onMidiMessageInternal, onResume });
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm run build:browser && node browser-test/app-loop.mjs`
Expected: the onResume block PASSES; 0 total failures.

- [ ] **Step 7: Full local suite**

Run:
```bash
npm run typecheck && npm run build:browser
node browser-test/logic.mjs && node browser-test/app-loop.mjs && node browser-test/screenshot.mjs && node browser-test/perf.mjs
```
Expected: 0 failures.

- [ ] **Step 8: Commit**

```bash
git add src/app/tick.ts src/app/resume.ts src/app/globals.ts browser-test/app-loop.mjs
git commit -m "$(cat <<'EOF'
feat(movy): onResume() forces a full repaint on return from background

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6b: Movy — Leave-Movy modal on root Back (supersedes Task 4's direct park)

**Decision (user, 2026-07-13):** Back at the root view must not park instantly.
It opens a modal — **[Background]** (default) / **Close Movy** / Back cancels —
so the old "Back closes movy at empty stack" stays reachable behind an explicit
choice, and parking stays fast (Back, then jog-click = 2 presses). On hosts
without `host_suspend_overtake`, the modal shows only **Close Movy**.

**Files:**
- Modify: `src/app/state.ts` (two new fields)
- Modify: `src/midi/router.ts` (root-Back branch from Task 4; new modal interception)
- Create: `src/renderer/leave-modal.ts`
- Modify: `src/app/tick.ts` (draw modal last)
- Modify: `browser-test/app-loop.mjs` (rewrite Task 4's two blocks + new cases)
- Modify: `browser-test/screenshot.mjs` (new scene + baseline)

**Interfaces:**
- Consumes: `host_suspend_overtake` decl (Task 3), `releaseAllNotes(track)`,
  `decodeDelta`, `MoveMainKnob` / `MoveMainButton` / `MoveBack` globals.
- Produces: `appState.leaveModal: boolean`, `appState.leaveModalSel: number`
  (0 = Background, 1 = Close); `drawLeaveModal(sel: number, canSuspend: boolean): void`.

- [ ] **Step 1: Rewrite the app-loop tests (failing first)**

Replace Task 4's two blocks (`root-view Back suspends…` and `root-view Back
exits…`) in `browser-test/app-loop.mjs` with:

```js
_log('\napp-loop: root Back opens the Leave-Movy modal (no instant park)');
{
    resetApp();
    appState.currentView = VIEW_CHAIN;
    sendMidi([0x90, PAD_KICK, 100]);              // held pad
    let suspended = 0;
    globalThis.host_suspend_overtake = () => { suspended++; };
    sendMidi([0xB0, MoveBack, 127]);
    eq('modal open', appState.leaveModal, true);
    eq('no park before confirm', suspended, 0);
    eq('notes released on modal open', Object.keys(keyboardState.held).length, 0);

    // Pads are swallowed while the modal is up.
    sendMidi([0x90, PAD_KICK, 100]);
    eq('pad swallowed by modal', Object.keys(keyboardState.held).length, 0);

    // Jog-click confirms the default (Background) -> park.
    sendMidi([0xB0, MoveMainButton, 127]);
    eq('confirm default parks', suspended, 1);
    eq('modal closed after confirm', appState.leaveModal, false);
    delete globalThis.host_suspend_overtake;
}

_log('\napp-loop: modal Close option fully exits; Back cancels');
{
    resetApp();
    appState.currentView = VIEW_CHAIN;
    let suspended = 0, exited = 0;
    globalThis.host_suspend_overtake = () => { suspended++; };
    const realExit = globalThis.host_exit_module;
    globalThis.host_exit_module = () => { exited++; };

    sendMidi([0xB0, MoveBack, 127]);              // open modal
    sendMidi([0xB0, MoveBack, 127]);              // Back again = cancel
    eq('Back cancels modal', appState.leaveModal, false);
    eq('cancel neither parks nor exits', suspended + exited, 0);

    sendMidi([0xB0, MoveBack, 127]);              // reopen
    sendMidi([0xB0, MoveMainKnob, 1]);            // jog +1 -> Close Movy
    eq('jog moved selection', appState.leaveModalSel, 1);
    sendMidi([0xB0, MoveMainButton, 127]);        // confirm
    eq('Close exits', exited, 1);
    eq('Close does not park', suspended, 0);

    globalThis.host_exit_module = realExit;
    delete globalThis.host_suspend_overtake;
}

_log('\napp-loop: old host (no suspend fn) -> modal offers Close only');
{
    resetApp();
    appState.currentView = VIEW_CHAIN;
    delete globalThis.host_suspend_overtake;
    let exited = 0;
    const realExit = globalThis.host_exit_module;
    globalThis.host_exit_module = () => { exited++; };
    sendMidi([0xB0, MoveBack, 127]);
    eq('modal opens on old host too', appState.leaveModal, true);
    sendMidi([0xB0, MoveMainButton, 127]);        // only option = Close
    eq('old host confirm exits', exited, 1);
    globalThis.host_exit_module = realExit;
}
```

(`keyboardState`, `MoveBack`, `PAD_KICK` are already in scope from Task 4's
test setup; `MoveMainKnob` comes from the same env-mock globals — if missing,
mirror how `MoveBack` is obtained. Jog encoding: `d2 = 1` decodes as +1 via
`decodeDelta`.)

- [ ] **Step 2: Run to verify failure**

`npm run build:browser && node browser-test/app-loop.mjs` → the new blocks
FAIL (`appState.leaveModal` undefined; Back parks immediately).

- [ ] **Step 3: State fields**

In `src/app/state.ts`, next to `currentView`/`dirty` (and in the AppState
interface if one is declared):

```ts
    /* Leave-Movy modal (root-view Back): 0 = Background, 1 = Close. */
    leaveModal:    false,
    leaveModalSel: 0,
```

- [ ] **Step 4: Router — replace the root-Back branch (Task 4's code) and add modal interception**

Root-Back branch becomes:

```ts
        } else {
            // Root view: open the Leave-Movy modal. Notes are released on
            // open (not on leave) because pad MIDI is swallowed while the
            // modal is up — a held pad would otherwise stick.
            releaseAllNotes(appState.activeSlot);
            appState.leaveModal = true;
            appState.leaveModalSel = 0;
            appState.dirty = true;
        }
```

Modal interception — insert immediately after the Shift handler (`if (d1 ===
MoveShift) …`), BEFORE the pad/step handlers, so the modal swallows all other
input while open:

```ts
    /* Leave-Movy modal: consumes everything except jog / click / Back. */
    if (appState.leaveModal) {
        const canSuspend = typeof host_suspend_overtake === 'function';
        if (d1 === MoveBack && d2 > 0) {
            appState.leaveModal = false;              // stay in movy
            appState.dirty = true;
        } else if (d1 === MoveMainKnob) {
            const delta = decodeDelta(d2);
            if (delta !== 0 && canSuspend) {          // single option: nothing to scroll
                appState.leaveModalSel = delta > 0 ? 1 : 0;
                appState.dirty = true;
            }
        } else if (d1 === MoveMainButton && d2 > 0) {
            const close = !canSuspend || appState.leaveModalSel === 1;
            appState.leaveModal = false;
            if (close) host_exit_module();
            else host_suspend_overtake();
        }
        return;
    }
```

- [ ] **Step 5: Renderer `src/renderer/leave-modal.ts`**

New file (~45 lines). Match `src/renderer/overlay.ts` idioms exactly — same
fill/clear/border calls, `fontPrint`, layout constants — the code below is the
structure; lift the pixel idioms from `drawEnumOverlay`/`drawJogToast`:

```ts
import { fontPrint } from '../font/index.js';

/* Centered confirmation box: [Background] / Close Movy / Back cancels.
 * canSuspend=false (old host) renders the Close row only. */
export function drawLeaveModal(sel: number, canSuspend: boolean): void {
    // box: centered, ~104x36 px, 1px border, cleared interior
    // title:  "Leave Movy?"
    // row 1 (if canSuspend): "Background"  — selected marker when sel === 0
    // row 2:                 "Close Movy"  — selected marker when sel === 1 || !canSuspend
    // hint:   "BACK: stay"
}
```

Wire into `src/app/tick.ts`: after the current view render dispatch (last, so
it draws on top):

```ts
    if (appState.leaveModal) {
        drawLeaveModal(appState.leaveModalSel, typeof host_suspend_overtake === 'function');
    }
```

- [ ] **Step 6: Run app-loop to verify pass**

`npm run build:browser && node browser-test/app-loop.mjs` → 0 failures.

- [ ] **Step 7: Screenshot scene + baseline**

Add a `leave-modal` scene to `browser-test/screenshot.mjs` (crib an existing
scene: render the root chain view, set `appState.leaveModal = true`, tick, and
capture). Then:

```bash
node browser-test/screenshot.mjs --update   # generates the new baseline only
node browser-test/screenshot.mjs            # 0 failures, no other baseline drift
```

Visually inspect `browser-test/screenshots/baseline/leave-modal.png` (box
centered, both rows legible, marker on Background).

- [ ] **Step 8: Full local suite**

```bash
npm run typecheck && npm test
```
Expected: 0 failures everywhere.

- [ ] **Step 9: Commit**

```bash
git add src/app/state.ts src/midi/router.ts src/renderer/leave-modal.ts src/app/tick.ts \
        browser-test/app-loop.mjs browser-test/screenshot.mjs browser-test/screenshots/baseline/leave-modal.png
git commit -m "$(cat <<'EOF'
feat(movy): Leave-Movy modal on root Back (Background default / Close / cancel)

Supersedes the instant park: closing movy stays reachable at the empty
back stack, guarded by an explicit choice. Old hosts get Close only.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Movy — documentation

**Files:**
- Modify: `MANUAL.md`, `README.md`

**Interfaces:** none (docs only). Read both files first to match voice/structure (`movy/CLAUDE.md` → Documentation).

- [ ] **Step 1: Add a Background mode section to MANUAL.md**

Add a new subsection (near the transport / navigation material). Content to cover, in the manual's step-by-step voice:

- **Enter:** press **Back** at the root (chain) view. Movy drops to Move's native UI but keeps sequencing; synced LFOs stay phase-locked because the Phase 1 clock keeps emitting. (Within movy, Back still steps back through sub-views — browse, keys/knobs, master detail, main/clip pages — as before; only Back at the root backgrounds movy.)
- **Return:** reopen movy (Tools menu, or the last-tool shortcut). LEDs and screen repaint from current state; the sequence never stopped.
- **Exit:** **Shift+Back** fully exits movy (unloads it), from anywhere.
- Note the host requirement: background mode needs a Schwung host that supports self-managed suspend; on older hosts Back at the root simply exits.

- [ ] **Step 2: Add the gesture to the Controls reference (MANUAL.md section 8)**

Add rows: `Back` (at root) → *Background — park movy, keep it playing*; `Shift+Back` → *Exit movy*.

- [ ] **Step 3: Add a headline bullet to README.md**

In *Features*, add one line, e.g. **Background mode** — *keeps sequencing under Move's UI (Back to park, Shift+Back to exit)*. No new screenshot is required (background mode has no distinct on-screen state); do not fabricate one.

- [ ] **Step 4: Commit**

```bash
git add MANUAL.md README.md
git commit -m "$(cat <<'EOF'
docs(movy): document background mode (Back to park, Shift+Back to exit)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Device e2e — deploy, verify background mode, push both repos

**Files:**
- Modify: `scripts/test-seq.sh` (movy)
- Deploy: schwung `shadow_ui.js` (worktree) + movy (`deploy.sh`)

**Interfaces:** none new. This task integrates and verifies on hardware.

- [ ] **Step 1: Check device reachability**

```bash
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null && echo ONLINE || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```
If offline: **report DEVICE OFFLINE in CAPS to the user**, skip Steps 2–7, and go to Step 8 (push) noting device verification was skipped.

- [ ] **Step 2: Deploy the modified schwung shadow_ui.js**

The shadow UI file is loaded once at shadow-UI process start, so a new copy needs a stack restart to take effect.

```bash
# From the schwung worktree:
scp -o ConnectTimeout=5 ../schwung-bgmode/src/shadow/shadow_ui.js \
    ableton@move.local:/data/UserData/schwung/shadow/shadow_ui.js
```

Then restart the schwung stack. **This is a root-SSH step the USER must run** (same sequence as MoveOriginal recovery — stop `move-launcher`, pkill the schwung stack, start `move-launcher`). Ask the user to run it (suggest they use `! <command>` for the interactive/root parts), and wait for confirmation the stack is back up before continuing. Do not `kill -9` shadow_ui yourself.

- [ ] **Step 3: Enable the device log and deploy movy**

```bash
ssh ableton@move.local 'touch /data/UserData/schwung/debug_log_on'
cd /Users/dake/git/cld/movy && ./scripts/deploy.sh
```

- [ ] **Step 4: Add a background-mode assertion to scripts/test-seq.sh**

Extend the sequencer e2e (`scripts/test-seq.sh`) with a background-mode check that reuses the harness's MIDI-inject + log-grep pattern. The assertion sequence:

1. Open movy, start the sequencer playing (existing transport helper).
2. Enable a synced slot LFO on a slow division on the active track (so Phase 1 clock-lock is observable) — reuse the Phase 1 clock-emission log check if present.
3. Inject **Back** (`0xB0 <MoveBack> 127`) at the root view.
   - **Known harness limitation:** CC injection may not reach the overtake UI (see the CC-Inject Harness Limitation memory). If Back cannot be injected, drive the suspend via the same shim path the Phase 1 test used, or assert the pieces that *are* observable (below) and note the manual step in the script output. Do not let this silently pass.
4. Assert, from the debug log, that after the Back:
   - movy logged the suspend/park transition and Move's native UI returned (shadow exit), **and**
   - the DSP **keeps emitting `0xF8` clock while parked** (slot still receives clock — the Phase 1 clock assertion should still fire with movy backgrounded). This is the core Phase 2 guarantee: the sequencer + clock survive backgrounding.
5. Reopen movy (open_tool_cmd) and assert movy logged `resume from background` (the onResume mlog) and repainted (LED traffic resumes).

Keep the check self-contained and automated where the harness allows; where a step is genuinely un-injectable, print a clearly-labelled `MANUAL:` line rather than a false PASS.

- [ ] **Step 5: Run the device sequencer e2e**

```bash
cd /Users/dake/git/cld/movy && ./scripts/test-seq.sh
```
Expected: existing transport/step/record/session/persistence checks PASS (modulo the pre-existing CC-inject Play limitation noted in memory), plus the new background-mode assertion. Investigate and fix any regression before pushing.

- [ ] **Step 6: Manual spot-checks (report results to the user)**

- Back at root → Move's UI returns, movy's sequence keeps playing, a synced LFO stays locked.
- Reopen movy → LEDs + screen correct, no stuck notes, transport continued.
- **Shift+Back** → movy fully exits.
- Hold a pad, then Back → the note does not hang (release-across-suspend works).

- [ ] **Step 7: Run the param-UI e2e (regression)**

```bash
cd /Users/dake/git/cld/movy && ./scripts/test.sh
```
Expected: PASS (or only the pre-existing CC-inject knob limitation). This confirms the schwung Back change did not break normal in-movy Back navigation.

- [ ] **Step 8: Push both repos**

Movy:
```bash
cd /Users/dake/git/cld/movy
git push -u origin feat/background-mode
```

Schwung worktree (branch stays local/pushed for review — **no upstream PR without asking the user**):
```bash
cd /Users/dake/git/cld/schwung-bgmode
git push -u origin feat/suspend-self-managed   # only if the user wants it on the remote; otherwise leave local
```

Then ask the user how to integrate (movy merge to main; whether to open the schwung PR upstream). Use `superpowers:finishing-a-development-branch` for the merge/PR decision.

- [ ] **Step 9: Clean up the schwung worktree (after integration decided)**

```bash
cd /Users/dake/git/cld/schwung
git worktree remove ../schwung-bgmode   # only once the branch is pushed/merged as decided
```

---

## Self-Review

**Spec coverage (design §7 Phase 2):**
- Gap 1 (Back conflict → `host_suspend_overtake()` + `suspend_self_managed`): Tasks 1, 2 (schwung), Task 4 (movy adoption). ✓
- Gap 2 (parked signal → parked-tick global; movy skips display/LED + refreshes on resume): Task 2 (signal), Task 5 (skip), Task 6 (onResume refresh). ✓
- Gap 3 (movy: capability flag, suspend gesture, stuck-note check, persistence-while-parked, resume re-sync e2e): Task 3 (flag), Task 4 (gesture + note release), Task 5 (persist still ticks while parked — `seqPersistTick()` in the parked branch), Task 8 (resume re-sync device e2e). ✓
- "Parked movy keeps sequencing *and* keeps emitting clock": DSP renders unconditionally (host) + Phase 1 clock emit is in `render_block` (independent of JS) — asserted in Task 8 Step 4.4. ✓

**Placeholder scan:** every code step shows the exact before/after. The only deliberately open items are (a) the movy `version` number (depends on current `main`, Step in Task 3 says how to pick it) and (b) `perf.mjs` / `test-seq.sh` helper names (those files' existing helpers must be matched at execution — instructions state the invariant to encode). No "TBD"/"add error handling"/"similar to Task N".

**Type consistency:** `overtakeSuspendSelfManaged` (schwung), `host_suspend_overtake` (both repos), `globalThis.overtakeParked` (set in Task 2, read in Task 5, declared in Task 3), `invalidateLedCachesOnResume` (defined Task 6 tick.ts, called Task 6 resume.ts), `onResume` (defined Task 6, captured by host at load, wired in globals.ts) — names match across tasks.

**Degradation invariant:** movy declares only `suspend_self_managed`; host derives keeps-JS (Task 1 Step 3); movy guards `host_suspend_overtake` with `typeof` (Task 4) and reads `globalThis.overtakeParked` as a property (Task 5). Old-host path is tested (Task 4 Step 1, second block). ✓
