# The splash lifts before the UI knows what loaded

## Symptom (reported)

> when I open a set in movy (or open movy when the set is selected) sometimes I
> still see an empty module slot first and only after some time the module
> appears there. sometimes I also see a module from the previous set before it
> disappears to align with the new set.

## Root cause

The settling gate (`seq/set-settle.ts`) asks the ENGINE two questions — have the
queued chain loads drained (`chpend`), and has the deferred payload landed — and
promotes to `ready` the moment both answer yes. It asks the UI nothing.

Every `Model` caches its module name and its whole param hierarchy, and re-reads
them only on the name poll: `NAME_POLL_TICKS = 344`, which at the device's
measured 63-205 Hz is **1.7-5.5 seconds**. Nothing kicks that poll when a Set
loads — `model.reload()` is called only from the browser, an undo restore, and
an LFO write.

So the first frame drawn after the splash lifts comes out of a cache that
predates the load: `'—'` on a freshly opened tool, or the previous Set's module
after a switch. Measured on the headless app loop (mock engine, one drum synth):

```
ready at tick 1  | module name on the visible slot = "—"
name resolved at tick 348
```

A second, smaller contributor: the render in `app/tick.ts` is gated on
`modelDirty || masterDirty || appState.dirty || …`, and a session phase change
sets none of them. Entering `loading` therefore does not repaint — the previous
Set's view stays on screen until something else happens to go dirty, which is
the same ~344-tick poll.

## The fix

Three pieces, one rule: **the Set is not playable until the thing about to be
drawn knows what is in it.**

1. `model/tick.ts` — `reReadModule()`: the name poll and the hierarchy rebuild,
   done NOW rather than scheduled. Both reads are synchronous, so the frame
   after the call already draws the Set that loaded. The hierarchy-rebuild block
   is lifted out of `processTick` into `syncHierarchy()` and shared, rather than
   copied. `Model.reloadNow()` exposes it.
2. `app/model-refresh.ts` (new) — `refreshModelsForSet()`. Every model gets a
   scheduled `reload()`; the one about to be DRAWN gets the synchronous
   `reloadNow()`. Only one, deliberately: re-reading eighty models on the
   audio-adjacent tick would cost far more than it buys, and an off-screen model
   re-reads on its first tick, which is the tick it becomes visible.
3. `seq/set-session.ts` — `refreshModelsForSet()` is called at the promotion
   point, after the loads have drained and the payload has landed, immediately
   before `phase = 'ready'`.
4. `app/tick.ts` — a session phase change marks `appState.dirty`, so the splash
   replaces the previous Set's view on the very next frame instead of whenever
   something else repaints.

The re-read has to happen AFTER the loads drain, not at `enterLoading`: reading
mid-load returns an empty slot and latches it.

### Rejected: waiting on the model instead of re-reading it

The first attempt kicked `reload()` at the promotion point and held the splash
until the shown model reported the re-read done. It worked, and it was wrong: it
made the session lifecycle depend on the shown model being ticked by the same
loop, which is true in `app/tick.ts` and true nowhere else. Fifteen assertions
across `set-session` and `set-settling` — which drive the session with no UI
attached — stalled at the ten-second cap. A wait whose failure mode is "ten
seconds of splash" needs a much better reason than a synchronous read that costs
one module's worth of IPC, once per Set load.

## Not in scope

`SET_POLL_TICKS = 96` (~0.5-1.5 s) is how long movy takes to NOTICE a Set
switch. During that window movy is legitimately live on the previous Set, which
is still loaded and playable. Shortening it trades a `host_read_file` per poll
against that latency and is a separate decision.

## Tests

- `browser-test/logic/set-settling.mjs` — S9: nothing is re-read while the
  modules are still draining; the shown model is re-read exactly once, and
  BEFORE the phase goes ready; an off-screen model is scheduled, not read.
- `browser-test/app-loop.mjs` — the user-visible assertion: on the tick
  `sessionReady()` first turns true, the visible slot already names its module.
  Plus the repaint half, with a control arm (the Loop strip paints ~1 rect on an
  idle tick; a phase change paints ~80).
- Teeth, both verified by mutation: dropping `refreshModelsForSet()` fails the
  app-loop name assertion and 4 logic assertions; dropping the `appState.dirty`
  on phase change fails the repaint assertion (80 rects → 1).
