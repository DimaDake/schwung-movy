# Schwung PAGE-mode Work Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the work items from `docs/schwung-releases-review-2026-09.md` that actually change what movy does under the `schwunggrid = page` renderer — where **Schwung plans AND draws** and movy targets the parameters.

**Architecture:** Under `page` (`src/renderer/schwung-grid.ts:11`), Schwung's `param_pages` library owns the page plan, the widgets and the graphics. That inverts which of the review's §3 declarations are movy's problem: the ones Schwung's own planner reads are **already served**, and re-implementing them in movy's renderer is exactly what the review's §4.1 argues against. What is left for movy is the half Schwung's planner structurally cannot do — the things only the surface owner sees — plus the embedding API movy is not yet using.

**Tech Stack:** TypeScript (`src/`, ES modules built to `dist/esm/` by `node build/browser.mjs`), Node test harness (`browser-test/logic/*.mjs`), QuickJS on device, Schwung `param_pages` reached through `src/renderer/schwung-lib.ts`.

**Spec:** `movy/docs/schwung-releases-review-2026-09.md` (§3 table, §4.1), read against `movy/docs/schwung-param-pages-findings.md` (§3 smaller findings, §7 before-default-on) and the upstream contract in `charlesvestal/schwung` `docs/MODULES.md` on `origin/main`.

## Global Constraints

- **Scope filter, applied twice.** First: review §1–§3 only, no product decisions, nothing marked Large. Second: **only what changes behaviour under `schwunggrid = page`.** What that filter removed, and why, is in "What this plan deliberately does not build" at the end — it is a scope decision, not an oversight.
- **§1 and §2 are already DONE in this tree** and were re-verified while writing this plan: `ffi.rs:71` has `reserved: [*mut c_void; 8]`; `chain_host.rs:305` has `PARAM_BUF = 128 * 1024` with an `abi-parity.mjs` drift test against `SHADOW_PARAM_VALUE_LEN`; `chain_idle.rs::midi_tick_wake` exists with three unit tests and `mod_tick` is `#[must_use]`. Nothing in §1/§2 is open.
- **Reach Schwung only through `src/renderer/schwung-lib.ts`.** It is the one door, opened with a guarded top-level `await`, and it is what makes an old Schwung cost movy nothing but this feature. A new symbol is reached by **property access on the namespace object** and guarded with `typeof … === 'function'` at the call site — never destructured at import, which is a link error that takes the whole library down.
- **`schwung/` and `schwung-davebox/` are reference repos. Do not modify them.** Pull before reading: `git -C ../schwung fetch origin` — the local checkout is on `movy-min-host-1.1.0`, behind `origin/main`, so read contract text with `git show origin/main:<path>`.
- **Page-mode tests need the library.** `npm test` builds with the stub (`browser-test/stubs/schwung-param-pages.mjs`), which throws on import so `schwungLibAvailable()` answers false and the mode pins to `off`. Every page-mode assertion must be inside `if (schwungLibAvailable())`, the way `browser-test/logic/schwung-grid.mjs` already does it, and must be **exercised at least once** with `SCHWUNG=/Users/dake/git/cld/schwung npm test` before the task is called done. A guarded block that never ran is not coverage.
- **No code duplication** (CLAUDE.md). **Comments explain WHY**, never WHAT.
- **Every task ends green on `npm test`** (0 failures), and once more under `SCHWUNG=…`.
- **Prove each test has teeth**: remove the fix, watch the new test fail, restore.
- Device tests are the gate at the END of the plan (Task 3), not per task.

---

## Why these two, and not the rest of §3

Checked against `origin/main`, Schwung's planner reads these itself, so under `page` movy has nothing to add:

| §3 row | Where Schwung already reads it |
|---|---|
| `short_name` | `page_plan.mjs:440`, `:497` |
| `viz: {kind, group, role}` | `viz.mjs::resolveViz`, imported by `page_controller.mjs:43`; `page_plan.mjs:109` aligns the groups to rows |
| `options_as_string` | `param_format.mjs::learnEnumWireFormat` / `enumWireValue` |
| `access`, `focus_param` | already DONE movy-side, and independent of the renderer |

What is left is the half that depends on **who owns the hardware**, and the embedding API:

