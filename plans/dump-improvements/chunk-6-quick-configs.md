# Chunk 6 — Custom-config quick wins: chordism, sfz, 303, chiptune, mrdrums, hush1 (B3 + B4 + B5)

Owns: new files in `src/modules/*.json` + registration lines in
`src/modules/loader.ts`. Wave 1 (but chunk 7 also edits loader.ts —
chunk 7 is scheduled after this one merges). Run `git -C movy pull`
first.

---

## Prompt

You are working in `/Users/dake/git/cld` on **movy** (`movy/` — an
Elektron-style knob UI for Ableton Move). Read `movy/CLAUDE.md` and the
root `CLAUDE.md` and follow their workflow (local suites, device e2e when
reachable, commit + push). Run `git -C movy pull` first.

Background: movy ships per-module layout configs as JSON in
`movy/src/modules/*.json`, registered in `src/modules/loader.ts`
(import + `CONFIGS` map entry — see how `plaits`/`wurl` are wired). The
schema is `ModuleConfig` in `src/types/param.ts`: banks → rows (2 rows ×
4 slots per bank; `null` = empty cell) → `KnobSlot`
(`key/short/full/type/render/env/lfo/options/min/max`), plus
`drum`/`setOnLoad`/`global`/`padSpecific` flags. A config **replaces** the
module's auto-generated layout entirely, so every param you want shown
must be listed. `movy/docs/module-dump/` holds the ground truth for every
module: `modules/<category>--<id>.json` has the full native param table
(`native.params`: key, name, type, min/max/step, options, default) and
the current auto-layout (`movy.pages`). This chunk = IMPROVEMENTS.md
**B3, B4, B5**.

