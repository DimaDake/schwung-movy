# Movy audio tracks — reusing schwung FX chains (feasibility)

**Date:** 2026-08-11
**Status:** research only. No design decisions, no implementation.
**Scope of this document:** *can movy own private schwung audio-FX chains, and
what would it cost?* It deliberately does **not** design the audio-track feature
(recording model, UI, session view, persistence). Those are open.

Source refs are against `schwung` @ `120ba662` (origin/main, 2026-08-11) and
`movy` @ main.

---

## Executive summary

Most of the plumbing already exists. Movy can host **N private chain instances,
each with up to 4 schwung audio FX, with zero changes to schwung** — because
`modules/chain/dsp.so` is already instance-based and exports the FX-only entry
points the shim itself uses.

The one genuinely hard part is **recording from other Move tracks**: per-track
audio only exists in the Link Audio ring, which is strict SPSC with the shim as
sole consumer. Everything else (external input, whole-mix resample, FX hosting,
param metadata, presets) is reachable today.

---

## 1. What movy already has and does not use

`movy-dsp` exports `move_plugin_init_v2` (`engine/crates/movy-dsp/src/lib.rs:274`),
so the shim loads it as the **overtake DSP generator** — not as an FX. The shim
calls its `render_block()` into the ME bus every 128-frame block:

- `schwung_shim.c:1816-1852` — overtake generator render, summed into
  `shadow_deferred_dsp_buffer`
- `schwung_shim.c:2381-2392` — that buffer joins the ME bus / mailbox

Today movy renders only the metronome click (`movy-dsp/src/lib.rs:132`). **The
stereo audio output path for audio tracks already exists and is wired.**

Two inputs the shim hands to overtake DSP on purpose:

| Source | How | Ref |
|---|---|---|
| External line/USB in | shim re-copies raw hardware `AUDIO_IN` into the mailbox immediately before calling overtake `render_block`, explicitly so overtake plugins can read line-in | `schwung_shim.c:1816-1843` |
| Move's full mix (resample) | mailbox `AUDIO_OUT` at render time; this is the same source schwung's own sampler uses | `shadow_sampler.c:894` |

The host API movy receives carries `mapped_memory`, `audio_in_offset`,
`audio_out_offset` (`schwung_shim.c:1463-1471`, struct in
`src/host/plugin_api_v1.h:50`).

---

## 2. The reuse mechanism: `chain/dsp.so` is already multi-instance

`src/modules/chain/dsp/chain_host.c` is the chain host. Schwung already runs
**4 concurrent instances** of it (one per shadow slot). All state lives in
`chain_instance_t` (`chain_internal.h`); the only file-global is `g_host`.

Beyond the standard v2 plugin API it exports plain C entry points
(`chain_host.c:2101-2149`):

```c
void chain_set_inject_audio(void *inst, int16_t *buf, int frames);
void chain_set_external_fx_mode(void *inst, int mode);
void chain_process_fx(void *inst, int16_t *buf, int frames);   /* FX only, any buffer */
int  chain_fx_requires_continuous(void *inst);
```

These exist because the shim uses them for the Link Audio rebuild path
(`shadow_chain_mgmt.c:1020-1031` dlsyms them; `schwung_shim.c:1759`, `:2203`,
`:2334` call them).

Three properties that make this directly usable by movy:

1. **A chain instance with no synth loaded is a pure FX processor.**
   `v2_render_block` memsets when there is no synth, mixes `inject_audio`, then
   runs the FX chain (`chain_host.c:2020-2069`). `chain_process_fx()` skips even
   that and runs FX alone on a caller-supplied buffer.
2. **FX resolve from the shared install dir.** Path is
   `<module_dir>/../audio_fx/<name>/<name>.so` (`chain_host.c:245`). An instance
   created with `module_dir = /data/UserData/schwung/modules/chain` therefore
   sees **every audio FX the user installed from the store** — no movy-side
   registry.
3. **Everything else comes along for free**: 4 FX slots per chain
   (`MAX_AUDIO_FX`, `chain_internal.h:42`), per-param smoothing, LFO modulation
   (`lfo_tick`, `chain_host.c:1885`), per-slot bypass (`fx1:bypassed` …), and the
   opaque `state` blob contract that powers module presets
   (`docs/MODULES.md` → "Making a module compatible with Module Presets").

---

## 3. Recommended approach

**movy-dsp dlopens `/data/UserData/schwung/modules/chain/dsp.so` and creates its
own chain instances**, one per audio track.

Per block, inside movy's existing `render_block`:

1. produce each track's source audio (file playback / recorded buffer /
   line-in / resample bus),
2. either `chain_set_inject_audio(chain[i], src, 128)` + `render_block(chain[i], buf, 128)`,
   or simply `chain_process_fx(chain[i], buf, 128)` to bypass the synth path
   entirely,
3. sum the tracks into movy's output buffer.

**Params** ride the existing bridge: the shim forwards unrecognised param keys
straight to the overtake DSP's `set_param` (`schwung_shim.c:3566`). Movy defines
its own namespace (e.g. `atrk2:fx1:wet`) and routes internally to the right
chain instance.

**UI metadata** also comes for free: `get_param(chain[i], "fx1:parameters")`
returns the same JSON that schwung's own slot UI builds pages from
(`chain_host.c:1578+` forwards `fx<N>:` gets to the FX instance). This fits how
movy's `hierarchy.ts` already consumes chain params.

**Schwung changes required: none.** One soft spot, see §5.1.

### Alternatives considered

