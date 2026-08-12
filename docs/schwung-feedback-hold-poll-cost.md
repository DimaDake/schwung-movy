# `reconcileFeedbackHolds` taxes every overtake tool's tick rate — investigation & proposed fix

**Status:** Diagnosed (2026-08-12). Fix NOT implemented — lives in the **schwung**
repo (root `CLAUDE.md` marks schwung do-not-modify). This doc is the handoff so
the change can be raised upstream without re-investigating.

**Scope:** Universal — costs **every** Schwung overtake tool (movy, davebox, …)
roughly 0.6 blocking host round-trips per tick. NOT movy-specific.

---

## TL;DR

`reconcileFeedbackHolds()` in `src/shadow/shadow_ui.js` reads
`getSlotParam(slot, "synth_module")` for all four slots on every invocation, and
is invoked every `FEEDBACK_HOLD_CHECK_INTERVAL = 10` ticks. Each read is a
**blocking** `shadow_get_param` that the shim only services **once per SPI frame
(~2.7 ms on device)**, so one invocation costs ~11 ms of wall time spread across
the loop.

The constant is commented `/* ~4x/sec */`, which assumes a ~40 Hz tick. That
holds for the normal shadow UI (`usleep(16000)`), but an **overtake** module runs
the loop at `usleep(2000)` and ticks at 80–100 Hz, so it actually fires ~8–10×/sec
— and the module id it re-reads changes only when the user loads a module.

Measured on movy (helm on two tracks, 2026-08-12): `get synth_module` was
**0.6 calls/tick costing 1.5 ms**, out of a ~12 ms tick period. That is **~12% of
every tick**, and because an overtake module's tick period is also its MIDI
sampling interval, it is ~12% of the tool's input latency.

## Proposed fix

Cache the slot→module-id mapping the same way `isLineInConsumerModule()` already
caches metadata by module id. The value is only invalidated by a module load,
which `shadow_ui.js` observes. Options, cheapest first:

1. **Cache `synth_module` per slot**, invalidated where a module load is handled
   (the same place `lineInConsumerCache` would need clearing). Removes 4 reads
   per invocation, leaving the guard's `synth:bypassed` / `slot:feedback_hold`
   reads — which only run for slots that actually consume line-in, i.e. usually
   none.
2. **Scale the interval by loop speed**: make `FEEDBACK_HOLD_CHECK_INTERVAL`
   depend on `overtake_mode`, so "~4×/sec" stays true at 100 Hz. Simpler but
   still pays 4 blocking reads per firing.

(1) is preferred: it makes the steady-state cost nil rather than merely rarer.

## How it was found

`movy/src/app/perf-probe.ts` wraps the host param globals and reports per-tick
call counts grouped by key, plus one stack trace per window for a chosen key
(`TRACE_LABEL`). Setting `TRACE_LABEL = 'synth_module'` attributed the calls to
`reconcileFeedbackHolds` in schwung's own `shadow_ui.js` rather than to movy.
Enable movy's debug log and read `perf_ipc` / `perf_who` lines:

```bash
ssh ableton@move.local 'touch /data/UserData/schwung/debug_log_on'
ssh ableton@move.local 'grep -o "perf_ipc.*" /data/UserData/schwung/debug.log | tail -3'
```

## Background: why a param read costs so much

`shadow_get_param` writes the shared `shadow_param` mailbox and then parks in a
`usleep(SHADOW_PARAM_POLL_US /* 200 */)` loop (`shadow_param_wait_response`)
until the shim services it, which happens once per SPI frame. So for any overtake
tool:

```
tick period ≈ (blocking param calls per tick) × ~2.7 ms + JS work + ~2 ms loop sleep
```

Reducing the *number* of per-tick calls is the only lever that matters; the calls
themselves are already trivial on the shim side (`param` avg 13 µs per frame).
