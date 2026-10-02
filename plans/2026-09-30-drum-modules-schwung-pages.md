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
| D4 | **Precedence:** a module's declared **drum surface** > module-shipped `movy_config.json` > movy's bundled config > generic. A declaration counts as a drum surface only if it has `pad_layout: "drums"` or a child level with `child_index_param` (D9). movy_config becomes a **frozen compatibility reader** — no new fields. | The user's first instinct was config-first (true for forge/weird-dreams); this ordering keeps that for them, because neither declares a drum surface, so they fall through to their configs. The user accepted trying it this way. |
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
- **D14 is half done.** The engine and the bind handle enums (by index or by
  name, equal bins) and booleans. NOT done: the UI still marks schwung-page
  enums non-automatable, `KnobParamInfo.options`/`wiresNames` are not filled
  by either page owner, the held-step detent is not one-option-per-detent,
  and the held arc denormalizes an enum lock with `denorm7` (rounding), not
  the engine's bins. Until then an enum a movy config forces automatable
  binds as `i|min|max` — the same rounding the CC path used.
- **Device check added:** `automation` P5 reads the binds and samples the bound
  param through the chain while the clip plays — the first check that
  automation is actually applied, not just drawn.

### Phase 3 — Held-step and lane visuals on drum pages

Fix whatever Phase 1(d) names. Acceptance: hold a step, turn a per-pad knob on
weird-dreams / mrdrums / sophie / 6w6 — the arc shows the lock value, the lane
mark appears, playback moves the arc on the right pad only. Screenshot scenes
for the held state.

### Phase 4 — movy owns drum focus (D8)

- Seat follows physical presses only; module focus reads are ignored for
  navigation.
- Write `child_index_param` on press where declared.
- Test: a sequenced note on 9w9 does not move the page; a finger press does.

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

### Phase 6 — Config-free rack rule (D4, D9)

- Extend `effectiveDrumConfig` / the surface reader with the
  `child_index_param` rule and the precedence in D4.
- Test: sophie **with its movy_config removed** is a 16-pad rack with correct
  pads, pages and automation.

### Phase 7 — 32-pad grid (D10)

- `drum-grid.ts`: 8-wide when `padCount > 16`; LEDs, pad-route, mutes follow the
  one geometry module.
- Test with dr32's shipped hierarchy.

---

## 4. Per-module acceptance

| Module | Pages | Pad → page | Automation sounds | Automation draws |
|---|---|---|---|---|
| 6w6 / 8w8 / 9w9 / cw78 | one voice seat + rest | D7; 9w9 no self-jumping | ✔ (movy chain) | ✔ |
| mrdrums | template, one block | D7 | ✔ | ✔ |
| sophie | its own `ui_pages` (D4) | D7 via D9 | ✔ incl. pad 16 | ✔ |
| simian | template, 3 child levels = block | D7 | ✔ | ✔ |
| forge / weird-dreams | movy_config (D11) | D7 | ✔ | ✔ |
| libpo32 / krautdrums | movy_config | best effort | best effort | best effort |
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
