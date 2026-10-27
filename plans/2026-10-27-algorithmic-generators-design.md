# Algorithmic generators: Variation and Smart Quantize without a model

Follows `plans/2026-10-26-ai-midi-design.md` (the gestures, the preview, the
undo) and `plans/2026-10-27-generators-quality-design.md` (the bench). Both
features keep their gestures, their preview and their one-step undo. What
changes is where the options come from: a local, rule-based engine in
`src/gen/` becomes the default, and the Gemini path stays as a setting.

## 1. Intent (the user's words, 2026-10-27)

- "rewrite both features ai variation and ai quantize to be full algorithmic
  functions … super duper complex algorithmic logic that takes into account all
  harmony related parameters … a set of 20 (or any number) of algorithmic
  presets … then we select 6 presets out of all of those that matches the case
  better."
- Knobs: "I want all knobs to be intuitive so no ui needed and be already in
  the best position. use 8 or 4 knobs depending if all knobs can be actually
  useful. I don't want knobs that doesn't produce useful results by turning."
- "a switch in global settings whether it is ai generated things or the new
  algorithmic ones (algorithmic default)."
- "turn knobs discards edits." "touching knobs acts as on pages with the top
  toast."
- "Quantize should be able to add variations to some extent (it is not only
  boring quantize but can actually update your clip in some meaningful way)."
- "I am open more logic and more code … it could be 10000 lines or more."
- Bench: "compare it with ai results that we had before (don't rerun) and make
  sure it is as close as possible (without optimizing much for particular data
  set)."
- Harmony: "it should be coherent. I wouldn't allow to turn harmony away to the
  stage where it is not musical. the rule of thumb: everything should sound
  well together (Scenes, tracks). we give harmony only if it is a single track
  clip or other tracks give harmony freedom."

Carried over from the earlier rounds (still binding): everything grows from what
the user played; a Variation keeps the track's role (chords stay chords, a drone
stays a drone); harmony rules, not scales; no option is a clip of the track
again (the same-loop rule); the B section is built track by track, never
globally; drums never change notes (pads), only rhythm, velocity and density;
SAFE / BALANCED / WILD stays; no "AI" on screen.

### Anti-goals

- A knob that does nothing audible on some preset or some track.
- A Harmony setting that makes the clip clash with the other tracks.
- Tuning constants to the 42 bench cases.
- Blocking the UI tick: generation runs in slices, one per tick.

## 2. The rules of harmony (the scene owns it)

Harmony is a property of the scene, not of a track. For a clip in scene S the
**constraint** is, per half-bar, the set of pitch classes the *other* melodic
tracks sound in S (transpose and speed applied, loop window only — the same
reading `sceneChords` already does).

| Constraint in the target scene | Freedom | What the generator may do |
| --- | --- | --- |
| A full chord (three or more pitch classes spelling a chord) | **locked** | Follow those chords exactly. The part chooses how it sits on them (roots, inversions, added tones). |
| One or two pitch classes (a drone, a bass alone, a pedal) | **partial** | Any chord that holds those pitch classes as chord or colour tones. |
| Nothing (empty, drums only, or the clip is alone in the Set) | **free** | Re-harmonise from the source scene, by the moves in §2.1. |

That single table is the whole rule: a track varied first in an empty B scene
chooses the B harmony; every track varied after it reads that harmony back from
the scene and follows it. Coherence across tracks needs no stored plan, and the
B section is still built track by track.

### 2.1 Harmonic moves (free and partial freedom)

From the source scene's progression (chords per half-bar, with their function
in the detected key), ordered close to far:

1. **Same progression** (the source's chords).
2. **Diatonic sequence**: the progression moved by scale degree onto IV, vi,
   ii or V (the most common B-section move in electronic music).
3. **Function substitutes**: tonic I↔vi↔iii, subdominant IV↔ii, dominant
   V↔vii°, per chord.
4. **Borrowed chords**: iv, bVI, bVII in major; IV, V (major) in minor.
5. **Pedal**: the progression's bass held on the tonic (or the source's bass),
   the upper chords moving.
