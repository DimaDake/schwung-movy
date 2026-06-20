# Mr Drums: per-focused-pad knobs & automation

**Date:** 2026-06-20
**Scope:** `movy/` only — TypeScript UI + the `mrdrums.json` layout. **No change to
the Mr Drums module** (`drums/mrdrums`). No change to the Rust seq engine.

---

## Problem

In Mr Drums, knob values, changes, and per-step automation can land on the wrong
drum pad — or on several pads at once:

1. **Automation leaks across pads.** Movy maps an automation lane to the param
   *alias* `synth:pad_vol`. Mr Drums rewrites that alias to the concrete pad key
   `p<NN>_vol` using its internal `ui_current_pad` *at the moment the value
   arrives*. With `ui_auto_select_pad` defaulting **"on"**, the DSP moves
   `ui_current_pad` to each pad as it plays, so a lane's CC hits whatever pad is
   sounding — not the pad that was edited.
2. **Automation appears on other pads' steps.** Lane lock data is keyed only by
   lane (the alias), so viewing a different pad reuses the same lane/locks — the
   dot never clears and the value bleeds onto un-automated steps of other pads.
3. **Normal knob edits hit the wrong pad.** A plain knob turn writes the
   `pad_vol` alias, which the DSP applies to its (possibly drifted)
   `ui_current_pad`. Movy reads the focused pad only once at load and never polls,
   so what you see and what you edit can diverge during playback.

## Goal

Knob **values, edits, and automation** apply only to the **focused** drum pad.
Focus changes **only on a manual pad press**. Switching the focused pad makes the
automation dot disappear and shows only the selected pad's parameter/automation.

---

## Design

### Core idea: address pad params by concrete key, owned by movy

Mr Drums already exposes every per-pad parameter as a real, ranged key
(`p01_vol`…`p16_vol`, `p03_pan`, …). Both **read** (`get_param`,
`mrdrums_plugin.cpp:880`) and **write** (`set_param`, `:796`) resolve concrete
keys through `find_pad_param`, **independent of `ui_current_pad`**.

Therefore movy will address **all** pad-scoped params by their concrete
`p<NN>_<suffix>` key, derived from a **movy-owned focused-pad** variable — never
from the DSP's `ui_current_pad`. This makes correctness independent of the DSP's
auto-select behavior: the DSP may drift its own `ui_current_pad` freely; movy
ignores it.

This is the key refinement over the original two-part plan: routing **every** I/O
(value read-back, normal edit, automation lane target) through the concrete key
*absorbs* the need to disable auto-select for correctness. `ui_auto_select_pad`
is no longer load-bearing.

### Component 1 — movy-owned focused pad

`drumCurrentPad` becomes movy's authoritative selection ("which pad am I
editing"):

- Defaults to `1` at load. **Stop seeding it from `ui_current_pad`**
  (`model/hierarchy.ts:52-55`) — that coupling is what let the DSP's drifted
  value leak into movy.
- Updated **only** by a manual pad press (`keyboard/drum-handler.ts` →
  `drumPadOn`).
- Never re-read from the DSP during operation.

`drumPadOn` keeps issuing `shadow_set_param(slot, 'synth:ui_current_pad', N)` on a
manual press. This is no longer needed for param I/O, but it keeps the DSP's own
notion aligned for one thing movy doesn't own: the **sample browser live-preview**
auditions `ui_current_pad`.

### Component 2 — concrete I/O key resolution

Define one helper that maps an alias param to the I/O key:

```
paramIoKey(s, p) =
  isPadScoped(s, p) ? concretePadKey(s.drumCurrentPad, p.key) : p.key
```

- `isPadScoped(s, p)` — true when the active module is a drum module with
  `drum.padScoping` configured **and** the param belongs to a `padSpecific: true`
  bank (`BankConfig.padSpecific`, already present).
- `concretePadKey(pad, aliasKey)` — built from a **fully general, config-declared
  template** so no key-format literals live in movy code:
  - `suffix = aliasKey.slice(aliasPrefix.length)` (`pad_vol` → `vol`)
  - `concreteKeyTemplate.replace('{pad}', zeroPad(pad, padDigits)).replace('{suffix}', suffix)`
  - For Mr Drums (`concreteKeyTemplate: "p{pad}_{suffix}"`, `padDigits: 2`,
    `aliasPrefix: "pad_"`): pad 3 + `pad_vol` → `p03_vol`. A different module with
    a different scheme supplies a different template — **movy parses neither `p`
    nor `_` nor `pad_`; they are all data.**

