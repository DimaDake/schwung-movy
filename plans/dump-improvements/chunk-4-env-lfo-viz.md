# Chunk 4 — 2-stage envelopes + module-LFO viz + detector misses (A2, A3, C5)

Owns: `src/model/envelope.ts`, `src/model/lfo-viz.ts`,
`src/renderer/envelope.ts` (+ light wiring in `src/model/viewmodel.ts`).
**Wave 2 — run before chunk 3** (filter viz), which touches the same
wiring. Run `git -C movy pull` first.

---

## Prompt

You are working in `/Users/dake/git/cld` on **movy** (`movy/` — an
Elektron-style knob UI for Ableton Move; 128×64 1-bit screen, pages of
2 rows × 4 knob cells). Read `movy/CLAUDE.md` and the root `CLAUDE.md`
and follow their workflow (local suites, screenshot baselines, device e2e
when reachable, commit + push, 200-line file limit, model/renderer
boundaries). Run `git -C movy pull` first.

Background: movy auto-detects ADSR groups per page
(`detectEnvelopes`/`planPageLayout` in `src/model/envelope.ts`; drawn by
`src/renderer/envelope.ts` as one 4-cell graphic per knob line) and LFO
shape+phase pairs (`detectLfoViz` in `src/model/lfo-viz.ts`, drawn by
`src/renderer/lfo-wave.ts` as a 2-cell wave). `movy/docs/module-dump/`
holds a live capture of all 76 installed modules (per-module layouts in
`modules/<category>--<id>.json`; analysis in `IMPROVEMENTS.md` — this
chunk is **A2 + A3 + C5**).

### Part 1 (A2): 2-stage / 3-stage envelope support

Today `detectEnvelopes` only emits a group when **all four** A/D/S/R roles
are present, so common AD/AR/ASR envelopes render as plain knobs. Dump
evidence — modules with 3+ envelope-named params and zero envelope lines:
`303`, `chordism` (Envelope page: Attack + Release), `fizzik`, `forge`,
`freak` (8 env-named params!), `granny`, `mrdrums` (per-pad
`attack_ms`/`decay_ms`), `mrsample` (8), `signal`, `euclidrum` (midi_fx).
Check each module's page rows in the dump before deciding what should
detect.

Requirements:
- Extend detection to emit partial groups: **AD, AR, ASR, ADS** (any
  qualifier group with ≥ 2 roles where one is `a`; keep the existing
  guard that a bare-letter-only group still needs all four letters).
  A 2-role group must occupy 2 adjacent cells on one row; 3-role groups
  3 cells (same adjacency rule the 4-role path uses via
  `planPageLayout` — study how it rearranges cells and reuse it).
