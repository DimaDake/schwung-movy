# CPU meter page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `Shift + Step 12` page showing what each track's chain costs per audio block, over a capacity bar for the whole chain render.

**Architecture:** The measurement already exists — `CostMeter` brackets every chain's render on the audio thread. This adds a second bracket around the synth stage, a set of held-peak accumulators the page owns (separate from the window a benchmark's `report()` closes), three fields on the `status` poll the UI already makes, and a pure renderer. Nothing new runs on the audio thread except one clock read per chain per block, and no new IPC exists at all.

**Spec:** `docs/superpowers/specs/2026-09-02-cpu-meter-design.md`

**Tech Stack:** Rust (`engine/crates/movy-dsp`), TypeScript (`src/`), `cargo test`, `browser-test/*.mjs`.

## Global Constraints

- **Nothing allocates on the audio thread.** Building the status string happens in `get_param`, which is not the render path — that is where every `format!` in this plan lives.
- **Serial and parallel must produce the same numbers.** The synth/total split has to mean the same thing in `render_serial` and in `RenderPool::run`.
- **The page must never call `CostMeter::report()`** — reading it closes the window a device benchmark owns (`scripts/measure-chain-balance.sh`). The page has its own accumulators and its own reset.
- **Full scale is `FULL_SCALE_US = 1000`, fixed.** Not auto-ranged: a column has to be comparable across sessions and across the CPU Optimize flag.
- **No mid-reference gridline.** A horizontal line across all columns reads as a limit and there is no per-track limit.
- Rows 60-63 are cleared every tick by the Loop Overview strip. `VIEW_CPU` joins that exclusion list, which is what lets the page draw down to row 62.
- Engine changes require bumping `ENGINE_VERSION` in `engine/crates/movy-dsp/src/lib.rs` **and** `src/seq/constants.ts` together — `build-dsp.sh` fails the build otherwise. **One bump for this whole plan: `0.60.0` → `0.61.0`, done in Task 3.**
- Run `cd movy && npm test` at the end of every task. `(cd engine && cargo test)` too for Tasks 1-3.
- `cargo` is not on PATH — use `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo`.

## File Structure

| File | Responsibility |
| --- | --- |
| `engine/crates/movy-dsp/src/chain_cost.rs` | the meter's held accumulators, the idle-decay rule |
| `engine/crates/movy-dsp/src/render_pool.rs` | publish the synth stage's cost per chain, alongside `cost_ns` |
| `engine/crates/movy-dsp/src/chain_slots.rs` | time the synth stage in the serial path; fold 0 for chains that did no work; `cost_status()` |
| `engine/crates/movy-dsp/src/lib.rs` | `chcost` / `chwall` / `chmask` on `status`; the `cpurst` command |
| `src/seq/state.ts` | the three fields, kept as RAW strings |
| `src/seq/engine.ts` | parse them out of `status` |
| `src/seq/constants.ts` | `STEP_CPU` |
| `src/app/state.ts` | `VIEW_CPU` |
| `src/seq/param-page.ts` | `VIEW_CPU` as the layer's fourth sibling |
| `src/seq/cpu-page.ts` | **new** — open/close and `cpurst`; no gesture state |
| `src/seq/cpu-page-vm.ts` | **new** — parse the raw fields into sixteen typed columns |
| `src/renderer/primitives.ts` | `hatchRect`, shared with the two existing hatch sites |
| `src/renderer/cpu-view.ts` | **new** — the pure renderer |
| `src/midi/router.ts` | consume knob and jog on this page so nothing falls through |
| `src/app/tick.ts` | dispatch, `cpuSig()` repaint gate, loop-strip exclusion |

---

### Task 1: The meter's own accumulators

The page's numbers cannot come from `ns` / `max_ns`: `report()` resets those, and a device benchmark reads it whenever it likes. This adds a parallel set on the page's reset schedule, plus the rule that a block a chain did no work in folds in **0** so a sleeping chain's mean decays.

**Files:**
- Modify: `engine/crates/movy-dsp/src/chain_cost.rs`

**Interfaces:**
- Consumes: nothing.
- Produces: `CostMeter::add_synth_ns(&mut self, chain: usize, dt: u64)`, `CostMeter::ui_costs(&self, chain: usize) -> (u64, u64, u32)` (total mean ns, synth mean ns, held peak ns), `CostMeter::ui_wall(&self) -> (u64, u32)` (wall mean ns, held peak ns), `CostMeter::ui_reset(&mut self)`.

- [ ] **Step 1: Write the failing tests**

Append to the `mod tests` block at the bottom of `engine/crates/movy-dsp/src/chain_cost.rs`:

```rust
    /// The whole reason the page has its own numbers: `report()` belongs to
    /// whichever device script is measuring, and it may fire at any moment. A
    /// peak the page is holding must not vanish because someone read the log.
    #[test]
    fn the_held_peak_survives_a_report_and_clears_only_on_its_own_reset() {
        let mut m = CostMeter::new(2);
        m.add_ns(0, 5_000);
        m.add_ns(0, 90_000);
        m.end_block();
        assert_eq!(m.ui_costs(0).2, 90_000, "the worst block is held");
        m.report();
        assert_eq!(m.ui_costs(0).2, 90_000, "a benchmark's read must not clear it");
        m.ui_reset();
        assert_eq!(m.ui_costs(0).2, 0, "cpurst clears it");
    }

    /// The bar draws a synth segment and an FX segment. The synth mean is its
    /// own signal, on the same 1/16 settling as the total.
    #[test]
    fn the_synth_mean_is_separate_from_the_total() {
        let mut m = CostMeter::new(1);
        for _ in 0..200 {
            m.add_ns(0, 1000);
            m.add_synth_ns(0, 600);
        }
        let (total, synth, _) = m.ui_costs(0);
        assert!((900..=1100).contains(&total), "total settled at {total}");
        assert!((540..=660).contains(&synth), "synth settled at {synth}");
        assert!(synth < total, "the synth is a part of the whole, not the whole");
    }

    /// A chain asleep under `chidle` builds no task at all, so nothing measures
    /// it. Feeding a zero is what makes the mean say "this costs nothing now" —
    /// without it the planner keeps budgeting a lane for a silent chain and the
    /// meter draws a bar for a chain that is rendering nothing.
    ///
    /// The mean FLOORS rather than reaching zero: `p - p/16` stops moving once
    /// `p < 16`, which is 15 ns — below the microsecond the page draws in.
    #[test]
    fn a_block_a_chain_did_not_work_in_decays_its_mean() {
        let mut m = CostMeter::new(1);
        for _ in 0..300 {
            m.add_ns(0, 800_000);
        }
        assert!(m.plan_ns()[0] > 700_000);
        for _ in 0..300 {
            m.add_ns(0, 0);
        }
        assert!(m.plan_ns()[0] < 16, "did not decay: {}", m.plan_ns()[0]);
        assert!(m.ui_costs(0).0 < 16, "the page's mean must decay with it");
    }

    /// The wall is the capacity bar. Same two numbers, same reset.
    #[test]
    fn the_wall_has_a_held_peak_too() {
        let mut m = CostMeter::new(1);
        for _ in 0..200 {
            m.add_wall(1_000_000);
        }
        m.add_wall(2_500_000);
        let (mean, peak) = m.ui_wall();
        assert!((900_000..=1_200_000).contains(&mean), "wall mean {mean}");
        assert_eq!(peak, 2_500_000, "the worst block is what the notch marks");
        m.report();
        assert_eq!(m.ui_wall().1, 2_500_000, "and it survives a benchmark read");
        m.ui_reset();
        assert_eq!(m.ui_wall().1, 0);
    }

    /// Teardown means the chains are gone. Everything about them goes with them,
    /// including the page's numbers — otherwise the meter draws the last set.
    #[test]
    fn reset_all_clears_the_page_numbers_too() {
        let mut m = CostMeter::new(1);
        m.add_ns(0, 40_000);
        m.add_synth_ns(0, 20_000);
        m.add_wall(50_000);
        m.reset_all();
        assert_eq!(m.ui_costs(0), (0, 0, 0));
        assert_eq!(m.ui_wall(), (0, 0));
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/dake/git/cld/movy/engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p movy-dsp chain_cost
```

Expected: FAIL — `no method named 'ui_costs'`, `no method named 'add_synth_ns'`, `no method named 'ui_wall'`, `no method named 'ui_reset'`.