Route the three I/O sites in `model/store.ts` through `paramIoKey` (currently all
use `s.componentKey + ':' + p.key`):

- `applyKnobDelta` — read-seed (`:55`) and write (`:71`).
- `refreshOneParam` — read-back (`:91`, `:99`).
- `knobParamInfo` — the `key`/automation target the seq layer assigns.

Param **labels, ranges, types, render style** continue to come from the alias
definition (config + `chain_params`). Only the I/O key is rewritten.

### Component 3 — automation lane target = concrete key

`KnobParamInfo` carries the concrete I/O key, so the seq layer assigns lanes
against `synth:p03_vol`:

- `midi/router.ts:124` `knob_<lane+1>_set = info.target + ':' + <ioKey>`.
- `seq/automation.ts` — `assignLane`, `laneForParam`, base-sync, and
  `clearLaneForKnob` all key off the concrete `targetParam` (mostly already
  `targetParam`-based; the caller now passes the concrete key).

A lane therefore belongs to exactly one (pad, param). Automating Vol on pads 1, 3,
5 consumes 3 of the 8 lanes per track. **Lane budget: keep 8, assign on demand;
when the pool fills, the existing `autoPoolFull` toast fires.** (Decided — no
engine expansion in this change.)

### Component 4 — dot/value scope to focused pad (no renderer change)

`buildAutomationView`'s `laneForKey(aliasKey)` (`app/tick.ts:58`) becomes
pad-aware: resolve `aliasKey` + `drumCurrentPad` → concrete key, then match the
lane by `targetParam`. A lane belonging to a different pad matches no key on the
current page, so its dot/value don't render. Switching the focused pad re-resolves
→ the dot disappears and only the selected pad's automation shows. The existing
per-key matching in `model/viewmodel.ts` does the filtering unchanged.

### Component 5 — remove the last Mr-Drums-specific string (`g_` → config)

`automatable` is currently computed with the literal `!p.key.startsWith('g_')`
(the `g_` global-param naming convention) in **two** places —
`model/store.ts:40` and `model/viewmodel.ts:55` — a Mr-Drums-ism *and* a
duplication.

Replace it with a config-driven flag:

- `BankConfig` gains `global?: boolean`. The "Global" bank in `mrdrums.json` sets
  it; synth banks (plaits, wurl) omit it, so their numeric params stay
  automatable exactly as today.
- When expanding `KnobSlot` → `KnobParam` at hierarchy build, stamp each param's
  `automatable` once (`numeric && validRange && !bank.global`) and store it on
  `KnobParam`. Both read sites use the stamped value — removes the `g_` literal
  and the duplication in one move.

After this, **no movy `.ts` file contains any Mr-Drums-specific literal** (see
"No movy code specific to Mr Drums" below).

### Component 6 — `ui_auto_select_pad` (secondary robustness)

Not required for correctness. Set `ui_auto_select_pad = "off"` once at load via a
generic `setOnLoad` map on the module config, for one reason only: so the DSP
doesn't drift `ui_current_pad` away from the focused pad between presses, keeping
the **sample-browser live-preview** on the focused pad. Clearly secondary — if
dropped, automation/edit correctness is unaffected.

---

## Config changes — `src/modules/mrdrums.json`

```jsonc
"drum": {
  "padCount": 16,
  "padNoteStart": 36,
  "rawMidi": false,
  "currentPadParam": "ui_current_pad",
  "padScoping": {
    "aliasPrefix": "pad_",
    "concreteKeyTemplate": "p{pad}_{suffix}",
    "padDigits": 2
  }
},
"setOnLoad": { "ui_auto_select_pad": "off" },
"banks": [
  /* ... */
  { "name": "Global", "global": true, "rows": [ /* g_* params */ ] }
]
```

Every Mr-Drums-specific value — the alias prefix, the concrete key shape, the
auto-select param name, which bank is global — lives in this JSON. Movy code reads
them generically.

Types in `src/types/param.ts`:
- `DrumConfig.padScoping?: { aliasPrefix: string; concreteKeyTemplate: string; padDigits: number }`
- `ModuleConfig.setOnLoad?: Record<string, string>`
- `BankConfig.global?: boolean`
- `KnobParam.automatable: boolean` (stamped at build)

