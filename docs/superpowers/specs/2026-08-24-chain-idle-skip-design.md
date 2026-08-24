# Skipping silent chains — design

Movy chains cost CPU whenever they are *loaded*. Twelve idle `helm` chains cost
~2340 µs against a ~2000 µs frame budget, with nothing playing
(`docs/chain-idle-cpu-optimization.md`). schwung's shim has skipped silent host
slots for years; this brings the same treatment to movy's twelve, on the same
chain module, with the same constants.

The optimization was documented and left unbuilt because of the wake-up problem:
once movy stops calling `render_block`, the chain cannot wake itself. The shim
already solved that — a staggered probe frame plus `mod:tick` — and this design
takes its answer rather than inventing one.

## 1. What the shim does, and what movy takes from it

The shim runs **two independent gates** per slot
(`schwung_shim.c:1852-2045`):

- **synth idle** — output silent for 344 blocks → skip `render_block`. FX still
  runs, on a buffer of **zeros**, so reverb and delay tails keep decaying.
- **FX idle** — the FX *output* has also been silent for 344 blocks → skip
  `chain_process_fx` too. Only reachable once the synth is already asleep.

Both are enabled by three symbols the chain module exports
(`src/modules/chain/dsp/chain_host.c`):

| symbol | behaviour |
| --- | --- |
| `chain_set_external_fx_mode(inst, 1)` | `render_block` returns straight after the synth (`chain_host.c:1960`), skipping inject and FX |
| `chain_process_fx(inst, buf, frames)` | runs the FX chain in place, honouring per-slot bypass |
| `chain_fx_requires_continuous(inst)` | 1 if any FX slot declared `capabilities.requires_continuous_processing` |

The shim uses the same split for a second purpose movy cannot copy — deferring
FX past the SPI ioctl, worth ~435 µs avg / 3 ms max of pre-ioctl budget. Movy is
called from inside one `render_block` and cannot defer past the ioctl. **Only the
idle half is in scope here.**

`mod:tick` (`chain_host.c:709`) already exists for exactly this: it advances
`lfo_tick` without rendering audio. It was added because a skipped `render_block`
ran a slot's LFOs ~172× too slow and resumed them from a stale phase at note-on.

## 2. Why the FX gate is not optional

An earlier draft gated on chain output alone, measured post-FX, on the reasoning
that tails are then covered for free. That is true for tails and wrong for the
case that costs the most:

**Any FX that never settles below ±4 pins the expensive synth awake forever.** A
delay with high feedback, a long reverb, an FX with a noise floor or a DC
offset — with a single post-FX gate that chain never sleeps, and `helm`'s 195 µs
idle is paid indefinitely. Splitting synth from FX makes the synth's sleep
independent of what the FX is doing.

## 3. Policy

Shim constants, cited to `schwung_shim.c:643-645`, with one deliberate
divergence:

| | value | source |
| --- | --- | --- |
| sleep after | 344 silent blocks (~1.0 s) | `DSP_IDLE_THRESHOLD` |
| silence | `abs(sample) <= 4` | `DSP_SILENCE_LEVEL` |
| probe every | 172 blocks (~0.5 s) | shim |
| stagger | `chain * 14` | **not the shim's 43** |

The shim's `s * 43` is `172 / 4`, which spreads four slots evenly. With twelve
chains `43 * 4 = 172 ≡ 0`, so chains 0/4/8 would probe on the same block and
stack three renders into one — the ~1 ms spike the stagger exists to prevent.
`172 / 12 → 14` keeps all twelve distinct.

## 4. Architecture

New `engine/crates/movy-dsp/src/chain_idle.rs`: a pure state machine holding no
chain or host types, unit-testable on the host without a device.

```rust
pub struct IdleGate {
    silence:    Vec<u32>,  // consecutive silent synth blocks, while awake
    slept:      Vec<u32>,  // blocks since the synth fell asleep
    asleep:     Vec<bool>,
    fx_silence: Vec<u32>,
    fx_asleep:  Vec<bool>,
    level:      IdleLevel, // the `chidle` ordinal
}
```

Per chain per block it answers two questions — render the synth? run the FX? —
and consumes two peaks afterwards. `chain_slots.rs` gets the wiring only.

### The render path

External FX mode is set **once at load**, not per block.

| synth | fx | work |
| --- | --- | --- |
| awake | awake | `render_block` → `process_fx` → mix |
| **asleep** | awake | **zero scratch** → `mod_tick` → `process_fx` → mix |
| asleep | asleep | nothing rendered, nothing mixed |

A sleeping synth must hand `process_fx` a buffer of zeros for the tail to decay
into. Missing that memset leaves the FX chewing the previous block's samples
forever — a stuck buzz, not silence. It is the sharpest teeth test in the suite.

**Only the synth gate probes.** On a probe block the synth renders; if it is
still silent the chain stays deep-asleep and the FX stays skipped, exactly as the
shim orders it. The FX gate needs no probe of its own: an FX with no input cannot
start speaking on its own, and the ones that can — loopers, modulated delays —
opt out entirely through `requires_continuous`.

