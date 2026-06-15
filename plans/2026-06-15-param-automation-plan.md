# Parameter Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native-Move-style per-step parameter automation to movy — up to 8 lanes per track, each targeting any chain param, played back block-rate via `CC 102–109` emitted by the engine.

**Architecture:** The Rust engine (`seq-core`) owns automation as sparse per-clip locks `(lane,step,val)` plus per-track lane state (assigned/base/label); it emits `OutEvent::Cc` on step entry (revert-to-base on un-locked steps), which `movy-dsp` turns into `midi_send_internal(0xB0|track, 102+lane, val)`. The chain's stock `knob_<N>_set` + CC-102 handler writes the actual param (spike-verified). The UI assigns lanes (a pool of 8) by issuing `knob_<N>_set` to the chain, mirrors engine status, edits locks on hold-step/Rec knob turns, and renders dots + held-step values.

**Tech Stack:** Rust (`seq-core` pure logic, `movy-dsp` cdylib), TypeScript (esbuild → `ui.js`), node `.mjs` test harnesses, device e2e via `scripts/test-seq.sh`.

**Design spec:** `movy/plans/2026-06-15-param-automation-design.md`

---

## File Structure

**Engine (Rust):**
- `engine/crates/seq-core/src/clip.rs` — add `Lock` + `locks: Vec<Lock>` + lock methods.
- `engine/crates/seq-core/src/track.rs` — add per-track lane state (`lane_assigned`, `lane_base`, `lane_label`).
- `engine/crates/seq-core/src/engine.rs` — add `OutEvent::Cc`, automation emission on step entry, `aset/abase/aclr/alabel` engine methods, status fields, `alabels` getter, lane-aware copy/paste.
- `engine/crates/seq-core/src/command.rs` — parse `aset/abase/aclr/alabel` ops.
- `engine/crates/seq-core/src/persist.rs` — serialize/load lane state + locks.
- `engine/crates/movy-dsp/src/lib.rs` — `OutEvent::Cc` → `midi_send_internal`; bump `ENGINE_VERSION`; route `get_param("alabels")`.

**UI (TypeScript):**
- `src/seq/constants.ts` — bump `ENGINE_VERSION` to match.
- `src/seq/state.ts` — mirror fields: `autoAssigned`, `autoActive`, `heldLocks`.
- `src/seq/engine.ts` — parse `alanes`/`aauto`/`hauto`; fetch `alabels` after boot/load.
- `src/seq/automation.ts` — **new**: lane registry + assignment + knob-edit decisions + clear.
- `src/model/index.ts` + `src/model/store.ts` — expose `getKnobParamInfo(physK)` (key/value/min/max/type/automatable/componentKey).
- `src/midi/router.ts` — route knob deltas / knob touch through automation when applicable.
- `src/types/viewmodel.ts` — `ParamVM`: add `automated`, `automatable`, plus held-value support.
- `src/model/viewmodel.ts` — populate the new `ParamVM` fields from an injected `AutomationView`.
- `src/app/tick.ts` — assemble `AutomationView` and pass it into the viewmodel build.
- `src/renderer/label.ts` — draw the automation dot; held-step inverted value; hide non-automatable; limit toast hook.

---

## Phase A — Engine (Rust)

### Task 1: `Lock` type + per-clip lock store

**Files:**
- Modify: `engine/crates/seq-core/src/clip.rs`

- [ ] **Step 1: Write failing tests** — append to the `tests` mod in `clip.rs`:

```rust
    #[test]
    fn lock_set_upsert_and_read() {
        let mut c = Clip::new();
        c.set_lock(2, 4, 100);
        c.set_lock(2, 4, 120); // upsert same lane+step
        assert_eq!(c.lock_at(2, 4), Some(120));
        assert_eq!(c.lock_at(2, 5), None);
        assert_eq!(c.locks.len(), 1);
    }

    #[test]
    fn automated_lanes_bitmask() {
        let mut c = Clip::new();
        c.set_lock(0, 0, 10);
        c.set_lock(3, 8, 20);
        assert_eq!(c.automated_lanes(), 0b0000_1001);
    }

    #[test]
    fn clear_lane_removes_only_that_lane() {
        let mut c = Clip::new();
        c.set_lock(1, 0, 10);
        c.set_lock(2, 0, 20);
        c.clear_lane(1);
        assert_eq!(c.lock_at(1, 0), None);
        assert_eq!(c.lock_at(2, 0), Some(20));
    }

    #[test]
    fn locks_at_step_lists_pairs() {
        let mut c = Clip::new();
        c.set_lock(0, 6, 11);
        c.set_lock(5, 6, 99);
        c.set_lock(0, 7, 1);
        let mut got: Vec<(u8, u8)> = c.locks_at_step(6).collect();
        got.sort_unstable();
        assert_eq!(got, vec![(0, 11), (5, 99)]);
    }
```

- [ ] **Step 2: Run, verify fail**

Run: `cd engine && cargo test -p seq-core lock`
Expected: FAIL — `Lock`/`set_lock`/etc. not found.

- [ ] **Step 3: Implement.** In `clip.rs`, add the type after `Note`:

```rust
/// Max automation locks per clip (8 lanes × generous step budget).
pub const MAX_LOCKS: usize = 1024;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Lock {
    /// Automation lane 0..8 (maps to chain knob lane / abs CC 102+lane).
    pub lane: u8,
    pub step: u16,
    /// 7-bit value (0..=127), scaled to the param range by the chain.
    pub val: u8,
}
```

Add `pub locks: Vec<Lock>,` to `struct Clip`, initialize `locks: Vec::new()` in `Clip::new()`, and add `self.locks.clear();` inside `Clip::clear()`. Then add methods inside `impl Clip`:

```rust
    /// Upsert a lock for (lane, step). Caps at MAX_LOCKS (drops new ones over).
    pub fn set_lock(&mut self, lane: u8, step: u16, val: u8) {
        if let Some(l) = self.locks.iter_mut().find(|l| l.lane == lane && l.step == step) {
            l.val = val;
            return;
        }
        if self.locks.len() < MAX_LOCKS {
            self.locks.push(Lock { lane, step, val });
        }
    }

    pub fn lock_at(&self, lane: u8, step: u16) -> Option<u8> {
        self.locks.iter().find(|l| l.lane == lane && l.step == step).map(|l| l.val)
    }

    pub fn clear_lane(&mut self, lane: u8) {
        self.locks.retain(|l| l.lane != lane);
    }

    /// Bitmask of lanes (bit `lane`) that have ≥1 lock — drives the UI dots.
    pub fn automated_lanes(&self) -> u8 {
        self.locks.iter().fold(0u8, |m, l| m | (1u8 << (l.lane & 7)))
    }

    /// (lane, val) pairs at `step` — for the held-step display.
    pub fn locks_at_step(&self, step: u16) -> impl Iterator<Item = (u8, u8)> + '_ {
        self.locks.iter().filter(move |l| l.step == step).map(|l| (l.lane, l.val))
    }
```

- [ ] **Step 4: Run, verify pass**

Run: `cd engine && cargo test -p seq-core`
Expected: PASS (all, incl. existing).

- [ ] **Step 5: Commit**

