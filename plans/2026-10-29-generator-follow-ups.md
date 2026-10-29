# Generator follow-ups: bass map, push, Variation voicing, drum map, guide tones, map bench

2026-10-29. User picked #2 #3 #4 #5 #6 #10 #14 from the follow-up list after
`plans/2026-10-29-rhythm-harmony-maps.md`; #10 (2-D maps) "drums only".

## What was built

| # | What | Where |
| --- | --- | --- |
| 2 | BASS PATTERN on the rhythm map (1–12 hits, 129 positions). A named figure keeps its parts; elsewhere a strong beat (IND ≥ 12) is the root, 8ths a fifth/octave, the hit before a change approaches the next root. `ownPositions`: named figures with the same onsets (OCTAVES, PUMP 8THS) stay apart, since their notes differ | `presets/new-lines.ts`, `shape/rhythm-map.ts` |
| 5 | Push: a strike within an 8th before a change, the change unstruck, plays the next chord — CHORDS, STABS, BASS | `create/push.ts` |
| 3 | Variation's chord realiser on `voiceAll` (style from voice count + TENSION + RANGE; top note per run anchored to the source's, TOP LINE weights; repeats not held, so RECOMBINE's pitch moves stay heard; 2 voices with a 7th = 3rd + 7th). Variation COMP on the comp map | `realise/chords.ts`, `presets/var-pattern.ts`, `theory/voicings.ts` (`anchors`, `holdRepeats`) |
| 4, 10 | DRUM MAP: GROOVE (57 positions through the 8 genre nodes) × KICK/SNARE/HATS density. Densities nest (ranking by level, then Barlow); between genres the hits are traded one at a time at the current density, velocities blended | `presets/new-drums-map.ts` |
| 6 | Guide tones: MELODY and COUNTER start each chord on its 3rd or 7th (5th where a major 7th would rub the root), nearest the last one; the note before a change steps into the next | `create/guide.ts` |
| 14 | Bench method 3: every position of every map knob played: gradual turns, mean turn, distinct positions, verdicts, onset reach | `scripts/gen-bench/quality/maps.mjs` |

## Findings on the way

- First pass of the realiser collapsed repeated chords: RECOMBINE's knobs went
  dead on partial pads (`knob_property_half_live_on_every_served_role`).
- DRUM MAP's first GROOVE (blended rankings) changed hits on only 12 of 57
  clicks; trading hits a step at a time makes every click move ≤ 1 hit a voice,
  and at a fixed density neighbouring genres still share most hits, so there a
  click is heard in the velocities (as on Grids).
- A guide-tone test that accepted "a guide tone or the tonic" passed without
  the guides (chord tones on strong beats are often 3rds). The test with teeth:
  a chord's first note is never its root (4/9 roots without guides, 0 with).

## Bench (`plans/gen-quality-follownew.md` vs `mapnew`)

- Map knobs (12381 positions): 90% of turns gradual, mean 1.23, 91% distinct,
  99% musical, 0% broken.
- Pieces: musical 88% → 75% (6 of 24 experimental, 0 broken); clash 0 → 1%,
  chord fit 0.93 → 0.94, worst part fit 0.86 → 0.87; chords in A' 3.92 → 3.67.
  Bisected: push, guides and the realiser each flip about one piece, the
  rest follows from the bass/drum maps changing what later parts are built
  on; no single change carries it, and none of the aggregate fits fell.
  Listen: `.gen-data/pieces/follownew/`.
- Duplicate pair `v-spread HARMONY=TENSION`: at their ends both reach a
  seventh plus ninth (HARMONY's 9TH sit, TENSION's top); the middles differ.

## Not done

- 2-D maps on the melodic parts (no spare knob; user chose drums only).
