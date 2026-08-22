# Chain balance: do twelve chains actually divide across three cores?

Sequel to `2026-08-22-join-cost-prototype.md`, which priced the fan-out
mechanism (~21 µs fixed, essentially all of it scheduler wake) and closed with
one caveat that could still have killed the design:

> **Whether 12 chains actually divide evenly.** 2.52× assumes three equal
> shares. Real chains have wildly different costs, so the achievable figure is
> bounded by the largest single chain, not by the mean.

That is Amdahl's law with a partition in place of a serial fraction. A static
assignment of chains to workers cannot finish before its largest member. If one
synth were half the set's cost, no number of workers would help, and the
correctness backlog behind parallel render — auditing 65 module repos, §2/§3 of
the schwung review — would not be worth starting.

**Answer: they divide well. 2.98× at three workers, 2.91× after the measured
join cost. The hard ceiling is 3.11×, set by `helm`, and a fourth worker buys
only 0.13× because of it. The design point stands.**

## Tooling

`scripts/measure-chain-balance.sh` + `chcostlog` in the engine
(`engine/crates/movy-dsp/src/chain_cost.rs`).

Every prior benchmark measures the **total** render and divides:
`measure-chain-cpu.sh` takes a slope, `bench-chain-cpu.sh` extrapolates one.
Both also load the *same* module into every chain — the one arrangement
guaranteed to look balanced. Neither can see a distribution, which is precisely
the statistic that decides this.

So the engine now times each `render_block` and accumulates per chain
(`CostMeter`). Two vDSO clock reads against a render costing tens of
microseconds is ~0.02% of the frame, so it is left permanently on: the
distribution only exists in a real mixed set, and a benchmark-only build would
measure a set nobody plays. Reading the report closes the window, which is what
lets the script discard the load-and-warm-up phase.

The script loads a different module per chain, holds a four-note chord in each,
and computes the best makespan by longest-processing-time-first — the standard
greedy, within 4/3 of optimal, and the exact optimum would not move the verdict.

## The result

Twelve chains, four held notes each, 1170 blocks:

| chain | module | mean µs | max µs |
| --- | --- | ---: | ---: |
| ch4 | helm | **803.8** | 1152.6 |
| ch7 | surge | 440.0 | 572.0 |
| ch9 | obxd | 257.0 | 311.6 |
| ch1 | obxd | 256.9 | 299.2 |
| ch3 | noisemaker | 238.5 | 307.9 |
| ch11 | noisemaker | 231.2 | 290.5 |
| ch6 | weird-dreams | 87.0 | 136.2 |
| ch5 | forge | 57.2 | 111.1 |
| ch10 | dexed | 50.1 | 87.4 |
| ch0 | plaits | 36.6 | 63.7 |
| ch8 | plaits | 35.5 | 72.5 |
| ch2 | dexed | 9.9 | 30.7 |

Serial total **2503.8 µs**; largest chain **803.8 µs (32% of total)**.

| workers | makespan | ideal | with 21 µs join |
| --- | ---: | ---: | ---: |
| 2 | 1258.6 µs | 1.99× | 1.96× |
| 3 | **839.3 µs** | **2.98×** | **2.91×** |
| 4 | 803.8 µs | 3.11× | 3.04× |

Three runs agree: serial totals 2454.1 / 2448.3 / 2503.8 µs, three-worker
speedup 2.98 / 2.97 / 2.98×. The spread across chains is 81× (dexed 9.9 µs to
helm 803.8 µs) and the partition absorbs it anyway — twelve items is enough for
greedy packing to work with, which is the real reason this came out well.

**The practical payoff is sharper than the ratio.** The measured work ceiling is
~2000 µs (`docs/chain-cpu-benchmarks.md`). This set costs **2503.8 µs serial —
it does not run today**. At 839 µs it fits with room to spare. The speedup is
not "the same sets, faster"; it is sets that currently overrun becoming
playable.

## Where the ceiling comes from

`helm` alone is 803.8 µs, so no partition can finish sooner than that, and
`2503.8 / 803.8 = 3.11×` is the limit with infinite workers. Three workers reach
2.98× of that 3.11× — within 4% of the best the distribution allows. **A fourth
worker is worth 0.13× and costs another RT thread on a four-core box**, which
the join-cost tail already argued against.

The consequence for the design: the partition is nearly free to get right at
N=3, and the thing to watch is not worker count but a single chain growing past
`total/3`. If a heavier synth than helm appears, the fix is a smarter partition
or splitting one chain across workers — not more workers.

## Two harness bugs found, both of which faked the answer

**Peaks were sampled after the window closed.** The audibility guard reported
plaits silent (peak 0) on chains that were sounding at 10721 during the
measurement — its low-pass gate had simply decayed in the seconds between the
cost read and the peak read. `peaks` is the *last rendered block*, so it has to
be sampled inside the window. Sampling it late made a sounding chain look idle
and would have triggered the "measured on silence" warning on a valid run.

**Held notes do not mean sustained notes.** Several synths decay to silence
while the key is still held — plaits' LPG at its 0.5 default, and dexed at
presets 0 and 5 (measured peaks 0 and 10 of 32767). A 14-second window measured
tails and reported dexed at 13.9 µs. Fixed by shortening the window to sit just
after the strike, and by adding `plaits: decay=1` and `dexed: preset=12` to the
shared prepare table. This is the same class of error as the monophonic-preset
trap already in that table, which is why the table now lives in
`scripts/lib/chain-bench.sh` and is shared with `stress-16-tracks.sh` rather
than being duplicated.

## What this does NOT settle

- **`sounding 9/12`.** dexed's preset write appears to land on one chain and not
  its twin (9.9 µs vs 50.1 µs for the same module and preset) — consistent with
  the known async preset load. It does not move the verdict: the missing cost
  can only *raise* the total while helm stays the maximum, so correcting it
  improves the ratio. But the audibility guard is not yet clean, and the figure
  is a floor rather than an exact number.
- **Whether the partition holds under a changing set.** These are static means
  over one arrangement. Chains are assigned at load time in the design, and
  nothing here measures re-balancing when a chain is loaded or cleared.
- **The per-chain maxima do not compose.** Summing them gives 3486 µs against a
  worst *observed* block of 2951 µs, so the expensive chains do not all peak
  together — but a partition built from means can still be beaten by a block
  where two heavy chains peak at once, and that risk is not quantified here.
- **Everything in the correctness list.** Unchanged from the join-cost
  write-up: §2 `chain_get_clock_status` doing `fopen`+`malloc` behind a
  non-atomic gate, §3 per-thread FPCR flush-to-zero, §4 the SPSC MIDI ring, §6
  same-module chains sharing one `dlopen` mapping, §7 `mapped_memory` as live
  DMA. A well-balanced partition does not make shared mutable state safe.

## Recommendation

Both questions the frame-phase measurement left open are now answered with
numbers: there is capacity (~2.2 idle cores), the mechanism is cheap (~21 µs),
and the work divides (2.91× at three workers, against a ceiling of 3.11×).
Nothing about performance can kill this design any more.

Effort now goes to the correctness list, and specifically to §2 and §3 — the two
that would corrupt audio rather than merely slow it down. §3 (set FPCR per
worker) is one line and has to land before the bit-identical serial-vs-parallel
oracle means anything.

The upstream host spec is still off-limits. What would justify raising it is an
in-situ measurement inside the real `render_block`, which remains unbuilt.
