# Save Durability Rewrite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite movy's sequencer persistence so a set can never be silently lost — not by an engine reload, not by a torn write, not by closing the tool, not by a failed write, and not by a transient set-identity glitch.

**Architecture:** The write path gains an envelope (generation header + length/checksum trailer) and rotating shadow copies, so a truncated file is *detectable* and the previous generation always survives. The orchestrator gains an engine-generation guard, so the UI refuses to autosave an engine whose contents it did not put there. `persist.ts` is rewritten from scratch and split by responsibility; the on-disk `movy1` format stays readable by every existing build and existing files still load.

**Tech Stack:** TypeScript (`src/seq/`), esbuild device bundle, node-based `browser-test/*.mjs` suites. No Rust/engine changes — the two extra envelope lines are unknown verbs that `seq-core::persist::load` already skips.

## Global Constraints

- **No UI and no manual save.** Durability is automatic; nothing is added to any page, and no toast or indicator is introduced. (Explicit user decision, 2026-07-31.)
- **On-disk format stays backward compatible.** An existing `sets/<uuid>/seq-state.json` written by any shipped build must still load. The canonical path `sets/<uuid>/seq-state.json` keeps holding a blob whose first line is `movy1`.
- **Forward compatible too.** The envelope's `gen` and `end` lines must be lines `seq-core::persist::load` ignores, so an older movy build reading a new file still loads the set.
- **No new host APIs.** schwung exposes only `host_read_file` / `host_write_file` / `host_file_exists` / `host_ensure_dir` — no rename, no fsync, no unlink. Crash safety must be built on top of those four.
- **`src/` file size:** hard limit 200 lines, target 50–100.
- **No engine (`engine/`) changes.** `ENGINE_VERSION` does not move.
- Comments explain WHY, never WHAT.

---

## Background: the six failure paths

Established by investigation on 2026-07-31 (see `CHANGELOG.md` entry added in Task 7):

- **F1 — engine reload wipes the set.** `src/seq/engine.ts` re-`dlopen`s `dsp.so` after 16 lost `status` polls; the reload comes up as a brand-new empty `Engine`. `persist.ts`'s `loaded` flag stays `true`, so nothing re-pushes the set. The next edit sets `dirty` and the *empty* engine is serialized over the only copy of the file.
- **F2 — non-atomic, unsynced writes.** `host_write_file` is `fopen("w")+fwrite+fclose` (`schwung/src/host/js_host_common.c:373`). A crash mid-write leaves a truncated file, and `persist::load` accepts anything starting with `movy1` while ignoring unknown lines — so a torn file loads as a silently *partial* set.
- **F3 — nothing saves on exit.** `src/app/unload.ts` never calls a save; every exit drops up to one save interval (~3 s) of edits.
- **F4 — failed writes are lost forever.** `get_param('state')` clears the engine's dirty flag on read, and `host_write_file`'s boolean is discarded. A failed write is never retried.
- **F5 — transient set identity redirects writes.** `readActiveSet()` returns `{uuid:'',name:''}` for "missing", "unreadable" *and* "no set", so a glitch sends autosaves to `_default`; when the real UUID returns, the old file is reloaded and the interim work is discarded. Device evidence: a `sets/__pending-0-1/` directory, written while Move was creating a set under a placeholder id.
- **F6 — no feedback / no manual save.** Out of scope by decision; not implemented.

---

## File Structure

| File | Status | Responsibility | Approx. lines |
|---|---|---|---|
| `src/seq/persist-blob.ts` | **new** | Envelope format: `wrapState`, `parseState`, `adler32`. Pure, no host calls. | 75 |
| `src/seq/persist-store.ts` | **new** | Durable file I/O for one set: verified writes, shadow rotation, best-of read. | 100 |
| `src/seq/set-context.ts` | modify | Set identity (`readActiveSet` → `SetId \| null`), paths incl. shadow slots, name index. | 95 |
| `src/seq/set-inherit.ts` | **new** | Copy-family inheritance + `resolveState()`. Moved out of `set-context.ts`. | 85 |
| `src/seq/ui-state.ts` | **new** | UI blob serialize/apply/reset. Moved out of `persist.ts`. | 80 |
| `src/seq/persist.ts` | **rewrite** | Orchestration: tick, flush, set switch, engine-generation guard. | 140 |
| `src/seq/engine.ts` | modify | `engineGeneration()` counter, bumped on every entry into service. | +6 |
| `src/app/unload.ts` | modify | Flush on teardown. | +5 |
| `browser-test/mock-fs.mjs` | **new** | In-memory `host_*` filesystem that can fail and truncate writes. | 45 |
| `browser-test/logic.mjs` | modify | New persistence tests; update the ones asserting the old single-file layout. | — |

Import graph (no cycles): `persist.ts` → {`engine`, `state`, `ui-dirty`, `ui-state`, `set-context`, `set-inherit`, `persist-store`}; `set-inherit` → {`set-context`, `persist-store`, `persist-blob`}; `persist-store` → {`set-context`, `persist-blob`}; `persist-blob` → nothing.

---

### Task 1: The state envelope

**Files:**
- Create: `movy/src/seq/persist-blob.ts`
- Test: `movy/browser-test/logic.mjs` (new block)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `adler32(s: string): number`
  - `interface ParsedState { payload: string; gen: number }`
  - `wrapState(payload: string, gen: number): string`
  - `parseState(raw: string | null): ParsedState | null`

- [ ] **Step 1: Write the failing test**

Add near the other per-set state tests in `browser-test/logic.mjs` (after the
`Test: set-context paths…` block), and add the import at the top of the file:

```js
import { wrapState, parseState, adler32 } from '../dist/esm/seq/persist-blob.js';
```

```js
_log('\nTest: state envelope (truncation is detectable)');
{
    const payload = 'movy1\nbpm 12000\ncl 0 0 16 0 0:24:60:100\n';
    const wrapped = wrapState(payload, 7);

    eq('envelope keeps the movy1 tag first', wrapped.split('\n')[0], 'movy1');
    eq('generation marker is line 2', wrapped.split('\n')[1], 'gen 7');
    eq('round-trips the payload', parseState(wrapped).payload, payload);
    eq('round-trips the generation', parseState(wrapped).gen, 7);

    // A blank set is the smallest possible payload and must survive too.
    eq('blank payload round-trips', parseState(wrapState('movy1\n', 3)).payload, 'movy1\n');

    // Backward compat: a file written by any shipped build has no envelope.
    const legacy = 'movy1\nbpm 12000\n';
    eq('legacy blob still loads', parseState(legacy).payload, legacy);
    eq('legacy blob is generation 0', parseState(legacy).gen, 0);

    // The whole point: a torn write must be REJECTED, not loaded as a
    // partial set. `gen` survives at the top; the trailer does not.
    eq('torn envelope rejected', parseState(wrapped.slice(0, 30)), null);
    eq('missing trailer rejected', parseState('movy1\ngen 7\nbpm 12000\n'), null);
    eq('bad checksum rejected',
        parseState(wrapped.replace(/end (\d+) (\d+) \d+/, 'end $1 $2 12345678')), null);
    eq('bad length rejected',
        parseState(wrapped.replace(/end (\d+) \d+ /, 'end $1 999999 ')), null);

    eq('not a movy blob → null', parseState('garbage\n'), null);
    eq('null in → null out', parseState(null), null);

    eq('adler32 is stable', adler32('movy1\n'), adler32('movy1\n'));
    ok('adler32 discriminates', adler32('movy1\n') !== adler32('movy2\n'));
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd movy && npm run build:browser && node browser-test/logic.mjs
```
Expected: FAIL — `Cannot find module '.../dist/esm/seq/persist-blob.js'`.

