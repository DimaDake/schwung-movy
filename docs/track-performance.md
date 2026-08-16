# Movy track performance — all measurements

Everything measured on device for the 16-track work: how much CPU a track costs,
how many you can run, and how long a note takes to reach a synth.

Measured 2026-08-15/16 on `move.local`. Reproduce with the scripts named in each
section.

---

## 1. The budget

The ceiling is **~2000 µs of work per audio frame**, of which ~146-263 µs is
movy's own baseline, leaving **~1737 µs for tracks**.

That number had to be measured, because the two obvious candidates are both
wrong:

- **`total` frame time (~2660 µs) does not move when you add tracks.** It is
  `pre + ioctl + post`, and the ioctl is mostly the *blocking wait* for the next
  SPI transfer. Work displaces that wait, so `total` reads flat right up until
  the wait is gone. Measuring it "proves" tracks are free.
- **The 2900 µs frame period is not a work budget** either — the transfer itself
  occupies part of it.

Found by ramping obxd from 0 to 12 chains, 4-note chords held
(`scripts/measure-work-ceiling.sh`):

| chains | work (`pre`+`post`) | `total` | |
|---|---|---|---|
| 0 | 263 µs | 2663 µs | |
| 3 | 971 | 2644 | flat — wait absorbing |
| 7 | 2000 | 2624 | **last flat row** |
| 8 | 2236 | 2710 | climbing |
| 9 | 2422 | 2897 | past the shim's 2850 µs overrun threshold |
| 12 | 3213 | 3684 | badly overrun |

Beyond ~2400 µs the shim's own `OVERRUN_THRESHOLD_US` (`schwung_shim.c:4357`) is
breached and it begins **skipping DSP work**.

> `overruns=` in the log is NOT a usable pass/fail signal: it is cumulative since
> boot and already runs at ~1700 per sampling window at idle, because the debug
> logging that makes these measurements possible is itself causing them.

---

## 2. Per-track cost, all 12 movy chains loaded

`scripts/stress-16-tracks.sh` — the same synth in every movy chain, a chord held
in each. **The `sounding` column is the one that makes the rest trustworthy**:
it reports how many chains were actually producing output, read from the engine's
own per-chain output peak.

| synth | 1 note | 2 | 3 | 4 | sounding | per track |
|---|---|---|---|---|---|---|
| **dexed** | 197 µs ✅ | 203 ✅ | 216 ✅ | 223 ✅ | 12/12 | ~6 µs |
| **plaits** | 460 ✅ | 456 ✅ | 457 ✅ | 457 ✅ | 12/12 | ~26 µs |
| **freak** (MrHyde) | 617 ✅ | 836 ✅ | 1143 ✅ | 1403 ✅ | 12/12 | ~105 µs |
| **nusaw** | 793 ✅ | 1355 ✅ | 1863 ✅ | 2487 ❌ | 12/12 | ~143 µs @3 |
| **moog** (RaffoSynth) | 1021 ✅ | 1034 ✅ | 1055 ✅ | 1062 ✅ | 10/12 | ~92 µs |
| **obxd** | 1243 ✅ | 1835 ✅ | 2406 ❌ | 3112 ❌ | 12/12 | ~141 µs @2 |
| **hera** | 2314 ❌ | 2783 ❌ | 3301 ❌ | 3729 ❌ | 12/12 | ~181 µs @1 |
| **noisemaker** (preset 9) | 2780 ❌ | 2869 ❌ | 2826 ❌ | 2908 ❌ | — | ~220 µs |
| **surge** | 3000 ❌ | 3383 ❌ | 3761 ❌ | 4016 ❌ | 11/12 loaded | ~238 µs |
| **helm** | 4105 ❌ | 5309 ❌ | 6753 ❌ | 8125 ❌ | 12/12 | ~330 µs @1 |

✅ under the ~2000 µs ceiling · ❌ over it, frame genuinely late.

**moog is genuinely monophonic** (a Minimoog emulation), which is why it is flat
across polyphony — that flatness is real, unlike the cases in §4.

> `surge` loaded into only 11 of 12 chains and `moog` into 10. Not diagnosed.
> Both are far past the budget anyway, so it does not change their verdict.

---

## 3. But you asked about **16** tracks

Movy hosts **12** chains — tracks 5-16. Tracks 1-4 are schwung's own slots,
rendered by the shim. All 16 draw on the *same* frame budget, so a full set costs
`baseline + 16 × per-track`.