- Extend the renderer to draw 2-vertex (attack up, decay/release down)
  and 3-vertex (A + S plateau + R) shapes; sustain remains a level, not a
  time. Keep the existing 4-stage drawing pixel-identical (baselines must
  not change for existing scenes — that's the regression gate).
- Fix detector misses (C5): teach `roleOf` these forms seen in the dump:
  - `env1 a` / `env2 d` style (qualifier + bare letter in words);
  - `amp`/`vca` as qualifiers mapping to the Amp group name;
  - keys like `v_attack`, `attack_ms` (suffix noise words `ms`, `time`
    ignored when extracting the role/qualifier).
  Then verify against dump layouts why `freak` and `mrsample` (8
  env-named params each) currently get no lines, and make the correct
  pages detect. `surge` "Amp Envelope" page shows `DECAY` twice (two
  qualifier groups colliding) — after your changes that page must
  resolve to sensible groups (whatever you determine is correct from
  `sound_generator--surge.json`), with a test.

### Part 2 (A3): module-LFO waveform viz

`detectLfoViz` (`src/model/lfo-viz.ts`) currently keys off explicit
config `lfo:` tags. Extend it (keep pure; split a helper file if it
outgrows the 200-line limit) to also detect **module** LFO clusters by
name. Explicit tags keep priority over inference. Also extend the
`KnobSlot.lfo` tag union (`src/types/param.ts`) with
`'rate' | 'depth' | 'sync' | 'deform'` so later module configs can opt
in precisely.

**Grouping:** qualifier-based like the envelope detector — strip the
`lfo` token and digits to form the group key, so chordism's
`amp_/lm_/pm_/filter_lfo_*` and fizzik's `lfo1_/lfo2_` are distinct
groups. fizzik's Mod page (`lfo1_rate, lfo1_depth, lfo1_shape,
lfo1_target / lfo2_…` — one LFO per row) must yield **two** viz groups
on one page; the VM array already supports this.

**Roles** (same-qualifier; verify by option vocabulary where noted):
- shape: enum with an lfo-context word (`lfo` in key/label) +
  `shape|wave|waveform|form`, qualifying iff ≥ half its options map to
  drawable shapes (table below). Unmapped *values* of a qualifying enum
  draw a generic glyph — never collapse the viz mid-scroll (layout
  stability while turning the shape knob through osirus's 68 entries).
- rate: `rate|speed|freq` numeric (free-running); rate_div: enum whose
  options parse as divisions (`1/4`, `1/8T`, `Off|1/64|…`).
- sync: enum with `free/sync` options (`lfo_sync`, freak's
  `lfo_rate_mode`) — its live value selects which rate source drives the
  cycle count.
- depth: `depth|magnitude|amount|amt` **without a destination word**
  after stripping the qualifier (`pitch/filter/pwm/osc/pan/cutoff/
  tva/tvf/amt1/amt2` → excluded: moog `lfo_pitch`, hush1 `lfo_filter`,
  osirus `osc1_lfo1_amount` are per-destination amounts, NOT master
  depth; filter's `lfo_amount` and surge's `magnitude` ARE).
- phase: `phase` 0..1; deform: `deform|symmetry` numeric (normalize
  osirus 0..127 → −1..1 around 64).
- polarity: options must contain `bipolar/unipolar` (forge `cv_lfo_pol`,
  surge `unipolar`); **osirus `lfoN_mode: Poly|Mono` is a voice mode and
  must NOT match** — vocabulary check, never key name alone.
- retrigger: `retrig|trigger|trigmode|keytrigger` — value maps to the
  dot: `note reset/one shot/keytrigger/retrig/on` → on;
  `free/freerun/off/random` → off.

**Span:** shape cell + adjacent same-row cell of the same group (prefer
rate, else phase, else depth). Verified placements: chordism Modulation
`shape(0)+rate(1)`; surge LFO pages `shape(0)+rate(1)`; osirus
`rate(0)+shape(1)`; filter LFO page `rate_hz(2)+shape(3)`; fizzik
`depth(1)+shape(2)` per row (keeps the `target` knob visible). No
adjacent same-row partner → no viz. Off-span group members keep their
knobs and feed the drawing live from `knobValues` (turning DEPTH moves
the amplitude).

**Shape mapping table** (extend `shapeSample` in
`src/renderer/lfo-wave.ts`; ids 0–5 exist, add 6–10; normalize names to
lowercase, strip `&`/spaces):
- 0 sine ← sine, sin, skewed sine, sink, warp
- 1 tri ← tri, triangle
- 2 saw up ← saw, sawtooth, ramp up, soft saw
- 3 square ← square, sqr, squ, rect, pulse, warm pulse, soft square
- 4 s&h stepped ← s&h, sample & hold, rnd1, random
- 5 smooth random ← smooth_random, s&g, rnd2, drift
- 6 saw down ← ramp down, saw down (chordism!)
- 7 noise ← noise (dense deterministic jitter, distinct from 4 and 5)
- 8 envelope glyph ← envelope (surge) — fixed AD-ramp icon
- 9 staircase glyph ← step sequencer (surge)
- 10 generic squiggle ← mseg, formula, `wave N` (osirus digital waves)
All fixed patterns must be deterministic (screenshot stability — see the
existing s&h/swishy comment in `shapeSample`).

**Rate → cycles:** extend `LfoVizVM` with `cycles: number` (1..6 whole
cycles, default 2 — the current constant; keeps the track-LFO page
pixel-identical), `depth: number` (0..1 amplitude scale, default 1 —
depth 0 draws a flat baseline, a deliberate "LFO inactive" cue) and
`deform?: number`. Cycle mapping: log-normalize numeric rates over the
param's min..max when max/min > 100 (fleet Hz ranges span 0.01..500),
linear otherwise; division enums map by ordinal position; the sync
enum's live value picks the active source. Integer cycles only.

**Explicitly out of scope** (document in code comments): delay/fade/LFO
envelopes (surge's DAHDSR — seconds don't belong on a cycles axis),
per-destination amount lists, obxd's mixable `lfo_sin/square/sh`
toggles (config territory), dexed's int-coded `lfo_wave` (a module
config can later supply `options` on that slot, which enables the viz
via the normal name path), minijv DC `offset`, forge `xlfo_src`
cross-mod.

Dump evidence to detect after this chunk: chordism Modulation, fizzik
Mod (×2), surge LFO 1..6 + Scene LFO 1..6, osirus LFO 1/2/3, filter LFO,
freak ModS/LFO. Correctly still knob-only: moog/hera/mrsample/midiverb
(no shape param on page), dexed (int shape), obxd (toggles), hush1
(shape hidden until its chunk-6 config lands — which should seat
`lfo_waveform` adjacent to `lfo_rate` to gain the viz).

### Tests, docs, verification

- Logic tests in `browser-test/logic.mjs` (mocks in
  `browser-test/mock-synth.mjs`): AD pair detects with 2 cells; AR with
  qualifier; ASR 3-cell; 4-role behaviour unchanged (existing tests must
  stay green); `env1 a`-style grouping; amp/vca qualifier naming. For
  the LFO part: chordism-like positive (shape+rate span, saw-down maps
  to id 6); fizzik-like page yields two groups with correct spans and
  the target knob untouched; osirus-like `Poly|Mono` mode param does
  NOT set polarity; master-depth vs destination-amount discrimination
  (filter `lfo_amount` in, moog `lfo_pitch` out); depth 0 → flat-line
  VM (`depth === 0`); rate→cycles mapping at min/mid/max for a wide Hz
  range and for a division enum with a live sync switch; a qualifying
  shape enum at an unmapped value (osirus "Wave 17") draws the generic
  glyph rather than dropping the viz; explicit `lfo:` tags still win
  over name inference (track-LFO page VM unchanged, cycles defaults
  to 2).
- Screenshot scenes for a 2-stage and a 3-stage envelope page; regenerate
  baselines (`node browser-test/screenshot.mjs --update`) and verify
  existing envelope scenes did NOT change. `node browser-test/perf.mjs`
  green.
- `cd movy && npm test` green. If `browser-test/dump-replay.mjs` exists,
  update expectations for pages that newly gain envelope/LFO groups.
- User-facing → `movy/MANUAL.md`: extend the envelope section (2/3-stage
  shapes) and the LFO viz mention; doc assets via
  `node scripts/make-doc-assets.mjs <baseline>`. README only if you judge
  it headline-worthy (probably not — it extends an existing feature).
- Device e2e per movy/CLAUDE.md if reachable (known wedge at plan time:
  zero-byte MIDI-inject flood — if that's the failure, report DEVICE
  VERIFICATION BLOCKED in CAPS and continue).
- Commit in reviewable steps (detector A2, renderer A2, roleOf fixes,
  A3), push to main.