- [ ] **Step 3: Add the fields**

In `engine/crates/movy-dsp/src/chain_cost.rs`, inside `pub struct CostMeter`, after the `plan_ns` field:

```rust
    /// The CPU page's numbers.
    ///
    /// Deliberately NOT `ns` / `max_ns` / `wall_max_ns`: reading `report()`
    /// closes that window, and a device benchmark closes it whenever it likes.
    /// A peak the user is looking at must not disappear because someone read a
    /// log, so these live on their own reset schedule (`ui_reset`, driven by the
    /// `cpurst` command the page issues when it opens).
    ui_synth_ns: Vec<u64>,
    ui_peak_ns: Vec<u32>,
    ui_wall_ns: u64,
    ui_wall_peak_ns: u32,
```

In `CostMeter::new`, after `plan_ns: vec![0; chains],`:

```rust
            ui_synth_ns: vec![0; chains],
            ui_peak_ns: vec![0; chains],
            ui_wall_ns: 0,
            ui_wall_peak_ns: 0,
```

- [ ] **Step 4: Fold the page's peak into `add_ns`**

In `add_ns`, immediately after the existing `if capped > self.max_ns[chain] { ... }` block:

```rust
        if capped > self.ui_peak_ns[chain] {
            self.ui_peak_ns[chain] = capped;
        }
```

- [ ] **Step 5: Add the synth mean, the wall accumulators and the readers**

After `add_ns`, add:

```rust
    /// The synth stage of one block, for the chains that render in two calls.
    ///
    /// A chain that does not split — `chidle 0`, or a module whose chain host
    /// does not export the FX trio — renders everything inside `render_block`,
    /// so its synth cost IS its total and the FX segment comes out empty. That
    /// is why the meter needs no branch for CPU Optimize being off.
    pub fn add_synth_ns(&mut self, chain: usize, dt: u64) {
        let Some(p) = self.ui_synth_ns.get_mut(chain) else { return };
        *p = if *p == 0 { dt } else { *p - *p / 16 + dt / 16 };
    }
```

In `add_wall`, after the existing `if dt > self.wall_max_ns { ... }`:

```rust
        self.ui_wall_ns =
            if self.ui_wall_ns == 0 { dt } else { self.ui_wall_ns - self.ui_wall_ns / 16 + dt / 16 };
        let capped = dt.min(u32::MAX as u64) as u32;
        if capped > self.ui_wall_peak_ns {
            self.ui_wall_peak_ns = capped;
        }
```

After `plan_ns`, add the readers:

```rust
    /// `(total mean, synth mean, held peak)` in nanoseconds, for one chain.
    pub fn ui_costs(&self, chain: usize) -> (u64, u64, u32) {
        (
            self.plan_ns.get(chain).copied().unwrap_or(0),
            self.ui_synth_ns.get(chain).copied().unwrap_or(0),
            self.ui_peak_ns.get(chain).copied().unwrap_or(0),
        )
    }

    /// `(mean, held peak)` of the whole chain render, in nanoseconds.
    pub fn ui_wall(&self) -> (u64, u32) {
        (self.ui_wall_ns, self.ui_wall_peak_ns)
    }

    /// Clear the held peaks. The means are left alone — they settle in a couple
    /// of hundred blocks, and blanking them would make the page open on zeros.
    pub fn ui_reset(&mut self) {
        for v in self.ui_peak_ns.iter_mut() {
            *v = 0;
        }
        self.ui_wall_peak_ns = 0;
    }
```

In `reset_all`, after the `plan_ns` loop:

```rust
        for v in self.ui_synth_ns.iter_mut() {
            *v = 0;
        }
        self.ui_reset();
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd /Users/dake/git/cld/movy/engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p movy-dsp chain_cost
```

Expected: PASS, all five new tests plus the six that were already there.

- [ ] **Step 7: Commit**

```bash
cd /Users/dake/git/cld/movy
git add engine/crates/movy-dsp/src/chain_cost.rs
git commit -m "$(cat <<'EOF'
engine: the CPU meter's numbers get their own reset schedule

report() closes its window, and a device benchmark closes it whenever it
likes. A peak the page is holding cannot depend on that.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Time the synth stage, and stop re-adding a sleeping chain's cost

Both render paths already make two calls when the chain splits. This brackets the first one, and fixes a real bug in the fold: `RenderPool::cost_ns` is never cleared between rounds and a deep-asleep chain builds no `Task`, so every block re-adds the cost the chain had while awake.

**Files:**
- Modify: `engine/crates/movy-dsp/src/render_pool.rs`
- Modify: `engine/crates/movy-dsp/src/chain_slots.rs:812-834` (`render_serial`), `:869-882` (the `render_parallel` fold), `:708-720` (`render`)

**Interfaces:**
- Consumes: `CostMeter::add_synth_ns` (Task 1).
- Produces: `RenderPool::synth_ns(&self, chain: usize) -> u64`.

- [ ] **Step 1: Write the failing test**

Append to `mod tests` in `engine/crates/movy-dsp/src/render_pool.rs`:

```rust
    /// The meter draws the two stages a split chain renders in. The pool has to
    /// publish the first one, because the audio thread cannot bracket a call it
    /// did not make — the same reason `cost_ns` exists.
    ///
    /// A sleeping synth (`render: None`) costs nothing: the zero-fill is movy's
    /// own bookkeeping, not the module's.
    #[test]
    fn the_pool_publishes_the_synth_stage_on_its_own() {
        let _lock = crate::midi_out::test_guard();
        let pool = RenderPool::new(1, CHAINS);
        let mut buf = vec![0i16; BLOCK * 2];

        pool.render_block(&[
            vec![Task {
                render: Some(fill),
                process_fx: None,
                inst: 7 as *mut c_void,
                buf: buf.as_mut_ptr(),
                frames: BLOCK as i32,
                chain: 0,
            }],
            vec![],
        ]);
        assert!(pool.synth_ns(0) > 0, "a chain that rendered has a synth cost");
        assert!(
            pool.synth_ns(0) <= pool.cost_ns(0),
            "the synth stage is a part of the block, not more than it"
        );

        pool.render_block(&[
            vec![Task {
                render: None,
                process_fx: None,
                inst: 7 as *mut c_void,
                buf: buf.as_mut_ptr(),
                frames: BLOCK as i32,
                chain: 1,
            }],
            vec![],
        ]);
        assert_eq!(pool.synth_ns(1), 0, "a sleeping synth costs nothing");
    }
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/dake/git/cld/movy/engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p movy-dsp render_pool
```

Expected: FAIL with `no method named 'synth_ns' found for struct 'RenderPool'`.

- [ ] **Step 3: Publish the synth stage from the pool**

In `render_pool.rs`, in `struct Shared`, beside `cost_ns`:

```rust
    /// The synth stage alone. Measured before the peak scan, so movy's own
    /// bookkeeping is not attributed to the module.
    synth_ns: Vec<AtomicU64>,
```

In the `Shared` construction beside `cost_ns: (0..chains)...`:

```rust
            synth_ns: (0..chains).map(|_| AtomicU64::new(0)).collect(),
```

In `fn run`, after the `unsafe { match t.render { ... } }` block and **before** the `synth_peak` scan:

```rust
        // Split HERE, not after the peak scan: the scan is movy's own
        // bookkeeping, and a module must not be charged for it. A sleeping
        // synth rendered nothing, so it cost nothing — the zero-fill above is
        // ours.
        let synth_ns = if t.render.is_some() { t0.elapsed().as_nanos() as u64 } else { 0 };
        if let Some(s) = shared.synth_ns.get(t.chain) {
            s.store(synth_ns, Ordering::Relaxed);
        }
