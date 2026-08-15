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

## Practical guidance

- **Anything up to ~80 µs/track fills all twelve chains.** dexed, plaits, forge,
  weird-dreams and noisemaker are unconstrained — pick them freely.
- **obxd is the interesting middle.** Fine everywhere at one or two notes; plan
  around 7 tracks if you are playing four-note chords on all of them.
- **surge and helm are the heavy ones.** Budget 4-5 surge tracks or 2-4 helm
  tracks, and treat them as the feature instrument rather than the default.
- **Mixed sets add up linearly.** Costs are per-chain and independent, so sum the
  per-track figures and keep the total under ~1737 µs.

## Caveats

- **One preset per synth** — whatever the module loads by default. A heavier
  patch (more oscillators, more unison, an active filter) costs more; `surge` and
  `helm` in particular vary a lot by patch.
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
