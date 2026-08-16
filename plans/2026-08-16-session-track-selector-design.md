# Session view as a track selector — design

Date: 2026-08-16

## Problem

With 16 tracks the step row doubles as the track selector in Session view
(`src/seq/track-select.ts`). Three things are wrong with it:

1. **The Session button LED is painted by nobody.** `paintAffordances()` in
   `src/seq/leds.ts` lights Back, the arrows, Loop, Copy, Delete, Mute, Sample,
   Capture and Undo — but never `CC_NOTE_SESSION` (50). The button reads as dead
   rather than "ready to press".

2. **Selecting a track from the step row half-switches.** `sessionStepPress()`
   calls only `selectTrack()`, which moves `appState.activeTrack` and
   `focusGroup`. The track buttons (`src/midi/router.ts`) additionally retarget
   `seqState.watchTrack`, emit `seqCmd('watch N')`, reset `barOffset`, adopt the
   new loop window, release live notes, close the global pages and restore the
   track's remembered view. None of that happens from the selector, and
   `engine.ts` parses `trk` back out of every status poll — so `watchTrack` is
   actively re-pinned to the *old* track. Screen and pads follow the new track
   while the step row and every step edit stay on the old one. Same family as
   45aa3d6, never applied to the selector.

3. **There is no way to switch tracks without leaving what you were doing.**
   Holding Session shows the clip grid; tapping a step selects a track but you
   stay on the grid, and the release reverts.

## Design

### State model

`seqState.sessionMode` currently decides two separate things: "the pads are the
clip grid" and "the step row is the track selector". Split them with one new
flag:

```
seqState.trackSelectHold   // Session button down, and a step has committed a switch
```

| state | pads / screen / knobs | step row |
|---|---|---|
| Track view | note layout | steps |
| `sessionMode` | clip grid | selector |
| `trackSelectHold` | note layout | selector |

Derived: `padsAreClipGrid = sessionMode`,
`stepRowIsSelector = sessionMode || trackSelectHold`.

### Gestures

| from | gesture | result |
|---|---|---|
| Track view | Session **down** | Session view (clip grid + selector) — unchanged |
| Session held | release, clean tap | latch Session — unchanged |
| Session held | release, >=500 ms or clip launched | revert to Track view — unchanged |
| Session held | **step N** | full switch to track N; `sessionMode=false`, `trackSelectHold=true`; the Session momentary is **cancelled** |
| `trackSelectHold` | **step M** | switch again; stays in `trackSelectHold` |
| `trackSelectHold` | Session **release** | `trackSelectHold=false`; **commits** — you stay on track N |
| Session latched | **step N down** | full switch to track N's Track view; `momentaryDown` whose restore returns to Session view + the old track |
| ^ | step N release, tap | latch — stay on track N |
| ^ | step N release, >=500 ms | revert to Session view + old track |

The last block is deliberately the track-button gesture, reusing
`momentary.ts` unchanged.

**Release consumption.** In the latched form, `sessionMode` is already false by
the time the step is released, so the release would fall through to
`handleStepButton`'s note-toggle path. `track-select.ts` remembers the step that
owns the in-flight peek (`selectPeekStep`) and consumes its release.

**Momentary cancel.** In the held form the switch must survive the Session
release, so the step press cancels the in-flight momentary outright instead of
calling `momentaryGesture()` (which would revert). `momentary.ts` gains
`momentaryCancel(button)`.

### Shared track switch

`src/track/switch.ts` (new) holds what a track switch actually is, so the track
buttons and the step selector cannot drift apart again:

- `captureTrackState()` / `restoreTrackState(s)` — the momentary restore
  closure, shared by the track buttons and the latched-Session step peek.
- `switchToTrack(track)` — close Main/Clip pages, `releaseAllLive()`,
  `selectTrack()`, `watchTrack` + `seqCmd('watch N')` + `barOffset = 0` +
  `requestLoopWindowAdopt()`, `masterDetail = false`, view from `trackView[]`,
  LED re-init.

