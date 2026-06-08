# Recursive Sub-level Expansion in `loadHierarchy`

**Date:** 2026-06-08  
**Status:** Approved  
**Scope:** `src/model/hierarchy.ts` only

---

## Problem

The generic path in `loadHierarchy` (lines 185–192) only processes levels that have a direct `knobs` array. Navigation-only levels — those that contain `params` entries pointing to sub-levels but no `knobs` of their own — are silently skipped along with all of their children.

**MrHyde (`freak`) is the primary affected module:**
- `mod` level: no `knobs`, has 6 sub-level entries (pitch_mod, harmonics_mod, timbre_mod, cutoff_mod, assign1_mod, assign2_mod)
- `mod_sources` level: no `knobs`, has 6 sub-level entries (lfo, envelope, cycle_env, random, velocity, poly_aftertouch)
- Result: all 12 modulation parameter pages are invisible in movy today

---

## Goal

All parameters controllable via Schwung's `ui_hierarchy` must be reachable as movy knob pages. This is the baseline correctness requirement; per-module layout optimization is a future concern addressed by custom `movy_config.json` files.

---

## Design

### Change

Replace the linear `root.params` scan with a recursive helper `addLevelOrExpand`.

**Current behaviour (preserved):** If a level has `knobs`, emit those as a bank page — no change.

**New behaviour:** If a level has no `knobs` but has `params` entries with `.level` pointers, recurse into each pointed-to sub-level. Recursion is capped at depth 2 (root → nav-only → leaf) to guard against malformed hierarchy data.

### Bank page naming

Sub-level page names are prefixed with the parent navigation level's abbreviated name:

- Prefix = CamelCase transform of level key, capped at 6 chars
  - `mod` → `"Mod"`
  - `mod_sources` → `"ModSrc"`
  - `assign1_mod` → `"As1Mod"` (if it were a nav level)
- Format: `prefix + "/" + childLevel.name`
- Examples: `"Mod/Pitch"`, `"Mod/Assign 1"`, `"ModSrc/LFO"`, `"ModSrc/Cycling Envelope"`

Child level name comes from the `name` field on the level object (requires adding `name?: string` to the private `HierLevel` interface). Falls back to the label from the parent's params entry, then the level key.

### Existing behaviour unchanged

- Modules with direct-knobs levels (Plaits, Wurl, any future custom-config module) are unaffected — the `if (s.moduleConfig)` early-return path is untouched.
- Root.knobs "Main" page and subsequent sub-level pages that already have `knobs` continue to work exactly as before.
- Preset detection logic is untouched.

---

## Resulting MrHyde bank pages

| # | Name | Params | Source |
|---|------|--------|--------|
| 1 | Main | 8 | root.knobs |
| 2 | Main | 8 | main level (page 1) |
| 3 | Main - 2 | 1 | main level (page 2) |
| 4 | Filter | 3 | filter level |
| 5 | Mod/Pitch | 6 | pitch_mod |
| 6 | Mod/Harmonics | 6 | harmonics_mod |
| 7 | Mod/Timbre | 6 | timbre_mod |
| 8 | Mod/Cutoff | 6 | cutoff_mod |
| 9 | Mod/Assign 1 | 7 | assign1_mod |
| 10 | Mod/Assign 2 | 7 | assign2_mod |
| 11 | ModSrc/LFO | 5 | lfo |
| 12 | ModSrc/Envelope | 5 | envelope |
| 13 | ModSrc/Cycling Envelope | 6 | cycle_env |
| 14 | ModSrc/Random | 5 | random |
| 15 | ModSrc/Velocity | 1 | velocity |
| 16 | ModSrc/Poly Aftertouch | 1 | poly_aftertouch |
| 17 | Voice & Mix | 8 | voice |

17 banks total (vs 5 today). All navigable via jog wheel.

---

## Implementation scope

- **File:** `src/model/hierarchy.ts`
- **Interface change:** Add `name?: string` to private `HierLevel` interface
- **Function change:** Extract recursive helper, replace current linear scan
- **No other files touched**

---

## Future work

Per-module `movy_config.json` files can override the generic layout at any time (the `if (s.moduleConfig)` early-return already handles this). Encourage module authors to provide these for optimal page mapping.