| Option | Verdict |
|---|---|
| Ask schwung for movy-owned slots (bump `SHADOW_CHAIN_INSTANCES` = 4, `shadow_constants.h:75`, or add a create-chain API) | The conceptual change we ruled out, and unnecessary given the above. |
| Reimplement an FX host inside movy-dsp (dlopen `audio_fx` modules directly against `audio_fx_api_v2.h`) | ~100 lines, avoids the `g_host` issue entirely, but throws away param smoothing, LFO modulation, presets and the patch format. Fallback only if the chain host proves unusable. |

---

## 4. Where audio can come from

| Want | Available today | Notes |
|---|---|---|
| External input (line / USB) | **Yes**, directly | Shim restores raw hardware `AUDIO_IN` for overtake DSP (`schwung_shim.c:1816-1843`) |
| Whole Move mix (resample) | **Yes**, directly | Mailbox `AUDIO_OUT`; what `shadow_sampler.c` records |
| **Individual Move tracks** | **Not without shim help** | See §5.3 |
| Movy's own tracks / playback | Movy implements it | `preview_play`/`preview_render` (`schwung_shim.c:454-560`) is a working single-voice WAV player in the shim, but it is one global instance — a pattern to copy, not to share |

---

## 5. Gotchas to plan around

### 5.1 `g_host` clobber (minor, and the one upstream ask)

`move_plugin_init_v2` in chain_host assigns a file-global `g_host`
(`chain_host.c:2082`). If movy calls it, it overwrites the pointer shared by the
shim's 4 slot instances.

Blast radius is small: `g_host` is only a logging fallback — each instance
copies the host API into `inst->host` / `inst->subplugin_host_api` at
`create_instance` (`chain_host.c:68-70`) — and both pointers are shim host APIs
anyway. Still, it is real coupling.

- **Clean fix (upstream):** add `chain_create_instance_with_host(host, module_dir, cfg)`.
  This is exactly the "simple change to make module chains reusable" category,
  and is framed as a schwung feature, not a movy patch.
- **Zero-change workaround:** ship a copy of `dsp.so` in movy's own module dir
  and dlopen that (separate mapping ⇒ separate `g_host`). Cost: version drift
  against schwung's chain host. A symlink does **not** work — dlopen resolves to
  the same realpath and shares the mapping.

### 5.2 Real-time constraints

`render_block` runs post-ioctl on the SPI thread: SCHED_FIFO 90, core 3,
~900µs/frame budget (`schwung_shim.c:7170-7184`, `docs/REALTIME_SAFETY.md`).
**No filesystem access on that thread.**

Sample loading and WAV writing must be deferred to `shim_worker`, which is how
schwung's own sampler does it — `SHIM_EVT_SAMPLER_PREP` / `_FINALIZE` /
`_CANCEL` (`src/host/shim_worker.h`), with the actual write on a separate writer
thread.

Also budget CPU: 4 extra chains × up to 4 FX each is significant on top of
movy's existing load. Movy's tick rate already varies 63–205 Hz with load, and
that tick period *is* the MIDI input sampling interval — audio-track DSP
overhead directly degrades pad latency.

### 5.3 Per-track recording is the hard part

Per-track Move audio exists only in `/schwung-link-in`, written by the
`link-subscriber` sidecar. The ring is strict SPSC with **the shim as sole
consumer** — `slots[s].read_pos` is advanced by the shim
(`link_audio.h:169-192`, `shadow_link_audio.h`, consumed at
`schwung_shim.c:2070-2090`). A second reader in movy would steal blocks from the
shim's rebuild path and corrupt Move's own audio reconstruction.

Options:

- Record the **resample bus** (whole mix). Easy, zero schwung change, but no
  per-track isolation.
- Negotiate a **fan-out / second-reader** in the shim, or a per-track publish
  slot. Small, self-contained, genuinely upstreamable — but it *is* a schwung
  change and must be framed as a schwung feature.

Note the existing rebuild path is itself precedent for what we want: schwung
already routes Move track N's audio through shadow slot N's FX chain
(`schwung_shim.c:1960-2120`).

### 5.4 Single overtake DSP slot

`overtake_dsp_gen` / `overtake_dsp_fx` are single globals
(`schwung_shim.c:418-419`) and the shim tries generator first, then FX
(`schwung_shim.c:1485-1540`). Fine for this design — movy sums its own tracks —
but it means movy's audio tracks cannot surface as **separate ME channels**
without shim help. They arrive as one stereo bus.

### 5.5 glibc

Any new `.so` movy ships stays under the existing cross-build gate
(`scripts/build-dsp.sh` enforces GLIBC ≤ 2.35; device is ≤ 2.35).

---

## 6. Unresolved: "schwung-spi"

**Not found.** There is no `schwung-spi` repo in `~/git/cld`, and no reference to
such a component in schwung's source, docs, `module-catalog.json`, or release
metadata.

The only SPI artefact is `docs/SPI_PROTOCOL.md`, which documents the **Move
hardware mailbox** (`/dev/ablspi0.0`, 768-byte transfers, 44.1 kHz / 128 frames /
stereo int16 at offsets 256 and 2304) — i.e. the layer the shim already sits on,
not a separate reusable chain mechanism.

If Charles meant something else, it lives outside these repos and needs a direct
question. **Nothing in the approach above depends on it.**

---

## 7. Open questions (not answered here)

- Do audio tracks need to be independently visible downstream (separate ME
  channels), or is one summed stereo bus acceptable? (§5.4)
- Per-track record: accept whole-mix resample, or pursue the shim fan-out? (§5.3)
- Where does recorded audio live — movy-private files, or Move's sample library?
- Does the FX chain belong per-track only, or is a movy-owned bus/master FX
  chain also wanted?
