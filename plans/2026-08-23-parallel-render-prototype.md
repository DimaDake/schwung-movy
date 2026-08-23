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
appear twice. Measured 1091 µs, so ~100 µs went somewhere this pricing does not
see.

**Every number in this section is priced with per-module means from a *different*
run, and §6 shows that is exactly what makes it wrong.** Repacked against this
run's own costs, the makespan is ~1090 µs rather than 990, the residue is ~47 µs
rather than ~100, and the reason the lanes cost more than the balance
measurement predicted is that *the chains themselves get 27% more expensive when
rendered concurrently*. The table above is kept because it is what motivated D1;
§6 is the measurement that replaces it.

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

## 6. The ~100 µs was the wrong number *and* the wrong suspect

D1 has been run. **It refutes this section's original premise.** The gap is not
~100 µs, and fan-out is not what it is made of. What was actually happening is
that **the parallel arm does 27% more total work than the serial arm** — a loss
six times larger than fan-out and imbalance put together, and one that was not on
the candidate list at all.

### How it is now measured

`scripts/lib/render-accounting.mjs` turns the two log lines the benchmark already
collects into an identity, so every loss is charged to exactly one line and the
remainder is what is genuinely unexplained:

```
serial_wall   = Σ cost_serial + residual        residual is the instrumentation error
Σ cost_par    = Σ cost_serial + contention      same chains, more threads
makespan      = max over lanes of Σ cost_par    what the packing delivers
par_wall      = makespan + overhead             fan-out + join + preemption-at-the-edges
```

The identity kills candidate 4 on sight. **A lane finishing early cannot be part
of the rendezvous residue**, because the wall is set by the *last* lane to
finish; lane 0 idling is already inside the makespan. It was misfiled, and the
accounting is what caught it — `an early lane costs makespan, not overhead` in
`browser-test/logic/partition.mjs` pins it so it cannot be refiled.

### What three runs say

| | run 1 | run 2 | run 3 |
| --- | ---: | ---: | ---: |
| serial wall | 2457.5 | 2511.4 | 2510.7 µs |
| **contention** | **687.9** | **695.8** | **664.3 µs** |
| imbalance (the plan) | 53.7 | 36.0 | 31.4 µs |
| overhead (the rendezvous) | 44.6 | 48.0 | 50.2 µs |
| timer residual | 4.6 | 4.7 | 4.8 µs |
| speedup | 2.15× | 2.18× | 2.21× |
| ceiling if the rendezvous were free | 2.23× | 2.28× | 2.31× |

The residual is 0.2% of the serial wall, which is what makes the rest of the
table worth reading: the per-chain timers really do add up to the wall.

**Fan-out and the join cost ~47 µs, not ~100.** That is about 2× the standalone
prototype's 21 µs, which is the expected direction — there "main" was a pool
thread on cores 0-2 that the scheduler co-located with a helper on 92% of frames,
and here main is the SPI thread at FIFO 90 on core 3, so every wake is
cross-core. The mechanism is behaving as designed.

**And it barely matters.** A *free* rendezvous would take this set from 2.21× to
2.31×. T1 and T2 below are chasing, between them, about 0.1×.

### Contention is the finding

Per-chain render calls get 27% slower when two other cores are rendering. The
timer brackets **only** the `render_block` call — `Instant::now()` immediately
before, `elapsed()` immediately after, no park, no wake, no rendezvous
(`render_pool.rs:226`) — so this is inside the module's own render, not around
it.

Two things inflate that timer and they are not the same problem: cache/memory
contention, and being *descheduled mid-render* by one of Move's FIFO 70 workers.
Per-lane inflation separates them for free, because **lane 0 is the audio thread
— FIFO 90 on core 3 — and Move's workers cannot preempt it**, while the FIFO 68
helpers can.

Run 3 measured `1.28, 1.48, 1.10`, and lane 0 held **only helm in both halves of
the window**, so its figure is the one the mid-window replan did not disturb:

> **The unpreemptable lane still ran 28% slower.**

