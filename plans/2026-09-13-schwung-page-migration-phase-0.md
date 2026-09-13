# Schwung Page Migration — Phase 0 (Infrastructure) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `schwunggrid = page` observable, measurable and testable offline, so that every Phase 1 behaviour claim has evidence behind it.

**Architecture:** Nothing here changes what movy does on screen. Phase 0 builds the instruments: a two-arm router run with a burn-down number, a fleet sweep through Schwung's real planner over the captured device dump, pixel coverage for a mode that currently has none, a fork-install path with a version floor, and a reproducible A/B for the per-tick cost. The enabler already exists and is under-used — `SCHWUNG=/path/to/schwung node build/browser.mjs` resolves `/data/UserData/schwung/shared/param_pages/*` to a real checkout (`build/browser.mjs:268`), so Schwung's planner runs in Node with no device.

**Tech Stack:** TypeScript (`src/` → `dist/esm/` via `node build/browser.mjs`), Node test harness (`browser-test/*.mjs`, `browser-test/logic/*.mjs`), Schwung `param_pages` `.mjs` reached through `src/renderer/schwung-lib.ts`, QuickJS on device.

**Spec:** `docs/superpowers/specs/2026-09-13-schwung-page-migration-design.md`. Live status: `docs/schwung-page-migration.md` (the ledger — update it as each task closes). Symptom detail: `docs/schwung-param-pages-findings.md`.

## Global Constraints

- **Nothing in Phase 0 changes on-screen behaviour.** Every task is an instrument or a pure refactor. A task that finds itself changing what a user sees has strayed into Phase 1 — stop and say so.
- **Local suites are meaningless for this work without a schwung checkout.** Run `SCHWUNG=../schwung npm test`. Without `SCHWUNG`, `browser-test/stubs/schwung-param-pages.mjs` throws on import, `schwungLibAvailable()` is false, the mode pins to `off`, and every Schwung assertion is **skipped, not failed**.
- **`MOVY_SCHWUNG_GRID=off|page` is stale and selects nothing.** It survives only in the usage comments of `scripts/grid-call-cost.mjs` and `scripts/measure-grid-cost.sh`. The mode is the `schwunggrid` flag; off device select it with `setSchwungGridMode()` (`src/renderer/schwung-grid.ts:88`). `MOVY_NO_SCHWUNG_GRID=1` still removes the layer from the bundle.
- **The local schwung checkout is not on `main`** — `movy-min-host-1.1.0`, 23 behind, and `git pull` refuses to fast-forward. Read upstream with `git -C ../schwung show origin/main:<path>`. (`voices.mjs` and `page_plan.mjs` are byte-identical to `origin/main` as of 2026-09-13; other files may not be.)
- **File size limits apply:** `src/` hard limit 200 lines, `browser-test/` and `test-device/` ~600.
- **Task completion checklist** (`CLAUDE.md`): local tests first (`npm test`, 0 failures), then the device tier when `move.local` answers, then commit with named files. If the device is unreachable, **say so in CAPS**. Phase 0 is almost entirely host-side; only Task 7 needs a device.
- **Prove every new test has teeth** by breaking the thing it guards and watching it go red. A test that cannot fail is the failure mode this repo has already paid for twice.

---

## What the research established before this plan was written

Two measurements change Phase 0's shape. Both are reproducible with the scratch scripts described in Task 5.

1. **Schwung's planner is already clean across the fleet.** `planPages()` over all 76 modules in `docs/module-dump/device-dump.json` yields **72 clean, 0 duplicate page names, 0 empty knobs pages, 0 throws**, and 4 warnings — all the same warning, `no ui_hierarchy — paginated from chain_params` (`branchage`, `belt-in`, `po32-drum`, `smack-in`). So the 9W9 class the findings feared (13 pages of "Params - 2") is **already fixed upstream**. The fleet sweep's value is therefore a *regression guard*, not a discovery tool — plus the second finding, which is the real one.

2. **Zero of 72 modules with a hierarchy declare voices to Schwung.** `voicesOf(hierarchy)` returns `[]` for every one, `mrdrums` and `forge` included. That is Cause E reproduced **offline, in one assertion, with no device** — and it locates the gap: `voices.mjs`'s own comment describes mrdrums' root as `child_count: 16`, `child_key_template: "p{index}_{key}"`, `child_index_param: "ui_current_pad"`, but the **dumped** mrdrums root has only `name`, `params`, `knobs`. The library is ready; the captured fleet predates the declaration.

   **Which is because the dump is stale: `generated_at` is 2026-07-15**, before Schwung #405/#411 existed. Every fleet conclusion about what modules declare is a statement about a two-month-old fleet. Re-capturing it is a prerequisite, not a nicety — hence Task 4.

---

## File Structure

**Created:**
- `browser-test/page-mode.mjs` — the burn-down runner. Spawns `app-loop.mjs` once per arm, diffs the `page` arm's failures against the expected-fail list, prints the number. ~90 lines.
- `browser-test/page-mode-expected-fail.json` — the 13 named Cause-A failures. Data only; the ratchet that may shrink and never grow.
- `browser-test/logic/env-identity.mjs` — proves `installEnv()` is idempotent, i.e. that a dump boot cannot steal the globals from the live env. ~50 lines.
- `browser-test/fleet-pages.mjs` — plans every dump module through Schwung's `planPages`, asserts the fleet invariants, and prints the voice-declaration census. ~150 lines.
- `src/renderer/schwung-page-io.ts` — the injected `io` object handed to `createController`.
- `src/renderer/schwung-page-contract.ts` — the contract tri-state, `refreshLoaded()`, the placeholder retry budget.
- `src/renderer/schwung-page-render.ts` — `render()`, `knobParamInfo()`, decoration assembly.
- `src/renderer/schwung-floor.ts` — the Schwung version floor and its reason string.
- `scripts/install-schwung-fork.sh` — installs a fork branch's `param_pages` **with the restart** QuickJS's module cache requires.
- `browser-test/grid-cost.mjs` — the off-device arm of the A/B, as a suite with a budget.

**Modified:**
- `browser-test/app-loop.mjs` — arm selection + failed-label capture. Two small additions; **do not refactor this file** (2713 lines of straight-line blocks; restructuring it is not this task).
- `browser-test/env.mjs:38` — `installEnv()` becomes idempotent.
- `browser-test/logic.mjs:79` — drop the ordering work-around and its comment.
- `browser-test/screenshot.mjs` — new `page`-mode scenes.
- `src/renderer/schwung-page.ts` — reduced to `createSchwungPage` + the interface.
- `src/renderer/schwung-lib.ts` — expose the version the floor compares against.
- `package.json` — register the new suites in `test`.
- `scripts/grid-call-cost.mjs`, `scripts/measure-grid-cost.sh` — untracked today; fix the stale arm selection and commit them.
- `docs/schwung-page-migration.md` — the ledger, updated at the end of every task.

---

### Task 1: The burn-down — `app-loop` runs both arms

`app-loop.mjs` is the gate for this feature (`docs/schwung-param-pages-findings.md` §5) and it runs one mode. Its 2713 lines are top-level straight-line blocks separated by `_log('\napp-loop: …')`, not functions, so parameterising the file internally is a large refactor with no payoff. Instead the file learns to run *as an arm*, and a new runner spawns it twice.

It has no `ok(label, cond)` — assertions go through `eq(label, actual, expected)`, and `fail()` increments `failures` (`app-loop.mjs:62-69`). That matters: a harness `ok(label, cond)` that ignored its condition has burned this repo before, so the ratchet below is built on the failure *labels* the run actually emits, never on a count someone typed.

**Files:**
- Modify: `browser-test/app-loop.mjs:45-60` (arm selection), `:62-69` (label capture), `:2713-2714` (emit before exit)
- Create: `browser-test/page-mode-expected-fail.json`
- Create: `browser-test/page-mode.mjs`
- Modify: `package.json` (`scripts.test`)

**Interfaces:**
- Consumes: `setSchwungGridMode(mode)` from `dist/esm/renderer/schwung-grid.js`; `SchwungGridMode = 'off' | 'body' | 'page'`.
- Produces: `MOVY_APP_LOOP_GRID` (env, arm selection) and `MOVY_APP_LOOP_LABELS=1` (env, makes the run print one `APP-LOOP-FAILED-LABELS <json-array>` line). Task 8 reuses both.

