# Bass over existing chords — evaluation (2026-11-06)

Scenario: a chord clip already exists (New Clip CHORDS / STABS / PAD), then
New Clip on the bass track. The bench's scripted pieces always build bass
*before* chords, so this path was never measured.

## Method

- **Generated:** 24 scenes, 8 keys, CHORDS/STABS/PAD, 2/4/8-bar clips, HARMONY
  turned on odd seeds, drums on 2 of 3. Then New Clip on the bass track: the
  BASS take, PULSE, WALK, plus turns of PATTERN (4 positions), NOTES (all 4)
  and SPACE (3). 288 bass clips.
- **Reference:** the user's own bass clips: 42 from Move set backups
  (`~/Documents/Move/Move Backup 2025-03-09`, `Set 3`) and 42 from Live sets
  (`MainSet`, `push_projects`, the `Diabolical…` / `Pattern in the Surface` /
  `3 guitar beats from move` projects). 24 of them have a chord clip in the
  same scene row.
- **Public:** 144 bass parts (GM programs 32–39) from the bench's MidiCaps /
  Lakh files (`.gen-data/src/midicaps`, 107 electronic, 37 pop): an 8-bar window
  from bar 9, with the chordal parts (piano, organ, guitar, strings, pads) and
  the kick beside them. 137 have chordal parts.
- Scripts (scratch, not committed): `extract.py` (Move `Song.abl` JSON and Live
  `.als` XML → clips), `gen.mjs` (chords first, then bass, through
  `dist/esm/gen`), `analyse.py` (the same metrics on both sets).

## Medians

| metric | user Move | user Live | public electronic | public pop | BASS take | BASS PATTERN turns | PULSE | WALK |
|---|---|---|---|---|---|---|---|---|
| notes / bar | 2.4 | 3.8 | 6.0 | 4.3 | **7.0** | **8.0** | 6.0 | 5.0 |
| gate (16ths) | 2.8 | 2.6 | 2.0 | 2.1 | **1.5** | **1.0** | 1.3 | 2.4 |
| legato (gate / gap to next) | 0.98 | 0.90 | 0.85 | 0.89 | **0.67** | 0.81 | 0.50 | 0.55 |
| silence | 26% | 30% | 22% | 25% | **50%** | 31% | 50% | 50% |
| stepwise intervals (1–2 st) | 29% | 17% | 13% | 19% | **2%** | **5%** | 0% | 24% |
| repeated notes | 6% | 22% | 40% | 30% | 14% | 24% | **80%** | 42% |
| distinct bar rhythms / bars | 0.44 | 0.50 | 0.38 | 0.50 | **0.25** | **0.25** | 0.25 | 0.88 |
| note on chord root | 40% | 32% | 45% | 59% | **25%** | 28% | 65% | 50% |
| note on the voicing's low note (not the root) | 0% | 0% | 0% | 4% | **25%** | 25% | 0% | 0% |
| bass onsets on a kick | – | – | 50% | 70% | **38%** | 33% | 37% | 28% |
| median pitch | 39 (Eb2) | 43 (G2) | 34 (Bb1) | 36 (C2) | **46 (Bb2)** | 45 | 36 | 50 |

A clash-time metric (bass pitch class absent from the sounding chord) does not
separate the sets: the user's lines sit outside the chord 12–19% of the time
too (passing tones).

## Findings, by weight

1. **BASS follows the pad's lowest voice, not the root.** `chordsOf` stores a
   segment's lowest sounding note as `Chord.bass`, and `new-lines.ts` BASS
   plays `c.bass ?? c.root`. Chord generators voice inversions on purpose
   (voice leading), so 14 of the 24 BASS takes (and 51 of 96 PATTERN turns) put
   ≥20% of their notes on a 3rd or 5th as the bass: every inverted pad chord
   becomes a slash chord (F/C, G/D, Am/C, Gm7/Bb). The user's lines never do
   that (0%). The bass defines the harmony; a keyboard's inversion is not a
   bass note. This is the main reason the lines sound "wrong" over existing
   chords.
