# WP11: latency and CPU retune — session plan

Master plan: `plans/2026-10-09-standalone-migration.md` → *WP11*. Branch
`standalone-migration`, after WP10 (`fd64619`, ENGINE 0.93.0).

## What is already true (read 2026-10-13, before any change)

- **The pad fast path exists.** `host/audio.c` gathers the frame's input
  (hardware RX, inject ring, test bus, UI ring) and calls `engine_on_midi` for
  every note **before** that frame's `engine_render`; the engine answers pads
  from its pushed pad map (`engineOwnsPads`, c72ec62), with
  `padsPlayNotes()` (`src/seq/router-pads.ts`) handing them back to the UI only
  in Session view. `padlat` (`pad_latency.rs`) reads **1 block, max 1** in the
  WP7 and WP10 tables. WP11's first bullet ("tick + frame" → "≤ 1 frame") was
  delivered by WP6; this WP only re-measures and documents it.
- **Thread layout on device** (movy-host pid 1236, uptime 1:54):

  | thread | policy / prio | cores |
  |---|---|---|
  | `movy-host` (main, the UI) | OTHER | 0-3 |
  | `movy-log` | OTHER | 0-3 |
  | `movy-audio` | FIFO 70 | 3 |
  | `movy-render0`, `movy-render1` | FIFO 68 | 0-2 |
  | **`movy-audio` (tid 1381)** | **OTHER** | **3** |

  The last row is not the audio thread: it is a thread the engine spawned
  *from* the audio thread (the set saver's worker, `set_saver.rs:477`, is the
  candidate), so it inherited the name and the core-3 pin. It does file I/O on
  the audio core and only runs when the audio thread sleeps.
- `render_pool.rs` `configure_thread`: helpers at FIFO 68 "below Move's own
  FIFO 70 workers" — those workers no longer exist. The audio thread is pinned
  to core 3 and the helpers to 0-2, so the two never share a core and the
  priority between them is moot.
- `chain_slots.rs` `LANES = 3`: a fourth lane was swept and lost **because the
  helpers competed with Move's FIFO 70 workers** — the reason is gone.
- `src/seq/cpu-page-vm.ts` `USABLE_BLOCK = 0.70`: calibrated on overtake, where
  ~8 % of the block was Move's own engine. Needs re-measuring on movy-host.
- Every `scripts/measure-*.sh` except `measure-ui-ipc.mjs` drives the overtake
  host (`lib/test-set.sh`, `ep`, `Frame(us)` from the shim) and cannot run.
- Carried from WP7: chain-load slow frames (35–40 ms at an open, dlopen on the
  audio thread; `load_queue.rs` header says moving loads off the audio thread
  needs a lock-free handshake around chain state).

## Tasks

- **T1 Pad path — measure and document.** Re-run `measure-ui-ipc.mjs`; record
  `padlat` in `docs/track-performance.md` §6/§8 as the delivered number; update
  `docs/pad-to-sound-latency.md` (its budget is the shim's).
- **T2 Thread placement.** Engine threads spawned from the audio thread get a
  name and cores 0-2 (`set_saver`, any other `thread::spawn` reached from
  `render`/`set_param`); a host test or a `/proc` check in a scenario that no
  movy thread other than `movy-audio` is pinned to core 3. Rewrite the
  priority comment in `configure_thread`.
- **T3 Lane sweep.** Make the lane count a startup flag (pool is built once in
  `configure`), port `measure-chain-balance.sh` to node on the standalone
  transport (mixed 12-chain set, `chcostlog`, `chwall`, `work_avg/max_us`),
  sweep 3 vs 4 lanes, set the default from the numbers.
- **T4 CPU meter recalibration.** movy-host counts late frames (interval
  between SPI transfers > 1.5 × 2902 µs) in `STATE`; a node port of
  `measure-work-ceiling.sh` ramps load until late frames appear; set
  `USABLE_BLOCK` from the measured edge and rewrite its comment.
- **T5 Chain-load slow frames.** Break down the 35–40 ms (chain host dlopen vs
  module dlopen vs `create_instance` vs state). Cheap candidate: dlopen the
  `.so` off the audio thread first so the audio-thread dlopen is a refcount
  bump. Ship only if it is that cheap; otherwise record the breakdown and leave
  it.
- **T6 Scripts and docs.** Delete the overtake-only `measure-*.sh` that T3/T4
  replace (same commit as the replacement); `track-performance.md` §9 WP11
  section; the master plan's WP11 status line.
- **T7 Gates.** `npm test`, `cargo test`, the device tier, commit, push.

## Outcome

Done 2026-10-13 (branch `standalone-migration`, ENGINE 0.94.0). Numbers:
`docs/track-performance.md` §8 *WP11*.

- **T1** pad: 1 block, max 1 (20/20). Documented in `pad-to-sound-latency.md`.
- **T2** `threads.rs` (`leave_audio_core`): render helpers and the saver
  (`movy-saver`) stay off core 3. Found beyond the plan, from the user's note on
  modules with their own threads: **osirus forks its DSP from the chain load and
  inherited core 3 + FIFO 70**, ~200 late transfers per 3.2 s with one Virus.
  `host/placement.c` moves any task pinned to core 3 alone (ours or a child's)
  to 0-2 once a second: 0-2 late. minijv's `jv880-emu` was already on 0-2.
- **T3** `chlanes` (diagnostic) + `measure-render-pool.mjs lanes`: four lanes
  win on every set measured; `LANES = 4`.
- **T4** late transfers: an overrun never skips a frame, it slows the block
  rate (293.7 Hz at 2963 µs of work), so the 1.5-frame first cut was blind —
  caught by an arm that ran at serial cost with `late=0`. Now gap > frame +
  1/16. `USABLE_BLOCK` 0.70 sits in the measured bracket (0.65 clean, 0.76
  late) and stays, with its reason rewritten.
- **T5** not shipped: chain loads on the audio thread. The slow-frame log now
  splits render from params (surge load 237 ms inside render; chain host 23 ms;
  a state restore 25 ms). Moving loads off the audio thread is an engine design
  of its own (lock-free hand-over, same-module load-vs-render).
- **T6** `measure-chain-balance.sh` and `measure-work-ceiling.sh` deleted for
  `measure-render-pool.mjs`, which refuses osirus/minijv in a ramp or twice in a
  set (the user: several instances can take the box down).
- Harness: `pidof movy-host` also lists a module's forked child (same
  executable), so the transport TERMed osirus's child and waited 12 s for a host
  never asked to stop. `HOST_PIDS` matches the main thread's name.
- The Linux-container run of `test-host-linux.sh` fails the boot-door checks
  with and without this change (pre-existing, container-only); the native host
  suite and every unit test under glibc pass.
