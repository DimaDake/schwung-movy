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

### DECIDED 2026-08-23: copy, do not audit

The three-tier design below was the plan until this was settled. **It is
superseded.** Copying is the mechanism and there is no allow-list:

| the set contains | do | cost |
| --- | --- | --- |
| a duplicated module — any module | give the second and later instances a private `dsp.so` copy | one dropout, once ever |
| a duplicate whose copy is absent or failed | pin it to one lane | makespan |

Two rules, and the second is a fallback that costs nothing when it is not
needed. What used to be tiers 1 and 3 collapse into the first row; tier 2
survives only as the safety net.

**Why this is better than tiering, and not merely cheaper: it needs no audit at
all.** Tier 1 made correctness depend on `audit-render-globals.py` being right,
and that audit is *static* — it cannot see through function pointers or C++
virtual dispatch, which is how `airwindows` reaches CLAP plugins and how
`plaits`, `obxd` and `surge` are built. "71 clean" only ever meant 71 with no
*statically reachable* mutable statics. A design that has to be told which
modules are safe is a design that is wrong the first time someone installs a
module nobody checked. Copying does not ask.

**What it costs, stated plainly.** The copy is a blocking file write on the
audio thread, so it is a dropout: measured 44–74 ms warm and 81–260 ms cold,
against a 2902 µs frame — 15 to 90 dropped frames
(`2026-08-22-module-isolation.md` §3). That was judged unacceptable there, on
the assumption it had to be hidden. It is accepted here, for three reasons:

- It lands at **module load**, which already blocks the audio thread on a
  `dlopen` and already hiccups. It is not a new class of event, it is a longer
  one.
- It fires **only for the second and later instance of one module in a set** —
  never for the ordinary case of twelve different instruments.
- It is a **cache, not a copy per load.** `chain_copy.rs` already implements the
  pattern — a sidecar recording the source's size and mtime, refreshed only when
  the source changes. So the cost is paid once for the life of a (module, chain)
  pair and never again, not once per load.

This is what makes the open question in `2026-08-22-module-isolation.md` §6
("a copy must not be on the audio thread, and movy has no non-audio thread")
stop being a blocker: nothing has to be warmed off-thread if a load-time dropout
is acceptable. Schwung's off-thread loader would turn the remaining hiccup into
nothing, which is why it stays on the §11 list — but it is now an improvement,
not a prerequisite.

Only `dsp.so` is copied. `module.json`, presets, ROMs, wavetables and soundfonts
are read with `fopen`, which does not care about inodes, so they symlink — and
they are the bulk of the bytes. Disk and RAM were never the constraint: every
installed `dsp.so` totals 41 MB against 26.9 GB free, and a duplicate `plaits`
mapping is 324 KB resident.

### The three-tier design this replaced

Kept because §9's coverage numbers and §12's unpinned run were both scored
against it, and because the fallback row is what survives.

**What tier 1 is worth** is very unevenly distributed. On this set: little. The
offline packer puts free-running at 2.92× against 2.72× pinned — about 7%, and
the fan-out in §6 costs more than that. On the degenerate set it is the whole
answer: **twelve tracks of one module pin to a single lane and return exactly
1.00×**. Twelve drum tracks is a set people build, and there three cores buy
nothing at all. Tier 1 is what makes the worst case stop being catastrophic;
tier 3 only matters if those twelve tracks are specifically one of the six.

**The tradeoff that killed it.** Uniform pinning has to trust nothing; tiering
makes correctness depend on a static audit. That is the whole argument for
copying instead, and it is made above — the allow-list this paragraph used to
call for is no longer wanted, because a module nobody has checked should not need
checking.

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

- **The equivalence oracle exists and passes, on 2 modules of 8.** See §9. No
  difference has been found, but coverage is the finding: two thirds of the
  fleet cannot be compared this way at all.
