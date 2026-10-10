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
| `movy-log` | `log_ring.c` | the one writer of debug.log and movy-host.log (below) |

The engine is only ever called from `movy-audio`, or with it locked out
(`vtable.c`), because `plugin_api_v2` modules assume render and set/get never
overlap. Supporting modules:

- `midi_in.c`: SPI mailbox, schwung's inject ring (`inject_ring.c`), the
  bus's `INJECT_MIDI` and shadow_ui's own UI ring (`ui_ring.c`, read with
  schwung's `ui_midi_ring.h` from the pin, so `inject-any.py`, `inject-ui.py`
  and `dev-probe.sh -i` work unchanged) are one input. Every packet reaches the UI; cable-0 notes
  with d1 ≥ 10 also reach `on_midi` directly, as the shim's pad path does. It
  also tracks the held step (exactly one, 500 ms tap/hold) and Delete for the
  shared JS's `shadow_get_held_step*` / `shadow_get_delete_held`.
- `midi_out.c`: shadow_ui's LED queue (the last write per note/CC wins and
  keeps its channel) plus a FIFO for everything else (SysEx is all-or-nothing).
- `param_queue.c`: no single slot. Every request has its own record and a FIFO
  place. A write whose waiter timed out is still applied; only an abandoned
  read is skipped. `param_bulk.c` is the shim's bulk codec.
- `display.c`: seqlocked frames, so the XMOS never gets a torn frame. Also
  `/dev/shm/schwung-display-live`, so display-server streams it unchanged, and
  `/dev/shm/schwung-display` (shadow_ui's frame under the shim), so
  `grab-screen.mjs` and `capture-screen.mjs` work unchanged.
- `log.c` + `log_ring.c`: every line from every thread goes into one lock-free
  4096-line ring, and the `movy-log` thread is the only caller of
  `unified_log`. schwung's `unified_log` drops a line when another thread holds
  its mutex (a trylock, so the audio thread never blocks); under the shim the
  UI and the engine are different processes, here they are one, and a module
  load logging from the audio thread swallowed the UI's `undo: LOAD MODULE`
  (reselect red ~2 runs in 3). The same ring answers `LOG_SEQ`/`LOG_TAIL`, and
  the crash handler writes what the writer has not reached before the
  backtrace.
- `surface_keys.c`: the two gestures movy-host answers below the UI. The
  **power button** (a cable-0 SysEx, `F0 00 21 1D 01 01 3A …`, sent on a hold)
  calls the UI's `onPowerButton`, which asks "Power off?"; confirming calls
  `host_power_off`, movy-host shuts down cleanly (onUnload saves), then
  `power.c` calls `com.ableton.system` `Power.shutDown` over D-Bus — Move's own
  power service, which ableton may call (`/etc/dbus-1/system.d/move.conf`), so
  no root helper. A **DRY RUN** whenever the test bus is on. The **fallback
  exit**, Shift + volume touch + jog click, closes cleanly; if the UI loop has
  not let go 2 s later (a wedged script) the audio thread exits hard (rc 4).
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
EXITs movy-host and releases the launcher.

**Harness mode** (the `testbus` file exists, which a shipped build never has):
after a clean close (rc 0, or 3 for a UI throw) `standalone/launch.sh` does not
return to Move. It holds, Move still down, until the harness writes `go`
(start movy-host again, ~0.5 s) or `quit` into `/dev/shm/.movy-sa-cmd`, or 300 s
pass. A close/open pair is then a process start rather than a Move restart and
a kill sweep: `smoke` went from ~140 s to 17 s, the whole tier to under 8 min.
A lock loser (rc 1) or a floor refusal (rc 2) never holds. A movy-sa left running holds SPI and port 47777, and the
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
| Move back after an exit | 3.6 s, either uid (2026-10-10: 6 runs) |
| "Move took 60 s" | **schwung's boot watchdog** (`host/boot_target_lib.sh`): `/opt/move/Move` counts every start as a boot attempt and clears it once Move has lived 15 s. launch-standalone.sh killing Move inside that window leaves the strike, and the third puts `boot-select --forced` on screen with a 60 s backstop. Reproduced: runs 1–2 at 3.6 s, run 3 at 61.5 s. The transport waits out the 15 s and touches the target's `healthy` file. A person opening a standalone tool three times within 15 s of each return hits it too — upstream (U8) |

Uid lessons, each one a bug fixed in this WP. Every file movy-host or its
launcher creates is made usable by the other uid:

- the session lock is opened read-only and made 0666;
- the shm files are made 0666;
- `movy-host.log` is replaced, never reopened;
- `bin/` is handed back to ableton when the launcher runs as root.

A root dev run otherwise locks every later ableton run out.

## Upstream

U6 [schwung#635](https://github.com/charlesvestal/schwung/pull/635)
(`open_tool_cmd` launches a standalone tool), U2
[schwung#636](https://github.com/charlesvestal/schwung/pull/636) (the two shm
contracts, documented), U1
[schwung#637](https://github.com/charlesvestal/schwung/issues/637) (a
standalone SDK library). Until #635 ships, the harness runs
launch-standalone.sh itself.

## WP7 (`plans/2026-10-10-wp7-standalone-parity.md`)

Done: the launcher hold, the log ring, the rest of the test bus, the volume
knob as master volume, the power button, the fallback exit, the dev tools on
movy-host, and the perf comparison (`docs/track-performance.md` §8). Both
flavours green on the full tier.

Still open:

- **Slow frames at chain load.** `padmap`, `mfx` and `chains` cost 35–40 ms
  each at every open (the dlopen-ing loads), `chain_host` 17 ms. Parity with
  the shim, startup only, under the fade-in. Moving loads off the audio thread
  is an engine change: WP11.
- **Speaker EQ (R8).** Under the shim MoveOriginal's speaker enhancer, and
  schwung's emulation of it, colour the built-in speaker. movy-host has
  neither: a MANUAL limitation for now. schwung's emulation is a static block
  in `schwung_shim.c`; copying it would be vendoring, so the path is an
  upstream extraction into `src/host/speaker_eq.c` (U7) that movy-host
  compiles from the pin.
- Not done by a person yet: opening movy-sa from the Tools menu by hand, a
  listening check, and a real power-button press (the tier only dry-runs it).