- [ ] **Step 1: Write the expected-fail list**

The 13 labels are quoted verbatim in `docs/schwung-param-pages-findings.md` §3 Cause A. Copy them exactly — a typo here silently turns a guard into a no-op.

Create `browser-test/page-mode-expected-fail.json`:

```json
{
  "note": "The 13 app-loop checks that fail under schwunggrid=page, all of them Cause A in docs/schwung-param-pages-findings.md — movy's model still owning paging, polling and input for a component Schwung draws. THIS LIST MAY SHRINK AND MUST NEVER GROW. A label here that starts passing must be DELETED (the run fails until it is). A failure not listed here is a regression and fails the run. Owner: docs/schwung-page-migration.md.",
  "labels": [
    "chain page: file-param jog click opens file browser",
    "browser opened",
    "browseOrigin captured the pre-open view",
    "Back leaves the file browser",
    "select committed the preset path",
    "assigned: navigated to LFO slot",
    "assigned: on chain view",
    "assign mode exited",
    "LFO page shows the assigned target (not None)",
    "module touch cleared on return",
    "held-step jog switches page",
    "chain+held jog-press drills to params",
    "shift+jog: plain jog steps one page"
  ]
}
```

- [ ] **Step 2: Teach `app-loop.mjs` its arm**

Add beside the other `await import(...)` calls (after `dist/esm/app/globals.js` is imported at `:44`, so the app's globals exist before `schwung-lib.ts`'s top-level await runs):

```js
/* THE ARM IS SELECTED HERE, NOT BY A BUILD DEFINE. The grid is a setting now
 * (src/renderer/schwung-grid.ts), and MOVY_SCHWUNG_GRID — still in two scripts'
 * usage lines — reaches no build at all, so selecting a mode that way ran `off`
 * twice and called it an A/B. Unset means the default, which is what every
 * existing `npm test` run wants. */
const { setSchwungGridMode } = await import('../dist/esm/renderer/schwung-grid.js');
const GRID_ARM = process.env.MOVY_APP_LOOP_GRID || null;
if (GRID_ARM) setSchwungGridMode(GRID_ARM);
```

- [ ] **Step 3: Capture the failed labels**

Replace `fail()` at `:65` and add the accumulator:

