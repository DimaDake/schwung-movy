# Undo / Redo — design

**Date:** 2026-08-04
**Status:** design approved, implementation not started
**Buttons:** Undo = CC 56, Redo = Shift + CC 56 (matches Move OG, manual §"Undo")

Movy has no undo today. `src/seq/buttons.ts:46` reports the Undo LED as "no movy
action yet", and `MANUAL.md:826` tells the user outright: *"No undo. There's no
undo history; edits are immediate."* This design replaces that with a single
global undo stack covering every musical edit movy can make.

---

## 1. Scope

**Undoable** — the four categories, all in:

| Category | Examples |
|---|---|
| Clip/note content | step toggles, pad-into-step entry, step-record, live record passes, clip clear/delete/copy/paste/duplicate, loop length + start, bar copy, transpose, quantize, per-step trig params (velocity, length, probability, condition, invert) |
| Automation | step locks, lane base changes, clearing a lane or a single step's lock, lane assign/free — **including** the side effects (clearing a clip drops its lane) |
| Chain params + modules | knob turns on any param page, LFO params, LFO target assignment, track volume, module load/swap, preset load, sample/file pick |
| Set-level settings | tempo, swing, root/key, clip scale, clip transpose, track mute |

**Not undoable** — anything that doesn't change the music:

- View and selection: active track, selected clip, bar/page navigation,
  Session/Note mode, opening the browser, the drum module's focused pad
  (`keyboard/drum-handler.ts:39` writes `currentPadParam`, which is view state).
- Transport: play/stop, record arm, metronome, count-in.
- **Transport link / Move clock follow** — explicitly excluded. A snapshot
  carries `link` (`persist.rs`), so the restore path must preserve the *live*
  link setting rather than apply the recorded one.
- **Keyboard layout** and root-note/octave shifts.
- Automation lane *mapping* infrastructure (`knob_N_set`, `app/tick.ts:250/275`).

**Undo never moves the view.** When an undo affects something off-screen the
toast names where it happened (`T3 · CUTOFF`) and the view stays put.

---

## 2. Architecture: three domains, one stack

Movy's state lives in three places, and each needs a different inverse. The
undo *stack* is single and global, in the UI; each entry may carry work for any
combination of domains, because one user action often touches several.

```
UndoEntry {
  verb:      string          // "CLEAR CLIP", "CUTOFF", "LOAD MODULE"
  target:    string          // "T2 · CLIP 3"
  detail:    string          // "12 NOTES"  |  "0.42 -> 0.31"
  seqSnap?:  { before: id, after?: id }   // engine domain
  paramOps:  ParamOp[]                     // chain-param domain
  moduleOp?: ModuleOp                      // module/preset domain
  setUuid:   string          // the set this entry belongs to
  engineGen: number          // engine generation at capture
}
```

### 2.1 Engine domain — snapshot ring in Rust

Everything in `seq-core` — clips, notes, loop length/start, trigs, automation
locks, lane assignment/base/label, tempo, swing, mute — is covered by **one**
mechanism: a snapshot of `persist::serialize(&engine)`.

This is the right shape precisely because the requirement is *"restore the side
effects too"*. Clearing a clip that also frees its automation lane is undone by
restoring the whole engine, not by replaying hand-written inverses that rot the
first time someone adds a command.

New engine commands (`crates/seq-core/src/command.rs`):

| Command | Meaning |
|---|---|
| `usnap <id>` | serialize current state into snapshot slot `id` |
| `uswap <restoreId> <captureId>` | capture current into `captureId`, **then** restore `restoreId` — atomic, and the single primitive both undo and redo use |
| `ucommit <id>` | compare current state to snapshot `id`; discard it if identical (no-op suppression) |
| `udrop <id>` / `uclr` | free one slot / all slots |

`uswap` makes undo and redo symmetric: undo is `uswap(before, after)`, redo is
`uswap(after, before)`. No separate redo bookkeeping in the engine.