One clean host-slot measurement (helm: **694 µs** on a host slot against 741 µs
on a movy chain) says the per-track cost is about the same either way. On that
basis:

| synth | per track | 12 movy | + 4 host = **16** |
|---|---|---|---|
| dexed (4 notes) | 6 µs | 223 ✅ | ~249 ✅ |
| plaits (4) | 26 µs | 457 ✅ | ~561 ✅ |
| moog (4, mono) | 92 µs | 1062 ✅ | ~1613 ✅ |
| freak (4) | 105 µs | 1403 ✅ | ~1823 ⚠️ marginal |
| obxd (2) | 141 µs | 1835 ✅ | ~2399 ❌ |
| nusaw (3) | 143 µs | 1863 ✅ | ~2435 ❌ |
| hera (1) | 181 µs | 2314 ❌ | ❌ |

**So obxd-at-2-notes and nusaw-at-3, which pass at 12 movy tracks, fail at a full
16.** The last column is extrapolated from a single host-track data point — the
host-phase benchmark only ever routed MIDI channel 0 to slot 0, so per-host-track
cost is not properly measured yet. Treat that column as the right shape, not a
measurement.

### Which synths run on all 16

- **dexed, plaits** — any polyphony, comfortably.
- **moog** — any polyphony, because it is monophonic.
- **freak** — marginal at four notes; fine at one or two.
- **Everything else** — no.

---

## 4. Silence masquerading as efficiency

Four modules measured as *cheap and flat across polyphony*. They were rendering
**nothing**. A cost table cannot tell "this synth renders its voices regardless"
from "the notes never arrived", which is why the engine now reports a per-chain
output peak and every row above carries a `sounding` count.

| module | why it was silent |
|---|---|
| **noisemaker** | preset 1 is **monophonic** — a 4-note chord costs one voice. Preset 9 is polyphonic and costs 220 µs/track against the 91 µs first measured. |
| **weird-dreams** | **kit-based**; the init kit has no voices. Responds to no note from 24 to 90 until a kit is loaded (`kit` 0-63). |
| **forge** | same — `kit` 0-136. |
| **mrdrums** | a **sampler**: a pad with no `pXX_sample_path` triggers nothing. |

**Any "flat across polyphony" row deserves suspicion before it is believed.**
Of the five that originally looked flat, exactly one (moog) was genuinely a
monophonic synth; the rest were artefacts.

---

## 5. Idle cost — loaded but silent

A chain costs CPU whenever it is *loaded*, playing or not.

| synth | idle / chain | playing | idle share |
|---|---|---|---|
| dexed | 3 µs | 11 | 27% |
| **plaits** | 28 | 33 | **84%** |
| noisemaker | 16 | 95 | 16% |
| obxd | 44 | 234 | 18% |
| surge | 135 | 382 | 35% |
| helm | 195 | 716 | 27% |

**Twelve idle helm chains cost ~2340 µs — more than the whole budget, with
nothing playing.** Skipping silent chains is analysed in
`chain-idle-cpu-optimization.md`; it is documented, not built, because a skipped
chain cannot wake itself.

---

## 6. Note latency

Two paths, and they were not equal.

**Sequencer notes** have never differed: the engine emits a host track's note as
MIDI (`midi_send_internal`) and hands a movy track's note straight to its chain
in the same audio block, with zero IPC. Movy tracks are equal or better here.

**Live pad notes** were the problem. A host track's pad note is one non-blocking
shm write; a movy track had no shadow slot, so each note was a *blocking* engine
param write.

**Fixed** by having the engine answer pads itself on the audio thread. The shim
already delivers pad notes to the overtake DSP's `on_midi`
(`schwung_shim.c:6950`) — confirmed by probe from real presses; it cannot be
confirmed by injection, because that path is the hardware MIDI scan and injection
writes the UI ring. The pad→pitch map (scale, octave, layout, drum lane) stays in
the UI and is pushed whenever it changes; the DSP looks up and forwards.

The engine keeps its own note ledger, because the rule movy's UI learned the hard
way applies here too: **a note-off is answered from what the note-ON recorded,
never the current map** — otherwise an octave change while a pad is held strands
the note forever.

### Measured, after the fix

`scripts/measure-pad-latency.sh`, plaits on movy chain 0, 4-note chords injected
into a settled device:

| track | idle IPC/tick | playing IPC/tick | blocking chain writes |
|---|---|---|---|
| host track 1 | 0.27 ms | 0.30 ms | — |
| movy track 5 | 2.43 ms | 2.47 ms | **0.00 / tick** |