- [ ] **Step 3: Write the implementation**

Create `movy/src/seq/persist-blob.ts`:

```ts
/* On-disk envelope around the engine's own state serialization.
 *
 * host_write_file is fopen("w") + fwrite + fclose — no temp-and-rename, no
 * fsync — so a crash or power-cut mid-write leaves a truncated file. The
 * engine's loader accepts any blob whose first line is "movy1" and skips lines
 * it doesn't recognise, which means a torn file used to load as a silently
 * *partial* set: some tracks present, the rest gone, no error anywhere.
 *
 *   movy1                       <- unchanged, so old builds still load us
 *   gen 42                      <- generation, at the TOP so truncation keeps it
 *   …engine payload…
 *   end 42 1850 2a1f3c04        <- generation, payload length, adler32
 *
 * `gen` and `end` are unknown verbs to seq-core's persist::load, which ignores
 * them, so the file stays loadable by every older movy build. A blob carrying
 * `gen` but no matching trailer is a torn write and is rejected; a blob with
 * neither line is a legacy file and is accepted as generation 0. Splitting the
 * marker (top) from the checksum (bottom) is what makes those two cases
 * distinguishable — without it a truncation deep in the payload is
 * indistinguishable from a pre-envelope file. */

const TAG = 'movy1';

/* Adler-32: short, dependency-free, and enough to catch the zero-filled tails
 * and short writes that a torn save actually produces. The payload is ASCII
 * (integers plus param keys), so charCodeAt doubles as the byte value. */
export function adler32(s: string): number {
    let a = 1, b = 0;
    for (let i = 0; i < s.length; i++) {
        a = (a + (s.charCodeAt(i) & 0xff)) % 65521;
        b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
}

export interface ParsedState {
    payload: string;   // exactly what the engine serialized / will be fed
    gen: number;       // envelope generation; higher wins when copies disagree
}

/** Envelope `payload` for generation `gen`. */
export function wrapState(payload: string, gen: number): string {
    const p = payload.endsWith('\n') ? payload : payload + '\n';
    const rest = p.slice(p.indexOf('\n') + 1);
    return TAG + '\ngen ' + gen + '\n' + rest
        + 'end ' + gen + ' ' + p.length + ' ' + adler32(p) + '\n';
}

/** Read an envelope back. `null` = unusable: wrong tag, or a torn write. */
export function parseState(raw: string | null): ParsedState | null {
    if (!raw) return null;
    const lines = raw.split('\n');
    if ((lines[0] || '').trim() !== TAG) return null;

    // No generation marker → written before the envelope existed. Trust it:
    // that is the only shape every currently-installed build produces.
    if (!(lines[1] || '').startsWith('gen ')) return { payload: raw, gen: 0 };

    const gen = Number(lines[1].slice(4).trim());
    if (!isFinite(gen)) return null;

    let last = lines.length - 1;
    while (last > 0 && lines[last] === '') last--;
    const tr = lines[last].split(' ');
    if (tr[0] !== 'end' || tr.length !== 4 || Number(tr[1]) !== gen) return null;

    const payload = TAG + '\n' + lines.slice(2, last).join('\n') + (last > 2 ? '\n' : '');
    if (payload.length !== Number(tr[2]) || adler32(payload) !== Number(tr[3])) return null;
    return { payload, gen };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd movy && npm run build:browser && node browser-test/logic.mjs
```
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add movy/src/seq/persist-blob.ts movy/browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
Add a state envelope so a torn save is detectable

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Verified writes and shadow rotation

**Files:**
- Create: `movy/browser-test/mock-fs.mjs`
- Create: `movy/src/seq/persist-store.ts`
- Modify: `movy/src/seq/set-context.ts` (add `shadowPath`, export `ensureDir`)
- Test: `movy/browser-test/logic.mjs` (new block)

**Interfaces:**
- Consumes: `wrapState`, `parseState`, `ParsedState` (Task 1); `uuidToStatePath`, `uuidToUiStatePath`, `ensureDir` (existing `set-context.ts`).
- Produces:
  - `shadowPath(uuid: string, slot: number): string` (in `set-context.ts`)
  - `safeWrite(path: string, content: string): boolean`
  - `readBestState(uuid: string): ParsedState | null`
  - `writeStateBlob(uuid: string, payload: string, gen: number): boolean`
  - `readUiBlob(uuid: string): string | null`
  - `writeUiBlob(uuid: string, content: string): boolean`
  - `resetStoreRotation(): void` (test hook)
  - `installMockFs(seed?): fs` / `uninstallMockFs()` (in `mock-fs.mjs`)

- [ ] **Step 1: Write the failing test**

Create `movy/browser-test/mock-fs.mjs`:

```js
/* In-memory stand-in for the device's host_* file API. Persistence tests need
 * to crash, truncate and fail writes on demand — none of which a real device
 * will do to order — so the whole filesystem is a plain object here. */

export function installMockFs(seed = {}) {
    const files = { ...seed };
    const fs = {
        files,
        /* path substring whose writes should fail, or true for every write */
        failWrites: null,
        /* { path: substring, at: n } — write only the first n chars, and still
         * report success: this is exactly what a power-cut mid-fwrite looks
         * like from JS. */
        truncate: null,
        writes: [],
    };
    globalThis.host_read_file = (p) => (p in files ? files[p] : null);
    globalThis.host_write_file = (p, c) => {
        fs.writes.push(p);
        if (fs.failWrites === true || (fs.failWrites && p.includes(fs.failWrites))) return false;
        if (fs.truncate && p.includes(fs.truncate.path)) {
            files[p] = c.slice(0, fs.truncate.at);
            return true;
        }
        files[p] = c;
        return true;
    };
    globalThis.host_file_exists = (p) => p in files;
    globalThis.host_ensure_dir = () => true;
    return fs;
}

export function uninstallMockFs() {
    delete globalThis.host_write_file;
    delete globalThis.host_file_exists;
    delete globalThis.host_ensure_dir;
    globalThis.host_read_file = () => null;   // logic.mjs's default stub
}
```

Add to `browser-test/logic.mjs` (imports at top):

