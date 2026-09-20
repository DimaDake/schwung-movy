# SP-43 — the second click on an entered preset page leaves it

Ledger entry: `docs/schwung-page-migration.md` lines 986-1017. Order **12**.
Related reading done for this plan: lines 1020-1049 (SP-44, the next item on
the same gesture surface), lines 2565-2699 (SP-16, the dive/graphics
machinery — read for the dive-intent contract, not directly load-bearing
here), lines 891-947 (SP-47's release framing), lines 31-98 / 99-195 /
3262-3313 (burn-down + state + environment facts), lines 254-535 (the
injection surface and the non-track pages — read to confirm no host-side lever
exists for door click semantics).

**This plan does not touch `../schwung`.** It also, unusually, does not
propose a source change to movy either — §1 explains why, and §5 is the
implementation agent's actual work: a pinning test plus a ledger correction,
not a patch.

Two grid arms exist by role, not by literal flag value (SP-40 is renaming the
flag concurrently): **the delegated/Schwung-renderer arm** (Schwung's
`param_pages` plans and draws the page) and **the movy-renderer arm** (movy's
own page renderer, untouched by this item — the preset page under that arm is
not delegated at all and this bug cannot occur there).

---

## 1. What the second click is supposed to do, and what it does today — they are the same thing

**The intent is Schwung's, stated in its own source, and it is not "stay
inside."** `page_controller.mjs`'s `onClick`, the `PAGE_PRESET` branch
(`origin/main` lines 3911-3917; byte-identical in `v1.4.0`, the release the
device runs, at lines 3632-3638 — confirmed by diffing both blobs fetched with
`git -C ../schwung fetch --all` then `git -C ../schwung show
<rev>:src/shared/param_pages/page_controller.mjs`):

```js
if (mp && mp.kind === PAGE_PRESET) {
    if (!menuEntered()) { enterMenu(); return null; }
    s.menuEntered = null;
    const grid = firstGrid(s.pages);
    if (grid >= 0 && grid !== s.pageIndex) goToPage(grid, { remember: false });
    else announcePageChange();
    return null;
}
```

preceded by this comment, present in both revisions, verbatim:

> A preset page: the first click goes IN, the second says done.
>
> Done means the first grid page, not "nothing". You came here to choose a
> sound and the browser loads as you scroll, so by the time you click there is
> nothing left to commit — what you want next is the knobs for the preset you
> just landed on. Leaving you in the browser makes the click do nothing and
> the page feel like somewhere you are stuck, with only Back to get out and
> Back only ever going backwards.

`restorePage`'s own docblock (origin/main line 1248, unchanged reasoning)
independently states the identical rule for the general case: *"Completing the
thing you came for — loading a preset, saving one — is done, so it hands the
jog back to paging."* Two functions, two authors' comments, one rule, stated
twice.

**`firstGrid(s.pages)`** (`page_nav.mjs:165-169`) returns the index of the
first `PAGE_KNOBS` page, falling back to 0. For a module whose root level
declares both a preset browser (`list_param`+`count_param`) and its own
knobs — e.g. `sound_generator--obxd` in the fleet dump
(`docs/module-dump/modules/sound_generator--obxd.json`,
`capabilities.ui_hierarchy.levels.root`: `list_param: "preset"`,
`count_param: "preset_count"`, knobs present) — the planner
(`page_plan.mjs:836-885`) pushes the `PAGE_PRESET` page named **"Presets"**
first, then continues emitting the level's own grid pages, which for root is
named **"Main"** (`page_plan.mjs:826`, the walk-root special case). So on this
real, dumped module the page order is `[0] Presets, [1] Main, …` and the
second click on the entered "Presets" door lands on page 1, "Main" — **the
next page, i.e. "the main page to its right,"** exactly the symptom the
product paragraph describes.

**movy's footer already advertises this, word for word.**
`src/renderer/schwung-page-chrome.ts:132`:
```ts
case lib.PAGE_PRESET: return [['JOG', 'PRST'], ['CLK', 'EDIT'], ['BACK', 'OUT']];
```
`CLK EDIT` is drawn while `menuEntered()` is true (`pageFooterFor`,
`schwung-page-chrome.ts:138-149`) — i.e. exactly the frame before the second
click. "EDIT" means what the click does: it takes you to the knobs to edit
them. It is not promising an in-list action, and the render-side comment for
the same page kind (`page_controller.mjs`, `PAGE_PRESET` render branch, both
revisions) says so too: *"Same chrome as a grid page … That is the whole
point: it used to eject into the list editor, which looks nothing like this."*

**Conclusion for part 1: the intent is defined, it is Schwung's, it is
documented in three independent places in the library (the click handler, the
restore helper, the render comment), and the code does exactly what it says.
There is no daylight between "supposed to" and "does."**

---

## 2. Whose mechanism is this — neither of the ledger's two candidates

The ledger entry names two suspects. Both are refuted by the read above, and a
third, more precise answer replaces them:

- **Not "movy's ladder handed the click on" incorrectly.** `router.ts:834-838`
  delegates the click to Schwung exactly when
  `spc.ctl.pickerOpen || spc.ctl.isDoor() || spc.ctl.state.touched >= 0`.
  `isDoor()` (`page_controller.mjs:3088-3092`) asks about the **current**
  page and returns true for `PAGE_PRESET` whether or not it is entered — so
  both the first and the second click are legitimately Schwung's, and this is
  correct routing, not a leak. SP-31's fix (the knob-page pin) is unrelated:
  no knob is held on this gesture.
- **Not "Schwung took it and moved [via a preset-commit re-plan]."** There is
  no re-plan in this path at all. `spc.click()` →
  `lib.applyInput(ctl, {type:'click'}, …)` (`schwung-page-input.ts:131-132`) →
  the `"click"` case in `page_input.mjs` → `controller.isDoor()` is true →
  `controller.onClick(-1)` is called **unconditionally on every click while
  the door is current** (`page_input.mjs`, the `"click"` case, "A DOOR page
  owns the plain click" comment) → the `PAGE_PRESET` branch quoted in §1 runs
  synchronously, mutates `s.menuEntered` and `s.pageIndex` **inside that one
  call**, and returns `null`. `applyInput`'s door branch then returns
  `opened ? controller.takePending() : null` — `null`, since `onClick`
  returned `null` — so `spc.click()` also returns `null`, and `router.ts:837`'s
  `intent && intent.action === 'open'` guard is false: **movy does nothing at
  all with this click.** The state change a user sees is 100% inside the one
  synchronous `onClick(-1)` call; there is no contract re-plan, no async gap,
  and nothing for `ctl.restorePage` to restore across, because nothing asked
  the controller to plan anything new — `s.pages` is the same array before and
  after, only `s.pageIndex` moved.
- **The actual mechanism, named:** Schwung's own `onClick`, `PAGE_PRESET`
  branch, is a **designed navigation transition**, not a side effect of
  anything else — first click opens the door (`enterMenu()`), second click
  closes it and jumps to `firstGrid` on purpose. It is a single mechanism, one
  function, no double-delivery (movy calls `applyInput` exactly once per
  click, and nothing else on movy's ladder reaches this branch — `assignActive()`
  and `anyStepHeld()`, the two blocks that sit above Schwung's door in
  `router.ts`, both `return` before reaching it and neither applies to this
  gesture).

---

## 3. Is a fix host-side, upstream, or neither

**Neither, as things stand, because there is nothing to fix.** The behaviour
matches its own documentation in the library, in two independent functions,
and matches the footer word movy already draws for it. Rule 1 in this repo's
CLAUDE.md ("a change Schwung needs is an upstream PR, never a local patch")
does not even come into play, because there is no defect to route anywhere —
routing a non-defect upstream would just be asking Schwung's maintainers to
revert a decision they made and wrote a paragraph defending.

**If product still wants the second click to do something *inside* the list**
(audition several presets with click-confirm between each, the way `PAGE_ITEMS`'s
`commitItem()` lets you stay), that is a **product conversation, not a bug
report**, and any resulting change is upstream by construction:
- The four hooks movy injects (`getParam`, `setParam`, `isModulated`,
  `announce` — *The injection surface* table, ledger lines 263-273) do not
  touch click semantics at all.
- `restorePage` exists and is callable, but using it to force the page back
  into the door immediately after this click would be **dual-driving** a
  delegated component against its own documented contract (the exact failure
  mode `movy/CLAUDE.md` rule 3 names) — the click already committed ("nothing
  left to commit," per the comment), so forcing a return would not undo
  anything, it would just refight a decision Schwung's own code already made
  and argued for.
- `onClick`'s `PAGE_PRESET` branch has no parameter, flag, or injected hook
  that changes its behaviour. Changing it requires editing
  `page_controller.mjs` itself — that is `../schwung`, never patched locally.

So: **if this is escalated, it is SU-15, and it has to be framed honestly as
"please reconsider a documented design decision," with the product argument
for it stated plainly** (e.g. "auditioning several presets and confirming one
with a click, without leaving the browser, is a workflow the current design
forecloses") — not as a bug fix. It is a small ask by the same measure the
ledger already uses for `page_controller.mjs` asks (*The injection surface*
§5: 98 commits/90 days, the highest-churn file — keep it short and be ready to
lose the argument, since the file's own author has already written the
counter-case).

**Recommendation: close SP-43 without a code change.** The ledger's own
*"Closes when"* text ("clicking again stays on that page") is the part that
needs correcting, not the code — it was written before the repro, per the
entry's own "Not yet reproduced" framing, and the repro (§1-§2 above) shows the
premise was wrong.

---

## 4. What SP-44 needs from this, stated explicitly

SP-44 ("knob 1 changes presets with no click first") is a **different**
question about the **same page kind**: whether `onKnobTurn` accepts a turn on
an un-entered door, not what a click does once one is entered. Nothing in this
plan touches:
- `isDoor()`, `menuEntered()`, `enterMenu()`/`exitMenu()` — SP-44's routing
  question ("does the controller already accept a knob turn on a door page")
  is answered independently of anything here, since it is about the *turn*
  path, not the *click* path.
- `onClick`'s `PAGE_PRESET` branch, `firstGrid`, or `page_input.mjs`'s door
  gate in the `"click"` case.
- `schwung-page-chrome.ts`'s `doorVerbs`/`CLK EDIT` — SP-44 will very likely
  need to add a `KNB PRST`-shaped hint for the un-entered state, additive to
  this table, not a rewrite of it.

Because this plan makes **no source change**, there is zero risk of it
foreclosing SP-44's implementation: SP-44's implementer inherits the click
ladder byte-for-byte as it stands today. The one thing SP-44 should reuse
rather than re-derive is the fixture this plan adds (§5) — a real dumped
module with a `PAGE_PRESET` root (`obxd`), already wired through
`dumpFixture`/`schwungPageFor` — since SP-44 needs the identical door to turn
a knob on before it is entered.

---

## 5. Test with teeth — pin the current (correct) behaviour, cheapest level

**No existing coverage exercises `PAGE_PRESET`'s click ladder at all**:
`grep -rn "PAGE_PRESET" browser-test/` and `grep -rn "isDoor\|menuEntered"
browser-test/` both return nothing before this plan. The one existing
preset-adjacent test (`browser-test/app-loop.mjs`, "full-screen file browser
exits cleanly," ~line 1021) uses the `mrdrums` fixture, which declares no
`ui_hierarchy` at all — under the delegated arm its plan is Schwung's single
fallback `Main` page (the fixture limit `page-mode-expected-fail.json`
already names), so it **cannot** reach a `PAGE_PRESET` door and is not the
right fixture to extend.

Add a case to `browser-test/logic/schwung-page.mjs` (the file that already
walks a real module's pages driving `pg.click()`/`pg.goToPage()` directly on
the `SchwungPage` object — see its existing `walk()` helper, ~line 554 — same
pattern, no MIDI simulation needed) using `dumpFixture('obxd')`
(`browser-test/dump-fixture.mjs`), which is real fleet metadata, not a
synthetic hierarchy:

```js
import { dumpFixture } from '../dump-fixture.mjs';
// ...
_log('\nTest: a preset door’s second click lands on the grid, not stuck inside');
{
    env.setParams(dumpFixture('obxd'));
    schwungGridReload();
    const pg = schwungPageFor(0, 'synth');
    for (let i = 0; i < 12 * 60 && !pg.ready; i++) pg.tick();
    ok('obxd resolved', pg.ready);

    const presetIdx = pg.ctl.pages.findIndex((p) => p.kind === pg.lib.PAGE_PRESET);
    ok('the fixture has a preset door', presetIdx >= 0);
    pg.goToPage(presetIdx);
    eq('not entered yet', pg.ctl.menuEntered(), false);

    pg.click();                                   // 1st click: enter
    eq('first click enters the door', pg.ctl.menuEntered(), true);
    eq('...and stays on the preset page', pg.ctl.pages[pg.ctl.pageIndex].kind,
       pg.lib.PAGE_PRESET);

    pg.click();                                   // 2nd click: the subject
    eq('second click leaves the door', pg.ctl.menuEntered(), false);
    const grid = pg.ctl.pages.findIndex((p) => p.kind === pg.lib.PAGE_KNOBS);
    eq('...and lands on the first grid page', pg.ctl.pageIndex, grid);

    schwungGridReload();
    env.setParams(MOCK_SYNTHS.test16);
}
```

(`pg.lib` — confirm the exact accessor name on the `SchwungPage` object before
writing this; `schwung-page.ts` constructs `input`/`ctl` from a `lib` closed
over at creation, so the test may need `pg.ctl.constructor`-adjacent access or
an exported `PAGE_PRESET`/`PAGE_KNOBS` from the same `schwungLib()` import the
suite already uses elsewhere in the file — match whatever `walk()`'s own
`lib.flipsOnClick` access pattern uses, since that function already reaches
`lib` from this scope.)

**What this pins, and what "teeth" means for a working-as-designed item:**
this is not a bug fix, so there is no broken behaviour to revert and watch
fail. The teeth are a **regression guard**: temporarily comment out the
`s.menuEntered = null; goToPage(grid, …)` two lines in a **local, uncommitted**
edit of `../schwung`'s checked-out working tree (never committed, reference
repo only) and confirm the two new assertions (`'second click leaves the
door'` and `'...and lands on the first grid page'`) go red — `menuEntered()`
stays `true` and `pageIndex` is unchanged. Restore the checkout
(`git -C ../schwung checkout -- src/shared/param_pages/page_controller.mjs`)
before running anything else. This proves the test actually watches the
mechanism in §1-§2, not a mock that always agrees with itself — the same
"prove it fails" discipline the briefing asks for, aimed at the library's
code instead of movy's, since movy's code is not what changed.

Also add, in the same block, a negative check for the *other* thing a future
regression could break: that `router.ts` still delegates the second click at
all (SP-43's original suspect #1). Since `spc.click()` was called directly
above rather than through `sendMidi`, add one `sendMidi([0xB0, 3, 127])`-driven
variant (jog-click CC) earlier in the block instead of `pg.click()`, so the
router's `isDoor()`-gated delegation (`router.ts:834-838`) is actually
exercised end to end, not bypassed. Prefer this MIDI-driven form as the
primary assertion and keep the direct `pg.click()` calls only if the
MIDI-driven route cannot reach the same fixture (`schwungPageFor` in this file
already has a MIDI-free convention, so check `app-loop.mjs`'s conventions if
routing through the router matters more than the controller call itself).

---

## 6. Ordered steps for a separate implementation agent

1. **Re-fetch and re-diff before touching anything**: `git -C ../schwung fetch
   --all`, then re-read `onClick`'s `PAGE_PRESET` branch and `firstGrid` against
   whatever `origin/main` now is — line numbers in this plan will drift even if
   the logic does not (it has been stable across two authored comments and one
   released version already).
2. **Confirm the repro once, cheaply, in the existing suite** — run
   `SCHWUNG=../schwung node browser-test/logic.mjs` first, unmodified, to get a
   clean baseline count before adding anything.
3. **Add the test from §5** to `browser-test/logic/schwung-page.mjs` (currently
   well under the ~600-line browser-test ceiling; confirm before and after).
   Use `obxd` via `dumpFixture` — real fleet metadata, no synthetic hierarchy
   needed, matching the briefing's "cheapest level that reproduces it."
4. **Prove the teeth** per §5's regression-guard procedure against the
   `../schwung` **working tree only** (never committed there), confirm the two
   assertions redden, then `git -C ../schwung checkout --` to restore it before
   any further test run.
5. **No change to `src/`.** If step 2's repro disagrees with this plan's
   reading (the two new assertions fail against the *current, unmodified*
   `../schwung` checkout) — stop and re-open the investigation; do not patch
   around a surprise without re-deriving why the source read in §1-§2 was
   wrong.
6. **Ledger update** (`docs/schwung-page-migration.md`, the SP-43 entry, lines
   986-1017): replace the "Not yet reproduced" framing with the finding —
   quote the `onClick`/`PAGE_PRESET` comment and `restorePage`'s docblock,
   name `firstGrid`/`obxd` as the concrete repro, mark the two ledger
   candidates (movy's ladder, a re-plan) as **refuted**, and correct *"Closes
   when"* to describe the pinning test rather than "stays on that page" (which
   this plan shows is not the intended behaviour). Move SP-43 to Done with a
   one-line state: *"working as designed upstream — pinned by a
   `schwung-page.mjs` test, not fixed by one."* If the product still wants the
   in-list-confirm workflow after reading this, record it as **SU-15** with
   the honest framing from §3 (a request to revisit a documented decision, not
   a bug), rather than reopening SP-43.
7. **Gates**: `SCHWUNG=../schwung npm test` (0 failures — the new test is
   additive, nothing existing should move), `SCHWUNG=../schwung node
   browser-test/page-mode.mjs` (the N of M count must not move — this item adds
   coverage, it does not change any planned page shape or any renderer output).
   No `engine/` change, so no `cargo test`. No rendering change (nothing in
   `src/renderer/` or `src/` changes at all), so `screenshot.mjs` should show 0
   diffs — run it to confirm rather than assume.
8. **Device tier**: not required by this item — no MIDI routing, IPC shape, or
   display code changes; the only new coverage is a controller-level logic
   test. Runs anyway at the wave boundary per the standing rule.
9. **Commit**: `browser-test/logic/schwung-page.mjs`,
   `docs/schwung-page-migration.md` — never `git add -A`. State in the commit
   body that this closes SP-43 with **no source change**, and why (quote the
   upstream comment, per this plan's §1).
