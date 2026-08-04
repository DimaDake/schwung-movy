# Undo / Redo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or
> superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give movy a global undo/redo stack (Undo = CC 56, Redo = Shift+CC 56)
covering every musical edit — clips, notes, automation, chain params, modules —
with a toast naming what changed.

**Architecture:** One UI-side stack; three domains. The Rust engine holds a
snapshot ring addressed by integer id (no blob ever crosses IPC); chain params
use inverse writes recorded at the mutation site; module swaps dump and replay
the outgoing module's params. Design: `plans/2026-08-04-undo-redo-design.md`.

**Tech Stack:** TypeScript (esbuild → `ui.js`, QuickJS), Rust (`seq-core`,
`movy-dsp` → `dsp.so`), node `.mjs` test suites.

## Global Constraints

- **File size: 200 lines hard limit, 50–100 target.** Split rather than exceed.
- `model/` never calls display functions; `renderer/` holds no state;
  `src/types/` never imports from the rest of `src/`.
- `ENGINE_VERSION` must match between `crates/movy-dsp/src/lib.rs` and
  `src/seq/constants.ts` — **bump it in both** when engine commands change.
- Engine sets must use `host_module_set_param_blocking`.
- Comments explain WHY, never WHAT.
- No code duplication — refactor to a shared location first.
- Undo may only issue operations that already exist as forward operations.

**Standard cycle for every task:** write the failing test → run it, confirm it
fails for the stated reason → implement → run it, confirm pass → run
`npm test` → `git add <specific files>` and commit. Never `git add -A`.

**Full local suite:**
```bash
cd movy && npm run build:browser
node browser-test/logic.mjs && node browser-test/dump-replay.mjs \
  && node browser-test/app-loop.mjs && node browser-test/screenshot.mjs \
  && node browser-test/perf.mjs
(cd engine && cargo test)
```

---

## File Structure

**Create:**

| File | Responsibility | Est. |
|---|---|---|
| `src/undo/types.ts` | `UndoEntry`, `ParamOp`, `ModuleOp`, `ClosePolicy` | 60 |
| `src/undo/state.ts` | undo + redo stacks, push/pop, eviction, invalidation | 100 |
| `src/undo/group.ts` | `beginEdit`/`endEdit`, open group, close policies, `undoTick` | 120 |
| `src/undo/record.ts` | `recordParamOp`/`recordModuleOp`, snapshot id allocation | 80 |
| `src/undo/apply.ts` | `undo()`/`redo()` — domain ordering, assertions | 130 |
| `src/undo/label.ts` | verb/target/detail composition | 70 |
| `src/undo/verbs.ts` | engine verb classification (mirrors `command.rs`) | 60 |
| `src/renderer/undo-overlay.ts` | the three-line toast | 60 |
| `src/chain/set-param.ts` | `setChainParam()` — the param-write chokepoint | 60 |
| `engine/crates/seq-core/src/undo.rs` | snapshot ring, `uswap`, no-op compare | 140 |

**Modify:** `seq/engine.ts` (seqEdit/seqCtl split, `unop` status field),
`seq/router.ts` (CC 56), `seq/buttons.ts` (`undoLedColor`), `app/tick.ts`
(`undoTick`, overlay draw), `types/viewmodel.ts` (`UndoToastVM`),
`crates/seq-core/src/command.rs` (`is_undoable_edit`, `u*` verbs),
`crates/seq-core/src/engine.rs` (ring field, status), `crates/movy-dsp/src/lib.rs`
(ENGINE_VERSION), `src/seq/constants.ts` (ENGINE_VERSION).

---

# PHASE 1 — Foundation + engine domain

### Task 1: Engine snapshot ring

**Files:** Create `engine/crates/seq-core/src/undo.rs`; modify `lib.rs`
(`pub mod undo;`), `engine.rs`, `command.rs`.

