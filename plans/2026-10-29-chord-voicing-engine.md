# Chord voicing and progression engine

2026-10-29. User: "research the following sources and improve movy generators
(or create new generator types) … specifically more interesting chord
generation". The sources were a Gemini summary of chord tools; this records
what checked out, what movy took, and what it left.

## What the sources say, checked

| Source | Verdict | What movy takes |
| --- | --- | --- |
| tonal.js `@tonaljs/voicing` + `voicing-dictionary` | real. A dictionary maps a chord symbol to interval stacks (`triads`, `lefthand`: m7 `3m 5P 7m 9M` / `7m 9M 10m 12P`); `search` lists every placement in a range, `get` picks the one closest to the last (`topNoteDiff`) | the style dictionary (`theory/voicing-styles.ts`), rootless A/B forms as JAZZ |
| Strudel `voicing()` (felixroos/chord-voicings) | real. `anchor` + `mode` (`below`: top note ≤ anchor, nearest wins) gives voice leading without state | the top-note anchor term in the search cost |
| "Optimal voice leading" with Dijkstra (Python) | no such repo found; the idea is real (ekzhang/harmony does DP; orbichord / Tymoczko do minimal L1) | the whole-loop shortest path (Viterbi, a DP over a layered graph = Dijkstra on a DAG), sorted L1 as the edge cost, the loop closed |
| Muzik (Rust), lead-note anchoring | not verified; the idea matches Strudel's anchor | TOP LINE motion |
| OpenChord M1 | **not found** anywhere; treated as hallucinated | nothing |
| ChordSeqAI | real (StudentTraineeCenter, archived 2025-04; web app PetrIvan/chord-seq-ai-app); no ONNX export found | nothing: an ML model per knob turn on QuickJS is out of budget; a corpus-weighted Markov table gives the same "what usually comes next" cheaply |
| Tonnetz / Neo-Riemannian PLR | already in movy (`theory/moves.ts` R/L/P TURN) | nothing new |
| Scaler 3 (pitch classes → voicing → performance) | marketing-level only; the layering is sound | the split: plan chords → VOICING style → STRUM/feel |
| Orchid / KeyStep strum, slop, harp | real (Orchid manual: Strum, Strum 2 oct, Slop, Arp, Harp) | STRUM modes UP, ROLL, SLOP, HARP, HARP 2X (`shape/strum.ts`) |
| OXI One fold-into-range | plausible, unverified | the window + "never under the floor" rule already did this |
| Drop 2 / drop 3, low-interval limits, pitch-class sets | standard theory | drop styles; LIL mud cost; quartal stacks filtered by chord-third + avoid notes |
| Markov progressions with a tension slider | standard; weights after de Clercq & Temperley's RS200 counts | `theory/walk.ts` WALK 1-3 (temperature knob-ready, fixed at 1 for now) |

## What changed

- **VOICING** replaces VOICES on CHORDS / STABS and VOICES+SPREAD on PAD: 12
  styles thin→rich (DUO … NEO SOUL). Colour tokens (9, 6, 11) resolve only
  where the scale under the chord holds them and they are not a semitone over
  a chord tone; a progression's own 7th replaces the 5th in a style without one.
- **Whole-loop voicing** (`theory/voicings.ts`): every candidate of every
  chord, Viterbi over movement (sorted L1) + top-note travel + anchor + mud +
  a bass that is not a chord tone; best few openings tried with the wrap
  added, so the loop closes. REGISTER keeps its old ladder (each click = the
  next chord-tone bottom above E2) as the first chord's opening.
- **MOTION** on PAD: SMOOTH, TOP LINE, CLIMB, ARCH, FALL, PARALLEL (planing).
- **STRUM** on PAD grows Orchid-style modes; positions 1-4 are the old strum.
- **HARMONY**: three seeded WALKs per run (diatonic, a take may open on them);
  SEC DOM, WALK SEC and TRITONE at the colour end (`ext`).

## Measured (quality bench, `plans/gen-quality-chordnew.md` vs `chordbase`)

Pieces musical 67% → 88%, broken 8% → 0%; useful clicks and register reach
up; nothing regressed. Part of the piece gain is the walks changing which
progression a seed opens on, not only the voicing. Generation stays under
0.4 ms per take in node at 256 steps (same as before).

## Not done

- A SURPRISE/temperature knob for the walks (no free knob on the chord
  presets; HARMONY positions carry the walks instead).
- Voicing engine for Variation's chord realiser (`realise/chords.ts` still
  voice-leads greedily from the source); the same `voiceAll` could serve it.
- Slash chords / pedal bass in the dictionary.
