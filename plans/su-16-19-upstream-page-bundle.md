# SU-16…SU-19 — The opt-in upstream page bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One Schwung PR carrying every `param_pages` capability movy's
migrated pages need and cannot reach from the host — each one parametrized,
each one defaulting to today's behaviour.

**Architecture:** Two doors, both already established upstream. A per-param
field declared in `chain_params` or the inline hierarchy (`normalize()` is
`{ ...raw, key }`, so an undeclared field is invisible to every module that
does not write it), or an optional `io` hook on `createController` (which
already defaults `isModulated`, `formatValue` and `loadCard` inert). No
behaviour changes for an existing module, and each task proves that claim with
a fleet sweep rather than asserting it.

**Tech Stack:** Plain ES modules (`src/shared/param_pages/*.mjs`), node for the
host tests, `tests/host/test_*.sh` (CI runs every one of them: `.github/workflows/ci.yml:50`).

**Spec:** `movy/docs/superpowers/specs/2026-09-22-virtual-page-alignment-design.md`
— section *The upstream PR*. The host-side companion is
`movy/plans/sp-57-virtual-page-alignment.md`; nothing here blocks it.

## Global Constraints

- **Work in the schwung fork, on one branch.** The local `schwung/` checkout is
  a reference clone — confirm the remote and the branch before the first edit.
  Never patch `param_pages` inside movy and never vendor it.
- **Ruling 3 is the acceptance bar: with no declaration and no new io hook,
  every fleet module draws and turns byte-identically.** Every task ships a
  host test that asserts the *default*, not only the new path.
- **The fleet fixture is `tests/fixtures/module-contracts.json`** — the sweep
  the existing tests already use (`test_big_number_font.sh` is the model).
- **Sequencing matters more than completeness.** `page_controller.mjs` took 98
  commits in 90 days and `render_page_movy.mjs` 62; an ask that waits is an ask
  that gets overtaken. File the PR as soon as Task 6 is green, and iterate in
  review rather than holding it back.
- **U4 (SU-19) is conditional and has no task here.** It exists only if the
  host plan's Task 6 proves on the device that `onKnobTouch`'s peek-clear is
  what costs movy the overlay. If it does, add it to this branch before Task 7
  as a fifth item, shaped like U2: a hook or a declaration that keeps a peek
  alive across the touch that raised it, defaulting to today's clear. If the
  device exonerates the touch, drop SU-19 from the PR title and the ledger.
- **Do not change `SU-6`** (the 15-vs-16 widget band). It is a layout
  correction, cannot be opt-in, and is deliberately out of this bundle.
- **No apostrophes inside the node scripts in `tests/host/*.sh`** — they are
  single-quoted bash strings (the existing tests say so).

---

## File structure

| file | responsibility | task |
| --- | --- | --- |
| `src/shared/knob_engine.mjs` | U1's `turn: "absolute"`; SU-13's feel overrides | 2, 6 |
| `src/shared/param_pages/page_controller.mjs` | U2's `io.enumPeek`; SU-13's throttle; SU-8's decoration bit | 3, 6 |
| `src/shared/param_pages/render_page_movy.mjs` | U3's declaration, the enum lift, the resolved text, the width guard | 4 |
| `src/shared/param_pages/font_big_num.mjs` | U3's atlas — the glyphs a non-numeric big value needs | 5 |
| `src/shared/param_pages/anim_state.mjs` | SU-11's per-key duration | 6 |
| `tests/host/test_turn_absolute.sh` | U1, both paths | 2 |
| `tests/host/test_enum_peek_hook.sh` | U2, both paths | 3 |
| `tests/host/test_big_value_declared.sh` | U3, both paths + the fleet sweep | 4, 5 |
| `docs/MODULES.md` | the three new declarations, documented where authors read | 7 |

---

### Task 1: Branch, and a baseline that proves "nothing changed"

Before adding a door, establish the measurement that every later task is judged
against: what the fleet plans and draws today. Without it, "no existing
rendering changed" is an assertion; with it, it is a diff of two files.

**Files:**
- Create: `tests/host/test_fleet_render_baseline.sh`
- Create: `tests/fixtures/fleet-render-baseline.json` (generated)

**Interfaces:**
- Produces: `tests/fixtures/fleet-render-baseline.json` — for every module in
  the fleet fixture, for every planned page, for every key: the widget kind
  (`widgetKindFor`) and, for an enum, whether the knob toggles
  (`isTwoWayMeta`). Tasks 2–6 re-run this and assert byte equality.

- [ ] **Step 1: Confirm the fork and cut the branch**

```bash
cd ../schwung
git remote -v                       # expect the fork alongside upstream
git fetch origin
git switch -c feat/param-pages-opt-in-bundle origin/main
```

If the checkout has no fork remote, stop and ask — pushing this to upstream
`main` is not the plan.

- [ ] **Step 2: Write the baseline generator + checker**

