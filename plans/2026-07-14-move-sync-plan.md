# Phase 3 — Movy ↔ Native Move Transport Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Movy's sequencer automatically phase-locks to Move's native sequencer whenever both are playing, keeps playing on its own clock when Move stops, and movy's tempo knob sets the device-wide tempo via the existing Link override.

**Architecture:** Engine-side clock follow in `seq-core` (pure, cargo-testable): Move's cable-0 realtime (`0xF8/0xFA/0xFB/0xFC`) — already delivered by the shim to movy-dsp's currently-no-op `on_midi` — drives the playhead at 24 PPQN ×4 with block interpolation while follow is engaged; the internal accumulator and clock emission are suspended, so schwung's transport service switches to `SRC_MOVE` and LFOs + movy notes ride the same grid. The UI adds an `EXT` indicator and a debounced `desired-tempo` write.

**Tech Stack:** Rust (seq-core, movy-dsp), TypeScript (movy UI), movy browser-test harness.

**Spec:** `movy/plans/2026-07-12-transport-beat-clock-design.md` §7 "Phase 3" (updated 2026-07-14 with the automatic-follow semantics — read it first; it is the contract for every behavior below).

## Global Constraints

- **ZERO schwung changes.** Everything runs on existing schwung infrastructure (cable-0 tap → overtake DSP `on_midi`; `desired-tempo` → Link sidecar). If you find yourself editing schwung, stop — the design says you shouldn't need to.
- **Follow is automatic, no toggle.** Engaged iff `playing && ext_running`. Move's Play never force-starts movy; movy's Play never starts Move (MovePlay CC 85 injection is explicitly OUT of scope).
- `ENGINE_VERSION` must match between `engine/crates/movy-dsp/src/lib.rs` and `src/seq/constants.ts` — bump BOTH (the status protocol gains a field).
- `on_midi` and the engine run on the shim's audio thread: no allocation-per-event, no I/O, panics caught by the existing `guard()`.
- Run the full movy local suite at the end of every task that compiles: `(cd engine && cargo test)` and `npm test`.
- Commit + push to movy `main` after every task. Device steps: check `ssh -o ConnectTimeout=3 ableton@move.local echo ok` first; if offline report `DEVICE OFFLINE` in CAPS.
- New UI state (EXT marker) → screenshot baseline; new business logic → logic/app-loop test (movy CLAUDE.md rules).

## File Structure

- `engine/crates/seq-core/src/clock.rs` — add a `sample_rate()` getter (field exists, currently `#[allow(dead_code)]`).
- `engine/crates/seq-core/src/engine.rs` — external-clock state + `on_external_realtime()` + follow-driven `advance_block`; `flush_gates()` extracted from `stop()`; `status()` gains `ext=`.
- `engine/crates/movy-dsp/src/lib.rs` — `on_midi` routes `0xF8+`; ENGINE_VERSION bump.
- `src/seq/engine.ts` — parse `ext=` into `seqState`.
- `src/seq/state.ts` (or wherever `seqState` is declared — grep) — `extSync: boolean` field.
- `src/seq/main-page-vm.ts` / renderer — EXT marker on the tempo cell.
- `src/seq/tempo-override.ts` (new, ~25 lines) — debounced `desired-tempo` write.
- `src/seq/main-page.ts` — tempo knob calls `scheduleTempoOverride`.
- `src/app/tick.ts` — call `tempoOverrideTick()`.

---

### Task 0: Preflight — verify every seam

- [ ] **Step 1: Greps (all must hit; if one misses, locate the moved code before editing)**

```bash
cd /Users/dake/git/cld/movy
grep -n "unsafe extern \"C\" fn on_midi" engine/crates/movy-dsp/src/lib.rs   # currently a no-op body
grep -n "fn start_transport" engine/crates/seq-core/src/engine.rs
grep -n "for g in self.gates.drain" engine/crates/seq-core/src/engine.rs     # inside stop()
grep -n "emitting_clock" engine/crates/seq-core/src/engine.rs | head -3      # Phase 1 emission
grep -n "pub tick: u64" engine/crates/seq-core/src/clock.rs
grep -n "TICKS_PER_BAR" engine/crates/seq-core/src/lib.rs
grep -n "seqCmd('bpm " src/seq/main-page.ts
grep -n "key === 'bpm'" src/seq/engine.ts
grep -n "ENGINE_VERSION" engine/crates/movy-dsp/src/lib.rs src/seq/constants.ts
```

