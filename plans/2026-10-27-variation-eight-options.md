# Variation: eight options, roles, no same loop

Follows `plans/2026-10-27-generators-quality-design.md`. Evidence: the Set
`mmv41ucwf` on the device (2026-10-27, scene 2 generated track by track, every
option 1 kept):

- the bass's B was its A with the two bars swapped (a rotation: the A loop
  started one bar later), and the chords followed it, so the "B" was A again;
- the helm drone (one note held 27 steps) came back as a 4-note melody,
  breaking the existing "half to double the notes" rule, which nothing checked;
- every request was answered by the fallback model (`gemini-3.1-flash-lite`
  429 all evening: the bench had spent the key's daily quota).

## Decided with the user

- **Eight Variation options**: 1-4 aligned (the source's rhythm and role, other
  notes), 5-6 aligned with a rhythmic change or different connections between
  the chords, 7-8 experimental. Smart Quantize keeps three.
- **Roles**: every option keeps the source's role (drone, pad, stabs, bass,
  arpeggio, lead; drums keep their density).
- **A rule against the same loop**: no option may be the source rotated in time
  (bars reordered) or transposed as a whole.
- **No global B section**: built track by track. The per-scene chord plan
  proposed earlier is dropped: a committed clip's notes already are the
  scene's harmony, and the next track is told to follow them.

## Design

1. `src/ai/role.ts`: the source's role measured on the device (notes at once,
   onsets per bar, median length, register). The prompt states it; the
   validator drops a Variation option that breaks it, which also enforces the
   note-count rule.
2. `src/ai/same-loop.ts`: votes over (time shift, transposition) between the
   option's and each existing clip's (step, pitch) cells; 85% or more matched is
   the same loop. Drums: rotations only (a drum B close to its A is legitimate).
   The same measure (shift 0) drops near-duplicate options.
3. Prompt: the 8-rung ladder (`ladders.ts`); the GENERATORS level moves only
   options 7-8. When other tracks already sound in the target scene, every
   option follows their chords (the "move the harmony" demand is only sent to
   an empty scene, and there it must be new chords, not A's in another order).
4. Validator returns the surviving options with their slot, and why the rest
   were dropped (logged). The strip numbers options by slot, so 7-8 stay the
   experimental ones whatever was dropped; its gap shrinks to fit 8.
5. Engine: `AI_STASH_SLOTS` 4 → 9 (ORIG + 8). ENGINE_VERSION bump.
6. Bench: expected option count per task; "kept" share and drop reasons in the
   report; a `--budget` cap on uncached requests so a run cannot spend the
   device's daily quota (use a second key for the bench where possible).