Synth silence is measured on the scratch *before* `process_fx`; FX silence
*after*. `peaks[i]` stays post-FX, so the benchmark "sounding" guard keeps its
current meaning.

### `mod_tick` must not allocate

`ChainInstance::set_param` does `CString::new(key)` **and** `CString::new(val)` —
two heap allocations. Calling it per block per sleeping chain on the audio thread
is the allocator-contention hazard §9 of
`plans/2026-08-21-parallel-chain-render-schwung-review.md` names. A new
`ChainInstance::mod_tick()` uses `c"mod:tick"` / `c"128"` literals and allocates
nothing. The 128-frame block size is already fixed by `SCRATCH_SAMPLES`.

### Symbol resolution

The three symbols resolve from the chain module's existing `dlopen` handle at
load, each an `Option`. A chain module without them degrades to today's single
`render_block` call and the FX gate is unavailable — the same shape as the
existing `self.api.render_block`.

### The render pool

`Task` gains a second function pointer:

```rust
Task { render: Option<RenderFn>, process_fx: Option<FxFn>, inst, buf, frames, chain }
```

`render: None` means "synth asleep — memset instead". All of a chain's work still
happens on one lane in one round, so the pool's safety argument — one lane
exclusively owns one instance for the round — is unchanged. A chain with both
gates asleep is not in the plan at all, so a task always has something to do.

## 5. Interactions

- **Planner.** `maybe_replan` feeds `loaded[i] = s.is_some()`; a deep-asleep chain
  becomes `false` so lanes rebalance around what is actually playing. A sleep or
  wake transition invalidates `plan_generation`; the 344-block hysteresis bounds
  how often that fires. Without it, three playing chains can all land on lane 0
  and run serially — a regression against today.
- **Digest oracle.** `digest_stimulus` strikes notes straight into instances,
  bypassing `ChainSlots::on_midi`, so the gate would never see them. `digest_arm`
  calls `wake_all()`, and both gates report "render" unconditionally while
  `digest.running()`.
- **Cost meter.** Untouched. A sleeping chain contributes no samples, so its
  `plan_ns` holds its last measured cost — exactly what the planner needs when it
  wakes.
- **`active_last_block`** stays truthful (chains that actually rendered);
  `asleep=N` joins `diag`. Any device assertion reading `active == loaded` needs
  updating.
- **Wake sites:** `on_midi`, `set_param`, load completion, state restore,
  `set_mix`. `teardown` calls `forget`.

## 6. The flag is an ordinal

The FX gate depends on the synth gate, and an ordinal says so in the type rather
than in a rule. `chidle` joins `chparallel`/`chlanes`/`chpin` on the flags page.

```
chidle 0   today's path exactly — one render_block call      (control arm)
chidle 1   split path, nothing ever sleeps                   (equivalence arm)
chidle 2   split + synth gate
chidle 3   split + synth gate + FX gate                      (default)
```

Value 1 isolates the split's own cost and is what `chdigest` runs against to
prove split == single call, bit-identical, **before any gate is trusted**. Bit
identity is expected because external mode skips synth → *inject* → FX, and
`inject_audio` is Link Audio: shim-only, never used by movy chains. Expecting it
is not proving it, which is what the oracle is for.

`applyFlagsToEngine` already re-pushes every flag on each engine boot, so a
re-dlopened engine needs no special handling.

## 7. Tests

Cheapest level that reproduces each failure, per `CLAUDE.md`.

**cargo, `chain_idle.rs`**
- sleeps on exactly the 344th silent block, not the 343rd
- wakes on the block MIDI arrives
- probe fires 1 block in 172
- no two of twelve chains probe on the same block — **this is the test that fails
  with the shim's `43`**
- `peak == 4` is silence, `5` is not
- the FX gate cannot sleep while the synth is awake
- each `chidle` level enables exactly the gates it names

**cargo, `chain_slots.rs`**
- a deep-asleep chain contributes nothing to the mix
- a synth-asleep-FX-awake chain renders its tail from **zeros** (teeth: remove the
  memset → stale-buffer buzz → fails)
- an FX declaring `requires_continuous` never sleeps
- `renders_nothing_when_empty` still holds

**Device** — the claims no unit test can reach:
- `chdigest` at `chidle 1` proves the split is bit-identical to `chidle 0`
- a tempo-synced LFO drone still speaks after sleeping (proves `mod_tick`)
- a long release tail is not clipped
- a looper keeps advancing through silence (the bug the shim's comment records)
- `scripts/bench-all-tracks.sh` idle columns collapse toward baseline, with
  `chidle 0` as the control arm

## 8. Accepted risks

- **Blast radius.** `chidle >= 1` changes how every movy chain renders, including
  chains that never sleep. Mitigated by `chidle 0` being a byte-for-byte fallback
  and the equivalence arm sitting between it and any gating.
- A synth with a DC offset above ±4 never sleeps. No false sleep, just no saving;
  not worth detecting.
- A self-starting drone speaks up to ~0.5 s late. This is already the behaviour
  of tracks 1-4, so it is a consistency argument as much as a tolerance.
