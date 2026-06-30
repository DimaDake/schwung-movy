# Per-Set Sequencer State — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make movy's sequencer + UI state per Ableton Move *set* (keyed by the set UUID), so switching sets recalls an independent project, mirroring schwung/davebox.

**Architecture:** The UI reads the active set UUID from `active_set.txt` and keys per-set state files by UUID. The Rust engine stays UUID-agnostic; the UI ferries state via `host_*_file` + the blocking `state` param, exactly as today. A new `src/seq/set-context.ts` holds path/IO/inherit helpers; `src/seq/persist.ts` is refactored to a `switchToSet` orchestration polled from the tick.

**Tech Stack:** TypeScript (→ `ui.js` via esbuild; `dist/esm/` for node tests), QuickJS host globals, node `.mjs` test harness (`browser-test/`).

## Global Constraints

- **File size:** hard limit 200 lines/file; target 50–100. `set-context.ts` must stay focused.
- **Engine sets must be blocking:** use `host_module_set_param_blocking('state', …, 200)`. Never non-blocking for `state`.
- **No engine/`dsp.so` change.** Blank = push the tag-only blob `"movy1\n"`; `persist::load()` already clears all clips before applying.
- **Breaking backward compatibility is OK.** No migration from / fallback to the old singleton `seq-state.json`.
- **All host calls guarded** with `typeof … === 'function'`.
- **Build before tests:** `npm run build:browser` refreshes `dist/esm` before any `.mjs` test.
- **Co-author trailer** on commits: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`.

## File Structure

- **Create `src/seq/set-context.ts`** — pure helpers: `readActiveSet`, `uuidToStatePath`, `uuidToUiStatePath`, name index (`loadNameIndex`/`saveNameIndex`/`rememberSet`), `stripCopySuffix`, `findInheritCandidates`, `copyStateFiles`, `resolveStateBlob`, `resolveUiBlob`, `BLANK_STATE`. Host-guarded IO; no orchestration, no engine IPC.
- **Modify `src/seq/persist.ts`** — replace singleton load-once with `switchToSet(uuid, name, saveOld)` orchestration + active-set poll + per-set autosave. Keep `markUiStateDirty`, `serializeUiState`, `applyUiState`; add `resetUiState`.
- **Modify `src/types/schwung.d.ts`** — add `host_file_exists`, `host_ensure_dir`.
- **Modify `browser-test/mock-engine.mjs`** — record `state` set (blocking) + return it from `get_param('state')`.
- **Modify `browser-test/logic.mjs`** — set-context + switchToSet tests.
- **Modify `browser-test/app-loop.mjs`** — boot+switch integration test.

---

### Task 1: Typings + set-context paths, active-set reader, name index

**Files:**
- Modify: `src/types/schwung.d.ts` (after line 18, the `host_module_*` block)
- Create: `src/seq/set-context.ts`
- Test: `browser-test/logic.mjs` (append a new test block)

**Interfaces:**
- Produces:
  - `readActiveSet(): { uuid: string; name: string }`
  - `uuidToStatePath(uuid: string): string`
  - `uuidToUiStatePath(uuid: string): string`
  - `loadNameIndex(): Record<string, string>`
  - `saveNameIndex(idx: Record<string, string>): void`
  - `rememberSet(name: string, uuid: string): void`
  - `BLANK_STATE: string` (`"movy1\n"`)

- [ ] **Step 1: Add host typings.** In `src/types/schwung.d.ts`, after the `host_module_get_param` line add:

```typescript
declare function host_file_exists(path: string): boolean;
declare function host_ensure_dir(path: string): boolean;
```

- [ ] **Step 2: Write the failing test.** Append to `browser-test/logic.mjs` (after the imports, add the import; after the last test, add the block):

Import (with the other `dist/esm` imports near the top):

```javascript
import {
    readActiveSet, uuidToStatePath, uuidToUiStatePath,
    loadNameIndex, rememberSet, BLANK_STATE,
} from '../dist/esm/seq/set-context.js';
```

Test block:

```javascript
_log('\nTest: set-context paths + active-set reader + name index');
{
    // Mock a tiny host filesystem (path → contents).
    const fs = {};
    globalThis.host_read_file  = (p) => (p in fs ? fs[p] : null);
    globalThis.host_write_file = (p, c) => { fs[p] = c; return true; };
    globalThis.host_file_exists = (p) => p in fs;
    globalThis.host_ensure_dir = () => true;

    fs['/data/UserData/schwung/active_set.txt'] = 'abc-123\nMy Song\n';
    const as = readActiveSet();
    eq('readActiveSet uuid', as.uuid, 'abc-123');
    eq('readActiveSet name', as.name, 'My Song');

    eq('state path keyed by uuid', uuidToStatePath('abc-123'),
        '/data/UserData/schwung/modules/tools/movy/sets/abc-123/seq-state.json');
    eq('ui path keyed by uuid', uuidToUiStatePath('abc-123'),
        '/data/UserData/schwung/modules/tools/movy/sets/abc-123/ui-state.json');
    eq('empty uuid → _default state path', uuidToStatePath(''),
        '/data/UserData/schwung/modules/tools/movy/sets/_default/seq-state.json');

    eq('BLANK_STATE is the format tag', BLANK_STATE, 'movy1\n');

    rememberSet('My Song', 'abc-123');
    eq('name index round-trips', loadNameIndex()['My Song'], 'abc-123');

    delete fs['/data/UserData/schwung/active_set.txt'];
    eq('missing active_set → empty uuid', readActiveSet().uuid, '');
}
```

- [ ] **Step 3: Run test, verify FAIL.**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `Cannot find module '../dist/esm/seq/set-context.js'` (build error) or assertion failures.

- [ ] **Step 4: Implement `src/seq/set-context.ts` (paths half).**

```typescript
/* Per-set state context. Schwung stores tracks per native Move set; movy
 * mirrors that by keying its state files on the active set's UUID. The active
 * set is identified by /data/UserData/schwung/active_set.txt (line 1 = UUID,
 * line 2 = name) — the same source davebox's seq8 tool reads. */

