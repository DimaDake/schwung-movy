# Generator audition app — design (2026-11-07)

## Intent

Improve the generators by putting the user's ear in the loop. Six bench rounds
(`2026-11-07-generation-paths-bench.md`) tuned against P10–P90 bands of real
scenes; several "faults" were the metric's, and nothing yet says what the user
would KEEP. The app lets the user listen through generated cases on the phone,
rate them, point at what is wrong, and turns every rating into (a) a concrete
fix lead per generator and (b) a permanent regression gate on the benches.

Success: after each listening session, an "act on ratings" round fixes the
generators the user marked worst, the next batch opens with before/after of
the flagged cases, and the bench reports how many of the user's Bads are still
bad and how many Keeps a change broke.

## Goals

- Phone-first, one-handed, private web page: a claude.ai Artifact (user's choice).
- Endless queue of cases, weighted **50% option sets / 30% bench-flagged /
  20% blind pairs** (user's choice), stratified so every generator appears early.
- Ratings stored where Claude can read them without the user exporting anything.
- Every rated case reproducible from the repo (seed + generator + knobs + scene).

## Non-goals

- Not the device keep-logging (separate later item; it validates in real use).
- Not a sound-design tool: fixed simple voices, judge notes not patches.
- No automatic generator changes: fixes happen in rounds on request.

## Anti-goals (a failure even if it works)

- Ratings that cannot be traced to a generator, its knobs and a location in
  the clip — "Bad" with no lead is useless.
- A queue dominated by one generator or one case kind.
- Sound so different from the Move that judgements invert (mitigated: per-case
  MIDI export to play on the Move).
- Slow on mobile: first case must play within ~2 s on phone data.

## Decided by the user

| topic | decision |
|---|---|
| hosting | claude.ai Artifact, ratings in its shared database |
| sound | simple WebAudio voices per role |
| case kinds | option sets (the six), bench-flagged, blind gen-vs-real |
| blind refs | equal mix: user's 151 scenes and 143 public MidiCaps scenes |
| rating | Keep / Meh / Bad; Bad opens reason chips |
| reveal | after rating: real/generated, generator + knobs, bench verdict; disagreement highlighted |
| batch | endless shuffled queue |
| fix loop | on request ("act on ratings"), in rounds; next batch leads with before/after |
| controls | solo part under test, mute per track, tempo slider, note-roll view |
| additions | weighted queue 50/30/20; tap the fault location on the roll; rated cases become a regression gate |

## Case kinds

1. **Option set** — one press of New Clip / Variation / Smart Double / Smart
   Quantize in a scene (from `paths.mjs`, `chains.mjs`, `keep.mjs`). Six
   options, swipe between them; star the best (optional), rate each Keep /
   Meh / Bad. Answers "what would I keep from one press".
2. **Bench-flagged** — cases the metrics call broken or borderline (usable
   fails, order-gap cases, layers misses), worst first within the stratum.
   Answers "real fault or metric artefact".
3. **Blind pair** — a real scene from `refs.json` with one part either the
   real part or New Clip's leave-one-out regeneration (`loo.mjs`). The user
   does not know which. Calibrates "usable" against the ear.

## The page

- Top: case kind, scene key/tempo, track chips (tap = mute, the part under
  test marked). Hold a "solo" button to hear the part under test alone.
- Middle: note roll of the scene (one lane per track, part under test
  highlighted), playhead. Tap a bar/beat on the roll to mark the fault place
  (one or more marks; marks are optional but encouraged on Bad).
- Bottom: Keep / Meh / Bad. Bad opens chips: clash, too busy, too sparse,
  off-groove, boring, wrong register, doesn't fit scene, other (+ optional
  short text). Then the reveal card; Next.
- Tempo slider (scene's tempo; 120 when none). Loops the scene until Next.
- Progress: rated count per kind; resume where left off.
- "Play on Move": link to the case's MIDI file.

## Sound

WebAudio, synthesised, no samples: kick/snare/hats/perc voices for the drum
track (pads mapped by the drum role table), bass (saw+sine, low-pass), chords
(soft pad, polyphonic), lead (pluck). Part under test slightly louder. Look-
ahead scheduler (~100 ms) so playback is stable on mobile; audio unlocked on
the first tap.

## Data

- **Exporter** `scripts/gen-bench/audition/export.mjs` (new): runs the
  existing benches' builders against `dist/esm` (as the benches do) and writes
  case files: per case `{ id, kind, generator, knobs, seed, scene: { key, bpm,
  steps, tracks: [{ role, notes: [[tick, gate, pitch, vel]] }] }, target,
  options?: [...], truth? (blind), bench: { verdict, outMetrics } }`. Notes in
  16th-step ticks, compact arrays. Case ids are stable hashes of the inputs
  so a re-export keeps ratings attached.
- Cases are split into files of a few hundred so the page loads the first
  file fast and fetches more as the queue runs; the full pool is a few
  thousand cases (3,004 MIDI files exist today).
- **Ratings** in the Artifact database: one document per rating `{ caseId,
  build, option?, rating, reasons[], marks[{bar, beat}], text?, at }`. `build`
  is the export's label (git sha) so before/after are told apart.

## The fix loop ("act on ratings")

1. Pull ratings (ArtifactData), join with the case files.
2. Report per generator: Keep/Meh/Bad share, top reasons, marked places, and
   ear-vs-bench disagreement (bench usable + user Bad; bench out + user Keep).
3. Read the rolls at the marked places, fix generators (or the metric), as in
   the bench rounds.
4. **Regression gate**: a new bench `audition-run.mjs` re-generates every rated
   generated case at the current build: "user Bads now changed / still same",
   "user Keeps changed" (a changed Keep is listed for re-listening, not failed
   outright, since a different take can also be good).
5. Re-export; the next batch begins with before/after of the cases fixed.

## Constraints

- Artifact page ≤ 16 MB; case files as separate published files.
- Artifact rules: scripts only from the allowed CDNs, exact versions; works at
  phone width; light/dark tokens.
- Bench code stays under `scripts/gen-bench/`; files ≤ 200 lines (src rule
  applies loosely to scripts too — keep them small).
- Private data: user scenes go only into the private artifact.

## Left to the builder

- Exact visual design, voice tuning, chip wording, roll rendering details.
- Stratification algorithm and how "worst first" is scored within flagged.
- How many cases per file; whether the exporter reuses run outputs or calls
  the builders directly (prefer calling builders: stable ids, full metadata).
