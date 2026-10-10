# Movy as a standalone Schwung module: migration plan

> **For agentic workers:** each **WP** below is one session. Read *Global
> constraints*, the *Reuse map* and your WP. Then execute: write the short task
> list you need, use TDD where a test can lead, and finish with the gates your
> WP names. A WP may not start until the WPs it depends on have landed on
> `main` with their gates green.

**Goal:** movy stops being an overtake tool that coexists with Move and becomes
a `"standalone": true` Schwung tool (like Dronage) that owns the device: SPI,
audio, display, LEDs and its own master chain and Sets. It can boot directly
into movy, and it keeps today's functionality, debuggability, performance and
tests.

**Architecture:** a small C host, `movy-host`, replaces the shim and shadow_ui.
It is built from schwung's own C libraries (QuickJS, `js_display`,
`js_host_common`, `unified_log`, the SPI lib) at a pinned schwung tag. It loads
the **unchanged** `dsp.so` through `plugin_api_v2`, the same way the shim does,
and runs the **unchanged** `ui.js` in QuickJS behind a platform seam. Until the
switch, the same `ui.js` and `dsp.so` run both as the shipping overtake `movy`
and as a side-by-side dev tool `movy-sa`. **There is never a build in which the
shipping movy does not work.**

**Tech stack:** C (host), Rust (`engine/`, unchanged ABI), TypeScript (`src/`),
schwung sources at a pinned tag, the messense `aarch64-unknown-linux-gnu`
toolchain that `build-dsp.sh` already requires.

**Read on 2026-10-09:** schwung `443466ab` (origin/main), schwung-davebox
`2883827`, dronage-move-release v1.4.3 (release tarball inspected).

---

## Global constraints

- **Minimal switch.** Anything that can be built and verified in today's
  overtake movy is pre-work (Phase A). Anything that only deletes or optimises
  is after-work (Phase C). The switch (Phase B) adds the host and one platform
  implementation, and changes nothing else.
- **One artifact, two flavours, until WP8.** `ui.js` and `dsp.so` are
  byte-identical between `movy` (overtake) and `movy-sa` (standalone). Code that
  differs between the flavours lives in `src/platform/*` and `movy-host`, nowhere
  else.
- **Gates are unchanged.** `./scripts/run-gate.sh both` on every WP that touches
  code (root `CLAUDE.md` checklist). From WP6 on, the device tier also runs
  against `movy-sa`. A WP is done when both flavours it touches are green.
- **Upstream, not patch** (`feedback_upstream-not-patch`). When schwung lacks
  something, file the PR in parallel and carry a clearly marked stand-in. Never
  vendor `param_pages` (movy `CLAUDE.md` Schwung page rule 2).
- **Pin what is compiled in, float what is shared at runtime.** C sources are
  compiled from a pinned schwung **tag** via `git -C $SCHWUNG archive <tag>`,
  never from the live checkout. That makes builds reproducible, and the root
  `CLAUDE.md` refresh rule keeps the checkout itself on `origin/main`. Runtime
  dependencies (shared `.mjs`, chain `dsp.so`, modules) stay on the device's
  installed schwung, guarded by `SCHWUNG_FLOOR` and parity tests.
- `ENGINE_VERSION` rules, atomic `dsp.so` deploy and engine-owned persistence
  (`engpersist`, ON since rev 4) all stand as written in `movy/CLAUDE.md`.
- **Copy forward, never clean up.** A migration step reads legacy state
  (schwung master FX, schwung slot state, Move-bound `sets/<uuid>/`, root-owned
  files, stored flags) and writes *new* state beside it. It never clears,
  moves, deletes or rewrites the source, and it never "enforces" the legacy
  side empty. A temporarily odd state is accepted in exchange for zero data
  loss and less code. Downgrading to the overtake build therefore still finds
  everything it left, and deleting *code* (WP9) never deletes *data*.
- File size limits (200 lines in `src/`, ~600 in tests) apply to `movy-host/`
  as well: one responsibility per `.c` file.

---

## What we learned (the ground this plan stands on)

### How standalone works in schwung today

- `"standalone": true` in a tool's `module.json`. Opening the tool runs
  `launch-standalone.sh <tool>/standalone`. That script asks shadow_ui to save
  (SIGTERM), pauses `move-launcher` through `schwung-heal`, kills
  Move/MoveOriginal/shadow_ui, frees `/dev/ablspi0.0` and runs the binary. When
  the binary exits it restarts Move. **It does not kill `display-server` or
  `schwung-manager`.**
- **Boot target** (`docs/BOOT_TARGETS.md`, recipe tested by
  `tests/host/test_boot_target_standalone_recipe.sh`): put a
  `"boot_target": {"id","name","exec"}` block **after** `id`/`name` in
  `module.json`, and ship a `boot-entry.sh` that runs the binary under `wait`,
  forwards TERM, and execs `schwung-entry.sh` when the binary exits. A boot
  target runs as **ableton** and must start `display-server` and
  `schwung-manager` itself.
- **Per-tool privileged helper:** `schwung-heal` installs a staged
  `modules/tools/<id>/bin/heal.new` as a root-owned 04755 `bin/heal`. This is the
  sanctioned way for a standalone tool to get root.
- **Dronage, the only standalone module in the 155-entry catalog**, is one
  stripped Rust binary. It reuses nothing from schwung at runtime and ships no
  boot target. It keeps its projects in
  `/data/UserData/UserLibrary/DronageMove/projects/` and its recordings in
  `UserLibrary/Samples/…`, and it has its own QUIT menu plus a
  Back+MODE+jog fallback. Its value here is as precedent for data placement and
  the exit gesture; its code has nothing to reuse.
  (`smack-in`/`belt-in` are "standalone" only in the audio-input sense.)
- `schwung_host.c` (the old standalone runtime) is dev-only and never runs on
  the device (`package.sh`: "shadow mode only"). It is **not** a base to build
  on. Its single-threaded loop is the wrong shape for movy's render pool.
