# SP-44 — knob 1 changes presets with no click first

Ledger entry: `docs/schwung-page-migration.md` lines 1178-1213. SU-9 row:
line 186. Related reading: *The injection surface* §4 (lines 341-357, the
"knob feel is upstream or it does not happen" argument bounding SU-9),
`plans/sp-43-second-click-leaves-preset-page.md` §4 (the `obxd` fixture and
what SP-44 inherits from the dropped item).

## The central question: is this movy's to build

SU-9 says no host-side route exists, reasoning from `onKnobTurn(slot,
direction, ...)` alone: it takes a direction, not a magnitude, and
`list_knob.mjs`'s feel constants are unwritable `export const`s. That is true
of `onKnobTurn` — but it is not the only door in, and it is the wrong one for
this page kind anyway: `keyAt(slot)` returns null for a `PAGE_PRESET` page
(`pageHasKnobs` is false — no page keys), so `onKnobTurn` bails at the top
whether or not the door is entered. It was never going to be the route.

Reading `page_controller.mjs` from `origin/main` (fetched fresh) turned up a
second, already-exposed pair:

- `ctl.enterMenu()` — public, callable outside the click ladder (the
  controller already calls it that way itself, from `restorePage`).
- `ctl.onJog(dir, {shift})` — public, and its `PAGE_PRESET` branch (entered)
  already calls the door's own `stepPreset`: flush pending writes, write the
  list index, re-read the name, arm the contract re-read. All of it stays
  inside Schwung; movy only calls it.

Composing those two — auto-enter, then drive `onJog` — reaches the list
without restating it, its length, or its commit path, which is exactly what
SU-9 forbids restating. What onJog does NOT have is a knob's feel (it moves
exactly one entry per call, calibrated for a jog detent, not a knob's
dozens-per-flick) — so `list_knob.mjs` is imported wholesale (one more of the
ten `param_pages` modules movy already dynamically imports in
`schwung-lib.ts`) rather than re-derived. Its `listKnobStep(state, delta,
nowMs, length)` only needs `length`, the door's preset count — read through
`port.getParam(qualify(countParam))`, the SAME injected hook that already
answers every read the controller makes, not a second source.

**Verdict: (a).** A host-side route exists — not through `onKnobTurn`, which
SU-9 correctly rules out, but through `enterMenu()` + `onJog()` + the
upstream `list_knob.mjs` feel module, none of which restate the door's own
data. Precedent for this shape of composition already exists in this file:
`focusVoice()` translates a pad press into `ctl.goToPage()` + a param write,
the same "host composes exposed primitives for a new physical gesture"
pattern.

## Design

`src/renderer/schwung-page-input.ts`, `knobTurn(slot, delta)`: when `slot ===
0` and the current page is `PAGE_PRESET`, route through a new
`turnPresetDoor()` instead of the existing `onKnobTurn` loop:

1. `!ctl.menuEntered()` → `ctl.enterMenu()` (the "no click first" part).
2. Feed the raw signed `delta` (not the ±1-per-detent expansion the ordinary
   knob path does) into a per-page-name `listKnobStep` accumulator.
3. Call `ctl.onJog(dir, {shift:false})` once per computed step.

`src/renderer/schwung-lib.ts`: add `list_knob.mjs` to the required
Promise.all (pure, no imports of its own — costs nothing an otherwise-
serviceable Schwung would not already pay) and expose `listKnobInit`/
`listKnobStep`.

Scope: knob 1 (slot 0) only, per the product ask. Other knobs on a preset
door are unchanged (still silently swallowed, same as before this item).

## Test — cheapest level, teeth proven by removal

`browser-test/logic/schwung-page.mjs`, reusing SP-43's fixture
(`dumpFixture('obxd')`, a real dumped module with a `PAGE_PRESET` root):
`goToPage` the preset door, tick a few frames (so `tickPreset`'s
read-every-third-tick cycle has read the count at least once), then
`pg.knobTurn(0, 6)` and assert the door entered with no click and the preset
index moved.

Teeth: reverting `schwung-page-input.ts` alone (keeping the lib addition) and
rebuilding `dist/esm` reddens both new assertions — "expected true, got
false" and "expected a truthy value" — confirming the test exercises the
routing, not the fixture's own tick. Restoring the fix returns both to green.

## Gates

`SCHWUNG=../schwung npm test` — 0 failures. `SCHWUNG=../schwung node
browser-test/page-mode.mjs` — 3 of 3 expected failures, unchanged. No
rendering code touched, so no screenshot baseline update.
