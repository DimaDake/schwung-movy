# Set Version History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every Movy set a bounded, browsable history of older versions that survives mistakes — not just torn writes — and can be restored on the device with no computer.

**Architecture:** A version layer on top of the existing 2-shadow rotation, never replacing it. Kept versions live one-per-directory under `sets/<uuid>/v/<n>/` (because `host_remove_dir` is the only delete movy has) and are listed in `sets/<uuid>/versions.json` (because no host API enumerates a directory). Retention is a pure function over the index. The UI is a sibling page in the existing `param-page.ts` layer.

**Tech Stack:** TypeScript → esbuild bundle (`ui.js`), QuickJS runtime on device. Tests: `browser-test/logic/*.mjs` (mock fs + mock engine), `browser-test/screenshot.mjs`, `scripts/test-*.sh` (device).

**Spec:** `plans/2026-09-08-set-version-history.md` — read it before Task 1. The plan argues from the spec; both travel together.

## Global Constraints

- **File size:** hard limit 200 lines per `src/` file; target 50–100.
- **Comments explain WHY** (constraints, invariants, workarounds), never WHAT.
- **Existing on-disk formats are frozen.** `seq-state.json`, `seq-state.1.json`, `seq-state.2.json` and `ui-state.json` keep their exact current names, contents and semantics. All new state lives in new files.
- **Ordering is by `gen`, never by the clock.** `ms` is display and bucketing only.
- **A capture that fails never blocks a save.** Every capture entry point returns void and swallows its own failure after logging.
- `MAX_VERSIONS = 32`; buckets `[1h, 24h, 7d, ∞)` capped 8 each, no rollover.
- `VERSION_MIN_MS = 600_000` (10 minutes) between `auto` captures.
- Every write goes through `safeWrite` from `src/seq/persist-store.ts` (write, then read back and compare).
- After every task: `npm test` must be 0 failures before the commit.
- Plans and specs live in `movy/plans/`. Never `git add -A`; stage named files.

---

### Task 1: Version paths and the index record

**Files:**
- Modify: `src/seq/set-context.ts` (append after `shadowPath`, around line 48)
- Create: `src/seq/version-index.ts`
- Test: `browser-test/logic/versions.mjs` (new), registered in `browser-test/logic.mjs`

**Interfaces:**
- Consumes: `SETS_DIR` (module-private const in `set-context.ts`), `parseState` from `src/seq/persist-blob.ts`
- Produces:
  - `versionsIndexPath(uuid: string): string`
  - `versionDir(uuid: string, n: number): string`
  - `versionStatePath(uuid: string, n: number): string`
  - `versionUiPath(uuid: string, n: number): string`
  - `interface VersionRec { n: number; gen: number; ms: number; why: VersionWhy; clips: number; ui: boolean }`
  - `type VersionWhy = 'open' | 'auto' | 'exit' | 'pre-wipe' | 'pre-restore' | 'adopted'`
  - `interface VersionIndex { next: number; v: VersionRec[] }`
  - `parseVersionIndex(raw: string | null): VersionIndex`
  - `serializeVersionIndex(idx: VersionIndex): string`
  - `countClips(payload: string): number`

- [ ] **Step 1: Write the failing test**

Create `browser-test/logic/versions.mjs`:

```javascript
/* browser-test/logic/versions.mjs — set version history: the index, the
 * retention ladder, capture, adoption and restore.
 *
 * Run by browser-test/logic.mjs.
 */

import { eq, ok, _log } from './harness.mjs';

export async function run() {
{
    _log('\nversion index:');
    const { parseVersionIndex, serializeVersionIndex, countClips }
        = await import('../../dist/esm/seq/version-index.js');
    const { versionsIndexPath, versionDir, versionStatePath, versionUiPath }
        = await import('../../dist/esm/seq/set-context.js');

    const SETS = '/data/UserData/schwung/modules/tools/movy/sets';
    eq('index path', versionsIndexPath('S1'), `${SETS}/S1/versions.json`);
    eq('version dir', versionDir('S1', 7), `${SETS}/S1/v/7`);
    eq('version state path', versionStatePath('S1', 7), `${SETS}/S1/v/7/seq-state.json`);
    eq('version ui path', versionUiPath('S1', 7), `${SETS}/S1/v/7/ui-state.json`);
    /* An empty uuid resolves to _default, exactly as uuidToStatePath does —
     * movy runs under that id until Move materialises the Set. */
    eq('empty uuid → _default', versionDir('', 1), `${SETS}/_default/v/1`);

    /* An unreadable index is NO VERSIONS, never an instruction to delete: the
     * same rule collectDeadSets applies to an unreadable Sets directory. */
    eq('null index is empty', parseVersionIndex(null).v.length, 0);
    eq('garbage index is empty', parseVersionIndex('{{{').v.length, 0);
    eq('empty index still counts from 1', parseVersionIndex(null).next, 1);

    const raw = JSON.stringify({ next: 4, v: [
        { n: 3, gen: 9, ms: 1788892154000, why: 'open', clips: 6, ui: true },
        { n: 1, gen: 4, ms: 0, why: 'adopted', clips: 2, ui: false },
    ] });
    const idx = parseVersionIndex(raw);
    eq('round-trips the count', idx.v.length, 2);
    eq('newest first', idx.v[0].n, 3);
    eq('carries why', idx.v[1].why, 'adopted');
    eq('carries the ui flag', idx.v[1].ui, false);
    eq('serialize round-trips', parseVersionIndex(serializeVersionIndex(idx)).v.length, 2);

    /* A record missing fields is dropped rather than defaulted: a version whose
     * generation we cannot read cannot be ordered, and an unordered entry in a
     * restore menu is worse than an absent one. */
    eq('a record with no n is dropped',
        parseVersionIndex(JSON.stringify({ next: 2, v: [{ gen: 1, ms: 0, why: 'open' }] })).v.length, 0);
    eq('a record with a bad why is dropped',
        parseVersionIndex(JSON.stringify({ next: 2, v: [{ n: 1, gen: 1, ms: 0, why: 'nope' }] })).v.length, 0);
    /* next must outrank every n on disk or a new version overwrites an old
     * directory — the one corruption this index cannot self-heal from. */
    eq('next is repaired past the highest n',
        parseVersionIndex(JSON.stringify({ next: 1, v: [{ n: 9, gen: 1, ms: 0, why: 'open', clips: 0, ui: false }] })).next, 10);

    eq('counts clips', countClips('movy1\ncl 0 0 16 0 x\ncp 0\ncl 1 0 16 0 y\n'), 2);
    eq('a blank has none', countClips('movy1\n'), 0);
}
}
```

Register it in `browser-test/logic.mjs`: add `import { run as run_versions } from './logic/versions.mjs';` next to the other `set-*` imports, and `run_versions,` next to `run_set_state,` in the run list.

- [ ] **Step 2: Run test to verify it fails**

Run: `node build/browser.mjs && node browser-test/logic.mjs 2>&1 | grep -A3 "version index"`
Expected: FAIL — `Cannot find module .../dist/esm/seq/version-index.js`

- [ ] **Step 3: Add the paths to `set-context.ts`**

Append after `shadowPath` (line ~48):

```typescript
/* Version history lives under the set's own directory so a dead Set takes its
 * history with it — `collectDeadSets` removes the whole tree.
 *
 * One directory PER VERSION, which looks extravagant until you notice that
 * `host_remove_dir` is the only removal the host offers: a version that cannot
 * be deleted on its own cannot be thinned, and thinning is the whole point. */
export function versionsIndexPath(uuid: string): string {
    return SETS_DIR + '/' + (uuid || '_default') + '/versions.json';
}
export function versionDir(uuid: string, n: number): string {
    return SETS_DIR + '/' + (uuid || '_default') + '/v/' + n;
}
export function versionStatePath(uuid: string, n: number): string {
    return versionDir(uuid, n) + '/seq-state.json';
}
export function versionUiPath(uuid: string, n: number): string {
    return versionDir(uuid, n) + '/ui-state.json';
}
```

- [ ] **Step 4: Create `src/seq/version-index.ts`**