```

Beside `pub fn cost_ns`:

```rust
    /// What the chain's synth stage cost in the last block it ran, nanoseconds.
    pub fn synth_ns(&self, chain: usize) -> u64 {
        self.shared.synth_ns.get(chain).map_or(0, |s| s.load(Ordering::Relaxed))
    }
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/dake/git/cld/movy/engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p movy-dsp render_pool
```

Expected: PASS.

- [ ] **Step 5: Time the synth stage in the serial path**

In `chain_slots.rs`, `fn render_serial`, replace the body of the loop from `if w.synth {` through `self.cost.stop(t0, i);` with:

```rust
            if w.synth {
                inst.render_block(&mut self.scratch[i][..frames]);
            } else {
                // The FX is owed silence to decay into, not the last block.
                self.scratch[i][..frames].fill(0);
            }
            // Before the peak scan, exactly as the pool does it — the two paths
            // have to mean the same thing or the meter changes when a flag does.
            let synth_ns = if w.synth { t0.elapsed().as_nanos() as u64 } else { 0 };
            if split {
                self.synth_peak[i] = self.scratch[i][..frames]
                    .iter()
                    .fold(0i32, |m, &s| m.max((s as i32).abs()));
            }
            if w.fx {
                inst.process_fx(&mut self.scratch[i][..frames]);
            }
            drop(scope);
            self.cost.stop(t0, i);
            self.cost.add_synth_ns(i, synth_ns);
```

- [ ] **Step 6: Stop the parallel fold re-reading a stale cost**

In `chain_slots.rs`, `fn render_parallel`, replace the fold loop:

```rust
            // Costs are timed on whichever lane ran the chain — the audio thread
            // cannot bracket a call it did not make.
            //
            // Only for chains that HAD work: `cost_ns` is never cleared between
            // rounds and a deep-asleep chain builds no task at all, so folding
            // unconditionally re-added the cost the chain had while awake, every
            // block, for as long as it slept. Its mean never decayed and the
            // planner went on reserving a lane for a chain rendering nothing.
            for c in 0..MOVY_CHAINS {
                if self.slots[c].is_some() && !self.work[c].none() {
                    self.cost.add_ns(c, pool.cost_ns(c));
                    self.cost.add_synth_ns(c, pool.synth_ns(c));
                    self.synth_peak[c] = pool.synth_peak(c);
                }
            }
```

- [ ] **Step 7: Fold a zero for the chains that did nothing**

In `chain_slots.rs`, `fn render`, immediately after the `if active > 0 { self.cost.add_wall(...); }` block:

```rust
        // A chain that did no work this block cost nothing, and its mean has to
        // say so. Serial `continue`s past it and parallel skips it above, so
        // without this the mean simply freezes — see the fold in
        // `render_parallel` for what that was doing to the plan.
        for i in 0..MOVY_CHAINS {
            if self.slots[i].is_some() && self.work[i].none() {
                self.cost.add_ns(i, 0);
                self.cost.add_synth_ns(i, 0);
            }
        }
```

- [ ] **Step 8: Run the full engine suite**

```bash
cd /Users/dake/git/cld/movy/engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test
```

Expected: PASS, no regressions.

- [ ] **Step 9: Commit**

```bash
cd /Users/dake/git/cld/movy
git add engine/crates/movy-dsp/src/render_pool.rs engine/crates/movy-dsp/src/chain_slots.rs
git commit -m "$(cat <<'EOF'
engine: time the synth stage, and stop charging a sleeping chain

cost_ns is never cleared between rounds and a deep-asleep chain builds no
task, so the parallel fold re-added what the chain cost while awake — every
block, for as long as it slept.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Put the numbers on the status poll

**Files:**
- Modify: `engine/crates/movy-dsp/src/chain_slots.rs` (add `cost_status`, `cost_ui_reset`)
- Modify: `engine/crates/movy-dsp/src/lib.rs:72` (version), `:197` area (the `cpurst` command), `:374-388` (`status`)
- Modify: `src/seq/constants.ts:38` (version)

**Interfaces:**
- Consumes: `CostMeter::ui_costs`, `ui_wall`, `ui_reset` (Task 1).
- Produces: the `status` fields `chcost=<t>/<s>/<p>,…` (16 triples, µs), `chwall=<mean>/<peak>/<block>` (µs), `chmask=<loaded>/<asleep>` (4 hex digits each); the `cpurst` set_param command.

- [ ] **Step 1: Write the failing test**

Append to `mod tests` in `engine/crates/movy-dsp/src/lib.rs`:

```rust
    /* The page rides the poll the UI already makes. A dedicated get_param would
     * buy one blocking round trip per repaint for numbers `status` can carry in
     * 250 bytes, and `SHADOW_PARAM_VALUE_LEN` is 65536. */
    #[test]
    fn status_carries_the_cpu_meter_fields() {
        let mut inst = Instance::new();
        let s = inst.get_param("status").expect("status");

        let cost = s
            .split(" chcost=")
            .nth(1)
            .and_then(|r| r.split(' ').next())
            .expect("chcost field");
        assert_eq!(cost.split(',').count(), 16, "one triple per chain: {cost}");
        assert!(cost.split(',').all(|t| t.split('/').count() == 3), "{cost}");
        assert!(cost.starts_with("0/0/0,"), "an idle engine costs nothing: {cost}");

        let wall = s
            .split(" chwall=")
            .nth(1)
            .and_then(|r| r.split(' ').next())
            .expect("chwall field");
        let block: u64 = wall.split('/').nth(2).unwrap().parse().unwrap();
        assert!((2800..3000).contains(&block), "128 frames at 44.1k is ~2902us, got {block}");

        assert!(s.contains(" chmask=0000/0000"), "nothing loaded, nothing asleep: {s}");
    }

    /* `cpurst` must not be `chcostlog`: that one closes the window a device
     * benchmark owns, and the page's peak has to survive a benchmark reading
     * the log while the page is up. */
    #[test]
    fn cpurst_is_accepted_and_does_not_disturb_the_status_shape() {
        let mut inst = Instance::new();
        inst.set_param("cmd", "cpurst");
        let s = inst.get_param("status").expect("status");
        assert!(s.contains(" chcost="), "{s}");
    }
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/dake/git/cld/movy/engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p movy-dsp status_carries_the_cpu
```

Expected: FAIL at `.expect("chcost field")`.

- [ ] **Step 3: Build the fields in `chain_slots.rs`**

Add beside `cost_report`:

```rust
    /// The CPU page's numbers as `status` fields, each with its leading space.
    ///
    /// MICROSECONDS, not nanoseconds: this goes out 24 times a second, four
    /// extra digits per chain buys nothing, and the page draws a 1000 us column
    /// in 39 pixels.
    ///
    /// Emitted unconditionally rather than behind an "the page is open" flag —
    /// that flag is a second copy of a fact the UI already owns, and it desyncs
    /// the moment an engine is re-dlopened under an open page.
    pub fn cost_status(&self) -> String {
        let mut s = String::with_capacity(288);
        s.push_str(" chcost=");
        for i in 0..MOVY_CHAINS {
            if i > 0 {
                s.push(',');
            }
            let (total, synth, peak) = self.cost.ui_costs(i);
            s.push_str(&format!("{}/{}/{}", total / 1000, synth / 1000, peak as u64 / 1000));
        }
        let (wall, wall_peak) = self.cost.ui_wall();
        let block_us =
            crate::ffi::MOVE_FRAMES_PER_BLOCK as u64 * 1_000_000 / host::sample_rate().max(1) as u64;
        s.push_str(&format!(
            " chwall={}/{}/{}",
            wall / 1000,
            wall_peak as u64 / 1000,
            block_us
        ));
        let mut loaded = 0u32;
        let mut asleep = 0u32;
        for i in 0..MOVY_CHAINS {
            if self.slots[i].is_some() {
                loaded |= 1 << i;
            }
            if self.idle.deep_asleep(i) {
                asleep |= 1 << i;
            }
        }
        s.push_str(&format!(" chmask={loaded:04x}/{asleep:04x}"));
        s
    }

    /// Clear the meter's held peaks — the page's own reset, never `report()`.
    pub fn cost_ui_reset(&mut self) {
        self.cost.ui_reset();
    }
```

- [ ] **Step 4: Wire the command and the status field in `lib.rs`**

In the `set_param` `match`, directly after the `"chcostlog"` arm:

```rust
            /* `cpurst` — clear the CPU page's held peaks. Deliberately NOT
             * `chcostlog`: that closes the window `measure-chain-balance.sh`
             * owns, and a peak the user is looking at must survive a device
             * script reading the log. */
            "cpurst" => {
                self.chains.cost_ui_reset();
            }
```

In `get_param`'s `"status"` arm, after the existing `chgen`/`chact`/`chslp`/`chpend` `push_str`:

```rust
                /* Rides the same poll, for the same reason: the CPU page
                 * repaints from `status` and must not buy an IPC of its own. */
                s.push_str(&self.chains.cost_status());
```

- [ ] **Step 5: Bump the engine version in both files**

`engine/crates/movy-dsp/src/lib.rs:72` → `const ENGINE_VERSION: &str = "0.61.0";`
`src/seq/constants.ts:38` → `export const ENGINE_VERSION = '0.61.0';`

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd /Users/dake/git/cld/movy/engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/dake/git/cld/movy
git add engine/crates/movy-dsp/src/chain_slots.rs engine/crates/movy-dsp/src/lib.rs src/seq/constants.ts
git commit -m "$(cat <<'EOF'
engine: carry the CPU meter on the status poll (ENGINE 0.61.0)

chcost/chwall/chmask ride the get_param the UI already makes every 8 ticks;
cpurst clears the held peaks without touching the benchmark window.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Parse the fields, without paying for them

The three fields land as **raw strings**. Splitting 32 numbers 24 times a second for a page that is usually closed is work nobody asked for; the view model parses on repaint instead.

**Files:**
- Modify: `src/seq/state.ts`, `src/seq/engine.ts`
- Test: `browser-test/logic/seq-engine.mjs`

**Interfaces:**
- Consumes: the `status` fields from Task 3.
- Produces: `seqState.cpuCost: string`, `seqState.cpuWall: string`, `seqState.cpuMask: string`.

- [ ] **Step 1: Write the failing test**

Append a block to `run()` in `browser-test/logic/seq-engine.mjs`. That file uses `eq` / `_log` from `./harness.mjs` (already imported at the top) and pulls engine modules in with `await import`, so match that:

```js
/* ── CPU meter fields ────────────────────────────────────────────────────── */
{
    _log('\nseq engine: CPU meter fields');
    const { parseStatusForTest } = await import('../../dist/esm/seq/engine.js');
    const { seqState } = await import('../../dist/esm/seq/state.js');

    parseStatusForTest('play=0 chcost=1050/900/1180,0/0/0 chwall=1491/2180/2902 chmask=00ff/0100');
    eq('cpuCost kept raw', seqState.cpuCost, '1050/900/1180,0/0/0');
    eq('cpuWall kept raw', seqState.cpuWall, '1491/2180/2902');
    eq('cpuMask kept raw', seqState.cpuMask, '00ff/0100');

    /* An engine older than the page sends none of them. The previous poll's
     * values must not be left standing as if they were current — that is the
     * meter showing a number nothing measured. */
    parseStatusForTest('play=0');
    eq('a status without the fields clears them', seqState.cpuCost, '');
    eq('all three of them', seqState.cpuWall + seqState.cpuMask, '');
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/logic.mjs
```

Expected: FAIL — `cpuCost kept raw` expected `'1050/900/1180,0/0/0'`, got `undefined`.

- [ ] **Step 3: Add the fields to `seqState`**

In `src/seq/state.ts`, in the `seqState` object literal:

```ts
    /* CPU meter, exactly as the engine sent them.
     *
     * RAW on purpose: parsed only when the page repaints. 32 numbers split and
     * Number()-ed at the 24 Hz poll is real work for a page that is closed
     * almost all the time, and three string assignments are not. */
    cpuCost: '',
    cpuWall: '',
    cpuMask: '',
```

- [ ] **Step 4: Parse them, and clear them when they are absent**

In `src/seq/engine.ts`, in `parseStatus`, before the loop over `s.split(' ')`:

```ts
    /* Cleared each poll rather than only overwritten: an engine that predates
     * the fields sends none of them, and last poll's numbers standing in for
     * this one is exactly the meter lying. */
    seqState.cpuCost = '';
    seqState.cpuWall = '';
    seqState.cpuMask = '';
```

And in the key chain, beside `chpend`:

```ts
        else if (key === 'chcost') seqState.cpuCost = val;
        else if (key === 'chwall') seqState.cpuWall = val;
        else if (key === 'chmask') seqState.cpuMask = val;
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/logic.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/dake/git/cld/movy
git add src/seq/state.ts src/seq/engine.ts browser-test/logic/seq-engine.mjs
git commit -m "$(cat <<'EOF'
seq: carry the CPU meter fields, unparsed

Raw strings: 32 numbers at the poll rate is work for a page that is closed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: The page — open, close, and consume input

**Files:**
- Create: `src/seq/cpu-page.ts`
- Modify: `src/app/state.ts`, `src/seq/constants.ts`, `src/seq/param-page.ts`, `src/seq/router-steps.ts`, `src/midi/router.ts`
- Test: `browser-test/logic/params-pages.mjs`

**Interfaces:**
- Consumes: `openParamPage`, `seqCmd`.
- Produces: `VIEW_CPU: number` (`src/app/state.ts`), `STEP_CPU: number` (`src/seq/constants.ts`), `cpuPageActive(): boolean`, `openCpuPage(): void`, `clearCpuPage(): void` (all `src/seq/cpu-page.ts`).

- [ ] **Step 1: Write the failing test**

Append to `browser-test/logic/params-pages.mjs`, matching the file's existing import and assertion style:

```js
/* ── CPU page: Shift+Step 12 ─────────────────────────────────────────────── */
{
    resetApp();
    appState.currentView = VIEW_CHAIN;
    handleStepButton(STEP_CPU, true, true);
    eq('Shift+Step 12 opens the CPU page', appState.currentView, VIEW_CPU);
    eq('the CPU page is a param-page sibling', paramPageActive(), true);
    ok('opening resets the held peaks', peekSeqCmdQueue().includes('cpurst'));

    /* Pressing again while it is up is the meter's "clear peaks" — the gesture
     * a hardware meter puts on its own button. */
    seqCmdFlush();
    handleStepButton(STEP_CPU, true, true);
    eq('a second press stays on the page', appState.currentView, VIEW_CPU);
    ok('and clears the peaks again', peekSeqCmdQueue().includes('cpurst'));

    /* Back leaves the layer for the view it was entered from — the same one
     * gesture that leaves Set Params, Clip Params and Settings. */
    appState.currentView = closeParamPage();
    eq('Back leaves for the origin', appState.currentView, VIEW_CHAIN);
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/logic.mjs
```

Expected: FAIL — `STEP_CPU` is not exported.

- [ ] **Step 3: Add the view and the step constant**

`src/app/state.ts`, beside the other `VIEW_` constants:

```ts
export const VIEW_CPU         = 9;   // CPU meter (Shift+Step 12)
```

`src/seq/constants.ts`, beside the other `STEP_` constants:

```ts
export const STEP_CPU = 11;          // Shift+Step 12 — CPU meter
```

- [ ] **Step 4: Create the page**

Create `src/seq/cpu-page.ts`:

```ts
/* CPU meter page: what each track's chain costs per audio block, over a
 * capacity bar for the whole chain render. Opened with Shift+Step 12, closed
 * with Back.
 *
 * The page has no gesture state and no editable value — every number on it
 * comes from the engine, and there is nothing to turn. What it does own is the
 * PEAK: `cpurst` clears the engine's held maxima, so opening the page starts a
 * fresh observation, and pressing the gesture again while it is up clears them
 * without leaving — the button a hardware meter puts its peak-reset on.
 *
 * Sibling of Set Params, Clip Params and Settings in the param-page.ts layer,
 * so one Back leaves all four and a track button closes them. Being open IS
 * `currentView === VIEW_CPU` — see the note in main-page.ts for what a second
 * hand-synced copy of that fact costs. */

import { appState, VIEW_CPU } from '../app/state.js';
import { openParamPage } from './param-page.js';
import { seqCmd } from './engine.js';

export function cpuPageActive(): boolean {
    return appState.currentView === VIEW_CPU;
}

/** Open the page, or — if it is already up — restart the peak observation. */
export function openCpuPage(): void {
    openParamPage(VIEW_CPU);
    seqCmd('cpurst');
}

/** Nothing transient to drop. Present so `param-page.ts` treats all four
 *  siblings the same way, rather than special-casing the one without state. */
export function clearCpuPage(): void {}
```

- [ ] **Step 5: Make it a param-page sibling**

In `src/seq/param-page.ts`: import `VIEW_CPU` from `../app/state.js` and `clearCpuPage` from `./cpu-page.js`; add `|| appState.currentView === VIEW_CPU` to `paramPageActive()`; add `clearCpuPage();` beside the other three clears in both `openParamPage` and `closeParamPage`.

- [ ] **Step 6: Bind the gesture**

In `src/seq/router-steps.ts`, import `STEP_CPU` from `./constants.js` and `openCpuPage` from `./cpu-page.js`, then add to `shiftStepFunction` directly after the `STEP_CLIP_PARAMS` block:

```ts
    if (step === STEP_CPU) {
        openCpuPage();
        appState.dirty = true;
        return;
    }
```

- [ ] **Step 7: Consume knob and jog on the page**

In `src/midi/router.ts`, import `cpuPageActive` from `../seq/cpu-page.js`.

In the knob dispatch, directly after the `flagsPageActive()` block:

```ts
        if (cpuPageActive()) {
            // Nothing on this page is editable. Consumed anyway, or a stray
            // turn reaches the module underneath and edits a parameter the user
            // cannot see.
            return;
        }
```

In the jog dispatch, directly after the `flagsPageActive()` block:

```ts
            if (cpuPageActive()) return;   // sixteen columns fit; nothing to scroll
```

- [ ] **Step 8: Run the test to verify it passes**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/logic.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
cd /Users/dake/git/cld/movy
git add src/app/state.ts src/seq/constants.ts src/seq/cpu-page.ts src/seq/param-page.ts src/seq/router-steps.ts src/midi/router.ts browser-test/logic/params-pages.mjs
git commit -m "$(cat <<'EOF'
seq: Shift+Step 12 opens the CPU meter page

A fourth param-page sibling. No editable value, so knob and jog are
consumed rather than falling through to the module underneath.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: The view model

Turns the three raw strings plus the track host setting into sixteen typed columns. This is where "the numbers stay representative" is decided, so it is where the tests are.

**Files:**
- Create: `src/seq/cpu-page-vm.ts`
- Test: `browser-test/logic/cpu-page.mjs` (new), registered in `browser-test/logic.mjs`

**Interfaces:**
- Consumes: `seqState.cpuCost / cpuWall / cpuMask` (Task 4), `trackKind` and `TRACK_COUNT` (`src/track/ref.ts`), `flagValue('cpuopt')`.
- Produces: `FULL_SCALE_US: number`; `type CpuColumn = { kind: 'live'|'empty'|'asleep'|'na'; totalUs: number; synthUs: number; peakUs: number }`; `type CpuPageVM = { columns: CpuColumn[]; wallUs: number; wallPeakUs: number; blockUs: number; load: number; peakLoad: number; optimized: boolean }`; `buildCpuPageVM(): CpuPageVM`.

- [ ] **Step 1: Write the failing tests**

First re-export the two new symbols from `browser-test/logic/harness.mjs` — every logic module takes its imports from there. Add to its import list and to the big `export { ... }` block at the bottom:

```js
import { buildCpuPageVM, FULL_SCALE_US } from '../../dist/esm/seq/cpu-page-vm.js';
```

Then create `browser-test/logic/cpu-page.mjs`. `run()` takes no arguments, `eq`/`ok`/`_log` come from the harness, and anything the harness does not re-export is pulled in with `await import` — the shape every module in this directory uses:

```js
/* browser-test/logic/cpu-page.mjs — the CPU page's view model: what the sixteen
 * columns mean, and what they mean when the engine is silent, old, or hosting
 * only some of the tracks.
 *
 * Run by browser-test/logic.mjs.
 */

import {
    buildCpuPageVM, FULL_SCALE_US, setFlag, resetFlags,
    ok, eq, _log,
} from './harness.mjs';

export async function run() {
    const { seqState } = await import('../../dist/esm/seq/state.js');

    /* Eight loaded chains; chain 8 loaded but asleep. Microseconds per block. */
    const COST = [
        '240/180/310', '370/300/450', '1050/900/1180', '920/700/1010',
        '250/200/300', '320/320/400', '180/140/220', '670/560/790',
        '0/0/0', '0/0/0', '0/0/0', '0/0/0', '0/0/0', '0/0/0', '0/0/0', '0/0/0',
    ].join(',');

    const feed = ({ mask = '01ff/0100', cost = COST, wall = '1491/2180/2902' } = {}) => {
        seqState.cpuCost = cost;
        seqState.cpuWall = wall;
        seqState.cpuMask = mask;
    };

    _log('\ncpu page: columns');
    resetFlags();
    setFlag('cpuopt', 1);
    setFlag('chtracks', 1);          // every track is a movy chain
    feed();
    let vm = buildCpuPageVM();
    eq('one column per track', vm.columns.length, 16);
    eq('a rendering chain is live', vm.columns[2].kind, 'live');
    eq('its total is what the engine said', vm.columns[2].totalUs, 1050);
    eq('and its synth stage', vm.columns[2].synthUs, 900);
    eq('and its held peak', vm.columns[2].peakUs, 1180);
    eq('loaded but silent is asleep, not empty', vm.columns[8].kind, 'asleep');
    eq('nothing loaded is empty', vm.columns[9].kind, 'empty');

    _log('\ncpu page: capacity');
    eq('block period comes from the engine', vm.blockUs, 2902);
    ok('load is wall over block', Math.abs(vm.load - 1491 / 2902) < 1e-6);
    ok('peak load likewise', Math.abs(vm.peakLoad - 2180 / 2902) < 1e-6);

    /* An overrun is the one reading that matters most. Clamping it here would
     * hide it, so the bar clamps and the number does not. */
    feed({ wall: '3400/3900/2902' });
    vm = buildCpuPageVM();
    ok('an overrun reads over 1.0', vm.load > 1);

    _log('\ncpu page: tracks movy cannot measure');
    resetFlags();
    setFlag('cpuopt', 1);
    setFlag('chtracks', 0);          // tracks 1-4 stay on the schwung host
    feed();
    vm = buildCpuPageVM();
    eq('a schwung-hosted track is n/a', vm.columns[0].kind, 'na');
    eq('and so are the other three', vm.columns[3].kind, 'na');
    eq('a movy chain beside them still reads', vm.columns[4].kind, 'live');

    _log('\ncpu page: CPU Optimize off');
    resetFlags();
    setFlag('cpuopt', 0);
    setFlag('chtracks', 1);
    /* One render_block call: the synth stage IS the whole chain, so the FX
     * segment comes out empty with no branch anywhere in the renderer. */
    feed({ cost: ['800/800/900'].concat(Array(15).fill('0/0/0')).join(','), mask: '0001/0000' });
    vm = buildCpuPageVM();
    eq('optimized is reported', vm.optimized, false);
    eq('synth equals total when the chain does not split', vm.columns[0].synthUs, 800);
    eq('so the FX segment is nothing', vm.columns[0].totalUs - vm.columns[0].synthUs, 0);

    _log('\ncpu page: nothing to draw');
    resetFlags();
    setFlag('chtracks', 1);
    seqState.cpuCost = ''; seqState.cpuWall = ''; seqState.cpuMask = '';
    vm = buildCpuPageVM();
    eq('an engine that never sent the fields draws empty', vm.columns[0].kind, 'empty');
    eq('and no load', vm.load, 0);
    ok('with a sane block period', vm.blockUs > 0);
    eq('full scale is fixed', FULL_SCALE_US, 1000);
}
```

Then register it in `browser-test/logic.mjs`: `import { run as run_cpu_page } from './logic/cpu-page.mjs';` beside the other imports, and `run_cpu_page,` in the list below them.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/logic.mjs
```

Expected: FAIL — cannot resolve `dist/esm/seq/cpu-page-vm.js` from `harness.mjs`.

- [ ] **Step 3: Write the view model**

Create `src/seq/cpu-page-vm.ts`:

```ts
/* What the CPU page draws, as data.
 *
 * Same split as the other pages: the renderer is pure and takes this, so every
 * rule below can be asserted without a framebuffer.
 *
 * The three inputs arrive as raw strings on the status poll and are parsed
 * HERE, once per repaint, rather than on every poll — see seq/state.ts. */

import { seqState } from './state.js';
import { flagValue } from './flags.js';
import { TRACK_COUNT, trackKind } from '../track/ref.js';

/** Column full scale, microseconds per block. FIXED.
 *
 *  Auto-ranging to the heaviest track would make a column legible on any set
 *  and comparable on none — not between sessions, and not across the CPU
 *  Optimize flag, which is the one comparison the page exists to make. 1000 us
 *  is round and puts every chain the fleet has measured on scale. */
export const FULL_SCALE_US = 1000;

/** Fallback block period, microseconds — 128 frames at 44.1 kHz. Only used
 *  before the first poll carrying `chwall`; the engine computes the real one
 *  from the host's sample rate. */
const DEFAULT_BLOCK_US = 2902;

export type CpuColumnKind =
    /** Rendering in movy's chain render, with a cost. */
    | 'live'
    /** Loaded, but making no sound, so `chidle` is skipping it. Distinct from
     *  `empty` because "costs nothing right now" and "there is nothing here"
     *  are the two different answers to a bar reading zero. */
    | 'asleep'
    /** No module. */
    | 'empty'
    /** On the Schwung host, which renders outside movy entirely. Blank would
     *  say the track is free; this says it is not ours to measure. */
    | 'na';

export type CpuColumn = {
    kind: CpuColumnKind;
    totalUs: number;
    synthUs: number;
    peakUs: number;
};

export type CpuPageVM = {
    columns: CpuColumn[];
    wallUs: number;
    wallPeakUs: number;
    blockUs: number;
    /** Wall over block. NOT clamped — an overrun is the reading that matters
     *  most, and the bar clamping is the renderer's business, not this. */
    load: number;
    peakLoad: number;
    /** CPU Optimize. Only the header uses it: with the flag off a chain renders
     *  in one call, so `synthUs === totalUs` already and no segment needs a
     *  branch. */
    optimized: boolean;
};

const EMPTY: CpuColumn = { kind: 'empty', totalUs: 0, synthUs: 0, peakUs: 0 };

function num(s: string | undefined): number {
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function buildCpuPageVM(): CpuPageVM {
    const triples = seqState.cpuCost ? seqState.cpuCost.split(',') : [];
    const [loadedHex, asleepHex] = (seqState.cpuMask || '0/0').split('/');
    const loaded = parseInt(loadedHex, 16) || 0;
    const asleep = parseInt(asleepHex, 16) || 0;
    const [wallStr, peakStr, blockStr] = (seqState.cpuWall || '').split('/');
    const blockUs = num(blockStr) || DEFAULT_BLOCK_US;
    const wallUs = num(wallStr);
    const wallPeakUs = num(peakStr);

    const columns: CpuColumn[] = [];
    for (let t = 0; t < TRACK_COUNT; t++) {
        if (trackKind(t) === 'host') {
            columns.push({ kind: 'na', totalUs: 0, synthUs: 0, peakUs: 0 });
            continue;
        }
        const bit = 1 << t;
        if (!(loaded & bit)) {
            columns.push({ ...EMPTY });
            continue;
        }
        const [total, synth, peak] = (triples[t] || '').split('/');
        columns.push({
            kind: asleep & bit ? 'asleep' : 'live',
            totalUs: num(total),
            synthUs: Math.min(num(synth), num(total)),
            peakUs: num(peak),
        });
    }

    return {
        columns,
        wallUs,
        wallPeakUs,
        blockUs,
        load: wallUs / blockUs,
        peakLoad: wallPeakUs / blockUs,
        optimized: flagValue('cpuopt') > 0,
    };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/logic.mjs
```

Expected: PASS.

- [ ] **Step 5: Prove the tests have teeth**

Temporarily change `kind: asleep & bit ? 'asleep' : 'live'` to `kind: 'live'` and re-run. Expected: FAIL on `loaded but silent is asleep, not empty`. Revert.

Temporarily change `load: wallUs / blockUs` to `load: Math.min(1, wallUs / blockUs)` and re-run. Expected: FAIL on `an overrun reads over 1.0`. Revert.

- [ ] **Step 6: Commit**

```bash
cd /Users/dake/git/cld/movy
git add src/seq/cpu-page-vm.ts browser-test/logic/cpu-page.mjs browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
seq: the CPU page's view model

Four column states, because a bar reading zero has four different reasons.
Load is not clamped: an overrun is the reading that matters most.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: The renderer

**Files:**
- Modify: `src/renderer/primitives.ts` (add `hatchRect`), `src/renderer/lfo-wave.ts:109-110`, `src/renderer/knob.ts:149-151` (both call it instead of their own copy)
- Create: `src/renderer/cpu-view.ts`
- Modify: `browser-test/screenshot.mjs` (four presets)

**Interfaces:**
- Consumes: `CpuPageVM`, `FULL_SCALE_US` (Task 6).
- Produces: `hatchRect(x: number, y: number, w: number, h: number, color: number): void` (`src/renderer/primitives.ts`); `renderCpuView(vm: CpuPageVM): void` (`src/renderer/cpu-view.ts`).

- [ ] **Step 1: Add the shared hatch and refactor the two existing copies**

In `src/renderer/primitives.ts`:

```ts
/* 50% checkerboard fill, broken on a DIAGONAL parity (x+y) rather than
 * per-column: a vertical edge and a flat run both come out dashed, where a
 * per-column rule leaves whole edges either solid or missing.
 *
 * Shared because three renderers want it — the LFO wave's "not sounding"
 * dotting, the knob envelope's ramp, and the CPU page's FX segment. */
export function hatchRect(x: number, y: number, w: number, h: number, color: number): void {
    for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) {
            if (((xx + yy) & 1) === 0) fill_rect(xx, yy, 1, 1, color);
        }
    }
}
```

In `src/renderer/lfo-wave.ts`, replace the two-line dotted branch of `vline`:

```ts
        const lo = Math.min(a, b), hi = Math.max(a, b);
        hatchRect(px, lo, 1, hi - lo + 1, colour);
