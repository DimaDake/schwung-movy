# Skipping silent chains — a measured, unbuilt optimization

**Status: documented, not implemented.** Recorded here because the measurement
justifies it and the risk is specific enough to be worth writing down before
anyone starts.

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

## Why it is not built: the wake-up problem

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

## What to measure afterwards

The same `scripts/bench-all-tracks.sh` idle columns should collapse toward the
baseline. The check that matters is not the saving but the absence of
regressions: load a chain with a synced LFO drone and confirm it still speaks,
and that a long release tail is not clipped.