Also read `Engine::status()` (engine.rs ~954) to see the exact `play=… tick=… bpm=…` field format before adding `ext=`.

---

### Task 1: Engine — external realtime state machine + tempo capture (TDD)

**Files:**
- Modify: `engine/crates/seq-core/src/clock.rs` (getter)
- Modify: `engine/crates/seq-core/src/engine.rs`

**Interfaces:**
- Produces: `Engine::on_external_realtime(&mut self, status: u8, out: &mut Vec<OutEvent>)`; `Engine::follow_active(&self) -> bool`; fields `ext_running`, `ext_awaiting_first`, `ext_ticks`, `ext_last_frame`, `ext_interval`, `ext_base`, `ext_base_set`, `frame_now`, `was_following`, `resume_anchor_pending` (all runtime-only — do NOT touch `persist.rs`); `Clock::sample_rate(&self) -> u32`; `Engine::flush_gates(&mut self, out)` (extracted from `stop()`, which now calls it).
- Consumes: existing `start_transport()`, `emitting_clock`, `OutEvent::{Start, Stop, Clock}`.

- [ ] **Step 1: Write the failing tests** (in the `#[cfg(test)]` module; `engine()`/`run_ticks()`/`FRAMES` helpers exist):

```rust
    /// 125 BPM at 24 PPQN / 44100 Hz = exactly 882 frames per external tick.
    const EXT_TICK_FRAMES: u32 = 882;

    /// Feed `n` external ticks with real frame spacing.
    fn run_ext_ticks(e: &mut Engine, n: u32, out: &mut Vec<OutEvent>) {
        for _ in 0..n {
            let mut left = EXT_TICK_FRAMES;
            while left > 0 {
                let step = left.min(FRAMES);
                e.advance_block(step, out);
                left -= step;
            }
            e.on_external_realtime(0xF8, out);
        }
    }

    #[test]
    fn ext_tempo_is_captured_into_engine_bpm() {
        let mut e = engine(); // 120.00 BPM internally
        let mut out = Vec::new();
        e.on_external_realtime(0xFA, &mut out);
        e.on_external_realtime(0xF8, &mut out); // anchor tick 0
        run_ext_ticks(&mut e, 24, &mut out);
        let bpm = e.clock.bpm_x100();
        assert!((12450..=12550).contains(&bpm), "captured {bpm}, want ~12500");
    }

    #[test]
    fn ext_clock_ignored_while_stopped() {
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        let mut out = Vec::new();
        e.on_external_realtime(0xFA, &mut out);
        run_ext_ticks(&mut e, 96, &mut out);
        assert_eq!(e.master_tick, 0);
        assert!(out.iter().all(|x| !matches!(x, OutEvent::NoteOn { .. })));
    }
```

- [ ] **Step 2: Run to verify failure** — `cd engine && cargo test -p seq-core ext_` → compile FAIL (`on_external_realtime` not found).

- [ ] **Step 3: Implement**

(a) `clock.rs`: remove the `#[allow(dead_code)]` on `sample_rate` and add:

```rust
    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }
```

(b) `engine.rs`: add the fields (with the `// --- external (Move native) clock follow — design §7 Phase 3 ---` comment block; init all zero/false in `new()`), extract `flush_gates`:

```rust
    fn flush_gates(&mut self, out: &mut Vec<OutEvent>) {
        for g in self.gates.drain(..) {
            out.push(OutEvent::NoteOff { track: g.track, pitch: g.pitch });
        }
    }
```

(replace the identical drain loop inside `stop()` with `self.flush_gates(out);`), then:

```rust
    fn follow_active(&self) -> bool {
        self.playing && self.ext_running
    }

    /// Move's cable-0 transport, delivered by the shim to movy-dsp on_midi.
    /// Follow is automatic: engaged while we play and Move's transport runs
    /// (design §7 Phase 3). Engage/disengage edges are handled in
    /// advance_block; this only maintains the external-clock model.
    pub fn on_external_realtime(&mut self, status: u8, out: &mut Vec<OutEvent>) {
        match status {
            0xFA => {
                self.ext_running = true;
                self.ext_awaiting_first = true;
                self.ext_ticks = 0;
                self.ext_base = 0;
                self.ext_base_set = true; // FA anchors bar 0; engage must not re-quantize
                self.ext_last_frame = self.frame_now;
                if self.playing {
                    // Both transports start the bar together.
                    self.flush_gates(out);
                    self.start_transport();
                }
            }
            0xFB => self.ext_running = true,
            0xFC => self.ext_running = false,
            0xF8 => {
                if !self.ext_running {
                    // Attached mid-song (no 0xFA): tempo is right immediately,
                    // bar alignment arrives with the next 0xFA.
                    self.ext_running = true;
                    self.ext_awaiting_first = true;
                }
                if self.ext_awaiting_first {
                    self.ext_awaiting_first = false;
                    self.ext_ticks = 0;
                } else {
                    self.ext_ticks += 1;
                    let delta = (self.frame_now - self.ext_last_frame) as f64;
                    let sr = self.clock.sample_rate() as f64;
                    // Accept only intervals inside 20–999 BPM at 24 PPQN.
                    if delta >= 60.0 * sr / (999.0 * 24.0) && delta <= 60.0 * sr / (20.0 * 24.0) {
                        self.ext_interval = if self.ext_interval <= 0.0 {
                            delta
                        } else {
                            self.ext_interval + 0.25 * (delta - self.ext_interval)
                        };
                        // Continuous capture: the UI shows Move's tempo and a
                        // revert keeps playing at it.
                        let bpm = (60.0 * 100.0 * sr / (self.ext_interval * 24.0)).round() as u32;
                        self.clock.set_bpm_x100(bpm);
                    }
                }
                self.ext_last_frame = self.frame_now;
            }
            _ => {}
        }
    }
```

Note: `advance_block` doesn't drive the playhead from these yet (Task 2) — but `frame_now` must advance now: add `self.frame_now += frames as u64;` as the first line of `advance_block`.

- [ ] **Step 4: Run** — `cargo test -p seq-core ext_` → both PASS; full `cargo test` → no regressions.

- [ ] **Step 5: Commit**