```bash
git add engine/crates/seq-core/src/clip.rs
git commit -m "feat(engine): per-clip automation lock store"
```

---

### Task 2: Lane-aware step copy/paste + duplicate

Duplicate already works (Clip clone copies `locks`). This task makes `copy_steps`/`paste_steps` carry locks so the Duplicate-button step copy moves automation, including for note-less steps.

**Files:**
- Modify: `engine/crates/seq-core/src/engine.rs` (`ClipboardNote`/`copy_steps`/`paste_steps`)

- [ ] **Step 1: Write failing test** — add to the `tests` mod in `engine.rs`:

```rust
    #[test]
    fn copy_paste_carries_locks_even_without_notes() {
        use crate::command::apply_batch;
        let mut e = engine();
        let mut out = Vec::new();
        // Lock on step 1 with NO note there; note on step 0.
        apply_batch(&mut e, "tog 0 0 60 100", &mut out);
        e.tracks[0].active_mut().set_lock(2, 1, 77);
        apply_batch(&mut e, "cpy 0 0 3", &mut out);   // copy steps 0-3 (locks + notes)
        apply_batch(&mut e, "pst 0 8", &mut out);     // paste at step 8
        assert_eq!(e.tracks[0].active().lock_at(2, 9), Some(77)); // step 1 → 9
        assert!(e.tracks[0].active().step_has_notes(8));          // step 0 → 8
    }
```

- [ ] **Step 2: Run, verify fail**

Run: `cd engine && cargo test -p seq-core copy_paste_carries_locks`
Expected: FAIL — pasted lock missing.

- [ ] **Step 3: Implement.** In `engine.rs` add a parallel lock clipboard. Add field to `Engine`: `lock_clipboard: Vec<Lock>,` (import `use crate::clip::{Clip, Lock};`), init `lock_clipboard: Vec::new(),` in `Engine::new`. In `copy_steps`, after building `self.clipboard`, capture locks:

```rust
        self.lock_clipboard = self.tracks[track]
            .active()
            .locks
            .iter()
            .filter(|l| l.step >= s0 && l.step <= s1)
            .map(|l| Lock { lane: l.lane, step: l.step - s0, val: l.val })
            .collect();
```

In `paste_steps`, after the note paste loop, add (re-borrow the clip):

```rust
        let lb = self.lock_clipboard.clone();
        let clip = self.tracks[track].active_mut();
        for l in lb {
            clip.set_lock(l.lane, dest_step + l.step, l.val);
        }
```

In `clear_clipboard`, also `self.lock_clipboard.clear();`.

- [ ] **Step 4: Run, verify pass**

Run: `cd engine && cargo test -p seq-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add engine/crates/seq-core/src/engine.rs
git commit -m "feat(engine): step copy/paste carries automation locks"
```

---

### Task 3: Per-track lane state

**Files:**
- Modify: `engine/crates/seq-core/src/track.rs`

- [ ] **Step 1: Write failing test** — add to a new `tests` mod at the bottom of `track.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_track_has_unassigned_lanes() {
        let t = Track::new();
        assert_eq!(t.lane_assigned, [false; 8]);
        assert_eq!(t.lane_base, [0u8; 8]);
        assert!(t.lane_label.iter().all(|s| s.is_empty()));
    }
}
```

- [ ] **Step 2: Run, verify fail**

Run: `cd engine && cargo test -p seq-core new_track_has_unassigned`
Expected: FAIL — fields not found.

- [ ] **Step 3: Implement.** Add to `struct Track`:

```rust
    /// Automation lane state (per track, shared across the track's clips —
    /// mirrors the chain slot's 8 knob mappings). label = "target:param".
    pub lane_assigned: [bool; 8],
    pub lane_base: [u8; 8],
    pub lane_label: [String; 8],
    /// Last step automation was emitted for (per track) — see engine emission.
    pub last_auto_step: i32,
```

Initialize in `Track::new()`:

```rust
            lane_assigned: [false; 8],
            lane_base: [0u8; 8],
            lane_label: Default::default(),
            last_auto_step: -1,
```

(`[String; 8]` implements `Default`.)

- [ ] **Step 4: Run, verify pass**

Run: `cd engine && cargo test -p seq-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add engine/crates/seq-core/src/track.rs
git commit -m "feat(engine): per-track automation lane state"
```

---

### Task 4: `OutEvent::Cc` + automation emission on step entry

**Files:**
- Modify: `engine/crates/seq-core/src/engine.rs`

- [ ] **Step 1: Write failing tests** — add to the `tests` mod in `engine.rs`:

```rust
    #[test]
    fn emits_lock_value_on_locked_step_and_base_elsewhere() {
        use crate::command::apply_batch;
        let mut e = engine();
        let mut out = Vec::new();
        // Lane 0 assigned, base 40; note so the clip plays; lock 100 at step 2.
        apply_batch(&mut e, "alabel 0 0 synth:cutoff;abase 0 0 40;tog 0 0 60 100", &mut out);
        e.tracks[0].active_mut().set_lock(0, 2, 100);
        e.play();
        let ev = run_ticks(&mut e, 3 * TICKS_PER_STEP as u64 + 2);
        let ccs: Vec<(u8, u8)> = ev.iter().filter_map(|x| match x {
            OutEvent::Cc { lane, val, track: 0 } => Some((*lane, *val)), _ => None,
        }).collect();
        // Step 0 (base 40), step 2 (lock 100) both appear; only on step entry.
        assert!(ccs.contains(&(0, 40)));
        assert!(ccs.contains(&(0, 100)));
    }

    #[test]
    fn no_cc_for_unassigned_lane() {
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.tracks[0].active_mut().set_lock(0, 0, 50); // lock but lane unassigned
        e.play();
        let ev = run_ticks(&mut e, TICKS_PER_STEP as u64 + 2);
        assert!(!ev.iter().any(|x| matches!(x, OutEvent::Cc { .. })));
    }
```

- [ ] **Step 2: Run, verify fail**

Run: `cd engine && cargo test -p seq-core emits_lock_value`
Expected: FAIL — `OutEvent::Cc` not found.

- [ ] **Step 3: Implement.** Add the variant to `OutEvent`:

```rust
    /// Parameter automation: chain abs-CC 102+lane, value 0..=127.
    Cc { track: u8, lane: u8, val: u8 },
```

Add an emission helper to `impl Engine`:

```rust
    /// Emit automation CCs for `track` entering `step`: each assigned lane gets
    /// its lock value at this step, or the lane base when no lock (revert-to-base).
    fn emit_automation(&mut self, track: usize, slot: usize, step: u16, out: &mut Vec<OutEvent>) {
        for lane in 0..8u8 {
            if !self.tracks[track].lane_assigned[lane as usize] {
                continue;
            }
            let val = self.tracks[track].clips[slot]
                .lock_at(lane, step)
                .unwrap_or(self.tracks[track].lane_base[lane as usize]);
            out.push(OutEvent::Cc { track: track as u8, lane, val });
        }
    }
```

In `service_tick`, inside the `if self.count_in_left == 0` per-track playback loop, after the position advances/wraps (end of the `for ti in 0..NUM_TRACKS` body, after the wrap block), add step-entry detection:

