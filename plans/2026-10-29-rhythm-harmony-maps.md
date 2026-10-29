# PATTERN and HARMONY as maps

2026-10-29. User: "would it make sense to have a pattern knob … not fixed by
particular rhythmic options but rather scan through all possible rhythmic
variations … up to 128 values … the change is always gradual but covers the
whole range … the same for harmony", then "128 is not too much. I don't care
about names", "implement everything for rhythm and harmony". Knob positions
are not persisted (RAM only, `src/ai/preview-knobs.ts`), so renumbering broke
nothing stored.

## PATTERN (CHORDS, STABS): `shape/rhythm-map.ts`, `create/pattern-knob.ts`

- A **flavour** is a ranking of the 16 steps: the figure's own steps first,
  the rest by **Barlow's indispensability** for 2·2·2·2
  (`[15,0,8,4,12,2,10,6,14,1,9,5,13,3,11,7]`).
- Density k plays the top k: the patterns of one flavour are **nested** (the
  Grids density idea), so a click adds or drops one onset; at the figure's own
  size it is the figure.
- Flavours: the named figures, the band's accents (when the band has them;
  WITH BAND's successor), and eight Euclidean ones (E3, E5, E7, E9, rotations).
- Laid as a **serpentine** (lo→hi, then hi→lo through the next), the next
  flavour the one closest (onset difference) at the turn; a pattern already on
  the map is skipped.
- CHORDS 1–10 onsets a bar (122 positions), STABS 1–8. A take lands on a named
  figure (`takes`), weighted by the old pools.
- Measured: 108 of 121 turns move one onset, mean 1.23 (1.75 without the
  serpentine — the test that proves it).

## HARMONY (New Clip, free and partial scenes): `theory/grammar.ts`, `create/harmony-map.ts`

- **Seeds**: the named loops, MORE loops, walks, +DEV and eight-chord loops,
  the borrowed COLOUR loops (ext). `seed` = their place, which `runPlan` draws
  by, so the map's layout never changes which loop a run opens on (without
  it the bench's pieces moved 88% → 75% musical purely by reshuffling).
- **Rules** (one chord a rule, length kept; after Steedman 1984 and
  Rohrmeier 2011): diatonic substitute a third away; preparation by the next
  chord's dominant or subdominant (not on the home slot); chromatic (ext):
  secondary dominant (never V7/I), tritone substitute, mixture (iv, bVI,
  bVII, bIII; minor: IV, V, bII). A seventh on or off is not a rule — VOICING
  already does it, and it flooded the map with near-duplicates.
- **Score**: mean log corpus weight (walk.ts RS200 tables) minus 0.2 a rule.
  Two depths, a beam of 32 diatonic + 32 colour, colour at most a third.
- **Order**: Lerdahl's chord distance (circle-of-fifths steps + basic-space
  tones not shared + tones outside the key, symmetric, as 12-bit masks);
  nearest-neighbour line from the first seed + 2-opt, diatonic first, colour
  after from where it ended.
- Measured: 128 loops on a 4-bar clip; 72 of 121 turns change one chord, 97
  one or two.
- Seconds: `walk.ts`'s `secondary()` and the SEC DOM / WALK SEC / TRITONE
  plans are gone — the grammar's colour covers them.

## Cost and staging

The map is several ms in QuickJS (Mac, `qjs` built from schwung's
quickjs-2025-04-26): stages 3/6/1/3/2 ms on 2 bars, 6/14/2/7/3 ms on 16 bars
(the worst take slice there is ~45 ms already). So a request builds it **a
stage a tick** before its first take (`planSteps`, `Request.plans`);
`prepare()` drains it at once. perf.mjs: a stage ≤ 3 ms in node (1.2).

**QuickJS bug found**: `for (const x of yield* g())` throws "InternalError:
stack underflow" in quickjs-2025-04-26 (node is fine). Source rule 5 bans it.

## Bench (`plans/gen-quality-mapnew.md` vs `mapbase`)

Every metric the same; useful clicks 46619 → 46905. A sweep of every PATTERN
and HARMONY position (3 scenes × 3 runs × 2 lengths, 7002 takes): 100%
musical by the bench verdict, as the old knobs (870 takes).

## Not done

- BASS's PATTERN keeps its library: its figures carry which note each hit
  plays (root, fifth, octave), which a ranking of onsets does not.
- Variation's PATTERN/COMP (var-pattern.ts) keeps its list.
- A locked scene has one plan (the scene's chords); nothing to map.