```js
import { installMockFs, uninstallMockFs } from './mock-fs.mjs';
import {
    safeWrite, readBestState, writeStateBlob, resetStoreRotation,
} from '../dist/esm/seq/persist-store.js';
import { shadowPath } from '../dist/esm/seq/set-context.js';
```

```js
_log('\nTest: durable store (rotation + verified writes)');
{
    const fs = installMockFs();
    resetStoreRotation();
    const canon = uuidToStatePath('S');

    // A save lands in both a shadow slot and the canonical path, newest first
    // in the shadow so the canonical still holds the previous generation until
    // the shadow has verified.
    ok('gen 1 write reported durable', writeStateBlob('S', 'movy1\nbpm 12000\n', 1));
    eq('canonical holds gen 1', readBestState('S').gen, 1);
    eq('shadow 1 holds gen 1', parseState(fs.files[shadowPath('S', 1)]).gen, 1);

    // The next save rotates to the other slot, so slot 1 keeps generation 1.
    ok('gen 2 write reported durable', writeStateBlob('S', 'movy1\nbpm 14000\n', 2));
    eq('shadow 1 still holds gen 1', parseState(fs.files[shadowPath('S', 1)]).gen, 1);
    eq('shadow 2 holds gen 2', parseState(fs.files[shadowPath('S', 2)]).gen, 2);
    eq('best-of read picks the newest', readBestState('S').payload, 'movy1\nbpm 14000\n');

    // The crash case: the canonical file is torn. The set must come back from
    // a shadow instead of loading as a partial set or as blank.
    fs.files[canon] = fs.files[canon].slice(0, 12);
    eq('torn canonical falls back to a shadow', readBestState('S').payload, 'movy1\nbpm 14000\n');
    eq('fallback keeps the generation', readBestState('S').gen, 2);

    // Every copy torn → nothing loadable, and the caller must be told so it
    // can fall back rather than silently start from a partial set.
    fs.files[shadowPath('S', 1)] = 'movy1\ngen 1\nbp';
    fs.files[shadowPath('S', 2)] = 'movy1\ngen 2\nbp';
    eq('all copies torn → null', readBestState('S'), null);

    // A write the host rejects must be reported, not swallowed.
    fs.failWrites = true;
    eq('failed write reported', writeStateBlob('S', 'movy1\nbpm 9000\n', 3), false);
    fs.failWrites = null;

    // A write that lies — reports success but stores a short file — is caught
    // by reading it back. This is the failure class fsync would cover and we
    // cannot: at least we refuse to call it saved.
    fs.truncate = { path: 'seq-state', at: 8 };
    eq('short write caught by read-back', writeStateBlob('S', 'movy1\nbpm 9000\n', 4), false);
    fs.truncate = null;

    eq('safeWrite verifies content', safeWrite(canon, 'hello'), true);
    fs.failWrites = true;
    eq('safeWrite reports host failure', safeWrite(canon, 'nope'), false);
    fs.failWrites = null;

    uninstallMockFs();
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd movy && npm run build:browser && node browser-test/logic.mjs
```
Expected: FAIL — `persist-store.js` not found.

- [ ] **Step 3: Write the implementation**

In `movy/src/seq/set-context.ts`, add next to the existing path helpers and
change `ensureDir` to be exported:

```ts
/* Rotating shadow copies of the state file. The canonical seq-state.json is
 * what older builds read; these two exist only so a torn canonical write never
 * costs more than the generation being written. */
export function shadowPath(uuid: string, slot: number): string {
    return SETS_DIR + '/' + (uuid || '_default') + '/seq-state.' + slot + '.json';
}

export function ensureDir(uuid: string): void {
    if (typeof host_ensure_dir === 'function') host_ensure_dir(SETS_DIR + '/' + uuid);
}
```

(Delete the old private `ensureDir`; keep the single exported one.)

Create `movy/src/seq/persist-store.ts`:

```ts
/* Durable file I/O for one set's state.
 *
 * Two things the old single-file writer could not do:
 *
 *  - Survive a torn write. schwung gives JS no rename and no fsync, so the
 *    substitute is redundancy: each save goes to one of two rotating shadow
 *    slots first and to the canonical seq-state.json last. Whatever the crash
 *    interrupts, a complete older copy is still on disk, and the envelope's
 *    checksum is what tells the two apart at load time.
 *
 *  - Notice a failed write. host_write_file's boolean was discarded while the
 *    engine had already cleared its dirty flag on the state read, so a write
 *    that failed was lost for good and nothing ever asked for it again. Every
 *    write is now read straight back and compared. That is not fsync — it
 *    cannot prove the bytes reached flash — but it does catch what the host
 *    API can actually go wrong with: ENOSPC, EACCES and short writes. */

import { wrapState, parseState, ParsedState } from './persist-blob.js';
import { ensureDir, shadowPath, uuidToStatePath, uuidToUiStatePath } from './set-context.js';

function readFile(path: string): string | null {
    return (typeof host_read_file === 'function') ? host_read_file(path) : null;
}

/** Write and confirm. `false` means the caller must keep the data pending. */
export function safeWrite(path: string, content: string): boolean {
    if (typeof host_write_file !== 'function') return false;
    if (!host_write_file(path, content)) return false;
    return readFile(path) === content;
}

/* Which shadow slot the next save uses. Reset per set: starting a new set at
 * slot 1 can only overwrite an older generation, which is always safe. */
let slotUuid = '';
let nextSlot = 1;

export function resetStoreRotation(): void {
    slotUuid = '';
    nextSlot = 1;
}

/** Persist `payload` at generation `gen`. `false` = not durable anywhere. */
export function writeStateBlob(uuid: string, payload: string, gen: number): boolean {
    ensureDir(uuid);
    if (uuid !== slotUuid) { slotUuid = uuid; nextSlot = 1; }

    const wrapped = wrapState(payload, gen);
    if (!safeWrite(shadowPath(uuid, nextSlot), wrapped)) return false;
    nextSlot = nextSlot === 1 ? 2 : 1;

    /* The canonical path is written last because until it lands it still holds
     * the previous generation — the one thing worth protecting. Its failure is
     * not fatal: the shadow already verified, so the state IS durable and
     * readBestState will find it. Report success and let the next save retry. */
    safeWrite(uuidToStatePath(uuid), wrapped);
    return true;
}

/** The newest intact copy of `uuid`'s state, or null if none survives. */
export function readBestState(uuid: string): ParsedState | null {
    let best: ParsedState | null = null;
    // Canonical first, so an equal generation resolves to it.
    for (const p of [uuidToStatePath(uuid), shadowPath(uuid, 1), shadowPath(uuid, 2)]) {
        const c = parseState(readFile(p));
        if (c && (!best || c.gen > best.gen)) best = c;
    }
    return best;
}

/* The UI blob (tonic, scale, layout, octaves, mutes) is deliberately NOT
 * rotated: it is JSON, so an envelope would break `JSON.parse` for older
 * builds, and a torn one costs the user their scale and mutes rather than
 * their music — applyUiState already falls back to defaults. It does get the
 * verified write, so a failed save is still retried. */
export function readUiBlob(uuid: string): string | null {
    return readFile(uuidToUiStatePath(uuid));
}

export function writeUiBlob(uuid: string, content: string): boolean {
    ensureDir(uuid);
    return safeWrite(uuidToUiStatePath(uuid), content);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd movy && npm run build:browser && node browser-test/logic.mjs
```
Expected: PASS, 0 failures. (Tests of `resolveStateBlob` / `switchToSet` still
pass at this point — nothing has been rewired yet.)

