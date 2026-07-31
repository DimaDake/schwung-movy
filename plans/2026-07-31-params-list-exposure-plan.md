# `ui_hierarchy` `params[]` Exposure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make movy's generic (no-config) param pages show the params a module
declares in each level's `params[]` list — not just the ≤8 on `knobs[]` — so
osirus finally exposes Preset/Bank/ROM, and 45 modules stop hiding 721 params.

**Architecture:** `hierarchy-walk.ts` gains an `extras` hook that appends a
level's `params[]`-only keys to its knob list (globally deduped, degenerate
ranges skipped); `hierarchy.ts` owns the filtering because only it holds
`chain_params` metadata. Page growth is paid for by a page-first read-back
cursor (same IPC budget, faster on-screen values) and shift+jog level skipping.
A bounded poll-time retry re-resolves preset counts and `(loading)` enum options
that the module publishes asynchronously.

**Tech Stack:** TypeScript → esbuild bundle (`ui.js`); pure-node test suites in
`browser-test/*.mjs`; device is `ableton@move.local`.

**Design doc:** `plans/2026-07-31-params-list-exposure-design.md`

## Global Constraints

- **Only the generic no-config path changes.** A module with a `ModuleConfig`
  returns early in `loadHierarchy` and must be byte-identical in
  `browser-test/dump-expect.json`: `signal, chordism, hush1, weird-dreams, sfz,
  essaim, chiptune, mrdrums, plaits, 303, krautdrums, wurl`.
- **No param reachable today may become unreachable.** A page may disappear
  only if its full key-list duplicates a page that remains.
- **File size: hard limit 200 lines, target 50–100** (`movy/CLAUDE.md`).
  `src/model/hierarchy.ts` is 424 lines today — Task 1 splits it before
  anything is added.
- **Per-tick IPC budget is unchanged:** `perf.mjs` asserts
  `GET_PARAM_PER_TICK_MAX = 2`. No task may add a `shadow_get_param` to a tick
  that already makes two.
- **Comments explain WHY, never WHAT** (`CLAUDE.md`).
- **Prove every new test has teeth:** remove the fix, watch the test fail,
  restore it (`feedback_verify-teeth-and-baseline`).
- Run `npm run build:browser` before any `.mjs` suite. `npm test` builds and
  runs all five (`logic`, `dump-replay`, `app-loop`, `screenshot`, `perf`).
- Commit after every task. Never `git add -A`.

---

### Task 1: Split `hierarchy.ts` (pure refactor, no behaviour change)

`hierarchy.ts` is 424 lines and every later task adds to it. Split first so the
gate is clean: a pure move must leave `dump-expect.json` untouched.

