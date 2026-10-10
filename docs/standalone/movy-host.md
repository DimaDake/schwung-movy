# movy-host (WP6)

The standalone flavour's C host, in `host/`. It does for movy what the shim and
shadow_ui do in the overtake flavour, and it runs the **same** `ui.js` and
`dsp.so`. Until WP8 it ships only as the dev tool **movy-sa** (never in the
catalog). Plan: `plans/2026-10-09-standalone-migration.md`, WP6.

## Shape

| Thread | File | Job |
|---|---|---|
| main | `ui.c`, `ui_js.c`, `globals*.c` | QuickJS: loads `ui.js`, ticks it on a 2 ms deadline (shadow_ui's overtake period, because the tick is movy's input sampling interval), drains input, batches encoder deltas (`deltas.c`), packs the screen |
| `movy-audio` | `audio.c`, `spi.c` | One `WAIT_AND_SEND` per 128-sample block: MIDI out (≤20 packets), display slices, MIDI in, engine notes, the param queue, `render_block`, audio out with a 0.5 s fade-in |
| `movy-testbus` | `testbus*.c` | `docs/standalone/testbus.md`, only when asked for |

The engine is only ever called from `movy-audio`, or with it locked out
(`vtable.c`), because `plugin_api_v2` modules assume render and set/get never
overlap. Supporting modules:

- `midi_in.c`: SPI mailbox, schwung's inject ring (`inject_ring.c`) and the
  bus's `INJECT_MIDI` are one input. Every packet reaches the UI; cable-0 notes
  with d1 ≥ 10 also reach `on_midi` directly, as the shim's pad path does. It
  also tracks the held step (exactly one, 500 ms tap/hold) and Delete for the
  shared JS's `shadow_get_held_step*` / `shadow_get_delete_held`.
- `midi_out.c`: shadow_ui's LED queue (the last write per note/CC wins and
  keeps its channel) plus a FIFO for everything else (SysEx is all-or-nothing).
- `param_queue.c`: no single slot. Every request has its own record and a FIFO
  place. A write whose waiter timed out is still applied; only an abandoned
  read is skipped. `param_bulk.c` is the shim's bulk codec.
- `display.c`: seqlocked frames, so the XMOS never gets a torn frame. Also
  `/dev/shm/schwung-display-live`, so display-server streams it unchanged.
- `rt.c` + `heal/heal.c`: real-time priority (below).
- `globals*.c`: every name in `browser-test/host-globals.json`, native or a
  logged no-op (`globals_stub.c`, the coexistence family).
  `browser-test/host-globals.mjs` fails when one is missing. `console.log` goes
  to debug.log under the source `shadow`, so `[shadow].*[movy]` greps keep
  working.

The UI tells the hosts apart by the `movy_host` global
(`src/platform/standalone.ts`). The standalone platform reuses the overtake
calls that mean the same thing and switches the Move-only ones off.

## Build, deploy, run

```bash
./scripts/build-host.sh          # dist/movy-host + dist/movy-heal, from the pinned schwung tag
./scripts/deploy.sh --sa         # movy as usual, then movy-sa beside it
bash host/tests/run.sh           # unit tests (part of npm test)
./scripts/test-host-linux.sh     # the same under glibc, in docker
npm run test:device -- --flavour sa --scenario smoke
```

A standalone run leaves the device as it found it: the transport's `close()`
EXITs movy-host. A movy-sa left running holds SPI and port 47777, and the
overtake transport now refuses a port-47777 server that is not schwung-testd
rather than grading through movy-host's bus (which hung a tier for 20 min).

movy-sa holds `module.json` (`standalone: true`, `component_type: tool`),
`standalone` (= `standalone/launch.sh`), `movy-host`, `movy-heal`, and copies
of `ui.js` and `dsp.so`. Its data is the overtake install's: `ui.js` names
`tools/movy` itself (prefs, configs, `chain-host.so`, Sets), and it is the same
user's movy.

`load` from the UI reloads movy-host's own `dsp.so`, never the path the UI
names. That path is the overtake install's, and the engine is the host's to
choose.

## Real-time priority

ableton cannot get `SCHED_FIFO` (WP0 findings §3.1). The launcher re-stages
`bin/heal.new` whenever `bin/heal` is missing, not root 04755, or not the
shipped one, and runs `schwung-heal`, which installs it. movy-host calls
`bin/heal rt <pid> <audio tid>`. The helper touches only a process whose
executable is the `movy-host` beside it: the audio thread by **tid**
(FIFO 70) and `movy-render*` (FIFO 68), plus `RLIMIT_MEMLOCK`. It goes by tid
because a thread spawned from the audio thread inherits its name. Memory is
locked before the audio thread starts: a `mlockall` with audio live stalled one
frame for 85 ms. With no usable helper movy-host runs degraded and says so
(`rt: … DEGRADED`, `STATE rt=other`).

## Measured on device (2026-10-10, schwung 1.7.3)

| | |
|---|---|
| launch (launch-standalone.sh → engine ready) | 3.2–3.3 s, either uid |
| SIGTERM → process exit | 130 ms |
| UI tick rate | ~380 Hz (overtake: 63–205 Hz) |
| engine param round trip | ~0.3 ms average (`perf_ipc`) |
| `smoke` on movy-sa | 13/13, stack as root and as ableton |
| Move back after a root-uid exit | ~3 s |
| Move back after an ableton-uid exit | under 4 s on one run, **~60 s** to shadow_ui on another (MoveOriginal at once, shadow_ui a minute later). Not yet understood |

Uid lessons, each one a bug fixed in this WP. Every file movy-host or its
launcher creates is made usable by the other uid:

- the session lock is opened read-only and made 0666;
- the shm files are made 0666;
- `movy-host.log` is replaced, never reopened;
- `bin/` is handed back to ableton when the launcher runs as root.

A root dev run otherwise locks every later ableton run out.

## Open, carried to WP7

- **Slow frames at chain load.** `chain_host`, `chains`, `padmap` and the
  `mfx:` loads each cost 12–40 ms on the audio thread. The shim services params
  on its SPI thread too, so this is parity, not a regression. Moving loads off
  the audio thread is an engine change (the plan's WP0 note). movy-host logs
  every such frame with its key.
- The rest of the test bus (`LOG_TAIL`, `DUMP`, `UI_EVAL`), restart without a
  Move round trip, the power button, the Leave modal, the volume knob, the perf
  comparison and `--flavour sa` for the whole tier.
- Not done by a person yet: opening movy-sa from the Tools menu by hand (the
  harness runs the same `launch-standalone.sh` the menu does), and a listening
  check (the tier runs muted).