- **dbxhost (legsmechanical, read 2026-10-09 at `934b87d0`)** takes the
  opposite route. It forks all of schwung (shim + shadow_ui) into one repo with
  davebox, and its "standalone" binary is a launcher that brings **MoveOriginal
  back up under the fork's shim**, so Move keeps running. That is the right
  route for davebox, which uses Move's own instruments. It is the wrong one for
  movy, whose goals 3 and 6 are to drop Move. Its operational lessons transfer
  almost one-to-one and are folded in below, marked *(dbx)*:
  - **Tool dispatch is first-match.** `tool_config.interactive` /
    `skip_file_browser` were tested *before* `standalone` on some stock
    versions, so `standalone` was silently ignored. `standalone` is read at the
    **top level** of `module.json`, not under capabilities.
  - **At boot, the process *is* `move-launcher.service`.** Exiting reads as
    "Move crashed" whatever the exit code, so quitting must `exec` onward
    (`schwung-entry.sh`, then the selector, then `MoveOriginal`). Never sweep
    MoveLauncher at boot, and never pause the unit (that is yourself).
  - **Use one launcher body for both doors**, selected by a positional
    `--boot` argument. An env var leaked across `exec` into the next session.
  - Boot-time stdout is not journaled, so redirect to a log first.
  - **Handoff audio burst.** Killing Move ungracefully leaves the audio
    hardware driverless, and it bursts at about −3 dBFS for ~1.5 s. dbxhost
    mutes first (control shm byte 49), then sends a graceful thread-directed
    SIGTERM.
  - **A stock update swapped `modules/chain/dsp.so`** under dbxhost and changed
    its behaviour overnight. The chain host is *code*, not shared content.
  - **The blessed helper can be un-setuid'd** by a reinstall (ableton owns the
    module dir). Check it on every launch and re-stage. Never `chown -R` the
    tree, because chown clears setuid.
  - **Hold a single-instance session lock** (`flock` on a `/dev/shm` dotfile).
    Use a **private shm namespace**, and clear stale rings on start:
    `launch-standalone.sh` does not.
  - **Delete capability probes once host and module ship together.** dbxhost
    deleted 378 `typeof host_*` gates, and a ratchet test keeps the count
    falling. Two gates crept back once and nobody noticed for a week.
  - **Run the host C tests in a Linux container.** macOS and glibc disagree on
    opaque types (`sigset_t` is 4 vs 128 bytes).

### What movy depends on today

- **~27 distinct host globals** (`grep shadow_|host_|move_midi_ src/` hits 39
  names, but the rest are schwung file names in comments). The
  param-channel and file globals become simpler. The overtake/coexistence
  family (`shadow_set_overtake_*`, `host_suspend_overtake`,
  `move_midi_inject_to_move`, `shadow_overtake_move_inject_active`,
  `shadow_swap_display`, `shadow_drain_midi_inject`) exists only to share the
  device with Move, so it gets **stubbed, then deleted**.
- **Schwung shared JS at runtime:** `param_pages/*.mjs` (16 modules via
  `src/renderer/schwung-lib.ts`), `shadow_ui_slot_grid.mjs`, `lane_voice_map`,
  `constants`, `input_filter`. They call `print`, `text_width`, `draw_line`,
  `clear_screen`, `move_midi_internal_send`, `shadow_get_held_step`,
  `shadow_get_held_step_is_hold`, `shadow_get_delete_held` and
  `shadow_get_scene_state`. That list is the runtime surface that can break on
  a schwung update.
- **Engine → host vtable** (`engine/crates/movy-dsp/src/host.rs`): `log`,
  `sample_rate`, `midi_send_internal` (notes and clock to schwung slots),
  `midi_inject_to_move` (LINK). The chain host gets a **copy of schwung's
  vtable** and through it reads `get_bpm`/`get_beat_position`/`get_clock_status`
  (chain LFO sync), `slot_recv_channel` and `midi_send_*`. The schwung chain
  `dsp.so` has no other shim dependency (only flag files under
  `/data/UserData/schwung/`).
