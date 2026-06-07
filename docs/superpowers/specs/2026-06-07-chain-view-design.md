# Chain View — Design Spec

**Date:** 2026-06-07  
**Status:** Approved

## Overview

Expand movy from single-module (synth only) to the full Schwung module chain: MIDI FX → Synth → FX 1 → FX 2. A new Chain View becomes the default entry point; users drill into any module to see all its parameter pages, then return to the chain overview.

---

## Navigation Model

Four views:

| View | Entry | Exit |
|---|---|---|
| `VIEW_CHAIN` *(new default)* | app start, Back from `VIEW_KNOBS` or `VIEW_KEYS` | Back → `host_exit_module()`, jog click → `VIEW_KNOBS`, shift+jog click → `VIEW_BROWSE` |
| `VIEW_KNOBS` | jog click in chain view | Back → `VIEW_CHAIN`, jog click → `VIEW_BROWSE` |
| `VIEW_BROWSE` | shift+jog click (chain view), jog click (knob view) | Back → `browseOrigin`, MoveMainButton → load module → `browseOrigin` |
| `VIEW_KEYS` | MoveMainButton from any view | Back → `VIEW_CHAIN` |

Jog wheel rotation:
- `VIEW_CHAIN`: cycles `chainIndex` 0–3
- `VIEW_KNOBS`: cycles pages within active component (existing behavior)
- `VIEW_BROWSE`: scrolls module list (existing behavior)

---

## Chain Components

```
index  label     componentKey  paramPrefix  moduleIdKey
  0    MIDI FX   midi_fx1      midi_fx1     midi_fx1_module
  1    SYNTH     synth         synth        synth_module
  2    FX 1      fx1           fx1          fx1_module
  3    FX 2      fx2           fx2          fx2_module
```

Module browser scan directories per component:
- `synth` → `modules/sound_generators`
- `midi_fx1` → `modules/midi_fx`
- `fx1`, `fx2` → `modules/audio_fx`

---

## Model Parameterization

`createModel(slot, componentKey)` replaces `createModel(slot)`.

All param lookups are derived from `componentKey`:
- `ui_hierarchy` → `componentKey + ':ui_hierarchy'`
- `chain_params` → `componentKey + ':chain_params'`
- module name poll → `componentKey + ':name'`
- module id → `componentKey + '_module'` (underscore — shadow API convention)
- set/get param → `componentKey + ':' + paramKey`

Four models are created at init, one per chain slot. Only the active model ticks each frame. Each model owns its own `knobPage`, preserving last-visited page per component automatically.

---

## Chain View Rendering

**Populated slot:**
- Header: `"T1"` left, module name right (normal `drawHeader`, not inverted)
- Bank bar: 4 segments, `bankIndex = chainIndex`, `bankCount = 4` — reuses `drawBankBar`
- Knob rows: first page of active component's params via existing `drawKnobRow`

**Empty slot (no module loaded):**
- Header: `"T1"` left, slot label (`"MIDI FX"` / `"SYNTH"` / `"FX 1"` / `"FX 2"`) right
- Center of screen: `"Click jog to add module"`

---

## Bottom Jog Toast

A thin inverted bar at y=57..63 (7px strip at the bottom of the 64px screen). Uses the main font (`fontPrint`, FONT_HEIGHT=5). Does not overlap the knob rows.

Shown while jog wheel is physically touched (NoteOn note = `MoveJogTouch`), hidden on release. `MoveJogTouch` is a new constant declared as the note immediately after `MoveKnob8Touch` (note 8).

Toast text per view:
- `VIEW_CHAIN`: `"SHIFT+CLICK swap  CLICK open"` (trimmed to fit if needed)
- `VIEW_KNOBS`: `"CLICK: swap module"`

The existing top-header param-name toast (knob touch) is unchanged.

---

## State Changes

### `appState` (src/app/state.ts)

Remove `model: Model | null`. Add:
```typescript
chainIndex:   number    // 0–3, active chain position (init = 1 for Synth)
chainModels:  Model[]   // 4 models, created at init
jogTouched:   boolean   // true while jog wheel is held
browseOrigin: number    // VIEW_CHAIN or VIEW_KNOBS
```

### `browserState` (src/browser/state.ts)

Add:
```typescript
componentKey: string   // which chain slot is being browsed
```

### `ModelState` (src/model/state.ts)

Add:
```typescript
componentKey: string   // 'synth' | 'fx1' | 'fx2' | 'midi_fx1'
```

### `ViewModel` / `ToastState` (src/types/viewmodel.ts)

Add to `ViewModel`:
```typescript
jogToast: string | null   // bottom toast text, null when not shown
```

---

## Files

### New
- `src/chain/config.ts` — `CHAIN_SLOTS` array (key, label, paramPrefix, moduleIdKey, scanDir)
- `src/renderer/chain-view.ts` — `renderChainView(vm, chainIndex, empty, jogTouched)`

### Modified
- `src/model/state.ts` — add `componentKey`
- `src/model/hierarchy.ts` — parameterize all `'synth:'` / `'synth_module'` lookups
- `src/model/store.ts` — parameterize `'synth:'` in poll/apply/refresh
- `src/model/index.ts` — `createModel(slot, componentKey)`
- `src/app/state.ts` — swap `model` → `chainModels`, add `chainIndex`, `jogTouched`, `browseOrigin`
- `src/app/init.ts` — create 4 models, default `chainIndex = 1`
- `src/app/tick.ts` — tick only active model; dispatch `renderChainView` for `VIEW_CHAIN`
- `src/midi/router.ts` — handle jog touch (note 8), chain view navigation, updated back/click/shift logic
- `src/browser/handler.ts` — scan dir from `componentKey`; set/use `browseOrigin`
- `src/browser/state.ts` — add `componentKey`
- `src/types/schwung.d.ts` — declare `MoveJogTouch`
- `src/types/viewmodel.ts` — add `jogToast` to `ViewModel`
