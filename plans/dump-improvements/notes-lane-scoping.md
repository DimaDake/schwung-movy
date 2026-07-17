# Notes — lane-scoping for euclidrum / eucalypso (chunk 7 stretch)

**Status: NOT config-only. Deferred — needs code changes. Written up per the
chunk-7 plan's timebox rule.**

## What these modules are

Both are **`midi_fx`** components (they load in the MIDI-FX chain slot, not the
synth slot) with per-lane parameter banks:

- **euclidrum** — 8 lanes × ~15 params (`lane<N>_enabled/pulses/rate/gate/freq/
  decay/accent/fill/drop/…`), 120 lane params, 56 hidden.
- **eucalypso** — 8 lanes × ~7 params (`lane<N>_enabled/pulses/note/octave/gate/
  drop/…`), 60 lane params, 24 hidden.

A pad-scoped "Lane" bank (press pad → focus lane N → knobs read/write
`lane<N>_*`) is the natural fit, exactly like signal/forge voices but with
`aliasPrefix: "cl_"`, `concreteKeyTemplate: "lane{pad}_{suffix}"`, `padDigits: 1`.

## Why it isn't config-only

`padScoping`'s key resolution (`model/pad-scope.ts` `concreteKey`, used by
`model/store.ts` `paramIoKey`) is already component-agnostic — it would resolve
`cl_gate` → `lane3_gate` for any componentKey. **The blocker is that the whole
pad/drum machinery is gated to the SYNTH slot (chain index 1):**

- `src/app/state.ts` `isDrumTrack(slot)` reads
  `trackModels[slot]?.[1]?.getViewModel().drumPadCount` — **hard-coded index 1**.
  A `midi_fx1` (chain index 0) drum config is never seen as a drum track.
- Pad routing / the 4×4 grid repaint in `src/app/tick.ts` and the seq router key
  off `isDrumTrack` / the synth model, so pads on a MIDI-FX-focused track go to
  the keyboard/step path, never to `updateDrumPad`.
- `drumPadOn`/`updateDrumPad` themselves are componentKey-parameterised already
  (they take `componentKey`), so only the *activation gate* is wrong.

## Code change required (scoped)

Make "is this track showing a pad grid, and which chain model owns it"
component-aware instead of assuming chain index 1:

1. `app/state.ts` — replace `isDrumTrack(slot)` with a helper that returns the
   **chain index of the currently-focused/selected chain model** whose
   `drumPadCount > 0` (the selected slot is already tracked for nav), not a
   literal `[1]`. Everything downstream should ask "the drum-owning chain model"
   rather than "the synth model".
2. `app/tick.ts` — the drum-grid paint + re-assert window must read the drum
   config/grid from that chain model, not `[1]`.
3. `seq/router.ts` (+ `keyboard`/`pads` routing) — the pad→`updateDrumPad` vs
   keyboard/step decision must use the same "drum-owning chain model" test, and
   dispatch pad focus/notes to that model's `updateDrumPad`.
4. Guard: when the drum-owning model is a `midi_fx`, live-note triggering
   (`shadow_send_midi_to_dsp`) may not apply — lane focus is UI-only selection,
   like `shiftSelectMidi`. Verify a MIDI-FX drum config wants **selection only**
   (no note-out), or route notes to the synth slot as today.

Effort: medium; touches the drum-activation gate in ~3 files + a device pass
(pads must select lanes while movy is focused on the MIDI-FX slot). Once landed,
euclidrum/eucalypso become **config-only** (drop in the two `*.json` with the
`cl_`/`lane{pad}_` padScoping shown above and register in `loader.ts`).
