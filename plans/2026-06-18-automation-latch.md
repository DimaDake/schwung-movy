# Automation Latch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change parameter-automation playback from a one-step blip (revert-to-base every unlocked step) to a latch that holds a value forward until the next lock on the lane or the next note on a different step, carrying across the loop boundary.

**Architecture:** Pure engine playback change in `seq-core`. The per-step `Lock` store, all UI gestures, the dot, persistence, and the on-screen-knob-stays-on-base behavior are untouched. A new pure `Clip::effective_at` encodes the latch rule deterministically (used as the test oracle); the runtime path is an O(1) forward recurrence in `emit_automation` using a per-track `auto_cur` carry, emitting CCs only on change. One small UI change drops the revert-to-base when a live-recorded knob is released so live takes latch like step automation.

**Tech Stack:** Rust (`seq-core`, host-tested with `cargo test`); TypeScript UI (`src/seq`, tested with `browser-test/logic.mjs`).

**Spec:** `docs/superpowers/specs/2026-06-18-automation-latch-design.md`

---

## File Structure

- `engine/crates/seq-core/src/clip.rs` — add `effective_at` (pure latch oracle) + tests.
- `engine/crates/seq-core/src/track.rs` — add `auto_cur: [i16; 8]` runtime carry state.
- `engine/crates/seq-core/src/engine.rs` — rewrite `emit_automation` to latch; reset `auto_cur` wherever `last_auto_step` resets (`start_transport`, `stop`, bar-boundary clip switch); update/extend tests.
- `engine/crates/movy-dsp/src/lib.rs` + `src/seq/constants.ts` — bump `ENGINE_VERSION` (must match).
- `src/seq/automation.ts` — drop revert-to-base on release for recorded lanes; remove dead `recordingLanes`.
- `browser-test/logic.mjs` — test that a recorded-lane release issues no `abase` revert.

---

## Task 1: `Clip::effective_at` — the pure latch oracle

**Files:**
- Modify: `engine/crates/seq-core/src/clip.rs` (add method near `lock_at`, ~line 107; add tests in the `#[cfg(test)] mod tests`)

- [ ] **Step 1: Write the failing tests**

Add to the `mod tests` block at the bottom of `clip.rs`:

```rust
    #[test]
    fn effective_at_latches_until_note_or_lock() {
        let mut c = Clip::new();
        // One-bar clip: note at step 0 (extends length to 16), lock 100 at step 4.
        c.toggle_step(0, &[(60, 100)]);
        c.set_lock(0, 4, 100);
        // base = 40 (resting value)
        assert_eq!(c.effective_at(0, 0, 40), 40); // note at step 0 → base
        assert_eq!(c.effective_at(0, 3, 40), 40); // before the lock → base (carry of base)
        assert_eq!(c.effective_at(0, 4, 40), 100); // lock
        assert_eq!(c.effective_at(0, 9, 40), 100); // latch holds (no note, no later lock)
        assert_eq!(c.effective_at(0, 15, 40), 100); // still holds to end of bar
    }

    #[test]
    fn effective_at_note_on_other_step_reverts_to_base() {
        let mut c = Clip::new();
        c.toggle_step(0, &[(60, 100)]); // note step 0
        c.toggle_step(8, &[(62, 100)]); // note step 8 (different step) ends the latch
        c.set_lock(0, 4, 100);
        assert_eq!(c.effective_at(0, 7, 40), 100); // latch from lock 4 still on
        assert_eq!(c.effective_at(0, 8, 40), 40); // note on step 8 reverts to base
        assert_eq!(c.effective_at(0, 12, 40), 40); // stays base after the interrupting note
    }

    #[test]
    fn effective_at_lock_wins_over_same_step_note() {
        let mut c = Clip::new();
        c.toggle_step(0, &[(60, 100)]); // note AND lock on step 0
        c.set_lock(0, 0, 90);
        assert_eq!(c.effective_at(0, 0, 40), 90); // co-located lock wins (note doesn't end it)
        assert_eq!(c.effective_at(0, 5, 40), 90); // latches forward
    }

    #[test]
    fn effective_at_carries_across_loop_boundary() {
        let mut c = Clip::new();
        c.toggle_step(0, &[(60, 100)]); // length 16; note at step 0
        c.set_lock(0, 14, 77);
        // Going backward cyclically from step 2: 2,1,0(note→base?) — but lock 14
        // is reached before... no: backward from 2 hits step 0 (note) before 14.
        // The note at step 0 ends the latch → base at step 2.
        assert_eq!(c.effective_at(0, 2, 40), 40);
        // Remove the note: now the lock at 14 wraps to govern step 2.
        c.notes.clear();
        assert_eq!(c.effective_at(0, 2, 40), 77); // carries across the boundary
    }

    #[test]
    fn effective_at_no_locks_is_base() {
        let mut c = Clip::new();
        c.toggle_step(0, &[(60, 100)]);
        assert_eq!(c.effective_at(0, 5, 40), 40);
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && cargo test -p seq-core effective_at`
Expected: FAIL — `no method named effective_at found for struct Clip`.