**Produces:**
```rust
pub struct UndoRing { /* … */ }
impl UndoRing {
    pub fn new() -> Self;
    pub fn snap(&mut self, id: u32, payload: String);
    pub fn take(&mut self, id: u32) -> Option<String>;
    pub fn peek(&self, id: u32) -> Option<&str>;
    pub fn drop_id(&mut self, id: u32);
    pub fn clear(&mut self);
    pub fn last_noop(&mut self) -> Option<u32>;   // drained by status
}
pub const MAX_SNAPSHOTS: usize = 64;
pub const MAX_BYTES: usize = 512 * 1024;
```

- [ ] **Step 1: Failing tests** in `undo.rs` `#[cfg(test)]`:
  `snap_then_peek_returns_payload`, `drop_id_frees`,
  `evicts_oldest_past_max_snapshots`, `evicts_oldest_past_max_bytes`,
  `clear_empties`.
- [ ] **Step 2:** `cd engine && cargo test undo::` → FAIL (module not found).
- [ ] **Step 3:** Implement `UndoRing` as `Vec<(u32, String)>` in insertion
  order with a running byte total; evict from the front on either cap.
- [ ] **Step 4:** `cargo test undo::` → PASS.
- [ ] **Step 5:** Commit `engine: undo snapshot ring`.

### Task 2: Transport-preserving restore + `uswap`

**Files:** Modify `engine.rs`, `undo.rs`, `command.rs`.

**Produces:** `Engine::undo_snapshot(&self) -> String`,
`Engine::undo_restore(&mut self, blob: &str)`.

`undo_restore` saves clock position, `playing`/queued slots, recording and
count-in state, and the live `link_enabled`; runs `persist::load`; restores
those fields; wraps any playhead left past a shortened clip; sets
`self.dirty = true`.

- [ ] **Step 1: Failing tests** in `engine.rs`:
  `undo_restore_keeps_transport_running`, `undo_restore_keeps_link_setting`,
  `undo_restore_wraps_playhead_past_shortened_clip`,
  `undo_restore_sets_dirty`, `uswap_round_trips` (snap A → edit → uswap →
  state == A → uswap back → state == edited).
- [ ] **Step 2:** `cargo test` → FAIL.
- [ ] **Step 3:** Implement, then wire commands in `command.rs`:
  `usnap <id>`, `uswap <restoreId> <captureId>`, `ucommit <id>`, `udrop <id>`,
  `uclr`. `ucommit` compares `undo_snapshot()` to `ring.peek(id)`; if equal it
  drops the id and records it in `last_noop`.
- [ ] **Step 4:** `cargo test` → PASS.
- [ ] **Step 5:** Commit `engine: transport-preserving undo restore`.

### Task 3: `is_undoable_edit` + status field + version bump

**Files:** Modify `command.rs`, `engine.rs` (`status()`),
`crates/movy-dsp/src/lib.rs`, `src/seq/constants.ts`.

`is_undoable_edit(verb)` sits directly beside `clears_capture` and carries the
same doc discipline. Membership = `clears_capture` **minus** `clipsel`,
`launch`, `stoptrk` (selection/transport), **plus** `mute`, `bpm`, `swing`.

`status()` gains `unop=<id>` when a no-op was drained, omitted otherwise.

- [ ] **Step 1: Failing tests:** `is_undoable_edit_excludes_selection`,
  `is_undoable_edit_includes_mute_bpm_swing`,
  `every_match_verb_is_classified` — parse `command.rs`'s own source with
  `include_str!` and assert each `"verb"` arm appears in `is_undoable_edit` or
  in an explicit `CONTROL_VERBS` list.
- [ ] **Step 2:** `cargo test` → FAIL.
- [ ] **Step 3:** Implement; bump `ENGINE_VERSION` in **both** files.
- [ ] **Step 4:** `cargo test` → PASS; `./scripts/build-dsp.sh` must not fail
  the version check.
- [ ] **Step 5:** Commit `engine: classify undoable verbs`.

### Task 4: `UndoEntry` types + stack

