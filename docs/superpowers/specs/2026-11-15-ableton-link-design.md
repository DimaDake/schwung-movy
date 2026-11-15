# Ableton Link in movy: tempo sync + per-track Link Audio out

Status: DESIGN, approved scope 2026-11-15. Nothing built.
Measured basis: device sweep 2026-11-15 (memory `movy-link-audio-cost`).

## Why

The owner wants to record and mix movy's tracks in Live without cables or a Mac
helper app: each movy track appears in Live as its own Link Audio input, and
movy and Live share one tempo, one beat grid and one Play/Stop. Monitoring stays
on Move's own outputs; the Live copy is for recording (it arrives late by the
network trip, Link's beat stamps put it on the grid).

This replaces F2 of `plans/2026-10-23-stems-freeze-export-wifi.md` (custom UDP
protocol + "Movy Receiver" Mac app + BlackHole): Live receives Link Audio
natively.

## Goals

1. **Link session** (tempo + phase): with the setting on, movy joins the Link
   session on every network interface (WiFi and the USB-C `usb0` link).
   - movy **follows** the session tempo and beat phase (quantum 4 = one bar).
   - movy **leads**: a tempo change made on movy is set on the session.
   - Joining a session adopts its tempo (Link's rule); alone, movy keeps its own.
2. **Start/Stop Sync, both ways** (owner's decision): movy Play/Stop starts and
   stops the session; a session start/stop starts and stops movy, on the beat
   grid. (Live honours it only with its own "Start Stop Sync" on.)
3. **Link Audio out**: 17 channels — `Movy 1` … `Movy 16` (one per track) and
   `Movy Master`. Names are FIXED (owner's decision) so Live's input routing
   survives a synth swap.
   - Track channels are **post-fader, post-pan, post-mute, pre-master** — the
     track as heard (owner's decision; same as the stems plan).
   - `Movy Master` is the final stereo output movy sends to the DAC (after the
     master chain), excluding speaker EQ.
   - Every buffer carries the Link beat at which its first sample PLAYS on
     Move's output, so Live can place it on the grid.
4. **Default OFF**, switched by a new movy-only toggle in Schwung's Global
   Settings (owner's decision; see *Setting*).
5. **Cost**: nothing when off; close to nothing when on and nobody subscribes;
   only subscribed channels cost CPU and network.

## Non-goals

- Receiving Link Audio into movy (Live → movy tracks). Later, maybe.
- Sends/returns as channels.
- MIDI clock out, or Link while movy is not running.
- A Mac app of any kind.
- Low-latency monitoring through Live.

## Anti-goals (failure even if it "works")

- Any audible cost on Move: a late frame, a glitch-log line, a click, caused by
  Link — on or off, subscribed or not.
- Link work on the audio thread beyond a bounded copy and one seqlock read; any
  syscall, lock, allocation or `fork()` in movy-host for Link.
- Network traffic or a joined Link session while the setting is off.
- Tempo hunting/wobble you can hear, or a Set marked dirty every block by
  phase nudges.
- Live's routing breaking because a channel renamed or vanished on a track change.

## Constraints

- **License:** the Link SDK is GPL-2.0+; movy is MIT. Link lives ONLY in a
  separate process, `movy-link`, talking to movy-host over shared memory (the
  schwung `link-subscriber` precedent, `THIRD_PARTY_LICENSES.md`). movy-host and
  dsp.so never link it. `movy-link`'s source is published GPL (its own SPDX
  header, a `THIRD_PARTY_LICENSES` entry in movy).
- **SDK:** schwung's vendored `libs/link` (Link 4.0, `e9a2e414`) at the PINNED
  tag, extracted by `git archive` like `build-host.sh` does for its sources.
  Build recipe = schwung `scripts/build.sh:453-482` (C++17, `-static-libstdc++`,
  asio-standalone, the `arc4random` compat shim for glibc 2.34). Toolchain:
  `aarch64-unknown-linux-gnu-g++` (present). glibc ≤ 2.35.
- **Clock:** Link's host clock on Linux is `CLOCK_MONOTONIC_RAW`
  (`platforms/Config.hpp:86`). Every time that crosses the SHM is µs on that
  clock. The audio thread reads it once per frame (vDSO).
- **No fork from movy-host** (memory `movy-fork-stalls-audio`): `movy-link` is
  started by `standalone/launch.sh` before it execs movy-host, on both doors
  (boot `--boot` path line ~73, Tools path, and the harness hold loop).
- **Threads:** movy-link runs SCHED_OTHER on cores 0-2
  (`threads::leave_audio_core` equivalent: `sched_setaffinity`). The RT kernel
  runs network IRQ threads at FIFO 50, below render workers (68) and audio (70),
  measured 2026-11-15, so network work cannot preempt rendering.
- **Measured cost ceiling** (proxy, 17 ch): USB ~12 %, WiFi ~25 % of one core
  kernel-side; 0 loss, 0 glitches. The real helper must land within ~1.3× of
  that, measured on the device.
- File size limits, ENGINE_VERSION bump in both places, engine owns Set files.

## Setting

New Schwung Global Settings item **Audio → "Movy Link"** (bool, default off),
stored in `features.json` as `movy_link_enabled`.
- Upstream PR to schwung (CLAUDE.md rule 2): one item in
  `src/shared/settings-schema.json` and one line in
  `schwung-manager/main.go: settingsToFeatures`. Filed in parallel from the
  `fork` remote; movy does not wait for it.
- movy-host reads the key with the existing `settings_file.h` poller (as
  `mirror.c`/`speaker.c` do). Absent key = off, so movy ships before the PR
  lands; until then the toggle can be set by editing `features.json` (documented
  for testers only).
- The UI has nothing to switch; the Main page only shows status (below).

## Architecture

```
 audio thread (core 3)                        movy-link (cores 0-2, SCHED_OTHER)
 ────────────────────                         ──────────────────────────────────
 engine render ─► post-join mix loop          ableton::LinkAudio link
   tap(track i) if subscribed(i) ─┐            ├─ reads audio ring ─► LinkAudioSink ×17
 final out ─► tap(master) ────────┤            │    commit(state, beat_at(play_time))
                                  ▼            ├─ writes session snapshot (seqlock)
            /dev/shm/movy-link  (created by    ├─ writes subscribed mask
             movy-host, swept at its start)    ├─ applies tempo / play requests
                                  ▲            └─ link.enable(setting && host alive)
 engine reads snapshot each block ┘
   follow tempo + phase, start/stop
```

### SHM segment `/dev/shm/movy-link` (one header, versioned)

Created and sized by movy-host at start (the existing `/dev/shm/movy-*` sweep
removes a stale one); movy-link opens it with retry and checks `magic` and
`version`. A C header shared by movy-host, the Rust engine (`#[repr(C)]`
mirror, with an ABI test like `abi-parity.mjs`) and movy-link.

- `host → link`: `enabled` (the setting), `host_pid`, `heartbeat` (frame
  counter), tempo request `{seq, bpm_x100, at_us}`, play request
  `{seq, playing, at_us}`.
- `link → host`: session snapshot under a seqlock — `{peers, tempo,
  beat_anchor, time_anchor_us, quantum, is_playing, play_change_us,
  session_seq}`; `subscribed_mask` (bit i = channel i has a listener);
  diagnostics (buffers sent, drops, last error).
- Audio: 17 SPSC rings of 128-frame stereo int16 blocks (≥ 16 blocks each,
  ~46 ms), each block headered with `{frame_index, play_time_us}`.
  Drop-on-full, counted; the audio thread never waits.

The engine reads the snapshot by value once per block (retry on a torn
seqlock, bounded, else keep last). It computes the session beat at a time as
`beat_anchor + (t - time_anchor_us) * tempo / 60e6` — Link's own timeline
model, so no SDK call is needed on the audio thread.

### Engine (Rust)

- **Tap**: in `chain_slots.rs` post-join loop beside `mix_into`
  (`chain_slots.rs:~1897`), copy the post-fader block of each track whose bit is
  set in `subscribed_mask`; tap the master after `self.master.run`. Unsubscribed
  = one bit test. Stamp `play_time_us` = this frame's output time (see
  *Output time*).
- **Follow** (new pure module in `seq-core`, e.g. `link_follow.rs`, host-tested):
  - Active when `enabled && peers > 0`. Then it beats external MIDI clock follow
    (`on_external_realtime`); with no peers, today's behaviour is unchanged.
    *(Builder's call recorded: Link wins over MIDI clock while peers exist.)*
  - Tempo: the clock runs at the session tempo. A session tempo change becomes
    movy's tempo (stored in the Set like a knob change).
  - Phase: each block, error = session beat − movy beat at the block's output
    time, wrapped to ±quantum/2. Small error → a bounded rate trim on top of the
    tempo (e.g. ≤ ±0.5 %), never stored in the Set. Large error (≥ ~1/8 beat, or
    on join/start) → re-anchor movy's position to the session grid at the next
    quantum boundary (the `ext_base` launch-quantize idea).
  - Start/stop: session `is_playing` false→true at `play_change_us` → movy starts
    so its bar 0 lands on the session's next quantum multiple (immediately if the
    session start itself was quantum-aligned, as Live's is). true→false → movy
    stops at that time.
- **Lead**: a tempo change by the user on movy writes a tempo request; movy
  Play/Stop writes a play request (movy-link calls
  `setIsPlayingAndRequestBeatAtTime(true, t, 0, quantum)` / `setIsPlaying(false,
  t)`). Requests carry a `seq`; follow ignores the echo of its own request
  (no feedback loop — the Play+LINK blink lesson, memory
  `movy-play-link-feedback-loop`).
- **Status** to the UI (the per-block snapshot, pure read): `lk=<off|on>`,
  `lkp=<peers>`, `lks=<subscribed mask>`.

### movy-link (C++17, `link/` in movy, GPL)

Forked from the publisher half of schwung `link_subscriber.cpp`, without the
subscriber, reorder or conceal code. Loop wakes every ~1 ms (cheap, bounded
latency; schwung's 10 ms gave bursts):
1. `link.enable()` iff `enabled` and movy-host alive (heartbeat advanced in the
   last 2 s and `kill(host_pid, 0)` ok). Host dead → close sinks, disable, exit.
2. Sinks: all 17 created when enabled, destroyed when disabled. For each,
   `BufferHandle` valid ⇒ a subscriber exists ⇒ set the mask bit, drain that
   ring and `commit(state, beatAtTime(play_time_us, 4), 4, 128, 2, 44100)`.
   Invalid ⇒ clear the bit and discard the ring (no work).
3. Snapshot: on tempo/start-stop callbacks and every loop, write the session
   timeline to the seqlock.
4. Requests: apply new tempo/play requests to the app session state.
5. `enableStartStopSync(true)`. Peer name **"Movy"**.

### Output time

`play_time_us` for a block = the RAW-clock time its first sample reaches
Move's output. The engine reads `CLOCK_MONOTONIC_RAW` once at the start of
`render_block` (render runs right after the SPI transfer, so no host API change
is needed) and adds a fixed output-latency constant: one frame in flight plus
the codec. The constant is **calibrated once on the device with Live** (record a
movy click on beat 1, measure the offset, set the constant); the builder
records the number and how it was measured.

## Calls made in review (not the owner's; check these)

- **`Movy Master` is post master chain, PRE master volume** (unity, like the web
  mirror undoes `mfx:vol`): the volume knob is for monitoring and must not ride
  the recording. Track channels are unaffected by master volume too.
- **Track channels exclude send returns** (the track's own post-fader signal);
  returns reach Live only inside `Movy Master`.
- **A muted track streams silence**; its channel never disappears.
- **Frozen tracks stream their frozen playback** (same mix loop).
- **Joining a session never stops movy**: only start/stop *edges* that happen
  after movy joined act on movy's transport. Its tempo is adopted on join.
- **Link beats MIDI clock follow while peers exist**; with no peers, MIDI clock
  follow works as today.
- **Phase nudges never reach the Set**; a session tempo change does (it is the
  tempo).
- `movy-link` ships in the store tarball and through `deploy.sh` with the same
  fresh-inode rule as `movy-host`.

### UI

- Main page (`src/seq/main-page.ts`), next to tempo: `LINK <n>` when the
  setting is on (n = peers), nothing when off. A new screenshot baseline.
- No toggle in movy's UI.

### Docs

- `site/manual/system.md`: "Playing with Live over Link" — turning on Movy
  Link, channel names, Start Stop Sync in Live, "monitor on Move, record in
  Live", USB-C works too. Works-like-Move block where it matches Move's Link.
- `README.md` headline bullet. `CHANGELOG.md`.

## Testing

- **cargo** (`seq-core`): follow — join adopts tempo, phase converges without
  overshoot, large error re-anchors on a bar, start aligns bar 0 to quantum,
  stop, echo suppression, MIDI clock vs Link precedence, trim never reaches the
  stored tempo. `movy-dsp`: tap copies exactly `mix_into`'s post-gain block,
  only subscribed tracks, master tap = DAC block; seqlock torn-read handling.
- **host/tests** (C): SHM create/sweep/version, setting poll → `enabled`.
- **movy-link unit tests** (host build, Link SDK compiles on macOS): ring drain,
  mask, heartbeat death → exit, requests.
- **ABI parity**: the SHM header between C, Rust and C++.
- **perf**: `cargo bench` tap at 17 subscribed ≤ 5 µs/block; 0 subscribed ≈ 0.
- **Device tier (required: audio thread, network, launch doors)**: new scenario
  `link` using a probe peer ON the device (a tiny `movy-link-probe` from the
  same SDK, run over ssh): it sees peer "Movy" and 17 channels; subscribing to
  `Movy 3` delivers audio while track 3 plays; setting tempo on the probe moves
  movy's tempo; probe start/stop drives movy transport; setting off ⇒ probe sees
  no peer. Plus scoped `smoke`, and the launch doors (`power`, boot) since
  `launch.sh` changes.
- **Measurement** (`scripts/measure-link-cost.sh`, new): the 2026-11-15 sweep
  (0/2/8/17 subscribed, USB and WiFi) against the real helper with the probe as
  subscriber; glitch log must stay empty.
- **Manual, once**: Live on the Mac records `Movy 1..16` aligned (calibrate the
  output-time constant), tempo and Start/Stop both ways.

## Left to the builder

- Exact SHM layout, ring depth, seqlock details, loop period.
- Phase-trim gains and thresholds (tested in cargo, checked by ear on device).
- Where the Main page status sits and its look.
- Name of the follow module, file splits (200-line limit).
- Whether movy-link tests run in `npm test` or a separate script (must be in
  the local gate either way).
