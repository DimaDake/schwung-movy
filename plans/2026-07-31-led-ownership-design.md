# LED ownership under overtake — design

**Date:** 2026-07-31
**Scope:** LED ownership only. Input routing, display handover, and the
hold-track + volume-knob gesture are explicitly **out of scope** and unchanged.

Framework references below are read from `schwung` at `origin/main`
(`4519d26d`, 2026-07-21). The local worktree was 5 weeks stale when this was
written and has since been reset to that commit.

---

## Problem

Move's firmware paints LEDs on top of movy's while movy is the active overtake
tool. movy currently fights this by force-writing LEDs every tick, and the
behaviour is inconsistent between a fresh open and a resume-from-park.

Two independent defects cause it.

### Defect 1 — `skip_led_clear` disables every LED suppression the framework has

`movy/module.json` declares `capabilities.skip_led_clear: true`. In
`schwung/src/host/shadow_led_queue.c`, `shadow_clear_move_leds_if_overtake()`
runs in this order:

1. `if (!cur_overtake) return;`
2. the `CORUN_TARGET_MOVE_NATIVE` branch (movy does not use co-run — `grep -rn corun movy/src/` is empty)
3. **`if (ctrl && ctrl->skip_led_clear) return;`** ← movy exits here
4. the strip loop that zeroes Move's cable-0 note LEDs, CC LEDs, and — when
   `overtake_suppress_sysex` is set — sysex RGB packets

So movy opts out of all of it. Three consequences:

- Move's note LEDs, CC LEDs and sysex RGB all reach the hardware.
- **`shadow_set_overtake_suppress_sysex(1)` in `src/app/init.ts:24-27` is inert.**
  That branch lives inside the step-4 loop `skip_led_clear` skips. Commit
  `588cdcd` ("Take Move's LED sysex during overtake") cannot have had the
  effect its message describes.
- `activateLedQueue()` is skipped for `skip_led_clear` modules
  (`shadow_ui.js:3514-3515`, and again on the tool-reconnect path at
  `:5548-5549`), and entry LED-clear / exit restore are both bypassed.

**The capability is vestigial.** `git log -S skip_led_clear -- module.json`
returns exactly one commit: `568b9ac`, movy v0.1.0, when movy was a "Piano
keyboard + module host". `skip_led_clear` is documented for modules that
overlay highlights on Move's existing clip colours (`schwung/docs/MODULES.md:80`).
movy is no longer such a module — `sessionPaintGrid()` (`src/seq/leds.ts:170`)
paints all 32 clip pads itself and `src/app/tick.ts:317` paints the full
chromatic layout. Nothing in movy consumes a Move-painted LED.

movy's own code already documents the symptom, in `src/renderer/knob-leds.ts:24-25`:

> *"force=true bypasses the LED cache so Move firmware's per-frame touch-state
> updates don't win."*

### Defect 2 — first-load and post-park LED behaviour differ

`resumeOvertakeModule()` (`shadow_ui.js:3237`) sets `overtake_mode(2)` and calls
`activateLedQueue()`, but never re-sets `skip_led_clear` or
`overtake_suppress_sysex`. Both were zeroed at park (`shadow_ui.js:3180-3187`).
`init()` is not re-run on resume, so movy's `suppress_sysex(1)` never fires
again, and `src/app/resume.ts` does not re-assert it.

| Phase | `skip_led_clear` | `suppress_sysex` | Move note/CC LEDs | Move sysex RGB |
|---|---|---|---|---|
| First load | 1 | 1 (inert) | leak | leak |
| After park → resume | 0 | 0 | stripped | leak |

movy's LED isolation therefore changes silently after the first Back-park
cycle, which is consistent with pollution that appears to come and go.

---

## Design

### Change 1 — `movy/module.json`: remove `skip_led_clear`

Delete the `"skip_led_clear": true` line from `capabilities`.
`claims_master_knob` stays (input side, out of scope).

Resulting behaviour:

- `shadow_clear_move_leds_if_overtake()` reaches its strip loop; Move's note
  LEDs, CC LEDs, and (via `suppress_sysex`) sysex RGB are all zeroed.
- `activateLedQueue()` runs on first load, matching the resume path. The
  first-load/resume asymmetry disappears.
- Entry gains the progressive LED-clear + "Loading…" ceremony
  (`shadow_ui.js:3706-3722`, `:14998-15020`).
- Exit (`exitToolOvertake`, `shadow_ui.js:3366-3369`) and park now run the
  snapshot restore. This is a correctness gain: today the entry snapshot is
  continuously repolluted by Move's passthrough writes during the session,
  which is precisely why the current code deliberately skips the restore.
  Frozen at entry, the snapshot is clean.

### Change 2 — `src/app/led-ownership.ts` (new)

Single exported function holding the guarded framework call:

