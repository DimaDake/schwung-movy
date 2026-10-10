# Standalone inventory (WP0)

Everything movy touches that the shim, shadow_ui or Move provides today, with
what movy-host does about it. Read at movy `276c94f` against schwung `v1.7.3`
(`911136d7`, what the device runs) on 2026-10-09.

**Dispositions:** *native* = movy-host implements it; *stub* = registered as a
no-op that logs once (WP6 `globals.c`), deleted in WP9; *retire* = the feature
goes away (see the plan's *Retired by design*); *runtime* = keeps coming from
the installed schwung.

## 1. Host globals movy's own code calls

From `grep -rhoE "\b(shadow_|host_|move_midi_)[a-z_]+" src`, with comment-only
hits removed. The plan's earlier list named `shadow_swap_display` and
`shadow_drain_midi_inject`, but those appear only in comments, so movy does not call them.

| Global | First uses | Disposition | Note |
|---|---|---|---|
| `host_read_file` | `renderer/schwung-canvas.ts:35`, `renderer/schwung-floor.ts:65` | native | from `js_host_common.c` |
| `host_write_file` | `seq/set-session.ts:117`, `seq/persist-store.ts:29` | native | `js_host_common.c` |
| `host_file_exists` | `seq/set-context.ts:24` | native | `js_host_common.c` |
| `host_ensure_dir` | `seq/set-context.ts:33` | native | `js_host_common.c` |
| `host_remove_dir` | `seq/set-context.ts:90` | native | `js_host_common.c` |
| `host_exit_module` | `midi/router.ts:270` | native | means a clean process exit |
| `host_module_get_param` | `host/param.ts:80` | native | the WP6 param queue; no single-slot SHM |
| `host_module_set_param` | `host/param.ts:79,107` | native | same queue: no write is ever lost |
| `host_module_set_param_blocking` | `host/param.ts:96` | native | waits ≤1 frame |
| `shadow_get_param` / `shadow_set_param` / `shadow_set_param_timeout` | `track/shim-port.ts:24-35` | native, slot→chain | the slot API only reaches schwung slots, which are master-only now; standalone routes to the movy master chain (WP3) |
| `shadow_get_params` / `shadow_set_params` | `host/param.ts:123,137` | native | bulk form of the same |
| `shadow_send_midi_to_dsp` | `track/shim-port.ts:51` | native | to the engine's `on_midi` |
| `shadow_get_ui_slot` | `app/init.ts:84` | stub (returns 0) | no schwung slot UI exists |
| `shadow_load_ui_module` | `renderer/schwung-canvas.ts:15,95,105` | native | loads a module's `ui.js` canvas in the same QuickJS runtime |
| `move_midi_internal_send` | `seq/led-cache.ts:73` | native | becomes LED/MIDI_OUT on cable 0 (`midi_out.c`) |
| `move_midi_inject_to_move` | `seq/set-commit.ts:111,154` | stub, then retire | no Move to inject into (LINK) |
| `host_suspend_overtake` | `midi/router.ts:269`, `app/leave-modal.ts:18` | stub, then retire | Background mode |
| `shadow_set_overtake_mode` | `seq/set-commit.ts:117` | stub, then retire | coexistence |
| `shadow_set_overtake_suppress_master_volume` | `mixer/track-volume.ts:73` | stub, then retire | volume knob is movy's (WP3) |
| `shadow_set_overtake_suppress_sysex` | `app/led-ownership.ts:15` | stub, then retire | movy owns every LED |
| `shadow_overtake_move_inject_active` | `seq/engine.ts:240` | stub (false), then retire | LINK |
| `setLED`, `setButtonLED`, `fill_rect`, `clear_screen`, `print`, … | `types/schwung.d.ts` | native | `js_display.c` plus `midi_out.c` |
| `decodeDelta` | `types/schwung.d.ts` | runtime | from `shared/input_filter.mjs` |

The callbacks movy defines: `init`, `tick`, `onMidiMessageInternal` and
`onUnload` (`renderer/schwung-canvas.ts:25`). movy defines **no**
`onMidiMessageExternal` (see §5).

## 2. Globals the shared JS calls at runtime

The modules movy imports (`src/renderer/schwung-lib.ts:176-228`, the 16
`param_pages/*.mjs`, plus `shadow_ui_slot_grid.mjs`, `lane_voice_map.mjs` and
`input_filter.mjs`), grepped at `v1.7.3`:

| Global | Called from | Disposition |
|---|---|---|
| `print` | enum_list, frame_ctx, page_controller, render_page, render_page_movy, fills | native (`js_display`) |
| `draw_line` | render_page_movy | native |
| `setLED`, `setButtonLED`, `move_midi_internal_send` | input_filter | native |
| `shadow_get_held_step`, `shadow_get_held_step_is_hold` | page_controller | native: `midi_in.c` keeps the held-step state the shim kept |
| `shadow_get_delete_held` | page_controller | native, same |
| `shadow_get_scene_state` | page_controller | native (movy's scene state) or stub |
| `clear_screen`, `host_read_file` | text_entry (WP4's Set rename) | native |
| `host_pad_block`, `shadow_get_pad_led_snapshot` | text_entry, pad typing only | native in `midi_in.c` / the LED cache, or stub (pad typing off) |
| ES modules `"std"` and `"os"` | `wav_io_qjs.mjs:17-18` | **native: movy-host must register quickjs-libc's `std`/`os` modules.** The plan's list did not mention this |

This table is the runtime surface a schwung update can break. WP1's manifest
starts from it.

## 3. `host_api_v1_t` (what `dsp.so` gets)

| Field | Engine use | movy-lab | movy-host |
|---|---|---|---|
| `api_version`, `sample_rate`, `frames_per_block` | `host.rs` `sample_rate` | 1 / 44100 / 128 | same |
| `mapped_memory`, `audio_out_offset`, `audio_in_offset` | unused by movy; chain modules may read audio-in | NULL / 256 / 2304 | the SPI page |
| `log` | `host.rs log` (+ chain host via `host::raw()`) | to the lab log | unified_log |
| `midi_send_internal` | notes/clock to schwung slots | counted (0 calls) | stub; retire with schwung-slot routing |
| `midi_send_external` | chain host | counted (0 calls) | out ring cable 2 |
| `get_clock_status`, `get_bpm`, `get_beat_position` | chain LFO sync | NULL (chain host null-checks) | the engine's clock: done in WP2 (`host_vtable.rs`), whatever the host passes |
| `midi_inject_to_move` | LINK | NULL | NULL (retire); skipped under `hostmode=standalone` since WP2 |
| `slot_recv_channel` | chain host (null-checked) | NULL | NULL |
| `mod_emit_value`, `mod_clear_source`, `mod_host_ctx` | not used by movy | NULL | NULL |

The movy-lab run showed that a vtable with only `log` and the two send
functions is enough to load two chains and play one.

## 4. Move-dependent behaviour

| Behaviour | Today | Standalone |
|---|---|---|
| Background mode, LINK, Move-bound Sets, Move master volume and overlay, schwung master FX, schwung-slot tracks | coexistence | retire (plan table) |
| **Speaker EQ** | the shim applies a speaker EQ when CC 115 says the speaker is active (`schwung_shim.c:250-311`) | **missing**: R8 item; C-opt, or port the EQ into the master chain |
| HP/speaker switching | XMOS hardware. CC 115 (0=speaker, 127=jack) only reports it. Seen live in run A | nothing to do for routing; the EQ above is the only consumer |
| Power button | MoveOriginal's shutdown prompt, from a cable-0 SysEx `F0 00 21 1D 01 01 3A <id> <val> 00 F7` (4 packets; `schwung_shim.c:8815`) | native in WP7. Not pressed during the spike, so the signature comes from source |
| Kernel RT tuning | `/etc/init.d/move` runs `chrt 90/91` on the spi/ablspi kthreads and pins IRQs at boot | inherited, since it happens before any app; no action |
| Volume knob | CC 79 relative (1 = +1, 7F/7E = −1/−2) plus touch note 8. Seen live | master volume (WP3) |

## 5. External USB-MIDI (USB-A)

It does **not** reach movy today. shadow_ui's `onMidiMessageExternal`
(`shadow_ui.js:31113`) feeds its own external-surface code and the CC map, and
movy registers no handler. In standalone mode, cable-2 events arrive in the same SPI
RX mailbox the lab scans. Forwarding them to the engine is *new* functionality,
not parity (C-opt). Not captured live: no device was plugged in.

## 6. Harness dependencies

The standalone column is specified in `testbus.md` (WP5); scenarios reach all
of it through `test-device/transport.ts`.

| Dependency | Where | Standalone |
|---|---|---|
| `schwung-testd` on 47777 (frame clock, engine params, pad-LED snapshot) | `test-device/daemon.ts`, `bus.ts` | testbus in movy-host (WP5/WP6) |
| `ui-agent.py` + `/dev/shm/schwung-ui-midi` ring | `test-device/agent.ts`, `device-agent/ui-agent.py` | `INJECT_MIDI` on the testbus |
| `/dev/shm/schwung-midi-inject` | `scenarios/volume.ts`, `ui-agent.py`, `scripts/lib/test-set.sh` | movy-host drains the same ring |
| `/dev/shm/schwung-display-live` | `test-device/display.ts` | **works unchanged**: movy-lab wrote it and display-server streamed it (spike run C) |
| `open_tool_cmd` + `schwung-control[56]` | `scripts/lib/test-set.sh`, `bus.ts` | **cannot open a standalone tool** (findings §3); use `launch-standalone.sh` |
| `debug.log` greps | `device.ts`, `fixture.ts`, `smoke.ts` | unified_log keeps the format |
| Root stack restart (`restart-stack.py`) | `engine.ts`, `fixture.ts` | restart movy-host only |
| Fixture seeding of `slot_state/`, `active_set.txt` | `fixture.ts`, `test-set.sh` | gone (no schwung slots, no Move Sets) |
| `probereq`/`probersp`, `chloadedlog` engine params | `probe.ts`, `fixture.ts` | unchanged (engine params) |