Allocation on the command path is already normal here — `set_param("cmd", …)`
and `get_param("status")` both build Strings in the same handler
(`crates/movy-dsp/src/lib.rs:38-76`) — so snapshotting costs nothing new
architecturally. **No blob ever crosses IPC**: the UI sends a command with an
integer id, never the state itself. That is the whole reason the ring lives in
the engine rather than the UI.

**Transport-preserving restore.** `persist::load` deliberately resets transport
(`persist.rs:3-7`: "Transport state … is deliberately not saved"). `uswap` must
*not* use it as-is. It saves the transport fields — clock position, playing and
queued slots, recording/count-in state, and the live `link` setting — runs the
load, then puts them back. Two consequences to handle explicitly:

- If the restore shortens a clip below the current playhead, the playhead is
  wrapped back into range rather than left out of bounds.
- `uswap` sets `engine.dirty = true`. Without it, autosave never persists the
  undone state and the undo is silently lost at the next save
  (`persist.ts:95`).

`uswap` must also not disturb the dirty-flag side effect that
`get_param("state")` has (`lib.rs:70`), which movy's autosave depends on.

**Automation lanes are bound on two sides, and the snapshot only holds one.**
This is load-bearing enough to state on its own:

- *Engine side* — `lane_assigned` / `lane_base` / `lane_label` are inside
  `persist::serialize`, so a snapshot restores them.
- *schwung side* — `shadow_set_param(slot, 'knob_<N>_set', '<component>:<param>')`
  is the chain-knob mapping that makes the engine's playback CCs actually land
  on the right param. **It is not in the snapshot.**

So a restore that changes lane assignment leaves the schwung-side mapping
stale: automation then drives the wrong param, or silently no-ops, with an
intact-looking UI — the exact failure mode recorded in
`project_reselect-synthparams-cache`.