Create `tests/host/test_fleet_render_baseline.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

# WHAT THE FLEET DRAWS TODAY, PINNED.
#
# Every item in this branch is opt-in, and "opt-in" is a claim about modules
# that declare NOTHING. That claim is cheap to make and easy to break by
# accident -- a predicate widened one clause too far takes the whole fleet with
# it -- so it is measured rather than asserted: the widget kind of every cell of
# every planned page of every module in the fixture, plus whether each enum
# toggles under the knob.
#
# Regenerate ONLY when a change is meant to move the fleet. In this branch,
# nothing is.
#
# NO APOSTROPHES inside the node script: single-quoted bash string.

node --input-type=module -e '
import fs from "node:fs";
import { widgetKindFor } from "./src/shared/param_pages/render_page_movy.mjs";
import { buildMetaIndex } from "./src/shared/param_pages/param_meta.mjs";
import { planPages } from "./src/shared/param_pages/page_plan.mjs";
import { isTwoWay } from "./src/shared/knob_engine.mjs";

const fleet = JSON.parse(fs.readFileSync("tests/fixtures/module-contracts.json", "utf8")).modules;
const out = {};
for (const c of fleet) {
    let cp = c.chain_params;
    if (typeof cp === "string") { try { cp = JSON.parse(cp); } catch { continue; } }
    if (!Array.isArray(cp)) continue;
    let plan;
    try { plan = planPages({ hierarchy: c.ui_hierarchy, chainParams: cp }); } catch { continue; }
    const metaIndex = buildMetaIndex({ hierarchy: c.ui_hierarchy, chainParams: cp });
    const cells = [];
    for (const page of plan.pages || []) {
        for (const k of page.keys || []) {
            if (!k) continue;
            const m = metaIndex.getOrGuess(k);
            cells.push(k + "=" + widgetKindFor(m) + (isTwoWay(m) ? "/twoway" : ""));
        }
    }
    out[c.id] = cells;
}
const path = "tests/fixtures/fleet-render-baseline.json";
const text = JSON.stringify(out, null, 1) + "\n";
if (process.env.UPDATE_BASELINE === "1") {
    fs.writeFileSync(path, text);
    console.log("PASS: baseline written, " + Object.keys(out).length + " modules");
} else if (!fs.existsSync(path)) {
    console.log("FAIL: no baseline; run with UPDATE_BASELINE=1 once");
    process.exit(1);
} else if (fs.readFileSync(path, "utf8") !== text) {
    console.log("FAIL: the fleet draws differently than the baseline records");
    process.exit(1);
} else {
    console.log("PASS: fleet unchanged, " + Object.keys(out).length + " modules");
}
'
```

- [ ] **Step 3: Export the predicate the baseline needs**

`isTwoWayMeta` is module-private in `knob_engine.mjs`. Export it under a public
name so the test can ask without duplicating the rule:

```js
/** Exported for the fleet baseline: a test that restates this predicate is a
 *  test of its own copy of the rule. */
export function isTwoWay(meta) { return isTwoWayMeta(meta); }
```

- [ ] **Step 4: Generate the baseline and check it is stable**

```bash
chmod +x tests/host/test_fleet_render_baseline.sh
UPDATE_BASELINE=1 bash tests/host/test_fleet_render_baseline.sh
bash tests/host/test_fleet_render_baseline.sh
```

Expected: `PASS: baseline written, N modules`, then `PASS: fleet unchanged, N
modules`. If the second run fails, the generator is not deterministic — fix
that now, because every later task leans on it.

- [ ] **Step 5: Commit**

```bash
git add tests/host/test_fleet_render_baseline.sh \
        tests/fixtures/fleet-render-baseline.json src/shared/knob_engine.mjs
git commit -m "tests: pin what the fleet draws today

Every item on this branch is opt-in, which is a claim about modules that
declare nothing — cheap to make, and easy to break by accident when a
predicate is widened one clause too far. So it is measured: the widget kind of
every cell of every planned page of every module in the fixture, plus whether
each enum toggles under the knob.

isTwoWayMeta is exported as isTwoWay for the same reason the sweep exists at
all: a test that restates the rule is a test of its own copy of it."
```

---

### Task 2: U1 — a two-option enum may step instead of toggle

**The behaviour being made optional exists for a reason, and the PR must say
so.** `knobStep`'s two-way branch was itself a device-report fix: a boxed
two-way shows a state and not a direction, so "turned left, nothing, forever"
read as a dead control — *"if there are only two, why not let it wrap otherwise
you have to know which way is off and which way is on"*. That argument holds
for a module whose two options are a choice in a box. It does not hold where
the host knows the pair is ordered (Chromatic → In Key) and wants a turn to be
deterministic. Hence a declaration, not a change of default.

**Files:**
- Modify: `src/shared/knob_engine.mjs`
- Create: `tests/host/test_turn_absolute.sh`

**Interfaces:**
- Consumes: `isTwoWay` from Task 1.
- Produces: per-param `turn: "absolute"`. Absent → today's toggle.

- [ ] **Step 1: Write the failing test**

Create `tests/host/test_turn_absolute.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

# A TWO-OPTION ENUM MAY ASK TO BE STEPPED RATHER THAN TOGGLED.
#
# The toggle is the default and stays the default: it exists because a boxed
# two-way shows a state and not a direction, so a direction-absolute turn has a
# dead half for anyone who cannot see which way is on. A host that DOES know
# the pair is ordered -- a note mode, a pad layout -- can say so per param.
#
# Both paths are asserted here. The default one is the one that matters.
#
# NO APOSTROPHES inside the node script: single-quoted bash string.

node --input-type=module -e '
import { knobInit, knobStep } from "./src/shared/knob_engine.mjs";

let fail = 0;
const bad = (m) => { console.log("FAIL: " + m); fail++; };

const choice = { type: "enum", kind: "enum", options: ["Chromatic", "In Key"], min: 0, max: 1, step: 1 };
const declared = { ...choice, turn: "absolute" };

/* DEFAULT: every detent flips, whichever way it went. */
let st = knobInit(0);
let v = 0;
for (let i = 0; i < 4; i++) v = knobStep(st, choice, 1, 1000 + i * 1000);
if (v !== 0) bad("the default stopped toggling: four clockwise detents landed on " + v);

/* DECLARED: direction decides, and a continued turn stays put. */
st = knobInit(0);
for (let i = 0; i < 4; i++) v = knobStep(st, declared, 1, 1000 + i * 1000);
if (v !== 1) bad("turn:absolute clockwise landed on " + v + ", want 1");
for (let i = 0; i < 4; i++) v = knobStep(st, declared, -1, 9000 + i * 1000);
if (v !== 0) bad("turn:absolute counter-clockwise landed on " + v + ", want 0");

/* A SWITCH IS UNAFFECTED: it was already direction-absolute, and the
 * declaration must not make it something else. */
const sw = { type: "enum", kind: "enum", options: ["Off", "On"], min: 0, max: 1, step: 1 };
st = knobInit(0);
v = knobStep(st, sw, 1, 1000);
if (v !== 1) bad("an Off/On switch stopped being direction-absolute");

if (fail) process.exit(1);
console.log("PASS: turn:absolute steps, and the default still toggles");
'
```

