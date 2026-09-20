# SP-40 — the flag becomes two values, MOVY and SCHWUNG

Ledger: `docs/schwung-page-migration.md` lines 3078–3120 (SP-40 entry), 891–944
(SP-47, which needs this), 3122–3159 (SP-41, which needs SP-53/54/55 — not this
alone). Order 7, first item of the release-gate wave, release gate ✔, model
Sonnet.

This is a **planning document only**. No source file has been touched while
writing it. Everything below was read from the actual code on
`feat/sp-gate-items-40-51`, not reasoned from the ledger prose — every claim
carries a `file:line`.

---

## 0. The one naming trap that will regress a sibling if missed

**"body" means two unrelated things in this codebase, and only one of them is
being deleted.**

1. **The flag's middle VALUE**, `schwunggrid = 1`, whose renderer is
   `src/renderer/schwung-body.ts` (`drawKnobParamsSchwung`), gated by
   `schwungGridEnabled()` (`src/renderer/schwung-flag.ts:10`,
   `mode === 'body'`). **This is what SP-40 deletes.**
2. **The screen REGION** — the 47-row band below the header and bank bar,
   `GRID_BODY_RECT` (`src/renderer/layout.ts:32`) — and the helpers named for
   it: `schwungBodyFor` / `schwungBankFor` / `schwungChromeFor`
   (`src/app/tick.ts:157,214,246`), and the log tag `mlog('schwung-body ' + r)`
   (`src/app/tick.ts:166`) that `test-device/scenarios/page-lifecycle.ts:73`
   (`const BODY = 'schwung-body'`) and `scripts/measure-grid-cost.sh:96,241`
   grep for. **All of this stays.** It is the delegation-ownership machinery
   `page` mode runs on today (`src/app/page-owner.ts`), and it existed before
   the `body` flag value and is unrelated to it — `schwungBodyFor` takes a
   `PageOwner`, never asks `schwungGridMode()`, and returns a callback built
   from `owner.page`, which only `page` mode ever populates.

Do not "clean up" `schwungBodyFor`/`schwungBankFor`/`schwungChromeFor` or the
`'schwung-body'` log line while doing this item. They have nothing to do with
the flag value being removed.

---

## 1. Every value, every producer, every consumer

### The definition (the one producer of what the flag MEANS)

`src/seq/flags-def.ts:83-108`:

```ts
key: 'schwunggrid', name: 'Param Pages',
hint: 'Who draws module knobs. PAGE re-paginates.',
min: 0, max: 2, def: 0, labels: ['MOVY', 'DRAW', 'PAGE'], uiOnly: true,
```

No `release` (debug-only today — SP-47's job, not this one's). No
`revisedAt` (comment: "a brand-new key has no stored value anywhere" — true
when it was written; **no longer true**, which is the whole hazard this item
exists to close).

### The one place a number becomes a mode

`src/renderer/schwung-grid.ts`:
- `SchwungGridMode = 'off' | 'body' | 'page'` (line 26)
- `MODES: SchwungGridMode[] = ['off', 'body', 'page']` (line 32)
- `schwungGridMode()` (line 67-91): `MODES[flagValue('schwunggrid')] ?? 'off'`,
  gated by library availability and the version floor, with an `override` for
  tests/device and a cache-drop on mode change.
- `setSchwungGridMode(m)` (line 101): the override setter — test/device only,
  writes no flag.

This file is **not being deleted**. Only its element count changes: three
modes become two, `'body'` drops out of the union and the array.

### The one file that IS the `body` renderer

`src/renderer/schwung-body.ts` (158 lines) — `drawKnobParamsSchwung(vm,
touched)`. Re-exports `BODY_Y`/`BODY_H` from `GRID_BODY_RECT`
(`layout.ts:32`) at lines 42-43. Its **one caller**:

`src/renderer/knob-view.ts`:
- line 7: `import { drawKnobParamsSchwung } from './schwung-body.js';`
- line 8: `import { schwungGridEnabled } from './schwung-flag.js';`
- line 104: `else if (schwungGridEnabled()) drawKnobParamsSchwung(vm); else drawKnobParams(vm);`

