# Chunk 3 — Filter cutoff+resonance graphic group (A1)

Owns: new `src/model/filter-viz.ts`, new `src/renderer/filter-curve.ts`;
wires into `src/model/viewmodel.ts`, `src/types/viewmodel.ts`,
`src/renderer/label.ts`/`knob-view.ts`. **Wave 2 — start only after
chunk 4 (envelope/LFO detectors) has merged**, since both touch the
viewmodel/knob-row wiring. Run `git -C movy pull` right before starting.

---

## Prompt

You are working in `/Users/dake/git/cld` on **movy** (`movy/` — an
Elektron-style knob UI for Ableton Move; 128×64 1-bit screen, 2 rows × 4
knob cells per page, cell width 32px). Read `movy/CLAUDE.md` and the root
`CLAUDE.md` and follow their workflow (local suites, screenshot baselines,
device e2e when reachable, commit + push, 200-line file limit,
model/renderer boundaries: `model/` never draws, `renderer/` is pure).
Run `git -C movy pull` first.

Background: movy already replaces knob cells with graphics when it detects
semantic groups — ADSR envelopes (one graphic per 4-cell line;
`src/model/envelope.ts` detect + `src/renderer/envelope.ts` draw) and LFO
waveforms (2-cell graphic; `src/model/lfo-viz.ts` + `src/renderer/
lfo-wave.ts`, `ViewModel.lfoViz`, drawn via `drawKnobRow` in
`src/renderer/label.ts`). This chunk adds a third auto-detected group per
IMPROVEMENTS.md **A1**: a filter-response curve for adjacent
cutoff+resonance knobs. Study how `lfoViz` flows from `detectLfoViz` →
`buildViewModel` (`src/model/viewmodel.ts`) → `LfoVizVM` →
`drawKnobRow`/`drawLfoWave` and mirror that pattern exactly.

### Detection (`src/model/filter-viz.ts`)

Detect on a page (≤ 8 `KnobParam`s) a cutoff+resonance pair by key/label,
qualifier-aware like the envelope detector (`roleOf` in
`src/model/envelope.ts` is the reference for word matching):

- cutoff role: whole-word `cutoff`, `freq`+`filter` qualifier, or key
  forms `filter_cutoff`, `vcf_cutoff`, `filter1_cutoff`, bare `cutoff`.
- resonance role: `resonance`, `reso`, `res`, `q`, `peak`.
- Pair only within the same qualifier (`filter1_cutoff` pairs with
  `filter1_resonance`, not `filter2_resonance`).
- Both params must be numeric (float/int), sit on the **same row**, and be
  **adjacent columns** (the 2-cell graphic spans startCol..startCol+1 like
  `LfoVizVM`). If adjacent-same-row fails, no viz (knobs render normally).
- A param already claimed by an envelope or LFO viz group on that page
  must not be claimed again — check integration order in
  `buildViewModel` and claim after envelopes/LFO viz.

Additionally resolve the **filter type (mode)** so the curve draws the
right shape. Detect the mode source by its **option vocabulary, not its
key** — bare `mode` keys are ambiguous (`filter`/`pushnpull` `mode` =
`["LP","HP","BP","Notch","Peak","AP"]` is a filter type; ambiotica's
`mode` = `["Mismember","Loona","NAPS","Flow"]` is an algorithm picker and
must NOT match). Rule: a same-qualifier enum param qualifies as the mode
source iff ≥ half its options normalize to filter-type words:
`lp|lowpass|low pass` → LP, `hp|high*` → HP, `bp|band*` → BP, `notch` →
NOTCH, `peak|bell` → PEAK, `ap|allpass` → AP, `off` → OFF; combined names
like aphex's `"HP+LP"` → BP, `"LP only"` → LP, `"HP only"` → HP.
Real mode sources in the dump: `filter`/`pushnpull` (`mode`), chordism
(`filter_mode` LP/HP/BP, plus `filter_slope` 12/24 dB), freak
(`filter_mode` lp/bp/hp), aphex (`filter_mode`), denis (`filter_type`),
mrsample (`filter_type`).

Mode **value** resolution (in `buildViewModel`, no extra IPC):
1. mode param on the same page → its live `knobValues` entry (turning
   MODE morphs the curve immediately);
2. mode param elsewhere in `knobParams` → its cached value when known;
3. no mappable mode param (moog, 303, obxd, …) → default **LP**.