---

## No movy code specific to Mr Drums

A goal of this change: **all Mr-Drums knowledge lives in `mrdrums.json`; no movy
`.ts` file hardcodes a Mr-Drums name, prefix, or key shape.** This keeps the door
open for the future where each module ships its own JSON layout (no movy edit to
add a drum module).

Audit of every Mr-Drums-specific reference in `src/**/*.ts` and its resolution:

| Reference | Today | After |
|---|---|---|
| `!key.startsWith('g_')` (`store.ts:40`, `viewmodel.ts:55`) | hardcoded global convention, duplicated | `BankConfig.global` flag; `KnobParam.automatable` stamped once |
| concrete pad key shape (this change) | — | `padScoping` template in JSON; movy substitutes tokens only |
| `ui_auto_select_pad`, `ui_current_pad` | — / `currentPadParam` | `setOnLoad` + `currentPadParam`, both JSON values |
| `loader.ts` registers `mrdrums.json` | manifest entry (same as every module) | unchanged — this is the layout registration, not module logic |
| `file-validate.ts` / `hierarchy.ts` "mrdrums" mentions | comments only; logic uses `fileRequireContains` | unchanged (no code coupling) |

Result: the only place the string "mrdrums" appears in movy `.ts` is the
`loader.ts` manifest line and example comments — no behavioral coupling.
**Auto-discovery of per-module JSON is explicitly out of scope** (future work);
the manifest stays for now.

## Migration

Automation saved before this change is keyed to the alias and will not map to the
concrete scheme — treated as fresh (no migration shim). Acceptable for a tool
mid-development.

---

## Files touched

| File | Change |
|---|---|
| `src/modules/mrdrums.json` | `drum.padScoping`, `setOnLoad` |
| `src/types/param.ts` | `DrumConfig.padScoping`, `ModuleConfig.setOnLoad`, `BankConfig.global`, `KnobParam.automatable` |
| `src/model/state.ts` / `hierarchy.ts` | `drumCurrentPad` default 1, drop `ui_current_pad` seed; stamp `KnobParam.automatable` from `bank.global`; pad-scoping metadata |
| `src/model/store.ts` | `paramIoKey` helper; route read/write/info through it; read `p.automatable` (drop `g_` literal) |
| `src/model/viewmodel.ts` | read `p.automatable` (drop `g_` literal); expose alias for display |
| `src/seq/automation.ts` | lane assign/lookup/base-sync via concrete `targetParam` |
| `src/midi/router.ts` | `knob_N_set` target = concrete key |
| `src/app/tick.ts` | `buildAutomationView.laneForKey` resolves alias+focusedPad→concrete |
| `src/chain/config.ts` (or model) | apply `setOnLoad` at module load |

---

## Testing

Per project rules — local suites first, then device (device verification is
mandatory for automation: mock tests miss CC routing + persist/read-back).

- `browser-test/logic.mjs` — `paramIoKey`/`concretePadKey` resolution; lane assign
  & `laneForKey` by concrete key; switching `drumCurrentPad` re-resolves the lane
  (dot present → absent). **Genericness proof:** drive `concretePadKey` with a
  synthetic `padScoping` (e.g. `aliasPrefix: "v_"`, template `"voice{pad}.{suffix}"`,
  `padDigits: 3`) and assert the output — confirms no `p`/`_`/`pad_` is baked into
  movy code. Also assert `automatable` derives from `bank.global`, not a `g_`
  string (a numeric param in a `global: true` bank is non-automatable regardless of
  key name).
- `browser-test/app-loop.mjs` — end-to-end: automate pad 1, switch to pad 2, lock
  absent; normal edit on pad 2 writes `p02_*`.
- `browser-test/screenshot.mjs` — new baseline: dot on focused pad, gone after a
  pad switch (`--update` to regenerate).
- `browser-test/perf.mjs` — no regression in fill_rect / IPC counts.
- Device (`scripts/test.sh`, plus a focused per-pad automation check): CC lands on
  the correct pad; concrete read/write round-trips; report **DEVICE OFFLINE** in
  CAPS if unreachable.

---

## Out of scope

- Expanding the engine's 8-lane-per-track budget.
- Restoring `ui_auto_select_pad` to "on" when movy closes.
- Migrating pre-existing (alias-keyed) automation data.
