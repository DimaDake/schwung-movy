# Skipping silent chains

**Status: SHIPPED 2026-08-24** as `chidle`, on by default. Design:
`docs/superpowers/specs/2026-08-24-chain-idle-skip-design.md`. What was built
differs from the sketch below in one important way — see *What shipped*.

## The measurement

A movy chain costs CPU whenever it is *loaded*, whether or not it is making a
sound. Measured on device (movy open, 4 chains, held 4-note chords vs nothing
playing):

| synth | idle / chain | playing / chain | idle share |
|---|---|---|---|
| dexed | 3 µs | 11 µs | 27% |
| **plaits** | 28 µs | 33 µs | **84%** |
| noisemaker | 16 µs | 95 µs | 16% |
| obxd | 44 µs | 234 µs | 18% |
| surge | 135 µs | 382 µs | 35% |
| helm | 195 µs | 716 µs | 27% |

The available per-frame work budget is ~1737 µs (see
`chain-cpu-benchmarks.md`). So:

- **Twelve idle helm chains cost ~2340 µs — more than the entire budget, with
  nothing playing.**
- Twelve idle surge chains cost ~1620 µs, about 93% of it.
- Plaits spends 84% of its cost doing nothing.

A loaded set is expensive before a single pad is touched, and that is the cost
this optimization would remove.

## The shape of it

Skip `render_block` for a chain that has **no notes held** and whose output has
been **silent for K consecutive blocks**. Movy is well placed to do this: it owns
both the MIDI routing to those chains and the param writes, so it knows exactly
when sound could restart.

Resume on any of: a note-on, a param write, a state restore, a module load.

## The wake-up problem

**Once movy stops calling `render_block`, the chain cannot wake itself.** That is
fine for note-driven sound and wrong for anything that generates internally:

- a MIDI FX arpeggiator producing its own notes,
- a tempo-synced LFO driving a filter into audibility,
- a self-oscillating filter that rings up after a delay,
- a long reverb or delay tail still decaying (partly handled by the silence
  window, but a slow swell could dip under the threshold and be cut).

Movy cannot distinguish "silent because nothing is playing" from "silent for the
moment but about to speak", because the thing that would tell it is the render
call it just stopped making.

## Two mitigations, either or both

1. **Only skip chains with no MIDI FX loaded.** The arpeggiator case is the one
   that clearly generates notes with no input, and it is detectable — the chain
   knows whether `midi_fx1` holds a module.
2. **Render one block in every N while idle** (N = 32 is ~93 ms). Any output
   above the silence threshold resumes full rendering. Costs ~3% of the idle
   figure instead of 100%, and bounds the worst case to one skipped block of a
   swell rather than silence forever.

(2) alone is probably enough, and is the safer of the two: it degrades to "a
drone starts up to 93 ms late" rather than "a drone never starts". (1) is a
cheap extra guard for the case most likely to bite.

## What shipped

Neither mitigation, as it turned out. schwung's shim had already solved this for
its four host slots and movy took its answer instead:

- **A staggered probe**, 1 block in 172 (~0.5 s), offset by `chain * 14`. The
  shim's own offset is `s * 43` = 172/4, which cannot be reused: `43 * 4 == 172`,
  so chains 0, 4 and 8 would probe on the same block and stack three renders
  into one.
- **`mod:tick`** (`chain_host.c:709`), which advances `lfo_tick` without
  rendering audio. This is what makes the LFO-drone case safe rather than
  merely unlikely — without it a sleeping chain's LFOs run 172× too slow and
  resume from a stale phase at note-on.
- **A synth/FX split**, which the sketch above did not consider at all. Gating
  on chain output alone is measured *post*-FX, so any FX that never settles
  below ±4 pins the expensive synth awake forever. The synth and the FX now
  sleep independently; a sleeping synth hands its FX a block of silence so tails
  decay normally, and FX declaring `requires_continuous_processing` never sleep.

## Measured, after the fix

`scripts/measure-chain-idle.sh`, twelve mixed chains loaded and nothing playing:

| | mean per block | worst |
|---|---|---|
| `chidle 0` (render everything) | 978 µs | 1161 µs |
| `chidle 3` (shipped default) | **71 µs** | 347 µs |

**13.8×**, with 10 of 12 chains asleep. Per chain, `helm` went 224.7 µs → 1.3 µs
and `surge` 178.7 µs → 1.0 µs. The two chains that stayed awake were two `plaits`
instances still ringing from the benchmark's own `decay=1` — the gate declining
to sleep a chain that is making sound, which is the gate working.

That is ~900 µs returned to a ~2000 µs budget, before a single pad is touched.

### And the checks that matter more than the saving

The same script runs all three, automated:

- **The split changes no samples.** Three arms (`chidle 0` / `chidle 1` /
  `chidle 0` again), because state survives between arms — 4 of 12 chains are
  reproducible across their own control arms, and all 4 are bit-identical.
- **A sleeping chain's LFOs still move.** Asserted on the driven param's value
  while that specific chain is in the reported `sleeping=[...]` list. Proved to
  have teeth by removing `mod_tick`: the value freezes at 1.000.
- **The gate actually fired.** A saving of zero and a saving never attempted
  look identical in a cost table.