**Files:** Create `src/undo/types.ts`, `src/undo/state.ts`.
**Test:** `browser-test/logic.mjs`.

**Produces:**
```ts
export interface ParamOp  { slot: number; key: string; old: string; new: string }
export interface ModuleOp { slot: number; componentKey: string;
                            oldModuleId: string; newModuleId: string;
                            oldParams: [string, string][] }
export interface UndoEntry {
    verb: string; target: string; detail: string;
    seqSnap?: { before: number; after: number };
    paramOps: ParamOp[]; moduleOp?: ModuleOp;
    setUuid: string; engineGen: number;
}
// state.ts
export function pushEntry(e: UndoEntry): void;
export function popUndo(): UndoEntry | null;
export function popRedo(): UndoEntry | null;
export function pushRedo(e: UndoEntry): void;
export function canUndo(): boolean;
export function canRedo(): boolean;
export function retractEntry(snapId: number): void;   // no-op retraction
export function invalidateUndo(reason: string): void; // clears both stacks
export function undoDepth(): number;
export function resetUndoState(): void;               // test hook
export const MAX_ENTRIES = 64;
```

Pushing a new entry clears the redo stack. Eviction drops the oldest entry and
returns its snapshot ids so the caller can `udrop` them.

- [ ] **Step 1: Failing tests:** push/pop ordering; `pushEntry` clears redo;
  eviction past `MAX_ENTRIES` drops the oldest; `retractEntry` removes by
  snapshot id; `invalidateUndo` empties both.
- [ ] **Steps 2-5:** standard cycle. Commit `undo: entry model and stack`.

### Task 5: Open group and close policies

**Files:** Create `src/undo/group.ts`. **Test:** `logic.mjs`.

**Consumes:** Task 4's stack. **Produces:**
```ts
export const CLOSE = { IMMEDIATE: 0, TOUCH_RELEASE: 1, LOOP_WRAP: 2, IDLE: 3 } as const;
export function beginEdit(o: { key: string; verb: string; target: string;
                               close: number; idleMs?: number;
                               seq?: boolean }): void;
export function recordDetail(detail: string): void;
export function endEdit(key?: string): void;   // key given → only close that group
export function closeAllGroups(): void;
export function groupOpen(): boolean;
export function openGroupKey(): string | null;
export function undoTick(): void;              // IDLE + LOOP_WRAP enforcement
export function resetUndoGroups(): void;
```

`beginEdit` with the open group's `key` joins it (no new snapshot). A different
key closes the open group first. `seq: true` allocates a snapshot id and queues
`usnap <id>`; `endEdit` queues `ucommit <id>` and pushes the entry.

- [ ] **Step 1: Failing tests:** same-key re-entry produces ONE entry;
  different-key re-entry closes the first and produces TWO; `IDLE` closes after
  `idleMs` of `undoTick`s; `LOOP_WRAP` closes on the wrap signal; `IMMEDIATE`
  closes within the call; an entry with no param ops and no seq snapshot is
  never pushed.
- [ ] **Steps 2-5:** standard cycle. Commit `undo: edit grouping`.

### Task 6: seqEdit/seqCtl split + verb classification mirror

**Files:** Create `src/undo/verbs.ts`; modify `src/seq/engine.ts`.
**Test:** `logic.mjs`.

**Produces:** `seqEdit(op)` (asserts an open group in dev builds), `seqCtl(op)`,
`isUndoableVerb(verb)`. `seqCmd` stays as a deprecated alias that routes by
classification, so no call site breaks before Task 9 migrates it.

- [ ] **Step 1: Failing tests:** **guard layer 2** —
  `every_command_rs_verb_is_classified` reads
  `engine/crates/seq-core/src/command.rs` with `readFileSync`, extracts every
  `"verb"` literal in a `match verb` arm (including `|`-joined arms), and
  asserts each appears in `UNDOABLE_VERBS` or `CONTROL_VERBS` in `verbs.ts`.
  Plus: `seqEdit` with no open group throws.