const SETS_DIR     = '/data/UserData/schwung/modules/tools/movy/sets';
const NAME_INDEX   = SETS_DIR + '/name-index.json';
const ACTIVE_SET   = '/data/UserData/schwung/active_set.txt';
/* Move stores each set's folder under its UUID; used to skip deleted sets. */
const MOVE_SETS_DIR = '/data/UserData/UserLibrary/Sets';

/* Loading this blank (tag-only) blob makes the engine clear all clips/tracks:
 * seq-core persist::load() resets everything before applying, and a payload
 * with only the FORMAT_TAG ("movy1") applies nothing → clean slate. */
export const BLANK_STATE = 'movy1\n';

function readFile(path: string): string | null {
    return (typeof host_read_file === 'function') ? host_read_file(path) : null;
}
function writeFile(path: string, content: string): void {
    if (typeof host_write_file === 'function') host_write_file(path, content);
}
function fileExists(path: string): boolean {
    if (typeof host_file_exists === 'function') return host_file_exists(path);
    const d = readFile(path);            // fallback: non-empty read == exists
    return d !== null && d.length > 0;
}
function ensureDir(uuid: string): void {
    if (typeof host_ensure_dir === 'function') host_ensure_dir(SETS_DIR + '/' + uuid);
}

export function uuidToStatePath(uuid: string): string {
    return SETS_DIR + '/' + (uuid || '_default') + '/seq-state.json';
}
export function uuidToUiStatePath(uuid: string): string {
    return SETS_DIR + '/' + (uuid || '_default') + '/ui-state.json';
}

/* line 1 = UUID, line 2 = name; {uuid:'',name:''} if missing/unreadable. */
export function readActiveSet(): { uuid: string; name: string } {
    const raw = readFile(ACTIVE_SET);
    if (!raw) return { uuid: '', name: '' };
    const lines = raw.split('\n');
    return { uuid: (lines[0] || '').trim(), name: (lines[1] || '').trim() };
}

export function loadNameIndex(): Record<string, string> {
    const raw = readFile(NAME_INDEX);
    if (!raw) return {};
    try {
        const o = JSON.parse(raw);
        return (o && typeof o === 'object') ? o : {};
    } catch { return {}; }
}
export function saveNameIndex(idx: Record<string, string>): void {
    writeFile(NAME_INDEX, JSON.stringify(idx));
}
export function rememberSet(name: string, uuid: string): void {
    if (!name || !uuid) return;
    const idx = loadNameIndex();
    if (idx[name] === uuid) return;
    idx[name] = uuid;
    saveNameIndex(idx);
}
```

- [ ] **Step 5: Run test, verify PASS.**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: PASS for the new block; existing tests still 0 failures.

- [ ] **Step 6: Commit.**

```bash
git add src/types/schwung.d.ts src/seq/set-context.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(seq): set-context paths, active-set reader, name index

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Inherit-on-copy (suffix strip, candidates, copy, resolve)

