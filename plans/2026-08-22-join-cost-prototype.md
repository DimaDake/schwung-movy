# Join cost: what the fan-out mechanism actually costs

Throwaway prototype called for by `2026-08-21-frame-phase-measurement.md`, which
proved the *capacity* for parallel chain render (~2.2 of 3 non-SPI cores idle
for the whole of movy's render window) and deliberately left the *throughput*
question open. Capacity is not throughput: splitting a 363 µs render N ways only
pays if waking N threads and joining them costs far less than the
`363 − 363/N` it saves.

**Answer: it costs ~21 µs, essentially all of it scheduler wake latency, and it
does not grow with the workload. At the design point — the audio thread plus two
helpers — that is a 2.52× speedup with 23 µs of overhead at p50 and 68 µs at
p99. The mechanism is not what kills this design.**

## Tooling

`scripts/measure-join-cost.sh` + `scripts/bench/join-cost.c`.

A standalone C binary, cross-compiled with the same toolchain as `dsp.so`, run
from `/tmp` on the device and deleted afterwards. It links nothing from movy and
touches no chain state — the workload is a synthetic float kernel calibrated to
a wall-clock target, a stand-in for a chain render rather than a model of one.

Its threads run *below* Move's audio threads (main FIFO 69, workers FIFO 68,
against Move's 70), so it can never preempt the audio callback and can never
cause a dropout. The price of that choice is that Move can preempt *us*, which
is the main caveat on every tail figure below.

## The result

3000 frames at the real 2901 µs cadence, 363 µs of work split three ways
(121.2 µs ideal share):

| | p50 | p90 | p99 | max |
| --- | --- | --- | --- | --- |
| serial baseline | 363.6 | 395.2 | 583.5 | 632.2 |
| parallel wall, clean frames | 144.5 | 158.0 | 189.3 | 223.0 |
| fan-out to first worker | 18.7 | 22.3 | 28.9 | 240.3 |
| fan-out to last worker | 20.9 | 25.6 | 48.3 | 243.5 |
| join latency | 0.3 | 0.4 | 4.1 | 42.9 |

**2.52× at p50. Overhead 23.3 µs at p50, 68.1 µs at p99.**

Calibration lands on target (363.6 µs measured against 363 requested), so the
speedup is against the workload actually delivered.

## Where the cost is

Three runs decompose it, and the decomposition is lopsided:

| configuration | overhead p50 |
| --- | --- |
| pure spin, no workload (workers never sleep) | **0.6 µs** |
| futex wake, no workload | **21.0 µs** |
| futex wake, 363 µs workload, 3 threads | **23.3 µs** |

The rendezvous machinery — the atomics, the generation counter, the join — is
free. Join latency is 0.3 µs at p50: by the time the main thread finishes its
own share, the helpers are already done and it observes that immediately.

**The entire cost is getting a sleeping thread onto a core.** ~18 µs for the
first, ~2 µs per additional worker after it. That is high for an RT wakeup on
PREEMPT_RT but it is a fixed cost: it does not scale with the workload, so it
gets cheaper in relative terms as chains are added. Against a 363 µs render it
is 6%.

Pure spin is the floor, not an option. Two spinning FIFO threads hit the RT
bandwidth throttle (`sched_rt_runtime_us` = 950000/1000000) and one frame in the
trial run stalled **47 ms**. It also burns three cores continuously, which would
starve the UI and the display. It is in the tool to prove where the 21 µs goes,
not as a candidate.

## Two things that were nearly measured wrong

**Placement, not the futex, explains the first bad reading.** The first run
reported a fan-out of 122 µs and only 1.72×. That number is an artifact of two
things: the device had been up 90 seconds and was still settling, and — the real
effect — the scheduler was parking a worker on the core the main thread already
held. 92% of frames in a later 4-thread run had two of our threads wake on the
same core. A co-located worker cannot start until the main thread finishes its
own share, because main sits one priority level above it, so `max(worker start)`
inflates to roughly main's whole share. The tool now records `sched_getcpu()`
per worker and counts collisions.

**Pinning fixes the collisions and makes the tail worse.** With `--affinity`,
collisions go to 0/800 and p50 improves slightly (28.1 µs vs 31.6 µs), but p99
overhead nearly doubles: **268.6 µs pinned against 156.2 µs unpinned.** A pinned
worker cannot step aside when Move's audio thread lands on its core; an unpinned
one migrates. Leave placement to the scheduler.

**Calibration by a single sample is a trap.** One run reported a 208 µs serial
baseline against a 363 µs request, then computed "overhead −28.6 µs" — nonsense.
A preemption during the one timed calibration pass read as "the machine is
slow", the batch was scaled down to compensate, and every later figure was
measured against the wrong workload. Calibration now takes the minimum of five
trials (interference can only add time), and the overhead figure divides the
*measured* serial baseline rather than the requested one, so a calibration miss
can no longer hide.

## What this does NOT settle

- **The tail is not this clean in the numbers that include preemption.** 214 of
  3000 frames were preempted by something above us, and those frames run to
  377 µs at p99 — worse than serial. In the real design most of that disappears,
  because movy's render *is* the audio thread rather than a bystander competing
  with it: a worker at FIFO 69 would be preempted only by `spi0` (FIFO 90),
  whose transfer completes before the render window opens. But "most" is an
  argument, not a measurement, and it can only be measured in situ.
- **In-situ cost.** Everything here is a standalone process. The real thing runs
  inside `render_block` with the real cache state, the real memory traffic, and
  Move's audio engine as the immediate next consumer of those cores.
- **Every correctness hazard in the review** — §2 `chain_get_clock_status` doing
  `fopen`+`malloc` behind a non-atomic gate, §3 per-thread FPCR flush-to-zero,
  §4 the SPSC MIDI ring, §6 same-module chains sharing one `dlopen` mapping,
  §7 `mapped_memory` being live DMA. A cheap join does not make shared mutable
  state safe, and this prototype deliberately touched none of it.
- **Whether 12 chains actually divide evenly.** 2.52× assumes three equal
  shares. Real chains have wildly different costs, so the achievable figure is
  bounded by the largest single chain, not by the mean.

## Recommendation

The mechanism is cheap enough that it is no longer the risk. 21 µs of fixed cost
against a 363 µs render, with the rendezvous itself free and the wake not
growing with load, clears the bar the frame-phase measurement set.

The next thing that can kill this design is the correctness list, not the
performance. That is where the effort should go — specifically §2 and §3, which
are the two that would corrupt audio rather than merely slow it down.

Still do not touch the upstream host spec. The prototype has numbers now, but
they are standalone numbers; an in-situ measurement is what would justify asking
for a threading contract.