```

In `src/renderer/knob.ts`, replace the body of the local `dottedV`:

```ts
    const dottedV = (px: number): void => { hatchRect(px, top, 1, bot - top + 1, 1); };
```

Add `hatchRect` to each file's existing import from `./primitives.js`.

- [ ] **Step 2: Verify the refactor changed no pixels**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/screenshot.mjs
```

Expected: PASS with **no** baseline differences. `hatchRect` at `w = 1` is exactly the loop it replaced, so a diff here means the parity was transcribed wrong.

- [ ] **Step 3: Write the renderer**

Create `src/renderer/cpu-view.ts`:

```ts
/* The CPU meter page: a capacity bar for the whole chain render, and one column
 * per track for what that track's chain costs per audio block.
 *
 * There is deliberately NO horizontal reference line across the columns. A line
 * spanning all sixteen reads as a limit, and there is no per-track limit — the
 * only ceiling on this page is the capacity bar, which is where it belongs. */

import type { CpuColumn, CpuPageVM } from '../seq/cpu-page-vm.js';
import { FULL_SCALE_US } from '../seq/cpu-page-vm.js';
import { fontPrint, fontWidth } from '../font/index.js';
import { fontPrint5x3, fontWidth5x3 } from '../font/index5x3.js';
import { drawHeader } from './header.js';
import { drawDottedH, drawDottedV, hatchRect } from './primitives.js';
import { W } from './layout.js';

/* Rows 60-63 belong to the Loop Overview strip, which repaints every tick
 * outside the dirty-frame block. VIEW_CPU is excluded from it (app/tick.ts), so
 * the label row can sit at 58 — but nothing may go below 62. */
const BAR_Y = 8, BAR_H = 6;
const TOP = 17, BOT = 56;
const HGT = BOT - TOP;
const LABEL_Y = 58;
const COL_W = 7;     // plus a 1 px gutter: 16 * 8 == W

/** Pixels for `us`, clamped to the plot. Exported so the scaling can be
 *  asserted without a framebuffer. */
export function barPixels(us: number): number {
    return Math.min(HGT, Math.max(0, Math.round((us / FULL_SCALE_US) * HGT)));
}

export function renderCpuView(vm: CpuPageVM): void {
    clear_screen();
    const pct = Math.round(vm.load * 100) + '%';
    drawHeader(vm.optimized ? 'CPU' : 'CPU OPT OFF', pct);
    drawCapacity(vm.load, vm.peakLoad);
    for (let i = 0; i < vm.columns.length && i < 16; i++) {
        drawColumn(i * 8, vm.columns[i]);
    }
    /* Every fourth track, because a 7 px column cannot hold a two-digit label
     * and a ruler nobody can read is worse than a sparse one. */
    for (const n of [1, 5, 9, 13]) fontPrint5x3((n - 1) * 8, LABEL_Y, String(n), 1);
    const scale = String(FULL_SCALE_US / 1000) + 'MS';
    fontPrint5x3(W - fontWidth5x3(scale), LABEL_Y, scale, 1);
}

/* The block, as a bar. Fill is what movy consumed; the notch is the worst block
 * since the page opened, held for as long as it stays open. The bar clamps at
 * full — the header's percentage is what reports an overrun. */
function drawCapacity(load: number, peak: number): void {
    fill_rect(0, BAR_Y, W, 1, 1);
    fill_rect(0, BAR_Y + BAR_H - 1, W, 1, 1);
    fill_rect(0, BAR_Y, 1, BAR_H, 1);
    fill_rect(W - 1, BAR_Y, 1, BAR_H, 1);
    const inner = W - 2;
    const fw = Math.round(Math.min(1, Math.max(0, load)) * inner);
    if (fw > 0) fill_rect(1, BAR_Y + 1, fw, BAR_H - 2, 1);
    const px = 1 + Math.round(Math.min(1, Math.max(0, peak)) * inner);
    // Inverted inside the fill, lit outside it — one mark that reads either way.
    fill_rect(Math.min(px, W - 2), BAR_Y + 1, 1, BAR_H - 2, px < 1 + fw ? 0 : 1);
    fill_rect(Math.min(px, W - 2) - 1, BAR_Y - 1, 3, 1, 1);
}

function drawColumn(x: number, col: CpuColumn): void {
    if (col.kind === 'na') {
        // Not ours to measure. Blank would say the track is free.
        drawDottedV(x + 3, TOP + 2, BOT);
        fill_rect(x, BOT, COL_W, 1, 1);
        return;
    }
    fill_rect(x, BOT, COL_W, 1, 1);          // the column exists, even unused
    if (col.kind === 'asleep') {
        // Loaded, silent, skipped: costing nothing right now, which is not the
        // same as nothing being here.
        fill_rect(x + 2, BOT - 3, 3, 1, 1);
        return;
    }
    if (col.kind === 'empty') return;

    const sH = barPixels(col.synthUs);
    const fH = Math.min(HGT - sH, barPixels(col.totalUs - col.synthUs));
    if (sH > 0) fill_rect(x, BOT - sH, COL_W, sH, 1);
    if (fH > 0) hatchRect(x, BOT - sH - fH, COL_W, fH, 1);
    if (col.totalUs > FULL_SCALE_US) {
        // Detached cap: a gap under a solid line, which reads over the solid
        // synth and the checkered FX alike.
        fill_rect(x, TOP + 1, COL_W, 1, 0);
        fill_rect(x, TOP, COL_W, 1, 1);
    }
    if (col.peakUs > 0) {
        drawDottedH(x, x + COL_W - 1, BOT - barPixels(col.peakUs));
    }
}
```

