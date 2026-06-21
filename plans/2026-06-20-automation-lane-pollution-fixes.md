# Automation lane pollution — root cause & fixes (2026-06-20)

## Problem (reported)

On the Mr Drums track (and chromatic tracks) step automation misbehaves:
params stop showing before the 8-lane cap, the on-screen knob doesn't move,
the pool-full toast is hidden behind the bar strip, and FX/MIDI params won't
automate at all.

## Root cause (evidence)

Device log, track-0 lane pool (8/8 full):

```
auto lanes t=0 [pad_vol, timbre, pad_attack_ms, pad_start, pad_pan, p01_vol, p07_pan, p07_decay_ms]
```

Only `p01_vol, p07_pan, p07_decay_ms` are real. The pool is polluted by two bugs:

- **RC1 — lanes never cleared on module change.** `resetAutomation()` has zero
  callers. `timbre` is a leftover from a previous synth on that track.
- **RC2 — pre-migration "zombie" alias lanes.** Today's per-pad change made movy
  address pads by concrete keys (`p03_vol`), but the engine *persists* lanes, so
  older lanes assigned with the generic alias key (`pad_vol`, `pad_pan`,
  `pad_attack_ms`, `pad_start`) survive. The display/match/clear logic now
  computes the concrete key, so these never match → never show the dot
  (render log: every param `a0`), can't be reused or cleared, occupy lanes
  forever.

Symptom mapping: pool full of zombies → `hiddenDuringHold()` hides real params
on hold (symptom 1); turning a non-pooled param with a full pool is consumed but
assigns nothing (symptom 2); the per-track 8-lane pool is shared across modules,
so drum zombies starve FX (symptom 4); "tune" is just the next param tried with a
full pool (symptom 5). The "8 AUTOMATION LANES — FULL" toast is drawn directly in
the knob view (rows 58–63) and, unlike `seqToast`, doesn't set the strip-
suppression flag, so `drawLoopStrip()` (clears rows 60–63) overwrites it
(symptom 3).

## Fixes (pool design kept as-is per decision)

1. **Purge invalid lanes at the label-sync boundary.** `syncLabelsFromEngine`
   validates each persisted lane against the *current* chain and drops it
   (`clearLane` → emits `aclr`, clearing engine + persistence) when:
   - the key uses the drum pad alias prefix (obsolete pre-migration form), or
   - the chain_params for that track is present but lacks the key (stale param,
     e.g. `timbre` after a module swap).
   When chain_params isn't loaded yet (`unknown`), keep the lane (no wrongful
   wipe during transient load). This runs on boot + after restore → **auto-
   recovers the device** on next deploy.
2. **Re-sync on runtime module change.** When the active track's `moduleId`
   changes, `requestLabelSync()` so the purge re-runs against the new chain.
3. **Toast/strip overlap.** Include the pool-full toast in the `jogToastShown`
   guard so the Loop strip yields to it (like every other toast).

## Tests

- `validateLane`: keep (range), drop (alias prefix), drop (stale key), unknown
  (no chain_params).
- `syncLabelsFromEngine`: drops alias + stale lanes, emits `aclr`, keeps valid;
  unknown kept with defaults.
- Device: deploy, confirm `auto lanes t=0` no longer lists `timbre`/`pad_*`,
  re-automate ≥1 FX param, pool-full toast not clipped by the strip.
