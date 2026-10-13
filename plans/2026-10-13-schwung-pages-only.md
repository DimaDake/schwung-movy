# Schwung pages only — retire movy's own param pages

**Decided 2026-10-13 (user).** Schwung-drawn param pages shipped as the default
and have had no complaints. The `schwunggrid` switch back to movy-drawn pages is
removed, along with every code path, test arm and script that exists only to
serve it. The goal is a smaller code base and fewer tokens per session.

movy's pages are **preserved, not erased**:

- tag `movy-pages-final` (= `dde8937`) is the last commit where `schwunggrid=0`
  still draws movy's pages, so the full working code stays checkout-able;
- `docs/movy-pages-knowhow.md` records what each technique solved and where it
  lives at that tag, so it can be reused somewhere else later.

## Decisions

1. **One owner.** `pageOwnerOf` / `pageOwnerForComponent` always return the
   Schwung owner. `claimed`/`delegated` collapse into `page` (ready ⇒ non-null).
2. **Pre-ready window: draw nothing, handle nothing.** While the contract is
   still resolving, the knob rows are blank, knob turns, touches and page jogs
   are dropped, and the knob LEDs are dark. `poll()` keeps ticking. No placeholder.
3. **Dead gates go with it.** movy ships the pinned tag's JS
   (`plans/2026-10-13-pin-schwung-js.md`), so the library cannot be missing and
   the version floor cannot fail: `schwung-floor.ts`, the `.off.ts` stand-ins,
   `build/device.mjs`'s swap, the stub fallbacks and `schwungLibAvailable`
   are all removed.
4. **The model stays as data.** Values, keys, automation, drum pads, file
   targets and the config loader / `config-hierarchy` (the Schwung page's
   fourth contract rung) are all kept. Only methods whose sole caller was the
   movy owner or a movy-only branch are removed. The view model is still
   built, because it supplies the header, toasts and step-page bar; its row
   cells are no longer drawn.
5. **Load latency** — with nothing filling the wait, a slow contract shows as
   blank rows. Measure the time to ready (probe) and tighten the retry pacing
   if the measurement says so.

## Phases

1. Plan + tag (this file).
2. Runtime: flag, mode, gates, stand-ins, owner fallback, `drawKnobParams`,
   router/tick movy fallbacks (`handleKnobDelta`, `mainPageKnob`,
   `clipPageKnob`, `editStepPageKnob`, …), then the methods/modules they leave
   unreferenced.
3. Tests: drop `page-mode.mjs` + expected-fail list, mode tests,
   `setSchwungGridMode` toggles, off-arm blocks, A/B scripts, device arming;
   screenshot scenes of movy's knob body. Add: not-ready page draws empty
   rows + ignores a turn.
4. Load latency probe + pacing (measured on device).
5. Docs: know-how doc, MANUAL (Settings row), CLAUDE.md, migration doc,
   pin plan follow-ups, CHANGELOG, memories.

## Gate

Local suite + vdev tier. Device tier as well: it covers the boot path without
the floor and stand-ins, and the latency measurement needs the device anyway.