**Files:**
- Modify: `src/seq/set-context.ts` (append)
- Test: `browser-test/logic.mjs` (append a block)

**Interfaces:**
- Consumes (Task 1): `uuidToStatePath`, `uuidToUiStatePath`, `loadNameIndex`, `BLANK_STATE`, internal `readFile`/`writeFile`/`fileExists`/`ensureDir`.
- Produces:
  - `stripCopySuffix(name: string): string | null`
  - `findInheritCandidates(name: string, idx: Record<string,string>): { uuid: string; name: string }[]`
  - `copyStateFiles(srcUuid: string, dstUuid: string): boolean`
  - `resolveStateBlob(uuid: string, name: string): string` — returns the engine state blob to load (seeds dst via copy on inherit; `BLANK_STATE` if nothing).
  - `resolveUiBlob(uuid: string): string | null` — ui-state.json contents or null.

- [ ] **Step 1: Write the failing test.** Append to `browser-test/logic.mjs`:

Import additions:

```javascript
import {
    stripCopySuffix, findInheritCandidates, resolveStateBlob, resolveUiBlob,
} from '../dist/esm/seq/set-context.js';
```

Test block:

```javascript
_log('\nTest: inherit-on-copy resolution');
{
    const fs = {};
    globalThis.host_read_file  = (p) => (p in fs ? fs[p] : null);
    globalThis.host_write_file = (p, c) => { fs[p] = c; return true; };
    globalThis.host_file_exists = (p) => p in fs;
    globalThis.host_ensure_dir = () => true;
    const stPath = (u) => '/data/UserData/schwung/modules/tools/movy/sets/' + u + '/seq-state.json';
    const uiPath = (u) => '/data/UserData/schwung/modules/tools/movy/sets/' + u + '/ui-state.json';
    const setDir = (u) => '/data/UserData/UserLibrary/Sets/' + u;

    eq('strip " Copy"',   stripCopySuffix('My Song Copy'),   'My Song');
    eq('strip " Copy 2"', stripCopySuffix('My Song Copy 2'), 'My Song');
    eq('no suffix → null', stripCopySuffix('My Song'),        null);

    // Parent "p-uuid" (name "My Song") has state + a live Move set.
    fs[stPath('p-uuid')] = 'movy1\nbpm 12000\n';
    fs[uiPath('p-uuid')] = '{"root":50,"scale":1}';
    fs[setDir('p-uuid')] = '';            // dir marker
    fs[setDir('c-uuid')] = '';            // the copy's Move set exists too
    const idx = { 'My Song': 'p-uuid' };

    const cands = findInheritCandidates('My Song Copy', idx);
    eq('one inherit candidate found', cands.length, 1);
    eq('candidate is the parent', cands[0].uuid, 'p-uuid');

    // Resolving a copy with no own state seeds + returns the parent's blob.
    const blob = resolveStateBlob('c-uuid', 'My Song Copy');
    eq('inherited state blob', blob, 'movy1\nbpm 12000\n');
    eq('copy seeded into dst state file', fs[stPath('c-uuid')], 'movy1\nbpm 12000\n');
    eq('copy seeded dst ui file', resolveUiBlob('c-uuid'), '{"root":50,"scale":1}');

    // Unknown brand-new set with no family → blank.
    eq('unknown set → blank', resolveStateBlob('z-uuid', 'Fresh'), 'movy1\n');

    // A set that already has its own state returns it (no inherit).
    fs[stPath('own')] = 'movy1\nswing 60\n';
    eq('own state wins', resolveStateBlob('own', 'Whatever'), 'movy1\nswing 60\n');
}
```

- [ ] **Step 2: Run test, verify FAIL.**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `stripCopySuffix` etc. not exported.

- [ ] **Step 3: Implement (append to `src/seq/set-context.ts`).**

