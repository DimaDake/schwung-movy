# Transport / Beat-Clock Service — Design (Phase 1)

**Date:** 2026-07-12
**Status:** Approved design, pending implementation plan.
**Scope:** Phase 1 only — schwung transport service + LFO phase-lock + movy clock
emission. Phase 2 (movy Clock Follow of native Move, tempo knob via Link
override) is documented as future work and builds on this without rework.
**Schwung base:** branch off `origin/main` (local checkout has diverged; all
seams verified present on `origin/main`).

---

## 1. Goal

Make schwung's synced-mode LFOs (slot LFOs and master-FX LFOs) **phase-lock,
drift-free**, to whichever transport is actually playing — the movy sequencer
or Move's native sequencer — and give every other tempo-synced schwung
parameter a single correct tempo source. Allowed to change schwung, but the
change must be a first-class schwung feature, not a movy-specific hack.

## 2. Verified background (corrections to the 2026-07-12 exploration doc)

- Confirmed: synced LFOs free-run phase at `lfo_sync_rate_hz(get_bpm(), div)`
  (`chain_host.c` `lfo_tick`, `shadow_chain_mgmt.c` master-FX tick). Movy
  cannot influence `get_bpm()`; its fallback chain is cable-0 measured clock →
  Set tempo (read from `Song.abl`) → last clock → settings → 120.
- Confirmed: the shim's cable-0 realtime tap (`schwung_shim.c`) fans Move's
  native transport (`0xF8/0xFA/0xFC`) to `sampler_on_clock`, the overtake DSP
  (movy already receives it), and all chain slots.
- **Correction 1 — dual clocks:** chain slots receive realtime from *both* the
  cable-0 broadcast and anything movy injects via `midi_send_internal` (the
  FX-broadcast loop in `shadow_midi.c` delivers to every active slot, and
  `v2_on_midi` runs `chain_update_clock_runtime` unconditionally). Any
  per-slot tick counter would double-count when both transports run. Counting
  must happen centrally, with source arbitration.
- **Correction 2 — remap mangling:** movy-injected realtime that goes through
  `shadow_chain_dispatch_midi_to_slots` hits `shadow_chain_remap_channel`,
  which rewrites `0xF8` to `(0xF0 | fwd_ch)` for slots with a forward channel
  — corrupted status bytes. Injected realtime must bypass per-slot dispatch.
- **Correction 3 — tempo override already exists:** `shadow_ui.js` writes
  `/data/UserData/schwung/desired-tempo`; the Link sidecar
  (`link_subscriber.cpp`) commits it to the Link session (`setTempo`) when
  Move is the sole peer, and Move follows. "Movy keeps the BPM UI while Move
  is clock master" is already plumbed — this is the Phase 2 tempo path, not
  new infrastructure.

## 3. Architecture

One new schwung concept: a **transport service** in the shim — the single
authority for "what transport is running, at what tempo, at what beat
position." Everything tempo-synced reads it; nothing else counts ticks.

```
Move native seq ──cable-0 0xF8/FA/FC──┐
                                      ├─→ shadow_transport (shim)
movy-dsp ──midi_send_internal 0xF8/FA/FC──┘      │
   (realtime intercepted before slot dispatch)   │
                                                 ├─ get_beat_position()  → LFO phase-lock
                                                 ├─ transport bpm        → get_bpm() priority 1
                                                 └─ (existing realtime broadcast to slots unchanged)
```

### 3.1 `src/host/shadow_transport.{c,h}` (new)

State (audio-thread-only; no locks, no logging — RT-safe):

- per-source (`SRC_MOVE_NATIVE`, `SRC_INTERNAL`): last-tick sample time,
  running flag, 24-PPQN tick count (reset on `0xFA`), EMA-smoothed tick
  interval (→ bpm), staleness detection (reuse the existing
  `CLOCK_TICK_STALE_MS` idea).
