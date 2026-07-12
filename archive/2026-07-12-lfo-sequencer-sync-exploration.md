# Syncing Schwung LFOs (and other synced params) to the Movy Sequencer — Exploration

**Date:** 2026-07-12
**Status:** Parked research / design exploration. No code written. Captures the
full discussion, every option considered, and all findings from reading the
schwung, schwung-davebox, and movy sources, so we can pick up later without
re-deriving.

---

## 1. The goal

Make schwung's **synced-mode LFO** (the Track LFO page we shipped in movy on
2026-07-11) actually stay in sync with the **movy sequencer**. Wanted: a clean,
concise, future-proof solution. Longer-term ambition (separate, later): sync the
movy sequencer to the **native Move sequencer** — davebox already does this.

"Synced" was clarified to mean, ideally, **tight phase-lock** (LFO at a known
phase on the bar/downbeat, drift-free), unless a mere **tempo/rate match** is
*much* cheaper — in which case compare and decide.

---

## 2. The two clocks (today)

They live in **different DSP instances** and do not share memory.

### Movy sequencer clock — `movy-dsp` (the overtake DSP)
- `engine/crates/seq-core/src/clock.rs`: integer accumulator, **PPQN = 96**,
  its own `bpm_x100`. Exact long-run tick rate, no drift.
- Movy **owns** its tempo (Main Parameters page, tempo/swing/root/key, v0.21.0).
- Emits notes to slots via `host::midi_send_internal(0x90|track, …)`
  (`movy-dsp/src/lib.rs`). Already **receives** Move's transport clock via a
  `get_clock_status` host hook (`movy-dsp/src/ffi.rs`), but does not emit clock.

### Schwung slot LFO — `chain_host.c` (per-slot chain DSP)
- `schwung/src/host/lfo_common.h`: `lfo_state_t`, waveforms, division table
  (27 divisions, beats per division), `lfo_sync_rate_hz(bpm, div)`,
  `lfo_advance_phase(phase, rate_hz, frames, sr)`.
- `schwung/src/modules/chain/dsp/chain_host.c` `lfo_tick()` (~line 1819): when
  `sync` is on, it computes `rate_hz = lfo_sync_rate_hz(host->get_bpm(), div)`
  and **free-runs the phase** (accumulates `rate_hz·frames/sr` each block).
- **Key properties:** rate-matched to whatever `get_bpm()` returns, but the
  phase is **never locked** to any transport — it just keeps accumulating from
  whenever the LFO was enabled. Master-FX LFOs are identical
  (`schwung/src/host/shadow_chain_mgmt.c` ~line 2121).

Where the LFO's tempo comes from — `host->get_bpm()` = `sampler_get_bpm()`
(`schwung/src/host/shadow_sampler.c:332`), priority chain:
1. **Active MIDI clock** `sampler_measured_bpm` — measured in `sampler_on_clock()`
   from incoming `0xF8`.
2. Current Set's tempo.
3. Last measured clock.
4. Settings-file tempo.
5. `120` default.

---

## 3. Key discovery — the cable-0 MIDI transport bus

`schwung/src/schwung_shim.c` (~line 1195–1244) taps **Move's hardware MIDI_OUT
mailbox** and, for **cable 0** system-realtime (`0xF8` clock / `0xFA` start /
`0xFC` stop), fans it out three ways:
1. → `sampler_on_clock()` (feeds `sampler_measured_bpm`, i.e. `get_bpm()`),
2. → the overtake DSP's `on_midi` (this is how **movy-dsp already receives**
   Move's transport),
3. → broadcast to **all chain slots**.

Cable 0 is populated by **Move's own firmware sequencer**, independent of the
user's "MIDI Clock Out" setting. So schwung's synced LFOs already track *Move's
native* transport tempo for free. The comments in `chain_get_clock_status`
(`chain_midi.c:83`) confirm this is the intended sync path.

---

## 4. The structural wall — why movy can't just feed the LFO

Movy's `midi_send_internal` does **not** reach the cable-0 tap. Its route is:

```
movy-dsp midi_send_internal
  → schwung_shim.c overtake_midi_send_internal (~line 1340)
  → shadow_chain_dispatch_midi_to_slots (shadow_midi.c:305)
```