```bash
git add engine/crates/seq-core/src/clock.rs engine/crates/seq-core/src/engine.rs
git commit -m "$(cat <<'EOF'
feat(engine): model Move's external transport clock (anchor, ticks, tempo capture)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Engine — follow-driven playhead, re-anchor, revert, emission gating (TDD)

**Files:**
- Modify: `engine/crates/seq-core/src/engine.rs` (`advance_block`)

**Interfaces:**
- Consumes: Task 1's fields + `on_external_realtime`.
- Produces: the complete follow behavior per design §7 Phase 3. `advance_block` signature unchanged.

- [ ] **Step 1: Write the failing tests**

```rust
    #[test]
    fn follow_locks_playhead_to_ext_ticks() {
        let mut e = engine();
        e.play();
        let mut out = Vec::new();
        e.on_external_realtime(0xFA, &mut out);
        e.on_external_realtime(0xF8, &mut out);
        run_ext_ticks(&mut e, 24, &mut out); // one external beat
        // 24 ext ticks × 4 = 96 master ticks, ± the interpolated tail.
        assert!((92..=100).contains(&e.master_tick), "master {}", e.master_tick);
    }

    #[test]
    fn no_internal_clock_emission_while_following() {
        let mut e = engine();
        e.play();
        let mut out = Vec::new();
        e.advance_block(FRAMES, &mut out); // internal Start fires first
        out.clear();
        e.on_external_realtime(0xFA, &mut out);
        e.on_external_realtime(0xF8, &mut out);
        run_ext_ticks(&mut e, 48, &mut out);
        let stops = out.iter().filter(|x| matches!(x, OutEvent::Stop)).count();
        assert_eq!(stops, 1, "internal session closed exactly once on engage");
        assert!(out.iter().all(|x| !matches!(x, OutEvent::Clock | OutEvent::Start)));
    }

    #[test]
    fn fa_reanchors_pattern_and_flushes_gates() {
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.play();
        let _ = run_ticks(&mut e, 30); // internal playback, gate open
        let mut out = Vec::new();
        e.on_external_realtime(0xFA, &mut out);
        assert!(out.contains(&OutEvent::NoteOff { track: 0, pitch: 60 }));
        assert_eq!(e.master_tick, 0);
        assert!(e.playing);
    }

    #[test]
    fn engaging_mid_song_waits_for_moves_next_bar() {
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        let mut out = Vec::new();
        // Move already running, unanchored, 10 ticks into wherever.
        e.on_external_realtime(0xF8, &mut out);
        run_ext_ticks(&mut e, 10, &mut out);
        e.play();
        // Up to the bar boundary (96 ext ticks) movy holds at 0…
        run_ext_ticks(&mut e, 40, &mut out);
        assert_eq!(e.master_tick, 0, "waits for Move's bar");
        // …then starts on the downbeat.
        run_ext_ticks(&mut e, 50, &mut out);
        assert!(e.master_tick > 0, "started after Move's bar boundary");
        assert!(out.iter().any(|x| matches!(x, OutEvent::NoteOn { .. })));
    }

    #[test]
    fn move_stop_reverts_to_internal_with_bar_anchored_emission() {
        let mut e = engine();
        e.play();
        let mut out = Vec::new();
        e.on_external_realtime(0xFA, &mut out);
        e.on_external_realtime(0xF8, &mut out);
        run_ext_ticks(&mut e, 48, &mut out); // half a bar in
        e.on_external_realtime(0xFC, &mut out);
        out.clear();
        let before = e.master_tick;
        let ev = run_ticks(&mut e, 96); // internal clock drives again
        assert!(e.master_tick > before, "keeps playing after Move stops");
        // Start re-emitted exactly once, at our next bar boundary, then clocks.
        let starts = ev.iter().filter(|x| matches!(x, OutEvent::Start)).count();
        assert_eq!(starts, 1);
        assert!(ev.iter().any(|x| matches!(x, OutEvent::Clock)));
    }

    #[test]
    fn stale_ext_clock_reverts_like_a_stop() {
        let mut e = engine();
        e.play();
        let mut out = Vec::new();
        e.on_external_realtime(0xFA, &mut out);
        e.on_external_realtime(0xF8, &mut out);
        run_ext_ticks(&mut e, 24, &mut out);
        let frozen = e.master_tick;
        // 1 s of silence (> 0.5 s staleness) then internal blocks.
        let mut left = 44100u32;
        while left > 0 { let s = left.min(FRAMES); e.advance_block(s, &mut out); left -= s; }
        assert!(e.master_tick > frozen, "revived on internal clock");
    }
```

(`run_ticks` drives `e.clock.tick`, which only advances when NOT following — it is the correct helper for the internal-clock phases of these tests.)

- [ ] **Step 2: Run to verify failure** — `cargo test -p seq-core follow_ fa_ engaging_ move_stop_ stale_` → FAIL (playhead doesn't follow; no gating).

- [ ] **Step 3: Rewrite `advance_block`**

```rust
    pub fn advance_block(&mut self, frames: u32, out: &mut Vec<OutEvent>) {
        self.frame_now += frames as u64;

        // Staleness: Move wedged without 0xFC must not freeze the playhead
        // (0.5 s, mirrors schwung's transport service).
        if self.ext_running
            && self.ext_last_frame > 0
            && self.frame_now - self.ext_last_frame > self.clock.sample_rate() as u64 / 2
        {
            self.ext_running = false;
        }

        // Follow engage/disengage edges (design §7 Phase 3).
        let following = self.follow_active();
        if following && !self.was_following {
            // Close the internal clock session; schwung's transport service
            // switches to Move's clock.
            if self.emitting_clock {
                self.emitting_clock = false;
                out.push(OutEvent::Stop);
            }
            self.resume_anchor_pending = false;
            if !self.ext_base_set {
                // Joined an already-running Move: launch-quantize to Move's
                // next bar so we start on the downbeat (0xFA anchors base 0
                // itself). 96 ext ticks = one 4/4 bar at 24 PPQN.
                self.ext_base = (self.ext_ticks / 96 + 1) * 96;
                self.ext_base_set = true;
                self.start_transport();
            }
        } else if !following && self.was_following {
            // Move stopped (or we did): resume the internal accumulator from
            // the current position; re-anchor emission at our next bar.
            self.clock.reset();
            self.clock.tick = self.master_tick;
            self.ext_base_set = false;
            if self.playing {
                self.resume_anchor_pending = true;
            }
        }
        self.was_following = following;

        let fired: u64 = if following {
            // Playhead target from Move's ticks: 24 → 96 PPQN, plus a
            // block-interpolated fraction, clamped to one beat per block.
            let mut abs = self.ext_ticks * 4;
            if self.ext_interval > 0.0 {
                let frac =
                    ((self.frame_now - self.ext_last_frame) as f64 / self.ext_interval).min(1.0);
                abs += (frac * 4.0) as u64;
            }
            abs.saturating_sub(self.ext_base * 4)
                .saturating_sub(self.master_tick)
                .min(96)
        } else {
            self.clock.advance(frames) as u64
        };

        // Internal transport edges (suppressed while following; a revert
        // re-anchors at the bar boundary inside the tick loop instead).
        if self.playing && !self.emitting_clock && !following && !self.resume_anchor_pending {
            self.emitting_clock = true;
            out.push(OutEvent::Start);
        } else if !self.playing && self.emitting_clock {
            self.emitting_clock = false;
            out.push(OutEvent::Stop);
        }
        if !self.playing {
            return;
        }
        for _ in 0..fired {
            if self.resume_anchor_pending
                && !following
                && self.master_tick % crate::TICKS_PER_BAR as u64 == 0
            {
                self.resume_anchor_pending = false;
                self.emitting_clock = true;
                out.push(OutEvent::Start);
            }
            if self.emitting_clock && !following && self.master_tick % 4 == 0 {
                out.push(OutEvent::Clock);
            }
            self.service_tick(out);
        }
    }
