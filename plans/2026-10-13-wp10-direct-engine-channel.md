# WP10: a direct UI↔engine channel — plan

> Session plan for WP10 of `plans/2026-10-09-standalone-migration.md`. Read the
> master plan's *Global constraints* and WP10 first.

**Goal (master plan):** replace the string `status` poll with a snapshot the
engine publishes every block (seqlock, lock-free read). Commands go through an
ordered queue, which retires the `#<seq>` dedupe, `param.ts`'s refused/timeout
accounting, the chain-payload retry and the `ping` reload loop. movy-host loads
exactly the `dsp.so` it shipped, so a version mismatch is a startup error. Keep
`cmd` semantics, and measure IPC with `perf_ipc` before and after.

**Starting point (2026-10-13, `1c29dc4` on `standalone-migration`):** device
tier 22 scenarios / 160 checks green, engine 0.92.0.

## What is already true

- **The queue exists.** WP6's `host/param_queue.c` is a FIFO with one record
  per request (mutex with priority inheritance, held only to link or unlink),
  serviced by the audio thread before each render. A set that nobody waits for
  is never lost and never reordered against a later get. So the transport
  half of WP10 is already done, and what is left is deleting the workarounds
  that assumed a lossy single slot.
- **Each blocking get costs a frame.** The audio thread answers at its next
  frame boundary, so a `status` get blocks the UI tick for up to 2.9 ms. Under
  `perf_ipc`, `mget status` is about 0.3 ms a tick averaged over a poll every
  8 ticks.

## Decisions

1. **movy-host publishes the snapshot, not the engine.** Decision 2 of the
   master plan keeps the Rust engine an unchanged `plugin_api_v2` plugin. The
   audio thread calls the engine's own `get_param("status")` after each
   render and writes the result into a seqlock buffer
   (`host/status_snap.c`). The UI reads it with no queue and no wait. If the
   per-block cost measures above about 20 µs, publish every second block.
2. **`status` becomes a pure read.** `unop` was drained by the read, and a
   host reading every block would swallow it before a late UI tick saw it.
   The engine now reports the latest no-op group id on every status, and the
   UI acts when the id changes. This is an engine change, so ENGINE_VERSION
   is bumped.
3. **"Has the engine spoken since I asked" becomes exact.** Today
   `statusSeq()` counts polls, which is a proxy. movy-host counts the
   requests it has queued (`submitted`) and stamps each snapshot with the
   number it had serviced before that render (`served`). Because the queue is
   FIFO, `snapshot.served >= mark` means every request up to `mark` is in the
   engine. `set-settle.ts` uses this instead of the poll count.
4. **Sets don't wait.** `paramSet` / `paramSetMany` enqueue and return.
   `false` now means only "no engine is loaded". The refused counters, the
   `IPC n` readout on the CPU page and the per-call timeouts go. Gets still
   block, because they need an answer.
5. **`cmd` goes out once.** No pending batch and no `#<seq>` tag. The engine's
   `apply_batch` tag parsing and `last_cmd_seq` go with it.
6. **Boot is one question.** movy-host loads its own `dsp.so` before the UI
   starts. The UI asks `ping` once: a match means ready; a different version
   means `ENGINE MISMATCH`, a broken install, shown on the failure screen with
   no reload loop; no answer means `ENGINE DID NOT START`. The host's `load` /
   `unload` keys go, since nothing sends them any more.
7. **The chain document is delivered once.** `chain-persist.ts` loses its
   retry.

## Tasks

- **T0 Baseline.** Restore WP7's measurement as `scripts/measure-ui-ipc.mjs`
  (one host, the fixture playing): tick rate, `perf_ipc` ipc/tick/period
  medians, `chwall`, frame work. Record the numbers here.
- **T1 Engine.** `unop` persistent (decision 2) and the batch tag removed
  (decision 5). Cargo tests lead.
