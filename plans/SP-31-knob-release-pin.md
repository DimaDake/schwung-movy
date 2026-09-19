# SP-31 — a lost knob release latches the controller, forever

BASE `d4e3ed3`. Ledger entry: `docs/schwung-page-migration.md` → `### SP-31`.
Burn-down at BASE (measured, this session): `page-mode: 3 of 3 expected failures
remain`, exit 0.

## The defect, in one line

A knob release is routed by asking who owns the page **now**. When the page
under the finger changed while it was down — a chain switch, a module swap, or
Session taking the knobs to the master bus — the release lands on a page that
never heard the press, and the press's own controller keeps the slot in
`touchOrder`. `page_controller.mjs:3632` only recomputes `touched` from
`touchOrder`, so `touched` stays ≥ 0 for the life of that controller; movy's
jog-click guard (`src/midi/router.ts:817-819`) reads `spc.ctl.state.touched >= 0`
and hands every later click to the page instead of movy. The controller has no
staleness expiry for a held knob **on purpose** (`page_controller.mjs:1352`
refuses to settle a contract under a hand; `~1499` returns early while
`touchOrder.length`), so nothing ages it out.

## The reproduction (local, no device)

`browser-test/app-loop.mjs` already documents this exact leak at `:556-559`:
*"the Session press that took the knobs to the master bus while it was down —
with that latched, the release below reaches a page that never heard the touch
and the synth page keeps the slot."* The existing block plugs it by hand
(`sendMidi([0x90, 1, 0])` before the Session release, `:561`).

Pinned form, under `MOVY_APP_LOOP_GRID=page`, on the suite's `mrdrums` fixture:

```
currentView = VIEW_KNOBS
sendMidi([0x90, 1, 127])                 // touch knob 1; the synth page hears it
sendMidi([0xB0, MoveSessionButton, 127]) // master bus takes the knobs (knobModel())
sendMidi([0x90, 1, 0])                   // release → the MASTER page, or nothing
sendMidi([0xB0, MoveSessionButton, 0])   // back to the synth page
```

After that, without the fix: `ownerFor().page.ctl.state.touched === 1` and
`touchOrder === [1]` (latched), and the next jog click on `VIEW_KNOBS` is taken
by the controller (`spc.click()`) instead of opening movy's module browser — so
`appState.currentView` stays `VIEW_KNOBS` instead of becoming `VIEW_BROWSE`.

With the fix: the release is delivered to the page that recorded the press, the
latch never forms, and the click reaches movy.

## The design taken

The entry's design, verbatim: **pin the page at press, deliver the release to
that page** — a `Map<knobIndex, page>` filled in the router's knob-touch branch
and drained on release.

- **New `src/midi/knob-page-pin.ts`** (~35 lines) — the ledger itself, the exact
  shape of `src/keyboard/held-notes.ts`: `pinPage(knob, page)`, `unpinPage(knob)`
  (remove and return), `pinnedPageFor(knob)`, `pinnedCount()`, `clearPins()`. It
  holds no MIDI globals and knows nothing about the router, so it stays under
  the 200-line src cap and keeps `router.ts` (already 1079 lines) from growing.
  *The release must come from what the press recorded, never from current
  state* — the same rule `held-notes.ts`'s header states for note-offs.
- **`src/midi/router.ts`** — the knob-touch branch (`:301-352`):
  - on the press: `pinPage(d1, owner.page)` — a `null` page (movy's own page, or
    a claimed page whose contract has not resolved) **deletes** the entry, so a
    fresh press can never inherit a stale pin;
  - at the **top of the `0x90 && d1 < 8` block**, before the Main/Clip/Flags/
    Step overrides: a release drains the pin, so a page that becomes an override
    between press and release cannot strand it either;
  - the release then skips the current owner (`if (!owed) owner.page?...`) —
    the pinned page already took it, and a second `knobTouch(k,false)` on the
    same controller would only repeat a no-op flush.
- **`src/app/input-reset.ts`** — `clearPins()` joins the other held-input
  latches. That file's header is the invariant this obeys (*"Every held-input
  latch here is armed by a press and disarmed only by the matching release"*),
  and it runs at init and where moves hands the foreground away, i.e. exactly
  where releases provably cannot come back.

**Not changed, deliberately:** the controller's touch semantics (a change
Schwung needs is an upstream PR), and `pageOwnerOf` — the pin is consulted only
at the two gesture sites that record and deliver a knob touch, so ownership
stays the one accessor's answer.

## The tests, with their teeth — MEASURED

Both are `app-loop.mjs` checks, inserted after the file-param block that
documents this leak, because the burn-down ratchets on app-loop labels and the
gesture must go through the real `onMidiMessageInternal`.

1. `the pressed page is not left holding the knob` (`page` arm only — under
   `off` there is no controller to latch). Assertion:
   `ownerFor().page.ctl.state.touched === -1`.
2. `...and the next jog click still reaches movy` (both arms). Assertion:
   `appState.currentView === VIEW_BROWSE` after the jog click.

