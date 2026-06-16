# Parameter Automation — Design (Tier B, engine-emitted CC)

Date: 2026-06-15
Status: design approved-in-principle; pending written-spec review before planning.

## 1. Goal

Add native-Move-style **parameter automation** to movy: per-step parameter
values that play back with the clip, edited on the knob param page. Aligned with
native Move where practical, simplified per the user:

- **One value per step** (no sub-step / smooth automation curves).
- Step automation by **holding a step + turning a knob** (works stopped *and*
  playing).
- **Live recording** of automation for **multiple params at once** (Rec-armed).
- **Clear** a param's automation by **holding Clear + touching its knob**.
- An **automation dot** at the top-right of an automated param's name under the
  knob.
- Holding a step shows the automated params' per-step values under the knobs
  (inverted, like a knob touch) instead of the name.
- **Duplicate** (clip and step) copies automation. A step with no notes can
  still be automated.

## 2. Why Tier B (engine-emitted MIDI CC)

Three candidate playback paths were evaluated against movy's architecture
(engine = overtake `dsp.so` that emits MIDI to the Schwung chain; synth params
are otherwise set by the UI via `shadow_set_param`):

| Tier | Path | Timing | Verdict |
|---|---|---|---|
| A | UI applies `shadow_set_param` per step-change | ~23 ms (UI tick, 44 Hz) | ~8× coarser than notes |
| **B** | **Engine emits CC; the chain maps CC→param** | **~2.9 ms (audio block)** | **chosen — as tight as notes, no patch** |
| C | movy hosts the synth `.so`s natively | per-sample | huge re-architecture; out of scope |

Key facts that make Tier B correct and feasible:

- **Notes are already block-rate (~2.9 ms), not sample-accurate.** movy collects
  a block's events and flushes them together via `host::midi_send_internal`
  (`movy-dsp/src/lib.rs` `render`/`drain_out`); the host MIDI send has no
  sample offset. So block-rate automation *matches note timing*.
- **Stock Schwung's chain has a native CC→param automation input.**
  `chain_midi.c:598-626`: **CC 102–109 (value 0–127)** sets knob 1–8's mapped
  param to `min + (val/127)·(max−min)` (rounded for int/enum), consumes the CC
  (never reaches the synth). No Schwung patch, no synth CC support needed — the
  *chain* performs the param write.
- **Each knob mapping targets any chain module.** `set_param("knob_<N>_set",
  "<target>:<param>")` with `target ∈ {synth, fx1, fx2, fx3, midi_fx1,
  midi_fx2}` (`chain_host.c:983-1045`). So a lane can automate any param of any
  module in the track's chain.

This is the same family of mechanism davebox uses for its "Sch" (chain-param)
automation, but movy needs no patched-Schwung indirection because it already
addresses real params.

### Device spike (2026-06-15) — PASSED

Verified live on `move.local` (temporary hook, since reverted):

```
shadow_set_param(slot, "knob_1_set", "synth:pad_vol")   → assignOk=true
shadow_send_midi_to_dsp([0xB0, 102, 127])  → pad_vol = 2.0000 (= max)  ✓
shadow_send_midi_to_dsp([0xB0, 102, 0])    → pad_vol = 0.0000 (= min)  ✓
```

So the assignment + CC-102 absolute path drives a chain param min↔max as
documented. Background-track routing (channel-addressed `midi_send_internal`) is
independently proven by the working 4-track note playback. Both risk legs closed.

**Finding — what is automatable:** only params resolvable as `target:param` in a
module's `chain_params` (synth / fx / midi_fx). A first attempt failed on
`g_master_vol` because **global (`g_*`) params** aren't reachable via
`knob_find_param(inst, "synth", …)`. So the automatable set excludes globals,
`filepath` params, and `enum`/params without a numeric `min`/`max`.

## 3. Model

- Per track, **up to 8 automation lanes** (`MAX_KNOB_MAPPINGS = 8`, CCs 71–78 →
  abs CCs 102–109). Accepted limit.