```

Adapt the exact merge against the current Phase 1 body — the `%4` Clock line and Start/Stop edges already exist; this adds `following` gating, the follow-driven `fired`, and the resume anchor. Preserve any surrounding logic (count-in etc.) untouched.

- [ ] **Step 4: Run** — the 6 new tests PASS; full `cargo test` green (Phase 1 emission tests must still pass — they never set `ext_running`, so behavior is identical).

- [ ] **Step 5: Commit**

```bash
git add engine/crates/seq-core/src/engine.rs
git commit -m "$(cat <<'EOF'
feat(engine): automatic clock follow — playhead locks to Move's transport

Engage on FA/mid-song (bar-quantized), re-anchor on FA, revert on FC or
0.5 s staleness with bar-anchored resumption of internal clock emission.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: movy-dsp — route realtime in, expose `ext=` status, bump ENGINE_VERSION

**Files:**
- Modify: `engine/crates/movy-dsp/src/lib.rs` (`on_midi` ffi, `PluginState`, `ENGINE_VERSION`)
- Modify: `engine/crates/seq-core/src/engine.rs` (`status()` — one field)
- Modify: `src/seq/constants.ts` (`ENGINE_VERSION`)

**Interfaces:**
- Produces: status string gains `ext=<0|1>` (place it right after the `bpm=` field); Task 4 parses it.

- [ ] **Step 1: Engine status field** — in `status()`, append `ext={}` with `self.follow_active() as u8` immediately after the `bpm=` field (match the existing `format!` style). Add a `follow_active()` visibility fix if needed (`pub(crate)` is enough if status is in the same file — it is).

- [ ] **Step 2: Implement `on_midi`** — replace the no-op:

```rust
unsafe extern "C" fn on_midi(instance: *mut c_void, msg: *const u8, len: c_int, _source: c_int) {
    guard((), || {
        // Surface input arrives via the cmd protocol; the only raw MIDI the
        // shim delivers here is Move's cable-0 system realtime (1 byte).
        if msg.is_null() || len < 1 {
            return;
        }
        let status = unsafe { *msg };
        if status < 0xF8 {
            return;
        }
        if let Some(i) = inst(instance) {
            i.on_external_realtime(status);
        }
    });
}
```

with the `PluginState` method:

```rust
    fn on_external_realtime(&mut self, status: u8) {
        // Events queue into self.out and drain on the next render_block.
        self.engine.on_external_realtime(status, &mut self.out);
    }
```

- [ ] **Step 3: Bump `ENGINE_VERSION`** by +1 in both `lib.rs` and `src/seq/constants.ts`.

- [ ] **Step 4: Verify** — `cargo test` green; `npm run typecheck` green; `./scripts/build-dsp.sh` cross-compiles (it enforces the version pairing).

- [ ] **Step 5: Commit**