- [ ] **Step 5: Commit**

```bash
git add movy/src/seq/persist-store.ts movy/src/seq/set-context.ts \
        movy/browser-test/mock-fs.mjs movy/browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
Verify every state write and keep rotating shadow copies

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Set identity that admits it doesn't know

**Files:**
- Modify: `movy/src/seq/set-context.ts` (`readActiveSet`, remove the inherit half)
- Create: `movy/src/seq/set-inherit.ts`
- Modify: `movy/browser-test/logic.mjs` (update the two blocks that import the moved symbols)
- Test: `movy/browser-test/logic.mjs`

**Interfaces:**
- Consumes: `readBestState`, `writeStateBlob`, `writeUiBlob`, `readUiBlob` (Task 2).
- Produces:
  - `interface SetId { uuid: string; name: string }` (in `set-context.ts`)
  - `readActiveSet(): SetId | null`
  - `stripCopySuffix`, `findInheritCandidates` — unchanged signatures, now in `set-inherit.ts`
  - `resolveState(uuid: string, name: string): { payload: string; gen: number }` (in `set-inherit.ts`)
  - `BLANK_STATE` stays exported from `set-context.ts`

- [ ] **Step 1: Write the failing test**

In `browser-test/logic.mjs`, replace the assertion
`eq('missing active_set → empty uuid', readActiveSet().uuid, '');` with the
block below, and change the two inherit assertions that call `resolveStateBlob`
to call `resolveState(...).payload`:

```js
    // "Unknown" must be distinguishable from "a set called ''". Movy follows
    // active_set.txt; a transient unreadable file used to resolve to the
    // `_default` set and quietly redirect every autosave there.
    delete fs['/data/UserData/schwung/active_set.txt'];
    eq('missing active_set → null', readActiveSet(), null);

    fs['/data/UserData/schwung/active_set.txt'] = '\n\n';
    eq('empty active_set → null', readActiveSet(), null);

    // Move reports a placeholder id while a set is being created. A device in
    // the wild ended up with a whole sets/__pending-0-1/ directory this way.
    fs['/data/UserData/schwung/active_set.txt'] = '__pending-0-1\nNew Set\n';
    eq('placeholder set id → null', readActiveSet(), null);

    fs['/data/UserData/schwung/active_set.txt'] = 'abc-123\nMy Song\n';
    eq('real uuid still resolves', readActiveSet().uuid, 'abc-123');
```

And update the imports at the top of `logic.mjs`:

```js
import {
    readActiveSet, uuidToStatePath, uuidToUiStatePath, shadowPath,
    loadNameIndex, rememberSet, BLANK_STATE,
} from '../dist/esm/seq/set-context.js';
import {
    stripCopySuffix, findInheritCandidates, resolveState,
} from '../dist/esm/seq/set-inherit.js';
```

In the inherit block, replace the three `resolveStateBlob` / `resolveUiBlob`
assertions with:

```js
    const st = resolveState('c-uuid', 'My Song Copy');
    eq('inherited state payload', st.payload, 'movy1\nbpm 12000\n');
    eq('seeded copy starts at generation 1', st.gen, 1);
    eq('copy seeded into dst state file', readBestState('c-uuid').payload, 'movy1\nbpm 12000\n');
    eq('copy seeded dst ui file', readUiBlob('c-uuid'), '{"root":50,"scale":1}');

    // Unknown brand-new set with no family → blank.
    eq('unknown set → blank', resolveState('z-uuid', 'Fresh').payload, 'movy1\n');

    // A set that already has its own state returns it (no inherit).
    fs[stPath('own')] = 'movy1\nswing 60\n';
    eq('own state wins', resolveState('own', 'Whatever').payload, 'movy1\nswing 60\n');
```

Add `readBestState, readUiBlob` to the `persist-store.js` import added in Task 2.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd movy && npm run build:browser && node browser-test/logic.mjs
```
Expected: FAIL — `set-inherit.js` not found.

- [ ] **Step 3: Write the implementation**

In `movy/src/seq/set-context.ts`: delete `stripCopySuffix`,
`escapeRegex`, `findInheritCandidates`, `copyStateFiles`, `resolveStateBlob`,
`resolveUiBlob`, `writeStateFile`, `writeUiFile` and the private `readFile`
users they needed; keep `SETS_DIR`, `NAME_INDEX`, `ACTIVE_SET`,
`MOVE_SETS_DIR`, `BLANK_STATE`, the path helpers, `ensureDir`, `shadowPath`,
the name index, and replace `readActiveSet` with:

```ts
export interface SetId { uuid: string; name: string; }

/* The active set, or `null` when we genuinely don't know which set is active:
 * active_set.txt missing, unreadable, or naming one of Move's transient
 * placeholder ids (a set being created shows up as `__pending-0-1` for a
 * moment). Callers must treat null as "keep the set we already have" and never
 * as a set of its own — the old reader collapsed all three cases to
 * {uuid:''}, which pointed every autosave at the `_default` set and threw the
 * work away when the real uuid reappeared. */
export function readActiveSet(): SetId | null {
    const raw = readFile(ACTIVE_SET);
    if (!raw) return null;
    const lines = raw.split('\n');
    const uuid = (lines[0] || '').trim();
    if (!uuid || uuid.startsWith('__')) return null;
    return { uuid, name: (lines[1] || '').trim() };
}
```

Keep `readFile` / `writeFile` private helpers and `fileExists` exported (the
inherit module needs it):

```ts
export function fileExists(path: string): boolean {
    if (typeof host_file_exists === 'function') return host_file_exists(path);
    const d = readFile(path);            // fallback: non-empty read == exists
    return d !== null && d.length > 0;
}
```

Create `movy/src/seq/set-inherit.ts`:

