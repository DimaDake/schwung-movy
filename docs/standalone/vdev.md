# The virtual device (plan WP12)

movy-host with no hardware: the same host, built with `host/vdev/spi_fake.c`
in place of `spi.c`, running in an aarch64 Ubuntu 22.04 container on colima
(glibc 2.35, the device's). The container carries a copy of a real Move's
`/data`, so the shared JS, the chain hosts and every module's `dsp.so` are the
device's own and run natively. The device tier's scenarios run against it
through the **same transport** (`test-device/transport-standalone.ts`), and
one container per shard runs them in parallel.

It is the fast loop, not the gate: anything hardware-timed (the audio
deadline, the real SPI, the power button's hardware, LEDs on glass) is still
the device tier's to judge, and so is every commit (root `CLAUDE.md`).

## Use

```bash
scripts/vdev.sh snapshot          # once, and after the box's schwung changes: copy move.local:/data (~500 MB, ~35 s)
scripts/vdev.sh image             # build the image from it (~30 s)
scripts/vdev.sh tier 3            # every scenario, 3 shards on fresh vdev0..2: GREEN/RED
scripts/vdev.sh up 0              # one container to work against...
eval "$(scripts/vdev.sh env 0)"   # ...ssh/scp/Node now reach vdev0 like a Move
scripts/deploy.sh vdev0           # ships the fake-SPI movy-host (MOVY_VDEV=1 is in the env)
scripts/vdev.sh test 0 --scenario smoke
scripts/vdev.sh down all
```

Measured 2026-10-13 (colima 4 vCPU, M-series Mac): the whole tier, 22
scenarios and 160 checks, green in **2 min 9 s** on three shards, against
about 9 min on the device. A one-container sweep is about 6 min.

## How it fits together

| Piece | What it is |
|---|---|
| `host/vdev/spi_fake.c` | `spi.h` with no XMOS: the 4 KiB mailbox is a file (`/dev/shm/vspi-mailbox`, `MOVY_VSPI`) and `spi_pump` sleeps to absolute 2902 µs deadlines, so a late frame runs late without pushing later ones back. Display slices are asked for 1..6 in turn. It writes the transfer count (u64 at 3072) and the last block's peak (i16 at 3080) into the page's unused gap, for anything outside that watches. It refuses to start where `/dev/ablspi0.0` exists. `host/tests/test_spi_fake.c` |
| `MOVY_VDEV=1 build-host.sh` | builds it into `dist/vdev/`, never over the device's `dist/movy-host`; `--version` and the first log line say `vdev` |
| `vdev/image/` | the Dockerfile; `/opt/move/Move` and `/etc/init.d/move` stand-ins whose `MoveOriginal` and `shadow_ui` are copies of `sleep`, because the harness and schwung's own (unchanged) `launch-standalone.sh` find Move by name; sshd as the way in |
| `scripts/vdev.sh` | snapshot, image, up/down, `env`, `test`, `tier` |
| `vdev/bin/ssh`, `scp` | first on `PATH` under `vdev.sh env`: every ssh the harness and the scripts make reads `.vdev/ssh_config` (vdev`N` = 127.0.0.1:2300+N, then the user's own config) |
| `test-device/vdev.ts` | the Node side of the same name: vdev`N`'s test bus is 127.0.0.1:48777+N |

`vdev.sh tier` builds once, then runs each shard against a fresh container
with `MOVY_PREBUILT=1`, which makes `deploy.sh`, `deploy_host` and the
transport's deploys copy without building: shards that each built would
write `dist/` and `ui.js` under each other's scp. Shards are balanced on the
previous tier's timings. A vdev run writes neither the flake ledger nor
`.last-schwung-version`: those are the box's records, and shards would race
on them.

## What the snapshot had to be told (found on the first runs)

- **`bin/schwung-heal` is replaced by a stub.** The box's is setuid root and
  "heals" `/opt/move/Move` back to schwung's real boot entrypoint, which
  cannot boot anything in a container: after the first crash scenario Move
  never came back and the next three scenarios timed out at 90 s.
- **`/dev/shm/schwung-control` is created at boot.** On the box it is residue
  of Move's shim, and `scripts/inject-any.py` rings its doorbell: without it
  the script placed a press and died before the release, which also failed
  the next inject check.
- **A few small Samples files are copied** (60 under 400 KB) for the file
  browser's `page-dive`; the 22 GB library and sfz's 600 MB instruments are not.
- **python3 (full, for `mmap`)**: the dev tools run python on the box.
- **`--cap-add SYS_PTRACE`**: root reads another uid's `/proc/<pid>/maps`
  (smoke's chain-host check); a container's root may not without it.

RT priority is degraded in the container (no setuid helper), and the four
vCPUs are shared by every shard: fine for function, meaningless for
`perf_*` and CPU-meter numbers. Measure those on the device.
