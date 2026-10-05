# Drum modules on Schwung pages — plan

Decided 2026-09-30 in a grilling session with the user. Every decision below is
the user's ruling; the rationale is recorded so a later reader can tell a
decision from an accident.

**Goal.** Every drum module in the fleet is fully functional in movy under the
SCHWUNG grid mode — pages that do not bloat, pads that select the right page,
and automation that both **sounds** and **draws** correctly — and a drum module
movy has never heard of gets all of that with **no `movy_config.json`**. Legacy
configs keep working. No module-specific code, and **no upstream PRs to
modules**.

**Priority modules:** 6w6, 8w8, 9w9, cw78, mrdrums, weird-dreams, forge, sophie,
simian. Best effort: libpo32, krautdrums (old, low quality). Partial by design:
dr32 (see D10).

---

## 1. Facts this plan rests on

Checked against source on 2026-09-30 (schwung `c02391c7`, module repos at their
`main`/`master`, the three new modules cloned into `cld/`).

### Three module shapes

| Shape | Modules | Per-pad keys | What the module declares |
|---|---|---|---|
| **Sibling** — one level per voice, each shaped differently | 6w6, 8w8, 9w9, cw78 | real, per voice (`bd_tune`, `sd_snap`) | 6w6/9w9 now: `pad_layout: drums` + `focus_param: ui_focus_level` |
| **Template** — one child level, its pages edit *the selected pad* | mrdrums, sophie, simian, dr32 | real, templated (`p03_tune`, `pad3_…`) | simian/dr32: full contract (`pad_layout`, `child_notes`/`child_note_base`, `child_index_param`, `child_press_param`). sophie: `child_index_param` only, no notes, no `pad_layout`; hides `ui_hierarchy` and serves `ui_pages` |
| **Alias** — focused-pad alias keys | forge, weird-dreams, libpo32 | via movy_config (`cv_*` → `pv3_*` / `v3_*`) | nothing drum-shaped; the layout lives only in movy_config |

### Why automation fails where it fails

- movy's engine plays a lane back as **CC 102+lane** into the chain, where the
  chain resolves the lane's knob mapping against its param table:
  `chain_midi.c:927` — `if (!pinfo) return;`. **A key missing from the table is
  dropped silently.**
- That table is capped: `MAX_CHAIN_PARAMS 256` (`chain_internal.h:193`), each
  entry ~4.3 KB (inline `options[128][32]`). Raising it costs ~1 MB per 256 per
  table per chain; it is compiled into schwung's chain `dsp.so`, which movy
  loads a **copy** of (`engine/crates/movy-dsp/src/chain_host.rs`) — so not
  even a standalone movy could raise it without forking the chain host.
- Exposure: sophie publishes **273** params (pad 16 falls off); dr32 lists
  **30** (no per-pad key on any pad is in the table); simian fits at 214 because
  its author counted.
- **Plain `set_param("synth:<key>")` needs no table**: `chain_host.c:1285`
  forwards straight to the plugin. This is the route D1 takes.
- sophie and simian failing *completely* is not explained by the cap alone.
  There is at least one more cause on movy's side (lane bound to a bare/alias
  key, or the table built from a `module.json` sophie does not carry). **Not
  diagnosed yet — Phase 1 does it; do not guess.**

### Why 9w9 jumps pads by itself

9w9 moves its own focus on every note-on unless **Move's** clock is running
(`er99_plugin.c:190`). movy's sequencer is not Move's clock, so every sequenced
hit moves the page. sophie's author avoids this explicitly ("Never mutate
focused_pad from DSP note-ons").

### Constraints already in force

- movy's page renderer (incl. `config-pages.ts`) is frozen for deletion —
  CLAUDE.md *Schwung page migration* rule 1. Page work goes in the
  movy↔Schwung seam.
- Rule 3: a delegated component is never dual-driven. The seat (D5) is movy
  owning **navigation** (which page index) while Schwung owns the **page**,
  which is the relationship `focusVoice → ctl.goToPage` already has.