```ts
/* Copy-on-inherit: Move's Copy/Paste makes a new set whose movy state doesn't
 * exist yet, and a user copying a set expects their sequence to come with it.
 * A copy is recognised by name ("X Copy", "X Copy 2") and seeded from the
 * best-matching family member that still has both a state file and a live
 * Move set. */

import { BLANK_STATE, MOVE_SETS_DIR, fileExists, loadNameIndex, uuidToStatePath } from './set-context.js';
import { readBestState, readUiBlob, writeStateBlob, writeUiBlob } from './persist-store.js';

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
 * Excludes the queried name so it never offers a no-op self-inherit. */
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
        // The canonical path is always written, so it alone answers "has state".
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

/* The state to load for `uuid`: its own newest intact copy → best-match
 * inherit (seeded onto disk so the copy owns it from here on) → blank. The
 * generation comes back with it so the next save continues the sequence
 * instead of restarting at 1 and losing to a stale higher-numbered copy. */
export function resolveState(uuid: string, name: string): { payload: string; gen: number } {
    const own = readBestState(uuid);
    if (own) return own;

    const cands = findInheritCandidates(name, loadNameIndex());
    if (cands.length > 0) {
        const src = readBestState(cands[0].uuid);
        if (src && writeStateBlob(uuid, src.payload, 1)) {
            const ui = readUiBlob(cands[0].uuid);
            if (ui) writeUiBlob(uuid, ui);
            return { payload: src.payload, gen: 1 };
        }
    }
    return { payload: BLANK_STATE, gen: 0 };
}
```

