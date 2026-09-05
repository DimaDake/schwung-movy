# Send FX Buses and MIX Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two movy-hosted send FX buses on the master page, and a MIX page at the end of every track's chain rotation carrying volume, pan and the two send levels — all four automatable on movy-hosted chains.

**Architecture:** Two `ChainInstance`s live in a new `send_bus.rs` owned by `ChainSlots` (NOT as extra entries in `ChainSlots.slots` — see spec §4). Each track's post-fader, post-pan signal accumulates into two i16 buses during the existing mix loop; after the track loop each bus runs `chain_process_fx` and sums into the output at unity. The UI adds one virtual `CHAIN_SLOTS` entry (MIX) and two `MASTER_FX_SLOTS` entries (SEND 1/2), following the existing virtual-LFO-slot pattern exactly.

**Tech Stack:** Rust (`movy-dsp`, `seq-core`, no_std-ish audio-thread discipline: no allocation in render), TypeScript → esbuild bundle → QuickJS on device, node-based test suites (`browser-test/`).

**Spec:** `movy/plans/2026-09-05-send-fx-and-mix-page-design.md` — read it before starting. Every task below argues from a numbered section of it.

## Global Constraints

- **File size: hard limit 200 lines, target 50–100.** Applies to `src/` and `engine/crates/*/src/`. `browser-test/` has a ~600-line ceiling.
- **No allocation on the audio thread.** Every buffer is preallocated in `new()`. `set_param` builds `CString`s — use byte literals in per-block paths (see `ChainInstance::mod_tick`).
- **`ENGINE_VERSION` must match** between `engine/crates/movy-dsp/src/lib.rs:72` and `src/seq/constants.ts`, and must be bumped **once per deployed build**. Currently `0.62.0`. Bump to `0.63.0` in Task 3; bump again before any *subsequent* device deploy. Two different builds sharing a version makes a stale `.so` look current.
- **A redeployed `dsp.so` does not hot-reload** — `deploy.sh` restarts the stack on md5 change, and the restart must run as root.
- **Comments explain WHY**, never WHAT. Match the density of the surrounding file.
- **No code duplication.** Refactor into a shared location before proceeding.
- **Prove a new test has teeth**: remove the fix, watch it fail, put it back.
- Local test gate, in order: `npm run build:browser`, then `npm test` (builds + runs all eight suites), plus `(cd engine && cargo test)` when `engine/` changed.
- Commit after every task. Never `git add -A`.

---

## File Structure

**Created:**
- `engine/crates/movy-dsp/src/send_bus.rs` — the two buses: accumulation, gating decision, process+mix. Pure decision logic separated from the FFI call so it is host-testable.
- `src/mixer/db-ladder.ts` — the dB ladder shared by the volume gesture and the MIX page.
- `src/mixer/mix-cells.ts` — the MIX page's eight knob cells (pure, `buildLfoVM` is the template).
- `src/mixer/mix-model.ts` — the `Model`-conforming object backing the MIX page.
- `src/mixer/mix-io.ts` — reading/writing the five-field mix triple through a `TrackPort`.
- `src/track/send-port.ts` — `TrackPort` writing engine-root `snd<n>:` keys.
- `browser-test/logic/mixer.mjs` — logic suite for the ladder, cells, model, persistence.

**Modified:**
- `engine/crates/movy-dsp/src/mixer.rs` — `TrackMix.send`, `send_gains`, `mix_into_gains`.
- `engine/crates/movy-dsp/src/chain_slots.rs` — owns `SendBuses`, accumulates in the mix loop, processes after it, dispatches send loads, mix-lane map.
- `engine/crates/movy-dsp/src/lib.rs` — `parse_mix` five fields, `snd<n>:` key namespace, `ch<N>:mixlane`, `drain_out` lane routing, `ENGINE_VERSION`.
- `src/chain/config.ts` — MIX slot, SEND slots, explicit `LFO_CHAIN_INDEX`, `isSendComponent`, `moduleReadKey`.
- `src/mixer/track-volume.ts` — ladder extracted out.
- `src/track/registry.ts` — `componentPort` send branch.
- `src/track/chain-persist.ts` — MIX slot excluded from persistable components; send chains persisted.
- `src/app/track-models.ts`, `src/app/init.ts` — build the new models.
- `src/midi/router.ts` — `setMapping` branch for mix params.
- `src/seq/automation.ts` — lane restore widened to 16 tracks.
- `browser-test/logic.mjs`, `browser-test/screenshot.mjs`, `browser-test/perf.mjs`.
- `MANUAL.md`, `README.md`, `CHANGELOG.md`.

---

## Task 1: `TrackMix` carries two send levels

Spec §5, §6. Pure data + math change, no wiring.

**Files:**
- Modify: `engine/crates/movy-dsp/src/mixer.rs`
- Modify: `engine/crates/movy-dsp/src/lib.rs:60-69` (`parse_mix`)
- Modify: `engine/crates/movy-dsp/src/chain_slots.rs:642` (`mix_csv`)

**Interfaces:**
- Produces: `TrackMix { gain: f32, pan: f32, muted: bool, send: [f32; 2] }`; `TrackMix::channel_gains() -> (f32, f32)` (unchanged signature); `TrackMix::send_gains(&self, n: usize) -> (f32, f32)`; `mixer::mix_into_gains(out: &mut [i16], src: &[i16], gl: f32, gr: f32)`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `engine/crates/movy-dsp/src/mixer.rs`:

```rust
#[test]
fn send_is_post_fader_and_post_pan() {
    // The whole point of the tap point: a track faded to half and panned hard
    // right sends a half-level, hard-right signal — not the raw synth output.
    let mix = TrackMix { gain: 0.5, pan: 1.0, send: [1.0, 0.0], ..TrackMix::default() };
    assert_eq!(mix.send_gains(0), (0.0, 0.5));
    assert_eq!(mix.send_gains(1), (0.0, 0.0));
}

#[test]
fn a_muted_track_sends_nothing() {
    // Muting a track must take its reverb with it, as it does in Live.
    let mix = TrackMix { muted: true, send: [1.0, 1.0], ..TrackMix::default() };
    assert_eq!(mix.send_gains(0), (0.0, 0.0));
}

#[test]
fn send_level_scales_the_tap() {
    let mix = TrackMix { send: [0.25, 1.0], ..TrackMix::default() };
    assert_eq!(mix.send_gains(0), (0.25, 0.25));
    assert_eq!(mix.send_gains(1), (1.0, 1.0));
}

#[test]
fn a_bad_send_level_is_silence_not_noise() {
    // Same rule gain already has: a NaN must never reach the bus.
    for bad in [-1.0f32, f32::NAN, f32::INFINITY] {
        let mix = TrackMix { send: [bad, 0.0], ..TrackMix::default() };
        assert_eq!(mix.send_gains(0), (0.0, 0.0), "send {:?} must not corrupt the bus", bad);
    }
}

#[test]
fn an_out_of_range_bus_index_sends_nothing() {
    let mix = TrackMix { send: [1.0, 1.0], ..TrackMix::default() };
    assert_eq!(mix.send_gains(2), (0.0, 0.0));
}

#[test]
fn defaults_send_nothing() {
    assert_eq!(TrackMix::default().send, [0.0, 0.0]);
}
```

Add to the `tests` module in `engine/crates/movy-dsp/src/lib.rs` (create one if absent, `#[cfg(test)] mod tests { use super::*; ... }`):

```rust
#[test]
fn a_legacy_three_field_mix_parses_with_no_sends() {
    // Sets saved before sends existed must restore, silently, at zero.
    let m = parse_mix("0.5,-0.25,0").expect("three fields is still valid");
    assert_eq!(m.gain, 0.5);
    assert_eq!(m.pan, -0.25);
    assert!(!m.muted);
    assert_eq!(m.send, [0.0, 0.0]);
}

#[test]
fn a_five_field_mix_carries_the_sends() {
    let m = parse_mix("1.0,0.0,0,0.25,0.75").expect("five fields is valid");
    assert_eq!(m.send, [0.25, 0.75]);
}

#[test]
fn a_four_field_mix_is_refused_whole() {
    // Half a send pair is not a mix this build can honour; refusing beats
    // applying a level nothing wrote.
    assert!(parse_mix("1.0,0.0,0,0.25").is_none());
    assert!(parse_mix("1.0,0.0,0,0.25,0.5,0.5").is_none());
}
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `cd engine && cargo test -p movy-dsp`
Expected: FAIL — `no field 'send' on TrackMix`, `no method 'send_gains'`.

- [ ] **Step 3: Implement**

In `mixer.rs`, extend the struct and factor the gain application so the main mix and the send tap share one code path:

```rust
pub struct TrackMix {
    pub gain: f32,
    pub pan: f32,
    pub muted: bool,
    /// Post-fader, post-pan tap into each send bus. 0.0 = off.
    pub send: [f32; 2],
}

impl Default for TrackMix {
    fn default() -> Self {
        Self { gain: 1.0, pan: 0.0, muted: false, send: [0.0, 0.0] }
    }
}

impl TrackMix {
    fn channel_gains(&self) -> (f32, f32) { /* unchanged */ }

    /// The track's contribution to send bus `n`. Post-fader and post-pan: the
    /// send follows the fader and the pan position, so pulling a track down
    /// takes its reverb with it (Live's default, and what "left of MFX" in the
    /// signal path implies).
    pub fn send_gains(&self, n: usize) -> (f32, f32) {
        let Some(&s) = self.send.get(n) else { return (0.0, 0.0) };
        let s = if s.is_finite() { s.max(0.0) } else { 0.0 };
        if s == 0.0 {
            return (0.0, 0.0);
        }
        let (gl, gr) = self.channel_gains();
        (gl * s, gr * s)
    }
}

