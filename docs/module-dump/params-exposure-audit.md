# `params[]` exposure — per-module audit

Movy now renders each `ui_hierarchy` level's `params[]` list after its `knobs[]`
row (design: `plans/2026-07-31-params-list-exposure-design.md`). This is a
generic rule applied to every module without a movy config, so every affected
module was reviewed individually to confirm it is actually **better off**.

Method: `browser-test/dump-expect.json` before/after (via
`scripts/report-page-diff.mjs`), plus the regenerated per-module layouts in
`docs/module-dump/modules/*.json`, which are produced by booting the real model
against the captured device metadata.

**Result: 43 modules changed, 612 parameters newly reachable, 0 parameters or
pages lost.** One regression was found and fixed before merge (`pushnpull`,
below). Verdicts: **31 improved, 12 neutral, 0 worse**.

Unaffected (a movy config owns their layout, so this code never runs):
`signal, chordism, hush1, weird-dreams, sfz, essaim, chiptune, mrdrums, plaits,
303, krautdrums, wurl, forge, libpo32`.

---

## Regression found and fixed

### `pushnpull` — a `canvas` parameter on a knob

`pushnpull` lists `view` (`type: "canvas"`) — a drawing surface for the module's
own web UI, with no min, no max and no value semantics. The first cut of the
extras rule promoted it to a knob, where it rendered as a meaningless 0..1 arc
and would have written nonsense to the DSP on any turn.

**Fix (generic, in `src/model/level-extras.ts`):** an extra is only promoted if
its declared type is one movy has a control for — `int`, `float`, `enum`,
`filepath`. A *missing* type is still allowed, since that is the `metaGuessed`
path that infers a real range from the first value read. Fleet-wide this rule
excludes exactly three parameters: `pushnpull.view` (canvas), `granny.sample_name`
(string) and — only where they are not already knobs — `wav_position` entries.
`granny.position` and `mrdrums.pad_start` are `wav_position` but were already on
`knobs[]` rows before this change, so they are untouched.

Regression test: `browser-test/logic.mjs` → *"extras: non-knob type skipped"*,
plus `audio_fx--pushnpull::view` in `dump-replay.mjs`'s `UNREACHABLE_OK` with
the reason recorded.

---

## Verdicts

