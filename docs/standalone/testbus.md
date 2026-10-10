# movy-host test bus — protocol v1

The device harness's channel into **movy-host**, the standalone flavour's C
host (plan WP6). It replaces two servers and three side channels of the
overtake flavour with one socket:

| Overtake today | Standalone |
|---|---|
| `schwung-testd` (47777): frame clock, engine params, pad LEDs, shim state | this bus |
| `ui-agent.py` (47778): writes the UI MIDI ring | `INJECT_MIDI` |
| `scp /dev/shm/schwung-display` | `FB` |
| `ssh grep debug.log` | `LOG_SEQ` / `LOG_TAIL` |
| root `restart-stack.py` | `EXIT`, then relaunch movy-host |

It is a **strict superset of the schwung-testd subset `test-device/bus.ts`
uses**. Every verb and reply shape that `bus.ts` parses works unchanged, so the
`Bus` client can talk to movy-host as it is. The verbs that only make sense
beside Move answer a fixed `ERR`, never a silent `OK`.

Read against schwung-testd 0.1.0 (`src/host/test_daemon/`, schwung `e877ed64`).

## Transport mapping

`test-device/transport.ts` is the interface; this table is what
`transport-standalone.ts` (WP6 minimal, WP7 complete) implements it with.

| `Transport` | Overtake (`transport-overtake.ts`) | Standalone (this bus) |
|---|---|---|
| `ping` | testd `PING` | `PING` |
| `frames(n)` | testd `WAIT_FRAME n` (shim SPI counter) | `WAIT_FRAME n` (movy-host's SPI counter) |
| `uiMidi(p)` | ui-agent `UI <hex>` (UI ring only) | `INJECT_MIDI <hex>` |
| `dspMidi(p)` | testd `INJECT_MIDI` (shim ring → Move) | `INJECT_MIDI <hex>` (same input path) |
| `engineGet/engineSet(k)` | testd `GET/SET_PARAM overtake_dsp:k` (single SHM slot) | `GET/SET_PARAM k` (param queue) |
| `engineSetQueued(k, v)` | remote-UI WebSocket (`engine-param.mjs`) | `SET_PARAM k v` (already queued) |
| `padLeds` | testd `SNAPSHOT_PAD_LEDS` | `SNAPSHOT_PAD_LEDS` |
| `framebuffer` | scp of `/dev/shm/schwung-display` | `FB` |
| `logGrep(p)` | ssh `grep p debug.log` | ssh `grep p debug.log` (see below) |
| `launch` | testd `SET_OPEN_TOOL movy` + `overtake_mode==2` + `__ready` | `launch-standalone.sh` over ssh (until U6), then `STATE engine_ready=1` |
| `running` | `STATE overtake_mode == 2` | `STATE running == 1` |
| `restart` | root `restart-stack.py` + ping | `EXIT`, then `go` to the held launcher, `PING` |
| `move` | `{ park }` (ui flag 0x80) | `null` — `needs: 'move'` scenarios print N/A |

Plain ssh to the box (fixture files, reading a saved Set) is not part of the
transport: the filesystem is the same under both flavours.

**`logGrep` stays on debug.log.** The ring behind `LOG_TAIL` belongs to one
movy-host process, and in harness mode every close/open is a new process (the
launcher hold), so a before/after count across an open would compare two
rings. debug.log spans them, and it no longer drops lines (one writer, see
`movy-host.md`). `LOG_SEQ`/`LOG_TAIL` are for a check inside one session; the
transport exposes them as `tx.hostBus`, with `SUBSCRIBE`/`DUMP`, `UI_EVAL`,
`STATE` and `CRASH`, for scenarios that declare `needs: 'testbus'`.

## Wire format

- TCP, one client at a time (a second connect waits in the backlog, as testd's
  does). Port **47777**, which schwung-testd also binds: the standalone
  transport stops testd first. Bound to `127.0.0.1` unless `MOVY_TESTBUS_BIND`
  names another address; the file form below binds `0.0.0.0`, because the
  harness that drops the file is on another machine.
- **Off unless asked for.** The bus thread starts only when `MOVY_TESTBUS=1` is
  in movy-host's environment or `<module dir>/testbus` exists. The file form
  exists because `launch-standalone.sh` does not forward the harness's
  environment. A shipped build never contains the file.
- Requests and replies are ASCII lines ending in `\n`, at most **64 KiB** (testd:
  4 KiB). The larger limit lets an engine blob go through `SET_PARAM` without a
  `*_FILE` detour.
- A request is `VERB [args]`. The verb is case-sensitive. Arguments are
  separated by single spaces, and the **last argument of `SET_PARAM` and
  `UI_EVAL` is the rest of the line, spaces included** (`SET_PARAM set lib
  rename <id> WP4 Device`).
- A reply is `OK[ <payload>]` or `ERR <VERB>: <reason>`. A multi-line reply is
  a header `OK count=<N> …`, N body lines, and `END`.
- Hex is lower-case, two digits per byte, no separators.
- `ERR` is the device's answer, so the harness grades it as an **assert**. A
  closed socket or a timeout is **infra** (`test-device/errors.ts`).

## What is implemented

All of v1 (WP6 + WP7). `UI_EVAL` and `CRASH` exist only in dev builds
(`build-host.sh` defines `MOVY_TESTBUS_EVAL` unless `MOVY_RELEASE=1`); a release
build answers `ERR UI_EVAL: not built in` and `ERR CRASH: unknown verb`.
`STATE` also carries `param_depth` (requests queued for the engine),
`ui_dropped` (input packets the UI ring had no room for) and
`work_avg_us`/`work_max_us` (below). `scenarios/testbus.ts` proves each verb on
the device; `host/tests/test_log.c` pins the reply shapes.

## Verbs

### Carried over from schwung-testd (reply shapes unchanged)

| Verb | Reply | Notes |
|---|---|---|
| `PING` | `OK movy-host <ver> proto=1 schwung=<tag> movy=<sha> pid=<n>` | Answers from the moment the bus thread is up, before the UI or engine. That makes it the "host is back" probe after `restart`. The harness tells the flavour from the second word. |
| `STATE` | `OK k=v k=v …` | See *STATE keys*. Keys are only ever added, never renamed or removed. |
| `WAIT_FRAME <n>` | `OK frame=<counter>` | `n` is 1..10000. Blocks until movy-host's SPI frame counter (one per `WAIT_AND_SEND`, ~2.9 ms) has advanced by `n`. After 30 s it replies `ERR WAIT_FRAME: timeout (audio thread not ticking?)`. |
| `GET_PARAM <key>` | `OK <value>` | An engine `get_param`, serviced by the audio thread between blocks (`param_queue.c`). The overtake prefix `overtake_dsp:` is accepted and stripped, so an unmodified `Bus` works. An unknown key replies `OK ` (empty), exactly as the engine answers it. |
| `SET_PARAM <key> <value>` | `OK` | Queued and **applied before the reply**: the reply waits until the audio thread has called `set_param` (≤ 1 frame plus the queue ahead of it). The overtake single slot is not modelled: no write is lost and none starves another. That means `PARAM_POLL_GAP` (`test-device/wait.ts`) is an overtake constant, and the standalone transport may poll faster. |
| `INJECT_MIDI <8 hex>` | `OK` | One USB-MIDI event packet (cable/CIN byte + 3 MIDI bytes), fed into the **same RX parser as the SPI mailbox**. Cable 0 is the surface: it reaches the UI (`onMidiMessageInternal`, after the same knob-delta accumulation and re-encode shadow_ui applies) and, where movy-host routes it, the engine. Cable 2 is external USB MIDI (`onMidiMessageExternal`). This single path is what removes the overtake two-ring split. Events apply in order at the next frame boundary. `OK` means queued, so wait with `WAIT_FRAME` or a probe, not on the reply. A full queue (256 events) replies `ERR INJECT_MIDI: queue full`. |
| `SNAPSHOT_PAD_LEDS` | `OK <64 hex>` | 32 bytes, pad 0..31: the last colour index movy sent to each pad (the LED queue's last-writer-wins table, `midi_out.c`). This is what the user sees, not what is still queued. |
| `SUBSCRIBE <ch>` / `UNSUBSCRIBE <ch>` | `OK` | Channel `midi_out`: every packet movy-host puts on the out ring (LEDs and external MIDI), with the frame it left on. Re-subscribe resets the baseline. |
| `DUMP <ch>` | `OK count=<N> dropped=<D>`, `EV <frame_hex8> <pkt_hex8>` ×N, `END` | Same shape and capacity rules as testd: when more than the ring holds were captured, the oldest are dropped and counted. |
| `QUIT` | `OK bye` | Closes **this connection** (testd semantics). It does not stop movy-host: that is `EXIT`. |
| `SET_OPEN_TOOL <id>` | `ERR SET_OPEN_TOOL: no Move — movy-host is already the tool` | Coexistence-only. |
| `RESTART_MOVE` | `ERR RESTART_MOVE: no Move — use EXIT and relaunch` | Coexistence-only. |

`SLOT`, `SET_PARAM_FILE` and `DUMP_PARAM_FILE` are not carried over: `bus.ts`
does not use them, and the 64 KiB line covers the blob case.

### New

| Verb | Reply | Notes |
|---|---|---|
| `FB` | `OK <2048 hex>` | The 1024-byte packed framebuffer (8 pages × 128 bytes, bit 0 topmost: `test-device/display.ts`'s layout) last sent over SPI. It is the frame on the glass, not a JS buffer mid-draw. It replaces the scp of `/dev/shm/schwung-display`, and it costs one round trip with no ssh handshake. |
| `LOG_SEQ` | `OK seq=<n>` | The sequence number of the last line movy-host's `unified_log` wrote. It is the baseline for a delta check. |
| `LOG_TAIL <from_seq> [<substring>]` | `OK count=<N> seq=<last>`, `LN <seq> <text>` ×N, `END` | The lines after `from_seq`, filtered by a literal substring when one is given. The host keeps the last 4096 lines in a ring. If `from_seq` is older than the ring, the header carries `lost=<k>` and the reply starts at the oldest line still held. It makes the before/after delta rule (`test-device/README.md`: "a `logLines` check must be a delta") exact, where it used to be a count of grep matches, and it needs no ssh. `debug.log` is still written, so the dev tools keep working. |
| `EXIT` | `OK bye` | Asks movy-host for a clean shutdown: UI `onUnload`, engine flush, out ring drained, process exit within 1 s. That is the same path as SIGTERM. The reply goes out before teardown starts. `restart` is `EXIT`, then a relaunch, then `PING`. |
| `CRASH` | (none — the process is gone) | **Dev builds only.** SIGSEGV inside the bus thread, to prove the crash handler: a `CRASH SIGSEGV` line and a named backtrace (`-rdynamic`) land in debug.log. Not a clean close, so the launcher returns to Move. |
| `UI_EVAL <js>` | `OK <json>` / `ERR UI_EVAL: <exception + stack>` | **Dev builds only** (compiled in with `MOVY_TESTBUS_EVAL`; a release build replies `ERR UI_EVAL: not built in`). Evaluates `<js>` on the UI thread between two ticks and replies with `JSON.stringify` of the result (a promise is awaited). This is the direct way to read the ViewModel that the `probereq`/`probersp` engine mailbox (`test-device/probe.ts`) works around today. The probe keeps working unchanged, because it is only engine params. As built: one request at a time, a 5 s answer limit, and only the eval's own promise is awaited (the UI loop runs the job queue only while one is open; shadow_ui never runs it). |

### STATE keys

| Key | Meaning |
|---|---|
| `frame` | SPI frame counter (same value `WAIT_FRAME` reports) |
| `running` | 1 while movy's UI is loaded and ticking, 0 during start-up and teardown |
| `engine_ready` | 1 once `dsp.so` is loaded and its instance answers `get_param` |
| `ui_tick` | UI ticks since start (the tick rate is the MIDI sampling interval, so a scenario can read it) |
| `inject_queued` | `INJECT_MIDI` events not yet applied |
| `uid`, `rt` | uid movy-host runs as, and the audio thread's scheduling (`fifo<prio>` or `other`), per WP0 findings §3 |
| `overtake_mode` | **compat**: 2 while `running=1`, else 0, so `Bus`-based waits written for overtake still mean "movy owns the surface" |
| `work_avg_us`, `work_max_us` | the audio thread's own work per frame (input, notes, params, render, output), mean and max over the last completed window of 1024 frames, against the 2902 µs budget |
| `shim_counter` | **compat**: equal to `frame` |

## Rules this protocol keeps from the overtake harness

- **Frames, not wall clock.** Every wait is `WAIT_FRAME` or a poll paced by
  it. Having no shim does not make a wall-clock sleep correct: the tick rate
  still moves with load.
- **Silence is never "empty".** A `GET_PARAM` on a host with no engine instance
  replies `ERR GET_PARAM: engine not loaded`, never `OK `.
- **A restart is proved, not assumed.** `restart` checks that `PING`'s `pid=` has
  changed. A bus that never
  went down must not read as one that came back.

## Not in v1

The `INJECT_MIDI` routing for external MIDI into the engine, Ableton Link, and
anything WP12's virtual device needs beyond this. That device is meant to speak
**this same protocol**, so the harness can run against it unchanged.