- [ ] **Step 3: Implement `effective_at`**

Add this method to `impl Clip` in `clip.rs`, right after `lock_at` (the method ending near line 114):

```rust
    /// Effective automation value at `step` for `lane`, given the lane `base`.
    /// Pure, position-deterministic form of the latch rule: scan backward
    /// cyclically within the loop window — the first lock found governs (it
    /// latched forward with no interrupting note), a note found first means the
    /// latch was already broken → base. Mirrors the engine's forward recurrence
    /// in steady state and is the test oracle for it.
    pub fn effective_at(&self, lane: u8, step: u16, base: u8) -> u8 {
        let len = self.length_steps;
        if len == 0 {
            return base;
        }
        let start = self.loop_start_steps;
        let rel = step.wrapping_sub(start) as i32;
        for d in 0..len as i32 {
            let off = (rel - d).rem_euclid(len as i32) as u16;
            let s = start + off;
            if let Some(v) = self.lock_at(lane, s) {
                return v;
            }
            if self.step_has_notes(s) {
                return base;
            }
        }
        base
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd engine && cargo test -p seq-core effective_at`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add engine/crates/seq-core/src/clip.rs
git commit -m "$(cat <<'EOF'
feat(engine): add Clip::effective_at latch oracle

Pure, position-deterministic resolution of an automation lane's value at a
step: the most recent lock governs, an interrupting note on a different step
reverts to base, latches carry across the loop boundary.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Latching `emit_automation` + `auto_cur` carry state

**Files:**
- Modify: `engine/crates/seq-core/src/track.rs:26-30` (add field), `:49-52` (init)
- Modify: `engine/crates/seq-core/src/engine.rs` — `start_transport` (~240), `stop` (~310), bar-boundary switch (~439), `emit_automation` (~534), and tests (~824)

- [ ] **Step 1: Write the failing tests**

Replace the existing test `emits_lock_value_on_locked_step_and_base_elsewhere` (engine.rs ~line 824-840) with these latch tests. (Keep `no_cc_for_unassigned_lane` as-is.)