- **T2 Host.** `status_snap.c` (seqlock, served stamp), `submitted` count,
  a non-waiting bulk set, and the `load`/`unload` keys removed. JS globals
  `movy_engine_snapshot()` → `{ seq, served, text } | null` and
  `movy_engine_submitted()`. C tests lead (seqlock under a concurrent writer;
  served/submitted ordering).
- **T3 UI.** Add `engineSnapshot` and `engineMark` to the platform. Rewrite
  the boot, status and flush parts of `engine.ts`; `param.ts` sets become
  non-blocking; `set-settle.ts` uses the mark; `chain-persist.ts` loses its
  retry; the CPU page loses its refusal readout; the mock engine serves
  snapshots. Logic tests lead.
- **T4 Docs.** `movy/CLAUDE.md` hard rules ("engine sets are blocking"),
  `docs/standalone/movy-host.md`, the `param.ts` header,
  `docs/track-performance.md` §8 (after-numbers), and the master plan's WP10
  status line.
- **T5 Gates and after-numbers.** `npm test`, `cargo test`, the device tier,
  then `measure-ui-ipc.mjs` again.

## Baseline (T0)

`node scripts/measure-ui-ipc.mjs`, 2026-10-13, engine 0.92.0 at `1c29dc4`, the
fixture playing, two runs (identical but for ±1 in the last digit):

| | before | after (every block) | **after (every 3rd block, shipped)** |
|---|---|---|---|
| UI tick rate | 380 Hz | 430 Hz | **420 Hz** |
| `perf_ipc ipc_ms` (UI blocked in IPC, per tick) | 0.7 ms | 0.4 ms | **0.4 ms** |
| `tick_ms` | 2.1 ms | 1.8–1.9 ms | **1.9 ms** |
| `period_ms` (the MIDI sampling interval) | 2.6 ms | 2.3 ms | **2.4 ms** |
| chains render wall | 56–57 µs | 59 µs | **58–59 µs** |
| audio frame work avg / max | 108 / 250–255 µs | 157 / 285–288 µs | **122–123 / 267–284 µs** |
| pad to sound | 1 block (max 1) | 1 | **1** |

The per-call breakdown (a `perf_ipc` line): `mget status n=0.1 ms=0.3 | bget
overtake_dsp:* n=0.1 ms=0.3 | mget ch0:* n=0.1 ms=0.2`. The status poll is the
largest single cost: each get waits for the next frame boundary.

**After:** `mget status` is gone from the breakdown; the snapshot read shows as
`snap n=0.3 ms=0.0` (a copy, no wait). Publishing every block cost the audio
thread ~49 µs a frame (the engine formats ~1.5 KB of status text), past the
20 µs line in decision 1, so the host publishes every third block (~115 Hz,
above the UI's ~107 Hz parse rate): +14 µs a frame on average, 0.5 % of the
2902 µs budget. Freshness is ≤ 8.7 ms against the old poll's ≤ 42 ms.

## Outcome

Done 2026-10-13 (branch `standalone-migration`, ENGINE 0.93.0). Beyond the
plan: `pushState`'s 3× retry and the chain payload's 20-attempt retry were the
same lossy-slot workaround and went with the rest; `TrackPort.setParamTimeout`
went too (every write is queued). The re-dlopen recovery tests (engine
generation 2, R6, the watch re-teach) are retired: movy-host never reloads the
engine, so there is nothing for them to recover from.

Found on the way: the device tier failed `seq` (after `versions`) on all three
attempts with `ECONNREFUSED`. A press sent while movy-host was still starting
had its connect refused, and by the time the transport asked `running()` the
bus was up, so the refusal was rethrown as a lost link. A pre-existing harness
race the faster start exposed; a refused connect now counts as "not up yet"
(`selftest/standalone-launch.mjs`).

Gates: `npm test` green; `cargo test` 398 + 308 green; device tier 22
scenarios / 160 checks, 0 failed.
