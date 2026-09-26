# SP-58 — the master chain grid draws Schwung's body; one door for the knob body

Ledger: `docs/schwung-page-migration.md` (row + entry "SP-58").

## Problem

Session's master GRID (not drilled in) drew movy's `drawKnobParams` body for
SEND/MFX slots while `knobModel()` routed the knobs through Schwung's delegated
page. SP-52 excluded the grid in `moduleGridOnScreen()` on the premise that it
has no param body — `renderChainView` draws one.

## Changes

1. `app/page-poll.ts` — session mode is a grid unless a screen-owning view
   (browse, file-browse, flags, versions, cpu) is up; Clip/Set Params checked
   first, matching the ladder order in `app/tick.ts`.
2. `app/tick.ts` — grid branch passes body + `schwungChromeFor(…, false)` and
   calls `noteRendered`; `drawnPageOwner` prefers Clip/Set owners in session mode.
3. `app/param-body.ts` (new) — `paramBodyFor(owner, vm, schwungBody)`: the only
   place the body is chosen; a live `delegated` owner reaching the fallback is
   logged (`movy-body-under-page`) and counted. All six app render sites use it.
4. Probe `page` answer carries `body/trips/last/session/masterDetail/masterSlot`.

## Why not a structural rule alone

"Every render call passes a body" passes with `schwungBody === undefined`; the
defect was the predicate. The runtime question (owner live + movy body) catches
both the predicate class and a forgotten site; the grep catches a site that
bypasses `paramBodyFor` entirely.

## Teeth

- `logic/set-session.mjs`, `logic/param-body.mjs`, `app-loop.mjs` SP-58 block +
  whole-run zero-trip check. Reverting the predicate / the render call each
  reddens them (done, recorded in the ledger).
- Screenshot `page_master_chain`.
- Device `test-device/scenarios/master-chain.ts` — red with the old predicate
  deployed, green with the fix.
