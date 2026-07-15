# Chunk 5 — Preset browser overlay for name-polled presets (C3)

Owns: `src/renderer/overlay.ts`, overlay open/commit flow in
`src/model/index.ts` (+ `src/model/state.ts` overlay state,
`src/types/viewmodel.ts` OverlayState). Independent of other chunks
(chunk 1 owns hierarchy.ts; coordinate only if you also need a hierarchy
change — you shouldn't). Wave 1. Run `git -C movy pull` first.

---

## Prompt

You are working in `/Users/dake/git/cld` on **movy** (`movy/` — an
Elektron-style knob UI for Ableton Move; 128×64 1-bit screen). Read
`movy/CLAUDE.md` and the root `CLAUDE.md` and follow their workflow
(local suites, screenshot baselines, device e2e when reachable, commit +
push, 200-line file limit, model never draws / renderer stateless). Run
`git -C movy pull` first.

Background — the problem (IMPROVEMENTS.md **C3** in
`movy/docs/module-dump/`): preset params come in two flavors from
`loadHierarchy` (`src/model/hierarchy.ts`):

1. with an `options` array (all names known) → knob-touch opens the
   scrollable enum overlay (`handleKnobTouch` in `src/model/index.ts`
   requires `p.options.length > 6`; drawn by `drawEnumOverlay` in
   `src/renderer/overlay.ts`);
2. **name-polled** (`options: null`, `nameKey` set — the current name is
   polled from the module's `name_param`; `renderStyle: 'preset'`). These
   get NO overlay: the only way through the list is turning the knob at
   `ENUM_DELTA_DIV = 4` detents per step.

Dump evidence (all name-polled): `minijv` **2 427** presets (≈ 9 700
detents for a full sweep), `surge` 675, `clap` 509, `obxd` 128, plus
hera 56, chordism 57, midiverb 64, chiptune 32, dexed 32, moog 14,
nusaw 27, hush1 11, braids 10, dragonfly-hall 25, impressive-chords 52
(see the PRESET KNOBS list in `docs/module-dump/IMPROVEMENTS.md` § C3 and
per-module `presets` blocks in `docs/module-dump/modules/*.json` — note
which modules the device capture shows `preset_name_0`-style per-index
keys for, visible as `preset_name_*` entries in the module's `params`
map in `device-dump.json`).

### What to build

A paged preset overlay for name-polled preset params:

- **Open/commit/cancel** exactly like the enum overlay: knob touch opens
  (for `renderStyle === 'preset'` with `nameKey` and `max - min > 6`),
  turning that knob scrolls the selection with the existing fractional
  accumulator (`accumStep`), release commits (writes the *index* via
  `shadow_set_param`, same value format the knob path uses today),
  touching another knob cancels/commits per existing enum-overlay
  semantics. Reuse the existing overlay state-machine shape in
  `src/model/state.ts`/`index.ts` (add a variant or a parallel
  `presetOverlay` state — pick whichever keeps files under the limit).
- **Name window polling:** the overlay shows a window of ~5 rows. For the
  visible window only, poll names per index via
  `shadow_get_param(slot, ck + ':preset_name_' + i)` (strategy already
  used by `loadHierarchy`), cached in a `Map<number,string>` in model
  state so re-showing a row does no IPC. If the module does not answer
  `preset_name_0` (probe once on open), fall back to showing `#<index>`
  for non-current rows and the polled current name (`nameKey`) for the
  selected row. **Poll at most the window size per tick** — never the
  whole list (minijv has 2 427; memory and IPC budgets matter; see the
  perf suite).
- **Turn acceleration:** with hundreds of presets, 4-detents-per-step is
  unusable. While the overlay is open, scale steps by turn velocity:
  consecutive deltas within a short tick window multiply the step (e.g.
  ×1 → ×4 → ×16 caps at list-size/20). Implement in the model
  (`handleKnobDelta` overlay branch), deterministic and unit-testable
  (drive tick + delta sequences in tests; the device tick rate is ~205 Hz
  — use tick counts, not wall time).
- **Rendering:** extend `src/renderer/overlay.ts` (or a sibling file if
  it would exceed 200 lines) — same visual language as the enum overlay
  (inverted selected row, scroll position indicator). Show
  `index/total` in a corner so users know where they are in 2 427.

Do not change flavor 1 (options-array enums) behaviour or visuals.

### Tests, docs, verification

- Logic tests (`browser-test/logic.mjs`; add a name-polled preset mock to
  `browser-test/mock-synth.mjs` that answers `preset_name_<i>` and one
  that doesn't): open-on-touch, window polling bounded (count
  `shadow_get_param` calls via a wrapper — assert ≤ window per tick),
  cache hit on revisit, fallback labels, acceleration curve (delta
  sequence → expected index jumps), commit writes correct index format,
  cancel restores.
- Screenshot scene(s) for the preset overlay (mid-list, showing
  index/total); `node browser-test/screenshot.mjs --update` for new
  baselines only — existing enum-overlay scenes must not change.
  `node browser-test/perf.mjs` green (overlay polling must not regress
  IPC counts for normal pages).
- `cd movy && npm test` green. If `browser-test/dump-replay.mjs` exists,
  run it (layouts shouldn't change — this chunk is interaction-only).
- User-facing feature → `movy/MANUAL.md`: preset overlay section +
  Controls reference row (touch preset knob → overlay; turn = scroll with
  acceleration; release = load). Doc asset via
  `node scripts/make-doc-assets.mjs <baseline>`. Headline-worthy →
  one Features bullet in `movy/README.md`.
- Device e2e per movy/CLAUDE.md if reachable — this chunk really wants a
  manual-ish device check against minijv (2 427 presets) via
  `./scripts/test.sh` plus a log-verified overlay open (inject knob-touch
  note + turns with `../schwung-midi-inject-ui.py`). Known wedge at plan
  time: zero-byte MIDI-inject flood — if CCs don't arrive at all, report
  DEVICE VERIFICATION BLOCKED in CAPS and continue.
- Commit in reviewable steps (model state+accel, polling, renderer,
  docs), push to main.
