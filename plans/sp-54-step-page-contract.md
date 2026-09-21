# SP-54 — the step page: a contract that exists only while a step is held

Ledger: `docs/schwung-page-migration.md` (SP-54 row + entry). Consumes SP-53's
virtual-component seam (`PageParamSource`/`createVirtualSource`) exactly as
Clip/Set Params do — no new lifetime concept (verified below).

## Verifying the inherited claim

SP-53 said: "build a fresh `createVirtualSource` per step-hold and drop it via
`schwungGridReload()` on release." Checked against the actual cache shape in
`renderer/schwung-grid.ts`:

- `createVirtualSource` is stateless (closures over live `seqState` fields), so
  a persistent singleton (like `clipParamsSource()`/`setParamsSource()`) reads
  identically to a rebuilt one — nothing to gain from literally reconstructing
  the `PageParamSource` object every hold. **Keep it a singleton.**
- What DOES need a per-hold reset is the cached `SchwungPage`/its controller
  (`ctl`), which carries UI-only ephemeral state (touch-claim timers, an open
  enum peek) that must not bleed from one physical hold into the next —
  matching the row's own title ("a contract that exists only while a step is
  held").
- `schwungGridReload(trackIndex)` is too coarse for this: it deletes every
  cache entry for that TRACK NUMBER, and the step page's fixed carrier
  (`MASTER_PAGE_TRACK`, shared with Clip Params/Set Params/MFX/SEND) or the
  watched track (shared with that track's OWN module page) both risk evicting
  a co-located page that has nothing to do with the step hold — forcing an
  unrelated re-plan (the exact minijv-sized cost the ledger worried about,
  but for the wrong reason: a real module sharing a cache bucket, not the step
  page's own size). **Extends the seam** with a surgical single-entry drop,
  `schwungGridDrop(trackIndex, componentKey)`, used instead.

## Design

- `chain/config.ts`: `STEP_PARAMS_COMPONENT`, added to `isVirtualPageComponent`.
- `seq/step-page-apply.ts`-equivalent: the five knob branches in
  `seq/step-edit.ts`'s `editStepPageKnob` are refactored into exported
  `applyStep{Velocity,LenIdx,ProbIdx,CondIdx,InvertOn}` functions taking an
  ABSOLUTE target (index or value) — the delta-based dispatch computes that
  target from `countDetents`, the virtual source's `set()` gets it straight
  from Schwung's own knob-feel math (SU-9, unchanged: same tradeoff Set
  Params' TEMPO already accepted). One writer, two callers, same as
  `applyClip*`/`applyTempoX100`.
- `seq/step-params-contract.ts` (new): the cell table. NATIVE FIRST, and
  further than SP-53 could go — LENGTH/PROBABILITY/CONDITION already have a
  fixed label array (`LENGTH_LABELS`/`PROB_LABELS`/`COND_LABELS`), so they map
  straight onto Schwung's own enum-square with no widget at all; INVERT is
  `toggle`, exactly like Set Params' LINK. Only VELOCITY loses its `vbar`
  picture, reading as a plain numeric dial (0-127) instead — a stated,
  deliberate scope cut (see "What this defers"), not an oversight: the other
  four are not a restyle-of-something-adequate the way the ledger assumed,
  they are a *correction* of that assumption (their labels were always enums).
- LEN's `format()` returns `'...'` when `seqState.holdGateMixed`, matching the
  the arc-rests/text-overridden precedent Clip Params' TRANSPOSE already set
  for "n/a on a drum track" — the position may be momentarily misleading, the
  printed text is not.
- `renderer/schwung-grid.ts`: `schwungGridDrop(trackIndex, componentKey)` —
  one `Map.delete`, exported alongside `schwungGridReload`.
- `seq/step-page.ts`: `onSessionEnd()` (happy-path release) and
  `resetStepPage()` (the lost-release recovery path called from
  `app/input-reset.ts`'s `resetHeldInput`) both call the new drop. Both are
  the ONLY two ways a step-hold session ends, so hooking both makes the
  page's lifetime non-latching **by construction** — SP-31 (controller
  latched forever) and SP-51 (overlay stranded) were bugs where the safety
  net existed on only one of these paths; here there is one drop, called from
  both.
- `app/tick.ts`: `stepParamsOwner = stepSelected ? pageOwnerForComponent(STEP_PARAMS_COMPONENT) : null`,
  folded into `drawnPageOwner`'s existing ternary ahead of Clip/Set Params.
  `schwungBodyFor` loses its `stepSelected` early-return (the generic
  `!owner.claimed`/`!owner.page` fallthrough already does the right thing once
  `drawnPageOwner` resolves the step-params owner). The VIEW_KNOBS/VIEW_CHAIN
  branches' `chrome` now derives from `drawnPageOwner` (so a delegated step
  cell's touch toast reaches the header) while `bank` keeps deriving from the
  MODULE's own `pageOwner` (so the bar still reads "step + the module's own
  bank count", per `step-page-vm.ts`'s existing comment — unaffected by which
  owner draws the body).
- `midi/router.ts`: the step-page touch and knob-turn dispatch gate on
  `stepParamsOwner().page` exactly like `clipParamsOwner()`/`mainParamsOwner()`
  — `owner.page.knobTouch/knobTurn` when delegated, the existing
  `editStepPageKnob`/`setStepTouchedKnob` calls when not.

## `hiddenDuringHold` / SP-33 / SP-35

Confirmed unaffected: `hiddenDuringHold` (`renderer/label.ts`) filters the
MODULE's own automation-lock body while a step is held but the step page is
NOT selected — a completely different render branch from the step page's five
cells, which never go through `drawKnobRow`. `buildStepPageVM` already sets
`automationHeld: false` for exactly this reason (its own comment). Nothing
here touches that path, SP-33's screen-follows-ownership rule, or SP-35's
"answer at the gesture, not a dimmed cell" rule.

## What this defers (not blocking, stated so it is not re-derived)

- **VELOCITY's `vbar` and a genuinely indeterminate-position widget for the
  mixed-length case** — `vizOverrides` + `renderer/schwung-widgets.ts`'s
  `registerWidget`, which today has zero real (non-module) callers. Building
  and visually verifying a hand-drawn canvas widget with no device in this
  session is exactly the risk SP-53 already declined to take for
  LENGTH/TRANSPOSE's restyle; same call here, recorded as a separable
  follow-up rather than shipped unverified.

## Teeth

`browser-test/logic/step-params-source.mjs` (new, mirrors
`clip-params-source.mjs`): contract shape (5 keys, short_names), one-writer
proof (`set()` and `editStepPageKnob`'s delta path land on the same
`seqState` field for LEN/PROB/COND/INVERT and the same computed delta for
VELOCITY), LEN's `'...'` on `holdGateMixed`, and the lost-release non-latching
claim itself: build the page, capture its identity, call `resetStepPage()`
(simulating the lost-release recovery path) and separately `onSessionEnd()`
(the happy path), and assert a subsequent `schwungPageFor` returns a
DIFFERENT instance after each — removing the `schwungGridDrop` call reddens
both.

## Outcome — one hazard found during implementation, not anticipated above

`param_meta.mjs`'s `learnEnumWireFormat` latches "this plugin writes option
NAMES" the first time a read's raw string happens to equal one of the enum's
own option labels. LENGTH's options include bare numerals ("1".."16" for
whole-bar counts), so wire index 3 ("1/4") read back as the string "3" —
which is ALSO option 7's label — and latched name-mode for the session: every
turn thereafter showed the wrong option (caught by the `page_stepparams`
screenshot scene showing `3` instead of `1/4`, reviewed at zoom, not blessed
blind). Fixed in the SEAM (`schwung-virtual-source.ts`'s `chainParamsJson()`
now declares `wire_format: 'index'` on every enum cell), not as a
LENGTH-specific patch — Clip/Set Params' enums never hit this (none of their
option labels are numeral-shaped) but the fix protects any future one that
would. PROB separately needed its wire index REVERSED against
`PROB_VALUES`'s internal descending order, because Schwung's turn convention
(CW always increases the wire index) is fixed and cannot be told to run
backwards per-cell. See the ledger's SP-54 entry for the full writeup.

## Gates

`SCHWUNG=../schwung npm test` (0 failures), `SCHWUNG=../schwung node
browser-test/page-mode.mjs` (burn-down 3, unaffected — the one step-hold
label there, `held-step jog switches page`, never selects the step page).
Screenshot review only if `off` visuals change (they must not — this is a
`page`-mode-only delegation). Idle-cost bound (`schwung-page-idle-cost.mjs`,
43 ≤ 48) re-checked: idle means no step held, and the step-params owner is
only ever asked for while `stepSelected`, so it adds zero idle-tick cost by
construction. No `engine/` change. Device tier not run (wave boundary, runs
once after SP-55).