| Item | Why `page` needs movy to do it |
|---|---|
| `child_press_param` / `focus_press_param` (§3) | Schwung's own vouch fires from `shadow_ui_param_pages.mjs:1220` on `isHardwarePadPress(data)` — its shadow UI reading raw cable-0. Under overtake **movy** owns the surface; the controller movy embeds is fed decoded intents and never sees a pad. So only movy can vouch, and without it a declared rack's focus never moves. |
| `movyBandLayout()` / `movyHeaderFor()` (§4.1) | The review names them "available and unused"; 1.1.0 (#373) made the grid embeddable on purpose and movy's `bands: {header:false, bank:false, footer:false}` is the exact configuration it was built for. `schwung-page.ts:444` passes **no rect**, so the body lays out on Schwung's own vertical rhythm and overlaps movy's bank bar by 2 px. |

---

## File Structure

**New files:**

| File | Responsibility |
|---|---|
| `browser-test/logic/schwung-page.mjs` | Page-mode logic tests for both tasks, all guarded on `schwungLibAvailable()`. |

**Modified files:**

| File | Change |
|---|---|
| `src/renderer/schwung-lib.ts` | Two more symbols through the one door: `focusPressParamOf` (`voices.mjs`), `childPressParam` (`child_key.mjs`). |
| `src/renderer/schwung-voices.ts` | `VoiceSurface.pressParam` — a child level's `child_press_param`, else the root's `focus_press_param`. |
| `src/model/drum-declared.ts` | `DeclaredSurface.pressParam` (structural restatement only; `effectiveDrumConfig` is untouched). |
| `src/model/state.ts`, `src/model/hierarchy.ts`, `src/model/index.ts` | Carry it to `model.getPressParam()`. |
| `src/midi/router.ts` | Write the vouch at the single pad-note site, beside `focusVoice`. |
| `src/renderer/schwung-page.ts` | Pass the body rect; export it as a constant. |
| `src/renderer/schwung-body.ts` | Same rect for `body` mode; correct the "only rect that fits" comment. |
| `browser-test/logic.mjs` | Register the new suite. |
| `browser-test/logic/harness.mjs` | Export what the new suite needs. |
| `CHANGELOG.md`, `docs/schwung-releases-review-2026-09.md`, `docs/schwung-param-pages-findings.md` | Task 3. |

---

### Task 1: The live-press vouch — `child_press_param` / `focus_press_param`

**Files:**
- Modify: `src/renderer/schwung-lib.ts`
- Modify: `src/renderer/schwung-voices.ts`
- Modify: `src/model/drum-declared.ts`
- Modify: `src/model/state.ts`, `src/model/hierarchy.ts`, `src/model/index.ts`
- Modify: `src/midi/router.ts:363-388`
- Create: `browser-test/logic/schwung-page.mjs`
- Modify: `browser-test/logic.mjs`, `browser-test/logic/harness.mjs`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `model.getPressParam(): string | null`; `VoiceSurface.pressParam: string | null`; `DeclaredSurface.pressParam: string | null`. Task 2 does not depend on any of it.

**Context an implementer needs.**

The contract (`docs/MODULES.md`, "Live presses — a vouch, never a pad id"):

> While the grid shows a component with such a level (or a `focus_press_param` at the top of a sibling-shape hierarchy), the host forwards Move's hardware pad notes to itself **passively** — nothing is blocked, the pad still plays — and on each press writes `<prefix>:<child_press_param> = "1"`: *a finger did that.* Note-on only, one write per press.
>
> **It is a vouch, not a pad id.** The host does not say *which* pad, because the pad-to-note map is Move's … The module pairs the vouch with the note it receives itself, in either order … A vouch with no note inside the window is dropped; a note with no vouch is a sequenced note and moves nothing.

Why the module cannot do this alone: Move turns a pad press into an ordinary note *before* playing it, so by the time it reaches `on_midi` a hit and a sequenced note are the same bytes — "same status, channel, note and source (measured on device)".

**Why this is the page-mode item.** `src/midi/router.ts:384` already does movy's half of the follow:

```ts
const spd = schwungActiveFor(appState.activeTrack.index, model!.getComponentKey());
if (spd) spd.focusVoice(pad);
```

`focusVoice` walks `ctl.pages` and calls `ctl.goToPage(i)` for the level the voice declared — so under `page` the **page** moves to the pad you hit. What does not move is the **module's own focus**: its `child_index_param` / `focus_param`, which is what its per-voice keys resolve against. So today the page turns to the snare while the knobs still edit the kick. The vouch is the missing half, and it only exists on movy's side of the seam.

**Two design points, both load-bearing:**

1. **Not drum-only, so not on `DrumConfig`.** `focus_press_param` is a hierarchy *root* field; a module need not declare `pad_layout: drums` to want to be told. Putting it on `DrumConfig` silently skips every melodic module that declares it. It goes on `ModelState`.
2. **movy needs no `isHardwarePadPress` sift.** Schwung needs one because it reads raw cable-0 traffic where steps (16–31), track buttons (40–43) and knob touch (0–9) arrive as notes on the same cable. movy is the surface owner and has already decoded the press by `router.ts:358` (`d1 >= PAD_MIN && d1 <= PAD_MAX`, then `(status & 0xF0) === 0x90 && d2 > 0`). The sequencer's own notes never pass through that site. Say this in the comment, or someone will import `isHardwarePadPress` to be safe and gate a range that is already gated.

**Library availability.** Both symbols exist in the local checkout (`voices.mjs:60`, `child_key.mjs:167`) and on `origin/main`. `child_key.mjs` is safe to add to the `Promise.all`: `page_controller.mjs`, already imported, imports it — so it exists wherever the library does. The *missing-export* case is the real risk, which is why the call sites guard on `typeof`.

- [ ] **Step 1: Write the failing test**

Create `browser-test/logic/schwung-page.mjs`:

```js
/* browser-test/logic/schwung-page.mjs — what movy still owes the Schwung
 * renderer under `schwunggrid = page`, where Schwung plans AND draws.
 *
 * Under `page` most of the module contract is Schwung's to read — short_name,
 * viz groups and the enum wire format are all resolved inside param_pages. What
 * is left here is the half that depends on who owns the HARDWARE, plus the
 * embedding API movy was not using.
 *
 * EVERY ASSERTION IS GUARDED on schwungLibAvailable(). The default build swaps
 * param_pages for a stub that throws on import, which is the whole point — a
 * Schwung that cannot serve the library must cost movy nothing but this
 * feature. Run with SCHWUNG=/path/to/schwung to actually exercise these.
 *
 * Run by browser-test/logic.mjs.
 */

import { schwungLibAvailable, eq, _log } from './harness.mjs';

export async function run() {

if (!schwungLibAvailable()) {
    _log('\nlogic: schwung page mode — SKIPPED (no param_pages; set SCHWUNG=)');
    return;
}

_log('\nTest: a sibling-shape focus_press_param is read off the hierarchy root');
{
    const { surfaceOf } = await import('../../dist/esm/renderer/schwung-voices.js');
    const s = surfaceOf({
        pad_layout: 'drums',
        focus_param: 'ui_voice',
        focus_press_param: 'live_press',
        levels: {
            bass_drum: { name: 'Bass Drum', note: 36, knobs: ['vol'] },
            snare:     { name: 'Snare',     note: 38, knobs: ['vol'] },
        },
    });
    eq('the press param is read', s.pressParam, 'live_press');
    eq('and the focus param still is', s.focusParam, 'ui_voice');
}

_log('\nTest: a template-shape child_press_param is read off the child level');
{
    const { surfaceOf } = await import('../../dist/esm/renderer/schwung-voices.js');
    const s = surfaceOf({
        pad_layout: 'drums',
        levels: {
            pads: {
                child_count: 4, child_key_template: 'p{index}_{key}',
                child_index_param: 'focused_pad',
                child_press_param: 'live_press',
                child_note_base: 36,
                knobs: ['vol'],
            },
        },
    });
    eq('the child level’s press param is read', s.pressParam, 'live_press');
}

_log('\nTest: a module that declares neither has no press param');
{
    const { surfaceOf } = await import('../../dist/esm/renderer/schwung-voices.js');
    const s = surfaceOf({
        pad_layout: 'drums',
        levels: { bass_drum: { name: 'Bass Drum', note: 36, knobs: ['vol'] } },
    });
    eq('absent stays absent', s.pressParam, null);
    /* Absent is the answer for all 80 modules in docs/module-dump/, so this is
     * the case that must cost nothing — no write is ever made. */
}

_log('\nTest: a malformed declaration is an absent one');
{
    const { surfaceOf } = await import('../../dist/esm/renderer/schwung-voices.js');
    eq('non-string root field', surfaceOf({ focus_press_param: 7, levels: {} }).pressParam, null);
    eq('empty string', surfaceOf({ focus_press_param: '', levels: {} }).pressParam, null);
    eq('no hierarchy at all', surfaceOf(null).pressParam, null);
}

}
```

Register it in `browser-test/logic.mjs`: add
`import { run as run_schwung_page } from './logic/schwung-page.mjs';`
beside the other imports and `await run_schwung_page();` next to the existing `run_schwung_grid()` call. **Read the run block first and match its call style** — some suites are awaited and some are not.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd movy && SCHWUNG=/Users/dake/git/cld/schwung node build/browser.mjs && node browser-test/logic.mjs 2>&1 | grep -A6 "schwung page mode"`
Expected: FAIL — `surfaceOf` returns no `pressParam` field, so every assertion reads `undefined` against `'live_press'` / `null`.

Also run it **without** `SCHWUNG=` once and confirm the suite prints the SKIPPED line and does not fail. Both paths matter.

- [ ] **Step 3: Open the door in `schwung-lib.ts`**

Add to `interface SchwungLib`, after `voiceIndexFromNote`:

```ts
    /* OPTIONAL, and typed so: a Schwung predating the live-press contract
     * serves voices.mjs and child_key.mjs without these. Reached by property
     * access on the namespace object and guarded at the call site, so a missing
     * export is "the module has not said" rather than the link error that would
     * take the whole library — and with it the whole renderer — down. */
    focusPressParamOf?: any;
    childPressParam?:   any;
```

Add `child_key.mjs` to the `Promise.all`. It is safe: `page_controller.mjs`, already in the list, imports it, so it exists wherever the library does.

```ts
        // @ts-ignore
        import('/data/UserData/schwung/shared/param_pages/child_key.mjs'),
```

Bind it in the destructure (`const [pc, pi, rpm, el, wr, vo, ck] = await Promise.all([...])`) and add to the `lib = {...}` literal:

```ts
        focusPressParamOf: vo.focusPressParamOf, childPressParam: ck.childPressParam,
```

- [ ] **Step 4: Read the declaration in `schwung-voices.ts`**

Add to `interface VoiceSurface`:

```ts
    /** The param a hardware pad press writes `"1"` to, or null. A CHILD level's
     *  `child_press_param` first, else the root's `focus_press_param`. */
    pressParam: string | null;
```

Add `pressParam: null` to `EMPTY`. Add `pressParam: pressParamOf(lib, hierarchy),` to the object `surfaceOf` returns — inside the existing `try`, so a throwing library still answers `EMPTY`.

Above `surfaceOf`:

```ts
/* A child level's `child_press_param`, else the root's `focus_press_param`.
 *
 * NOT SCOPED TO THE PAGE YOU ARE ON, matching upstream: a level declaring this
 * is the module saying "tell me about presses", and which page you happen to be
 * looking at is not part of that request. Under `page` the grid follows the
 * module's focus from any page, so a hit while you are on the reverb page
 * should still land you on the drum you hit.
 *
 * Both reads are guarded because both exports are optional on an older Schwung,
 * and "the library cannot answer" is the same as "the module has not said". */
function pressParamOf(lib: any, hierarchy: any): string | null {
    if (typeof lib.childPressParam === 'function') {
        const levels = (hierarchy && hierarchy.levels) || {};
        for (const name of Object.keys(levels)) {
            const k = lib.childPressParam(levels[name]);
            if (k) return k;
        }
    }
    if (typeof lib.focusPressParamOf === 'function') {
        return lib.focusPressParamOf(hierarchy) ?? null;
    }
    return null;
}
```

`childPressParam` upstream already returns null for a level with no children (`hasChildren` guard), so no extra check is needed here — do not add one.

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd movy && SCHWUNG=/Users/dake/git/cld/schwung node build/browser.mjs && node browser-test/logic.mjs`
Expected: PASS.

- [ ] **Step 6: Commit the read half**

```bash
git add src/renderer/schwung-lib.ts src/renderer/schwung-voices.ts \
        browser-test/logic/schwung-page.mjs browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
read child_press_param / focus_press_param off the declaration

Both optional on an older Schwung, so both are reached by property
access and guarded — a missing export must not take the library, and
with it the whole renderer, down.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Carry it to the model**

In `src/model/drum-declared.ts`, add to `interface DeclaredSurface`:

```ts
    pressParam: string | null;
```

`effectiveDrumConfig` does **not** change: the vouch is not drum-only and must not ride `DrumConfig`, or every melodic module that declares `focus_press_param` is silently skipped. Note that in the interface comment.

In `src/model/state.ts`, beside `drumPadNames`:

```ts
    /* The module's declared live-press param (schwung's child_press_param /
     * focus_press_param), or null.
     *
     * Here rather than on DrumConfig because focus_press_param sits at the
     * hierarchy ROOT — a module need not declare a drum layout to want to be
     * told a finger did that. */
    pressParam:          string | null;
```

and `pressParam: null,` in the initialiser beside `drumPadNames: []`.

In `src/model/hierarchy.ts`, beside the `s.drumPadNames = …` assignment (around `:190`):

```ts
    s.pressParam = declaredSurface?.pressParam ?? null;
```

and extend the existing `mlog('drum-declared …')` call with:

```ts
       + ' press=' + (s.pressParam || '-')
```

That log is the only trace a declaration reached movy at all. Without the field, a press param that never arrived is indistinguishable from one that did and was never written — which is exactly the silent failure the surrounding comment exists to prevent.

In `src/model/index.ts`, beside `getDrumConfig()` (around `:434`):

```ts
        getPressParam(): string | null { return s.pressParam; },
```

- [ ] **Step 8: Write the vouch in the router**

In `src/midi/router.ts`, inside `if (d1 >= PAD_MIN && d1 <= PAD_MAX) {` → `if ((status & 0xF0) === 0x90 && d2 > 0) {`, **before** the `if (drumCfg)` branch so a melodic module that declares it is served too:

```ts
            /* "A finger did that." Move turns a pad press into an ordinary note
             * BEFORE playing it, so by the time it reaches the module's on_midi
             * a hit and a sequenced note are the same bytes — same status,
             * channel, note and source. This is the one fact the module cannot
             * get for itself, and under `page` it is the other half of the
             * follow: focusVoice() below moves the SCHWUNG page to the voice,
             * and this moves the MODULE's own focus, which is what its
             * per-voice keys resolve against. Without it the page turns to the
             * snare while the knobs still edit the kick.
             *
             * No hardware-press sift is needed here, unlike Schwung's own
             * vouch: that one reads raw cable 0, where steps, track buttons and
             * knob touch all arrive as notes. movy owns the surface and has
             * already decoded this as a pad — and the sequencer's notes never
             * reach this site.
             *
             * The vouch, never a pad id: the pad-to-note map is Move's, and a
             * module told "pad 68" could only address one bank, mis-strided.
             * The module pairs this with the note it receives itself. */
            const pressParam = model?.getPressParam();
            if (pressParam) {
                portFor(track).setParam(model!.getComponentKey() + ':' + pressParam, '1');
            }
```

`portFor` is already imported at `src/midi/router.ts:28`; `track` and `model` are already in scope from the lines above. Do not add a second route to the track.

- [ ] **Step 9: Add the model-level test**

Append to `browser-test/logic/schwung-page.mjs`, inside `run()`:

```js
_log('\nTest: the declared press param reaches the model');
{
    const { bootModel } = await import('./harness.mjs');
    const preset = {
        'synth:name': 'vouchrack', 'synth_module': 'vouchrack',
        'synth:ui_hierarchy': JSON.stringify({
            pad_layout: 'drums',
            focus_param: 'ui_voice',
            focus_press_param: 'live_press',
            levels: {
                bass_drum: { name: 'Bass Drum', note: 36, knobs: ['vol'] },
                snare:     { name: 'Snare',     note: 38, knobs: ['vol'] },
            },
        }),
        'synth:chain_params': JSON.stringify([
            { key: 'vol', name: 'Vol', type: 'float', min: 0, max: 1 },
        ]),
        'synth:vol': '0.5',
    };
    const m = bootModel(preset);
    for (let i = 0; i < 20; i++) m.tick();
    eq('the model carries the press param', m.getPressParam(), 'live_press');
}

_log('\nTest: a module declaring none leaves the model with null');
{
    const { bootModel } = await import('./harness.mjs');
    const preset = {
        'synth:name': 'plainrack', 'synth_module': 'plainrack',
        'synth:ui_hierarchy': JSON.stringify({
            pad_layout: 'drums',
            levels: { bass_drum: { name: 'Bass Drum', note: 36, knobs: ['vol'] } },
        }),
        'synth:chain_params': JSON.stringify([
            { key: 'vol', name: 'Vol', type: 'float', min: 0, max: 1 },
        ]),
        'synth:vol': '0.5',
    };
    const m = bootModel(preset);
    for (let i = 0; i < 20; i++) m.tick();
    eq('nothing declared, nothing carried', m.getPressParam(), null);
}
```

> Before writing these two, check how `bootModel` presets spell the hierarchy — read `browser-test/logic/drums.mjs`, which boots a declared rack already. If it uses a different key than `'synth:ui_hierarchy'`, use that one. A test that boots a model the harness cannot build passes by asserting nothing.

- [ ] **Step 10: Run everything and watch it pass**

Run: `cd movy && npm test` then `SCHWUNG=/Users/dake/git/cld/schwung npm test`
Expected: 0 failures both times.

- [ ] **Step 11: Prove it has teeth**

- Delete the `if (pressParam)` block in `router.ts`, confirm nothing in the logic suite catches it — that is expected, and it is why Step 12 adds the device check. Restore.
- Change `pressParamOf` to `return null;`, confirm the four surface tests and both model tests fail. Restore.
- Change `s.pressParam = declaredSurface?.pressParam ?? null;` to `= null;`, confirm the two model tests fail. Restore.

- [ ] **Step 12: Record — do not fake — the router write's coverage gap**

The router line is the one part no logic test reaches, and **it cannot be covered on the device today either.** Checked while writing this plan:

```bash
grep -rl "press_param" docs/module-dump/modules/   # no matches, 78 modules
grep -rl "focus_param" docs/module-dump/modules/   # no matches
```

Not one module in the fleet declares a press param or even a focus param — the dump predates both contracts, and `voice-poc`, the reference module, is a Schwung test module built only under `SCHWUNG_BUILD_TEST_MODULES=1`. A device scenario asserting the vouch would load a module that declares nothing, see no write, and pass by proving nothing. That is worse than no test.

So: **write no device scenario, and no `scripts/test-*.sh`** (CLAUDE.md: cheapest level that reproduces, and a bespoke script for something a unit test already covers is churn). Instead:

- Confirm the grep result yourself rather than trusting this plan — the fleet moves.
- Record the gap in Task 3's notes with the shape of the test that would close it: `test-device/scenarios/module-contract.ts` is the home (its own header states the pattern — "THE MODULE IS THE SUBJECT, NOT A FIXTURE ID": borrow a module that declares the behaviour into a slot, prove it, hand it back), and the assertion is a `set slot=<s> key=<comp>:<press_param> val=1` line in movy's debug log following a pad press, with no such line following a sequenced note on the same pad.
- Name the blocker: a fleet module declaring `child_press_param` or `focus_press_param`.

- [ ] **Step 13: Commit**

```bash
git add src/model/drum-declared.ts src/model/state.ts src/model/hierarchy.ts \
        src/model/index.ts src/midi/router.ts browser-test/logic/schwung-page.mjs
git commit -m "$(cat <<'EOF'
vouch a hardware pad press to the module

Under `page` focusVoice() already moves the Schwung page to the voice you
hit; this moves the MODULE's own focus, which is what its per-voice keys
resolve against. Without it the page turns to the snare while the knobs
still edit the kick.

On ModelState, not DrumConfig: focus_press_param is a hierarchy ROOT
field, so a melodic module can declare it too.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Give the embedded grid its rect — `movyBandLayout` as the supported API

**Files:**
- Modify: `src/renderer/schwung-page.ts:444`
- Modify: `src/renderer/schwung-body.ts:40-42`
- Modify: `browser-test/logic/schwung-page.mjs`
- Modify: `browser-test/logic/harness.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `export const PAGE_BODY_RECT = { x: 0, y: 10, w: 128, h: 47 }` from `src/renderer/schwung-page.ts`, imported by `schwung-body.ts` so the two modes cannot drift.

**Context an implementer needs.**

The review (§4.1): 1.1.0 (#373) made the grid **embeddable on purpose** — `movyBandLayout()` / `movyHeaderFor()` place header / bank bar / body / footer into a rect and let a caller take any subset, "so a tool can now keep its own chrome and host the real grid instead of writing a second one. That is movy's exact configuration (`bands: { header: false, bank: false, footer: false }`), now a supported API rather than a bend." Both symbols are listed as available and unused.

The cost of not using it is already measured, in `docs/schwung-param-pages-findings.md` → Smaller findings:

> **The body sits 2 px too high and overlaps movy's bank bar. CONFIRMED.** `schwung-page.ts:render()` passes no `rect`, so `movyBandLayout()` uses Schwung's own vertical rhythm: widget row 0 at `y=9`, on top of movy's bank bar (`BAR_Y 8`, `BAR_H 2` → rows 8–9), and the last label ends at 54 leaving three dead rows before `TOAST_Y 58`.

And upstream confirms the mechanism directly (`render_page_movy.mjs:3074`): **`const reflow = !!o.rect;`** — "Reflow now happens only when a rect is actually supplied. Without one, every band keeps the position the vertical rhythm gives it." So passing no rect is not a default; it is opting out of the layout.

**The arithmetic, verified against `origin/main` while writing this plan.** `BAND_H` (`render_page_movy.mjs:3015`) is `gutter0: 1, widget: 15, label: 7, gutter1: 2`, so a body needs exactly `1+15+7+2+15+7 = 47` rows. With `rect.y = 10`:

| | computed | movy's constant |
|---|---|---|
| widget row 0 | `10 + 1` = **11** | `ROW0_Y` = 11 ✓ |
| label row 0 | `11 + 15` = 26 | (movy's is 27 — see below) |
| widget row 1 | `26 + 7 + 2` = **35** | `ROW1_Y` = 35 ✓ |
| label row 1 | `35 + 15` = 50 | (movy's is 51) |
| body ends | `50 + 7` = 57 | `TOAST_Y` = 58 ✓ |

Both widget rows land exactly on movy's own row constants and the body stops one row short of the toast band. The label rows stay one row higher than movy's because Schwung's widget band is 15 tall and movy's is 16 — **that is not reachable from the rect**, and it is not this task's job. Say so in the comment so the next reader does not chase it.

`schwung-body.ts` has the same bug with `BODY_Y = 8, BODY_H = 48`, and a comment claiming this "is the only rect that fits". It is not: the requirement is 47 rows, so `y` has room. Correct the comment as well as the numbers — a wrong comment that sounds certain is worse than none.

- [ ] **Step 1: Write the failing test**

Append to `browser-test/logic/schwung-page.mjs`, inside `run()` (after the `schwungLibAvailable()` guard, so `BAND_H` is safe to read):

```js
_log('\nTest: the embedded body rect seats Schwung’s widget rows on movy’s own rows');
{
    const { PAGE_BODY_RECT } = await import('../../dist/esm/renderer/schwung-page.js');
    const { BAND_H } = await import('../../dist/esm/renderer/schwung-lib.js')
        .then((m) => m.schwungLib());
    const { ROW0_Y, ROW1_Y, BAR_Y, BAR_H, TOAST_Y } =
        await import('../../dist/esm/renderer/layout.js');

    /* This is the whole point of supplying a rect at all: upstream reflows ONLY
     * when one is given (render_page_movy.mjs, `const reflow = !!o.rect`), so
     * without it the body keeps Schwung's vertical rhythm and lands on movy's
     * bank bar. Asserting the arithmetic rather than the literal means the test
     * fails if EITHER side moves — movy's row constants or Schwung's band
     * heights. */
    const row0 = PAGE_BODY_RECT.y + BAND_H.gutter0;
    const row1 = row0 + BAND_H.widget + BAND_H.label + BAND_H.gutter1;
    const end  = row1 + BAND_H.widget + BAND_H.label;

    eq('widget row 0 is movy’s ROW0_Y', row0, ROW0_Y);
    eq('widget row 1 is movy’s ROW1_Y', row1, ROW1_Y);
    eq('the body clears the bank bar', PAGE_BODY_RECT.y >= BAR_Y + BAR_H, true);
    eq('and stops above the toast band', end <= TOAST_Y, true);
    eq('the rect is exactly the room a body needs', PAGE_BODY_RECT.h,
       BAND_H.gutter0 + BAND_H.widget + BAND_H.label
       + BAND_H.gutter1 + BAND_H.widget + BAND_H.label);
}

_log('\nTest: both embedded modes use ONE rect');
{
    /* `body` and `page` embed the same grid under the same chrome. Two
     * definitions of where it goes is how they came to disagree by 2 px in the
     * first place. */
    const { PAGE_BODY_RECT } = await import('../../dist/esm/renderer/schwung-page.js');
    const { BODY_Y, BODY_H } = await import('../../dist/esm/renderer/schwung-body.js');
    eq('body mode shares the page rect’s y', BODY_Y, PAGE_BODY_RECT.y);
    eq('body mode shares the page rect’s h', BODY_H, PAGE_BODY_RECT.h);
}
```

> `schwungLib()` throws when unavailable — that is why this block sits after the guard. Confirm `BAND_H` is on the `SchwungLib` interface (it is: `schwung-lib.ts` exports `BAND_H: rpm.BAND_H`). Confirm `layout.ts` exports the five constants under these names before writing the import.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd movy && SCHWUNG=/Users/dake/git/cld/schwung node build/browser.mjs && node browser-test/logic.mjs`
Expected: FAIL — `PAGE_BODY_RECT` is not exported, and `BODY_Y`/`BODY_H` are 8/48 against a required 10/47.

- [ ] **Step 3: Export the rect and pass it in `page` mode**

In `src/renderer/schwung-page.ts`, beside `const BANDS`:

```ts
/* WHERE the embedded grid goes. `BANDS` says what to draw; this says where, and
 * they are not the same question — upstream reflows ONLY when a rect is
 * supplied (`const reflow = !!o.rect` in render_page_movy.mjs), so passing none
 * is not a default, it is opting out. Without it the body kept Schwung's own
 * vertical rhythm: widget row 0 at y=9, straight over movy's bank bar (BAR_Y 8,
 * BAR_H 2), with three dead rows left under it.
 *
 * y=10, h=47 puts both widget rows exactly on movy's ROW0_Y/ROW1_Y and ends the
 * body at 57, one row above TOAST_Y. 47 is not a choice: it is
 * gutter0+widget+label+gutter1+widget+label, the room a body needs.
 *
 * The LABEL rows still land one row above movy's own (26/50 against 27/51),
 * because Schwung's widget band is 15 tall and movy's is 16. That is not
 * reachable from the rect and is deliberately not chased here. */
export const PAGE_BODY_RECT = { x: 0, y: 10, w: 128, h: 47 };
```

and at `render()`'s `ctl.render` call:

```ts
            ctl.render(ctx, { title, bands: BANDS, rect: PAGE_BODY_RECT });
```

- [ ] **Step 4: Share the rect with `body` mode**

In `src/renderer/schwung-body.ts`, replace the `BODY_Y`/`BODY_H` block:

```ts
/* ONE definition of where the embedded grid goes, shared with `page` mode.
 *
 * These were 8 and 48, with a comment saying that was the only rect that fits.
 * It was not: a body needs 47 rows (gutter0+widget+label+gutter1+widget+label),
 * so `y` had room — and 8 put widget row 0 on top of movy's bank bar. Two
 * modes embedding the same grid under the same chrome must not carry two
 * answers, which is how they came to disagree by 2 px. */
export const BODY_Y = PAGE_BODY_RECT.y;
export const BODY_H = PAGE_BODY_RECT.h;
```

with `import { PAGE_BODY_RECT } from './schwung-page.js';` at the top. **Check for an import cycle first** — if `schwung-page.ts` already imports from `schwung-body.ts`, put `PAGE_BODY_RECT` in `src/renderer/layout.ts` instead (where movy's other screen constants live) and import it into both. A TDZ at load is movy not starting; `schwung-grid.ts`'s own comment records that exact failure mode.

Whichever file ends up owning it, the `.off` stand-ins must keep compiling: check `schwung-page.off.ts` and `schwung-body.off.ts` and add the same export if either is expected to provide it.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd movy && SCHWUNG=/Users/dake/git/cld/schwung npm test`
Expected: 0 failures. Then `npm test` without `SCHWUNG=` — also 0 failures, with the page suite SKIPPED.

A screenshot baseline may move: `body` mode's rect changed, and `browser-test/screenshot.mjs:658` sets `schwunggrid` for the flags-page scene. If baselines shift, regenerate with `node browser-test/screenshot.mjs --update`, **look at the diff** and confirm it is the two-row shift you intended, then re-run.

- [ ] **Step 6: Prove it has teeth**

Set `PAGE_BODY_RECT.y` back to 8 and confirm "the body clears the bank bar" fails. Set `h` to 48 and confirm the room assertion fails. Remove the `rect:` argument from `ctl.render` — confirm nothing in the logic suite catches that, which is expected: the rect's *presence* at the call site is the one thing only a rendered frame can show. Note it for Task 3 rather than inventing a mock controller to assert an argument.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/schwung-page.ts src/renderer/schwung-body.ts \
        browser-test/logic/schwung-page.mjs browser-test/logic/harness.mjs
git commit -m "$(cat <<'EOF'
give the embedded grid its rect: y=10, h=47, one definition

movyBandLayout reflows ONLY when a rect is supplied, so passing none was
opting out: the body kept Schwung's vertical rhythm and put widget row 0
on movy's bank bar, with three dead rows under it. y=10 seats both
widget rows on movy's own ROW0_Y/ROW1_Y and ends at 57, one above the
toast band; 47 is the room a body needs, not a choice.

body mode carried 8/48 and a comment claiming that was the only rect
that fits. Both modes embed the same grid under the same chrome, so
they now share one constant.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Docs, bookkeeping, and the device gate

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/schwung-releases-review-2026-09.md`
- Modify: `docs/schwung-param-pages-findings.md`

**Interfaces:** none.

**Context an implementer needs.** Neither change is visible to someone using movy in the default renderer — `schwunggrid` is debug-only and defaults to MOVY — so `MANUAL.md` and `README.md` stay untouched. That is a deliberate call, not an omission: CLAUDE.md asks for MANUAL updates on *significant, user-facing* changes, and a debug-flag renderer's 2 px is neither. Say so in the commit message so the next reader can see the rule was applied rather than forgotten.

Both source documents carry status that is now stale, and leaving it is how the next reader re-does this work.

- [ ] **Step 1: Update the review document**

In §3's table, rewrite the `child_press_param` / `focus_press_param` row the way the already-resolved rows were rewritten — strike the stale claim, state what happened and where:

> ~~Not read.~~ **DONE 2026-09-13.** Read through `schwung-lib` (both exports optional and guarded), carried on `ModelState` rather than `DrumConfig` because `focus_press_param` is a hierarchy ROOT field, and written at `router.ts`'s single pad-note site beside `focusVoice`. Under `page` it is the other half of the follow: `focusVoice` moves the Schwung page, the vouch moves the module's own focus.

In §4.1, after the "Checked: every symbol `renderer/schwung-lib.ts` imports still exists" paragraph, record that `movyBandLayout`'s rect is now supplied (`PAGE_BODY_RECT`), and that `focusPressParamOf` has moved off the unused list. Leave `focusToken`, `voiceIndexFromLevel/Child/Wire`, `isHardwarePadPress`, `movyHeaderFor`, `drawPadGridIcon`, `registerOverlayWidgets` and `drawCustom` on it.

Add a short note under §3's table recording **why the other rows are not movy's work under `page`** — with the upstream line numbers from this plan's "Why these two" table. That is the finding this plan produced and it is worth more than the code: it says which half of the contract movy owns.

Update §7's ordered list to reflect what is now done.

- [ ] **Step 2: Update the findings document**

In §3 → Smaller findings, mark "The body sits 2 px too high" **FIXED 2026-09-13** with the rect and the reason (`reflow = !!o.rect`), and correct the claim about `schwung-body.ts`'s comment now that the comment is corrected.

In §7 "Before default-on", strike the body-rect half of item 9. Leave the held-step filter half open. Add a line to item 10 recording what is *still* uncovered and why:

- **The router's vouch write** — no module in `docs/module-dump/modules/` (78 of them) declares `child_press_param` or `focus_press_param`, and `voice-poc` is built only under `SCHWUNG_BUILD_TEST_MODULES=1`. A device scenario would pass by proving nothing. Home when a declaring module exists: `test-device/scenarios/module-contract.ts`; assertion: a `set slot=<s> key=<comp>:<press_param> val=1` log line after a pad press and none after a sequenced note on the same pad.
- **The `rect:` argument's presence** at `schwung-page.ts`'s `ctl.render` call — the constant's *value* is asserted, its *use* is not. A page-mode screenshot scene would cover it, and `browser-test/screenshot.mjs` has none (grep: no scene renders `page`), which is item 10's own second bullet.

- [ ] **Step 3: Write the CHANGELOG entry**

Under `## [Unreleased]` → `### Added` (the vouch) and `### Fixed` (the rect). Match the existing entries' density: they explain the mechanism and what it cost, not the diff. The vouch entry should carry the "page turns to the snare while the knobs edit the kick" symptom, because that is what a reader will recognise.

- [ ] **Step 4: Run local tests, both ways**

```bash
cd movy && npm test
SCHWUNG=/Users/dake/git/cld/schwung npm test
```
Expected: 0 failures both times. Both are required — the first proves the feature costs nothing without the library, the second proves the guarded assertions actually ran.

- [ ] **Step 5: Run the device tier**

`ping move.local` ALWAYS fails (ICMP is blocked) — probe with ssh. See `movy/CLAUDE.md` → Dev loop step 4.

```bash
cd movy && npm run test:device
```

The tier is a gate and retries a failed scenario itself, by cause. A red exit means it stayed red through the retry, and the evidence is already in `.test-out/<scenario>.md` — do not re-run it by hand. Fix it, or report the failing check to the user. **If the device is unreachable, report it IN CAPS** so the user knows device verification was skipped.

- [ ] **Step 6: Commit and push**

```bash
git add CHANGELOG.md docs/schwung-releases-review-2026-09.md \
        docs/schwung-param-pages-findings.md
git commit -m "$(cat <<'EOF'
docs: record the page-mode half of the schwung declarations

MANUAL and README deliberately untouched: schwunggrid is debug-only and
defaults to MOVY, so neither change is user-facing in the shipped
renderer.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push
```

---

## What this plan deliberately does not build

Stated so the omissions read as decisions. The first three were in the previous draft of this plan and were cut by the page-mode filter — reinstating any of them is a task-sized change, not a redesign.

**Cut because Schwung's planner already reads them under `page`:**

- **`options_as_string`** — `param_format.mjs::learnEnumWireFormat` / `enumWireValue` honour it, and under `page` Schwung commits the enum. A movy-side `learnEnumFmt` would only change movy's own write paths (automation replay, undo restore), which is a `MOVY`-mode improvement, not a page-mode one.
- **`viz: {kind, group, role}`** — `viz.mjs::resolveViz` (imported at `page_controller.mjs:43`) plus `page_plan.mjs:109` do the whole job upstream. Teaching movy's `envelope.ts` / `filter-viz.ts` / `lfo-viz.ts` / `eq-viz.ts` to read the same declaration is a second implementation of one contract, which is precisely what §4.1 argues against.
- **`short_name`** — already DONE movy-side, and `page_plan.mjs:440` does it upstream.

**Cut because it is renderer-independent, so not page-mode work:**

- **`capabilities.default_fx` + `preset` by name** — seeding a track's empty FX section on an interactive pick. Real §3 work with no product decision in it, unaffected by which renderer draws. It was Task 7 of the pre-filter plan and is ready to reinstate on request; the design there (readiness predicate shared with undo's staged restore, params before preset, empty-section guard, one undo group per seeded FX) still stands.
- **`capabilities.default_buses`** — needs a bus container movy's chain does not have. §4.2 work.

**Cut as out of scope by the original filter:**

- **`card_script` / `as_page` / `extra_keys` / `live: true`** — the §3 table's Large row.
- **§4.2 variable-length chains, §4.3 buses and per-voice sends, §4.4 boot target, §4.6 snapshot and recall** — product decisions or Large.

**Page-mode work this plan does NOT touch, and where it lives.** The `schwunggrid` before-default-on list (`docs/schwung-param-pages-findings.md` §7) has ten items and this plan closes half of one. The rest are their own plans, and two deserve naming because they sit next to what was built here:

- **Cause E — pad-scoped drum modules are not planned as voice pages.** 6W6, 8W8, 9W9 and cw-78 declare voices the *movy* way (`bank.pad` in `src/module-configs/`), so Schwung's planner does not know those levels are voices and `focusVoice()` returns false. Called "the most dramatic user-visible regression found". The findings doc names three possible homes for the fix, which makes it a decision rather than a task.
- **Cause G — parameter graphics disappear permanently under `page`.** `page_controller.mjs` gates graphics on `!s.decorations`, and `schwung-page.ts:416` sets decorations from whether a lane *exists*, so automating one cutoff kills that page's curves for good. The blunt gate is **upstream's**, so the fix is a Schwung PR, not a movy patch — and `schwung/` is a reference repo this plan may not modify.