`bodyOverride` (line 103, `if (bodyOverride) bodyOverride();`) is the seam
`page` mode uses instead (`src/app/tick.ts`'s `schwungBodyFor`) — it never
goes through `schwungGridEnabled()`. Confirmed: `schwungGridEnabled()` has
**exactly one real call site** in the whole tree
(`grep -rn "schwungGridEnabled(" src/ browser-test/ test-device/ scripts/"`
returns `knob-view.ts:104`, its own definition, and one comment in
`screenshot.mjs:1283`).

### The predicate/setter wrapper — dead once `body` is gone

`src/renderer/schwung-flag.ts` (13 lines), whole file:
```ts
export function schwungGridEnabled(): boolean { return schwungGridMode() === 'body'; }
export function setSchwungGrid(on: boolean): void { setSchwungGridMode(on ? 'body' : 'off'); }
export { schwungGridMode, setSchwungGridMode };
```
Its only importers: `knob-view.ts` (above) and `scripts/schwung-grid-preview.mjs:26`
(a manual, ungated preview tool — not in `package.json`, not in
`browser-test/device-scripts.mjs`'s enforcement, no other reference). Once
`schwungGridEnabled`/`setSchwungGrid` have no reason to exist, nothing else in
this file has a caller — the `schwungGridMode`/`setSchwungGridMode` re-exports
are never used through this file (every real caller imports them straight
from `schwung-grid.js`; confirmed by grepping every hit of `setSchwungGridMode`
and `schwungGridMode` across `browser-test/`, `src/`, `scripts/`, `test-device/`
— none goes through `schwung-flag.js` except the dead re-export itself).

**Delete the whole file.**

### The `.off` stand-in (the build-time axis, not the flag)

`src/renderer/schwung-body.off.ts` — the `MOVY_NO_SCHWUNG_GRID=1` stand-in
(a *different* switch, `build/device.mjs:36`, whether the Schwung layer is in
the bundle **at all**, independent of what the flag says). Its whole job:
stay surface-identical to `schwung-body.ts` (re-export `BODY_Y`/`BODY_H`,
throw on `drawKnobParamsSchwung`) so the `body|page|editor|widgets|voices|lib`
swap in `build/device.mjs` (below) has somewhere to point when `schwung-body.js`
is asked for. Once nothing imports `schwung-body.js`, nothing asks for its
stand-in either.

**Delete this file too** — it is what the ledger's "its `.off` stand-in" means.
Do **not** touch the other four `.off.ts` files
(`schwung-editor.off.ts`, `schwung-widgets.off.ts`, `schwung-voices.off.ts`,
`schwung-page.off.ts`) or `schwung-lib.off.ts` — they stand in for different
modules on the *same* build-time axis and are untouched by this item, except
for one dangling cross-reference (§6 below).

### The build wiring that names `schwung-body` explicitly

`build/device.mjs`:
- line 66-70, the `gridOffStubs` plugin's resolve filter and ternary:
  ```ts
  build.onResolve({ filter: /\/schwung-(body|page|editor|widgets|voices|lib)\.js$/ }, (a) => {
      const which = a.path.includes('schwung-body') ? 'body'
                  : a.path.includes('schwung-editor') ? 'editor'
                  : a.path.includes('schwung-widgets') ? 'widgets'
                  : a.path.includes('schwung-voices') ? 'voices'
                  : a.path.includes('schwung-lib') ? 'lib' : 'page';
      return { path: resolve(root, `src/renderer/schwung-${which}.off.ts`) };
  });
  ```
  Drop `body` from the regex alternation and from the ternary (5 remain:
  `page|editor|widgets|voices|lib`). Harmless to leave as dead code, but it
  actively contradicts its own comment at line 47 ("These five are the only
  importers of param_pages" — already stale today, six were listed, will be
  five after this cleanup) — fix the comment's count in the same edit.

`build/browser.mjs`:
- line 26: `resolve(root, 'src/renderer/schwung-body.ts'),` — an explicit entry
  point (so browser tests can import `dist/esm/renderer/schwung-body.js`
  directly). **Remove the line** — the file is gone.
- Also remove the `schwung-flag.ts` entry point (comment at line 21-23
  explains why it was an entry point: "so the browser tests can toggle the
  grid and call the adapter directly" — nobody does once the file is deleted).
- The comment block at line 320-321 ("renderer/schwung-body.ts imports
  Schwung's shared param_pages by its absolute device path...") documents
  behaviour of a file that will not exist; reword or drop the `schwung-body.ts`
  mention (the `schwung-lib.ts`/`schwung-page.ts` entries still need the same
  explanation, so keep the rest of the comment, just retarget the file name it
  opens with).

### `schwung-off-is-free.mjs` — unaffected, verified

`scripts/schwung-off-is-free.mjs` checks the strings `renderPageMovy` and
`createController` survive/vanish with `MOVY_NO_SCHWUNG_GRID`. Both symbols
are defined in `src/renderer/schwung-lib.ts:34,37,153,155` (the shared
adapter both `body` and `page` used), not only reachable through
`schwung-body.ts` — `src/renderer/schwung-page.ts:127` also calls
`lib.createController(...)`. Deleting `schwung-body.ts` removes one caller of
`renderPageMovy`, not the only one, so this script's assertions do not change
and do not need editing. **Verify, don't just trust this**: run it after the
deletion (step 10 below) and confirm both counts stay non-zero on the
flag-on build.

### The device-side type union naming `'body'`

Two real (non-comment) hits outside `src/`:
- `test-device/probe.ts:69`: `setGridMode(m: 'off' | 'body' | 'page' | null)`
  — drop `'body'` from the union.
- `test-device/selftest/device-probe.mjs:61`:
  `ok('page names the renderer', ['off', 'body', 'page'].includes(page.renderer), ...)`
  — drop `'body'` from the array.

Neither is exercised with `'body'` anywhere (no scenario ever calls
`probe.setGridMode('body')` — confirmed:
`grep -rn "setGridMode(" test-device/` finds only `'off'`/`PAGE_MODE`/`null`
calls in `arm.ts`, `page-lifecycle.ts`), so these are type-hygiene fixes, not
behaviour changes.

### Everything that only ever used `'off'`/`'page'` — confirmed untouched

Exhaustive grep for `setSchwungGridMode('body')` / `schwunggrid.*1\b` used as a
*mode selector* (as opposed to a numeric-flag-machinery literal, handled in
§3) across `browser-test/logic/{page-freshness,schwung-page,page-automation,
page-contract,page-owner,schwung-page-press,hierarchy-source}.mjs`,
`browser-test/{screenshot,app-loop,page-mode}.mjs`, `scripts/{schwung-app-check,
schwung-one-bank-bar,schwung-plock-view-check,grid-tick-cpu,grid-call-cost}.mjs`,
and every `test-device/scenarios/*.ts` (`arm.ts`'s `MOVY_ARM = 'off'`,
`page-lifecycle.ts`'s `PAGE_MODE`) returns **zero** calls with `'body'`. These
files need **no code change** for this item — only the doc comments in `arm.ts`
line 6 ("three values (`off`/`body`/`page`)") and `test-device/runner.ts:27-28`
("all three schwunggrid renderers") name a count that becomes wrong; both are
prose, not assertions, and are optional/low-priority (§9 step 11).

---

## 2. What `body` is today, precisely, and what breaks by deleting it

**What it is**: `schwunggrid = 1` → `schwungGridMode() === 'body'` →
`knob-view.ts` calls `drawKnobParamsSchwung(vm)` instead of `drawKnobParams(vm)`
for the body band only — movy still plans the page (its own bank index,
still its own model), Schwung only draws the eight cells' widgets. No
parameters move between pages; it is a restyle (confirmed by
`schwung-body.ts:9-22`'s own header comment — "WHAT CROSSES THE SEAM IS
MOVY'S VIEW MODEL, NOT MOVY'S PORT... movy stays the source of truth for WHAT
is on the page").

**Who reads the value 1 specifically, beyond the mode mapping already
covered**: nobody outside `schwung-grid.ts`'s `MODES` array and
`schwung-flag.ts`'s equality check. There is no third reader of the raw
number — every other consumer asks `schwungGridMode()` for the *mode string*,
never `flagValue('schwunggrid')` directly (confirmed:
`grep -rn "flagValue('schwunggrid')" src/` returns only
`schwung-grid.ts:70`).

**What deleting it breaks, if done carelessly**:
- Any stored `prefs.json` with `flags.schwunggrid: 1` or `: 2` silently
  changes meaning the instant this ships, unless the remap (§4) lands in the
  same commit. This is the core hazard the ledger flags and the reason the
  remap is **in this item**, not deferred.
- `browser-test/logic/schwung-page.mjs`'s "both embedded modes... use ONE
  rect" block (§3) — its *subject* (the `schwung-body.js`/`schwung-body.off.ts`
  pair sharing `GRID_BODY_RECT`) stops existing. Deleting the block is not a
  coverage loss: the rect's correctness (the arithmetic against `BAND_H`,
  `ROW0_Y`/`ROW1_Y`, `BAR_Y`+`BAR_H`, `TOAST_Y`) is independently pinned by the
  earlier block in the same file (`schwung-page.mjs:144-169`, "the embedded
  body rect seats Schwung's widget rows on movy's own rows"), which reads
  `GRID_BODY_RECT` straight from `layout.ts` and is not about `schwung-body.ts`
  at all. **Verify this claim before deleting** (step 7): run
  `node browser-test/logic.mjs` with only the 653-662 block commented out and
  confirm the 144-169 block still exercises the same rect.
- `layout.ts:14-16`'s comment ("shared by `body` and `page` modes and by the
  off stand-in") becomes wrong the moment `body` stops existing — update it to
  "shared by `page` mode and the off stand-in."

---

## 3. The `.off` stand-ins, and which tests change SUBJECT

Two `.off` artifacts are in scope (see §1): `schwung-body.off.ts` (deleted
outright) and the **dangling cross-references** in the four surviving
`.off.ts` files that cite it as the canonical explanation:

- `schwung-editor.off.ts:2`: "See schwung-body.off.ts for why the module has
  to leave the graph rather than merely be unreachable."
- `schwung-widgets.off.ts:2`
- `schwung-voices.off.ts:2`
- `schwung-page.off.ts:2`

All four point at a file that will not exist. Redirect them to
`build/device.mjs`'s own `gridOffStubs` comment (lines 34-51, "THE OFF SWITCH
HAS TO BE FREE" — the actual canonical explanation, which does not live in any
`.off.ts` file and survives this deletion) rather than to a sibling `.off.ts`,
so a future deletion of any one of these four doesn't orphan the reference
again.

**Tests whose SUBJECT changes, not just their assertions** (the briefing's
"a test that silently stops asserting is worse than a red one" — checked one
by one):

1. `browser-test/logic/schwung-page.mjs:653-662` — subject is
   `schwung-body.ts`/`.off.ts` sharing the rect. **Subject deleted along with
   the code it names.** Delete the block. Not a silent regression: see §2's
   verification note — the rect's own correctness is pinned elsewhere in the
   same file.
2. `browser-test/logic/schwung-grid.mjs:20-97`, the whole suite — subject is
   "the runtime switch between movy's own parameter renderer and Schwung's."
   **Subject survives, VALUES change.** This is a rewrite, not a deletion —
   see §5 for the exact new assertions.
3. `browser-test/logic/flags.mjs` — eleven lines reference `schwunggrid` as a
   **numeric-machinery test subject** (clamp, persistence, jog/knob, LED
   normalization), not as a mode-name test. Their subject (the generic flags
   machinery) survives; only the numeric literals tied to the OLD range
   (`max=2`, clamp target `2`, label `'PAGE'`) need updating to the new range.
   Full line-by-line list in §5.
4. `browser-test/screenshot.mjs` — no case currently renders under
   `schwunggrid=1` (confirmed: no `case` block sets the flag to 1 or calls
   `setSchwungGrid`/`schwungGridEnabled` — the only baselines sensitive to the
   flag's **value being shown as text** are `flags-top`/`flags-scrolled`,
   which render the Settings row, not the body band). Two baselines need
   regeneration for that reason alone (§5, §7).
5. `scripts/schwung-grid-preview.mjs` — **subject is entirely `body` mode**
   ("movy's UI, with Schwung's widgets in the body" — every shot it prints
   toggles `setSchwungGrid`). Delete the whole script; there is no remaining
   two-shot comparison it could mean once `body` is gone (`page` mode cannot
   be previewed through a bare `renderKnobsView(vm, false, 0)` call — it needs
   a `bodyOverride` built from a resolved `SchwungPage`, which this script
   never constructs). Confirmed unreferenced by `package.json` or any gate.

---

## 4. The migration for a stored value

**Confirmed inert, so out of scope for the migration itself**: a top-level
`"schwunggrid"` key in `prefs.json` (outside `flags`). `readPrefFlags()`
(`src/seq/prefs.ts:81-91`) reads `readPrefs().flags` only, and ignores every
other top-level key. A prefs.json hand-edited with a bare `"schwunggrid": 2`
at the root changes nothing today and will change nothing after this item —
worth stating in the commit so nobody "fixes" it later believing it was a
migration gap.

**In scope**: `prefs.json`'s `flags.schwunggrid`, read through
`readPrefFlags()` → `ensure()` in `src/seq/flags.ts:93-120`.

**Why the existing `revisedAt` mechanism is NOT enough as it stands.**
Read `ensure()` (`flags.ts:97-113`) closely: when `rev < f.revisedAt` (the
`superseded` branch), the *only* thing it does with a stored value is
**discard it and take `f.def`** — that is what "adopted" means throughout
this file and its one existing user, `engpersist` (`flags-def.ts:137`,
`revisedAt: 4` — see the git history, `b804536`). It has never had to
preserve a stored *value*, only replace it with a new default. SP-40 needs
something `revisedAt` has never done: **remap an old value's number to a
new number that means something else**, because the mapping is not
"discard, take the new default" — `MOVY (0)` stays `0`, but old `DRAW (1)`
must land on new `MOVY (0)` and old `PAGE (2)` must land on new `SCHWUNG (1)`.
A plain `clampFlag` to the new `max: 1` gets the `2→1` case right **by
coincidence** (clamping the old top value to the new top value) and the
`1→?` case **wrong**: an old `DRAW` user's stored `1` would clamp to `1`,
which now means `SCHWUNG` — silently handing a restyle-only user the fully
delegated, re-paginating renderer. This is exactly the silent-landing hazard
the ledger names and the reason this needs a real remap, not a range clamp.

**The design**: extend `FlagDef` with one more optional field, used only in
the branch that already exists for "a stored value predates a shipped
default":

```ts
// src/seq/flags-def.ts, alongside `revisedAt`
/** How a value stored under an OLD numbering survives a renumbered range,
 *  applied once on the same `revisedAt` trigger — for a flag whose VALUES
 *  were renumbered, not only its default. Absent means "no stored value
 *  survives the revision, take `def`" (engpersist's shape, unchanged). */
remapAt?: (old: number) => number;
```

```ts
// src/seq/flags-def.ts, the schwunggrid entry
key: 'schwunggrid', name: 'Param Pages',
hint: 'Who draws module knobs. PAGE re-paginates.',
min: 0, max: 1, def: 0, labels: ['MOVY', 'SCHWUNG'], uiOnly: true,
revisedAt: 5,
remapAt: (old) => (old >= 2 ? 1 : 0),   // 0->0 (MOVY), 1->0 (DRAW deleted, falls
                                         // back to movy's own renderer), 2->1 (PAGE->SCHWUNG)
```

```ts
// src/seq/flags-def.ts
export const FLAGS_REV = 5;   // was 4
```

```ts
// src/seq/flags.ts, ensure() — the superseded branch gains one case
const superseded = f.revisedAt !== undefined && rev < f.revisedAt;
if (f.key in stored && !superseded) {
    v[f.key] = clampFlag(f, stored[f.key]);
} else if (superseded && f.key in stored && f.remapAt) {
    v[f.key] = clampFlag(f, f.remapAt(stored[f.key]));
    if (v[f.key] !== f.def) adopted++;
} else {
    v[f.key] = f.def;
    if (superseded && f.key in stored && stored[f.key] !== f.def) adopted++;
}
```

The write-back loop (`flags.ts:113-117`) needs no change — it already writes
back whatever `v[f.key]` ended up as, for every `f.revisedAt !== undefined &&
rev < f.revisedAt`, which now includes the remapped value.

**Why `revisedAt: 5` and not something else**: `FLAGS_REV` is currently 4
(consumed once, by `engpersist`). A fresh bump to 5, with `schwunggrid`'s own
`revisedAt` at 5, means a device already at rev 4 (i.e., one that already
adopted the `engpersist` default) crosses this new threshold exactly once,
on first boot of a build carrying this change — matching how `engpersist`'s
rollout worked. **Do not reuse 4** — a device could plausibly already be at
rev 4 with a stored `engpersist` opinion of its own (post-rollout), and this
must not re-trigger that flag's adoption a second time; `rev < f.revisedAt`
being false for `engpersist` once `rev >= 4` is what already prevents that,
and a fresh `5` for `schwunggrid` keeps the two independent.

**A second-order interaction this creates, that the implementer must handle
in the same pass — see §5, test 3.5**: `browser-test/logic/flags.mjs:136-142`
currently uses `schwunggrid` as the *control* flag in a test proving "a flag
with no `revisedAt` keeps its stored value across an unrelated revision
bump." Once `schwunggrid` gets its own `revisedAt`, it stops being a valid
control for that claim — the fixture (`flagsRev: 3`) is below *both*
`engpersist`'s (4) and `schwunggrid`'s (5) thresholds now, so both get
touched, and the test's own premise ("no revision") becomes false of the
value it names. This has to be re-pointed at `setcommit` (the one flag with
no `revisedAt` after this change), not merely left alone — leaving it alone
makes the test assert something no longer true of what it names, which
would still pass today (rev 3 < 5, remap(1)=0, but the fixture never checks
schwunggrid's *value* changed — wait, it does, at line 142, and that
assertion **would now fail** since remap(1)=0≠1). This one is not a silent
regression risk — it goes red on its own — but the fix is a rename of which
flag the fixture stores, not a new expected number, so it is called out
explicitly to save the implementer a debug cycle.

---

## 5. Test plan

### 5.1 New assertions with teeth — the remap itself

Add to `browser-test/logic/flags.mjs`, in the "Persistence" block, right
after the existing `revisedAt` coverage (after line 152 in the current file):

```js
/* SP-40 — the flag's VALUES were renumbered (DRAW deleted), not only its
 * default, so a stored value needs a REMAP, not just a new default. A plain
 * clampFlag to the new max would get 2->1 right by coincidence and 1->1
 * wrong (an old DRAW user would land on SCHWUNG, not MOVY). */
installMockFs({
    [PREFS_PATH]: JSON.stringify({ flagsRev: 4, flags: { schwunggrid: 2 } }),
});
resetFlags();
eq('old PAGE (2) remaps to new SCHWUNG (1)', flagValue('schwunggrid'), 1);
uninstallMockFs();

installMockFs({
    [PREFS_PATH]: JSON.stringify({ flagsRev: 4, flags: { schwunggrid: 1 } }),
});
resetFlags();
eq('old DRAW (1) remaps to new MOVY (0), not to new SCHWUNG (1)',
   flagValue('schwunggrid'), 0);
uninstallMockFs();

installMockFs({
    [PREFS_PATH]: JSON.stringify({ flagsRev: 4, flags: { schwunggrid: 0 } }),
});
resetFlags();
eq('old MOVY (0) stays MOVY (0)', flagValue('schwunggrid'), 0);
uninstallMockFs();
```

**Prove the teeth**: with `remapAt` removed (fall through to the `else` branch
so a superseded stored value always takes `f.def`), the first new test must
go **red** (`flagValue('schwunggrid')` would read `0`, not `1`) — that is the
1→1-would-be-wrong / 2→wrong-without-remap case made concrete. Run it, confirm
red, then restore `remapAt` and confirm green. Record the exact before/after
in the commit message.

### 5.2 `browser-test/logic/flags.mjs` — numeric-literal updates (subject
survives, numbers don't)

| line(s) | today | change to |
| --- | --- | --- |
| 113-115 | `setFlag('schwunggrid', 99)` clamps to `2` | clamps to `1` (new max) |
| 138 | fixture stores `schwunggrid: 1` to prove "no revision keeps stored value" | **replace the flag under test with `setcommit`** (see §4's note — `schwunggrid` is no longer revision-less) — e.g. `{ flagsRev: 3, flags: { engpersist: 0, setcommit: 0 } }`, asserting `flagValue('setcommit') === 0` (its `def` is 1, so a surviving `0` proves the point) |
| 142 | asserts the above | update together with 138 |
| 309, 346 | `setFlag('schwunggrid', 2)` used to reach the top of the range for LED/label checks | `setFlag('schwunggrid', 1)` |
| 324 | `ok('a labelled flag shows its word', vm.rows.some((r) => r.value === 'PAGE'))` | `=== 'SCHWUNG'` |

Everything else naming `schwunggrid` in this file (67, 103-105, 111, 126, 130,
154, 157, 163, 166, 169, 277-286, 343-345, 388, 392) exercises the flag's
*name* or a value already inside both the old and new range (`0`, `1` used as
"a value", `99` as "out of range") — no change needed beyond the two rows
above, because none of them depends on there being three labels or an
`old-2`-shaped literal.

### 5.3 `browser-test/logic/schwung-grid.mjs` — full rewrite of the mode
mapping block (lines 20-97)

The subject (the runtime switch) survives; every assertion naming `'body'` or
value `2` must change:

- Line 27: unchanged (`def` stays `0`).
- Lines 30-35: drop the `body` case entirely.
  ```js
  setFlag('schwunggrid', 0);
  eq('flag 0 -> movy draws', schwungGridMode(), 'off');
  setFlag('schwunggrid', 1);
  eq('flag 1 -> Schwung plans and draws', schwungGridMode(), 'page');
  ```
- Lines 40-42: `ok('an out-of-range flag still names a real mode',
  ['off', 'page'].includes(schwungGridMode()));` (drop `'body'` from the
  array).
- Lines 49-55 (cache-drop test): flip between `0` and `1` instead of `0` and
  `2`.
- Lines 71-73 (under-floor pin): `setFlag('schwunggrid', 1)` instead of `2`
  (the top value, whatever it is now called, is still the one that must pin
  to `off` under an unmet floor).
- Lines 83-86 (library-unavailable branch): `for (const v of [0, 1])` instead
  of `[0, 1, 2]`.

**Prove the teeth on the mapping test specifically**: with `MODES` left at
three entries (`['off','body','page']`) but the flag def's `max` dropped to 1,
`setFlag('schwunggrid', 1)` would read mode `'body'`, not `'page'` — confirm
the rewritten test catches that (it does, directly: `eq(...,'page')` reads the
wrong string). This is the test that would have caught a partial migration
(def changed, `MODES` array forgotten).

### 5.4 `browser-test/logic/schwung-page.mjs` — delete lines 653-662

Delete the "both embedded modes, and the off stand-in, use ONE rect" block
entire. Per §2/§3, run the suite with this block alone commented out **before**
deleting `schwung-body.ts` to confirm the earlier block (144-169) already
covers the rect's correctness independent of it — that is the evidence this
is not a silent coverage loss.

### 5.5 Screenshot baselines

Two baselines are sensitive to the value shown, not to the body band:
`flags-top` and `flags-scrolled` (`browser-test/screenshot.mjs:736-746`).
`flags-scrolled` sets `setFlag('schwunggrid', 2)` (line 744) to show a
non-default value in the Settings list — update the literal to `1`, and the
baseline's `PAGE` text changes to `SCHWUNG`. Regenerate both with
`SCHWUNG=../schwung node browser-test/screenshot.mjs --update` and read the
diff before accepting — `flags-top` should show **no** pixel change (its
branch sets `schwunggrid` to `0`, untouched), and a diff there would mean
something else moved.

No other baseline renders through `schwungGridEnabled()`/`drawKnobParamsSchwung`
— confirmed in §1, no `case` in `screenshot.mjs` sets `schwunggrid` to `1` or
calls the body-mode path. The `page_body`/`page_body_p2`/`page_voice_pad`
scenes (`screenshot.mjs:~1296-1360`) go through `bodyOverride`
(`sp.render(...)`, `page` mode), never `schwungGridEnabled()` — unaffected,
verify by confirming a `--update` run touches only `flags-scrolled.png`
(and `flags-top.png` only if it turns out sensitive; expected not to be).

### 5.6 What is NOT touched and should be verified to stay that way

Run these as an explicit checklist after the code changes, before committing:
- `SCHWUNG=../schwung node browser-test/page-mode.mjs` — must still report
  the same "N of 3" (the burn-down only ever arms `'off'`/`'page'`; a change
  here would mean something leaked).
- `scripts/schwung-off-is-free.mjs` (needs a schwung checkout and a working
  `build/device.mjs`) — both counts (`renderPageMovy`, `createController`)
  must stay non-zero on the flag-on build; see §1's reasoning for why this is
  expected to be a no-op.

---

## 6. Ordered implementation steps

Each step is small enough to review on its own; run `SCHWUNG=../schwung npm
test` after every group marked **(gate)**.

1. **`src/seq/flags-def.ts`**: add `remapAt?: (old: number) => number` to
   `FlagDef`, with the doc comment from §4. Change the `schwunggrid` entry to
   `min: 0, max: 1, def: 0, labels: ['MOVY', 'SCHWUNG'], uiOnly: true,
   revisedAt: 5, remapAt: (old) => (old >= 2 ? 1 : 0)`. Bump `export const
   FLAGS_REV = 5;`.
2. **`src/seq/flags.ts`**: extend the `superseded` branch in `ensure()` per §4
   (the `else if (superseded && f.key in stored && f.remapAt)` case).
3. **`src/renderer/schwung-grid.ts`**: `SchwungGridMode = 'off' | 'page'`;
   `MODES = ['off', 'page']`. Update the header comment (lines 8-11) to drop
   the `'body'` row.
4. **`src/renderer/knob-view.ts`**: remove the `drawKnobParamsSchwung` and
   `schwungGridEnabled` imports (lines 7-8); collapse line 104-105 to
   `if (bodyOverride) bodyOverride(); else drawKnobParams(vm);`.
5. **Delete** `src/renderer/schwung-body.ts`, `src/renderer/schwung-body.off.ts`,
   `src/renderer/schwung-flag.ts`, `scripts/schwung-grid-preview.mjs`.
6. **`src/renderer/layout.ts`**: reword the `GRID_BODY_RECT` comment (line
   14-16) to drop "`body` and" — "shared by `page` mode and the off
   stand-in."
7. **`src/renderer/schwung-editor.off.ts`, `schwung-widgets.off.ts`,
   `schwung-voices.off.ts`, `schwung-page.off.ts`**: retarget the "See
   schwung-body.off.ts for why..." cross-reference to `build/device.mjs`'s
   `gridOffStubs` comment (§3).
8. **`build/device.mjs`**: drop `body` from the `gridOffStubs` regex and
   ternary (line 61-70); fix the "these five/six" count in the comment above
   it (line 47).
9. **`build/browser.mjs`**: remove the `schwung-body.ts` and `schwung-flag.ts`
   entry points (line 24 area); retarget the comment at line ~320 that opens
   on `schwung-body.ts`.
10. **(gate)** `SCHWUNG=../schwung npm test` — this is the build step that
    matters (`build:browser` runs inside `npm test`); confirm it fails loudly
    if any of the deleted files is still referenced (a missing entry point or
    a stale import throws at build time, not silently).
11. **Test edits**: `browser-test/logic/flags.mjs` (§5.1, §5.2),
    `browser-test/logic/schwung-grid.mjs` (§5.3), `browser-test/logic/
    schwung-page.mjs` (§5.4, delete 653-662 — but only after independently
    confirming the 144-169 block still covers the rect, per §2/§3).
12. **(gate)** `SCHWUNG=../schwung npm test` again — 0 failures.
13. **Teeth check** (§5.1): temporarily remove `remapAt` from the
    `schwunggrid` entry, rerun `node browser-test/logic.mjs`, confirm the two
    new remap assertions go red (record which ones and the actual vs
    expected), restore `remapAt`, confirm green again.
14. **Baselines**: `SCHWUNG=../schwung node browser-test/screenshot.mjs
    --update`; review the diff — expect exactly `flags-scrolled.png` to
    change (§5.5); if anything else moved, stop and find out why before
    accepting.
15. **(gate)** `SCHWUNG=../schwung node browser-test/page-mode.mjs` — same N
    of 3 as before this item (§5.6).
16. **`scripts/schwung-off-is-free.mjs`** (needs `SCHWUNG` set and a clean
    `ui.js` build) — confirm both counts stay non-zero on the flag-on build
    (§1, §5.6). Not part of `npm test`; run it explicitly and report the
    numbers in the commit message.
17. **Optional, low-priority prose fixes** (not gated by any test, do only if
    time remains and do not let them block the commit): `test-device/arm.ts:6`
    ("three values" → "two values"), `test-device/runner.ts:27-28` ("all
    three" → "both"), `scripts/measure-grid-cost.sh:66` and `scripts/
    measure-pad-page-latency.sh:54` (`SCHWUNGGRID=2` for the `page` arm still
    clamps correctly to the new top mode — see reasoning below — but reads
    clearer as `SCHWUNGGRID=1`), `browser-test/screenshot.mjs:1283`'s comment
    naming `schwungGridEnabled()`/`mode === 'body'`.

    *Why `SCHWUNGGRID=2` in those two device scripts still works untouched*:
    they write the raw JSON number directly into `prefs.json` on the device,
    bypassing `setFlag`/`clampFlag` at write time — but `ensure()` still
    clamps *on read* (`clampFlag(f, stored[f.key])`, the ordinary
    non-superseded path once the device's `flagsRev` is already `>= 5`), and
    `clampFlag` maps `2` to the new `max: 1`, which is `'page'` in the new
    two-element `MODES` array — the same renderer the script intended,
    reached by clamp instead of by the literal being right. Confirmed
    non-urgent; still worth the one-line fix for the next reader.
18. **Update the ledger**: `docs/schwung-page-migration.md`'s SP-40 row (state
    `⬜` → `✅`) and a one-line closed-item entry per the file's own
    convention (see "Closed items" section), naming the `remapAt` mechanism
    since SP-41 and any future flag-value renumbering will look for this
    precedent.
19. **Commit** — docs-only? No: this touches `src/`, `browser-test/`,
    `scripts/`, `build/` — both gates apply, run them for real (not skipped).
    `git add` the specific files touched (see the list above plus the ledger
    edit); do not `git add -A`.

---

## 7. Answers to the six required questions, in one place

1. **Every value/producer/consumer** — §1. Stored on the device: yes,
   `prefs.json`'s `flags.schwunggrid`, via `writePrefFlag` — the whole reason
   §4 exists.
2. **What `body` is, who reads it, what breaks** — §2.
3. **The `.off` stand-ins, and which tests change subject** — §3.
4. **The migration for a device with a stored value** — §4 (the `remapAt`
   design, the `FLAGS_REV` bump, the top-level-key inert case explicitly
   confirmed out of scope).
5. **The test plan and how the teeth are proven** — §5.
6. **Ordered steps** — §6.
