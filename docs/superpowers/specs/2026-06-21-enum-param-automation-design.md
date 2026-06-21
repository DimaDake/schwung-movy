# Enum Param Automation Design

**Date:** 2026-06-21

## Goal

Allow `enum` params to be assigned to automation lanes and record per-step locks, exactly like `float`/`int` params. `file` params and `preset` params remain non-automatable.

## What changes

### 1. `automatable` flag — `src/model/hierarchy.ts`

Two locations set this flag; both need `|| type === 'enum'` added:

**Config path (line ~130):**
```typescript
automatable: (type === 'float' || type === 'int' || type === 'enum') && max > min && !bank.global,
```

**Generic no-config path (line ~332):**
```typescript
automatable: (type === 'float' || type === 'int' || type === 'enum') && max > min && !key.startsWith('g_'),
```

Preset params (`presetParam`) keep `automatable: false` hardcoded. File params (`type === 'filepath'`) keep `automatable: false` hardcoded.

### 2. Delta scaling — `src/seq/automation.ts`

`handleAutomationKnob` accumulates deltas on a 0-127 scale. A raw delta of 1 against 0-127 for a 4-option enum would require ~42 turns per option — too slow. We pre-scale to match the normal `ENUM_DELTA_DIV = 4` feel:

```typescript
// At the top of handleAutomationKnob, before accumLive:
const effDelta = (info.type === 'enum' && info.max > info.min)
    ? Math.max(Math.sign(delta), Math.round(delta * 127 / info.max / ENUM_DELTA_DIV))
    : delta;
// use effDelta in place of delta throughout accumLive / aset
```

Import `ENUM_DELTA_DIV` from `../model/constants.js`.

**Math check:**
- 4-option enum (max=3): `effDelta = max(1, round(1 * 127/3/4)) = max(1, 11) = 11` → ~12 turns full range, ~3 turns/option ≈ ENUM_DELTA_DIV feel.
- 2-option enum (max=1): `effDelta = max(1, round(1 * 127/1/4)) = max(1, 32) = 32` → ~4 turns full range.
- 128-option enum (max=127): `effDelta = max(1, round(1 * 127/127/4)) = max(1, 0) = 1` → 127 turns full range (1 option/turn — fine for large enums). The `Math.sign` guard ensures a non-zero delta always produces at least ±1 movement.

### 3. Enum square display during held-step — `src/model/viewmodel.ts`

`enumIndex` is computed from the base value `s.knobValues[gi]`. Under held-step or live automation, `displayValue` already shows the locked option name (via `formatValue`), but `enumIndex` — used by the enum square renderer — still shows the base option. Fix: override `enumIndex` from the denormalized held/live value.

```typescript
let enumIdx = (p.type === 'enum' && typeof v === 'number') ? Math.round(v) : 0;
// ... later, inside the held / live branches:
if (auto.held && lane >= 0 && auto.heldValues.has(lane)) {
    const hv = auto.heldValues.get(lane) as number;
    touched = true;
    displayValue = formatValue(p, hv);
    arcValue = renorm(hv);
    if (p.type === 'enum') enumIdx = Math.round(hv);   // ← add
} else if (!auto.held && lane >= 0 && auto.liveValues.has(lane)) {
    const lv = auto.liveValues.get(lane) as number;
    touched = true;
    displayValue = formatValue(p, lv);
    arcValue = renorm(lv);
    if (p.type === 'enum') enumIdx = Math.round(lv);   // ← add
}
```

`enumIdx` is used after this block, so it must be `let` not `const`.

### 4. Tests — `browser-test/logic.mjs`

Add cases:
- Enum param with ≥2 options has `automatable: true`.
- Enum param with 1 option (max=0) has `automatable: false` (max > min guard).
- `handleAutomationKnob` with a 4-option enum: 4 raw delta-1 turns accumulate to at least one option advance on the 0-127 scale (i.e., `effDelta` rounds to ≥1 per ENUM_DELTA_DIV turns).
- `buildViewModel` with a held-step lock on an enum lane: `enumIndex` in the ParamVM matches the locked option, not the base.

## What does NOT change

- Engine (`engine/`): no changes. The engine already stores 0-127 per lock and doesn't know param types.
- Lane assignment, `norm7`/`denorm7`, `aset`/`asetr` commands: all unchanged.
- Preset params: `automatable: false` stays.
- File params: `automatable: false` stays.
- The enum overlay (long-press): unaffected; it only opens in normal (non-step-auto) mode.

## Scope exclusions

Preset-type params (`renderStyle === 'preset'`) are excluded even though they are typed as `enum` internally. The `automatable: false` hardcoded on `presetParam` already enforces this.

## Testing

Local: `npm test` (logic + app-loop + screenshot + perf).
Device: `./scripts/test.sh` — the existing param-automation e2e validates lane assignment and CC routing; enum params are exercised if a module config with an enum param is active.
