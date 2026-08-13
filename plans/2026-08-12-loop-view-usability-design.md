# Loop view & bar indicator usability — design

**Date:** 2026-08-12
**Status:** approved, ready for implementation

## Problem

The engine plays `[loop_start_steps, loop_start_steps + length_steps)` in **absolute**
step coordinates (`engine/crates/seq-core/src/clip.rs:91`). The documented
two-bar-press gesture (`loop-mode.ts` → `loop <trk> <startStep> <lenStep>`) sets
`loop_start_steps > 0`. The UI, however, reads `lenSteps` as if the loop always
began at bar 0. Every view that touches bars is therefore wrong whenever the loop
does not start at bar 1.

Probed with `loopStart=32, lenSteps=32, barOffset=2` (loop = bars 3–4, viewing bar 3):

| # | Site | Actual behaviour |
|---|------|------------------|
| 1 | `render.ts:64` `drawLoopStrip` | Solid segments drawn at bars **0 and 1**, both outside the loop. Bar 2 — selected *and* active — renders as the outside `+` marker. Bar 3 not drawn at all. |
| 2 | `render.ts:17` `playheadX` | Absolute `posTick` divided by loop length → returns **127 for the entire loop**; sweep pinned to the right edge. |
| 3 | `leds.ts:222` step row | `step >= lenSteps` blacks out steps 32–47 → **entire step row dark**, occupancy invisible, step editing blind. |
| 4 | `state.ts:176` `maxBarOffset` | Returns 2 → arrows **cannot reach bar 3**, the loop's own second bar, and can reach bars 0–1 outside it. |
| 5 | `leds.ts:52` `loopBarColor` | `inLoop` is computed, passed in the ctx, and **never read**. The loop window is invisible in Loop mode; an out-of-loop bar holding leftover notes blinks identically to an in-loop one. |
| 6 | `loop-mode.ts:77` | `DOUBLE_TAP_TICKS = 60` counts engine ticks. At the observed 63–205 Hz range the window swings **0.29 s → 0.95 s** with device load. |

Two further usability gaps, independent of the coordinate bug:

- A two-bar press sets the window but leaves `barOffset` where it was — possibly
  outside the new loop, so you edit a bar you cannot hear.
- Loop+wheel shrink can strand `barOffset` the same way.

## Decisions

Confirmed with the user during brainstorming:

1. **LED grammar** — reuse session view's pulse vocabulary (colour *and* rate).
2. **Strip span** — window-through-selected; the sweep covers the active window only.
3. **Extras included** — persistent Loop readout, viewed bar follows the loop.
4. **Extras rejected** — double-tap restoring the previous window.
5. **Playhead outranks selected** (so a playing 1-bar loop shows green, not white).

## Design

### 1. One coordinate model (`seq/state.ts`)

Make the correct computation the only reachable one:

```ts
stepInLoop(step): boolean   // loopStart <= step < loopStart + lenSteps
minBarOffset(): number      // loopStartBar()
maxBarOffset(): number      // min(loopEndBar() + 1, 15)  — one navigable bar past the loop
```

`maxBarOffset()`'s new formula is identical to the old one whenever `loopStart === 0`,
so existing tests stay green and the behaviour change is confined to mid-clip loops.
`clipBars()`'s comment about the extra navigable bar is stale (that bar comes from
`maxBarOffset`) and gets corrected.

`playheadX` gains a **required** `loopStartTick` parameter rather than an optional
one: the bug was a caller silently omitting the offset, so the signature must refuse
to compile without it.

### 2. Loop-view LEDs (`seq/leds.ts`)

`loopBarColor` returns `CellLed { base, anim, channel }`, matching
`sessionCellColor` (`session.ts:88`) so both views share one vocabulary. `hasContent`
and `blink` leave the ctx (user: no content indication), and `barHasContent()` is
deleted with them — removing **256 `occHasStep()` calls per frame**.

| Bar state | base | anim | channel |
|---|---|---|---|
| playhead (playing) | `C_GREEN` | — | `ANIM_NONE` |
| selected + active | `C_WHITE` | `trackColor` | `ANIM_PULSE_SLOW` |
| selected, inactive | `C_WHITE` | `C_DARKGREY` | `ANIM_PULSE_SLOW` |
| active | `trackColor` | `C_WHITE` | `ANIM_PULSE` |
| inactive | `C_DARKGREY` | — | `ANIM_NONE` |

> **Superseded on review (2026-08-12).** The two-colour blends muddied both hues,
> and mixed rates cannot stay synchronised — the firmware drives each rate off its
> own division, so a slow selected bar only meets its on-beat neighbours every
> other cycle. Shipped instead: every state fades **its own colour against black**
> on **one** channel, so the row breathes as a single movement.
>
> | Bar state | base | anim | channel |
> |---|---|---|---|
> | playhead (playing) | `C_BLACK` | `C_GREEN` | `ANIM_PULSE` |
> | selected (in or out of loop) | `C_BLACK` | `C_WHITE` | `ANIM_PULSE` |
> | active | `C_BLACK` | `trackColor` | `ANIM_PULSE` |
> | inactive | `C_DARKGREY` | — | `ANIM_NONE` |
>
> This also resolves the open question below in the safe direction: the lit colour
> now lives in `anim`, which the firmware honours even where it ignores `base`.
> The original pairs put white in `base` and would have pulsed black-on-black there.

Priority: playhead > selected > active > inactive, mirroring session's
`queued > playing > selected`. The active row is byte-identical to session's
playing-clip pair, so it breathes in hardware phase-lock with it.

