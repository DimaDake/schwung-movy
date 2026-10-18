# movy-host (WP6–WP8)

movy's C host, in `host/`. It does for movy what the shim and shadow_ui did in
the overtake flavour, and it runs the **same** `ui.js` and `dsp.so`. In WP6–WP7
it shipped only as the dev tool movy-sa; since WP8 it **is** the `movy` module
(`tools/movy`), and movy-sa is retired (`deploy.sh` removes it). Plan:
`plans/2026-10-09-standalone-migration.md`.

## Shape

| Thread | File | Job |
|---|---|---|
| main | `ui.c`, `ui_js.c`, `globals*.c` | QuickJS: loads `ui.js`, ticks it on a 2 ms deadline (shadow_ui's overtake period, because the tick is movy's input sampling interval), drains input, batches encoder deltas (`deltas.c`), packs the screen |
| `movy-audio` | `audio.c`, `spi.c` | One `WAIT_AND_SEND` per 128-sample block: MIDI out (≤20 packets), display slices, MIDI in, engine notes, the param queue, `render_block`, the status snapshot, audio out with a 0.5 s fade-in |
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
  read is skipped. `param_bulk.c` is the shim's bulk codec. Since WP10 movy
  never waits on a write (`host_module_set_param`, bulk sets included): a set
  is refused only when no engine is loaded. The queue counts what it has
  queued (`submitted`) and serviced (`served`).
- `status_snap.c` (WP10): after every render the audio thread asks the
  engine for `status` and publishes it in a seqlock, stamped with `served` as
  of that render. The UI reads it with `movy_engine_snapshot_seq()` (a number,
  every tick) and `movy_engine_snapshot()` (a copy, when the number moved), so
  status costs no queue round trip. A snapshot whose `served` has reached a
  `movy_engine_submitted()` taken earlier reflects every request made before it
  (`seq/set-settle.ts` waits on exactly that). A status too long for the 16 KB
  buffer is refused, never truncated, and logged once.
