# 16-track UX polish backlog

Deferred deliberately: the 16-track work (Stages 1-2) is functionally complete
and device-verified, and the plan is to finish the audio side (Stages 3-6)
before spending time on feel. Recorded here so nothing is lost to memory.

## Resolved

- **Track selection was unreliable** (reported 2026-08-15, fixed same day).
  **Root cause: none of my four suspects.** `appState.trackModels`,
  `trackChainIndex` and `trackView` were never widened past 4 in Stage 2, so
  every track above 3 had no state at all. The track-button path does
  `appState.currentView = appState.trackView[track]`, which handed the UI
  `undefined` for any track outside the first group — nothing to render, so the
  selection looked like it had not happened. Selecting from the step row alone
  survived (it does not touch currentView), which is exactly why it was
  intermittent rather than dead.
  Fixed by sizing all three arrays from `TRACK_COUNT`; covered by
  "track state exists for every track" in `app-loop.mjs`.

## Open

- **The browser-load gesture on a movy track is verified BY HAND, not
  automatically.** Manual probe on device (2026-08-15): selecting track 5 from
  the Session step row, then jog-clicking, gives
  `browse: open t=4 synth n=39`, and a screen grab shows `T5 > PLAITS  OSC` —
  the knob page rendering a movy chain's params through `MovyChainPort`. So the
  feature works.

  What is not automated is reaching the browser from `test-chains.sh`: how many
  clicks it takes depends on which view movy is in (the chain view drills to the
  knob page first and only browses directly when the slot is empty), and the
  earlier blocks in that suite move the view around. Pressing Back to normalise
  risks opening the Leave-Movy modal. The suite reports this as a warning rather
  than a pass. A `view=` field in the status line would make it trivial.

  Original note follows.

- **The browser-load gesture on a movy track was unverified on device.**
  `browser-test/app-loop.mjs` ("the module browser loads onto a movy-hosted
  track") drives the real `openBrowser` / `loadSelectedModule` and asserts the
  write lands as `ch1:synth:module`, so the LOAD PATH is covered. What is not
  covered is the jog navigation that gets you there on hardware:
  `scripts/test-chains.sh` injects a click/turn/click sequence and no chain load
  appears, and it reports that as a warning rather than a pass.

  Not diagnosed, because movy logs nothing between the button press and the
  engine write — there is no way to tell "the gesture missed the browser" from
  "the browser refused the load". Fixing that needs either a log line when the
  browser opens, or a framebuffer grab (`scripts/grab-screen.mjs`) to see which
  view is actually on screen. The equivalent gesture on a HOST track is covered
  by `test-module-contract.sh`, so the shared navigation works; only the
  movy-track intersection is unproven.

## Also worth a look when polishing

- Group changes reset `initLedsDone`, forcing a full LED repaint. Correct, but
  it repaints all 32 pads plus the step row — check it does not cost a visible
  hitch on device.
- No on-screen indication of which group is focused. The bright quad on the step
  row is the only cue, and it is invisible when the user is looking at the
  screen rather than the panel.