/// Mix `src` into `out` at explicit per-channel gains. The shared core of the
/// main mix and every send tap — one saturation rule, one rounding rule.
pub fn mix_into_gains(out: &mut [i16], src: &[i16], gl: f32, gr: f32) {
    if gl == 0.0 && gr == 0.0 {
        return; // silent: nothing to add, and no rounding noise either
    }
    let n = out.len().min(src.len()) / 2 * 2;
    for i in (0..n).step_by(2) {
        let l = out[i] as i32 + (src[i] as f32 * gl) as i32;
        let r = out[i + 1] as i32 + (src[i + 1] as f32 * gr) as i32;
        out[i] = saturate(l);
        out[i + 1] = saturate(r);
    }
}

pub fn mix_into(out: &mut [i16], src: &[i16], mix: &TrackMix) {
    let (gl, gr) = mix.channel_gains();
    mix_into_gains(out, src, gl, gr);
}
```

In `lib.rs`, make `parse_mix` accept three or five fields:

```rust
/// `gain,pan,muted` or `gain,pan,muted,send1,send2`. Three fields is the
/// legacy form every set saved before sends existed carries, and it must keep
/// restoring — at zero sends, not at whatever the previous track left behind.
fn parse_mix(val: &str) -> Option<crate::mixer::TrackMix> {
    let mut it = val.split(',');
    let gain: f32 = it.next()?.trim().parse().ok()?;
    let pan: f32 = it.next()?.trim().parse().ok()?;
    let muted = it.next()?.trim() != "0";
    let mut send = [0.0f32; 2];
    match (it.next(), it.next(), it.next()) {
        (None, _, _) => {}
        (Some(a), Some(b), None) => {
            send[0] = a.trim().parse().ok()?;
            send[1] = b.trim().parse().ok()?;
        }
        // A lone fourth field is half a pair: refuse the value whole rather
        // than apply a level nothing wrote.
        _ => return None,
    }
    if !gain.is_finite() || !pan.is_finite() || !send.iter().all(|s| s.is_finite()) {
        return None;
    }
    Some(crate::mixer::TrackMix { gain, pan, muted, send })
}
```

In `chain_slots.rs`, `mix_csv` emits five fields so a save round-trips:

```rust
pub fn mix_csv(&self, slot: usize) -> Option<String> {
    let m = self.mixes.get(slot)?;
    Some(format!("{:.4},{:.4},{},{:.4},{:.4}",
                 m.gain, m.pan, m.muted as u8, m.send[0], m.send[1]))
}
```

- [ ] **Step 4: Fix the existing round-trip test and run everything**

`chain_slots.rs:1058` asserts `"1.0000,0.0000,0"`. Update it to `"1.0000,0.0000,0,0.0000,0.0000"` and add one line proving sends round-trip:

```rust
slots.set_mix(4, TrackMix { gain: 0.3162, pan: -0.5, muted: true, send: [0.25, 0.0] });
assert_eq!(slots.mix_csv(4).as_deref(), Some("0.3162,-0.5000,1,0.2500,0.0000"));
```

Run: `cd engine && cargo test`
Expected: PASS, all suites.

- [ ] **Step 5: Commit**

```bash
git add engine/crates/movy-dsp/src/mixer.rs engine/crates/movy-dsp/src/lib.rs engine/crates/movy-dsp/src/chain_slots.rs
git commit -m "$(cat <<'EOF'
feat(engine): TrackMix carries two post-fader send levels

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `send_bus.rs` — the buses, host-testable

Spec §5. Pure decision logic + buffers. No `ChainSlots` wiring yet, no FFI in the tested paths.

**Files:**
- Create: `engine/crates/movy-dsp/src/send_bus.rs`
- Modify: `engine/crates/movy-dsp/src/lib.rs` (add `mod send_bus;`)

**Interfaces:**
- Consumes: `mixer::{mix_into_gains, TrackMix}` (Task 1); `chain_idle::SILENCE_LEVEL`.
- Produces:
  - `pub const SEND_BUSES: usize = 2;`
  - `pub fn should_process(dirty: bool, last_peak: i32, continuous: bool) -> bool`
  - `pub struct SendBuses` with `new() -> Self`, `accumulate(&mut self, src: &[i16], mix: &TrackMix)`, `take_plan(&mut self, frames: usize) -> [bool; SEND_BUSES]`, `buf_mut(&mut self, n: usize) -> &mut [i16]`, `finish(&mut self, n: usize, out: &mut [i16], frames: usize)`, `set_continuous(&mut self, n: usize, on: bool)`, `any_dirty(&self) -> bool`.

The split exists so the FFI call (`process_fx`) stays in `chain_slots.rs` where the instances live, while every rule about *whether* to make it is decided here and tested on the host — the same shape `chain_idle.rs` already uses.

- [ ] **Step 1: Write the failing tests**

Create `engine/crates/movy-dsp/src/send_bus.rs` containing only the test module for now:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::mixer::TrackMix;

    fn sending(level: f32) -> TrackMix {
        TrackMix { send: [level, 0.0], ..TrackMix::default() }
    }

    #[test]
    fn accumulating_sums_every_track_into_one_bus() {
        let mut b = SendBuses::new();
        b.accumulate(&[1000, 1000], &sending(1.0));
        b.accumulate(&[500, 500], &sending(1.0));
        assert_eq!(&b.buf_mut(0)[..2], &[1500, 1500], "a bus is a sum, not a replace");
    }

    #[test]
    fn a_zero_send_never_touches_the_bus() {
        // Zero cost when unused, rule 2 of three (design §5).
        let mut b = SendBuses::new();
        b.accumulate(&[30000, 30000], &sending(0.0));
        assert!(!b.any_dirty(), "a track at zero send must not dirty the bus");
        assert_eq!(&b.buf_mut(0)[..2], &[0, 0]);
    }

    #[test]
    fn the_bus_saturates_like_the_main_mix() {
        let mut b = SendBuses::new();
        for _ in 0..4 {
            b.accumulate(&[30000, -30000], &sending(1.0));
        }
        assert_eq!(&b.buf_mut(0)[..2], &[i16::MAX, i16::MIN], "clipped, not wrapped");
    }

    #[test]
    fn an_untouched_bus_is_not_processed_and_not_cleared() {
        // Zero cost when unused, rules 1 and 3.
        let mut b = SendBuses::new();
        assert_eq!(b.take_plan(128), [false, false]);
    }

    #[test]
    fn a_ringing_bus_keeps_processing_after_its_input_stops() {
        // The tail rule. Without it a reverb is cut off the block the last note
        // ends, which is the single most audible way to get this wrong.
        assert!(should_process(false, 5000, false));
    }

    #[test]
    fn a_silent_bus_with_a_silent_tail_stops() {
        assert!(!should_process(false, 0, false));
        assert!(!should_process(false, crate::chain_idle::SILENCE_LEVEL, false));
    }

    #[test]
    fn a_continuous_fx_never_stops() {
        // Loopers and modulated delays declare requires_continuous_processing:
        // their state stops advancing if a block is skipped.
        assert!(should_process(false, 0, true));
    }

    #[test]
    fn fresh_input_always_processes() {
        assert!(should_process(true, 0, false));
    }

    #[test]
    fn finishing_mixes_at_unity_and_zeroes_the_bus() {
        let mut b = SendBuses::new();
        b.accumulate(&[1000, 1000], &sending(1.0));
        b.take_plan(2);
        let mut out = vec![100i16, 100];
        b.finish(0, &mut out, 2);
        assert_eq!(out, vec![1100, 1100], "returns sum into the output at unity");
        assert_eq!(&b.buf_mut(0)[..2], &[0, 0], "the bus does not carry into the next block");
        assert!(!b.any_dirty());
    }

    #[test]
    fn finishing_remembers_the_output_peak_for_the_tail_rule() {
        let mut b = SendBuses::new();
        b.accumulate(&[9000, -9000], &sending(1.0));
        b.take_plan(2);
        let mut out = vec![0i16; 2];
        b.finish(0, &mut out, 2);
        // Input has stopped, but the last output was loud: still processing.
        assert_eq!(b.take_plan(2), [true, false]);
    }
}
```

- [ ] **Step 2: Run and verify failure**

Run: `cd engine && cargo test -p movy-dsp send_bus`
Expected: FAIL — `cannot find type SendBuses`.

- [ ] **Step 3: Implement**

Prepend to `send_bus.rs`:

```rust
//! The two send buses movy sums its tracks into.
//!
//! A send bus is `chain_process_fx` (`chain_host.c:2176`) run over a buffer
//! every track has already contributed to — so it cannot be planned onto a
//! render lane: it depends on every chain having rendered, and runs after the
//! join, serially on the audio thread (design §5).
//!
//! **Zero cost when no send is in use is a design commitment, not a property
//! that falls out.** Three early-outs, one test each: a bus with no instance is
//! never processed, a track at zero send never touches a buffer, and a bus
//! nothing wrote is never cleared. Get them wrong and an unused feature costs
//! two memsets and sixteen chains of multiply-adds per block, forever.
//!
//! Free of chain, host and FFI types, exactly as `chain_idle` is: every rule
//! here is decided by counting peaks and flags, so the audio-thread code that
//! obeys it stays a straight read of this file.

use crate::chain_idle::SILENCE_LEVEL;
use crate::mixer::{mix_into_gains, TrackMix};

pub const SEND_BUSES: usize = 2;

/// 128 frames stereo — schwung's block size, same as a chain's scratch.
const BUS_SAMPLES: usize = 128 * 2;

/// Whether a bus owes its FX a call this block.
///
/// `dirty` — a track fed it. `last_peak` — what it output last block, which is
/// how a reverb tail keeps ringing after its input stops. `continuous` — the FX
/// declared `requires_continuous_processing`, so skipping a block corrupts its
/// state rather than merely silencing it.
pub fn should_process(dirty: bool, last_peak: i32, continuous: bool) -> bool {
    dirty || continuous || last_peak > SILENCE_LEVEL
}

