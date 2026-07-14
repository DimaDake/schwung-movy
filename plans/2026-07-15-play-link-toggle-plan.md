# Play-Link Toggle — Implementation Plan

**Goal:** A Set-page toggle that gates the always-on bidirectional transport
link (Phase 4). **Default OFF.** OFF = Phase 3 semantics (clock-follow only,
no Play/Stop propagation); ON = Phase 4 (either Play/Stop starts/stops both).
Persists **per set**.

**Design decision (user, 2026-07-15):** the toggle gates **only** the Play/Stop
propagation. Phase 3 clock-follow (EXT lock + tempo follow while both play)
stays unconditional in both states.

**Contract — behavior by link state:**

| | Link OFF (default) | Link ON |
|---|---|---|
| movy Play/Stop | movy only | also toggles Move (MovePlay inject, pending-start) |
| Move `0xFA` | does not start movy | starts movy |
| Move `0xFC` | movy keeps playing (reverts to internal) | stops movy |
| clock-follow / EXT | works | works |

**Constraints:** ZERO schwung changes. `ENGINE_VERSION` bumps in BOTH
`engine/crates/movy-dsp/src/lib.rs` and `src/seq/constants.ts` (status + persist
grow a field). movy CLAUDE.md test discipline. Commit + push per task.

---

### Task 1: Engine — `link_enabled` field + gating + persistence (TDD)

**Files:** `engine/crates/seq-core/src/engine.rs`, `command.rs`, `persist.rs`.

- [ ] **Step 1 — failing tests** (engine.rs test mod):
  - `link_off_movy_play_starts_without_inject`: default engine; `request_play` →
    `playing`, no `MoveInject`, and (advance a block) still no inject.
  - `link_off_move_fa_does_not_start_movy`: default engine, stepful track;
    `0xFA` + 96 ext ticks → `master_tick==0`, no `NoteOn` (old Phase-3
    behavior — Move Play does not start a stopped movy).
  - `link_off_move_fc_keeps_movy_playing`: default engine; `e.play()`, `0xFA`,
    `0xF8`, 24 ext ticks, `0xFC` → `e.playing` still true.
  - `link_enabled_round_trips`: persist a link-on engine → reload → `link_enabled`;
    a legacy string without a `link` line → `link_enabled == false`.
  - Prefix every existing Phase 4 test (`move_play_starts_movy_when_stopped`,
    `move_stop_stops_movy`, `movy_play_injects_and_waits_for_moves_fa`,
    `pending_start_times_out_to_internal_clock`,
    `movy_stop_injects_when_move_running_and_cancels_pending`) and command.rs
    `play_stop_commands_route_through_move_link` with `e.link_enabled = true;`.
- [ ] **Step 2 — run, verify failure.**
- [ ] **Step 3 — implement:**
  - `pub link_enabled: bool` field; `new()` inits `false`.
  - `request_play`: `if !self.link_enabled { self.play(); return; }` before the
    existing body.
  - `request_stop`: `if !self.link_enabled { self.stop(out); return; }` before
    the existing body.
  - `on_external_realtime` `0xFA` start-branch guard: `if self.link_enabled && !self.playing { … play() }`.
  - `on_external_realtime` `0xFC`: `if self.link_enabled && self.playing { self.stop(out); }` then `ext_running = false`.
  - `status()`: add `link={}` right after `ext={}`; arg `self.link_enabled as u8`
    right after `self.follow_active() as u8`.
  - `command.rs`: `"link" => { if let Some(v) = next() { engine.link_enabled = v != 0; } }`.
  - `persist.rs`: serialize `link {0|1}` (after the `swing` line); reset
    `engine.link_enabled = false` in `load()`'s reset block; parse
    `Some("link") => { … engine.link_enabled = v != 0 }`.
- [ ] **Step 4 — full `cargo test` green.** Commit.

### Task 2: DSP version bump

**Files:** `engine/crates/movy-dsp/src/lib.rs`, `src/seq/constants.ts`.

- [ ] Bump `ENGINE_VERSION` 0.25.0 → 0.26.0 in both. `cargo test`,
      `npm run typecheck`, `./scripts/build-dsp.sh` green. Commit.

### Task 3: UI — LINK cell on knob 4 + status parse (TDD)

**Files:** `src/seq/state.ts`, `src/seq/engine.ts`, `src/seq/main-page-vm.ts`,
`src/seq/main-page.ts`, `browser-test/{logic,screenshot}.mjs`.

- [ ] **Step 1 — failing tests:** logic test — feed a status with `link=1`,
      assert `seqState.linkEnabled === true`; build the Set VM with
      `linkEnabled` true/false and assert the knob-4 cell displays `ON`/`OFF`.
- [ ] **Step 2 — implement:**
  - `state.ts`: `linkEnabled: boolean` field, default `false`; parse helper N/A.
  - `engine.ts` `parseStatus`: `else if (key === 'link') seqState.linkEnabled = val === '1';`.
  - `main-page-vm.ts`: a 5th `cell` (knob 4) — `shortName: 'LINK'`,
    `fullName: 'Play Link'`, `type: 'enum'`, `options: ['OFF','ON']`,
    `enumIndex: linkEnabled?1:0`, `displayValue` `ON`/`OFF`, `normalizedValue`
    0/1. Put it in `rows[1][0]`; add to the `cells` array so its touch-toast works.
  - `main-page.ts` `mainPageKnob`: `k === 4` branch — CW (`n>0`) → ON, CCW → OFF;
    on change set `seqState.linkEnabled`, `seqCmd('link ' + (on?1:0))`,
    `markUiStateDirty()`.
- [ ] **Step 3 — screenshot scene:** Set-page variant with `linkEnabled=true`;
      `screenshot.mjs --update`, inspect, then clean run 0 failures.
- [ ] **Step 4 — `npm run typecheck && npm test && (cd engine && cargo test)` green.** Commit.

### Task 4: Device e2e + docs

- [ ] Reachability check. Deploy; `./scripts/test.sh` + `./scripts/test-seq.sh`.
- [ ] Verify on device: with LINK **OFF** (default) movy Play does NOT start
      Move (no CC85 round-trip → `play=1` is immediate, not FA-driven); toggle
      LINK **ON** → movy Play again starts Move (FA-driven). Clock-follow/EXT
      unaffected in both. Report honestly; DEVICE OFFLINE in CAPS if unreachable.
- [ ] Docs: MANUAL Move-sync section — the link is now opt-in via the **LINK**
      Set-page toggle (default off; clock-follow still automatic); Controls
      reference LINK row + Play-row note ("when LINK is on"). README bullet:
      "one transport (opt-in)".
- [ ] Final suite, commit, push.