- [ ] **Steps 2-5:** standard cycle. Commit `undo: engine command chokepoint`.

### Task 7: Apply — undo(), redo(), invalidation

**Files:** Create `src/undo/apply.ts`. **Test:** `logic.mjs`.

**Produces:** `undoOnce(): UndoResult`, `redoOnce(): UndoResult`,
`onSetSwitch(uuid)`, `onEngineGeneration(gen)`,
`type UndoResult = { ok: boolean; verb: string; target: string; detail: string; reason?: string }`.

Order within an entry: `moduleOp` (async, Phase 3) → `paramOps` in reverse →
`uswap(before, after)` → **`requestLabelSync()`** (§2.1 of the design: the
schwung-side `knob_N_set` mapping is not in the snapshot) → `requestLaneWarm`
when a `moduleOp` was applied.

- [ ] **Step 1: Failing tests:** undo pops and pushes to redo; redo restores;
  `uswap` is queued with the right ids; **`requestLabelSync` is requested after
  every seq restore** (remove that line and the test must fail); param ops apply
  in reverse; set switch and engine-generation change invalidate; undo on an
  empty stack returns `ok: false` with `reason: 'empty'`.
- [ ] **Steps 2-5:** standard cycle. Commit `undo: apply and invalidation`.

### Task 8: Toast overlay + labels

**Files:** Create `src/undo/label.ts`, `src/renderer/undo-overlay.ts`; modify
`src/types/viewmodel.ts`, `src/app/tick.ts`.
**Test:** `browser-test/screenshot.mjs`.

**Produces:** `undoToastVM(): UndoToastVM | null`, `showUndoToast(r: UndoResult, redo: boolean)`,
`drawUndoOverlay(vm: UndoToastVM)`. `UndoToastVM = { head: string; verb: string; detail: string }`.

Boxed, full width, ~1 s. Drawn in `app/tick.ts` beside `drawCaptureOverlay`
(above the volume overlay, below the leave modal). Labels shortened with
`renderer/shorten.ts`.

- [ ] **Step 1:** Add three `screenshot.mjs` scenes — `undo-toast`,
  `redo-toast`, `undo-empty` — and run `node browser-test/screenshot.mjs`
  → FAIL (missing baselines).
- [ ] **Step 2:** Implement, then `node browser-test/screenshot.mjs --update`
  and **eyeball each new PNG** before accepting it.
- [ ] **Step 3:** `node browser-test/screenshot.mjs` → 0 failures.
- [ ] **Step 4:** Commit `undo: toast overlay`.

### Task 9: Button, LED, and engine-domain call sites

**Files:** Modify `src/seq/router.ts`, `src/seq/buttons.ts`, `src/app/tick.ts`,
and every engine-domain edit site: `seq/edit-ops.ts`, `step-edit.ts`,
`clip-page.ts`, `main-page.ts`, `duplicate.ts`, `loop-mode.ts`, `session.ts`,
`step-rec.ts`, `automation.ts`, `mixer/track-mutes.ts`.
**Test:** `browser-test/app-loop.mjs`.

CC 56 with `d2 > 0`: `shiftHeld ? redoOnce() : undoOnce()`, then
`showUndoToast`. `undoLedColor(canUndo, canRedo, shiftHeld)` → bright when the
relevant action is available, off otherwise.

Live-record grouping: `beginEdit({ key: 'rec:' + track, close: CLOSE.LOOP_WRAP })`
on record start; `undoTick` closes it when `seqState.curStep` wraps past
`loopStart`, immediately reopening for the next pass so two loops give two undos.

- [ ] **Step 1: Failing tests** in `app-loop.mjs`: **guard layer 4** — wrap the
  schwung globals so a mutating `seqEdit` with no open group throws; then a
  table-driven round trip, one row per gesture (step toggle, clear clip,
  duplicate, loop length, transpose, quantize, trig velocity, automation lock,
  lane clear, mute, tempo): `capture status → gesture → undo → status identical
  → redo → status identical to post-edit`.