**Files:**
- Create: `src/model/param-build.ts`
- Create: `src/model/preset-param.ts`
- Modify: `src/model/hierarchy.ts`
- Test: `browser-test/dump-replay.mjs` (existing, must pass unchanged)

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  // src/model/preset-param.ts
  export function buildPresetParam(
      s: ModelState, listParam?: string, countParam?: string, nameParam?: string,
  ): KnobParam | null;

  // src/model/param-build.ts
  export interface RawMeta {
      key?: string; label?: string; name?: string; level?: string;
      type?: string; min?: number; max?: number; step?: number; options?: string[];
      automatable?: boolean; behavior?: string;
      knob_acceleration?: string; knobAcceleration?: string;
      root?: string; filter?: unknown; start_path?: string;
  }
  export function inferRenderStyle(type: KnobParam['type'], min: number, max: number): KnobParam['renderStyle'];
  export function inferBehavior(explicit: unknown, options: string[] | null): KnobParam['behavior'] | undefined;
  export function inferAcceleration(value: unknown): KnobParam['knobAcceleration'] | undefined;
  export function parseFilter(filter: unknown): string[];
  /* Generic-path builder: chain_params meta `cp` + hierarchy meta `def` → KnobParam. */
  export function buildGenericParam(key: string, cp: RawMeta, def: RawMeta): KnobParam;
  ```

- [ ] **Step 1: Move `buildPresetParam` to `src/model/preset-param.ts`**

Cut the function verbatim (including its comment block) out of `hierarchy.ts`
into the new file. It needs these imports:

```ts
import type { KnobParam } from '../types/param.js';
import type { ModelState } from './state.js';
```

In `hierarchy.ts` add `import { buildPresetParam } from './preset-param.js';`.

- [ ] **Step 2: Move the metadata helpers and the generic build loop to `src/model/param-build.ts`**

Move `inferRenderStyle`, `inferBehavior`, `inferAcceleration`, `parseFilter`
verbatim, and export them. Then move the body of the final
`for (const key of entry.keys)` loop in `hierarchy.ts` (the block that builds a
`KnobParam` from `cp`/`def`, including the `filepath` branch and the
`metaGuessed` comment) into `buildGenericParam`, returning the param instead of
pushing it:

```ts
export function buildGenericParam(key: string, cp: RawMeta, def: RawMeta): KnobParam {
    const type = cp.type || def.type || 'float';
    if (type === 'filepath') {
        return {
            key,
            label:      String(cp.name ?? def.label ?? key),
            shortLabel: null,
            type:       'file',
            min: 0, max: 0, step: 0,
            options:    null,
            renderStyle: 'arc',
            automatable: false,
            fileRoot:      String(cp.root ?? '/data/UserData'),
            fileFilter:    parseFilter(cp.filter),
            fileStartPath: String(cp.start_path ?? cp.root ?? '/data/UserData'),
        };
    }
    const options  = cp.options ?? def.options ?? null;
    const hasRange = cp.min != null || cp.max != null || def.min != null || def.max != null;
    let min  = cp.min  != null ? cp.min  : (def.min  != null ? def.min  : 0);
    let max  = cp.max  != null ? cp.max  : (def.max  != null ? def.max  : 1);
    let step = cp.step != null ? cp.step : (def.step != null ? def.step : (type === 'float' ? 0.02 : 1));
    if (type === 'enum') { min = 0; max = options ? options.length - 1 : 127; step = 1; }
    // C4: no metadata anywhere → movy guessed float 0..1 (numeric types only).
    // Flag it so the first value read can infer the real int type and widen the
    // range (see meta-infer.ts / store.ts).
    const metaGuessed = !hasRange && (type === 'float' || type === 'int');
    const behavior = inferBehavior(cp.behavior ?? def.behavior, options);
    return {
        key,
        label:      cp.name || def.label || key,
        shortLabel: null,
        type:       type as KnobParam['type'],
        options, min, max, step,
        renderStyle: inferRenderStyle(type as KnobParam['type'], min, max),
        // Config-less fallback: the `g_` global-naming convention is the only
        // signal available here. Modules with a movy config use bank.global.
        automatable: behavior === 'trigger' ? false : (cp.automatable ?? def.automatable ??
            ((type === 'float' || type === 'int') && max > min && !key.startsWith('g_'))),
        behavior,
        knobAcceleration: inferAcceleration(
            cp.knob_acceleration ?? cp.knobAcceleration ??
            def.knob_acceleration ?? def.knobAcceleration,
        ),
        ...(metaGuessed ? { metaGuessed: true } : {}),
    };
}
```

Retype `cpMap` in `hierarchy.ts` as `Record<string, RawMeta>` (it was
`Record<string, HierParam & { name?: string }>`) so the `filepath` branch's
`root`/`filter`/`start_path` reads no longer need inline casts, and keep the
local `HierParam`/`HierLevel` interfaces only for the hierarchy JSON shape.

The loop in `hierarchy.ts` becomes:

```ts
for (const key of entry.keys) {
    if (!key) { s.knobParams.push(null); continue; }
    if (key === listParam && presetParam) { s.knobParams.push(presetParam); continue; }
    s.knobParams.push(buildGenericParam(key, cpMap[key] ?? {}, paramDefs[key] ?? knobInline[key] ?? {}));
}
```

- [ ] **Step 3: Verify the refactor changed nothing**

Run:
```bash
npm run typecheck && npm run build:browser
node browser-test/dump-replay.mjs
node browser-test/logic.mjs
git diff --stat browser-test/dump-expect.json
```
Expected: both suites 0 failures, and **no diff** in `dump-expect.json` (a pure
move cannot change a single module's layout). If the snapshot moved, the move
was not verbatim — fix before continuing.

- [ ] **Step 4: Confirm the file-size limit is met**

Run: `wc -l src/model/hierarchy.ts src/model/param-build.ts src/model/preset-param.ts`
Expected: every file ≤ 200 lines.

- [ ] **Step 5: Commit**

```bash
git add src/model/hierarchy.ts src/model/param-build.ts src/model/preset-param.ts
git commit -m "Split hierarchy.ts into orchestration, param build, preset param"
```

---

### Task 2: Level `params[]` extras on the generic pages

**Files:**
- Modify: `src/model/hierarchy-walk.ts`
- Modify: `src/model/hierarchy.ts`
- Test: `browser-test/mock-synth.mjs`, `browser-test/logic.mjs`

**Interfaces:**
- Consumes: `buildGenericParam` (Task 1).
- Produces:
  ```ts
  // src/model/hierarchy-walk.ts
  export function paramKeys(lvl: WalkLevel | undefined): string[];
  export interface WalkOptions { extras?: (lvl: WalkLevel) => string[]; }
  export function buildLevelPages(
      allLevels: Record<string, WalkLevel>, rootKey: string, opts?: WalkOptions,
  ): Array<{ name: string; keys: string[] }>;
  ```

- [ ] **Step 1: Write the failing tests**

Add to `browser-test/mock-synth.mjs` inside `MOCK_SYNTHS`:

```js
    /* A level whose params[] list is richer than its knobs[] row — the osirus
     * shape. `bank_index` is degenerate (min==max) so it must NOT be rendered;
     * `ui_scroll` is internal state; `dupe` is already a knob elsewhere. */
    hier_params_extras: {
        "synth:name": "Extras",
        "synth:chain_params": JSON.stringify([
            { key: "cutoff",     name: "Cutoff",   type: "int", min: 0, max: 127 },
            { key: "dupe",       name: "Dupe",     type: "int", min: 0, max: 127 },
            { key: "pw",         name: "Osc1 PW",  type: "int", min: 0, max: 127 },
            { key: "wave",       name: "Osc1 Wave", type: "enum", options: ["Sine", "Saw"] },
            { key: "semi",       name: "Osc1 Semi", type: "int", min: 16, max: 112 },
            { key: "bank_index", name: "Bank",     type: "int", min: 0, max: 0 },
            { key: "ui_scroll",  name: "Scroll",   type: "int", min: 0, max: 9 },
            { key: "rom",        name: "ROM",      type: "enum", options: ["A", "B", "C"] },
        ]),
        "synth:ui_hierarchy": JSON.stringify({
            levels: {
                root: {
                    knobs: ["cutoff", "dupe"],
                    params: [
                        { key: "bank_index", label: "Bank" },
                        { key: "ui_scroll",  label: "Scroll" },
                        { level: "osc",      label: "Oscillators" },
                        { level: "settings", label: "Settings" },
                    ],
                },
                osc: {
                    knobs: ["pw"],
                    params: [
                        { key: "pw",   label: "Osc1 PW" },
                        { key: "wave", label: "Osc1 Wave" },
                        { key: "semi", label: "Osc1 Semi" },
                        { key: "dupe", label: "Dupe" },
                    ],
                },
                settings: { knobs: [], params: [{ key: "rom", label: "ROM" }] },
            },
        }),
        "synth:cutoff": "64", "synth:dupe": "0", "synth:pw": "0",
        "synth:wave": "0", "synth:semi": "64", "synth:bank_index": "0",
        "synth:ui_scroll": "0", "synth:rom": "0",
    },

    /* Ten extras on one level → the level spans two pages: bare name, then " - 2". */
    hier_params_overflow: {
        "synth:name": "Overflow",
        "synth:chain_params": JSON.stringify(
            ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map(k =>
                ({ key: k, name: k.toUpperCase(), type: "int", min: 0, max: 127 })),
        ),
        "synth:ui_hierarchy": JSON.stringify({
            levels: {
                root: {
                    knobs: ["a", "b"],
                    params: ["c", "d", "e", "f", "g", "h", "i", "j"].map(k => ({ key: k, label: k })),
                },
            },
        }),
        ...Object.fromEntries(["a","b","c","d","e","f","g","h","i","j"].map(k => [`synth:${k}`, "0"])),
    },
```

Add to `browser-test/logic.mjs` (after the existing hierarchy tests near line
260, reusing the file's `bankNames(m)` helper):

```js
/* ── params[] extras: the osirus Preset/Bank/ROM gap ─────────────────────── */

_log('\nTest: level params[] entries render after that level\'s knobs');
{
    const m = bootModel(MOCK_SYNTHS.hier_params_extras);
    const keysOf = (pg) => {
        const layout = m.dumpLayout();
        return layout.params.slice(pg * 8, pg * 8 + 8).filter(Boolean).map(p => p.key);
    };
    const names = bankNames(m);
    eq('extras: page 0 = Main',        names[0], 'Main');
    eq('extras: page 1 = Oscillators', names[1], 'Oscillators');
    eq('extras: page 2 = Settings',    names[2], 'Settings');
    eq('extras: root keeps its knobs', JSON.stringify(keysOf(0)), JSON.stringify(['cutoff', 'dupe']));
    eq('extras: osc knobs then params, deduped',
        JSON.stringify(keysOf(1)), JSON.stringify(['pw', 'wave', 'semi']));
    eq('extras: settings renders its params-only key',
        JSON.stringify(keysOf(2)), JSON.stringify(['rom']));
    const all = m.dumpLayout().params.filter(Boolean).map(p => p.key);
    eq('extras: ui_* key never rendered',      all.includes('ui_scroll'), false);
    eq('extras: degenerate min==max skipped',  all.includes('bank_index'), false);
    eq('extras: no key rendered twice',        all.length, new Set(all).size);
}

