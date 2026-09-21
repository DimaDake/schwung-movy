# SP-55 — MIX, the track LFO page and the master LFO page

Ledger: `docs/schwung-page-migration.md` (SP-55 row + entry, ~line 2215).
Consumes SP-53's seam (`PageParamSource`/`createVirtualSource`,
`src/renderer/schwung-virtual-source.ts`) — no new mechanism added to it.

## The carried claim was wrong — verified before writing code

SP-53 said: *"SP-55: real ports already satisfy `PageParamSource`; only
`formatValue` + `isMovyOwnComponent` removal are new."* Checked against the
actual engine boundary and it does not hold for either page, for two
different reasons:

- **MIX has no per-field engine key at all.** `mix-io.ts`'s own header says
  it: the engine parses `gain,pan,muted,send1..sendN` as ONE composite
  param (`ch<N>:mix`; confirmed in `engine/crates/movy-dsp/src/lib.rs` —
  `rest == "mix"` is caught before it ever reaches the chain instance). A
  bare `componentPort` cannot answer `mix:gain` — nothing anywhere parses
  that key — so this page needs a translating source exactly like a
  virtual component does, just backed by a real read-modify-write instead
  of `seqState`.
- **The LFO's cells ARE individually real params** (`lfo1:rate_hz`,
  `lfo2:target`, ... — confirmed forwarded straight to the schwung chain
  host's own `plugin_api_v2` instance, not intercepted by movy's Rust
  engine). But Schwung's contract wants ONE flat per-component namespace,
  and the model shows TWO banks (LFO 1/LFO 2) of the SAME 8 knob
  positions — a bare port has no way to turn `lfo:rate` into `lfo1:rate_hz`
  vs `lfo2:rate_hz`, and no `ui_hierarchy`/`chain_params` to serve either
  (no module.json — nothing is loaded in this slot).

So both pages need a source; neither is "just a `componentPort`". What
*was* right in the carried note: neither needs `seqState`, and neither is a
virtual component in `isVirtualPageComponent`'s sense (they keep their real
port underneath, and their `PageRef`/`pageRefOf` addressing is unchanged —
track-scoped for MIX and the track LFO, `MASTER_PAGE_TRACK`-pinned for the
master LFO via the EXISTING `isMasterComponent` check).

## Design

**`isMovyOwnComponent` is repurposed, not removed** (`chain/config.ts`): it
used to gate a refusal in `app/page-owner.ts` (deleted); now
`renderer/schwung-grid.ts`'s `schwungPageFor` asks it, alongside
`isVirtualPageComponent`, to decide whether a translating source is needed
before falling through to a bare `componentPort`. New: `isLfoComponent`
(the `endsWith('lfo')` half, needed by a second caller below).

**`src/chain/own-component-source.ts`** — the routing table `schwungPageFor`
calls: `mix` → `mixSchwungSource(track)`; either LFO key →
`lfoSchwungSource(scope)`, `scope` chosen exactly like `lfo/model.ts`
already does (`masterScope()` for `master_fx:lfo`, `trackScope(track)`
otherwise).

**`src/mixer/mix-schwung-cells.ts`** — 5 cells (`gain`,`pan`,`send1..3`; the
2 blank knob positions `mix-cells.ts` draws are not reproduced — a
cosmetic, contiguous-layout difference, not a correctness gap). Every cell
is `type: 'float', 0..1` — the control's POSITION, the SAME units
`mix-io.ts`'s `LANE_RANGE` already uses for automation — so `get()` is
`fieldFrac`, `set()` is `fieldFromFrac` into `applyMixFieldAbs`
(`mix-apply.ts`, new), and `format()` prints the field's own unit
(dB/pan/dB) via `formatDb`/`formatPan`/`formatSend`.