- ~~**§4 is untouched.**~~ **Fixed — see §10.** It was also much smaller than
  this section believed: no module in the 93-repo fleet reaches either unsafe
  sender from `render_block`, and the one render-path MIDI call that does exist
  goes to the MPSC-safe `midi_inject_to_move`.
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

1. ~~**Finish the lane curve — the fourth arm.**~~ **Run — the curve turns
   over, and `DEFAULT_LANES = 3` is already the cap, so this closes with no code
   change. See §12.**
2. ~~**The serial/parallel equivalence oracle.**~~ ~~Widening its coverage.~~
   ~~Defeating the pinning and re-running on two instances of ONE module.~~
   **Run — `chpin 0` exists and the unpinned oracle produced its first
   duplicate-race evidence. See §12.** What is left of this item is not another
   oracle run: it is the eight chains that are *not reproducible serially*, which
   is now the binding constraint on every question the oracle can be asked.
   §5's decision lowers the stakes here: with copying rather than an audit, the
   oracle no longer has to certify individual modules as safe to duplicate. It
   goes back to being what it was built for — a check that parallel render does
   not change the audio at all.
3. **Per-chain `module_dir` — give duplicates their own `dsp.so` copy.** Now
   the top item, and the one the whole feature is bounded by: twelve tracks of
   one module return exactly 1.00× today, and twelve drum tracks is a set people
   build. **No longer blocked on an allow-list** — §5's decision replaced the
   audit with copying, so there is no per-module policy to write and no evidence
   to gather first. The mechanism is proven and needs no schwung change
   (`2026-08-22-module-isolation.md` §2); `chain_copy.rs` already implements the
   cache-with-sidecar pattern it needs; `chpin` (§12) is the switch that lets a
   copied set actually spread. What is left is plumbing: `chain_slots.rs` still
   passes one shared `module_dir` string to every chain.
4. ~~**§4 of the review, the MIDI-out rings.**~~ **Done — see §10.**
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

## 9. The equivalence oracle: does parallel render sound the same?

Every measurement above asks whether parallel render is *faster*. None asked
whether it is *correct* — `chain peaks` says a chain made a sound, which a race
that drops, doubles or reorders samples passes trivially.

**The bar is bit-identical, and that is a choice the design earned.** Each chain
renders into its own buffer, every worker sets the same FPCR flush-to-zero flag,
and the mix stays serial in slot order after the join — so the parallel arm does
the same arithmetic in the same order. There is no tolerance to argue about and
no threshold to tune: one differing sample is a defect.

**How it is measured.** `chdigest <blocks>` (engine 0.39.0) runs a self-contained
experiment: strike a fixed chord on every loaded chain, FNV-1a exactly N blocks
of each chain's output, release. The digest is folded on the audio thread after
the join and before the mix, so it reads precisely what the lane that rendered
the chain wrote. `scripts/measure-render-equivalence.sh` scores three arms.

**Why the stimulus is generated inside the render.** The obvious harness — hold a
chord over the wire, digest both arms — cannot work. `measure-parallel-render.sh`
strikes its chord with 48 separate socket writes, so the notes land seconds apart
and never on the same block twice. Any difference that produced would be
indistinguishable from a threading bug.

### Three arms, not two, and why the third is not optional

The run is **A, B, A'**: the serial control brackets the parallel arm in time,
and a chain is evidence only if `A == A'`. Without that, the first run would have
read as a catastrophe — **all twelve chains "differed"**, and none of it was
threading.

Two facts separated the causes. Two `dexed` instances hashed *identically* to
each other inside every arm, so the modules are deterministic; and reloading the
chains before each arm fixed four of them. What the first run measured was
**state surviving from one arm into the next** — voice-allocator position,
free-running LFO phase — which no settling gap can wait out. Every arm now gets
freshly instantiated chains.

### The result, and its coverage

Three lanes, 512-block window, fleet `plaits obxd dexed noisemaker helm forge
weird-dreams surge`:

| verdict | chains | modules |
| --- | ---: | --- |
| bit-identical | 4 | dexed ×2 (L0), forge (L2), weird-dreams (L1) |
| not reproducible serially | 8 | plaits ×2, obxd ×2, noisemaker ×2, helm, surge |
| silent | 0 | — |

**No difference was found. The honest headline is the coverage, not the pass.**
Two thirds of the fleet cannot be compared this way, because they do not repeat
themselves even single-threaded from a fresh load.

### The unit of evidence is the module, not the chain

"4 of 12 chains" overstates it. The set is 8 modules across 12 chains, four of
them loaded twice, and the two `dexed` chains hashed *identically to each other*
in every arm — that is one piece of evidence duplicated, not two. The honest
figure is **3 modules of 8**: dexed, forge, weird-dreams.

The eight that are not reproducible are also not merely missing coverage. A
module that renders differently on two identical fresh loads, single-threaded,
is doing one of two things, and they have opposite consequences:

- **(a) seeding from a clock or `/dev/urandom`** — harmless, and it means the
  oracle can *never* test that module, which is a fact worth knowing rather than
  a gap worth closing.
- **(b) carrying state across re-instantiation in a file-scope static** — §5's
  hazard class exactly, and it would make the module unsafe under parallel render
  regardless of anything the oracle reports.

Sorting the eight into (a) and (b) is the useful question. Part of the answer is
already free: `scripts/audit-render-globals.py` flags 7 fleet repos as touching
shared statics from render — forge-move, krautdrums-move, schwung-StreamRTSP,
schwung-airwindows, schwung-chordism, schwung-sfz, schwung-virus — and **none of
the eight unreproducible modules is among them**, which points at (a). Not proof:
the audit is static and cannot see through function pointers or C++ virtual
dispatch, and plaits, obxd and surge are all C++.

### Lane 0 passes are nearly tautological, and the run says so

Lane 0 *is* the audio thread: a chain the planner put there renders on the same
thread in both arms, so it matches for the same reason serial matches serial.
Only a chain that ran on a **helper** was exposed to the concurrency under test —
so of the four passes above, the evidence is **forge and weird-dreams**, and the
two `dexed` chains are close to free.

This is not a hypothetical. The same run at **`chlanes 2`** put all four
reproducible chains on lane 0, and reports `INCONCLUSIVE` rather than a green
pass over a run that tested nothing. The scorer's five cases — pass, fail, silent,
not-reproducible, and lane-0-only — are pinned by `browser-test/device-scripts.mjs`
against synthetic arms, each proven to fail when its guard is removed.

### What this does and does not license

- It does **not** license `chparallel` defaulting on. §4's MIDI-out rings are a
  *known* single-producer violation that no amount of audio comparison reaches:
  a corrupted ring index need never perturb a sample.
- An audio diff is a **probabilistic** race detector. It catches a bug only if it
  fires inside the window and moves the output. That is why it is a gate and not
  a proof.
- Coverage is the thing to improve next. The eight unstable modules are unstable
  for a reason nobody has looked at yet — a time-seeded noise source is benign,
  a static that survives re-instantiation is the same hazard class as §5.


---

## 10. The MIDI-out rings: measured first, then closed

§4 of the review named this the hazard that neither the pinning nor the tiering
covers, and it was the last *correctness* item on the list. It turned out to be
two separate questions that had been fused: **how big is it**, and **how do we
stop it**. The first has an answer that changes the second.

### How big it is: much smaller than "modules do emit MIDI from render"

The review's evidence was that `v2_render_block` calls `v2_tick_midi_fx`
(chain_host.c:1942) and that MIDI leaves from in there. True, but it does not
follow that the unsafe senders are reachable. Enumerating the three render-path
MIDI exits, against the current schwung checkout and all 93 fleet repos:

| exit | reachable from render? | shape |
| --- | --- | --- |
| `midi_inject_to_move` | **yes** — `v2_tick_midi_fx` Pre mode (chain_midi.c:608), plus `schwung-fork` from `process_midi` | **bounded MPSC** (Vyukov per-slot-sequence, `shadow_constants.h:520`), documented for concurrent producers *across processes* |
| `midi_send_internal` | **no module in 93 repos** | unsafe |
| `midi_send_external` | **no module in 93 repos** | unsafe |

