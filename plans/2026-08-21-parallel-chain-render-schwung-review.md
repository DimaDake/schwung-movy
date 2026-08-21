# Parallel chain render — what schwung's code and history say

**Date:** 2026-08-21
**Companion to:** `plans/2026-08-16-parallel-chain-render.md` (the proposal)
**Question asked:** why did schwung run on one CPU in the first place, and what
does its codebase/history know about parallel render that the proposal doesn't?

Everything below is cited to a file:line or a commit. Where something is
*unmeasured* it says so — that distinction matters more than usual here, because
the proposal's headline number rests on a measurement that answers a
neighbouring question.

---

## 1. schwung never decided to use one CPU. It decided to keep core 3 clear.

There is no commit where anyone chose serial DSP. Serial DSP is what falls out of
the architecture:

- schwung is an `LD_PRELOAD` sidecar inside MoveOriginal that hooks **`ioctl`**
  on `/dev/ablspi0.0` (`docs/ARCHITECTURE.md`, Layer 2). All DSP runs wrapped
  around that one syscall, on whichever thread issues it — Move's `Audio
  Main/SPI`. There was never a schwung-owned audio thread to fan out *from*.
- That thread is **SCHED_FIFO 90, pinned to core 3** (`docs/REALTIME_SAFETY.md`
  §"System Architecture"; the pin is the driver's, mask `0x8`).

The real decision, and it *is* explicit and repeated, is the opposite of
parallelism: **nothing of schwung's may run at RT priority next to the audio
thread.** Every thread schwung owns is either SCHED_OTHER or deliberately
*below* Move's own threads, and pinned to cores 0-2:

| thread | scheduling | where |
|---|---|---|
| shim worker | SCHED_OTHER, cores 0-2 | `src/host/shim_worker.h:95` |
| remote-snapshot worker | **FIFO 10**, cores 0-2 | `src/schwung_shim.c:3996-4012` |
| trace exporter | SCHED_OTHER, cores 0-2 | `src/host/schwung_trace.c:493-505` |
| shadow_ui | SCHED_OTHER, cores 0-2 | `src/host/shadow_process.c:358-372` |
| link-subscriber | SCHED_OTHER, cores 0-2 | commit `8592be5c` |

And every time an RT-priority thread *did* appear beside the audio thread, it was
logged as a bug and removed:

- `8592be5c` — link-subscriber inherited FIFO 70 across all four cores from the
  fork; "squatting on core 3". Fixed to `SCHED_OTHER/0/mask=7`.
- `25b72907` — `shim_run_command` children inherited FIFO 90; the whole shim
  worker exists so the SPI path stops doing file I/O and `system()`.
- `docs/REALTIME_SAFETY.md` §"Root Causes Found" — shadow_ui, host_system_cmd
  children, `jack_midi_connect` and RNBO all inherited FIFO 70 and caused audible
  glitches. RNBO threads landing on core 3 were fixed by `taskset 0x7`.
- `docs/plans/2026-08-21-create-instance-thread-spike.md` §2 — seven fleet
  modules `pthread_create` inside `create_instance` and therefore inherit FIFO 90
  today. Recorded as an undeclared defect, and cited as a *reason to move
  creation off the SPI thread*.

The doc states the rule flatly: **"Never let child processes inherit FIFO
scheduling from the shim"**, **"Never pin compute threads to core 3"**.

So the proposal's §3 line — *"Workers inherit the audio thread's RT priority"* —
is not a small implementation detail. It is the first thing schwung has ever
proposed doing that its own realtime doc forbids, and §5 below is why that is not
just a style objection.

### The other half of the answer: the plugin API has no thread contract

`grep -ci thread src/host/plugin_api_v1.h` → **0**. The word does not appear.
`create_instance`, `render_block`, `on_midi` and `set_param` have never been told
what thread they run on, how many of them may run at once, or what is shared. The
2026-08-21 spike says the same thing about the realtime side: *"the plugin API has
no realtime contract — `create_instance` may do anything, most modules ship
outside this tree, and the cost is therefore unbounded and unknowable from here."*

65 module repos were written against an implicit "one thread, one at a time, in
slot order" that nobody wrote down and nothing has ever violated. Parallel render
changes that contract silently, for code movy does not own.

---

## 2. `chain_get_clock_status` does file I/O and `malloc` in the render path

**This is the sharpest single finding, and the proposal's §4 audit would miss it,
because it is not a global in the chain host — it is a callback the chain host
hands *down* to every sub-plugin.**

`chain_host.c:82-86` builds each chain's sub-plugin vtable by
`memcpy`ing schwung's whole `host_api_v1_t` and overriding four members:

```c
memcpy(&inst->subplugin_host_api, g_host, sizeof(host_api_v1_t));
inst->subplugin_host_api.get_clock_status = chain_get_clock_status;
```

`chain_get_clock_status` (`chain_midi.c:85-87`) calls
`chain_refresh_clock_output_enabled`, which on a 1-second gate
(`CLOCK_SETTINGS_REFRESH_MS`, `chain_internal.h:59`) does:

```c
static void chain_refresh_clock_output_enabled(uint64_t now_ms) {
    if (now_ms < g_clock_next_refresh_ms) return;      /* plain read  */
    g_clock_output_enabled = chain_read_clock_output_enabled();
    g_clock_next_refresh_ms = now_ms + CLOCK_SETTINGS_REFRESH_MS;   /* plain write */
}
```

and `chain_read_clock_output_enabled` (`chain_midi.c:17-76`) is
`fopen("/data/UserData/settings/Settings.json")` + `ftell` + `malloc(size+1)` +
`fread` + `fclose` + `free`.

Three separate problems appear the moment two clock-aware chains render
concurrently:

1. **The rate gate is not atomic.** N workers crossing the 1 s boundary in the
   same block all read the stale `g_clock_next_refresh_ms`, all pass, and all do
   the file read. The gate's entire job is to make this happen once; parallelism
   multiplies it by the number of clock-aware chains, *into a single audio block*.
2. **`g_clock_output_enabled` / `g_clock_next_refresh_ms` are plain globals**,
   written from render, with no atomics. `g_clock_last_tick_ms` and
   `g_clock_transport_running` are worse: written from `on_midi` (pre-ioctl, SPI
   thread) and read here from render (workers) — a genuine cross-window race,
   currently impossible by construction.
3. **It is blocking I/O in the SPI callback path**, which `REALTIME_SAFETY.md`
   rule #1 forbids outright. It survives today only because it is rare and
   serialized.

Clock-aware modules are exactly the ones this path is for — arps, tb3po,
breakbeat, Beat Bank. movy has its own private `dsp.so` copy
(`chain_copy.rs`), so these globals are movy-private and shared across
movy's twelve chains: this is movy's race to hit, not schwung's.

---

## 3. Flush-to-zero is per-thread, and only the SPI thread has it

`src/schwung_shim.c:5013-5027`:

```c
/* Flush-to-zero denormals on the SPI thread so IIR filters (speaker EQ,
 * subsonic HP, etc.) don't grind through gradual-underflow range during
 * long silent tails. FPCR is per-thread — set once on first callback.
 * aarch64 FPCR bit 24 = FZ */