Real modules that must detect (verify against
`docs/module-dump/modules/…json` — `movy.params[].key` and page rows):
`filter` (audio_fx: cutoff+resonance), `303`, `moog`, `obxd`, `hush1`,
`nusaw`, `braids` (cutoff+resonance on its Filter page), `hera`
(vcf_cutoff+vcf_resonance), `chordism` (Main page cutoff+reso AND Filter
page filter_cutoff+filter_resonance), `freak`, `krautdrums`
(filter_cutoff+filter_reso), `surge` (filter1_*). Non-detections that must
stay plain: `spectra` (frequency+resonators — resonators is a mixer, not
a Q), fizzik (`rnd_reson` is a randomizer, keep out: require the reso
word to be the label/key head, not a `rnd_`-prefixed key).

### ViewModel + rendering

- Add `FilterVizVM` to `src/types/viewmodel.ts`:
  `{ line: 0|1; startCol: number; cutoff: number; resonance: number;
  mode: 'lp'|'hp'|'bp'|'notch'|'peak'|'ap'|'off'; slope?: 0|1 }`
  (cutoff/resonance normalized 0..1 from the params' min/max/current
  values; `slope` set only when a same-qualifier 12/24 dB-style enum
  exists, e.g. chordism's `filter_slope`) and `filterViz?: FilterVizVM[]`
  on `ViewModel`, mirroring `LfoVizVM`/`lfoViz`.
- `src/renderer/filter-curve.ts`: pure `drawFilterCurve(rowY, viz)`
  drawing across the 2-cell span (64×~20px area — reuse the exact
  geometry `drawLfoWave` uses). In every shape, cutoff = the feature's
  x-position and resonance = the bump/dip magnitude:
  - **lp**: flat passband from the left, resonance bump at the corner,
    falling slope to the right (steeper when `slope === 1`);
  - **hp**: mirrored — rising slope from the left, bump at corner, flat
    passband to the right;
  - **bp**: single hump centered at cutoff; resonance raises/narrows it;
  - **notch**: flat line with a V dip at cutoff; resonance deepens it;
  - **peak**: flat line with a bell bump at cutoff;
  - **ap**: plain flat line (no spectral shape to show);
  - **off**: dashed flat line.
  1-bit pixels via `fill_rect` only. Label cells below stay untouched
  (touch/value/automation behaviors unchanged — labels and knob turning
  still work per param).
- Wire into `drawKnobRow` (`src/renderer/label.ts`) and `renderKnobsView`
  the same way `lfoViz` is passed through.

### Tests, docs, verification

- Logic tests (`browser-test/logic.mjs`): detection positives (moog-like
  mock, qualifier pairing, chordism two-pages case), negatives (spectra
  case, non-adjacent, cross-row), mode-source vocabulary rule (a
  filter-like `mode` enum detects; an ambiotica-like `mode` enum does
  not), mode value resolution (same-page live value; default LP when
  absent), `"HP+LP"` → bp mapping, claim-priority vs envelope (a page where
  attack/decay/sustain/release + cutoff/reso coexist — envelope wins its
  cells, filter viz still claims its own pair).
- Screenshot tests: add scene(s) in `browser-test/screenshot.mjs` for a
  filter page at low and high resonance, plus one per mode shape
  (lp/hp/bp/notch at least — one scene each, or a composite via the
  filter module's LP/HP/BP/Notch enum); regenerate baselines
  (`node browser-test/screenshot.mjs --update`) and check diffs. Run
  `node browser-test/perf.mjs` — the curve must not blow the fill_rect
  budget (compare to the LFO wave's cost).
- `cd movy && npm test` green. If `browser-test/dump-replay.mjs` exists,
  update its expectations (pages gaining `filterViz`).
- User-facing feature → document in `movy/MANUAL.md` (how the graphic
  reads: corner = cutoff, peak = resonance) with a doc asset generated via
  `node scripts/make-doc-assets.mjs <baseline-name>`; add a Features
  bullet + screenshot to `movy/README.md` (this is a headline feature).
- Device e2e per movy/CLAUDE.md if reachable (known wedge at plan time:
  zero-byte MIDI flood blocks CC injection — if that's the failure mode,
  report DEVICE VERIFICATION BLOCKED in CAPS and continue).
- Commit in reviewable steps (detector, renderer+wiring, docs), push to
  main.