The reproduction is: touch knob 1 on `VIEW_KNOBS`; press Session (the knobs are
the master bus now); **release the knob while Session is still down** — out of
order, the case the user does not control; toggle Session off (a full press AND
release: `CC_NOTE_SESSION` toggles on the PRESS, so the release alone only puts
the button back up — measured, and it is what made the second check toothless
until it was corrected); then jog-click with nothing held.

**Teeth, exact commands and observed text.** Removing the fix's delivery
(`owed?.knobTouch(d1, false)` in `src/midi/router.ts`, module left in place),
`SCHWUNG=../schwung npm run build:browser` then:

```
$ MOVY_APP_LOOP_GRID=page node browser-test/app-loop.mjs
  ✗ the pressed page is not left holding the knob: expected -1, got 1
  ✗ ...and the next jog click still reaches movy: expected 2, got 1
5 APP-LOOP CHECK(S) FAILED                      (3 expected + these 2)

$ SCHWUNG=../schwung node browser-test/page-mode.mjs
  ✗ REGRESSION under page — not in the expected-fail list: the pressed page is not left holding the knob
  ✗ REGRESSION under page — not in the expected-fail list: ...and the next jog click still reaches movy
page-mode: 5 of 3 expected failures remain
PAGE-MODE LEDGER OUT OF DATE (2)                exit 1
```

Restored: both green, `MOVY_APP_LOOP_GRID=page node browser-test/app-loop.mjs`
back to `3 APP-LOOP CHECK(S) FAILED` (the three expected), and
`page-mode: 3 of 3 expected failures remain` / `PAGE-MODE LEDGER UP TO DATE`,
exit 0. The `off` arm is clean in both states (`ALL APP-LOOP CHECKS PASSED`).

## The (a)/(b)/(c) ruling — settled, **(c)**, with (a) refuted by measurement

**(a) is FALSE for this pin.** The plan line `app-loop.mjs:1063` is BYTE-IDENTICAL
with the fix in place, with the fix removed, and at BASE:

```
[page-plan] mrdrums fixture ck=synth mode=page lib=true movyBanks=4 claimed=true delegated=true ctlPages=1 names=["Main"]
[page-plan] mrdrums fixture ck=synth mode=off  lib=true movyBanks=4 claimed=false delegated=false ctlPages=0 names=[]
```

The pin has no effect on the controller's planned page set, so it does not
change what the fixture reports on this tree. `shift+jog: plain jog steps one
page` — the check SP-17's record says the pin reddens — **passes at BASE, passes
with this pin, and passes with this pin removed**: it is not among the failures
in any of the three runs, and the burn-down is `3 of 3` with the pin (the same
three labels as BASE) against `5 of 3` only when the NEW checks are reddened.

**Why this pin cannot reach that check (the code-path argument).** `shownPage(m)`
is `pageOwnerOf(m).pageIndex`; the `shift+jog` block's gestures are all CCs
(`MoveMainKnob`, `MoveShift`) and its fixture is entered by `env.setParams` +
`init()` + `reload()` — **it never sends a `0x90` note below 8**, which is the
only input the pin is recorded from or drained by. `pinPage`/`unpinPage` are
called from exactly two sites (`src/midi/router.ts:279`, `:348`), `clearPins`
from one (`src/app/input-reset.ts:77`), and nothing outside
`src/midi/knob-page-pin.ts` can read the map at all (grep: `pinnedPageFor` and
`pinnedCount` have no callers — they are the module's own surface, not a seam).

**(b) is the correct description of the three survivors, and needs no fixture
change.** All three are one mechanism, and the plan line above is its proof:
`movyBanks=4` (movy's config) against `ctlPages=1 names=["Main"]` (the plan).
The `mrdrums` fixture declares no `ui_hierarchy`, so Schwung plans the single
page `Main`; a fixture with one page cannot express "the jog stepped one page",
"the browser opened over the page you were on" or "the pre-open view was
captured" — the three labels on the burn-down. The pin changes none of it.

**(c), named: SP-17's pin was NOT the design the entry describes.** The entry
records `pcount=1 ctlPages=1 names=Main` pinned against `pcount=3
names=Main>Main - 2>Effects` unpinned — a pin that changed `ctlPages` on the
`hier_params_overflow_two_levels` fixture, which plans three pages. A
knob-index-keyed map filled at the press and drained at the release **cannot**
do that: it is consulted only inside the router's `0x90 && d1 < 8` branch, and
that fixture's block sends no knob note. So the code SP-17 measured was
reachable from somewhere the entry's own description does not name — most
plausibly `pageOwnerOf` or the page-cache lookup behind it, in which case a pin
left over from an earlier block answered `pageOwnerOf(m)` with the page of the
PREVIOUS fixture: one page, named `Main`, exactly what the record shows. That is
a stale page served as the current one, not an entanglement with the fixture
limit — and it is why it was right to revert it.

**Limitation.** SP-17's code is unrecoverable (it was reverted before commit:
`git log --all -G"pinPage|heldPage|pinnedPage|touchOrder|knobPin"`, `-S "Map<number,"`
and a rev-list `git grep` across every `router.ts` revision return no such
blob), so the paragraph above is an inference from the entry's own two records
(the description of the shape, and the measurement) which cannot both describe
one piece of code. What is measured, not inferred: the plan line is unchanged by
this pin, and this pin cannot reach the check that record says it reddens.
