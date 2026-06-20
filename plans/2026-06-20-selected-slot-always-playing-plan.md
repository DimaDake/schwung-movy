# Selected Slot Always Playing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While the transport runs, entering a note into the selected slot makes that slot play immediately, grid-aligned — the selected slot is always the playing slot.

**Architecture:** A single engine helper `ensure_selected_playing(track)` sets the edited track's `playing_slot` to its `active_clip` (seeding the playhead to the master grid phase), called from the `tog` and `ltog` command arms. Gated on `self.playing`, so the stopped/no-autostart behavior is unchanged. No UI change — playback, LEDs, and persistence already key off `playing_slot`.

**Tech Stack:** Rust (`seq-core`), `cargo test`; movy browser tests (`npm test`); device e2e (`test-seq.sh`).

Spec: `movy/plans/2026-06-20-selected-slot-always-playing.md`

---

### Task 1: Engine helper + wiring with TDD

**Files:**
- Modify: `engine/crates/seq-core/src/engine.rs` (add `ensure_selected_playing`)
- Modify: `engine/crates/seq-core/src/command.rs` (call from `tog`/`ltog` arms; add tests)

- [ ] **Step 1: Write the failing tests**

Add to the `#[cfg(test)]` module in `engine/crates/seq-core/src/command.rs`:

```rust
#[test]
fn tog_while_playing_makes_selected_slot_play() {
    let mut e = engine();
    let mut out = Vec::new();
    // Transport running, track 0's selected slot empty + never launched.
    apply_batch(&mut e, "play", &mut out);
    assert_eq!(e.tracks[0].playing_slot, None, "empty selected slot isn't playing yet");
    apply_batch(&mut e, "tog 0 4 60 100", &mut out);
    assert!(e.playing);
    assert_eq!(
        e.tracks[0].playing_slot,
        Some(e.tracks[0].active_clip),
        "entering a note while playing makes the selected slot the playing slot"
    );
}

#[test]
fn ltog_while_playing_makes_selected_slot_play() {
    let mut e = engine();
    let mut out = Vec::new();
    apply_batch(&mut e, "play", &mut out);
    apply_batch(&mut e, "ltog 0 4 36 100", &mut out);
    assert_eq!(e.tracks[0].playing_slot, Some(e.tracks[0].active_clip));
}

#[test]
fn tog_while_playing_grid_aligns_playhead() {
    let mut e = engine();
    let mut out = Vec::new();
    apply_batch(&mut e, "play", &mut out);
    // Advance partway into the bar so the playhead is not at step 0.
    e.advance_block(crate::TICKS_PER_STEP as u32 * 3, &mut out);
    let master_phase = e.tracks[0].pos_tick; // a reference track already playing would sit here
    apply_batch(&mut e, "tog 0 8 60 100", &mut out);
    // The newly-playing track is seeded to the master grid phase, not step 0.
    assert_eq!(
        e.tracks[0].pos_tick % crate::TICKS_PER_BAR as u32,
        master_phase % crate::TICKS_PER_BAR as u32,
        "playhead is grid-aligned, not restarted at step 0"
    );
}
```

Note: `tog 0 4 ...` puts the note at step 4. In `tog_while_playing_grid_aligns_playhead` track 0 was empty before `tog`, so after `play()` its `playing_slot` is `None` and `pos_tick` stays 0 while the bar advances; the assertion checks the helper seeds `pos_tick` to `master_tick % len` (= 3 steps in), proving grid alignment rather than a step-0 restart. If `TICKS_PER_BAR`/`TICKS_PER_STEP` aren't visible at `crate::`, use the same path the existing tests use (grep `TICKS_PER` in `command.rs`/`engine.rs`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && cargo test -p seq-core tog_while_playing ltog_while_playing`
Expected: FAIL — `playing_slot` is `None` (helper not wired yet).

- [ ] **Step 3: Add the helper to `engine.rs`**

Place near `launch_clip` / `play` (after `start_transport`):