| module | pages | new params | verdict | notes |
|---|---|---|---|---|
| `osirus` | 13 → 23 | 105 | **improved** | The module this work started from. Bank, ROM (Virus A/B/C), both oscillators' PW/wave/semitone, all three LFOs' modes and clocks, the full 3-slot mod matrix. Device-verified. |
| `surge` | 31 → 50 | 103 | **improved** | Per-oscillator octave/keytrack/retrigger, mixer mutes and routing, all 12 LFOs' hold/sustain/release/trigger mode, send levels. |
| `minijv` | 50 → 70 | 90 | **improved** | Per-tone pitch/amp/filter envelope levels and delay, key-follow, plus `patchbank`/`patchnumber` — patch selection was previously unreachable. |
| `euclidrum` | 10 → 19 | 63 | **improved** | Per-lane fill, drop, gate, velocity, accent and randomisation. Each lane gains one overflow page; shift+jog jumps lane to lane. |
| `dexed` | 23 → 29 | 41 | **improved** | Per-operator velocity sensitivity, rate scaling, AMS, EG L3/L4 and oscillator mode — the parts of DX7 programming that were still hidden. |
| `eucalypso` | 11 → 13 | 32 | **improved** | Per-lane note/octave randomisation with their seeds, BPM, retrigger mode. |
| `helm` | 30 → 34 | 32 | **improved** | The 32 step-sequencer values, four pages of 8. Editable per step for the first time. |
| `aphex` | 9 → 16 | 19 | **improved** | Second-voice detune/PW/sync/FM, filter mode and reversal, the ESP envelope/pitch block. |
| `ottx` | 2 → 5 | 14 | **improved** | Every band's up/down ratio and threshold plus both crossover frequencies — a 3-band OTT with only 2 pages was barely usable before. |
| `magneto` | 5 → 8 | 13 | **improved** | Tape loop length, record mode, sync mode/division, tempo, feedback. |
| `obxd` | 13 → 16 | 13 | **improved** | Voice count, bandpass, filter-envelope invert, LFO sync, per-voice pans 5–8. |
| `dragonfly-hall` | 2 → 3 | 8 | **improved** | Low/high cut, crossover and multiplier, modulation and wander — the whole tone-shaping half of the reverb. |
| `superarp` | 5 → 7 | 7 | **improved** | Sync, internal BPM, modifier trigger and the four randomisation seeds. |
| `smack` | 3 → 6 | 6 | **improved** | Clear, Detect BPM, Transport, Pad Play, AB Quantize, pitch range. |
| `smack-in` | 3 → 6 | 6 | **improved** | Same set on the input variant. |
| `denis` | 7 → 9 | 6 | **improved** | 30-entry preset list, filter type, portamento, legato, velocity→filter. |
| `verglas` | 2 → 3 | 4 | **improved** | Freeze, mode, quality, stereo spread. |
| `superboom` | 4 → 5 | 4 | **improved** | Flavor (8 voicings), mod shift, vocal gain/control. |
| `ambiotica` | 2 → 3 | 4 | **improved** | Loop length, mod shape, tempo sync, lo-fi tails. |
| `usefulity` | 1 → 2 | 4 | **improved** | Per-channel phase invert, DC filter, bass audition — the point of a utility plugin. |
| `tapescam` | 1 → 2 | 3 | **improved** | Input gain, tape speed, widen. |
| `linein` | 6 → 6 | 3 | **improved** | Noise-gate mode, amount and hold; fit into existing pages' spare slots. |
| `genera` | 2 → 3 | 2 | **improved** | Generator mode and a 20-entry scale list. |
| `spectra` | 4 → 5 | 2 | **improved** | Polyphony and limiter. |
| `granular` | 4 → 5 | 2 | **improved** | Grain drift and envelope. |
| `structor` | 3 → 4 | 2 | **improved** | Detection and random filter. |
| `dissolver` | 2 → 3 | 2 | **improved** | Attack and release times. |
| `cloudseed` | 1 → 2 | 2 | **improved** | Stereo width and mod rate. |
| `filter` | 4 → 5 | 1 | **improved** | Filter model. |
| `palette` | 5 → 6 | 1 | **improved** | FX reorder (24 routings). |
| `war_bells` | 10 → 11 | 1 | **improved** | 22-entry preset list. |
| `fizzik` | 9 → 10 | 1 | **improved** | Voicing (12 options). |
| `velocity_scale` | 1 → 1 | 1 | **improved** | Curve preset — the module's main control. |
| `sf2` | 1 → 1 | 4 | neutral | Reverb/chorus on + level. Useful, but the module publishes no metadata for them, so they start as guessed 0..1 controls until first read (`metaGuessed`). |
| `chowtape` | 1 → 2 | 2 | neutral | `degrade` and `output` are real, but the module reports no display name — the on-screen labels fall back to the keys. An upstream naming fix, not a movy one. |
| `pushnpull` | 2 → 3 | 2 | neutral | Attack and band split are genuine; the third listed entry was the `canvas` regression above and is now excluded. |
| `mverb` | 1 → 2 | 1 | neutral | Early mix. |
| `vocoder` | 1 → 2 | 1 | neutral | Unvoiced mix. |
| `freeverb` | 1 → 1 | 1 | neutral | Width. |
| `psxverb` | 1 → 1 | 1 | neutral | Input gain. |
| `nam` | 1 → 1 | 1 | neutral | Cab bypass. |
| `chord` | 1 → 1 | 1 | neutral | Strum direction. |
| `ducker` | 1 → 2 | 1 | neutral | Velocity sensitivity; no `chain_params` metadata, so it starts guessed. |

## Things checked and deliberately left alone

- **Randomisation seeds** (`*_seed`, 0..65535 — eucalypso, euclidrum, superarp).
  Wide integer ranges are slow on a knob, but these are exactly what the module
  itself offers in its list view, and movy already honours a module's
  `knob_acceleration` metadata when it declares one. Making movy *infer*
  acceleration from range width is a separate idea, tracked in
  `IMPROVEMENTS.md`, not something to fold into this change.
- **Long enum lists** (osirus `assign*_dest`, 123 options; `chorus_lfo_shape`,
  68). Any enum with more than 6 options opens movy's full-screen scrollable
  overlay, so length is not a usability problem.
- **Page growth.** `minijv` reaches 70 pages and `surge` 50. Two things make
  that workable: existing pages keep their position and name, so nothing a user
  already knows moves, and Shift + jog jumps section to section. Read-back was
  also made page-first so a bigger module is no slower to read.
- **Short-name collisions.** `dump-replay.mjs` enforces unique 5-character
  on-screen names per page; every new page passes without additions to
  `KNOWN_COLLIDING_PAGES`.
