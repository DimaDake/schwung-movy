# Batch 2 — View interaction & track control

Status: design (approved, proceeding to plan)
Date: 2026-06-13
Part of: the movy sequencer LED/UX refinement epic. Batch 2 of the epic.
Prereq: Batch 1 (`feat/seq-led-affordance`) merged/branched — this builds on the
LED affordance foundation (track buttons, transport, step icons are movy-owned;
`trackButtonColor` exists with a mute-dim path stubbed for here).

## Goal

Track / Session / Loop buttons become **momentary-capable**: pressing changes
the view immediately (on button-down); a quick **tap latches** the switch; a
**hold** is a temporary peek that **returns to the prior state on release**,
with pads/knobs live in the peeked view while held. Session and loop views get
correct colors and single-press selection; view-switch announcements move to the
**header** (off the bottom bar-indicator); **mute** gains a gesture and a dimmed
track button.

## Established facts (verified in code)

- **Hold threshold:** ~300 ms = `HOLD_TICKS = 28` at movy's ~94 Hz device tick.
  (`uiTick()` in `seq/engine.ts` is the monotonic tick source.)
- **movy already does hierarchical Back** (`midi/router.ts:112`) and switches
  active track + remembered view on a track press (`router.ts:92`). Session
  (CC 50) and Loop (CC 58) are currently latching toggles.
- **Engine `mute` command exists and is tested** (`command.rs:48`,
  `mute <track> <0|1>`). Engine work here is only: add `mute=` to `status()`.
- View enum (`app/state.ts`): `VIEW_KEYS=0, VIEW_KNOBS=1, VIEW_BROWSE=2,
  VIEW_CHAIN=3, VIEW_FILE_BROWSE=4`. Session/Loop are `seqState.sessionMode` /
  `seqState.loopMode` flags, NOT view-enum values.

## Components

### 1. Momentary view-switch core — new `src/seq/momentary.ts`
Generic, one active button at a time.
- `momentaryDown(button, restore: () => void)`: records `{button, pressTick:
  uiTick(), restore}`. Caller applies the target view *before/after* calling.
- `momentaryUp(button): void`: if it matches the active button and
  `uiTick() − pressTick ≥ HOLD_TICKS`, invokes `restore()` (it was a hold);
  otherwise leaves the switch latched. Clears the active record either way.
- Pure logic, unit-tested by injecting a tick source (pass `now` into a testable
  inner fn, or expose `momentaryUpAt(button, now)`).
- Heterogeneous targets are handled by the caller's `restore` closure (it
  snapshots whatever it changed: `sessionMode`, `loopMode`, `activeSlot`,
  `currentView`, …).

### 2. Track button — `midi/router.ts`
On track-button down (CC 40–43): if Mute is held → mute gesture (component 5) and
return. Otherwise capture `restore` = current `{activeSlot, currentView,
sessionMode, loopMode}`, then apply the target: exit session/loop, set
`activeSlot = track`, set `currentView = VIEW_KEYS` (the drum/chromatic note
layout), repaint pads. Register with `momentaryDown`. On release, `momentaryUp`
decides tap-latch vs hold-return.

> "Track layout = drums or chromatic keys" → the Keys/instrument note view. The
> pads already render drums vs chromatic from the active module; the on-screen
> view becomes Keys. Easy to change to "remembered view" if desired.

### 3. Session button (CC 50) — `seq/router.ts`
On down: capture `restore` (current `sessionMode`), set `sessionMode = true`,
header-announce "Session". On up: `momentaryUp`. Clip launches work while held.
Tap latches session; hold returns to note view.

### 4. Loop button (CC 58) — `seq/router.ts` + `loop-mode.ts`
On down: capture `restore` (current `loopMode`), set `loopMode = true`,
header-announce "Loop". On up: `momentaryUp`. **Single press on a step in loop
mode selects that bar** (`barOffset = bar`) — replacing today's
single-press-double-tap-only behavior; two simultaneous presses still set the
loop window; double-tap-same-bar still makes a 1-bar loop.

### 5. Mute (CC 88) + dim — `seq/router.ts`, `seq/state.ts`, `seq/leds.ts`, engine
- `muteHeld` flag set on Mute down/up.
- Track-button press while `muteHeld` → `seqCmd('mute ' + track + ' ' +
  (muted[track] ? 0 : 1))` (toggle), header-announce, and **do not** switch
  views.
- Engine `status()` gains `mute=` — 4 chars `'0'|'1'` per track, e.g.
  `mute=0100`. UI parses into `seqState.muted: boolean[4]` (in `parseStatus`).
- `trackButtonColor(track, active)` gains the muted branch: muted →
  `TRACK_COLOR_DIM[track]` (completes the Batch 1 deferral). The track-button
  painter passes `seqState.muted[track]`.

### 6. Session-grid recolor — `seq/session.ts` `sessionPaintGrid`
- Clip with content → track color; empty slot → off (`C_BLACK`).
- Selected slot **with content** → blink white/track color.
- Selected **empty** slot → dark grey (`C_DARKGREY`).
- Playing/queued pulsing kept (queued blink, about-to-stop blink) but recolored
  to the track palette per above.

### 7. Loop-bars recolor — `seq/leds.ts` `paintLoopBars`
- Bars with content **blink**; selected bar → white/off; other (unselected)
  bars → track color/off; playhead bar stays green while playing.

### 8. Header announcements — `seq/render.ts` + `app/tick.ts`
- View-switch messages (Note / Session / Loop) render as a short string in the
  **header row** (top of the 128×64 display), auto-expiring like the toast, so
  they never cover the bottom loop/bar strip.
- **Remove the "Bar N" toasts** (`navigateBar` in `seq/router.ts`,
  `setLoopBars`'s "Loop N" stays as header-style or is dropped — bar changes are
  visible on the strip).
- Keep the existing center/bottom toast for non-navigation confirmations only.

## Engine change
`status()` += `mute=` (4 chars). Add a `cargo test` asserting the field reflects
`tracks[t].muted`. Bump `ENGINE_VERSION` 0.10.0 → 0.11.0 (UI + Rust) since the
status format changed.

## Performance
- All new LED painting stays on the cached helpers (`cachedSetLED` /
  `cachedSetButtonLED`) — zero steady-state IPC.
- Momentary state machine does **no per-tick allocation**; the tap/hold check is
  a single subtraction read on release.
- `perf.mjs` must still show ~0 idle LED sends; header-announcement draws only
  while active (a few ticks), like the existing toast.

## Testing
- `logic.mjs`: momentary tap (latch) vs hold (restore) by injecting `now`;
  mute+track emits the right `mute` cmd and does NOT switch view; muted
  `trackButtonColor` → dim; session color branches (content/empty/selected-
  content/selected-empty); loop-bar color branches; single-press-selects-bar.
- `screenshot.mjs`: header announcement rendering (update baselines for the new
  states only).
- `perf.mjs`: within budget.
- `cargo test`: `mute=` status field.
- Device: `test-seq.sh` + `test.sh` when reachable; else report DEVICE OFFLINE
  in caps.

## Deferred → Batch 2.5
Davebox exit/background parity: Back=suspend vs Shift+Back=full-exit, LED-restore
on exit, Shift+Step13 re-entry, co-run keep-mask manifest.