So the bulk of it is memory, not scheduling. Three cores rendering big synths at
once evict each other; helm, surge and obxd do not fit beside one another. The
spread across lanes (1.10–1.48) may be preemption on top, or just different cache
footprints per module — run 3's replan moved chains between lanes 1 and 2
mid-window, so that spread is not yet attributable and should not be quoted.

This is the one loss on the list that **no scheduling change can recover**. It is
also, at ~0.6× of speedup, by far the largest.

### T0 has been run: the contention is the THIRD LANE, not parallelism

`chlanes <n>` (ENGINE 0.38.0) makes the lane count a runtime control instead of
a constant, and `measure-parallel-render.sh` now sweeps it on one held set.
Measured 2026-08-23, drift across the whole sweep **−0.0%**:

| lanes | wall | speedup | contention | imbalance | overhead | ceiling | joins yielded |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| serial | 2505.3 µs | 1.00× | — | — | — | — | — |
| 1 | 2487.5 µs | 1.01× | −22.5 µs | 0.0 µs | 9.4 µs | 1.01× | 0 / 1450 |
| 2 | 1353.7 µs | 1.85× | 82.7 µs | 37.5 µs | 24.5 µs | 1.88× | 4 / 1801 |
| 3 | 1141.4 µs | **2.20×** | 676.5 µs | 20.3 µs | 62.0 µs | 2.32× | 1176 / 1797 |

**Three lanes does beat two — the design point stands.** The marginal ledger
underneath it is the finding:

- the **2nd** lane buys 1134 µs of wall and costs 83 µs of extra work
- the **3rd** lane buys 212 µs of wall and costs 594 µs of extra work

Per-lane efficiency falls from 92% to 73%: the third lane runs at about a third
of the second one's marginal efficiency. **So §6's "the parallel arm does 27%
more work" is not a property of parallel render — at two lanes it is 3%.** All
of D1's contention term is the third lane, and the join agrees: the audio thread
waits on a helper on 65% of blocks at three lanes and essentially never at two.

**The one-lane arm is the sweep's own falsifier**, which is why `chlanes 1` is a
real setting rather than an alias for serial. It runs the parallel path with
nothing to hand out, so it can differ from serial only by the planner and the
rendezvous; it read 1.01×, contention within noise, inflation 0.99. A sweep
where it does not is measuring something other than the lane count.

That is not hypothetical. **The first sweep was invalid and both guards caught
it.** Re-striking the chord between arms *without releasing first* stacked
voices on every polyphonic synth, so the set grew monotonically more expensive:
the closing serial baseline came back **+82%**, and the one-lane arm reported
0.72× with 1.39× "contention" against no helper threads at all. Read naively the
table said parallel render was a loss and that fewer lanes were better —
plausible, clean, and entirely an artifact. `restrike_chord` releases before it
holds, and the drift check and the one-lane check are now gates the script
prints rather than something a reader has to notice.

### Treatments, re-priced against the measurement

- **T0 — DONE, see above.** Three lanes beats two by 0.35×, so the design point
  stands; but the third lane is where all the contention is, which makes the
  *fourth* the open question rather than a settled 0.13×.
- **T1 — bias lane 0.** Targets imbalance, measured at **31–54 µs**. Still one
  line (start `lane_load[0]` below zero, since lane 0 pays no wake cost), still
  correct, but worth ~0.05× rather than "most of the gap". Demoted.
- **T2 — hoist the wake out of the critical path**, overlapping it with the
  sequencer tick movy does earlier in the same callback. Targets overhead,
  measured at **~47 µs**. Bounded above by 0.10×. Demoted.
- **T3 — spin instead of park.** Still a trap, and now visibly not worth it: it
  chases the same ~47 µs while burning a core for ~1800 µs of every frame,
  starving the Move workers that run right after us — *and* a spinning core is
  itself a contention source, which is the term that actually dominates.
- **T4 — pin helpers to fixed cores.** Already measured in the join-cost
  prototype: fixes p50, wrecks p99. Don't.
