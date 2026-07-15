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

`detectLfoViz` currently keys off movy's own LFO-page param tags. Extend
it (same file, keep pure) to also detect **module** LFO clusters by
key/label: an enum shape param (`*lfo*` + `shape`/`wave`/`waveform` in
key or label) adjacent on the same row to a rate or depth param of the
same qualifier (`lfo_rate`, `lfo_dpt`, `vib_speed` does NOT count — no
lfo word). Draw with the existing `drawLfoWave` (shape index must map
onto `LFO_SHAPES` order — for module enums, map by option-name matching:
sine/tri/saw/square/random/S&H style names; if the enum's options can't
be mapped confidently, skip the viz for that group).

Dump evidence to detect: `chordism` Modulation page (`LFO Wave`+`LFO
Rate`), `obxd` (lfo pages), `hera`, `hush1` (`lfo_waveform` currently
hidden — only add viz for *visible* params; don't unhide anything in this
chunk). Non-detection: fizzik's Mod page uses `RATE/DEPTH/SHAPE/TARGE`
labels without an LFO word in key or label — confirm from
`sound_generator--fizzik.json` and leave it undetected if so.

### Tests, docs, verification

- Logic tests in `browser-test/logic.mjs` (mocks in
  `browser-test/mock-synth.mjs`): AD pair detects with 2 cells; AR with
  qualifier; ASR 3-cell; 4-role behaviour unchanged (existing tests must
  stay green); `env1 a`-style grouping; amp/vca qualifier naming; module
  LFO positive (chordism-like mock) and the option-name-unmappable
  negative.
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