`dispatch_to_slots` delivers to slots by **channel match** (slots are ch 1–4 or
All). A `0xF8` has low-nibble 8, so it fails the per-slot channel gate — **but**
the function's **FX-broadcast loop** (`shadow_midi.c:385`) forwards the raw bytes
to every active slot's `v2_on_midi`, and `v2_on_midi` (`chain_midi.c:476`) calls
`chain_update_clock_runtime(msg,len)` **unconditionally at the top**
(`chain_midi.c:479`).

Therefore:
- **Movy's injected `0xF8` DOES reach `chain_update_clock_runtime`** (which today
  only tracks `g_clock_last_tick_ms` / running/stopped — it does **not** count a
  usable running tick number, and the LFO does not read it).
- **Movy's injected clock does NOT reach `sampler_on_clock` / `get_bpm()`** —
  that path is cable-0-mailbox only, which an overtake tool can't write.

**Consequence:** the LFO reads `get_bpm()` for its rate, and **movy has no way to
set `get_bpm()`**. So a synced LFO under movy currently runs at Move's *Set*
tempo (or 120 / last-known) — **not** movy's tempo. A "tempo-match, movy-only,
zero-schwung-change" option for the LFO **does not actually exist.**

---

## 5. The asymmetry vs davebox (the crux)

- **davebox syncs its *own* sequencer.** The thing that must stay in time (its
  playhead) is davebox's own code, so it changes its own behavior — no host
  changes needed ("module-only").
- **Movy wants to sync *schwung's* LFO.** That LFO is **not movy's code**; it
  lives in schwung's chain host, decides its speed by asking schwung
  (`get_bpm()`), and movy can't answer that question from the outside.

> **One-liner:** davebox owns the thing being synced; movy doesn't — it belongs
> to schwung. So real, tight sync **requires a small schwung-side change**;
> there's no clean movy-only path.

---

## 6. Options considered (movy-as-master framing)

| # | Mechanism | Effort | Result |
|---|-----------|--------|--------|
| **0. Note-on retrigger** | Already exists: LFO `retrigger` resets phase on first note-on of a phrase; movy already sends per-step notes | **Zero code** | Loose (note-gated, not bar-aligned) **and rate is still wrong** (get_bpm ≠ movy tempo). Not real sync. |
| **1. Movy emits MIDI clock only** | Movy sends `0xF8/0xFA/0xFC` at its tempo | Small, movy-only | Sets transport *status* for synths that read `get_clock_status`, but **does nothing for LFO rate/phase** (LFO reads get_bpm, not ticks). Not viable alone. |
| **2. Clock-tick phase-lock** ⭐ | Movy emits `0xF8/0xFA/0xFC`; **schwung LFO derives phase from counted ticks** (`phase = fract(ticks / (24 × division_beats))`, reset on `0xFA`) when synced | Moderate: small movy change **+ one localized schwung change** (tick counter in `chain_midi.c` + read it in `lfo_tick`; same for `shadow_chain_mgmt.c`) | **Tight, drift-free, bar-aligned phase-lock.** Rate implicit (no get_bpm). Move-native drives the *same* `0xF8` bus, so it phase-locks to Move for free too. |

Because movy-only can't reach the LFO at all, **tempo-match is not meaningfully
cheaper than phase-lock** — both need a schwung change, and once you're counting
ticks you get exact phase for the same cost. **Option 2 is the recommendation in
the movy-as-master framing.**

---

## 7. The inversion — "sync movy to the same source as the LFOs"

Idea: instead of movy being master, movy becomes a **follower** of Move's clock
(davebox "Clock Follow"). If movy and the LFOs both follow Move, they're in sync.

- **Speed/tempo: works, zero schwung change.** Both read Move's tempo. ✓
- **Phase: still not locked.** The LFO still free-runs its phase; shared tempo
  fixes speed, not "where in its cycle is it now," and it slowly drifts. Tight
  phase-lock **still** needs the schwung change. ✗
- **Can movy update that source (set the tempo)?** **No** (via MIDI): movy can't
  write cable-0 or Move's Set tempo. davebox itself **cedes tempo to Move when
  following** (reads it, never sets it). Movy *could* start/stop Move's transport
  (inject Play CC 85, davebox-style) but not dial its tempo.

**So the real decision reduces to: who owns the tempo?**

| | Who sets tempo | Rate sync | Phase-lock | Schwung change? |
|---|---|---|---|---|
| **Movy follows Move** | Move hardware | ✓ free | ✗ still needs change | Only for phase |
| **Movy is master** | Movy (keeps its tempo page) | needs change | ✓ | Yes, for both |