static int fpcr_fz_set = 0;
if (!fpcr_fz_set) { ... msr fpcr ... fpcr_fz_set = 1; }
```

A render worker is a new thread, so it starts with **FZ off**. Two consequences,
pulling in opposite directions:

- **Performance.** Denormal grinding hits decaying IIR state — reverb tails,
  filter tails, released envelopes. That is the FX-heavy, tail-heavy workload the
  parallel render exists to make affordable. A worker could be *slower per chain*
  than the serial path it replaces, and the regression would be
  preset-dependent and intermittent, which is the worst shape of bug to chase.
- **The test oracle.** §5 of the proposal promises a **bit-identical**
  serial-vs-parallel comparison ("the mix is integer, so this is exact — no
  epsilon"). FZ changes results. That test will fail — correctly — as soon as any
  chain has a decaying tail, and will pass on a plucky lead, so it can also
  quietly *not* catch it. The one-line fix (set FPCR in each worker's entry) has
  to land before the oracle means anything.

---

## 4. Two of the three MIDI-out callbacks are not multi-producer

The chain's sub-plugin vtable is a verbatim copy of schwung's (`chain_host.c:82`),
so every module in every movy chain holds schwung's real `midi_send_internal`,
`midi_send_external` and `midi_inject_to_move`. And MIDI *is* emitted from render:
`chain_host.c:1880` `v2_render_block` calls `v2_tick_midi_fx(inst, frames)`, which
is the arpeggiator/clock-generator tick, and that reaches the Pre-mode inject
path (`chain_midi.c:602-622`, `:832`). The spike doc independently notes tb3po's
`send_midi` is "reached only from the step sequencer in `render_block`".

| callback | shape | verdict under N producers |
|---|---|---|
| `midi_inject_to_move` → `shadow_midi_inject_push` | bounded **MPSC** (Vyukov per-slot-seq), `shadow_constants.h:518-571` | **safe.** But the doc comment at `shadow_midi.c:740` still claims "Same-thread as the drain … so no extra synchronization is needed" — stale, and it is what a reader would check. |
| `midi_send_external` → `overtake_midi_send_external`, `schwung_shim.c:1404-1428` | **SPSC.** `volatile uint32_t head` with a plain `head = head + 1`; the comment says "producer writes (**any** audio thread)" meaning *one* | **unsafe.** Two workers claiming the same slot lose or duplicate packets and desynchronise `head`. |
| `midi_send_internal` → `overtake_midi_send_internal`, `schwung_shim.c:1356` | calls `shadow_chain_broadcast_realtime` / `shadow_chain_dispatch_midi_to_slots`, plus a `static int midi_log_count` | **unsafe, and worse than a ring.** This dispatches into **schwung's own four chain slots'** `on_midi` — instances the SPI thread also touches pre-ioctl. A movy worker would be calling into schwung's slot state from a second thread. |

---

## 5. There is no safe priority for the workers, and the contention number
doesn't answer the question that decides it

> **RESOLVED 2026-08-21 by measurement — see
> `2026-08-21-frame-phase-measurement.md`.** The question below ("are Move's
> FIFO-70 threads live in the same sub-window as our workers?") was measured
> with ftrace `sched_switch`. They are **not**: movy's `render_block` and Move's
> audio engine run in the same callback, movy first, so Move's worker pool
> cannot start until movy hands back. Its start time tracks movy's render
> duration to within a few µs across 0/6/12 chains. ~2.2 of the 3 non-SPI cores
> are idle for the whole render window, and the window grows with movy's own
> load. The sandwich argument in (a) below therefore does not bite: a worker at
> FIFO 69 is preempted only by `spi0` (FIFO 90) and by Move's audio threads,
> which are asleep throughout. The rest of this section is kept for the
> reasoning; treat (a) as answered and (b) as still open.

The proposal's §3 puts workers at the audio thread's RT priority, and prices
contention from `measure-core-contention.sh` (§7 of `docs/track-performance.md`):
1 busy core costs +12%, 2 cost +24%, saturating at 3; interpolated to Move's 0.56
core of off-thread load, ~7%.

That measurement is sound for what it measures — **shared-L2 and
memory-controller pressure from steady-state `dd` aggressors at SCHED_OTHER.** It
does not measure either of the two things that decide whether RT workers are
viable:

**(a) Scheduling preemption, in both directions.** Move runs three `Audio Worker`
threads at **FIFO 70**, plus `Link Main` at **FIFO 35**
(`docs/plans/2026-08-21-create-instance-thread-spike.md` §2, and the per-thread
table in `track-performance.md` §7).

- Workers *above* 70 preempt Move's own audio render and Link. schwung already
  has this bug on file twice: `link_audio_producer_burst_dropouts` is literally
  "our DSP is 70, Link Main is 35, and it starves", and `8592be5c` is a sidecar
  that inherited 70 and had to be dropped to SCHED_OTHER.
- Workers *below* 70 get preempted mid-block by Move's audio workers, and the
  join on the SPI thread absorbs the stall — one late worker blows the frame for
  all twelve chains, which is strictly worse than serial.
- There is no gap to sit in. `dd` at SCHED_OTHER, which is what was measured,
  never exercises either edge.

**(b) Whether Move's workers are busy in the *same sub-window*.** The three
Audio Workers are ~7.5% of a core each *averaged over the frame*. Nobody has
measured **when inside the 2902 µs frame they run**, and Move's pipeline is driven
by the same SPI cadence, so "shortly after the transfer" — the exact window a
render worker wants — is the likely answer rather than an unlikely one. If they
burst in that window, effective parallelism is closer to 2 cores than 3, and the
+12%/+24% steady-state curve understates it.

Two smaller caveats on the same numbers, both stated in the docs and worth
re-reading in this context: every figure was taken with **movy closed and Move's
transport stopped**, and `top`'s per-thread sampling is a frame average, not an
occupancy trace.

**What would actually settle it:** a scheduler trace (or `schwung_trace`, which
already emits per-thread spans on a shared timebase — `docs/tracing.md`) showing
where Move's three FIFO-70 workers sit relative to the ioctl return. That is a
measurement, not an argument, and it is cheap next to the implementation.

---

## 6. Same-module chains share one mapping — a sharper version of §4 of the plan

The proposal's §4 says "all twelve movy chains share **one** private `dsp.so`
copy" and audits the chain host's globals. Correct, and the chain host is clean —
`chain_host.c:15` has exactly one file-scope mutable global (`g_host`), and the
modulation bus is instance-scoped (`mod_host_ctx = inst`, `chain_host.c:86`).

But the sharing goes one level deeper than the plan states. `chain_host.c:438`
loads each synth with `dlopen(dsp_path, RTLD_NOW | RTLD_LOCAL)`. `RTLD_LOCAL`
controls *symbol visibility*, not mapping identity: dlopen'ing the same realpath
twice returns the same handle and the same mapping. So **two chains with the same
module share that module's file-scope state**, which is the common case — two obxd
tracks, two drum racks, two of anything.

`chain_copy.rs` exists precisely because this is true one level up. The plan
inherits the reasoning but not the conclusion.

**Partial audit (11 of 65 fleet repos, the ones checked out locally).** Method
mirrors `schwung/tools/spike/create_instance_audit.py` — resolve
`.render_block = <fn>`, brace-match, transitively expand local calls, report
file-scope mutable statics and host-vtable reaches. Script:
`scripts/audit-render-globals.py`, run from `cld/` (the directory holding the
module repos) — re-run it before relying on the list, the fleet changes under us.

- **Clean:** helm, moog, obxd's own wrapper, davebox, mono-voice, belt-in,
  smack-in — no mutable file-scope state reached from render.
- **forge-move** — `SINE_TABLE` (`src/dsp/forge.c:567`) is shared, but written
  once in an init function and read-only afterward. Safe, and exactly the "shared
  wavetables are fine if read-only" case the plan allows.
- **obxd** — `static Random sysRandom` (`src/dsp/Engine/JuceCompat.h:70-71`), a
  process-wide xorshift RNG mutated by `nextInt64()`. Reached only from voice and
  oscillator construction (`ObxdVoice.h:135,162-166`, `ObxdOscillatorB.h:104`),
  so **latent, not active** — unless schwung's residual 2.6 lands and creation
  moves off-thread too (§8).
- **belt / smack** — `gen_render` reads `g_host->mapped_memory +
  g_host->audio_in_offset` **during render** (`belt_gen.c:32-40`). See §7.
- **granny** — `free()` inside the render path. See §9.

The remaining 54 repos are not checked out here. Given that 2 of 11 do something
in render that a serial-only contract makes safe, "audit the whole fleet before
writing §3" should be read as load-bearing rather than diligence.

---

## 7. `mapped_memory` is live DMA, and serial render is what makes it safe

Modules that declare audio input read Move's SPI mailbox directly through the
host vtable (`belt_gen.c:34`, `smack_gen.c`, and per the create-spike also breath
and performance-fx). Immediately before movy's `render_block` is called, the shim
refreshes that region:

```c
memcpy(sh_ain, hw_ain, AUDIO_BUFFER_SIZE);          /* schwung_shim.c:2076 */
...
overtake_dsp_gen->render_block(overtake_dsp_gen_inst, render_buffer, 128);
```

Today the ordering is guaranteed by there being one thread. With workers, the
region is only stable for as long as every worker is inside the join. That is
fine *if the barrier is absolute* — and it is exactly the thing that breaks under
the natural fallback. schwung's own precedent for a late off-thread operation is
`SHIM_EVT_OVERTAKE_DSP_FREE`, which deliberately **leaks on timeout** because "a
leak is recoverable; a use-after-free in the audio path is not"
(`REALTIME_SAFETY.md`). A render barrier has no equivalent escape: timing out and
proceeding means the next ioctl transfers into a buffer a worker is still
reading, and writes a partially-mixed scratch into the output. Spinning instead
means one descheduled worker stalls the frame.

Worth stating in the plan as a decision, because both options are bad and the
choice cannot be deferred to implementation.

---

## 8. This design and schwung's residual 2.6 each assume the other side is serial

As of **2026-08-21** (commit `592aec1e`, `docs/plans/2026-08-21-create-instance-thread-spike.md`)
schwung is actively building **Design B**: `create_instance` / `destroy_instance`
on a background loader thread. The spike's verdict is "may proceed".

The two designs are mirror images:

| | schwung residual 2.6 | movy parallel render |
|---|---|---|
| loader | **off-thread** | on the audio thread (`load_queue.rs`, one per callback) |
| render | on the audio thread | **off-thread, N workers** |

Each is safe alone because the other half stays on one thread. Together there is
a loader thread plus N render threads and **no exclusion mechanism anywhere** —
and `REALTIME_SAFETY.md` has already written down what that costs on the chain
path specifically:

> The module triple (`handle` / `plugin_v2` / `instance`) is a check-then-call
> over three non-atomic words read from `chain_midi.c` in five places. Off
> thread, a `dlclose` under a reader is a jump into an unmapped segment.
>
> Chain instances are touched on **both** sides of the ioctl — `mix_audio` and
> `forward_midi` before, `render_block` / `shadow_chain_process_fx` after — so a
> worker must be excluded from two windows separated by a ~2 ms blocking call,
> not one.

That paragraph was written about a loader thread. It describes a render worker
exactly as well. And §6's latent obxd `sysRandom` becomes an active race the
moment creation is also off-thread.

**This is a coordination item, not just a risk.** The thread contracts the spike
proposes for `plugin_api_v1.h` (§3 of that doc) are being written *right now*, and
they are the natural place to also say what `render_block` may assume. If movy
wants parallel render, the time to get "your `render_block` may be called
concurrently with another instance's" into that contract is while it is being
drafted, not after.

---

## 9. Smaller items, all real

- **Allocator contention.** `malloc`/`free` appear in the render path in at least
  three places: granny's `free`, `chain_read_clock_output_enabled`'s
  `malloc`/`free` (§2), and movy's own
  `host::log(&format!("chain {}: audio active …"))` at
  `chain_slots.rs:261`. One thread gets an uncontended per-thread arena; N RT
  threads contend, and glibc's arena lock is a plain mutex — an RT thread can
  block on it behind a lower-priority holder. Bounded in practice (the log fires
  once per chain) but it is allocation in an audio callback on a realtime thread,
  which is the thing `REALTIME_SAFETY.md` exists to prevent.
- **False sharing in movy's own loop.** `self.peaks[i]` and `self.audible[i]`
  (`chain_slots.rs:258-260`) are twelve adjacent elements — one or two cache
  lines ping-ponging between workers every block. Cheap to fix (pad, or return
  per-worker and merge at the join) and easy to forget.
- **MIDI ordering becomes nondeterministic.** Serial render injects Pre-mode MIDI
  in chain order within a block. Parallel interleaves it. Per-chain ordering is
  preserved (one worker per chain), so note-on/note-off pairing is safe, but the
  block-level order across chains is no longer reproducible — which matters for
  the bit-identical oracle if any test drives two arps at once.

---

## 10. What to change in the proposal

Not "don't do this". The physics in §2 of the proposal is right — twelve serial
`render_block`s next to three idle A72s is the biggest number on the table, and
Move itself uses three workers for the same job. But three things in the current
draft are load-bearing and wrong or unproven:

1. **§3 "workers inherit the audio thread's RT priority" is the riskiest line in
   the plan, and it is stated as a given.** Make it the first measurement instead
   (§5(b)): trace where Move's FIFO-70 workers actually sit inside the frame, then
   choose. It is cheap and it can kill the design before any code.
2. **§4's audit is aimed one level too high.** Add: (a) the sub-plugin vtable the
   chain host hands down (§2 and §4 above — that is where the file I/O and the
   SPSC ring are), and (b) same-module chains sharing one mapping (§6), which is
   the common case, not the exotic one.
3. **§5's bit-identical oracle does not hold until FPCR is set per worker** (§3
   above). One line, but the test is worthless without it and misleading with it
   half-done.

And one addition: **talk to upstream before writing §3.** The thread contracts
for `plugin_api_v1.h` are being drafted this week for residual 2.6 (§8). A
sentence about concurrent `render_block` costs nothing to add now and is
unenforceable across 65 repos later — which is precisely the argument the spike
doc makes for its own create-forbidden rule.
