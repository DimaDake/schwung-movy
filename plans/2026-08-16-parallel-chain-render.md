# Rendering movy's chains in parallel

**Date:** 2026-08-16
**Status:** proposal, not started.
**Evidence:** `docs/track-performance.md` §1 (the budget) and §7 (the frame, and
what standalone would buy).

---

## 1. Why this and not standalone

The question that started this was whether movy should run standalone like
`dronage-tool`, since Move's transport is stopped anyway. Measured, that is worth
**~15%** — MoveOriginal costs the audio frame 239 µs of 2902, and its other 56%
of a core is off-thread. §7 has the accounting.

Parallelism is worth multiples of that, and does not require leaving Move.

`chain_slots.rs:221` renders all twelve chains one after another, on Move's audio
thread, into a single reused scratch buffer:

```rust
for i in 0..MOVY_CHAINS {
    let Some(inst) = self.slots[i].as_mut() else { continue };
    inst.render_block(scratch);          // <- serial, one thread
    ...
    mix_into(&mut out[..frames], scratch, &self.mixes[i]);
}
```

Meanwhile three of the four A72s are ~idle, and MoveOriginal — the thing we were
considering deleting — renders its own audio on **three worker threads**.

The wall clock does not move: the work ceiling is 2432 µs per frame no matter how
many threads run inside it. What changes is how much work fits in it.

## 2. What it could be worth

Today ~2000 µs of that ceiling is available to movy, essentially all of it
serial. With W workers the chain budget becomes roughly

```
W × 2000 µs − join overhead − contention penalty
```

The contention penalty is measured, not guessed (§7): one extra busy core costs
the audio thread ~12% of its own work, two cost ~24%, and it saturates there. But
that penalty applies to a slice that is now 1/W the size, so it does not eat the
gain — it trims it.

Expected: **2-2.5× the chain budget with 3 workers.** Against §2's stress table
that is the difference between "dexed and plaits only" and obxd at 4 notes
(3112 µs) or helm at 1 note (4105 µs) across all twelve chains.

## 3. Design

Rendering twelve chains is embarrassingly parallel: each `render_block` touches
one instance and one scratch buffer, and the sum happens afterwards.

- **Per-worker scratch.** `self.scratch` is one buffer reused across chains
  today; it becomes one per worker (or one per chain — 12 × 128 frames × 2ch ×
  i16 is 6 KB, which is nothing).
- **Static partition, not a work queue.** Chains are assigned to workers at load
  time, rebalanced only when a chain is loaded or cleared. A lock-free queue
  would add per-block synchronisation for no benefit at N=12.
- **Two barriers per block.** The audio thread signals "render", waits, then does
  the mixing itself — `mix_into` is 12 × 128 saturating adds, cheap and
  order-dependent for nothing.
- **Spin-then-futex, never a mutex.** At a 2902 µs period with ~600 µs of work
  per worker, a sleeping wake-up costs more than the spin.
- **Workers inherit the audio thread's RT priority** (`Audio Main/SPI` runs at
  RT −71). A worker at normal priority preempted mid-block stalls the whole
  frame; this is the single most likely way to make things *worse*.
- **Fall back to serial** when the partition is trivially small (≤ 2 loaded
  chains) or a worker fails to start. The serial path stays the reference
  implementation and the test oracle.

## 4. The risk that could kill it

**Module globals.** All twelve movy chains share **one** private `dsp.so` copy
(`chain_copy.rs`, which exists precisely because `move_plugin_init_v2` clobbers a
`g_host` shared across instances). Per-instance state is fine; per-*library*
state is not, and today it is safe only because the render is serial.

This must be established before any of §3 is written:

1. Audit the chain host's own globals — `g_host` and anything reached through it.
2. Per module, check for library-scope mutable state (shared wavetables are fine
   if read-only; a shared scratch buffer or a global RNG is not).
3. Decide the fallback: either a **private `dsp.so` copy per worker** (more
   memory, more dlopen time, restores isolation) or a per-library lock (which
   serialises exactly the modules that need it, and only those).

A module that cannot be rendered concurrently is not a blocker — it is a chain
that gets pinned to the audio thread's own partition.

## 5. Measuring it

The existing harness answers this directly, and the before/after is comparable to
the tables already in `docs/track-performance.md`:

```bash
scripts/measure-work-ceiling.sh    # does the ceiling move?
scripts/stress-16-tracks.sh        # per-synth, all 12 chains, with `sounding`
scripts/measure-core-contention.sh # what the workers cost the audio thread
scripts/measure-pad-latency.sh     # a join must not lengthen the pad path
```

Two things must be true, not one: the work ceiling rises **and** `sounding`
still reports 12/12. A parallel render that drops chains would otherwise look
like a large speed-up.

Guard rails to add alongside:

- A `seq-core` test that the parallel and serial paths produce **bit-identical**
  output for the same input (the mix is integer, so this is exact — no epsilon).
- A perf assertion that the join adds no per-tick IPC and no allocation in the
  audio callback.

## 6. Order of work

1. **Audit §4 first.** If module globals force a copy per worker, the memory and
   load-time cost changes the calculation before any code is written.
2. Per-worker scratch + static partition, still called serially — no threads
   yet, and the bit-identical test starts passing here.
3. Spawn the workers, RT priority, spin-then-futex barriers.
4. Measure with §5. Keep the serial path selectable at runtime so the comparison
   is one param, not one build.