`C_DARKGREY` (124) is `#1A1A1A` in the hardware table — already the darkest
non-black, i.e. exactly the requested "very dark grey". No new constant.

**Cache hazard.** Notes 16–31 must not be painted through both `cachedSetLED`
(`lastNoteLed`) and `cachedSetAnimLED` (`lastAnimLed`): stale entries in the idle
map would suppress needed sends on a Loop-mode toggle. `leds.ts` tracks the previous
`loopMode` and calls `seqLedsInvalidate()` on the transition. Cost is one cold
repaint, which `FRAME_BUDGET` already spreads over 2–3 ticks. Chosen over migrating
the whole step row to the anim API because it leaves the well-tested step-row path
untouched.

**Open for device verification.** The two-colour pulse pair is inferred from the
Push-2 model documented at `colors.ts:31`. If the firmware ignores `base` once a
pulse channel is set (as `session.ts:84` warns for single-colour firmware), the
white-dominant selected bar degrades to a white↔black pulse — still correct in
meaning, and still distinct from the active bars' rate. Verify on hardware; if the
pairing reads wrong, swap `base`/`anim` for the selected rows only.

### 3. Step row (`seq/leds.ts`)

Replace `step >= lenSteps` with `!stepInLoop(step)` and `step < lenSteps` with
`stepInLoop(step)`. Out-of-loop steps keep today's black (unchanged look for
`loopStart === 0`); in-loop steps get occupancy white / track-dim as before.

### 4. Strip (`seq/render.ts`)

Span `from = min(loopStartBar, barOffset)` to `to = max(loopEndBar, barOffset)`.
Active bars are segments — 2 px for the selected bar, 1 px otherwise, and 1 px even
when selected if the loop is a single bar (existing native rule). Inactive bars in
span render the `+` marker.

Sweep is confined to the active window: origin `(loopStartBar - from) * segW`,
width `loopBarCount * segW`, position from `playheadX(posTick, loopStartTick, lenSteps, activeWidth)`.

### 5. Persistent Loop readout (`seq/render.ts`, `app/tick.ts`)

While `loopMode` is on, draw a header band reading `LOOP 3-4  BAR 3` (single-bar
loop reads `LOOP 3  BAR 3`), computed live from state — replacing the current
~0.3 s flash that leaves no text behind.

Drawn from `tick.ts`'s **per-tick** section beside `drawLoopStrip()` (`tick.ts:618`),
not the dirty-frame block, for the same reason the strip lives there: it must track
navigation without redraw plumbing. It clears its own rows each tick, as the strip
does. Leaving Loop mode sets `appState.dirty` so the band is erased once, following
the quant-overlay precedent at `tick.ts:419`. While the band is up it supersedes the
timed `Loop` announcement; the `Note` announcement on exit is unchanged.

### 6. Gestures (`seq/loop-mode.ts`, `seq/router-steps.ts`)

- `DOUBLE_TAP_TICKS = 60` → `DOUBLE_TAP_MS = 450` on `Date.now()`, with an `*At()`
  variant for tests — the pattern `momentary.ts:11` already documents for exactly
  this tick-rate failure.
- `setLoopBars` clamps `barOffset` into `[s, e]`, fixing both the two-bar-press and
  the wheel-shrink stranding. Clamping (rather than always jumping to the loop start)
  preserves proximity and yields the loop start in the approved example
  (viewing bar 1, press 3+5 → bar 3).
- `router-steps.ts:142` takes `minBarOffset()` as its lower bound instead of `0`.

## Testing

Cheapest level that reproduces each bug, per `CLAUDE.md`. **Every fix is reverted
individually to confirm its test fails** — no exceptions.

Shared fixture: `loopStart=32, lenSteps=32, barOffset=2`, notes at steps 32 and 36.

- `logic.mjs`
  - step row: white at 0/4, track-dim elsewhere (**currently all-black** — teeth).
  - strip: segments at bars 2–3, not 0–1; selected bar thick, not a `+`.
  - strip: selected bar outside the window → `+` markers through to it.
  - `playheadX`: 0 at loop start and 64 at loop mid (**currently 127** — teeth).
  - `minBarOffset`/`maxBarOffset`/`stepInLoop`.
  - `loopBarColor`: full state table above, including selected-inactive.
  - `setLoopBars` clamps `barOffset`; arrow nav clamps to `minBarOffset()`.
  - double-tap via the `*At()` variant at wall-clock boundaries (449 ms / 451 ms).
  - `loopHeaderText()` for single-bar and multi-bar windows.
- `app-loop.mjs` — Loop-mode paint through the real setter: base on the first tick,
  animation on the second (the `cachedSetAnimLED` handshake), and the
  `seqLedsInvalidate()` on Loop-mode transition.
- `screenshot.mjs` — new scenes: mid-clip-loop strip, selected-bar-outside-window,
  Loop header band. Baselines regenerated with `--update`.
- `perf.mjs` — loop-mode frame cost; should improve once `barHasContent` is gone.
- Device: `./scripts/test-seq.sh` (reachability-checked first). Hardware check of
  the pulse pairing per §2's open item.

## Docs

- `MANUAL.md:523` is two lines for this whole feature and cites `§11.5/§12.1`,
  sections that no longer exist. Replace with a real Loop view section: the bar
  gestures, the LED table, and the strip/readout, with a baseline screenshot.
- `CHANGELOG.md` entry covering the six fixes and the two additions.

## Out of scope

- Double-tap restoring the previous loop window (rejected).
- Auto-following the playing bar in the step view.
- Any change to how the engine stores or clamps the loop window.