2. **Pushed/syncopated chord clips are read on a half-bar grid.** CHORDS
   strikes on 0.75/1.5/2.75/3.5 beats (anticipations), but the scene's harmony
   is quantised per half-bar (`Prog` unit HALF). The bass then changes chords
   at the wrong time, for example a whole bar of E (the C7/E chord's low note)
   under a Bb/F chord in seed 3. A bass over an existing clip should follow the
   clip's actual change times (or push with it).
3. **Too busy and too short.** 7–8 notes a bar at gate ~1–1.5 sixteenths,
   against the user's 2.4–3.8 notes held ~2.7 sixteenths, near-legato. The
   take pool is dominated by 8th pumps (7 of 24 takes are the same
   `0,2,4,…,14` rhythm) and gallops.
4. **No melodic motion.** 2–5% stepwise intervals against 17–29%. BASS's
   parts are root / fifth / octave / chord tone / one approach note. The user
   walks scale steps (B1 C2 D2, Eb F Ab Bb, C D E G A runs) and uses the 3rd
   (10–14% of notes). The "NOTES = CHORD TONES" turn is the only source of 3rds
   and it is rarely the take.
5. **One bar copied.** Every bar has the same rhythm (0.25 distinct rhythms per
   bar). The user's lines are 2- or 4-bar riffs: the same cell with the last
   bar answering (a pickup run into the loop, a held note, a fill). Pitch
   changes only because the chord does.
6. **Register too high.** The MID take sits at Bb2, the user's lines around
   Eb2–G2. OCTAVE takes are `[LOW, MID, MID]`.
7. PULSE repeats one note (80%). WALK is the closest to the user's motion
   (24% steps, varied rhythms) but sits at D3 and still lacks root-on-change
   discipline (50% roots).

## What the public parts add

They confirm 1, 3 (gate, not count), 5 and 6, and add one:

- Lakh's chordal parts are inverted as freely as movy's, yet their bass plays
  the voicing's low note only 0–4% of the time: the bass ignores the
  keyboard's inversion (finding 1).
- Public electronic bass is as busy as BASS (6 notes a bar) but its notes are
  held (gate 2 sixteenths, legato 0.85): the problem is short notes and gaps,
  not the count. The user's own lines are sparser than either.
- They repeat the root more (30–40% repeated notes, 45–59% on the root) and
  move within a chord less than the user does: the user's lines are more
  melodic than the genre norm, and that is part of the taste.
- **They lock to the kick**: 50% (electronic) / 70% (pop) of bass onsets land
  on a kick, against 28–38% for every generator. BASS reads the band's accents
  only on some PATTERN positions.
- They sit lower still: Bb1–C2.

## What the user's lines have (the target qualities)

- The root on (or just before) each chord change; the bar's "one" is struck
  in nearly every bar.
- Few notes, long ones: held roots, rests as part of the riff, ~2–4 onsets a bar.
- A riff identity: a 1–2-bar rhythmic cell with syncopation (e.g. 0,2,7,10,14)
  that survives chord changes, and is transposed rather than recomputed.
- Stepwise scale motion and minor-3rd figures (root ↔ b3 / 3), with the 5th
  and octave less common than the generator assumes.
- Phrase-end variation: the last bar of 2/4 answers with a run or pickup into
  the next root.
- Low register (E1–G2 centre).

Theory sources agree: the root locked to each change, passing/approach tones
into the next root, then chord tones and rhythm, with restraint
(pluginboutique, musicradar, attackmagazine, Beat Kitchen; walking-bass
beat-role templates).

## Proposed fixes (not started)

1. Bass target = chord root, not `Chord.bass`, when the harmony came from
   another track's voicing; keep `bass` only for an intended slash chord
   (a planned one, or a bass track's own line).
2. Read the scene's change times from the chord clip's onsets (pushes
   included) instead of half-bar cells, for bass/line generators.
3. BASS takes: kick-locked figures as a default, fewer notes, longer gates (GATE take range up), more held and
   syncopated cells; LOW as the default OCTAVE.
4. A 2/4-bar phrase: the cell repeats, the last bar varies (pickup run,
   approach, held note).
5. Scale passing tones between roots (diatonic steps on weak 16ths), and the
   3rd as a regular part.
6. Bench: a "bass over existing chords" piece order, plus these metrics
   (notes/bar, gate, step%, voicing-bass share, distinct bar rhythms) against
   the user corpus and the public parts (`public.mjs` over MidiCaps).
