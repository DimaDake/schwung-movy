# Smart Double: Shift + hold Step 15

User, 2026-10-28: "add algorithmic generator for doubling clip length. It should use the same shortcut but holding it
(like other generators). It should keep the first part mostly untouched. Only the ending can be affected by modifying
the connection notes. It should be distinctive from the variation generator. Apply everything that was applicable to
other generators."

## Gesture

Shift + Step 15 is Double Loop. Like Step 16, a **tap** keeps its old meaning, now on release (`router-steps.ts`), and a
**hold** fills the bar (`ai/hold.ts`, label `SMART DOUBLE`) and starts task `double`. The hold is armed only when the
clip has notes and twice its loop still fits the engine's 16 bars (`aiDoubleAllowed`); an unarmed press is a tap. In
Session view the tap still fires on press (Shift + step there was never a hold).

## Task

`double` rewrites the clip it is on (`job-target.ts`), at twice its loop length, at its own speed. It is **always
algorithmic** (`job.ts`): there is no model prompt for it, whatever GENERATOR MODE says. The preview, the knobs, the knob
lights and the single undo entry are the ones Variation and Smart Quantize use; ORIG restores the clip at its old length.

The generator context (`analysis/context.ts`) reads the clip's **loop window** from its start (`windowOf`) and loops it
to the doubled length, so `ctx.src` is the plain double. Harmony is the clip's own scene, as for Smart Quantize (one
SCENE plan), but `freedom` is the scene's real one, so an ending may change a chord only where no other track sets it.
The guard refuses the plain double (a tap is that).

## In phase with the scene

A clip whose loop grows keeps its playhead, so doubling a 1-bar clip while a
2-bar neighbour is in its second bar left the double a bar out against it, and
its endings (written against the neighbour's bars as they line up from tick 0)
over the wrong chords. The engine re-phases a playing clip whose length changes
through `dbl`, `aiclip` or `aiload` (`engine/phase.rs`): to the longest playing
loop the new length divides, in master time (clip speed counted), or nowhere.
`loop` (the LENGTH knob) is left alone, since a playhead jumping while the knob
turns would be worse.

The endings also hit with the band (`analysis/band.ts`): every other track's
onsets in the scene, each loop window repeated from 0 the way the engine now
phases them, bucketed to a 32nd and weighted by velocity (100 = 1; an accent is
0.9, so a struck chord or snare counts and a quiet hat does not). `pickIn`
moves each pickup grid point onto the strongest accent within half a grid step
(STOP, TURNAROUND's fallback, drum PICKUP, BREAK); RUN adds 12 velocity on a
shared hit. Bench "with band" (share of new ending onsets on an accent, where
the band plays one): 0.47 without, 0.48 with at BALANCED — the cached Sets'
bands mostly play on the pickup grid already, and ten of the fourteen
generators place onsets by their own rule; the tests pin the off-grid case.

## The seams (`shape/seams.ts`)

Every double generator keeps the doubled clip and rewrites only its seams:

- the **end**: the last ENDING (½ beat, 1 beat, 2 beats, 1 bar, 2 bars; never more than half the clip; opens at about a
  quarter of it, at least a beat);
- with **SEAMS = BOTH**, also the end of the first half, half as long: the first half asks, the second answers.

`rewrite()` replaces the notes that start in a seam and shortens a kept note still sounding when a new one starts (or,
for STOP, at the seam), so a line stays one line. What a seam leads into is the clip's first onset (`nextEv`): both
halves open on it. Endings are fitted to the scene's chords (`pitchFix` at a TENSION, or chord tones), except TURN.

## Generators

| class | melodic (`dbl-lines.ts`, `dbl-melodic.ts`) | drums (`dbl-drums.ts`) |
| --- | --- | --- |
| close | TURNAROUND (APPROACH below / above / enclose / chromatic, TENSION), CADENCE (LAND root / fifth / tonic / dominant, HOLD) | FILL (DENSITY, PADS), PICKUP (PADS, PUSH, HITS) |
| rhythm | PUSH (PUSH, ACCENT), RUN (RATE, DIRECTION, NOTES), ECHO (STEP, FROM before / opening) | ROLL (RATE incl. ACCEL, CRESC), REPEAT (GRAIN, DECAY) |
| exp | STYLE (LIKENESS, DENSITY, SEED: the Markov walk of 2026-10-28 §1), STOP (KIND stop / hold / stab, PICKUP), TURN (MOVE V7 / IV / tritone / R / L / P, TENSION; free scenes only) | BREAK (KEEP, PICKUP), STYLE (LIKENESS, DENSITY, SEED) |

Four knobs each. What the other generators have and this applies: each preset its own generator with its own knobs;
the knob-liveness property (no dead knob, `gen-engine.mjs` walks `double` over three scenes and every role); two
variant takes per preset (`variant.ts`: ENDING ±1, SEAMS flipped, each choice knob to the next); spread-based selection
of six (`select.ts`, the Variation mix per level); level shifts (SAFE: ENDING −1; WILD: ENDING +1, SEAMS BOTH); the
learned style and the Tonnetz moves; the perf budget (`perf.mjs` runs a doubled 512-note clip).

## EVOLVE (`presets/dbl-evolve.ts`)

User, 2026-10-28: "when I double something close to a chord progression or anything backed by chords I want to see an
option that evolves that to something new. If the first bar has 2 chords and i double it the second bar should have 2
different chords… treat it as a general improvement". The one double that rewrites a whole half: the second half is
the part re-realised (`realise`, the Variation realisers) over the first half's chords developed by `harmonicMoves`
(SAME left out; in a partial scene only moves that tolerate the pins), MOVE picking which, with TENSION, RHYTHM and
RANGE. Served where the scene is not locked and the clip has chords; fit 0.8 on a chord part (0.62 on a line), so it
is among the six for the fixtures' pad, stabs and lead in a free scene. Bench BALANCED: ending novelty 0.70 → 0.72,
notes variability 0.37 → 0.39, coherence 0.92 unchanged.

## Bench (`scripts/gen-bench/double.mjs`)

Every cached case's own clip doubled (no model reference: no model ever did this task). BALANCED: 42 requests, six
options each, first part kept 0.97, ending novelty 0.70, ending coherence 0.92. SAFE 0.96 / 0.46 / 0.94, WILD 0.80 /
0.80 / 0.92 (WILD rewrites both seams). The Variation and Smart Quantize gates are unchanged.