```typescript
/* The version index — `sets/<uuid>/versions.json`.
 *
 * No host API lists a directory, so this file IS the list: a version the index
 * does not name is invisible, and a name the index carries for a directory that
 * is gone is dropped on read. Keeping the record parsing here, with no I/O,
 * is what lets the whole self-heal be tested without a filesystem. */

export type VersionWhy =
    'open' | 'auto' | 'exit' | 'pre-wipe' | 'pre-restore' | 'adopted';

const WHYS: VersionWhy[] = ['open', 'auto', 'exit', 'pre-wipe', 'pre-restore', 'adopted'];

export interface VersionRec {
    n: number;      // directory under v/, never reused
    gen: number;    // envelope generation — THE ORDERING KEY
    ms: number;     // Date.now() at capture, or 0 when unknown; display only
    why: VersionWhy;
    clips: number;  // how a user tells a real version from a blank one
    ui: boolean;    // whether v/<n>/ui-state.json exists
}

export interface VersionIndex { next: number; v: VersionRec[] }

const EMPTY: VersionIndex = { next: 1, v: [] };

function isRec(o: unknown): o is VersionRec {
    const r = o as VersionRec;
    return !!r && typeof r.n === 'number' && typeof r.gen === 'number'
        && typeof r.ms === 'number' && WHYS.indexOf(r.why) >= 0;
}

/** Parse, dropping anything unusable. An unreadable index reads as NO VERSIONS
 *  — never as permission to delete, which is the guard `collectDeadSets`
 *  applies to an unreadable Sets directory for the same reason. */
export function parseVersionIndex(raw: string | null): VersionIndex {
    if (!raw) return { next: 1, v: [] };
    let o: { next?: unknown; v?: unknown };
    try { o = JSON.parse(raw); } catch { return { next: 1, v: [] }; }
    const list = Array.isArray(o.v) ? o.v.filter(isRec).map((r) => ({
        n: r.n, gen: r.gen, ms: r.ms, why: r.why,
        clips: typeof r.clips === 'number' ? r.clips : 0,
        ui: r.ui === true,
    })) : [];
    list.sort((a, b) => b.gen - a.gen || b.n - a.n);
    /* `next` must outrank every n on disk. A truncated write that lost the
     * counter would otherwise hand the next capture a directory that already
     * exists — the one corruption self-heal cannot undo, because the old
     * version's files would be gone. */
    let next = typeof o.next === 'number' && o.next >= 1 ? o.next : 1;
    for (const r of list) if (r.n >= next) next = r.n + 1;
    return { next, v: list };
}

export function serializeVersionIndex(idx: VersionIndex): string {
    return JSON.stringify({ next: idx.next, v: idx.v });
}

/** Clips in a payload. The one number the menu shows that says whether a
 *  version is worth restoring. */
export function countClips(payload: string): number {
    let n = 0;
    for (const line of payload.split('\n')) if (line.startsWith('cl ')) n++;
    return n;
}

export { EMPTY as EMPTY_VERSION_INDEX };
```

- [ ] **Step 5: Run the test**

Run: `node build/browser.mjs && node browser-test/logic.mjs 2>&1 | grep -E "version index" -A 20`
Expected: all PASS

- [ ] **Step 6: Full suite and commit**

```bash
npm test
git add src/seq/set-context.ts src/seq/version-index.ts browser-test/logic/versions.mjs browser-test/logic.mjs
git commit -m "feat(versions): the version index and its paths"
```

---

### Task 2: The retention ladder

**Files:**
- Create: `src/seq/version-retain.ts`
- Test: `browser-test/logic/versions.mjs` (append a second block)

**Interfaces:**
- Consumes: `VersionRec` from Task 1
- Produces: `versionToDrop(list: VersionRec[], now: number): number | null` — the `n` to remove, or null if the list fits. `MAX_VERSIONS`, `BUCKET_MS`, `BUCKET_CAP` exported for the tests.

**Why pure:** the entire "good spread" guarantee lives in one function with no I/O, so it can be tested exhaustively against a month of synthetic timestamps.

- [ ] **Step 1: Write the failing test**

Append to `browser-test/logic/versions.mjs`, inside `run()` after the first block:

```javascript
{
    _log('\nretention ladder:');
    const { versionToDrop, MAX_VERSIONS }
        = await import('../../dist/esm/seq/version-retain.js');

    const NOW = 1788892154000;
    const MIN = 60_000, HOUR = 3600_000, DAY = 24 * HOUR;
    /* Newest first, gen descending — the order the index is kept in. */
    const mk = (ages, why = 'auto') => ages.map((a, i) => ({
        n: ages.length - i, gen: ages.length - i, ms: NOW - a,
        why: Array.isArray(why) ? why[i] : why, clips: 4, ui: true,
    }));

    eq('a short list is never thinned', versionToDrop(mk([0, MIN, 2 * MIN]), NOW), null);
    eq('exactly MAX is not thinned',
        versionToDrop(mk(Array.from({ length: MAX_VERSIONS }, (_, i) => i * MIN)), NOW), null);

    /* Over cap in the newest bucket: the drop comes from THAT bucket, and it is
     * the interior version whose neighbours are closest together. */
    {
        const ages = [0, MIN, 2 * MIN, 3 * MIN, 4 * MIN, 5 * MIN, 6 * MIN, 20 * MIN, 40 * MIN];
        const list = mk(ages);
        const drop = versionToDrop(list, NOW);
        ok('drops from the crowded end', ages.indexOf(NOW - list.find((r) => r.n === drop).ms) <= 6);
    }

    /* The newest three are never dropped, however dense they are. */
    {
        const list = mk([0, 1000, 2000, 3 * MIN, 10 * MIN, 20 * MIN, 30 * MIN, 40 * MIN, 50 * MIN]);
        const drop = versionToDrop(list, NOW);
        ok('never the newest three', drop !== list[0].n && drop !== list[1].n && drop !== list[2].n);
    }

    /* A pre-wipe inside 7 days survives even when it is the densest point —
     * those versions exist BECAUSE something destructive happened. */
    {
        const ages = [0, MIN, 2 * MIN, 10 * MIN, 11 * MIN, 12 * MIN, 13 * MIN, 30 * MIN, 50 * MIN];
        const why = ages.map((_, i) => (i === 5 ? 'pre-wipe' : 'auto'));
        const list = mk(ages, why);
        eq('a recent pre-wipe is not the drop',
            versionToDrop(list, NOW) === list[5].n, false);
    }

    /* No rollover: an empty older bucket does not lend slots to the newest one,
     * so a long session cannot eat the history it exists to protect. */
    {
        const ages = Array.from({ length: 9 }, (_, i) => i * MIN);   // all inside 1h
        ok('the hour bucket thins at 8 even with the rest empty',
            versionToDrop(mk(ages), NOW) !== null);
    }

    /* A version with no usable clock lands in the OLDEST bucket and is ranked
     * there by generation — nothing is ever ordered by the clock. */
    {
        const list = [
            ...mk([0, MIN, 2 * MIN]),
            ...Array.from({ length: 9 }, (_, i) => ({
                n: 100 - i, gen: 100 - i, ms: 0, why: 'adopted', clips: 1, ui: false,
            })),
        ];
        const drop = versionToDrop(list, NOW);
        ok('a clockless version can be dropped', drop >= 90);
    }

    /* A clock that jumped backwards must not make every version "in the
     * future" and unthinnable. */
    {
        const ages = Array.from({ length: 9 }, (_, i) => -(i * DAY));  // all ahead of now
        ok('future timestamps still thin', versionToDrop(mk(ages), NOW) !== null);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node build/browser.mjs && node browser-test/logic.mjs 2>&1 | grep -A3 "retention ladder"`
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/seq/version-retain.ts`**

```typescript
/* Which version to drop when a set is at its limit.
 *
 * Pure — versions and `now` in, one `n` out — because the spread this produces
 * IS the feature, and a spread that can only be observed by filling a device
 * with a month of edits is a spread nobody will ever check.
 *
 * The shape is logarithmic, not even. A rule that simply thinned wherever the
 * gaps were smallest converges on an EVEN spread, which after a month means one
 * version a day and nothing fine-grained from the session you are actually in.
 * Buckets fix the shape; the gap rule then chooses within a bucket. */

import type { VersionRec } from './version-index.js';

export const MAX_VERSIONS = 32;

const HOUR = 3600_000;
/* Upper age bound of each bucket; the last is unbounded. */
export const BUCKET_MS = [HOUR, 24 * HOUR, 7 * 24 * HOUR, Infinity];
export const BUCKET_CAP = [8, 8, 8, 8];

/* Never dropped, whatever the ladder says. */
const KEEP_NEWEST = 3;
const PRE_WIPE_PROTECT_MS = 7 * 24 * HOUR;

/** Which bucket a version falls in. A missing, zero or future timestamp cannot
 *  be aged, so it goes in the oldest bucket — where it is ranked by generation
 *  like everything else. Ordering never touches the clock; only membership
 *  does. */
function bucketOf(r: VersionRec, now: number): number {
    const age = now - r.ms;
    if (!(r.ms > 0) || age < 0) return BUCKET_MS.length - 1;
    for (let i = 0; i < BUCKET_MS.length; i++) if (age <= BUCKET_MS[i]) return i;
    return BUCKET_MS.length - 1;
}

function protectedRec(r: VersionRec, i: number, now: number): boolean {
    if (i < KEEP_NEWEST) return true;
    return r.why === 'pre-wipe' && r.ms > 0 && now - r.ms <= PRE_WIPE_PROTECT_MS;
}

/** The `n` to remove, or null when the list fits.
 *
 *  `list` is newest first (generation descending), as the index keeps it. */
export function versionToDrop(list: VersionRec[], now: number): number | null {
    if (list.length <= MAX_VERSIONS) return null;

    /* Because the caps sum to MAX_VERSIONS, being over the total always means
     * some bucket is over its own cap — there is no separate global rule. */
    const buckets: VersionRec[][] = BUCKET_MS.map(() => []);
    for (const r of list) buckets[bucketOf(r, now)].push(r);

    for (let b = 0; b < buckets.length; b++) {
        const rows = buckets[b];
        if (rows.length <= BUCKET_CAP[b]) continue;
        const drop = pickWithin(rows, list, now);
        if (drop !== null) return drop;
    }
    /* Every over-cap bucket is entirely protected — fall back to the oldest
     * unprotected version anywhere, so a capture is never refused for want of
     * room. */
    for (let i = list.length - 1; i >= 0; i--)
        if (!protectedRec(list[i], i, now)) return list[i].n;
    return null;
}

