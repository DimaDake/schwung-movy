# Generator quality metrics

2026-10-29. What the user asked for: every knob, and every position of it,
makes a meaningful change while the result stays musical (experimental
sometimes is fine), and the generators together can build a real piece from
nothing or from a few notes. Optimise the new metrics where it is meaningful,
without regressing the old ones; think as a product owner, not as an optimiser.

The older bench (`scripts/gen-bench/algo.mjs`, `plans/2026-10-27-generators-quality-design.md`)
scored options at their **default** knobs only, one track at a time. Nothing
turned a knob, and nothing listened to the tracks together.

## How to run

```bash
npm run build:browser
node scripts/gen-bench/quality/run.mjs --label <name> [--compare base] [--cases <substring>] [--pieces 12]
```

About 8 s for the 42 bench cases. Writes `.gen-data/quality/<label>.json`,
`plans/gen-quality-<label>.md` (a scorecard with a better / same / **REGRESSED**
verdict per row when `--compare` is given) and every piece as a MIDI file under
`.gen-data/pieces/<label>/` (A A B B A', drums on channel 10) for listening.

## One verdict for all three methods

`quality/musical.mjs` judges a part where it will play:

| verdict | melodic | drums |
| --- | --- | --- |
| **broken** | empty; more than 16 onsets a bar; median outside 28..100; chord fit < 0.55; more than 25% of strong-beat notes rub against the band | more than 32 hits a bar |
| **experimental** | fit < 0.72; rub 10-25%; span over three octaves; an empty bar | no downbeat; under 2 or over 24 hits a bar; an empty bar |
| **musical** | everything else | everything else |
| **refused** | the guard refused every roll: the screen keeps what it had, so the turn was a dead click, not a broken sound | same |

**Calibration of "rub".** A rub is a minor second or minor ninth (or two
octaves and a semitone) against a note another track holds on a strong beat.
Measured on the corpus's real parts against their own scenes, the first
definition (pitch-class 1 or 11) flagged one real part fully: a major seventh,
a maj7 chord's own colour. With the interval taken as played, real parts rub
**0%** (23 parts: median 0, p90 0, max 0). That is what the thresholds stand on.

## Method 1: the knob sweep (`quality/sweep.mjs`)

For every request in the bench (each case's own task, a Smart Double of its
clip, a New Clip in its slot) and every generator that serves it, each live
knob is turned through all its positions (12 sampled for SEED), the others at
default. Hidden knobs (`live.ts`) are skipped: the screen does not show them.

- **dead click**: the take did not change, or the guard refused it.
- **cliff**: on a continuous knob, one click rewrote more than 80% of the part.
- **promise kept**: what the knob's name promises rises with it (Spearman ≥ 0.5):
  DENSITY onsets, LENGTH and GATE note length, RANGE span, TENSION non-chord
  share, PITCH FIX wrong notes (falling), DYNAMICS velocity following the metre,
  SWING the shift from SWING 0, TIMING distance from the grid (falling), HUMAN
  that distance (rising), AMOUNT distance from the source, LIKENESS (falling),
  DRIFT and VARY distance from their own position 0, GHOSTS hits.
- **duplicate knobs**: two knobs whose two ends give the same two takes.
- the verdict at every position.

## Method 2: the knob space (`quality/space.mjs`)

Twelve random knob states per generator and request, plus every one-click
neighbour of the default. The shares of musical, experimental, broken and
refused, and whether the default sits inside the musical region.

## Method 4: the piece (`quality/piece.mjs`, `piece-score.mjs`)

A scripted user, twelve seeds, in eight keys, two ways: **from scratch**, and
**around a motif** (four notes in one bar, on the lead track, as a user would
play them). Scene A: New Clip drums, bass, chords, lead in that order (the
lead is the motif in the second mode). Scene B: Variation, track by track,
taking whichever of the options the seed points at, since any option offered
must be one a user could keep. Scene A': each A clip copied and Smart Doubled,
track by track.

Judged with the bench's own scorer, not the generators' plans, so no
generator grades its own work: the scene's chords are what its tracks sound
(`sceneChords`). Per scene: the worst part's strong-beat rub, the chord fit,
**mud** (two melodic parts with medians under 52). Across scenes: role
breaks and B copies by the product's own rules (`roleBreak`, `isSameLoop`),
the A-to-B distance, and the chords A' moves through.

## The old metrics, side by side

Alignment, gate, played-drum gate, Variation's best-of-six gate, Variation
novelty and coherence, Smart Double's first part kept / ending novelty /
coherence, New Clip's meaningful / coherence / with-band, read from the
older bench's own functions.

## What the numbers said, and what was done

Baseline = the code before this work, measured with the final metric
definitions. Final = after the changes below.

| metric | base | final |
| --- | --- | --- |
| knobs: dead clicks | 20% | 16% |
| knobs: duplicate knob pairs | 21 | 5 |
| knobs: promise kept | 86% | 88% |
| space: musical | 80% | 84% |
| space: default musical | 85% | 87% |
| piece: musical | 17% | 79% |
| piece: broken | 21% | 4% |
| piece: strong-beat rub | 6% | 1% |
| piece: low-end mud scenes | 11 | 1 |
| old: alignment / gate / played gate | 0.64 / 88% / 100% | 0.63 / 88% / 100% |
| old: Variation novelty / coherence | 0.66 / 0.91 | 0.67 / 0.92 |
| old: New Clip with band | 0.65 | 0.68 |

Every older-bench gate still passes (`algo.mjs`: alignment 0.63, quantize
recovery 0.90, variation alignment 0.37, gate 88%, played-drum gate 100%).

Each fix answers a musical fault found by listening to the numbers, not a
number on its own:

1. **Chords sat on the bass.** New Clip's LOW register was a fixed centre
   (55); in some keys the chords' median fell under the bass line's. Now the
   lowest voice keeps a fifth over the band's bass line (`shape/band-pitch.ts`
   `chordFloor`), in every REGISTER.