Export `MOVE_SETS_DIR` from `set-context.ts` (it is currently private).

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd movy && npm run build:browser && node browser-test/logic.mjs
```
Expected: the envelope, store, set-context and inherit blocks PASS. The
`switchToSet save-then-load orchestration` block is expected to FAIL here —
`persist.ts` still calls the removed `resolveStateBlob`; Task 5 rewrites it.
Confirm `npm run typecheck` reports the same, and nothing else.

- [ ] **Step 5: Commit** (after Task 5 makes the suite green — this task is a
  mid-refactor state; do not commit a red suite. Skip to Task 4.)

---

### Task 4: Engine generation counter

**Files:**
- Modify: `movy/src/seq/engine.ts`
- Test: `movy/browser-test/logic.mjs` (new block)

**Interfaces:**
- Consumes: nothing.
- Produces: `engineGeneration(): number` — bumped every time the engine enters
  service, so a reload is observable.

- [ ] **Step 1: Write the failing test**

```js
_log('\nTest: engine generation tracks reloads');
{
    const { resetSeqEngine, seqEngineTick, engineReady, engineGeneration } =
        await import('../dist/esm/seq/engine.js');
    const { resetSeqState } = await import('../dist/esm/seq/state.js');
    const { installMockEngine, uninstallMockEngine } = await import('./mock-engine.mjs');

    const eng = installMockEngine();
    resetSeqEngine(); resetSeqState();
    eq('generation starts at 0', engineGeneration(), 0);

    seqEngineTick();                       // probe → ping ok
    ok('engine ready', engineReady());
    eq('first boot is generation 1', engineGeneration(), 1);

    // The engine wedges: 16 lost status polls send engine.ts back to probing,
    // and the probe re-dlopens dsp.so. Whatever comes back is a NEW engine.
    eng.statusUnavailable = true;
    for (let i = 0; i < 8 * 20; i++) seqEngineTick();
    eng.statusUnavailable = false;
    for (let i = 0; i < 8; i++) seqEngineTick();
    ok('engine ready again', engineReady());
    eq('reload is a new generation', engineGeneration(), 2);

    uninstallMockEngine(); resetSeqEngine(); resetSeqState();
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd movy && npm run build:browser && node browser-test/logic.mjs
```
Expected: FAIL — `engineGeneration is not a function`.

- [ ] **Step 3: Write the implementation**

In `movy/src/seq/engine.ts`, next to `bootState`:

```ts
/* Bumped every time the engine enters service. A re-dlopen after a wedge comes
 * up as a brand new, EMPTY Engine; persist.ts compares this against the
 * generation whose contents it authored, so it can never autosave over a set
 * with an engine it did not restore. */
let generation = 0;
export function engineGeneration(): number { return generation; }
```

In `probeTick()`, immediately after `bootState = 'ok';`:

```ts
        generation++;
```

In `resetSeqEngine()`, add:

```ts
    generation = 0;
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd movy && npm run build:browser && node browser-test/logic.mjs
```
Expected: the generation block PASSES (`switchToSet` block still red from Task 3).

- [ ] **Step 5: Commit** (deferred to Task 5 — the suite is mid-refactor.)

---

### Task 5: Rewrite the orchestrator

**Files:**
- Create: `movy/src/seq/ui-state.ts`
- Rewrite: `movy/src/seq/persist.ts`
- Modify: `movy/browser-test/logic.mjs` (rewrite the two persistence blocks)
- Test: `movy/browser-test/logic.mjs`

**Interfaces:**
- Consumes: `engineGeneration` (Task 4); `readBestState`, `writeStateBlob`,
  `readUiBlob`, `writeUiBlob`, `resetStoreRotation` (Task 2); `resolveState`
  (Task 3); `readActiveSet`, `rememberSet` (Task 3).
- Produces:
  - `seqPersistTick(): void`, `seqPersistFlush(): void`
  - `switchToSet(uuid: string, name: string, saveOld: boolean): void`
  - `currentSetUuid(): string`, `markUiStateDirty` (re-export), `resetSeqPersist()`
  - `serializeUiState()`, `applyUiState(blob)`, `resetUiState()` (in `ui-state.ts`)

- [ ] **Step 1: Write the failing test**

Replace the `seq persistence:` block in `logic.mjs` with:

```js
/* ── seq persistence ─────────────────────────────────────────────────────── */
{
    _log('\nseq persistence:');
    const { installMockEngine, uninstallMockEngine } = await import('./mock-engine.mjs');
    const { seqEngineTick, resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const { seqPersistTick, seqPersistFlush, resetSeqPersist, currentSetUuid } =
        await import('../dist/esm/seq/persist.js');

    const ACTIVE = '/data/UserData/schwung/active_set.txt';
    const SAVED  = 'movy1\nbpm 14000\ncl 0 0 16 0 0:24:60:100\n';
    const EDITED = 'movy1\nbpm 14000\ncl 0 0 32 0 0:24:62:110\n';
    const BLANK  = 'movy1\n';

    const boot = (files) => {
        const fs = installMockFs(files);
        const eng = installMockEngine();
        resetSeqEngine(); resetSeqState(); resetSeqPersist(); resetStoreRotation();
        seqEngineTick();     // probe → ready, generation 1
        seqPersistTick();    // first ready tick → resolve the set and restore
        return { fs, eng };
    };
    const teardown = () => {
        uninstallMockEngine(); uninstallMockFs();
        resetSeqEngine(); resetSeqState(); resetSeqPersist(); resetStoreRotation();
    };

    // Restore: the set named by active_set.txt is pushed into the engine.
    {
        const { fs, eng } = boot({ [ACTIVE]: 'S1\nSong One\n', [uuidToStatePath('S1')]: SAVED });
        eq('restored the active set', eng.stateBlob, SAVED);
        eq('tracking the active set', currentSetUuid(), 'S1');
        teardown();
    }

    // Autosave writes an envelope that reads back as the engine's payload.
    {
        const { fs, eng } = boot({ [ACTIVE]: 'S1\nSong One\n', [uuidToStatePath('S1')]: SAVED });
        eng.stateBlob = EDITED;
        seqState.dirty = true;
        for (let i = 0; i < 700; i++) seqPersistTick();
        eq('autosaved the edited state', readBestState('S1').payload, EDITED);
        eq('dirty cleared after save', seqState.dirty, false);

        // Clean → no further writes.
        const before = fs.writes.length;
        for (let i = 0; i < 700; i++) seqPersistTick();
        eq('no write when clean', fs.writes.length, before);
        teardown();
    }

    /* F1 — the destructive one. engine.ts re-dlopens dsp.so after a wedge and
     * the new engine has NO clips. The UI must restore into it and must not
     * write that blank engine over the set. Delete the generation guard in
     * persist.ts and this fails: the file becomes "movy1\n". */
    {
        const { fs, eng } = boot({ [ACTIVE]: 'S1\nSong One\n', [uuidToStatePath('S1')]: SAVED });
        eq('sanity: set restored', eng.stateBlob, SAVED);

        eng.statusUnavailable = true;
        for (let i = 0; i < 8 * 20; i++) { seqEngineTick(); seqPersistTick(); }
        eng.statusUnavailable = false;
        eng.stateBlob = BLANK;                 // the reloaded DSP is empty
        for (let i = 0; i < 8; i++) seqEngineTick();

        seqState.dirty = true;                 // an edit lands on the new engine
        for (let i = 0; i < 700; i++) seqPersistTick();

        eq('engine restored from disk after reload', eng.stateBlob, SAVED);
        eq('blank engine never overwrote the set', readBestState('S1').payload, SAVED);
        teardown();
    }

    /* F4 — a failed write must stay pending. The engine clears its own dirty
     * flag on the state read, so if the UI drops it nothing ever asks again. */
    {
        const { fs, eng } = boot({ [ACTIVE]: 'S1\nSong One\n', [uuidToStatePath('S1')]: SAVED });
        eng.stateBlob = EDITED;
        seqState.dirty = true;
        fs.failWrites = 'seq-state';
        for (let i = 0; i < 700; i++) seqPersistTick();
        eq('failed save did not corrupt the file', readBestState('S1').payload, SAVED);

        fs.failWrites = null;
        seqState.dirty = false;                // engine says clean; UI must retry anyway
        for (let i = 0; i < 700; i++) seqPersistTick();
        eq('failed save retried once writes work', readBestState('S1').payload, EDITED);
        teardown();
    }

    /* F5 — active_set.txt going unreadable must not move us to `_default`. */
    {
        const { fs, eng } = boot({ [ACTIVE]: 'S1\nSong One\n', [uuidToStatePath('S1')]: SAVED });
        delete fs.files[ACTIVE];
        eng.stateBlob = EDITED;
        seqState.dirty = true;
        for (let i = 0; i < 700; i++) seqPersistTick();
        eq('still on the same set', currentSetUuid(), 'S1');
        eq('edit saved to the real set', readBestState('S1').payload, EDITED);
        eq('nothing written to _default', readBestState(''), null);

        // A placeholder id is equally "unknown".
        fs.files[ACTIVE] = '__pending-0-1\nNew Set\n';
        for (let i = 0; i < 200; i++) seqPersistTick();
        eq('placeholder id ignored', currentSetUuid(), 'S1');
        teardown();
    }

    /* F3 — closing movy flushes instead of dropping the last edits. */
    {
        const { fs, eng } = boot({ [ACTIVE]: 'S1\nSong One\n', [uuidToStatePath('S1')]: SAVED });
        eng.stateBlob = EDITED;
        seqState.dirty = true;
        seqPersistFlush();                     // what onUnload calls
        eq('flush persisted immediately', readBestState('S1').payload, EDITED);
        teardown();
    }

    /* Generations continue across sessions, so a save never loses to a stale
     * higher-numbered copy left behind by an earlier run. */
    {
        const { fs, eng } = boot({ [ACTIVE]: 'S1\nSong One\n', [uuidToStatePath('S1')]: SAVED });
        eng.stateBlob = EDITED;
        seqState.dirty = true;
        for (let i = 0; i < 700; i++) seqPersistTick();
        const genAfterFirstRun = readBestState('S1').gen;
        const files = { ...fs.files };
        teardown();

        const second = boot(files);
        second.eng.stateBlob = 'movy1\nbpm 15000\n';
        seqState.dirty = true;
        for (let i = 0; i < 700; i++) seqPersistTick();
        ok('generation kept climbing', readBestState('S1').gen > genAfterFirstRun);
        eq('newest wins', readBestState('S1').payload, 'movy1\nbpm 15000\n');
        teardown();
    }

    globalThis.host_read_file = () => null;    // restore the default test stub
}
```

Update the `switchToSet save-then-load orchestration` block to install the
mock fs and seed `active_set.txt`-free direct calls (it calls `switchToSet`
directly, so only the file assertions change):

```js
    eq('A saved before B load', readBestState('A').payload, 'movy1\nbpm 13000\nEDITED\n');
```

And update the `automation: restore re-requests label sync` block's `PATH` to
`uuidToStatePath('')` (it seeds a file for the `_default` set) plus seed
`active_set.txt` absent so the boot falls through the unknown-set grace:

```js
    files[ACTIVE] = 'LS1\nLabel Set\n';
    files[uuidToStatePath('LS1')] = 'movy1\nau 0 0 100 synth:cutoff\n';
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd movy && npm run build:browser && node browser-test/logic.mjs
```
Expected: FAIL — `seqPersistFlush is not a function`, plus the Task-3 breakage.

- [ ] **Step 3: Write the implementation**

Create `movy/src/seq/ui-state.ts` by moving `serializeUiState`, `applyUiState`,
`resetUiState` and `clampInt` out of the old `persist.ts` verbatim (same
imports: `keyboardState`, `OCT_MIN`, `OCT_MAX`, `MODE_NAMES`, `layoutNames`,
`SCALES`, `mutesSnapshot`, `restoreMutes`, `resetTrackMutes`). Keep their
existing comments. Nothing about their behaviour changes.

Replace `movy/src/seq/persist.ts` entirely with:

```ts
/* Per-set autosave / restore of the sequencer state (davebox pattern: the
 * engine can't touch the filesystem, so the UI ferries the serialized state
 * through host_read_file / host_write_file).
 *
 * State is keyed by the active Move set's UUID, so each set recalls an
 * independent movy project — aligned with how schwung stores tracks per set.
 *
 * Two invariants keep a set from being lost, and everything here exists to
 * hold them:
 *
 *  1. Never persist an engine we did not restore. seq/engine.ts re-dlopens
 *     dsp.so when the engine stops answering, and the reload comes up EMPTY.
 *     Autosave is muted until the generation we last pushed into matches the
 *     engine's current one.
 *  2. Never drop a write. host_module_get_param('state') clears the engine's
 *     own dirty flag as a side effect of the read, so a write we fail to
 *     complete is one nothing will ever ask us for again — hence saveRetry,
 *     which outlives the engine-sourced dirty mirror. */

import { mlog } from '../log.js';
import { engineReady, engineGeneration, requestLabelSync } from './engine.js';
import { seqState } from './state.js';
import { markUiStateDirty, takeUiDirty, clearUiDirty } from './ui-dirty.js';
import { serializeUiState, applyUiState, resetUiState } from './ui-state.js';
import { readActiveSet, rememberSet } from './set-context.js';
import { readUiBlob, writeStateBlob, writeUiBlob } from './persist-store.js';
import { resolveState } from './set-inherit.js';

const SAVE_TICKS = 600;       // ~3s autosave cadence at the ~205 Hz device rate
const SET_POLL_TICKS = 96;    // ~0.5s: catch native set switches (incl. on resume)
const UNKNOWN_SET_POLLS = 20; // ~10s of no active_set.txt before using _default

let saveCountdown = SAVE_TICKS;
let setPollCountdown = 1;     // resolve the set on the first ready tick
let unknownPolls = 0;
let curUuid: string | null = null;  // null = which set is active is still unknown
let lastGoodPayload = '';     // newest payload known durable for curUuid
let savedGen = 0;             // envelope generation of lastGoodPayload
let restoredGen = -1;         // engine generation whose contents we authored
let saveRetry = false;        // a write failed; retry regardless of the engine

export { markUiStateDirty };
export function currentSetUuid(): string { return curUuid || ''; }

function filesAvailable(): boolean {
    return typeof host_read_file === 'function' && typeof host_write_file === 'function';
}

/* Push a payload into the live engine and record that this engine generation
 * now holds state we authored — the gate the autosave checks. */
function pushToEngine(payload: string): void {
    if (typeof host_module_set_param_blocking === 'function')
        host_module_set_param_blocking('state', payload, 200);
    // Restore carries the lane labels/assignments; re-request the label sync so
    // the automation registry reflects the just-loaded set (otherwise the UI
    // registry stays empty — no dot, no held value, no read-back suppression).
    requestLabelSync();
    lastGoodPayload = payload;
    restoredGen = engineGeneration();
    seqState.dirty = false;
    saveRetry = false;
}

/* Read the engine's state and persist it under `uuid`. */
function saveState(uuid: string): boolean {
    if (typeof host_module_get_param !== 'function') return false;
    const payload = host_module_get_param('state');
    if (payload === null) return false;
    if (payload === lastGoodPayload) return true;   // unchanged → spare the flash
    if (!writeStateBlob(uuid, payload, savedGen + 1)) return false;
    lastGoodPayload = payload;
    savedGen++;
    return true;
}

/* Persist everything dirty for the current set. Shared by the autosave tick,
 * the set switch and onUnload — closing movy used to drop up to a full save
 * interval of edits on the floor. */
export function seqPersistFlush(): void {
    if (curUuid === null || !filesAvailable()) return;
    if (engineGeneration() !== restoredGen) return;   // not our engine — see the tick

    if (takeUiDirty() && !writeUiBlob(curUuid, serializeUiState())) markUiStateDirty();

    if (!seqState.dirty && !saveRetry) return;
    if (saveState(curUuid)) {
        saveRetry = false;
        mlog('seq: saved ' + lastGoodPayload.length + ' bytes (gen ' + savedGen + ')');
    } else {
        saveRetry = true;
        mlog('seq: SAVE FAILED — retrying');
    }
}

/* Optionally save the outgoing set, then load the incoming set's engine + UI
 * state into the live engine. */
export function switchToSet(uuid: string, name: string, saveOld: boolean): void {
    if (saveOld && curUuid !== null && curUuid !== uuid) seqPersistFlush();

    const st = resolveState(uuid, name);
    curUuid = uuid;
    savedGen = st.gen;
    pushToEngine(st.payload);

    const ui = readUiBlob(uuid);
    if (ui && ui.length > 0) applyUiState(ui);
    else resetUiState();

    rememberSet(name, uuid);
    clearUiDirty();
}

/* Returns true when the set changed, so the caller skips the save this tick. */
function pollActiveSet(): boolean {
    const id = readActiveSet();
    if (!id) {
        /* Unknown → keep whatever set we have. Only a boot that never sees a
         * real uuid falls back to _default, so movy still persists on a device
         * with no native set rather than waiting forever. */
        if (curUuid === null && ++unknownPolls >= UNKNOWN_SET_POLLS) {
            switchToSet('', '', false);
            mlog('seq: no active set — using _default');
            return true;
        }
        return false;
    }
    if (id.uuid === curUuid) return false;
    const first = curUuid === null;
    switchToSet(id.uuid, id.name, !first);
    mlog('seq: ' + (first ? 'loaded' : 'switched to') + ' set ' + id.uuid);
    return true;
}

export function seqPersistTick(): void {
    if (!engineReady() || !filesAvailable()) return;

    /* An engine we did not restore is an EMPTY engine. Restoring before
     * anything else — and refusing to save until we have — is what stops a
     * wedged engine's reload from overwriting the set with a blank one. */
    if (curUuid !== null && engineGeneration() !== restoredGen) {
        pushToEngine(lastGoodPayload);
        mlog('seq: engine reloaded — restored ' + lastGoodPayload.length + ' bytes');
        return;
    }

    if (--setPollCountdown <= 0) {
        setPollCountdown = SET_POLL_TICKS;
        if (pollActiveSet()) return;
    }
    if (curUuid === null) return;

    if (--saveCountdown > 0) return;
    saveCountdown = SAVE_TICKS;
    seqPersistFlush();
}

/* Test hook. */
export function resetSeqPersist(): void {
    saveCountdown = SAVE_TICKS;
    setPollCountdown = 1;
    unknownPolls = 0;
    curUuid = null;
    lastGoodPayload = '';
    savedGen = 0;
    restoredGen = -1;
    saveRetry = false;
    clearUiDirty();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd movy && npm run build:browser && npm run typecheck && node browser-test/logic.mjs
```
Expected: 0 failures, 0 type errors.

- [ ] **Step 5: Prove the F1 test has teeth**

Temporarily delete the `engineGeneration() !== restoredGen` guard block from
`seqPersistTick`, rebuild, and re-run. Expected: the F1 block FAILS with
`blank engine never overwrote the set`. Restore the guard and re-run: PASS.

- [ ] **Step 6: Commit**

```bash
git add movy/src/seq/persist.ts movy/src/seq/ui-state.ts movy/src/seq/set-context.ts \
        movy/src/seq/set-inherit.ts movy/src/seq/engine.ts movy/browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
Rewrite sequencer persistence around a generation guard

Never autosave an engine the UI did not restore: a wedged engine's reload comes
up empty and used to be written straight over the set. Set identity now
distinguishes "unknown" from "_default", and failed writes stay pending instead
of being dropped along with the engine's dirty flag.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Flush on teardown

**Files:**
- Modify: `movy/src/app/unload.ts`
- Test: `movy/browser-test/app-loop.mjs`

**Interfaces:**
- Consumes: `seqPersistFlush` (Task 5).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Append to `movy/browser-test/app-loop.mjs` (follow the file's existing harness
setup; it already installs the mock engine and drives `init`/`tick`):

```js
/* Closing movy must persist. The autosave runs every ~3 s, so without this
 * every exit silently discarded whatever was done since the last one. */
{
    _log('\nunload flushes pending state:');
    const { onUnload } = await import('../dist/esm/app/unload.js');
    const { seqState } = await import('../dist/esm/seq/state.js');
    const { readBestState } = await import('../dist/esm/seq/persist-store.js');
    const { uuidToStatePath } = await import('../dist/esm/seq/set-context.js');

    const EDITED = 'movy1\nbpm 15500\ncl 0 0 16 0 0:24:64:100\n';
    engine.stateBlob = EDITED;
    seqState.dirty = true;
    onUnload();
    eq('unload persisted the pending state', readBestState(SET_UUID).payload, EDITED);
}
```

Where `engine` / `SET_UUID` are the mock engine and the set uuid the file's
harness already booted with; if `app-loop.mjs` does not yet install a mock
filesystem, install one with `installMockFs({ [ACTIVE]: 'AL1\nApp Loop\n' })`
at the top of the file and use `'AL1'` as `SET_UUID`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd movy && npm run build:browser && node browser-test/app-loop.mjs
```
Expected: FAIL — `readBestState(...)` is null; `onUnload` never saved.

- [ ] **Step 3: Write the implementation**

In `movy/src/app/unload.ts`, add the import and the flush at the end of
`onUnload`:

```ts
import { seqPersistFlush } from '../seq/persist.js';
```

```ts
    mlog('unload: released ' + gates + ' sequencer note(s)');
    /* Last chance to persist: the autosave only runs every ~3 s, so without
     * this every exit dropped the edits made since the last one. Notes are
     * released first — a stuck note outlives the tool, so it must not wait
     * behind file I/O. The engine is still loaded here; schwung unloads the
     * DSP immediately after this returns. */
    seqPersistFlush();
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd movy && npm run build:browser && node browser-test/app-loop.mjs && node browser-test/logic.mjs
```
Expected: 0 failures in both.

- [ ] **Step 5: Commit**

```bash
git add movy/src/app/unload.ts movy/browser-test/app-loop.mjs
git commit -m "$(cat <<'EOF'
Persist pending sequencer state on teardown

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Full verification, device e2e, docs

**Files:**
- Modify: `movy/CHANGELOG.md`
- Modify: `movy/MANUAL.md` (persistence section — behaviour note only, no UI)
- Test: every local suite + `scripts/test-seq.sh` on device

- [ ] **Step 1: Run the whole local suite**

```bash
cd movy && npm test
```
(That is `build:browser` + `logic.mjs`, `dump-replay.mjs`, `app-loop.mjs`,
`screenshot.mjs`, `perf.mjs`.) Expected: 0 failures across all five.
No engine change was made, so `cargo test` is not required — run it anyway to
confirm: `cd engine && cargo test`.

- [ ] **Step 2: Confirm perf did not regress**

```bash
cd movy && node browser-test/perf.mjs
```
The autosave now does 2 writes + 2 read-backs every ~3 s instead of 1 write.
Expected: IPC/fill_rect counts unchanged (persistence is not on the render
path); render timing within the existing thresholds. If `perf.mjs` asserts a
host-call budget that this trips, raise the budget with a comment naming the
rotation, not by weakening the assertion.

- [ ] **Step 3: Deploy and run the device e2e**

```bash
cd movy
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && ./scripts/deploy.sh && ./scripts/test-seq.sh \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```
Expected: PASS. If the device is offline, report it to the user in CAPS.

- [ ] **Step 4: Verify the new files on the real device**

```bash
ssh ableton@move.local 'ls -la /data/UserData/schwung/modules/tools/movy/sets/*/'
ssh ableton@move.local 'head -n 2 /data/UserData/schwung/modules/tools/movy/sets/*/seq-state.json; \
                        tail -n 1 /data/UserData/schwung/modules/tools/movy/sets/*/seq-state.json'
```
Expected: each live set has `seq-state.json` + `seq-state.1.json` and/or
`seq-state.2.json`; the canonical file's line 1 is `movy1`, line 2 is `gen N`,
and its last line is `end N <len> <adler>`.

Then confirm backward compatibility against a real pre-existing file: the
`22c526a4-…` set on the device still holds a legacy (envelope-free)
`seq-state.json`. Open movy with that set active and confirm the log shows
`seq: loaded set 22c526a4-…` and the clips are present.

- [ ] **Step 5: Confirm the exit flush on device**

```bash
ssh ableton@move.local '> /data/UserData/schwung/debug.log'
# open movy, edit a step, close movy immediately (well inside the 3 s autosave)
ssh ableton@move.local 'grep "\[movy\] seq:" /data/UserData/schwung/debug.log'
```
Expected: a `seq: saved <n> bytes (gen N)` line emitted at teardown, and
re-opening movy shows the edit.

- [ ] **Step 6: Update the docs**

`movy/CHANGELOG.md` — a `### Fixed` entry naming the five failure paths (F1–F5)
in user terms: sets lost after a screen freeze, sets lost on exit, partial sets
after a power-cut, silent save failures, and edits landing in the wrong set.

`movy/MANUAL.md` — in the persistence/sets section, state that movy autosaves
per Move set every few seconds *and* on exit, that a set survives a crash or
power-cut by keeping rotating copies, and that there is deliberately no manual
save. No screenshots (no UI changed).

`movy/README.md` — no change; this is a fix, not a headline feature.

- [ ] **Step 7: Commit and push**

```bash
git add movy/CHANGELOG.md movy/MANUAL.md
git commit -m "$(cat <<'EOF'
Document the persistence rewrite

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
git push
```

---

## Self-review notes

- **Spec coverage:** F1 → Tasks 4+5 (generation guard); F2 → Tasks 1+2
  (envelope + rotation); F3 → Task 6 (unload flush); F4 → Tasks 2+5
  (`safeWrite` + `saveRetry`); F5 → Tasks 3+5 (`SetId | null`, `__` filter,
  unknown-set grace); F6 → intentionally not implemented (user decision, noted
  in Global Constraints).
- **Backward compatibility:** covered by `parseState`'s legacy branch (Task 1
  test), by keeping `sets/<uuid>/seq-state.json` canonical, and verified
  against a real legacy file on device in Task 7 Step 4.
- **Ordering risk:** Tasks 3 and 4 intentionally leave the suite red (the old
  `persist.ts` still references removed symbols); the commit happens in Task 5.
  Anyone executing tasks in isolation must run 3 → 4 → 5 as one unit.