---

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Automation lanes write the param directly** (`chains.set_param(c, "<component>:<key>", v)`), not CC 102+lane. **All lanes, not only drums.** **Only movy-owned chains are automatable**; the CC path is deleted. | Removes the 256 cap and the table-miss failure in one move; no module or schwung change. **Zero added latency is a hard requirement** (the user's "otherwise strong NO"): it runs in `drain_out` in the same block as today's `chains.on_midi` CC; `apply_mix_lane` is the existing precedent. Resolution rises above 7 bits as a side effect. |
| D2 | **No CC fallback is needed.** Tracks always run on movy-owned chains; schwung-hosted chains carry only the master, which is not automated. | The user's ruling (2026-09-30). So the 256-param table never limits a track lane, and no `NO LOCK`-for-cap path or MANUAL note is required. |
| D3 | **Scope: SCHWUNG grid mode.** MOVY mode gets bug fixes only. D1 lives in the engine, so it fixes both modes. | Migration rule 1. |
| D4 | **Precedence (revised 2026-10-03): a movy_config ALWAYS wins over a module's declaration.** Order: movy's bundled override config (kept for now for 6w6, 8w8, 9w9, cw78) > module-shipped `movy_config.json` > the module's declared **drum surface** > generic. A declaration counts as a drum surface only if it has `pad_layout: "drums"` or a child level with `child_index_param` (D9). movy_config is a **frozen legacy reader**: no new fields, and future modules are not expected to ship one. | The user's ruling: "config wins all the time" is the simpler rule to follow and explain. The first version (declaration > config) was "tried this way" and is superseded. Today's code (`effectiveDrumConfig`) still lets a declared `pad_layout: "drums"` override the config (6w6, 9w9, sophie's D9 case); Phase 6 flips it. The config decides the drum setup (pads, notes, pad scoping). Page navigation for a sibling rack still reads the declared voices where there are any (`focusVoice`). |
| D5 | **One per-pad seat, built in movy's seam.** For sibling racks the voice pages collapse into a single rotating seat; template racks already have one per child level. movy owns the page index, Schwung draws the page. | Upstream is likely to push back and Schwung will not expose it anyway; nothing user-facing is lost. The cost is coupling to `pages[i].level` / `voicesOf`, which is paid for with a logic test against the real schwung checkout. |
| D6 | **Per-pad pages first** in the jog, everything else after. The per-pad block = voice levels (sibling) or every page of every child level (template). | Makes the pad-switch rule (D7) well defined. |
| D7 | **Pad-switch rule.** On a per-pad page, a pad press moves to that pad and **keeps the page offset** within the block, **clamped** to the new voice's last page. On any other page the press does not move the page, but **the focus still updates**: jogging back to the seat shows the last pad hit. | The user's rule, option (a). Diverges from native schwung (which follows from any page) on purpose. |
| D8 | **movy owns drum focus**, from physical pad presses only, mapped through the declared notes. It writes `child_index_param` where one exists (so the module's own copy/delete gestures agree) and **never follows the module's focus reports** (`focus_param`, `child_index_param` reads). | Fixes 9w9 (and any future note-following module) with no module change. We lose module-initiated focus moves (mrdrums' auto-select on preset load), which is fine. |
| D9 | **Config-free drum rack rule:** a child level declaring `child_index_param` ⇒ drum rack; notes from `child_notes` / `child_note_base`, else `36 + i`. An explicit `pad_layout: "chromatic"` always wins. | Schwung forbids inferring layout, but configless modules must work. Narrow: in the dumped fleet only sophie uses `child_index_param` (simian and dr32 also declare `pad_layout`). |
| D10 | **More than 16 voices ⇒ the drum grid goes 8 wide over all 32 pads**, bottom-left upward. Generic — no dr32 code. The right half has no drum function today; if one is added later it gets an on/off switch that overlays this. | The user's ruling (R5). dr32's page count stays low through D5/D6 (its four child levels are one block). |
| D11 | **forge, weird-dreams, libpo32 stay on their movy_configs permanently** as a supported legacy path. | No upstream PRs to modules (Q7). |
| D12 | **No pad-switch query.** All per-pad pages' values stay in memory; a pad switch reads nothing blocking. For template racks that means warming every pad's concrete keys in the background, not on the press. | The user's requirement, pending the latency investigation (§5). SP-39 already bulk-warms on `jump`; this moves the warm off the press entirely. |
| D13 | **32 automation lanes per track** (from 8). | The 8 came from CC 102–109; direct writes (D1) remove that reason. 32 matches Schwung's own `LANE_MAX`. |
| D14 | **Enums and booleans are automatable, in both grid modes.** Equal bins (option = ⌊v·n/128⌋, n = 2 for a boolean), stepped and never interpolated; the engine writes the form the module's `get_param` emits (option name or index), detected at bind; one detent moves one option on a held step. | The old scaling problem was the chain's CC scaling against a min/max that is not the option count. With direct writes the engine converts. MOVY mode gets the one rule change in `param-build.ts` / `config-pages.ts` by the user's explicit ruling, despite migration rule 1. |
| D15 | **No data migration.** Stored values stay 7-bit; lane index and target key are already explicit in the set file (`au <track> <lane> <base> <label>`, locks `lane:step:val`). | Old sets load unchanged. Going above 7 bits WOULD need a format change and a migration; deferred so this release adds none on top of the ones already since the last public release. **Downgrade hazard:** an older movy loads lane ≥ 8 as `lane & 7` (merging into lanes 0–7) — release notes; from now on the parser drops out-of-range lanes instead of masking. |
| D16 | **Per-voice locks on drum tracks via Schwung's `lane_voice_map.mjs`** (pure, imported through `schwung-lib`, never re-spelled): a step copy/paste on a drum track moves only the selected voice's locks, and the held-step display can show only the focused pad's locks. | Matches Move's own per-voice paste (measured by Schwung) and keeps one definition of "which keys are which pad" — the module's declaration. |
| D17 | **Stale lanes keep today's purge** when the module changes (`seq/automation.ts:449`); Schwung's keep-dormant rule is NOT adopted. | The user's ruling. |

---

## 3. Phases

Order is the user's (R6). Each phase: cheapest test that reproduces it first
(CLAUDE.md *Match the test to the bug*); prove teeth by removing the fix.

### Phase 1 — Automation diagnosis matrix

A per-module matrix, one row per priority module, answering for a held-step
lock on pad N's param: **(a)** which key the lane binds to, **(b)** whether the
chain can resolve it (in table? under cap?), **(c)** whether playback reaches
pad N and only pad N, **(d)** whether the held arc and the lane mark draw.

- Build it as a `dump-replay.mjs`-style logic test over the module dumps plus
  the new modules' shipped hierarchies. **Refresh `docs/module-dump/` first** —
  it is from 2026-09-13 and has no simian or dr32.
- Output: the named cause(s) for sophie and simian, and the held-step
  arc cause for weird-dreams (hypothesis: the lock is recorded on the concrete
  `v3_*` key while the page cell carries the alias `cv_*`, so the decoration
  never matches — verify, do not assume).
- The matrix stays as the regression test for Phases 2–3.

#### Phase 1 — findings (2026-10-01)

Measured, not read: `browser-test/logic/drum-automation.mjs` boots the real
controller over the 2026-10-01 capture (105 modules) through movy's io and
asks the real code for each column; the chain table comes from schwung's own
`chain_params.c` compiled natively (`browser-test/chain-table.mjs`). Snapshot
in `browser-test/drum-automation-expect.json` (`UPDATE_DRUM_MATRIX=1` to
re-baseline). Teeth: binding the lane to the concrete child key in the built
bundle turns simian/dr32 rows red as named cell diffs.

**The CC path's lookup.** `knob_find_param` → `find_param_info` is an EXACT
scan — no child-template alias, no suffix match, no refresh. The table is
`module.json` at load (`static`), replaced by the plugin's `chain_params`
(`dynamic`) on the first `find_param_by_key` miss, both capped at 256.

| module | (a) lane binds | pad N's key | (b) table | (c) pad N only | (d) arc / mark / sync |
|---|---|---|---|---|---|
| 6w6 8w8 9w9 cw78 | concrete (`lt_tune`) | same | dynamic | ✔ | ✔ ✔ ✔ — **all good** |
| mrdrums | alias `pad_vol` | `p03_vol` | dynamic | ✘ focused pad | ✘ arc, mark on every pad, purged |
| weird-dreams | alias `cv_vol` | `v3_vol` | dynamic | ✘ focused voice | ✘ arc, mark on every pad, purged |
| forge | alias `cv_m1` (`{key}` template) | `pv3_m1` | static | ✘ focused voice | ✘ arc, mark on every pad, purged |
| sophie | template `tune` | `p03_tune` | **none** | ✘ | arc on every pad, no mark, purged |
| simian | template `tune` | `pad3_tune` | **none** | ✘ | arc on every pad, no mark |
| dr32 | template `start` | `pad3_start` | **none** | ✘ | arc on every pad, no mark |
| libpo32 | — no per-pad page in SCHWUNG mode (plans `Presets | Main: level/decay` from its module.json root) | | | | |
| krautdrums | — no per-pad key anywhere (one level per voice) | | | | |

**Named causes.**

- **C1 — the lane binds the page's TEMPLATE/ALIAS key, never pad N's.**
  `schwung-page-render.ts` `knobParamInfo` returns `ioKey: ctl.page.keys[slot]`
  raw. On a child level that is the template (`tune`) — the controller resolves
  `pad3_tune` only inside its own reads/writes (`childResolve`) and exports no
  resolved-key accessor (only `childIndexOf(level)`). On alias racks it is the
  focused-voice alias. Every non-sibling row fails (c) on this alone.
- **C2 — sophie, simian, dr32 are silent because the bare template key is in
  NO table.** Their tables hold only concrete per-pad keys (sophie, simian) or
  base keys without the per-pad ones (dr32), and the CC path matches exactly.
  This is the "more than the cap" cause the plan predicted. The cap is real
  but secondary: sophie's dynamic table ends at `p15_ring_tone` (pad 16 gone);
  simian's own `chain_params` stops at `pad14_*` (pads 15-16 never listed);
  dr32 lists no per-pad key; forge's static table is full at 256. D1
  (direct `set_param`, no table) removes all of it.
- **C3 — weird-dreams' held arc: the REVERSE of the hypothesis.** The lock is
  recorded on the ALIAS (`synth:cv_vol`, C1) and the decoration looks it up by
  the CONCRETE key — `buildAutomationView.laneForKey` (`app/tick.ts`) maps the
  cell through `concreteKey(ps, pad, key)` → `synth:v3_vol` → no lane, no arc.
  The mark uses `automationFor` → `laneForParam(alias)`, which matches, so the
  mark draws on every pad. Same for mrdrums and forge.
- **C4 — `validateLane` purges alias and template lanes at the next label
  sync.** A bare alias is dropped by rule; sophie's `tune` is unknown to movy's
  config-built model. So even the mis-bound lane does not survive a sync.
- **C5 — template marks.** The controller asks `isAutomated` with the RESOLVED
  key (`fullKey`), the lane holds the template → no mark on simian/dr32/sophie,
  while `decorationsFor` (template vs template) leaks the arc onto every pad.

**What Phases 2-3 must also cover (found by the teeth run).** With the lane
bound to the correct concrete key: `validateLane` would PURGE it (movy's model
does not know `pad16_start`), and `laneForKey` would miss it (it does not
resolve child templates) — both need the child-level resolution, not only the
alias one. Unverified, recorded only: in the mock, `ctl.childIndexOf(level)`
did not follow `focusVoice` on simian (pad 3 read back as index 0); resolve pad
N from movy's own pad (D8), not from the controller's read-back.

**libpo32 and krautdrums** are new findings for the best-effort pair: under
SCHWUNG neither exposes a single per-pad parameter today.

### Phase 2 — Direct-write lanes (D1, D2)

- Engine: on lane bind (`knob_<N>_set` today, `seq/lane-mapping.ts`), also hand
  the engine the target `<component>:<key>` plus min/max/type; `drain_out`
  writes `set_param` for a movy-hosted chain instead of `on_midi` CC.
- **No heap on the audio thread**: the key string is built at bind time, the
  value formatted into a fixed buffer.
- **Verify, don't assume:** a direct write updates the modulation *base*
  (`chain_mod_update_base_from_set_param`) — check it composes with an LFO on
  the same param exactly as the CC path does, and that float smoothing behaves
  the same.
- **Why the latency is the same (checked 2026-09-30):** `drain_out`
  (`lib.rs:784`) runs before `chains.render` (`lib.rs:791`) in the same
  `render_block`, so a value is heard in the block it is due, exactly as the CC
  is today. The chain's float smoother does not slew it:
  `smoother_set_target` jumps `current = target` (`chain_params.c:92`). The
  extra work on the `set_param` path (mod-target scan of ≤64, smoother slot,
  `lane_on_set_param`) is about what the CC path spends on its knob-mapping
  scan and its 256-entry table lookup.
- **Latency gate:** measure with `perf-probe.ts` that the lane-to-sound path is
  no slower than CC (same block). If it is slower, stop — D1 is conditional on
  this.
- Delete the CC 102+lane emit and the `knob_<N>_set` lane mapping — tracks are
  always movy chains (D2), so nothing needs the CC path.
- D13: lane arrays 8 → 32 (`track.rs`, `persist.rs` `lane < 8` / `lane & 7`,
  the UI lane pool); revisit `MAX_LOCKS = 1024` per clip, shared by all lanes.
- D14: the bind-time descriptor carries type, range and, for an enum, the
  option list and the value form. It is rebuilt whenever the module (re)loads
  and never persisted, so a param a module changes from float to enum is read
  as what it is now.
- **Lock precedes its note** (Schwung's `lane_lookahead.h` lesson: a drum voice
  latches pitch at note-on, so a lock one block late lands on the NEXT hit).
  movy is ahead by one tick on the grid by construction (`engine.rs` emits notes,
  advances `pos_tick`, then the entered step's automation) — add a seq-core test
  that pins it, including microtimed/nudged notes, the first step after Play and
  the loop wrap.
- ENGINE_VERSION bump.

#### Phase 2 — results (2026-10-02)

Built against schwung `origin/main` cfeb2b0a (the `schwung-main` worktree —
`schwung/` itself is diverged from a rewritten `origin/main` and was left
alone). ENGINE_VERSION 0.82.0.

- **Wire.** `ch<N>:lane` = `<lane>|<spec>`, spec one of `-`, `m|<field>`,
  `f|min|max|key`, `i|min|max|key`, `e|n|key`, `n|key|opt|…`
  (`engine/crates/movy-dsp/src/auto_lane.rs`). It replaces both `knob_<N>_set`
  and `mixlane`. The UI sends it on assign and on EVERY label sync
  (`seq/lane-mapping.ts` `bindLane`), so a bind survives an engine restart,
  a Set load and an undo without a verify loop. `ch<N>:lanes` reads the binds
  back (device tests use it). A new Set document clears every bind.
- **Deleted:** the CC 102+lane emit, `verifyLaneMappings` (the
  `knob_<N>_name` round-robin), and the `knob_<N>_value` param-cache warm
  (`requestLaneWarm` / `laneWarmTick`) — all three existed only because the
  chain resolved the CC through its param table. `reselect`'s C2 now asserts
  the binds survive a reselect instead of the warm.
- **A restored lane whose module is not loaded is kept but not bound** (the
  bind carries the range; a guess would write wrong values). The label sync
  reports it and `app/tick.ts` retries with backoff (64 → 2048 ticks).
- **Modulation, verified in source:** the old CC path wrote the plugin
  directly (`knob_forward_value`), so an LFO on the same param overwrote the
  lane at its next tick. The direct path is the chain's `set_param`, which
  calls `chain_mod_update_base_from_set_param` — the lane moves the LFO's
  base and the two compose. That is a behaviour CHANGE (better), recorded in
  the changelog. Smoothing: same (`smoother_set_target` jumps). Schwung's own
  lane recording (`lane_on_set_param`) is gated off by `lanes_enabled`.
- **Latency gate — how it was met.** `perf-probe.ts` measures the UI's host
  IPC, not the engine, so it cannot see this path. Instead
  `a_lane_value_reaches_its_param_in_the_block_it_is_due` (movy-dsp) asserts
  that in every block where the sequencer's applied value moves, the chain's
  `set_param` receives it in that same `render()` call; teeth shown by
  draining one block late (fails with `[]`). The per-write CPU was NOT A/B'd
  against the CC path on device — the CC path's cost lived in the chain
  (256-entry `strcmp` scan + knob-mapping scan) and is gone.
- **Lock before note — the plan's premise was wrong for three cases.** On the
  grid the lock is one tick early by construction, but the first step after
  Play, an early-nudged note and an early note wrapped onto the previous pass
  all fired BEFORE their step's automation. Fixed in `seq-core`: before a
  note-on, if the applied step (`Track::auto_step`) is not the note's step,
  that step's automation is applied first (on-change, so step entry adds
  nothing). Two tests pin it; both failed before the fix.
- **D13:** `LANES = 32` (`seq-core/track.rs`), status masks are 8 hex digits,
  `MAX_LOCKS` 1024 → 4096, and `emit_automation` is one pass over the locks
  (was one `lock_at` scan per lane). Persist drops `lane >= 32` instead of
  `lane & 7`.
- **D14 done (2026-10-02, second commit).** Enums of 2+ options and 0..1
  switches are automatable in both grid modes (`shapeAutomatable` in
  `param-build.ts`, shared by `config-pages.ts`; `enumLane` in
  `schwung-page-render.ts`). Every 7-bit conversion goes through
  `seq/lane-value.ts`: a stepped value is stored at its bin CENTRE so
  `⌊v·n/128⌋` — the engine's rule — returns the same option; a held-step detent
  moves one option. Both page owners hand the bind the options and the wire
  form (`enumLaneInfo` honours forge's `enumSetIndex`); a restored lane gets
  them from `paramRangeByKey`. The MOVY enum box, wave shape and toggle now
  follow a held/live value like the arc did. Inferred two-state ACTIONS stay
  non-automatable (Schwung marks them `writeOnly`; movy's `applyAutoStyle`).
  Not device-verified beyond P5's generic "playback moves the param" — no
  scenario drives an enum knob on the device.
- **Device check added:** `automation` P5 reads the binds and samples the bound
  param through the chain while the clip plays — the first check that
  automation is actually applied, not just drawn.

### Phase 3 — Held-step and lane visuals on drum pages

Fix whatever Phase 1(d) names. Acceptance: hold a step, turn a per-pad knob on
weird-dreams / mrdrums / sophie / 6w6 — the arc shows the lock value, the lane
mark appears, playback moves the arc on the right pad only. Screenshot scenes
for the held state.

#### Phase 3 — results (2026-10-03)

Built against schwung `origin/main` 2467bcc2 (`schwung-main` worktree; `schwung/`
is still diverged and was left alone). No ENGINE change. The user's report that
drove it: "on the simian automation currently applying to whatever pad is
active, so it changes when i press the pad" — C1 under D1, since the engine now
writes the bound key straight to the module and `synth:tune` IS "the focused
pad's tune".

- **C1 — the lane binds pad N's concrete key.** `schwung-page-render.ts`
  `knobParamInfo().ioKey` is now `laneKeyOf(cell)`: a child-level template is
  resolved with Schwung's own `resolveChildKey` at the instance **movy's pad
  press chose** (`focusVoice` records it per level, keyed to the contract parse
  so another module's choice answers nothing), falling back to
  `ctl.childIndexOf(level)` for a level movy never focused; then a movy-config
  alias goes through `PageAutomation.laneKey` (`app/automated-keys.ts`), i.e.
  `concreteKey(padScoping, drumCurrentPad)` on the track's model
  (`componentModelOf`, factored out of `modulated-keys.ts`). Measured: the
  controller's own index lags the press by 4-10 ticks (it learns it by reading
  `child_index_param` back), which is why simian pad 16 bound `pad4_tune` when
  the controller's index was trusted — D8's rule, taken early for the lane.
- **C3/C5 — arc and mark.** The page decorates its cells by the RESOLVED key
  (`render()` maps `keysOf()` through `childKeyOf`), and `automationFor`'s
  `isAutomated`/`baseOf`/`noteBase` resolve an alias through `laneKey` before
  the registry lookup. `buildAutomationView.laneForKey` already concretised
  aliases and is unchanged.
- **C4 — the sync keeps them.** `validateTrackLane` (moved out of `app/tick.ts`
  so the matrix calls the real judge) passes `model.childTemplateOf`:
  `pad16_start` validates as `start` (`model/child-keys.ts`, Schwung's resolver
  pushed in from `app/globals.ts` like the surface reader). `paramRangeByKey`
  falls back to every key the module DECLARES (chain_params + every level's
  knobs/params, built by `buildGenericParam`) — forge's Voice macros `cv_m1..8`
  are on no movy page. A bare template lane (the pre-fix binding) is NOT dropped:
  it keeps playing into the focused pad, as it did, rather than vanish from
  users' Sets; re-recording binds the pad.
- **Found on the way:** `aliasFromConcrete` read `padDigits` as an EXACT width,
  while `concreteKey` pads with `padStart` — forge's one-digit `pv{pad}` wrote
  pad 16 as `pv16_m1` and the reverse map missed it, purging every forge lane on
  pads 10-16 at the next sync. Now a minimum width.
- **Matrix:** column (b) and `chain-table.mjs`/`native/chain-table.c` deleted
  (the CC path they modelled is gone). Arc read off `ctl.decorations` after the
  page's own `render()`. Every row but sophie asserts sounds+draws outright.
  Teeth: seven mutations, one per piece above, each turns named rows red.
- **Screenshot:** `page_held_drum` (simian, pad 3's Tone page, lock on
  `pad3_tune` through the real registry and `buildAutomationView`); throws if
  the lane binds the template, 216 px differ if decorated by template.
- **Not done — sophie.** It declares no voices, so `focusVoice` cannot move its
  page and its `focused_pad` is never written by movy: under SCHWUNG the page
  edits whichever pad the module has focused, and the lane binds THAT pad
  (consistent with what the knob edits). Its row stays NO until Phase 6 (D9).
- Not device-verified per module: the tier has no drum-module scenario, and
  loading simian/dr32/forge on the box churns the set the gate runs on.

### Phase 4 — movy owns drum focus (D8)

- Covers config racks as well as declared ones (D4 revised): a config rack's
  press writes its `currentPadParam`, and the page and the lane key resolve at
  movy's pad, not at the module's read-back.
- Seat follows physical presses only; module focus reads are ignored for
  navigation.
- Write `child_index_param` on press where declared.
- Test: a sequenced note on 9w9 does not move the page; a finger press does.

#### Phase 4 — results (2026-10-03)

Built against schwung `origin/main` ecf1c828 (`schwung-main` worktree;
`schwung/` is still diverged and was left alone). No ENGINE change.

- **The seam is the io, not the input handler.** Schwung's controller follows
  the module through two READS: `syncVoiceFromModule` navigates on
  `focus_param` (sibling racks; 6w6/8w8/9w9/cw78 move it on every note-on while
  Move's clock is stopped, and mrdrums auto-selects), and
  `syncChildIndexFromModule` adopts `child_index_param` (template racks). Both
  go through movy's io, so `renderer/schwung-page-focus.ts` answers them:
  `focus_param` is always null ("no information": the controller does nothing
  and leaves its latch alone, and navigation is `focusVoice`'s alone), and a
  level's `child_index_param` answers what movy last WROTE, which is a pad press
  (`focusVoice` → `choose`), the controller's own picker or index knob
  (`io.setParam` → `wrote`), or a config rack's press write (`focusWritten`,
  from the router via `padFocusWrite`, which is shared with `drumPadOn`, so
  sophie's `focused_pad` is one value). Before any press it answers null, so the
  controller keeps instance 0, which is movy's model pad 1.
- **One focus per index PARAM, not per level.** simian's `pads`, `pad_noise`
  and `pad_mix` share `ui_current_voice`. Keyed per level (Phase 3's map),
  `pad_noise` never saw the press and fell back to the controller's index.
- **Alias racks resolve at movy's pad.** `focus.ioKey` routes every page
  read and write of a movy-config alias (`pad_vol`, `cv_vol`) through
  `PageAutomation.laneKey`, so it uses the concrete key MOVY mode's `paramIoKey`
  has always used. mrdrums and forge both move their focus on notes, so the
  alias edited the pad the pattern last played.
- **Cost, caught by SP-39's press test.** The first version asked
  `hier.parsed()` on every controller read, and for a rack that serves no
  `ui_pages` that is an uncached live read per ask (6w6's jump: 9 singles
  instead of 1). `PageHierarchy.peek()` parses the contract as last read, with
  no read of its own. The controller re-reads the contract on its own poll.
- **Test:** `browser-test/logic/drum-focus.mjs`, with the real controller and
  the dumped contracts for 9w9, simian, sophie and mrdrums. The module's report
  is staged through the track's port, because the mock port remembers movy's
  press write, so editing `env.params` never reached the controller and the
  first version of the test passed with the fix removed. Teeth: five mutations
  (focus_param falls through, child index falls through, alias not
  concretised, focus keyed per level, and the `peek` cost), and each turns
  named checks red.
- Not done here: a picker pick does not move movy's model pad
  (`drumCurrentPad`), so an ALIAS lane bound after a picker pick resolves at the
  last pressed pad. Template lanes follow `focusedChild` and are right.

### Phase 5 — The seat, ordering and pad-switch rule (D5, D6, D7, D12)

- A rotation layer in the seam over `ctl.pages`: the per-pad block first,
  collapsed to one seat for sibling racks; page dots, header label and jog count
  come from the rotation.
- Pad-switch rule per D7 (offset kept, clamped; no move off-block; focus
  updated).
- D12: background warm of every pad's concrete keys; assert a pad switch issues
  **zero** blocking reads.
- Tests against the real schwung checkout (`SCHWUNG=../schwung npm test`); read
  `ctl.pageIndex` directly — SP-45 showed `probe.page().cells` is blind to
  schwung's page cursor.
- Existing movy-config voice rotation (`model/page-rotation.ts`) is MOVY-mode
  and frozen; do not extend it.

### Phase 5b — Per-voice locks (D16)

- Expose `lane_voice_map.mjs` through `schwung-lib`; step copy/paste on a drum
  track filters locks to the copied voice's keys; held-step display filters to
  the focused pad.
- Logic test over the declared racks (sibling and template shapes).

#### Phases 5 + 5b — results (2026-10-03)

Built and tested together (one device run), against schwung `origin/main`
ecf1c828 (`schwung-main` worktree; `schwung/` is still diverged and was left
alone). ENGINE 0.83.0.

- **The seat is `renderer/schwung-page-seat.ts`**, a pure re-ordering of the
  controller's own page indices; Schwung still plans and draws every page. Per
  declared voice, its block: a sibling voice's level pages (6w6/8w8/9w9/cw78),
  or, for a child voice, every page of every level on its level's
  `child_index_param` (simian's Tone/Noise/Mix, dr32's 48 pad pages), which is
  lane_voice_map.mjs's grouping. Jog order = the seat's block + everything on no
  block. `SchwungPage.pageIndex/pageCount/goToPage/changePage` are now the
  SEAT's (the bank bar follows); tests that index `ctl.pages` read
  `ctl.pageIndex`.
- **The seat is adopted, not imposed**: a section-picker jump onto another
  voice's page makes that voice the seat, so every real page keeps a place in
  the order.
- **D6 landing**: a drum module opens on its seat, once per contract and only
  while the controller is still on the page it chose itself (a replan or a
  page the user jogged to is never yanked back). Without it a press from the
  module's default page (Main) would, by D7, move nothing.
- **The jog**: the seat re-orders only the PAGE step. A picker or an entered
  door owns the jog (`onJog`'s ladder, all of it behind `pickerOpen` /
  `menuEntered()`), so those go to `ctl.onJog` untouched; a seat step is a
  warmed jump (`goToPage(…, {remember:false})`), dropping the hint and peek
  as `onJog` would.
- **D7** is `seat.press`: offset within the block kept, clamped; off-block
  press returns -1 (no move) but moves the seat. `focusVoice` returns true for
  any declared voice now, moved or not.
- **D12**: `renderer/schwung-page-prefetch.ts`. Every voice's block keys,
  resolved per voice, ride the SPARE ROOM of the existing epoch fill (no new
  round trip; simian's ~380 keys cycle in ~13 fills), and a cache miss is
  served from it when read within 48 epochs. A write through the port drops
  the key; `:module` and `invalidateAll` clear it. `focusVoice` peeks the
  contract instead of reading it, so the SP-39 press test's one contract
  single is now 0. Measured: simian pad switch 7 live cell reads → 0; 9w9 one
  warm bulk → 0. Bound, by design: dr32's set is too big to cycle inside the
  age bound, so its uncovered keys fall back to the old warm.
- **D16 copy**: `cpy <t> <s0> <s1> [<pitch> <laneMask>]`. The engine copies
  only that pitch's notes and the mask's locks, and the paste replaces only
  those at the destination (`copy_steps_voice`, three Rust tests). The UI
  (`seq/voice-copy.ts`) sends the pair on a drum view (`watchLane ≥ 0`) when
  the module has a voice map: `model.voiceKeysOf(pad)`, built at hierarchy load
  from Schwung's own `laneVoiceMap` (loaded optionally beside param_pages; it
  is 1.6.0, past SCHWUNG_FLOOR), indexed by PAD through the declared voice
  list, so a bundled config's different notes (6w6) do not matter. Notes are
  per-voice too, which is Move's measured behaviour and what movy's drum step
  LEDs already show. No map (config-only racks, melodic) = whole-step copy, as
  before.
- **D16 display** needs no new filter. Decorations are keyed by the page's
  RESOLVED keys, and a pad page resolves at the focused pad, so a held step
  shows only that pad's locks. Asserted (simian pads 3/4) rather than coded
  twice.
- **Tests**: `browser-test/logic/drum-seat.mjs`. Teeth: six mutations (no
  prefetch, offset not kept, planner jog, all lanes copied, no landing,
  off-block press moves), each turning named checks red; the contract peek's
  teeth are the SP-39 press test. Baselines `page_voice_pad` and
  `page_held_drum` changed in the bank bar only (seat count/position).
- **Not done**: config-only racks (forge, weird-dreams, mrdrums, sophie with
  its config) have no declared voices, so no seat and whole-step copy. Phase 6
  (D9) gives sophie voices; the alias racks stay on their config (D11).

### Phase 6 — Config-free rack rule (D4, D9)

**Ruling (user, 2026-10-03): a module-shipped `movy_config.json` always wins
(D4 revised).** sophie plays today because its shipped config makes it a drum
track. The declaration-based rules (`pad_layout: "drums"`, and D9's
`child_index_param` ⇒ drum rack) are still built, but they apply only to
modules that do NOT ship a config. That is the expected path for future modules;
the config is legacy. movy's bundled overrides for 6w6, 8w8, 9w9 and cw78
are kept for now and also win. Phase 6 work:
- flip `effectiveDrumConfig`, so a config (bundled or shipped) beats a declared
  surface (today a declaration overrides it);
- the config path must also move the page on a pad press. Today only declared
  voices do (`focusVoice` → `surfaceOf`). For a config rack with a template
  page, write the config's `currentPadParam` (sophie: `focused_pad`) on the
  press and resolve the page's child level at that pad (shared with Phase 4);
- test sophie both ways: with its config removed it is a 16-pad rack via D9;
  with the config present it stays on the config path.

- Extend `effectiveDrumConfig` / the surface reader with the
  `child_index_param` rule and the precedence in D4.
- Test: sophie **with its movy_config removed** is a 16-pad rack with correct
  pads, pages and automation.

#### Phase 6 — results (2026-10-03)

Built against schwung `origin/main` ecf1c828 (`schwung-main` worktree;
`schwung/` is still diverged and was left alone). No ENGINE change.

- **The flip** (`model/drum-declared.ts`): a config, bundled or shipped, is
  returned untouched; the declaration is read only when there is none. Nothing
  is merged in from it any more (the old merge carried the config's scoping into
  the declared rack, and the declaration's `focus_param` into the config).
- **The flip exposed a numbering clash, so pads map to voices BY NOTE.** 9w9
  declares 36..44, **46, 45**; its bundled config plays 36 + i. By position,
  pad 10 sounded 45 (Crash) while its name, its page and its copied keys were
  the voice at index 9 (46, Ride). `padVoices(cfg, voices)` matches each pad's
  sounding note to the declared voice, and is what names the pads and indexes
  the D16 voice keys; the router passes the pad's note to `focusVoice`, which
  picks the voice declaring it (by position only when no note is given). The
  user-visible change: 9w9 pads 10/11 are back in the config's order.
- **D9 lives in the seam's one reader** (`renderer/schwung-voices.ts`,
  `declaredRack`): with no voices and no explicit `chromatic`, the first level
  in Schwung's own voice order that has children and a `child_index_param` is
  given `pad_layout: "drums"` and `child_note_base: 36` (unless it states
  notes), and everything downstream — `voicesOf`, `laneVoiceMap`, the seat — is
  Schwung's code reading that contract. Memoised per contract object. The voice
  map reader is `rackVoiceMap` (same normaliser), registered in globals and
  reused by the tests rather than re-spelled.
- **sophie with its config** therefore gets voices from D9 for NAVIGATION (the
  seat, D7, `focusVoice` writing `focused_pad`) while the drum setup stays the
  config's (`pad_` scoping, `currentPadParam`). The router still also writes the
  config's `focused_pad` (`padFocusWrite`), the same value; left as is.
- **Not as the plan said: forge is reached too.** Its six voice levels carry
  `child_index_param: focused_voice` with no layout, so D9 seats its Voice
  block (Selected Voice, Voice, Osc, Filter, Env, Mod, Setup) first and a press
  writes `focused_voice`. Its config still decides pads and the `cv_*`→`pv*`
  scoping, so lanes are unchanged (`pv3_m1`). Its voice map is empty (every
  voice shares `{key}`), so its copy stays whole-step.
- **MOVY-mode side effect of the flip:** 6w6/8w8/9w9/cw78 no longer get the
  declared `focus_param` merged into their config, so a press under MOVY pages
  no longer writes `ui_focus_level`. movy's own pages for them name concrete
  keys, so nothing reads it; under SCHWUNG `focusVoice` still writes it.
- **Tests**: `browser-test/logic/drum-racks.mjs` (pure precedence, by-note
  pads, chromatic guard; sophie without and with its config, 9w9 under its
  bundled config). The matrix now passes sophie on pads 3 and 16 and asserts it
  (the `NOT_YET` exemption is gone); it looks for the per-pad cell past a seat
  that opens on a door (forge's Selected Voice). Teeth: no D9, declaration
  first, page by position, names by position, chromatic inferred, voice map
  unwrapped — each turns named checks red.

### Phase 7 — 32-pad grid (D10)

- `drum-grid.ts`: 8-wide when `padCount > 16`; LEDs, pad-route, mutes follow the
  one geometry module.
- Test with dr32's shipped hierarchy.

#### Phase 7 — results (2026-10-03)

- `drumCols(cfg)` in `keyboard/drum-grid.ts` replaces the `DRUM_COLS` constant:
  8 for a non-rawMidi rack of more than 16 pads, else 4. Input, LEDs, the
  engine's pad map (`pad-route`), mutes and the model's initial focus already
  went through `drumPadOfPhys` / `physPadOfDrumPad`, so nothing else changed.
- Tests in `drum-racks.mjs`: the 32-pad round trip and row order, 16 pads stay
  4 wide, a right-half pad lights only on a 32-pad rack, and dr32's dumped
  contract plays 32 distinct voices across the whole grid. Teeth: always-4-wide
  turns 8 checks red.
- Not done: the header pad icon (`drawPadGridIcon`, frozen renderer) still
  assumes 4 across. It is drawn only for a config-scoped rack (`isPadScoped`),
  and no config in the fleet has more than 16 pads.
- **Revised 2026-10-04 (user):** the 32 pads were numbered in 8-wide rows, so
  pads 5-8 landed on the right half. Now two 4x4 banks: 1-16 fill the left half
  exactly like a 16-pad rack, 17-32 the right half the same way.

---

## 4. Per-module acceptance

| Module | Pages | Pad → page | Automation sounds | Automation draws |
|---|---|---|---|---|
| 6w6 / 8w8 / 9w9 / cw78 | one voice seat + rest | D7; 9w9 no self-jumping | ✔ (movy chain) | ✔ |
| mrdrums | template, one block | D7 | ✔ | ✔ |
| sophie | its own `ui_pages` | D7 through D9's voices, with or without its config; the config still sets pads and scoping (D4) | ✔ incl. pad 16 | ✔ |
| simian | template, 3 child levels = block | D7 | ✔ | ✔ |
| forge / weird-dreams | movy_config (D11, §7: pages too) | D7 (no jump, §7) | ✔ | ✔ |
| libpo32 / krautdrums | movy_config (libpo32 pages §7) | best effort | ✔ libpo32 | ✔ libpo32 |
| dr32 | 4 child levels = block, 32 pads | D7, D10 | ✔ | ✔ |

---

## 5. Parked — recorded, not in this plan

- **Pad → page latency on weird-dreams** is noticeably worse than native
  schwung. SP-39's bulk warm did not fix it. Investigate in its **own session**;
  D12 is the only part taken here.
- **Drum-voice sends to Send 1 / Send 2.** Schwung already has `split_voices`
  and bus routing (`docs/MODULES.md` → *Rendering voices apart*), and movy has
  send buses (`project_movy-send-fx-and-mix-page`). A later phase.
- **dr32 beyond D10** (engine switching, resample, kit browser) — not targeted.
- **Automation follows edits** — compare movy's step copy/paste/delete/undo
  with the Move semantics Schwung measured (`lane_edit.h`, `docs/MOVE_MODEL.md`).
- **Live record semantics** — Schwung's "a pass erases the span it sweeps" and
  punch-until-wrap, against movy's live take.
- **Smooth (breakpoint) lanes** — Schwung's beat-positioned points with
  hold/ramp. A different model from per-step locks; needs a real migration.
- **Right-half pad function** on drum tracks — none today; if added, an on/off
  switch over D10.

---

## 6. 2026-10-04 — DR32 follow-ups (generic)

- **Page bloat was `visible_if`, not the seat.** Module pages got no `visible`
  hook, so the planner failed open and planned every gated level: DR32 52 pages
  (every engine's) vs Schwung's 8-11. `renderer/schwung-page-visible.ts` now
  answers it by Schwung's grid rules (controller values first, then the page
  cache; a condition key is per-instance only when its level lists it — DR32's
  `ui_engine`/`ui_family` are read bare; an unread or "" key fails open). A pad
  press re-plans via the controller's gate lane (7 ticks in the test). Side
  effect for D12: the seat's block now holds only the visible engine's pages, so
  DR32's prefetch set shrinks to something the age bound can cycle.
  Test: `browser-test/logic/page-visible.mjs` (7 checks red without the hook).
- **ENGN did nothing**: a held `type: "canvas"` cell's click intent had no host
  screen in movy. `renderer/schwung-canvas-dive.ts` hosts the module's
  fullscreen script to upstream's contract; `midi/canvas-dive-input.ts` is the
  router's one gate. Closing re-reads live and marks the controller's gates due
  (`markGatesDue` sets `state.gatesDue` — upstream has no public verb; wanted:
  `selectionChanged()` marking gates due too). Test:
  `browser-test/logic/schwung-canvas-dive.mjs`.
- **File browser preview + `browser_hooks`** (done, same day): honoured by
  movy's browser (`browser/file-preview.ts`). Correction to the first note: the
  modules that SERVE them are mrdrums (preview + `ui_auto_select_pad=off`,
  restored), MrSample, granny and tablor. DR32 0.4.1 declares its Kit browser
  only in module.json's fallback chain_params; on the device it browses kits
  through its Category/Kit list pages, which are Schwung's own and already
  worked. MOVY-mode config file params (config-pages.ts, frozen) carry no
  declaration and are unchanged. Test: `browser-test/logic/file-preview.mjs`.

---

## 7. 2026-10-05 — legacy racks plan from their movy_config (user's ruling)

"Old modules behave better with movy_config." Under SCHWUNG pages, a module's
config now **outvotes its declaration for PAGES** when both hold:

- the config describes a rack: a sibling voice run (6w6/8w8/9w9/cw78, as
  before), or a **pad-scoped** drum config (`padScoping` or `currentPadParam`,
  not `rawMidi`), which translates to one plain page per bank, in bank order;
- the declaration is not a **modern rack** (`model/modern-rack.ts`):
  `pad_layout: "drums"`, a level with `child_prefix`, or a `child_key_template`
  containing `{index}`.

In: forge (its voice levels are `{key}` passthroughs), mrdrums, weird-dreams,
signal (user: include), libpo32. Out: simian, dr32, sophie (user: keep its
declared pages; its `p{index}_{key}` template is what separates it from forge),
6w6/9w9 (`pad_layout`), krautdrums/essaim/slicer (raw-MIDI note maps). A synth
config never translates, so it never outvotes anything.

- Slots go inline (`{key, type, label, min, max, options, …}`): the alias keys
  have no `chain_params` entry, and a real entry still outranks inline.
- The verdict is memoized per declared text, module id included, and gives up
  waiting for an id after 3 unanswered asks. Asking the id on every ask cost
  `schwung-page-idle-cost` one trip per reload poll (43 → 49 against a 48
  budget, before the fix).
- Matrix: weird-dreams opens on Voice, forge on Osc (lanes `pv3_wave` /
  `pv16_wave`, exact), libpo32 gains rows 3/16 that sound and draw. forge no
  longer **jumps** on a pad press. That matches MOVY mode (its banks carry no
  `pad`), and D7 for forge now means "the page edits the pressed voice".
- Tests: `config-hierarchy.mjs` (pad-scoped translation, inline enum metadata,
  raw-MIDI/synth → null, the modern-rack cases); `schwung-page.mjs` (6w6 and
  mrdrums, each against a plain and a modern contract). Teeth: with the
  override removed, 10 checks go red.

### §7 follow-ups (same day)

- **Pad icon.** A translated `padSpecific` bank carries `movy_pad_scoped` on its
  level, and the chrome lights the icon on it (`hier.padScopedLevel`). The seat
  still answers for declared voices. Test: `drum-seat.mjs` (forge, mrdrums,
  weird-dreams page by page; 9 red without it). Screenshot `page_config_pad`.
- **Graphics.** `model/config-viz.ts` turns `env`/`filter`/`lfo`/`render: vbar|hbar`
  /`env: false` into declared `viz` on the inline entries, grouped per config
  row. lfo `mode`/`retrig`/`deform` have no Schwung role and stay undeclared.
  Checked through Schwung's own `resolveViz` in `fleet-pages.mjs`: forge Filter
  is a declared filter and Mix 8 declared faders. Mod's row is Shape, Rate,
  Sync, Depth, and Sync broke Schwung's adjacency rule. `settleSpans` declares
  every role after the first adjacent run `span: false` (the contract's own
  lend-a-value role), so the wave spans Shape+Rate and Depth feeds it from its
  own cell. MOVY mode draws no wave there. Screenshot `page_config_mod`. Screenshots `page_config_filter`, `page_config_mix`. The dump fixture
  serves no values for forge's concrete per-pad keys, so the filter curve in the
  shot sits at its floor.