struct Bus {
    buf: Vec<i16>,
    /// Something was accumulated into `buf` this block.
    dirty: bool,
    /// Output peak of the last block this bus processed.
    last_peak: i32,
    continuous: bool,
    /// This block's decision, taken once in `take_plan` so accumulate-time and
    /// process-time cannot disagree.
    process: bool,
}

pub struct SendBuses {
    buses: Vec<Bus>,
}

impl SendBuses {
    pub fn new() -> Self {
        Self {
            buses: (0..SEND_BUSES)
                .map(|_| Bus {
                    buf: vec![0i16; BUS_SAMPLES],
                    dirty: false,
                    last_peak: 0,
                    continuous: false,
                    process: false,
                })
                .collect(),
        }
    }

    /// Tap one chain's rendered block into every bus it feeds.
    pub fn accumulate(&mut self, src: &[i16], mix: &TrackMix) {
        for (n, bus) in self.buses.iter_mut().enumerate() {
            let (gl, gr) = mix.send_gains(n);
            if gl == 0.0 && gr == 0.0 {
                continue; // zero send: the bus is not even touched
            }
            let len = bus.buf.len().min(src.len());
            mix_into_gains(&mut bus.buf[..len], &src[..len], gl, gr);
            bus.dirty = true;
        }
    }

    /// Decide, once, which buses run this block. `frames` is accepted so the
    /// caller's block length is the only source of truth for length.
    pub fn take_plan(&mut self, frames: usize) -> [bool; SEND_BUSES] {
        let _ = frames;
        let mut plan = [false; SEND_BUSES];
        for (n, bus) in self.buses.iter_mut().enumerate() {
            bus.process = should_process(bus.dirty, bus.last_peak, bus.continuous);
            plan[n] = bus.process;
        }
        plan
    }

    /// The buffer the FX pass writes over.
    pub fn buf_mut(&mut self, n: usize) -> &mut [i16] {
        &mut self.buses[n].buf
    }

    /// Sum a processed bus into the output at unity, remember its peak for the
    /// tail rule, and zero it. Never called for a bus `take_plan` said no to,
    /// which is what keeps an unused bus free of a memset.
    pub fn finish(&mut self, n: usize, out: &mut [i16], frames: usize) {
        let bus = &mut self.buses[n];
        let len = bus.buf.len().min(frames);
        bus.last_peak = bus.buf[..len].iter().fold(0i32, |m, &s| m.max((s as i32).abs()));
        mix_into_gains(&mut out[..len.min(out.len())], &bus.buf[..len], 1.0, 1.0);
        bus.buf[..len].fill(0);
        bus.dirty = false;
        bus.process = false;
    }

    /// Cached from the FX chain, so the audio thread never asks across FFI in
    /// the skip path.
    pub fn set_continuous(&mut self, n: usize, on: bool) {
        if let Some(b) = self.buses.get_mut(n) {
            b.continuous = on;
        }
    }

    pub fn any_dirty(&self) -> bool {
        self.buses.iter().any(|b| b.dirty)
    }

    /// Drop what a bus holds without processing it — for the block a send
    /// module is unloaded, where the buffer would otherwise keep a stale tail.
    pub fn discard(&mut self, n: usize) {
        let bus = &mut self.buses[n];
        if bus.dirty {
            bus.buf.fill(0);
            bus.dirty = false;
        }
        bus.last_peak = 0;
    }
}

impl Default for SendBuses {
    fn default() -> Self {
        Self::new()
    }
}
```

Register the module in `lib.rs` beside the other `mod` declarations:

```rust
mod send_bus;
```

- [ ] **Step 4: Run and verify pass**

Run: `cd engine && cargo test -p movy-dsp send_bus`
Expected: PASS, 10 tests.

- [ ] **Step 5: Prove the teeth**

Temporarily change `should_process` to `dirty || continuous` (dropping the tail rule) and re-run: `a_ringing_bus_keeps_processing_after_its_input_stops` and `finishing_remembers_the_output_peak_for_the_tail_rule` must FAIL. Restore.

- [ ] **Step 6: Commit**

```bash
git add engine/crates/movy-dsp/src/send_bus.rs engine/crates/movy-dsp/src/lib.rs
git commit -m "$(cat <<'EOF'
feat(engine): send bus accumulation and tail-aware process gating

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wire the buses into the render path and the `snd<n>:` namespace

Spec §5, §6. This is the task that makes sends audible.

**Files:**
- Modify: `engine/crates/movy-dsp/src/chain_slots.rs` (`ChainSlots` field, `render`, `service_loads`, new send accessors)
- Modify: `engine/crates/movy-dsp/src/lib.rs` (`snd<n>:` keys, `ENGINE_VERSION` → `0.63.0`)
- Modify: `src/seq/constants.ts` (`ENGINE_VERSION` → `0.63.0`)

**Interfaces:**
- Consumes: `SendBuses` (Task 2), `TrackMix::send_gains` (Task 1).
- Produces on `ChainSlots`: `pub fn request_send_load(&mut self, bus: usize, module: &str)`, `pub fn set_send_state(&mut self, bus: usize, state: &str)`, `pub fn send_param(&mut self, bus: usize, key: &str, val: &str)`, `pub fn send_get_param(&mut self, bus: usize, key: &str) -> Option<String>`, `pub fn send_module(&mut self, bus: usize) -> Option<String>`.
- Engine keys: `snd<n>:module`, `snd<n>:state`, and `snd<n>:<anything else>` forwarded to the instance.

- [ ] **Step 1: Write the failing test**

In `chain_slots.rs` tests. `ChainSlots::new()` has no host in a unit test, so the assertion is about *routing and buffers*, not about a real FX:

```rust
/// A send bus with no module must not silently swallow the tracks that feed
/// it — and must not carry their audio into the next block either.
#[test]
fn a_send_with_no_module_discards_its_bus() {
    let mut slots = ChainSlots::new();
    slots.set_mix(4, TrackMix { send: [1.0, 0.0], ..TrackMix::default() });
    let mut out = vec![0i16; 4];
    slots.render(&mut out);
    assert_eq!(out, vec![0i16; 4], "no host, no chains: nothing is mixed");
    assert!(!slots.sends_dirty(), "the bus is cleared even with nothing loaded");
}

#[test]
fn send_keys_are_addressed_by_bus_not_by_chain() {
    // `snd0:` must never be parsed as a chain key — `ch<N>` IS track N, and a
    // send is not a track.
    let mut slots = ChainSlots::new();
    slots.request_send_load(0, "reverb");
    assert_eq!(slots.pending_loads(), 1, "a send load rides the shared queue");
}
```

Add the small accessor the first test needs (`pub fn sends_dirty(&self) -> bool { self.sends.any_dirty() }`).

- [ ] **Step 2: Run and verify failure**

Run: `cd engine && cargo test -p movy-dsp chain_slots`
Expected: FAIL — `no method sends_dirty`, `no method request_send_load`.

- [ ] **Step 3: Implement — the struct field and the load path**

In `ChainSlots`:

```rust
    /// The two send buses. NOT entries in `slots`: `ch<N>` IS track N, and 61
    /// sites in this crate rely on `slots` holding exactly `MOVY_CHAINS`
    /// tracks. Keeping the buses in their own field makes every one of those
    /// loops correct by construction (design §4).
    sends: SendBuses,
    /// Send FX instances, indexed by bus.
    send_slots: Vec<Option<ChainInstance>>,
```

Initialise in `new()`: `sends: SendBuses::new(), send_slots: (0..SEND_BUSES).map(|_| None).collect(),`.

Loads ride the shared `LoadQueue` under synthetic slot numbers, so the
one-load-per-audio-callback bound covers them unchanged:

```rust
/// Queue slot for send bus `n`. Above every chain, so it cannot collide with a
/// track — the queue is slot-generic and does not care, but a reader does.
fn send_queue_slot(bus: usize) -> usize { MOVY_CHAINS + bus }

pub fn request_send_load(&mut self, bus: usize, module: &str) {
    if bus >= SEND_BUSES { return; }
    /* The chain host's own component name. A send holds one audio FX, so the
     * bus number lives in the engine key and the component underneath is
     * always `fx1` — the UI never has to know that. */
    self.queue.push(LoadRequest {
        slot: send_queue_slot(bus),
        component: "fx1".to_string(),
        module: module.to_string(),
        state: None,
    });
}
```

In `service_loads`, dispatch before the chain path (read the existing body first and mirror its instance-creation and logging):

```rust
    if req.slot >= MOVY_CHAINS {
        let bus = req.slot - MOVY_CHAINS;
        self.service_send_load(bus, &req);
        return;
    }
```