- [ ] **Step 4: Add the screenshot presets**

In `browser-test/screenshot.mjs`, add to the `PRESETS` array:

```js
    'cpu-opt-on', 'cpu-opt-off', 'cpu-overscale', 'cpu-empty',
```

Import at the top, beside the other renderer imports:

```js
const { renderCpuView }   = await import('../dist/esm/renderer/cpu-view.js');
const { buildCpuPageVM }  = await import('../dist/esm/seq/cpu-page-vm.js');
```

(match however the file already performs its imports — some are static, some awaited after `installEnv`.)

Add the case block beside `flags-release`:

```js
        case 'cpu-opt-on':
        case 'cpu-opt-off':
        case 'cpu-overscale':
        case 'cpu-empty': {
            resetFlags();
            const on = preset !== 'cpu-opt-off';
            setFlag('cpuopt', on ? 1 : 0);
            // 'cpu-opt-off' also stands for the arrangement where tracks 1-4
            // are Schwung's: the two are the states the page has to survive.
            setFlag('chtracks', on ? 1 : 0);
            const live = [
                '240/180/310', '370/300/450', '1050/900/1180', '920/700/1010',
                '250/200/300', '320/320/400', '180/140/220', '670/560/790',
            ];
            const over = live.slice();
            over[2] = '1600/1300/1900';
            const rows = preset === 'cpu-overscale' ? over : live;
            const cost = rows.concat(Array(16 - rows.length).fill('0/0/0')).join(',');
            if (preset === 'cpu-empty') {
                seqState.cpuCost = ''; seqState.cpuWall = ''; seqState.cpuMask = '';
            } else {
                seqState.cpuCost = cost;
                seqState.cpuWall = preset === 'cpu-overscale' ? '2210/2680/2902' : '1491/2180/2902';
                seqState.cpuMask = '01ff/0100';
            }
            lastRender = () => renderCpuView(buildCpuPageVM());
            lastRender();
            break;
        }
```