```rust
                let cur = (self.tracks[ti].pos_tick / TICKS_PER_STEP) as i32;
                if cur != self.tracks[ti].last_auto_step {
                    self.tracks[ti].last_auto_step = cur;
                    let slot2 = self.tracks[ti].playing_slot.unwrap_or(slot);
                    self.emit_automation(ti, slot2, cur as u16, out);
                }
```

(`slot` is already bound earlier in the loop to the playing slot.) In `start_transport`, reset `t.last_auto_step = -1;` for each track so step 0 emits on play. In `stop`, also reset `last_auto_step` to `-1` for all tracks.

- [ ] **Step 4: Run, verify pass**

Run: `cd engine && cargo test -p seq-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add engine/crates/seq-core/src/engine.rs
git commit -m "feat(engine): emit automation CC on step entry with revert-to-base"
```

---

### Task 5: Engine commands `aset/abase/aclr/alabel` + status + `alabels`

**Files:**
- Modify: `engine/crates/seq-core/src/engine.rs` (methods + status + getter)
- Modify: `engine/crates/seq-core/src/command.rs` (op parsing)

- [ ] **Step 1: Write failing tests** — add to the `tests` mod in `command.rs`:

```rust
    #[test]
    fn automation_commands_set_lane_lock_base() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "alabel 0 1 synth:cutoff", &mut out);
        assert!(e.tracks[0].lane_assigned[1]);
        assert_eq!(e.tracks[0].lane_label[1], "synth:cutoff");
        apply_batch(&mut e, "abase 0 1 64", &mut out);
        assert_eq!(e.tracks[0].lane_base[1], 64);
        // abase emits a live CC immediately (audition / stopped apply).
        assert!(out.iter().any(|x| matches!(x, OutEvent::Cc { track: 0, lane: 1, val: 64 })));
        apply_batch(&mut e, "aset 0 1 5 90", &mut out);
        assert_eq!(e.tracks[0].active().lock_at(1, 5), Some(90));
        apply_batch(&mut e, "aclr 0 1", &mut out);
        assert!(!e.tracks[0].lane_assigned[1]);
        assert_eq!(e.tracks[0].active().lock_at(1, 5), None);
    }

    #[test]
    fn status_reports_automation_fields() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "alabel 0 0 synth:a;alabel 0 2 synth:b", &mut out);
        e.tracks[0].active_mut().set_lock(2, 4, 50);
        apply_batch(&mut e, "hold 0 4", &mut out);
        let s = e.status();
        assert!(s.contains("alanes=05"));  // lanes 0 and 2 assigned
        assert!(s.contains("aauto=04"));   // lane 2 has a lock
        let hauto = s.split("hauto=").nth(1).unwrap().split(' ').next().unwrap();
        assert_eq!(hauto, "2:50");
    }
```

- [ ] **Step 2: Run, verify fail**

Run: `cd engine && cargo test -p seq-core automation_commands status_reports_automation`
Expected: FAIL.

- [ ] **Step 3: Implement engine methods** in `engine.rs`:

```rust
    pub fn auto_label(&mut self, track: usize, lane: usize, label: &str) {
        if track < NUM_TRACKS && lane < 8 {
            self.tracks[track].lane_assigned[lane] = true;
            self.tracks[track].lane_label[lane] = label.to_string();
        }
    }

    pub fn auto_base(&mut self, track: usize, lane: usize, val: u8, out: &mut Vec<OutEvent>) {
        if track < NUM_TRACKS && lane < 8 {
            self.tracks[track].lane_base[lane] = val;
            if self.tracks[track].lane_assigned[lane] {
                out.push(OutEvent::Cc { track: track as u8, lane: lane as u8, val });
            }
        }
    }

    pub fn auto_set(&mut self, track: usize, lane: usize, step: u16, val: u8, out: &mut Vec<OutEvent>) {
        if track < NUM_TRACKS && lane < 8 {
            self.tracks[track].active_mut().set_lock(lane as u8, step, val);
            // Audition: apply now (stopped) / refresh (playing) for the edited lane.
            if self.tracks[track].lane_assigned[lane] {
                out.push(OutEvent::Cc { track: track as u8, lane: lane as u8, val });
            }
        }
    }

    pub fn auto_clear(&mut self, track: usize, lane: usize) {
        if track < NUM_TRACKS && lane < 8 {
            for c in &mut self.tracks[track].clips {
                c.clear_lane(lane as u8);
            }
            self.tracks[track].lane_assigned[lane] = false;
            self.tracks[track].lane_label[lane].clear();
        }
    }

    /// All lanes' labels for every track, for the UI to rebuild its registry +
    /// re-apply chain knob mappings after a load. Format: tracks ',', lanes '.',
    /// each label or '-'.
    pub fn auto_labels(&self) -> String {
        let mut out = String::new();
        for (ti, t) in self.tracks.iter().enumerate() {
            if ti > 0 { out.push(','); }
            for lane in 0..8 {
                if lane > 0 { out.push('.'); }
                let l = &t.lane_label[lane];
                out.push_str(if l.is_empty() { "-" } else { l });
            }
        }
        out
    }
```

Add to `status()` — extend the `format!` (add fields + args). Append to the format string ` alanes={} aauto={} hauto={}` and compute:

```rust
        let alanes = wt.lane_assigned.iter().enumerate()
            .fold(0u8, |m, (i, &a)| if a { m | (1 << i) } else { m });
        let aauto = clip.automated_lanes();
        let hauto = match self.held_query {
            Some((t, step)) if t < NUM_TRACKS => {
                let mut v: Vec<(u8, u8)> = self.tracks[t].active().locks_at_step(step).collect();
                v.sort_unstable();
                v.iter().enumerate().fold(String::new(), |mut s, (i, (l, val))| {
                    if i > 0 { s.push('.'); }
                    s.push_str(&format!("{l}:{val}")); s
                })
            }
            _ => String::new(),
        };
```

Pass `alanes`, `aauto`, `hauto` as the new trailing `format!` args (use `{:02x}` for `alanes` and `aauto`).

- [ ] **Step 4: Implement command parsing** in `command.rs` `apply_op` match (before `_ =>`):

```rust
        // Parameter automation. lane 0..8, val 0..=127.
        "alabel" => {
            // alabel <t> <lane> <target:param>
            let t = next(); let lane = next();
            if let (Some(t), Some(lane)) = (t, lane) {
                let label = it.next().unwrap_or("");
                engine.auto_label(t as usize, lane as usize, label);
            }
        }
        "abase" => {
            if let (Some(t), Some(lane), Some(v)) = (next(), next(), next()) {
                engine.auto_base(t as usize, lane as usize, v.clamp(0, 127) as u8, out);
            }
        }
        "aset" => {
            if let (Some(t), Some(lane), Some(s), Some(v)) = (next(), next(), next(), next()) {
                engine.auto_set(t as usize, lane as usize, s.clamp(0, 255) as u16, v.clamp(0, 127) as u8, out);
            }
        }
        "aclr" => {
            if let (Some(t), Some(lane)) = (next(), next()) {
                engine.auto_clear(t as usize, lane as usize);
            }
        }
```

