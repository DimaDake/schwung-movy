# Improvement proposals from the 2026-07-15 module inventory

Source data: [SUMMARY.md](SUMMARY.md), [device-dump.json](device-dump.json),
[modules/](modules/). 76 modules captured live (9 MIDI FX, 35 sound
generators, 32 audio FX); 64 modules produced 117 anomaly warnings.

Ranked within each category by user impact ÷ effort.

---

## A. New auto-applied UI groups (envelope-style, zero per-module work)

### A1. Filter graphic group (cutoff + resonance)
**17 modules** expose a cutoff+resonance pair movy can detect the same way
it detects ADSR — by key/label with a qualifier (`cutoff`/`filter_cutoff`/
`vcf_cutoff`/`filter1_cutoff` + `resonance`/`reso`/`res`):

> filter, pushnpull, 303, braids, chordism, fizzik, freak, hera, hush1,
> krautdrums, minijv, moog, nusaw, obxd, osirus, surge (+ spectra's
> frequency/resonators is a near-match)

Proposal: when cutoff+reso sit adjacent on a page, replace their two knob
cells with a single two-cell filter-response curve (corner position =
cutoff, peak height = resonance), labels/touch/automation unchanged — the
exact pattern the LFO waveform viz already uses for Shape+Phase. Extend
later with MODE/SLOPE awareness (chordism's Filter page has both) to draw
LP/HP/BP/notch shapes.

### A2. Two-stage envelope support (AD / AR / ASR)
The ADSR detector requires all four roles, so common 2-stage envelopes get
plain knobs. **10 modules** have 3+ envelope-named params but zero envelope
lines today: 303, chordism (Attack+Release), fizzik, forge, freak, granny,
mrdrums (per-pad attack_ms/decay_ms), mrsample, signal (per-voice attack),
euclidrum. Proposal: draw a 2-vertex (AD/AR) or 3-vertex (ASR) graphic when
a qualifier group has 2–3 roles; also teach `roleOf` the `env1 a` /
`amp`/`vca` qualifier forms so freak/mrsample's 8 env-named params group
correctly instead of falling through.

### A3. Module-LFO waveform viz
Movy's own LFO page draws Shape+Phase as a waveform, but module LFO
clusters (chordism `LFO Wave/Rate/Dpt`, fizzik's Mod page with two
RATE/DEPTH/SHAPE sets, obxd, hera, hush1…) render as plain enums.
Proposal: reuse `detectLfoViz` on module pages when a `*_lfo_shape`/`wave`
+ `rate` pair is adjacent, drawing the same 2-cell wave.

---

## B. Custom layouts (per-module configs)

### B1. Modules that show NOTHING today — biggest functional win
`branchage` (27 params), `smack-in` (20), `belt-in` (16) publish
`chain_params` but no `ui_hierarchy`, and movy's generic path requires the
hierarchy — so their param pages are empty. Either ship movy configs for
the three, or (better, generic) add a fallback that paginates
`chain_params` directly when no hierarchy exists. The fallback also
future-proofs new store modules.

### B2. Per-unit modules that qualify for the drum/pad treatment
The dump shows large blocks of per-unit params reachable only through the
module's own "current X" alias — exactly what the drum `padScoping` config
solves (focused-pad concrete keys, pad-press selection):

| module | hidden per-unit params | unit |
|---|---|---|
| dexed | 120 (`op1_`..`op6_`, 20 each) | FM operator → 6 pad-selectable OP pages |
| weird-dreams | 104 `vN_` (already drum-configured; EQ/master block of 31 still hidden) | voice |
| signal | 52 `vN_` | 13 voices — drum-style synth, no config yet |
| euclidrum | 56 `laneN_` | 8 lanes — pad-select a lane like a drum pad |
| forge | 24 `vN_` + kit params | voices |
| eucalypso | 24 `laneN_` | lanes |
| minijv | 340 `nvram_tone_N_` | 4 tones |
| krautdrums | 8 `rhythm_1..8` (config exists — just add a Rhythm bank) | rhythm slot |

Highest value: **dexed** (operator editing is the whole point of DX7-style
synthesis and is 84 % hidden today) and **signal/forge** (drum-style
modules identified by the dump that lack the pad UI mrdrums/krautdrums
already enjoy).

### B3. chordism "Chord Multi" page is functionally incomplete
The page shows chromatic toggles **C..G only** (8 knob slots); `chord_pc_8`
..`chord_pc_11` (G#, A, A#, B) exist but are unreachable — you cannot build
chords containing the top four pitch classes. Fix via a config that spans
two rows/pages, or nicer: a pad-based 12-note toggle overlay (movy already
owns the pads).

### B4. sfz shows opaque `knob_0..knob_7` while real params hide
sfz's hierarchy exposes eight unnamed macro knobs; its `chain_params`
(attack, decay, sustain, release, cutoff, reso, tune, gain…) are all
hidden. A tiny config mapping the named params (plus the ADSR group from
A2) makes it a first-class citizen.

### B5. Quick config wins for core hidden params
- **303**: `waveform`, `tuning`, `drive_model`, `devil_mod_switch` hidden —
  waveform on a 303 is core.
- **chiptune**: `wavetable`, `detune`, `noise_mode`, `sweep` hidden (10 of 18).
- **mrdrums**: add pad-scoped `pad_choke_group` to the existing config.
- **hush1**: 23 hidden incl. `pulse_width`, `pwm_*`, `lfo_waveform`.

---

## C. Generic bugs / systemic fixes

### C1. Preset knob duplicated on two pages
`impressive-chords` and `breakbeat` get a dedicated "Preset" page **and**
the same preset knob again as slot 1 of "Main - 1". Cause: `loadHierarchy`
adds the separate Preset page when root has ≥8 knobs but doesn't remove
`list_param` from the root knob list when the module also lists it there.
One-line fix + logic test.

### C2. On-screen name collisions — 19 pages across 15 modules
`dedupShortNames` strips the common word prefix but (a) never re-checks the
result, so second-level collisions survive ("Delay Tone Hi/Lo" → `TONE`,
`TONE`; "Ctrl to Cutoff/Morph/…" → `TO`, `TO`, `TO`), and (b) can strip all
context ("Wave 1..4" + "Shape 1..4" → chordism's Oscillators page renders
as `1 2 3 4 / 1 2 3 4`). Proposal: iterate dedup to a fixed point, and when
a suffix is ≤2 chars keep a compressed prefix (`WAV1`/`SHP1`); when
collisions persist, fall back to joined-truncation (`TONEH`/`TONEL`).
Affected pages listed in SUMMARY.md anomalies (chordism ×4, surge ×4,
palette ×4, fizzik ×5, denis ×4, signal, obxd, osirus, …).

### C3. Huge preset lists are knob-only torture
Preset params that publish only a count+name (no options array) never get
the scrollable overlay (`enumOverlay` requires `options`), so they are
jog-by-knob only at 4 detents/step: **minijv = 2 427 presets (9 708
detents to sweep), surge = 675, clap = 509, obxd = 128**. Proposal: give
`renderStyle: 'preset'` + `nameKey` params a paged overlay that polls
names for the visible window (name_param per index is already supported by
the loader) plus turn-acceleration.

> **NOT ACTIONABLE as proposed (reviewed 2026-07-16 — chunk 5 dropped).**
> The proposal's premise is self-contradicting against `loadHierarchy`
> (`src/model/hierarchy.ts`): a preset param only becomes the overlay-less
> `options: null` + `nameKey` flavor **when the module does not answer
> `preset_name_0`**. If it did answer per-index names, the loader already
> builds a full `options` array and it already gets the enum overlay. So
> "poll `preset_name_<i>` for the visible window" returns null for exactly
> the modules that need this — the device dump confirms empty `presets.sample`
> and zero `preset_name_*` keys for minijv/surge/obxd/clap. The only name
> obtainable is the *currently loaded* preset (`name_param`), so an overlay
> could show nothing but `#index / total`. Judged not worth the interaction
> surface; if revisited, it needs upstream modules to publish per-index names
> (or a bulk `preset_names` array).

### C4. Metadata-less params get guessed ranges
When neither `chain_params` nor hierarchy-inline metadata exists, movy
assumes float 0..1 step 0.02 and shows `%`. `impressive-chords` (16
params: base_note, transpose, retrig…), `clap` (plugin_index!, param_6/7),
sfz's knobs. Semitone/index params as 0..1 % knobs are wrong or broken.
Proposal: after first read, infer int-ness from the returned value format
(the enum layer already learns formats this way) and clamp/step
accordingly; long-term, file issues upstream for the modules to publish
metadata.

### C5. Envelope detector misses (verify then fix with A2)
`surge` "Amp Envelope" page shows duplicate `DECAY` (two env groups
colliding), and the A2 list shows full-ADSR modules whose pages still miss
lines because roles sit in different qualifier groups. Add dump-driven
regression tests: replay `device-dump.json` layouts in logic tests and
assert expected envelope lines per module (the dump makes this trivial
now).

---

## D. Other observations

- **Automation/LFO reach**: everything hidden today is also invisible to
  automation lanes and LFO targeting; B1/B2/B5 multiply modulation targets
  for free.
- **Dump-driven regression testing**: `scripts/dump-movy-layout.mjs` runs
  the real model against real device data — wiring a curated subset of
  `device-dump.json` into `browser-test/` would catch layout regressions
  against every installed module, not just the 7 bundled configs.
- **Store-wide leverage**: several fixes (C2, C3, B1-fallback, A1–A3) are
  generic — they improve every current and future store module with zero
  per-module work, which is where movy gets the most usability per line.

## Suggested order

1. **C1** preset duplication (one-liner + test)
2. **C2** short-name dedup fixes (pure function + tests, 19 pages improve)
3. **B1** chain_params fallback (3 dead modules come alive)
4. **A1** filter graphic (17 modules, reuses LFO-viz pattern)
5. **C3** preset overlay w/ name polling (minijv/surge/clap/obxd)
6. **A2** 2-stage envelopes (+ detector qualifier fixes)
7. **B2** dexed operator pages, then signal/forge drum configs
8. **B3/B4/B5** chordism Chord Multi, sfz, 303/chiptune quick configs