Playing costs a movy track nothing over idle, and the blocking write per note is
gone. Proved to have teeth by putting it back: with `engineOwnsPads()` forced to
`false` and the same gesture, `msetb ch0:*` reappears in every chord window at
~0.1 calls/tick and ~0.2 ms/tick — **≈2 ms of parked UI loop per note**,
serialised across a chord.

> **The earlier "host 0.30 ms vs movy 2.12 ms" pair was not the pad path.**
> `perf_ipc` wrapped `host_module_set_param` but not
> `host_module_set_param_blocking` — and every engine write movy makes is
> blocking, so the pad writes were never in the number at all. The 2.12 ms was
> the row below, standing next to them. The probe now wraps it (`msetb`), which
> is what made the before/after above measurable.

### What a movy track cost next: the chain page, not the pads

The 2.4 ms/tick a movy track read at **idle** was one label: `mget ch<N>:*` —
the knob page refreshing the chain's params, **one blocking round trip per
tick**, against 0.3 ms for a host track (whose params come through schwung's own
cache). That mattered more than the pad fix did: the UI loop polls MIDI once per
iteration, so **the tick period _is_ the pad input sampling interval**
(`pad-to-sound-latency.md` §1), and this was ~27% of it, paid whether or not
anything was playing.

**Fixed by batching it.** A movy chain's reads go through the bulk channel — one
round trip for the whole visible page plus a sweep window, once every 8 ticks
(`REFRESH_BULK_TICKS`), instead of one param per tick. Same round trip whatever
the batch, so the page now converges in 8 ticks rather than 16 *and* costs an
eighth of the IPC. Host slots deliberately keep the per-tick read: their reads
are cheap, and the shim's bulk handler routes only to the overtake DSP, so a
chain slot could not batch even if it wanted to.

Measured on a movy track with plaits loaded, idle:

| | before | after |
|---|---|---|
| movy's own IPC / tick | 2.4 ms (`mget ch0:*`) | **0.5 ms** (`bget` 0.2 + `mget status` 0.3) |
| time inside `tick()` | 3.6 ms | **1.7 ms** |
| tick period | 8.9 ms | **6.9 ms** |
| tick rate | 110 Hz | **144-147 Hz** |

The tick period is the pad sampling interval, so that is ~1 ms off the mean pad
latency and ~2 ms off its worst case, on every movy track.

### What is left is not movy's

With the probe finally covering every entry point, the biggest label on the tick
is **schwung's own**: `get synth_module` at 0.6 calls/tick and ~1.6 ms/tick, from
`reconcileFeedbackHolds()` (`schwung/src/shadow/shadow_ui.js:2693`), which reads
`synth_module` for every slot on every host-loop iteration for any overtake tool.
It shows up in the window but not in `tick_ms`, because it runs in the host loop
rather than inside movy's tick. Filed upstream — see
`schwung-feedback-hold-poll-cost.md`.

## 7. Caveats

- **Preset and kit choice dominate.** Every figure is "this synth, this preset",
  not "this synth". noisemaker moves 2.4× between presets.
- **No audio FX.** Synth slot only; each FX adds its own cost.
- **Loading costs far more than running.** A single module load blocks the audio
  callback for ~1986 µs (`scripts/measure-load-blocking.sh`), which is why movy
  releases at most one load per callback. Loading twelve chains is a burst of
  twelve such stalls, not a steady-state cost.
- **Host-track cost is one data point**, not a measurement (see §3).

## Scripts

```bash
scripts/measure-work-ceiling.sh    # the ~2000 us budget
scripts/stress-16-tracks.sh        # all 12 chains, with sounding verification
scripts/bench-chain-cpu.sh         # per-synth slope from 4 chains
scripts/bench-all-tracks.sh        # host slots vs movy chains
scripts/measure-load-blocking.sh   # what a module load costs
scripts/measure-pad-latency.sh     # live pad cost, host track vs movy track
```

> **Trust the instrument only as far as it reaches.** `perf_ipc` has twice
> reported a clean number for a call it was not wrapping — first
> `host_module_set_param_blocking` (every engine write movy makes), then
> `shadow_get_params` (the bulk channel). Worse, a wrapper survives a tool
> reopen while the module state behind it does not, so calls were recorded into
> counters nothing reported — `shadow_ui` outlives even a Move stack restart, so
> that state persisted for hours. Both are now asserted in `browser-test/perf.mjs`:
> every host entry point is wrapped, wrappers report through a swappable global
> sink, and a reopen takes the counting over without nesting.
