# Ableton Link (tempo sync + Link Audio out) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** movy joins the Ableton Link session (tempo, phase, Start/Stop Sync both ways) and publishes 20 Link Audio channels, default off behind a new Schwung Global Settings toggle.

**Architecture:** A GPL sidecar `movy-link` (C++17, Link SDK) owns the Link instance. It shares ONE SHM segment `/dev/shm/movy-link` with movy-host (creates it, writes the setting) and the Rust engine (taps audio into per-channel SPSC rings, reads a seqlocked session snapshot, writes tempo/play requests). The follow logic is pure `seq-core`.

**Tech Stack:** C (movy-host), Rust (seq-core, movy-dsp), C++17 + Link 4.0 from schwung's pinned `libs/link`, TypeScript UI.

**Spec:** `docs/superpowers/specs/2026-11-15-ableton-link-design.md`

## Global Constraints

- Default OFF. Setting key `movy_link_enabled` in schwung `config/features.json`; absent = off.
- Channels (index → Link name): 0-15 → `Movy 1`…`Movy 16` (post-fader, post-pan, post-mute, pre-master, no send returns); 16-18 → `Movy Send 1`…`Movy Send 3` (bus returns, post-FX, as summed into the output); 19 → `Movy Master` (after master FX, BEFORE `limiter.process`). Peer name `Movy`. Quantum 4.0. 44100 Hz, 128-frame stereo int16 blocks.
- All SHM times are µs on `CLOCK_MONOTONIC_RAW` (Link's Linux clock).
- Link SDK only in `movy-link` (GPL-2.0-or-later SPDX). movy-host and dsp.so never link it.
- Audio thread: no syscall except one `clock_gettime` (vDSO), no lock, no allocation; drop-on-full rings.
- No `fork()` in movy-host: `launch.sh` starts movy-link.
- ENGINE_VERSION bump in `engine/crates/movy-dsp/src/lib.rs` AND `src/seq/constants.ts`.
- Files ≤ 200 lines (src/, host/, engine modules by convention).
- Phase trim never reaches the stored tempo; joining never stops movy; Link beats MIDI-clock follow while peers > 0.

## Review Focus

1. **movy-link absent / crashed / old** (SHM magic or version mismatch) → movy behaves exactly as today: `peers` reads 0, Play starts immediately. Test: Task 4 `bridge_without_helper_is_inert`.
2. **Setting turned off while playing with peers** → movy keeps playing at its tempo, no stop, no tempo jump. Test: Task 3 `disable_while_following_keeps_playing`.
3. **Play pressed while peers > 0 but helper wedged** (no ack for > 500 ms) → movy starts locally anyway. Test: Task 3 `play_request_times_out_to_local_start`.
4. **Session tempo outside 20-300 BPM** (Link allows 20-999) → clamp, no panic, trim still bounded. Test: Task 3 `out_of_range_session_tempo_clamps`.
5. **Torn snapshot read** (helper mid-write) → engine keeps the previous snapshot. Test: Task 4 `torn_seqlock_keeps_last`.

---

### Task 1: SHM ABI

**Files:**
- Create: `link/movy_link_shm.h` (C, included by movy-host, movy-link)
- Create: `engine/crates/movy-dsp/src/link_shm.rs` (`#[repr(C)]` mirror)
- Test: `host/tests/test_link_shm_abi.c`, Rust unit test in `link_shm.rs`

**Interfaces — Produces:**
```c
#define MOVY_LINK_SHM "/movy-link"
#define MOVY_LINK_MAGIC 0x4B4E4C4Du   /* "MLNK" */
#define MOVY_LINK_VERSION 1u
#define MOVY_LINK_CHANNELS 20
#define MOVY_LINK_FRAMES 128
#define MOVY_LINK_RING 32             /* blocks per channel, ~93 ms */
typedef struct { uint64_t play_time_us; uint64_t frame; int16_t lr[MOVY_LINK_FRAMES * 2]; } movy_link_block_t; /* 528 */
typedef struct { uint32_t write, read, drops, pad; movy_link_block_t b[MOVY_LINK_RING]; } movy_link_ring_t; /* 16912 */
typedef struct {
  uint32_t magic, version;                 /* 0, 4 */
  uint32_t enabled, host_pid;              /* 8, 12  movy-host */
  uint64_t heartbeat;                      /* 16  engine: block count */
  uint32_t movy_bpm_x100;                  /* 24  engine: current tempo */
  uint32_t tempo_req_seq, tempo_req_bpm_x100; /* 28, 32 */
  uint32_t play_req_seq, play_req_playing, pad0; /* 36, 40, 44 */
  uint64_t play_req_at_us;                 /* 48 */
  uint32_t snap_seq, peers;                /* 56, 60  link: seqlock (odd = writing) */
  double   tempo, beat_anchor;             /* 64, 72 */
  uint64_t time_anchor_us;                 /* 80 */
  uint32_t is_playing, tempo_ack_seq;      /* 88, 92 */
  uint64_t play_change_us;                 /* 96 */
  uint32_t play_ack_seq, subscribed;       /* 104, 108 bit i = channel i has a listener */
  uint32_t link_alive, sent;               /* 112, 116 */
  movy_link_ring_t ring[MOVY_LINK_CHANNELS]; /* 120 */
} movy_link_shm_t;                         /* 338360 */
```
Rust: `pub struct LinkShm` with identical fields, `pub const LINK_CHANNELS: usize = 20`, `pub const CH_SEND0: usize = 16`, `pub const CH_MASTER: usize = 19`.

- [ ] Step 1: C test `_Static_assert`s + runtime `offsetof` prints for every field above; Rust test `layout_matches_c` asserts `size_of::<LinkShm>() == 338360` and `offset_of!` for `heartbeat`=16, `snap_seq`=56, `tempo`=64, `subscribed`=108, `ring`=120. Run both → fail (no files).
- [ ] Step 2: write the header and the Rust mirror. Run `bash host/tests/run.sh` and `cargo test -p movy-dsp link_shm` → pass.
- [ ] Step 3: commit.

### Task 2: movy-host creates the segment and publishes the setting

**Files:**
- Create: `host/link_host.c`, `host/link_host.h`
- Modify: `host/main.c` (init after the `/dev/shm/movy-*` sweep, before the engine loads), the UI-thread poll site where `mirror_poll(tick)` runs, `scripts/build-host.sh` (add `-I link` and the new .c)
- Test: `host/tests/test_link_host.c` (wired into `host/tests/run.sh`)

**Interfaces — Produces:** `void link_host_init(const char *shm_dir, const char *features_path);` (creates `shm_dir/movy-link`, size `sizeof(movy_link_shm_t)`, mode 0666, zeroed, magic/version/host_pid set, enabled = 0) · `void link_host_poll(int tick);` (UI thread; reads `movy_link_enabled` with `features_read_if_changed`/`features_value`; `t`→1, anything else →0) · `int link_flag_parse(const char *json);` (exposed for tests).

- [ ] Step 1: tests `creates_segment_with_magic`, `flag_true_false_absent` (`{"movy_link_enabled": true}`→1, `false`→0, `{}`→0), `poll_updates_enabled`. Run → fail.
- [ ] Step 2: implement (mirror.c's poll pattern). Run `bash host/tests/run.sh` → pass.
- [ ] Step 3: commit.

### Task 3: seq-core follow logic

**Files:**
- Create: `engine/crates/seq-core/src/link_follow.rs`
- Modify: `clock.rs` (trim), `engine.rs` (`play`, `stop`, `beat_position`, `advance_block`, `on_external_realtime` precedence), `command.rs` (`bpm` → tempo request), `lib.rs` (mod)
- Test: inside `link_follow.rs` and `engine.rs` test modules

**Interfaces — Produces:**
```rust
#[derive(Clone, Copy, Default, PartialEq, Debug)]
pub struct LinkSnapshot { pub enabled: bool, pub peers: u32, pub tempo: f64, pub beat_anchor: f64,
  pub time_anchor_us: u64, pub is_playing: bool, pub play_change_us: u64,
  pub tempo_ack_seq: u32, pub play_ack_seq: u32 }
impl LinkSnapshot { pub fn beat_at(&self, t_us: u64) -> f64 }   // anchor + (t - anchor_t) * tempo / 60e6 (signed)
pub struct LinkRequests { pub tempo_seq: u32, pub tempo_bpm_x100: u32, pub play_seq: u32, pub playing: bool, pub play_at_us: u64 }
pub struct LinkFollow { /* state */ }
impl LinkFollow {
  pub fn active(&self) -> bool;                 // enabled && peers > 0
  pub fn requests(&self) -> &LinkRequests;
}
// Engine:
pub fn link_block(&mut self, snap: &LinkSnapshot, out_time_us: u64, out: &mut Vec<OutEvent>); // before advance_block
// Clock:
pub fn set_trim_ppm(&mut self, ppm: i32);       // clamp ±5000; advance() scales accum by (1e6+ppm)/1e6
```
Behaviour (values pinned):
- Session tempo → `clock.set_bpm_x100(round(tempo*100))` clamped 2000-30000, only when `tempo_ack_seq >= requests.tempo_seq` (own request settled).
- Phase error `e = wrap(snap.beat_at(out_time) - movy_beat, quantum 4)` in (-2, 2]. `|e| < 0.125` → `trim_ppm = clamp(round(e * 20000), ±5000)`; else → re-anchor: restart transport at the session's next multiple of 4 (pending start, same path as a remote start).
- `is_playing` rising edge with `play_change_us > joined_at_us` → pending start: transport starts in the first block whose output window contains the session's next multiple of 4 at or after `play_change_us` (immediately when `beat_at(play_change_us)` is within 1/64 beat of a multiple of 4). Falling edge after join → `stop`.
- `play()` while `active()` → write play request (`seq+1`, playing, at = out_time) and return; the start comes back through the edge. No ack within 500 ms of `out_time` → start locally.
- `stop()` → stops at once and writes a play request (false).
- `bpm` command while `enabled` → tempo request (`seq+1`).
- `follow_active()` (MIDI clock) is false while `active()`.
- Disable or peers→0 while playing → keep playing at the current tempo, `trim_ppm = 0`.

- [ ] Step 1: failing tests: `beat_at_extrapolates`, `join_adopts_session_tempo`, `own_tempo_request_not_overwritten_until_ack`, `small_error_trims_and_converges` (simulate 2000 blocks, |e| < 0.002 at end, stored bpm unchanged), `trim_never_reaches_stored_tempo`, `large_error_reanchors_on_next_bar`, `remote_start_aligns_bar0_to_quantum`, `edge_before_join_ignored` (joining a stopped session never stops movy), `remote_stop_stops`, `local_play_waits_for_edge`, `play_request_times_out_to_local_start`, `local_stop_is_immediate_and_requested`, `midi_clock_ignored_while_link_active`, `disable_while_following_keeps_playing`, `out_of_range_session_tempo_clamps`, `clock_trim_scales_tick_rate` (in clock.rs: +1000 ppm over 1 min = +0.1 % ticks ±1).
- [ ] Step 2: run `cargo test -p seq-core link` → fail.
- [ ] Step 3: implement. Run `(cd engine && cargo test)` → all pass.
- [ ] Step 4: commit.

### Task 4: movy-dsp bridge, taps, status

**Files:**
- Create: `engine/crates/movy-dsp/src/link_bridge.rs` (map SHM, snapshot read, requests, heartbeat), `engine/crates/movy-dsp/src/link_tap.rs` (ring writer)
- Modify: `lib.rs` (instance owns `LinkBridge`; in `render()`: `bridge.begin_block()` → `engine.link_block(..)` before `advance_block`; status keys; ENGINE_VERSION), `chain_slots.rs` (tap tracks beside `mix_into` ~1897, master between `process_fx` and `limiter.process` via a new `MasterChain::run_tapped(out, tap: impl FnOnce(&[i16]))` split of `run`), `send_bus.rs` (`finish` gains `tap: impl FnOnce(&[i16])` before the buffer is cleared), `src/seq/constants.ts`
- Test: unit tests in both new files against a heap `Box<LinkShm>` (no shm_open)

**Interfaces — Produces:**
```rust
pub struct LinkBridge { /* *mut LinkShm or None */ }
impl LinkBridge {
  pub fn open() -> Self;                         // shm_open(MOVY_LINK_SHM, O_RDWR) + mmap; any failure / magic / version mismatch → inert
  pub fn from_raw(p: *mut LinkShm) -> Self;      // tests
  pub fn begin_block(&mut self, bpm_x100: u32) -> (LinkSnapshot, u64 /*out_time_us*/, u32 /*subscribed*/);
  pub fn write_requests(&mut self, r: &LinkRequests);
  pub fn tap(&mut self, ch: usize, lr: &[i16]);  // no-op unless bit ch in this block's mask; drop+count on full
}
pub const OUTPUT_LATENCY_US: u64 = 2902 * 2;     // one frame in flight + codec; CALIBRATE (Task 8)
```
`begin_block`: heartbeat += 1, movy_bpm_x100 store, seqlock read (≤ 3 tries, else last), `out_time = clock_gettime(CLOCK_MONOTONIC_RAW) + OUTPUT_LATENCY_US`; snapshot `enabled` comes from the SHM `enabled`. Status: ` lk=<0|1> lkp=<peers> lks=<mask hex>`; inert bridge → `lk=0 lkp=0 lks=0`.

- [ ] Step 1: failing tests: `bridge_without_helper_is_inert`, `torn_seqlock_keeps_last`, `heartbeat_and_tempo_published`, `tap_only_subscribed`, `tap_full_ring_drops_and_counts`, `track_tap_equals_mix_contribution` (one track, pan/vol set, tapped block == what `mix_into` added), `send_tap_is_bus_return`, `master_tap_is_pre_limiter_pre_volume` (master volume 0.5 → tap unchanged), `status_carries_link_keys`.
- [ ] Step 2: run → fail. Step 3: implement. Step 4: `(cd engine && cargo test)` + `cargo bench` tap: 20 subscribed ≤ 5 µs/block on host. Step 5: `npm test` (ENGINE_VERSION parity). Commit.

### Task 5: movy-link sidecar

**Files:**
- Create: `link/movy_link.cpp` (main loop), `link/link_rings.hpp` (pure ring/mask/liveness logic, no SDK), `link/tests/test_link_rings.cpp`, `scripts/build-link.sh`
- Modify: `THIRD_PARTY_LICENSES.md` (create if absent): Link SDK GPL-2.0+, movy-link GPL

**Interfaces — Consumes:** Task 1 header. **Produces:** `dist/movy-link` (aarch64), `scripts/build-link.sh [--host-test]`.

Loop (1 ms sleep): open SHM with retry (magic/version check, else wait); `alive = enabled && heartbeat advanced within 2 s && kill(host_pid,0)==0`; host gone > 2 s → exit 0. Enabled edge → `link.enable(true)`, `enableLinkAudio(true)`, `enableStartStopSync(true)`, set tempo from `movy_bpm_x100` before enabling, create 20 `LinkAudioSink(link, name, 256)`; disabled edge → destroy sinks, `enable(false)`. Per sink: `BufferHandle h(sink)`; valid → mask bit on, drain ring blocks, `commit(state, state.beatAtTime(play_time_us,4), 4, 128, 2, 44100)` (copy samples); invalid → bit off, `read = write`. Snapshot each loop under seqlock (`beatAtTime(now,4)`, `now`, tempo, `isPlaying`, `timeForIsPlaying`, `numPeers`). New tempo request → `setTempo(bpm, now)`, `tempo_ack_seq = seq`. New play request → playing: `setIsPlayingAndRequestBeatAtTime(true, at, 0, 4)`, else `setIsPlaying(false, at)`; `play_ack_seq = seq`. `sched_setaffinity` cores 0-2, SCHED_OTHER. Logs to `/data/UserData/schwung/movy-link.log` (rate-limited).

- [ ] Step 1: host tests (clang++ on macOS, no SDK): `drain_order`, `mask_follows_listeners`, `invalid_handle_discards`, `liveness_heartbeat_timeout`, `version_mismatch_waits`. Run `scripts/build-link.sh --host-test` → fail.
- [ ] Step 2: implement; build recipe from schwung `scripts/build.sh:453-482` (`git archive` the PINNED tag's `libs/link` + `src/host/arc4random_compat.c`). Host tests pass; aarch64 build succeeds; `file dist/movy-link` = aarch64; `objdump -T` max GLIBC ≤ 2.35.
- [ ] Step 3: add host tests + `--host-test` to `npm test`'s chain (package.json `test` script). Commit.

### Task 6: Ship and launch

**Files:**
- Modify: `standalone/launch.sh` (start `"$DIR/movy-link" &` before every `exec`/run of movy-host on both doors and the hold loop; never twice: `pgrep -x movy-link` guard), `scripts/deploy.sh`, `scripts/build-module.sh` (include `movy-link`, fresh inode via tmp + mv), `host/tests/` boot-door test if it lists launched binaries.

- [ ] Step 1: extend the boot-door/launch test (`bash host/tests/run.sh`) with `launch_starts_link_once`. Fail → implement → pass. Commit.

### Task 7: UI status

**Files:**
- Modify: `src/seq/engine-status.ts` (parse `lk`, `lkp`), `src/seq/main-page.ts` (draw `LINK <n>` beside tempo when `lk=1`), `browser-test/logic/<seq suite>.mjs`, `browser-test/screenshot.mjs` (scene `main-page-link`)

- [ ] Step 1: logic test `status_parses_link`, screenshot scene → fail. Implement. `node browser-test/screenshot.mjs --update`, `npm test` → pass. Commit.

### Task 8: Device verification

**Files:**
- Create: `link/movy_link_probe.cpp` (subscriber/test peer: `--peers`, `--channels`, `--subscribe <name> <secs>` prints frames received + peak, `--tempo <bpm>`, `--play`, `--stop`), `test-device/scenarios/link.ts`, `scripts/measure-link-cost.sh` (the 2026-11-15 sweep with the probe subscribed to 0/2/8/20 channels)
- Modify: `engine/.../link_bridge.rs` `OUTPUT_LATENCY_US` after calibration (manual, with Live)

- [ ] Step 1: scenario: enable via features.json (restore after), probe sees peer `Movy` + 20 channels; subscribe `Movy 1` while track 1 plays → frames > 0, peak > 0; `--tempo 133` → movy status bpm 13300; `--play`/`--stop` drive movy `play=`; disable → probe sees 0 peers. Run `npm run test:device -- --scenario link,smoke,power`.
- [ ] Step 2: `scripts/measure-link-cost.sh`: glitch log unchanged at 20 subscribed on USB and WiFi; record CPU numbers in the commit.
- [ ] Step 3: calibration with Live (owner present): record movy click → set constant. Commit.

### Task 9: Schwung upstream toggle

**Files (schwung fork branch `feat/movy-link-setting`):** `src/shared/settings-schema.json` (Audio item `{"key":"movy_link","label":"Movy Link","type":"bool"}`), `schwung-manager/main.go` `settingsToFeatures` (`"movy_link": "movy_link_enabled"`).

- [ ] Step 1: branch from fresh `origin/main`, change, `go test ./...` in schwung-manager, push to `fork`, open PR to `charlesvestal/schwung`. Do not wait.

### Task 10: Docs

**Files:** `site/manual/system.md` (section "Playing with Live over Link"), `site/reference/controls.md` if a control appears (none expected), `README.md` bullet, `CHANGELOG.md`.

- [ ] Step 1: write; `node scripts/site/build-assets.mjs --check` passes. Commit, push.