- `display.c`: seqlocked frames, so the XMOS never gets a torn frame. Also
  `/dev/shm/schwung-display-live`, so display-server streams it unchanged, and
  `/dev/shm/schwung-display` (shadow_ui's frame under the shim), so
  `grab-screen.mjs` and `capture-screen.mjs` work unchanged.
- `mirror.c`: the rest of schwung's `/mirror`, written into the shim's own
  segments in place (never unlinked: display-server maps each once and never
  reopens it). `/schwung-surface-live` takes LEDs from the final MIDI_OUT and
  presses from the raw MIDI_IN, always, like the shim does. An idle frame costs
  about 60 ns. `/schwung-audio-live` takes the engine block only while
  features.json `display_mirror_enabled` is on. The UI thread re-reads that
  setting every 64 ticks, with a stat() call. Off, it costs one load per frame
  (`host/tests/test_mirror.c` measures both).
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
  **power button** (a cable-0 SysEx, `F0 00 21 1D 01 01 3A …`, sent on a tap or a hold; the host must answer each one with `F0 00 21 1D 01 01 39 02 F7`, as stock Move does, or the hardware reports only the first press per launch)
  calls the UI's `onPowerButton`, which asks "Power off?"; confirming calls
  `host_power_off`, movy-host shuts down cleanly (onUnload saves), then
  `power.c` calls `com.ableton.system` `Power.shutDown` over D-Bus — Move's own
  power service, which ableton may call (`/etc/dbus-1/system.d/move.conf`), so
  no root helper. The call answers at once and the power goes seconds later,
  so movy-host then **holds** (deaf to SIGTERM, up to 120 s) instead of
  exiting: an exit let `launch-standalone.sh` restart Move, and the power cut
  killed that Move mid-boot. The boot selector counted each one as a failed
  boot, and three in a row opened schwung's "failed to start" picker.
  A **DRY RUN** whenever the test bus is on, which never holds. The **fallback
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
./scripts/deploy.sh              # ui.js, dsp.so, movy-host, launcher, boot entry → tools/movy
bash host/tests/run.sh           # unit tests + the boot-door test (part of npm test)
./scripts/test-host-linux.sh     # the same under glibc, in docker
scripts/vdev.sh tier 3           # the device tier with no device, in containers (vdev.md)
npm run test:device -- --scenario smoke
```

A standalone run leaves the device as it found it: the transport's `close()`
EXITs movy-host and releases the launcher.

**Harness mode** (`/dev/shm/.movy-testbus` exists; the transport makes it
at connect, removes it at close, and a reboot clears it):
after a clean close (rc 0, or 3 for a UI throw) `standalone/launch.sh` does not
return to Move. It holds, Move still down, until the harness writes `go`
(start movy-host again, ~0.5 s) or `quit` into `/dev/shm/.movy-cmd`, or 300 s
pass. A close/open pair is then a process start rather than a Move restart and
a kill sweep: `smoke` went from ~140 s to 17 s, the whole tier to under 8 min.
A lock loser (rc 1), a floor refusal (rc 2) or a stop (rc 5) never holds. A
movy-host left running holds SPI and port 47777, so the transport's `close()`
always EXITs it.

`tools/movy` holds `module.json` (`standalone: true`, `component_type: tool`,
`boot_target`), `standalone` (= `standalone/launch.sh`), `boot-entry.sh`,
`movy-host`, `movy-heal`, `ui.js`, `dsp.so`, `chain-host.so`, `configs/` and
`schwung/` (the pinned tag's shared JS that movy-host imports in place of the
installed schwung's, `host/module_path.c`),
plus what movy writes there (prefs, `bin/heal`, the legacy `sets/`).

`load` from the UI reloads movy-host's own `dsp.so`, never the path the UI
names: the engine is the host's to choose.

## The two doors (WP8)

| | Tools menu | Boot picker |
|---|---|---|
| chain | `launch-standalone.sh` → `standalone` | selector → `boot-entry.sh` → `standalone --boot` → **exec** `movy-host --boot` |
| uid | the stack's (ableton; root after the dev restart) | ableton |
| quit (rc 0, UI error 3, hard exit 4, crash) | movy-host exits; launch-standalone.sh restarts Move through the selector, and `boot-entry.sh` consumes the one-shot `/dev/shm/.movy-return` the Tools door wrote and execs `schwung-entry.sh` (else a default of `movy` booted movy again) | movy-host **execs** `schwung-entry.sh` (then `/opt/move/Move`, then `MoveOriginal`, each only if the earlier is missing) |
| stop (SIGTERM/SIGINT → rc 5) | exits | exits — a stop must never start Schwung |

Why movy-host, not the shell, owns the boot exit:

- **The boot pid must never just exit.** At boot there is no
  launch-standalone.sh: MoveLauncher supervises the pid the selector exec-ed
  (dbxhost found it reads any exit as "Move crashed"). `boot-entry.sh` and
  `standalone --boot` both exec, so that pid is movy-host's, and its every way
  out but a stop is an exec into Schwung (`handover.c`), including the crash
  handler and the fallback hard exit (execve is async-signal-safe). Every fd
  from 3 up is closed first: SPI is exclusive.
- **MoveLauncher blocks SIGTERM, SIGINT and SIGUSR1** in everything it starts
  (SigBlk 0x4202 on MoveOriginal, read 2026-10-11), and a blocked mask survives
  fork and exec. A shell cannot unblock it; movy-host does at start
  (`signals.c`), so a stop's TERM reaches the process that holds SPI.
- **Which door is an argument**, never an environment variable: an exported one
  rides the exec into Schwung, and that session's next Tools launch takes the
  boot branches (dbxhost's split-device bug).
- The launcher starts `schwung-manager` and `display-server` when they are not
  running (the selector starts nothing for its targets; the Tools door finds
  both up). It never sweeps or pauses MoveLauncher: at boot that is our own
  supervisor.

`host/tests/test_boot_door.sh` runs the real `boot-entry.sh` and launcher
against a fake movy-host and pins `module.json`'s `boot_target`;
`test_handover.c` and `test_signals.c` pin the exec chain and the mask.

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

## Core placement (WP11)

Core 3 is the audio core: `movy-audio` is pinned there and renders lane 0;
the engine's three render helpers (`movy-render0..2`, FIFO 68) and its
`movy-saver` keep to cores 0-2, and the UI, log and bus threads float. A
thread or process started from the audio thread inherits its pin, and a fork
its FIFO 70 too — osirus (Virus) forks its DSP emulator from a chain load, and
that process then held core 3 at the audio thread's own priority: ~200 late
transfers per 3 s with one Virus playing. `placement.c` walks movy-host's
tasks and its children's once a second (from the UI loop) and moves any task
pinned to core 3 alone, other than the audio thread, to 0-2 with its policy
unchanged (`placement: … moved to 0-2` in the log). With it, the same Virus
plays with 0-1 late transfers.

`frame_stats.c` keeps the frame's numbers for `STATE`: work avg/max, the
shortest SPI call (`pump_min_us`, boundary wait + ~400 µs DMA) and the longest
gap, and `late_frames` (`frame_clock.h`). An overrun never skips a frame: the
transfer runs late and the block rate falls (serial render of an over-budget
set ran at 293.7 Hz, not 344.5), so lateness is a gap more than 1/16 frame
past 2902 µs. The slow-frame log (`audio: slow frame`, > 10 ms) splits the
frame into render and params and names the slowest param, not the last.

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
standalone SDK library), U8
[schwung#641](https://github.com/charlesvestal/schwung/pull/641)
(launch-standalone.sh: one launch at a time; a tool launch is not a failed
boot), U7 [schwung#642](https://github.com/charlesvestal/schwung/pull/642)
(speaker EQ as `src/host/speaker_eq.c`), and
[schwung#643](https://github.com/charlesvestal/schwung/issues/643) (a module
declares `min_host_version` in its own module.json and the host refuses to
load it; movy's `module.json` adopts it once that lands). Until #635 ships,
the harness runs launch-standalone.sh itself.

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
  upstream extraction into `src/host/speaker_eq.c` (U7,
  [schwung#642](https://github.com/charlesvestal/schwung/pull/642)) that
  movy-host compiles from the pin once a tag carries it.
- Not done by a person yet: opening movy-sa from the Tools menu by hand, a
  listening check, and a real power-button press (the tier only dry-runs it).