- [ ] **Steps 2-5:** standard cycle. Commit `undo: wire the Undo button`.

---

# PHASE 2 — Chain params

### Task 10: `setChainParam` chokepoint + grep guard

**Files:** Create `src/chain/set-param.ts`; modify `model/store.ts:175`,
`model/trigger.ts:145`, `model/index.ts:143,154`, `browser/file-handler.ts:96`,
`lfo/model.ts:70`. **Test:** `logic.mjs`.

**Produces:**
```ts
export function setChainParam(slot: number, key: string,
                              value: string, old: string | null): boolean;
```
Writes via `shadow_set_param` exactly as today, and calls `recordParamOp` when
a group is open and `old !== value`.

- [ ] **Step 1: Failing tests:** **guard layer 3** —
  `no_direct_shadow_set_param_outside_allowlist` walks `src/**/*.ts` and fails
  on any `shadow_set_param(` outside `chain/set-param.ts`, `lfo/assign.ts`,
  `mixer/track-volume.ts`, `browser/handler.ts`, `app/tick.ts`,
  `model/hierarchy.ts`, `keyboard/drum-handler.ts`. Plus: a write with
  `old === value` records no op.
- [ ] **Steps 2-5:** standard cycle. Commit `undo: chain param chokepoint`.

### Task 11: Knob touch grouping

**Files:** Modify `seq/automation.ts` (`automationKnobTouched`/`Released`),
`seq/main-page.ts`, `seq/clip-page.ts`, `seq/step-page.ts`, `model/store.ts`.
**Test:** `logic.mjs`, `app-loop.mjs`.

Touch opens `beginEdit({ key: 'knob:' + slot + ':' + paramKey,
close: CLOSE.TOUCH_RELEASE, idleMs: 600 })`; release closes it. The idle
fallback covers turns that arrive with no touch event.

- [ ] **Step 1: Failing tests:** many deltas between touch and release produce
  ONE entry whose `old` is the pre-touch value and `new` the post-release value;
  turning knob A then knob B without releasing produces TWO; a turn that returns
  to its starting value produces NONE; a turn with no touch event closes after
  `idleMs`.
- [ ] **Steps 2-5:** standard cycle. Commit `undo: knob gesture grouping`.

### Task 12: LFO assign and track volume

**Files:** Modify `src/lfo/assign.ts`, `src/mixer/track-volume.ts`.
**Test:** `logic.mjs`.

`assignLfoTarget` wraps its three writes in one `IMMEDIATE` group — three
`ParamOp`s in one entry — **and** captures the target param's current value so
undo restores the knob to its pre-LFO position. `clearLfoTarget` likewise.
Track volume opens its group in `beginDivert` and closes it in `endDivert`.

- [ ] **Step 1: Failing tests:** an LFO assign yields exactly one entry with
  four ops (target, target_param, enabled, driven param); undoing it restores
  the driven param's pre-assign value; a volume gesture from `volumeTrackDown`
  through `volumeTrackUp` yields one entry.
- [ ] **Steps 2-5:** standard cycle. Commit `undo: LFO assign and track volume`.

---

# PHASE 3 — Modules and presets

### Task 13: Module dump

**Files:** Create `src/undo/module-dump.ts`; modify `browser/handler.ts`.
**Test:** `logic.mjs`, `dump-replay.mjs`.

**Produces:** `dumpModuleParams(slot, componentKey): [string, string][]` —
reads `chain_params` for the key list and takes values from the model's mirror,
falling back to `shadow_get_param` for keys the hierarchy doesn't expose.

- [ ] **Step 1: Failing tests:** a dump covers every `chain_params` key;
  `loadSelectedModule` records a `ModuleOp` carrying the outgoing id and dump;
  reselecting the same module records nothing. In `dump-replay.mjs`, assert the
  dump is non-empty for every one of the 76 real modules in `docs/module-dump/`.