`applyMixFieldAbs` is the delegated path's write, `mix-model.ts`'s `edit()`
is the delta path's — both call the SAME `writeMix` (already the one
low-level writer) but are NOT unified into one function: `edit()` re-uses
its own cached `MixVals` across a whole non-linear dB-ladder turn, and
folding the delegated path's fresh `readMix` into it would add an IPC
round trip per detent to `off` for no behavioural gain. Undo is still one
group either way: both open on the SAME key (`mixGestureKey`, moved into
`mix-io.ts` so there is one spelling of it), and `mix-model.ts`'s
`handleKnobRelease` — called generically on release regardless of
delegation (`midi/router.ts`'s `owedModel?.handleKnobRelease(d1)`) — closes
whichever path opened it.

**`src/lfo/lfo-schwung-cells.ts`** — 16 cells, two banks of 8 in the same
knob order the model uses, keys prefixed `b0_`/`b1_` so Schwung's own
8-per-page chunking lands each bank on its own page unprompted. Per field:

- `rate` is a FIXED `type: 'enum'` whose `options()` resolves live off the
  bank's `sync` flag — the 27 `LFO_DIVISIONS` when synced, or a new
  41-label Hz ladder (`RATE_HZ_MIN * RATE_HZ_FACTOR^i`, i=0..40 — the SAME
  ladder `lfo/model.ts`'s unsynced `stepDiscrete` already steps on) when
  not. This is what avoids needing `VirtualCellSpec.type` to become a
  function: RATE's fundamental shape depends on another cell's live value,
  and a fixed enum whose *options* are swapped is the existing
  dynamic-options precedent (Set Params' LAYOUT), not a new capability.
- `target` is a plain `type: 'enum'` whose options are
  `buildTargetOptions(scope, bank).map(o => o.label)` — Schwung's own
  click-to-list-picker replaces movy's overlay, same posture as Clip
  Params' SCALE (SU-4, "the editor is the host's"). **Deliberately not
  `formatValue`**, despite the ledger entry suggesting it: an enum whose
  option labels are already the resolved "Comp:Param" text needs no
  separate formatting hook, and staying consistent with LAYOUT's
  dynamic-options shape is the more native-first choice.
- `retrigger` is a DEAD cell (fixed `'0'`, `set()` a no-op) on the master
  scope (`!scope.hasRetrigger`) rather than an omitted one — both banks
  stay 8 keys so the flat 16-key list keeps chunking into two ALIGNED
  pages; omitting it on master only would misalign bank 1 by one key.
- Every other field (`sync`, `mode`/polarity, `shape`, `phase`, `depth`)
  reads/writes the real key directly through `writeLfoParam`/
  `scope.port.getParam`, which already opens its own undo gesture
  (`writeLfoParam`'s own `beginGesture`) — closed by the SAME
  `TOUCH_RELEASE` idle-timeout fallback the `off`-mode path already relies
  on (checked: `lfo/model.ts`'s `handleKnobRelease` calls no `endEdit` at
  all today), so nothing new is needed for undo grouping here either.

**Not automatable** (`renderer/schwung-page-render.ts`'s `knobParamInfo`):
an LFO cell is a real ranged param, so Schwung's own generic rule would
call it automatable — the movy model never has
(`lfo/inert.ts`). `chain_params` carries no field schwung's own
`param_meta.mjs` reads as an override (checked — there is none), so the
fix is local: `automatable` is forced false when `isLfoComponent
(componentKey)`, matching `isMovyOwnComponent`'s own test. MIX needed no
equivalent fix — its fields ARE automatable under `off` too
(`mix-model.ts`'s own note, "AFTER the spread"), and `applyLaneMapping`
already special-cases `MIX_TARGET` regardless of who built the
`KnobParamInfo`, so a delegated MIX automation write reaches the engine's
`mixlane` command exactly like an `off`-mode one does — verified by
reading `seq/lane-mapping.ts`, not device.

## Read-cost note (recorded, not solved this pass)

`createVirtualSource` is `bulkReads: false` by design — a virtual cell is
normally a free field access, and every existing consumer (Clip/Set/Step
Params) is exactly that. MIX and LFO are not: each `get()`/`set()` is a
real port call. MIX costs one (`readMix`, one composite key) — no worse
than a real module's own per-key cost. An LFO cell costs one real
`getParam` per field, so a full rotation over one bank can cost up to 8
round trips where a real module's contract (helped by `schwung-page-
cache.ts`'s `bulkReads`-aware batching, SP-26) costs closer to 1. Not fixed
here: building a `bulkReads: true` + `getMany` variant of this source is a
reasonable follow-up, and this pass instead scoped the LFO's `TARGET` cell
(the only one with a materially larger read — `buildTargetOptions` walks
every loaded component's own `chain_params`) to pay that cost only on
Schwung's own reload/rotation cadence, not every tick, matching the
existing dynamic-options precedent. No device measurement this session.

## Teeth

`browser-test/logic/own-component-source.mjs` (new): MIX's contract shape
(5 keys, no holes), a read-modify-write proof (gain set, then a send set,
then gain is read back unchanged — reddens if `applyMixFieldAbs` read
`defaultMix()` instead of `readMix(track)`), and `format()` text. LFO's
contract shape (16 keys, bank order), a real-key round-trip (`b0_depth` →
`ch0:lfo1:depth`, bank 1 untouched), the RATE ladder in both sync states,
the master retrigger dead cell, and the automation guard through a REAL
built page (`schwungPageFor`, matching SP-53/54's own "plans and settles
under page" pattern) — **proven by removing the `!isLfoComponent(...)`
clause and watching `an LFO cell is never automatable` redden**, then
restoring it (done, confirmed, restored — see commit).

`browser-test/logic/page-owner.mjs`'s existing "movy's own pages are never
claimed" test asserted the OLD refusal (`claimed: false`) — updated to
assert the new routed-and-delegated shape instead (it is now the test that
would catch a regression back to refusal).

`browser-test/app-loop.mjs`'s master-LFO block needed two small fixes,
both because a page that used to be permanently un-delegated is now a real
Schwung page with real state:

- **"detail jog scrolls to LFO 2"** checked `model.getKnobPage()` — under
  delegation the jog moves SCHWUNG's own page index and the movy model's
  bank counter is correctly inert (same as any other delegated module).
  Fixed to read through `pageOwnerOf(...).pageIndex` (`shownPage`, already
  used elsewhere in this file), which is mode-agnostic.
- **"Back returns to the master grid"** — the immediately preceding knob
  turn opens Schwung's own transient enum "peek" panel
  (`page_controller.mjs`'s `ENUM_PEEK_MS = 1500`, wall-clock), and Back's
  own ladder dismisses that FIRST (`page_input.mjs`'s `dismissPeek()`,
  ahead of `exit` — deliberate library behaviour, not a movy bug). Fixed by
  aging the mocked clock past `ENUM_PEEK_MS` before the single Back press,
  the same technique this file's own hold-knob test already uses for a
  different wall-clock gesture — a second immediate Back press was tried
  first and rejected: it left the harness in a state that broke an
  unrelated LATER test ("gate: Back still reaches its handler"), and
  chasing that further was not worth it once the clock-based fix worked
  cleanly.

## Gates

`SCHWUNG=../schwung npm test` — 0 failures. `SCHWUNG=../schwung node
browser-test/page-mode.mjs` — 3 of 3 expected failures, unchanged (ledger
up to date). `browser-test/logic/schwung-page-idle-cost.mjs` — 43 ≤ 48,
unchanged (MIX/LFO are read only while their OWN page is on screen, never
during another page's idle tick). `screenshot.mjs` — 180/0, no baseline
diffs (no new `page`-mode scene added for MIX/LFO this pass — a stated
scope cut, matching SP-53/54's own deferred-restyle precedent; the logic
suite is the teeth). No `engine/` change. Device tier not run (wave
boundary; the ledger records what no device has confirmed).

## What this does NOT cover (stated so it is not re-derived)

- No `page`-mode screenshot scene for MIX or either LFO page (visual
  review deferred, like SP-53's LENGTH/TRANSPOSE restyle).
- MIX's delegated knob feel is Schwung's own linear `min..max` stepping,
  not `off`'s non-linear dB ladder (SU-9/13 posture — an upstream ask if
  it becomes a complaint, not fixed here).
- The per-field read cost noted above is not device-measured.
- Two SP-54 carried gaps were checked against these pages specifically:
  Schwung's `ENUM_DELTA_DIV=4` vs movy's `DETENT_DIV=8` affects every enum
  cell here (RATE synced, TARGET, MODE, SHAPE) exactly as it did Clip/Set
  Params' enums — not fixed, SU-9 territory. The two-way-latch toggle gap
  affects every `type:'toggle'` cell here (SYNC, RETRIGGER) — not fixed,
  same posture.