6. **Relative / parallel**: the progression re-centred on the relative key, or
   the parallel mode's qualities.
7. **Chromatic mediant**: I → bVI or III (WILD only).

Every candidate progression is scored for **connection**: how the source
scene's last chord leads into its first (root motion by fifth or step, common
tones), and how its last leads back into the source's first (scenes loop and
are played in any order). Moves that connect badly are dropped, not merely
ranked low. In **partial** freedom a move is dropped if any of its chords would
clash with the pinned pitch classes (a semitone or tritone against them on a
strong beat).

## 3. Pipeline (`src/gen/`)

```
Set ─▶ analyse ─▶ harmony plan ─▶ skeleton ─▶ transform (preset) ─▶ realise ─▶ shape (knobs) ─▶ guard ─▶ option
```

1. **Analyse** (`analysis/`)
   - key: duration-weighted pitch-class profile of the scene against
     Krumhansl–Kessler profiles, major and minor, all 24 keys; confidence.
   - chords: per half-bar, template scoring of the sounding pitch classes with
     root and bass weight (triads, sevenths, sus, power fifths), merged into
     spans; each span gets its Roman numeral and function (T/S/D) in the key.
   - groove: per 16th of the bar, the median offset of all onsets in the scene;
     swing (the late shift of off-beat 16ths/8ths); the grid that explains the
     part best (1/8, 1/8T, 1/16, 1/16T, 1/32) by error with a complexity penalty.
   - role: `role.ts` as it is.
2. **Harmony plan** (`theory/plan.ts`): the target chord per half-bar, from
   §2 and the Harmony knob.
3. **Skeleton** (`analysis/skeleton.ts`): the part as events (onset, length,
   velocity, voices); each melodic voice tagged with its Impro-Visor category
   against the chord under it (chord tone, colour tone, approach tone, other),
   its chord degree, and the contour step to the next event. Drums: per-pad
   step patterns with metrical weights.
4. **Transform** (`presets/`): the preset's family reshapes the skeleton.
5. **Realise** (`realise/`): skeleton → notes over the planned chords.
   Melodic voices take the same category and contour against the new chord,
   nearest to the previous pitch, inside the register; approach tones resolve
   by step to the next chord or colour tone. Chords are voiced with the same
   voice count, nearest to the previous voicing (smallest total movement).
   Bass takes root, fifth or octave by the skeleton's degree, with approach
   notes into chord changes.
6. **Shape** (`shape/`): the knob stages, each applied to every preset (§5).
7. **Guard** (`guard.ts`): role kept (onset range, voices, lengths, register —
   the same `roleBreak`), drums on the kit, the clip length and the engine's
   512-note cap, never a copy of the source, never the same loop (on a hit the
   seed steps on, up to eight times).

The user's timing feel survives the whole pipeline: onsets are carried as a
grid position plus a feel offset, and only the stages that mean to move time
(Timing, Swing, Rhythm) change the offset.

## 4. Presets and selection

A preset is a recipe: a transform family, which roles and tasks it applies to,
which harmonic freedom it needs, its distance class (close, rhythm/connection,
experimental — the three groups of the old ladder) and its default knob
positions. About thirty for Variation and twelve for Smart Quantize, listed in
`presets/catalog.ts`.

**Variation, melodic** (examples of the families): next chords; re-voice;
contour mirror; call and response; motif sequence; retrograde cells; rhythmic
displacement; anticipation of chord changes; recombine (positions, durations,
pitches swapped among the part's own notes, after Live's Recombine); thin to
the strong beats; passing and neighbour notes; suspensions that resolve;
augmentation / diminution of the motif; Euclidean re-spacing with the same
onset count; pedal; arpeggio re-pattern; chord rhythm from the comping
library; spread / drop-2 voicing; octave bass; walking approach.

**Variation, drums**: kick variation; hats and percussion; ghosts and accents;
last-bar fill; displaced snare/clap; turnaround every second bar; half/double
time feel; density remap from metrical weights (after Grids); Euclidean
percussion line.

