# Generic Module Multi-Level Parameter Pages — Design Spec

**Date:** 2026-06-07  
**Status:** Approved  
**Scope:** `movy/src/` — hierarchy parsing, model state, viewmodel, renderer, shorten

---

## Problem

When a module has no custom movy JSON config, `hierarchy.ts` reads only the `root` level of `ui_hierarchy` and shows a single page of 8 knobs. Modules like OB-Xd have 11 additional parameter levels (Global, Osc1, Osc2, Filter, etc.) that are silently ignored.

Additionally:
- The preset selector is never shown even when exposed via `list_param`
- Single-word parameter labels longer than 5 chars collapse to a single letter (e.g. "Cutoff" → "C")

---

## Solution

Three targeted changes to the no-config fallback path in `hierarchy.ts`, with minimal downstream changes.

---

## 1. Multi-Level Parameter Pages

### Parsing

`ui_hierarchy.levels` is a dict of named levels. The `root` level's `params` array contains entries like `{"level": "global", "label": "Global"}` that declare which sub-levels exist and their display labels.

**Algorithm (no-config path only):**

1. Build a `levelLabel: Map<string, string>` from `root.params` entries that have a `level` key.
2. Process root level first → "Main" page (using `root.knobs`).
3. For each `{level, label}` in `root.params` (in order):
   - Look up `levels[level]`
   - Skip if the level has no `knobs` array (navigation-only: those with `items_param` or `select_param`)
   - Take `level.knobs` in slices of 8
   - If slices > 1: name pages `"Label - 1"`, `"Label - 2"`, etc.
   - If exactly 1 slice: name page with the label as-is

### State

Add `bankNames: string[]` to `ModelState` (initialized to `[]`). Populated by `loadHierarchy` alongside `knobParams`.

`viewmodel.ts` uses `s.bankNames[s.knobPage]` as the primary source for `bankName`, falling back to the existing `moduleConfig.banks[page].name` logic, then `"Main"` / `"Page N"`.

### KnobParam construction for generic levels

Use `cpMap` (from `chain_params`) for type/min/max/step. Fall back to the level's `params` array entries for label. Key is the string from `knobs[]`.

---

## 2. Preset Selector

### Detection

When `root` has both `list_param` and `count_param`, a preset selector exists.

**Placement:**
- `root.knobs.length < 8` → prepend preset param to root.knobs (appears on Main page)
- `root.knobs.length === 8` → add a dedicated **"Preset"** page as the first page (before Main), containing only the preset knob at slot 0 (7 remaining slots null)

### Name Availability Check

At load time, attempt to collect all preset names in order:

1. `shadow_get_param(slot, "synth:preset_names")` → if non-null, parse as JSON `string[]`
2. Else, probe `shadow_get_param(slot, "synth:preset_name_0")` → if non-null, iterate `0..count-1` collecting `shadow_get_param(slot, "synth:preset_name_N")`

### KnobParam for Preset

Always `type: 'enum'`. Min=0, max from `shadow_get_param(slot, "synth:" + count_param)` cast to int minus 1.

| Names available? | `options`   | `nameKey`        | Overlay |
|------------------|-------------|------------------|---------|
| Yes              | `allNames`  | `undefined`      | Yes (long-press, isLongEnum because count > 6) |
| No               | `null`      | `"preset_name"`  | No (isLongEnum requires options.length > 6) |

### New field: `KnobParam.nameKey?: string`

When set, `buildViewModel` fetches the display value via `shadow_get_param(s.activeSlot, "synth:" + p.nameKey)` instead of `formatValue`. This is only used for the no-names preset case.

### Visual rendering

Both cases render as an enum square (not an arc knob) because `type === 'enum'`. The enum delta accumulator (`ENUM_DELTA_DIV`) applies in both cases, giving slow scrolling through presets.

---

## 3. Label Shortening Fix

**File:** `src/renderer/shorten.ts`

**Current bug:** `autoShorten("Cutoff", 5)`:
1. words = `["CUTOFF"]`, words[0].length = 6 > 5 → skip
2. acronym = `"C"` → length 1 ≤ 5 → returns `"C"` ✗

**Fix:** Add a single-word early exit before the acronym step:

```typescript
if (words.length === 1) return words[0].substring(0, maxChars);
```

Results: `"CUTOFF"` → `"CUTOF"`, `"RESONANCE"` → `"RESON"`, `"PORTAMENTO"` → `"PORTA"`.

Multi-word params are unaffected. "F Attack" → `"F"` (existing behaviour, first word ≤ maxChars — acceptable since "F" is a deliberate prefix in the module's own naming).

---

## Files Changed

| File | Change |
|------|--------|
| `src/types/param.ts` | Add `nameKey?: string` to `KnobParam` |
| `src/model/state.ts` | Add `bankNames: string[]` |
| `src/model/hierarchy.ts` | Multi-level parsing + preset injection |
| `src/model/viewmodel.ts` | Use `bankNames`, resolve `nameKey` for display |
| `src/renderer/shorten.ts` | Single-word truncation fix |

No changes to renderer, overlay, or the existing custom-config path.

---

## Constraints & Edge Cases

- **Custom config takes priority:** If `loadModuleConfig(moduleId)` returns a config, the existing path runs unchanged. The new logic only applies to the no-config fallback.
- **Level with 0 knobs:** Skip silently (no page added).
- **preset_count returns null or 0:** Skip preset param entirely.
- **Preset names count exceeds count param:** Truncate to count.
- **bankNames length mismatch:** `viewmodel.ts` falls back to `"Page N"` for any index beyond bankNames.length.
- **Level label display:** Bank name is the raw level label string; the header renderer already truncates the module name if the bank name is wide. No additional shortening needed.