/** Thin where it is densest: the interior version whose two neighbours are
 *  closest together. The bucket's ends are left alone — they anchor its span,
 *  and dropping them shrinks the range the bucket exists to cover. */
function pickWithin(rows: VersionRec[], list: VersionRec[], now: number): number | null {
    let best: number | null = null;
    let bestGap = Infinity;
    for (let i = 1; i < rows.length - 1; i++) {
        const r = rows[i];
        if (protectedRec(r, list.indexOf(r), now)) continue;
        /* Clockless rows have no gap to measure; rank them by generation by
         * treating the oldest as the densest. */
        const gap = rows[i - 1].ms > 0 && rows[i + 1].ms > 0
            ? rows[i - 1].ms - rows[i + 1].ms
            : -r.gen;
        if (gap < bestGap) { bestGap = gap; best = r.n; }
    }
    if (best !== null) return best;
    /* No interior candidate survived the protections — take the bucket's oldest
     * unprotected row instead. */
    for (let i = rows.length - 1; i >= 0; i--)
        if (!protectedRec(rows[i], list.indexOf(rows[i]), now)) return rows[i].n;
    return null;
}
```

- [ ] **Step 4: Run the test**

Run: `node build/browser.mjs && node browser-test/logic.mjs 2>&1 | grep -E "retention ladder" -A 12`
Expected: all PASS

- [ ] **Step 5: Prove the ladder has teeth**

Temporarily change `BUCKET_CAP` to `[32, 32, 32, 32]` and re-run. The "no rollover" and "hour bucket thins at 8" assertions must FAIL. Restore the value.

- [ ] **Step 6: Full suite and commit**

```bash
npm test
git add src/seq/version-retain.ts browser-test/logic/versions.mjs
git commit -m "feat(versions): the retention ladder, as a pure function"
```

---

### Task 3: The version store

**Files:**
- Create: `src/seq/version-store.ts`
- Test: `browser-test/logic/versions.mjs` (append a third block)

**Interfaces:**
- Consumes: Task 1's paths and index; `safeWrite` from `src/seq/persist-store.ts`; `wrapState`/`parseState` from `src/seq/persist-blob.ts`; `versionToDrop` from Task 2
- Produces:
  - `readVersionIndex(uuid: string): VersionIndex`
  - `writeVersion(uuid: string, why: VersionWhy, payload: string, gen: number, ui: string | null, now: number): boolean`
  - `readVersionState(uuid: string, n: number): { payload: string; gen: number } | null`
  - `readVersionUi(uuid: string, n: number): string | null`
  - `pruneVersions(uuid: string, now: number): void`

- [ ] **Step 1: Write the failing test**

Append to `browser-test/logic/versions.mjs`:

```javascript
{
    _log('\nversion store:');
    const { installMockFs, uninstallMockFs } = await import('./harness.mjs');
    const { readVersionIndex, writeVersion, readVersionState, readVersionUi }
        = await import('../../dist/esm/seq/version-store.js');
    const { versionStatePath, versionUiPath, versionsIndexPath }
        = await import('../../dist/esm/seq/set-context.js');

    const NOW = 1788892154000;
    const fs = installMockFs({});
    ok('a set with no history reads empty', readVersionIndex('S1').v.length === 0);

    ok('writes a version', writeVersion('S1', 'open', 'movy1\ncl 0 0 16 0 x\n', 5, '{"root":48}', NOW));
    const idx = readVersionIndex('S1');
    eq('one version', idx.v.length, 1);
    eq('numbered from 1', idx.v[0].n, 1);
    eq('carries the generation', idx.v[0].gen, 5);
    eq('counted its clips', idx.v[0].clips, 1);
    eq('recorded the ui blob', idx.v[0].ui, true);
    eq('next advanced', idx.next, 2);

    eq('the payload comes back', readVersionState('S1', 1).payload, 'movy1\ncl 0 0 16 0 x\n');
    eq('the ui blob comes back', readVersionUi('S1', 1), '{"root":48}');

    /* The version DIRECTORY is written before the index entry, so a crash
     * between them leaves an unreferenced directory — collectable — instead of
     * an index naming files that do not exist. */
    const order = fs.writes.filter((p) => p.includes('/v/1/') || p.endsWith('versions.json'));
    ok('directory written before the index', order[order.length - 1].endsWith('versions.json'));

    /* No ui blob is a legitimate version: an adopted OLDER sequence has no ui
     * state of its own age, and restoring it must leave the chains alone. */
    writeVersion('S1', 'adopted', 'movy1\n', 1, null, 0);
    eq('a version can have no ui half', readVersionIndex('S1').v.find((r) => r.n === 2).ui, false);
    eq('and reads back as null', readVersionUi('S1', 2), null);

    /* An index naming a version whose files are gone must not offer it. */
    delete fs.files[versionStatePath('S1', 2)];
    eq('a dangling entry is dropped on read',
        readVersionIndex('S1').v.some((r) => r.n === 2), false);

    /* A failed write must leave NO index entry: a version that half exists is
     * worse than one that does not, because the menu would offer it. */
    fs.failWrites = '/v/3/';
    eq('a failed capture is not recorded', writeVersion('S1', 'auto', 'movy1\ncl 0 0 16 0 z\n', 9, null, NOW), false);
    fs.failWrites = null;
    eq('and left the index alone', readVersionIndex('S1').v.some((r) => r.n === 3), false);

    uninstallMockFs();
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node build/browser.mjs && node browser-test/logic.mjs 2>&1 | grep -A3 "version store"`
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/seq/version-store.ts`**

```typescript
/* Reading and writing a set's kept versions.
 *
 * The write ORDER is the durability rule and the only subtle thing here: the
 * version's files land first, the index entry second. A crash between them
 * leaves a directory nothing names — harmless, and collected on the next
 * capture — where the other order would leave the menu offering a version whose
 * files do not exist. Same discipline as shadow-before-canonical in
 * persist-store.ts, for the same reason. */

import { mlog } from '../log.js';
import { parseState, wrapState } from './persist-blob.js';
import { safeWrite } from './persist-store.js';
import {
    fileExists, versionDir, versionStatePath, versionUiPath, versionsIndexPath,
} from './set-context.js';
import {
    countClips, parseVersionIndex, serializeVersionIndex,
    type VersionIndex, type VersionWhy,
} from './version-index.js';
import { versionToDrop } from './version-retain.js';

function read(path: string): string | null {
    return (typeof host_read_file === 'function') ? host_read_file(path) : null;
}

/** The index, with entries whose files are gone dropped. Self-healing on READ
 *  rather than on a sweep: there is no directory listing, so the index is the
 *  only place the discrepancy can be noticed at all. */
export function readVersionIndex(uuid: string): VersionIndex {
    const idx = parseVersionIndex(read(versionsIndexPath(uuid)));
    const live = idx.v.filter((r) => fileExists(versionStatePath(uuid, r.n)));
    if (live.length !== idx.v.length) {
        idx.v = live;
        safeWrite(versionsIndexPath(uuid), serializeVersionIndex(idx));
    }
    return idx;
}

export function readVersionState(uuid: string, n: number): { payload: string; gen: number } | null {
    const p = parseState(read(versionStatePath(uuid, n)));
    return p ? { payload: p.payload, gen: p.gen } : null;
}

export function readVersionUi(uuid: string, n: number): string | null {
    return read(versionUiPath(uuid, n));
}

/** Keep `payload` (and `ui`, when there is one) as a new version.
 *
 *  Returns false when nothing durable was written — the caller logs and carries
 *  on, because a capture that fails must never block the save it rode in on. */
export function writeVersion(
    uuid: string, why: VersionWhy, payload: string, gen: number,
    ui: string | null, now: number,
): boolean {
    const idx = readVersionIndex(uuid);
    const n = idx.next;
    if (typeof host_ensure_dir === 'function') {
        host_ensure_dir(versionDir(uuid, n));
    }
    if (!safeWrite(versionStatePath(uuid, n), wrapState(payload, gen))) {
        mlog('versions: capture failed for ' + uuid + ' (' + why + ')');
        return false;
    }
    let hasUi = false;
    if (ui !== null && ui !== '') hasUi = safeWrite(versionUiPath(uuid, n), ui);

    idx.next = n + 1;
    idx.v.unshift({ n, gen, ms: now, why, clips: countClips(payload), ui: hasUi });
    idx.v.sort((a, b) => b.gen - a.gen || b.n - a.n);
    if (!safeWrite(versionsIndexPath(uuid), serializeVersionIndex(idx))) {
        mlog('versions: index write failed for ' + uuid);
        return false;
    }
    pruneVersions(uuid, now);
    return true;
}

/** Drop versions until the set is within its limit. One at a time, because the
 *  ladder re-evaluates after every removal — the bucket a version sits in
 *  depends on the ones around it. */
export function pruneVersions(uuid: string, now: number): void {
    for (let guard = 0; guard < 8; guard++) {
        const idx = readVersionIndex(uuid);
        const n = versionToDrop(idx.v, now);
        if (n === null) return;
        if (typeof host_remove_dir === 'function') host_remove_dir(versionDir(uuid, n));
        idx.v = idx.v.filter((r) => r.n !== n);
        if (!safeWrite(versionsIndexPath(uuid), serializeVersionIndex(idx))) return;
        mlog('versions: pruned ' + n + ' from ' + uuid);
    }
}
```

- [ ] **Step 4: Run the test**

Run: `node build/browser.mjs && node browser-test/logic.mjs 2>&1 | grep -E "version store" -A 15`
Expected: all PASS

- [ ] **Step 5: Full suite and commit**

```bash
npm test
git add src/seq/version-store.ts browser-test/logic/versions.mjs
git commit -m "feat(versions): the version store, files before index"
```

---

### Task 4: Capture and adoption

**Files:**
- Create: `src/seq/version-capture.ts`
- Modify: `src/seq/set-session.ts` — `enterLoading` (capture `open` + adopt), `sessionFlush` (capture `exit`)
- Modify: `src/seq/set-save.ts` — `saveSet` (capture `auto`)
- Modify: `src/seq/set-fail.ts` — `sessionStartFromScratch` (capture `pre-wipe`)
- Test: `browser-test/logic/versions.mjs` (append a fourth block)

**Interfaces:**
- Consumes: Task 3's store; `readBestState`, `readUiBlob` from `persist-store.ts`; `shadowPath`, `uuidToStatePath` from `set-context.ts`
- Produces:
  - `adoptExistingVersions(uuid: string, now: number): number` — number adopted, 0 if the set already has an index
  - `captureVersion(uuid: string, why: VersionWhy, payload: string, gen: number, now?: number): void`
  - `captureAutoIfDue(uuid: string, payload: string, gen: number, now?: number): void`
  - `resetVersionCapture(): void`

- [ ] **Step 1: Write the failing test**

Append to `browser-test/logic/versions.mjs`:

```javascript
{
    _log('\nadopting what earlier builds wrote:');
    const { readFileSync } = await import('node:fs');
    const { installMockFs, uninstallMockFs } = await import('./harness.mjs');
    const { adoptExistingVersions, captureVersion, captureAutoIfDue, resetVersionCapture }
        = await import('../../dist/esm/seq/version-capture.js');
    const { readVersionIndex, readVersionUi } = await import('../../dist/esm/seq/version-store.js');
    const { uuidToStatePath, uuidToUiStatePath, shadowPath }
        = await import('../../dist/esm/seq/set-context.js');
    const { wrapState } = await import('../../dist/esm/seq/persist-blob.js');

    const NOW = 1788892154000;
    const FIX = 'browser-test/fixtures/old-sets/movy-chains';
    const oldSeq = readFileSync(`${FIX}/seq-state.json`, 'utf8');
    const oldUi = readFileSync(`${FIX}/ui-state.json`, 'utf8');

    /* A real set from an earlier build: canonical plus two shadows, one of them
     * an older generation. All three predate this feature. */
    {
        resetVersionCapture();
        const fs = installMockFs({
            [uuidToStatePath('OLD')]: oldSeq,
            [shadowPath('OLD', 1)]: oldSeq,
            [shadowPath('OLD', 2)]: wrapState('movy1\ncl 0 0 16 0 9:24:60:100:0\n', 3),
            [uuidToUiStatePath('OLD')]: oldUi,
        });
        eq('adopts the distinct copies', adoptExistingVersions('OLD', NOW), 2);
        const idx = readVersionIndex('OLD');
        eq('duplicates collapsed', idx.v.length, 2);
        ok('ordered newest first', idx.v[0].gen > idx.v[1].gen);
        eq('the newest adopted carries the ui blob', idx.v[0].ui, true);
        eq('and it is the current one', readVersionUi('OLD', idx.v[0].n), oldUi);
        /* Older adopted versions get NO ui blob: ui-state.json was never
         * rotated, so pairing an older sequence with today's chains would be a
         * quiet lie. */
        eq('the older adopted has none', idx.v[1].ui, false);

        /* Adoption COPIES. Adopting the shadows by reference would mean the
         * history evaporates on the next autosave, which rewrites them. */
        ok('the shadow was copied, not referenced',
            Object.keys(fs.files).some((p) => p.includes('/v/') && p.endsWith('seq-state.json')));

        eq('adoption is once per set', adoptExistingVersions('OLD', NOW), 0);
        eq('and did not touch the current state', fs.files[uuidToStatePath('OLD')], oldSeq);
        uninstallMockFs();
    }

    /* A legacy envelope — written before gen/end existed — adopts at 0. */
    {
        resetVersionCapture();
        installMockFs({ [uuidToStatePath('LEG')]: 'movy1\ncl 0 0 16 0 0:24:60:100:0\n' });
        eq('a legacy file adopts', adoptExistingVersions('LEG', NOW), 1);
        eq('at generation 0', readVersionIndex('LEG').v[0].gen, 0);
        uninstallMockFs();
    }

    /* A set with nothing on disk has nothing to adopt — and must not record an
     * empty version, which would sit in the menu pretending to be work. */
    {
        resetVersionCapture();
        installMockFs({});
        eq('nothing to adopt', adoptExistingVersions('NEW', NOW), 0);
        uninstallMockFs();
    }

    _log('\ncapture conditions:');
    {
        resetVersionCapture();
        installMockFs({});
        captureVersion('S2', 'open', 'movy1\ncl 0 0 16 0 x\n', 4, NOW);
        eq('open captured', readVersionIndex('S2').v.length, 1);
        /* An identical payload is not a new version — the autosave rewrites the
         * same bytes whenever anything else in the set changed. */
        captureVersion('S2', 'exit', 'movy1\ncl 0 0 16 0 x\n', 5, NOW + 1000);
        eq('an unchanged payload is not captured again', readVersionIndex('S2').v.length, 1);
        captureVersion('S2', 'exit', 'movy1\ncl 0 0 16 0 y\n', 6, NOW + 2000);
        eq('a changed payload is', readVersionIndex('S2').v.length, 2);

        /* auto is rate-limited: the autosave fires every few seconds forever. */
        captureAutoIfDue('S2', 'movy1\ncl 0 0 16 0 z\n', 7, NOW + 3000);
        eq('auto is refused inside the interval', readVersionIndex('S2').v.length, 2);
        captureAutoIfDue('S2', 'movy1\ncl 0 0 16 0 z\n', 7, NOW + 11 * 60_000);
        eq('and allowed after it', readVersionIndex('S2').v.length, 3);

        /* A blank must never displace real work in the menu. */
        captureVersion('S2', 'pre-wipe', 'movy1\n', 8, NOW + 12 * 60_000);
        eq('a pre-wipe of a blank is still recorded', readVersionIndex('S2').v.length, 4);
        uninstallMockFs();
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node build/browser.mjs && node browser-test/logic.mjs 2>&1 | grep -A3 "adopting what earlier"`
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/seq/version-capture.ts`**

```typescript
/* When a version is kept.
 *
 * Five moments and nothing else — anything driven by the autosave alone would
 * write history at flash-wearing speed for no benefit, since the rotation
 * already covers the crash case. The one that matters most is `open`: a
 * snapshot of what was on disk BEFORE movy can write anything, which costs a
 * single write per set open and turns "my set came up blank" from a data loss
 * into a menu entry. */

import { mlog } from '../log.js';
import { parseState } from './persist-blob.js';
import { readUiBlob } from './persist-store.js';
import { shadowPath, uuidToStatePath } from './set-context.js';
import { readVersionIndex, readVersionState, writeVersion } from './version-store.js';
import type { VersionWhy } from './version-index.js';

/** ~10 minutes. The autosave runs every few seconds forever, so `auto` needs a
 *  floor or the history is just the rotation with extra steps. */
const VERSION_MIN_MS = 600_000;

let lastAutoMs = 0;

export function resetVersionCapture(): void {
    lastAutoMs = 0;
}

function read(path: string): string | null {
    return (typeof host_read_file === 'function') ? host_read_file(path) : null;
}

/** Is this payload already the newest version? The autosave rewrites the same
 *  bytes whenever anything else in the set changed, and a menu full of
 *  identical entries hides the ones that differ. */
function alreadyNewest(uuid: string, payload: string): boolean {
    const idx = readVersionIndex(uuid);
    if (idx.v.length === 0) return false;
    const top = readVersionState(uuid, idx.v[0].n);
    return !!top && top.payload === payload;
}

export function captureVersion(
    uuid: string, why: VersionWhy, payload: string, gen: number,
    now: number = Date.now(),
): void {
    if (!uuid && uuid !== '') return;
    if (why !== 'pre-wipe' && why !== 'pre-restore' && alreadyNewest(uuid, payload)) return;
    const ui = readUiBlob(uuid);
    if (!writeVersion(uuid, why, payload, gen, ui, now)) {
        /* Logged and dropped. The set's CURRENT state outranks its history, so
         * a capture never fails a save. */
        mlog('versions: ' + why + ' capture dropped for ' + uuid);
        return;
    }
    if (why === 'auto') lastAutoMs = now;
}

export function captureAutoIfDue(
    uuid: string, payload: string, gen: number, now: number = Date.now(),
): void {
    if (lastAutoMs !== 0 && now - lastAutoMs < VERSION_MIN_MS) return;
    captureVersion(uuid, 'auto', payload, gen, now);
    /* Set even when the capture was skipped as a duplicate: the interval is
     * about how often we ASK, not how often we succeed. */
    lastAutoMs = now;
}

/** Seed a set's history from what earlier builds already wrote.
 *
 *  Returns the number adopted, and 0 when the set already has an index — this
 *  runs on every open and must be a no-op after the first.
 *
 *  Adoption COPIES. The shadows are live rotation slots: adopting them by
 *  reference would mean the history evaporates on the very next autosave. */
export function adoptExistingVersions(uuid: string, now: number = Date.now()): number {
    if (readVersionIndex(uuid).v.length > 0) return 0;

    const seen: string[] = [];
    const found: { payload: string; gen: number }[] = [];
    for (const path of [uuidToStatePath(uuid), shadowPath(uuid, 1), shadowPath(uuid, 2)]) {
        const p = parseState(read(path));
        if (!p || seen.indexOf(p.payload) >= 0) continue;
        seen.push(p.payload);
        found.push({ payload: p.payload, gen: p.gen });
    }
    if (found.length === 0) return 0;

    found.sort((a, b) => a.gen - b.gen);   // oldest gets the lowest n
    const ui = readUiBlob(uuid);
    let adopted = 0;
    for (let i = 0; i < found.length; i++) {
        /* Only the NEWEST adopted version gets the ui blob. There is exactly
         * one ui-state.json — it was never rotated — so giving an older
         * sequence today's chains would be a quiet lie. An older adopted
         * version restores the sequence alone and leaves the chains as they
         * are, which the menu shows as SEQ ONLY. */
        const isNewest = i === found.length - 1;
        if (writeVersion(uuid, 'adopted', found[i].payload, found[i].gen,
                         isNewest ? ui : null, 0)) adopted++;
    }
    if (adopted > 0) mlog('versions: adopted ' + adopted + ' for ' + uuid);
    return adopted;
}
```

- [ ] **Step 4: Hook the capture points**

In `src/seq/set-session.ts`, inside `enterLoading`, after `const st = loadSet(id, name);` and before `setId = id;`:

```typescript
    /* Before movy can write anything to this Set: adopt whatever earlier builds
     * left, then snapshot what was actually on disk. This one capture is what
     * makes a Set that comes up blank a menu entry rather than a loss. */
    adoptExistingVersions(id);
    captureVersion(id, 'open', st.payload, st.gen);
```

Add to its imports: `import { adoptExistingVersions, captureVersion } from './version-capture.js';`

In `sessionFlush`, replace the body's tail so the flush captures on the way out:

```typescript
    const r = saveSet(setId, gen, force);
    if (r.ok) gen = r.gen;
    /* A forced flush is a teardown or a set switch — a natural boundary, and
     * the last chance this Set has to record where it got to. */
    if (force && r.ok) captureVersion(setId, 'exit', savedPayload(), gen);
```

`savedPayload` is already imported there.

In `src/seq/set-save.ts`, at the end of `saveSet` just before `return { ok: true, wrote: true, gen: gen + 1 };`:

```typescript
    /* Rides the save that just wrote, so the history costs no extra engine read
     * — and is rate-limited inside, because this runs every few seconds. */
    captureAutoIfDue(id, payload, gen + 1);
```

Add `import { captureAutoIfDue } from './version-capture.js';`

In `src/seq/set-fail.ts`, inside `sessionStartFromScratch`, before `writeStateBlob(id, BLANK_STATE, ...)`:

```typescript
    /* The set about to be blanked, kept unconditionally. This is the capture
     * the whole feature exists for. */
    const stored = readBestState(id);
    if (stored) captureVersion(id, 'pre-wipe', stored.payload, stored.gen);
```

Add `import { readBestState } from './persist-store.js';` and `import { captureVersion } from './version-capture.js';`

Also add `resetVersionCapture()` to `resetSetSession()` in `set-session.ts`, and export it from `browser-test/logic/harness.mjs` if the other suites need it.

- [ ] **Step 5: Run the tests**

Run: `node build/browser.mjs && node browser-test/logic.mjs 2>&1 | grep -E "adopting what earlier|capture conditions" -A 15`
Expected: all PASS. The `old-set.mjs` suite must also still pass — it now runs with adoption active, which is itself the backward-compatibility check.

- [ ] **Step 6: Full suite and commit**

```bash
npm test
git add src/seq/version-capture.ts src/seq/set-session.ts src/seq/set-save.ts src/seq/set-fail.ts browser-test/logic/versions.mjs
git commit -m "feat(versions): capture on open, autosave, exit and wipe; adopt older sets"
```

---

### Task 5: Restore

**Files:**
- Create: `src/seq/version-restore.ts`
- Modify: `src/seq/set-session.ts` — export `reloadCurrentSet()`
- Test: `browser-test/logic/versions.mjs` (append a fifth block)

**Interfaces:**
- Consumes: Tasks 3 and 4; `writeStateBlob`, `writeUiBlob`, `readBestState` from `persist-store.ts`; `shadowPath` from `set-context.ts`
- Produces: `restoreVersion(uuid: string, n: number, now?: number): boolean`; `reloadCurrentSet(): void` from `set-session.ts`

- [ ] **Step 1: Write the failing test**

Append to `browser-test/logic/versions.mjs`:

```javascript
{
    _log('\nrestoring a version:');
    const { installMockFs, uninstallMockFs } = await import('./harness.mjs');
    const { restoreVersion } = await import('../../dist/esm/seq/version-restore.js');
    const { writeVersion, readVersionIndex } = await import('../../dist/esm/seq/version-store.js');
    const { resetVersionCapture } = await import('../../dist/esm/seq/version-capture.js');
    const { readBestState } = await import('../../dist/esm/seq/persist-store.js');
    const { uuidToStatePath, uuidToUiStatePath, shadowPath }
        = await import('../../dist/esm/seq/set-context.js');
    const { wrapState } = await import('../../dist/esm/seq/persist-blob.js');

    const NOW = 1788892154000;
    const MUSIC = 'movy1\ncl 0 0 16 0 0:24:60:100:0\n';

    {
        resetVersionCapture();
        const fs = installMockFs({
            /* The state after a wipe, exactly as it looks on a damaged device:
             * a blank at a HIGHER generation than the good copy. */
            [uuidToStatePath('S3')]: wrapState('movy1\n', 8),
            [shadowPath('S3', 1)]: wrapState('movy1\n', 8),
            [shadowPath('S3', 2)]: wrapState(MUSIC, 7),
            [uuidToUiStatePath('S3')]: '{"root":48}',
        });
        writeVersion('S3', 'pre-wipe', MUSIC, 7, '{"root":60}', NOW - 1000);
        const n = readVersionIndex('S3').v[0].n;

        ok('restores', restoreVersion('S3', n, NOW));

        /* The whole point, and the trap proved on device: restoring only the
         * canonical file still loads EMPTY, because readBestState takes the
         * highest generation it can read and the blank in a shadow is newer. */
        eq('movy would now load the music', readBestState('S3').payload, MUSIC);
        eq('the ui blob came back too', fs.files[uuidToUiStatePath('S3')], '{"root":60}');

        /* A restore is itself undoable. */
        ok('the present was captured first',
            readVersionIndex('S3').v.some((r) => r.why === 'pre-restore'));
        uninstallMockFs();
    }

    /* A version with no ui half restores the sequence and leaves chains alone —
     * that is what SEQ ONLY promises in the menu. */
    {
        resetVersionCapture();
        const fs = installMockFs({
            [uuidToStatePath('S4')]: wrapState('movy1\n', 2),
            [uuidToUiStatePath('S4')]: '{"root":48}',
        });
        writeVersion('S4', 'adopted', MUSIC, 1, null, 0);
        const n = readVersionIndex('S4').v.find((r) => r.ui === false).n;
        ok('restores', restoreVersion('S4', n, NOW));
        eq('the sequence came back', readBestState('S4').payload, MUSIC);
        eq('the chains were left alone', fs.files[uuidToUiStatePath('S4')], '{"root":48}');
        uninstallMockFs();
    }

    /* A version whose files vanished is refused rather than restoring nothing
     * over the user's work. */
    {
        resetVersionCapture();
        installMockFs({ [uuidToStatePath('S5')]: wrapState(MUSIC, 3) });
        eq('an unknown version is refused', restoreVersion('S5', 99, NOW), false);
        eq('and the set is untouched', readBestState('S5').payload, MUSIC);
        uninstallMockFs();
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node build/browser.mjs && node browser-test/logic.mjs 2>&1 | grep -A3 "restoring a version"`
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/seq/version-restore.ts`**

```typescript
/* Putting a version back.
 *
 * Step 2 writes the canonical file AND BOTH ROTATION SHADOWS, which looks
 * redundant and is not. Copies are ordered by generation and `readBestState`
 * takes the highest one it can read, so a newer blank left in a shadow outranks
 * a rescue written only to the canonical file — verified on a device: the set
 * still loads empty and the restore looks like it did nothing. */

import { mlog } from '../log.js';
import { wrapState } from './persist-blob.js';
import { readBestState, safeWrite, writeUiBlob } from './persist-store.js';
import { shadowPath, uuidToStatePath } from './set-context.js';
import { captureVersion } from './version-capture.js';
import { readVersionIndex, readVersionState, readVersionUi } from './version-store.js';

export function restoreVersion(uuid: string, n: number, now: number = Date.now()): boolean {
    const idx = readVersionIndex(uuid);
    const rec = idx.v.find((r) => r.n === n);
    const src = rec ? readVersionState(uuid, n) : null;
    if (!rec || !src) {
        mlog('versions: cannot restore ' + n + ' of ' + uuid);
        return false;
    }

    /* Before anything is overwritten: a mis-press must not cost the live take,
     * so a restore is itself undoable. */
    const cur = readBestState(uuid);
    if (cur) captureVersion(uuid, 'pre-restore', cur.payload, cur.gen, now);

    let top = cur ? cur.gen : 0;
    for (const r of readVersionIndex(uuid).v) if (r.gen > top) top = r.gen;
    const gen = top + 1;
    const wrapped = wrapState(src.payload, gen);

    if (!safeWrite(uuidToStatePath(uuid), wrapped)) return false;
    /* Both shadows, for the reason at the top of this file. */
    safeWrite(shadowPath(uuid, 1), wrapped);
    safeWrite(shadowPath(uuid, 2), wrapped);

    /* Only when the version HAS a ui half. An adopted older sequence has none,
     * and overwriting the chains with nothing would be worse than the wipe this
     * feature exists to undo. */
    const ui = rec.ui ? readVersionUi(uuid, n) : null;
    if (ui !== null && ui !== '') writeUiBlob(uuid, ui);

    mlog('versions: restored ' + n + ' of ' + uuid + ' at gen ' + gen);
    return true;
}
```

- [ ] **Step 4: Export the reload hook from `set-session.ts`**

Add next to the other exports:

```typescript
/** Re-enter the load path for the Set already open — what a restore needs once
 *  the files on disk have changed under it. Deliberately the SAME path a set
 *  switch takes, so a restore inherits the settle wait and the module reload
 *  rather than inventing its own. */
export function reloadCurrentSet(): void {
    if (!setId && !setName) return;
    enterLoading(setId, setName);
}
```

- [ ] **Step 5: Run the tests**

Run: `node build/browser.mjs && node browser-test/logic.mjs 2>&1 | grep -E "restoring a version" -A 12`
Expected: all PASS

- [ ] **Step 6: Prove the three-copy rule has teeth**

Temporarily delete the two `safeWrite(shadowPath(...))` lines and re-run. `movy would now load the music` must FAIL, reproducing the device-proven trap. Restore the lines.

- [ ] **Step 7: Full suite and commit**

```bash
npm test
git add src/seq/version-restore.ts src/seq/set-session.ts browser-test/logic/versions.mjs
git commit -m "feat(versions): restore, writing every copy so the rescue wins"
```

---

### Task 6: The page — state and gestures

**Files:**
- Create: `src/seq/versions-page.ts`, `src/seq/versions-page-vm.ts`
- Modify: `src/app/state.ts` (add `VIEW_VERSIONS = 10`), `src/seq/param-page.ts` (`paramPageActive`), `src/seq/flags-page.ts` (the `BACKUPS ▸` row), `src/midi/router.ts` (jog / jog-click / shift+jog)
- Test: `browser-test/logic/versions.mjs` (append a sixth block)

**Interfaces:**
- Consumes: Tasks 3 and 5; `openParamPage`, `closeParamPage` from `param-page.ts`
- Produces:
  - `versionsPageState = { selected: number, confirming: boolean }`
  - `versionsPageActive(): boolean`, `openVersionsPage(): void`, `resetVersionsPage(): void`
  - `versionsPageJog(delta: number, shift: boolean): void`
  - `versionsPageClick(): void` — arms the confirm, then restores
  - `versionsPageBack(): boolean` — true when it consumed the press (cancelling a confirm)
  - `buildVersionsPageVM(now?: number): VersionsPageVM` with `{ rows: { age: string; why: string; clips: string; seqOnly: boolean }[]; selected: number; confirming: boolean; empty: boolean }`
  - `agoLabel(ms: number, now: number): string`

- [ ] **Step 1: Write the failing test**

Append to `browser-test/logic/versions.mjs`:

```javascript
{
    _log('\nversions page:');
    const { installMockFs, uninstallMockFs } = await import('./harness.mjs');
    const { agoLabel, buildVersionsPageVM } = await import('../../dist/esm/seq/versions-page-vm.js');
    const { versionsPageState, versionsPageJog, resetVersionsPage }
        = await import('../../dist/esm/seq/versions-page.js');
    const { writeVersion } = await import('../../dist/esm/seq/version-store.js');

    const NOW = 1788892154000;
    const MIN = 60_000, HOUR = 3600_000, DAY = 24 * HOUR;

    eq('just now', agoLabel(NOW - 5000, NOW), 'JUST NOW');
    eq('minutes', agoLabel(NOW - 18 * MIN, NOW), '18M AGO');
    eq('hours', agoLabel(NOW - 3 * HOUR, NOW), '3H AGO');
    eq('yesterday', agoLabel(NOW - 30 * HOUR, NOW), 'YESTERDAY');
    eq('days', agoLabel(NOW - 4 * DAY, NOW), '4D AGO');
    /* No usable clock: say so rather than invent a date. Nothing in the list is
     * ORDERED by time, so an unknown one costs only its label. */
    eq('no timestamp', agoLabel(0, NOW), 'OLDEST');
    eq('a future timestamp is not a negative age', agoLabel(NOW + HOUR, NOW), 'OLDEST');

    installMockFs({});
    eq('an empty set says so', buildVersionsPageVM(NOW, 'E1').empty, true);
    writeVersion('P1', 'pre-wipe', 'movy1\ncl 0 0 16 0 x\ncl 1 0 16 0 y\n', 3, '{}', NOW - 2 * MIN);
    writeVersion('P1', 'adopted', 'movy1\ncl 0 0 16 0 z\n', 1, null, 0);
    const vm = buildVersionsPageVM(NOW, 'P1');
    eq('two rows', vm.rows.length, 2);
    eq('newest first', vm.rows[0].why, 'BEFORE WIPE');
    eq('shows the clip count', vm.rows[0].clips, '2 CLIPS');
    eq('one clip is singular', vm.rows[1].clips, '1 CLIP');
    eq('a version with no ui half is marked', vm.rows[1].seqOnly, true);

    resetVersionsPage();
    versionsPageJog(1, false);
    eq('jog moves one row', versionsPageState.selected, 1);
    versionsPageJog(1, false);
    eq('and clamps at the end', versionsPageState.selected, 1);
    uninstallMockFs();
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node build/browser.mjs && node browser-test/logic.mjs 2>&1 | grep -A3 "versions page"`
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/seq/versions-page-vm.ts`**

```typescript
/* What the versions page draws — computed without pixels so the wording and the
 * time labels are testable on their own. */

import { currentSetUuid } from './set-session.js';
import { readVersionIndex } from './version-store.js';
import type { VersionWhy } from './version-index.js';

export interface VersionsRowVM {
    age: string; why: string; clips: string; seqOnly: boolean;
}
export interface VersionsPageVM {
    rows: VersionsRowVM[]; selected: number; confirming: boolean; empty: boolean;
}

const WHY_LABEL: Record<VersionWhy, string> = {
    'open': 'OPENED', 'auto': 'AUTOSAVE', 'exit': 'ON EXIT',
    'pre-wipe': 'BEFORE WIPE', 'pre-restore': 'BEFORE UNDO', 'adopted': 'ADOPTED',
};

const MIN = 60_000, HOUR = 3600_000, DAY = 24 * HOUR;

/** Relative time, because absolute dates do not fit and do not help. A
 *  timestamp that is missing, zero or in the future cannot be aged — say
 *  OLDEST rather than invent a date, since the list is ordered by generation
 *  and never by the clock. */
export function agoLabel(ms: number, now: number): string {
    if (!(ms > 0) || ms > now) return 'OLDEST';
    const d = now - ms;
    if (d < MIN) return 'JUST NOW';
    if (d < HOUR) return Math.floor(d / MIN) + 'M AGO';
    if (d < DAY) return Math.floor(d / HOUR) + 'H AGO';
    if (d < 2 * DAY) return 'YESTERDAY';
    return Math.floor(d / DAY) + 'D AGO';
}

export function buildVersionsPageVM(
    now: number = Date.now(), uuid: string = currentSetUuid(),
): VersionsPageVM {
    const idx = readVersionIndex(uuid);
    const rows = idx.v.map((r) => ({
        age: agoLabel(r.ms, now),
        why: WHY_LABEL[r.why],
        clips: r.clips === 1 ? '1 CLIP' : r.clips + ' CLIPS',
        seqOnly: !r.ui,
    }));
    return {
        rows,
        selected: 0,      // filled in by versions-page.ts; see buildVersionsPageVM callers
        confirming: false,
        empty: rows.length === 0,
    };
}
```

Note for the implementer: `selected` and `confirming` are overwritten by the caller in `tick.ts` from `versionsPageState`, keeping this module free of page state — the same split `flags-page-vm.ts` uses.

- [ ] **Step 4: Create `src/seq/versions-page.ts`**

```typescript
/* The BACKUPS page: a scrolled list of this Set's kept versions, and the one
 * gesture that puts one back.
 *
 * A restore replaces live work, so it is the only list on this device that asks
 * twice. Everything else here is the flags page's shape — jog scrolls, Back
 * leaves — because they are the same gesture and must not behave differently. */

import { appState, VIEW_VERSIONS } from '../app/state.js';
import { openParamPage } from './param-page.js';
import { currentSetUuid, reloadCurrentSet } from './set-session.js';
import { readVersionIndex } from './version-store.js';
import { restoreVersion } from './version-restore.js';
import { mlog } from '../log.js';

export const versionsPageState = {
    selected: 0,
    confirming: false,
};

export function versionsPageActive(): boolean {
    return appState.currentView === VIEW_VERSIONS;
}

export function openVersionsPage(): void {
    versionsPageState.selected = 0;
    versionsPageState.confirming = false;
    openParamPage(VIEW_VERSIONS);
}

export function resetVersionsPage(): void {
    versionsPageState.selected = 0;
    versionsPageState.confirming = false;
}

function rowCount(): number {
    return readVersionIndex(currentSetUuid()).v.length;
}

/** Jog scrolls one row; Shift+jog jumps eight, because 32 versions is eight
 *  screens of plain scrolling — the level-skip idiom the cursor pagination
 *  already established. */
export function versionsPageJog(delta: number, shift: boolean): void {
    if (versionsPageState.confirming) return;   // the confirm owns the jog
    const step = shift ? 8 : 1;
    const max = Math.max(0, rowCount() - 1);
    const next = Math.max(0, Math.min(max, versionsPageState.selected + delta * step));
    versionsPageState.selected = next;
}

/** Jog click: first press arms the confirm, second performs the restore. */
export function versionsPageClick(): void {
    const idx = readVersionIndex(currentSetUuid());
    const rec = idx.v[versionsPageState.selected];
    if (!rec) return;
    if (!versionsPageState.confirming) {
        versionsPageState.confirming = true;
        return;
    }
    versionsPageState.confirming = false;
    if (restoreVersion(currentSetUuid(), rec.n)) {
        /* The ordinary load path, so the engine gets the state, the chains
         * reload and the existing splash covers the settling. */
        reloadCurrentSet();
    } else {
        mlog('versions: restore refused for ' + rec.n);
    }
}

/** Back cancels an armed confirm; otherwise the param layer handles it. */
export function versionsPageBack(): boolean {
    if (!versionsPageState.confirming) return false;
    versionsPageState.confirming = false;
    return true;
}
```

- [ ] **Step 5: Wire the view in**

`src/app/state.ts` — add after `VIEW_CPU`:

```typescript
export const VIEW_VERSIONS = 10;  // Backups (Settings → BACKUPS)
```

`src/seq/param-page.ts` — add `VIEW_VERSIONS` to the import and to `paramPageActive()`:

```typescript
        || appState.currentView === VIEW_VERSIONS;
```

`src/seq/flags-page.ts` — the settings list gains an action row. Add above `flagsPageJog`:

```typescript
/* The one row on this page that is not a flag. It sits last so it never moves
 * when the flag list changes, and it is an ACTION: knob 1 does nothing on it,
 * and the jog click opens the page. */
export const BACKUPS_ROW = -1;
export function flagsRowCount(): number { return visibleFlags().length + 1; }
export function backupsRowSelected(): boolean {
    return flagsPageState.selected === visibleFlags().length;
}
```

and change `flagsPageJog`'s clamp to `flagsRowCount() - 1`, and `flagsPageKnob` to return early when `backupsRowSelected()`.

`src/midi/router.ts` — in the jog handler near line 789, before the `flagsPageActive()` branch:

```typescript
            if (versionsPageActive()) {
                versionsPageJog(delta > 0 ? 1 : -1, appState.shiftHeld);
                appState.dirty = true;
                return;
            }
```

and in the jog-click handler, alongside the existing page cases:

```typescript
            if (versionsPageActive()) { versionsPageClick(); appState.dirty = true; return; }
            if (flagsPageActive() && backupsRowSelected()) { openVersionsPage(); appState.dirty = true; return; }
```

and in the Back handler, before the param layer closes:

```typescript
            if (versionsPageActive() && versionsPageBack()) { appState.dirty = true; return; }
```

- [ ] **Step 6: Run the tests**

Run: `node build/browser.mjs && node browser-test/logic.mjs 2>&1 | grep -E "versions page" -A 16`
Expected: all PASS

- [ ] **Step 7: Full suite and commit**

```bash
npm test
git add src/seq/versions-page.ts src/seq/versions-page-vm.ts src/app/state.ts src/seq/param-page.ts src/seq/flags-page.ts src/midi/router.ts browser-test/logic/versions.mjs
git commit -m "feat(versions): the BACKUPS page and its gestures"
```

---

### Task 7: The renderer

**Files:**
- Create: `src/renderer/versions-view.ts`
- Modify: `src/app/tick.ts` (render branch), `browser-test/screenshot.mjs` (three scenes)
- Test: `browser-test/screenshot.mjs`

**Interfaces:**
- Consumes: `VersionsPageVM` from Task 6; `drawHeader` from `src/renderer/header.ts`; `firstVisibleRow`, `VISIBLE_ROWS` conventions from `src/renderer/flags-view.ts`
- Produces: `renderVersionsView(vm: VersionsPageVM): void`

- [ ] **Step 1: Add the screenshot scenes (they fail first)**

In `browser-test/screenshot.mjs`, add to the scene name list: `'versions_empty', 'versions_list', 'versions_confirm',` and the cases:

```javascript
        case 'versions_empty':
            lastRender = () => renderVersionsView({ rows: [], selected: 0, confirming: false, empty: true });
            lastRender(); break;
        case 'versions_list':
            lastRender = () => renderVersionsView({
                rows: [
                    { age: '2M AGO',  why: 'OPENED',      clips: '6 CLIPS', seqOnly: false },
                    { age: '18M AGO', why: 'AUTOSAVE',    clips: '6 CLIPS', seqOnly: false },
                    { age: '1H AGO',  why: 'BEFORE WIPE', clips: '6 CLIPS', seqOnly: false },
                    { age: '3H AGO',  why: 'AUTOSAVE',    clips: '4 CLIPS', seqOnly: false },
                    { age: 'OLDEST',  why: 'ADOPTED',     clips: '5 CLIPS', seqOnly: true  },
                ], selected: 2, confirming: false, empty: false });
            lastRender(); break;
        /* The confirm must say what a restore does NOT cover — Schwung's own
         * four track slots live in Move's set file, out of movy's reach. */
        case 'versions_confirm':
            lastRender = () => renderVersionsView({
                rows: [{ age: '2M AGO', why: 'OPENED', clips: '6 CLIPS', seqOnly: false }],
                selected: 0, confirming: true, empty: false });
            lastRender(); break;
```

with `const { renderVersionsView } = await import('../dist/esm/renderer/versions-view.js');` beside the other renderer imports.

- [ ] **Step 2: Run to verify it fails**

Run: `node build/browser.mjs && node browser-test/screenshot.mjs 2>&1 | tail -5`
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/renderer/versions-view.ts`**

```typescript
/* The BACKUPS list.
 *
 * Same row metrics and the same centred scroll window as the settings list —
 * they are the same gesture, and two lists that scroll differently under one
 * jog wheel is a bug the user feels before they can name it. */

import type { VersionsPageVM } from '../seq/versions-page-vm.js';
import { fontPrint, fontWidth, FONT_HEIGHT } from '../font/index.js';
import { drawHeader } from './header.js';
import { firstVisibleRow, VISIBLE_ROWS } from './flags-view.js';
import { W, HEADER_H, TOAST_Y } from './layout.js';

const ROW_H = FONT_HEIGHT + 2;
const LIST_TOP = HEADER_H + 2;
/* Two lines above the toast band, for the confirm. Not the bottom of the
 * screen: tick.ts repaints the Loop Overview strip there every tick, outside
 * the dirty-frame block, and it would cut the second line in half. */
const FOOT_TOP = TOAST_Y - 2 * ROW_H;

function centre(y: number, text: string, color: number): void {
    fontPrint(Math.floor((W - fontWidth(text)) / 2), y, text, color);
}

export function renderVersionsView(vm: VersionsPageVM): void {
    clear_screen();
    drawHeader('BACKUPS', null, true);

    if (vm.empty) {
        centre(Math.floor(TOAST_Y / 2), 'NO BACKUPS YET', 1);
        return;
    }

    const first = firstVisibleRow(vm.selected, vm.rows.length);
    for (let i = 0; i < VISIBLE_ROWS && first + i < vm.rows.length; i++) {
        const r = vm.rows[first + i];
        const y = LIST_TOP + i * ROW_H;
        const sel = first + i === vm.selected;
        if (sel) fill_rect(0, y - 1, W, ROW_H, 1);
        const c = sel ? 0 : 1;
        fontPrint(2, y, r.age, c);
        fontPrint(38, y, r.why, c);
        /* Right-aligned, because the count is what the eye scans for when
         * hunting the version that still has the work in it. */
        const tail = r.seqOnly ? r.clips + ' *' : r.clips;
        fontPrint(W - 2 - fontWidth(tail), y, tail, c);
    }

    if (vm.confirming) {
        fill_rect(0, FOOT_TOP - 2, W, 2 * ROW_H + 3, 0);
        centre(FOOT_TOP, 'JOG = RESTORE  BACK = CANCEL', 1);
        /* The honest half: Schwung's own four track slots live in Move's set
         * file, which movy cannot write. */
        centre(FOOT_TOP + ROW_H, 'SCHWUNG SLOTS NOT INCLUDED', 1);
    }
}
```

- [ ] **Step 4: Wire it into `tick.ts`**

Beside the `VIEW_FLAGS` branch:

```typescript
        } else if (appState.currentView === VIEW_VERSIONS) {
            const vm = buildVersionsPageVM();
            vm.selected = versionsPageState.selected;
            vm.confirming = versionsPageState.confirming;
            renderVersionsView(vm);
```

- [ ] **Step 5: Generate baselines and eyeball them**

```bash
node build/browser.mjs
node browser-test/screenshot.mjs --update
git status --short browser-test/screenshots/    # ONLY the three new files may appear
node scripts/make-doc-assets.mjs versions_list versions_confirm versions_empty
```

Open `docs/assets/versions_list.png` and check: rows do not collide, the `*` fits, the confirm's two lines are whole.

- [ ] **Step 6: Full suite and commit**

```bash
npm test
git add src/renderer/versions-view.ts src/app/tick.ts browser-test/screenshot.mjs browser-test/screenshots/baseline/versions_*.png docs/assets/versions_*.png
git commit -m "feat(versions): draw the BACKUPS list"
```

---

### Task 8: Device test, docs, changelog

**Files:**
- Create: `scripts/test-versions.sh`
- Modify: `scripts/test-all-device-schwung.sh`, `scripts/test-all-device-movy.sh`, `browser-test/device-scripts.mjs`, `MANUAL.md`, `README.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: `scripts/lib/test-set.sh` (`test_set_begin`, `test_set_end`, `ts_ssh`, `ts_open_movy`, `ts_close_movy`, `ts_restart_stack`, `qgrep`)

**This is the backward-compatibility gate.** It runs in both host arms.

- [ ] **Step 1: Write `scripts/test-versions.sh`**

```bash
#!/usr/bin/env bash
# test-versions.sh — a set written by an EARLIER movy keeps its work when this
# build opens it, and can be restored from the device.
#
# The local suites prove the logic against captured files. This proves the one
# thing they cannot: that a real device, opening a real pre-feature set,
# adopts it without touching the state, and that a restore reaches THE ENGINE
# rather than only the disk.
set -euo pipefail
HOST="${1:-move.local}"
MOVY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
. "$MOVY_DIR/scripts/lib/test-set.sh"
test_set_begin
trap test_set_end EXIT INT TERM

SETS=/data/UserData/schwung/modules/tools/movy/sets
UUID=$(ts_active_uuid)
D="$SETS/$UUID"
FIX="$MOVY_DIR/browser-test/fixtures/old-sets/movy-chains"
PASS=0; FAIL=0
ok()   { echo -e "  \033[0;32m✓\033[0m $1"; PASS=$((PASS+1)); }
bad()  { echo -e "  \033[0;31m✗\033[0m $1"; FAIL=$((FAIL+1)); }

# Seed the PRE-FEATURE layout with movy closed: the running tool autosaves over
# these files, so a fixture written under it is a copy of the last test's mess.
ts_close_movy
ts_ssh "rm -rf $D/v $D/versions.json"
scp -q "$FIX/seq-state.json" "ableton@$HOST:$D/seq-state.json"
scp -q "$FIX/seq-state.json" "ableton@$HOST:$D/seq-state.1.json"
scp -q "$FIX/ui-state.json"  "ableton@$HOST:$D/ui-state.json"
BEFORE=$(ts_ssh "md5sum $D/seq-state.json | cut -d' ' -f1")

ts_open_movy
sleep 8   # the open capture rides the load, which settles behind the splash

# 1. adoption happened, and did not touch the state it adopted
ts_ssh "test -f $D/versions.json" && ok "versions.json created" || bad "no index written"
N=$(ts_ssh "grep -o '\"n\":' $D/versions.json | wc -l" | tr -d ' \r\n')
[ "${N:-0}" -ge 1 ] && ok "adopted $N version(s)" || bad "nothing adopted"
AFTER=$(ts_ssh "md5sum $D/seq-state.json | cut -d' ' -f1")
[ "$BEFORE" = "$AFTER" ] || bad "adoption modified the current state"
[ "$BEFORE" = "$AFTER" ] && ok "the current state was not modified"

# 2. the set still plays: the engine holds the fixture's clips
CLIPS=$(node "$MOVY_DIR/scripts/engine-param.mjs" get state 2>/dev/null | grep -c '^cl ' || true)
[ "${CLIPS:-0}" -ge 1 ] && ok "the engine holds $CLIPS clip(s) from the old set" \
                        || bad "the old set's clips did not reach the engine"

# 3. wipe, then restore, and read the clips back OUT OF THE ENGINE
ts_ssh "cp $D/seq-state.json /tmp/versions-good.json"
node "$MOVY_DIR/scripts/engine-param.mjs" set cmd "clipdel 0 0" >/dev/null 2>&1 || true
sleep 10   # let the autosave carry the deletion to disk
ts_close_movy
LATEST=$(ts_ssh "grep -o '\"n\":[0-9]*' $D/versions.json | head -n 1 | cut -d: -f2")
ts_ssh "cp $D/v/$LATEST/seq-state.json $D/seq-state.json
        cp $D/v/$LATEST/seq-state.json $D/seq-state.1.json
        cp $D/v/$LATEST/seq-state.json $D/seq-state.2.json"
ts_open_movy
sleep 8
BACK=$(node "$MOVY_DIR/scripts/engine-param.mjs" get state 2>/dev/null | grep -c '^cl ' || true)
[ "${BACK:-0}" -ge 1 ] && ok "restored version reached the engine ($BACK clip(s))" \
                       || bad "the restore did not reach the engine"

echo
[ "$FAIL" -eq 0 ] && echo -e "\033[0;32m\033[1mALL $PASS CHECKS PASSED\033[0m" \
                  || { echo -e "\033[0;31m\033[1m$FAIL CHECK(S) FAILED\033[0m"; exit 1; }
```

`chmod +x scripts/test-versions.sh`.

- [ ] **Step 2: Register it in both sweeps and in the script linter**

Add `test-versions.sh` to the suite list in `scripts/test-all-device-schwung.sh` and `scripts/test-all-device-movy.sh`. Add its assertions to `browser-test/device-scripts.mjs` so a log phrase it greps for can never drift from what the source emits.

- [ ] **Step 3: Run it, once, on the device**

```bash
ssh -o ConnectTimeout=3 ableton@move.local echo ok && ./scripts/test-versions.sh move.local
```

Device tests are flaky by nature: run it once. If it fails, check whether the failure names something this plan changed; otherwise report it and move on.

- [ ] **Step 4: Docs**

`MANUAL.md` §9 — replace the `recover-sets.mjs` bullet's *preamble* (keep the script documented for sets damaged before this shipped) with a pointer to the on-device menu, and add a subsection under §1 describing Settings → `BACKUPS`, with `docs/assets/versions_list.png`.

`README.md` — one bullet in *Features*: "**Backups.** Every set keeps up to 32 older versions — restore any of them from the device."

`CHANGELOG.md` — under `## [Unreleased]`, an `### Added` entry describing the ladder, adoption, and that Schwung's own track slots are not included.

- [ ] **Step 5: Full local suite, then commit**

```bash
npm test
git add scripts/test-versions.sh scripts/test-all-device-schwung.sh scripts/test-all-device-movy.sh browser-test/device-scripts.mjs MANUAL.md README.md CHANGELOG.md
git commit -m "test(versions): device backward-compatibility suite, plus docs"
git push
```

---

## Self-review notes

**Spec coverage.** Layout → Task 1. Index and self-heal → Tasks 1, 3. Capture conditions → Task 4. Retention ladder → Task 2. Adoption → Task 4. Restore → Task 5. UI → Tasks 6, 7. Failure handling → Tasks 3, 4, 5 (each has a negative test). Compatibility → Task 4's adoption tests, Task 8's device suite, and the existing `old-set.mjs` suite, which runs unchanged with adoption active.

**Deliberately deferred.** `pruneVersions` is called only from `writeVersion`, so a set whose ladder changed shape while movy was closed is thinned on its next capture rather than on open. That is one write later and avoids a delete on a path the user did not ask anything of.

**Known sharp edge for the implementer.** `versions-page-vm.ts` imports `currentSetUuid` from `set-session.ts`, and `versions-page.ts` imports `reloadCurrentSet` from the same file, while `set-session.ts` imports `version-capture.ts`. That is a cycle through the bundle. It resolves at runtime because every call happens after module init, but if esbuild reorders it into a TDZ error, the fix is to pass the uuid in from `tick.ts` rather than reaching for it — `buildVersionsPageVM` already takes it as a parameter for exactly this reason.