Both roads reach tight phase-lock only through the schwung LFO change.

---

## 8. davebox findings (schwung-davebox, pulled 2026-07-12)

davebox shipped **bidirectional** transport sync, **module-only** (it owns its
own sequencer DSP `dsp/seq8.c`):

- **Clock Follow** (`c083e3f`): reads Move's `0xF8` and advances its playhead
  from Move's clock instead of its own accumulator; EMA-captures Move's tempo
  from the inter-clock sample period. Clean seam
  `seq8_clock_advance()`/`seq8_tick_due()` gated by one `clock_follow_on` flag.
  Its Play injects **MovePlay (CC 85)** to start/stop Move; `0xFA` re-anchors to
  bar 1. Hybrid stop detection (`0xFC` or ~750 ms clock staleness). **This is the
  blueprint for the future "movy follows native Move" direction** — and movy-dsp
  already receives Move's cable-0 clock.
- **Clock Out master** (`7a764a6`): emits `0xF8/0xFA/0xFC` from `render_block`
  (96-PPQN master ÷ 4 = 24-PPQN), via `midi_send_external` on **cable 2 (USB-A)**,
  for **external gear**. Reusable emit pattern:
  - `clock_send_raw(inst, rt)` — packet `{0x20|(rt>>4), rt, 0, 0}` via
    `g_host->midi_send_external`.
  - `clock_send_f8_tick()` — divides 96-PPQN by 4; self-gates on
    `clock_send_on && !clock_follow_on`.
  - Transport-edge trackers emit `0xFA`/`0xFC`.
  - Persisted per-set as `_cs`.

**Note the cable difference:** davebox's Clock Out is **cable 2 (external gear)**;
it would **not** reach schwung's own slot LFOs. For movy → schwung-internal LFOs
we want the **internal** path (`midi_send_internal` → `dispatch_to_slots` →
FX-broadcast → `chain_update_clock_runtime`), verified above. The **emit
divider/edge logic** from davebox is directly reusable; the **transport** is not.

davebox also only *knows about* Ableton Link as the reason Move delays its
transport start (~1 bar) — it waits through Move's "Ableton Link grid" sync
(`seq8_set_param.c:399`, `seq8_render.c:158`, MANUAL §16.6). It does **not** join
Link itself.

---

## 9. Ableton Link exploration

- **Present but not exposed.** The full Link C++ SDK is vendored
  (`schwung/libs/link`) and used **only** inside the `link_subscriber` sidecar
  (`schwung/src/host/link_subscriber.cpp`) for **Link Audio** streaming. It
  computes `beatAtTime(hostTime, quantum)` and can `setTempo` /
  `commitAppSessionState`, but **nothing publishes tempo/beat/phase to a SHM a
  module or the DSP can read** (`link_audio.h` carries audio only). So the LFO is
  blind to Link today.
- **davebox does not use Link directly** (uses MIDI clock on top of Move's
  Link-synced transport).