`service_send_load` creates the instance on first use (`host.create_instance(&self.module_dir)`), sets `external_fx_mode(true)` so `render_block` is never owed anything, writes `fx1:module`, applies any attached state, refreshes `self.sends.set_continuous(bus, inst.fx_requires_continuous())`, calls `self.sends.discard(bus)` (an outgoing FX's tail must not ring on into its replacement), bumps `self.generation`, and logs one line: `host::log(&format!("send {}: {}", bus, req.module))`.

- [ ] **Step 4: Implement — the render path**

In `render()`, inside the existing per-chain mix loop, immediately after
`mix_into(&mut out[..frames], scratch, &self.mixes[i]);`:

```rust
            // Post-fader, post-pan: the same block, at the same gains, tapped
            // into whichever buses this track feeds. Costs two float compares
            // per bus for a track that sends nothing.
            self.sends.accumulate(scratch, &self.mixes[i]);
```

After the `idle.observe` loop and before `cost.end_block()`:

```rust
        // After every chain has rendered and mixed: a bus is a sum of tracks,
        // so it cannot exist until they are all in. Serial on the audio thread
        // by construction — there is no join left to hide behind.
        let t_send = self.cost.start();
        let plan = self.sends.take_plan(frames);
        let mut send_ran = false;
        for n in 0..SEND_BUSES {
            if !plan[n] {
                continue;
            }
            let Some(inst) = self.send_slots[n].as_mut() else {
                // The bus was fed but has nowhere to go. Drop it rather than
                // let it ring into the block after a module is removed.
                self.sends.discard(n);
                continue;
            };
            inst.process_fx(&mut self.sends.buf_mut(n)[..frames]);
            self.sends.finish(n, &mut out[..frames], frames);
            send_ran = true;
        }
```

The CPU meter needs one `add_wall` call per block — it tracks a per-call maximum, so two calls would report two smaller peaks instead of one block. Restructure the existing bracket to add the send time into the same call:

```rust
        // was: if active > 0 { self.cost.add_wall(t0.elapsed().as_nanos() as u64); }
        let render_ns = t0.elapsed().as_nanos() as u64;   // taken where add_wall used to be
        // ... mix loop, send phase ...
        let send_ns = if send_ran { t_send.elapsed().as_nanos() as u64 } else { 0 };
        if active > 0 || send_ran {
            self.cost.add_wall(render_ns + send_ns);
        }
        if active > 0 || send_ran {
            self.cost.end_block();
        }
```

- [ ] **Step 5: Implement — the engine keys**

In `lib.rs` `set_param`, **before** the `_ if key.starts_with("ch")` arm (`snd0:` would not match `ch`, but keep the send arm adjacent and explicit):

```rust
            /* `snd<n>:<rest>` addresses send bus n. A send is not a track and
             * never gets a `ch<N>` key: `ch<N>` IS track N. The component
             * underneath is always the instance's `fx1`, so the UI addresses a
             * bus and never a component. */
            _ if key.starts_with("snd") => {
                if let Some((bus, rest)) = parse_send_key(key) {
                    match rest {
                        "module" => self.chains.request_send_load(bus, val),
                        "state" => self.chains.set_send_state(bus, val),
                        _ => self.chains.send_param(bus, rest, val),
                    }
                }
            }
```

`get_param` gains the mirror, with `"module"` reading back through the chain
host's underscore alias:

```rust
            _ if key.starts_with("snd") => {
                let (bus, rest) = parse_send_key(key)?;
                if rest == "module" {
                    return self.chains.send_get_param(bus, "fx1_module");
                }
                self.chains.send_get_param(bus, rest)
            }
```

`parse_send_key("snd0:module") -> Some((0, "module"))`, mirroring
`parse_chain_key`. Add a unit test for it alongside the existing chain-key
tests, including `parse_send_key("snd9:module") == None` for an out-of-range
bus.

- [ ] **Step 6: Bump ENGINE_VERSION in both files**

`engine/crates/movy-dsp/src/lib.rs:72` and `src/seq/constants.ts` → `0.63.0`. `build-dsp.sh` fails the build if they disagree.

- [ ] **Step 7: Run everything**

Run: `cd engine && cargo test && cd .. && npm run build:browser && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add engine/crates/movy-dsp/src/chain_slots.rs engine/crates/movy-dsp/src/lib.rs src/seq/constants.ts
git commit -m "$(cat <<'EOF'
feat(engine): render two send FX buses after the chain mix

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Automation lanes can target a mix param

Spec §7 (engine half).

**Files:**
- Modify: `engine/crates/movy-dsp/src/chain_slots.rs` (the per-chain lane→field map)
- Modify: `engine/crates/movy-dsp/src/lib.rs` (`ch<N>:mixlane` key, `drain_out` routing)

**Interfaces:**
- Consumes: `TrackMix` (Task 1).
- Produces: `ChainSlots::set_mix_lane(&mut self, slot: usize, lane: u8, field: MixField)`, `ChainSlots::clear_mix_lane(&mut self, slot: usize, lane: u8)`, `ChainSlots::apply_mix_lane(&mut self, slot: usize, lane: u8, val: u8) -> bool` (true = consumed as a mix write, false = not a mix lane, send the CC).
- `pub enum MixField { Gain, Pan, Send1, Send2 }` in `mixer.rs`, with `MixField::parse(&str) -> Option<MixField>` accepting `"gain" | "pan" | "send1" | "send2"`.
- Engine key: `ch<N>:mixlane` with value `<lane>,<field>` or `<lane>,-` to clear.

- [ ] **Step 1: Write the failing tests**

In `chain_slots.rs` tests:

```rust
#[test]
fn a_mix_lane_writes_the_mixer_not_the_chain() {
    // The whole point: a mix param is not a chain-host param, so the CC that
    // would carry it has nowhere to land (knob_find_param resolves only
    // chain-internal components).
    let mut slots = ChainSlots::new();
    slots.set_mix_lane(4, 2, MixField::Pan);
    assert!(slots.apply_mix_lane(4, 2, 127), "lane 2 is a mix lane: consumed");
    assert_eq!(slots.mix_csv(4).as_deref(), Some("1.0000,1.0000,0,0.0000,0.0000"));
    assert!(slots.apply_mix_lane(4, 2, 0));
    assert_eq!(slots.mix_csv(4).as_deref(), Some("1.0000,-1.0000,0,0.0000,0.0000"),
               "pan spans -1..+1, so 0 is hard left and 64 is centre");
}

#[test]
fn an_unmapped_lane_is_left_to_the_chain() {
    let mut slots = ChainSlots::new();
    assert!(!slots.apply_mix_lane(4, 0, 64), "no mapping: the CC must still be sent");
}

#[test]
fn a_gain_lane_spans_the_full_fader_range() {
    let mut slots = ChainSlots::new();
    slots.set_mix_lane(4, 0, MixField::Gain);
    slots.apply_mix_lane(4, 0, 127);
    let m = slots.mix_csv(4).unwrap();
    assert!(m.starts_with("4.0000,"), "127 is the top of the 0-4 fader, got {m}");
}

#[test]
fn a_send_lane_spans_zero_to_unity() {
    let mut slots = ChainSlots::new();
    slots.set_mix_lane(4, 1, MixField::Send2);
    slots.apply_mix_lane(4, 1, 127);
    assert_eq!(slots.mix_csv(4).as_deref(), Some("1.0000,0.0000,0,0.0000,1.0000"));
}

#[test]
fn clearing_a_mix_lane_returns_it_to_the_chain() {
    let mut slots = ChainSlots::new();
    slots.set_mix_lane(4, 3, MixField::Gain);
    slots.clear_mix_lane(4, 3);
    assert!(!slots.apply_mix_lane(4, 3, 64));
}
```

- [ ] **Step 2: Run and verify failure**

Run: `cd engine && cargo test -p movy-dsp mix_lane`
Expected: FAIL — `cannot find MixField`.

- [ ] **Step 3: Implement**

In `mixer.rs`:

```rust
/// A mixer field an automation lane can drive. Movy's own, because none of
/// these is a chain-host param — `knob_find_param` resolves only components
/// inside the chain, so the ordinary CC 102+lane path has nowhere to land.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum MixField { Gain, Pan, Send1, Send2 }

impl MixField {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "gain" => Some(Self::Gain),
            "pan" => Some(Self::Pan),
            "send1" => Some(Self::Send1),
            "send2" => Some(Self::Send2),
            _ => None,
        }
    }

    /// Denormalize a 0-127 lane value onto this field's range. The ranges are
    /// the UI's too (`src/mixer/mix-io.ts`) — a lane that scaled differently
    /// from the knob would make an automated value jump on release.
    pub fn denorm(self, v: u8) -> f32 {
        let n = (v.min(127) as f32) / 127.0;
        match self {
            Self::Gain => n * 4.0,
            Self::Pan => n * 2.0 - 1.0,
            Self::Send1 | Self::Send2 => n,
        }
    }

    pub fn apply(self, mix: &mut TrackMix, v: u8) {
        let f = self.denorm(v);
        match self {
            Self::Gain => mix.gain = f,
            Self::Pan => mix.pan = f,
            Self::Send1 => mix.send[0] = f,
            Self::Send2 => mix.send[1] = f,
        }
    }
}
```

In `ChainSlots`, a per-chain array of 8 optional fields (`mix_lanes: Vec<[Option<MixField>; 8]>`, sized `MOVY_CHAINS` in `new()`), plus the three methods. `apply_mix_lane` returns `false` for an unmapped lane or an out-of-range slot so the caller falls through to the CC.

In `lib.rs` `set_param`, inside the `ch<N>:` arm beside `mix`:

```rust
                    } else if rest == "mixlane" {
                        /* "<lane>,<field>" — or "<lane>,-" to release the lane
                         * back to the chain. The UI assigns lanes; the engine
                         * only needs to know which of them stop being CCs. */
                        let mut it = val.split(',');
                        if let (Some(l), Some(f)) = (it.next(), it.next()) {
                            if let Ok(lane) = l.trim().parse::<u8>() {
                                match MixField::parse(f.trim()) {
                                    Some(field) => self.chains.set_mix_lane(slot, lane, field),
                                    None => self.chains.clear_mix_lane(slot, lane),
                                }
                            }
                        }
```

In `drain_out`, the `OutEvent::Cc` arm's `Some(c)` branch consults the map first:

```rust
                OutEvent::Cc { track, lane, val } => {
                    match chain_for(track, self.movy_tracks) {
                        None => {
                            host::midi_send_internal(0xB0 | track, 102 + lane, val);
                        }
                        Some(c) => {
                            /* A mix lane is movy's own mixer, not a param the
                             * chain can be told about — see MixField. */
                            if !self.chains.apply_mix_lane(c, lane, val) {
                                self.chains.on_midi(
                                    c,
                                    &[0xB0, 102 + lane, val],
                                    MOVE_MIDI_SOURCE_INTERNAL,
                                );
                            }
                        }
                    }
                }
```

- [ ] **Step 4: Run and verify pass**

Run: `cd engine && cargo test`
Expected: PASS.

- [ ] **Step 5: Prove the teeth**

Make `apply_mix_lane` always return `false` and re-run: the four mix-lane tests must FAIL. Restore.

- [ ] **Step 6: Commit**

```bash
git add engine/crates/movy-dsp/src/mixer.rs engine/crates/movy-dsp/src/chain_slots.rs engine/crates/movy-dsp/src/lib.rs
git commit -m "$(cat <<'EOF'
feat(engine): automation lanes can drive gain, pan and the two sends

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Extract the dB ladder

Spec §8. Pure refactor, no behaviour change — the safety net for Task 7.

**Files:**
- Create: `src/mixer/db-ladder.ts`
- Modify: `src/mixer/track-volume.ts:60-100`
- Create: `browser-test/logic/mixer.mjs`
- Modify: `browser-test/logic.mjs` (register the new suite in both lists)

**Interfaces:**
- Produces: `VOL_MIN`, `VOL_MAX`, `VOL_STEPS`, `idxToAmp(i: number): number`, `ampToIdx(a: number): number`, `volumeFrac(amp: number): number`, `UNITY_FRAC`.

- [ ] **Step 1: Write the characterization test first**

Create `browser-test/logic/mixer.mjs`. Read `browser-test/logic/harness.mjs` and one existing suite (e.g. `browser-test/logic/tracks-refs.mjs`) for the import shape and `ok(label, cond)` usage first — and note that `ok` once IGNORED its condition, so make one assertion fail deliberately before trusting the file.

```js
import { ok, section } from './harness.mjs';
import { ampToIdx, idxToAmp, volumeFrac, VOL_MAX, VOL_STEPS } from '../../dist/esm/mixer/db-ladder.js';

export function run() {
    section('mixer: dB ladder');

    // One detent is one dB anywhere in the range. A fixed LINEAR step made the
    // quiet half of the fader five detents wide, reported from the field as
    // "adjustable to about -8.5 dB, then it cuts off".
    const unity = ampToIdx(1);
    ok('unity is an exact ladder position', idxToAmp(unity) === 1);
    ok('one detent below unity is ~1 dB down',
       Math.abs(20 * Math.log10(idxToAmp(unity - 1)) + 1) < 0.001);
    ok('index 0 is true silence', idxToAmp(0) === 0);
    ok('the top of the ladder is +12 dB', idxToAmp(VOL_STEPS) === VOL_MAX);
    ok('the ladder round-trips', ampToIdx(idxToAmp(30)) === 30);
    ok('unity sits inside the travel', volumeFrac(1) > 0 && volumeFrac(1) < 1);
}
```

Register it in `browser-test/logic.mjs` — one import line and one entry in each of the runner's two lists.

- [ ] **Step 2: Run and verify failure**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — cannot resolve `dist/esm/mixer/db-ladder.js`.

- [ ] **Step 3: Move the ladder**

Create `src/mixer/db-ladder.ts` holding `VOL_MIN`, `VOL_MAX`, `DB_MIN`, `DB_STEP`, `DB_MAX`, `VOL_STEPS`, `idxToAmp`, `ampToIdx`, `idxToFrac`, `volumeFrac`, `UNITY_FRAC` — moved verbatim from `track-volume.ts:60-100`, including the field-report comment, which is the reason the ladder exists and must travel with it. Export `idxToAmp`/`ampToIdx`/`VOL_STEPS` (previously private).

In `track-volume.ts`, delete the moved block and import from the new module. `volumeFrac` is already exported from `track-volume.ts` and consumed elsewhere — keep re-exporting it there so no call site changes in this task.

Check `build/browser.mjs`: a new module directory may need an entry (this has bitten `dist/esm` before — see the CPU meter work).

- [ ] **Step 4: Run and verify pass**

Run: `npm run build:browser && npm test`
Expected: PASS, all eight suites, including the untouched volume-gesture assertions.

- [ ] **Step 5: Commit**

```bash
git add src/mixer/db-ladder.ts src/mixer/track-volume.ts browser-test/logic/mixer.mjs browser-test/logic.mjs build/browser.mjs
git commit -m "$(cat <<'EOF'
refactor(mixer): extract the dB ladder so the MIX page can share it

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: The MIX slot exists in the chain rotation

Spec §8. Config + the `isLfoSlot`-is-not-"last" correction. No page content yet — the slot renders as a virtual slot with an empty body, which is enough to prove the rotation and the persistence exclusions.

**Files:**
- Modify: `src/chain/config.ts`
- Modify: `src/track/chain-persist.ts:66-70` (`persistableComponents`)
- Modify: `src/app/track-models.ts`
- Modify: `browser-test/logic/mixer.mjs`

**Interfaces:**
- Produces: `MIX_CHAIN_INDEX`, `isMixSlot(chainIndex: number): boolean`, `LFO_CHAIN_INDEX` (now an explicit constant, not `length - 1`).

- [ ] **Step 1: Write the failing tests**

Append to `browser-test/logic/mixer.mjs`:

```js
import { CHAIN_SLOTS, LFO_CHAIN_INDEX, MIX_CHAIN_INDEX, isLfoSlot, isMixSlot, isVirtualSlot }
    from '../../dist/esm/chain/config.js';
import { persistableComponents } from '../../dist/esm/track/chain-persist.js';

section('mixer: the MIX chain slot');

ok('MIX is the last slot', MIX_CHAIN_INDEX === CHAIN_SLOTS.length - 1);
ok('MIX comes after LFO', MIX_CHAIN_INDEX > LFO_CHAIN_INDEX);
// LFO_CHAIN_INDEX used to be `length - 1`. Adding a slot after it silently
// retargeted every isLfoSlot() caller at MIX — including the two that decide
// which slots hold a module.
ok('LFO is still LFO', CHAIN_SLOTS[LFO_CHAIN_INDEX].label === 'LFO');
ok('isLfoSlot does not claim MIX', !isLfoSlot(MIX_CHAIN_INDEX));
ok('MIX holds no module', isVirtualSlot(CHAIN_SLOTS[MIX_CHAIN_INDEX]));
// A virtual slot in the persist list means every save asks the engine for a
// module that cannot exist, and every restore tries to load "".
const comps = persistableComponents();
ok('MIX is not persisted as a component', !comps.includes('mix'));
ok('LFO is not persisted as a component', !comps.some((c) => c === 'lfo'));
ok('the four real components are', comps.length === 4);
```

- [ ] **Step 2: Run and verify failure**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `MIX_CHAIN_INDEX` is undefined.

- [ ] **Step 3: Implement**

In `src/chain/config.ts`:

```ts
export const CHAIN_SLOTS: ChainSlot[] = [
    { componentKey: 'midi_fx1', label: 'MIDI FX', scanDir: 'midi_fx',          expectedType: 'midi_fx'         },
    { componentKey: 'synth',    label: 'SYNTH',   scanDir: 'sound_generators', expectedType: 'sound_generator' },
    { componentKey: 'fx1',      label: 'FX 1',    scanDir: 'audio_fx',         expectedType: 'audio_fx'        },
    { componentKey: 'fx2',      label: 'FX 2',    scanDir: 'audio_fx',         expectedType: 'audio_fx'        },
    { componentKey: 'lfo',      label: 'LFO',     scanDir: '',                 expectedType: ''                },
    { componentKey: 'mix',      label: 'MIX',     scanDir: '',                 expectedType: ''                },
];

/* Both virtual pages are addressed by an EXPLICIT index. `length - 1` was fine
 * while the LFO was last; the moment a page was appended after it, every
 * isLfoSlot() caller silently retargeted at the new page — including
 * persistableComponents() and buildTrackModels(), which decide which slots hold
 * a module at all. */
export const LFO_CHAIN_INDEX = 4;
export const MIX_CHAIN_INDEX = 5;
export function isLfoSlot(chainIndex: number): boolean { return chainIndex === LFO_CHAIN_INDEX; }
export function isMixSlot(chainIndex: number): boolean { return chainIndex === MIX_CHAIN_INDEX; }
```

In `chain-persist.ts`, filter on the slot rather than on the LFO alone:

```ts
/* The chain components worth persisting: every real slot, minus the virtual
 * pages (LFO and MIX hold no module of their own). */
function persistableComponents(): string[] {
    return CHAIN_SLOTS.filter((s) => !isVirtualSlot(s)).map((s) => s.componentKey);
}
```

Export it for the test. In `track-models.ts`, build a placeholder for MIX (replaced in Task 7 — for now reuse the LFO model's inert surface so the page renders empty rather than throwing):

```ts
export function buildTrackModels(track: number): Model[] {
    return CHAIN_SLOTS.map((s, i) => {
        if (isLfoSlot(i)) return createLfoModel(track);
        if (isMixSlot(i)) return createMixModel(track);   // Task 7
        return createModel(portFor(track), s.componentKey);
    }) as Model[];
}
```

For this task, stub `createMixModel` in `src/mixer/mix-model.ts` as `inertModelSurface`-plus-empty-VM; Task 7 fills it in.

- [ ] **Step 4: Run and verify pass**

Run: `npm run build:browser && npm test`
Expected: PASS. `dump-replay.mjs` must be green — the MIX slot is not module-driven, so no baseline changes.

- [ ] **Step 5: Prove the teeth**

Revert `LFO_CHAIN_INDEX` to `CHAIN_SLOTS.length - 1` and re-run: `isLfoSlot does not claim MIX` and both persist assertions must FAIL. Restore.

- [ ] **Step 6: Commit**

```bash
git add src/chain/config.ts src/track/chain-persist.ts src/app/track-models.ts src/mixer/mix-model.ts browser-test/logic/mixer.mjs
git commit -m "$(cat <<'EOF'
feat(ui): add the MIX chain slot and pin the virtual-slot indices

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: The MIX page renders and edits

Spec §8. `src/lfo/cells.ts` + `src/lfo/model.ts` are the literal template — read both before starting.

**Files:**
- Create: `src/mixer/mix-io.ts`
- Create: `src/mixer/mix-cells.ts`
- Modify: `src/mixer/mix-model.ts` (replace the Task 6 stub)
- Modify: `browser-test/logic/mixer.mjs`
- Modify: `browser-test/screenshot.mjs`

**Interfaces:**
- Consumes: `db-ladder` (Task 5), `MIX_CHAIN_INDEX` (Task 6), `paramCell` from `src/seq/param-vm.js`, `inertModelSurface` from `src/lfo/inert.js`, `trackKind` from `src/track/ref.js`, `portFor` from `src/track/registry.js`.
- Produces:
  - `mix-io.ts`: `interface MixVals { gain: number; pan: number; muted: boolean; send: [number, number] }`, `readMix(track: number): MixVals`, `writeMixField(track: number, field: MixFieldName, value: number, before: string | null): void`, `packMixValue(v: MixVals): string`, `type MixFieldName = 'gain' | 'pan' | 'send1' | 'send2'`, `SEND_MAX = 1`, `PAN_MIN = -1`, `PAN_MAX = 1`.
  - `mix-cells.ts`: `buildMixCells(v: MixVals, kind: TrackKind): (ParamVM | null)[]`, `buildMixVM(track: number, st: MixPageState): ViewModel`.
  - `mix-model.ts`: `createMixModel(track: number): Model`.

- [ ] **Step 1: Write the failing tests**

Append to `browser-test/logic/mixer.mjs`:

```js
import { buildMixCells } from '../../dist/esm/mixer/mix-cells.js';

section('mixer: the MIX page');

const movy = buildMixCells({ gain: 1, pan: 0, muted: false, send: [0, 0] }, 'movy');
ok('four cells, four blanks', movy.filter((c) => c !== null).length === 4);
ok('the order is VOL PAN SND1 SND2',
   movy.slice(0, 4).map((c) => c.shortName).join(' ') === 'VOL PAN SND1 SND2');
ok('unity reads 0.0 dB', movy[0].displayValue === '0.0 dB');
ok('centre pan reads C', movy[1].displayValue === 'C');
ok('a send at zero reads OFF', movy[2].displayValue === 'OFF');

const panned = buildMixCells({ gain: 1, pan: -1, muted: false, send: [1, 0.5] }, 'movy');
ok('hard left reads L100', panned[1].displayValue === 'L100');
ok('a full send reads 0.0 dB', panned[2].displayValue === '0.0 dB');

// A schwung-hosted track renders inside the shim: movy never sees its audio,
// and schwung has no slot:pan. Drawing live knobs there would invite a gesture
// that cannot do anything.
const host = buildMixCells({ gain: 1, pan: 0, muted: false, send: [0, 0] }, 'host');
ok('a host track keeps its fader', host[0] !== null && host[0].shortName === 'VOL');
ok('a host track has no pan cell', host[1] === null);
ok('a host track has no send cells', host[2] === null && host[3] === null);

// A muted track's fader must still show its level — mute is the engine's own
// per-track mute, not a fader at zero.
const muted = buildMixCells({ gain: 0.5, pan: 0, muted: true, send: [0, 0] }, 'movy');
ok('mute does not zero the displayed level', muted[0].displayValue !== '-inf');
```

- [ ] **Step 2: Run and verify failure**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — cannot resolve `mix-cells.js`.

- [ ] **Step 3: Implement `mix-io.ts`**

Reads and writes the five-field triple through the track's port, using
`MIX_KEY` from `track/mix-persist.js`. Every write carries the whole value —
the engine parses it as a unit, which is why `track-volume.ts` keeps a
`mixTail`. Writing a single field means read-modify-write of the cached record,
then one `setChainParam(portFor(track), MIX_KEY, packMixValue(next), before)`
so undo records the same shape the edit wrote (recording just the gain made
`parse_mix` reject the inverse, and undo on a movy track silently did nothing).

On a host track, `gain` reads and writes `slot:volume` instead; pan and sends
are not written at all.

Display helpers live here so the cells file stays about layout:

```ts
/** Amplitude as the fader reads it. Index 0 on the ladder is true silence. */
export function formatDb(amp: number): string {
    if (amp <= 0) return '-inf';
    return (20 * Math.log10(amp)).toFixed(1) + ' dB';
}

/** Live's own notation: C, L100, R42. */
export function formatPan(pan: number): string {
    const p = Math.round(Math.abs(pan) * 100);
    if (p === 0) return 'C';
    return (pan < 0 ? 'L' : 'R') + p;
}

export function formatSend(level: number): string {
    return level <= 0 ? 'OFF' : formatDb(level);
}
```

- [ ] **Step 4: Implement `mix-cells.ts`**

Model it on `src/lfo/cells.ts`. Four cells on line 1, four `null` on line 2.
`renderStyle: 'arc'` for all four; `normalizedValue` uses `volumeFrac(gain)` for
VOL (so the drawn travel matches what the knob does), `(pan + 1) / 2` for PAN,
and `volumeFrac(level)`-style ladder position for the sends. On `kind === 'host'`
return `[volCell, null, null, null, null, null, null, null]`.

`buildMixVM` mirrors `buildLfoVM`: `moduleName: 'MIX'`, `bankCount: 1`,
`rows: [cells.slice(0, 4), cells.slice(4, 8)]`, `isEmpty: false`,
`automationHeld`/`automationPoolFull` passed through (unlike the LFO page,
these params ARE automatable, so the held-step dimming must work), no `lfoViz`.

- [ ] **Step 5: Implement `mix-model.ts`**

Model it on `src/lfo/model.ts`: a closure over cached `MixVals`, `touched`,
per-knob fractional accumulators. Spread `inertModelSurface('mix', 'MIX', 'mix')`
for the dozen accessors a page with no module answers the same way — but
**override four of them**, because unlike the LFO page these params are
automatable and lane restore has to be able to validate them:

```ts
        ...inertModelSurface('mix', 'MIX', 'mix'),
        /* The LFO page stubs these out because LFO params are not automatable.
         * Mix params are — so the lane layer must be able to ask this page for
         * a param's identity, its range and its current value, exactly as it
         * asks a module's model (see syncLabelsFromEngine → validateLane). */
        getKnobParamInfo(physK: number): KnobParamInfo | null {
            const f = FIELD_AT[physK];
            if (!f || trackKind(track) === 'host') return null;
            const r = FIELD_RANGE[f];
            return { gi: physK, key: f, ioKey: f, target: 'mix', value: valueOf(f),
                     min: r.min, max: r.max, type: 'float', automatable: true };
        },
        paramRangeByKey(key: string) { return FIELD_RANGE[key] ?? null; },
        getValueByKey(key: string) { ... },
        getComponentKey() { return 'mix'; },
```

`FIELD_AT = ['gain', 'pan', 'send1', 'send2']`; `FIELD_RANGE` uses `{ min: 0, max: 4 }` for gain, `{ min: -1, max: 1 }` for pan, `{ min: 0, max: 1 }` for the sends — **the same numbers `MixField::denorm` uses in Rust** (Task 4). A mismatch makes an automated value jump the moment the knob is released.

`handleKnobDelta(k, delta)` walks the dB ladder for VOL and the sends (one detent = one dB, index 0 = off) and a linear 1/64-per-detent for PAN, then writes through `mix-io`. `getViewModel()` returns `buildMixVM`.

- [ ] **Step 6: Add screenshot scenes**

In `browser-test/screenshot.mjs`, add two scenes following the existing chain-page scenes: `mix-page-movy` (a movy track, non-default values so the arcs are visible) and `mix-page-host` (a host track, showing the single fader). Then:

```bash
node browser-test/screenshot.mjs --update
```

Inspect the two new PNGs in `browser-test/screenshots/baseline/` before committing them — a baseline generated from a broken renderer locks the break in.

- [ ] **Step 7: Run everything**

Run: `npm run build:browser && npm test`
Expected: PASS, all eight suites.

- [ ] **Step 8: Commit**

```bash
git add src/mixer/mix-io.ts src/mixer/mix-cells.ts src/mixer/mix-model.ts browser-test/logic/mixer.mjs browser-test/screenshot.mjs browser-test/screenshots/baseline/mix-page-*.png
git commit -m "$(cat <<'EOF'
feat(ui): MIX page with volume, pan and the two send levels

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Lane restore covers all 16 tracks

Spec §7, the pre-existing bug. Independent of the rest — a reviewer could accept this and reject everything else — so it is its own task and its own commit.

**Files:**
- Modify: `src/seq/automation.ts:311` (`verifyLaneMappings`), `:427` (`syncLabelsFromEngine`)
- Modify: `browser-test/logic/` — the existing automation suite (find it with `grep -rln syncLabelsFromEngine browser-test/logic/`)

**Interfaces:** no signature changes.

- [ ] **Step 1: Write the failing test**

In the automation logic suite:

```js
section('automation: lane restore reaches every track');

// The engine emits labels for all 16 tracks (engine.rs:2322), but the UI read
// only the first four — a leftover from when movy had four. Lanes on tracks
// 5-16 were therefore never rebuilt after a Set load, and never re-applied
// after a module reload: automation that plays back in one session and is
// silently gone in the next.
const labels = Array.from({ length: 16 },
    (_, t) => ['synth:cutoff', ...Array(7).fill('-')].join('.')).join(',');
const applied = [];
syncLabelsFromEngine(labels, (slot, lane, tp) => applied.push(slot),
                     () => ({ min: 0, max: 1, type: 'float' }));
ok('every track is restored', applied.length === 16);
ok('track 15 is restored', applied.includes(15));

// verifyLaneMappings round-robins one track per call; 16 calls must visit all 16.
const seen = new Set();
for (let i = 0; i < 16; i++) verifyLaneMappings((slot) => { seen.add(slot); return null; }, () => {});
ok('the round-robin visits all 16 tracks', seen.size === 16);
```

- [ ] **Step 2: Run and verify failure**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `applied.length === 4`, `seen.size === 4`.

- [ ] **Step 3: Implement**

```ts
// was: for (let t = 0; t < 4 && t < tracks.length; t++)
for (let t = 0; t < TRACK_COUNT && t < tracks.length; t++)
```

```ts
// was: verifyTrack = (verifyTrack + 1) & 3;
verifyTrack = (verifyTrack + 1) % TRACK_COUNT;
```

`TRACK_COUNT` is already imported at the top of the file. The round-robin's
cadence is unchanged — one track per call — so a 16-track sweep takes four
times as long and costs no extra IPC per call: `verifyLaneMappings` returns
before any read when a track has no assigned lane.

- [ ] **Step 4: Run and verify pass**

Run: `npm run build:browser && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/seq/automation.ts browser-test/logic/
git commit -m "$(cat <<'EOF'
fix(automation): restore and verify lanes on all 16 tracks, not the first 4

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Mix params route to a mix lane

Spec §7 (UI half). Joins Task 4's engine seam to Task 7's page.

**Files:**
- Modify: `src/midi/router.ts:467-469` (the `setMapping` callback)
- Modify: `src/seq/automation.ts` (`validateLane` must accept a `mix:` target)
- Modify: `browser-test/logic/mixer.mjs`

**Interfaces:**
- Consumes: `getKnobParamInfo` returning `target: 'mix'` (Task 7); engine key `ch<N>:mixlane` (Task 4).

- [ ] **Step 1: Write the failing test**

```js
section('mixer: automating a mix param');

// A mix param is not a chain-host param, so the ordinary knob_<N>_set mapping
// has nowhere to land — the lane has to be declared to movy's own mixer
// instead. Assert the WRITE, not that a function was called: a mapping issued
// to the wrong key is exactly the failure this catches.
const writes = [];
const info = { target: 'mix', ioKey: 'send1', min: 0, max: 1, value: 0,
               type: 'float', automatable: true, gi: 2, key: 'send1' };
mappingFor(7, info, (key, val) => writes.push([key, val]))(3);
ok('a mix param declares a mix lane', writes[0][0] === 'mixlane');
ok('the lane and field travel together', writes[0][1] === '3,send1');

const chainWrites = [];
const cutoff = { ...info, target: 'synth', ioKey: 'cutoff' };
mappingFor(7, cutoff, (key, val) => chainWrites.push([key, val]))(3);
ok('a module param still uses the chain mapping', chainWrites[0][0] === 'knob_4_set');
ok('and still names target:param', chainWrites[0][1] === 'synth:cutoff');
```

This requires the callback to be extractable. Factor the inline arrow at
`router.ts:467` into an exported `mappingFor(track, info, write)` in
`src/seq/lane-mapping.ts` (new, ~25 lines) — the router keeps one call site and
the logic becomes testable, which the inline arrow never was.

- [ ] **Step 2: Run and verify failure**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — cannot resolve `lane-mapping.js`.

- [ ] **Step 3: Implement**

```ts
/* Which mapping a lane needs, decided by what the param IS.
 *
 * A module param is mapped inside the chain (`knob_<N>_set`), and the engine's
 * CC 102+lane lands on it. A mix param has no chain-host param to land on —
 * `knob_find_param` resolves only components inside the chain — so the lane is
 * declared to movy's own mixer instead and the engine writes the field
 * directly (see MixField in engine/crates/movy-dsp/src/mixer.rs). */
export function mappingFor(
    track: number, info: KnobParamInfo,
    write: (key: string, val: string) => boolean,
): (lane: number) => boolean {
    if (info.target === 'mix') {
        return (lane) => write('mixlane', lane + ',' + info.ioKey);
    }
    return (lane) => write('knob_' + (lane + 1) + '_set', info.target + ':' + info.ioKey);
}
```

Router: `handleAutomationKnob(track, k, info, delta, mappingFor(track, info, (key, val) => portFor(track).setParam(key, val)))`.

`clearLane` must release the engine-side mapping too, or a cleared lane keeps
eating CCs: in `automation.ts`, when the cleared entry's `targetParam` starts
with `mix:`, also `portFor(track).setParam('mixlane', lane + ',-')`.

`validateLane` must not `drop` a `mix:` lane on restore — it looks the key up in
the module's params and would purge it. Add the branch: a `mix:` target
validates against `FIELD_RANGE` from `mix-io.ts`.

- [ ] **Step 4: Run and verify pass**

Run: `npm run build:browser && npm test`
Expected: PASS.

- [ ] **Step 5: Prove the teeth**

Delete the `info.target === 'mix'` branch and re-run: the first two assertions must FAIL. Restore.

- [ ] **Step 6: Commit**

```bash
git add src/seq/lane-mapping.ts src/midi/router.ts src/seq/automation.ts browser-test/logic/mixer.mjs
git commit -m "$(cat <<'EOF'
feat(ui): automation lanes for the four mix params

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: The two SEND slots on the master page

Spec §9.

**Files:**
- Create: `src/track/send-port.ts`
- Modify: `src/chain/config.ts` (`MASTER_FX_SLOTS`, `isSendComponent`, `moduleReadKey`)
- Modify: `src/track/registry.ts:55-57` (`componentPort`)
- Modify: `src/app/init.ts:62-64` (master models)
- Modify: `browser-test/logic/mixer.mjs`, `browser-test/screenshot.mjs`

**Interfaces:**
- Produces: `class SendPort implements TrackPort` (constructor takes the bus index 0|1); `isSendComponent(componentKey: string): boolean`; `sendBusOf(componentKey: string): number` returning -1 for a non-send.
- Component keys: `snd0`, `snd1`.

- [ ] **Step 1: Write the failing tests**

```js
section('mixer: master send slots');

ok('master reads SEND SEND MFX MFX MFX MFX LFO',
   MASTER_FX_SLOTS.map((s) => s.label).join(' ') === 'SEND 1 SEND 2 MFX 1 MFX 2 MFX 3 MFX 4 LFO');
ok('the sends are left of MFX', MASTER_FX_SLOTS[0].componentKey === 'snd0');
ok('MASTER_LFO_INDEX still points at the LFO',
   MASTER_FX_SLOTS[MASTER_LFO_INDEX].label === 'LFO');
// A send is movy's own, not schwung's master bus: routing it to a shadow slot
// would write master_fx keys for a chain schwung does not host.
ok('a send is not a master component', !isMasterComponent('snd0'));
ok('a send is a send', isSendComponent('snd0') && sendBusOf('snd1') === 1);
// The chain host exposes a loaded module under an underscore alias; the send's
// bus prefix has to survive that translation.
ok('a send reads back through the bus key', moduleReadKey('snd0') === 'snd0:module');
ok('a track component still uses the underscore alias', moduleReadKey('fx1') === 'fx1_module');
ok('a master component still uses the colon key',
   moduleReadKey('master_fx:fx1') === 'master_fx:fx1:module');
```

- [ ] **Step 2: Run and verify failure**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `isSendComponent` is not exported.

- [ ] **Step 3: Implement**

`config.ts`:

```ts
export const MASTER_FX_SLOTS: ChainSlot[] = [
    /* Movy's own send buses, and deliberately first: they are left of the
     * master FX on the page because they are left of them in the signal path —
     * a send's output joins movy's stereo out, which schwung's master FX then
     * process (design §9). */
    { componentKey: 'snd0', label: 'SEND 1', scanDir: 'audio_fx', expectedType: 'audio_fx' },
    { componentKey: 'snd1', label: 'SEND 2', scanDir: 'audio_fx', expectedType: 'audio_fx' },
    { componentKey: 'master_fx:fx1', label: 'MFX 1', scanDir: 'audio_fx', expectedType: 'audio_fx' },
    // ... fx2-fx4 unchanged ...
    { componentKey: 'master_fx:lfo', label: 'LFO', scanDir: '', expectedType: '' },
];

/* A send bus is hosted by MOVY, not by schwung's master bus. It rides the
 * master page because that is where a user looks for it, but its params go to
 * movy's engine and its port must not be a shadow slot. */
export function isSendComponent(componentKey: string): boolean {
    return /^snd[01]$/.test(componentKey);
}
export function sendBusOf(componentKey: string): number {
    return isSendComponent(componentKey) ? Number(componentKey.slice(3)) : -1;
}
```

`moduleReadKey` gains the send branch **first**, since `snd0` contains no colon
and would otherwise take the underscore path and ask for `snd0_module`:

```ts
export function moduleReadKey(componentKey: string): string {
    if (isSendComponent(componentKey)) return componentKey + ':module';
    return componentKey.includes(':') ? componentKey + ':module' : componentKey + '_module';
}
```

`send-port.ts` is `MovyChainPort` with a different prefix — read that file and
mirror it, including the bulk-channel batching and the blocking-write rule.
`key(k)` returns `'snd' + bus + ':' + k`. `sendMidi` is a no-op with a comment:
a send bus has no synth and no notes.

`registry.ts`:

```ts
export function componentPort(index: number, componentKey: string): TrackPort {
    if (isSendComponent(componentKey)) return sendPort(sendBusOf(componentKey));
    return isMasterComponent(componentKey) ? hostPort(0) : portFor(index);
}
```

with a memoised `sendPort(bus)` beside the existing `hostPorts` cache, cleared
by `resetPorts()`.

`init.ts` builds the two extra models:

```ts
    appState.masterFxModels = MASTER_FX_SLOTS.map((s, i) => {
        if (isMasterLfoSlot(i)) return createScopedLfoModel(masterScope());
        return createModel(componentPort(0, s.componentKey), s.componentKey);
    });
```

Note this replaces the hard-coded `hostPort(0)` — read the comment there and
extend it rather than deleting it: it explains why a master component must not
take `portFor(0)`, which is still true.

The browser needs no change: `openBrowser`/`loadSelectedModule` already go
through `componentPort` and `moduleReadKey`. Verify the `isMaster` path in
`loadSelectedModule` — it keys on `componentKey.includes(':')` to decide
path-vs-id, and `snd0` has no colon, so a send correctly loads **by id**, like a
track chain slot. Add an assertion for that rather than relying on it.

- [ ] **Step 4: Add a screenshot scene**

`master-send-slot`: the master page focused on SEND 1 with a module loaded, so
the seven-dot bank bar is captured. `node browser-test/screenshot.mjs --update`, inspect, commit.

- [ ] **Step 5: Run everything**

Run: `npm run build:browser && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/track/send-port.ts src/chain/config.ts src/track/registry.ts src/app/init.ts browser-test/logic/mixer.mjs browser-test/screenshot.mjs browser-test/screenshots/baseline/master-send-slot.png
git commit -m "$(cat <<'EOF'
feat(ui): two movy-hosted SEND FX slots on the master page

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Send chains and send levels survive a Set reopen

Spec §6.

**Files:**
- Modify: `src/track/chain-persist.ts`
- Modify: `src/track/chain-payload.ts`
- Modify: `browser-test/logic/mixer.mjs`

**Interfaces:**
- Consumes: the chain-set document codec (slot-generic), `packMix` (`src/track/mix-persist.ts`).
- Produces: `ChainSetState.sends?: { b: number; m: string; s?: string }[]` in the saved blob.

- [ ] **Step 1: Write the failing tests**

```js
section('mixer: persistence');

// The five-field form. An untouched track must still write nothing, or every
// set file grows sixteen default triples.
ok('a default mix is not saved', packMix('1.0000,0.0000,0,0.0000,0.0000') === undefined);
ok('a send alone is worth saving',
   packMix('1.0000,0.0000,0,0.5000,0.0000') === '1.0000,0.0000,0,0.5000,0.0000');
// Legacy: a set written before sends existed.
ok('a legacy triple still round-trips', mixPair('0.5000,0.0000,0') !== null);
ok('a five-field value is accepted', mixPair('0.5000,0.0000,0,0.2500,0.0000') !== null);
ok('a four-field value is refused whole', mixPair('0.5000,0.0000,0,0.25') === null);

// The send chains themselves.
const doc = buildChainSetDoc({ sends: [{ b: 0, m: 'reverb' }] });
ok('a send rides the set document', doc.includes('reverb'));
ok('it is addressed above every chain', doc.includes('16'));
```

- [ ] **Step 2: Run and verify failure**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL on the four-field and send-document assertions.

- [ ] **Step 3: Implement**

`mix-persist.ts`: `parseMix` accepts 3 or 5 fields (mirroring the Rust rule
exactly — refuse 4), and `packMix` treats `gain 1, pan 0, unmuted, sends 0` as
the default that writes nothing.

`chain-persist.ts`: capture the two send buses alongside the tracks. They are
not tracks, so they get their own `sends` array in the saved state rather than a
`t: 16` entry — a reader that assumed `t` was a track index would otherwise
address a track that does not exist. On the wire they still travel as chain-set
slots `MOVY_CHAINS + b`, because the codec is slot-generic and the engine's
`request_send_load` already expects that numbering.

Preset blobs ride the same deferred bulk write `chain-payload.ts` already does
per track — read that file's header for why it is deferred (the document is
what starts the loads that make the bulk channel unwritable) and add the sends
to the same wait.