- Each lane targets **one arbitrary chain param** (`target:param`), chosen
  across any module in the track's chain.
- Automation is **sparse per-step locks**: a lane has a value at some steps.
  **Unrecorded steps revert to the lane's base value** (the param's manual knob
  value). A lane is "automated" (shows the dot) if it has ≥1 lock in the clip.
- **Value resolution is 7-bit (128 levels)** — the chain's abs-CC scaling.
- **Automatable params**: numeric chain params (`float`/`int` with a numeric
  `min`/`max`) of the synth or any chain FX / MIDI-FX, addressable as
  `target:param`. **Excluded:** `filepath`/`file` params, global (`g_*`) params
  (not reachable via `knob_find_param`), and `enum`/range-less params (the chain's
  abs-CC scaling needs a numeric range — `enum` support is deferred pending
  verification that the chain assigns enums a 0..count−1 range).

### Lane assignment (implicit, pool of 8)

A lane is grabbed the first time you automate a param (hold-step+turn, or
Rec+turn). On assignment the UI:

1. Picks a free lane `k` (0–7) for the track; if all 8 are used → see §6 (toast,
   restrict view).
2. `shadow_set_param(slot, "knob_{k+1}_set", "{target}:{param}")` — binds the
   chain knob mapping.
3. Tells the engine the lane is assigned + its base value (`alane`, `abase`).

Hold-Clear + touch frees the lane (clears locks and the assignment). No separate
assignment screen (YAGNI) unless the user later asks for one.

## 4. Engine (Rust `seq-core`) — source of truth

### `clip.rs`
- `Lock { lane: u8 /*0-7*/, step: u16, val: u8 /*0-127*/ }`, stored
  `locks: Vec<Lock>` per clip (sparse).
- `set_lock(lane, step, val)` (upsert), `clear_lane(lane)`, `locks_at_step(step)`,
  `automated_lanes() -> u8` (bit `k` set if lane `k` has ≥1 lock).
- Range copy/paste (`copy_steps`/`paste_steps`) carries locks in `[s0,s1]`
  **independent of notes** (an empty step's locks copy too).
- `Clip` clone already covers `duplicate_clip` / `paste_clip`.

### `track.rs`
- Per-track lane state: `lane_assigned: [bool;8]`, `lane_base: [u8;8]`.

### `engine.rs`
- New `OutEvent::Cc { track: u8, lane: u8, val: u8 }`.
- `service_tick`: on the tick a track's playhead **enters a new step**, for each
  assigned lane emit `Cc` with the step's lock value if present, else the lane
  base (revert-to-base). Emitted only on step entry, not every tick.
- Commands (`command.rs`): `aset <t> <lane> <step> <val>`,
  `abase <t> <lane> <val>`, `aclr <t> <lane>`, `alane <t> <lane> <0|1>`.
  `abase` also emits the lane's CC immediately (live apply when stopped / for
  audition; see §6).
- `status()` additions (UI ignores unknown keys): `alanes=<hex>` (assigned),
  `aauto=<hex>` (lanes with ≥1 lock → dots), `hauto=<lane:val.lane:val…>`
  (locks at the **held** step, for the held-step display).

### `lib.rs`
- `drain_out`: `OutEvent::Cc { track, lane, val }` →
  `host::midi_send_internal(0xB0 | track, 102 + lane, val)`.
- **Bump `ENGINE_VERSION`** (and `src/seq/constants.ts` to match — build-time
  guard).

### `persist.rs`
- Serialize per-clip locks + per-track lane assignment/base. Bump persist format
  (tolerant load of older files).

## 5. UI (`src/seq`, `src/model`, `renderer`)

- **Lane registry** (UI mirror): `(slot, paramKey) → lane`, plus free-pool
  tracking per track. Drives assignment (§3) and the dot/value rendering.
