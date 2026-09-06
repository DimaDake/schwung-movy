# Send FX cost, and whether the send phase should be parallel

Measured 2026-09-06 on device, against the send buses shipped in
`2026-09-05-send-fx-and-mix-page-design.md`.

Two questions, one measurement:

1. Would rendering the two send buses in parallel be worth a rendezvous?
2. Would sends 3 and 4 cost much?

Both reduce to *what one send bus's FX pass costs per block*, so that is what
was measured. Harness: `scripts/measure-send-cost.sh`, reading the per-bus cost
meter through `sndcostlog`.

---

## 1. Method

`sndcostlog` reports a 1/16 exponential mean of the `chain_process_fx` call for
each bus, plus its worst single block, and **resets the window** — the same
trick `chcostlog` uses, and for the same reason: it lets a measurement discard
the load phase and the note-on attack, and time only the settled window.

Per FX: load it into bus 0, set track 0 to unity/centred/full send, hold a note,
discard the first window, then measure over 6 s of continuous audio. Track 0
because that is the only track the device fixture seeds with a synth — every
other track is empty, and a send from one measures silence.

Costs are of each module **at its shipped default preset**. A reverb set to a
longer tail or a higher quality mode will cost more than the number here.

## 2. Results

One send bus, one FX, 2902 µs block (128 frames):

| FX | mean µs/block | max µs | % of frame |
|---|---:|---:|---:|
| freeverb | 44.8 | 76.9 | 1.5% |
| midiverb | 48.2 | 89.4 | 1.7% |
| mverb | 88.1 | 127.9 | 3.0% |
| dragonfly-hall | 230.8 | 293.2 | 8.0% |
| tape-echo2 | 353.6 | 438.6 | 12.2% |

An 8× spread between the light and heavy ends. Every answer below depends on
which end of that table a user loads, not on how many slots exist.

### The serial phase is additive

The arithmetic below rests on `A + B`, so it was falsified rather than assumed.
With both buses loaded and fed at once:

| FX | alone | both loaded |
|---|---:|---:|
| dragonfly-hall | 230.8 | 227.7 |
| tape-echo2 | 353.6 | 355.9 |

Within noise. No interaction — the buses do not slow each other down.

The same run's CPU meter read `chwall=616/883/2902` with a single synth
playing (chain 0 at 36 µs), so those two sends were ~95% of the measured wall:
**584 µs, 20% of the frame budget, for two reverbs.**

### Nothing here pins a bus awake

None of the five declares `capabilities.requires_continuous_processing`, so
every one of them idles out once its own tail falls below `SILENCE_LEVEL` after
the input stops. A send that is loaded but not being fed costs nothing at rest —
the cost in the table is what it charges *while working*, not a standing tax.

## 3. Question 1 — parallel send rendering

The send phase is serial by construction: a bus is a sum of tracks, so it cannot
run until every chain has rendered. Serial costs `A + B`. Fanning bus 1 onto a
helper costs `max(A, B)` plus one rendezvous, ~21 µs of scheduler wake
(`project_movy-join-cost`; not re-measured here).

**Saving = the cheaper bus, minus 21 µs.**

| pair | serial | parallel | saved |
|---|---:|---:|---:|
| midiverb + freeverb | 93 µs | 69 µs | 24 µs (0.8%) |
| midiverb + tape-echo2 | 402 µs | 375 µs | 27 µs (0.9%) |
| dragonfly + tape-echo2 | 584 µs | 377 µs | 207 µs (7.1%) |

**Verdict: not worth building for two sends.** It pays only when *both* are
expensive, and 7% of a frame is small beside what sends already save against
per-track inserts. With one light FX in the pair the saving is noise.

One point in its favour, if it is ever built: the send phase runs *after* the
chain join, so the helper threads are idle and it pays none of the 27%
three-lane contention tax chain rendering pays
(`2026-08-23-parallel-render-prototype.md` §6). The table above should be close
to what is actually delivered, unlike the chain case.

## 4. Question 2 — sends 3 and 4

**The slots are free; only what you load into them costs.** An empty bus is
never accumulated into, never processed and never cleared — three early-outs,
each pinned by a test in `send_bus.rs`. Two more buses add 1 KB of preallocated
buffers and 32 more float compares per block (16 chains × 2 buses). Unmeasurable
against 2902 µs.

What four sends cost when used:

| loadout | per block | % of frame |
|---|---:|---:|
| four light (midiverb-class) | ~190 µs | 6.5% |
| two light + two heavy | ~770 µs | 27% |
| four heavy | ~1170 µs | 40% |

Forty percent is a lot, but it is a user's deliberate choice and still far
cheaper than the same four effects inserted on eight tracks each.

Two consequences worth knowing before building it:

- **The MIX page still fits.** VOL · PAN · SND1 · SND2 on line 1, SND3 · SND4 on
  line 2 — 6 of 8 knobs.
- **The automation pool gets tight.** VOL + PAN + four sends is 6 of a track's 8
  lanes if a user automates all of them on one track.

### It flips question 1

Four heavy sends serial is ~1170 µs. Fanned across the idle helpers that becomes
`max ≈ 356 + 21 ≈ 380 µs` — a **790 µs saving, 27% of the frame**. Parallel is
not worth building for two sends; it becomes the obvious next step if four sends
get used the way four sends invite.

## 5. Recommendation

**Add sends 3 and 4. Skip parallel for now.**

The work is a 5→7-field mix value (`parse_mix` already tolerates 3 for legacy
sets, so the same shape extends), two more `MixField` variants, two more
`MASTER_FX_SLOTS` entries, and two more cells on the MIX page. No new mechanism
anywhere — every piece already exists and is tested.

**Superseded on the parallel half, 2026-09-06** — parallel send rendering was
built anyway, for the heavy-FX case this section prices at 207 us. See
`2026-09-06-parallel-send-render.md`; the recommendation to add sends 3 and 4
still stands and is still unbuilt.

Revisit parallel only once there is evidence people load three or four expensive
FX at a time. At that point it is worth 27% of the frame rather than 7%, and the
cost meter added here is what will say so.

## 6. What this does not measure

- **A loaded set.** These runs had one synth playing (36 µs). Send cost per block
  is independent of how many chains exist — a bus processes one buffer either way
  — but the *percent-of-frame* framing assumes the rest of the budget is free. On
  a 12-chain set the sends compete with ~600-1500 µs of chain render.
- **The rendezvous cost on this path.** The ~21 µs figure is carried over from
  the chain fan-out work; a send-phase rendezvous has not been built or timed.
- **Non-default presets.** Every number is the module's shipped default.
- **`max` is one block.** A note-on spikes it; the mean is the number to plan
  with.