```typescript
function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* Move's Copy/Paste appends " Copy" then " Copy N"; strip one level. */
export function stripCopySuffix(name: string): string | null {
    const m = (name || '').match(/^(.*?)\s+Copy(?:\s+\d+)?\s*$/);
    return m ? m[1].replace(/\s+$/, '') : null;
}

/* Family members (base name, or base + " Copy [N]") whose movy state file AND
 * backing Move set still exist. Sorted base-first, then shortest, then alpha.
 * Excludes the queried name so the picker never offers a no-op. */
export function findInheritCandidates(
    name: string, idx: Record<string, string>,
): { uuid: string; name: string }[] {
    const base = stripCopySuffix(name);
    if (!base) return [];
    const re = new RegExp('^' + escapeRegex(base) + '(?:\\s+Copy(?:\\s+\\d+)?)?$');
    const out: { uuid: string; name: string }[] = [];
    for (const n in idx) {
        if (n === name || !re.test(n)) continue;
        const uuid = idx[n];
        if (!uuid) continue;
        if (!fileExists(uuidToStatePath(uuid))) continue;
        if (!fileExists(MOVE_SETS_DIR + '/' + uuid)) continue;
        out.push({ uuid, name: n });
    }
    out.sort((a, b) => {
        if (a.name === base) return -1;
        if (b.name === base) return 1;
        if (a.name.length !== b.name.length) return a.name.length - b.name.length;
        return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
    });
    return out;
}

export function copyStateFiles(srcUuid: string, dstUuid: string): boolean {
    if (!srcUuid || !dstUuid) return false;
    const st = readFile(uuidToStatePath(srcUuid));
    if (!st) return false;
    ensureDir(dstUuid);
    writeFile(uuidToStatePath(dstUuid), st);
    const ui = readFile(uuidToUiStatePath(srcUuid));
    if (ui) writeFile(uuidToUiStatePath(dstUuid), ui);
    return true;
}

/* The engine state blob to load for `uuid`: own file → best-match inherit
 * (seeded via copy) → blank. */
export function resolveStateBlob(uuid: string, name: string): string {
    const own = readFile(uuidToStatePath(uuid));
    if (own && own.length > 0) return own;
    const cands = findInheritCandidates(name, loadNameIndex());
    if (cands.length > 0 && copyStateFiles(cands[0].uuid, uuid)) {
        const seeded = readFile(uuidToStatePath(uuid));
        if (seeded && seeded.length > 0) return seeded;
    }
    return BLANK_STATE;
}

export function resolveUiBlob(uuid: string): string | null {
    return readFile(uuidToUiStatePath(uuid));
}
```

- [ ] **Step 4: Run test, verify PASS.**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: PASS; existing tests 0 failures.

- [ ] **Step 5: Commit.**

```bash
git add src/seq/set-context.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(seq): inherit movy state from parent set on copy/paste

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: persist.ts — switchToSet orchestration, poll, per-set autosave

**Files:**
- Modify: `src/seq/persist.ts` (replace body below the imports)
- Modify: `browser-test/mock-engine.mjs` (record `state`)
- Test: `browser-test/logic.mjs` (append a block)

**Interfaces:**
- Consumes (Tasks 1–2): all `set-context.ts` exports.
- Produces:
  - `switchToSet(uuid: string, name: string, saveOld: boolean): void`
  - `currentSetUuid(): string` (test/inspection getter)
  - existing: `markUiStateDirty`, `serializeUiState`, `applyUiState`, `seqPersistTick`, `resetSeqPersist`.

- [ ] **Step 1: Extend the mock engine to record `state`.** In `browser-test/mock-engine.mjs`:

In the `engine` object literal add fields:

```javascript
        /* blocking `state` loads, in order; stateBlob = last loaded blob */
        stateLoads: [],
        stateBlob: null,
```

In `reset()` add:

```javascript
            this.stateLoads = [];
            this.stateBlob = null;
