# Phase 4 — Bidirectional Transport Link (always on) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One transport across the device: Move's Play/Stop starts/stops movy, and movy's Play/Stop starts/stops Move (MovePlay CC 85 injection) — always on, no setting.

**Architecture:** Additive to Phase 3's clock-follow state machine in `seq-core`. `0xFA` gains a "start movy if stopped" branch, `0xFC` a "stop movy" branch; movy's transport commands arm a pending-start (wait for Move's `0xFA`, ~2-bar timeout) and emit `OutEvent::MoveInject { val }` press/release pairs that movy-dsp forwards to `host_api.midi_inject_to_move` (davebox blueprint: render-context injects only, fire-and-forget, no state-change-driven injects → no loops).

**Tech Stack:** Rust (seq-core, movy-dsp). No UI changes (always-on, and the Phase 3 EXT badge already covers indication).

**Spec:** `movy/plans/2026-07-12-transport-beat-clock-design.md` §7 "Phase 4" — the contract, including which Phase 3 bullets it supersedes.

**Prerequisite:** Phase 3 (`plans/2026-07-14-move-sync-plan.md`) implemented — this plan modifies its state machine and rewrites one of its tests.

## Global Constraints

- **ZERO schwung changes.** `midi_inject_to_move` is already on the overtake host API (verified: `schwung_shim.c` sets `overtake_host_api.midi_inject_to_move = shadow_chain_midi_inject` on origin/main).
- **Injects fire only from explicit transport commands** (movy Play/Stop), never from transport-state changes — the no-feedback-loop invariant. Session-launch auto-start does NOT inject (documented follow-up).
- **ABI hazard:** `engine/crates/movy-dsp/src/ffi.rs` mirrors a prefix of `host_api_v1_t`. `midi_inject_to_move` sits mid-struct (schwung `src/host/plugin_api_v1.h` ~line 101). It must be added at its EXACT position in the Rust struct — compare field-by-field against the header and add any missing intermediate fields as correctly-typed `Option<...>` placeholders in order. Getting this wrong shifts every later field silently.
- `ENGINE_VERSION` bump in BOTH `engine/crates/movy-dsp/src/lib.rs` and `src/seq/constants.ts`.
- Full movy suite after every task: `(cd engine && cargo test)` + `npm test`. Commit + push per task.
- Device: reachability check first; if offline report `DEVICE OFFLINE` in CAPS.

---

### Task 0: Preflight

- [ ] **Step 1: Verify seams**

```bash
cd /Users/dake/git/cld/movy
grep -n "on_external_realtime" engine/crates/seq-core/src/engine.rs | head -3   # Phase 3 landed
grep -n "ext_clock_ignored_while_stopped" engine/crates/seq-core/src/engine.rs  # test to rewrite
grep -n "fn play\b\|fn stop\b" engine/crates/seq-core/src/command.rs engine/crates/seq-core/src/engine.rs | head -5
grep -n "MoveInject\|midi_inject" engine/crates/movy-dsp/src/ffi.rs             # expect NO hits yet
grep -rn "MOVE_PLAY_RELEASE_SAMPLES\|MOVE_PLAY_CC" /Users/dake/git/cld/schwung-davebox/dsp/*.c | head -4
```

Record davebox's `MOVE_PLAY_CC` (expect 85) and `MOVE_PLAY_RELEASE_SAMPLES` values — reuse the release gap verbatim.

- [ ] **Step 2: Locate the transport-command entry points** — find where the UI's `play`/`stop` cmds reach the engine (command.rs dispatch → `Engine::play()` / `Engine::stop()`). The link logic wraps THESE call sites via new methods `request_play(out)` / `request_stop(out)`; direct `play()`/`stop()` callers elsewhere (session auto-start, recording) stay un-propagated.

---

### Task 1: Engine — linked transport (TDD)

**Files:**
- Modify: `engine/crates/seq-core/src/engine.rs` (+ `command.rs` dispatch swap)

**Interfaces:**
- Produces: `OutEvent::MoveInject { val: u8 }`; `Engine::request_play(&mut self, out)` / `Engine::request_stop(&mut self, out)` (command dispatch now calls these); fields `pending_play: bool`, `pending_play_deadline: u64` (frames), `inject_release_at: u64` (0 = idle) — all runtime-only, not persisted.
- Consumes: Phase 3's `ext_running`, `frame_now`, `on_external_realtime`, `flush_gates`, `start_transport`.

- [ ] **Step 1: Failing tests**

```rust
    #[test]
    fn move_play_starts_movy_when_stopped() {   // rewrites ext_clock_ignored_while_stopped
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        let mut out = Vec::new();
        e.on_external_realtime(0xFA, &mut out);
        e.on_external_realtime(0xF8, &mut out);
        run_ext_ticks(&mut e, 8, &mut out);
        assert!(e.playing, "linked transport: Move Play starts movy");
        assert!(out.iter().any(|x| matches!(x, OutEvent::NoteOn { .. })));
        assert!(out.iter().all(|x| !matches!(x, OutEvent::MoveInject { .. })),
                "state-change never injects");
    }

    #[test]
    fn move_stop_stops_movy() {
        let mut e = engine();
        e.play();
        let mut out = Vec::new();
        e.on_external_realtime(0xFA, &mut out);
        run_ext_ticks(&mut e, 8, &mut out);
        e.on_external_realtime(0xFC, &mut out);
        assert!(!e.playing, "linked transport: Move Stop stops movy");
        assert!(out.iter().all(|x| !matches!(x, OutEvent::MoveInject { .. })));
    }

    #[test]
    fn movy_play_injects_and_waits_for_moves_fa() {
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        let mut out = Vec::new();
        e.request_play(&mut out);                 // Move not running
        assert!(!e.playing, "pending-start: silent until Move's FA");
        // Press + (after the release gap) release, from advance_block.
        e.advance_block(FRAMES, &mut out);
        assert!(out.iter().any(|x| matches!(x, OutEvent::MoveInject { val: 127 })));
        let mut left = 44100u32; // > release gap
        while left > 0 { let s = left.min(FRAMES); e.advance_block(s, &mut out); left -= s; }
        assert!(out.iter().any(|x| matches!(x, OutEvent::MoveInject { val: 0 })));
        // Move answers with FA -> movy starts.
        e.on_external_realtime(0xFA, &mut out);
        assert!(e.playing);
    }

    #[test]
    fn pending_start_times_out_to_internal_clock() {
        let mut e = engine();
        let mut out = Vec::new();
        e.request_play(&mut out);
        // 2 bars at 120 BPM = 4 s = 176400 frames; run 5 s.
        let mut left = 5 * 44100u32;
        while left > 0 { let s = left.min(FRAMES); e.advance_block(s, &mut out); left -= s; }
        assert!(e.playing, "timeout fallback: play internally if Move never starts");
        assert!(out.iter().any(|x| matches!(x, OutEvent::Start)), "internal clock session opened");
    }

    #[test]
    fn movy_stop_injects_when_move_running_and_cancels_pending() {
        let mut e = engine();
        let mut out = Vec::new();
        // Case A: playing + Move running -> stop injects a toggle.
        e.on_external_realtime(0xFA, &mut out);
        e.request_play(&mut out);                 // Move running: starts (quantized), no inject
        assert!(out.iter().all(|x| !matches!(x, OutEvent::MoveInject { .. })));
        e.request_stop(&mut out);
        e.advance_block(FRAMES, &mut out);
        assert!(!e.playing);
        assert!(out.iter().any(|x| matches!(x, OutEvent::MoveInject { val: 127 })));
        // Case B: cancel during pending-start toggles Move back.
        let mut e = engine();
        let mut out = Vec::new();
        e.request_play(&mut out);                 // pending, inject armed
        e.request_stop(&mut out);                 // cancel
        let mut left = 44100u32;
        while left > 0 { let s = left.min(FRAMES); e.advance_block(s, &mut out); left -= s; }
        assert!(!e.playing);
        let presses = out.iter().filter(|x| matches!(x, OutEvent::MoveInject { val: 127 })).count();
        assert_eq!(presses, 2, "start toggle + cancel toggle");
    }
```

DELETE/replace Phase 3's `ext_clock_ignored_while_stopped` (its assertion is now wrong by design).

- [ ] **Step 2: Run to verify failure**, then implement:

(a) `OutEvent::MoveInject { val: u8 }` variant (doc comment: MovePlay CC 85 toward Move's firmware; press 127 / release 0).

(b) Inject queue on Engine — davebox two-phase, engine-frame timed:

```rust
    /// Queue a MovePlay toggle: press now (next advance_block), release after
    /// the davebox-verified gap. Fire-and-forget — never state-driven.
    fn queue_move_play_toggle(&mut self) {
        self.move_inject_press_pending = true;
    }
```

with drain at the top of `advance_block` (after `frame_now +=`):

```rust
        if self.move_inject_press_pending {
            self.move_inject_press_pending = false;
            out.push(OutEvent::MoveInject { val: 127 });
            self.inject_release_at = self.frame_now + MOVE_PLAY_RELEASE_GAP as u64;
        } else if self.inject_release_at > 0 && self.frame_now >= self.inject_release_at {
            self.inject_release_at = 0;
            out.push(OutEvent::MoveInject { val: 0 });
        }
```

(`MOVE_PLAY_RELEASE_GAP`: the davebox `MOVE_PLAY_RELEASE_SAMPLES` value from Task 0.)

(c) `request_play` / `request_stop`:

```rust
    /// Transport-button Play under the always-on Move link (design §7 Phase 4):
    /// if Move already runs, start now (Phase 3 bar-quantized join); otherwise
    /// toggle Move and hold silent until its 0xFA (~1-bar Link grid), with a
    /// 2-bar timeout fallback onto the internal clock.
    pub fn request_play(&mut self, out: &mut Vec<OutEvent>) {
        let _ = out;
        if self.ext_running {
            self.play();
            return;
        }
        self.queue_move_play_toggle();
        self.pending_play = true;
        let frames_per_bar = self.clock.sample_rate() as u64 * 60 * 4 * 100
            / self.clock.bpm_x100() as u64;
        self.pending_play_deadline = self.frame_now + 2 * frames_per_bar;
    }

    pub fn request_stop(&mut self, out: &mut Vec<OutEvent>) {
        if self.pending_play {
            self.pending_play = false;
            self.queue_move_play_toggle();   // Move may already be starting: toggle back
            return;
        }
        self.stop(out);
        if self.ext_running {
            self.queue_move_play_toggle();
        }
    }
```

(d) `on_external_realtime` link branches: in `0xFA`, before the existing `if self.playing` re-anchor, add `if !self.playing { self.pending_play = false; self.play(); }` (then the FA anchor logic continues — `play()`/`start_transport` ordering must leave `ext_base = 0` anchored as in Phase 3; verify against the Phase 3 FA body). In `0xFC`: `if self.playing { self.stop(out); }` before clearing `ext_running` (order: flush notes while gates still known). Staleness path: UNCHANGED (revert-keep-playing).

(e) Pending timeout in `advance_block` (next to the staleness check):

```rust
        if self.pending_play && self.frame_now >= self.pending_play_deadline {
            self.pending_play = false;
            self.play();   // Move never started: run on the internal clock
        }
```

(f) `command.rs`: the transport play/stop command arms now call `request_play`/`request_stop` (pass the `out` they already have). All other `play()`/`stop()` callers unchanged.

- [ ] **Step 3: Run** — 5 new tests PASS; **all Phase 3 follow tests still PASS** (they exercise playing-state paths, unaffected); full `cargo test` green.

- [ ] **Step 4: Commit**

```bash
git add engine/crates/seq-core/src/engine.rs engine/crates/seq-core/src/command.rs
git commit -m "$(cat <<'EOF'
feat(engine): always-on bidirectional transport link with Move

Move FA/FC starts/stops movy; movy Play/Stop toggles Move (MovePlay via
MoveInject events), with pending-start waiting for Move's Link-grid FA
and a 2-bar internal-clock fallback.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: movy-dsp — inject forwarding + version bump

**Files:**
- Modify: `engine/crates/movy-dsp/src/ffi.rs` (ABI-ordered `midi_inject_to_move` field)
- Modify: `engine/crates/movy-dsp/src/host.rs` (safe wrapper)
- Modify: `engine/crates/movy-dsp/src/lib.rs` (drain arm + `ENGINE_VERSION`)
- Modify: `src/seq/constants.ts` (`ENGINE_VERSION`)

- [ ] **Step 1: ffi field (ABI audit).** Print schwung's struct order (`git -C /Users/dake/git/cld/schwung show origin/main:src/host/plugin_api_v1.h | sed -n '51,113p'`) and diff field-by-field against `ffi.rs`. Insert `pub midi_inject_to_move: Option<unsafe extern "C" fn(msg: *const u8, len: c_int) -> c_int>,` at its exact position, adding any other missing intermediates as ordered placeholders. Add a comment: `// Field order mirrors host_api_v1_t — NEVER reorder or skip.`

- [ ] **Step 2: Wrapper in host.rs** (same shape as `midi_send_internal`):

```rust
pub fn midi_inject_to_move(cin: u8, status: u8, d1: u8, d2: u8) -> bool {
    if let Some(h) = host() {
        if let Some(f) = h.midi_inject_to_move {
            let pkt = [cin, status, d1, d2];
            return unsafe { f(pkt.as_ptr(), pkt.len() as c_int) } > 0;
        }
    }
    false
}
```

- [ ] **Step 3: Drain arm in `drain_out`:**

```rust
                OutEvent::MoveInject { val } => {
                    // MovePlay (CC 85) toward Move's firmware — davebox packet shape.
                    host::midi_inject_to_move(0x0B, 0xB0, 85, val);
                }
```

- [ ] **Step 4: Bump `ENGINE_VERSION`** (+1, both files). Run `cargo test`, `npm run typecheck`, `./scripts/build-dsp.sh`, `npm test` — all green.

- [ ] **Step 5: Commit** (`feat(dsp): forward MoveInject events to Move via midi_inject_to_move`).

---

### Task 3: Device e2e + docs

- [ ] **Step 1: Deploy + regressions** — `./scripts/test.sh && ./scripts/test-seq.sh` (offline → `DEVICE OFFLINE` in CAPS, push, stop).

- [ ] **Step 2: Link verification (PASS criteria, report honestly):**

1. Movy Play (Move stopped): Move's transport starts (screen/play LED); movy waits silently, then both start together on Move's downbeat. If Move takes > 2 bars (or is wedged), movy starts alone — verify by stopping MoveOriginal's playback path if feasible, else skip with a note.
2. Movy Stop: both stop.
3. Move Play (movy open but stopped): movy starts with it; same from the background (movy parked).
4. Move Stop: movy stops.
5. Double-press safety: mash movy Play/Stop quickly — transports settle consistent (no stuck toggle), no MIDI runaway in the log.
6. Phase 3 checks still hold: Move→movy tempo follow, EXT badge, LFO lock.

> **Known limitation — NOT a P4 failure:** the movy TEMPO knob does not change
> Move's tempo (schwung's Link sidecar is dormant unless Link Audio routing is
> on — root cause and fix options in
> `docs/tempo-knob-move-override-not-applied.md`; fix deferred, user decision
> 2026-07-15). Under P4, Move owns tempo during playback: set it on Move's
> hardware; movy follows. Do not spend device time debugging the knob→Move
> direction, and do not "fix" the knob's brief tease-and-snap-back — it becomes
> correct optimistic feedback once the schwung tempo bridge lands.

- [ ] **Step 3: Docs.** `MANUAL.md`: update the Move-sync section — one transport, either Play/Stop drives both; the ~1-bar wait on movy-initiated starts (Move's Link grid); the two workflow notes (movy-only ⇒ silent native set; Move-only ⇒ stop movy tracks individually). Controls reference: Play/Stop rows gain the propagation note. `README.md`: fold into the existing Move-sync bullet ("one transport").

- [ ] **Step 4: Full suite, commit, push.** Report device results + that design §7 is fully shipped except Link-as-clock-source.

---

## Self-review notes (plan time)

- Spec coverage: every §7.4 bullet has a task/test — FA-starts (T1 test 1), FC-stops (test 2), inject+pending+timeout (tests 3–4), stop-inject+cancel (test 5), no-state-driven-injects (asserted in tests 1–2), staleness-unchanged (Phase 3 test still green), background case (device step 3), auto-start non-propagation (Task 0 Step 2 scoping + design note).
- Consistency: `MoveInject { val }` matches Tasks 1↔2; `request_play/request_stop` signatures match test usage; release-gap constant sourced from davebox in Task 0 and used in Task 1.
- Known judgment points: exact `play()` vs FA-anchor ordering inside `on_external_realtime` (verify against the Phase 3 body); command.rs dispatch names; the ffi ABI audit.
