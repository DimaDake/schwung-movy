# Chunk 1 — Generic hierarchy fixes (C1 + B1 + C4)

Owns: `src/model/hierarchy.ts` (+ its tests). Independent of all other
chunks. Wave 1.

---

## Prompt

You are working in `/Users/dake/git/cld` on **movy** (`movy/` — an
Elektron-style knob UI + sequencer for Ableton Move, running as a Schwung
tool). Read `movy/CLAUDE.md` and the root `CLAUDE.md` first and follow
their workflow exactly (local test suites, device e2e when reachable,
commit + push at the end, 200-line file limit, model/renderer boundaries).
Run `git -C movy pull` before starting.

Background: `movy/docs/module-dump/` contains a live capture of all 76
modules installed on the device — per-module native params + the exact
layout movy computes (`modules/<category>--<id>.json`), an anomaly index
(`SUMMARY.md`), and an analysis (`IMPROVEMENTS.md`). This chunk implements
IMPROVEMENTS.md **C1, B1, C4** — three fixes to the generic layout builder
`loadHierarchy()` in `movy/src/model/hierarchy.ts`.

### Fix 1 (C1): preset knob duplicated on two pages

When a module's root level has ≥ 8 knobs and declares
`list_param`/`count_param`, `loadHierarchy` adds a dedicated "Preset" page
(`presetSeparate`). But if the module *also* lists the preset key inside
`root.knobs`, the key stays in `rootKeys` and the preset knob renders a
second time on "Main - 1".

Evidence: `docs/module-dump/modules/midi_fx--impressive-chords.json` and
`sound_generator--breakbeat.json` — pages are
`[Preset] Preset … [Main - 1] Preset, …`.

Fix: when the separate Preset page is added, filter `listParam` out of
`rootKeys`. Add a logic test in `movy/browser-test/logic.mjs` using a new
mock in `browser-test/mock-synth.mjs` (root with 8+ knobs where one knob
key equals `list_param`); assert the preset key appears exactly once
across all pages.

### Fix 2 (B1): modules with chain_params but no ui_hierarchy show nothing

Three installed modules publish `chain_params` but no `ui_hierarchy`, and
the generic path bails without a hierarchy — their param pages are empty:
`branchage` (27 params), `smack-in` (20), `belt-in` (16). See
`docs/module-dump/modules/midi_fx--branchage.json`,
`sound_generator--smack-in.json`, `sound_generator--belt-in.json` for the
real chain_params these modules expose (names, types, ranges, enums).

Fix: in the generic no-config path, when `ui_hierarchy` is null/empty but
`chain_params` parsed to a non-empty array, build pages directly from the
chain_params order (8 per page via the existing `addLevel('Main', keys)`
helper), using each entry's `name/type/min/max/step/options` metadata.
Skip entries whose key starts with `ui_` (internal UI state). Filepath
entries must still become `type:'file'` knobs (the orphan-filepath
injection already does this — make sure the fallback doesn't double-add
them). Add logic tests: a mock with chain_params only (mixed float/enum/
filepath) asserting page count, labels, types, ranges; and assert the
existing hierarchy-driven mocks are unaffected.

### Fix 3 (C4): metadata-less params get guessed 0..1 float ranges

When a knob key has no `chain_params` entry **and** no inline hierarchy
metadata, movy guesses `float 0..1 step 0.02` and formats values as `%`.
Real casualties (see `analysis.noMetadata` in the dump files):
`impressive-chords` (16 params: base_note, transpose, retrig, choke …),
`clap` (plugin_index, param_6, param_7), `sfz` (knob_0..7).

Implement first-read inference, mirroring how the enum layer learns its
exchange format (`enumFmtFor` in `src/model/store.ts` — learned once per
param, cached in state): for a *guessed* param (add a `metaGuessed: true`
flag on `KnobParam` when the fallback triggered), on the first successful
value read (`refreshKnobValues`/`applyKnobDelta` seed path):

- if the raw string parses as an integer and |value| > 1 → switch the
  param to `type:'int'`, `step: 1`, and widen `min`/`max` to at least
  contain the value (use symmetric bounds for negatives, e.g. value −24 →
  min −24 … max 24; value 30 → 0 … 127 is NOT assumed — widen to the
  smallest power-of-two-ish bound ≥ value, document the chosen rule in a
  comment);
- if it parses as a float in [0,1] → keep the guess.

Keep the inference in one small pure helper (new file
`src/model/meta-infer.ts`, ≤ 50 lines) with direct unit tests in
`logic.mjs`, and make sure `automatable` and value normalization
(`normalizedValue` in the viewmodel) stay consistent after the switch.
This is a heuristic — do not apply it to params that have real metadata.

### Verification & handoff

- `cd movy && npm test` — all four suites green; add the new logic tests
  described above (they must fail before each fix, pass after).
- If `browser-test/dump-replay.mjs` exists (a parallel chunk may have
  added it), run it; update its expectations file for the layouts you
  intentionally changed (branchage/smack-in/belt-in gain pages;
  impressive-chords/breakbeat lose the duplicate preset).
- Device e2e per movy/CLAUDE.md if reachable. Known issue at plan time:
  the device MIDI-inject channel was wedged (zero-byte MIDI flood) — if
  knob-CC checks fail that way, report DEVICE VERIFICATION BLOCKED in CAPS
  and continue.
- User-facing behaviour changed (three dead modules gain param pages) →
  add a short note to `movy/MANUAL.md` where module param pages are
  described. No README change (not a headline feature).
- Commit per fix (three commits), push to main.