Two findings sit behind that table.

**MIDI FX cannot reach the unsafe senders at all — structurally.**
`midi_fx_api_v1_t` (`schwung/src/host/midi_fx_api_v1.h`) has no host pointer:
`create_instance(module_dir, config_json)`, and `tick` returns messages through
an `out_msgs` buffer. A MIDI FX has nothing to call. Everything it generates is
funnelled by the *chain host* into `midi_inject_to_move` — the safe one. So the
intuition that "MIDI FX are the risk, and they are cheap enough to pin to one
lane" is exactly inverted: MIDI FX are the one category that is safe by
construction, and pinning them would buy nothing.

**The only fleet module that calls `midi_send_internal` at all is `essaim`**, at
`src/dsp/essaim.c:504`, and it uses it to drive **pad LEDs**. Its callers are
`on_midi` and `set_param` — never `render_block`. Movy runs neither off the audio
thread, so it was never exposed. `scripts/audit-render-globals.py` already
collected this (it tracks host calls per render entry point); nobody had grepped
its output for the MIDI ones.

So there is no live bug. What there is, is a **contract** movy quietly broke: 93
repos were written against "one thread, one chain at a time, in slot order", and
a module added tomorrow is entitled to send MIDI from render. That is worth
fixing regardless — but it is a guard, not a rescue.

### How it is closed: movy owns the vtable, so movy can keep the promise

`chain_host.rs:170` hands the chain host a host API pointer at
`move_plugin_init_v2`, and that pointer reaches **every module in every movy
chain**. It used to be schwung's own struct, passed through. It is now a *copy*
with two pointers replaced — `engine/crates/movy-dsp/src/midi_out.rs`:

- A send issued while a chain is rendering is **parked** in that chain's queue.
  One producer per queue, because a chain renders on exactly one lane.
- The audio thread **drains** it after the join, **in slot order**.
- A send from outside a render — movy's own transport clock and automation CC —
  passes straight through, untouched.

Two properties fall out, and the second is the one worth having:

1. schwung sees a single producer again, which is the safety claim.
2. The emission **order** becomes deterministic, and identical between serial and
   parallel. This is the same reason the mix is summed serially in slot order
   after the join rather than as lanes finish. Parallel render now produces
   identical *MIDI*, not merely identical audio — which extends what §9's oracle
   is able to claim, since the oracle can only ever see samples.

`midi_inject_to_move` is deliberately left alone. It is a real MPSC queue, it
already carries the Pre-mode path from render, and routing a working
safety-correct path through this one would add risk to buy nothing. Its
cross-chain ordering stays nondeterministic under parallel; within a chain it is
unchanged, and the chains address different recv channels.

### The one thing this cost

The mirror in `ffi.rs` was deliberately a **prefix** of schwung's
`host_api_v1_t`, stopping at `midi_inject_to_move`. Safe while movy only read
fields out of schwung's struct — the offsets of the fields present do not move.
Not safe once movy hands over a copy: the chain host reads `slot_recv_channel`
(Pre-mode track addressing) and `get_beat_position` (chain LFO lock) off whatever
it is given, and a short copy makes it read past the end and call a garbage
function pointer on the audio thread.

So the mirror is now complete, and `browser-test/abi-parity.mjs` demands an
**exact** match rather than a prefix. schwung appending a field now fails a local
test with a diff to apply, instead of failing on the device. That guard was
proven by deleting `get_beat_position` from the mirror and watching the test say
`C has 17, Rust has 16`.

### What it measured

