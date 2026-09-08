# Send FX buses and the per-track MIX page — design

Status: approved 2026-09-05. Implementation plan: `2026-09-05-send-fx-and-mix-page-plan.md`.

Two movy-hosted send FX buses on the master page, and a MIX page at the end of
every track's chain rotation carrying volume, pan and the two send levels — all
four automatable.

---

## 1. What exists already

- **The mixer is movy's own.** Movy is loaded as schwung's overtake DSP
  generator and the shim sums ONE stereo buffer from it into the ME bus, so
  every movy-hosted track is mixed in `mixer.rs` rather than arriving in Move's
  mixer as its own channel. `TrackMix { gain, pan, muted }` already exists and
  is already persisted (`mix-persist.ts`); **pan and mute have had no control
  surface**, and this is it.
- **`chain_process_fx(inst, buf, frames)` is a standalone FX pass.** It walks a
  chain instance's audio-FX slots over a caller-supplied buffer and touches
  nothing else (`schwung/src/modules/chain/dsp/chain_host.c:2176`). A send bus is
  exactly this call on an accumulated buffer.
- **A virtual chain slot is an established pattern.** The LFO page is a
  `CHAIN_SLOTS` entry with `scanDir: ''`, backed by a Model-conforming object
  rather than a module (`src/lfo/model.ts`, `inertModelSurface`).
- **`LoadQueue` is slot-generic** (`slot: usize`), so send-module loads ride the
  same one-load-per-audio-callback bound as chain loads with no change.

## 2. Constraints that shape the design

- **Only movy-hosted chains can be sent.** A schwung-slot track renders inside
  the shim; movy never sees its audio. There is no `slot:pan` in schwung either.
  So on a host track, pan and both sends are unreachable — not unimplemented.
- **`slot:volume` is not automatable.** `knob_find_param` resolves only
  chain-internal components, so a shim-level param cannot be a lane target. On a
  host track the MIX page is a fader and nothing else.
- **A mix param is not a chain-host param.** The existing automation path is
  engine lane → CC 102+lane → the chain's `knob_<lane+1>_set` mapping. Mix
  params live in movy's own mixer, so they need a lane target of their own
  (§7).
- **Send buses cannot be parallelised.** A bus depends on every chain that feeds
  it having rendered, so it runs after the join, serially on the audio thread.

## 3. CPU: when this pays

Sends move work OUT of the parallel pool and ONTO the critical path. With N
tracks wanting one effect of cost R, and L lanes (default 3):

| | total core time | frame critical path |
|---|---|---|
| Insert per track | N × R | ≈ ceil(N/L) × R, plus the 3-lane contention tax |
| One send | 1 × R | exactly 1 × R, no contention tax |

- **N=1: sends are strictly worse.** An insert on a helper lane may cost the
  critical path nothing; a send always costs its full R on lane 0.
- **N=2–3: a wash on the deadline**, a 2–3× saving in total core time.
- **N≥4: sends win on both.**

They pay most with: many tracks sharing one expensive wet effect; `chlanes 1`
(no parallel pool to lose); a `chain_pin`-blacklisted FX (N copies forced onto
one lane); `chiso` on (N `.so` copies); and **sleep behaviour** — at the default
`chidle` level a chain's FX stops only once its synth sleeps and its own tail
falls silent, so N per-track reverbs hold N chains awake for their tail plus
~1 s, and N FX declaring `requires_continuous_processing` hold them awake
forever.

They do not pay for: one or two tracks; cheap FX; insert-shaped FX (distortion,
compression, EQ — a send produces a different result, not a cheaper one);
synth-bound sets; host tracks.

**Zero cost when unused is a design commitment, not a freebie** — see §5.

## 4. Where the send buses live

Two `ChainInstance`s in a new `send_bus.rs`, owned by `ChainSlots`, NOT two
extra entries in `ChainSlots.slots`.

The rejected alternative — slots 16/17 in the same `Vec` — reuses more
(`service_loads`, the chain-set document, `set_param`/`get_param` are all
slot-generic), but 61 sites reference `MOVY_CHAINS` and four iterate
`self.slots` directly. Every one would have to be audited so a send bus is never
planned onto a render lane, struck by the digest, or counted as an active track.
A separate field leaves `self.slots` at exactly 16 entries, so every existing
loop is correct by construction and the invariant "`ch<N>` IS track N" stays
literally true. Only `service_loads` gains a dispatch branch; loads still ride
the shared `LoadQueue` with `slot = MOVY_CHAINS + n`.

## 5. Engine: the render path

`TrackMix` gains `send: [f32; 2]`.

In `chain_slots::render()`, inside the existing per-chain mix loop and
immediately after `mix_into(out, scratch, mix)`, the same scratch accumulates
into each bus at `gain × pan × send[n]` — **post-fader, post-pan**, sharing the
one `channel_gains()` computation with the main mix. After the track loop, each
loaded send instance runs `process_fx` on its bus and the result is summed into
`out` at unity; the bus is then zeroed.

Send chains never call `render_block` (they have no synth) and are never planned
onto a lane. They run inside the existing `add_wall` bracket, so the CPU page
keeps measuring the whole cost.

**Idle gating.** A bus skips `process_fx` only while its input is silent AND its
own last output was silent AND the FX has not declared
`requires_continuous_processing` — the same rule `chain_idle` applies to a
track's post-FX stage, so a reverb tail rings out instead of being cut.

