# Movy Knob Steppiness Fix — Staggered Refresh Design

**Date:** 2026-06-08  
**Status:** Spec — awaiting implementation  
**Related tests:** `browser-test/perf.mjs`, `scripts/test.sh` §8b

---

## Problem

Knob turns on device feel steppy: sound, LEDs, and UI all update in ~150 ms bursts
rather than smoothly.

**Root cause:** `refreshKnobValues()` in `model/tick.ts` fires every
`KNOB_REFRESH_TICKS = 69` ticks (~138 ms at ~500 Hz). It calls
`shadow_get_param` sequentially for every param in `s.knobParams`. Each call
blocks for one shim SPI callback round-trip (~2–3 ms at 44100/128). For OB-Xd
(62 params): 62 × 3 ms ≈ 186 ms — *longer* than the refresh interval. During
that blocking window, no MIDI events are processed, no LEDs are updated, and no
display renders, so accumulated knob CCs all fire at once → stepping.

This is confirmed by device log: `perf_refresh_ms=178–316 ms` for OB-Xd,
`perf_tick_rate=154–273 ticks/sec` under load.

---

## Constraints

- No changes to the schwung C layer (`schwung/`, `schwung-davebox/`) — movy only.
- `shadow_get_param` must remain synchronous blocking (the API contract).
- The fix must not break the existing browser-test and device-test suites.
- `KNOB_REFRESH_TICKS`, `NAME_POLL_TICKS`, `KNOBS_PER_PAGE` remain constants.

---

## Solution: Staggered Refresh

Instead of refreshing all N params in a single tick, refresh **one param per
tick**, cycling through the list. This spreads the blocking across N ticks
rather than concentrating it in one.

### Mechanism

Add a new field to `ModelState`:

```typescript
refreshParamCursor: number;  // index into knobParams[] of the next param to refresh
```

`processTick` in `model/tick.ts` changes:

**Before (current):**
```
every KNOB_REFRESH_TICKS ticks → call refreshKnobValues() (reads ALL params)
```

**After:**
```
every tick → call refreshOneParam(s):
    read knobParams[refreshParamCursor] from shadow
    update knobValues[refreshParamCursor]
    advance cursor (mod len)
    if cursor just wrapped → full cycle done, check for dirty
```

Net effect: for 16 params, one GET every tick → ~2–3 ms blocking per 2 ms tick
(no improvement — but each tick still returns in time). Wait — we need to be
careful here.

### Timing analysis

Each `shadow_get_param` call blocks for ~2–3 ms (one shim SPI callback
round-trip). In overtake mode, `shadow_ui.c` runs the tick loop with
`usleep(2000)`, so one GET per tick will stretch tick wall time from ~2 ms to
~5 ms, naturally dropping the tick rate from ~500 Hz to ~180–250 Hz. That is
acceptable — 5 ms latency is imperceptible, and the critical property is that
**no single tick blocks for more than ~3 ms**: MIDI events, LED updates, and
display renders all run between consecutive GETs.

With 16 params: full refresh cycle ≈ 80 ms (16 × 5 ms) instead of the current
~50 ms burst. With 62 params: full cycle ≈ 310 ms spread across 62 ticks vs.
the current 186 ms in one tick. The absolute cycle time is similar or longer,
but knob response is immediate because MIDI processing is never blocked.

### Active-knob suppression

During active knob use, the current values in `s.knobValues` are authoritative
(set by `applyKnobDelta` + `shadow_set_param`). Reading them back from the shim
during knob use races with in-flight SET requests and can briefly show stale
values. Suppress refresh for `REFRESH_SUPPRESS_TICKS` after the last delta.

```typescript
const REFRESH_SUPPRESS_TICKS = 100;  // ~200 ms; covers the shim SET round-trip
```

In `processTick`, before calling `refreshOneParam`:
```typescript
if (s.lastDeltaTick >= 0 && _perfTickCount - s.lastDeltaTick < REFRESH_SUPPRESS_TICKS) {
    return;  // skip this tick's param read
}
```

`s.lastDeltaTick` is updated in `processTick` after the `pendingDeltas` flush
loop (where `_perfTickCount` is already available). `applyKnobDelta` in
`store.ts` does not need to change.

---

## Data flow changes

### `ModelState` additions (state.ts)

```typescript
refreshParamCursor: number;   // 0
lastDeltaTick: number;        // -REFRESH_SUPPRESS_TICKS (starts un-suppressed)
```

### `store.ts` — `refreshKnobValues` replacement

