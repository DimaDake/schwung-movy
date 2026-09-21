# A module loaded into an empty master FX slot shows no parameters

**Reported:** adding a module to an MFX module slot shows no parameters until
movy is restarted — the module loads and affects the sound the whole time.

**Status:** fixed on `fix/mfx-slot-params` (evaluated and re-implemented from
`fix/mfx-slot-params-stale`, commit `5236999`, which predates SP-52 by an
entire wave — its merge-base is `47aec91`, before `97d425d` "SP-52: delegate
the master chain"). That branch's own fix (a flat `NAME_POLL_TICKS`-cadence
retry in `src/model/meta-retry.ts`) is NOT what shipped here; see "What
changed from the original branch" below.

## The decisive question: does SP-52 already fix this?

No. Device-confirmed both ways:

- **`page` arm (SCHWUNG delegated) does not need a fix.** Loading 4k-eq into
  an empty master FX slot, forced to `page` via `probe.setGridMode`: the log
  shows `schwung-body not-ready track=0 ck=master_fx:fx1 pages=0` immediately
  followed (88 ms later) by `... ok ... pages=6`, and a real screenshot
  (`scripts/grab-screen.mjs`) shows the full page — `TYPE=BROWN OVRSM=2X
  BYPASS A.GAIN IN OUT`. `renderer/schwung-page-contract.ts`'s own retry
  (SP-15, `RETRY_TICKS`/`RETRY_LIMIT`) hits this identical race from the
  delegated side and already closes it, fast.