```bash
git add engine/crates/movy-dsp/src/lib.rs engine/crates/seq-core/src/engine.rs src/seq/constants.ts
git commit -m "$(cat <<'EOF'
feat(dsp): route Move's cable-0 realtime into the engine; status reports ext follow

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: UI — EXT indicator + tempo knob writes the Link override (TDD)

**Files:**
- Modify: `src/seq/engine.ts` (status parse), the `seqState` declaration file (grep `bpmX100:` to find it)
- Modify: `src/seq/main-page-vm.ts` + its renderer (EXT marker on the tempo cell)
- Create: `src/seq/tempo-override.ts`
- Modify: `src/seq/main-page.ts` (knob hook), `src/app/tick.ts` (debounce tick)
- Test: `browser-test/logic.mjs` or `browser-test/app-loop.mjs` (match where main-page behavior is already tested — grep `bpm` in both), `browser-test/screenshot.mjs` (EXT scene)

**Interfaces:**
- Consumes: `ext=` status field (Task 3), `host_write_file` (ambient-declared).
- Produces: `seqState.extSync: boolean`; `scheduleTempoOverride(bpmX100: number)`, `tempoOverrideTick()`.

- [ ] **Step 1: Failing tests.** (a) Status parse: feed a status line containing `ext=1` through the existing status-parse test path (crib the neighboring `bpm` parse test) and assert `seqState.extSync === true`. (b) Debounce: 

```js
_log('\ntempo override: debounced desired-tempo write');
{
    const writes = [];
    globalThis.host_write_file = (p, v) => { writes.push([p, v]); return true; };
    scheduleTempoOverride(12500);
    scheduleTempoOverride(12600);           // knob still turning — supersedes
    for (let i = 0; i < 59; i++) tempoOverrideTick();
    eq('no write during debounce', writes.length, 0);
    tempoOverrideTick();
    eq('single write after debounce', writes.length, 1);
    eq('path', writes[0][0], '/data/UserData/schwung/desired-tempo');
    eq('value is the LAST bpm, 4 decimals', writes[0][1], '126.0000\n');
    delete globalThis.host_write_file;
}
```

- [ ] **Step 2: Run to verify failure**, then implement:

`src/seq/tempo-override.ts`:

```ts
/* Debounced Link tempo override (schwung desired-tempo protocol): Move's
 * firmware follows movy's tempo knob via the Link sidecar, which applies the
 * file only while Move is the sole Link peer — with Live connected the
 * session owns tempo, which is correct. Debounce keeps a knob sweep from
 * spamming the file (the sidecar polls its mtime at ~100 Hz). */
const PATH = '/data/UserData/schwung/desired-tempo';
const DEBOUNCE_TICKS = 60;   // ~0.3 s at the ~205 Hz device tick

let pending = 0;             // bpmX100 awaiting write; 0 = idle
let countdown = 0;

export function scheduleTempoOverride(bpmX100: number): void {
    pending = bpmX100;
    countdown = DEBOUNCE_TICKS;
}

export function tempoOverrideTick(): void {
    if (!pending) return;
    if (--countdown > 0) return;
    if (typeof host_write_file === 'function') {
        host_write_file(PATH, (pending / 100).toFixed(4) + '\n');
    }
    pending = 0;
}
```

Hook: in `src/seq/main-page.ts`, next to the existing `seqCmd('bpm ' + next)`, add `scheduleTempoOverride(next);`. In `src/app/tick.ts`, call `tempoOverrideTick()` once per tick (with the other per-tick maintenance calls, NOT inside the parked early-return skip — the write must still fire if the user backgrounds movy right after a tempo change; check where the Phase 2 parked skip begins and place this above it).

Status parse in `src/seq/engine.ts`: `else if (key === 'ext') seqState.extSync = val === '1';` plus the `extSync: false` field where `seqState` is declared.

EXT marker: in `main-page-vm.ts`, when `seqState.extSync`, suffix the tempo cell's value with `' EXT'` (or, if the vm has a dedicated flag/badge convention — check how other cells mark states — follow that convention instead). Renderer follows automatically if it prints the vm string.

- [ ] **Step 3: Screenshot scene** — add a main-page scene variant with `seqState.extSync = true`; `node browser-test/screenshot.mjs --update`, inspect the new baseline (tempo cell shows EXT), then a clean `node browser-test/screenshot.mjs` run with 0 failures and no other baseline drift.

- [ ] **Step 4: Full local suite** — `npm run typecheck && npm test && (cd engine && cargo test)` → all green.

- [ ] **Step 5: Commit**

```bash
git add src/seq/tempo-override.ts src/seq/main-page.ts src/seq/engine.ts src/seq/main-page-vm.ts \
        src/app/tick.ts browser-test/ 
