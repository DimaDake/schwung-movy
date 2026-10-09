# WP0 spike findings

`movy-lab` (`spike/movy-lab/`, ~330 lines of C) was built from schwung **v1.7.3**
sources via `git archive` and run on the device (schwung 1.7.3, kernel
5.15.92-rt57, BusyBox init) on 2026-10-09. It used `scripts/spike-movy-lab.sh`
(runs A and B) plus a display check (run C). Raw logs are in
`spike/movy-lab/out/` (not committed).

## 1. What was proven

| Claim | Evidence |
|---|---|
| A pinned-tag build works | QuickJS + `js_display.c` from `git archive v1.7.3`, cross-built with the messense toolchain. The binary needs GLIBC ≤ 2.17 |
| QuickJS + js_display paint the screen | A JS `frame()` calls `print`/`clear_screen`; the frame is packed with `js_display_pack` and served through the pull handshake (boot-select.c shape) |
| **display-server streams movy-host's frames unchanged** | Run C: the lab wrote `/dev/shm/schwung-display-live`, and `curl :7681/stream` returned the lab's screen (`movy-lab v1.7.3 / uid 0 rt fifo70 / t 6s render 22us …`). The format matches `js_display_pack` |
| **The unchanged `dsp.so` (ENGINE 0.85.0) runs with no shim** | A hand-made `host_api_v1_t` was enough: `chain_host` + `chains` loaded noisemaker and braids from stock modules, `padmap` was set, and `on_midi(0x90, 68, 100)` gave `chpeak` 6537 / 9279 / 6893 … on every note (both runs) |
| Physical pads can reach the engine with no JS | Cable-0 notes 68-99 from the RX mailbox go straight to `on_midi` |
| SIGTERM | The loop left **0.1 ms** after the signal; the process exited **59 ms** after it (screen blank + stats) |
| Move comes back | Every run: `launch-standalone.sh` restarted Move after the lab exited |
| `/dev/ablspi0.0` is exclusive | Run C1 launched as a uid that could not kill the root-owned stack: `open` returned **EBUSY**, the lab exited 1, and Move kept running. Two processes can never drive SPI at once |

## 2. Numbers

**Timeline** (device clock; "Move back" = a new shadow_ui pid; from the first
runs, which polled with `pidof`. The committed script scans `/proc` instead,
which is slower per poll, so its "Move gone" stamps land ~0.5 s late):

| | A (ableton) | B (root, SIGTERM) |
|---|---|---|
| launch → Move gone | 2.20 s | 1.76 s |
| launch → movy-lab running | 2.62 s | 2.58 s |
| movy-lab start → SPI open | 34 ms | 3 ms |
| movy-lab exit → shadow_ui back | 3.88 s | 3.69 s |

About 1.8 s of the open time is fixed sleeps in `launch-standalone.sh` (1 s
up front, 0.3 s for the shadow_ui save, then 0.5 + 0.2 s around the kills). The exit time is
the Move cold start. **R6: opening from Tools takes ~2.6 s, and getting back
takes ~3.8 s plus Move's UI coming up.** That is acceptable for a dev flavour,
and it is why WP8's boot target is the main entry.

**Frame** (128 frames, 2902 µs period; A had 20,641 frames over 60 s and B had 3,268):

| µs | A: SCHED_OTHER | B: SCHED_FIFO 70, core 3, mlockall |
|---|---|---|
| frame period p50 / p99 / p999 | 2902 / 2988 / **4346** | 2902 / 2954 / **3001** |
| render (2 chains) p50 / p99 | 20.7 / 122 | 21.1 / 131 |
| work between pumps p50 / p99 | 22.5 / 218 | 22.9 / 224 |
| max (one outlier per run) | 33.0 ms period, 31.9 ms render | 43.4 ms / 42.4 ms |

- **Headroom against overtake** (`track-performance.md` §7): in overtake mode,
  MoveOriginal's render (239 µs) and schwung's pre/post (111 µs) come out of the
  2432 µs work ceiling before movy renders. The lab's own non-render overhead is
  about 2 µs p50. **So standalone gives movy ~2430 µs where overtake gives
  ~2080: +350 µs, +17%.** That confirms §7's frame-only term. Contention relief was not
  measured.
- **Without RT, 1 frame in 1000 runs ≥ 1.1 ms late** (p999 4346 µs; a repeat run
  with the stack root-owned gave 4019 µs). With FIFO 70 the p999 is 3001 µs
  (repeat: 3293 µs over 2,948 frames). RT is required.
- The single ~30-40 ms outlier per run is most likely the first chain loads
  (`dlopen` inside the first render blocks), but it was not timestamped. WP6
  must time-stamp outliers, and it must load chains off the audio thread.
- `spi_tx_time` (`SCHWUNG_OFF_SPI_TX_TIME`) is **not** a monotonic stamp:
  consecutive reads differ by 1-700 µs and are often equal. Its meaning needs a
  re-read before WP6 uses it, and the lab's `spi_tx_delta` stat means nothing.

## 3. Findings that change the plan

