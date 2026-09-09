# A movy-owned master FX chain

**Status: PARKED mid-design, 2026-09-10.** Architecture settled and agreed;
sections 2-3 (UI binding, persistence, migration mechanics, testing) are not
written. No code exists. Resume at "What is still open".

Started from one question — *can movy's output bypass schwung's master FX
chain?* — which turned out to have a "no" worth writing down, and a second
question behind it (*what would it take to leave the shim entirely?*) whose
answer is much cheaper than we assumed.

## 1. Where movy's audio actually goes

Movy is loaded as an overtake DSP **generator**. Its `render_block` output
reaches the DAC like this (`schwung/src/schwung_shim.c`):

| Line | What happens |
|---|---|
| `:2288` | movy's `render_block` runs; output summed into `shadow_deferred_dsp_buffer` |
| `:2310` | the file-preview player mixes into the same buffer |
| `:2980` | that buffer is added into the ME bus (`me_full` / `me_unity`) — the comment says **"unconditionally"** |
| `:3044` | ME clamped `int32` -> `int16` as `me_unity_i16` |
| `:3047` | `fx_target = me_unity_i16` (non-rebuild path) |
| `:3164` | send-bus returns sum into `fx_target` |
| `:3188` | the master FX loop processes `fx_target` in place |
| `:3218` | post-MFX ME scaled by master volume and summed into the mailbox beside Move's own audio |

So movy sits in the same bus as schwung's slot chains, upstream of both the
send returns and Master FX. **There is no flag, capability or param that
routes around it** — `:2980` is a straight-line mix with no guard.

Movy's own MASTER page makes this worse rather than better: it drives
schwung's global slots directly (`src/chain/config.ts:46-52`,
`master_fx:fx1..fx4` + `master_fx:lfo`), which `src/track/registry.ts:57` has
to special-case away from the track ports. Movy does not have a master chain;
it has a remote control for schwung's.

### Bypassing the old master

An **empty** schwung master chain is a genuine no-op: `:3188` `continue`s past
a slot with no instance. Nothing is called, nothing is copied, nothing costs.

Strictly better than the `bypassed` flag on the same struct, which still calls
`process_block` and then memcpys the dry signal back over the result (so a
bypassed reverb keeps its tail advancing). Bypassed costs full CPU and changes
nothing; empty costs nothing.

And every set schwung creates starts empty: `seed_empty_set_state()`
(`src/host/shadow_set_pages.c:132`) writes `{}` into `master_fx_0..3.json`.

What remains in the path with an empty chain is not an effects chain at all —
a hard clip into `int16` at `:3044`, a master-volume multiply at `:3218`, and a
second clip when that sums into the mailbox. No limiter, no dither, no extra
gain stage. Two consequences:

- movy's own master chain would be the **last stage that can do anything about
  level**, because `:3044` clips hard. A limiter has nowhere else to live.
