# Movy chain CPU benchmarks

How many **movy-hosted tracks** (5-16) can run a given synth, at a given
polyphony, before the audio frame stops keeping up.

Measured on device 2026-08-15 by `scripts/bench-chain-cpu.sh` (per-synth cost)
and `scripts/measure-work-ceiling.sh` (the budget itself).

> Tracks 1-4 are Schwung's own and cost movy **nothing** — the host renders them.
> Everything here is about the twelve chains movy hosts itself.

---

## The budget, and why it had to be measured

Two obvious candidates are both wrong:

- **`total` frame time (~2660 µs) does not move when you add chains.** It is
  `pre + ioctl + post`, and the ioctl is mostly the *blocking wait* for the next
  SPI transfer. Extra work displaces that wait, so `total` is flat right up until
  the wait is gone. Measuring it "proves" chains are free.
- **The 2900 µs frame period is not a work budget** either, because the transfer
  itself occupies part of it.

So the ceiling was found by ramping obxd from 0 to 12 chains with a 4-note chord
held in each, watching where `total` breaks away from flat:

| chains | work (`pre`+`post`) | `total` | |
|---|---|---|---|
| 0 | 263 µs | 2663 µs | |
| 3 | 971 µs | 2644 µs | flat — wait absorbing |
| 7 | 2000 µs | 2624 µs | **last flat row** |
| 8 | 2236 µs | 2710 µs | climbing |
| 9 | 2422 µs | 2897 µs | past the shim's 2850 µs overrun threshold |
| 12 | 3213 µs | 3684 µs | frame badly overrun |

**Usable work budget: ~2000 µs**, of which ~263 µs is movy's baseline, leaving
**~1737 µs for chains**. Beyond ~2400 µs the shim's own `OVERRUN_THRESHOLD_US`
(2850 µs on `total`, `schwung_shim.c:4357`) is breached and it begins *skipping
DSP work*.

The ramp also validates the extrapolation used below: it implies 248 µs/track for
obxd at 4 notes, against 228 µs measured independently at 4 chains.

---

## Per-track cost, and how many tracks fit

`max tracks` = `1737 µs / per-track cost`, capped at 12 (movy hosts twelve).

| synth | notes | per track | max tracks | |
|---|---|---|---|---|
| **dexed** | 1 | 8 µs | **12** | |
| | 2 | 8 µs | **12** | |
| | 3 | 8 µs | **12** | |
| | 4 | 10 µs | **12** | cheapest by a wide margin |
| **plaits** | 1 | 30 µs | **12** | |
| | 2 | 30 µs | **12** | |
| | 3 | 32 µs | **12** | |
| | 4 | 32 µs | **12** | |
| **forge** | 1 | 45 µs | **12** | |
| | 2 | 45 µs | **12** | |
| | 3 | 45 µs | **12** | |
| | 4 | 45 µs | **12** | |
| **noisemaker** | 1 | 91 µs | **12** | |
| | 2 | 75 µs | **12** | |
| | 3 | 92 µs | **12** | |
| | 4 | 91 µs | **12** | |
| **weird-dreams** | 1 | 80 µs | **12** | |
| | 2 | 81 µs | **12** | |
| | 3 | 81 µs | **12** | |
| | 4 | 81 µs | **12** | |
| **obxd** | 1 | 97 µs | **12** | |
| | 2 | 145 µs | **11** | |
| | 3 | 191 µs | **9** | |
| | 4 | 228 µs | **7** | |
| **surge** | 1 | 290 µs | **5** | |
| | 2 | 311 µs | **5** | |
| | 3 | 351 µs | **4** | |
| | 4 | 371 µs | **4** | |
| **helm** | 1 | 380 µs | **4** | |
| | 2 | 499 µs | **3** | |
| | 3 | 575 µs | **3** | |
| | 4 | 725 µs | **2** | heaviest measured |

### Two behaviours that change how you budget

**Some synths are flat across polyphony.** `dexed`, `plaits`, `forge`,
`weird-dreams` and `noisemaker` cost the same at four notes as at one — they
render their voices regardless of how many you play, so extra notes are free and
only the track count matters.

**Others scale steeply.** `obxd` more than doubles from 1 to 4 notes, `helm`
nearly doubles. For these, polyphony is the budget: three obxd tracks playing
four-note chords cost the same as nine playing single notes.

### An overload, observed

`helm` at 4 notes across 4 chains measured **3164 µs of work — more than the
entire 2900 µs frame**. That configuration cannot keep up, and it agrees with the
table above (helm at 4 notes tops out at 2 tracks).