- [ ] **Step 4: Run and verify pass**

Run: `npm run build:browser && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/track/mix-persist.ts src/track/chain-persist.ts src/track/chain-payload.ts browser-test/logic/mixer.mjs
git commit -m "$(cat <<'EOF'
feat(persist): save send chains and the five-field mix

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Prove the unused path is free

Spec §3, §5. The claim made to the user: with no send modules and every send at zero, nothing measurable changes.

**Files:**
- Modify: `browser-test/perf.mjs`
- Modify: `engine/crates/movy-dsp/src/chain_slots.rs` (test only)

**Interfaces:** none.

- [ ] **Step 1: Write the failing test**

In `chain_slots.rs`:

```rust
/// The zero-cost claim, as an assertion rather than a promise: a block with no
/// send module and no track sending must not touch a bus buffer at all.
#[test]
fn an_unused_send_path_never_touches_a_buffer() {
    let mut slots = ChainSlots::new();
    let mut out = vec![0i16; 256];
    for _ in 0..8 {
        slots.render(&mut out);
    }
    assert!(!slots.sends_dirty(), "no track sends: no bus is dirtied");
    assert_eq!(slots.send_process_count(), 0, "no instance: no FX pass, ever");
}
```

Add the `send_process_count()` counter (`#[cfg(test)]`-gated or a plain counter
— a `u32` incremented in the send loop costs nothing and is also useful in the
device log).