Replace `refreshKnobValues(s)` with `refreshOneParam(s, tickCount)`:

```typescript
export function refreshOneParam(s: ModelState, tickCount: number): void {
    if (s.knobParams.length === 0) return;
    if (tickCount - s.lastDeltaTick < REFRESH_SUPPRESS_TICKS) return;

    const i = s.refreshParamCursor % s.knobParams.length;
    s.refreshParamCursor = (i + 1) % s.knobParams.length;

    const p = s.knobParams[i];
    if (!p) return;

    const raw = shadow_get_param(s.activeSlot, p.key);
    if (raw === null) return;
    const newVal = parseFloat(raw);
    if (!isNaN(newVal) && newVal !== s.knobValues[i]) {
        s.knobValues[i] = newVal;
        s.dirty = true;
    }
}
```

The existing `refreshKnobValues` function is kept for reference until the new
path is validated on-device, then removed.

### `tick.ts` changes

- Remove `refreshCountdown` decrement and the `if (--s.refreshCountdown <= 0)` block.
- Call `refreshOneParam(s, _perfTickCount)` unconditionally each tick.
- Update `lastDeltaTick` after the `pendingDeltas` flush loop.
- Remove `KNOB_REFRESH_TICKS` import (no longer needed by tick.ts).
- Keep perf logging but update: log `perf_cursor=N` every NAME_POLL_TICKS ticks
  to confirm the cursor is advancing.

### `constants.ts` additions

```typescript
export const REFRESH_SUPPRESS_TICKS = 100;
```

`KNOB_REFRESH_TICKS` can be removed once the old path is gone.

---

## Testing plan

### Browser tests (perf.mjs) — threshold tightening

After the fix, update thresholds:

| Check | Before | After |
|---|---|---|
| `GET_PARAM_PER_REFRESH_MAX` | 40 | 2 (one per tick; allow 1 spare) |
| `RENDER_MEDIAN_MS_MAX` | 2 ms | 2 ms (unchanged) |
| `FILL_RECT_PER_RENDER_MAX` | 1500 | 1500 (unchanged) |

Test 2 in `perf.mjs` currently counts GETs over a 69-tick window. After the
fix it must change to: run exactly 1 tick and assert `getParamCount <= 2`
(one refresh GET, one pollModuleName GET only if it fires in that tick — in
practice it fires every 344 ticks so it won't coincide). The 69-tick loop
becomes irrelevant.

### Device tests (test.sh) — threshold tightening

After the fix, tighten in `scripts/test.sh`:

```bash
REFRESH_MS_MAX=10   # one GET per tick: ~3 ms; allow 10 ms for jitter
TICK_RATE_MIN=100   # unchanged
```

(The comment in test.sh currently says "tighten to 30 ms"; after staggered fix
we can tighten further to 10 ms because each tick only blocks for one GET.)

### Manual smoke test

On-device: load OB-Xd, twist knob 1, listen for stepping. The ~150 ms burst
should be gone; param changes should feel immediate.

---

## What this does NOT change

- LED update path (`updateKnobLEDs`) — already fires every tick, not blocked.
- Display render path (`renderKnobsView`) — already only runs when `dirty`.
- MIDI routing — unchanged.
- `pollModuleName` — still fires every `NAME_POLL_TICKS`.
- The shim, schwung, or any C layer — movy-only change.

---

## Optional follow-up: native knob renderer

Not in scope for this fix, but noted for future work:

`drawCircleBorder` makes ~64 `fill_rect` calls per arc knob via a Bresenham
loop. Replacing this with a native C/Rust `draw_knob_widget(x, y, r, value)`
binding would reduce ~520 fill_rect calls per frame to 8. On QuickJS (device)
each JS → C call has overhead; eliminating the loop would measurably reduce
render time. This is a separate design effort.

---

## Open questions (resolved)

- **Automated param changes (e.g., LFO modulation):** The suppression window
  (`REFRESH_SUPPRESS_TICKS = 100`) is short enough that automated changes
  become visible within ~200 ms of the last knob touch. This is acceptable —
  LFO-modulated params update at audio rate; a 200 ms display lag after a
  manual touch is not noticeable. If real-time display of automated values
  while the user is also turning knobs is needed, the cursor can skip the
  actively-touched slot only (rather than suppressing all refresh) — but that
  is deferred.

- **`refreshCountdown` removal:** `s.refreshCountdown` in `ModelState` and
  `createModelState` should be removed to keep state clean. `KNOB_REFRESH_TICKS`
  constant should also be removed from `constants.ts` once the old code path
  is gone.