---

## Measured for real: all 12 movy chains at once

The table above extrapolates from four chains. This is the actual thing — the
same synth in **all twelve** movy chains, a chord held in every one
(`scripts/stress-16-tracks.sh`). Baseline with no chains: 146 µs.

| synth | 1 note | 2 notes | 3 notes | 4 notes |
|---|---|---|---|---|
| **dexed** | 197 µs ✅ | 203 ✅ | 216 ✅ | 223 ✅ |
| **plaits** | 460 ✅ | 456 ✅ | 457 ✅ | 457 ✅ |
| **obxd** | 1243 ✅ | 1835 ✅ | 2406 ❌ | 3112 ❌ |
| **noisemaker** (preset 9) | 2780 ❌ | 2869 ❌ | 2826 ❌ | 2908 ❌ |
| **surge** | 3000 ❌ | 3383 ❌ | 3761 ❌ | 4016 ❌ |
| **helm** | 4105 ❌ | 5309 ❌ | 6753 ❌ | 8125 ❌ |

✅ = under the ~2000 µs work ceiling. ❌ = over it; the frame is genuinely late
(`total` climbs past ~2700 µs as the ioctl wait is exhausted).

**So, on all twelve movy tracks at once:** dexed and plaits at any polyphony,
obxd up to two notes. Nothing else — noisemaker on a polyphonic preset, surge and
helm all exceed the budget with a single note in every track.

### The preset trap — noisemaker

The four-chain table above says noisemaker costs ~91 µs/track. The stress test
says **220 µs/track**. Both are right: the first ran on **preset 1, which is
monophonic**, and the second on **preset 9, which is not**. A mono preset makes a
four-note chord cost exactly one voice, so the synth looks cheap and its
polyphony column looks flat.

This is the single biggest trap in these numbers. Any "flat across polyphony"
row deserves suspicion before it is believed — check the preset before concluding
a synth is efficient.

### Extrapolation vs reality

Worth knowing how much to trust the four-chain table. Predicted twelve-chain work
against measured:

| synth | predicted | measured | |
|---|---|---|---|
| obxd, 4 notes | 2882 µs | 3112 µs | 8% under |
| surge, 1 note | 3626 µs | 3000 µs | 17% over |
| helm, 1 note | 4706 µs | 4105 µs | 13% over |

Close enough to be useful, and slightly **pessimistic** for the heavy synths — so
the four-chain table will not tell you a configuration is fine when it is not.
Where the answer is marginal, run the stress test rather than trusting the slope.

> `surge` reported only 11 of 12 chains loaded in that run. Not diagnosed; it is
> already far over budget at 11, so it does not change the conclusion.

## Practical guidance

- **Only dexed and plaits comfortably fill all twelve chains** at any polyphony,
  confirmed by the stress test rather than extrapolated.
- **obxd fills them at one or two notes**, not three.
- **noisemaker's cheap figure is a preset-1 (mono) artefact** — on preset 9 it
  does not fit twelve tracks at all.
- **obxd is the interesting middle.** Fine everywhere at one or two notes; plan
  around 7 tracks if you are playing four-note chords on all of them.
- **surge and helm are the heavy ones.** Budget 4-5 surge tracks or 2-4 helm
  tracks, and treat them as the feature instrument rather than the default.
- **Mixed sets add up linearly.** Costs are per-chain and independent, so sum the
  per-track figures and keep the total under ~1737 µs.

## Caveats

- **Preset choice dominates.** The four-chain table used each module's DEFAULT
  preset, and noisemaker's default is monophonic — 91 µs/track there against
  220 µs on polyphonic preset 9. Treat any per-synth figure as "this preset",
  not "this synth".
- **No audio FX.** Only the synth slot was loaded. Each FX in a chain adds its
  own cost on top.
- **`overruns=` was not usable as a pass/fail signal.** It is cumulative since
  boot and already runs at ~1700 per sampling window at idle on this device — the
  debug logging that makes the measurement possible is itself causing them. The
  work metric is what the numbers rest on.
- **Loading costs far more than running.** A single module load blocks the audio
  callback for ~1986 µs (`scripts/measure-load-blocking.sh`), which is why movy
  releases at most one load per callback. Loading twelve chains is a burst of
  twelve such stalls, not a steady-state cost.

## Re-measuring

```bash
./scripts/bench-chain-cpu.sh move.local 4 obxd surge helm   # per-synth cost
./scripts/measure-work-ceiling.sh move.local obxd 12        # the budget itself
```

Both need movy open on the device with the debug log enabled.
