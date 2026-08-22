# Generic item selectors (bank / soundfont / cabinet pickers)

**Status:** implemented and device-verified 2026-08-22 (dexed, 33 banks).
**Motivating case:** dexed's `.syx` bank picker is unreachable in movy.

---

## 1. What schwung already declares

A hierarchy level may carry `items_param` + `select_param` instead of knobs
(`schwung/docs/MODULES.md:1027`). dexed emits, from `dx7_plugin.cpp:2132`:

```json
"banks": { "label": "SYX Banks",
           "items_param": "syx_bank_list",
           "select_param": "syx_bank_index",
           "children": null, "knobs": [], "params": [] }
```

reached by a nav entry in `root.params`: `{"level":"banks","label":"Choose Bank"}`.

- **`items_param` reads** a JSON array of `{label|name, index}`
  (`dx7_plugin.cpp:1641`). The host falls back `label ?? name ?? "Item N"`
  (`shadow_ui.js:10704`).
- **`select_param` is written** with the chosen `index` as a decimal string
  (`shadow_ui.js:14727`). dexed's setter resolves index → path, loads the
  `.syx`, and resets `preset` to 0 (`dx7_plugin.cpp:585`).
- `navigate_to` names the level the *native* list leaves you on. Not
  meaningful for a knob grid; movy ignores it.

**No path ever crosses the boundary.** The `path` lives in the DSP's own
struct (`dx7_plugin.cpp:396`), built from `<module_dir>/banks/`. movy sees
labels and integers only. This is an **enum whose options the module supplies**,
not a file param — midiverb's `unit_list` (Midiverb / Midifex / Midiverb II)
has no filesystem behind it at all.

### The fleet: 12 levels, 8 modules

| module | level | items → select | readable selection |
|---|---|---|---|
| dexed | banks | `syx_bank_list` → `syx_bank_index` | yes |
| obxd | banks | `fxb_bank_list` → `bank_index` | yes |
| sf2 | soundfont | `soundfont_list` → `soundfont_index` | yes |
| nam | models, cabs | `model_list`/`cab_list` → `model_index`/`cab_index` | yes |
| midiverb | unit | `unit_list` → `unit` | yes (also a chain_param enum) |
| sfz | jump | `instrument_list` → `bank_index` | probe |
| surge, clap | category_jump | `category_list` → `jump_to_category` | no — command |
| minijv | save_slot, load_expansion, expansions | … → `do_save_to_slot`, `load_expansion`, `jump_to_expansion` | no — commands |

All twelve declare `knobs: []` and `params: []`, which is exactly why movy
renders nothing for any of them: `hierarchy-walk.ts:105` only emits a page
when it has keys.

**Only the readable ones are in scope.** `jump_to_category` and
`do_save_to_slot` are write-only commands — minijv's *writes a patch to a
slot*. A cell that cannot read back its own selection has no state to show,
and movy's value-refresh cursor re-asserting one would fire it repeatedly.

---

## 2. Naming

movy already uses **bank** to mean a *knob page* (`s.bankNames`,
`s.bankGroups`, `numBanks()`). This feature is the **item selector**
internally — `items-param.ts`, `renderStyle: 'items'`. The user-facing label
is whatever the module declares ("SYX Banks", "Soundfont", "Cabinet").

---

## 3. Detection — `src/model/items-param.ts` (new)

Mirrors `preset-param.ts`. For each level carrying `items_param`:

1. Require `select_param`.
2. `JSON.parse(getParam(ck + ':' + items_param))` → non-empty array; take
   `label ?? name ?? "Item <index>"` and the numeric `index` of each entry.
3. `getParam(ck + ':' + select_param)` must parse as an integer that matches
   one of those `index` values.

All three hold → build a cell. Any fails → the level stays invisible, exactly
as today. **That third probe is the selectors-only rule** — no allowlist, no
name heuristics, and a module that later makes its selection readable gets a
cell with no movy change. Cost: two host reads per items level at hierarchy
load (dexed 1, nam 2, minijv 3).

Indices are taken from the entries, not from array position: the contract
carries an explicit `index` and nothing guarantees it is dense.

## 4. The param

```ts
{ key: select_param,
  label: level.label ?? level.name ?? navLabel ?? levelKey,
  shortLabel: null,
  type: 'enum', min: 0, max: items.length - 1, step: 1,
  options: labels,
  renderStyle: 'items',
  capturesModuleState: true,
  automatable: false }
```

`level.label` beats the nav label here: the level says "Soundfont", the nav
entry says "Choose Soundfont". `hierarchy-walk.ts:74` deliberately prefers nav
labels for *page* names; a single cell wants the noun.

`knobValues[gi]` holds the **position in the options array**, not the module's
`index` — so a sparse list still maps correctly. The write converts back.

Labels are used verbatim. dexed emits the raw filename with extension
(`ROM1A.syx`), obxd strips `.fxb` and forces "Factory" first
(`obxd_plugin.cpp:523`), midiverb emits plain names. That is what each module
calls its own items; movy does not normalise. The 5-char cell truncates from
the front, so extensions only ever appear in the 12-char overlay row.

## 5. Placement

`generic-pages.ts` prepends the selector key(s) immediately before `listParam`
in `rootKeys`, so the cell rides whichever path preset took — Main when there
is room, or the dedicated Preset page when Main is full. dexed lands at
exactly 8 (selector + preset + 6 knobs). nam has two selectors and no preset;
both prepend to Main in declaration order.