- **Link's unique advantage:** it's **bidirectional** — any peer can
  `setTempo()`. It is the **only** approach where movy could be a true shared
  tempo authority that Move itself respects (answers the "can movy update the
  source?" question with a real *yes*).
- **Cost:** heavier. The LFO would need a Link/beat feed that doesn't exist in
  the DSP; you'd first build a **Link→DSP beat/phase SHM bridge** (get the
  sidecar's beat clock into the audio-thread LFO), *then* still change the LFO
  leaf. Plus device risk: unverified whether Move cedes tempo to an external Link
  peer.

### MIDI clock vs Link for this task

| | MIDI clock (davebox's choice) | Ableton Link |
|---|---|---|
| Phase quality | Good (24-PPQN + reset on start) | Best (continuous beat phase) |
| Movy can set shared tempo? | ✗ (emits own clock) | ✓ (`setTempo`) |
| Schwung change size | Small (LFO counts ticks it already receives) | Larger (Link→DSP bridge **+** LFO change) |
| Infra wired end-to-end? | ✓ (movy's `0xF8` already reaches `chain_host`) | ✗ (Link stuck in the sidecar) |
| Precedent | ✓ davebox proved it | ✗ davebox avoided it |
| Device risk | Low | Higher (does Move accept external Link tempo?) |

---

## 10. Recommendation & suggested path

- **For the focused ask (phase-lock schwung LFOs to movy, soon):** **Option 2 —
  MIDI-clock tick phase-lock.** Reuses a fully-wired bus, one small localized
  schwung leaf change, davebox-proven, low device risk. Keeps movy as tempo
  master (movy emits its own clock).
- **Keep Ableton Link as the documented future upgrade** for the bigger ambition
  ("movy becomes the tempo brain the whole Move follows"). It can replace the
  clock *source* under the same LFO phase-lock code later, since both ultimately
  drive `phase = fract(beat / division)`.
- **Future "movy follows native Move":** port davebox's Clock Follow seam
  (`clock_follow_on` discriminator, EMA tempo capture, MovePlay inject). movy-dsp
  already receives Move's cable-0 clock, so the input is present.

### Concrete change sketch for Option 2 (when we implement)
1. **Movy (movy-dsp):** in `render_block`, emit `0xF8` every 4 master ticks
   (96→24 PPQN) + `0xFA`/`0xFC` on transport edges, via `midi_send_internal`.
   Note `overtake_midi_send_internal` needs a **4-byte** packet
   `[_, status, 0, 0]` (`schwung_shim.c:1341` requires `len ≥ 4`, reads `msg[1]`
   as status; `0xF8` → CIN `0x0F`).
2. **Schwung (leaf change):** `chain_update_clock_runtime` (`chain_midi.c:113`)
   counts a running tick number and resets it on `0xFA`; `lfo_tick`
   (`chain_host.c:1819`) uses `phase = fract(ticks / (24 × division_beats))` +
   `phase_offset` when `sync` is on, instead of free-running `get_bpm`. Apply the
   same to master-FX LFOs (`shadow_chain_mgmt.c:2121`).

---

## 11. Open decisions (unresolved — to settle before implementing)

1. **Who owns tempo?** Movy master (Option 2, movy keeps its tempo page) vs movy
   follows Move (rate free, phase still needs the change, movy cedes tempo).
2. **How to land the schwung change** (it's unavoidable for tight phase-lock):
   local patch first → upstream later, upstream PR from the start, or local fork.
   davebox precedent favored on-device validation first.
3. **Scope of first pass:** slot LFOs only, slot + master-FX LFOs, or a general
   transport-phase mechanism any synced schwung param can opt into.
4. **MIDI clock now vs Link now** — recommendation is MIDI clock now, Link as
   documented future work.

---

## 12. Source pointers (for whoever implements)

- `schwung/src/host/lfo_common.h` — LFO state, divisions, `lfo_sync_rate_hz`,
  `lfo_advance_phase`, `lfo_process_midi` (retrigger).
- `schwung/src/modules/chain/dsp/chain_host.c` — `lfo_tick()` (~1819).
- `schwung/src/modules/chain/dsp/chain_midi.c` — `chain_update_clock_runtime`
  (113), `chain_get_clock_status` (83), `v2_on_midi` (476), `lfo_process_midi`
  call (491).
- `schwung/src/host/shadow_chain_mgmt.c` — master-FX LFO tick (~2121).
- `schwung/src/host/shadow_sampler.c` — `sampler_get_bpm` (332),
  `sampler_on_clock` (902).
- `schwung/src/schwung_shim.c` — cable-0 realtime tap (1195–1244),
  `overtake_midi_send_internal` (1340), `overtake_midi_send_external` (1384).
- `schwung/src/host/shadow_midi.c` — `shadow_chain_dispatch_midi_to_slots` (305),
  FX-broadcast (385).
- `schwung/src/host/link_subscriber.cpp` — Link SDK usage (sidecar only);
  `setTempo`/`beatAtTime` (188–293, 556–566). `schwung/libs/link` — vendored SDK.
- `schwung-davebox/dsp/seq8.c` — Clock Out emit (`clock_send_*`), Clock Follow
  state; commits `c083e3f` (Clock Follow), `7a764a6` (Clock Out master),
  `9748b68` (Link transport-sync wait).
- Movy: `engine/crates/seq-core/src/clock.rs` (PPQN 96 accumulator),
  `engine/crates/movy-dsp/src/{lib.rs,ffi.rs,host.rs}` (`midi_send_internal`,
  `get_clock_status`). Track LFO page: `src/lfo/*`, `src/chain/config.ts`.