```ts
export function claimLedOwnership(): void
```

Called from `init()` (`src/app/init.ts`) and from `onResume()`
(`src/app/resume.ts`). Fixes Defect 2 and satisfies the no-duplication rule —
one call site to assert against in tests, one place to change if the framework
grows another LED-ownership flag.

The `typeof fn === 'function'` guard is retained: hosts predating
`shadow_set_overtake_suppress_sysex` must keep working.

### Change 3 — `src/renderer/knob-leds.ts`: add a diff cache

`updateKnobLEDs()` currently writes 16 LEDs (8 notes 0-7 + 8 CCs 71-78) every
tick with no diff cache, purely to out-shout Move's repaints. With Changes 1-2
in place Move no longer repaints those addresses, so the writes become
on-change.

**`force=true` stays.** The obvious implementation — drop `force` and let
schwung's `setLED` cache do the work — is wrong here. movy imports `setLED` /
`setButtonLED` from `/data/UserData/schwung/shared/input_filter.mjs`
(`build/device.mjs:20`), whose module-level `ledCache` / `buttonCache` movy has
no way to invalidate: `invalidateLedCachesOnResume()` (`src/app/tick.ts:181-191`)
clears only movy's own caches. Meanwhile the framework's entry LED-clear
(`shadow_ui.js:650-662`, which covers CCs 71-78) writes straight through
`move_midi_internal_send` and never updates that cache. Any path where the
cache outlives a hardware clear — notably a tool exit and re-entry within one
shadow_ui process, where the ES module cache may persist — leaves the cache
claiming a colour the hardware no longer shows, and the knob LEDs stay dark.

So Change 3 gives knob-leds **its own** diff cache, cleared by the existing
`invalidateLedCachesOnResume()`, and keeps `force=true` to bypass schwung's
opaque one. This is exactly the pattern `src/seq/led-cache.ts` already uses,
and for the same reason.

This is in scope rather than deferred for two reasons:

1. It removes the workaround whose own comment names the bug. Leaving it keeps
   the pollution assumption baked into the code.
2. **Budget interaction.** The framework's overtake LED queue allows
   `SHADOW_LED_OVERTAKE_BUDGET = 48` writes per tick
   (`schwung/src/host/shadow_led_queue.h:17`). movy's `FRAME_BUDGET` is 40 for
   sequencer LEDs (`src/seq/led-cache.ts:18`) plus knob-leds' unconditional 16
   = up to 56 distinct addresses per tick. Activating the queue on first load
   makes that ceiling newly reachable. Dropping idle knob traffic to ~0
   removes the pressure.

Ships as its own commit so device verification can attribute any regression to
Changes 1-2 or to Change 3.

---

## Testing

The pollution itself happens in schwung's C code, so no local movy suite can
reproduce it. Per CLAUDE.md's "match the test to the bug — cheapest level that
reproduces it", the local test targets Defect 2, which *is* movy logic.

**`browser-test/logic.mjs`** — mock `shadow_set_overtake_suppress_sysex`, drive
init → park → resume, assert LED ownership is claimed on both. Prove teeth by
reverting `resume.ts` and confirming the test fails.

**`npm test`** — full local suite. Screenshot baselines are not expected to
move (LED writes are not framebuffer). `perf.mjs` should show Change 3's drop
in per-tick LED traffic.

**Device** (`./scripts/test.sh`, `./scripts/test-seq.sh`) — plus an automated
park/resume log assertion rather than a manual pad inspection: movy already
logs on claim, so the device script parks, resumes, and greps for the
resume-side claim. No manual device gestures.

---

## Risks

**Entry delay.** `OVERTAKE_INIT_DELAY_TICKS = 30` (`shadow_ui.js:613`),
commented "~500ms at 16ms tick". The device is known to tick considerably
faster than several schwung comments assume, so the real delay is plausibly
well under 500ms. Measure on device; do not quote the comment. If it is
genuinely disruptive, revisit — the user has accepted it provisionally.

**Park visuals.** Move now gets its pre-overtake LEDs restored on park. Expected
to be correct (you are parking under Move's own UI) but it is new behaviour and
needs a device look.

**Regression shape.** If pollution survives Changes 1-2, Change 3's diff cache
would make a polluted LED *stick* rather than flicker. This is why the commits
are separated.

---

## Out of scope

- The hardcoded CC 79 / note 8 input passthrough (`schwung_shim.c:5860`) and
  the volume-touch display handover (`schwung_shim.c:3288`). Both would need
  upstream schwung changes to honour the `claims_master_knob` capability movy
  already declares. Tracked separately.
- Upstream fix for the framework dropping a module's declared capabilities on
  resume (Defect 2's root cause). movy works around it locally here; the
  framework bug is worth reporting separately since it will affect other tools.