- [ ] **Step 2: Run it and watch it fail**

```bash
chmod +x tests/host/test_turn_absolute.sh && bash tests/host/test_turn_absolute.sh
```

Expected: FAIL on `turn:absolute clockwise landed on 0` — the declaration is
ignored, so four detents toggle twice and land back at 0.

- [ ] **Step 3: Implement the branch**

In `src/shared/knob_engine.mjs`, inside `knobStep`, at the head of the two-way
branch (before the toggle):

```js
    /*
     * ...UNLESS THE PARAM ASKS TO BE STEPPED.
     *
     * The toggle below is right for a boxed two-way whose options are a choice
     * -- Mix/Reverb -- because the box shows a state and not a direction, so
     * half of every reach would read as a dead control. It is wrong where the
     * pair is ORDERED and the caller knows it: a note mode, a pad layout, a
     * host-owned page whose knob should land where the wrist pointed. Those
     * declare `turn: "absolute"` and get the switch`s own rule -- clockwise to
     * the second option, counter-clockwise to the first -- with no gesture
     * latch, because a turn that lands on the value it is already on writes
     * nothing to latch against.
     *
     * Per param and opt-in: nothing in the fleet declares it, so nothing in
     * the fleet moves (tests/host/test_fleet_render_baseline.sh).
     */
    if (isTwoWayMeta(meta) && meta.turn === "absolute") {
        state.value = delta > 0 ? switchOnValue(meta) : (switchOnValue(meta) === 1 ? 0 : 1);
        state.lastDirection = Math.sign(delta);
        state.lastTurnMs = nowMs;
        return state.value;
    }
```

Place it immediately before the existing switch branch so a declared Off/On
pair takes the same path it always did.

- [ ] **Step 4: Run it and watch it pass**

```bash
bash tests/host/test_turn_absolute.sh
```

Expected: `PASS: turn:absolute steps, and the default still toggles`.

- [ ] **Step 5: Prove the fleet did not move**

```bash
bash tests/host/test_fleet_render_baseline.sh
```

Expected: `PASS: fleet unchanged`.

- [ ] **Step 6: Prove the teeth**

Drop the `&& meta.turn === "absolute"` clause so the branch takes every
two-way. Re-run both tests: `test_turn_absolute.sh` must fail on *the default*
assertion, and the fleet baseline must fail too. That pair is the evidence the
gate works. Restore.

- [ ] **Step 7: Commit**

```bash
git add src/shared/knob_engine.mjs tests/host/test_turn_absolute.sh
git commit -m "knob: a two-option enum may declare turn: absolute

The toggle stays the default and stays right: a boxed two-way shows a state
and not a direction, so direction-absolute has a dead half for anyone who
cannot see which way is on — which is the device report that put the toggle
there.

It is wrong where the pair is ORDERED and the caller knows it. A note mode or
a pad layout turned clockwise should land on the second option and stay there,
not walk back and forth under a continued turn. Those declare turn: absolute
and take the switch's own rule; everything else is untouched, and the fleet
baseline is what says so."
```

---

### Task 3: U2 — the peek may be suppressed when the box already says it

`page_controller.mjs:3402-3420` already declines to raise the peek on a list
layout, with the reasoning spelled out in its own comment: a list row prints
the option in full, so the panel *"covers a legible answer with the same
answer"*, and it records a device report about exactly that. The grid has the
same case whenever the cell already shows the whole option. Only the host knows
when that is true for its own layout, so the judgement is injected.

**Files:**
- Modify: `src/shared/param_pages/page_controller.mjs`
- Create: `tests/host/test_enum_peek_hook.sh`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `io.enumPeek(key, meta) -> boolean | null`. Absent, or null →
  today's rule.

- [ ] **Step 1: Write the failing test**

Create `tests/host/test_enum_peek_hook.sh`, modelled on the existing
`tests/host/test_enum_peek.sh` (read it first — it already builds a controller
over a fake io and turns a knob, which is most of this test):

```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

# THE HOST MAY DECLINE THE PEEK.
#
# The controller already declines it on a list layout, because a row prints the
# option in full and the panel would cover a legible answer with the same
# answer. A grid cell can be in the same position -- a three-character option in
# a box that fits it -- but only the host knows how its own cells are drawn, so
# the judgement is injected rather than guessed here.
#
# Default absent = raised, exactly as before. That is the assertion that
# matters.
#
# NO APOSTROPHES inside the node script: single-quoted bash string.

node --input-type=module -e '
import { createController } from "./src/shared/param_pages/page_controller.mjs";

let fail = 0;
const bad = (m) => { console.log("FAIL: " + m); fail++; };

const chain = [{ key: "shape", name: "Shape", type: "enum",
                 options: ["Sine", "Saw", "Square", "Noise"], wire_format: "index" }];
const values = { shape: "0" };
const baseIo = {
    getParam: (k) => {
        if (k.endsWith("ui_hierarchy")) return JSON.stringify({ levels: { root: { knobs: ["shape"] } } });
        if (k.endsWith("chain_params")) return JSON.stringify(chain);
        return values[k.split(":").pop()] ?? null;
    },
    setParam: (k, v) => { values[k.split(":").pop()] = v; return true; },
};

