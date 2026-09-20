# SP-53 — Set Params and Clip Params become a host-owned contract

Ledger: `docs/schwung-page-migration.md` (row + entry near "SP-53"). Reuses
SP-52's addressing machinery (`componentPort`, the fixed-carrier `pageRefOf`
pin) rather than duplicating it (briefing rule 6).

## Decision gate

Set Params and Clip Params have **no module behind them** — their `prefix`
names no chain slot, and their io answers out of `seqState`/`keyboardState`
directly. SP-52's four defects were all about which PORT and REF a real
module's page used; this item is the opposite shape: there is no port, only
movy's own state, so the seam has to be a new interface, not a routing fix.

## The seam

**`PageParamSource`** (`src/renderer/schwung-page-source.ts`) — the minimal
shape `createSchwungPage`'s pipeline actually dereferences on `port`:
`bulkReads`, `getParam`, `setParam`, plus the optional bulk/write-log members
`createPageReadCache` already treats as optional. `TrackPort` satisfies it
structurally, so every existing call (a real module's `componentPort(...)`)
is unchanged. Two more optional members ride on the same interface:

- `vizOverrides?(key)` / `formatValue?(fullKey, raw, surface)` — the two
  `createController(io)` hooks movy has never injected (*The injection
  surface* §1/§4 of the ledger). They belong to the SOURCE, not to the
  plumbing: a real port has none (today, unchanged); a virtual source can
  supply them without `schwung-page.ts` needing a fifth/sixth constructor
  argument.

`port.track.index` (used 3 places: two callback shapes in `schwung-page.ts`,
one `ctl.load({slot: ...})` in `schwung-page-contract.ts`) is the one
`TrackPort`-only field the pipeline reads. Decoupled: `createSchwungPage` and
`createPageContract` take an explicit `trackIndex: number` instead of
reading it off the port — a virtual source makes no claim about a track at
all (SP-52's `EngineRootPort` already does the weaker version of this, faking
`track: {index: 0}` "as a claim it does not make"; a source with no `track`
field at all is the cleaner end state, not a claim to walk back later).

**`createVirtualSource(componentKey, cells)`**
(`src/renderer/schwung-virtual-source.ts`) — one `PageParamSource` per
virtual component, built from a flat table of `VirtualCellSpec`s
(`key, name, type, min/max/options, get(), set(value), format?`). It
synthesises BOTH halves of the contract from the same table:

- `ui_hierarchy`: `{levels:{root:{knobs:[...cell keys]}}}`.
- `chain_params`: `{[key]: {name, type, min, max, options}}` — **config-first
  by construction**: there is no DSP behind a virtual component to cross-check
  against, so the table IS the only place a range can be declared, and a
  wrong number here is the only way this knob is ever wrong (unlike a real
  module, where config drift against the DSP clamp is the documented failure
  mode — see `project_config-range-drift-audit`). Getting this wrong looks
  exactly like that bug: an enum whose `options` array is short of the real
  choice count snaps back on the option past the end, because `commitEnum`
  clamps the index to `options.length - 1` before it ever reaches `set()`.

Both are recomputed on every ask rather than cached: a virtual page's whole
state is a handful of field reads, and Set Params' LAYOUT cell needs this —
its option list depends on the current MODE, so a live getter is what lets a
mode change reach the next re-plan (bounded by `RELOAD_POLL_TICKS`/a hold
change, same delay any other module's contract change already tolerates).

**Addressing.** `chain/config.ts` gains `CLIP_PARAMS_COMPONENT` and
`isVirtualPageComponent()`. `renderer/schwung-grid.ts`'s `schwungPageFor`
resolves the source (virtual factory vs `componentPort`) before calling
`createSchwungPage`. `app/page-owner.ts`'s `pageRefOf` pins a virtual
component to the SAME fixed carrier SP-52 introduced for master/send
(`MASTER_PAGE_TRACK`) — reused, not reinvented. A new
`pageOwnerForComponent(componentKey)` answers the ownership question for a
page with no `model` object at all (Set Params/Clip Params have no
`getKnobPage()`/`getBankCount()` to fall back to — the movy-owned fallback is
always page 0 of 1, which is what these pages have always been).

## Config-first ranges (requirement 2)

A virtual cell's `min`/`max`/`options` is not compared against anything —
there is no DSP clamp to drift from. What breaks if it is wrong is the same
failure a real module shows: `param_meta.mjs`'s `normalize()` never widens a
declared range, and `commitEnum`/`onKnobTurn` clamp to it, so a SHORT range
(e.g. `SCALE_LABELS` missing an entry) makes the knob refuse to reach a value
movy's own model can still produce, and a WRONG option order makes the wire
index land on the wrong choice silently — no crash, no log, just a knob that
picks something other than what it displays. There is exactly one writer of
the range (`clip-params-contract.ts`'s cell table) and one reader of it
(`createVirtualSource`), which is what SP-20's "one reader" rule already
established for a real module's contract.

## What SP-54 and SP-55 inherit

- **SP-54's contract has a LIFETIME** (appears on a step hold, disappears on
  release). `createVirtualSource` takes a plain `cells` array and returns a
  fresh `PageParamSource` — it holds no session state of its own, so SP-54
  can construct one when a step is grabbed and let it go when it isn't;
  `schwungGridReload()` (already generic over any cached `SchwungPage`) is
  the existing mechanism for dropping the stale page when the held step
  changes. The seam does not need a new "lifetime" concept: a virtual source
  is already as cheap to build and discard as the cells it closes over.
- **SP-55's pages have a real port and a real key already** — they are NOT
  virtual components in this seam's sense (a real `TrackPort` behind
  `portFor(track)`/`hostPort(0)` satisfies `PageParamSource` structurally,
  needing none of `createVirtualSource`). What SP-55 needs from this item is
  only `formatValue` (for the LFO target-name reading) and the
  `isMovyOwnComponent` removal — both already generalized here, not bespoke
  to Set/Clip Params.
- Both confirmed served by one seam. If either had turned out to need
  something this design does not have (a source with a lifetime OUTSIDE a
  single render, or a real port that also wants `vizOverrides`), that would
  be a wrong-seam finding; neither does.

## Write blast radius (requirement 4)

Today: `clipPageKnob(k, delta, track)` (delta-based, `midi/router.ts:558`) is
the only writer of `seqState.clipScaleIdx/lenSteps/clipTranspose/clipQuant`.
Refactored into four `applyClip*(track, absoluteValue)` functions
(`seq/clip-page.ts`) that both the existing delta path AND the virtual
source's cells call — **one writer, two callers, never both live for the
same gesture**: `midi/router.ts`'s knob-turn dispatch picks exactly one
(`owner.page.knobTurn(...)` when delegated, `clipPageKnob(...)` when not) per
turn, gated on the SAME `pageOwnerForComponent(...).page` the render path
reads, so draw and write cannot disagree about who owns the page. Touch/
release keep running either way (undo bookkeeping, `touchedKnob` tracking);
the SCALE long-enum's open/scroll/commit sub-machinery is skipped when
delegated (Schwung's own click-to-list-picker replaces it — "the editor is
the host's", SU-4) via a `delegated` flag on `clipPageTouch`/`clipPageRelease`.

## Native first (bounds the scope)

Per the ledger's own rule ("take Schwung's native drawing first and only
reach for a widget where the reading is genuinely worse"): every Clip Params
cell is declared as a plain native type (`enum` for SCALE/QUANT, `int` for
LENGTH/TRANSPOSE) — **no `vizOverrides`/custom widget this round.** LENGTH and
TRANSPOSE draw as Schwung's ordinary numeric dial rather than movy's
big-font "preset" look; SCALE and QUANT draw as Schwung's enum-square,
identical in spirit to today's movy-drawn one. TRANSPOSE's "n/a on a drum
track" is the one reading only movy can compute, so it is the seam's first
real `formatValue` caller: `getParam` still returns `'0'` (matching today's
`normalizedValue: isDrum ? 0 : ...`, so the arc rests at the same position),
and `formatValue` overrides the PRINTED text to `'n/a'`. Restyling
LENGTH/TRANSPOSE to movy's big-font look via `vizOverrides` + the widget
registry (`renderer/schwung-widgets.ts`) is a deliberate, separable follow-up
— it is a restyle, not a correctness gap, and it is untested pixel-for-pixel
territory this pass deliberately does not enter (no device this session to
verify a hand-built canvas widget looks right).

## Upstream bounds (do not reopen)

- **SU-12** — not opened. The step page's own page-in-the-set question is
  SP-54's, not this item's; Clip/Set Params fold into the SAME contract movy
  already writes (one root level), so no `buildTrailingPages` caller-supplied
  page is needed here.
- **SU-13** — not opened. No feel complaint exists yet. Recorded for when one
  arrives: Set Params' TEMPO knob, once migrated, steps by whatever
  `chain_params` declares (`step`) through Schwung's own acceleration curve
  (`SETPARAM_THROTTLE_MS`/knob-state), not movy's `countDetents` — a
  same-magnitude turn may land on a different bpm than today. Bounded, not
  fixed.
- **SU-14** — not opened; this item pays the cost named there (the
  unconditional re-plan) exactly like every other delegated page. Clip Params
  is a 4-key contract on `origin/main`'s current re-plan cost (SP-27's
  measurement floor, `plaits`-shaped: near-nothing), so this item does not
  wait on PR #519.

## Teeth

`browser-test/logic/clip-params-source.mjs` (new): builds the virtual source
directly (no device, no schwung checkout needed for the config-shape half),
asserts `ui_hierarchy`/`chain_params` JSON round-trips through
`createVirtualSource`, that TRANSPOSE's `format()` returns `'n/a'` only on a
drum track, and that each cell's `set()` reaches the SAME `seqState` field
`clipPageKnob`'s delta path does (proving the two writers are one function).
Guarded (`schwungLibAvailable()`) integration checks belong in
`browser-test/logic/schwung-page.mjs` alongside the existing SP-26/SP-39
cache/warm assertions: a Clip Params page plans under `page`, its four keys
read back through the real `param_pages` metaIndex, and a knob turn dispatched
through `owner.page.knobTurn` lands on the same `seqState` field the `off`
arm's `clipPageKnob` would have written — proven by reverting
`createVirtualSource`'s `chain_params` synthesis to an empty object and
watching the plan come back empty (no pages), then restoring it.

## Gates

`SCHWUNG=../schwung npm test` (0 failures), `SCHWUNG=../schwung node
browser-test/page-mode.mjs` (burn-down 3, must not grow). `screenshot.mjs`
review if Clip Params draws differently — expected NOT to (native dial/enum
close to today's, but not byte-identical; a new `page`-mode scene covers it
rather than the existing `off` baselines). No `engine/` change. Device tier
not run here (wave boundary).

## Scope note — UPDATED: Set Params shipped same day

Set Params landed on the same seam right after this plan's first pass closed
Clip Params (`seq/set-params-contract.ts`, `seq/main-page-apply.ts` +
`main-page-constants.ts`). It needed no new mechanism — `VirtualCellSpec`
gained one field (`options` as a function, for LAYOUT's mode-dependent list)
and one more (`shortName`, for BOTH contracts, see below) — but it did
surface two things Clip Params could not:

- **`SETPARAM_THROTTLE_MS` (SU-13) is real**, caught by `page-mode.mjs`'s own
  regression gate on the pre-existing LINK test (two rapid opposite-direction
  turns, no release between them, asserted synchronously). Not a production
  bug — the fix was making the test bracket each turn with a touch/release,
  which is what a real gesture always has anyway.
- **`short_name` matters.** The first screenshot baselines (reviewed at 8×,
  not blessed blind) showed Schwung's own label auto-abbreviator mangling
  "Play Link" into "PLLINK" and "Pad Layout" into "PLAYOU". `VirtualCellSpec`
  gained a `shortName` field, threaded into `chain_params` as `short_name`,
  populated from movy's own existing short labels
  (`main-page-vm.ts`/`clip-page-vm.ts`) rather than invented again.

See the ledger's SP-53 entry for the full writeup, the teeth, and what no
device has confirmed yet.