In `browser-test/perf.mjs`, add the MIX page to the page-cost ranking and assert
its `fill_rect` count and IPC count against a recorded budget, the way the
existing pages are asserted.

- [ ] **Step 2: Run and verify failure**

Run: `cd engine && cargo test -p movy-dsp an_unused_send`
Expected: FAIL — `no method send_process_count`.

- [ ] **Step 3: Implement the counter, run**

Run: `cd engine && cargo test && cd .. && npm test`
Expected: PASS.

- [ ] **Step 4: Prove the teeth**

Remove the `if gl == 0.0 && gr == 0.0 { continue; }` early-out in
`SendBuses::accumulate` and re-run: `an_unused_send_path_never_touches_a_buffer`
must FAIL. Restore.

- [ ] **Step 5: Commit**

```bash
git add engine/crates/movy-dsp/src/chain_slots.rs browser-test/perf.mjs
git commit -m "$(cat <<'EOF'
test: pin the zero-cost claim for the unused send path

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Docs and device verification

Spec §10. Nothing here is optional: a new page and two new slots are exactly the "significant, user-facing change" the docs rule names.

**Files:**
- Modify: `MANUAL.md`, `README.md`, `CHANGELOG.md`
- Create: `docs/assets/mix-page-movy.png`, `docs/assets/master-send-slot.png`

- [ ] **Step 1: Generate the doc screenshots from the test baselines**

```bash
node scripts/make-doc-assets.mjs mix-page-movy master-send-slot
```

- [ ] **Step 2: Write the docs**

`MANUAL.md`: a section for the MIX page (how to reach it — jog to the end of the
chain rotation; what each knob does; that all four automate like any other
param) and one for the master SEND slots. State the host-track limit plainly:
on a schwung-hosted track the MIX page is a fader only, and `chtracks` is what
changes that. Add rows to the Controls reference tables in section 8.

`README.md`: one bullet in *Features* with the MIX page screenshot.

`CHANGELOG.md`: an entry naming the feature, the `chtracks` limit, and the
`syncLabelsFromEngine` fix.

- [ ] **Step 3: Bump ENGINE_VERSION for the deploy**

`0.63.0` → `0.64.0` in both `engine/crates/movy-dsp/src/lib.rs` and
`src/seq/constants.ts`, if any engine change has landed since Task 3's bump.

- [ ] **Step 4: Full local gate**

```bash
npm run build:browser && npm test && (cd engine && cargo test)
```
Expected: 0 failures.

- [ ] **Step 5: Device**

```bash
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && ./scripts/deploy.sh && ./scripts/test-all-device-movy.sh && ./scripts/test-cpu.sh \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```

Device suites are FLAKY. Run each relevant suite ONCE. If one fails, check
whether the output points at a send/mix regression; otherwise report it and move
on. Do not bisect. **If the device is unreachable, report DEVICE OFFLINE to the
user in CAPS.**

Manual device check the automated suites cannot make (no host build can load a
chain): load a reverb into SEND 1, raise SND1 on two tracks, confirm both are
audible in the return and that muting a track takes its send with it.

- [ ] **Step 6: Commit and push**

```bash
git add MANUAL.md README.md CHANGELOG.md docs/assets/mix-page-movy.png docs/assets/master-send-slot.png engine/crates/movy-dsp/src/lib.rs src/seq/constants.ts
git commit -m "$(cat <<'EOF'
docs: MIX page and master send FX slots

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
git push
```

---

## Self-review notes

- **Spec coverage.** §1–2 context; §3 CPU → Task 12; §4 structure → Task 2; §5 render → Tasks 1–3; §6 params/persistence → Tasks 1, 3, 11; §7 automation → Tasks 4, 8, 9; §8 MIX page → Tasks 5, 6, 7; §9 master sends → Task 10; §10 testing → distributed, plus 12 and 13; §11 out of scope → nothing built.
- **Type consistency.** `MixField` (Rust) ↔ `MixFieldName` (TS) share the wire strings `gain|pan|send1|send2`. `FIELD_RANGE` (Task 7) and `MixField::denorm` (Task 4) must carry the same three ranges — called out in both tasks.
- **Ordering.** Tasks 1→2→3 are strictly sequential. Task 4 needs 1. Tasks 5→6→7 are sequential and need nothing from the engine. Task 8 is fully independent. Task 9 needs 4 and 7. Task 10 needs nothing but 6. Task 11 needs 10. Tasks 12–13 last.