_log('\nTest: a level overflowing 8 slots numbers from " - 2"');
{
    const names = bankNames(bootModel(MOCK_SYNTHS.hier_params_overflow));
    eq('overflow: page 0 keeps the bare name', names[0], 'Main');
    eq('overflow: page 1 is " - 2"',           names[1], 'Main - 2');
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | grep -E "extras:|overflow:"`
Expected: FAIL — `extras: settings renders its params-only key` (Settings page
does not exist today), `extras: osc knobs then params` (only `pw`), and
`overflow: page 0 keeps the bare name` (today it is `Main - 1`).

- [ ] **Step 3: Add `paramKeys` and the `extras` hook to `hierarchy-walk.ts`**

```ts
export interface WalkOptions {
    /* params[]-only keys to append to a level's knob row. hierarchy.ts owns the
     * filtering (dedupe, preset list key, ui_*, degenerate ranges) because only
     * it holds chain_params metadata; the walk just asks, in visit order, and
     * must call this exactly once per level so the caller's dedupe stays sound. */
    extras?: (lvl: WalkLevel) => string[];
}

export function paramKeys(lvl: WalkLevel | undefined): string[] {
    return (lvl?.params ?? [])
        .map(p => (typeof p === 'string' ? p : p.key ?? null))
        .filter((k): k is string => k !== null);
}
```

In `buildLevelPages`, take `opts: WalkOptions = {}` as a third argument and
replace the render block inside `visit`:

```ts
        const name = nameOf(key, lvl);
        const keys = knobKeys(lvl);
        const sig  = keys.join(' ');
        /* A `children` level that re-lists its parent's knobs is a duplicate
         * page — but it may still own params[] entries nothing else consumed,
         * so ask for extras either way and render them alone when the knob row
         * is the duplicate. */
        const dup     = keys.length > 0 && rendered.has(sig);
        const extras  = opts.extras ? opts.extras(lvl) : [];
        const pageKeys = dup ? extras : [...keys, ...extras];
        if (pageKeys.length > 0) {
            if (!dup) rendered.add(sig);
            out.push({ name: prefix ? prefix + '/' + name : name, keys: pageKeys });
        }
```

- [ ] **Step 4: Build the extras filter in `hierarchy.ts` and drop the `- 1` suffix**

In the generic path, right after `allKnobKeys` is built (move that block above
the root-page construction so the walk and the root share it):

```ts
    /* Every knobs[] key in every level, so a params[] entry that merely re-lists
     * a knob is not rendered twice. Grows as each level's extras are consumed —
     * a key belongs to exactly one page, the first level that declares it. */
    const seen = new Set<string>(allKnobKeys);

    /* A numeric param the module reports as unturnable (max <= min) is a stub —
     * osirus publishes bank_index 0..0 until its ROM lists the banks. Rendering
     * it would give a dead knob; the async re-resolve (meta-retry.ts) rebuilds
     * the pages once the module reports a real range. Enums are exempt: their
     * range comes from the option list, not min/max. */
    function renderableExtra(cp: RawMeta | undefined): boolean {
        if (!cp) return true;                       // no metadata → meta-infer widens it
        if (cp.type === 'enum' || (cp.options?.length ?? 0) > 0) return true;
        return !(cp.min != null && cp.max != null && cp.max <= cp.min);
    }

    const extrasOf = (lvl: HierLevel): string[] => {
        const out: string[] = [];
        for (const k of paramKeys(lvl as WalkLevel)) {
            if (seen.has(k) || k === listParam || k.startsWith('ui_')) continue;
            if (!renderableExtra(cpMap[k])) continue;
            seen.add(k);
            out.push(k);
        }
        return out;
    };
```

Append root's extras to its page and pass the hook to the walk. ⚠️ `extrasOf`
mutates `seen`, so each level must be asked exactly **once** — bind root's
result to a variable rather than calling it twice in one condition:

```ts
    const rootExtras = extrasOf(rootLevel);
    if (rootKeys.length > 0 || rootExtras.length > 0) addLevel('Main', [...rootKeys, ...rootExtras]);

    const rootLevelKey = allLevels['root'] ? 'root' : Object.keys(allLevels)[0];
    for (const page of buildLevelPages(allLevels, rootLevelKey, { extras: extrasOf })) {
        addLevel(page.name, page.keys);
    }
```

Then change `addLevel`'s naming so page 1 keeps the bare label:

```ts
    function addLevel(label: string, keys: string[]): void {
        const pages = Math.max(1, Math.ceil(keys.length / KNOBS_PER_PAGE));
        for (let i = 0; i < pages; i++) {
            // Page 1 keeps the plain level name: extras make many single-page
            // levels multi-page, and suffixing page 1 would rename every
            // module's first page for no reason.
            addPage(i === 0 ? label : label + ' - ' + (i + 1),
                keys.slice(i * KNOBS_PER_PAGE, (i + 1) * KNOBS_PER_PAGE));
        }
    }
```

Imports to add in `hierarchy.ts`: `paramKeys`, type `WalkLevel`, `WalkOptions`
from `./hierarchy-walk.js`; `RawMeta` from `./param-build.js`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run typecheck && npm run build:browser && node browser-test/logic.mjs`
Expected: 0 failures, including all 10 new assertions.

- [ ] **Step 6: Prove the tests have teeth**

Temporarily change `extrasOf` to `return []`. Run `node browser-test/logic.mjs`
— expect the extras assertions to fail. Restore. Temporarily drop the
`renderableExtra` call — expect `extras: degenerate min==max skipped` to fail.
Restore, rebuild.

- [ ] **Step 7: Regenerate the fleet snapshot and review it module by module**

```bash
cp browser-test/dump-expect.json /tmp/dump-expect.before.json
node browser-test/dump-replay.mjs --update
node browser-test/dump-replay.mjs
node scripts/report-page-diff.mjs /tmp/dump-expect.before.json | tee /tmp/page-diff.txt
```
Expected: `dump-replay` 0 failures. In `page-diff.txt`, verify (a) no module
**lost** a page or a shown key, and (b) the 12 config-path modules listed in
Global Constraints appear with no change at all.

If `dump-replay` reports a short-name collision on a **new** page, look at the
two labels: if they are genuinely identical upstream, add
`<key>::<pageName>` to `KNOWN_COLLIDING_PAGES` with a comment naming the
module's duplicate labels; otherwise it is a `dedupShortNames` bug — fix that
instead of whitelisting.

- [ ] **Step 8: Add the reachability invariant to `dump-replay.mjs`**

In `checkInvariants`, after the existing per-param loop:

```js
    /* Every key a module declares in a level's params[] must land on a page —
     * that reachability is the whole point of the extras pass, and a snapshot
     * alone would happily freeze a regression in place. */
    const declared = new Set();
    for (const lvl of Object.values(entry.ui_hierarchy?.levels ?? {})) {
        for (const p of (lvl.params ?? [])) {
            const k = typeof p === 'string' ? p : p.key;
            if (k && !k.startsWith('ui_')) declared.add(k);
        }
    }
    const shownKeys = new Set(snap.shownKeys);
    const unreachable = [...declared].filter(k => !shownKeys.has(k) && !UNREACHABLE_OK.has(`${key}::${k}`));
    check(`${key}: all declared params reachable (missing: ${unreachable.join(',')})`,
        unreachable.length === 0);
```

`checkInvariants` needs the dump entry — change its signature to
`checkInvariants(key, model, snap, entry)` and pass `entry` at the call site
(around line 181). Declare the allow-list above `KNOWN_COLLIDING_PAGES`:

```js
/* Keys deliberately not rendered: the module reports an unturnable range
 * (max <= min), so a knob would be dead. hierarchy.ts:renderableExtra skips
 * them and the async re-resolve picks them up if the module widens the range. */
const UNREACHABLE_OK = new Set([
    'sound_generator--osirus::bank_index',
]);
```

Populate `UNREACHABLE_OK` from the actual run — for each failure, confirm the
key really is degenerate in the dump before adding it, and record why.

- [ ] **Step 9: Run all local suites**

Run: `npm test`
Expected: `logic`, `dump-replay`, `app-loop`, `perf` pass. `screenshot` may fail
on modules whose page names changed — that is Task 6; note the failing scenes
and continue.

- [ ] **Step 10: Commit**

```bash
git add src/model/hierarchy.ts src/model/hierarchy-walk.ts \
        browser-test/logic.mjs browser-test/mock-synth.mjs \
        browser-test/dump-replay.mjs browser-test/dump-expect.json
git commit -m "Render a level's params[] entries after its knobs"
```

---

### Task 3: Page-first read-back (keeps values fresh as pages grow)

`refreshOneParam` round-robins the whole `knobParams` array one param per tick,
so Task 2's ~40 % bigger arrays would slow every on-screen value. Interleave a
current-page cursor with the global one — **still one `shadow_get_param` per
tick**, so the IPC budget is untouched.

**Files:**
- Modify: `src/model/store.ts:210-255`
- Modify: `src/model/state.ts`
- Test: `browser-test/logic.mjs`, `browser-test/perf.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ModelState.refreshPageCursor: number`.

- [ ] **Step 1: Write the failing test**

Add to `browser-test/logic.mjs`:

```js
/* ── read-back visits the current page fast regardless of module size ────── */

_log('\nTest: refresh cursor reaches the current page within 16 ticks');
{
    const m = bootModel(MOCK_SYNTHS.hier_params_overflow);
    m.changePage(1);                       // page 1 = keys c..j (off the front of the array)
    const reads = [];
    const realGet = globalThis.shadow_get_param;
    globalThis.shadow_get_param = (slot, key) => { reads.push(key); return realGet(slot, key); };
    for (let i = 0; i < 16; i++) m.tick();
    globalThis.shadow_get_param = realGet;

    const pageKeys = m.dumpLayout().params.slice(8, 16).filter(Boolean).map(p => p.key);
    const missed = pageKeys.filter(k => !reads.includes('synth:' + k));
    eq('refresh: every current-page param read within 16 ticks', missed.join(','), '');
    const perTick = reads.length / 16;
    ok(`refresh: ${perTick.toFixed(2)} reads/tick (budget 2)`);
    eq('refresh: no more than 2 reads per tick on average', perTick <= 2, true);
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | grep "refresh:"`
Expected: FAIL — `every current-page param read within 16 ticks` lists the page-1
keys, because the global cursor is still walking page 0.

- [ ] **Step 3: Implement the interleaved cursor**

Add to `ModelState` (`state.ts`) next to `refreshParamCursor`:

```ts
    /* Cursor over the CURRENT page's 8 slots. Interleaved with
     * refreshParamCursor (one read per tick, alternating) so on-screen values
     * converge in ~16 ticks no matter how many pages the module has, while
     * off-page values still creep forward for the next page switch. */
    refreshPageCursor:   number;
```
and `refreshPageCursor: 0,` in `createModelState`.

In `store.ts`, extract the existing body of `refreshOneParam` (everything after
the cursor arithmetic) into `refreshAt(s: ModelState, i: number): void`, then:

```ts
export function refreshOneParam(s: ModelState, tickCount: number): void {
    if (s.knobParams.length === 0) return;
    if (tickCount - s.lastDeltaTick < REFRESH_SUPPRESS_TICKS) return;

    if (tickCount % 2 === 0) {
        const local = s.refreshPageCursor % KNOBS_PER_PAGE;
        s.refreshPageCursor = (local + 1) % KNOBS_PER_PAGE;
        refreshAt(s, s.knobPage * KNOBS_PER_PAGE + local);
        return;
    }
    const i = s.refreshParamCursor % s.knobParams.length;
    s.refreshParamCursor = (i + 1) % s.knobParams.length;
    refreshAt(s, i);
}
```

`refreshAt` must return early when `i >= s.knobParams.length` or the entry is
null (a partly-filled page pads with nulls). Import `KNOBS_PER_PAGE` in
`store.ts` if it is not already imported.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node browser-test/logic.mjs 2>&1 | grep "refresh:"` — expect all pass.

- [ ] **Step 5: Add the perf assertion**

In `browser-test/perf.mjs`, in the helm block (around line 234), extend the
existing tick loop to total the reads as well as track the max:

```js
    let maxGets = 0, totalGets = 0;
    for (let i = 0; i < 70; i++) {
        getParamCount = 0;
        model.tick();
        totalGets += getParamCount;
        if (getParamCount > maxGets) maxGets = getParamCount;
    }
    check('helm: max shadow_get_param calls per tick', maxGets, GET_PARAM_PER_TICK_MAX);
    /* The page-first cursor splits its reads between the current page and the
     * global sweep — it must not ADD IPC, whatever the module's page count. */
    check('helm: avg shadow_get_param calls per tick',
          +(totalGets / 70).toFixed(2), GET_PARAM_PER_TICK_MAX);
```

The `check('helm: buildViewModel median', …)` assertion below it now runs on a
34-page helm (up from 30) — confirm it still passes rather than raising
`VM_MEDIAN_MS_MAX`.

- [ ] **Step 6: Run the suites**

Run: `node browser-test/perf.mjs && node browser-test/dump-replay.mjs`
Expected: 0 failures in both.

- [ ] **Step 7: Prove the test has teeth**

Revert `refreshOneParam` to the old single-cursor version, run
`node browser-test/logic.mjs` — the 16-tick assertion must fail. Restore.

- [ ] **Step 8: Commit**

```bash
git add src/model/store.ts src/model/state.ts browser-test/logic.mjs browser-test/perf.mjs
git commit -m "Refresh the current page first so read-back does not scale with page count"
```

---

### Task 4: Shift + jog skips whole levels

**Files:**
- Modify: `src/model/state.ts`, `src/model/hierarchy.ts`, `src/model/index.ts`,
  `src/lfo/model.ts`, `src/midi/router.ts:470-490`
- Test: `browser-test/logic.mjs`, `browser-test/app-loop.mjs`

**Interfaces:**
- Consumes: `addLevel`/`addPage` from Task 2.
- Produces:
  ```ts
  ModelState.bankGroups: number[];              // one entry per page
  model.changePageGroup(delta: number): void;   // on both the param and LFO models
  ```

- [ ] **Step 1: Write the failing test**

Add to `browser-test/logic.mjs`:

```js
/* ── shift+jog jumps level to level, not page to page ────────────────────── */

_log('\nTest: changePageGroup skips a level\'s overflow pages');
{
    const m = bootModel(MOCK_SYNTHS.hier_params_overflow_two_levels);
    eq('group: starts on page 0',            m.getKnobPage(), 0);
    m.changePageGroup(1);
    eq('group: +1 lands on the next level',  m.getKnobPage(), 2);   // skips "Main - 2"
    m.changePageGroup(1);
    eq('group: clamps at the last level',    m.getKnobPage(), 2);
    m.changePageGroup(-1);
    eq('group: -1 returns to the level head', m.getKnobPage(), 0);
    m.changePage(1);
    m.changePageGroup(-1);
    eq('group: -1 from mid-level goes to that level\'s head', m.getKnobPage(), 0);
}
```

Add the mock it needs to `browser-test/mock-synth.mjs`:

```js
    /* Two levels, the first spanning two pages — the shape shift+jog exists for. */
    hier_params_overflow_two_levels: {
        "synth:name": "Groups",
        "synth:chain_params": JSON.stringify(
            ["a","b","c","d","e","f","g","h","i","j","k"].map(x =>
                ({ key: x, name: x.toUpperCase(), type: "int", min: 0, max: 127 })),
        ),
        "synth:ui_hierarchy": JSON.stringify({
            levels: {
                root: {
                    knobs: ["a", "b"],
                    params: [
                        ...["c","d","e","f","g","h","i","j"].map(x => ({ key: x, label: x })),
                        { level: "fx", label: "Effects" },
                    ],
                },
                fx: { knobs: ["k"], params: [{ key: "k", label: "k" }] },
            },
        }),
        ...Object.fromEntries(["a","b","c","d","e","f","g","h","i","j","k"]
            .map(x => [`synth:${x}`, "0"])),
    },
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | grep "group:"`
Expected: FAIL — `m.changePageGroup is not a function`.

- [ ] **Step 3: Record the group id per page**

`state.ts`: add `bankGroups: number[];` beside `bankNames` and `bankGroups: [],`
in the factory.

`hierarchy.ts`: the page accumulator entry gains a group, filled by `addLevel`:

```ts
    const bankEntries: Array<{ name: string; keys: (string | null)[]; group: number }> = [];
    /* Pages that came from the same hierarchy level share a group, so shift+jog
     * can skip a level's overflow pages in one gesture. */
    let nextGroup = 0;

    function addPage(name: string, keys: (string | null)[], group: number): void {
        const padded = keys.slice(0, KNOBS_PER_PAGE);
        while (padded.length < KNOBS_PER_PAGE) padded.push(null);
        bankEntries.push({ name, keys: padded, group });
    }

    function addLevel(label: string, keys: string[]): void {
        const group = nextGroup++;
        const pages = Math.max(1, Math.ceil(keys.length / KNOBS_PER_PAGE));
        for (let i = 0; i < pages; i++) {
            addPage(i === 0 ? label : label + ' - ' + (i + 1),
                keys.slice(i * KNOBS_PER_PAGE, (i + 1) * KNOBS_PER_PAGE), group);
        }
    }
```

The dedicated `addPage('Preset', [listParam!])` call becomes
`addPage('Preset', [listParam!], nextGroup++)`.

After the accumulator loop, alongside `s.bankNames`:
```ts
    s.bankGroups = bankEntries.map(e => e.group);
```

In the **config path** (which returns early), one bank = one page = one group:
```ts
    s.bankGroups = s.moduleConfig.banks.map((_, i) => i);
```
Place it next to the existing `s.knobValues = …` initialisation in that branch.
Also set `s.bankGroups = []` in the reset block at the top of `loadHierarchy`
(next to `s.bankNames = []`).

- [ ] **Step 4: Implement `changePageGroup`**

`src/model/index.ts`, right after `changePage`:

```ts
        /* Shift+jog: jump to the head of the previous/next level. From mid-level,
         * a backward jump lands on the current level's own head first — the same
         * "back out to the section start" feel as a text editor's paragraph jump. */
        changePageGroup(delta: number): void {
            if (s.enumOverlay) return;
            const groups = s.bankGroups;
            const n = numBanks();
            if (n === 0 || groups.length !== n) return this.changePage(delta);
            const here = groups[s.knobPage];
            let next = s.knobPage;
            if (delta > 0) {
                while (next < n - 1 && groups[next] === here) next++;
            } else {
                while (next > 0 && groups[next] === here) next--;
                const target = groups[next];
                while (next > 0 && groups[next - 1] === target) next--;
            }
            mlog('changePageGroup delta=' + delta + ' ' + s.knobPage + '→' + next + '/' + n);
            if (next !== s.knobPage) { s.knobPage = next; s.dirty = true; }
        },
```

⚠️ `this` is not bound in these object-literal methods elsewhere in the file —
replace `this.changePage(delta)` with the inline clamp instead:

```ts
            if (n === 0 || groups.length !== n) {
                const clamped = Math.max(0, Math.min(n - 1, s.knobPage + delta));
                if (clamped !== s.knobPage) { s.knobPage = clamped; s.dirty = true; }
                return;
            }
```

`src/lfo/model.ts`: add next to its `changePage` so the router can call the
method on either model without a type guard:

```ts
        /* The LFO page has no level structure — shift+jog behaves like a plain
         * page turn here. */
        changePageGroup(delta: number): void { this.changePage(delta); },
```
If that object literal does not use `this` elsewhere, extract the page-change
body into a local `function step(delta: number)` and call it from both.

- [ ] **Step 5: Route shift+jog**

`src/midi/router.ts`, in the `VIEW_KNOBS` branch of the `MoveMainKnob` handler:

```ts
            } else if (appState.currentView === VIEW_KNOBS) {
                const dir = delta > 0 ? 1 : -1;
                const m = activeModel();
                /* Shift+jog is an explicit "next section" gesture, so it skips the
                 * step-page-at-bank-0 interplay a plain jog has. */
                if (appState.shiftHeld) {
                    m?.changePageGroup(dir);
                } else if (stepPageAvailable()) {
                    const onBank0 = (m?.getKnobPage?.() ?? 0) === 0;
                    if (stepPageState.selected) {
                        if (dir > 0) setStepPageSelected(false);
                    } else if (dir < 0 && onBank0) {
                        setStepPageSelected(true);
                    } else {
                        m?.changePage(dir);
                    }
                } else {
                    m?.changePage(dir);
                }
            } else if (appState.currentView === VIEW_BROWSE) {
```

- [ ] **Step 6: Add the router-level test**

Add at the end of `browser-test/app-loop.mjs`, using the file's own helpers
(`sendMidi`, `advance`, `eq`, `env`, `appState`). `resetApp()` boots mrdrums (a
config-path module), so this test boots its own generic module instead:

```js
/* ── shift+jog skips a whole level through the real router ───────────────── */

_log('\napp-loop: shift+jog skips a level\'s overflow pages');
{
    engine.reset();
    env.setParams(MOCK_SYNTHS.hier_params_overflow_two_levels);
    resetSeqState();
    resetSeqEngine();
    globalThis.init();
    const m = appState.trackModels[0][1];
    m.reload();
    advance(12);
    appState.currentView = VIEW_KNOBS;

    eq('shift+jog: 3 pages (Main, Main - 2, Effects)', m.getBankCount(), 3);

    sendMidi([0xB0, globalThis.MoveMainKnob, 1]);       // plain jog CW
    advance(1);
    eq('shift+jog: plain jog steps one page', m.getKnobPage(), 1);

    sendMidi([0xB0, globalThis.MoveShift, 127]);        // Shift down
    sendMidi([0xB0, globalThis.MoveMainKnob, 127 - 1]); // jog CCW (decodeDelta → -1)
    advance(1);
    eq('shift+jog: back jumps to the level head', m.getKnobPage(), 0);

    sendMidi([0xB0, globalThis.MoveMainKnob, 1]);       // jog CW, still shifted
    advance(1);
    eq('shift+jog: forward skips the overflow page', m.getKnobPage(), 2);
    sendMidi([0xB0, globalThis.MoveShift, 0]);          // Shift up
}
```

`VIEW_KNOBS` is already imported at the top of the file. If the sequencer's
step-page state intercepts the jog in this harness, clear it the same way the
neighbouring sequencer tests do before sending the jog.

- [ ] **Step 7: Run the suites**

Run: `npm run typecheck && npm run build:browser && node browser-test/logic.mjs && node browser-test/app-loop.mjs && node browser-test/dump-replay.mjs`
Expected: 0 failures.

- [ ] **Step 8: Prove the tests have teeth**

Make the router call `changePage` instead of `changePageGroup` under shift —
`app-loop.mjs` must fail. Restore.

- [ ] **Step 9: Commit**

```bash
git add src/model/state.ts src/model/hierarchy.ts src/model/index.ts \
        src/lfo/model.ts src/midi/router.ts \
        browser-test/logic.mjs browser-test/mock-synth.mjs browser-test/app-loop.mjs
git commit -m "Shift+jog skips to the next hierarchy level"
```

---

### Task 5: Re-resolve asynchronous preset/enum metadata

osirus publishes `preset_count = 0` and `rom_index.options = ["(loading)"]`
until its ROM finishes loading, and movy reads both exactly once — so the Preset
knob is dropped forever and ROM shows a placeholder. Retry on the existing name
poll, bounded and latching.

**Files:**
- Create: `src/model/meta-retry.ts`
- Modify: `src/model/state.ts`, `src/model/constants.ts`, `src/model/hierarchy.ts`,
  `src/model/tick.ts`
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Consumes: `ModelState` fields from Tasks 3–4.
- Produces:
  ```ts
  // src/model/meta-retry.ts
  export function isPlaceholderOptions(options: string[] | null | undefined): boolean;
  /* Returns true when it spent this tick's IPC budget on a metadata probe
   * (the caller then skips refreshOneParam so the tick stays within 2 reads). */
  export function retryUnsettledMeta(s: ModelState): boolean;
  // src/model/state.ts
  ModelState.metaRetries: number;       // counts probes; META_RETRY_LIMIT latches off
  ModelState.presetDeclared: boolean;   // root declared list_param + count_param
  // src/model/constants.ts
  export const META_RETRY_LIMIT = 8;    // ~8 name polls of grace after a module loads
  ```

- [ ] **Step 1: Write the failing test**

Add to `browser-test/mock-synth.mjs`:

```js
    /* osirus's shape mid-ROM-load: the preset list is empty and the ROM enum
     * carries a single "(loading)" option. env.setParams() can rewrite these
     * mid-test to simulate the ROM landing. */
    hier_async_meta: {
        "synth:name": "Loader",
        "synth:chain_params": JSON.stringify([
            { key: "cutoff", name: "Cutoff", type: "int", min: 0, max: 127 },
            { key: "rom",    name: "ROM",    type: "enum", options: ["(loading)"] },
        ]),
        "synth:ui_hierarchy": JSON.stringify({
            levels: {
                root: {
                    list_param: "preset", count_param: "preset_count", name_param: "preset_name",
                    knobs: ["cutoff"],
                    params: [{ key: "rom", label: "ROM" }],
                },
            },
        }),
        "synth:preset_count": "0",
        "synth:cutoff": "64",
        "synth:rom": "0",
    },
```

Add to `browser-test/logic.mjs`:

```js
/* ── async metadata: preset list + enum options that arrive after load ───── */

_log('\nTest: preset count and enum options are re-resolved when they land');
{
    const m = bootModel(MOCK_SYNTHS.hier_async_meta);
    const romOf = () => m.dumpLayout().params.filter(Boolean).find(p => p.key === 'rom');
    eq('async: no Preset knob while the count is 0',
        m.dumpLayout().params.filter(Boolean).some(p => p.renderStyle === 'preset'), false);
    eq('async: ROM shows the placeholder at first',
        JSON.stringify(romOf().options), JSON.stringify(['(loading)']));

    // The ROM lands: preset list and real options appear.
    env.setParams({
        ...MOCK_SYNTHS.hier_async_meta,
        "synth:preset_count": "3",
        "synth:preset_names": JSON.stringify(['Init', 'Bass', 'Lead']),
        "synth:chain_params": JSON.stringify([
            { key: "cutoff", name: "Cutoff", type: "int", min: 0, max: 127 },
            { key: "rom",    name: "ROM",    type: "enum", options: ["Virus A", "Virus B", "Virus C"] },
        ]),
    });
    for (let i = 0; i < 3 * NAME_POLL_TICKS; i++) m.tick();

    const preset = m.dumpLayout().params.filter(Boolean).find(p => p.renderStyle === 'preset');
    eq('async: Preset knob appears once the count is non-zero', !!preset, true);
    eq('async: Preset knob carries the real names',
        JSON.stringify(preset.options), JSON.stringify(['Init', 'Bass', 'Lead']));
    eq('async: ROM options are re-read',
        JSON.stringify(romOf().options), JSON.stringify(['Virus A', 'Virus B', 'Virus C']));
}

_log('\nTest: the async retry latches off and does not poll forever');
{
    const m = bootModel(MOCK_SYNTHS.hier_async_meta);   // never settles
    let reads = 0;
    const realGet = globalThis.shadow_get_param;
    globalThis.shadow_get_param = (slot, key) => {
        if (key === 'synth:preset_count' || key === 'synth:chain_params') reads++;
        return realGet(slot, key);
    };
    for (let i = 0; i < 40 * NAME_POLL_TICKS; i++) m.tick();
    globalThis.shadow_get_param = realGet;
    eq('async: probes stop at META_RETRY_LIMIT', reads <= META_RETRY_LIMIT + 2, true);
}
```

Import the two constants at the top of `logic.mjs`:
```js
import { NAME_POLL_TICKS, META_RETRY_LIMIT } from '../dist/esm/model/constants.js';
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | grep "async:"`
Expected: FAIL on `Preset knob appears…`, `Preset knob carries the real names`
and `ROM options are re-read` (the module is read once and never revisited).

- [ ] **Step 3: Record what "unsettled" means at load time**

`constants.ts`:
```ts
/* Probes of asynchronous module metadata (preset lists, enum option sets that
 * arrive after load) before movy stops asking. One probe per name poll. */
export const META_RETRY_LIMIT = 8;
```

`state.ts`: add and initialise
```ts
    /* A module can publish its preset list and enum options AFTER load (osirus
     * scans its ROM asynchronously). These drive a bounded re-probe; both reset
     * on a genuine module change, like paramGestures. */
    metaRetries:         number;
    presetDeclared:      boolean;
```
(`metaRetries: 0,` and `presetDeclared: false,` in the factory.)

`hierarchy.ts`, in the generic path where the preset is detected:
```ts
    s.presetDeclared = !!(rootLevel.list_param && rootLevel.count_param);
```
and in the reset block at the top of `loadHierarchy`, alongside the existing
`if (s.moduleId !== prevModuleId)` clause, add `s.metaRetries = 0;` **inside**
that clause — a same-module reload (which the retry itself triggers) must not
reset the budget, or the probe loops forever.
Set `s.presetDeclared = false;` in the unconditional reset block.

- [ ] **Step 4: Implement the retry**

Create `src/model/meta-retry.ts`:

```ts
import type { ModelState } from './state.js';
import { META_RETRY_LIMIT } from './constants.js';
import { mlog } from '../log.js';

/* A module that has not finished loading publishes a one-entry option list of
 * the form "(loading)" / "(scanning)". A real single-option enum is vanishingly
 * rare and would only cost one wasted probe. */
export function isPlaceholderOptions(options: string[] | null | undefined): boolean {
    return !!options && options.length === 1 && /^\(.*\)$/.test(String(options[0]).trim());
}

function presetPending(s: ModelState): boolean {
    return s.presetDeclared && !s.knobParams.some(p => p?.renderStyle === 'preset');
}

function placeholderEnum(s: ModelState): boolean {
    return s.knobParams.some(p => p?.type === 'enum' && isPlaceholderOptions(p.options));
}

/* One probe per call, at the name-poll cadence. Returns true when a probe was
 * made so the caller can skip its own read and keep the tick within the 2-IPC
 * budget perf.mjs enforces. */
export function retryUnsettledMeta(s: ModelState): boolean {
    if (s.metaRetries >= META_RETRY_LIMIT) return false;
    const wantPreset = presetPending(s);
    if (!wantPreset && !placeholderEnum(s)) {
        s.metaRetries = META_RETRY_LIMIT;   // settled — latch off
        return false;
    }
    s.metaRetries++;

    if (wantPreset) {
        const raw = shadow_get_param(s.activeSlot, s.componentKey + ':preset_count');
        if (raw && parseInt(raw) > 0) {
            mlog('meta-retry: preset list settled (' + raw + ')');
            s.hierarchyKey = '';            // processTick rebuilds on the next tick
        }
        return true;
    }

    const raw = shadow_get_param(s.activeSlot, s.componentKey + ':chain_params');
    if (raw) {
        try {
            const arr = JSON.parse(raw) as Array<{ key?: string; options?: string[] }>;
            const settled = arr.some(cp => cp.key
                && s.knobParams.some(p => p?.key === cp.key && isPlaceholderOptions(p.options))
                && !isPlaceholderOptions(cp.options));
            if (settled) {
                mlog('meta-retry: enum options settled');
                s.hierarchyKey = '';
            }
        } catch { /* a malformed republish is just another unsettled poll */ }
    }
    return true;
}
```

`tick.ts`, in the poll block, and guarding the refresh:

```ts
    let probed = false;
    if (--s.pollCountdown <= 0) {
        s.pollCountdown = NAME_POLL_TICKS;
        pollModuleName(s);
        refreshModulatedKeys(s);
        probed = retryUnsettledMeta(s);
    }

    if (!probed && s.knobParams.length > 0) {
        const t0 = Date.now();
        refreshOneParam(s, _perfTickCount);
        const ms = Date.now() - t0;
        if (ms > _perfRefreshMaxMs) _perfRefreshMaxMs = ms;
    }
```

- [ ] **Step 4a: Keep `knobPage` valid after a rebuild**

A rebuild can shrink the page count (an enum that settles to fewer options
cannot, but a preset page appearing shifts nothing — a module that *drops*
params can). In `processTick`'s reload branch, replace the unconditional
`s.knobPage = 0` with:

The current branch (`tick.ts:14-20`) zeroes `knobPage` **before**
`loadHierarchy`. Move that decision after the load and key it off the module id,
which `loadHierarchy` refreshes:

```ts
    if (s.hierarchyKey !== s.activeModuleName) {
        const prevModuleId = s.moduleId;
        loadHierarchy(s);
        /* A metadata re-resolve rebuilds the SAME module — keep the user on the
         * page they were reading. Only a real module change starts over. */
        if (s.moduleId !== prevModuleId || s.knobPage >= s.bankNames.length) s.knobPage = 0;
        s.refreshParamCursor = 0;
        refreshModulatedKeys(s);   // populate LFO-target cache for the new module
    }
```

Keep the rest of the branch's ordering exactly as it is.

Add a `logic.mjs` assertion for this, since it is easy to regress:

```js
_log('\nTest: a same-module rebuild keeps the current page');
{
    const m = bootModel(MOCK_SYNTHS.hier_params_overflow_two_levels);
    m.changePage(2);
    m.reload();
    m.tick(); m.tick();
    eq('rebuild: page survives a same-module reload', m.getKnobPage(), 2);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run typecheck && npm run build:browser && node browser-test/logic.mjs 2>&1 | grep "async:"`
Expected: all pass.

- [ ] **Step 6: Confirm the IPC budget still holds**

Run: `node browser-test/perf.mjs`
Expected: `max shadow_get_param calls per tick` still ≤ 2.

- [ ] **Step 7: Prove the tests have teeth**

Make `retryUnsettledMeta` return `false` immediately — the three `async:` settle
assertions must fail. Set `META_RETRY_LIMIT = 100000` — the latch assertion must
fail. Restore both.

- [ ] **Step 8: Commit**

```bash
git add src/model/meta-retry.ts src/model/state.ts src/model/constants.ts \
        src/model/hierarchy.ts src/model/tick.ts \
        browser-test/logic.mjs browser-test/mock-synth.mjs
git commit -m "Re-resolve preset lists and enum options that arrive after module load"
```

---

### Task 6: Screenshot baselines and user docs

**Files:**
- Modify: `browser-test/screenshot.mjs`, `browser-test/screenshots/baseline/*`
- Modify: `MANUAL.md`, `CHANGELOG.md`
- Modify: `docs/assets/*` (generated)

- [ ] **Step 1: Add scenes for the new states**

Three edits in `browser-test/screenshot.mjs`, matching the existing pattern:

1. Add to the `PRESETS` array (line 32-55), next to the other module scenes:
```js
    'params-overflow-page', 'params-extras-settings',
```

2. Add to the `BASE` map (line 61), which maps a scene to its mock synth:
```js
    'params-overflow-page':   'hier_params_overflow',
    'params-extras-settings': 'hier_params_extras',
```

3. Add to the `applyView` switch, next to the other `changePage` scenes:
```js
        // Overflow page: proves the " - 2" header and a full row of params[] extras.
        case 'params-overflow-page':   model.changePage(1); forceRender(); break;
        // A level that has NO knobs[] at all now gets a page from its params[].
        case 'params-extras-settings': model.changePage(2); forceRender(); break;
```

- [ ] **Step 2: Regenerate and review the baselines**

```bash
npm run build:browser
node browser-test/screenshot.mjs --update
node browser-test/screenshot.mjs
```
Expected: 0 failures. Open the two new PNGs under
`browser-test/screenshots/baseline/` and confirm the header reads `Main - 2` /
`Settings` and the labels are legible (no 5-char mush).

Any **pre-existing** scene that changed must be explained by the Task 2 naming
rule (a `X - 1` header becoming `X`). If a scene changed for any other reason,
stop and investigate before updating.

- [ ] **Step 3: Update `MANUAL.md`**

Two edits, matching the file's voice:

1. In the param-pages section, explain that a module's pages now carry every
   param the module publishes for that section, continuing onto `- 2` / `- 3`
   pages when a section has more than eight.
2. In the **Controls reference** tables (section 8), add the row:
   `Shift + Jog turn` — *Jump to the previous/next section (skips a section's
   extra pages)*.

Add the screenshot:
```bash
node scripts/make-doc-assets.mjs params-overflow-page
```
and reference `docs/assets/params-overflow-page.png` next to the explanation.

- [ ] **Step 4: Add a CHANGELOG entry**

Follow the existing format; cover the four user-visible changes: params-list
exposure, `- 2` page naming, shift+jog section skip, and asynchronous
preset/ROM resolution.

- [ ] **Step 5: Run everything**

Run: `npm test`
Expected: all five suites, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add browser-test/screenshot.mjs browser-test/screenshots MANUAL.md CHANGELOG.md docs/assets
git commit -m "Document and baseline the params-list pages and shift+jog"
```

---

### Task 7: Device verification

**Files:**
- Create: `scripts/probe-async-meta.mjs`
- Modify: `plans/2026-07-31-params-list-exposure-design.md` (record §6 findings)

- [ ] **Step 1: Check the device and the schwung stack**

```bash
ssh -o ConnectTimeout=3 ableton@move.local echo ok || echo "DEVICE OFFLINE"
ssh ableton@move.local "ps aux | grep -c '[s]chwung-manager'"
```
If the device is unreachable, **report `DEVICE OFFLINE — SKIPPING DEVICE TESTS`
to the user in CAPS** and stop this task (the plan's other tasks stand on the
local suites). If schwung-manager is not running, ask the user to open the
schwung manager on the Move — port 7700 only listens while it runs.

- [ ] **Step 2: Write the async-metadata probe**

Create `scripts/probe-async-meta.mjs`, modelled on `scripts/chain-params.mjs`
(same `ws://<host>:7700/ws/remote-ui` transport and `subscribe` message). It
must: subscribe to a slot, print `preset_count`, `preset_names`, the
`chain_params` entry for `rom_index` and for `bank_index` immediately, then
again after 15 s, and report whether `chain_params`/`ui_hierarchy` were
**republished** in between (a republish means movy could key the rebuild off the
message instead of polling).

Usage line to put in its header comment:
`node scripts/probe-async-meta.mjs <slot> [host]  # osirus must be on <slot>'s synth`

- [ ] **Step 3: Run the probe against osirus**

Load osirus on a track's synth slot:
```bash
node scripts/module-slot.mjs get 0 synth          # note the current module to restore it
node scripts/module-slot.mjs set 0 synth osirus
node scripts/probe-async-meta.mjs 0
```
Record the settled values in the design doc's §6 (replace the "required" list
with the measured numbers). Restore the slot afterwards with the module you
noted — **do not leave the user's set changed.**

- [ ] **Step 4: Act on what the probe shows**

- If `bank_index` settles to `max > 0`: nothing to do — Task 2's
  `renderableExtra` lets it through automatically on the rebuild. Remove
  `sound_generator--osirus::bank_index` from `UNREACHABLE_OK` only if a
  refreshed dump shows the new range; otherwise leave it with a comment saying
  the dump predates the ROM load.
- If it stays `0..0`: the module genuinely offers one bank. Leave it skipped and
  say so in the audit (Task 8) — a knob with one value is noise, not a feature.
- If `chain_params` is republished on ROM load: note it in the design doc as a
  cheaper future trigger; do **not** rewrite Task 5 (polling already works and
  is module-agnostic).

- [ ] **Step 5: Deploy and run the device suites**

```bash
./scripts/deploy.sh
./scripts/test.sh
./scripts/test-seq.sh
```
Expected: PASS on both. Then, with osirus on a slot, open movy and confirm on
the real screen:
```bash
node scripts/grab-screen.mjs /tmp/osirus-main.png
```
- the Settings level has a page carrying ROM with real Virus model names,
- shift+jog moves a whole level per detent,
- values on the visible page track the device.

- [ ] **Step 6: Commit**

```bash
git add scripts/probe-async-meta.mjs plans/2026-07-31-params-list-exposure-design.md
git commit -m "Probe and record osirus asynchronous metadata on device"
```

---

### Task 8: Per-module audit — verify the change actually helps each module

The generic rule is assumed to improve all 45 generic-path modules plus helm.
Verify it, module by module, and propose something better wherever it does not.

**Files:**
- Create: `docs/module-dump/params-exposure-audit.md`
- Modify: `docs/module-dump/SUMMARY.md` and `docs/module-dump/modules/*.json` (regenerated)
- Possibly modify: `src/model/hierarchy.ts` (a new exclusion rule), `src/modules/*.json`

- [ ] **Step 1: Regenerate the per-module layout docs**

```bash
npm run build:browser
node scripts/dump-movy-layout.mjs
```
This rewrites `docs/module-dump/modules/<category>--<id>.json` and `SUMMARY.md`
from the real model, so each module's post-change pages can be read directly.

- [ ] **Step 2: Produce the diff view**

```bash
node scripts/report-page-diff.mjs /tmp/dump-expect.before.json > /tmp/page-diff-final.txt
```
(`/tmp/dump-expect.before.json` was saved in Task 2 Step 7. If it is gone,
regenerate it from git: `git show HEAD~5:browser-test/dump-expect.json > /tmp/dump-expect.before.json`,
adjusting the revision to the commit before Task 2.)

- [ ] **Step 3: Classify every affected module**

Work through all 46 (45 dump modules + helm) from the design doc §7 table. For
each, read its new pages in `docs/module-dump/modules/*.json` and classify:

- **improved** — the new pages carry params a musician would want (waveforms,
  envelopes, FX depth, model/bank selectors).
- **neutral** — the params are real but rarely touched; pages are appended after
  the existing ones, so nothing gets in the way.
- **worse** — at least one of:
  - a param that cannot do anything useful on a knob (an internal index, a
    read-only status, a value the module ignores),
  - a page whose short names are unreadable or ambiguous,
  - a level whose page count grew so much that the existing pages are now hard
    to reach even with shift+jog,
  - a param whose range or type metadata is wrong enough to make the knob
    dangerous (jumps a whole set to a destructive state).

- [ ] **Step 4: Write the audit doc**

Create `docs/module-dump/params-exposure-audit.md` with a table of all 46
modules — `module | verdict | new pages | notes` — followed by a section per
**worse** verdict giving a concrete alternative:

- an **exclusion rule** in `renderableExtra` (only if it generalises — e.g.
  "params the module reports as read-only"; never a module-name special case),
- a **per-module config** in `src/modules/<id>.json` giving that module a
  hand-built layout (the mechanism the config path already provides), or
- an **upstream fix** — the module should move the param onto a `knobs[]` row or
  fix its metadata. Frame it as an upstream feature/PR against that module's
  repo, with no mention of movy internals
  (`feedback_upstream-not-patch`).

- [ ] **Step 5: Implement the fixes the audit calls for**

Apply only the generalisable ones in this task. For each change: add or update a
`logic.mjs` assertion first, implement, re-run
`node browser-test/dump-replay.mjs --update`, and re-check the diff.

Anything that needs an upstream change gets written up in the audit doc and
reported to the user — do not patch a third-party module from movy.

- [ ] **Step 6: Run everything, including the device**

```bash
npm test
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && ./scripts/test.sh || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```
Expected: all local suites 0 failures.

- [ ] **Step 7: Commit and push**

```bash
git add docs/module-dump browser-test/dump-expect.json src/model/hierarchy.ts \
        browser-test/logic.mjs
git commit -m "Audit params-list exposure across every affected module"
git push
```

- [ ] **Step 8: Report to the user**

Summarise: the verdict table (improved / neutral / worse counts), every module
that came out **worse** with the proposed alternative, anything left as an
upstream ask, and whether device verification ran or was skipped (in CAPS if the
device was offline).