| check | result |
| --- | --- |
| `cargo test` | 89 movy-dsp (up from 78), 261 seq-core, 0 failed |
| local suites | all green, 133 passed |
| device — `test-chains.sh` | PASSED, 14 checks; chains load, sound (peak 10669), dexed metadata intact, state restored |
| device — `measure-render-equivalence.sh` | **PASS, 4/12 bit-identical, 0 differences, 3 on helper lanes** (was 2) — and the surviving hashes are byte-for-byte the ones the pre-change build produced |
| device — `measure-parallel-render.sh` | **2.23× at 3 lanes**, unchanged; `chlanes 1` control still 1.00×; serial drift 0.1% |
| device — `chmidilog` | `dropped=0` after a full twelve-chain run |

The drain is a 12-iteration walk over relaxed atomics per block when nothing is
queued, which is why the speedup did not move.

### Teeth

Each guard was removed and the failure watched, per the repo rule:

- Scope removed from `render_pool::run` → `a_send_from_inside_a_task_is_attributed_to_that_task_s_chain` FAILED.
- Drain order reversed → `the_drain_is_in_slot_order_whatever_order_the_lanes_queued_in` FAILED.
- `get_beat_position` deleted from the ABI mirror → abi-parity FAILED.

The serial path takes the same `Scope`, but note what it is for: serial has one
thread by definition, so its scope buys **ordering parity**, not safety. The
safety-critical site is `run`, and that is the one under test — under parallel
every lane, the audio thread's included, goes through it.


---

## 11. What schwung could change once movy's parallel render is real

Every item below is **blocked on us, not on Charles** — but the reason has
moved, and the old wording no longer describes it.

The standing rule was "no upstream conversation until there is an in-situ
measurement inside the real `render_block`", because every earlier number came
off a bench rather than off the thing: `dd` aggressors standing in for chains,
the join mechanism timed standalone, lanes priced with per-module means borrowed
from a *different* run, and figures taken with movy closed and the transport
stopped. That caution was earned. The bench predicted ~7% contention where the
real render measured **27%**, and 2.98x where the device gave **2.23x** — being
wrong by that margin in front of upstream costs credibility that is not cheap to
rebuild.

**That condition is now met.** Review §5's two deciding questions are both
answered from the device: (b) *when* inside the frame Move's FIFO-70 workers run
was settled by `2026-08-21-frame-phase-measurement.md` with a scheduler trace —
they run *after* movy's render, in the same callback, leaving ~2.2 cores idle
through our window — and (a) follows from it. §6 measured concurrent-render
inflation inside the real render, §9 hashes real chain output inside it, §10
counts real render-path MIDI inside it.

What blocks the list now is **maturity, not evidence**: `chparallel` is still off
by default, the fourth lane is unmeasured, and the oracle compares 3 of the 8
modules in the set. Walking into upstream with a prototype nobody has turned on
is a weak position however good the numbers are. So this section is a list to
hold, not a list to act on — and the thing that unblocks it is shipping
`chparallel`, not measuring more.

The framing matters, and it is the opposite of the obvious one. The tempting ask
is *"document a rule that new modules must not send MIDI from render"*. That is
the weakest option available: it is unenforceable, its failure mode is invisible,
and it would make 93 repos give up an ability that is perfectly legal in
schwung's own single-threaded host — to pay for a movy-only feature. Everything
below is instead a small change that **removes** a workaround movy is carrying,
and costs module authors nothing.

Ordered by how much movy code each one deletes.

### 1. Make the two MIDI-out senders multi-producer

`midi_send_internal` and `midi_send_external` are single-producer;
`midi_inject_to_move` beside them is a proper bounded MPSC (Vyukov
per-slot-sequence, `shadow_constants.h:520`). **schwung has already solved this
exact problem once** — the other two simply never got the same treatment.

If they did, movy deletes `midi_out.rs` outright, *and* the vtable copy in
`chain_host.rs` that exists only to host the wrappers, *and* the exact-mirror
requirement §10 had to impose on `ffi.rs`. This is by far the largest deletion
on the list, and the change upstream is small and self-contained.

### 2. Put a size field in `host_api_v1_t`