For **each** module below: read its dump file, design banks that cover
the listed params (keep the module's own grouping where it's good — the
existing auto pages are shown in `movy.pages`), give every slot a `short`
(≤ 5 chars, unique per page) and `full` name, set `env:`/`lfo:` tags
where the params form envelope/LFO groups (`a|d|s|r`, `shape|phase|mode|
retrig`) so the existing graphics engage, and use `type`/`options` from
`native.params` verbatim (don't invent ranges).

### 1. chordism (`sound_generator--chordism.json`) — B3 + hidden params

- **Must fix:** the "Chord Multi" page exposes chromatic toggles C…G only
  (8 slots); `chord_pc_8..chord_pc_11` (G#, A, A#, B) exist in
  chain_params but are unreachable — chords using those pitch classes
  cannot be built. Config: two Chord Multi banks ("Chord 1" C…G, "Chord
  2" G#…B) or one bank + a second (your call), covering all 12
  `chord_pc_*` params. Render as `hbar` (they're 0/1 toggles — check
  native.params).
- Restore the useful hidden params (38 total, list in the dump's
  `analysis.hiddenParams`): at minimum `detune`, `chord_spread`,
  `chord_rotation`, `fm_modulator`, `fm_amount`, `filter_lfo_rate/depth/
  shape`, `vib_delay`, `delay_tone`, `glide_legato`, `lfo_phase_1..4`.
  Skip write-only/positional oddities you judge non-musical
  (`quality_position`, `*_position`) — document skips in the config
  PR/commit message.
- Keep Cutoff+Reso adjacent on the same row wherever they appear (a
  parallel work item draws a filter graphic for adjacent pairs).
- Fix the unreadable pages while you're here: your `short` names replace
  the auto-shortener, so "Wave 1..4"/"Shape 1..4" become e.g.
  `WAV1..WAV4`/`SHP1..SHP4`, "Ctrl to X" → `>CUT`, `>MRPH`, etc.
- chordism has 57 presets via list/count params — **warning:** the
  name-polled preset knob (`nameKey`, `renderStyle: 'preset'`) is built
  only by the generic no-config path in `loadHierarchy`; a `KnobSlot`
  with `render: 'preset'` will show a bare index, not names. Either (a)
  extend the config path minimally so a slot can declare
  `nameKey`/count-param (small, contained addition to the config branch
  of `src/model/hierarchy.ts` + `KnobSlot` in `src/types/param.ts` —
  chunk 1 also edits hierarchy.ts, so pull latest and keep the change
  surgical), or (b) if that turns ugly, keep the preset knob as an
  indexed enum and say so in the commit message. Verify with a logic
  test either way (preset knob present; names shown for option (a)).

### 2. sfz (`sound_generator--sfz.json`) — B4

Auto-layout shows opaque `knob_0..knob_7`; the real named params are all
hidden in chain_params: `attack, decay, sustain, release` (tag them
`env: a/d/s/r` on one row → ADSR graphic), `cutoff, reso` (adjacent),
`tune, gain, octave_transpose, voices, preset, knob_preset`. Keep the
`knob_0..7` macros on a second "Macros" bank (they're the SFZ-defined
per-instrument controls). `preset` here is a filepath-flavored or indexed
param — check `native.params` and wire it the way the dump says it
behaves.

### 3. 303 (`sound_generator--303.json`) — B5

Hidden but core: `waveform` (enum — check options in the dump), `tuning`,
`drive_model`, `devil_mod_switch`. Design 2–3 banks covering the existing
16 shown params + these 4. Keep cutoff+resonance adjacent; the env-ish
params (`attack/decay/env_mod` — check exact keys in the dump) on one
row with `env` tags where they truly are envelope stages.

### 4. chiptune (`sound_generator--chiptune.json`) — B5

10 of 18 params hidden: `chip, alloc_mode, noise_mode, sweep, wavetable,
channel_mask, detune, octave_transpose, pitch_env_depth, pitch_env_speed`.
Two-to-three banks covering all 18 + the preset knob (32 presets).

### 5. mrdrums — extend existing `src/modules/mrdrums.json` (B5)

Add pad-scoped `pad_choke_group` to the appropriate pad bank
(`padSpecific: true` bank; the alias→concrete mapping `pad_*`→`pNN_*`
already exists via `drum.padScoping` — just add the slot). Check the
dump (`sound_generator--mrdrums.json`) for its range/options. Do NOT
expose `ui_*` keys or `g_rand_*` (internal).

### 6. hush1 (`sound_generator--hush1.json`) — B5

23 hidden incl. `pulse_width, pwm_mode, pwm_depth, pwm_env_depth,
lfo_waveform, lfo_trigger, lfo_sync, bend_range, sub_mode, white_noise,
velocity_sens, filter_velocity_sens`. Cover them in sensible banks; put
`lfo_waveform` adjacent to the LFO rate param with `lfo:` tags where
they map onto movy's LFO viz semantics; keep the existing envelope rows
intact (hush1 already auto-detects Amp/Filter envelopes — your config
must reproduce those rows with explicit `env` tags or you'll lose the
graphics).

### Shared requirements

- Register every new config in `src/modules/loader.ts` (alphabetical,
  matching existing style).
- **Logic tests** (`browser-test/logic.mjs`): for each module, add a mock
  to `browser-test/mock-synth.mjs` built from the real dump values
  (`synth_module` key set so the config path engages — see the `mrdrums`
  mock for the pattern) and assert: bank count, a few key slots (label,
  type, range), the chordism `chord_pc_8..11` reachability, sfz ADSR
  env-tags detected (envelope line present in the VM), no duplicate
  on-screen `short` names per page (assert via `vm` shortNames).
- Screenshot scenes for at least chordism "Chord 2" and sfz main bank;
  `node browser-test/screenshot.mjs --update`; existing baselines
  unchanged.
- `cd movy && npm test` green. If `browser-test/dump-replay.mjs` exists,
  update expectations for these six modules (their layouts change from
  auto → config).
- User-facing → `movy/MANUAL.md`: if it lists modules with custom
  layouts, add these; note the chordism Chord Multi fix. Not README
  material.
- Device e2e per movy/CLAUDE.md if reachable — ideally load chordism on
  the device and verify a `chord_pc_9` set round-trips
  (`./scripts/test.sh` + a manual `shadow_set_param` check via the debug
  log). Known wedge at plan time: zero-byte MIDI-inject flood — if CC
  injection is what fails, report DEVICE VERIFICATION BLOCKED in CAPS
  and continue.
- One commit per module config (6 commits), push to main.