- [ ] **Step 5: Generate and eyeball the baselines**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/screenshot.mjs --update
```

Then open `browser-test/screenshots/baseline/cpu-opt-on.png` and the other three and check, at 4×:

- the header reads `CPU` / a percentage, and `CPU OPT OFF` on the off preset
- the capacity bar has a peak notch above it
- track 3's column is capped by a detached line on `cpu-overscale` and not on `cpu-opt-on`
- tracks 1-4 are dotted verticals on `cpu-opt-off`
- track 9 shows the asleep dash, tracks 10-16 only their baselines
- **no horizontal line spans the columns**
- the label row is `1 5 9 13` and `1MS`, and nothing is drawn below row 62

- [ ] **Step 6: Run the whole suite**

```bash
cd /Users/dake/git/cld/movy && npm test
```

Expected: 0 failures.

- [ ] **Step 7: Commit**

```bash
cd /Users/dake/git/cld/movy
git add src/renderer/primitives.ts src/renderer/lfo-wave.ts src/renderer/knob.ts src/renderer/cpu-view.ts browser-test/screenshot.mjs browser-test/screenshots/baseline
git commit -m "$(cat <<'EOF'
renderer: the CPU meter page

Sixteen columns over a capacity bar, with no reference line across them — a
line spanning every column reads as a limit and there is no per-track limit.
hatchRect is shared with the two renderers that had their own copy.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Wire it into the tick, and document it