- **Move-coexistence features** that cannot exist without Move: Background
  mode, LINK (follow Move's transport), Sets bound to Move Sets
  (`active_set.txt`), Move's master volume, the track+volume Move overlay,
  schwung's master FX slots, schwung slot tracks and MIGRATE TRACKS.
- **Device harness:** `schwung-testd` (port 47777; frame clock, engine params,
  pad-LED snapshot, all through the shim's shm), `ui-agent.py` (the UI MIDI
  ring), the display framebuffer file, a `debug.log` grep, `open_tool_cmd`,
  fixture seeding of schwung slot state and Move Sets, and a root restart of the
  whole stack.

---

## Reuse map

| Need | Take from schwung | How | Breaks on schwung update? |
|---|---|---|---|
| JS runtime | `libs/quickjs/quickjs-2025-04-26` | compiled in, pinned tag | no (pinned); bump deliberately with `SCHWUNG_FLOOR` |
| Drawing globals (`fill_rect`, `print`, fonts) | `src/host/js_display.{c,h}` | compiled in | no |
| File/http/tar globals, `eval_file`, module loader glue | `src/host/js_host_common.{c,h}` | compiled in | no |
| Logging to the same `debug.log`/sources | `src/host/unified_log.c` | compiled in | log format only (dev tooling) |
| SPI open/mmap/ioctl, offsets, sysinfo | `src/lib/schwung_spi_lib.{c,h}`, `boot-select.c` frame loop + LED-show reset | compiled in / pattern | no |
| Plugin ABI | `src/host/plugin_api_v1.h` | compiled in; `abi-parity.mjs` | caught by test |
| Param pages, slot grid, lane map | `shared/**/*.mjs` on device | runtime import (as today) | **yes**, guarded by WP1's globals manifest + `schwung-built.mjs` |
| Chain host | `src/modules/chain/dsp/*.c` | **compiled from the pinned tag into movy's payload** (WP2), not dlopened from stock *(dbx)* | no |
| Every other module | `modules/**` | runtime dlopen (shared content) | ABI only, guarded by `abi-parity.mjs` |
| Launch / kill Move / restart Move | `launch-standalone.sh` + `schwung-heal --pause-launcher` | runtime, documented contract | low (documented, upstream-tested) |
| Boot directly into movy | boot selector + `boot_target` block + recipe | runtime contract | low (upstream-tested recipe) |
| Root for RT priority and file ownership | `schwung-heal` per-tool helper staging | runtime contract | low |
| Live screen stream (7681), screenshot tools | `display-server` reads `/dev/shm/schwung-display-live` | movy-host writes that shm | dev tools only; the gate uses testbus `FB` instead |
| Store, file browser (7700) | `schwung-manager` | keeps running / launched by boot entry | no |
| MIDI inject tools | `/dev/shm/schwung-midi-inject` ring format | movy-host drains it | dev tools only |
| LED queue semantics (last-writer-wins per note, ≤20 pkts/frame) | `shadow_led_queue.c` | **pattern only**: it pulls `clip_state`/`rec_arm`, so re-implement ~80 lines | no |

**Upstream PRs this plan files** (in parallel, never blocking):

- **U1 "standalone SDK" build target:** schwung's `build.sh` emits
  `libschwung_standalone.a` (QuickJS + js_display + js_host_common + unified_log
  + spi_lib) plus headers as a release asset, so movy links a published artifact
  instead of compiling a source subset (filed in WP6).
- **U2** Document `schwung-display-live` and the MIDI-inject ring as stable
  contracts for standalone tools (WP6).
- **U3** Whatever WP0 finds missing for power-off or RT priority under a boot
  target (WP0/WP7).
- **U5** `launch-standalone.sh`: mute before teardown, give Move a graceful
  shutdown, and clear stale `/dev/shm/schwung-*`, if WP0 measures a handoff
  burst *(dbx)*.
- **U6** `open_tool_cmd` → `launchToolConfirmed`, so a standalone tool can be
  opened programmatically (WP0 finding 3; filed with WP6).
- **U4** If param_pages grows a `shadow_*` dependency, an injectable
  "host adapter" argument instead of a bare global (raised only if WP1's
  manifest shows churn).

---

## Retired by design (accepted, see *Decisions*)

These cannot exist without Move running beside movy. Goal #1 ("exactly the same
functionality") is read as *everything except these*:

| Feature | Standalone replacement |
|---|---|
| Background mode (park under Move's UI) | none: the Leave modal offers only **Close Movy** |
| LINK (start/stop with Move's sequencer) | none in migration; Ableton Link proper is optional after-work (C-opt) |
| Sets follow Move's active Set | movy's own set manager (WP4, designed separately) |
| Move master volume / Move volume overlay | movy master volume on the master chain (WP3); track+volume works on all 16 tracks, no Shift needed |
| Schwung master FX slots | movy-owned master chain (WP3) |
| Schwung-slot tracks, MIGRATE TRACKS | already dead weight (every track is a movy chain); deleted in WP9 |

The UX cost to flag: opening movy from Move now restarts Move on exit (seconds,
measured in WP0). Booting straight into movy (WP8) is meant to become the main
way in.

---

## Phase 0: spike

### WP0: inventory and feasibility spike

**Why first:** five unknowns can each change the shape of WP6, and none of them
is answered by reading code.

**Deliverables:**

1. `docs/standalone/inventory.md`: every host global, every
   `host_api_v1_t` field and every shared-JS global, each with a disposition
   (*native* / *stub* / *retire*) and the file:line that uses it. Plus every
   Move-dependent behaviour, including what external USB-MIDI does today (does
   it reach movy chains?), and every harness dependency.
2. A throwaway standalone dev tool `movy-lab` (`module.json` with
   `standalone: true`, binary at `tools/movy-lab/standalone`, about 400 lines of
   C on the `boot-select.c` skeleton). It must:
   - open SPI, drive `WAIT_AND_SEND`, stop the LED show, and paint text through
     QuickJS + `js_display` (proves the pinned-tag build works);
   - dlopen the **current** movy `dsp.so` with a hand-made `host_api_v1_t`,
     load a 2-chain test Set, and play a pad note through it (proves the engine
     runs with no shim);
   - log every RX MIDI event (cable, CIN, bytes), which captures the **power
     button**, volume-knob touch, jog, and USB-A external MIDI signatures;
   - try `SCHED_FIFO` on the audio thread and report `EPERM` or the priority;
     measure `spi_tx_time`, render µs and frame headroom over 60 s;
   - handle SIGTERM within 1 s; on exit, check that `launch-standalone.sh`
     brings Move back;
   - **record the audio across the Tools→standalone handoff** (USB-C or
     line-in capture) and measure any burst *(dbx)*; and confirm which of
     `tool_config` / `standalone` wins in the installed schwung's tool
     dispatch;
   - write `/dev/shm/schwung-display-live` and confirm `display-server` streams
     it (same 1024-byte packing as `js_display_pack`?);
   - record the uid it runs as when launched from Tools (expected root) and as
     a boot target (expected ableton).
3. `docs/standalone/spike-findings.md`: numbers (open-from-Move time,
   exit-to-Move time, frame headroom compared with the overtake
   `docs/track-performance.md` §7 baseline), the power-button signature,
   headphone/speaker routing without Move, the RT verdict, and a go/no-go per
   risk in the *Risk register*.

**Verification:** a manual-free script, `scripts/spike-movy-lab.sh`, that
deploys, launches via `open_tool_cmd`, collects the log over ssh after the
binary exits, and checks that Move is back. Shipping movy is untouched, so the
gates are skipped as docs/scratch only (say so in the commit). `movy-lab` is
deleted in WP6.

**Exit:** every risk R1–R6 has a verdict; WP6's design choices (RT path, uid
path, power handling) are fixed in the findings doc.

**Done 2026-10-09** (branch `standalone-migration`): `docs/standalone/inventory.md`
and `docs/standalone/spike-findings.md`. Plan-changing results, all in the
findings doc §3. (1) ableton cannot get SCHED_FIFO (Move uses file caps), so
movy-host runs as ableton and a staged `bin/heal` helper promotes its threads.
(2) `open_tool_cmd` cannot open a standalone tool (new upstream **U6**). (3)
WP8 must change `component_type` off `overtake`: overtake is scanned before
`standalone`. (4) No systemd on the device, so the launcher pause never runs.
(5) The shared JS needs quickjs-libc `std`/`os`. (6) The speaker EQ is a shim
feature (R8).

---

## Phase A: pre-work, shipped in overtake movy

Every WP here lands on `main`, ships in the normal overtake release, and is
gated exactly as today. None of them needs movy-host.

### WP1: the platform seam (UI)

**Goal:** movy's TypeScript touches the host through exactly one module, so the
standalone flavour is one new file, not a sweep.

- Create `src/platform/` with: `platform.ts` (the `Platform` interface plus
  `caps`); `overtake.ts` (today's globals, moved verbatim); `index.ts`
  (picks the implementation once at init); and `caps.ts`, where
  `coexistsWithMove` gates background mode, LINK, the Move volume divert,
  overtake suppress, Move inject and `set-commit`'s overtake lowering.
  `canSuspend` and `ownsMasterVolume` are also caps.
- Route **every** current global call site through it: `host/param.ts`
  (already the param door), `track/shim-port.ts`, `undo/module-*.ts`,
  `mixer/track-volume.ts`, `app/led-ownership.ts`, `seq/engine.ts`,
  `seq/set-commit.ts`, `renderer/schwung-canvas.ts`, `app/init.ts`, file I/O
  sites and the router's root-Back path.
- `browser-test/logic/source-rules.mjs`: fail on any
  `shadow_|host_|move_midi_` identifier in code (comments excluded) outside
  `src/platform/`, with the same
  grep style as the `hierarchy-source` rule.
- **Globals manifest:** a generated `browser-test/host-globals.json` lists every
  global movy references plus every global the shared JS it imports references.
  The shared JS side is computed from the `$SCHWUNG` checkout by
  `scripts/host-globals.mjs`. A new suite, `browser-test/host-globals.mjs`,
  fails when the shared JS starts using a global the manifest doesn't list.
  That is the early warning for a schwung update that would break the
  standalone flavour; WP6 makes movy-host answer every entry.
- Mocks: the browser-test globals become one mock `Platform`.

**Behaviour change:** none. **Gates:** both tiers. **Size:** mechanical but
broad; the source-rule makes it self-checking.

**Done 2026-10-09** (branch `standalone-migration`): `src/platform/`
(`platform.ts`, `caps.ts`, `overtake.ts`, `index.ts`, and `host-globals.d.ts`,
which now holds every `shadow_*`/`host_*`/`move_midi_*` declaration). Every call
site goes through `platform`. `source-rules.mjs` Rule 3 bans those names outside
`src/platform/`, and Rule 1 now guards `platform.engine*` instead of the raw
globals. `scripts/host-globals.mjs` writes `browser-test/host-globals.json`
(56 movy globals and 13 shared). It finds unresolved names with the TypeScript
checker plus a walk over `globalThis.<name>`, because `page_controller` reaches
the held-step state that way. `browser-test/host-globals.mjs` is in `npm test`.
`logic/platform-caps.mjs` checks that a platform with `coexistsWithMove: false`
silences background mode, the LED claim, set-commit and the volume divert.
Notes for WP6:
- A platform method returns `undefined` only when the host *lacks* the call.
  A present call that answers nothing maps to its call site's old verdict
  (for example `engineSetBlocking` → `!== false`). The param door depends on
  that distinction.
- **Deviation:** the browser suites still mock the raw globals instead of one
  mock `Platform`. `overtake.ts` reads each global at call time, so those mocks
  now exercise the real overtake implementation. Converting 57 suites would
  have tested less. The standalone platform gets its own suite in WP6, and
  `setPlatformForTest` is how it gets in.
- `perf-probe` wraps `platform.ipcCalls`, so the host names its own round trips.

### WP2: the engine owns its host vtable and clock

**Goal:** the chain host and every module see a vtable **movy synthesises**,
fed by movy's own transport, so standalone needs nothing from schwung's clock.

- `movy-dsp`: build one `host_api_v1_t` per process (extend `chain_host`'s
  existing copy). It forwards `log`, `mapped_memory` and the audio offsets;
  routes `midi_send_*` as today; and answers `get_bpm`, `get_beat_position` and
  `get_clock_status` from `seq-core`'s clock instead of schwung's. Set
  `slot_recv_channel` and keep the `reserved[8]` tail rule from `ffi.rs`.
- **Pin the chain host** *(dbx)*: build `chain-host.so` from the pinned
  schwung tag's `src/modules/chain/dsp/` (with the same `git archive` step
  WP6 uses) and ship it in movy's payload. The engine loads that instead of
  stock `modules/chain/dsp.so`. Run it behind a flag first; it defaults ON once
  the tier is green. This is verifiable in overtake movy, and it removes the
  coupling that changed dbxhost's behaviour under it.
- A host-mode param, `host_mode=overtake|standalone`, set by the UI from
  `platform.caps`. In `standalone`, `midi_send_internal` to schwung slots and
  `midi_inject_to_move` are skipped (no slots, no Move); in `overtake` nothing
  changes.
- Tests: `cargo test` for clock→vtable values across tempo changes and
  start/stop; `abi-parity.mjs` stays exact; device `lfo.ts`, `master-chain.ts`
  and `sends.ts` must stay green. Synced chain LFOs are what would show a
  wrong beat position.
- Bump `ENGINE_VERSION`.

**Gates:** both tiers plus `cargo test`.

**Done 2026-10-09** (branch `standalone-migration`, ENGINE 0.86.0):
- `movy-dsp/src/host_vtable.rs` holds the one vtable, moved out of
  `chain_host.rs`. It keeps the parked MIDI sends, and `get_bpm`,
  `get_beat_position` and `get_clock_status` answer from atomics that
  `Instance::render` publishes after `advance_block`. The beat comes from
  `seq_core::Engine::beat_position()`: quarter notes since Play, None while
  stopped. Beat 0 is tick 0 *serviced*, which is where the first 0xF8 used to
  go, so the phase matches what schwung's transport service gave. While
  following Move it moves in whole ticks.
- **Behaviour change (accepted as WP2's point):** a synced LFO in a movy chain
  now follows movy's transport only. Move playing while movy is stopped no
  longer drives it, and while stopped it free-runs at movy's live tempo. The
  MANUAL LFO paragraph says so. Master FX and schwung slots still run on
  schwung's vtable and are unchanged.
- **Pinned chain host:** `scripts/lib/schwung-pin.sh` holds the tag (v1.7.3), and
  `scripts/build-chain-host.sh` builds it from `git archive` with upstream's
  compile lines. Its exported symbols are identical to the stock build;
  the compiler differs (GCC 15 vs Debian 12). `build-dsp.sh` calls it, so
  deploy.sh, the device tier and the store tarball all ship `chain-host.so`.
  deploy.sh and `test-device/engine.ts` count it as engine: temp+mv, plus a
  restart when it changes. The engine still loads a COPY (`chain-pinned.so`,
  separate from the stock copy `chain-dsp.so`), because a store update untars
  over the shipped file at the same inode. The `chpinhost` flag (debug, default
  ON) selects it, and a payload without the file falls back to stock.
- The engine param is `hostmode`, not `host_mode`: source-rules Rule 3 reads
  any `host_*` token outside `src/platform/` as a host global. Under
  `standalone`, `host::midi_send_internal` and `midi_inject_to_move` return
  false before reaching the host.
- Tests: cargo tests for `beat_position` (stopped, rate, alignment with clock
  #24, tempo change, restart; each one was shown to fail with the fix removed),
  the vtable, the host-mode skip and the source pick. Smoke check
  `chain-host-pinned` reads `/proc/<MoveOriginal>/maps` as root. Before this
  change it showed `chain-dsp.so`.

### WP3: movy-owned master chain and master volume

**Goal:** finish and implement the parked
`docs/superpowers/specs/2026-09-10-movy-owned-master-chain-design.md`. This is
needed in both futures, and it is the only pre-work item users see.

- Write that spec's missing §5: the `mfx:` namespace (mirroring
  `parse_send_key`), persistence in `chain_doc.rs`, and migration. Do this as the
  first step of the session, without a separate design round, because the
  architecture is already agreed in §2–§4.
- Engine: a master `ChainInstance` at `master_index()`, FX-only, 4 FX + 2 LFOs.
  It runs at the tail of `ChainSlots::render`, with `mod_tick()` **before**
  `process_fx()`, under the same idle rule as `send_bus::should_process`, inside
  the existing `render_ns` bracket. Add a CPU-page column. Add a **master
  volume** gain stage and a safety limiter after it. In overtake mode, master
  volume stays at unity, and Move's knob keeps driving Move's own volume. The
  stage exists so that standalone only changes who turns it.
- UI: **the binding follows the host mode.** Under `host_mode=overtake` the
  MASTER page stays on schwung's `master_fx:*`, exactly as today, so overtake
  users see no change. Under `host_mode=standalone`, or the test flag
  `mstown=1` in overtake, it binds to the movy master port. Undo covers both.
- Import (copy only): the first time a Set is opened with the movy master
  bound, and that Set's movy master has never been imported, read schwung's
  saved master for it (`set_state/<uuid>/master_fx_*.json`, a **file read**, so
  it also works in standalone with no shim) and load those modules and params
  into the movy master. Mark the movy side as imported. **Schwung's master is
  never cleared and never enforced empty**, and nothing is written back.
  Consequence, accepted: with `mstown=1` in overtake, an imported Set runs its
  master FX twice (movy's, then schwung's). That only ever happens in a test
  mode, and in standalone schwung's master is not in the audio path at all.
- Tests: cargo tests (LFO ticks on an FX-only chain, idle tail, digest folds
  before the master), `master-chain.ts`/`master-fx.ts` device scenarios
  run once per binding (overtake: schwung master; `mstown=1`: movy master), plus
  an import scenario that also asserts schwung's files are **byte-identical**
  afterwards. Update the
  MANUAL master-chain section.
- Bump `ENGINE_VERSION`.

**Split point if it overruns:** engine+doc+keys (one session), then UI binding
and import (the next).

**Done 2026-10-10** (branch `standalone-migration`, ENGINE 0.87.0, one session):
- Spec §5 written (`docs/superpowers/specs/2026-09-10-movy-owned-master-chain-design.md`).
  `mfx:` is schwung's `master_fx:` key layout with movy's prefix, so binding
  is a prefix swap (`chain/master-prefix.ts`, `master-binding.ts`).
- Engine: `master_chain.rs` (stage, volume `mfx:vol`, −1 dBFS limiter, held
  writes until queued loads land) behind `mfx:own`, default 0, so overtake
  output is bit-identical. The document slot is `master_index() = RENDER_SLOTS`,
  outside the pool; only the document and the load queue grew (`DOC_SLOTS`).
  The import mark rides the chain document as `(master_index, "imported", "1")`.
  `mfxlog` is the read-back, `mfxcost` the CPU-page column (`M`).
- UI: `mstown` (debug, `uiOnly`, next open) or no Move beside → `mfx:`. The
  browser loads `mfx:` by id, schwung's master by path. Import
  (`chain/master-import.ts`) on `sapl`, two phases, never writes a file.
- **Deviation:** the plan said to run `master-chain.ts`/`master-fx.ts` once per
  binding. Those two test schwung's master (persistence through schwung's
  saver and a reboot), which the movy binding does not use, so instead one new
  scenario, `master-own.ts`, binds movy's master through a probe seam
  (`bindMaster`, no prefs write) and covers import, mark, audio through the
  stage, byte-identical schwung files and unbinding.
- Master volume is not per-Set and is not saved yet; standalone (WP7) decides
  where it lives.

### WP4: set manager core (after its separate design)

**Depends on:** the set manager design, which you said is designed separately.
This WP implements it in overtake movy behind a flag (`setsrc=MOVY`, default
OFF until the WP's own gate). Flipping it on breaks the tie to Move's
`active_set.txt`.

What the migration needs from the design, at minimum:

- Sets live in a data root independent of Move and of the module directory.
  `/data/UserData/UserLibrary/Movy/` follows Dronage's precedent and survives a
  module reinstall.
- list / open / new / rename / duplicate / delete; the last-open Set
  reopens at launch; version history (`version_store.rs`) carries over.
- Import of every existing Move-bound Set (`sets/<uuid>/`) with its Move
  name, as a **copy** into the new library. The legacy `sets/<uuid>/` stays
  where it is, and so does schwung's `set_state/<uuid>/`. Re-running the import
  skips Sets already imported and never overwrites a library Set. Accepted
  oddity: after the switch, edits live only in the library, so a downgrade
  opens the pre-import state.
- **Set GC is keyed on Move's Sets** (`set_gc.rs` deletes `sets/<uuid>/` once
  Move's Set is gone). It must never touch the new library, and under
  `host_mode=standalone` it does not run at all; the library has its own
  explicit delete.
- **Ownership comes from the copy, not a chown.** The import runs as whatever
  uid writes the library, so the new files are owned correctly. Root-owned
  legacy files only need to be readable, and 644 is. If WP0 shows movy-host
  runs as root in both doors (R1's helper), there is nothing to do. If it
  runs as ableton, the import runs at standalone's first launch (WP8), never
  as root.
- Device fixture: seed movy Sets directly (no `set_state/<uuid>`, no Move Set
  materialisation, no stack restart to seed). This is the first concrete win
  for goal 8.

**Gates:** both tiers, with the fixture change landing in the same commit.

### WP5: harness transport seam and testbus spec

**Goal:** device scenarios talk to an interface, so the standalone flavour is a
second implementation, not a rewrite.

- `test-device/transport.ts` is the interface: `uiMidi`, `dspMidi`, `frames(n)`,
  `engineGet`/`engineSet`, `padLeds`, `framebuffer`, `logGrep`, `open`,
  `restart`, `deploy`. `transport-overtake.ts` wraps today's
  `Bus`/`Agent`/`Display`/`device.ts`. Scenarios and `fixture.ts` import only
  the interface.
- Scenarios that test coexistence (background, LINK, migrate, schwung master
  FX) get tagged `needs: 'move'`. The runner skips them by declaration, never
  silently, and prints them as **N/A** (a gate may still only be GREEN or RED).
- `docs/standalone/testbus.md` is the movy-host test bus protocol, a strict
  superset of the schwung-testd subset `bus.ts` uses: `PING`, `STATE`,
  `WAIT_FRAME n`, `GET_PARAM`/`SET_PARAM` (engine), `INJECT_MIDI` (hardware
  input, i.e. it reaches the UI *and* the engine, which kills the two-ring
  split), `SNAPSHOT_PAD_LEDS`, `SUBSCRIBE`/`DUMP`, plus new `FB` (1024-byte
  framebuffer), `LOG_TAIL`, `QUIT` and `UI_EVAL` (dev builds only).

**Behaviour change:** none. **Gates:** device tier green on the refactored
harness.

**Done 2026-10-10** (branch `standalone-migration`). `test-device/transport.ts`
(interface; `move` is the coexistence door, null without Move) and
`transport-overtake.ts`; `Ctx` carries `tx` instead of `bus`/`agent`; engine
keys are unprefixed everywhere outside the overtake transport, and the nine
copied `engine-param.mjs` helpers are now `tx.engineSetQueued`. `needs: 'move'`
tags `master-fx`, `migrate` and `volume`; smoke's park/resume section checks
`tx.has('move')`. `run.mjs --flavour` accepts `overtake` only until WP6.
`browser-test/device-scripts.mjs` fails a scenario or shared harness file that
imports `bus`/`agent`/`daemon` or spells `overtake_dsp:`. The protocol is in
`docs/standalone/testbus.md`; its choices for WP6: `QUIT` keeps testd's
close-the-connection meaning and `EXIT` stops movy-host; `LOG_SEQ`/`LOG_TAIL`
make log deltas exact; `STATE` carries `overtake_mode`/`shim_counter` compat
keys so `Bus` works unmodified; the bus is off unless `MOVY_TESTBUS=1` or a
`testbus` file sits in the module dir (`launch-standalone.sh` drops the env).
The fixture's schwung-slot and Move-Set half (`fixture.ts` ssh paths) is still
overtake-shaped. It is reached by plain ssh, not the transport, and WP7 gives it
a standalone branch.

---

## Phase B: the switch

### WP6: movy-host core

**Depends on:** WP0 (findings), WP1, WP2, WP5 (protocol). WP3 and WP4 are
**not** required to run, only to reach parity in WP7.

New top-level `movy/host/` (C, ≤200 lines per file), built by
`scripts/build-host.sh` from `git archive <SCHWUNG_HOST_TAG>` sources with the
existing cross toolchain (glibc ≤ 2.35). It prints the pinned schwung tag and
movy commit on `--version` and in its first log line.

| File | Responsibility |
|---|---|
| `main.c` | single-instance `flock` on `/dev/shm/.movy-session.lock` *(dbx)*; private shm prefix `/movy-` and a stale-ring sweep; output fades in from silence; args, signals (TERM/INT → clean shutdown ≤1 s, crash handler → backtrace to `debug.log`), thread start, schwung version check vs `SCHWUNG_FLOOR` (refuse with an on-screen message, never a black screen) |
| `spi.c` | open/mmap/`SET_SPEED`, the `WAIT_AND_SEND` loop on the audio thread (RT per WP0), LED-show reset at start |
| `audio.c` | one block: drain the param queue, `on_midi` for queued MIDI, `render_block`, write to OFF_OUT_AUDIO; audio-in is natively available via `mapped_memory` |
| `vtable.c` | the `host_api_v1_t` given to `dsp.so`: `log`→unified_log, `midi_send_external`→out ring cable 2, `mapped_memory`=SPI page; clock fields are the engine's (WP2) |
| `param_queue.c` | UI→audio request queue (MPSC, N slots, **not one**), serviced between blocks; blocking get/set wait ≤1 frame. Implements the `host_module_*` and bulk `overtake_dsp:` semantics without any lost-write mode |
| `midi_in.c` | RX parse (8-byte events, XMOS heartbeat at 248, cable 0 hardware / cable 2 external), knob-delta accumulation and re-encode exactly as shadow_ui (`overtakeKnobDelta`), held-step/delete-held state for the shared-JS globals, drain of the schwung-midi-inject ring |
| `midi_out.c` | out ring ≤20 pkts/frame; LED last-writer-wins per note with the channel preserved (the `cachedSetAnimLED` handshake still holds) |
| `display.c` | `js_display_pack` → 6 SPI slices, plus a copy to `/dev/shm/schwung-display-live` (format confirmed in WP0) |
| `ui.c` | UI thread: QuickJS runtime, `js_display_register_bindings`, `js_host_register_common`, absolute-path module loader for `/data/UserData/schwung/shared/**`, `js_std_await` on load (keeps `schwung-lib.ts`'s top-level await valid), tick at ~200 Hz or on input, call `tick`/`onMidiMessageInternal`/`onMidiMessageExternal`/`onUnload`, JS exceptions logged **with stack** (better than shadow_ui's silent eject) |
| `globals.c` | the native globals from WP0's inventory; every coexistence global from the WP1 manifest as a no-op that logs once; `host_exit_module` → clean exit |
| `testbus.c` | the WP5 protocol on 47777 (localhost unless `MOVY_TESTBUS_BIND`); in this WP the subset `PING`, `STATE`, `WAIT_FRAME`, `INJECT_MIDI`, `FB`, `GET/SET_PARAM`, `QUIT` |

Also in this WP:

- `src/platform/standalone.ts`: caps `coexistsWithMove=false`,
  `canSuspend=false`, `ownsMasterVolume=true`. It sets `host_mode=standalone`
  on the engine.
- Packaging for the dev tool `movy-sa`: `module.json` with `standalone: true`,
  the binary as `standalone`, plus copies of `ui.js`/`dsp.so`. Add
  `bin/heal.new` (the root launcher that runs movy-host with RT priority) **if**
  WP0 said ableton cannot get `SCHED_FIFO`. `deploy.sh --sa` installs it.
- `browser-test/host-globals.mjs` extended: every manifest entry must be
  registered by `globals.c` (it greps the C source), so a schwung update that
  adds a shared-JS dependency fails locally, before the device.
- Unit tests for the C host (`movy/host/tests/`) run natively **and** in a Linux
  container (`scripts/test-host-linux.sh`, ubuntu image) *(dbx)*. That
  container is the seed of WP12.
- If a helper is used, the launcher checks on every start that
  `bin/heal` is still root 04755, and re-stages `heal.new` if not *(dbx)*.
- Delete `movy-lab`. File U1 and U2.

**Exit:** on device, `movy-sa` opens from Tools, plays a fixture Set, shows the
UI, responds to injected pads and knobs, saves, quits back to Move, and survives
SIGTERM. The `smoke` scenario passes through `transport-standalone.ts`, which
WP6 writes in its minimal form. Shipping `movy` is unchanged, and both local
gates are green.

**Split point if it overruns:** (a) spi/audio/vtable/param_queue/midi with a JS
stub UI, then (b) ui/globals/display/testbus.

### WP7: standalone parity

**Goal:** `movy-sa` passes the whole device tier, with the debugging and
performance surface intact.

- testbus: full protocol (`SNAPSHOT_PAD_LEDS`, `SUBSCRIBE`/`DUMP`, `LOG_TAIL`,
  `UI_EVAL`); `transport-standalone.ts` complete; restart is just "restart the
  movy-host process", with no Move, no root stack restart and no Move-Set
  fixture.
- Standalone behaviour behind caps: the Leave modal without Background; the
  volume knob → master volume (WP3 stage); track+volume on all 16 tracks
  without the Move overlay; the **power button** → shutdown dialog → poweroff
  path per WP0 (helper or U3); exit via Close Movy plus a Dronage-style hard
  fallback combo.
- Debuggability checklist, each item proven by a scenario or script:
  `dev-probe.sh log|status`, `capture-screen.mjs` (display-server),
  `grab-screen.mjs`, CPU meter, `perf-probe.ts` `perf_ipc`, engine `diag`
  commands, `inject-*.py` via the inject ring, JS stack traces, native crash
  backtrace.
- Performance comparison on the same fixture Set, overtake vs standalone:
  frame headroom, CPU-page totals, `perf_refresh_ms` median, pad-to-sound
  latency (`measure-pad-latency.sh`, ported to the transport). Every number must
  be equal or better; results go in `docs/track-performance.md` as a new
  section.
- `run-gate.sh device --flavour sa` runs the tier against `movy-sa`;
  `needs: 'move'` scenarios print N/A.

**Exit:** both flavours green on the full tier; the perf table shows no
regression; MANUAL draft for the standalone behaviours.

### WP8: the switch

- `movy` **becomes** the standalone flavour: `module.json` gets a top-level
  `standalone: true` and **drops `tool_config` and the overtake capabilities**
  (first-match dispatch *(dbx)*), and `min_host_version` is set to the release
  WP0 verified. It also gets
  the `boot_target` block placed after `id`/`name` (`{"id":"movy","name":"Movy",
  "exec":"boot-entry.sh"}`), and `boot-entry.sh` from the upstream recipe. Both doors run one body,
  `standalone` (`--boot` as a positional argument, never an env var). At boot it
  never exits: on quit it `exec`s `schwung-entry.sh`, then the selector, then
  `MoveOriginal`. It never sweeps or pauses MoveLauncher, and it redirects
  stdout to `movy-launch.log` before anything else *(dbx)*. Pin it with a host
  test like dbxhost's `test_boot_target_second_door.sh`. The
  entry also starts `display-server` and `schwung-manager` when they are not
  running. Retire the `movy-sa` id (`deploy.sh` cleans it up).
- **Same catalog module, updated in place; no new module id.** Checked
  against schwung `443466ab`:
  - The catalog entry (`id: movy`, `component_type: tool`) has no
    type-specific field. `release.json` in the movy repo drives the download,
    so a new release shows up as an ordinary **Update**.
  - The manager's install is an atomic **merge** (`atomic_install.go`): each
    shipped file is renamed into place with a new inode, and everything else
    in `tools/movy/` (Sets, leftovers from the overtake build) stays.
    Replacing a *running* `standalone` binary is therefore safe; the old
    process keeps its inode.
  - The Tools menu re-reads every `module.json` on entry
    (`scanForToolModules`), so the next open after the update launches
    standalone with no reboot. `standalone` wins over `tool_config` since
    v1.6.0 (#557); dropping `tool_config` makes that moot on older hosts too.
  - The manager reconciles `boot_target` on every install and update, so the
    picker row appears. It never becomes the default by itself; the user picks
    it once in the boot window (document this in the MANUAL).
  - **`min_host_version` is per catalog entry, not per release.** Raise it with
    a catalog PR to the first schwung that has standalone dispatch, the
    launcher-watchdog pause and per-tool helper blessing. That is ≥ 1.6.0;
    WP0 confirms the exact release. Users on an older schwung are then refused
    the update and keep their overtake movy. movy-host still checks
    `SCHWUNG_FLOOR` at startup, for side-loads and for the time before the
    catalog PR merges.
  - **Roll out on the module beta channel first**: `release.json`
    `channels.beta` carries the standalone build, and `stable` stays overtake
    until the WP8 gate. Beta is opt-in (`beta_channel_enabled` in the manager),
    so only volunteers get it. There is no automated downgrade (the store only
    offers newer), so a rollback is a fix-forward stable release.
  - Device checks for the update path, each one scripted: update with movy
    closed; update while overtake movy is **open**; update while it is **parked
    in Background** (the next Tools open kills that stack, so engine autosave
    must already hold the state); update while movy-standalone is running
    (the restart prompt); and the Tools quick-launch / last-tool paths, in
    case one of them reads cached metadata.
- `build-module.sh`/`release.json`: the tarball carries `standalone`,
  `boot-entry.sh`, `ui.js`, `dsp.so` and `bin/heal.new`. Verify the store-update
  path against a **running** movy (the dsp.so-inode lesson; the executable gets
  `ETXTBSY`) per `docs/schwung-atomic-module-install.md`.
- First standalone launch: run WP4's copy-import for any Set not yet in the
  library (and WP3's master import happens on each Set's first open). Legacy
  files are only read. If the library itself is not writable, refuse with an
  on-screen reason and never fall back to writing the legacy tree.
- Docs: MANUAL ("Opening Movy", boot into movy, Leave/Close, volume, master,
  Sets), README headline ("boots straight into Movy"), CHANGELOG, Discord note,
  `movy/CLAUDE.md` (the module type, the dev loop, "restart the stack" → "restart
  movy-host").
- Release per `docs/RELEASING.md`; a catalog PR if the catalog entry needs to
  change.

**Exit:** release tagged; the boot target is verified on hardware (boot → movy,
Back during the window → picker, quit → Schwung); device tier green on the
release build.

---

## Phase C: after-work

Each item is independent once WP8 has shipped. **Keep the overtake code for one
release after WP8** so a user can downgrade; WP9 starts after that.

### WP9: delete the coexistence code

`src/platform/overtake.ts`, background mode (`leave-modal` Background,
`resume.ts`, `overtakeParked`), LINK and `midi_inject_to_move`,
`track/shim-port.ts` and schwung-slot ports, MIGRATE TRACKS, Move-Set identity
(`active_set.txt`, pending-sets, materialisation), the schwung master-FX
mirror and binding, LED ownership/suppress, `set-commit` overtake
lowering, `host_mode=overtake` in the engine, `needs: 'move'` scenarios,
`transport-overtake.ts`, the related flags (removed from the table with **no**
`FLAGS_REV` bump: unknown stored keys are ignored, so the user's other
settings survive), and the
docs that describe them (`docs/persistence-hazards.md` entries that no longer
apply). The source rule from WP1 shrinks to `standalone.ts` only. **Delete every
`typeof shadow_*/host_*` gate.** Host and UI now ship as one payload, so a gate
can only ever be true. `browser-test/logic/source-rules.mjs` gains a
**ratchet** on the count, which may fall and never rise *(dbx)*.

**Code only.** WP9 deletes no user data: legacy `sets/<uuid>/`, schwung's
`set_state/` and master files, the `ui-state` chains mirror and slot state all
stay on disk. The import code also stays, because a Set nobody has opened
since the switch still needs it.

### WP10: a direct UI↔engine channel (motivation 1)

Replace the string `status` poll with a shared-memory snapshot the engine
publishes every block (seqlock; UI reads lock-free). Commands go over an SPSC
queue with ordered delivery, which retires `#<seq>` dedupe, the
`param.ts` refused/timeout accounting, chain-payload retry and the `ping`
reload loop (movy-host loads exactly the `dsp.so` it shipped; a version
mismatch is a startup error). Keep `cmd` semantics; measure IPC cost with
`perf_ipc` before and after.

### WP11: latency and CPU retune (motivations 4, 5; goal 3)

- Audio-thread pad fast path: hardware pad events go to the engine's padmap in
  the **same frame** they arrive (the engine already owns pads under
  `engineOwnsPads`); the UI only mirrors. Expected: pad-to-sound drops from
  "tick + frame" to "≤1 frame".
- Retune the render pool for a CPU with no MoveOriginal (worker count,
  affinity, priorities: the FIFO-70 Move workers no longer exist) and
  recalibrate the CPU meter; port the `measure-*.sh` scripts that still matter;
  update `docs/track-performance.md`.

### WP12: a virtual device (goal 8, bonus)

A fake-SPI backend for movy-host (`spi_fake.c`, mailbox in a file or socket,
timer-paced at 2902 µs) running in a Linux arm64 container on the dev Mac
(colima, already used for schwung builds). Modules' aarch64 `dsp.so` run
natively there, so most device scenarios run through the same transport with
**no hardware** and in parallel. The device tier stays the gate for anything
hardware-timed.

### C-opt (not in the migration's scope; list for later)

Ableton Link via schwung's vendored Link SDK (license check first), MIDI clock
in/out on USB-A, a WAV recorder of the master (Dronage's precedent:
`UserLibrary/Samples/…`), battery indicator.

---

## Order, dependencies, cost

```
WP0 ─┬─ WP1 ─┐
     ├─ WP2 ─┼─ WP6 ── WP7 ── WP8 ── (one release) ── WP9 ─┬─ WP10
     ├─ WP5 ─┘          ▲                                  ├─ WP11
     ├─ WP3 ────────────┤                                  └─ WP12
     └─ [set-manager design] ── WP4 ─┘
```

WP1, WP2, WP3 and WP5 are independent of each other and can run in any order;
WP4 waits only for its design. That is 13 sessions (15 if WP3 and WP6 hit their
split points), one gate run each, and 9 of them before the switch.

## Risk register

| # | Risk | Where answered | Mitigation |
|---|---|---|---|
| R1 | A boot target runs as ableton and cannot get `SCHED_FIFO` → glitches | WP0 | per-tool root launcher via `schwung-heal` staging (`bin/heal.new`); U3 if staging needs a verb |
| R2 | Sets written as root by today's engine are unwritable as ableton | WP0/WP4 | never chown legacy files: the copy-import writes new files as the running uid; WP8 refuses with a message if the library is unwritable |
| R3 | Power button is handled by MoveOriginal; unknown signature | WP0 | capture it; shutdown via helper; U3 upstream if it needs a shared path |
| R4 | A schwung update makes param_pages call a global movy-host lacks | WP1/WP6 | globals manifest + C-side registration test; no-op-and-log stubs mean a degraded page, not a crash |
| R5 | QuickJS / host-ABI drift between pinned host and installed schwung | WP6 | pinned tag printed in the log; `abi-parity.mjs`; `SCHWUNG_FLOOR` check at startup |
| R6 | Open-from-Move/exit-to-Move takes seconds | WP0 | measured and documented; the boot target is the main entry |
| R7 | Store update replaces a running binary | WP8 | verify the install path; `ETXTBSY` must fail safe |
| R8 | Hardware behaviour Move used to own (HP/speaker switch, USB-C audio, auto-off) | WP0 | inventory; anything missing → C-opt or a MANUAL limitation |
| R9 | Audio burst at the Tools→movy handoff | WP0 | measure; movy-host fades in; U5 upstream *(dbx)* |
| R10 | A stock update changes chain-host behaviour under movy | WP2 | pinned chain host *(dbx)* |

## Decisions (accepted by the user, 2026-10-09)

1. **The "Retired by design" table** is the reading of goal #1.
2. **C host built from schwung's C libraries** at a pinned tag; the Rust engine
   stays an unchanged `plugin_api_v2` plugin.
3. **Side-by-side `movy-sa` dev flavour until WP8**; `movy` switches only then. `movy-sa` is dev-only and never goes in
   the catalog: users get the standalone build as an **update of the same `movy`
   module**, beta channel first.
4. **Set data root `/data/UserData/UserLibrary/Movy/`**; the set-manager design
   builds on it.
5. **Pinned chain host** (WP2): movy ships its own chain host, built from the
   pinned schwung tag, instead of loading stock `modules/chain/dsp.so`. Upstream
   chain fixes arrive by bumping the pin.
6. **Every dbxhost-derived item marked *(dbx)*** is accepted as part of the
   plan. The shared JS (`param_pages`) still loads from the installed schwung,
   because movy's no-vendoring rule stands.
7. **Copy forward, never clean up** (see *Global constraints*). Schwung's master
   FX is never cleared or enforced empty, and legacy Sets and files are only
   read. The MASTER binding follows the host mode, so overtake users see no
   change.