function peekAfterTurn(io) {
    const ctl = createController(io);
    ctl.load();
    for (let i = 0; i < 8; i++) ctl.onKnobTurn(0, 1, 1000 + i * 100);
    return ctl.enumPeek();
}

if (!peekAfterTurn({ ...baseIo })) bad("the default stopped raising the peek");
if (!peekAfterTurn({ ...baseIo, enumPeek: () => null })) bad("a null answer did not fall through");
if (peekAfterTurn({ ...baseIo, enumPeek: () => false })) bad("the host declined and the peek was raised anyway");
if (!peekAfterTurn({ ...baseIo, enumPeek: () => true })) bad("the host asked for it and it was not raised");

if (fail) process.exit(1);
console.log("PASS: enumPeek is consulted, and absent means raised");
'
```

- [ ] **Step 2: Run it and watch it fail**

```bash
chmod +x tests/host/test_enum_peek_hook.sh && bash tests/host/test_enum_peek_hook.sh
```

Expected: FAIL on `the host declined and the peek was raised anyway` — the hook
does not exist, so `{ enumPeek: () => false }` changes nothing.

- [ ] **Step 3: Accept the hook**

In `createController(io)`, beside `formatValue`:

```js
    /*
     * Optional: may this key raise the option panel on a turn?
     *
     *   enumPeek(key, meta) -> true | false | null
     *
     * The controller already declines on a list layout -- a row prints the
     * option in full, so the panel covers a legible answer with the same one --
     * and a grid cell can be in that same position when its box happens to fit
     * the whole option. Whether it does is a question about the HOST`s cells,
     * not about this metadata, so it is injected on the same terms as
     * isModulated and formatValue: absent, or null for a given key, and the
     * existing rule decides.
     */
    const enumPeekAllowed = io.enumPeek || null;