Movy already has the repair, and the precedent is exact.
`persist.ts:pushToEngine` pairs every state restore with `requestLabelSync()`
("Restore carries the lane labels/assignments; re-request the label sync so the
automation registry reflects the just-loaded set", `persist.ts:56-59`), which
drives `syncLabelsFromEngine` at `app/tick.ts:244-264` to rebuild the registry
*and* re-apply each lane's chain knob mapping. **An undo restore is the same
operation and must do the same thing: `uswap` is always followed by
`requestLabelSync()`**, plus `requestLaneWarm(track)` when the entry also
carries a `moduleOp` (the reload empties the host's abs-CC param cache).

There is a safety net — `verifyLaneMappings` round-robins stale mappings back
into place every `LANE_VERIFY_TICKS` (`app/tick.ts:269-278`) — but it repairs
slowly, so the design must not lean on it. It is the second line, not the first.

### 2.2 Chain-param domain — inverse writes

Chain params are *not* in the engine. They live in schwung's chain, reachable
only as `shadow_set_param(slot, key, value)`. Here an inverse journal is the
correct mechanism, not snapshots: a param write has **no side effects** — the
value written is the whole truth — and the old value is already in hand at
every mutation site (movy keeps `s.knobValues[gi]` as its mirror), so recording
costs zero extra reads.

```
ParamOp { slot: number, key: string, old: string, new: string }
```

Undo writes `old` back through the identical call the forward edit used. Ops
within an entry are applied in reverse order of recording.

**The eight write paths**, five of which share a `Model` chokepoint:

| Path | Handling |
|---|---|
| `model/store.ts:175` | knob turns — chokepoint |
| `model/trigger.ts:145` | trigger/action params — chokepoint |
| `model/index.ts:143/154` | enum + file commits — chokepoint |
| `browser/file-handler.ts:96` | sample/file pick — chokepoint |
| `lfo/model.ts:70` | LFO depth/rate/phase. The track-LFO page is a Model-conforming virtual slot (`componentKey: 'lfo'`, `lfo/model.ts:267`), so its knobs are structurally identical to synth params — but it has its **own** set function, so the chokepoint must be applied there too, not only in `store.ts` |
| `lfo/assign.ts` | **LFO target assign** — writes three keys atomically (`target`, `target_param`, `enabled`). One entry, three `ParamOp`s. This is the case that forces `paramOps` to be a list |
| `mixer/track-volume.ts:139` | `slot:volume` via CC 79. Gesture boundaries already exist (`beginDivert`/`endDivert`, `volumeTouch`) and map straight onto `beginEdit`/`endEdit` |
| `keyboard/drum-handler.ts:39` | focused drum pad — **excluded**, view state |

**LFO assign restores the driven param.** Assigning an LFO makes the DSP move
the target param continuously, so clearing the assignment alone would strand
the knob wherever the LFO parked it. The entry therefore also captures the
target param's value at assign time and restores it — undoing an LFO assign
returns the knob to its pre-LFO position.

### 2.3 Module / preset domain — dump and replay

`shadow_set_param(slot, 'fx1:module', id)` is destructive: schwung tears the old
module down and the new one comes up with defaults. The inverse needs the old
module *and* everything it held — all of which movy can read before the swap,
and mostly already does.

```
ModuleOp {
  slot: number, componentKey: string,
  oldModuleId: string, newModuleId: string,
  oldParams: [key, value][]      // dumped pre-swap
}
```

Sources: old id from `shadow_get_param(slot, moduleReadKey(componentKey))`
(already read in `browser/handler.ts:49`), the key list from `chain_params`
(already read in `hierarchy.ts:72`), values from movy's mirror, falling back to
a read for keys the hierarchy doesn't expose.

Undo is asynchronous — write the old module id, wait for the module to come up,
then replay the dump. Movy already has both halves of this: `hierarchy.ts:50-54`
pushes `setOnLoad` params after a load, and `requestLaneWarm` handles the
post-reload param-cache warm. A small state machine drives it:

```
issue module set -> poll until moduleId matches (pollModuleName already does this)
  -> apply oldParams -> requestLaneWarm -> restore seqSnap (if the entry has one)
```

Module first, then the engine snapshot: automation lanes reference param keys,
so the module must exist before the lane warm can bind them. On timeout, toast
a failure and clear both stacks rather than leave a half-applied undo.

Preset loads use the same machinery (`model/preset-param.ts`).

---

## 3. Grouping

### 3.1 Module layout

A new `src/undo/` directory, sized to the 200-line hard limit / 50–100 target:

```
src/undo/
  state.ts     the stack + redo stack, entry type, budget and eviction   (~90)
  group.ts     beginEdit/endEdit, the open group, close policies         (~100)
  record.ts    recordParamOp / recordModuleOp, snapshot id allocation    (~70)
  apply.ts     undo() / redo(): domain ordering, assertions, invalidation (~110)
  label.ts     verb / target / detail composition                       (~60)
src/renderer/undo-overlay.ts   the toast                                 (~50)
```

`undo/` depends on `seq/engine.ts` (to queue commands) and on nothing in
`renderer/`; the overlay reads a plain VM, matching the existing boundary rule
that renderers never touch state.

### 3.2 The open group

A gesture spans many ticks, so a lexical `withEdit(fn)` wrapper cannot express
it. The mechanism is an **open group with an explicit close policy**:

```ts
beginEdit({
  key:   'knob:T1:cutoff',        // identity — what re-entry joins
  verb:  'CUTOFF', target: 'T1',
  close: CLOSE.TOUCH_RELEASE,
})
```

| Close policy | Used by |
|---|---|
| `IMMEDIATE` | one-shot ops — `endEdit()` in the same call |
| `TOUCH_RELEASE` | knobs (synth, LFO, main/clip params, track volume) |
| `LOOP_WRAP` | live record passes |
| `IDLE(ms)` | fallback for turns that arrive with no touch event |

**Re-entrancy is what does the grouping.** `beginEdit` with the *same* `key` as
the open group joins it — extending the group, never nesting. A *different* key
closes the open group first, then opens a new one. That single rule produces
every behaviour asked for: repeated deltas on one knob coalesce into one entry;
moving to a second knob without releasing the first yields two entries; a live
rec pass closes itself at the wrap so two loops give two undos.

`undoTick()`, called from `app/tick.ts`, enforces `IDLE` timeouts and
`LOOP_WRAP`. Everything else closes from the input path that already knows the
gesture ended — `automationKnobReleased`, `mainPageRelease`, `volumeTrackUp`.

Groups close on:

| Kind | Closes on |
|---|---|
| Knob turn (synth, LFO, track volume) | capacitive **touch release** — already routed as `automationKnobTouched`/`automationKnobReleased`, `mainPageTouch` — with an idle-timeout fallback for turns that arrive without a touch event |
| Live record pass | the **loop wrap**. Two loops recorded = two undos |
| Step-record hold, step toggle, pad-into-step | immediately, one entry per press |
| One-shot ops (clear, delete, copy, paste, duplicate, quantize, transpose) | immediately |
| Tempo/swing/scale/transpose knobs | touch release, same as any knob |

`beginEdit` is what makes "all modifications to one parameter while the user
still holds the knob" a single undo, while the parameter itself keeps changing
immediately as it does today. Undo is a recording layer; it never defers an edit.

### No-op suppression

An entry that changed nothing is discarded, never pushed. Two checks at
`endEdit`:

- **Param domain**: drop every `ParamOp` where `old === new`.
- **Engine domain**: `ucommit <id>` makes the engine compare the current
  serialization to the before-snapshot and discard the snapshot if identical.
  A serialization compare — not an edit counter — because the case that matters
  is *change and revert within one group* (turn an automation lock up and back
  down before releasing), which a counter cannot see.

If nothing survives both checks, the entry is not pushed.

The engine's answer arrives on the next status poll (~40 ms), so the UI pushes
the entry optimistically and retracts it when the engine reports `unop=<id>`.
The failure mode is benign: an undo pressed inside that 40 ms window restores an
identical state.

---

## 4. Invalidation and assertions

| Trigger | Action |
|---|---|
| Set switch (`persist.ts:pollActiveSet`) | clear both stacks — the state they reference belongs to another set |
| Engine generation change | clear both stacks. A reloaded engine is a *different, empty* engine (`persist.ts:12-17`), and every snapshot id in it is gone |
| Module identity mismatch before a module undo | **assert**: if the currently-loaded module isn't the entry's `newModuleId`, something changed behind our back (movy can be parked with Back while the user swaps a module in Move's own UI). Clear both stacks, toast `UNDO UNAVAILABLE` |
| Param value drift | **never assert.** Automation and LFOs move param values continuously; asserting would make param undo fire almost never. Best-effort write |

The unifying rule: **an undo may only issue operations that already exist as
forward operations.** Undo introduces no write path movy doesn't already use,
which is what keeps its side-effect profile identical to the edit it reverses.

---

## 5. Memory

In-memory only, never persisted to disk (per requirement). Per-set, discarded
on set switch.

- **64 entries**, oldest evicted first.
- **Byte budget** alongside the count: engine snapshots are a few KB each
  (`persist::serialize` of 4 tracks × 8 clips), module dumps a few KB but rare.
  Cap the ring at ~512 KB and evict oldest on either limit. The engine also
  self-caps defensively, since it owns the allocations.
- Evicting a UI entry sends `udrop <id>` so the engine frees the snapshot.

---

## 6. UI

**Toast overlay** — a new `renderer/undo-overlay.ts`, boxed, full display width,
~1 s then it vanishes. Three lines: verb line (`UNDO` / `REDO`), the operation,
and the target plus detail.

```
+-----------------------------------+      +-----------------------------------+
|  UNDO                             |      |  REDO                             |
|  CLEAR CLIP                       |      |  CUTOFF                           |
|  T2 · CLIP 3 · 12 NOTES           |      |  T1 · 0.42 -> 0.31                |
+-----------------------------------+      +-----------------------------------+
```

Labels are composed at `beginEdit`/`endEdit` and kept short — 128 px at
`FONT_HEIGHT = 5`. `renderer/shorten.ts` already exists for this.

Empty stack → `NOTHING TO UNDO` / `NOTHING TO REDO` in the same overlay.

**Button and LED.** CC 56 press = undo; with Shift held = redo. `undoLedColor()`
(`seq/buttons.ts:46`) becomes real: lit when undo is available, dim when not,
and while Shift is held it reflects *redo* availability instead.

**Redo invalidation:** a new edit after an undo clears the redo stack, as
everywhere else.

---

## 7. schwung side-effect audit

Checked against `schwung/src/shadow/shadow_ui.js` (pulled 2026-08-04).

| Surface | Finding |
|---|---|
| **Move's native undo double-firing** | **Not a risk.** Under full overtake, MIDI does not reach Move — `shadow_ui.js:3431` disables overtake mode specifically "to allow MIDI to reach Move again". CC 56 is in schwung's LED-candidate list (`:639`, commented `undo`) and movy declares no `button_passthrough` (`module.json` capabilities are `claims_master_knob` + `suspend_self_managed`), so movy owns both the press and the LED |
| **Module-write bookkeeping** | movy writes `:module` directly, bypassing schwung's `chainConfigs` model — but schwung reconciles by reading back *from the DSP* (`applyComponentSelectionConfirmed` → `loadChainConfigFromSlot:6824`), and `refreshSlotModuleSignature` does the same every 30 ticks. schwung converges either way. Undo re-issues exactly the write a forward load already does, so it adds no new surface |
| **Native edits while parked** | Real. movy can be parked (Back) while the user edits in Move's own UI. Handled by the module-identity assertion in §4 |
| **Engine restore** | Must preserve transport and set `dirty` — see §2.1 |

---

## 8. Limits (stated honestly)

- Anything a module holds that movy never mirrors — a param absent from
  `chain_params`, or internal DSP state such as a loaded sample buffer — cannot
  be restored by a module or preset undo.
- Undo history is lost when movy closes. By design.
- Undo does not reach into Move's own set state (native clips, native devices);
  movy only undoes what movy changed.

---

## 9. Phases

One design, three implementation plans. Each phase ends device-verified.

**P1 — Foundation + engine domain.** Undo core (stack, entry model,
`beginEdit`/`endEdit`, invalidation, memory budget), the toast overlay, CC 56 +
Shift + LED, the engine snapshot ring (`usnap`/`uswap`/`ucommit`/`udrop`,
transport-preserving restore, no-op compare), and instrumentation of the clip,
note, loop, trig **and automation** call sites plus tempo/swing/mute/scale.
Automation comes nearly free once snapshots exist — it is already inside
`persist::serialize`, but only if every restore is paired with
`requestLabelSync()` (§2.1). P1 also lands **all four guard layers** (§10),
including `is_undoable_edit` and the `command.rs` completeness test — they are
worth least if retrofitted after the call sites exist.

**P2 — Chain params.** The `Model` chokepoint (covering `store.ts`,
`trigger.ts`, `index.ts`, `file-handler.ts`, `lfo/model.ts`), plus the two
bespoke paths: `lfo/assign.ts` (three-key atomic entry + driven-param restore)
and `mixer/track-volume.ts`. Touch-based grouping and no-op suppression.

**P3 — Modules and presets.** The dump/replay state machine, the async
re-apply, the module-identity assertion, and bundling the engine snapshot for
lane side effects.

---

## 10. Guards: a new edit cannot silently skip undo

The dominant long-term risk is not this implementation — it is the edit added
six months from now whose author never thinks about undo. "Be careful" is not a
mechanism, so four layers, each failing a test rather than relying on review.

**The codebase already establishes the pattern.** `clears_capture(verb)` in
`command.rs:49` is a centralized classification of "is this verb a user edit
gesture?", and its doc comment states the discipline exactly:

> *Listed here rather than sprinkled through the arms below so the rule can be
> read (and tested) in one place; the next edit verb someone adds shows up as an
> omission here instead of a silent bug. The rule is user intent, not traffic.*

Undo wants the same rule with a slightly different membership (`clipsel`,
`launch` and `stoptrk` clear the capture buffer but are selection/transport, so
they are not undoable; `abase`/`abaseq` are internal syncs and are excluded from
both). So we add a sibling `is_undoable_edit(verb)` beside it, under the same
discipline — extending an accepted pattern rather than inventing one.

**Layer 1 — one chokepoint per domain.**
`seqCmd` splits into `seqEdit(op)` (mutating; asserts an open group) and
`seqCtl(op)` (non-mutating: `play`, `stop`, `watch`, `wlane`, `hold`, `metro`).
Every chain-param write goes through `setChainParam()`. Both are the only doors.

**Layer 2 — completeness driven by the Rust source.** A logic test parses the
verb literals out of `command.rs`'s `match verb` arms and asserts every one
appears in exactly one classification bucket. *Adding a new engine command fails
the test until it is classified as an undoable edit or as control.* This is the
strongest guard because its input is the actual source of truth, not a
hand-maintained list that can be forgotten. The same test asserts
`is_undoable_edit` and `clears_capture` stay individually complete.

**Layer 3 — no new direct writes.** A grep test fails when a
`shadow_set_param(` appears outside the allowlisted chokepoint files. Movy
already asserts budgets this way in `perf.mjs`, so the shape is familiar.

**Layer 4 — runtime assertion + round-trip invariant.** In `app-loop.mjs`,
which already drives real MIDI through the router, the schwung globals are
wrapped so any mutating `seqEdit` or `setChainParam` firing with **no open
group** throws. Then a table-driven invariant, one row per gesture:

```
capture state -> perform gesture -> undo -> assert state identical to capture
                                 -> redo -> assert state identical to post-edit
```

Layers 1–3 catch *"you forgot to record the edit."* Layer 4 catches *"you
recorded it, but the entry doesn't restore everything"* — the partial-undo
failure a chokepoint cannot see. Adding a gesture to the table is one line, so
the cheap path for a new feature is also the correct one.

---

## 11. Testing

Following `CLAUDE.md` — cheapest level that reproduces the behaviour, and prove
each test has teeth by removing the fix and watching it fail.

| Suite | Coverage |
|---|---|
| `cargo test` (seq-core) | snapshot ring, `uswap` symmetry, transport preservation across restore, playhead wrap on a shortened clip, `dirty` set on restore, no-op compare (change-and-revert), memory cap eviction |
| `browser-test/logic.mjs` | stack model, push/undo/redo ordering, redo invalidation on new edit, grouping boundaries (same-key join, different-key close), no-op suppression, set-switch and generation invalidation, label composition |
| `browser-test/logic.mjs` (guards) | §10 layer 2: every verb in `command.rs`'s `match verb` arms is classified; layer 3: no `shadow_set_param(` outside the chokepoint allowlist |
| `browser-test/app-loop.mjs` (guards) | §10 layer 4: mutations with no open group throw; table-driven undo/redo round-trip invariant, one row per gesture |
| `browser-test/app-loop.mjs` | CC 56 press → correct command queue; Shift + CC 56 → redo; LED states |
| `browser-test/screenshot.mjs` | new baselines for the undo and redo overlays and the empty-stack case |
| `browser-test/perf.mjs` | no extra `shadow_get_param` per tick; snapshot commands stay inside the per-tick IPC budget |
| `browser-test/dump-replay.mjs` | param-domain invariants against the real device metadata in `docs/module-dump/` |
| Device | extend `scripts/test-seq.sh` with undo/redo coverage rather than adding a bespoke script |

**Docs:** `MANUAL.md:826` ("No undo") must be replaced with a real section, the
Controls reference (§8) gains Undo and Shift+Undo, and `README.md` gets a
one-line feature bullet with a screenshot from the new baseline.
