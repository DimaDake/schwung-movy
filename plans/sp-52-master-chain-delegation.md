# SP-52 — the master chain: MFX 1–4 and SEND 1–3 on Schwung's renderer

Ledger: `docs/schwung-page-migration.md` (row + entry near "SP-52").

## Decision gate

SP-53 builds a virtual-component seam for a page with **no module behind it**
(Set Params, Clip Params). MFX 1–4 and SEND 1–3 are the opposite case: seven
ordinary module contracts, reached through three ports movy already owns
(`hostPort(0)`, `engineRootPort()`, `portFor`). *The pages that are not a
track module's* (ledger, 2026-09-20) already concludes zero upstream PRs are
needed and these are real contracts, not virtual ones. **This item does not
consume SP-53's seam — safe to ship independently.**

## The seam where INPUT and DRAW/POLL diverge

Input already asks the delegated owner: `knobModel()` returns the master
model in session mode (`midi/router.ts:131`), the knob-CC branch resolves
`pageOwnerOf(model)` (`:577`), the jog calls
`pageOwnerOf(masterModel()).changePage` (`:980`, `:1038`, `:1054`).

Nothing draws or polls it because `moduleGridOnScreen()` has an explicit
`!seqState.sessionMode` clause (`app/page-poll.ts`) — so in session mode
`gridOnScreen` is always false, `pollDrawnPage`/`schwungBodyFor` never run,
`page.ready` never resolves, and every question falls through to movy's own
model. Inert, which is why it was never reported as a bug.

## Four defects (all movy's, no upstream ask)

1. **The port.** `schwungPageFor` builds on `portFor(trackIndex)`
   (`renderer/schwung-grid.ts`) instead of `componentPort(trackIndex,
   componentKey)` (`track/registry.ts:64`). A `master_fx:` key belongs to
   `hostPort(0)`; a `snd<n>` key belongs to `engineRootPort()` and is already
   its own namespace (`snd0:cutoff`) — reaching either through the plain
   chain port glues `ch<N>:` onto a key that already names its destination.
2. **The cache id / the ref.** `schwungPageFor`'s cache id is `trackIndex +
   ':' + componentKey`, and `pageRefOf` stamps `appState.activeTrack.index`
   onto every ref — so a master/send component gets sixteen page identities,
   one per track, and a track switch silently swaps in a different cached
   controller and read cache for the one module that is actually there. Fix
   the ref (pin master/send to a fixed carrier, 0) and the cache id is fixed
   with it — they were never two edits.
3. **The render.** The session-mode branch in `app/tick.ts` calls
   `renderKnobsView(vm, ...)` with no body and no chrome. It needs the same
   three arguments (`schwungBody`, `schwungBankFor`, `schwungChromeFor`) the
   `VIEW_KNOBS` branch passes, built from an owner over `masterModel()` — and
   `moduleGridOnScreen()`'s session clause becomes `sessionMode →
   masterDetail` (the master GRID is a chain view, not a param page; only the
   DETAIL page is one).
4. **The tilde.** `modulatedKeysOf` walks `appState.trackModels[track]`; a
   master model lives in `appState.masterFxModels`, so a master FX param
   driven by a master LFO reports unmodulated forever. Branch on
   `isMasterComponent` in that file.

## The send trap (ledger asks to pin it)

A send's component key IS its namespace (`snd0:cutoff`); `qualify` in
`schwung-page.ts` already passes a colon-bearing key through untouched, which
is correct today by luck. Pin with a unit test: a send read/write must land
verbatim, never `ch0:snd0:<key>` nor `snd0:snd0:<key>`.

## The JS-mirror hazard

Checked, not a blocker for this item: all four fixes are on the
read/ownership side (which port a page is built on, whose model it belongs
to, whether modulation is reported) — none of them adds a movy-side WRITE
path Schwung's mirror could overwrite on save. A delegated page's writes
already went through `ctl.setParam` → the same port, unchanged here.

## Teeth

Cheapest level: the port/ref/tilde defects are pure functions of state, unit
testable without a device or even a full model. The render defect
(`moduleGridOnScreen`) is a pure boolean function of `seqState`/`appState`,
also cheap. For each of the four, revert the fix, confirm the corresponding
new assertion goes red, restore, confirm green:

- `browser-test/logic/schwung-grid.mjs` — `schwungPageFor` against a master
  and a send component, capturing the underlying global to prove the key
  lands verbatim on the right channel (port).
- `browser-test/logic/tracks-refs.mjs` — `componentPort` identity + the send
  trap pinned at the key level (port, independently of schwung-grid.ts).
- `browser-test/logic/page-owner.mjs` — `pageRefOf` track-independence for
  master/send (ref/cache-id) and `modulatedKeysOf` reading `masterFxModels`
  (tilde).
- `browser-test/logic/set-session.mjs` — `moduleGridOnScreen()` under session
  mode + `masterDetail`, including a `currentView` leftover that must not
  matter (render precondition).

Device check named, not built (per instructions — the wave's device agent
runs it): a `sends` scenario that loads a module into SEND 1 under the
SCHWUNG flag, turns a knob, and asserts `sndlog`'s logged key is
`snd0:<key>`. A `page`-mode screenshot scene for an MFX/SEND page is also
named as follow-up — no existing baseline exercises session mode, so this
change moved 0 of the 177 existing scenes.

## Gates

`SCHWUNG=../schwung npm test` (0 failures), `SCHWUNG=../schwung node
browser-test/page-mode.mjs` (burn-down must not grow), `screenshot.mjs`
(review diffs — none expected, since no existing scene touches session mode).
Device tier NOT run here (wave boundary, per briefing).