1. **R1 (RT): an ableton process cannot get SCHED_FIFO.** shadow_ui,
   MoveOriginal and display-server all run as uid 1000 with `RLIMIT_RTPRIO` 0.
   MoveOriginal gets its FIFO 70 audio threads from **file capabilities**
   (`cap_ipc_lock,cap_sys_nice,cap_sys_resource=ep` on `/opt/move/MoveOriginal`),
   not from root. Run A (ableton): `SCHED_FIFO 70 → EPERM`, `mlockall → ENOMEM`,
   and movy's render workers logged `sched=-1 (degraded)`. Run B (root): all
   succeeded.
   **Decision for WP6:** movy-host runs as **ableton**. It ships a tiny staged
   helper `bin/heal.new`, which schwung-heal installs as `bin/heal`, root
   04755, on its next run. The helper does one closed thing: set SCHED_FIFO
   (70 for the audio thread, 68 for render workers) and raise
   `RLIMIT_MEMLOCK` on movy-host's own pid/tids, then exit. That keeps every
   file movy-host writes ableton-owned (R2), and nothing runs as root for
   longer than the call. If the helper is missing or un-setuid'd, run degraded
   and say so on screen (*dbx* re-bless check). File capabilities are rejected
   because a store reinstall replaces the binary and drops them.
2. **Tools launches inherit the stack's uid.** After a normal boot the stack is
   ableton, so a launch from Tools gets ableton. After the dev
   `restart-stack.py`, the stack and every launch run as **root**.
   `launch-standalone.sh` from a uid lower than the stack's cannot kill it and
   fails safe (EBUSY, above). The device harness must launch `movy-sa` with
   the stack's uid.
3. **`open_tool_cmd` cannot open a standalone tool.** Its handler
   (`shadow_ui.js:29450`) calls `startInteractiveTool` directly and never
   consults `toolLaunchKind`. Upstream PR (new **U6**): route it through
   `launchToolConfirmed`. Until then, the harness runs `launch-standalone.sh`
   itself. That is exactly what the Tools menu runs, via `host_system_cmd`.
4. **First-match dispatch is fixed upstream** (`shared/tool_launch.mjs`,
   2026-09-29, in 1.7.3): `standalone` wins over every `tool_config` branch.
   **But overtake is decided first, in a separate scan**, so WP8 must change
   `component_type` away from `overtake` (to `tool`), not just add
   `standalone: true`.
5. **This firmware has no systemd** (BusyBox init; `/etc/init.d/move` runs
   `start-stop-daemon -c ableton MoveLauncher`). `launch-standalone.sh`'s
   `--pause-launcher` path needs `/usr/bin/systemctl`, so it never runs.
   MoveLauncher is simply SIGTERM'd and nothing respawns it. Move comes back by
   bare `nohup /opt/move/Move`, **unsupervised**, and as the launching uid
   (root after run B). The *dbx* "Restart=on-failure respawns Move alongside" risk
   does not exist on this firmware, and the EBUSY guard covers it anyway.
   For WP8's boot target, there is also no `move-launcher.service` to "be".
   Re-read `docs/BOOT_TARGETS.md` against sysvinit before designing the exit
   path.
6. **The shared JS imports quickjs-libc's `std` and `os` modules**
   (`wav_io_qjs.mjs`), so movy-host must register them (inventory §2).
7. **The speaker EQ is a shim feature** (CC 115 driven). Standalone loses it
   (R8). Port it to the master chain, or document it as a limitation.

## 4. Not measured (and why)

| Item | Why | Carry to |
|---|---|---|
| Handoff audio burst (R9) | Needs an external capture on USB-C or line-out; nothing in software can record while no process owns SPI | WP7: a capture with a cable, or a user listening test. The lab already fades in over 0.5 s |
| Audible output | Only the render peak (`chpeak`) was verified. Someone handled the device during run A, but nobody reported what they heard | WP6 exit: listening check |
| Power-button signature live | Not pressed during the runs; the signature is from the shim source | WP7 |
| USB-A external MIDI live | No device plugged in | C-opt |
| Boot-target uid | Would need a reboot into a boot target. Booting is documented to run as ableton, and finding 1 already designs for ableton | WP8 |
| Physical panel shows the frame | Same handshake as the device-verified boot-select; display-server mirror verified | WP6 exit |

## 5. Risk verdicts

| # | Verdict |
|---|---|
| R1 RT as ableton | **No-go without help → go with the heal helper** (finding 1). Measured: p999 4.3 ms without RT, 3.0 ms with it |
| R2 root-owned Sets | Go. movy-host stays ableton (finding 1), and the copy-forward rule handles legacy root files |
| R3 power button | Open. Signature known from source; the shutdown path is designed in WP7 |
| R4 shared-JS global drift | Go. Surface listed (inventory §2), with one addition (`std`/`os`) |
| R5 QuickJS/ABI drift | Go. Pinned tag builds; the tag goes in the first log line |
| R6 open/exit time | Go. 2.6 s in, 3.8 s back; the boot target is the main entry |
| R7 store replaces a running binary | Not tested (WP8) |
| R8 hardware Move owned | One item found: the speaker EQ. HP/speaker switching is in hardware; kernel RT tuning comes from init |
| R9 handoff burst | Open, not measurable in software (§4) |
| R10 chain-host drift | Unchanged (WP2). The lab already ran a *copied* chain host from its own directory |