```

In `setParam`, add a branch (alongside `cmd`/`load`):

```javascript
        } else if (key === 'state') {
            engine.stateLoads.push(value);
            engine.stateBlob = value;
```

In `get_param`, before `return null;` add:

```javascript
        if (key === 'state') return engine.stateBlob;
```

- [ ] **Step 2: Write the failing test.** Append to `browser-test/logic.mjs`:

Imports:

```javascript
import { switchToSet, currentSetUuid, resetSeqPersist } from '../dist/esm/seq/persist.js';
import { keyboardState } from '../dist/esm/keyboard/state.js';
import { installMockEngine } from './mock-engine.mjs';
```

Test block:

```javascript
_log('\nTest: switchToSet save-then-load orchestration');
{
    const eng = installMockEngine();         // installs host_module_* on globalThis
    const fs = {};
    globalThis.host_read_file  = (p) => (p in fs ? fs[p] : null);
    globalThis.host_write_file = (p, c) => { fs[p] = c; return true; };
    globalThis.host_file_exists = (p) => p in fs;
    globalThis.host_ensure_dir = () => true;
    const stPath = (u) => '/data/UserData/schwung/modules/tools/movy/sets/' + u + '/seq-state.json';
    const uiPath = (u) => '/data/UserData/schwung/modules/tools/movy/sets/' + u + '/ui-state.json';

    resetSeqPersist();
    eng.reset();

    // Set A has saved state + ui; load it (no old to save on first switch).
    fs[stPath('A')] = 'movy1\nbpm 13000\n';
    fs[uiPath('A')] = '{"root":55,"scale":2}';
    switchToSet('A', 'Song A', false);
    eq('loaded A blob into engine', eng.stateLoads[eng.stateLoads.length - 1], 'movy1\nbpm 13000\n');
    eq('applied A ui root', keyboardState.rootNote, 55);
    eq('applied A ui scale', keyboardState.scale, 2);
    eq('current uuid is A', currentSetUuid(), 'A');

    // The engine now "holds" A's state; switching to fresh B must SAVE A first.
    eng.stateBlob = 'movy1\nbpm 13000\nEDITED\n';     // simulate edited engine state
    switchToSet('B', 'Song B', true);
    eq('A saved before B load', fs[stPath('A')], 'movy1\nbpm 13000\nEDITED\n');
    eq('B is blank (no file, no family)', eng.stateLoads[eng.stateLoads.length - 1], 'movy1\n');
    eq('B ui reset to defaults (root 48)', keyboardState.rootNote, 48);
    eq('B ui reset to defaults (scale 0)', keyboardState.scale, 0);
    eq('current uuid is B', currentSetUuid(), 'B');
}
```

- [ ] **Step 3: Run test, verify FAIL.**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `switchToSet`/`currentSetUuid` not exported.

- [ ] **Step 4: Rewrite `src/seq/persist.ts` body (keep lines 1–18 imports; add set-context import; replace lines 20 onward).**

Replace the import block additions and everything from the `STATE_PATH` const down with:

```typescript
import {
    readActiveSet, uuidToStatePath, uuidToUiStatePath,
    resolveStateBlob, resolveUiBlob, rememberSet, BLANK_STATE,
} from './set-context.js';

const SAVE_TICKS = 600;     // ~3s autosave cadence at the ~205 Hz device rate
const SET_POLL_TICKS = 96;  // ~0.5s: catch native set switches (incl. on resume)

let loaded = false;
let saveCountdown = SAVE_TICKS;
let setPollCountdown = SET_POLL_TICKS;
let uiDirty = false;
let curUuid = '';
let curName = '';

export function markUiStateDirty(): void { uiDirty = true; }
export function currentSetUuid(): string { return curUuid; }

/** `{root,scale}` JSON of the persisted UI keyboard state. */
export function serializeUiState(): string {
    return JSON.stringify({ root: keyboardState.rootNote, scale: keyboardState.scale });
}

/** Apply a serialized UI-state blob (tolerant of missing/invalid fields). */
export function applyUiState(blob: string): void {
    try {
        const o = JSON.parse(blob);
        if (typeof o.root === 'number') keyboardState.rootNote = Math.max(0, Math.min(103, o.root | 0));
        if (typeof o.scale === 'number') keyboardState.scale = Math.min(SCALES.length - 1, Math.max(0, o.scale | 0));
    } catch { /* corrupt file → keep defaults */ }
}

/* Defaults match init() (root 48, Major scale 0). */
function resetUiState(): void {
    keyboardState.rootNote = 48;
    keyboardState.scale = 0;
}

function filesAvailable(): boolean {
    return typeof host_read_file === 'function' && typeof host_write_file === 'function';
}

/* Read the engine's current state and persist it to `uuid`'s files. */
function saveSet(uuid: string): void {
    if (typeof host_module_get_param === 'function') {
        const state = host_module_get_param('state');
        if (state !== null) host_write_file(uuidToStatePath(uuid), state);
    }
    host_write_file(uuidToUiStatePath(uuid), serializeUiState());
    seqState.dirty = false;
}

/* The one routine both boot-load and live-switch funnel through: optionally
 * save the outgoing set, then load the incoming set's state (own → inherited →
 * blank) and UI state into the live engine. */
export function switchToSet(uuid: string, name: string, saveOld: boolean): void {
    if (saveOld && curUuid !== uuid) saveSet(curUuid);

    const blob = resolveStateBlob(uuid, name);
    if (typeof host_module_set_param_blocking === 'function')
        host_module_set_param_blocking('state', blob, 200);
    // Restore carries lane labels/assignments; re-request the label sync so the
    // automation registry reflects the just-loaded set (see boot-load history).
    requestLabelSync();

    const ui = resolveUiBlob(uuid);
    if (ui && ui.length > 0 && blob !== BLANK_STATE) applyUiState(ui);
    else if (ui && ui.length > 0) applyUiState(ui);
    else resetUiState();

    curUuid = uuid;
    curName = name;
    rememberSet(name, uuid);
    seqState.dirty = false;
    uiDirty = false;
}

export function seqPersistTick(): void {
    if (!engineReady() || !filesAvailable()) return;

    if (!loaded) {
        loaded = true;
        const { uuid, name } = readActiveSet();
        switchToSet(uuid, name, false);
        mlog('seq: loaded set ' + (uuid || '_default'));
        return;
    }

    if (--setPollCountdown <= 0) {
        setPollCountdown = SET_POLL_TICKS;
        const { uuid, name } = readActiveSet();
        if (uuid !== curUuid) {
            switchToSet(uuid, name, true);
            mlog('seq: switched to set ' + (uuid || '_default'));
            return;
        }
    }

    if (--saveCountdown > 0) return;
    saveCountdown = SAVE_TICKS;

    if (uiDirty) {
        uiDirty = false;
        host_write_file(uuidToUiStatePath(curUuid), serializeUiState());
    }
    if (!seqState.dirty) return;
    if (typeof host_module_get_param !== 'function') return;
    const state = host_module_get_param('state');
    if (state !== null) {
        host_write_file(uuidToStatePath(curUuid), state);
        seqState.dirty = false;
        mlog('seq: autosaved (' + state.length + ' bytes)');
    }
}

/* Test hook. */
export function resetSeqPersist(): void {
    loaded = false;
    saveCountdown = SAVE_TICKS;
    setPollCountdown = SET_POLL_TICKS;
    uiDirty = false;
    curUuid = '';
    curName = '';
}
```

Note: simplify the redundant `if/else if` UI branch above to:

```typescript
    const ui = resolveUiBlob(uuid);
    if (ui && ui.length > 0) applyUiState(ui);
    else resetUiState();
```

(The blob/BLANK distinction is irrelevant — on inherit, copyStateFiles already seeded the ui file, so `ui` is present; on blank there is no ui file → defaults.)

- [ ] **Step 5: Run test, verify PASS.**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: PASS; existing logic tests still 0 failures.

- [ ] **Step 6: Typecheck.**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 7: Commit.**

```bash
git add src/seq/persist.ts browser-test/mock-engine.mjs browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(seq): per-set state — switchToSet orchestration + active-set poll

Engine state and UI state (root/scale) are now keyed by the active Move set
UUID; switching sets saves the old set and loads the new (own → inherited →
blank). Replaces the singleton seq-state.json (BC break, intentional).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: App-loop integration — boot loads active set, switch reloads

**Files:**
- Modify: `browser-test/app-loop.mjs` (add a test block; the harness already installs the mock engine and drives init/tick)

**Interfaces:**
- Consumes: `globalThis.init/tick`, `installMockEngine` (already imported as `engine`), `host_*_file` (override locally).

- [ ] **Step 1: Write the failing test.** Append to `browser-test/app-loop.mjs` (after the existing tests, before the final summary/`process.exit`):

```javascript
_log('\napp-loop: active-set switch reloads the engine');
{
    // Back the host filesystem with an in-memory map and an active set "S1".
    const fs = {};
    globalThis.host_read_file  = (p) => (p in fs ? fs[p] : null);
    globalThis.host_write_file = (p, c) => { fs[p] = c; return true; };
    globalThis.host_file_exists = (p) => p in fs;
    globalThis.host_ensure_dir = () => true;
    const ACTIVE = '/data/UserData/schwung/active_set.txt';

    fs[ACTIVE] = 's1-uuid\nSet One\n';
    resetApp();                              // init() + settle; boot-load reads S1
    advance(4);
    const loadsAfterBoot = engine.stateLoads.length;
    eq('boot loaded a set blob', loadsAfterBoot >= 1, true);

    // Switch the active set; the poll (~96 ticks) must reload for the new UUID.
    fs[ACTIVE] = 's2-uuid\nSet Two\n';
    advance(120);
    eq('set switch triggered a fresh engine load', engine.stateLoads.length > loadsAfterBoot, true);
    eq('S1 was saved on switch-out', 's1-uuid' in JSON.stringify(Object.keys(fs)) ? true : Object.keys(fs).some(k => k.includes('s1-uuid')), true);
}
```

- [ ] **Step 2: Run test, verify FAIL or PASS-by-accident.**

Run: `npm run build:browser && node browser-test/app-loop.mjs`
Expected: With the Task 3 code present this should PASS. If it FAILs, inspect whether `resetApp()` re-runs `resetSeqPersist()` — if persist's `loaded` flag survives across `resetApp`, add `resetSeqPersist()` to the test's setup (import it) before `resetApp()`.

- [ ] **Step 3 (only if Step 2 failed on stale `loaded`): import + reset.** Add near the top imports:

```javascript
const { resetSeqPersist } = await import('../dist/esm/seq/persist.js');
```

And call `resetSeqPersist();` immediately before `resetApp();` in the new block.

- [ ] **Step 4: Run test, verify PASS.**

Run: `npm run build:browser && node browser-test/app-loop.mjs`
Expected: PASS; existing app-loop tests still 0 failures.

- [ ] **Step 5: Commit.**

```bash
git add browser-test/app-loop.mjs
git commit -m "$(cat <<'EOF'
test(seq): app-loop covers active-set switch → engine reload

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Full local suite, regression, device verification, docs

**Files:**
- Modify: `movy/CLAUDE.md` (one line under the sequencer section noting per-set state) — optional, only if it clarifies.
- Verify: screenshot + perf baselines unaffected.

- [ ] **Step 1: Run the full local suite.**

Run: `npm test`
Expected: `logic.mjs`, `app-loop.mjs`, `screenshot.mjs`, `perf.mjs` all 0 failures. No rendering changed, so screenshot needs no `--update`. If perf flags extra IPC, confirm the `state` poll runs at most every `SET_POLL_TICKS` and the active-set read is a single small file read per poll.

- [ ] **Step 2: Typecheck.**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Device test (if reachable).**

Run:
```bash
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && (cd movy && ./scripts/test-seq.sh) \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```
Expected: PASS. The suite exercises transport/steps/record/session/persistence; per-set paths must not regress single-set persistence. **If `test-seq.sh` hard-codes `seq-state.json`, update it to the per-set path** (`sets/<uuid>/seq-state.json`, or the `_default` path when no `active_set.txt`). If the device is offline, **report "DEVICE OFFLINE — SKIPPING DEVICE TESTS" to the user in CAPS.**

- [ ] **Step 4: Manual device sanity (if reachable, by the user):** create two Move sets, put a distinct sequence in each via movy, switch between them, confirm each recalls its own clips/tempo/root; copy a set and confirm the duplicate inherits the parent's movy sequence.

- [ ] **Step 5: Final commit / push.**

```bash
git add -p   # stage only intended changes
git commit -m "$(cat <<'EOF'
chore(seq): finalize per-set state (tests, device verification)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push
```

---

## Self-Review notes

- **Spec coverage:** active_set source (T1), per-set paths (T1), name index (T1), inherit-on-copy auto-pick (T2), blank-on-unknown (T2/T3), switchToSet save→resolve→load→ui (T3), poll detection (T3), per-set autosave (T3), boot+switch integration (T4), no engine change (T3 uses `BLANK_STATE`), typings (T1), device note (T5). UI-state per-set: covered (T3 resolve/apply/reset).
- **Type consistency:** `switchToSet(uuid,name,saveOld)`, `currentSetUuid()`, `resolveStateBlob(uuid,name)`, `resolveUiBlob(uuid)`, `BLANK_STATE='movy1\n'`, paths `sets/<uuid|_default>/{seq-state,ui-state}.json` — consistent across tasks.
- **Out of scope:** modal inherit-picker, snapshots, old-singleton migration.
