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
isolation. §6 takes that number apart; it is not yet known how much of it is
overhead at all.

## 5. Pinning is the floor, not the design

Same-module chains are pinned **uniformly**, and that is more conservative than
the evidence requires. Two instances of one module only conflict if the module
has state to conflict over. Most do not: of 78 audio-rendering modules, 6 mutate
their own statics from render and 12 more reach the chain host's clock globals —
**~60 are provably free to run duplicated, concurrently, with no copy and no
pin.**

The measured set makes the cost of ignoring that concrete. Its four duplicated
modules are **plaits, obxd, dexed and noisemaker**, and none of them is on either
hazard list. *Every pin in the 2.23× measurement protected against nothing.*

The design that follows is three tiers, not one rule:

| the set contains | do | cost |
| --- | --- | --- |
| a duplicated **clean** module (~60 of 78) | nothing — let it run free on separate lanes | none |
| a duplicated **flagged** module | pin it to one lane | makespan |
| a duplicated flagged module that **dominates** the set | give it a private byte copy | a warmed cache |

Copying stops being the mechanism and becomes the escape hatch for one narrow
case — which is what makes the unsolved part of `2026-08-22-module-isolation.md`
(there is no non-audio thread to warm a copy cache on) affordable to leave open.

**What tier 1 is worth** is very unevenly distributed. On this set: little. The
offline packer puts free-running at 2.92× against 2.72× pinned — about 7%, and
the fan-out in §6 costs more than that. On the degenerate set it is the whole
answer: **twelve tracks of one module pin to a single lane and return exactly
1.00×**. Twelve drum tracks is a set people build, and there three cores buy
nothing at all. Tier 1 is what makes the worst case stop being catastrophic;
tier 3 only matters if those twelve tracks are specifically one of the six.

**The tradeoff, stated plainly.** Uniform pinning has to trust nothing. Tiering
makes correctness depend on the audit being right, and that audit is *static*: it
cannot see through function pointers or C++ virtual dispatch, which is exactly
how `airwindows` dispatches into CLAP plugins. "71 clean" means 71 with no
*statically reachable* mutable statics. Tier 1 should therefore be an allow-list
of modules confirmed clean, not a deny-list of the ones flagged — a module nobody
has checked must land in tier 2, where being wrong costs speed instead of
correctness.

## 6. The ~100 µs: what it might be, and what to do about it

**None of it is attributed yet, and two of the four candidates are not overhead
at all.** `yielded=2106` says only that the audio thread reached the join first;
it cannot say why.

Four candidates:

1. **Partition error.** The 990 µs makespan above is computed from per-module
   means taken in a *different run*, and the live planner packs a 1/16
   exponential mean that lags. If the plan was simply worse than the one priced
   here, that is not overhead and no amount of tuning the rendezvous touches it.
2. **Fan-out latency** — the gap between `unpark` and a helper actually running.
   The join-cost prototype put this at ~19 µs per helper at p50 and 240 µs at
   max, and it is pure dead time: the audio thread has published work that nobody
   is doing yet.
3. **Preemption** by Move's FIFO 70 threads, which sit above the helpers' 68.
   The frame-phase measurement found ~2.2 of 3 non-SPI cores idle *during* movy's
   render window — Move's own workers run after it in the same callback — so this
   should be small. That prediction has never been checked with helpers actually
   running.
4. **Lane 0 finishing early.** Lane 0 is 904 µs against lane 2's 990 µs, so the
   audio thread waits ~86 µs. That is most of the gap on its own.

**The 21 µs was never a prediction for this configuration.** In the standalone
prototype, "main" was a pool thread among the others on cores 0-2, and the
scheduler co-located a helper with it on 92% of frames. Here main is Move's SPI
thread — **FIFO 90, pinned to core 3** — and the helpers are masked to 0-2. Every
wake is now cross-core and the cache sharing is different. The number should be
re-measured in situ before it is treated as a baseline.

### Diagnosis, before any treatment

- **D1 — separate partition error from overhead, for free.** The cost report
  already carries this run's own per-chain costs. Repacking *those* and comparing
  the resulting makespan against the measured `wall` splits candidate 1 from 2-4
  using data already collected. This should be done first; it is arithmetic on an
  existing log line.
- **D2 — instrument the rendezvous in situ.** Timestamps at publish, at each
  helper's first instruction, at each helper's last, and at join return. p50 and
  p99. That splits fan-out (2) from preemption (3). Two clock reads per helper
  per block, ~30 ns each.

### Treatments, cheapest first

- **T1 — bias lane 0.** The planner treats all lanes as equal, but lane 0 is not:
  it is already running and pays no wake cost, so it should be handed *more* work
  than the helpers by roughly the fan-out latency. One line — start `lane_load[0]`
  below zero instead of at zero. It targets candidate 4 directly, and candidate 4
  looks like most of the gap.
- **T2 — hoist the wake out of the critical path.** The helpers are unparked at
  the start of the chain render, so their wake latency is dead time. movy does
  sequencer work *before* chain render in the same callback. Publishing and
  unparking at the top of `render_block`, with the helpers spinning briefly on a
  "go" flag set when the chain render begins, overlaps the wake with work movy
  has to do anyway. The plan is stable block to block, so most of the task list
  is already known that early.
- **T3 — spin instead of park.** The prototype measured 0.6 µs for a pure spin
  against 21 µs for a futex wake, which is the single largest known lever — and
  it is the wrong trade here. Blocks arrive every 2902 µs and the render takes
  ~1091 µs, so a spinning helper burns a core for ~1800 µs of every frame,
  starving the Move workers that run right after us. A *bounded* spin after
  finishing a round does not help either: the next block is 1.8 ms away, far
  past any sane spin budget. Recorded so it is not rediscovered as an idea.
- **T4 — pin helpers to fixed cores** rather than the 0-2 mask. Already measured
  in the join-cost prototype: it fixes p50 and wrecks p99. Don't.
- **T5 — raise helper priority above Move's 70.** Would address candidate 3
  directly and is the one thing `docs/REALTIME_SAFETY.md` forbids outright, with
  commits (`8592be5c`, `25b72907`) removing exactly this mistake. Not available
  without an upstream conversation, and that conversation needs D2's numbers
  first.

## 7. What this does NOT settle

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
- **The tiering in §5 is designed, not built.** The planner pins every duplicate.
- **Upstream stays off-limits** pending an in-situ measurement, per
  `2026-08-21-parallel-chain-render-schwung-review.md`.

## 8. Next

1. **D1 — repack this run's own per-chain costs.** Arithmetic on a log line
   already collected, and it decides whether §6 is an overhead problem at all.
   Nothing else in §6 is worth doing before it.
2. **The serial/parallel equivalence oracle.** The one thing standing between a
   measurement and a feature, and the gate on `chparallel` ever defaulting on.
3. **T1 — bias lane 0**, if D1 says the gap is real overhead. One line, targets
   the largest identified candidate.
4. **Tier 1 of §5 — stop pinning clean duplicates.** Modest on a varied set,
   decisive on twelve tracks of one module, where the current design returns
   1.00×. Needs the confirmed-clean allow-list first.
5. **§4 of the review, the MIDI-out rings** — the first hazard neither the
   pinning nor the tiering covers, since two *different* modules emitting from
   render is enough.
