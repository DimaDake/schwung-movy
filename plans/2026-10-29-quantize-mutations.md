# Smart Quantize mutations

2026-10-29. User: "I want quantize to have more options to mutate current
clip. Either new generators or existing ones" … "They should originate from
the current clip. Not from scratch".

## What changed

- **Six options** instead of three (`engine.ts` `optionCountFor`, `select.ts`
  slots for 6: SAFE 2 close/3 rhythm/1 exp, BALANCED 2/2/2, WILD 1/2/3). Option 1
  is still the tightest.
- **Ten mutation generators**, all from `tightSrc`: the clip on the grid by
  TIMING with TIGHT's default pitch fix (`presets/quant-mutate.ts`), then one
  change (`shape/mutate.ts`):

| Generator | Class | Change |
| --- | --- | --- |
| MUTATE | exp | weak-beat notes ±1–4 scale steps (strong beats past AMOUNT 5, onto chord tones); a chord's top only |
| MODE | exp | same degrees in another mode of the tonic (parallel, Dorian … Locrian), WHERE; only when `ctx.alone` |
| INVERT | exp | diatonic mirror round a pivot, WHERE; lines only |
| OCTAVES | rhythm | off-beat notes ±12; lines only |
| RATCHET | rhythm | repeats at 1/32, 1/16T, 1/16 with DECAY, ≤ 4 strikes, ≤ half the notes |
| SHIFT | rhythm | rotate −4..+4 sixteenths, KEEP downbeats |
| HUMANIZE | close | loosen timing, velocity, length |
| MUTATE (drums) | exp | hits a 16th/8th along; downbeat kick and backbeat snare stay |
| RATCHET (drums) | rhythm | rolls on hats, snare or any pad, an 8th at most |
| HUMANIZE (drums) | close | as melodic |

- Pitch mutations (MUTATE, INVERT, OCTAVES) clear semitone rubs against the
  band, for the moved notes only (Smart Quantize otherwise skips the band
  check: it fixes the player's own notes).
- `GenCtx.alone`: no other track sounds pitches under the target. A Smart
  Quantize reports `freedom` as `locked` always, so MODE needed its own flag.

## Measured on the way

- First RATCHET (up to 8 strikes on any note) failed the old bench's gate on
  density: 88% → 69%. Capped at 4 strikes on at most half the notes: the gate
  is back to the baseline.
- MODE against a band was 20% broken (every third clashes): now offered only
  on a clip playing alone.
- MUTATE/OCTAVES/HUMANIZE/RATCHET had 7–9% broken defaults while TIGHT had
  none: they started from the clip without TIGHT's pitch fix, so the player's
  slips stayed. Starting from the fixed clip: none of them is in the worst list.

Bench (`plans/gen-quality-quantnew.md` vs `follownew`): useful clicks 47098 →
50054; default musical 86% → 85% (the new presets' defaults count, several of
them deliberately experimental); duplicate pairs +1 (`q-octaves AMOUNT=SEED`
on a case with almost no off-beat notes, where both move the same one).