git commit -m "$(cat <<'EOF'
feat(movy): EXT follow indicator + tempo knob sets device tempo via Link override

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

(Also `git add` the seqState declaration file and any new baseline PNG.)

---

### Task 5: Device e2e

**Files:** none. If `move.local` is offline: report `DEVICE OFFLINE — DEVICE VERIFICATION SKIPPED` in CAPS, push, stop.

- [ ] **Step 1: Deploy + regression suites**

```bash
cd /Users/dake/git/cld/movy
./scripts/test.sh          # param-UI e2e must stay green
./scripts/test-seq.sh      # deploys dsp.so; sequencer e2e must stay green
```

- [ ] **Step 2: Follow verification** (PASS criteria — record results honestly):

1. Start the movy sequencer with an audible pattern (movy standalone): plays at movy's tempo, synced LFOs locked (Phase 1 behavior unchanged).
2. Start Move's native sequencer (background movy first): on Move's Play (`0xFA`), movy restarts the bar with Move — both downbeats coincide, and stay coincident for ≥ 2 minutes (drift-free). The main-page tempo cell shows **EXT** and displays Move's tempo.
3. Change Move's tempo from Move's UI: movy follows within ~a second (EMA), notes stay locked.
4. Turn movy's tempo knob while following: Move's tempo changes (visible on Move's screen) and both stay locked. Expect brief rubber-banding on the movy display — converging is PASS, oscillating forever is FAIL.
5. Stop Move: movy keeps playing at the captured tempo; within one bar the synced LFOs re-lock to movy's grid (internal clock resumed).
6. With movy STOPPED, press Move's Play: movy must NOT start.

- [ ] **Step 3: Perf spot-check** — `./scripts/test.sh` perf timings within noise of the Task 5 Step 1 run.

- [ ] **Step 4: Commit any device-found fixes**, with the failing observation in the message.

---

### Task 6: Docs + wrap-up

**Files:**
- Modify: `MANUAL.md` — new "Syncing with Move's sequencer" subsection (automatic; the six behaviors from Task 5 Step 2, in the manual's voice; note the tempo knob sets the device tempo and the Live-connected exception) + Controls reference row for the tempo knob's new side effect; reuse the EXT baseline via `node scripts/make-doc-assets.mjs <baseline-name>`.
- Modify: `README.md` — one Features bullet: syncs with Move's native sequencer (automatic clock follow + shared tempo).

- [ ] **Step 1: Write both docs** (read them first; match voice and granularity).
- [ ] **Step 2: Final full local suite**, commit, push:

```bash
npm test && (cd engine && cargo test)
git add MANUAL.md README.md docs/assets/
git commit -m "$(cat <<'EOF'
docs(movy): document automatic Move-sync (clock follow, shared tempo, EXT indicator)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push
```

- [ ] **Step 3: Report:** behaviors verified on device (or DEVICE OFFLINE), and that Phase 3 closes the design's planned scope — remaining future item is Link-as-clock-source only.

---

## Self-review notes (plan time)

- Spec coverage: design §7 Phase 3 items 1–3 → Tasks 1–4; "zero schwung changes" → Global Constraints; automatic semantics (no force start/stop, FA re-anchor, bar-quantized join, revert-keeps-playing, staleness) → Task 2 tests one-for-one; Move-Play-must-not-start-movy → `ext_clock_ignored_while_stopped` + device step 6. CC 85 explicitly out of scope.
- Type consistency: `on_external_realtime(status, out)` matches between Tasks 1–3; `ext=` field name matches Tasks 3–4; `scheduleTempoOverride/tempoOverrideTick` match Task 4's test and implementation.
- Known judgment points for the executor: merging the Task 2 `advance_block` with the current Phase 1 body (preserve count-in and surrounding logic), the seqState declaration location, and the vm badge convention — each has a grep instruction.
