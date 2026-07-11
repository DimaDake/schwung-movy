# Track-chain LFO page — Design

Date: 2026-07-11

Add a new last page to movy's track chain: **LFO**. It exposes the current
track's (schwung slot's) two slot LFOs. The chain page shows LFO 1; jog-click
drills into a 2-bank detail view (LFO 1 / LFO 2). Drill-down and per-track nav
state preservation mirror how module chain slots behave.

## Background (schwung slot LFOs)

- Each schwung slot has **2 slot LFOs**, run by the chain-host C engine in
  `render_block`. Config is pushed via `shadow_set_param(slot, "lfoN:KEY", val)`
  where `N` is 1 or 2. movy runs inside schwung's JS context, so these calls are
  directly available. **No C/engine changes are required.**
- Param keys (per LFO):
  - `target` (component key string, e.g. `synth`, `fx1`, `fx2`, `midi_fx1`,
    `lfo2`; `""` clears) + `target_param` (param key within target)
  - `enabled` (`0`/`1`) — active = enabled AND valid target
  - `shape` (index 0–5: Sine/Tri/Saw/Square/S&H/Swishy)
  - `polarity` (0/1 = Unipolar/Bipolar) — surfaced as **Mode**
  - `sync` (0/1 = Free/Sync)
  - `rate_hz` (float 0.1–20.0, used when Free)
  - `rate_div` (index 0–26 into the division table, used when Sync)
  - `depth` (float −1..1)
  - `phase_offset` (float 0..1, displayed 0–360°)
  - `retrigger` (0/1) — engine resets phase on first note-on of a phrase
- **Modulation-target gating:** schwung has *no* dedicated "modulatable" flag.
  The C runtime (`chain_mod.c`) accepts any `target:param` (defaults unknown
  params to float 0..1). The only gate is schwung's picker, which lists params
  from each component's `chain_params` JSON filtered to `float`/`int`/`enum`.
  movy mirrors exactly this filter — nothing more.

## Architecture — LFO as a virtual 5th chain slot

Add a 5th entry to `CHAIN_SLOTS` (`{ componentKey: 'lfo', label: 'LFO', … }`),
backed by a **Model-conforming object** `createLfoModel(track)` stored at
`trackModels[track][4]`. It emits the standard `ViewModel`, so all rendering is
shared and navigation reuses the existing machinery:

- **Chain page** (`VIEW_CHAIN`, bank-bar segment 5) renders LFO 1's 8 params via
  the existing `renderChainView` — knobs are live/editable, like a module chain
  page.
- **Jog-click drills** into `VIEW_KNOBS`, rendering the same model with **2
  banks**: bank 0 = LFO 1, bank 1 = LFO 2. Jog / ←→ scroll banks via
  `changePage`.
- **Per-track nav state** (bank + chain slot) is preserved automatically because
  it lives in the per-track model + `trackChainIndex`, identical to modules.

The LFO model is bespoke internally (custom read/write to `lfoN:*`, special
widgets) but conforms to the `Model` interface (stubbing automation/drum/file
methods) so it plugs into `trackModels` and the router/tick plumbing unchanged.
Unlike real slots it can't be swapped — the router skips the module browser for
this slot.

## Parameters & widgets (8 params = one bank per LFO)

Grid layout (2 rows × 4), order matches the spec:

| Pos | Param     | Key(s)                    | Widget                    | Display / notes            |
|-----|-----------|---------------------------|---------------------------|----------------------------|
| 0   | Target    | `target` + `target_param` | enum **overlay**          | flat shortened list; auto-enables |
| 1   | Shape     | `shape` (0–5)             | enum **overlay**          | Sine/Tri/Saw/Square/S&H/Swishy |
| 2   | Mode      | `polarity` (0/1)          | enum inline (no overlay)  | `UNI` / `BI`               |
| 3   | Sync      | `sync` (0/1)              | enum inline (no overlay)  | `FREE` / `SYNC`            |
| 4   | Rate      | `rate_hz` / `rate_div`    | **arc** knob, dual-mode   | value under knob           |
| 5   | Depth     | `depth` (−1..1)           | **arc** knob              | `−100%…+100%`              |
| 6   | Phase     | `phase_offset` (0..1)     | **arc** knob              | `0–360°`                    |
| 7   | Retrigger | `retrigger` (0/1)         | **hbar** switch           | on/off                     |

All 8 params are `automatable: false`.