```

- [ ] **Step 4: Consult it at the one site that raises the peek**

In `onKnobTurn`, the condition that builds `s.peek` gains a final clause:

```js
        const hostAllows = enumPeekAllowed ? enumPeekAllowed(key, meta) : null;
        if (hostAllows !== false
            && s.layout !== LAYOUT_LIST
            && meta.divable && meta.kind === KIND_ENUM
            && !drawnWide(key) && !drawnAsSwitch(key)
            && Array.isArray(meta.options) && meta.options.length >= 2) {
```

`true` deliberately does not force it past the other gates: a wide graphic or a
list row still wins, because those are facts about what is already on screen.
The hook can only decline something the controller would otherwise raise.

- [ ] **Step 5: Run it and watch it pass, then sweep**

```bash
bash tests/host/test_enum_peek_hook.sh
bash tests/host/test_enum_peek.sh
bash tests/host/test_fleet_render_baseline.sh
```

Expected: all three PASS. The pre-existing `test_enum_peek.sh` is the real
default check — it was written before this hook existed.

- [ ] **Step 6: Prove the teeth**

Invert the clause to `hostAllows === false` and confirm
`test_enum_peek_hook.sh` fails on the *default* assertion. Restore.

- [ ] **Step 7: Commit**

```bash
git add src/shared/param_pages/page_controller.mjs tests/host/test_enum_peek_hook.sh
git commit -m "page: a host may decline the enum peek per key

The controller already declines on a list layout, for a reason its own comment
records: a row prints the option in full, so the panel covers a legible answer
with the same answer, and that was reported from the device. A grid cell can be
in exactly that position when its box fits the whole option — but whether it
does is a question about the host's cells, not about this metadata.

So it is injected, on the same terms as isModulated and formatValue: absent, or
null for a key, and the existing rule decides. True cannot force a peek past
the wide-graphic or list gates — those are facts about what is already drawn.
The hook only declines."
```

---

### Task 4: U3 — a param may declare that its value is drawn in the big face

Four parts, one door. The first three are in `render_page_movy.mjs`; the atlas
is Task 5, and this task's fleet sweep will show exactly which glyphs it needs.

**Files:**
- Modify: `src/shared/param_pages/render_page_movy.mjs`
- Create: `tests/host/test_big_value_declared.sh`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: per-param `display: "big"`; `bigValueText(meta, raw, cellText)`
  exported from `render_page_movy.mjs`.

- [ ] **Step 1: Read the call site first**

```bash
grep -n "drawKnobWidget(" -A 6 src/shared/param_pages/render_page_movy.mjs | head -40
grep -n "cellText" src/shared/param_pages/render_page_movy.mjs | head -20
```

Confirm where `cellText` comes from at the call site — it is the text the page
has already resolved for the label band, and part 2 below depends on it being
the *formatted* reading (including anything `formatValue` supplied). If it is
not, resolve the text the same way the enum branch does and say so in the
comment; do not guess.

- [ ] **Step 2: Write the failing test**

Create `tests/host/test_big_value_declared.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

# A PARAM MAY ASK FOR THE BIG FACE, WHATEVER ITS VALUE LOOKS LIKE.
#
# isCountedQuantity already concedes the principle: some numbers are read, not
# aimed. But the only way in is a name this file happens to recognise, and the
# face can only spell integers -- so a swing percentage, a clip length in steps
# and a 2:4 trig condition, which are the same shape, cannot ask.
#
# The guard moves with it: three digits was a proxy for "does it fit", and once
# the text is arbitrary the honest test is the measured width.
#
# NO APOSTROPHES inside the node script: single-quoted bash string.

node --input-type=module -e '
import { shouldDrawBigNumber, bigValueText, widgetKindFor, WIDGET_BIGNUM, CELL_W }
    from "./src/shared/param_pages/render_page_movy.mjs";
import { fontWidth, missingGlyphs } from "./src/shared/param_pages/font_big_num.mjs";

let fail = 0;
const bad = (m) => { console.log("FAIL: " + m); fail++; };

/* DEFAULTS, first and last: the span cap and the enum refusal are unchanged. */
const wideInt = { type: "int", kind: "number", key: "cutoff", name: "Cutoff", min: 0, max: 127, step: 1 };
if (shouldDrawBigNumber(wideInt)) bad("a wide int started drawing big without asking");
const plainEnum = { type: "enum", kind: "enum", key: "shape", name: "Shape", options: ["Sine", "Saw"] };
if (shouldDrawBigNumber(plainEnum)) bad("an enum started drawing big without asking");

/* DECLARED: the span cap and the enum refusal both yield. */
const swing = { ...wideInt, key: "swing", name: "Swing", min: 50, max: 80, display: "big" };
if (!shouldDrawBigNumber(swing)) bad("display:big did not lift the span cap");
if (widgetKindFor(swing) !== WIDGET_BIGNUM) bad("display:big did not reach the widget");
const cond = { ...plainEnum, key: "cond", name: "Condition",
               options: ["1:1", "1:2", "2:2"], display: "big" };
if (!shouldDrawBigNumber(cond)) bad("display:big did not lift the enum refusal");

/* THE TEXT IS THE ONE THE PAGE RESOLVED, not one recomputed from the raw. */
if (bigValueText(cond, "2", "2:2") !== "2:2") bad("a declared enum drew its index, not its option");
if (bigValueText(swing, "54", "54%") !== "54%") bad("a declared int dropped the reading it was given");
if (bigValueText(swing, null, null) !== "--") bad("an unread value stopped drawing --");

/* THE GUARD IS A MEASURED WIDTH, so a declaration cannot smear into the next
 * cell however long the option is. */
const longEnum = { ...cond, options: ["Mixolydian"], display: "big" };
if (fontWidth("Mixolydian") <= CELL_W - 2)
    bad("the test fixture is not actually too wide; pick a longer one");
if (shouldDrawBigNumber(longEnum) && widgetKindFor(longEnum) === WIDGET_BIGNUM)
    bad("a value too wide for the cell was still drawn big");

/* Anything a declared value can emit must exist in the face. */
for (const t of ["2:2", "54%", "1/16", "0.5"]) {
    const miss = missingGlyphs(t);
    if (miss.length) bad("the face cannot spell " + t + ", missing: " + miss.join(""));
}

if (fail) process.exit(1);
console.log("PASS: display:big is honoured, and undeclared params are unchanged");
'
```

- [ ] **Step 3: Run it and watch it fail**

```bash
chmod +x tests/host/test_big_value_declared.sh && bash tests/host/test_big_value_declared.sh
```

Expected: FAIL on `display:big did not lift the span cap`, on `bigValueText is
not a function`, and on the missing glyphs — the last of which is Task 5's
work and is expected to stay red until then.

- [ ] **Step 4: Honour the declaration (part 1)**

In `shouldDrawBigNumber`, ahead of the existing rules:

```js
export function shouldDrawBigNumber(meta) {
    if (!meta) return false;
    if (meta.kind === KIND_OPAQUE) return false;
    /*
     * A PARAM MAY SAY IT IS READ RATHER THAN AIMED.
     *
     * isCountedQuantity below already concedes this for a closed list of
     * NAMES -- a tempo is 124, not 40% of the way between 40 and 240 -- but a
     * module cannot join that list, and the rule cannot see the difference
     * between a swing percentage and a filter cutoff from the range alone.
     * A declaration can.
     *
     * It lifts two gates: the span cap, and the blanket refusal of enums
     * (a 2:4 trig condition or a 1/16 division is a value to read, and the
     * enum square`s two lines of 5x3 are not how you read it). Both stay in
     * force for everything undeclared, which is the whole fleet.
     *
     * What it does NOT lift is the fit: see fitsBigCell.
     */
    if (meta.display === "big") return true;
    if (meta.kind === KIND_ENUM) return false;
    ... /* the existing body, unchanged from here down */
}
```

- [ ] **Step 5: Draw the text the page resolved (part 2)**

Add beside `bigNumberText`:

```js
/**
 * The text a big cell draws.
 *
 * `bigNumberText` recomputes from the raw value, which is right for a counted
 * quantity and wrong for everything a declaration can now bring here: an
 * enum`s option, a host reading with a unit ("54%"), a division ("1/16").
 * Those have already been resolved once by the page -- short_options, options,
 * then the host`s formatValue -- and resolving them a second time here is how
 * the two come to disagree.
 *
 * So the resolved text wins where there is one, and the numeric path is the
 * fallback it always was.
 */
export function bigValueText(meta, raw, cellText) {
    if (cellText !== null && cellText !== undefined && cellText !== "") return String(cellText);
    return bigNumberText(meta, raw);
}
```

and in `drawKnobWidget`'s `WIDGET_BIGNUM` branch:

```js
    if (widget === WIDGET_BIGNUM) {
        drawBigNumber(ctx, cellLeft(g, col) + Math.floor(g.cellW / 2), ky,
                      bigValueText(meta, raw, cellText));
        return;
    }
```

- [ ] **Step 6: Replace the digit count with a measured width (part 4)**

Add beside `BIG_NUM_MAX_DIGITS`:

```js
/*
 * DOES IT FIT, asked directly.
 *
 * BIG_NUM_MAX_DIGITS was a proxy for this question and a good one while every
 * big value was an integer: three digits is 27px in a 32px cell, four is 37,
 * and an overflow does not clip -- the digits run over the cell next door and
 * clipped() reports nothing, so the page looks fine to every automated check
 * while two labels sit under one smear.
 *
 * Once a declaration can bring arbitrary text here the proxy stops working in
 * both directions ("1/16" is four characters and narrow; "Mixolydian" is ten
 * and hopeless), so the width is measured instead. Undeclared params reach
 * this with the same integer texts they always did and land the same way.
 */
function fitsBigCell(meta, text) {
    return fontWidth(String(text)) <= CELL_W - 2;
}
```

and consult it in `widgetKindFor`, which is the one place that decides:

```js
export function widgetKindFor(meta, cellText) {
    if (!meta) return WIDGET_KNOB;
    if (meta.kind === KIND_OPAQUE) return WIDGET_OPAQUE;
    if (meta.writeOnly) return WIDGET_BUTTON;
    if (shouldDrawBigNumber(meta)) {
        /* A declared value that cannot fit falls back to the widget it would
         * otherwise have had, rather than smearing across its neighbour. */
        const text = bigValueText(meta, null, cellText ?? widestOptionOf(meta));
        if (fitsBigCell(meta, text)) return WIDGET_BIGNUM;
    }
    if (meta.kind === KIND_ENUM) return WIDGET_ENUM;
    return WIDGET_KNOB;
}
```

Add `widestOptionOf(meta)` next to it — the longest of `short_options` /
`options` by `fontWidth`, or `String(meta.max)` for a number — so the decision
is stable across values and a cell cannot change widget as it is turned:

```js
/* THE DECISION MUST NOT DEPEND ON THE CURRENT VALUE. A cell that draws big at
 * "1:1" and small at "Mixolydian" changes shape as you turn it, which is worse
 * than either choice made consistently. So the fit is asked of the WIDEST
 * thing this cell can ever show. */
function widestOptionOf(meta) {
    const opts = Array.isArray(meta.short_options) ? meta.short_options
               : (Array.isArray(meta.options) ? meta.options : null);
    if (opts && opts.length) {
        return opts.reduce((a, b) => (fontWidth(String(b)) > fontWidth(String(a)) ? b : a));
    }
    return String(typeof meta.max === "number" ? meta.max : "");
}
```

- [ ] **Step 7: Run the test — expect only the glyph assertions red**

```bash
bash tests/host/test_big_value_declared.sh
```

Expected: every assertion passes except `the face cannot spell 2:2` and its
siblings, which Task 5 fixes. Note which characters it names — that is the
exact list Task 5 adds.

- [ ] **Step 8: Prove the fleet did not move**

```bash
bash tests/host/test_fleet_render_baseline.sh
bash tests/host/test_big_number_font.sh
bash tests/host/test_big_number.sh
```

Expected: all PASS. `widgetKindFor` gained a parameter — if the baseline moved,
a caller is passing something in the new second position; find it before
regenerating anything.

- [ ] **Step 9: Commit**

```bash
git add src/shared/param_pages/render_page_movy.mjs tests/host/test_big_value_declared.sh
git commit -m "page: a param may declare display: big

isCountedQuantity already concedes that some values are read rather than
aimed, but the only way in is a name this file recognises — so a swing
percentage, a clip length and a 2:4 trig condition, which are the same shape,
cannot ask. The declaration lifts the span cap and the blanket enum refusal,
for declaring params only.

Two consequences, both necessary. The cell draws the text the page already
resolved (short_options, options, then the host's formatValue) instead of
recomputing it from the raw number — resolving it twice is how the label and
the widget come to disagree. And the three-digit guard becomes a measured
width, asked of the WIDEST thing the cell can ever show, so a declaration
cannot smear into its neighbour and a cell cannot change shape as it is turned.

The fleet baseline is unchanged: nothing declares it."
```

---

### Task 5: U3's atlas — the glyphs a non-numeric big value needs

`font_big_num.mjs` carries `0123456789+-` and refuses the rest, "matching what
`bigNumberText` can emit". Now that a declaration can bring `2:4` and `50%`,
the face has to spell them. Its own header records where it came from:
transcribed from movy's `src/font/glyphs-big.ts`, MIT, © megadake — and movy's
copy is a full ASCII atlas. This is completing a vendoring, not drawing new
letterforms.

**Files:**
- Modify: `src/shared/param_pages/font_big_num.mjs`

**Interfaces:**
- Consumes: the glyph list Task 4's Step 7 printed.
- Produces: nothing new — `fontWidth`, `fontPrint` and `missingGlyphs` are
  unchanged in shape.

- [ ] **Step 1: Take the glyphs from movy's atlas**

Read `movy/src/font/glyphs-big.ts`. Its `G` array is indexed from `' '` (0x20)
in ASCII order; the format is identical (`[advance, yOff, w, h, ...rowBits]`,
bit0 leftmost). Extract the rows for `%`, `:`, `/` and `.` — and any further
character Task 4's test named.

**The advance differs by one and that is load-bearing.** This file's header
says so: movy's blitter adds a 1px inter-glyph gap separately and this one does
not, so every advance here is movy's plus one. Add one to each advance as you
transcribe, and the existing twelve are the reference — check a digit against
movy's to confirm the convention still holds before trusting it for four new
glyphs.

- [ ] **Step 2: Extend `CHARS` and `G` together**

```js
/*
 * FOURTEEN... AND THEN SOME. The face was cut for what bigNumberText could
 * emit -- digits and a sign. A param may now declare `display: "big"` and
 * bring its own reading with it (a ratio, a percentage, a division), so the
 * face carries what those spell. Same source as the original twelve: movy`s
 * src/font/glyphs-big.ts, MIT, transcribed with the same +1 advance.
 *
 * missingGlyphs is still the guard, and test_big_number_font.sh still sweeps
 * the fleet against it -- a declaration that asks for a character this face
 * does not have must fail loudly, not draw a hole.
 */
const CHARS = '0123456789+-:%/.';
```

with the four rows appended to `G` **in the same order as `CHARS`**
(`glyphFor` is an index lookup — a mismatch silently draws the wrong glyph).

- [ ] **Step 3: Run the tests**

```bash
bash tests/host/test_big_value_declared.sh
bash tests/host/test_big_number_font.sh
bash tests/host/test_fleet_render_baseline.sh
```

Expected: all PASS, including the glyph assertions that were red in Task 4.

- [ ] **Step 4: Look at the glyphs**

Render each new character and check it by eye at the cell's real size — a
transposed row byte produces a plausible-looking blob that no test catches:

```bash
node --input-type=module -e '
import { fontPrint, fontWidth, HEIGHT } from "./src/shared/param_pages/font_big_num.mjs";
for (const ch of ":%/.") {
    const rows = Array.from({ length: HEIGHT }, () => Array(fontWidth(ch) + 2).fill(" "));
    fontPrint({ fill_rect: (x, y) => { if (rows[y]) rows[y][x] = "#"; } }, 0, 0, ch, 1);
    console.log(ch + ":"); console.log(rows.map((r) => r.join("")).join("\n"));
}
'
```

Adjust the shim's `fill_rect` signature to whatever `fontPrint` actually calls
(read it — it is eight lines). The point is to see the shapes, not to automate
them.

- [ ] **Step 5: Commit**

```bash
git add src/shared/param_pages/font_big_num.mjs
git commit -m "font: the big face learns : % / .

The face was cut for what bigNumberText could emit — digits and a sign — and
missingGlyphs refuses everything else, which is right and is why this is
needed rather than optional: a param declaring display: big brings its own
reading with it, and 2:4 or 50% would have been a loud failure rather than a
drawn cell.

Same source as the original twelve, recorded in this file's own header: movy's
src/font/glyphs-big.ts, MIT, © megadake, which is a full ASCII atlas this
project vendored a subset of. Transcribed with the same +1 advance, since our
blitter folds the inter-glyph gap into the advance and movy's does not."
```

---

### Task 6: The carried asks — SU-8, SU-11, SU-13

Three items already written up in movy's ledger and never filed. All additive;
none changes a default. They ride this branch because a second PR into the same
two files, a week apart, is the sequencing risk the ledger warns about.

**Files:**
- Modify: `src/shared/param_pages/page_controller.mjs` (SU-8, SU-13)
- Modify: `src/shared/param_pages/anim_state.mjs` (SU-11)
- Modify: `src/shared/knob_engine.mjs` (SU-13)

- [ ] **Step 1: Read the three write-ups before writing any code**

In `movy/docs/schwung-page-migration.md`, the Upstream table's SU-8, SU-11 and
SU-13 rows, plus SP-48's section (which contains SU-11's PR-ready text). They
carry the rationale and, for SU-11, the wording. Do not re-derive them.

- [ ] **Step 2: Write the default assertion each of the three has to pass**

One test, three cases, written before any of them is implemented. This is the
only part of Task 6 this plan specifies in full, because it is the part ruling 3
turns on — the implementations themselves are specified by the ledger write-ups
Step 1 sent you to read, and restating them here would put a second, staler copy
in circulation.

Create `tests/host/test_carried_defaults.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

# THE THREE CARRIED ASKS, ASSERTED FROM THE OTHER SIDE.
#
# Each adds a field or a hook. What matters for this branch is what happens when
# nobody sets them, which is the case every module in the fleet is in.
#
# NO APOSTROPHES inside the node script: single-quoted bash string.

node --input-type=module -e '
import { createController } from "./src/shared/param_pages/page_controller.mjs";
import { SETPARAM_THROTTLE_MS } from "./src/shared/param_pages/page_controller.mjs";
import { animObserveLanded, animSettled } from "./src/shared/param_pages/anim_state.mjs";

let fail = 0;
const bad = (m) => { console.log("FAIL: " + m); fail++; };

const chain = [{ key: "cutoff", name: "Cutoff", type: "int", min: 0, max: 127, step: 1 }];
const io = {
    getParam: (k) => {
        if (k.endsWith("ui_hierarchy")) return JSON.stringify({ levels: { root: { knobs: ["cutoff"] } } });
        if (k.endsWith("chain_params")) return JSON.stringify(chain);
        return "64";
    },
    setParam: () => true,
};

/* SU-8: a controller nobody decorated marks nothing. */
const ctl = createController(io);
ctl.load();
const decos = ctl.state.decorations || [];
if (decos.some((d) => d && d.automated))
    bad("a cell reported automated with no host decoration");

/* SU-13: the defaults ARE the constants, not new numbers. */
const feelCtl = createController(io);
if (feelCtl.feel && feelCtl.feel.setParamThrottleMs !== SETPARAM_THROTTLE_MS)
    bad("io.feel absent changed the throttle from " + SETPARAM_THROTTLE_MS);

/* SU-11: a key with no declared duration ages exactly as it always did. */
const store = {};
animObserveLanded(store, "k", "1", 10, 0, 200);
if (animSettled(store, "k", 199)) bad("an undeclared key settled early");
if (!animSettled(store, "k", 501)) bad("an undeclared key never settled");

if (fail) process.exit(1);
console.log("PASS: the carried asks are inert until a host asks");
'
```

Adjust each probe to the real export names as you implement — `animSettled`'s
signature in particular is whatever `anim_state.mjs` already exports, and this
test must ask the real one rather than a name invented here.

- [ ] **Step 3: Implement the three, smallest first**

In this order, because each is independent and the first is the one most likely
to be taken on its own:

1. **SU-8** — `decorations[slot].automated` beside `locked`, plus the 2x2 mark
   in the corner `render_page_movy.mjs` already reserves. Nothing drawn unless
   a host sets it.
2. **SU-11** — a per-key duration in the animation store, so `settled` ages out
   a value that never rests. SP-48's section in movy's ledger carries the
   PR-ready wording; use it.
3. **SU-13** — `io.feel` overrides for `SETPARAM_THROTTLE_MS` and the knob
   constants:

```js
/*
 * Optional: a host may override the feel constants.
 *
 *   io.feel = { setParamThrottleMs, enumDeltaDiv, ... }
 *
 * They are `export const` bindings -- readable and not writable -- so a host
 * that owns its own pages (movy`s Set Params, Clip Params, the step page) has
 * no route to them at all and must either accept the library`s feel or
 * reimplement the gesture around it. Defaults are exactly today`s values, so
 * an io without this field is unchanged in every path.
 */
```

After each one, re-run `tests/host/test_carried_defaults.sh` **and** the fleet
baseline before starting the next. A carried item that moves the fleet is a
carried item that was not additive after all.

- [ ] **Step 4: Prove the teeth on the defaults**

For each of the three, make its new behaviour unconditional (drop the `if` that
gates it on the host having asked) and confirm `test_carried_defaults.sh` goes
red on that item's case. Restore. A default assertion that cannot fail is the
failure mode this whole branch is built to avoid.

- [ ] **Step 5: Gate all three**

```bash
for t in tests/host/*.sh; do bash "$t" || echo "RED: $t"; done
```

Expected: no `RED:` lines. This is what CI runs (`.github/workflows/ci.yml:50`).

- [ ] **Step 6: Commit each item separately**

Three commits, not one — a reviewer should be able to take SU-8 and leave
SU-11.

---

### Task 7: File the PR

- [ ] **Step 1: Document the declarations where authors read them**

In `docs/MODULES.md`, add `turn: "absolute"` and `display: "big"` to the
parameter-declaration reference, and `io.enumPeek` / `io.feel` to the host
integration section. A capability nobody can find is a capability nobody uses.

- [ ] **Step 2: Full host suite, from clean**

```bash
git stash list                       # expect empty: no experiment left behind
for t in tests/host/*.sh; do bash "$t" || echo "RED: $t"; done
bash tests/host/test_fleet_render_baseline.sh
```

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/param-pages-opt-in-bundle
gh pr create --title "param_pages: opt-in capabilities for host-owned pages" --body "$(cat <<'EOF'
Six capabilities a host-owned page set needs and cannot reach today. Every one
is opt-in and defaults to current behaviour: a module that declares nothing,
and an `io` that supplies nothing, draws and turns byte-identically.

That claim is measured rather than asserted — `tests/host/test_fleet_render_baseline.sh`
pins the widget kind of every cell of every planned page of every module in the
fleet fixture, plus whether each enum toggles under the knob, and every commit
here leaves it unchanged.

**Per-param declarations**
- `turn: "absolute"` — a two-option enum steps by direction instead of
  toggling. The toggle stays the default, for the reason it was added: a boxed
  two-way shows a state and not a direction, so direction-absolute has a dead
  half for anyone who cannot see which way is on. Where the pair is ordered and
  the caller knows it (a note mode, a pad layout), a continued turn walking the
  value back and forth is the bug instead.
- `display: "big"` — the value is read, not aimed, whatever it looks like.
  `isCountedQuantity` already concedes the principle for a closed list of
  names; nothing can join that list, and the face could only spell integers.
  Lifts the span cap and the enum refusal for declaring params only, draws the
  text the page already resolved rather than recomputing it, and replaces the
  three-digit guard with a measured width asked of the widest thing the cell
  can show.

**Host hooks (absent = today)**
- `io.enumPeek(key, meta)` — decline the option panel per key. The controller
  already declines on a list layout, because a row prints the option in full;
  a grid cell can be in the same position, but only the host knows how its
  cells are drawn. Can only decline, never force.
- `io.feel` — the feel constants as overridable defaults. They are `export
  const` bindings, so a host owning its own pages has no route to them at all.

**Additive fields**
- `decorations[slot].automated` — one bit beside `locked`, for the mark the
  corner is already reserved for. Nothing drawn unless a host sets it.
- a per-key duration in the animation store, so `settled` ages out a value
  that never rests.

**Font.** `font_big_num.mjs` gains `:` `%` `/` `.`, transcribed from the same
MIT source its header already names (movy's `src/font/glyphs-big.ts`, a full
ASCII atlas this project vendored twelve glyphs of). `missingGlyphs` remains
the guard, so a declaration asking for a character the face lacks still fails
loudly.

Driven by movy's page migration, where three pages are host-owned contracts
(`chain_params` written by the host, no module behind them). Each item is
independent — take them separately if that is easier to review.
EOF
)"
```

- [ ] **Step 4: Record it in movy's ledger**

Back in `movy/`, update `docs/schwung-page-migration.md`: SU-16…SU-19 gain the
PR number and state 🔨 FILED; SU-8, SU-11 and SU-13 move to filed with the same
number. Note the minimum Schwung version each movy-side consumer will need once
it releases.

---

## Notes for the executor

- **`widgetKindFor` gains an optional second parameter in Task 4.** It is
  exported and called from outside (the audit sheet, `describePage`). Trailing
  and optional, never a reorder — the same rule the file already states for
  `anim`/`nowMs`/`animKey`.
- **Task 4's test stays partly red until Task 5.** That is expected and stated
  in its step; do not "fix" it by weakening the glyph assertions.
- **If Task 6's write-ups disagree with what the code now does**, the ledger is
  older than the branch — fix the ledger in movy, and say so in the entry.