- **T5 — raise helper priority above Move's 70.** Aimed at preemption, which the
  lane 0 result says is at most a minority of the inflation. `REALTIME_SAFETY.md`
  forbids it outright, with commits (`8592be5c`, `25b72907`) removing exactly this
  mistake. It was already off-limits; it is now also not the problem.

### Still open

- **D2 — instrument the rendezvous in situ** (timestamps at publish, each
  helper's first and last instruction, and join return). Now much less
  interesting: it would explain ~47 µs. Do it only if T0 says the rendezvous is
  worth optimising after all.
- **Attributing the inflation spread.** Needs a window shorter than the 1024-block
  replan interval, or a pinned plan, so lane composition is fixed for the whole
  measurement. The benchmark now warns when the plan moves under it and prints
  both plans.

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
- **The fourth lane is unmeasured.** `MAX_LANES` is 4 and `chlanes 4` works, but
  the sweep that would have priced it was interrupted. The balance measurement's
  0.13× assumed no contention, and the third lane's ledger (594 µs of extra work
  for 212 µs of wall) says the fourth is where the curve most plausibly turns
  over. One flag, and the sweep already has the arm.
- **The measured speedup moves with how much of the set is sounding.** The
  headline 2.23× and the §6 runs (2.15–2.21×) are the same script on the same
  modules; the §6 runs had 8–9 of 12 chains audible at sampling time. Both arms
  see the same set, so the accounting holds, but the absolute figure is not
  stable to a hundredth.
- **`chparallel` is not persisted and defaults off.** It changes the "one
  thread, one at a time, in slot order" contract 93 module repos were written
  against.
- **The tiering in §5 is designed, not built.** The planner pins every duplicate.
- **Upstream stays off-limits** pending an in-situ measurement, per
  `2026-08-21-parallel-chain-render-schwung-review.md`.

## 8. Next

D1 reordered this list and T0 has now confirmed the shape it implied: the
rendezvous work (T1, T2) is worth ~0.1× between them and stays at the bottom,
and the design point of three lanes survives.

1. **Finish the lane curve — the fourth arm.** `LANES="1 2 3 4"`, one run. The
   third lane cost 594 µs of extra work for 212 µs of wall; if the fourth turns
   the curve over, the answer is to *cap* lanes, which is a one-line default and
   the cheapest remaining win. Nothing below this changes what the feature is.
2. **The serial/parallel equivalence oracle.** Unchanged: the one thing standing
   between a measurement and a feature, and the gate on `chparallel` ever
   defaulting on.
3. **Tier 1 of §5 — stop pinning clean duplicates.** Modest on a varied set
   (imbalance measured 20–38 µs at 2–3 lanes), decisive on twelve tracks of one
   module, where the current design returns 1.00×. Needs the confirmed-clean
   allow-list first.
4. **§4 of the review, the MIDI-out rings** — the first hazard neither the
   pinning nor the tiering covers, since two *different* modules emitting from
   render is enough.
5. **T1 and T2**, together worth about 0.1×, and only if something above them
   has not already changed the design.

### What the benchmark now guarantees about itself

Three harness faults in this session each produced a *confident wrong answer*
rather than an error, so each is now a gate rather than a habit:

- **Writes that never arrive.** `ep` discarded both streams, so a sweep in which
  all ~200 engine writes were dropped — the host argument was an ssh-config
  alias, which resolves for ssh but not for the WebSocket on port 7700 — still
  loaded chains, held a chord and sampled every arm. `ep` now counts failures,
  `cb_require_engine_link` refuses to start without a proven path, and
  `browser-test/device-scripts.mjs` asserts every benchmark probes first. That
  invariant immediately found the same hole in `measure-chain-balance.sh`,
  `measure-module-isolation.sh` and `stress-16-tracks.sh`.
- **A set that changes under the sweep.** The closing serial re-measure bounds
  it, and >10% drift is now printed as a warning.
- **A control arm that must return 1.00×.** `chlanes 1` has no other job.

Also unchanged from D1: a deploy alone does not reload the engine. Even with the
version bumped, the device kept re-opening the old library while the UI looped on
`stale pong 0.37.0`; only a stack restart brought 0.38.0 up. Confirm by poking a
command the old build does not have.