2. **A chord part sank.** With HARMONY on ROOTS or INVERSION, or RANGE open,
   each chord was led from the last one's dropped root or spread voice, so a
   long pad slid down every bar (to E0 in a bench piece). The realiser now
   leads from the voice-led chord and folds every voice into the RANGE window
   (`realise/chords.ts`).
3. **Parts rubbed against the band.** New Clip around a motif, and a B section
   built track by track, struck semitones against notes other tracks held. One
   pass (`clearRubs`, run in `generate.ts` for New Clip, Variation and the new
   notes of a Smart Double) moves a chord voice an octave, or a line's note to
   the nearest chord tone that does not rub. A note rubs with what is held as
   it starts on a strong beat, and with what the band strikes on a strong beat
   while it still sounds. A clip shorter than its scene is checked on every bar
   it loops under, including notes held across the loop point. Smart Quantize
   is untouched: it fixes the player's notes, not the band's. So are
   generators that place a note on purpose (`ownPitches`: TURNAROUND's
   CHROMATIC approach, CADENCE landing on the tonic over V7): moving those
   would make the knob lie. They are the 1% of rub left in the pieces.
4. **TENSION's clicks were dead** (84%): four thresholds, and the realiser only
   moved notes already off the chord. It is now a dial centred on 5
   (`shape/tension.ts`): up turns more chord tones into colour tones, weak beats
   first; down takes outside notes back onto chord tones. Positions are nested.
   Its promise is kept 94% of the time (was 38%).
5. **PITCH FIX's clicks were dead** (84%): a bar over eight fit levels on a take
   with a few wrong notes. It is now a count, worst first, onto chord tones, with
   one position per fixable note (up to 10) and `ALL` at the end; its default
   fixes what the old default did. Promise kept 87% (was 5%).
6. **VARY and DRIFT skipped clicks on short parts**: a fraction n/10 of a few
   notes rounds to the same count. Both now vary at least one more note per
   click. VARY also draws its choices per note, so positions nest, and falls
   through to a change that can apply (a push onto a taken step did nothing).
7. **A Smart Double broke its part's role** (a RUN flooding a sparse lead with
   16ths). Its guard now applies the role rule Variation already had.

## Corrected rather than optimised

Some first readings were the metric's fault, not the generators'. They were
fixed in the bench and the baseline re-measured with them.

- **DYNAMICS** was read as velocity spread; the knob makes velocity follow the
  metre, which can narrow the spread. The promise is now that covariance.
- **SWING** was read on odd 16ths only; a part with no 16ths swings its 8ths.
  The promise is now the shift from SWING 0.
- **Role breaks** were read from the role classifier's labels: a pad whose
  notes got a step shorter read as "stabs". They now use `roleBreak`, the rule
  the product enforces. **Copies** likewise use `isSameLoop` instead of an
  arbitrary distance (a B that changes only the kick is a legitimate B).

## Left alone, on purpose

- **TENSION below 5** on a part that is already all chord tones has nothing to
  do. Making those clicks "move" would mean inventing a new meaning for less
  tension (open fifths?), which is a product decision, not a fix.
- **AMOUNT, RANGE, DENSITY** still have 35-51% dead clicks, for the same
  reason VARY had (a fraction of a few notes). Same remedy where it fits; not
  done here, to keep each change one that was listened to.
- **LIKENESS** keeps its promise 24-66% of the time per generator. It needs a
  look at the Markov walk itself.
