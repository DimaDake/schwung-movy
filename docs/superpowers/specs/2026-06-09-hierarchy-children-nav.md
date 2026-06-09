# Hierarchy `children` Navigation — Design Spec

**Date:** 2026-06-09

## Problem

`hierarchy.ts` builds parameter banks from the `ui_hierarchy` JSON returned by
the DSP at runtime. It scans `root.params` for navigation entries (objects with a
`level` field) to discover sub-levels. For modules like moog, the root level has
an empty `params` array and delegates navigation via a `children` field:

```json
"root": {
  "children": "main",
  "params": [],
  "knobs": ["cutoff", "resonance", ...],
  "list_param": "preset",
  "count_param": "preset_count",
  "name_param": "preset_name"
},
"main": {
  "params": [
    {"level": "osc1",     "label": "Oscillator 1"},
    {"level": "osc2",     "label": "Oscillator 2"},
    {"level": "filter",   "label": "Filter"},
    {"level": "filt_env", "label": "Filter Env"},
    ...10 total
  ]
}
```

The `children` field is currently ignored. Result: only a "Main" bank appears;
all 10 named sub-levels are silently dropped.

## Scope

This pattern is specific to moog among current device modules. All other
navigation patterns already work:

| Pattern | Modules | Status |
|---|---|---|
| Flat root (no sub-levels) | plaits, wurl, braids, dexed | ✓ |
| Root nav (`root.params` has level entries) | obxd, forge, freak, mrdrums | ✓ |
| **Delegated nav (`root.children` → nav level)** | **moog** | **✗ fix here** |
| Nav-only levels (recursive drill-down) | freak | ✓ |
| Preset selector (`list_param` + `count_param`) | obxd, moog | ✓ (stays on root) |

## Solution

When `root.params` has no navigation entries (no objects with a `level` field),
follow `root.children` to find the level that does, and use it as the navigation
source. Everything else — preset detection, Main bank from root.knobs —
continues to read from `root` directly.

### Definition: navigation source level (`navLevel`)

```
navLevel =
  if root.params has any {level: ...} entry → root
  else if root.children names a level with {level: ...} params → that level
  else → root (no sub-levels found, same as today for flat modules)
```

`levelLabel` (the map from level key → display label) and sub-level expansion
are both sourced from `navLevel.params`, not `root.params`.

### Expected banks for moog after fix

| # | Bank | Source |
|---|---|---|
| 0 | Preset | `root.list_param` preset detection (14 presets) |
| 1 | Main | `root.knobs` |
| 2 | Oscillator 1 | `osc1.knobs` via `main.params` |
| 3 | Oscillator 2 | `osc2.knobs` |
| 4 | Oscillator 3 | `osc3.knobs` |
| 5 | Oscillator 4 | `osc4.knobs` |
| 6 | Mixer | `mixer.knobs` |
| 7 | Filter | `filter.knobs` |
| 8 | Filter Env | `filt_env.knobs` |
| 9 | Amp Env | `amp_env.knobs` |
| 10 | LFO | `lfo.knobs` |
| 11 | Performance | `performance.knobs` |

12 banks total, using the module author's own labels.

## Changes

### `src/model/hierarchy.ts`

1. Add `children?: string` to `HierLevel` interface.
2. After building `rootLevel`, compute `navLevel`: check whether `root.params`
   contains any `{level: ...}` entry; if not and `root.children` is set, use
   `allLevels[root.children]` as `navLevel`.
3. Replace both uses of `rootLevel.params` in the nav section (levelLabel
   population and `addLevelOrExpand` loop) with `navLevel?.params`.

No other logic changes. Preset detection, Main bank, and the
`addLevelOrExpand` recursive expander are untouched.

### `src/modules/moog.json` — delete

The generic path now produces the correct layout with the author's names.
The custom config was added solely because the generic path was broken.

### `src/modules/loader.ts`

Remove the `moog` import and `CONFIGS['moog']` entry.

### `browser-test/mock-synth.mjs`

- Update `moog` mock: remove `synth_module` key (use generic path, not custom
  config). Update `ui_hierarchy` to the runtime format with `root.children:
  "main"` and the 10 named sub-levels.
- Keep `chain_params` as-is (provides type/min/max metadata).

### `browser-test/logic.mjs`

Update moog test block:
- `bankCount = 12` (Preset + Main + 10 sub-levels)
- First bank name = "Preset"
- Bank 2 name = "Oscillator 1"
- Bank 6 name = "Mixer"
- Bank 11 name = "Performance"
- Osc wave params still render as `type: "int"` (chain_params has no options
  for osc3/osc4 wave; this is acceptable — values work, display shows 0–3)

## What is not in scope

- Chain_params overflow (appending banks for params absent from hierarchy):
  separate concern, not needed for any current module.
- `items_param` / `select_param` / `visible_if` / `navigate_to`: native-UI
  constructs, correctly ignored by movy today.
- Fixing enum options for osc3/osc4 wave params: requires DSP-side change to
  add options to chain_params; not a movy concern.
