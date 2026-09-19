# SP-35 — a held step hands the page back to movy, and the reporter wants it not to

Ledger entry: `docs/schwung-page-migration.md` (SP-35, finding #1 of the twelve).
Branch `feat/sp-35-38-gate-items`, base `0977dd3`.

## Reproduction

Under `schwunggrid=page`, hold a step to edit automation. SP-33 made the whole
page hand back to movy for the duration of the hold, so the parameters move
under the hand at the exact moment the hand is choosing which one to lock.

Measured on the SP-33 fixture (`MOCK_SYNTHS.test16`), pre-change:

```
mode=page delegated=true reason=ok track=0 ck=synth pages=2 at=0
HELD: owner.delegated=false page=false reason=step-held track=0 ck=synth
```

## The ledger's source claim — VERIFIED, and now measured

The ledger says SP-18's whole p-lock decoration pass is unreachable in
production today: `decorationsFor` returns null unless `auto.held`, `auto.held`
IS `seqState.stepAutoMode`, and the same flag makes `owner.page` null so the
delegated render never runs. It asked for this to be verified before building.

Verified by counting the calls, not by reading: wrapping `page.ctl.setDecorations`
and holding a step with a lock live gave

```
typeof setDecorations=function
HELD: setDecorations calls=0 last=null
```

i.e. the decoration pass is not merely unreachable in principle — the seam it
reaches Schwung through is called **zero times** for the whole hold. The claim
in the ledger is correct as written.

**The ledger is WRONG about one thing, and it matters for the tests.** It says
the two app-loop checks "both assert the behaviour being reversed" and names
two. There are **three**: the block's last check,
`'a held step keeps movy reading its own page'` (`p1() !== before`), asserts
that movy's own value refresh runs through the hold — which is the same
behaviour, one layer up (`app/tick.ts`: `activeModel.tick(!pageOwner.delegated)`).
Once the hold stops making the owner movy's, that check cannot hold under
`page`. Evidence: the check is a direct consequence of `live()`'s second term,
so anything that removes the term removes it. Left alone it would take the
burn-down to 4 and break the "N must not grow past 3" gate; deleting it would
lose the SP-12/SP-18 assertion. It is replaced by its opposite under `page`
("the drawn page keeps reading"), which is the same claim about the same
behaviour with the ownership moved — not a lost assertion.

A second measured fact, which decided where the tests go: on the SP-33 fixture
the two planners agree on **all eight** cells (`differing slots: 0`), so the
check `'>...so the knob targets the parameter movy drew'` is **vacuous** on it —
and its opposite would be too. The disagreement the router's comment counts
(9 cells across the mock presets) is real: `8w8`/`6w6` put `bd_tune` at knob 0
where movy's own config puts `bd_attack`, and jogging the SP-33 fixture's page
puts `p9` there where movy's bank 0 has `p1`. So the replacement check is given
**teeth** by jogging the page first: the same expression then reads "the key the
page drew" in one arm and "the key movy drew" in the other, and the pre-change
run fails it (`alabel 0 0 synth:p1` where the page drew `p9`).

## Design decision

**1. The hold leaves the gate.** `live()` in `src/app/page-owner.ts` keeps only
the term it needs: the contract has resolved. The `step-held` reason goes with
it. The step page (`stepPageAvailable() && stepPageState.selected`) is a
different thing and is untouched: it is movy's OWN page, and `schwungBodyFor`
still declines for it before it ever asks the owner.

**2. The "cannot take a lock" filter is movy's own chrome, at the gesture site.**
Ruling applied literally: no decoration is written for it. `decorations` is
`{locked, value}`; `locked` means "a lane live on this frame holds this
PARAMETER", and setting it on a cell nobody locked is the exact lie SP-16
removed. `renderer/label.ts` is not grown.

What is drawn instead: when a step is held and the param under the knob cannot
take a lock, movy **consumes the turn and toasts the refusal** (`seqToast`,
drawn by `drawJogToast` on the knobs/chain view, after the body — movy's chrome,
and it is live under `page`; the existing `'pool-full toast shown immediately at
8 lanes'` app-loop check passes in the `page` arm today, which is the evidence
that movy's toast channel survives delegation). The rule lives where the rule
already lives — `handleAutomationKnob`'s `!info.automatable` branch — so there is
still exactly one statement of "this param can take a lock".

Why this and not the hint band: the harm is not only that the cell looks
lockable, it is that the turn currently **falls through to a base-value edit**
(`src/midi/router.ts`: `if (owner.page) owner.page.knobTurn(...) else
model.handleKnobDelta(...)`), so a person believing they are locking is editing
the patch. A hint band would name the refusal and still let that write happen.
The gesture-site refusal stops it and says why, which is the ledger's
"a cell that cannot be locked says so".

`info.key` is the key that is toasted, because under `page` that is the key the
person is looking at (Schwung's), which is the same rule that makes the lane
target right.

**The pool-full half needs no code.** It is already said by movy's own
`8 AUTOMATION LANES — FULL` toast, drawn from `vm.automationHeld &&
vm.automationPoolFull`, and `vm.automationHeld` is true through a delegated hold.

**3. The loss, stated.** The proactive half of movy's filter is NOT carried over:
a non-automatable cell is dimmed/hidden by movy's own body drawer
(`hiddenDuringHold`, only reachable by drawing the body) and looks like any
other cell on the delegated page until you turn it. movy's chrome can say the
refusal at the moment of the gesture and cannot say it per-cell without writing
the lie above, so it says it at the gesture. That is SU-8's territory: a
channel that means "this cell cannot be locked" belongs upstream, not in
`decorations`. Recorded in the ledger, not invented here.

## Files

| file | change |
| --- | --- |
| `src/app/page-owner.ts` | `live()` = `page.ready`; the `step-held` branch of `reason` and the header comment go with it |
| `src/app/tick.ts` | the `schwungBodyFor` comment block that argues the held step is movy's screen — rewritten to the new ruling |
| `src/seq/automation.ts` | the refusal: a held step's turn on a non-automatable param is consumed + toasted |
| `browser-test/app-loop.mjs` | the SP-33 block's two checks replaced by their opposites (plus the third, above); a new block for the decoration wiring and the lock target; the refusal check |
| `browser-test/logic/automation.mjs` | **a FOURTH site the ledger did not name**: `non-automatable not consumed` (`logic/automation.mjs:123`) asserts the behaviour being reversed. Inverted for a held step, kept as-is with no step held |
| `browser-test/screenshot.mjs` | comment for `page_held_unassignable` (the scene now grades Schwung's page under the hold) + its baseline |
| `docs/schwung-page-migration.md` | SP-35 → Done, plus the closed-item entry |

No change under `engine/` → `cargo test` not required.

## Tests, with their teeth

Each is written first and run RED against the unfixed tree, then green.

1. **`browser-test/app-loop.mjs` — the decoration reaches the controller.**
   Under `page`, hold a step, make a lock with the knob, mark the lane live
   (`engine.status.aauto`), and assert `ctl.setDecorations` was called with
   `[{locked: true, value: …}]` at the cell the page drew. Red = `0` calls
   (measured above). This is the failing test for the ledger's source claim.
2. **`browser-test/app-loop.mjs` — the lock lands on the parameter the page
   drew.** Jog the delegated page so the two planners disagree (`p9` vs `p1`),
   hold a step, turn knob 0, assert `alabel 0 0 synth:p9` and NOT `synth:p1`.
   Red pre-change: `alabel 0 0 synth:p1` — the lane is bound to movy's param
   while Schwung's page draws another. True in the `off` arm for the same
   reason it always was.
3. **The two replaced checks** (same commit, so the diff is a decision):
   `'a held step hands the page back to movy'` → `'a held step keeps the page
   the mode delegated'`; `'>...so the knob targets the parameter movy drew'` →
   the drawn-page comparison; and the third, `'a held step keeps movy reading
   its own page'` → `'a held step keeps the drawn page reading'`.
4. **`browser-test/app-loop.mjs` — the refusal.** A held step's turn on
   `file_param`'s non-automatable knob 0 is consumed and toasted. Red without
   the automation.ts change (`seqToastText()` is `''`).

**Do not grow the burn-down:** `SCHWUNG=../schwung node browser-test/page-mode.mjs`
must still print `3 of 3` (baseline re-measured this session at `3 of 3`).

## Baselines

`page_held_unassignable` is the only scene that asks the app for the body under
a held step (`schwungBodyFor(pageOwnerOf(model), …)` with `stepAutoMode` set), so
it is the only baseline that can change — and it must, because the whole point is
that the body under the hold is now Schwung's. The other `page_*` scenes call
`sp.render(...)` directly and grade the renderer, which is not what changed.
Enumerated and confirmed by a full `screenshot.mjs` run before regenerating;
**no blanket `--update`**.

## Closure evidence

- The three app-loop checks replaced in place, the two new blocks red→green.
- `SCHWUNG=../schwung npm test` → 0 failures.
- `SCHWUNG=../schwung node browser-test/page-mode.mjs` → `3 of 3`.
- `npm run test:device` with `prefs.flags.schwunggrid = "off"` — **NOT RUN, three
  attempts.** The box had rebooted onto a cold chain; the shim's boot instantiates
  slot 0 ONLY and the remote-UI route cannot fill an uninstantiated slot, so
  `fixture.ensure()` never establishes (`chain is [0 plaits 1 - 2 - 3 -]`, wants
  `[0 plaits 1 mrdrums 2 - 3 -]`) and no scenario ever starts — `.test-out/` has no
  artifact newer than the previous evening. Schwung's own shadow UI reports the
  mismatch 251 times. Nothing in this item touches slot or chain loading. Reported,
  not waved through; the pref was restored to `2` (`page`) afterwards.
- `MANUAL.md`/`README.md`: **not** edited — the `page` flag is not user-visible
  yet (SP-47 ships the two-value switch), so there is no user-facing change to
  document.
