# Frame phase: where Ableton's threads actually run

Measurement taken 2026-08-21 on device, to settle the question §5 of
`2026-08-21-parallel-chain-render-schwung-review.md` raised and could not
answer: **at the instant movy renders, are the other cores free?**

The existing number (`measure-core-contention.sh`: +12% / +24% as aggressor
cores are added) does not answer it. That ramp measures steady-state bandwidth
pressure from `dd` at normal priority. The parallel design fails or succeeds on
something else entirely — whether Move's own three `SCHED_FIFO` 70 audio
workers happen to be running *in the same sub-window* where movy's workers
would need a core. A thread at FIFO 70 does not share; it preempts.

**Answer: they are free. Move's worker pool runs strictly *after* movy's
render, not beside it, and ~2.2 of the 3 non-SPI cores are idle for the whole
of movy's render window.**

## Tooling

`scripts/measure-frame-phase.sh` + `scripts/lib/frame-phase.mjs`.

Kernel `sched_switch` tracepoint via ftrace, as root. No rebuild, no code in
the audio path, no shim change — the only cost is ~1 µs per context switch. The
analyzer reconstructs per-core occupancy and bins it by phase offset within the
frame.

`perf` is present but `perf_event_paranoid=2` and tracefs is unmounted, so
ftrace under `/sys/kernel/debug/tracing` (root) is the working route.

## Frame anatomy

The audio thread blocks **twice** per frame, and the two blocks mean different
things. Getting this wrong is easy and wrecks every number downstream — keying
"frame start" off any `Audio Main/SPI` switch-in reports 1873 Hz, and off any
block reports 705 Hz, against a true 344.6 Hz.

```
t+0      switch IN                    <- ioctl wakes from the period sleep
t+18     switch OUT prev_state=D      <- SPI transfer submitted, DMA wait
t+405    switch IN                    <- ioctl RETURNS. post_transfer begins.
t+1478   switch OUT prev_state=S      <- callback done, sleeps to the next tick
t+2901   switch IN                    <- next frame
```

Measured: period p50 **2901 µs (344.7 Hz)**, ioctl DMA wait p50 **387 µs**,
pre p50 **18 µs**.

Phase 0 in every table is the wake after the `D` block — the ioctl returning,
which is the instant `shim_post_transfer` starts and therefore the instant
movy's `render_block` starts.

This reconciles exactly with schwung's own `Frame(us)` log line, which reports
`ioctl` as one number spanning both blocks: `pre 374 + ioctl 2068 + post 198 =
2640`, against ftrace's `18 + (1760 S + 387 D) + [post + Move audio + next
pre]`. Two views of the same frame.

## The result

Load was 0, 6, then 12 plaits chains, 4 held notes each, driven through
`scripts/engine-param.mjs`. 2 s capture each, ~690 clean frames per run.

| chains | schwung `post` | Move's worker pool starts | ends | free cores during movy's render |
| --- | --- | --- | --- | --- |
| 0 | — | 66 µs | 269 µs | — |
| 6 | 198 µs | 259 µs | 499 µs | 2.25 – 2.38 |
| 12 | 363 µs | 425 µs | 663 µs | 2.03 – 2.37 |

The worker start tracks movy's render duration to within a few µs:

```
 0 chains:  66                    = 66
 6 chains:  66 + 198  = 264   vs  259 measured
12 chains:  66 + 363  = 429   vs  425 measured
```

That is not a correlation, it is the mechanism. movy's `render_block` and
Move's own audio engine run in the **same callback, one after the other**:
schwung's `post_transfer` calls the overtake DSP first, then returns into
Move's audio code, which only then fans out to its three workers. Move's pool
*cannot* be running during movy's render, because Move has not been given the
CPU back yet.

Per-core occupancy, 12-chain run (0 = movy starts rendering):

```
phase(us)   cpu0       cpu1       cpu2       cpu3        free
0-50        40         76         24         58          2.03
100-150     44         77         25         35          2.19
200-250     39         75         19         32          2.36
300-350     38         76         20         30          2.36
400-450     63         84         54         69          1.31   <- Move's pool wakes
450-500     98         98         98         98          0.08   <- saturated
550-600     99         99         99         99          0.05
700-750     78         93         76         58          0.94
```

One of the four cores is the SPI thread itself (it migrates between runs, which
is why no single column reads 100%). So of the **3 remaining cores, ~2.2 are
idle** for the entire span movy renders in, and they stay idle right up to the
moment movy hands back.

## What this means for the parallel design

**The capacity is there.** ~2.2 free cores across movy's render window supports
the 2–2.5× the original proposal claimed. The window also *grows with movy's own
load*, since Move's pool is pushed later by exactly the amount movy spends —
so the headroom does not shrink as chains are added, which is the case that
matters.

**The priority sandwich in review §5 is much weaker than it looked.** That
argument was: workers above FIFO 70 preempt Move's audio, workers below it get
preempted and stall the join. It assumed Move's FIFO-70 threads were live
during our window. They are not. The scheduling facts, read off the same trace:

- `Audio Main/SPI` and the three `Audio Worker` threads: prio 29 (FIFO 70).
- `spi0`: prio 9 (FIFO 90). `irq/27`, `irq/28-DMA IRQ`: prio 49 (FIFO 50).
- `ksoftirqd/*`: prio 120 — normal, not RT, despite PREEMPT_RT.

A worker at FIFO 69 would be preempted only by `spi0` and by Move's own audio
threads, and the latter are asleep for the whole window. Lower numeric prio =
higher priority, so the DMA IRQ threads at 49 sit *below* the audio thread at
29 and are not a threat either.

**Preemption of the render stretch is currently nil.** `post on-cpu` equals
`post wall` to the microsecond (1073 µs / 1073 µs at 12 chains) — the audio
thread is never descheduled mid-callback. So there is no existing jitter source
that a join would inherit.

## What this does NOT settle

The measurement was aimed at one question and answers only that one. Untouched:

- Every correctness hazard in the review — §2 `chain_get_clock_status` doing
  `fopen`+`malloc` behind a non-atomic gate, §3 per-thread FPCR flush-to-zero,
  §4 the SPSC MIDI ring, §6 same-module chains sharing one `dlopen` mapping,
  §7 `mapped_memory` being live DMA. Free cores do not make shared mutable
  state safe.
- Fan-out/join cost itself. ~2.2 free cores is capacity, not throughput: futex
  wake + join overhead per block at 344 Hz is unmeasured, and it is charged
  against a 363 µs render. A prototype has to measure it, not assume it.
- The tail. p50 free-core figures are steady; the p99 frame is what drops audio,
  and a 2 s capture at 344 Hz is ~690 frames — enough for p95, thin for p99.
- §8's composition hazard with upstream's in-flight off-thread `create_instance`
  work is unaffected by any of this.

## Recommendation

The measurement that could have killed the design did not. Capacity and
scheduling both check out, and the free window scales with movy's own load.

Next step is a throwaway prototype that measures **fan-out/join cost only** —
N threads, a fixed synthetic workload, no chain state touched — to price the
mechanism before any of the correctness work in the review is attempted. If
join overhead eats a meaningful share of 363 µs, the design dies cheaply there
instead of after the shared-state audit.

Do not touch the upstream host spec yet. The threading contract being drafted
for schwung's residual 2.6 is worth influencing, but only with a prototype's
numbers behind it.