Notes:
- **Shape** uses an overlay even though it has only 6 options (the generic
  overlay threshold is `>6`). The LFO model forces the overlay for shape.
- **Depth** is a normal arc knob (not a vbar): normalizedValue =
  `(v − min)/(max − min)`, so −1→empty, 0→half, +1→full; display as signed %.

## Data flow

- All reads/writes target the **current track's** slot:
  `shadow_set_param(track, 'lfo1:'+key, …)` / `'lfo2:'+key`.
- **Auto-enable:** selecting a real Target sets `target`+`target_param` and
  `enabled=1`; selecting **None** clears both and sets `enabled=0`. The
  `enabled` param is never shown as a knob.
- **Target list** is rebuilt each time the target overlay opens: scan loaded
  components (`synth`, `fx1`, `fx2`, `midi_fx1`, `midi_fx2`) via
  `shadow_get_param(track, comp+':chain_params')`, keep `float`/`int`/`enum`
  params, plus the other LFO's params, prepend **None**. Labels are formed as
  `Comp:Param` and shortened to fit the overlay width.
- Values are read from `lfoN:*` on model load / drill-in and are movy-owned
  thereafter (a light re-read on entering the page keeps them fresh if schwung's
  own UI changed them).

## Rate dual-mode scaling

- **Free:** `rate_hz` 0.1–20 Hz. Perceptually-scaled detents (finer at low Hz)
  so the knob is usable across the range; arc fill over 0.1–20; display
  `"2.0 Hz"`.
- **Sync:** `rate_div` index 0–26, 1 index/detent; arc fill = `div/26`; display
  the division label (`"1/4"`, `"2bar"`, …).
- Toggling Sync swaps which underlying param the Rate knob drives and the value
  shown under it.

## Navigation

- `chainIndex` upper bound changes `3` → `CHAIN_SLOTS.length − 1` (4) in the
  router's chain-nav clamps (jog rotation + ←/→). Master-chain clamps
  (`masterChainIndex`, 0–3) are left untouched.
- On the LFO slot:
  - `VIEW_CHAIN` jog-click drills to `VIEW_KNOBS` (no browser).
  - Shift+click does **not** open a browser (no module to swap).
  - `VIEW_KNOBS` jog-click does **not** open a browser.
  - Back behaves as today (`VIEW_KNOBS`→`VIEW_CHAIN`, `VIEW_CHAIN`→exit).
- Chain-page empty/toast text is customized so the LFO slot never shows
  "CLICK JOG: ADD MODULE" / "SHIFT+CLICK SWAP".
- `drawBankBar` already computes segment width for any count, so 5 (or 6 with
  the step page) segments render without change.

## Files

New:
- `src/lfo/params.ts` — the 8 param definitions, shape/division name tables, and
  the target-list builder (`chain_params` scan + shorten).
- `src/lfo/model.ts` — `createLfoModel(track)` implementing the `Model`
  interface (2 banks; custom knob-delta, enum overlays, auto-enable, rate
  dual-mode; automation/drum/file methods stubbed).

Edit:
- `src/chain/config.ts` — add the LFO `CHAIN_SLOTS` entry + an `isLfoSlot`
  (or `LFO_CHAIN_INDEX`) helper.
- `src/app/init.ts` — build `trackModels[track]` as the 4 module models plus the
  LFO model at index 4.
- `src/midi/router.ts` — chain-index bounds `3`→`4`; skip the module browser on
  the LFO slot for both `VIEW_CHAIN` shift/empty and `VIEW_KNOBS` clicks.
- `src/renderer/chain-view.ts` — LFO-specific empty/toast text.

## Testing

- `browser-test/logic.mjs`: LFO param IO (`lfoN:*` set/get), target-list build +
  shorten + float/int/enum filter, auto-enable on Target / disable on None, rate
  dual-mode scaling + display, bank count / page nav, `automatable=false`.
- `browser-test/screenshot.mjs`: new baselines — LFO chain page (LFO 1), detail
  bank 0 (LFO 1) and bank 1 (LFO 2), target overlay, shape overlay
  (`--update` to generate).
- `browser-test/app-loop.mjs`: LFO page reachable via chain nav + drill in the
  full init/tick loop.
- Device: `./scripts/test.sh` after deploy (report in CAPS if `move.local`
  offline).

## Non-goals

- Not automatable (no schwung CC lanes exist for slot LFO params).
- No C/engine changes (the slot-LFO engine and retrigger already exist).
- `enabled` is hidden (driven implicitly by Target).