**Zero cost when unused.** Three deliberate early-outs, each pinned by a test:

1. two pointer checks — is a send instance loaded — before the process step;
2. an early-out on `send[n] == 0` per chain in the mix loop, mirroring
   `mix_into`'s existing silence early-out;
3. a per-bus dirty flag gating the zeroing, so an untouched bus is not memset.

With no send modules and every send at zero this is a few dozen branches per
block against a 2902 µs frame, plus 1 KB of preallocated buffers.

## 6. Engine: params and persistence

- `parse_mix` accepts **three** fields (legacy `gain,pan,muted`) or **five**
  (`gain,pan,muted,send1,send2`). An old set restores with sends at zero.
  `packMix` keeps returning `undefined` at the all-defaults value, so an
  untouched track still writes nothing.
- Send chains are addressed as `snd<n>:*` at the engine root, translated onto
  the instance's `fx1` component (`snd0:module` → `fx1:module`, read back via
  `fx1_module`).
- They persist in the existing chain-set document as pseudo-slots
  `MOVY_CHAINS + n` — the codec is already slot-generic — and their preset blobs
  ride the existing deferred bulk write in `chain-payload.ts`.

## 7. Automation of the mix params

`assignLane`'s `setMapping` callback is the seam. For a module param it issues
`knob_<lane+1>_set`; for a mix param it instead writes `ch<N>:mixlane
<lane>,<field>`. In `drain_out`, an `OutEvent::Cc` for a movy chain consults
that map first and applies the value to the mixer field directly, instead of
emitting CC 102+lane into the chain.

Everything above that seam is untouched: lanes, step locks, live takes, base
values, undo, the pool-of-8. Lane restore re-issues the mix mapping exactly
where it re-issues `knob_N_set` today.

**Pre-existing bug this feature would inherit.** `syncLabelsFromEngine` loops
`t < 4` and `verifyLaneMappings` round-robins `& 3`
(`src/seq/automation.ts:427,311`), while the engine emits labels for all 16
tracks (`engine.rs:2322`). Automation lanes on tracks 5–16 are therefore never
rebuilt after a Set load nor re-applied after a module reload. A leftover from
the 4-track era, same shape as the `track > 3` mute guard. Widened to
`TRACK_COUNT` as its own task with its own test.

## 8. UI: the MIX page

A sixth `CHAIN_SLOTS` entry, last, `scanDir: ''` so `isVirtualSlot` already
covers it. Four knobs: **VOL · PAN · SND1 · SND2**.

`LFO_CHAIN_INDEX` stops being "the last slot" and becomes an explicit index.
This is load-bearing: `persistableComponents()` (`chain-persist.ts:69`) and
`buildTrackModels()` (`app/track-models.ts`) both filter on `isLfoSlot`, and
both must now also exclude the MIX slot, which holds no module either.

The dB ladder currently private to `mixer/track-volume.ts` moves to
`mixer/db-ladder.ts` and is shared, so the page and the hold-track+volume
gesture cannot drift. Sends use the same ladder with index 0 = off.

On a host track: VOL edits `slot:volume` and PAN/SND1/SND2 render as disabled
cells.

## 9. UI: the two SEND slots on the master page

Prepended to `MASTER_FX_SLOTS`, so master reads **SEND 1 · SEND 2 · MFX 1–4 ·
LFO**. One FX module per send, matching an MFX slot.

They are NOT `master_fx:` components. `componentPort` gains a third branch
returning a `SendPort` that writes engine-root `snd<n>:` keys, and
`moduleReadKey` gains the matching read alias. Browsing, loading, undo and the
module-state dump go through `openBrowser`/`loadSelectedModule` unchanged —
those are already generalised over `ChainSlot`.

Signal flow: send FX → movy's stereo out → ME bus → schwung's master FX. "Left
of MFX" on the page is also left of it in the signal path.

## 10. Testing

**Rust (`cargo test`)**
- send accumulation is post-fader and post-pan (proven with a track that is both
  panned and faded);
- `parse_mix` accepts 3 and 5 fields; a 3-field value yields zero sends;
- the bus is processed after the track mix and zeroed between blocks;
- tail-vs-silence gating: a ringing bus keeps processing, a silent one stops;
- the three zero-cost early-outs;
- lane → mix routing in `drain_out`.

**Logic suite (`browser-test/logic/`)**
- MIX page view model, movy and host variants;
- the shared dB ladder;
- lane assignment for a mix param;
- the `LFO_CHAIN_INDEX` / `persistableComponents` change;
- persistence round-trip, including a legacy 3-field set;
- lane restore across all 16 tracks (§7 fix) — must fail with the `t < 4` cap in
  place.

**Screenshots** — new scenes for the MIX page (movy and host) and a master SEND
slot; baselines regenerated.

**Perf** — `perf.mjs` asserts a set with no sends measures as today's baseline;
`test-cpu.sh` on device for the two extra FX passes.

**Docs** — MANUAL.md section + Controls reference rows; README bullet.

## 11. Out of scope

- Return level or return pan (send amount is the only level control, exactly as
  an MFX slot has none).
- Sends from schwung-hosted tracks — structurally impossible without a schwung
  change.
- Fanning the two buses onto helper lanes in a second rendezvous. Worth
  revisiting once the buses exist and `CostMeter` can price them: it costs
  ~21 µs of scheduler wake, so it only pays if a send FX costs materially more
  than that.