```rust
    /// While the transport runs, ensure the edited track's selected clip is the
    /// one playing, so step entry into an empty/selected slot is immediately
    /// audible (the selected slot is always the playing slot). Seeds the
    /// playhead to the master bar/step phase so the clip stays in sync with the
    /// bar and the other playing tracks. No-op when stopped (preserves the
    /// no-autostart-on-note-entry rule) or when this slot is already playing
    /// (don't disturb a running clip's playhead).
    fn ensure_selected_playing(&mut self, track: usize) {
        if !self.playing || track >= NUM_TRACKS {
            return;
        }
        let slot = self.tracks[track].active_clip;
        // A note into the selected slot cancels any Session stop/queue on it.
        self.tracks[track].queued_slot = None;
        self.tracks[track].pending_stop = false;
        if self.tracks[track].playing_slot == Some(slot) {
            return;
        }
        self.tracks[track].playing_slot = Some(slot);
        let len = self.tracks[track].clips[slot].length_ticks().max(1) as u64;
        let start = self.tracks[track].clips[slot].loop_start_ticks();
        self.tracks[track].pos_tick = start + (self.master_tick % len) as u32;
        self.tracks[track].last_auto_step = -1;
        self.tracks[track].auto_cur = [-1; 8];
    }
```

Make it `pub(crate)` instead of private only if `command.rs` is a separate module that can't see a private method — it is in the same crate; check whether sibling `engine.rs` methods called from `command.rs` (e.g. `launch_clip`, `toggle_record`) are `pub`. Match their visibility (they are `pub`), so declare `pub fn ensure_selected_playing`.

- [ ] **Step 4: Wire it into `command.rs`**

In the `"tog"` arm, after the `toggle_step` call, inside the `if (t as usize) < NUM_TRACKS {` block:

```rust
                if (t as usize) < NUM_TRACKS {
                    engine.tracks[t as usize]
                        .active_mut()
                        .toggle_step(s.clamp(0, 255) as u16, &chord);
                    engine.ensure_selected_playing(t as usize);
                }
```

In the `"ltog"` arm, after its lane toggle is applied, likewise call `engine.ensure_selected_playing(t as usize);` within the `t < NUM_TRACKS` guard. (Grep `"ltog"` in `command.rs` to place it exactly.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd engine && cargo test -p seq-core`
Expected: PASS — new tests pass; `tog_does_not_autostart_transport` and all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add engine/crates/seq-core/src/engine.rs engine/crates/seq-core/src/command.rs
git commit -m "$(cat <<'EOF'
feat(seq): selected slot is always the playing slot while transport runs

Entering a note into the selected slot now makes that slot play
immediately, grid-aligned to the master bar phase. No-op when stopped.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Full test pass + deploy + push

- [ ] **Step 1: Local movy tests**

Run: `cd movy && npm test`
Expected: 0 failures across logic / app-loop / screenshot / perf.

- [ ] **Step 2: Engine tests (already covered, re-confirm)**

Run: `cd movy/engine && cargo test`
Expected: PASS.

- [ ] **Step 3: Device e2e (if reachable)**

Run:
```bash
cd movy
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && ./scripts/test-seq.sh \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```
Expected: PASS, or report DEVICE OFFLINE in CAPS to the user.
`test-seq.sh` builds + deploys `dsp.so`, required for this engine change.

- [ ] **Step 4: Commit any test/baseline updates and push to main**

```bash
git add -A   # only if baselines/tests changed; otherwise skip
git commit -m "test(seq): cover selected-slot-always-playing" 2>/dev/null || true
git push
```
Branchless: commit straight to `main` and push, per user instruction.

---

## Self-Review

- **Spec coverage:** invariant (Task 1 helper), grid-align timing (Task 1 test + seed), stopped no-op preserved (gated on `self.playing`, existing test re-run), `tog`+`ltog` wiring (Task 1 Step 4), no UI change (none planned), tests (Task 1 + Task 2). All covered.
- **Placeholders:** none — all code shown.
- **Type consistency:** `ensure_selected_playing(track: usize)`, `pos_tick: u32`, `master_tick: u64`, `length_ticks()/loop_start_ticks(): u32` — consistent with confirmed source.