(Note: `alabel`'s third token is read with `it.next()` directly — it's a `target:param` string, not an integer, so it can't use the `next()` int parser.)

- [ ] **Step 5: Run, verify pass**

Run: `cd engine && cargo test -p seq-core`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add engine/crates/seq-core/src/engine.rs engine/crates/seq-core/src/command.rs
git commit -m "feat(engine): automation commands, status fields, labels getter"
```

---

### Task 6: Persistence + `movy-dsp` wiring + version bump

**Files:**
- Modify: `engine/crates/seq-core/src/persist.rs`
- Modify: `engine/crates/movy-dsp/src/lib.rs`

- [ ] **Step 1: Write failing test** — add to the `tests` mod in `persist.rs`:

```rust
    #[test]
    fn round_trips_automation() {
        let mut e = Engine::new(44100, 12000);
        let mut out = Vec::new();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        crate::command::apply_batch(&mut e, "alabel 0 1 synth:cutoff;abase 0 1 70", &mut out);
        e.tracks[0].active_mut().set_lock(1, 3, 55);
        let s = serialize(&e);
        let mut e2 = Engine::new(44100, 12000);
        assert!(load(&mut e2, &s));
        assert!(e2.tracks[0].lane_assigned[1]);
        assert_eq!(e2.tracks[0].lane_label[1], "synth:cutoff");
        assert_eq!(e2.tracks[0].lane_base[1], 70);
        assert_eq!(e2.tracks[0].active().lock_at(1, 3), Some(55));
    }
```

- [ ] **Step 2: Run, verify fail**

Run: `cd engine && cargo test -p seq-core round_trips_automation`
Expected: FAIL.

- [ ] **Step 3: Implement persist.** In `serialize`, inside the per-track loop (after the `tk` line), write assigned lanes:

```rust
        for lane in 0..8 {
            if t.lane_assigned[lane] {
                s.push_str(&format!("au {} {} {} {}\n", ti, lane, t.lane_base[lane], t.lane_label[lane]));
            }
        }
```

In the per-clip loop, after the `cl` line, write locks (only if any):

```rust
            if !c.locks.is_empty() {
                s.push_str(&format!("lk {} {} ", ti, ci));
                for (i, l) in c.locks.iter().enumerate() {
                    if i > 0 { s.push(';'); }
                    s.push_str(&format!("{}:{}:{}", l.lane, l.step, l.val));
                }
                s.push('\n');
            }
```

In `load`, reset lane state in the clip-reset loop: add inside `for t in &mut engine.tracks {`:

```rust
        t.lane_assigned = [false; 8];
        t.lane_base = [0u8; 8];
        t.lane_label = Default::default();
```

Add match arms in the `for line` loop:

```rust
            Some("au") => {
                // au <track> <lane> <base> <label>
                let track = it.next().and_then(|x| x.parse::<usize>().ok());
                let lane = it.next().and_then(|x| x.parse::<usize>().ok());
                let base = it.next().and_then(|x| x.parse::<u8>().ok());
                let label = it.next().unwrap_or("");
                if let (Some(track), Some(lane), Some(base)) = (track, lane, base) {
                    if track < engine.tracks.len() && lane < 8 {
                        engine.tracks[track].lane_assigned[lane] = true;
                        engine.tracks[track].lane_base[lane] = base;
                        engine.tracks[track].lane_label[lane] = label.to_string();
                    }
                }
            }
            Some("lk") => load_locks(engine, &mut it),
```

Add the loader fn next to `load_clip`:

```rust
fn load_locks<'a>(engine: &mut Engine, it: &mut impl Iterator<Item = &'a str>) {
    let track = it.next().and_then(|x| x.parse::<usize>().ok());
    let slot = it.next().and_then(|x| x.parse::<usize>().ok());
    let (Some(track), Some(slot)) = (track, slot) else { return };
    if track >= engine.tracks.len() || slot >= 8 { return; }
    if let Some(locks) = it.next() {
        for tok in locks.split(';') {
            let p: Vec<&str> = tok.split(':').collect();
            if p.len() == 3 {
                if let (Ok(lane), Ok(step), Ok(val)) =
                    (p[0].parse::<u8>(), p[1].parse::<u16>(), p[2].parse::<u8>()) {
                    engine.tracks[track].clips[slot].set_lock(lane & 7, step, val.min(127));
                }
            }
        }
    }
}
```

- [ ] **Step 4: Wire `movy-dsp`.** In `engine/crates/movy-dsp/src/lib.rs`: bump `const ENGINE_VERSION: &str = "0.15.0";`. In `drain_out`, add a match arm:

```rust
                OutEvent::Cc { track, lane, val } => {
                    host::midi_send_internal(0xB0 | track, 102 + lane, val);
                }
```

In `Instance::get_param`, add an arm: `"alabels" => Some(self.engine.auto_labels()),`.

- [ ] **Step 5: Run, verify pass**

Run: `cd engine && cargo test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add engine/crates/seq-core/src/persist.rs engine/crates/movy-dsp/src/lib.rs
git commit -m "feat(engine): persist automation; emit CC; bump ENGINE_VERSION 0.15.0"
```

---

## Phase B — UI mirror + IPC

### Task 7: Bump UI `ENGINE_VERSION` + mirror fields + status parse

**Files:**
- Modify: `src/seq/constants.ts`
- Modify: `src/seq/state.ts`
- Modify: `src/seq/engine.ts`
- Test: `browser-test/logic.mjs`

- [ ] **Step 1: Write failing test** — add to `browser-test/logic.mjs` (follow its existing `import`/assert style; it imports from `dist/esm`). Add:

```js
import { parseStatusForTest } from '../dist/esm/seq/engine.js';
import { seqState } from '../dist/esm/seq/state.js';

{
  parseStatusForTest('play=0 trk=0 alanes=05 aauto=04 hauto=2:50');
  assertEq(seqState.autoAssigned, 0x05, 'autoAssigned parsed');
  assertEq(seqState.autoActive, 0x04, 'autoActive parsed');
  assertEq(seqState.heldLocks.get(2), 50, 'heldLocks parsed');
}
```

(Use the file's existing `assertEq`/harness; if names differ, match the surrounding code.)

- [ ] **Step 2: Run, verify fail**

Run: `cd movy && npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `autoAssigned` undefined.

- [ ] **Step 3: Implement.** In `src/seq/constants.ts`, set the version to `'0.15.0'` (match `ENGINE_VERSION`). In `src/seq/state.ts` `SeqUiState`, add:

```ts
    /* automation (mirrored from status, watched track / active clip) */
    autoAssigned: number;          // bitmask of assigned lanes (from `alanes`)
    autoActive: number;            // bitmask of lanes with locks (from `aauto`)
    heldLocks: Map<number, number>; // lane -> value at the held step (from `hauto`)
```

In `defaults()`: `autoAssigned: 0, autoActive: 0, heldLocks: new Map(),`. In `src/seq/engine.ts` `parseStatus`, add arms:

```ts
        else if (key === 'alanes') seqState.autoAssigned = parseInt(val, 16) || 0;
        else if (key === 'aauto') seqState.autoActive = parseInt(val, 16) || 0;
        else if (key === 'hauto') {
            seqState.heldLocks.clear();
            if (val) for (const pair of val.split('.')) {
                const [l, v] = pair.split(':').map(Number);
                if (l >= 0 && l < 8) seqState.heldLocks.set(l, v);
            }
        }
```

- [ ] **Step 4: Run, verify pass**

Run: `cd movy && npm run build:browser && node browser-test/logic.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/seq/constants.ts src/seq/state.ts src/seq/engine.ts browser-test/logic.mjs
git commit -m "feat(ui): mirror automation status fields; bump engine version"
```

---

## Phase C — UI automation logic

### Task 8: Expose knob param info from the model

The automation layer needs, for a physical knob `physK` on the active track: its param key, target (componentKey), current value, min/max, type, and whether it is automatable. Add one accessor.

**Files:**
- Modify: `src/model/index.ts` (public model interface + factory)
- Modify: `src/model/store.ts` (helper)
- Test: `browser-test/logic.mjs`

- [ ] **Step 1: Read** `src/model/index.ts` to see the model's public method shape and how `ModelState` (`knobParams`, `knobValues`, `knobPage`, `componentKey`) is exposed, then mirror that style.

- [ ] **Step 2: Write failing test** — add to `logic.mjs` using the existing model test setup (search the file for how it builds a model with `test_`-prefixed params; reuse that). Assert:

```js
{
  const m = makeTestModel();           // existing helper in logic.mjs
  const info = m.getKnobParamInfo(0);  // physical knob 0
  assertEq(typeof info.key, 'string', 'param info has key');
  assertEq(typeof info.automatable, 'boolean', 'param info has automatable');
}
```

If `logic.mjs` has no model helper, add the accessor and a minimal direct `createModel` construction following an existing model test in the file.

- [ ] **Step 3: Run, verify fail**

Run: `cd movy && npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `getKnobParamInfo` undefined.

- [ ] **Step 4: Implement.** In `src/model/store.ts` add:

```ts
export interface KnobParamInfo {
    gi: number;
    key: string;
    target: string;      // componentKey, e.g. "synth" / "fx1"
    value: number;       // current manual value (defaults to min if unknown)
    min: number;
    max: number;
    type: string;
    automatable: boolean;
}

export function knobParamInfo(s: ModelState, physK: number): KnobParamInfo | null {
    const gi = s.knobPage * KNOBS_PER_PAGE + physK;
    const p = s.knobParams[gi];
    if (!p) return null;
    const v = s.knobValues[gi];
    // Automatable: numeric range, not a file/global param.
    const automatable = (p.type === 'float' || p.type === 'int')
        && typeof p.min === 'number' && typeof p.max === 'number' && p.max > p.min
        && !p.key.startsWith('g_');
    return {
        gi, key: p.key, target: s.componentKey,
        value: (v === null || v === undefined) ? p.min : (v as number),
        min: p.min, max: p.max, type: p.type, automatable,
    };
}
```

In `src/model/index.ts`, expose it on the model object: `getKnobParamInfo: (physK: number) => knobParamInfo(state, physK)` (import `knobParamInfo`), and add `getKnobParamInfo(physK: number): KnobParamInfo | null;` to the model's public interface/type.

- [ ] **Step 5: Run, verify pass**

Run: `cd movy && npm run build:browser && node browser-test/logic.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/model/store.ts src/model/index.ts browser-test/logic.mjs
git commit -m "feat(ui): expose per-knob param info for automation"
```

---

### Task 9: Automation registry + lane assignment + value mapping

**Files:**
- Create: `src/seq/automation.ts`
- Test: `browser-test/logic.mjs`

- [ ] **Step 1: Write failing tests** — add to `logic.mjs`:

```js
import {
  resetAutomation, laneForParam, assignLane, automationRegistry, norm7, denorm7,
} from '../dist/esm/seq/automation.js';

{
  resetAutomation();
  assertEq(norm7(1, 0, 2), 64, 'norm7 mid → 64'); // round(1/2*127)=64
  assertEq(denorm7(127, 0, 2), 2, 'denorm7 max → 2');
  // assignLane grabs a free lane and records the registry entry.
  const info = { gi: 0, key: 'cutoff', target: 'synth', value: 1, min: 0, max: 2, type: 'float', automatable: true };
  const lane = assignLane(0, 0, info, () => true); // setMapping returns true
  assertEq(lane, 0, 'first lane assigned');
  assertEq(laneForParam(0, 'synth:cutoff'), 0, 'lane lookup by target:param');
  // Pool of 8: filling all returns -1.
  for (let i = 1; i < 8; i++) assignLane(0, 0, { ...info, key: 'k' + i }, () => true);
  assertEq(assignLane(0, 0, { ...info, key: 'k8' }, () => true), -1, 'pool full → -1');
}
```

- [ ] **Step 2: Run, verify fail**

Run: `cd movy && npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/seq/automation.ts`:**

```ts
/* UI-side automation registry: maps each track's 8 lanes to a chain param
 * (target:param) and caches its range for rendering/denormalization. The
 * engine owns lock data + playback; this layer assigns lanes (a pool of 8 per
 * track, mirroring the chain's knob mappings) and feeds the engine commands. */
import type { KnobParamInfo } from '../model/store.js';
import { seqCmd } from './engine.js';

export interface LaneEntry {
    targetParam: string;   // "synth:cutoff"
    shortName: string;     // param key for display
    min: number;
    max: number;
    type: string;
}

/* registry[track][lane] = entry | null */
const registry: (LaneEntry | null)[][] =
    [0, 1, 2, 3].map(() => new Array(8).fill(null));

export function automationRegistry(): (LaneEntry | null)[][] { return registry; }

export function resetAutomation(): void {
    for (const t of registry) t.fill(null);
}

/* 7-bit conversion matching the chain's abs-CC scaling. */
export function norm7(v: number, min: number, max: number): number {
    if (max <= min) return 0;
    return Math.max(0, Math.min(127, Math.round((v - min) / (max - min) * 127)));
}
export function denorm7(n: number, min: number, max: number): number {
    return min + (n / 127) * (max - min);
}

export function laneForParam(track: number, targetParam: string): number {
    const lanes = registry[track];
    for (let l = 0; l < 8; l++) if (lanes[l]?.targetParam === targetParam) return l;
    return -1;
}

/* Assign `info`'s param to a free lane on `track`. `setMapping(lane)` issues the
 * chain knob_<lane+1>_set (returns false on failure). Returns the lane, or -1 if
 * the param's pool of 8 is full / mapping failed. Also seeds the engine label +
 * base. */
export function assignLane(
    track: number, slot: number, info: KnobParamInfo,
    setMapping: (lane: number) => boolean,
): number {
    const tp = info.target + ':' + info.key;
    const existing = laneForParam(track, tp);
    if (existing >= 0) return existing;
    const lane = registry[track].findIndex((e) => e === null);
    if (lane < 0) return -1; // pool full
    if (!setMapping(lane)) return -1;
    registry[track][lane] = { targetParam: tp, shortName: info.key, min: info.min, max: info.max, type: info.type };
    seqCmd('alabel ' + track + ' ' + lane + ' ' + tp);
    seqCmd('abase ' + track + ' ' + lane + ' ' + norm7(info.value, info.min, info.max));
    return lane;
}

export function clearLane(track: number, lane: number): void {
    if (lane < 0 || lane >= 8) return;
    registry[track][lane] = null;
    seqCmd('aclr ' + track + ' ' + lane);
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd movy && npm run build:browser && node browser-test/logic.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/seq/automation.ts browser-test/logic.mjs
git commit -m "feat(ui): automation lane registry + assignment"
```

---

### Task 10: Knob-turn routing (hold-step edit / Rec record / base)

When the user turns a knob, decide: (a) holding a step → write a lock at the held step; (b) Rec+playing, no step held → write a lock at the playing step; (c) assigned lane, no step/Rec → update base; (d) otherwise → normal param set (today's path). Cases (a)–(c) auto-assign a lane if needed and consume the knob.

**Files:**
- Modify: `src/seq/automation.ts` (add `handleAutomationKnob`)
- Modify: `src/midi/router.ts` (call it before `handleKnobDelta`)
- Test: `browser-test/logic.mjs`

- [ ] **Step 1: Write failing test** — add to `logic.mjs`:

```js
import { handleAutomationKnob } from '../dist/esm/seq/automation.js';
import { peekSeqCmdQueue, resetSeqEngine } from '../dist/esm/seq/engine.js';
import { seqState } from '../dist/esm/seq/state.js';

{
  resetAutomation(); resetSeqEngine();
  const info = { gi: 0, key: 'cutoff', target: 'synth', value: 1, min: 0, max: 2, type: 'float', automatable: true };
  seqState.holdStep = 4;          // a step is held
  const consumed = handleAutomationKnob(0, 0, info, +1, () => true);
  assertEq(consumed, true, 'hold-step knob consumed');
  const q = peekSeqCmdQueue().join('|');
  assert(q.includes('aset 0 0 4 '), 'aset issued at held step 4');
  seqState.holdStep = -1;
}
```

- [ ] **Step 2: Run, verify fail**

Run: `cd movy && npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `handleAutomationKnob` undefined.

- [ ] **Step 3: Implement** in `automation.ts` (add imports `seqState` from `./state.js`):

```ts
import { seqState } from './state.js';

/* Returns true if the knob turn was consumed as automation. `delta` is the
 * decoded encoder delta; `setMapping` issues the chain knob mapping on assign. */
export function handleAutomationKnob(
    track: number, physK: number, info: KnobParamInfo, delta: number,
    setMapping: (lane: number) => boolean,
): boolean {
    if (!info.automatable) return false;
    const held = seqState.holdStep >= 0;
    const recArmed = seqState.recording && seqState.playing;
    if (!held && !recArmed) {
        // No automation gesture: only intercept if this param is already a lane,
        // to keep its base coherent (engine-driven). Else let normal path run.
        const lane = laneForParam(track, info.target + ':' + info.key);
        if (lane < 0) return false;
        const cur = currentLaneValue(track, lane, info);
        const next7 = clamp7(norm7(cur, info.min, info.max) + delta);
        seqCmd('abase ' + track + ' ' + lane + ' ' + next7);
        return true;
    }
    // Hold-step or Rec: ensure a lane, then write a lock at the target step.
    let lane = laneForParam(track, info.target + ':' + info.key);
    if (lane < 0) lane = assignLane(track, track, info, setMapping);
    if (lane < 0) { seqState.autoPoolFull = true; return true; } // consumed; toast handled in render
    const step = held ? seqState.holdStep : seqState.curStep;
    const cur = held ? heldStepValue(track, lane, info) : currentLaneValue(track, lane, info);
    const next7 = clamp7(norm7(cur, info.min, info.max) + delta);
    seqCmd('aset ' + track + ' ' + lane + ' ' + step + ' ' + next7);
    return true;
}

function clamp7(n: number): number { return Math.max(0, Math.min(127, n)); }

/* Current effective value for a lane: held-step lock if present, else base. */
function currentLaneValue(track: number, lane: number, info: KnobParamInfo): number {
    return info.value; // manual value is the base reference for relative turns
}
function heldStepValue(track: number, lane: number, info: KnobParamInfo): number {
    const v = seqState.heldLocks.get(lane);
    return v === undefined ? info.value : denorm7(v, info.min, info.max);
}
```

Add `autoPoolFull: boolean` to `SeqUiState` (default `false`) in `state.ts` — render clears it after showing the toast.

- [ ] **Step 4: Wire the router.** In `src/midi/router.ts`, replace the knob-CC branch body (lines ~98-104) so automation gets first refusal:

```ts
    if ((status & 0xF0) === 0xB0 && d1 >= KNOB_CC_BASE && d1 < KNOB_CC_BASE + NUM_KNOBS) {
        const k     = d1 - KNOB_CC_BASE;
        const delta = decodeDelta(d2);
        const model = knobModel();
        const info  = model?.getKnobParamInfo(k) ?? null;
        const track = appState.activeSlot;
        if (info && handleAutomationKnob(track, k, info, delta,
                (lane) => shadow_set_param(track, 'knob_' + (lane + 1) + '_set', info.target + ':' + info.key))) {
            return;
        }
        model?.handleKnobDelta(k, delta);
        return;
    }
```

Add imports at the top of `router.ts`: `import { handleAutomationKnob } from '../seq/automation.js';`.

- [ ] **Step 5: Run, verify pass**

Run: `cd movy && npm run build:browser && node browser-test/logic.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/seq/automation.ts src/seq/state.ts src/midi/router.ts browser-test/logic.mjs
git commit -m "feat(ui): route knob turns to automation (hold-step / rec / base)"
```

---

### Task 11: Clear gesture + label re-sync on boot/load

Hold-Clear + knob touch clears that param's lane. On engine boot/load, fetch `alabels` and re-apply each track's `knob_<N>_set` so background-track playback CCs land.

**Files:**
- Modify: `src/seq/automation.ts` (`clearLaneForKnob`, `syncLabelsFromEngine`)
- Modify: `src/midi/router.ts` (touch branch)
- Modify: `src/seq/engine.ts` (call sync on boot-ok and after a load)
- Test: `browser-test/logic.mjs`

- [ ] **Step 1: Write failing test** — add to `logic.mjs`:

```js
import { syncLabelsFromEngine } from '../dist/esm/seq/automation.js';
{
  resetAutomation();
  // "synth:cutoff" on track 0 lane 1; rest empty.
  const applied = [];
  syncLabelsFromEngine('-.synth:cutoff.-.-.-.-.-.-,-.-.-.-.-.-.-.-,-.-.-.-.-.-.-.-,-.-.-.-.-.-.-.-',
      (slot, lane, tp) => applied.push(slot + ':' + lane + ':' + tp),
      () => ({ min: 0, max: 1, type: 'float' }));
  assertEq(laneForParam(0, 'synth:cutoff'), 1, 'label synced into registry');
  assert(applied.includes('0:1:synth:cutoff'), 're-applied knob mapping');
}
```

- [ ] **Step 2: Run, verify fail**

Run: `cd movy && npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement** in `automation.ts`:

```ts
export function clearLaneForKnob(track: number, info: KnobParamInfo): void {
    const lane = laneForParam(track, info.target + ':' + info.key);
    if (lane >= 0) clearLane(track, lane);
}

/* Rebuild the registry from the engine's `alabels` and re-apply each assigned
 * lane's chain mapping. `apply(slot, lane, targetParam)` issues knob_<N>_set;
 * `rangeOf(targetParam)` supplies min/max/type for denormalization. */
export function syncLabelsFromEngine(
    alabels: string,
    apply: (slot: number, lane: number, targetParam: string) => void,
    rangeOf: (targetParam: string) => { min: number; max: number; type: string } | null,
): void {
    const tracks = alabels.split(',');
    for (let t = 0; t < 4 && t < tracks.length; t++) {
        const lanes = tracks[t].split('.');
        for (let l = 0; l < 8 && l < lanes.length; l++) {
            const tp = lanes[l];
            if (!tp || tp === '-') { registry[t][l] = null; continue; }
            const r = rangeOf(tp);
            registry[t][l] = {
                targetParam: tp, shortName: tp.split(':')[1] ?? tp,
                min: r?.min ?? 0, max: r?.max ?? 1, type: r?.type ?? 'float',
            };
            apply(t, l, tp);
        }
    }
}
```

- [ ] **Step 4: Wire the touch branch** in `router.ts` (replace lines ~52-55):

```ts
    if ((status & 0xF0) === 0x90 && d1 < 8) {
        if (d2 > 0) {
            const info = knobModel()?.getKnobParamInfo(d1) ?? null;
            if (deleteActiveForClear() && info) { clearLaneForKnob(appState.activeSlot, info); return; }
            knobModel()?.handleKnobTouch(d1);
        } else {
            knobModel()?.handleKnobRelease(d1);
        }
        return;
    }
```

Add imports: `import { clearLaneForKnob } from '../seq/automation.js';` and re-export `deleteActive` as `deleteActiveForClear` — add to `src/seq/router.ts` an export `export { deleteActive as deleteActiveForClear } from './edit-ops.js';` (edit-ops already exports `deleteActive`), and import it in `midi/router.ts`.

- [ ] **Step 5: Wire boot/load sync** in `src/seq/engine.ts`. After `bootState = 'ok'` in `probeTick`, and whenever a load completes, call a small hook. Add at the end of `probeTick`'s success branch:

```ts
        requestLabelSync();
```

Add a module-level flag + helper:

```ts
let labelSyncPending = true;
export function requestLabelSync(): void { labelSyncPending = true; }
export function takeLabelSync(): boolean {
    if (!labelSyncPending) return false; labelSyncPending = false; return true;
}
```

In `app/tick.ts`, once per tick after `seqEngineTick()`, if `engineReady() && takeLabelSync()`, fetch and apply:

```ts
    if (engineReady() && takeLabelSync()) {
        const labels = host_module_get_param('alabels');
        if (labels) syncLabelsFromEngine(labels,
            (slot, lane, tp) => shadow_set_param(slot, 'knob_' + (lane + 1) + '_set', tp),
            (tp) => rangeFromChainParams(appState.activeSlot, tp));
    }
```

Add a small `rangeFromChainParams(slot, "target:param")` helper in `automation.ts` that reads `shadow_get_param(slot, target + ':chain_params')`, parses, finds the param, returns `{min,max,type}` or null. (Background-slot ranges are best-effort; missing ranges default to 0..1 and are corrected when that track is next viewed.) Also call `requestLabelSync()` when `seqState.dirty` transitions after a `state` load if applicable.

- [ ] **Step 6: Run, verify pass**

Run: `cd movy && npm run build:browser && node browser-test/logic.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/seq/automation.ts src/midi/router.ts src/seq/router.ts src/seq/engine.ts src/app/tick.ts browser-test/logic.mjs
git commit -m "feat(ui): clear-gesture + re-sync lane mappings from engine labels"
```

---

## Phase D — Rendering

### Task 12: `ParamVM` automation fields + viewmodel population

**Files:**
- Modify: `src/types/viewmodel.ts`
- Modify: `src/model/viewmodel.ts`
- Modify: `src/app/tick.ts` (build + inject `AutomationView`)
- Test: `browser-test/logic.mjs`

- [ ] **Step 0: Read** `src/model/viewmodel.ts` and `src/model/index.ts` to capture the exact current `buildViewModel` signature and the existing `touched`/`displayValue` computation, so the changes in Step 3 are additive edits to real code (not rewrites). Note how the model exposes the viewmodel (`getViewModel`) so the `AutomationView` can be threaded through without `seq/` leaking into `model/`.

- [ ] **Step 1: Write failing test** — add to `logic.mjs` exercising `buildViewModel` with an injected automation snapshot (follow the file's existing `buildViewModel` usage). Assert a `ParamVM` carries `automated`/`automatable` and that an automated, non-held param shows the dot flag:

```js
{
  const vm = buildViewModelForTest(/* model */, {
    assignedLanes: 0b1, activeLanes: 0b1, held: false, heldValues: new Map(),
    laneForKey: (key) => (key === 'cutoff' ? 0 : -1),
  });
  const pv = firstParamVM(vm); // helper: first non-null cell
  assertEq(pv.automated, true, 'automated dot flag set');
}
```

(Use/extend the file's existing viewmodel test helpers; if `buildViewModel` takes no automation arg yet, this is the failing condition.)

- [ ] **Step 2: Run, verify fail**

Run: `cd movy && npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `src/types/viewmodel.ts`, add to `ParamVM`:

```ts
    automated:   boolean;   // lane has ≥1 lock → show the dot
    automatable: boolean;   // can be assigned a lane (numeric, non-global)
```

Define an injectable snapshot type (in `viewmodel.ts`):

```ts
export interface AutomationView {
    assignedLanes: number;                 // bitmask, active track
    activeLanes: number;                    // bitmask of lanes with locks
    held: boolean;                          // a step is currently held
    poolFull: boolean;                      // all 8 lanes used (limit toast)
    heldValues: Map<number, number>;        // lane -> display value at held step
    laneForKey: (key: string) => number;    // param key -> lane (-1 none)
}
```

In `src/model/viewmodel.ts`, change `buildViewModel(state, ...)` to accept an `auto: AutomationView` parameter and, when building each `ParamVM`, set:

```ts
        const lane = auto.laneForKey(p.key);
        const automatable = (p.type === 'float' || p.type === 'int')
            && typeof p.min === 'number' && typeof p.max === 'number' && p.max > p.min
            && !p.key.startsWith('g_');
        const automated = lane >= 0 && (auto.activeLanes & (1 << lane)) !== 0;
        // When a step is held, an automatable lane shows its held-step value
        // inverted (like a touch); reuse `touched` + `displayValue`.
        let touched = /* existing touched logic */;
        let displayValue = /* existing */;
        if (auto.held && lane >= 0 && auto.heldValues.has(lane)) {
            touched = true;
            displayValue = formatValue(p, auto.heldValues.get(lane)!);
        }
        // ...assign automated, automatable, touched, displayValue into the ParamVM
```

In `src/app/tick.ts`, before each `renderKnobsView(...)`/viewmodel build, assemble the snapshot from `seqState` + the registry:

```ts
import { automationRegistry, denorm7 } from '../seq/automation.js';

function buildAutomationView(track: number): AutomationView {
    const reg = automationRegistry()[track];
    const heldValues = new Map<number, number>();
    for (const [lane, v] of seqState.heldLocks) {
        const e = reg[lane];
        if (e) heldValues.set(lane, denorm7(v, e.min, e.max));
    }
    const laneForKey = (key: string): number => {
        for (let l = 0; l < 8; l++) if (reg[l] && reg[l]!.shortName === key) return l;
        return -1;
    };
    return {
        assignedLanes: seqState.autoAssigned,
        activeLanes: seqState.autoActive,
        held: seqState.holdStep >= 0,
        poolFull: seqState.autoPoolFull,
        heldValues, laneForKey,
    };
}
```

Pass `buildAutomationView(appState.activeSlot)` into the model's viewmodel build (thread it through `model.getViewModel(auto)` or directly into `buildViewModel`). Keep `model/` free of `seq/` imports — the snapshot is a plain object built in `app/tick.ts`.

- [ ] **Step 4: Run, verify pass**

Run: `cd movy && npm run build:browser && node browser-test/logic.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types/viewmodel.ts src/model/viewmodel.ts src/app/tick.ts browser-test/logic.mjs
git commit -m "feat(ui): viewmodel carries automation dot/held-value/automatable"
```

---

### Task 13: Render dot, held-step values, hide non-automatable, limit toast

**Files:**
- Modify: `src/renderer/label.ts`
- Modify: `src/renderer/knob-view.ts` (skip non-automatable cells during hold; show toast)
- Test: `browser-test/screenshot.mjs` (new baselines)

- [ ] **Step 1: Add screenshot cases.** In `browser-test/screenshot.mjs`, add render cases (follow the file's existing scene definitions): (a) a param row with one automated param → expect a dot; (b) a held-step state showing inverted lane values with non-automatable cells blank; (c) pool-full + held → bottom toast text. Run with `--update` only after visually confirming.

- [ ] **Step 2: Run, verify fail**

Run: `cd movy && npm run build:browser && node browser-test/screenshot.mjs`
Expected: FAIL (new scenes have no baseline / differ).

- [ ] **Step 3: Implement dot + hide.** In `src/renderer/label.ts`, extend `drawLabelCell` to draw a 2×2 dot at the top-right when `pvm.automated`:

```ts
export function drawLabelCell(col: number, lblY: number, pvm: ParamVM): void {
    const knobCenterX = col * CELL_W + Math.floor(CELL_W / 2);
    const text = pvm.touched ? pvm.displayValue : pvm.shortName;
    const tw   = fontWidth(text);
    const tx   = knobCenterX - Math.floor(tw / 2);
    if (pvm.touched) {
        fill_rect(col * CELL_W, lblY, CELL_W, LBL_H, 1);
        fontPrint(tx, lblY + 1, text, 0);
    } else {
        fontPrint(tx, lblY + 1, text, 1);
    }
    if (pvm.automated) {
        // top-right dot of the cell (2×2), inverted color if the cell is filled
        const dx = col * CELL_W + CELL_W - 3;
        fill_rect(dx, lblY, 2, 2, pvm.touched ? 0 : 1);
    }
}
```

In `src/renderer/knob-view.ts` (or `drawKnobRow` in `label.ts`), when a step is held (pass a `holdActive` + `poolFull` flag into the render path via the viewmodel — add `automationHeld`/`automationPoolFull` to `ViewModel`), skip drawing cells whose `ParamVM.automatable` is false, and when `automationPoolFull` also skip cells that are automatable-but-not-automated (show only the 8 assigned lanes). Render the bottom toast when `automationPoolFull && automationHeld` using the existing seq-toast renderer (`seqToast('8 automation lanes')` from `src/seq/render.ts`).

Add `automationHeld: boolean` and `automationPoolFull: boolean` to `ViewModel` (`src/types/viewmodel.ts`) and set them in `buildViewModel` from the `AutomationView`.

- [ ] **Step 4: Visually confirm, then update baselines**

Run: `cd movy && npm run build:browser && node browser-test/screenshot.mjs --update`
Then re-run without `--update`:
Run: `node browser-test/screenshot.mjs`
Expected: PASS (0 failures).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/label.ts src/renderer/knob-view.ts src/types/viewmodel.ts src/model/viewmodel.ts browser-test/screenshot.mjs browser-test/baselines
git commit -m "feat(ui): render automation dot, held-step values, hide non-automatable, limit toast"
```

---

## Phase E — Integration, perf, device

### Task 14: app-loop + perf coverage

**Files:**
- Modify: `browser-test/app-loop.mjs`
- Modify: `browser-test/perf.mjs`

- [ ] **Step 1: app-loop test.** Add a scenario (follow the file's harness): assign a lane, set a lock, mark the engine status as playing across steps, and assert the UI applies the expected `CC 102+lane` / the lane state stays coherent (the app-loop harness captures `shadow_send_midi_to_dsp` / engine cmds — assert the `aset`/`abase` ops were queued, and that switching tracks does not drop lane state). Run:

Run: `cd movy && npm run build:browser && node browser-test/app-loop.mjs`
Expected: PASS.

- [ ] **Step 2: perf test.** In `browser-test/perf.mjs`, add an assertion that during a held-step automation edit the per-tick `shadow_set_param`/IPC count stays bounded (one `knob_N_set` on assign, then only queued engine ops — no per-tick param spam). Run:

Run: `node browser-test/perf.mjs`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add browser-test/app-loop.mjs browser-test/perf.mjs
git commit -m "test(ui): app-loop + perf coverage for automation"
```

---

### Task 15: Full local suite + device e2e

- [ ] **Step 1: Full local suite**

Run:
```bash
cd movy
npm run build:browser
node browser-test/logic.mjs
node browser-test/app-loop.mjs
node browser-test/screenshot.mjs
node browser-test/perf.mjs
(cd engine && cargo test)
```
Expected: 0 failures across all.

- [ ] **Step 2: Device e2e** (engine + UI; builds `dsp.so`). Confirm reachability first:

```bash
cd movy
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && ./scripts/test-seq.sh \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```
If offline, **report DEVICE OFFLINE in CAPS** to the user. If online: verify the e2e passes, then manually sanity-check on device — assign a lane (hold a step, turn a knob), confirm the dot appears, the value plays back, and persists across a tool reopen.

- [ ] **Step 3: Commit any fixes, then push**

```bash
git add -A
git commit -m "feat: parameter automation (8 lanes/track, engine CC playback)"
git push
```

---

## Notes for the implementer

- **TDD order matters:** the engine (Phase A) is fully host-testable with `cargo test` and should be green before any UI work.
- **`ENGINE_VERSION` must match** between `movy-dsp/src/lib.rs` (`0.15.0`) and `src/seq/constants.ts` — `build-dsp.sh` fails otherwise, and the UI re-loads the DSP until versions match.
- **Never scp over a live `dsp.so`** — `deploy.sh`/`test-seq.sh` ship it scp-to-temp + `mv` (fresh inode).
- **Keep `model/` free of `seq/` imports** — automation reaches the model only as a plain `AutomationView` object built in `app/tick.ts`.
- **7-bit resolution** is inherent to the chain's abs-CC path; don't try to defeat it.
- If a `logic.mjs`/`screenshot.mjs` helper named here (`makeTestModel`, `buildViewModelForTest`, `firstParamVM`) doesn't exist verbatim, match the file's actual existing helpers — the assertions are what matter.