```js
/* The LABELS, not the count. page-mode.mjs ratchets on which checks fail, so a
 * count would let one check start failing while another stopped and call it
 * unchanged. */
const failedLabels = [];
function fail(label, why) { _log(`  \x1b[31m✗\x1b[0m ${label}: ${why}`); failures++; failedLabels.push(label); }
```

- [ ] **Step 4: Emit the labels before exiting**

Replace the last two lines (`:2713-2714`). The emit must come **before** `process.exit(1)` or the failing arm reports nothing:

```js
if (process.env.MOVY_APP_LOOP_LABELS) _log('APP-LOOP-FAILED-LABELS ' + JSON.stringify(failedLabels));
if (failures === 0) _log('\n\x1b[32m\x1b[1mALL APP-LOOP CHECKS PASSED\x1b[0m');
else { _log(`\n\x1b[31m\x1b[1m${failures} APP-LOOP CHECK(S) FAILED\x1b[0m`); process.exit(1); }
```

- [ ] **Step 5: Check the arm actually bites**

Run:

```bash
SCHWUNG=../schwung node build/browser.mjs
MOVY_APP_LOOP_GRID=page MOVY_APP_LOOP_LABELS=1 node browser-test/app-loop.mjs | grep APP-LOOP-FAILED-LABELS
```

Expected: a JSON array of 13 labels. If it is `[]`, the arm did not take — most likely `schwungLibAvailable()` is false (rebuild with `SCHWUNG=`) or the import landed before `globals.js`.

- [ ] **Step 6: Write the burn-down runner**

Create `browser-test/page-mode.mjs`:

```js
#!/usr/bin/env node
/* page-mode.mjs — the schwung page migration's burn-down.
 *
 * Runs the REAL router suite once per arm and ratchets on which checks fail
 * under `page`. The number it prints is the migration's progress, and it is
 * deliberately the only place that number exists: a fresh session reads it in
 * one command and cannot argue with it.
 *
 * Two directions of failure, both hard:
 *   - a failure NOT in the list  → the last change regressed a sibling
 *   - a listed label that PASSES → the list is stale; delete the label
 *
 * A separate process per arm, not two passes in one: app-loop.mjs is 2713 lines
 * of top-level straight-line blocks sharing one set of mock globals, and
 * re-running it in-process would have the second arm inherit the first's state.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));

/* SKIPPED, not passed, and it says so: without a checkout the stub throws on
 * import, the mode pins to `off`, and both arms would measure the same thing
 * and agree. Silence here is what would make this suite lie. */
if (!process.env.SCHWUNG) {
    console.log('page-mode: SKIPPED (no param_pages; set SCHWUNG=/path/to/schwung)');
    process.exit(0);
}

function arm(mode) {
    const r = spawnSync(process.execPath, [join(__dir, 'app-loop.mjs')], {
        env: { ...process.env, MOVY_APP_LOOP_GRID: mode, MOVY_APP_LOOP_LABELS: '1' },
        encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    const m = /APP-LOOP-FAILED-LABELS (\[.*\])/.exec(r.stdout || '');
    if (!m) {
        console.log(r.stdout || '');
        console.log(r.stderr || '');
        throw new Error(`page-mode: the ${mode} arm printed no label line (crash, or the emit moved after process.exit)`);
    }
    return JSON.parse(m[1]);
}

const expected = new Set(JSON.parse(readFileSync(join(__dir, 'page-mode-expected-fail.json'), 'utf8')).labels);
const offFailures  = arm('off');
const pageFailures = arm('page');

let bad = 0;

/* The `off` arm is the control. If it fails, nothing the `page` arm says means
 * anything — the difference would not be attributable to the mode. */
if (offFailures.length) {
    console.log(`  \x1b[31m✗\x1b[0m the off arm must be clean: ${JSON.stringify(offFailures)}`);
    bad++;
}

for (const label of pageFailures) {
    if (!expected.has(label)) {
        console.log(`  \x1b[31m✗\x1b[0m REGRESSION under page — not in the expected-fail list: ${label}`);
        bad++;
    }
}
for (const label of expected) {
    if (!pageFailures.includes(label)) {
        console.log(`  \x1b[32m✓\x1b[0m fixed under page: ${label}`);
        console.log(`  \x1b[31m✗\x1b[0m …so delete it from browser-test/page-mode-expected-fail.json`);
        bad++;
    }
}

console.log(`\npage-mode: ${pageFailures.length} of ${expected.size} expected failures remain`);
if (bad) { console.log(`\x1b[31m\x1b[1mPAGE-MODE LEDGER OUT OF DATE (${bad})\x1b[0m`); process.exit(1); }
console.log('\x1b[32m\x1b[1mPAGE-MODE LEDGER UP TO DATE\x1b[0m');
```

- [ ] **Step 7: Run it**

Run: `SCHWUNG=../schwung node browser-test/page-mode.mjs`

Expected: exit 0, and the line `page-mode: 13 of 13 expected failures remain`.

If a label is reported as "fixed", it was mistyped in Step 1 — the runner cannot tell a fixed check from a label that never existed. Compare against the `grep APP-LOOP-FAILED-LABELS` output from Step 5 rather than against the findings doc.

- [ ] **Step 8: Prove it has teeth, in both directions**

```bash
# Direction 1: a stale list must fail.
node -e "const f='browser-test/page-mode-expected-fail.json',j=JSON.parse(require('fs').readFileSync(f));j.labels.push('a check that does not exist');require('fs').writeFileSync(f,JSON.stringify(j,null,2))"
SCHWUNG=../schwung node browser-test/page-mode.mjs; echo "exit=$?   # expect 1, '…so delete it'"
git checkout browser-test/page-mode-expected-fail.json

# Direction 2: a regression must fail.
node -e "const f='browser-test/page-mode-expected-fail.json',j=JSON.parse(require('fs').readFileSync(f));j.labels.shift();require('fs').writeFileSync(f,JSON.stringify(j,null,2))"
SCHWUNG=../schwung node browser-test/page-mode.mjs; echo "exit=$?   # expect 1, 'REGRESSION under page'"
git checkout browser-test/page-mode-expected-fail.json
```

- [ ] **Step 9: Register the suite**

In `package.json`, add `node browser-test/page-mode.mjs` to `scripts.test`, immediately after `node browser-test/app-loop.mjs`.

- [ ] **Step 10: Run the whole suite both ways**

```bash
npm test                      # no SCHWUNG: page-mode prints SKIPPED, everything else green
SCHWUNG=../schwung npm test   # page-mode prints 13 of 13
```

Both must exit 0. A machine with no schwung checkout must not go red — that is what the SKIPPED path is for.

- [ ] **Step 11: Commit**

```bash
git add browser-test/app-loop.mjs browser-test/page-mode.mjs \
        browser-test/page-mode-expected-fail.json package.json
git commit -m "$(cat <<'EOF'
test: the page-mode burn-down, ratcheted on labels rather than a count

app-loop is the gate for the schwung page migration and ran one mode. It now
runs as an arm (MOVY_APP_LOOP_GRID) and prints which checks failed, and
page-mode.mjs spawns it twice and diffs the `page` arm against a named list of
the 13 known Cause-A failures.

Labels and not a count: a count would let one check start failing while another
stopped and report it as unchanged. Both directions are hard failures — an
unlisted failure is a regression, and a listed label that passes means the list
is stale. So the list can only shrink.

The off arm is asserted clean because it is the control: if it fails, nothing
the page arm says is attributable to the mode.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 12: Update the ledger**

In `docs/schwung-page-migration.md`: set SP-01 to `✅`, and add a Log line naming the commit and `page-mode: 13 of 13`.

---

### Task 2: The harness env leak

`browser-test/dump-boot.mjs:95` calls `installEnv()` a second time. From that point the param globals belong to the new env instance while `env.setParams` still feeds the harness's own — so any later suite that boots a model reads whatever the dump left behind instead of its own preset. `browser-test/logic.mjs:79` documents this and works around it by ordering `run_schwung_page` before `run_undo_params`.

The work-around is load-bearing today, which is why this is its own task: removing it may turn other suites red, and finding that out deliberately is the point. `docs/schwung-param-pages-findings.md` §7 flags it as deferred for exactly this reason.

**Files:**
- Create: `browser-test/logic/env-identity.mjs`
- Modify: `browser-test/env.mjs:38` (`installEnv`)
- Modify: `browser-test/logic.mjs:70-84` (suite order + the comment)

**Interfaces:**
- Consumes: `installEnv()` from `browser-test/env.mjs`; `createDumpBoot(dump)`, `loadDump()` from `browser-test/dump-boot.mjs`.
- Produces: `installEnv()` is idempotent — the second and later calls return the **same** env object and do not reassign the globals.

- [ ] **Step 1: Write the failing test**

Create `browser-test/logic/env-identity.mjs`:

```js
/* env-identity.mjs — one env per process, however many times it is asked for.
 *
 * createDumpBoot() calls installEnv() a second time, and the globals the
 * bundled modules read are whatever the LAST call assigned. So a suite holding
 * the first env kept feeding a store nothing read: every later suite that
 * booted a model saw the dump's params instead of its own preset, silently and
 * with every assertion still green. logic.mjs ordered its suites around it.
 *
 * This asserts the property directly rather than the symptom, because the
 * symptom is "some later suite is subtly wrong" and that is not a test. */
import { installEnv, ok, eq, _log } from './harness.mjs';

export async function run() {
    _log('\nlogic: one env per process');

    const { loadDump, createDumpBoot } = await import('../dump-boot.mjs');

    const first = installEnv();
    eq('installEnv is idempotent', installEnv(), first);

    /* The real second caller, not a stand-in: the bug lives in dump-boot's own
     * call, and a hand-written installEnv() here would pass while dump-boot
     * still stole the globals. */
    await createDumpBoot(loadDump());

    /* The globals must still answer to the env the suite is holding. */
    first.setParams({ 'synth:env_identity_probe': '41' });
    eq('the live env still backs shadow_get_param',
        globalThis.shadow_get_param('synth:env_identity_probe'), '41');

    ok('a dump boot does not steal the globals');
}
```

Register it in `browser-test/logic.mjs`: import it as `import { run as run_env_identity } from './logic/env-identity.mjs';` (every logic suite exports a bare `run()` and pulls `ok`/`eq`/`_log`/`installEnv` from `./harness.mjs` — see `logic/schwung-page.mjs`), then add `run_env_identity` to the `SUITES` array.

- [ ] **Step 2: Run it and watch it fail**

Run: `SCHWUNG=../schwung node browser-test/logic.mjs 2>&1 | grep -A4 'one env per process'`

Expected: `✗ the live env still backs shadow_get_param: expected "41", got …` — `null`, or whatever the dump left at that key. If it passes, check that `createDumpBoot` is really being awaited; the whole test rests on its `installEnv()` call having run.

- [ ] **Step 3: Make `installEnv()` idempotent**

In `browser-test/env.mjs`, above `export function installEnv()`:

```js
/* ONE ENV PER PROCESS. The globals the bundled modules read are module-level
 * assignments, so a second installEnv() silently repoints them at a second
 * store while every existing holder keeps writing to the first. Returning the
 * live one is safe because env.setParams() replaces the whole store anyway —
 * per-suite isolation comes from that call, never from a fresh env. */
let installed = null;
```

and at the top of the function body:

```js
export function installEnv() {
    if (installed) return installed;
    let params = {};
```

then assign and return it at the end of the function, in place of the existing bare `return env;`:

```js
    installed = env;
    return env;
```

- [ ] **Step 4: Run it and watch it pass**

Run: `SCHWUNG=../schwung node browser-test/logic.mjs 2>&1 | grep -A4 'one env per process'`

Expected: both checks `✓`.

- [ ] **Step 5: Remove the work-around and find out what it was holding up**

In `browser-test/logic.mjs`, delete the comment at `:79-84` and move `run_schwung_page` back beside `run_schwung_grid`.

Run: `SCHWUNG=../schwung npm test`

If suites go red here, **that is this task's real finding.** Fix them in this task — they were passing on the leak. Record each one in the commit message; do not re-order the suites to hide it.

- [ ] **Step 6: Prove it has teeth**

```bash
git stash push browser-test/env.mjs
SCHWUNG=../schwung node browser-test/logic.mjs 2>&1 | grep 'live env still backs'   # expect ✗
git stash pop
```

- [ ] **Step 7: Commit**

```bash
git add browser-test/env.mjs browser-test/logic.mjs browser-test/logic/env-identity.mjs
git commit -m "$(cat <<'EOF'
test: one env per process, and the suite order that was hiding a second one

createDumpBoot() called installEnv() a second time, repointing the globals the
bundled modules read at a new store while every existing holder kept writing to
the first. Every assertion stayed green: the damage was that a later suite
booting a model read the dump's params instead of its own preset.

logic.mjs had ordered run_schwung_page ahead of run_undo_params to dodge it.
That ordering is gone, so the next suite to depend on the leak fails instead of
passing quietly.

installEnv() now returns the live env. Per-suite isolation was never the env's
job — env.setParams() replaces the whole store.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Update the ledger** — SP-02 `✅`, Log line, and name any suite that went red in Step 5.

---

### Task 3: Split `schwung-page.ts`

457 lines against the repo's hard 200-line limit, and every Phase 1 item edits this file. Pure refactor: the public surface does not move.

**Files:**
- Modify: `src/renderer/schwung-page.ts` → keeps `SchwungIntent`, `SchwungPage`, `createSchwungPage`
- Create: `src/renderer/schwung-page-io.ts` — the injected `io` handed to `lib.createController` (`schwung-page.ts:111`)
- Create: `src/renderer/schwung-page-contract.ts` — the `contractUnresolved` tri-state, `refreshLoaded()` (`:171-190`), the placeholder retry (`RETRY_TICKS = 12`, `RETRY_LIMIT = 60`, `:224-237`)
- Create: `src/renderer/schwung-page-render.ts` — `render()`, `knobParamInfo()`, decoration assembly
- Modify: `src/renderer/schwung-page.off.ts` if the `.off` stand-in's surface must match

**Interfaces:**
- Consumes: `schwungLib()` from `./schwung-lib.js`; `TrackPort`; `GRID_BODY_RECT` from `./layout.js`.
- Produces: **no change.** `createSchwungPage(port, componentKey)` returns the same `SchwungPage` with the same members (`reload`, `tick`, `pageCount`, `pageIndex`, `changePage`, `goToPage`, `keyAt`, `targetAt`, `labelAt`, `knobParamInfo`, `render`, `knobTurn`, `knobTouch`, `click`, `back`, `focusVoice`, `ready`, `ctl`). Any change to that list means this stopped being a refactor.

- [ ] **Step 1: Record the baseline**

```bash
SCHWUNG=../schwung npm test 2>&1 | tail -5
SCHWUNG=../schwung node browser-test/page-mode.mjs | tail -2
```

Write both results into the commit message later. `page-mode` must still say `13 of 13` at the end of this task — a refactor that changes the burn-down changed behaviour.

- [ ] **Step 2: Move the injected io**

Cut the `io` object literal passed to `lib.createController` (`schwung-page.ts:111` onward) into `schwung-page-io.ts` as a factory taking what it closes over:

```ts
/* The injected io — rule 1 of param_pages: the library does no param I/O, the
 * caller does every read and write. Extracted so the contract lifecycle and the
 * render path can be read without scrolling past it. */
export function createPageIo(port: TrackPort, qualify: (k: string) => string) { /* … */ }
```

Keep every existing comment with the code it explains. A comment left behind in the old file describing code that is no longer there is worse than no comment.

- [ ] **Step 3: Move the contract lifecycle**

Into `schwung-page-contract.ts`: `refreshLoaded()`, the `contractUnresolved` tri-state, `RETRY_TICKS`, `RETRY_LIMIT` and the retry counters. Export one factory returning `{ refreshLoaded, tick }` over the controller.

Note for Phase 1: SP-15 (Cause D) works in this file. Leave the retry-budget comments intact — the hypothesis that the budget is spent before the module arrives is recorded there.

- [ ] **Step 4: Move the render path**

Into `schwung-page-render.ts`: `render()`, `knobParamInfo()`, and the decoration assembly — including the `const on = lane >= 0 && (auto.activeLanes & (1 << lane)) !== 0` line, which is Cause G2 and which SP-16 will change. Do not fix it here.

- [ ] **Step 5: Check the sizes and the types**

```bash
wc -l src/renderer/schwung-page*.ts   # every file ≤ 200
npm run typecheck
```

- [ ] **Step 6: Run everything**

```bash
SCHWUNG=../schwung npm test
SCHWUNG=../schwung node browser-test/page-mode.mjs | tail -2   # still 13 of 13
```

Both green, and the burn-down unchanged. If `page-mode` moved, this was not a refactor — find what behaviour changed before committing.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/schwung-page.ts src/renderer/schwung-page-io.ts \
        src/renderer/schwung-page-contract.ts src/renderer/schwung-page-render.ts
git commit -m "$(cat <<'EOF'
refactor: schwung-page splits along the seams Phase 1 will edit

457 lines against a 200-line limit, and every item of the page migration edits
this file. Split by responsibility rather than by size: the injected io, the
contract tri-state and its retry budget, and the render path.

No behaviour change — the SchwungPage surface is identical and the page-mode
burn-down still reads 13 of 13, which is the assertion that this was a refactor.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Update the ledger** — SP-03 `✅`.

---

### Task 4: Re-capture the module dump

Every fleet conclusion rests on `docs/module-dump/device-dump.json`, whose `generated_at` is **2026-07-15** — before Schwung #405/#411, i.e. before modules could declare voices or widgets at all. Measured today, `voicesOf(hierarchy)` returns `[]` for all 72 dumped modules with a hierarchy, `mrdrums` included, while `voices.mjs`'s own comment describes an mrdrums root carrying `child_count: 16` and `child_key_template: "p{index}_{key}"`. Either the fleet has moved since July and the dump is simply stale, or it has not and Cause E is a fleet-wide module gap. **Those two worlds need different Phase 1 work, and only a fresh dump tells them apart.**

Needs a reachable device. See `docs/module-dump/` and the `dump-modules.sh` pipeline.

**Files:**
- Modify: `docs/module-dump/device-dump.json` (regenerated)
- Modify: `docs/module-dump/SUMMARY.md` (regenerated, if the pipeline writes it)
- Modify: `browser-test/dump-expect.json` (only if `dump-replay` legitimately moves — see Step 4)
- Modify: `docs/schwung-page-migration.md` (record the answer)

**Interfaces:**
- Consumes: the existing dump pipeline in `docs/module-dump/` / `scripts/`.
- Produces: a dump whose `generated_at` is this run, plus a recorded answer to "does any fleet module declare voices to Schwung?" — the premise Task 5's census and SP-14 both rest on.

- [ ] **Step 1: Check the device answers**

```bash
./scripts/dev-probe.sh status
```

`ping move.local` **always** fails (ICMP is blocked) — probe over ssh, never with ping. If the device is unreachable, **stop this task and report it to the user IN CAPS**; Tasks 5–7 can proceed, but Task 5's census must then be labelled as measured against the July dump.

- [ ] **Step 2: Re-run the dump**

Follow `docs/module-dump/` (the collector runs on device; the movy-layout snapshot runs host-side). Confirm afterwards:

```bash
node -e "const d=JSON.parse(require('fs').readFileSync('docs/module-dump/device-dump.json','utf8'));console.log(d.generated_at, d.module_count, d.complete)"
```

Expected: today's date, a module count ≥ 76, `complete: true`. An incomplete dump is not usable as a fleet baseline — find out which module stalled the collector and record it.

- [ ] **Step 3: Answer the voice question**

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { voicesOf } from '../schwung/src/shared/param_pages/voices.mjs';
const d = JSON.parse(readFileSync('docs/module-dump/device-dump.json','utf8'));
const P = v => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } };
let n = 0;
for (const m of d.modules) {
  const h = P(m.ui_hierarchy); if (!h) continue;
  const v = voicesOf(h) || [];
  if (v.length) { n++; console.log(m.id + ': ' + v.length + ' voices'); }
}
console.log('modules declaring voices: ' + n);
"
```

Record the number in the ledger under SP-14 either way. `0` means Cause E must be solved on movy's side (translate `bank.pad` into the declaration the planner wants) because the modules are third-party and decision 2 keeps them off the critical path. Non-zero means name which modules, because they become SP-14's fixtures.

- [ ] **Step 4: Re-baseline `dump-replay` only where the fleet really moved**

Run: `SCHWUNG=../schwung node browser-test/dump-replay.mjs`

Some diffs are expected — modules changed in two months. For each, decide and write down whether it is a real module change (re-baseline) or a movy regression the old dump was hiding (fix it). **Do not run `--update` to make the suite quiet.** If a diff cannot be explained, leave the suite red and report it; an unexplained re-baseline destroys the only fleet evidence this project has.

- [ ] **Step 5: Commit**

```bash
git add docs/module-dump/ browser-test/dump-expect.json
git commit -m "$(cat <<'EOF'
dump: re-capture the fleet, because every page-migration conclusion rests on it

The committed dump was generated 2026-07-15, before Schwung #405/#411 — so it
predates modules being able to declare voices or widgets at all, and every
"the fleet does not declare X" reading of it was a statement about a
two-month-old fleet.

Recorded with it: how many modules declare voices to Schwung's voicesOf(). That
number decides whether Cause E is solved on movy's side or in the modules, and
it was unanswerable against the old capture.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Update the ledger** — SP-04a `✅`, the voice count under SP-14, and the new dump date in Environment facts.

---

### Task 5: The fleet sweep

`dump-replay.mjs` replays **movy's** model — the layer Schwung bypasses — so it is structurally blind to re-pagination (`docs/schwung-param-pages-findings.md` §5). This is its sibling: the same 76 modules planned through Schwung's own `planPages`.

Measured before writing this plan, the static invariants **already pass**: 72 clean, 0 duplicate page names, 0 empty knobs pages, 0 throws, and 4 `no ui_hierarchy — paginated from chain_params` warnings (`branchage`, `belt-in`, `po32-drum`, `smack-in`). The 9W9 class is fixed upstream. So this suite's job is to **hold** that, and to carry the voice census — which does not pass, and which is Cause E reproduced with no device.

**Files:**
- Create: `browser-test/fleet-pages.mjs`
- Create: `browser-test/fleet-expect.json` (the accepted-warning and census baseline)
- Modify: `package.json` (`scripts.test`)

**Interfaces:**
- Consumes: `planPages`, `pageSlotKeys` from `param_pages/page_plan.mjs`; `voicesOf`, `padLayoutOf` from `param_pages/voices.mjs`; `docs/module-dump/device-dump.json`.
- Produces: `npm test` fails when a module's Schwung page plan degrades. Verified shapes — `planPages({ hierarchy, chainParams, unresolved: false })` returns `{ pages, fingerprint, warnings, conditionKeys, realigned }`; a page is `{ kind, name, level, … }` with `kind` one of `knobs` / `preset` / `items` / `menu`; `pageSlotKeys(page)` returns an 8-element array of bare keys or `null`. `voicesOf(hierarchy)` takes the **hierarchy itself**, not an options object — passing `{ hierarchy }` returns `[]` and looks like a real answer.

- [ ] **Step 1: Write the suite**

Create `browser-test/fleet-pages.mjs`:

```js
#!/usr/bin/env node
/* fleet-pages.mjs — every fleet module, planned through SCHWUNG's planner.
 *
 * dump-replay.mjs replays movy's model, which is the layer `page` mode
 * bypasses, so it cannot see a re-pagination at all. This plans the same
 * modules the way the device will under `page`, against the real captured
 * metadata in docs/module-dump/ — no device.
 *
 * THE INVARIANTS PASS TODAY (72 clean of 76 at the 2026-07-15 capture). That is
 * the point: the 9W9 class — 13 pages all named "Params - 2", no level on any of
 * them — is fixed upstream, and this is what stops it coming back. A suite is
 * allowed to be green on the day it lands as long as it can go red.
 *
 * The census is the part that does not pass, and it is deliberately a REPORT
 * rather than an assertion: zero modules declaring voices is Cause E, it is a
 * fleet/module fact rather than a movy regression, and failing the build for it
 * would make every session red for something no session can fix. It is
 * baselined so a CHANGE in it is loud.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const EXPECT = join(__dir, 'fleet-expect.json');
const UPDATE = process.argv.includes('--update');

if (!process.env.SCHWUNG) {
    console.log('fleet-pages: SKIPPED (no param_pages; set SCHWUNG=/path/to/schwung)');
    process.exit(0);
}

/* Resolved straight from SCHWUNG, NOT through dist/esm and the esbuild alias:
 * this suite reads the library as data — it plans pages without a model, a
 * port or a controller — so going through movy's bundle would drag the whole
 * renderer in for nothing. */
const PP = join(process.env.SCHWUNG, 'src', 'shared', 'param_pages');
const { planPages, pageSlotKeys } = await import(join(PP, 'page_plan.mjs'));
const { voicesOf } = await import(join(PP, 'voices.mjs'));

const dump = JSON.parse(readFileSync(join(__dir, '..', 'docs', 'module-dump', 'device-dump.json'), 'utf8'));
const P = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } };

let failures = 0;
const ok   = (l) => console.log(`  \x1b[32m✓\x1b[0m ${l}`);
const fail = (l, why) => { console.log(`  \x1b[31m✗\x1b[0m ${l}: ${why}`); failures++; };

const warned = {};       // id → warnings[]
const census = [];       // ids declaring voices

console.log(`\nfleet-pages: ${dump.modules.length} modules, dump ${dump.generated_at}`);

for (const m of dump.modules) {
    const cp = P(m.chain_params);
    if (!cp) { fail(m.id, 'no chain_params in the dump'); continue; }
    const h = P(m.ui_hierarchy);

    let r;
    try { r = planPages({ hierarchy: h, chainParams: cp, unresolved: false }); }
    catch (e) { fail(m.id, 'planPages threw: ' + e.message); continue; }

    /* THE 9W9 CLASS. Two pages with the same kind and name are two jog steps a
     * user cannot tell apart — 9W9 shipped 13 of them, all "Params - 2", and no
     * amount of reading one page told you which. */
    const seen = new Set();
    for (const p of r.pages) {
        const k = p.kind + ' ' + p.name;
        if (seen.has(k)) { fail(m.id, `two ${p.kind} pages both named "${p.name}"`); break; }
        seen.add(k);
    }

    /* A knobs page whose every slot is empty is a page that draws nothing and
     * still costs a jog step. */
    for (const p of r.pages) {
        if (p.kind !== 'knobs') continue;
        if (pageSlotKeys(p).every((x) => !x)) { fail(m.id, `knobs page "${p.name}" has no keys`); break; }
    }

    /* Every page must be nameable. An unnamed page has nothing to put in movy's
     * header or its bank bar. */
    for (const p of r.pages) {
        if (!p.name) { fail(m.id, `a ${p.kind} page has no name`); break; }
    }

    if (r.warnings.length) warned[m.id] = r.warnings;
    if (h && (voicesOf(h) || []).length) census.push(m.id);
}

/* Warnings are baselined, not banned: `no ui_hierarchy — paginated from
 * chain_params` is a legitimate module shape, and four modules have it. A NEW
 * warning is what matters. */
const expect = UPDATE ? null : JSON.parse(readFileSync(EXPECT, 'utf8'));
if (UPDATE) {
    writeFileSync(EXPECT, JSON.stringify({ warned, voiceDeclaring: census.sort() }, null, 2) + '\n');
    console.log('  baseline written to browser-test/fleet-expect.json');
} else {
    for (const id of Object.keys(warned)) {
        if (!expect.warned[id]) fail(id, 'new planner warning: ' + warned[id].join(' | '));
    }
    for (const id of Object.keys(expect.warned)) {
        if (!warned[id]) fail(id, 'warning gone — re-baseline with --update');
    }
    const before = (expect.voiceDeclaring || []).join(',');
    const now    = census.sort().join(',');
    if (before !== now) fail('voice census', `was [${before}], now [${now}] — re-baseline with --update and tell SP-14`);
    else ok(`voice census unchanged (${census.length} module(s) declare voices to Schwung)`);
}

if (failures === 0) console.log('\n\x1b[32m\x1b[1mALL FLEET-PAGE CHECKS PASSED\x1b[0m');
else { console.log(`\n\x1b[31m\x1b[1m${failures} FLEET-PAGE CHECK(S) FAILED\x1b[0m`); process.exit(1); }
```

- [ ] **Step 2: Baseline and run**

```bash
node browser-test/fleet-pages.mjs --update   # writes fleet-expect.json
SCHWUNG=../schwung node browser-test/fleet-pages.mjs
```

Expected: all checks pass. The census line should read `0 module(s) declare voices to Schwung` against the July dump, or whatever Task 4 measured against a fresh one.

- [ ] **Step 3: Prove it has teeth**

The invariants pass on arrival, so they must be shown able to fail. Inject each class into a scratch copy of the dump and confirm a red run:

```bash
node --input-type=module -e "
import { readFileSync, writeFileSync } from 'node:fs';
const p = 'docs/module-dump/device-dump.json';
const d = JSON.parse(readFileSync(p, 'utf8'));
const m = d.modules.find(x => x.id === 'obxd');
const h = JSON.parse(m.ui_hierarchy);
// Two levels with the SAME name → two pages a user cannot tell apart.
h.levels.osc2.name = h.levels.osc1.name;
m.ui_hierarchy = JSON.stringify(h);
writeFileSync(p, JSON.stringify(d));
"
SCHWUNG=../schwung node browser-test/fleet-pages.mjs; echo "exit=$?   # expect 1, obxd two knobs pages both named …"
git checkout docs/module-dump/device-dump.json
```

Then the census, which is the one that guards Cause E:

```bash
node -e "const f='browser-test/fleet-expect.json',j=JSON.parse(require('fs').readFileSync(f));j.voiceDeclaring=['mrdrums'];require('fs').writeFileSync(f,JSON.stringify(j,null,2))"
SCHWUNG=../schwung node browser-test/fleet-pages.mjs; echo "exit=$?   # expect 1, voice census"
git checkout browser-test/fleet-expect.json
```

- [ ] **Step 4: Register and run the suite**

Add `node browser-test/fleet-pages.mjs` to `scripts.test` in `package.json`, after `dump-replay`. Then:

```bash
npm test                      # SKIPPED without a checkout
SCHWUNG=../schwung npm test    # green
```

- [ ] **Step 5: Commit**

```bash
git add browser-test/fleet-pages.mjs browser-test/fleet-expect.json package.json
git commit -m "$(cat <<'EOF'
test: the fleet, planned through Schwung's planner instead of movy's model

dump-replay replays movy's model — the layer `page` mode bypasses — so it cannot
see a re-pagination. This plans the same 76 modules the way the device will and
asserts what a user can actually navigate: no two pages with the same kind and
name (9W9 shipped 13 "Params - 2"), no knobs page with no keys, every page
nameable.

The invariants pass on arrival, so each is shown able to fail rather than
asserted to work: the 9W9 class is fixed upstream and this is what stops it
returning.

The voice census is a baselined report, not an assertion. Zero modules declare
voices to voicesOf() — that is Cause E, it is a module-side fact, and failing
the build for it would make every session red for something no session can fix.
A change in it is loud, which is what SP-14 needs.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Update the ledger** — SP-04 `✅`, and the census number under SP-14.

---

### Task 6: `page`-mode screenshot scenes

`schwungGridEnabled()` is `mode === 'body'`, so under `page` it is false, screenshot scenes pass no `bodyOverride`, and **every baseline renders movy's widgets whatever the flag says** — the suite passes vacuously (`docs/schwung-param-pages-findings.md` §5). Under `body` it does bite: 111 of 149 baselines differ. `GRID_BODY_RECT`'s *value* is asserted in `browser-test/logic/schwung-page.mjs`; its *use* at the `ctl.render` call is not, and §7 item 10 names that gap explicitly.

**Files:**
- Modify: `browser-test/screenshot.mjs` (new scenes; `PRESETS` at `:35`)
- Create: `browser-test/screenshots/baseline/page_*.png`

**Interfaces:**
- Consumes: `setSchwungGridMode`, `schwungActiveFor` from `dist/esm/renderer/schwung-grid.js`; `renderKnobsView(vm, jogTouched, activeSlot, bodyOverride, bank)` from `dist/esm/renderer/knob-view.js`; `SchwungPage.render(title, auto?, touched?)`, `.ready`, `.pageIndex`, `.pageCount`.
- Produces: baselines that fail if the rect stops being supplied at the `ctl.render` call.

- [ ] **Step 1: Add a scene that renders Schwung's body**

`renderKnobsView` already takes the two arguments this needs — `bodyOverride` and `bank` — because movy draws the bank bar from Schwung's page index and count (`knob-view.ts`). So the scene supplies both:

```js
/* PAGE MODE, DRAWN BY SCHWUNG. The rest of the baselines cannot reach it:
 * schwungGridEnabled() is `mode === 'body'`, so under `page` every existing
 * scene renders movy's widgets however the flag is set, and the suite reports
 * green about a renderer it never ran. */
case 'page_body': {
    setSchwungGridMode('page');
    const sp = schwungActiveFor(0, 'synth');
    if (!sp) throw new Error('page_body: no SchwungPage for track 0 — is SCHWUNG set?');
    /* The controller resolves the contract over several ticks (RETRY_TICKS 12 ×
     * RETRY_LIMIT 60 in schwung-page-contract.ts). Waiting on `ready` rather
     * than on a tick count keeps the scene deterministic on a slow machine. */
    for (let i = 0; i < 12 * 60 && !sp.ready; i++) { sp.tick(); advance(1); }
    if (!sp.ready) throw new Error('page_body: the contract never resolved');
    lastRender = () => renderKnobsView(model.getViewModel(), false, 0,
        () => sp.render('T1 > ' + MODULE_NAME),
        { index: sp.pageIndex, count: sp.pageCount });
    lastRender();
    break;
}
```

Add `'page_body'` to `PRESETS`. Reset the mode with `setSchwungGridMode(null)` after the scene so later scenes are unaffected — the mode is a module-level override, and leaving it set would silently repaint every scene after this one.

- [ ] **Step 2: Add a second scene one page in**

Same shape, named `page_body_p2`, with `sp.changePage(1)` before the render. One scene proves the body draws; a second proves the page index movy puts in the bank bar is Schwung's and not a frozen `0`, which is the Cause A symptom this suite can see.

- [ ] **Step 3: Generate and eyeball the baselines**

```bash
SCHWUNG=../schwung node build/browser.mjs
SCHWUNG=../schwung node browser-test/screenshot.mjs --update
open browser-test/screenshots/baseline/page_body.png browser-test/screenshots/baseline/page_body_p2.png
```

**Look at them.** A blank 128×64 frame will baseline itself perfectly and assert nothing. Expect widget rows at y=11 and y=35 (`GRID_BODY_RECT = {x:0, y:10, w:128, h:47}` reflowed), movy's bank bar on rows 8–9, and the two frames differing.

- [ ] **Step 4: Prove they have teeth — the actual §7 gap**

```bash
SCHWUNG=../schwung node browser-test/screenshot.mjs   # green
# Remove the rect from the ctl.render call in schwung-page-render.ts, then:
SCHWUNG=../schwung node build/browser.mjs && SCHWUNG=../schwung node browser-test/screenshot.mjs
# expect a diff on page_body — movyBandLayout reflows ONLY when a rect is
# supplied (`const reflow = !!o.rect`), so with none the body sits at y=9, on
# top of movy's bank bar. That diff is the coverage §7 item 10 asked for.
git checkout src/renderer/schwung-page-render.ts
```

- [ ] **Step 5: Run everything and commit**

```bash
SCHWUNG=../schwung npm test && npm test
git add browser-test/screenshot.mjs browser-test/screenshots/baseline/page_body.png \
        browser-test/screenshots/baseline/page_body_p2.png
git commit -m "$(cat <<'EOF'
test: `page` mode gets pixels, and the body rect gets its first real assertion

schwungGridEnabled() is `mode === 'body'`, so under `page` every scene rendered
movy's widgets whatever the flag said and the suite passed vacuously about a
renderer it never ran.

Two scenes now render Schwung's own body through renderKnobsView's bodyOverride,
the second one page in — because the bank bar index is Schwung's page index, and
a frozen 0 there is the Cause A symptom a screenshot can see.

Removing the rect from the ctl.render call now turns them red: movyBandLayout
reflows only when a rect is supplied, so without one the body lands on top of
movy's bank bar. That was the gap named in findings §7 item 10 — the rect's
value was asserted, its use was not.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Update the ledger** — SP-05 `✅`.

---

### Task 7: Fork install path and the version floor

Consequence of the fork-and-pin decision. Two halves, both about the same failure: a Schwung that cannot serve what movy needs must say so.

`schwungLibAvailable()` answers **availability, not vintage**, and the distinction is load-bearing — a Schwung with all six files present but an older `page_plan.mjs` fails with a *link* error (`Could not find export 'navLabelsOf'`), which `schwung-lib.ts` correctly catches and reports as "unavailable" with a message no user can act on.

**Files:**
- Create: `src/renderer/schwung-floor.ts`
- Modify: `src/renderer/schwung-lib.ts` (expose the installed version)
- Modify: `src/renderer/flags-view.ts` or wherever the Settings hint renders `schwungLibError()`
- Create: `scripts/install-schwung-fork.sh`
- Create: `browser-test/logic/schwung-floor.mjs`

**Interfaces:**
- Consumes: `host_read_file(path)` (already stubbed in `browser-test/env.mjs` and used by `dump-boot.mjs`); `/data/UserData/schwung/release.json`, whose keys are `version` and `download_url`.
- Produces: `schwungFloorMet(): boolean` and `schwungFloorReason(): string` from `src/renderer/schwung-floor.ts`; `SCHWUNG_FLOOR` the required version string. `schwungGridMode()` pins to `off` when the floor is unmet, exactly as it does when the library is unavailable.

- [ ] **Step 1: Write the failing test**

Create `browser-test/logic/schwung-floor.mjs`:

```js
/* schwung-floor.mjs — an under-floor Schwung must say WHICH version it needs.
 *
 * schwungLibAvailable() answers availability, not vintage, and that gap has a
 * shape: a Schwung with all six param_pages files but an older page_plan.mjs
 * fails with a LINK error ("Could not find export 'navLabelsOf'"), which is
 * caught and reported as "unavailable" — true, and useless to the person
 * holding the device. */
import { ok, eq, _log } from './harness.mjs';

export async function run() {
    _log('\nlogic: the schwung version floor');

    const { schwungFloorMet, schwungFloorReason, SCHWUNG_FLOOR } =
        await import('../../dist/esm/renderer/schwung-floor.js');

    const realRead = globalThis.host_read_file;
    const serve = (v) => { globalThis.host_read_file = (p) =>
        p === '/data/UserData/schwung/release.json'
            ? (v === null ? null : JSON.stringify({ version: v, download_url: '' }))
            : realRead?.(p) ?? null; };

    serve('0.11.4');
    eq('an old Schwung fails the floor', schwungFloorMet(), false);
    eq('and the reason names the floor', schwungFloorReason().includes(SCHWUNG_FLOOR), true);

    serve(SCHWUNG_FLOOR);
    eq('exactly the floor passes', schwungFloorMet(), true);

    serve('99.0.0');
    eq('a newer Schwung passes', schwungFloorMet(), true);

    /* No release.json at all is the interesting case: it is what a dev install
     * looks like, and refusing the grid there would make the device
     * untestable. Unknown is not under-floor. */
    serve(null);
    eq('an unreadable version does not fail the floor', schwungFloorMet(), true);

    globalThis.host_read_file = realRead;
    ok('the floor reads release.json and reports its reason');
}
```

Register it in `browser-test/logic.mjs` as `import { run as run_schwung_floor } from './logic/schwung-floor.mjs';` plus a `SUITES` entry.

- [ ] **Step 2: Run it and watch it fail**

Run: `SCHWUNG=../schwung node browser-test/logic.mjs 2>&1 | grep -A6 'version floor'`

Expected: a module-not-found error for `schwung-floor.js` — the file does not exist yet.

- [ ] **Step 3: Write the floor**

Create `src/renderer/schwung-floor.ts`:

```ts
/* schwung-floor.ts — which Schwung this movy needs, and how to say so.
 *
 * `schwungLibAvailable()` answers whether the six param_pages modules IMPORTED,
 * which is not the same question. A Schwung with all six files present but an
 * older page_plan.mjs fails with a LINK error — "Could not find export
 * 'navLabelsOf'" — and schwung-lib.ts catches it and reports "unavailable":
 * true, and nothing the person holding the device can act on.
 *
 * WHY THIS VALUE. `page` mode needs main at or past #405 (widget_registry.mjs),
 * #411 (voices.mjs), #414 and #415; an older install is missing those two files
 * outright. 1.3.0 is where the param contract ceiling became 128 KB, which movy
 * matches in chain_host.rs. Raise this when a feature starts depending on a
 * newer Schwung, and say which feature in the commit.
 */
export const SCHWUNG_FLOOR = '1.3.0';

const RELEASE = '/data/UserData/schwung/release.json';

/* PER COMPONENT, NUMERICALLY. A string compare puts '1.10.0' BELOW '1.3.3',
 * which would pin a perfectly good Schwung to MOVY the first time the minor
 * version reached double digits — a bug that hides for a year and then bites
 * every user at once. */
function atLeast(have: string, want: string): boolean {
    const h = have.split('.').map((n) => parseInt(n, 10) || 0);
    const w = want.split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(h.length, w.length); i++) {
        const a = h[i] ?? 0, b = w[i] ?? 0;
        if (a !== b) return a > b;
    }
    return true;                                  /* equal meets the floor */
}

/** The installed version, or '' when it cannot be read. */
export function schwungVersion(): string {
    try {
        const raw = host_read_file(RELEASE);
        if (!raw) return '';
        return String(JSON.parse(raw).version || '');
    } catch { return ''; }
}

/*
 * UNKNOWN IS NOT UNDER-FLOOR, and this is a deliberate choice rather than a
 * lenient default: a dev install — a checkout rsync'd onto the device — has no
 * release.json at all, and refusing the grid there would make the whole feature
 * untestable on the only machine that can test it. A wrong `true` here costs a
 * confusing render; a wrong `false` costs the device.
 */
export function schwungFloorMet(): boolean {
    const v = schwungVersion();
    return v === '' ? true : atLeast(v, SCHWUNG_FLOOR);
}

/** Why the switch is stuck on MOVY, for the Settings hint. Empty when it is not. */
export function schwungFloorReason(): string {
    if (schwungFloorMet()) return '';
    return 'needs Schwung ' + SCHWUNG_FLOOR + ' (have ' + schwungVersion() + ')';
}
```

`host_read_file` is already a device global and is stubbed in `browser-test/env.mjs`; declare it in `src/types/` if the typecheck does not already know it.

- [ ] **Step 4: Gate the mode on it**

In `src/renderer/schwung-grid.ts:54`, extend `schwungGridMode()`'s first clause so an unmet floor pins to `off` alongside an unavailable library. Keep the existing comment's reasoning: pinning is what makes the setting safe to expose at all.

Surface `schwungFloorReason()` wherever `schwungLibError()` already renders, so the Settings row says which version is needed rather than that something failed.

- [ ] **Step 5: Run the tests**

```bash
SCHWUNG=../schwung npm test
SCHWUNG=../schwung node browser-test/page-mode.mjs | tail -2   # still 13 of 13
```

- [ ] **Step 6: Write the fork installer**

Create `scripts/install-schwung-fork.sh`. It must **restart the stack**, not just copy files — QuickJS caches modules per `shadow_ui` process and `shadow_load_ui_module` renames only `ui.js`, not its imports, so a fresh `voices.mjs` links against the cached old `page_plan.mjs` and dies with `Could not find export 'navLabelsOf'`. `scripts/install.sh` (which reboots) is the reliable path; follow it.

Put this in the script's header comment, because it is the trap that costs an hour every time it is rediscovered:

```bash
# A FILE COPY IS NOT AN INSTALL, and the failure is silent: shadow_ui's stderr
# is /dev/null and the device has no syslog, so debug.log says only
# "shadow_load_ui_module returned false". To see the real message, deploy a
# throwaway ui.js that does the import inside try/catch and console.log's the
# error — console.log reaches debug.log.
```

- [ ] **Step 7: Verify on device, or say you could not**

```bash
./scripts/dev-probe.sh status
./scripts/install-schwung-fork.sh <branch>
./scripts/dev-probe.sh log
```

Confirm movy starts and the Settings row shows the fork's behaviour. If the device is unreachable, **report it to the user IN CAPS** and mark SP-06 `🔨` with the host-side half done.

- [ ] **Step 8: Prove the floor has teeth**

```bash
node -e "const f='src/renderer/schwung-floor.ts',s=require('fs').readFileSync(f,'utf8');require('fs').writeFileSync(f,s.replace(/SCHWUNG_FLOOR\s*=\s*'[^']*'/,\"SCHWUNG_FLOOR = '99.0.0'\"))"
SCHWUNG=../schwung node build/browser.mjs && SCHWUNG=../schwung node browser-test/logic.mjs 2>&1 | grep -A6 'version floor'
# expect ✗ on 'exactly the floor passes' — the floor is being read, not ignored
git checkout src/renderer/schwung-floor.ts
```

- [ ] **Step 9: Commit**

```bash
git add src/renderer/schwung-floor.ts src/renderer/schwung-grid.ts src/renderer/schwung-lib.ts \
        src/renderer/flags-view.ts scripts/install-schwung-fork.sh browser-test/logic/schwung-floor.mjs \
        browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
schwung: a version floor, because "unavailable" was true and useless

schwungLibAvailable() answers availability, not vintage. A Schwung with all six
param_pages files but an older page_plan.mjs fails with a LINK error —
"Could not find export 'navLabelsOf'" — which schwung-lib.ts correctly catches
and reports as unavailable, leaving the person holding the device with nothing
to act on.

The floor reads release.json and names the version it needs, and the mode pins
to MOVY when it is unmet, the same way it does when the library is missing. An
UNREADABLE version reads as met on purpose: that is what a dev install looks
like, and refusing the grid there would make the device untestable.

install-schwung-fork.sh restarts the stack rather than copying files, because
QuickJS caches modules per shadow_ui process and renames only ui.js — so a
fresh voices.mjs links against the cached old page_plan.mjs.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 10: Update the ledger** — SP-06 `✅` (or `🔨` if the device was unreachable), and put the floor value into Environment facts.

---

### Task 8: The A/B cost harness

**Opus.** Attribution is what failed last time (`docs/schwung-param-pages-findings.md` §4 "Why it is not attributed"), and SP-13 depends entirely on this being trustworthy.

Two scripts already exist untracked and are good. `scripts/grid-call-cost.mjs` counts **host calls** off device, on the reasoning that a `shadow_*_param` is a synchronous round-trip costing about one audio block whatever the value is — so the call count *is* the latency, in units a laptop can count exactly. `scripts/measure-grid-cost.sh` reads `perf_ipc` on device while injecting one CC carrying a real magnitude, because a flick is not sixty small turns.

Both have **stale usage lines**: they document `MOVY_SCHWUNG_GRID=off|page`, which reaches no build, so following them as written measures `off` twice and reports no difference.

`grid-call-cost.mjs` also records why the device arm must be passive: an injected control CC reaches schwung's cable-0 handler, cached at `shadow_ui` startup, not movy's — so movy's surface cannot be driven by script while it is overtaking. That is why the off-device call-count arm carries the burden and why it, not the device arm, becomes a suite.

**Files:**
- Modify: `scripts/grid-call-cost.mjs` (arm selection), `scripts/measure-grid-cost.sh` (arm selection) — both untracked; commit them
- Create: `browser-test/grid-cost.mjs`
- Modify: `package.json` (`scripts.test`)

**Interfaces:**
- Consumes: `setSchwungGridMode` from `dist/esm/renderer/schwung-grid.js`; `installEnv`, `installMockEngine`, `MOCK_SYNTHS` from `browser-test/`; `MOVY_APP_LOOP_GRID` from Task 1 if the device arm reuses it.
- Produces: `browser-test/grid-cost.mjs` fails when `page`-mode host calls per gesture exceed a committed budget relative to `off`. The budget is a **ratio**, not an absolute — an absolute number would drift with every unrelated change to how many params a page holds.

- [ ] **Step 1: Fix the arm selection in both scripts**

In `scripts/grid-call-cost.mjs`, replace the `MOVY_SCHWUNG_GRID` usage block with `setSchwungGridMode()` and a plain argument:

```js
/*   SCHWUNG=../schwung node build/browser.mjs
 *   node scripts/grid-call-cost.mjs off
 *   node scripts/grid-call-cost.mjs page
 *
 * MOVY_SCHWUNG_GRID used to appear here and reaches NO build — the mode became
 * the `schwunggrid` flag. Following the old lines ran `off` twice and reported
 * no difference, which is the one result an A/B must not be able to fake.
 */
const { setSchwungGridMode } = await import('../dist/esm/renderer/schwung-grid.js');
const ARM = process.argv[2];
if (ARM !== 'off' && ARM !== 'page') { console.error('usage: grid-call-cost.mjs off|page'); process.exit(2); }
setSchwungGridMode(ARM);
```

In `scripts/measure-grid-cost.sh`, replace the `MOVY_SCHWUNG_GRID=… node build/device.mjs` lines with setting the `schwunggrid` flag in the device's prefs (`0` = MOVY, `2` = PAGE), and note in the header that a **stored** flag beats a changed default.

- [ ] **Step 2: Check both arms actually differ**

```bash
SCHWUNG=../schwung node build/browser.mjs
node scripts/grid-call-cost.mjs off
node scripts/grid-call-cost.mjs page
```

Expected: two different call counts. **If they are equal the harness is broken, not the finding** — most likely `schwungLibAvailable()` is false, so `page` pinned itself to `off`. Print the resolved mode in both arms so this can never be mistaken for a result.

- [ ] **Step 3: Turn the off-device arm into a suite**

Create `browser-test/grid-cost.mjs`: run the same scripted gesture under both modes in one process — each arm in its own `spawnSync`, as `page-mode.mjs` does and for the same reason — and assert the ratio against a committed budget. Record the measured numbers in the file's comment with the date, so the next reader knows what the budget was set from rather than guessing at a magic constant.

Use a gesture that reproduces the complaint: a knob flick on a heavy module's page, then a jog page change. `docs/schwung-param-pages-findings.md` §Cause F names mini JV as the reproducer.

- [ ] **Step 4: Register and run**

Add `node browser-test/grid-cost.mjs` to `scripts.test`. Then `npm test` and `SCHWUNG=../schwung npm test` — both green, SKIPPED without a checkout.

- [ ] **Step 5: Prove it has teeth**

Raise the `page` arm's cost artificially — e.g. force `refreshOneParam` to run twice per tick — and confirm the suite goes red. Revert. Without this the budget is a number nobody has ever seen fail.

- [ ] **Step 6: Take the device baseline, or say you could not**

```bash
./scripts/dev-probe.sh status
./scripts/measure-grid-cost.sh off
./scripts/measure-grid-cost.sh page
```

Record both in the ledger under SP-13 — this is the "before" that SP-13 compares against after SP-12. If the device is unreachable, **report it IN CAPS**; the off-device arm still lands.

- [ ] **Step 7: Commit**

```bash
git add scripts/grid-call-cost.mjs scripts/measure-grid-cost.sh browser-test/grid-cost.mjs package.json
git commit -m "$(cat <<'EOF'
perf: the grid A/B becomes reproducible, and its arms can no longer be identical

Both scripts documented MOVY_SCHWUNG_GRID=off|page, which reaches no build — the
mode became the `schwunggrid` flag. Followed as written they ran `off` twice and
reported no difference, which is the one result an A/B must not be able to fake.
Arms are now selected with setSchwungGridMode() off device and the flag on it,
and each arm prints the mode it resolved.

The off-device arm becomes a suite with a RATIO budget rather than an absolute:
a shadow_*_param is a synchronous round-trip costing about one audio block, so
the call count is the latency in units a laptop can count exactly, while an
absolute number would drift with every unrelated change to page size.

The device arm stays passive because it has to: an injected control CC reaches
schwung's cable-0 handler, cached at shadow_ui startup, not movy's — so movy's
surface cannot be driven by script while it is overtaking.

SP-13 compares against the baseline recorded here.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Update the ledger** — SP-07 `✅`, and the baseline numbers under SP-13.

---

## Phase 0 exit criteria

Phase 1 starts when all of these hold:

- [ ] `SCHWUNG=../schwung npm test` green, and `npm test` green without a checkout
- [ ] `SCHWUNG=../schwung node browser-test/page-mode.mjs` prints `page-mode: 13 of 13 expected failures remain` and exits 0
- [ ] `browser-test/fleet-pages.mjs` green, with the voice census baselined and its number recorded under SP-14
- [ ] `page_body` and `page_body_p2` baselines exist, and removing the rect from the `ctl.render` call turns them red
- [ ] No file in `src/renderer/schwung-page*.ts` over 200 lines
- [ ] The dump's `generated_at` is this month, or the device was unreachable and that is **recorded in CAPS** in the ledger
- [ ] A device A/B baseline for both arms is in the ledger under SP-13, or the same CAPS note
- [ ] `docs/schwung-page-migration.md` shows SP-01 … SP-07 closed, each with its evidence

**Then stop.** Phase 1's first item (SP-10, the delegation boundary) is Opus work and gets its own plan written from the ledger at the start of its own session — not appended here.
