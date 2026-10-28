# Generators phase 3: learned style, locked loops, Tonnetz, cycles

Follows `2026-10-27-algorithmic-generators-design.md`. The user asked (2026-10-28) to apply ideas from the
generative-MIDI tradition — Markov chains (Subsequence and others), the Turing Machine / Mutable Instruments
Marbles locked loop, neo-Riemannian (Tonnetz) chord moves, Reich / TidalCycles phasing — to "drastically
improve generators quality, variability and creative impact". Approved: phase 1 below.

## Measure first

More randomness scores well on variability and still sounds worse, so the bench (`scripts/gen-bench/algo.mjs`)
gains a **creative** table per task, for the cached Gemini rows and the engine alike:

- **novelty**: `1 - ideaKept` per option — how far the option moved from the source;
- **coherence**: `fit` per option (melodic) — chord tones and colours on strong positions, no clashes.

A change counts as an improvement only if novelty and variability rise while coherence holds (within 0.02 of
before) and the existing gate table keeps passing.

## 1. Learned style (Markov), `src/gen/style/`

A variable-order Markov model learned per request from the part itself plus the track's other clips
(`ctx.loops`), cached per context. Order 0-3 with back-off to a lower order when a context was never seen;
order 0 is smoothed toward neighbouring values so the walk can leave the source's exact vocabulary.

- **Melodic**: two chains. Rhythm: inter-onset interval in steps, conditioned on the previous IOIs and the
  onset's place in the beat. Pitch: the interval in scale steps, conditioned on the previous intervals. Gate
  ratio and velocity are drawn from the source at the same metric strength. Chords (pad, stabs) take only the
  rhythm and sound the source chord under each new onset; the realiser re-voices them over the plan.
- **Drums**: one chain over the set of pads struck on each 16th, conditioned on the step's place in the bar
  (16 / 8 / 4 positions by order) and the previous steps.

The walk is written for a PHRASE (1, 2 or 4 bars, never longer than the target) and repeated, the way a real
part repeats. Every melodic result goes through `over()`, so harmony stays the scene's: strong notes land on
chord or colour tones of the plan and the freedom rule is untouched.

Generators: **STYLE** (melodic, 8 knobs: LIKENESS, PHRASE, DENSITY, HARMONY, CHANGES, TENSION, RANGE, SEED) and
**STYLE** for drums (4: LIKENESS, PHRASE, DENSITY, SEED). LIKENESS 0-10 sets order and temperature: low =
free recombination, high = the source's own phrases. Default 6.

## 2. Locked loop (Turing Machine / Marbles déjà vu), `presets/var-turing.ts`

A register of LOOP clock steps, filled from the source's first steps (onset or rest, scale degree). Each time a
step passes the output it is rewritten with a chance set by LOCK: fully locked replays the source's first steps
as a loop (a polymeter when LOOP does not divide 16), fully open is a new random line. Rewritten steps draw an
onset with DENSITY's bias and a degree within SPREAD; the result is realised over the plan.

Knobs (8): LOCK, LOOP (3 4 5 6 7 8 12 16), CLOCK (1/16 1/8 1/4), SPREAD, DENSITY, HARMONY, TENSION, SEED.
Roles: lead, arpeggio, bass.

## 3. Tonnetz moves, `theory/moves.ts`

The neo-Riemannian transforms move one note of a triad by a step or two: P (C↔Cm), L (C↔Em), R (C↔Am). A
**TURN** move applies one to every second half-bar of a held chord (C C → C Am), so a slow progression gains
motion with two common tones kept. R TURN (0.35), L TURN (0.4), P TURN (0.6, modal mixture). Offered only where
the scene is free, filtered by the connection rule like every move.

## 4. CYCLE rhythms, `shape/rhythm.ts`

RHYTHM gains CYCLE 3, 5, 6 and 7: the source's first N steps repeat every N steps against the 16-step bar and
come back into phase over the loop (Reich's phasing, Tidal's polymeter). Lines repeat their figure's notes,
chords sound the source chord under each onset. Every preset with a RHYTHM knob gets them.

## Phase 2 (not now)

L-system phrase forms (AABA, call and response over 4-8 bars, inside MOTIF / DEVELOP) and Grids-style map
morphing with our own maps (Grids' tables are GPL; movy does not copy them).

## Tests

- Logic: the Tonnetz transforms; the Markov model (deterministic per seed, order 3 on a single source
  reproduces it, order 0 departs from it); CYCLE onsets repeat every N steps; the Turing register at full LOCK
  replays the source's first LOOP steps.
- The existing knob property (every knob of every preset changes an option somewhere, no dead knob) and the
  perf budget (one take per slice ≤ 15 ms) cover the new presets.
- Bench: gates, variability and the creative table before and after.