It imports `seqState` (`seq/state.ts`), `seqCmd` (`seq/engine.ts`) and
`requestLoopWindowAdopt` (`seq/state.ts`) directly rather than `seq/router.ts`,
so nothing cycles back through `router-steps.ts`. `midi/router.ts` loses ~30
lines to it.

### LEDs

`sessionStepLed` gains a third case, ordered selected -> group -> rest:

```
step === activeTrack   -> { base: trackColor, anim: WHITE, ANIM_PULSE }
trackGroup === focus   -> { base: BLACK,      anim: trackColor, ANIM_PULSE }   // today
else                   -> solid trackColor                                     // today
```

Both cues survive, which matters because the octave buttons move `focusGroup`
without moving `activeTrack` — the selected track stays visible after the group
scrolls away from it.

Session button: `cachedSetButtonLED(CC_NOTE_SESSION, sessionMode ? WHITE_BRIGHT
: WHITE_DIM)` in `paintAffordances()`, matching the Loop button.

**Cache invalidation.** `seqLedsTick` force-invalidates when `sessionMode`
flips, because the step row has three painters over the same notes and whichever
cache is idle goes stale. The condition has to watch the SELECTOR, not
`sessionMode`: `trackSelectHold` flips the row between the same two painters
with `sessionMode` false on both sides, so no `sessionMode` edge exists to catch
it.

Verified caveat: this arm is a guard, not today's load-bearing fix.
`app/tick.ts` separately invalidates on the `sessionMode` edge that always
precedes the hold, which leaves `lastNoteLed` empty and covers the exit by
coincidence — breaking the `leds.ts` arm alone fails no test. It is kept because
relying on that coincidence is how the Loop-mode version of this bug happened.
The tests that DO have teeth here are the ones asserting the row's actual
colours (see below).

**Octave buttons** hijack to group-scroll under `sessionMode` only, not
`trackSelectHold`: during the hold you are in Track view and all 16 tracks are
directly reachable on the row, so the pad octave stays with the pads.

## Files

| file | change |
|---|---|
| `src/track/switch.ts` | **new** — capture/restore/switchToTrack |
| `src/midi/router.ts` | track buttons use the shared helpers |
| `src/seq/track-select.ts` | selected-track pulse; three gesture forms; peek release |
| `src/seq/state.ts` | `trackSelectHold` |
| `src/seq/momentary.ts` | `momentaryCancel(button)` |
| `src/seq/router-buttons.ts` | clear `trackSelectHold` on Session release |
| `src/seq/leds.ts` | split pads-vs-steps condition; Session LED; invalidate |
| `src/seq/router-steps.ts` | selector condition; peek-release routing |
| `src/app/input-reset.ts` | reset `trackSelectHold` |
| `MANUAL.md` | section 17 + the section 8 controls table |

`track-select.ts` grows 38 -> ~110 lines, inside the 200-line limit.

## Tests

- **`browser-test/logic.mjs`** — `sessionStepPress` sets `watchTrack` and emits
  `watch N` (the regression with teeth: revert the fix and it fails); the
  three-way `sessionStepLed`; the `trackSelectHold` transition table.
- **`browser-test/app-loop.mjs`** — real MIDI -> setLED: CC50 down gives the
  selector plus the clip grid on the pads; a step press flips the pads to the
  note layout while the row stays the selector, wearing all 16 track colours
  with the selected one pulsing white; CC50 up commits and leaves the row as
  steps. Asserts the CC50 dim/bright LED.

Teeth confirmed by reverting each fix in turn: dropping the `watchTrack`
retarget fails four assertions; not painting the selector during the hold fails
two; not painting CC50 fails two.
- **`browser-test/perf.mjs`** — no new per-tick cost; the selector row is
  already a per-tick paint in Session and only joins Track view while held.
- Device: `./scripts/test.sh`, `./scripts/test-seq.sh`.