- active source arbitration: **Move native wins while its transport runs**;
  the internal source drives only while cable-0 is idle/stopped. Predictable,
  and matches Phase 2 (movy will follow Move when Move runs, so "both
  running" converges to one clock).

Feeds:

- existing cable-0 tap: add one call `transport_on_realtime(SRC_MOVE_NATIVE,
  status)` next to `sampler_on_clock`.
- `overtake_midi_send_internal`: if `msg[1] >= 0xF8`, call
  `transport_on_realtime(SRC_INTERNAL, status)` and broadcast to slots via the
  **same 1-byte path as the cable-0 broadcast** (so `chain_get_clock_status`
  and clock-driven plugins see movy's transport too), then return — never
  through `dispatch_to_slots` (fixes Correction 2).

Output — called from the render path once per block:

- `double transport_beat_position(void)` — beats since the active source's
  transport start: `ticks / 24.0` plus an **interpolated fraction** from
  samples elapsed since the last tick at the measured tick rate. Interpolation
  is required: at 24 PPQN a 1/32-note LFO cycle is only 3 raw ticks. Clamped
  so it never runs past the next expected tick by more than one tick's worth
  (stale clock ⇒ freeze, then staleness flips `running` off).
- Returns `-1.0` when no transport is running (callers fall back to free-run).
- `float transport_bpm(void)` / `int transport_active(void)` for `get_bpm()`.

### 3.2 Host API (`plugin_api_v1.h`)

Append to `host_api_v1_t` (append-only keeps ABI compat — the host constructs
the struct):

```c
/* Beats since transport start of the active clock source (Move native or an
 * internal module's emitted clock), 24-PPQN-derived, block-interpolated.
 * Returns < 0 when no transport is running. */
double (*get_beat_position)(void);
```

`sampler_get_bpm()` gains a new priority 1: if `transport_active()`, return
`transport_bpm()`. (Cable-0 behavior is unchanged — the service measures the
same ticks `sampler_measured_bpm` did; this generalizes it to the internal
source so arps/delays/sampler quantize also follow movy's tempo.)

### 3.3 LFO phase-lock (`lfo_common.h` + both tick sites)

New shared helper:

```c
/* Phase-locked LFO phase from transport beat position. */
static inline double lfo_synced_phase(double beat_position, int rate_div) {
    float beats = lfo_divisions[clamped(rate_div)].beats;
    return fmod(beat_position / (double)beats, 1.0);
}
```

In `chain_host.c lfo_tick()` and `shadow_chain_mgmt.c` master-FX tick, when
`lfo->sync`:

- `bp = host->get_beat_position()`; if `bp >= 0` → `lfo->phase =
  lfo_synced_phase(bp, lfo->rate_div)` (writing `lfo->phase` keeps continuity:
  when transport stops, free-run resumes from the locked phase, no jump).
- else → legacy free-run at `lfo_sync_rate_hz(get_bpm(), div)` (Ableton-like:
  synced LFOs follow song position while playing, keep breathing when
  stopped).

`phase_offset` continues to apply downstream (`effective_phase`), so it
becomes a musically meaningful offset against the bar. `retrigger` remains
relevant only in free-run (locked phase is deterministic); no behavior change
needed, just a doc note.

### 3.4 Movy clock emission (`movy-dsp`)

In `render_block`, from the existing 96-PPQN master clock (davebox seq8 emit
pattern, adapted to the **internal** send path):

- transport start → `midi_send_internal(0xFA, 0, 0)`; stop → `0xFC`.
- every 4th master tick (96 → 24 PPQN) → `0xF8`.
- Emitted only while the movy sequencer plays. Tempo changes need no special
  handling — tick spacing follows the accumulator.
- Packet shape: existing `host::midi_send_internal` already builds the 4-byte
  `[CIN, status, 0, 0]` packet (`host.rs:45` computes CIN `0x0F` for `0xF8+`).

## 4. Resulting behavior

| Situation | LFO sync | Tempo (`get_bpm`) |
|---|---|---|
| Movy playing, Move stopped | phase-locked to movy bars | movy tempo |
| Move native playing | phase-locked to Move bars | Move tempo |
| Both playing (pre-Phase-2) | follows Move (arbitration) | Move tempo |
| Nothing playing | free-run at last-known tempo | fallback chain |

## 5. Testing

**Schwung** (compiled-C unit test, `tests/host/` pattern):
`shadow_transport` — tick counting, `0xFA` reset, EMA bpm from synthetic tick
timing, arbitration (internal drives when cable-0 idle; Move takes over on its
`0xFA`/first tick; reverts on staleness), interpolation monotonic and clamped,
`lfo_synced_phase` division math (spot-check against `lfo_sync_rate_hz`).

**Movy:** `cargo test` in seq-core/movy-dsp — 24-PPQN divide emits exactly 24
ticks/beat across odd block sizes; `0xFA`/`0xFC` on transport edges; no ticks
when stopped. Existing `.mjs` suites must stay green (no UI change in
Phase 1).

**Device e2e:** deploy both; script: enable a synced slot LFO on a slow
division, start movy sequencer, capture debug log of LFO phase (add a
temporary rate-limited debug counter or verify audibly + via
`chain_get_clock_status` transitions in the log); verify Move-native playback
also locks; verify movy tempo change speeds the LFO. Extend
`scripts/test-seq.sh` with a clock-emission assertion (log shows slot
receiving movy `0xF8` while playing, none when stopped).

## 6. Risks / edge cases

- **RT safety:** all transport-service calls run in the SPI/audio path —
  fixed-size state, no I/O. EMA math is a few float ops per tick.
- **Jitter:** internal clock ticks are generated at block boundaries (~2.9 ms
  granularity) — same as davebox; EMA + interpolation smooths it. Long-run
  drift is zero because tick *count*, not measured rate, drives phase.
- **Source flapping:** Move starting mid-movy-playback snaps LFO phase to
  Move's bar grid (a jump). Acceptable pre-Phase-2; Phase 2 makes movy follow
  Move so grids coincide.
- **Old modules:** `get_beat_position` appended to the host struct; modules
  ignore it unless they opt in. LFO change is behavior-improving only when a
  transport runs; otherwise identical to today.

## 7. Phase 2 (future, builds on this unchanged)

1. **Movy Clock Follow:** advance movy's playhead from cable-0 ticks when
   Move's transport runs (davebox `clock_follow` seam: ×4 to 96 PPQN,
   re-anchor on `0xFA`, stop on `0xFC`/staleness); self-gate clock emission
   while following.
2. **Tempo knob:** movy tempo page writes
   `/data/UserData/schwung/desired-tempo` (existing Link-override protocol) →
   Move's tempo follows; works when Move is the sole Link peer. Optional
   MovePlay (CC 85) injection so movy's Play drives Move's transport.
3. **Ableton Link as clock source:** a Link beat feed can become a third
   `transport_on_*` source under the same `get_beat_position()` API.

## 8. Source pointers (verified on `origin/main`, 2026-07-12)

- `src/schwung_shim.c` — cable-0 realtime tap (~1198), `sampler_on_clock`
  call (1201), `overtake_midi_send_internal` (1325).
- `src/host/shadow_midi.c` — `shadow_chain_dispatch_midi_to_slots`,
  `shadow_chain_remap_channel` (remap hazard), FX-broadcast loop.
- `src/modules/chain/dsp/chain_midi.c` — `chain_update_clock_runtime` (113),
  `v2_on_midi` (517), `chain_get_clock_status`.
- `src/modules/chain/dsp/chain_host.c` — `lfo_tick`.
- `src/host/shadow_chain_mgmt.c` — master-FX LFO tick.
- `src/host/lfo_common.h` — divisions, `lfo_sync_rate_hz` (201),
  `lfo_advance_phase` (210).
- `src/host/plugin_api_v1.h` — `host_api_v1_t`, `get_clock_status` (77),
  `get_bpm` (87).
- `src/host/shadow_sampler.c` — `sampler_get_bpm` fallback chain.
- `src/host/link_subscriber.cpp` — desired-tempo override (259–306).
- `schwung-davebox/dsp/seq8.c` — clock emit/follow reference (commits
  `c083e3f`, `7a764a6`).
- Movy: `engine/crates/seq-core/src/clock.rs` (96-PPQN accumulator),
  `engine/crates/movy-dsp/src/{lib.rs,host.rs,ffi.rs}`.