- schwung's master is bypassed by *being empty*, and staying empty is now
  safe: PR #311 (host **1.1.0**; device is on 1.4.0) made
  `saveMasterFxChainConfig` adopt the shim's truth and preserve the file on a
  failed read, so a cleared slot stays cleared. Movy already requires >=1.1.0
  (PR #485). Before that it could come back from the JS mirror — schwung-movy#9,
  the same ownership wound that motivates this whole feature.

## 2. Decisions taken

1. **Movy hosts its own master FX chain**, for ownership: schwung's saver must
   never be able to erase or resurrect it.
2. **Replace + migrate.** The MASTER page rebinds to movy-owned slots. On first
   load of an old set, movy reads schwung's `master_fx` slots, re-loads those
   modules into its own chain, clears schwung's, and marks the set migrated.
3. **Parity shape: 4 FX + 2 LFOs**, matching schwung's master chain 1:1 so
   migration preserves behaviour and the MASTER page's grid, detail view and
   jog navigation are unchanged.
4. **Scope of the schwung exit: off the host slots, not off the chain module.**
   `chtracks` goes to 16; every track is a movy chain. Movy keeps dlopening
   schwung's chain module as its per-chain host, exactly as tracks 5-16 do
   today.

### The two facts that make this cheap

- **`chain_process_fx` is already in movy's hands.** `ChainInstance::process_fx()`
  (`engine/crates/movy-dsp/src/chain_host.rs:384`) runs a chain's audio-FX chain
  over an arbitrary buffer in place — that is exactly what a send bus is
  (`send_bus.rs:3`). A chain instance holds up to **8** audio FX
  (`chain_internal.h:55`, `MAX_AUDIO_FX 8`); movy's sends just happen to use one
  (`SEND_COMPONENT = "fx1"`, `chain_slots.rs:66`).
- **The LFOs come free.** A chain instance carries `LFO_COUNT = 2`
  (`schwung/src/host/lfo_common.h:21`) — the same pair, shapes and sync as
  schwung's master LFOs (`shadow_chain_mgmt.h:364`). That is already how movy
  tracks 5-16 get theirs. **Parity needs no new LFO code.**

## 3. Approach (agreed): the master chain is one more movy-hosted ChainInstance

Rejected alternatives:

- **Four audio-FX instances hosted directly, with movy's own LFOs in Rust.**
  Total independence from the chain module, and ~400 lines of new DSP that must
  reproduce schwung's LFO shapes, sync and LFO-to-LFO targeting closely enough
  that migrated sets still sound the same. Only worth it if the point is to
  escape the chain module too — which decision 4 says it is not.
- **Make the master a 17th track chain.** Cheapest in new code, but it enters
  the `ch<N>` index space, so the parallel planner, idle skip, CPU meter, mixer
  and undo all end up treating it as a track that is not one. Saves a day now,
  costs "why is there a track 17" forever.

### The stage

One new `ChainInstance` in `ChainSlots`, at a reserved index above the sends —
the same move `send_index()` made, in the index space `chain_slots.rs:69`
already calls "ONE index space":

```
0..MOVY_CHAINS      track chains
send_index(0..2)    send buses
master_index()      the master chain      <- new
```

FX-only: no synth, never `render_block`. Holds `fx1..fx4` and its two LFOs.

### Where it runs

At the tail of `ChainSlots::render()` (`chain_slots.rs:919`), after the send
phase has summed every bus into `out` and after `midi_out::QUEUE.drain`:

```rust
if let Some(m) = self.master.as_mut() {
    let _ = m.mod_tick();          // LFOs; render_block would have done this
    m.process_fx(&mut out[..frames]);
}
```

`mod_tick()` before `process_fx()` is **load-bearing and is the one
non-obvious line in the feature**: LFO values are applied to FX params by the
tick, and an FX-only chain never calls the `render_block` that normally hosts
it (`chain_host.rs:401`). Without it the master LFOs sit frozen at their base
value — silently, exactly like the sleeping-chain bug that comment records.

### Cost accounting

Audio thread, serial, after the join — like the send phase, and for the same
reason: it is a sum of everything, so it cannot start until everything is in.
It gets its own `add_wall` bracket **inside** the existing `render_ns` window,
not a second one (`chain_slots.rs:986` — two calls report two smaller peaks).
CPU page gets one more column beside the send columns.

### Idle

Reuse `send_bus::should_process` rather than inventing a rule: process when the
input block is non-silent, keep processing while the tail rings, never stop if
the FX declares `requires_continuous_processing`. A master reverb over a silent
set must not pin the whole engine awake.

### What it does not touch

`render_parallel`, the `Planner`, `chain_pin`, `chain_idle`'s per-chain state.
The master is one serial pass over the output buffer — no lane, no plan. The
digest oracle folds per-chain scratch buffers *before* the master runs, so a
master FX cannot make a parallel and a serial render disagree. Worth an
explicit assertion rather than an assumption.

## 4. Escaping the old master entirely: the boot-target option

The objection that parked this: with schwung's master still downstream,
somebody can add something there and forget. Becoming a **boot target**
(`schwung/docs/BOOT_TARGETS.md`, #423 in 1.3.0; movy's own
`docs/schwung-releases-review-2026-09.md` Section 4.4) dissolves that — no
shim, no `shadow_master_fx_slots`, no ME bus. Not bypassed: absent.

We assumed that meant movy reimplementing schwung's host. **It mostly does
not.** Inventory taken 2026-09-10:

### Reusable essentially as-is

| Piece | What it is | Movy's cost |
|---|---|---|
| Display | `schwung/src/host/js_display.{c,h}` — 773 lines; deps are stdio/stdlib/string/math + stb_image + stb_truetype. Framebuffer drawing, TTF **and** bitmap fonts, `js_display_pack()` for the wire format. | Link it. `js_display_register_bindings(ctx, global)` installs `fill_rect`, `clear_screen`, `print`, `text_width`, `draw_arc`, `draw_image`, `set_font`... — movy's **155 `fill_rect` and 13 `clear_screen` call sites run unchanged**. |
| JS runtime | QuickJS vendored at `schwung/libs/quickjs/quickjs-2025-04-26`. | Embed it; `ui.js` runs as-is. |
| Device ownership | `schwung/src/boot-select.c` — 499 lines, **a working standalone program that already does it**: opens `/dev/ablspi0.0`, mmaps the page, `SET_SPEED`, drives `WAIT_AND_SEND`, paints the screen, decodes jog detents and button press-edges from the RX mailbox. Plus `src/lib/schwung_spi_lib.h` documenting every offset, ioctl and the sysinfo tx-time stamp. | Copy the skeleton. This was assumed to be the hardest part; it is written. |
| Chain module | `chain_host.c` dsp.so — movy already dlopens it. | Nothing. |
| Module store / file browser | `schwung-manager` (Go). BOOT_TARGETS says to launch it yourself; schwung-specific features self-gate. | One line in `entry.sh`. |
| Shared JS | `schwung/src/shared/*.mjs` — `param_pages`, `knob_engine`, `filepath_browser`, `menu_*`, `text_entry`, `overlay_card`. | Optional. |

### Movy would have to write

1. **The audio half of the frame loop.** `boot-select` drives display + MIDI but
   not audio. Movy adds `OFF_OUT_AUDIO`/`OFF_IN_AUDIO` (128 frames @ 44.1 kHz)
   and the SCHED_FIFO discipline. Protocol documented, cadence known (2902 us) —
   the risk is realtime correctness, not unknowns.
2. **The `host_api_v1` vtable.** Today movy *forwards* schwung's — `host.rs:18`
   says so outright, "without movy synthesising one". Standalone it must
   synthesise ~9 entries: `log`, `midi_send_internal`/`_external`,
   `midi_inject_to_move`, `get_clock_status`, `get_bpm`, `get_project_bpm`,
   `get_beat_position`, `slot_recv_channel`. Movy already owns a transport and
   beat clock, so most are already computed or trivial.
3. **Pad/LED MIDI** — movy already composes these; they would go to the mailbox
   instead of through `shadow_send_midi_to_dsp`.
4. **Boot plumbing** — `boot.json`, `entry.sh`, SIGTERM handling (a TERM-deaf
   binary keeps `/dev/ablspi0.0` open and bricks the next boot until `kill -9`),
   `healthy` watchdog.

### The part worth noticing

Of the 24 shim globals movy's TypeScript calls, the file ones
(`host_read_file`, `host_write_file`, `host_ensure_dir`, `host_remove_dir`,
`host_file_exists`) are plain POSIX, and the param ones
(`host_module_get_param`, `host_module_set_param_blocking`) get **simpler** —
movy would be the host, so they stop being IPC. The overtake family
(`host_suspend_overtake`, `shadow_set_overtake_mode`,
`shadow_set_overtake_suppress_sysex`,
`shadow_set_overtake_suppress_master_volume`,
`shadow_overtake_move_inject_active`, `shadow_drain_midi_inject`,
`shadow_swap_display`) exists **only to share a device with Move** — standalone,
that code is deleted, not ported. A meaningful slice of movy's shim coupling is
coexistence machinery the migration removes.

### What it actually costs

Not engineering — product. No Move audio path at all: no Move tracks, no Move
sampler, no Move sound beside movy. Sets stop being shared with Move (and Move
only materialises a Set when Move itself has content —
`project_movy-set-identity`). Module loading still blocks the audio thread
(review Section 4.5, unfixed in both trees).

**The finding that should settle the sequencing:** the master chain in section 3
is needed in *both* futures. A standalone movy cannot inherit
`shadow_master_fx_slots` — there is no shim to hold them. So building it now is
work required either way, and leaning on schwung's MFX instead is the only
choice here that would have to be undone.

## 5. What is still open

- **Design sections 2-3, unwritten.** UI binding and the `mfx:` param namespace
  (mirroring `parse_send_key`, `lib.rs:53`); persistence in the chain document
  (`chain_doc.rs`); migration mechanics; testing.
- **The ownership guarantee, undecided and non-blocking.** Default to
  enforce-empty: on set load, one read of `master_fx:modules`; if anything is
  there, clear it and toast what was cleared. ~30 lines, no upstream change, and
  the failure direction is the safe one — a read that fails looks empty, so the
  worst case is "movy did not clear it", never "movy deleted something it could
  not see". That is the inverse of the #311 hazard, which is what makes it safe
  to do unconditionally. Alternatives were warn-only, or the boot target.
- **The boot target is its own decision**, on its own merits (roughly 15% frame
  headroom per `docs/track-performance.md` Section 7, plus full ownership) — not
  a way to stop someone leaving a reverb in the wrong slot.

## Cross-references

- `docs/schwung-releases-review-2026-09.md` Section 4.4 — boot targets, strategy
- `docs/track-performance.md` Section 7 — what standalone would buy
- schwung-movy#9 / schwung PR #311 / movy PR #485 — the master-FX erase history