- **Automatable knobs are engine-driven.** For an assigned lane, manual knob
  turns (stopped, no step held) go through `abase` (engine emits the CC live) —
  a single source of truth, avoiding `shadow_set_param`/CC divergence on that
  param. Non-automated knobs keep today's `shadow_set_param` path unchanged.
- **Knob while a step is held** → `aset` at the **held** step (not the
  playhead). Works **stopped and playing** (§6). The held step's value shows
  inverted under the knob.
- **Knob while Rec + playing** (no step held) → `aset` at the **current playing**
  step; multiple knobs turned = multiple lanes recorded simultaneously.
- **Hold-Clear + knob touch** → `aclr` the lane + free it. Intercept in
  `midi/router.ts` before `handleKnobTouch` (Clear = `CC_DELETE` 119, tracked by
  `deleteActive()`).
- **Rendering** (`renderer/label.ts`): automation **dot** at top-right of a
  label when its lane has ≥1 lock; held-step shows the step's value inverted
  (reusing the `touched` render path). `model/` stays pure — `app/tick.ts`
  passes an `AutomationView` snapshot into `buildViewModel` (no `seq/` import in
  `model/`).

## 6. Step-hold behavior (stopped and playing)

Holding a step enters **automation-edit** on the knob grid:

- **Below the 8-lane limit:** show the current page's **automatable** params
  (file / non-automatable hidden). Assigned lanes show their **held-step value**
  (inverted) + dot; unassigned automatable params show the name and can be
  grabbed by turning their knob.
- **At the 8-lane limit:** restrict the grid to **exactly the 8 assigned lanes**
  (hide everything else, even automatable-but-unassigned params), and show a
  **bottom toast** indicating the limit. The 8 lanes may span multiple
  modules/pages; the UI renders them from the lane registry (label + per-step
  value) without needing to be on each param's page.
- **Transport independence:** the hold-step edit always targets the *held*
  step's lock, whether the clip is **stopped or playing**.
  - *Stopped:* turning the knob writes the lock and the engine emits that
    lane's CC live (`abase`/`aset` apply path) so the held step's value is
    audible (audition); on release the lane reverts to base.
  - *Playing:* the edit updates the held step's lock while playback continues;
    the new value takes effect when the playhead next reaches that step (the
    engine emits per-step on step entry).

## 7. Constraints (accepted)

- 8 automation lanes per track.
- 7-bit (128-level) value resolution.
- Lanes target arbitrary chain params (synth / FX / MIDI-FX); `file` excluded.

## 8. Tests

- **Rust (`cargo test`)**: lock set/clear/upsert; copy-range carries locks
  (incl. note-less steps); duplicate carries locks; `Cc` emission on step entry
  with revert-to-base; `abase` immediate emit; status `alanes`/`aauto`/`hauto`;
  persist round-trip.
- **`logic.mjs`**: lane assignment + pool-full refusal; held-step→`aset`;
  Rec+turn→`aset` at playing step; clear frees lane; base mirroring;
  value↔7-bit mapping.
- **`app-loop.mjs`**: a playing clip with locks emits the correct
  `CC 102+lane` per step via the MIDI capture harness; revert-to-base on
  unlocked steps.
- **`screenshot.mjs`**: new baselines — automation dot; held-step inverted
  value; non-automatable params hidden during hold; limit-reached restricted
  grid + bottom toast.
- **`perf.mjs`**: CC emission bounded (≤ one per assigned lane per step entry,
  not per tick); IPC for assignment is interaction-rate only.
- **Device (`test-seq.sh`)**: deploy engine+UI; verify automation plays back and
  survives persistence; **spike to confirm** `knob_{N}_set` + CC 102–109 drive a
  background (non-focused) track's chain param.

## 9. Open implementation details (resolve in the plan)

- Exact wiring of the "automatable knob → engine-driven" switch vs. the existing
  `model/store.ts` `applyKnobDelta` path.
- Rendering the cross-module 8-lane grid during limit-reached step-hold (labels
  for params not on the current page come from the lane registry).
- Whether `abase` should also persist (resting value) — default: yes, base is
  part of lane state.