**Smart Quantize** (melodic and drums): tight (timing to the scene's groove,
only clashing pitches fixed); tidy (double hits and flams removed, velocity and
length evened); groove (swing and accents of the scene); shaped (chords filled
and re-voiced, ghost notes cleaned); embellished (passing notes, grace notes,
small fills); phrase answer (the second half developed lightly).

**Selection** (`select.ts`), once per request:

1. Keep the presets that apply to this task, role, drum/melodic and freedom.
2. Generate each with its default knobs.
3. Score: fit to the planned harmony (categories weighted by beat strength),
   groove fit, role kept, distance from the source; drop same loops and
   failures.
4. Fill the level's slots per class — Variation 6 options:
   SAFE 4 close + 2 rhythm; BALANCED 3 + 2 + 1 experimental; WILD 2 + 2 + 2.
   Quantize 3 options: closest, shaped, inspired, the level moving the whole
   ladder (as the old prompt ladder did).
5. A variety rule: no two options of one family, and every pair at least
   `MIN_PAIR_DIFF` apart (the bench's gate threshold, 0.2).
6. Options are shown closest first.

Everything is deterministic for a given Set, seed and knob state, so a test or
a bench run is repeatable; Seed is the way to roll again.

## 5. Knobs (preview only)

The knobs are idle in the preview today (`src/ai/preview.ts`). In algorithmic
mode they edit the option on screen:

- A turn regenerates that option from the source with the new knob state and
  writes it over the clip: **hand edits on that option are discarded** (user
  decision). The regeneration is coalesced to once per tick.
- Each option keeps its own knob state; switching options switches knob sets.
  Move's knobs are endless, so nothing jumps.
- Every option opens with the knob positions the selector chose: turning is
  never needed.
- **Touch** shows the param's top strip, the way a Schwung page shows a held
  knob (`render_page.mjs` `drawTouchStrip`): an inverted band over the top of
  the screen, full name on the left, value on the right. It stays while the knob
  is touched and for the toast time after the last turn.

### 5.1 Variation (8 knobs)

| # | Melodic | Left → right | Drums | Left → right |
| --- | --- | --- | --- | --- |
| 1 | CHANGE | close to the source → far | CHANGE | close → far |
| 2 | HARMONY | §2: free/partial = the moves close → far; locked = roots → inversions → added 7ths/9ths/sus | FILL | none → a full last-bar fill |
| 3 | TENSION | chord tones → colour tones → approach and chromatic | GHOSTS | none → many |
| 4 | RHYTHM | the source's rhythm → displaced → recombined | SHIFT | as played → snare/kick displaced |
| 5 | DENSITY | thinner → denser (centre = as is) | DENSITY | thinner → denser |
| 6 | RANGE | close → wide (interval span, chord spread, bass octaves) | ACCENT | flat → strong accents |
| 7 | LENGTH | staccato → legato (centre = as is) | HATS | sparse → busy hats |
| 8 | SEED | a new roll per detent | SEED | a new roll per detent |

### 5.2 Smart Quantize (8 knobs)

| # | Melodic | Left → right | Drums | Left → right |
| --- | --- | --- | --- | --- |
| 1 | TIMING | your feel → on the grid | TIMING | your feel → on the grid |
| 2 | SWING | straight → heavy (starts on the swing you played) | SWING | same |
| 3 | GRID | 1/8 → 1/8T → 1/16 → 1/16T → 1/32 (starts on the detected grid) | GRID | same |
| 4 | PITCH FIX | none → clashes → strong beats on chord tones → every note fits | CLEAN | keep double hits → remove flams and doubles |
| 5 | EMBELLISH | none → grace, passing and neighbour notes | EMBELLISH | none → ghost notes and small fills |
| 6 | DYNAMICS | as played → groove accents | DYNAMICS | as played → groove accents |
| 7 | LENGTH | staccato → legato (centre = as played) | LENGTH | short → long |
| 8 | SEED | a new roll per detent | SEED | a new roll per detent |

**Every knob must move the output on every preset and role.** This is a test,
not a hope (§8): for each preset, role fixture and knob, two positions far
apart give two different clips. A knob that cannot pass on some material is a
bug in its stage, not a reason for a blank.

### 5.3 AI mode

The Gemini reply is a finished clip, so only the stages that work on any notes
stay live: all of Smart Quantize's knobs (they are post-processing), and for
Variation DENSITY, LENGTH and RANGE (RANGE as interval span only). The other
Variation knobs are blank in AI mode, so no knob is ever dead.

## 6. Settings

The Settings page gains **GENERATOR MODE: ALGORITHMIC / AI** (knob 1, like
the GENERATORS row), stored in `prefs.json` as `genMode`, default ALGORITHMIC.
AI mode needs the key as before; ALGORITHMIC needs nothing and works offline.
GENERATORS (SAFE / BALANCED / WILD) applies to both.

## 7. Running on the device

The engine runs inside the UI's tick. A request is sliced: the sixteen track
reads (one per tick, as today), one analysis tick, then one preset candidate
per tick, then the selection; the running screen and the thinking LEDs show
meanwhile, exactly as for a model request, and Back cancels. A knob turn costs
one regeneration of one option, at most once per tick. A cost check in the perf
suite times a full request and one regeneration on the largest fixture against
a budget scaled for QuickJS.

## 8. Testing and the bench gate

Logic tests (`browser-test/logic/gen-*.mjs`):
- theory: key finding on known progressions, chord spans, Roman numerals,
  categories, voice leading (smallest movement), each harmonic move, the
  freedom table.
- each stage and each preset on small fixtures (a pad, stabs, a bass, an arp,
  a lead, a drone, a drum loop).
- **the knob property**: every knob changes the output on every preset × role.
- the guard: role kept, kit kept, same loop refused, note cap.
- the selection: counts per level, variety rule, ordering, determinism.
- the job and the preview: algorithmic requests complete in slices, knob turns
  regenerate and discard edits, the touch strip, AI-mode blanks, the setting.

Screenshot baselines: the touch strip over the preview; the Settings row.

**Bench** (`scripts/gen-bench/algo.mjs`): the same cases, the same scorer
(`score.mjs`), the shipped engine (`dist/esm/gen`). Variation and Quantize are
asked for **three** options (the AI was asked for three in the reference runs),
so best-of-three meets best-of-three; best-of-six is reported beside it.

Targets, against the cached reference `default-x3` (gemini-3.1-flash-lite,
BALANCED, three runs):

| metric | AI | gate for the algorithmic engine |
| --- | --- | --- |
| alignment, all | 0.57 | ≥ 0.54 (within the ±0.03 run spread) |
| quantize recovery | 0.78 | ≥ 0.75 |
| variation alignment | 0.36 | ≥ 0.33 |
| gate | 67 % | ≥ 62 % |
| played-drum gate | 72 % | ≥ 67 % |

plus the level ladder (idea kept falls and pair difference rises from SAFE to
WILD), and a per-case table against the cached AI replies (wins, ties, losses).

**Against tuning to the bench**: the cases split in two by a fixed rule (sorted
id, alternating within each source); constants may be tuned on the first half
only, the gate is judged on the second, and a gap between the halves larger
than the run spread is reported as overfitting. Rules come from theory, never
from a case.

## 9. Non-goals

- New gestures or features (fills on demand, add-a-part).
- Changing the Gemini path beyond the knob blanks and the mode switch.
- Rust: everything is TypeScript in the UI; the engine's `aiclip` / `aistash` /
  `aiload` protocol is reused as is.

## 10. Calls made in this design (not asked)

- Variation offers six options in algorithmic mode (the user's number); AI mode
  keeps eight.
- Smart Quantize also gets eight knobs, since "quantize should be able to add
  variations" made five more of them useful.
- The setting is its own Settings row, not a value on the GENERATORS row, so
  each row keeps one knob and one meaning.
- Harmony constraints are read per half-bar (house and techno change chords on
  the half-bar often enough that a bar grid would smear them).