`buildConfigPages` is grid-driven and cannot auto-insert, so config modules
opt in with a slot `{"render": "items", "itemsLevel": "<level key>"}` — the
same shape as the existing `render: "preset"`. Only sfz is affected today,
and only if its `bank_index` probes readable.

## 6. Interaction — the file-param *gesture*, enum plumbing

`handleKnobRelease` already commits an enum overlay exactly once, wrapped in
`undoableEdit` with the `capturesModuleState` snapshot
(`model/index.ts:152-179`). That is the wanted behaviour for free. Two
changes:

- `handleKnobTouch` opens the overlay for `renderStyle: 'items'`
  **regardless of option count**. The existing `> 6` threshold would let a
  3-bank module load a `.syx` per detent.
- A raw delta arriving with no preceding touch must not reach `pendingDeltas`:
  `handleKnobDelta` pushes to `touchedSlots` without opening anything, so an
  items param needs an explicit guard there.

The resting cell draws the truncated label in an enum square, like
`type: 'file'` (`knob.ts:306`) — deliberately *not* the preset look, since two
adjacent cells rendering identically is the legibility problem the placement
exists to avoid.

## 7. After commit — reload

Committing arms `itemsReloadCountdown` (~250 ms of ticks; the tick rate swings
63-205 Hz, so this is a tick count, never a wall-clock sleep). When it fires,
`s.hierarchyKey = ''`, which makes the next tick re-run `loadHierarchy` —
re-reading `ui_hierarchy`, `chain_params`, and the preset count/names. This
matches the host's own settle-then-re-read (`shadow_ui.js:14760`) and covers
sfz and minijv, whose *hierarchies* change on selection, not just their preset
lists.

`tick.ts:53` already preserves `s.knobPage` across a rebuild of the same
`moduleId` and clamps it to the new page count, so no page-restore code is
needed — a bank switch is not a module change. Note this turns on `moduleId`
(`synth_module`, stably `"dexed"`) and not `activeModuleName`: dexed reports the
loaded *patch* name as its name, so after a bank switch the device log reads
`loadHierarchy: slot=0 module=PIANO   3`. Keying the reset off the display name
would reset the page on every preset change.

## 8. Persistence and undo

**Never persist the index.** It is positional over an alphabetically-sorted
directory scan (`scan_syx_banks:404`) and shifts when a `.syx` is added or
removed. dexed knows this: its own state restore tries `syx_bank_name` first
and only falls back to `syx_bank_index` (`dx7_plugin.cpp:977-987`).

movy does not need to. `capturesModuleState: true` snapshots the module's own
`<component>:state` blob, which is name-first for dexed, so undo is correct
without movy storing anything. A code comment records this so it is not later
"optimised" into an int.

## 9. Performance

`syx_bank_list` calls `scan_syx_banks()` on **every read**
(`dx7_plugin.cpp:1642`); obxd's `fxb_bank_list` likewise rescans
(`obxd_plugin.cpp:987`). The list is therefore read at hierarchy load and on
knob touch — **never** from the value-refresh cursor, never from
`wantsRefresh`. Only `select_param`, a plain int, joins the refresh set.
`perf.mjs` asserts the per-tick IPC count, so a regression that puts a list
read on the cursor fails locally.

Re-fetching on touch is what makes a bank uploaded from the schwung web UI
appear without reopening movy.

## 10. Tests

- **`browser-test/logic/items-select.mjs`** (new suite, plus one line in each
  of `logic.mjs`'s two lists): dexed-shaped hierarchy → cell immediately left
  of preset, labels resolved, current index shown; unreadable `select_param`
  → no cell; empty/malformed list → no cell; sparse `index` values map
  correctly; a 3-item list still opens the overlay on touch; a delta with no
  touch writes nothing; commit writes the index exactly once and arms the
  reload; a list that SHRANK between touches clamps rather than committing an
  index the module never offered. Each guard proved by reverting it and
  watching the assertion fail — two of them passed for the wrong reason first
  (`enumRawToIndex` clamps to `options.length-1`, which a two-entry sparse list
  makes indistinguishable from the real mapping; and one detent never crosses a
  step on a narrow range, so a single delta tests no guard at all).
- **`dump-replay.mjs`**: the dump records all 12 levels but never probed the
  items/select *values*, so replaying it today can only assert "still nothing".
  `scripts/dump-tool/ui.js` gains a probe for both keys; on the next device dump
  the per-module snapshots in `dump-expect.json` pick the new cells up on their
  own, so no bespoke assertion is needed.
- **`screenshot.mjs`**: two scenes — resting cell beside preset, and the
  overlay open — with baselines regenerated.
- **Device** (`scripts/test-items.sh`, added to `test-all-device.sh`): dexed on
  a track; inject touch → four detents → release and assert the selector was
  built from the device's own list, that scrolling writes nothing, that release
  writes exactly once, and that a `loadHierarchy` follows. This is the one thing
  the local suites cannot answer — neither key appears in `chain_params`, so
  every local fixture is hand-written.

  Two things it caught. First, the overlay commit path logged **nothing**: only
  `store.ts`'s turn path emitted `set slot=… key=…`, so on device an enum chosen
  from a list was indistinguishable from one never chosen. That line now exists
  for every overlay commit, not just selectors. Second, a knob release is a
  note-ON with velocity 0 — `midi/router.ts` dispatches the knob branch on
  `0x90` only, so an injected note-off (`0x80`) is silently dropped.

---

## Out of scope

Write-only command levels (surge/clap `category_jump`, minijv
`save_slot`/`load_expansion`/`expansions`). They need a fire-once affordance,
not a selector; revisit if asked for.