- [ ] **Steps 2-5:** standard cycle. Commit `undo: module param dump`.

### Task 14: Async module restore + identity assertion

**Files:** Create `src/undo/module-apply.ts`; modify `src/undo/apply.ts`,
`src/app/tick.ts`. **Test:** `logic.mjs`, `app-loop.mjs`.

**Produces:** `beginModuleRestore(op: ModuleOp, done: () => void)`,
`moduleRestoreTick()`, `moduleRestorePending(): boolean`.

State machine: assert the live module id equals `op.newModuleId` (mismatch →
`invalidateUndo('module drift')` + `UNDO UNAVAILABLE` toast) → write
`oldModuleId` → poll until the live id matches → replay `oldParams` →
`requestLaneWarm(slot)` → restore the entry's `seqSnap` → `requestLabelSync()`.
Timeout after `MODULE_RESTORE_TICKS` → toast failure and invalidate.

- [ ] **Step 1: Failing tests:** a full restore writes the old id then replays
  every param, in that order; a drifted module id invalidates both stacks and
  applies nothing; a timeout invalidates; the seq snapshot is restored **after**
  the module is up, not before.
- [ ] **Steps 2-5:** standard cycle. Commit `undo: module restore`.

### Task 15: Preset loads

**Files:** Modify `src/model/preset-param.ts`, `src/model/index.ts`.
**Test:** `logic.mjs`.

A preset load is a module-domain entry: dump before, restore after, same
machinery as Task 14 with `oldModuleId === newModuleId`.

- [ ] **Step 1: Failing test:** a preset change records an entry whose undo
  replays the pre-load param dump.
- [ ] **Steps 2-5:** standard cycle. Commit `undo: preset loads`.

---

### Task 16: Docs and device verification

**Files:** Modify `MANUAL.md` (replace the "No undo" line at :826 with a real
section; add Undo and Shift+Undo to the Controls reference in §8),
`README.md` (one Features bullet + screenshot), `CHANGELOG.md`;
extend `scripts/test-seq.sh`.

- [ ] **Step 1:** `node scripts/make-doc-assets.mjs undo-toast` and reference
  `docs/assets/undo-toast.png`.
- [ ] **Step 2:** Extend `scripts/test-seq.sh`: build a scene with engine
  commands, toggle a step, inject CC 56, and assert via `status` that the step
  is gone; then Shift+CC 56 and assert it is back. Use `ts_tap_cc` so the whole
  gesture is one device-side script.
- [ ] **Step 3:** Device run — `ssh -o ConnectTimeout=3 ableton@move.local echo ok`
  then `./scripts/test-seq.sh`, or report **DEVICE OFFLINE** in CAPS.
- [ ] **Step 4:** Commit `undo: docs and device coverage`.

---

## Self-review

- **Spec coverage.** §1 scope → Tasks 9 (engine domain), 10-12 (params), 13-15
  (modules/presets). §2.1 engine ring → 1-3; the two-sided lane binding →
  Task 7's `requestLabelSync` assertion. §2.2 eight write paths → Task 10
  (five), 12 (two), excluded (`drum-handler`) recorded in the allowlist.
  §3 grouping → 5, 11, 12; close policies all exercised. §4 invalidation → 7
  and 14. §5 memory → 1 and 4. §6 UI → 8 and 9. §10 guards → layer 1 (Task 6,
  10), layer 2 (Task 6), layer 3 (Task 10), layer 4 (Task 9). §11 testing →
  every task names its suite; docs → Task 16.
- **Placeholders:** none — every task names exact files, exported signatures,
  and named test cases.
- **Type consistency:** `UndoEntry`/`ParamOp`/`ModuleOp` defined once in
  `undo/types.ts` (Task 4) and referenced unchanged in Tasks 7, 10, 13, 14.
  `UndoResult` defined in Task 7, consumed in Task 8's `showUndoToast`.
  `setChainParam` (Task 10) is the only param writer used by Tasks 11-12.
