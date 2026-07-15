# Chunk 2 — On-screen short-name dedup overhaul (C2)

Owns: `src/renderer/shorten.ts` (+ tests, screenshot baselines).
Independent of all other chunks. Wave 1.

---

## Prompt

You are working in `/Users/dake/git/cld` on **movy** (`movy/` — an
Elektron-style knob UI for Ableton Move; 128×64 screen, 8 knobs, labels
truncated to 5 chars). Read `movy/CLAUDE.md` and the root `CLAUDE.md`
first and follow their workflow (local suites, device e2e when reachable,
commit + push, 200-line file limit). Run `git -C movy pull` before
starting.

Background: `movy/docs/module-dump/SUMMARY.md` (Anomalies section) lists
**19 pages across 15 modules** whose on-screen knob names collide after
shortening. The shortener is `dedupShortNames()` in
`movy/src/renderer/shorten.ts` (pure function, called from
`src/model/viewmodel.ts` with `maxChars = 5`). This chunk is
IMPROVEMENTS.md **C2**.

### The two defects (with real data)

Reproduce each from the dump before fixing — the per-module layout files
(`docs/module-dump/modules/<category>--<id>.json`, `movy.pages[].rows`)
show the exact `shortName(fullName)` pairs rendered today.

1. **No fixed-point iteration.** The dedup strips the common word prefix
   from a colliding group, but never re-checks the result:
   - chordism Delay page: "Delay Tone Hi"/"Delay Tone Lo" → both `TONE`;
     "Delay Mod Rate"/"Delay Mod Depth" → both `MOD`.
   - chordism Ctrl Src page: "Ctrl to Cutoff/Morph/Vibrato/Shape" → all
     `TO` (prefix `CTRL ` stripped, then `autoShorten("TO CUTOFF")`
     returns its ≤5-char first word `TO`).

2. **Context-free suffixes.** When the stripped suffix is tiny, all
   context disappears — and two *different* groups can collapse to
   identical names:
   - chordism Oscillators page: "Wave 1..4" → `1 2 3 4` and
     "Shape 1..4" → `1 2 3 4`; the page renders as two identical rows of
     bare digits.

Other affected pages to use as test material: surge "Oscillator 1/2/3"
(`WIDTH`×2), surge "Amp Envelope" (`DECAY`×2), palette (all 4 pages:
`AMOUN`/`MACRO`/`DRIFT`), fizzik Mod page (`RATE`/`DEPTH`/`SHAPE`/
`TARGE`), denis Mat pages (`ENV->`, `LFO->`), signal Mix (`LEVEL`,
`FREQ`), obxd "LFO Dest", osirus "LFO 2", eucalypso Main (`ON`),
euclidrum Global (`PRESE`), mrsample Sample (`START`), usefulity
(`MONO`), spectra, structor, magneto, minijv, forge, clap, chordism
Morph (`MORPH`×4!).

### Required behaviour

Rework `dedupShortNames` (keep it a pure function, same signature, same
file) so that for every page:

- **No two non-null entries on a page share a shortName** unless their
  full labels are genuinely identical.
- **Iterate to a fixed point:** after prefix-stripping, re-detect
  collisions and resolve again (bounded, e.g. 3 passes, then last-resort
  disambiguation below).
- **Short suffixes keep compressed context:** when a stripped suffix is
  ≤ 2 chars, prepend a compressed form of the stripped prefix's last word
  (e.g. "Wave 1" in a WAVE-group → `WAV1`, "Shape 3" → `SHP3`, "FM
  Amount 2" → `FM A2`-style is fine too — pick one rule, apply it
  consistently, and encode it in tests). Compression: consonant-skeleton
  or truncation, your choice, but deterministic.
- **Persisting collisions** (identical suffixes, e.g. "Delay Mod Rate" vs
  "Delay Mod Depth" after one strip → `RATE`/`DEPTH` is fine, but
  `MOD`/`MOD` is not): resolve by shortening the *joined remaining words*
  (`TONEH`/`TONEL` for Tone Hi/Lo) rather than the first word only.
- **Explicit `shortLabel`s from module configs are never altered** (the
  existing guard).
- Result strings must stay ≤ `maxChars` and non-empty for non-null
  entries.

`autoShorten` and `enumSquareLines` are used elsewhere — don't change
their behaviour for non-colliding cases; existing baselines with
non-colliding labels must not shift.

### Tests & verification

- Add a dedicated logic-test block in `movy/browser-test/logic.mjs`
  driving `dedupShortNames` directly (import from
  `dist/esm/renderer/shorten.js`) with the real label sets above
  (chordism Oscillators, Delay, Ctrl Src, Morph; surge Amp Envelope;
  palette Main). Assert: pairwise uniqueness + specific expected names
  for the chordism Oscillators page (encode your chosen rule).
- A page-level assertion through the model: boot a mock synth (add one to
  `browser-test/mock-synth.mjs`) with "Wave 1..4"/"Shape 1..4" labels and
  assert `vm` shortNames are unique.
- Rendering changed → run `node browser-test/screenshot.mjs`; if any
  baseline legitimately changes, regenerate (`--update`) and eyeball the
  diffs. Add one new screenshot scene showing a previously-colliding page
  if no existing scene covers it.
- `cd movy && npm test` green. If `browser-test/dump-replay.mjs` exists,
  run it and update expectations for pages whose names you fixed.
- Device e2e per movy/CLAUDE.md if reachable (known wedge at plan time:
  zero-byte MIDI flood blocks CC injection — if that's what fails, report
  DEVICE VERIFICATION BLOCKED in CAPS and continue).
- Not headline, but user-visible: one line in `movy/MANUAL.md` if it
  documents label shortening; otherwise skip docs.
- Commit + push to main.