```rust
    // Collect (lane, val) CCs for track 0 from an event list.
    fn ccs0(ev: &[OutEvent]) -> Vec<(u8, u8)> {
        ev.iter().filter_map(|x| match x {
            OutEvent::Cc { lane, val, track: 0 } => Some((*lane, *val)),
            _ => None,
        }).collect()
    }

    #[test]
    fn automation_latches_forward_emitting_on_change_only() {
        let mut e = engine();
        // Lane 0 assigned, base 40; note at step 0; lock 100 at step 2.
        e.tracks[0].lane_assigned[0] = true;
        e.tracks[0].lane_base[0] = 40;
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.tracks[0].active_mut().set_lock(0, 2, 100);
        e.play();
        // Run one full bar (16 steps) + slack.
        let ev = run_ticks(&mut e, 16 * TICKS_PER_STEP as u64 + 2);
        let ccs = ccs0(&ev);
        // Expect exactly two changes in the bar: base 40 at step 0, lock 100 at
        // step 2 — then 100 latches (no per-step re-emit).
        assert_eq!(ccs, vec![(0, 40), (0, 100)], "latch should emit on change only");
    }

    #[test]
    fn automation_reverts_to_base_on_note_at_other_step() {
        let mut e = engine();
        e.tracks[0].lane_assigned[0] = true;
        e.tracks[0].lane_base[0] = 40;
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.tracks[0].active_mut().toggle_step(8, &[(62, 100)]); // note step 8
        e.tracks[0].active_mut().set_lock(0, 2, 100);
        e.play();
        let ev = run_ticks(&mut e, 16 * TICKS_PER_STEP as u64 + 2);
        let ccs = ccs0(&ev);
        // step0 → base 40, step2 → 100, step8 note → back to base 40.
        assert_eq!(ccs, vec![(0, 40), (0, 100), (0, 40)]);
    }

    #[test]
    fn automation_carries_across_loop_boundary() {
        let mut e = engine();
        e.tracks[0].lane_assigned[0] = true;
        e.tracks[0].lane_base[0] = 40;
        // No notes → nothing interrupts; lock 77 at step 14.
        e.tracks[0].active_mut().set_lock(0, 14, 77);
        // Give the clip a length so it plays (set_loop one bar) without notes.
        e.tracks[0].active_mut().set_loop(0, 16);
        e.play();
        // Two full bars: after the lock at 14 the value 77 must persist past the
        // wrap (no re-revert to base at step 0 of the second pass).
        let ev = run_ticks(&mut e, 32 * TICKS_PER_STEP as u64 + 2);
        let ccs = ccs0(&ev);
        // First pass: base 40 (seed at step 0), then 77 at step 14. Second pass:
        // value stays 77 across the boundary → no further CC.
        assert_eq!(ccs, vec![(0, 40), (0, 77)]);
    }

    #[test]
    fn automation_matches_effective_at_oracle_in_steady_state() {
        let mut e = engine();
        e.tracks[0].lane_assigned[0] = true;
        let base = 40u8;
        e.tracks[0].lane_base[0] = base;
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.tracks[0].active_mut().toggle_step(8, &[(62, 100)]);
        e.tracks[0].active_mut().set_lock(0, 2, 100);
        e.tracks[0].active_mut().set_lock(0, 10, 55);
        e.play();
        // Run two full bars; track the last emitted value, compare per-step on
        // the SECOND pass to the oracle (first pass seeds the carry).
        let mut cur: i16 = -1;
        let mut got = [0u8; 16];
        for step in 0..32u64 {
            let ev = run_ticks(&mut e, TICKS_PER_STEP as u64);
            for (l, v) in ccs0(&ev) {
                if l == 0 { cur = v as i16; }
            }
            if step >= 16 {
                got[(step - 16) as usize] = cur as u8;
            }
        }
        let clip = e.tracks[0].active().clone();
        for s in 0..16u16 {
            assert_eq!(got[s as usize], clip.effective_at(0, s, base),
                "step {s} mismatch vs oracle");
        }
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && cargo test -p seq-core automation_`
Expected: FAIL — the current per-step emit produces `(0,40),(0,100),(0,40),(0,40)…` (re-emits base every unlocked step), so `assert_eq!(ccs, …)` fails. `auto_cur` does not exist yet (compile error in Step 4's impl is expected to be resolved together — run after Steps 3-4).

- [ ] **Step 3: Add the `auto_cur` carry field to `Track`**

In `engine/crates/seq-core/src/track.rs`, add the field after `last_auto_step` (line 30):

```rust
    /// Last step automation was emitted for (per track) — see engine emission.
    pub last_auto_step: i32,
    /// Per-lane value currently applied during playback (`-1` = none emitted
    /// yet → force emit). The latch carry: an unlocked, note-free step holds
    /// this. Runtime-only (derived; not persisted).
    pub auto_cur: [i16; 8],
```

And initialise it in `Track::new()` after `last_auto_step: -1,` (line 52):

```rust
            last_auto_step: -1,
            auto_cur: [-1; 8],
```

- [ ] **Step 4: Rewrite `emit_automation` and reset `auto_cur` at the reset points**

In `engine/crates/seq-core/src/engine.rs`, replace the body of `emit_automation` (the loop at ~534-544) with the forward recurrence:

```rust
    /// Emit automation CCs for `track` entering `step` (the latch). Each
    /// assigned lane resolves to: its lock at this step (a new automation
    /// point), else base if a note is anchored here (a note on a step other
    /// than the latch origin ends it), else the carried value (latch holds).
    /// Emits only when the value changes; carry persists across the loop
    /// boundary because `auto_cur` is not reset on wrap.
    fn emit_automation(&mut self, track: usize, slot: usize, step: u16, out: &mut Vec<OutEvent>) {
        for lane in 0..8u8 {
            if !self.tracks[track].lane_assigned[lane as usize] {
                continue;
            }
            let base = self.tracks[track].lane_base[lane as usize];
            let v: u8 = {
                let clip = &self.tracks[track].clips[slot];
                if let Some(lv) = clip.lock_at(lane, step) {
                    lv
                } else if clip.step_has_notes(step) {
                    base
                } else {
                    let cur = self.tracks[track].auto_cur[lane as usize];
                    if cur >= 0 { cur as u8 } else { base }
                }
            };
            if v as i16 != self.tracks[track].auto_cur[lane as usize] {
                self.tracks[track].auto_cur[lane as usize] = v as i16;
                out.push(OutEvent::Cc { track: track as u8, lane, val: v });
            }
        }
    }
```

In `start_transport` (~240), reset the carry alongside `last_auto_step`:

```rust
            t.pos_tick = start;
            t.last_auto_step = -1; // re-emit automation from step 0 on (re)start
            t.auto_cur = [-1; 8];
```

In `stop` (~310-312), do the same:

```rust
        for t in &mut self.tracks {
            t.last_auto_step = -1;
            t.auto_cur = [-1; 8];
        }
```

In the bar-boundary clip switch (~439-443), reset the new clip's carry so the previous clip's latch doesn't bleed in:

```rust
                if let Some(slot) = t.queued_slot.take() {
                    t.playing_slot = Some(slot);
                    t.active_clip = slot;
                    t.pos_tick = t.clips[slot].loop_start_ticks();
                    t.last_auto_step = -1;
                    t.auto_cur = [-1; 8];
                }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd engine && cargo test -p seq-core`
Expected: PASS — all latch tests green, no regressions in the rest of `seq-core`.

- [ ] **Step 6: Commit**

```bash
git add engine/crates/seq-core/src/track.rs engine/crates/seq-core/src/engine.rs
git commit -m "$(cat <<'EOF'
feat(engine): latch automation playback instead of per-step blip

emit_automation now holds a lane's value forward (carry in Track.auto_cur)
until the next lock or a note on a different step reverts it to base; emits
on change only and carries across the loop boundary. Verified against the
effective_at oracle.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Bump `ENGINE_VERSION` (playback semantics changed)

**Files:**
- Modify: `engine/crates/movy-dsp/src/lib.rs:18`
- Modify: `src/seq/constants.ts:22`

- [ ] **Step 1: Bump the Rust constant**

In `engine/crates/movy-dsp/src/lib.rs` line 18:

```rust
const ENGINE_VERSION: &str = "0.16.0";
```

- [ ] **Step 2: Bump the TS constant to match**

In `src/seq/constants.ts` line 22:

```typescript
export const ENGINE_VERSION = '0.16.0';
```

- [ ] **Step 3: Verify they match**

Run: `grep -h "0.16.0" engine/crates/movy-dsp/src/lib.rs src/seq/constants.ts`
Expected: two lines, both showing `0.16.0`.

- [ ] **Step 4: Commit**

```bash
git add engine/crates/movy-dsp/src/lib.rs src/seq/constants.ts
git commit -m "$(cat <<'EOF'
chore: bump ENGINE_VERSION to 0.16.0 for latch playback

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Live-recorded automation latches (drop revert-to-base on release)

**Files:**
- Modify: `src/seq/automation.ts` — `recordingLanes` decl (~131-133), its `.add` (~180), the release handler (~188-210)
- Modify: `browser-test/logic.mjs` — automation knob-routing block (~1993-2025)

- [ ] **Step 1: Write the failing test**

In `browser-test/logic.mjs`, inside the "automation knob routing" block, add `automationKnobReleased` to the import and append this case before the closing `}` (after the Rec-armed test at ~line 2024):

```javascript
    // Live-recorded automation latches: releasing the knob does NOT revert the
    // param to base — the recorded lock holds until its end trigger.
    resetAutomation(); resetSeqEngine(); resetSeqState();
    seqState.recording = true; seqState.playing = true; seqState.curStep = 7;
    handleAutomationKnob(0, 0, info, +1, () => true);   // assigns lane 0, records lock
    const beforeLen = peekSeqCmdQueue().length;
    automationKnobReleased(0, 0, info);
    const afterRelease = peekSeqCmdQueue().slice(beforeLen);
    eq('recorded-lane release issues no abase revert',
        afterRelease.some((o) => o.startsWith('abase 0 0')), false);
    resetSeqState();
```

Update the import line (~1996) to include `automationKnobReleased`:

```javascript
    const { resetAutomation, handleAutomationKnob, automationKnobReleased } = await import('../dist/esm/seq/automation.js');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/logic.mjs 2>&1 | grep -i "abase revert"`
Expected: FAIL — the current code queues `abase 0 0 64` (revert), so `some(startsWith('abase 0 0'))` is `true` (expected `false`).

- [ ] **Step 3: Remove the revert-to-base on release; delete dead `recordingLanes`**

In `src/seq/automation.ts`:

Delete the `recordingLanes` declaration and its comment (~131-133):

```typescript
/* Lanes (track*8+lane) currently being live-recorded — used to revert the
 * synth to base when the knob is released. */
const recordingLanes = new Set<number>();
```

Delete the `.add` line in `handleAutomationKnob` (~180):

```typescript
    if (recArmed) recordingLanes.add(track * 8 + lane);
```

Replace the recorded-lane branch of `automationKnobReleased` (~203-209) — change:

```typescript
    if (lane < 0) return;
    const baseN = norm7(info.value, info.min, info.max);
    if (recordingLanes.delete(track * 8 + lane)) {
        seqCmd('abase ' + track + ' ' + lane + ' ' + baseN); // emits → revert to base
    } else if (!seqState.stepAutoMode) {
        seqCmd('abaseq ' + track + ' ' + lane + ' ' + baseN); // quiet base sync
    }
```

to:

```typescript
    if (lane < 0) return;
    // Live-recorded automation latches until its end trigger (next note on a
    // different step, or next lock) — no revert-to-base on release. Only a
    // normal (non-automation) edit syncs the engine base, quietly.
    if (!seqState.stepAutoMode) {
        seqCmd('abaseq ' + track + ' ' + lane + ' ' + norm7(info.value, info.min, info.max));
    }
```

- [ ] **Step 4: Run the test (and typecheck) to verify it passes**

Run: `cd /Users/dake/git/cld/movy && npm run typecheck && npm run build:browser && node browser-test/logic.mjs 2>&1 | tail -3`
Expected: typecheck clean (no unused `recordingLanes`); logic.mjs `0 failures`.

- [ ] **Step 5: Commit**

```bash
git add src/seq/automation.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(automation): live-recorded values latch to their end trigger

Releasing a live-recorded knob no longer reverts the param to base; the
recorded lock now holds until the next note on a different step or the next
lock, matching step automation. Removes dead recordingLanes tracking.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Full verification (local suite + device)

**Files:** none (verification only)

- [ ] **Step 1: Run the full Rust engine test suite**

Run: `cd /Users/dake/git/cld/movy/engine && cargo test`
Expected: all crates pass (PASS, 0 failures).

- [ ] **Step 2: Run the full local JS suite**

Run:
```bash
cd /Users/dake/git/cld/movy
npm run build:browser
node browser-test/logic.mjs
node browser-test/app-loop.mjs
node browser-test/screenshot.mjs
node browser-test/perf.mjs
```
Expected: each reports `0 failures`. No screenshot baselines change (no render change); if `screenshot.mjs` reports diffs, investigate — it should NOT, since this is engine-only. Perf test 2b ("automation lanes are decoupled from playback") must still pass.

- [ ] **Step 3: Device e2e (if `move.local` reachable)**

Run:
```bash
cd /Users/dake/git/cld/movy
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && ./scripts/test-seq.sh \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```
`test-seq.sh` builds + deploys `dsp.so` (new ENGINE_VERSION) and runs the sequencer e2e (transport, steps, record, persistence). Expected: PASS. If the device is offline, **report DEVICE OFFLINE to the user in CAPS** so they know device verification was skipped. Manually confirm on device when possible: set a lock on one step, play — the value audibly holds across following steps and reverts to base only on the next note on a different step.

- [ ] **Step 4: Final commit (only if Step 3 produced changes, e.g. deploy artifacts)**

Most likely nothing to commit here. If `test-seq.sh` regenerated any tracked artifact:
```bash
git add <specific files>
git commit -m "$(cat <<'EOF'
test: device e2e for latch automation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review notes

- **Spec coverage:** §3 recurrence → Task 2 `emit_automation`; §3 `effective_at` oracle → Task 1; §4 `track.rs auto_cur` + resets → Task 2; §4 version bump → Task 3; §4 live recording / §5 release change → Task 4; §7 tests → Tasks 1, 2, 4; device → Task 5. The spec's "seed on seek" is intentionally omitted: the engine only ever (re)starts playback at a clip's loop-start (`start_transport`, bar-boundary switch both set `pos` to `loop_start_ticks`), and `auto_cur` is reset at each of those points, so the forward recurrence is correct from the first step without a separate backward-scan seed. Carry-across-boundary is covered because `auto_cur` is *not* reset on loop wrap.
- **Type consistency:** `effective_at(lane: u8, step: u16, base: u8) -> u8`, `auto_cur: [i16; 8]`, `automationKnobReleased(track, physK, info)` used consistently across tasks.
- **No placeholders:** every code step shows complete code.
