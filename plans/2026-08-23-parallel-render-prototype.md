# Parallel chain render: the prototype runs

Sequel to `2026-08-22-module-isolation.md`, which closed the last open
*correctness* question before any code could be written. This is the first
increment that actually renders movy's chains on more than one thread.

**Result: 2.23× on twelve real chains on the device, reproduced three times.
Serial spends 84% of the audio frame; parallel spends 38%. Serial's worst block
was 2874 µs against a 2902 µs frame — 1% from overrunning — and parallel's worst
was 1350 µs.**

| | serial | parallel | |
| --- | ---: | ---: | ---: |
| wall mean | 2437.3 µs | 1091.3 µs | **2.23×** |
| wall max | 2873.8 µs | 1349.5 µs | 2.13× |
| of the 2902 µs frame | 84.0% | 37.6% | |

Measured by `scripts/measure-parallel-render.sh` on one running set flipped
between the two modes, so the chains are identical in both arms. Off by default:
`chparallel 1` opts in.

---

## 1. The chain host is thread-safe. That was not known.

The review's §2 read as the sharpest blocker: `chain_get_clock_status` does
`fopen` + `malloc` behind a **non-atomic** 1-second gate, on the render path, in
the `dsp.so` copy that all twelve movy chains share. If that were reachable from
every chain's render, parallel render would need twelve chain-host copies before
it could run at all.

It is not. Auditing the chain module as one unit — it is ten files, so single-file
resolution would have missed it:

```
chain host: 4 file-scope mutable statics, 37 functions reachable from v2_render_block
0 reachable functions touch shared state
```

All four statics are `g_clock_*` in `chain_midi.c`, and **none is statically
reachable from `v2_render_block`**. They are reached only through the
`get_clock_status` pointer the chain host installs into each sub-plugin's vtable
(`chain_host.c:83`) — so only if a *module* asks. Everything `v2_render_block`
itself touches hangs off `inst`, which is per-chain.

So §2 narrows from "movy's race to hit on every chain" to an enumerable list.
Across the 93 checked-out fleet repos, **12 modules actually call
`get_clock_status`**: branchages, beatbank, euclidrum, genera, groovebank,
eucalypso, superarp, 9W9, breakbeat, midi-player, aphex, magneto. Together with
the 6 that mutate their own statics, that is the whole set the lane pinning below
has to keep apart — and pinning keeps *every* duplicate apart, so it covers both
lists without needing either to be complete.

## 2. What was built

Three pieces, ~500 lines, all behind `chparallel`.

**`render_pool.rs` — the threads.** Two persistent helpers beside the audio
thread. Rendezvous is a generation counter published with release/acquire plus
`park`/`unpark`; the audio thread publishes tasks, renders its own lane, then
spins briefly and yields until `pending` hits zero. Nothing allocates: task lists
are preallocated to twelve and only ever cleared and refilled.

Helpers run at **SCHED_FIFO 68 on cores 0-2** — below Move's own FIFO 70 workers
so a helper can never preempt the audio callback, and off core 3, which
`REALTIME_SAFETY.md` reserves for the SPI thread. Both `sched_setaffinity` and
`sched_setscheduler` returned 0 on device; the degraded path logs and keeps
going.

Each helper sets **FPCR bit 24 (flush-to-zero)** on entry, which was review §3.
FPCR is per-thread, so a helper starts with FZ *off* and would grind through
gradual underflow on exactly the decaying reverb and filter tails this exists to
make affordable — and would produce different samples from the serial path, which
is what makes the equivalence oracle in §5 below meaningful at all.

**`render_plan.rs` — the assignment.** Longest-processing-time-first over module
*groups*, driven by a 1/16 exponential mean of each chain's measured cost.
Same-module chains are pinned to one lane, so two instances of one module never
render at the same time and cannot race on the shared `.data`/`.bss` that
`2026-08-22-module-isolation.md` proved they share. Allocation-free: planning
runs on the audio thread, on a chain-set change and every 1024 blocks after.

**`chain_slots.rs` — per-chain buffers.** One 512-byte output buffer per chain
instead of one shared scratch. The mix stays serial *after* the join, in slot
order, so parallel and serial sum the same numbers in the same order.

## 3. Two bugs the tests caught, both startup-only

**The pool poisoned itself on its first block.** A helper that was still starting
up when the first round was published snapshotted the *already-bumped*
generation, concluded it had nothing to do, and parked — permanently, because it
would never see that bump again. `pending` never reached zero. Fixed with a
`ready` handshake: `RenderPool::new` blocks until every helper has taken its
snapshot. Removing it fails 4 of 5 pool tests.

**A lane the pool could not staff was silently dropped.** The plan is built for a
lane count the pool may not have, and the surplus was skipped rather than run
inline — which silences chains rather than slowing them, and the only symptom
would have been a quiet track. Found by writing the test before assuming the
answer.

**And one test of mine was wrong**: the pool tests shared a `static mut` buffer,
so cargo's concurrent runner made three honest tests fail on each other.

## 4. Where the missing 0.75× is

`2026-08-22-chain-balance-measurement.md` predicted 2.98× for these modules. That
prediction charged for neither the pinning nor the fan-out. Both bills arrive
here.

The measured plan was `4,2,10 | 7,6,5,0,8 | 1,9,3,11`. Priced with the per-module
means from the balance measurement:

| lane | chains | µs |
| --- | --- | ---: |
| 0 (audio thread) | helm, dexed, dexed | 904 |
| 1 | surge, weird-dreams, forge, plaits, plaits | 658 |
| 2 | obxd, obxd, noisemaker, noisemaker | 990 |

Makespan 990 µs against a 2437 µs serial total — the partition alone predicts
**2.46×**, and this set is unusually pinning-heavy: four of its eight modules
appear twice. Measured 1091 µs, so **fan-out and preemption cost ~100 µs per
block**.

That is ~5× the 21 µs the join-cost prototype measured for the mechanism in
isolation, and the difference is what FIFO 68 buys: helpers *can* be preempted by
Move's FIFO 70 threads, and `yielded=2106` says the audio thread reached the join
first on essentially every block. The mechanism is not the problem; waiting for a
preempted helper is.

## 5. What this does NOT settle

- **There is no equivalence oracle yet.** Nothing has verified that parallel
  render produces the *same audio* as serial — only that every chain is
  measurably sounding in both arms. FPCR per worker was the prerequisite for
  that test and it has landed, so the oracle is now the next thing worth
  building, and it should be built before this flag defaults to on.
- **§4 is untouched.** `midi_send_external` and `midi_send_internal` are
  single-producer, and modules *do* emit MIDI from render (`v2_tick_midi_fx`).
  The pinning does not help: two *different* modules emitting concurrently is
  enough. The 8 sounding chains here are plain synths, so the measurement did
  not exercise it.
- **The lane count is fixed at 2 helpers** and the fourth worker was worth 0.13×
  in the balance measurement, so this is the design point rather than a limit
  that was tested here.
- **`chparallel` is not persisted and defaults off.** It changes the "one
  thread, one at a time, in slot order" contract 93 module repos were written
  against.
- **Upstream stays off-limits** pending an in-situ measurement, per
  `2026-08-21-parallel-chain-render-schwung-review.md`.

## 6. Next

1. **The serial/parallel equivalence oracle.** The one thing standing between a
   measurement and a feature.
2. **Bound the join.** ~100 µs of the ~1091 is waiting on preempted helpers.
   Worth knowing whether that is fan-out latency or genuine preemption before
   reaching for a priority change, which schwung's realtime doc forbids.
3. **§4, the MIDI-out rings** — the first hazard the pinning does not cover.