The repaint gate is the part that keeps the meter honest: the UI thread competes with the render lanes for Move's cores, so a page that repaints freely inflates the number it is showing.

**Files:**
- Modify: `src/app/tick.ts`
- Modify: `MANUAL.md`
- Test: `browser-test/app-loop.mjs`

**Interfaces:**
- Consumes: `renderCpuView` (Task 7), `buildCpuPageVM` (Task 6), `cpuPageActive` (Task 5), `updateSingleKnobLED` (`src/renderer/knob-leds.ts`).
- Produces: nothing further.

- [ ] **Step 1: Write the failing test**

Add the three names this task's tests need to `browser-test/app-loop.mjs`'s
imports — `STEP_CPU` from `../dist/esm/seq/constants.js`, `VIEW_CPU` from
`../dist/esm/app/state.js`, and `closeParamPage` from
`../dist/esm/seq/param-page.js` — beside whichever of them the file already
pulls in. Then append, following the file's existing block style:

```js
/* ── CPU page owns its bottom rows ──────────────────────────────────────────
 * drawLoopStrip() clears rows 60-63 every tick, OUTSIDE the dirty-frame block.
 * A page that draws down there and is not excluded loses those rows a few
 * milliseconds after it painted them — visible only on the device, because a
 * screenshot scene never ticks. */
_log('\napp-loop: CPU page is not painted over by the loop strip');
{
    resetApp();
    handleStepButton(STEP_CPU, true, true);
    eq('the CPU page is up', appState.currentView, VIEW_CPU);
    appState.dirty = true;

    const rects = [];
    const origFR = globalThis.fill_rect;
    globalThis.fill_rect = (x, y, w, h, v) => rects.push([x, y, w, h, v]);
    advance(1);
    globalThis.fill_rect = origFR;

    const stripDrawn = rects.some(([x, y, w, h, v]) => x === 0 && y === 60 && w === 128 && h === 4 && v === 0);
    eq('loop strip suppressed on the CPU page', stripDrawn, false);
    ok('and the page actually painted', rects.length > 0);

    appState.currentView = closeParamPage();
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/app-loop.mjs
```

Expected: FAIL — `loop strip suppressed on the CPU page` is `true`, because nothing renders the view yet and nothing excludes it from the strip.

- [ ] **Step 3: Dispatch the view**

In `src/app/tick.ts`, add the imports:

```ts
import { renderCpuView } from '../renderer/cpu-view.js';
import { buildCpuPageVM } from '../seq/cpu-page-vm.js';
import { cpuPageActive } from '../seq/cpu-page.js';
import { VIEW_CPU } from './state.js';   // add to the existing VIEW_ import
```