The chain host already forwards a copy of the host vtable — `chain_host.c:82`
is `memcpy(&inst->subplugin_host_api, g_host, sizeof(host_api_v1_t))` plus four
overridden members. Movy now does the same thing one level up, and §10 is
literally the same pattern.

The difference is that the chain host compiles against the header it is copying,
so it cannot truncate. Movy mirrors the struct by hand and can. A `struct_size`
member (or a `host_api_v1_copy()` helper) would let any forwarding host copy
**by size** and patch the two early, stable pointers — which retires the
exact-mirror coupling and the test that guards it, even if item 1 never lands.

### 3. Make `chain_get_clock_status`'s refresh gate atomic

Review §2, still the sharpest single finding. `chain_refresh_clock_output_enabled`
does `fopen` + `malloc` behind a **non-atomic** one-second gate
(`chain_midi.c:85`), on the render path, in a `dsp.so` all twelve movy chains
share. 12 fleet modules reach it, and it is part of why the planner has to pin
same-module chains to one lane.

An atomic gate — or hoisting the read off the render path — shrinks movy's
pinning list, which is exactly what §8 item 3 (twelve tracks of one module
returning 1.00×) is blocked on.

### 4. Give the chain host a per-instance `g_host`

`move_plugin_init_v2` assigns a **file-global** `g_host` (`chain_host.c:2082`).
Since dlopen dedups by realpath, movy initialising it would overwrite the pointer
schwung's own four slots share — which is the entire reason `chain_copy.rs`
exists and byte-copies the chain host's `dsp.so`.

Per-instance storage would retire the chain-host copy. Note it does **not**
retire module-level isolation: `2026-08-22-module-isolation.md` found 6 modules
whose own file-scope statics need separating regardless, and that copy stays.

### 5. Fix the stale comment at `shadow_midi.c:740`

It still claims the inject ring is "Same-thread as the drain … so no extra
synchronization is needed". That has not been true since the ring became MPSC,
and it is precisely the sentence someone auditing this path would read and
believe. Documentation only, zero risk, and it cost this project real time.

### 6. Sanction a helper-thread priority band

Movy's workers sit at FIFO 68 by inference: `docs/REALTIME_SAFETY.md` forbids
being at or above Move's FIFO 70 and cites two commits that removed exactly that
mistake, but it does not sanction anything below. A stated band would turn
movy's guess into a contract.

**This is the one item that is gated hardest**, because arguing for it means
arguing that movy runs modules on several threads — which is the whole thing the
in-situ-measurement rule is holding back. It is also the item T5 sits behind.

### 7. An off-thread loader

Schwung's residual 2.6 (review §8) is already building one. It is the natural
home for warming movy's copy cache, which `2026-08-22-module-isolation.md` §6
flags as the one unanswered question in per-chain `module_dir`: a copy must never
happen on the audio thread, and movy has no non-audio thread of its own.

Nothing to ask for here beyond making sure movy's need is visible when it lands.

---

## 12. Two measurements that close §8 items 1 and 2

Both run 2026-08-23 on engine 0.41.0, on the twelve-chain fleet set.

### The fourth lane turns the curve over, and it is not contention that does it

| lanes | wall | speedup | contention | imbalance | overhead |
| --- | --- | --- | --- | --- | --- |
| serial | 2465.2 µs | 1.00× | — | — | — |
| 1 | 2431.0 µs | 1.01× | −38.0 µs | 0.0 µs | 9.2 µs |
| 2 | 1301.3 µs | 1.89× | 40.5 µs | 2.1 µs | 49.1 µs |
| **3** | **1107.4 µs** | **2.23×** | 585.5 µs | 48.2 µs | 44.2 µs |
| 4 | 1393.3 µs | 1.77× | 638.6 µs | 226.9 µs | 391.8 µs |

Serial drift over the sweep −0.2%, and the `chlanes 1` control arm returned
1.01×, so the set held still.