- **One piece of 24 still breaks**: a scripted B where the bass moved
  the harmony and the chords did not follow (fit 0.51 by the bar-level scorer).
  Tuning for one seed would be fitting the bench.
- Pieces vary with seeds; ±1 piece (4%) between runs of different code is noise.

## Tests

`browser-test/logic/gen-quality.mjs`: each fix above, with the bench's pure parts
(rub, refused verdict, sampling, Spearman, MIDI round trip). Each test was
proven by putting its fix back and watching it fail; the chord-sink test fails
on the original `realise/chords.ts`.

## Round 2: ranges and positions (2026-10-29)

User: "increase parameter ranges everywhere where it is musical (octaves
especially), and make more positions where they can meaningfully change
something"; "basic ranges as we measured and agreed before; extended ranges
add more experimental flavour"; "experimental is still musical".

So the rule: a take (New Clip's roll, a default) stays inside the measured
range; the new positions sit past it, and may be experimental, never broken.
Two numbers were added to the sweep: **useful clicks** (clicks that change the
take) and **register reach** (how far a register-type knob moves the part's
median, end to end).

**Metric correction first.** A melodic part over 16 onsets a bar read as
broken, so every 1/16T arp (24 a bar, a trance staple) was "broken". Now over
16 is experimental (`busy`), over 24 broken. The base was re-measured with it
(`base40`, 40 pieces a mode, since 12 moves ±1 piece on any change: a
different scene A shows the scripted user different B options).

| metric | base40 | ext40 |
| --- | --- | --- |
| useful clicks | 44377 | 45822 |
| register reach | 9.4 st | 16.7 st |
| dead clicks / broken positions | 16% / 1% | 16% / 1% |
| space: musical | 84% | 82% (the new ends are experimental) |
| piece: broken / mud scenes | 5% / 5 | 3% / 3 |
| old bench | | all same; variation best-of-six gate 72% → 78% |

What changed, and why each is a musical step:

- **Chord REGISTER** (CHORDS, PAD, STABS): 3 → 9 positions. A centre moved by
  a few semitones gave the same voicing more often than not (51% dead), so a
  position is now an inversion: position i opens on the chord's i-th tone up
  from E2 (LOW, MID, HIGH open where their centres did). 8% dead, reach 28 st.
  Under the band's floor the low positions meet: the chord never goes under
  the bass.
- **Line REGISTER** (RIFF, COUNTER) adds an octave each way. Lines step by
  octaves: between them only some notes would fold.
- **BASS OCTAVE** adds DEEP and HIGH. A SUB position was tried and dropped:
  its median fell under E1 (the bench's register floor).
- **ARP**: OCTAVES 1-4 in half octaves (the old 0 and 1 were the same, 33%
  dead; now 0%), a tall arp starts lower so its top stays under A6; RATE adds
  1/4 and is ordered slowest to fastest.
- **MELODY RANGE**, **VOICES**, **PAD SPREAD**, **Variation ARP OCTAVES**,
  **REGISTER INTERVAL** (±2 octaves) extended.
- **RANGE** adds X2.5 and X3.0, and its clicks are heard: the line realiser
  let the mapped chord tone win within 3 semitones of the scaled interval, so
  RANGE moved nothing until it was large. That tolerance now shrinks to 0 at
  X1.4 / X0.7. RANGE dead clicks fell 7-20 points per generator.

Tried and reverted: **PULSE OCTAVE** past an octave. The role lock refuses a
variation that moves a part's middle more than an octave, so those positions
could only ever be refused; and -1 OCT on a bass fell under E1.

## Round 3: more harmony (2026-10-29)

User: "more harmony options for chord generators on new scenes; apply the new
functionality generically to all generators where possible".

- New Clip (`create/plans.ts`): four more diatonic loops per mode after the
  first eight (so every old position keeps its meaning), in the take pool;
  five borrowed / modal progressions at the end, `HarmonyPlan.ext`, which
  `runPlan` never draws and `defaultHarmony` never lands on. Free major:
  8 → 17 options.
- Generic, every free-scene HARMONY: `harmonicMoves` no longer drops a move
  that is WILD's own or connects below `DROP_BELOW`; it appends it, `ext`,
  after the rest (Variation's HARMONY, Smart Double EVOLVE's MOVE). `journey`
  (+DEV) skips them, EVOLVE is only offered when a non-ext move exists.
- Generic, every line that walks the scale: `scaleUnder(key, chord)` lends a
  borrowed chord's foreign tone and drops the scale tone a semitone from it
  (a major chord's major 7th stays: it is colour). Used by `allowedPcs`
  (every Variation through the realiser) and New Clip's MELODY, RIFF, COUNTER.
- Bench (40 pieces a mode, vs ext40): no regression; useful clicks +168;
  HARMONY positions on New Clip broken 0 of 270.