- **`off` arm (movy's own renderer) still has the bug, and it is a genuine
  race, not a permanent break.** Same module (4k-eq), same gesture, forced to
  `off`: one run in several came back `module=4k-eq cells=[]` — named,
  nothing drawn, and (pre-fix) it stays that way for the session, because
  `hierarchy.ts`'s `loadHierarchy` latches `hierarchyKey = activeModuleName`
  at its TOP, before it knows whether the read found anything. Other runs of
  the identical gesture came back fully correct — the read landed after the
  module published, not before. This is the race the original branch
  diagnosed; SP-52 never touched `hierarchy.ts` or `meta-retry.ts`, so it
  could not have fixed it, and did not.

**A separate, real bug found on the way:** `app/tick.ts`'s `seqState.
sessionMode` + `masterDetail` render branch never called `noteRendered(vm)`,
so the test probe's `page()` verb kept answering with whatever a track's
`VIEW_KNOBS` had last drawn — measured live as `module=plaits` while the
master slot held `4k-eq`. Real users were unaffected (the screen itself was
drawn correctly by `renderKnobsView`); only the automated probe was blind to
the master detail page. Fixed with one `noteRendered(vm)` call, matching the
other two render branches.

## Root cause (confirmed, movy's own render path only)

A master FX slot loads by DSP path under a **blocking** write
(`src/browser/handler.ts`, `MASTER_LOAD_TIMEOUT_MS`) sized for dlopen +
`create_instance` — "a CLAP host is the slow case" per that code's own
comment. That wait is for the MODULE to exist, not for it to have published
its `ui_hierarchy`/`chain_params` yet. `hierarchy.ts`'s B1 bail —
"genuinely nothing: no hierarchy, no config, no chain_params" — is where a
read that lands in that gap ends up, and until this fix it left
`hierarchyKey` latched at the module's name, so `syncHierarchy` never
rebuilt again. `meta-retry.ts`'s three existing predicates
(`presetPending`, `placeholderEnum`, `degenerateKeys`) all inspect params
that already exist; here there are none, so none of them caught it.

## What changed from the original branch

The original fix reused `meta-retry.ts`'s existing `NAME_POLL_TICKS` cadence
(~1 poll/second, 8 tries) — correct, but it is exactly what the user's own
report called "ugly... parameters appear with some delay": up to ~8 real
seconds. `renderer/schwung-page-contract.ts` had already solved the identical
"a read that comes back empty is not a verdict" problem for the delegated
side (SP-15) at a much faster, two-phase pace — `RETRY_TICKS=12` while
urgent, `RETRY_LIMIT=60` tries, falling back to the slow cadence only once
that window passes. That pacing is measurably safe (it is what
`browser-test/logic/schwung-page-idle-cost.mjs` already asserts an idle-cost
bound against) and it is what a user actually experiences as "the params
just appeared."

This fix restates those same numbers for movy's own model
(`HIERARCHY_RETRY_TICKS=12`, `HIERARCHY_RETRY_LIMIT=60` in
`src/model/constants.ts` — restated, not imported: `model/` must not depend
on `renderer/`, R12) and arms them at the exact point the empty read is
detected (`hierarchy.ts`'s B1 bail calls `meta-retry.ts`'s new
`armHierarchyRetry`), rather than waiting for the next `NAME_POLL_TICKS`
poll. `src/model/tick.ts` ticks the new countdown independently of
`pollCountdown`, clearing `hierarchyKey` to force a rebuild the moment it
fires. `meta-retry.ts`'s existing predicates and their slow cadence are
untouched — a background scan (osirus's ROM) that nobody is staring at does
not need the faster pace; a load a user is watching does.

Files: `src/model/constants.ts`, `src/model/state.ts`, `src/model/
hierarchy.ts`, `src/model/meta-retry.ts`, `src/model/tick.ts` (model fix);
`src/app/tick.ts` (`noteRendered` probe-gap fix, one line);
`test-device/scenarios/master-fx.ts` (`mfx-load-shows-params`, forced to the
`off` arm via `test-device/arm.ts`'s `armMovy` — `page` never needed
covering, SP-15's own tests already do).

## Verification

- **`browser-test/logic/model-hierarchy.mjs`** — "a NAMED module with
  nothing published yet gets its params (mfx-slot-params-stale)". Boots a
  model with a resolved name and empty `chain_params`/`ui_hierarchy` (the
  race, reproduced without a device — the bug is component-agnostic in
  `hierarchy.ts`, so a plain `synth` slot proves it the same as
  `master_fx:fx1` would), asserts nothing draws yet, then publishes the real
  contract (simulating the module finishing its DSP-side init) and asserts
  the params appear within `HIERARCHY_RETRY_TICKS` ticks, with no reopen.
  **Teeth:** `armHierarchyRetry` short-circuited to a no-op reddens exactly
  this check (`expected ["Bypass"], got []`) while every other logic check
  (21 others touching failure/undo/version-floor paths) stays green.
- **`test-device/scenarios/master-fx.ts`**, new check
  `mfx-load-shows-params` — the real gesture (browse into an empty master FX
  slot proven empty by C1, load the first module, drill into its detail
  page), forced to the `off` arm, polling `probe.page()` to a deadline
  covering the retry's own worst case. Passed repeatedly after the fix;
  reproduced the bare failure (`cells=[]`) against the pre-fix code on
  device, several times, before the fix landed.

## Gates

`SCHWUNG=../schwung npm test` — 0 failures. `browser-test/page-mode.mjs` — 3
of 3 expected failures, unchanged. `schwung-page-idle-cost.mjs` — 43 <= 48,
unchanged (the new retry never touches the idle path). Full device tier —
see the commit for the run's own numbers.

## What this does NOT cover

- A module whose `ui_hierarchy` genuinely never publishes (a broken or
  incompatible plugin) still costs `HIERARCHY_RETRY_LIMIT` (60) rebuilds
  before giving up — bounded, same shape as the existing `META_RETRY_LIMIT`
  give-up, just a faster cadence.
- The original branch's `master-fx.ts`/`migrate.ts` device-scenario
  extensions and its `false pass` finding about `probe.page()`'s session-mode
  blind spot were re-derived independently here (the branch predates SP-52's
  own large rewrite of `master-fx.ts`, so its diff could not be cherry-picked
  as-is) rather than ported; the substance — the `noteRendered` gap — is the
  same finding, fixed the same way.
