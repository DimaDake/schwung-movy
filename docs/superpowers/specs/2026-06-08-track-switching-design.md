# Track Switching Design

**Date:** 2026-06-08  
**Status:** Approved

## Problem

Movy currently locks to whichever track was focused when it opened (`shadow_get_ui_slot()` called once at init, stored in `appState.activeSlot`, never updated). The header hardcodes `'T1'`. Users cannot switch between the 4 Move tracks while movy is running.

## Goal

Support all 4 tracks (T1–T4) in movy with track switching via the Move's physical track buttons (MoveRow1–MoveRow4, CC 43–40). Preserve both chain slot position (MIDI_FX/SYNTH/FX1/FX2) and knob page per track when switching back and forth.

## Input

Track buttons arrive as CC messages `[0xB0, d1, d2]` with `d1` in range 40–43:

| Button | CC | Slot |
|--------|----|------|
| T1     | 43 | 0    |
| T2     | 42 | 1    |
| T3     | 41 | 2    |
| T4     | 40 | 3    |

Formula: `newSlot = 43 - d1`

On track switch, `jogTouched` resets to `false` (the jog toast should not carry over from the previous track).

These are forwarded to `onMidiMessageInternal` by shadow_ui.js in OVERTAKE_MODULE mode (all non-encoder MIDI is passed through directly). The shadow_ui track-slot handler only fires outside overtake mode.

## Architecture

### Model grid

Replace the single 4-model chain with a 4×4 model grid. All 16 models are created at init. Only the active track's 4 models tick each frame — IPC load is identical to today.

```
trackModels: Model[][]   // [trackSlot 0-3][chainSlot 0-3]
```

`knobPage` lives inside each model's `ModelState` and is naturally preserved across track switches because models are never destroyed or reset after init.

### Per-track chain index

Replace the single `chainIndex: number` with a per-track array:

```
trackChainIndex: number[]   // length 4, default [1, 1, 1, 1]  (SYNTH = 1)
```

Active model accessor: `trackModels[activeSlot][trackChainIndex[activeSlot]]`

### activeSlot

`appState.activeSlot` remains a single number representing the currently focused track (0–3). It is now updated at runtime when track buttons are pressed (previously only set at init).

## State changes (`app/state.ts`)

| Before | After |
|--------|-------|
| `chainModels: Model[]` | `trackModels: Model[][]` |
| `chainIndex: number` | `trackChainIndex: number[]` |
| `activeSlot: number` (set once) | `activeSlot: number` (updated on track switch) |

## File changes

| File | Change |
|------|--------|
| `src/app/state.ts` | Add `trackModels: Model[][]`, `trackChainIndex: number[]`; remove `chainModels`, `chainIndex` |
| `src/app/init.ts` | Create 16 models with `Array.from({length:4}, (_, slot) => CHAIN_SLOTS.map(s => createModel(slot, s.componentKey)))`; init `trackChainIndex = [1,1,1,1]` |
| `src/app/tick.ts` | Derive `chainIdx = trackChainIndex[activeSlot]`; use `trackModels[activeSlot][chainIdx]` |
| `src/midi/router.ts` | Add CC 40–43 handler (update `activeSlot`, set dirty); update all `chainModels`/`chainIndex` references to use `trackModels[activeSlot]` and `trackChainIndex[activeSlot]` |
| `src/renderer/chain-view.ts` | Add `activeSlot: number` param; replace hardcoded `'T1'` with `` `T${activeSlot + 1}` `` |

## Display

- `renderChainView` gains a 4th parameter `activeSlot: number`
- Track label in header: `'T' + (activeSlot + 1)` — `'T1'` for slot 0, `'T4'` for slot 3
- No change to KNOBS, KEYS, or BROWSE views
- No pixel layout change — screenshot baselines remain valid for slot 0 (T1 same as before)

## Out of scope

- LED feedback on track buttons (track button LEDs are not exposed via `setLED`)
- Polling inactive tracks in the background
- Any change to the KEYS, BROWSE, or KNOBS views