**Three lanes is the design point and the answer is already in the code**:
`DEFAULT_LANES = 3`. `MAX_LANES` stays 4 because it is the ceiling on a
*measurement* control, and removing the arm that produced this table would make
the table unreproducible.

The interesting part is *why* the fourth lane loses, because it is not the
mechanism T0 found. Contention barely moves — 585.5 → 638.6 µs, +9% — while
**rendezvous overhead goes up 8.9× (44.2 → 391.8 µs) and imbalance 4.7× (48.2 →
226.9 µs)**. Adding the fourth lane does not make the chains cost more; it makes
the *join* cost more. That is consistent with the frame-phase result: Move's own
FIFO-70 workers run on the same four cores immediately after movy's render, so a
fourth helper is the one that stops fitting in the gap, and the wall is then set
by whichever lane got descheduled. The run flagged it independently — the plan
changed *during* the four-lane window, which is the planner reacting to costs
that were themselves preemption noise.

So the third lane and the fourth fail for opposite reasons, and only the third
is worth its price.

### The oracle, unpinned: dexed raced itself and stayed bit-identical

`chpin 0` (`render_plan::plan`, `ChainSlots::set_pin_duplicates`) stops the
planner keeping same-module chains on one lane. It is off by default, never
persisted, and deliberately unsafe — it is what allows the race the pinning
exists to prevent, which is the only way to get evidence about that race.

| run | evidence | on a helper | **raced a sibling** | verdict |
| --- | --- | --- | --- | --- |
| `PIN=1` (control) | 4/12 | 4 | **0** | PASS |
| `PIN=0` | 4/12 | 2 | **2** | PASS |

**The control is the finding.** Pinned, all four duplicate pairs sat on one lane
each (`plaits` L1+L1, `obxd` L0+L0, `dexed` L1+L1, `noisemaker` L2+L2) and the
run printed the same green PASS over the same four chains — while testing
nothing whatsoever about duplicates. That is the vacuity §8 item 2 asserted,
now demonstrated rather than argued.

Unpinned, the planner split all four pairs, and one pair survived to be
evidence: **`dexed` on lanes 0 and 1, both `7a0d03e7374a79e3`, byte-identical to
each other, to the serial arms, and to every earlier run of this set.** Two
instances of one module rendering concurrently through one `dlopen` mapping
produced the same audio as one at a time.

`RACED` is a distinct count from `EXPOSED` for a reason a single number hides: a
helper lane exposes a chain to concurrency *in general*, but only a sibling on
another lane exercises the shared `.data` of one mapping. The harness now
refuses to print PASS for a `PIN=0` run whose `RACED` is 0 — an unpinned run
that spread nothing is indistinguishable from a pinned one, and would otherwise
report a green answer to a question it never asked.

**What this does not license.** One module of duplicate evidence is not the
allow-list §5 tier 1 needs. `forge` remains flagged-and-passing on the same
vacuous ground it was before — there is still exactly one forge in the set, so
splitting duplicates changed nothing for it. And the binding constraint is
unchanged and now clearly the top of the list: **eight of twelve chains are not
reproducible serially**, so no amount of lane arrangement can turn them into
evidence. Widening the oracle means fixing that, not running it again.

### Teeth

Each guard was removed and the named test watched to fail:

- ignore `pin_duplicates` when grouping → `unpinned_duplicates_land_on_different_lanes`
  and `unpinned_still_schedules_every_chain_exactly_once` FAILED
- keep module-equality membership when unpinned → both FAILED (three chains of
  one module scheduled nine times)
- drop the forced replan in `set_pin_duplicates` →
  `unpinning_forces_a_replan_rather_than_waiting_for_one` FAILED

Plus two scorer cases in `browser-test/device-scripts.mjs` fixing that a split
pair counts as raced and a pinned pair does not, and a source assertion that the
`RACED == 0` branch exits non-zero.

`pin` is reported in `chrenderlog` because a set with no duplicated module plans
identically either way: an arm that meant to unpin and did not would otherwise
look exactly like one that did.
