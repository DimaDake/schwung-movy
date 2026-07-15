# Chunk 7 — Per-unit configs via padScoping: signal, forge, krautdrums, weird-dreams (B2, dexed excluded)

Owns: new `src/modules/{signal,forge}.json`, edits to
`src/modules/{krautdrums,weird-dreams}.json` + `src/modules/loader.ts`.
**Start after chunk 6 merges** (same loader.ts). Stretch:
euclidrum/eucalypso lane pages. dexed is explicitly OUT of scope;
minijv/osirus deferred. Run `git -C movy pull` first.

---

## Prompt

You are working in `/Users/dake/git/cld` on **movy** (`movy/` — an
Elektron-style knob UI for Ableton Move with a 32-pad grid). Read
`movy/CLAUDE.md` and the root `CLAUDE.md` and follow their workflow
(local suites, device e2e when reachable, commit + push). Run
`git -C movy pull` first.

Background: movy's drum machinery lets a config declare per-pad params
once via aliases — `drum.padScoping` (`ModuleConfig` in
`src/types/param.ts`: `aliasPrefix` e.g. `"pad_"`,
`concreteKeyTemplate` e.g. `"p{pad}_{suffix}"`, `padDigits`) maps an
alias slot (`pad_vol`) to the focused pad's concrete key (`p03_vol`);
pad presses select the focused unit (`drum.padCount`, `padNoteStart`,
`currentPadParam`; selection logic in `src/model/pad-scope.ts`,
`src/keyboard/drum-handler.ts`; study `src/modules/mrdrums.json` and
`weird-dreams.json` as the two live examples — weird-dreams uses
`cv_`-alias → `v<N>_` unpadded keys, proving non-`pNN` templates work).

`movy/docs/module-dump/` is the ground truth: per-module
`modules/sound_generator--<id>.json` files carry the full native param
table (`native.params`) and current auto-layout (`movy.pages`);
`analysis.hiddenParams` lists what's unreachable today. This chunk =
IMPROVEMENTS.md **B2 minus dexed**.

### 1. signal — new config (52 hidden `vN_` params)

A 13-voice drum-style synth. Hidden per-voice params: `v<N>_attack`,
`v<N>_sub_div`, `v<N>_sweep`, `v<N>_tone_rnd` (×13 voices, unpadded
`v1_`..`v13_` — confirm exact key shape and voice count from
`analysis.hiddenParams` and `native.params` in
`sound_generator--signal.json`). Also confirm from `native.params`
whether shown per-voice aliases already exist (the auto-layout "Patch"/
"Mix" pages — see `movy.pages`). Build a config with:
- global banks reproducing the good parts of the current auto-layout
  (Main/Mix pages);
- a `padSpecific` voice bank exposing the per-voice params via
  `padScoping` (alias prefix of your design, e.g. `v_` if the module has
  current-voice aliases — CHECK `native.params` for existing `v_`-style
  alias keys first; if the module has no alias keys, use the
  `concreteKeyTemplate` direct mapping with movy-side aliases exactly as
  weird-dreams does);
- `drum` block: `padCount` = voice count, `padNoteStart` per the
  module's note mapping (check `module_json`/`native.params` for a
  current-voice or note-base hint; weird-dreams + mrdrums show the two
  conventions), `currentPadParam` if the module exposes one.

### 2. forge — new config (24 `vN_` + kit params, 146 hidden total)

Same treatment: per-voice `v<N>_*` bank via padScoping. From
`analysis.hiddenParams` also restore the musical globals (`morph_src`,
`morph_curve`, `init_decay`, `init_freq`, `rnd_pitch`, `all_mono` …) and
skip the one-shot action params (`copy_a_b`, `copy_b_a`, `swap_ab`,
`rnd_b_from_a` are momentary commands, not knobs — leave them out and
note the skip; if you find a clean pattern for momentary-action slots
already in movy, you may use it, but do not invent a new interaction in
this chunk). Fix the duplicate `KIT`/`MIX` short names on its pages with
explicit `short`s.

### 3. krautdrums — extend existing config (`src/modules/krautdrums.json`)

Add a "Rhythm" bank exposing `rhythm_1`..`rhythm_8` (check types/ranges
in `sound_generator--krautdrums.json`), plus the hidden globals worth
having: `tempo_mode, limiter, delay_type, reverb_type, delay_sync`.
Don't disturb the existing banks (screenshot baselines exist).

### 4. weird-dreams — extend existing config (31-param master/EQ block)

Hidden non-voice params: `comp, dj_filter, eq_lo, eq_mid, eq_hi,
lo_freq, mid_freq, hi_freq, q_lo, q_mid, q_hi, reset_eq, …` (full list in
`analysis.hiddenParams` — everything not `v<N>_`). Add "EQ" and
"Master" banks. `reset_eq` is likely a momentary action — same skip rule
as forge.

### 5. Stretch (only if 1–4 land cleanly): euclidrum + eucalypso lanes

These are **midi_fx** with `lane1_..lane8_` per-lane params (56 and 24
hidden). The pad-scoped machinery currently assumes the synth slot +
drum pads; scoping a *midi_fx* component per-lane may need code changes
in pad-scope/drum-handler (component-key awareness). Timebox: if it's
config-only (verify whether `padScoping` works for `componentKey`
`midi_fx1` — trace `paramIoKey` in `src/model/store.ts`), do it;
otherwise write up what code change is needed in
`movy/plans/dump-improvements/notes-lane-scoping.md` and stop.

### Shared requirements

- Register new configs in `src/modules/loader.ts`.
- **Logic tests** per module (`browser-test/logic.mjs`, mocks in
  `browser-test/mock-synth.mjs` built from real dump values incl.
  concrete per-voice keys like the existing mrdrums mock): pad-scoped
  alias resolves to the focused voice's concrete key
  (`getKnobParamInfo(...).ioKey`), voice switch reseeds values
  (`updateDrumPad` → values re-read), bank counts, no duplicate short
  names per page.
- Screenshot scene for one per-voice bank (signal); baselines via
  `node browser-test/screenshot.mjs --update`; existing krautdrums/
  weird-dreams scenes must only change where you intentionally added
  banks.
- `cd movy && npm test` green. If `browser-test/dump-replay.mjs` exists,
  update expectations for these modules.
- Docs: `movy/MANUAL.md` — extend the drum-modules section (signal/forge
  gain pad-selected voice editing). README bullet only if you judge the
  two new drum modules headline-worthy.
- Device e2e per movy/CLAUDE.md if reachable — for at least signal:
  deploy, load it, press pads, verify focused-voice param writes hit
  `v<N>_*` keys in the debug log. Known wedge at plan time: zero-byte
  MIDI-inject flood — if injection is what fails, report DEVICE
  VERIFICATION BLOCKED in CAPS and continue.
- One commit per module, push to main.