In the render dispatch, directly after the `VIEW_FLAGS` branch:

```ts
        } else if (appState.currentView === VIEW_CPU) {
            renderCpuView(buildCpuPageVM());
            // Nothing on this page is editable, so every knob goes dark. A knob
            // still lit from the page underneath would be inviting a turn this
            // page consumes and ignores.
            updateSingleKnobLED(-1, 0);
```

- [ ] **Step 4: Add the repaint gate**

Beside the other signature functions in `src/app/tick.ts`. Note the two-stage shape — it is not the `mainSig()` pattern, deliberately:

```ts
let lastCpuRaw = '';
let lastCpuSig = '';
/* The CPU page's repaint gate.
 *
 * TWO stages, unlike the other pages' signatures. The cheap one is the raw
 * status strings: the tick runs at 60-200 Hz and the poll that can change them
 * at ~24, so on most ticks nothing can possibly have moved and two string
 * concatenations settle it. Only when a new poll has landed is the view model
 * built — and then the signature is over the DRAWN PIXELS, not the microseconds
 * behind them, so microsecond jitter under a pixel does not repaint anything.
 *
 * That second stage is the load-bearing one: movy's UI thread competes with the
 * render lanes for Move's cores, so a meter that repaints on noise inflates the
 * very number it is displaying.
 *
 * Called once per tick and it does its own storing — the other signature checks
 * call their function twice per tick, which this one cannot afford. */
function cpuRepaintTick(): void {
    if (!cpuPageActive()) return;
    const raw = seqState.cpuCost + '|' + seqState.cpuWall + '|' + seqState.cpuMask;
    if (raw === lastCpuRaw) return;
    lastCpuRaw = raw;
    const vm = buildCpuPageVM();
    const cols = vm.columns.map((c) =>
        c.kind[0] + barPixels(c.synthUs) + '.' + barPixels(c.totalUs) + '.' + barPixels(c.peakUs));
    const sig = Math.round(vm.load * 100) + '|' + Math.round(vm.peakLoad * 100) + '|'
        + (vm.optimized ? 1 : 0) + '|' + cols.join(',');
    if (sig === lastCpuSig) return;
    lastCpuSig = sig;
    appState.dirty = true;
}
```

Import `barPixels` from `../renderer/cpu-view.js`, and call it beside the other signature checks:

```ts
    cpuRepaintTick();   // repaint only when a pixel the CPU page draws would change
```

- [ ] **Step 5: Exclude the page from the loop strip**

In `src/app/tick.ts`, extend the guard above `drawLoopStrip()`:

```ts
    const isBrowseView = appState.currentView === VIEW_BROWSE || appState.currentView === VIEW_FILE_BROWSE;
    // The CPU meter owns the whole screen down to row 62, and the strip's
    // per-tick clear would take its label row.
    const isFullScreenView = isBrowseView || appState.currentView === VIEW_CPU;
```

and replace `!isBrowseView` with `!isFullScreenView` in the `drawLoopStrip` condition only. Leave the `songBandTick` condition on `isBrowseView` — Session view and the CPU page cannot both be up, so it never applies.

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/app-loop.mjs
```

Expected: PASS.

- [ ] **Step 7: Test the repaint gate itself**

The gate is the reason the meter does not inflate its own reading, so it gets its
own assertions rather than a manual check. Append to `browser-test/app-loop.mjs`:

The numbers must arrive through the **real poll**, not `parseStatusForTest`:
`parseStatus` now clears the three fields on every poll, so a value written
behind the poll's back is wiped by the next tick. `installMockEngine` serializes
whatever keys are on `engine.status`, which is the path the device takes.
`STATUS_POLL_TICKS` is 8, so each observation has to advance past one poll.

```js
/* ── CPU page repaints on pixels, not on microseconds ───────────────────────
 * The meter runs on the UI thread, which competes with the render lanes for
 * Move's cores. A page that repaints because a number wobbled below the
 * resolution of a bar is measuring its own repaint. */
_log('\napp-loop: CPU page repaints only when a drawn pixel changes');
{
    resetApp();
    const cols = (t, s) => [`${t}/${s}/900`].concat(Array(15).fill('0/0/0')).join(',');
    engine.status.chmask = '0001/0000';
    engine.status.chwall = '1491/2180/2902';
    engine.status.chcost = cols(800, 600);

    handleStepButton(STEP_CPU, true, true);
    eq('the CPU page is up', appState.currentView, VIEW_CPU);
    advance(12);                        // past a poll; settles the first repaint

    const paintsAfter = (mutate) => {
        mutate();
        appState.dirty = false;
        const before = painted.length;
        advance(12);
        return painted.length - before;
    };

    /* One microsecond on a 1000 us column is 1/39th of a pixel, and one on the
     * capacity bar is well under 1%. */
    eq('sub-pixel jitter does not repaint', paintsAfter(() => {
        engine.status.chcost = cols(801, 601);
        engine.status.chwall = '1492/2180/2902';
    }) > 0, false);

    /* 100 us is ~4 px of a column: a change the screen can actually show. */
    eq('a change worth a pixel does repaint', paintsAfter(() => {
        engine.status.chcost = cols(900, 700);
    }) > 0, true);

    delete engine.status.chcost;
    delete engine.status.chwall;
    delete engine.status.chmask;
    appState.currentView = closeParamPage();
}
```

Run it:

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/app-loop.mjs
```

Expected: PASS both.

- [ ] **Step 8: Prove that test has teeth**

Temporarily replace the body of `cpuRepaintTick` with `appState.dirty = true;` and
re-run `node browser-test/app-loop.mjs`. Expected: FAIL on `sub-pixel jitter does
not repaint`. Then temporarily make it `return;` unconditionally. Expected: FAIL on
`a change worth a pixel does repaint`. Revert both.

A gate that fails neither way is a gate that is not wired in — which is exactly
what happens if `cpuRepaintTick()` is added to the file but never called.

- [ ] **Step 9: Document it**

Add a section to `MANUAL.md` beside the other `Shift + Step` pages. It must cover:

- the gesture (`Shift + Step 12`), and that pressing it again clears the held peaks
- what 100% means: **movy's chain render against one audio block**, not the whole device — Move's own engine takes roughly another 240 µs of the same block
- the four column states: a bar, a dash (loaded but silent), a bare baseline (empty), a dotted column (on the Schwung host, which movy cannot measure)
- solid = synth, checkered = FX; and that with **CPU Optimize off** the chain renders in one call so there is no FX segment to show
- that a track legitimately reads **higher** with CPU Optimize on — measured at ~27% under three-lane contention — while the capacity bar reads much lower, because the lanes are carrying the block in parallel
- full scale is 1 ms per column, fixed; a column that goes over is capped by a detached line

Use `cpu-opt-on.png` and `cpu-opt-off.png` from the screenshot baselines via the `make-doc-assets.mjs` workflow described in `movy/CLAUDE.md` → **Documentation**.

- [ ] **Step 10: Run everything**

```bash
cd /Users/dake/git/cld/movy && npm test && (cd engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test)
```

Expected: 0 failures in both.

- [ ] **Step 11: Commit**

```bash
cd /Users/dake/git/cld/movy
git add src/app/tick.ts browser-test/app-loop.mjs MANUAL.md docs/assets
git commit -m "$(cat <<'EOF'
app: render the CPU page, gated on the pixels it draws

The UI thread competes with the render lanes, so a meter that repaints on
noise inflates its own reading. VIEW_CPU is excluded from the loop strip's
per-tick clear, which would take its label row.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Device verification

Not a task — run once the eight are done, per `movy/CLAUDE.md` → **Dev loop** step 4. The device is what proves the two claims a host build cannot:

1. Deploy (`scripts/deploy.sh`) — a new `dsp.so` needs a Move restart, which `deploy.sh` does on an md5 change.
2. Open the page on a set with several loaded tracks. The columns should be non-zero, and the capacity percentage should be in the tens.
3. Toggle **CPU Optimize** on the Settings page and watch the capacity bar move while the columns stay in the same units. This is the whole "representative in both modes" claim.
4. Stop the transport and let the set go silent. Loaded columns should fall to the asleep dash within a second or two — that is the Task 2 decay fix, and it is the one thing no host test can reach.

Device tests are flaky. Run the relevant suite once; if it fails, check whether it points at this change, and otherwise report it and move on.
