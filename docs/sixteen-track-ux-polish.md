# 16-track UX polish backlog

Deferred deliberately: the 16-track work (Stages 1-2) is functionally complete
and device-verified, and the plan is to finish the audio side (Stages 3-6)
before spending time on feel. Recorded here so nothing is lost to memory.

## Open

- **Track selection from the Session step row is unreliable** (reported on
  device, 2026-08-15). Pressing a step in Session view does not always select
  the track. Suspects, in the order worth checking:
  1. **The step press is being swallowed upstream.** `handleStepButton` sees the
     press only if `seqHandleMidi` routes it there; a held modifier (Copy,
     Delete, Shift, a held step) takes priority earlier in the chain and would
     make selection work only *sometimes*, which matches the symptom.
  2. **`momentaryGesture()` interaction.** Session-held + step marks the
     momentary as used. If the button is latched rather than held the call is a
     no-op, but the two paths have not been tested against each other on device.
  3. **LED vs state divergence.** Selection may be succeeding while the paint
     lags, so it *looks* like nothing happened. `appState.initLedsDone` is reset
     in `sessionStepPress`, but the clip grid repaint path is progressive and
     may need a frame or two.
  4. **Release handling.** `sessionStepPress` fires on press only; the release
     still falls through to whatever the step row does next. Worth confirming a
     release cannot re-enter note-entry handling.

  The local suites cover the happy path only (`app-loop.mjs` drives a clean
  latch → press → select). Reproducing this needs either a device gesture trace
  or an `app-loop` case with a modifier held across the press.

## Also worth a look when polishing

- Group changes reset `initLedsDone`, forcing a full LED repaint. Correct, but
  it repaints all 32 pads plus the step row — check it does not cost a visible
  hitch on device.
- No on-screen indication of which group is focused. The bright quad on the step
  row is the only cue, and it is invisible when the user is looking at the
  screen rather than the panel.
