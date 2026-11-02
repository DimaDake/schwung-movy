# Generator UX rework — design

Status: decisions recorded 2026-11-01; the §4 table awaits the user's mark-up. Covers issues #1–#8 of the
2026-11-01 product review of Smart Quantize, Variation, New Clip and Smart
Double.

## 1. Intent

Movy's generators are for **casual producers with little music theory**,
working mostly in the studio, but they should be confident enough to use
them **on stage**. Today the musical results are good (the quality bench
reads about 88 % of scripted pieces as musical), but the UX gets harder
the more you use it:

- knobs mean different things on each option;
- you can't reach a generator the curated picks left out;
- Step 14 hides which mode you are in;
- one knob turn can lose something you liked, with no way back;
- the vocabulary overlaps;
- a global boldness setting is buried in Settings.

The aim is a generator you can **learn once and trust**. The same knob
does the same kind of thing everywhere. Every suitable generator is a jog
turn away. Nothing you liked is ever lost.

### What the user decided (2026-11-01)

| # | Issue | Decision |
| --- | --- | --- |
| 1 | Knobs mean different things per generator | **Fixed roles per knob slot** across all generators. Every generator's layout is confirmed from the table in §4. |
| 2 | Options are anonymous | **No change.** Touching the jog shows `GENERATOR: NAME`, and touching a knob shows its name. That is enough. |
| 3 | Can't pick a specific generator | **Every suitable generator is reachable.** The jog continues past the curated picks through the rest. Generators that don't suit the task never appear. |
| 4 | Step 14's hidden mode | **Mix both.** On a track with clips, Variation's picks include 1–2 New Clip options. |
| 5 | A knob turn loses edits | **Granular undo** through the whole generator session, including after committing (§3). The rule that a knob turn discards hand edits stays. |
| 6 | 8-knob limit | **Stay at 8.** No second page. |
| 7 | Overlapping words | SPARSE → **SPACE**. BUSY (and every "how many notes" knob) → **DENSITY**. VARY is **replaced by DRIFT**. |
| 8 | SAFE / BALANCED / WILD | **Remove it.** Always BALANCED, and whatever WILD alone could reach moves onto the knobs (§2.5). |
| + | An overlong list | **Merge overlapping generators** (§2.7), but never below the picks plus 4 for any task and track kind that selects (New Clip shows all its generators, §2.9). Nothing audible may be lost: every merged generator's sound stays reachable. |

Standing rules from earlier rounds, still binding:

- Every knob turn makes an audible, useful change, and a knob that can't is hidden (its LED stays dark).
- Defaults start at the best positions.
- Touching a knob shows the top toast; the knob LEDs show positions.
- A knob turn discards hand edits.
- The scene owns the harmony, and a part keeps its role.
- Results are new each run (randomness is wanted), but knob positions are deterministic: turning back gives the same notes.
- No "AI" anywhere on screen.

### Goals

- G1. A user who learns one generator's knobs can guess any other's.
- G2. Any suitable generator is reachable from the preview without menus.
- G3. Nothing heard in a generator session is lost: it can always be undone back to, even after committing.
- G4. One gesture per intent, with no hidden modes.
- G5. Safe on stage: every action stays in time, and undo and option switches are instant.

### Non-goals

- Learning the user's taste. Usage data or telemetry.
- Detecting the track's instrument to order New Clip options (a later item).
- A second knob page. New generators (§2.9 gives existing Variation generators a second job on New Clip; that is not a new generator).

### Anti-goals (failure even if it "works")

- A knob slot whose role changes from generator to generator without a reason the table states.
- An undo that loses timing, or audibly glitches the loop on stage.
- A scrolling list that buries the good picks: the first picks must stay the best, and the list past them is stable, not reshuffled.
- A task whose generators all fit in its picks, so every run shows the same set (drum Variation would have had exactly 6 for 6 slots).
- A generator in the list that does nothing useful for this clip (e.g. Quantize options on an empty New Clip).

## 2. Design

### 2.1 Fixed knob roles (#1)

Each slot has one role. A generator fills the slots its knobs fit and
leaves the rest empty and dark, so a 4-knob generator may use slots 1, 2,
4 and 7, for example. Moving a knob to its role's slot beats packing the
knobs into 1–4: the user learns slots, not lists.

| Slot | Role | Typical knobs |
| --- | --- | --- |
| 1 | **WHAT**: the generator's main idea | PATTERN, STYLE, CONTOUR, CELL, FORM, MODE, GROOVE, TIMING (Quantize) |
| 2 | **HOW MUCH**: how many notes, or how much is rewritten | DENSITY, AMOUNT, NOTES, LIKENESS |
| 3 | **HARMONY**: the chords (melodic). Drums: the generator's second idea | HARMONY, FIX NOTES (Quantize); ACCENT, FILL, SHIFT (drums) |
| 4 | **WHERE**: pitch place, or place in the clip | REGISTER, RANGE, OCTAVE(S), SPLIT, WHERE, PAD(S) |
| 5 | **LENGTH** | GATE, LENGTH, ENDING (Double); HUMAN (drums) |
| 6 | **EXTRA** | SPACE, SEAMS, DRIFT (next to SEED), DYNAMICS where 7 is taken |
| 7 | **FLAVOUR** | DYNAMICS, STRUM, COLOUR, VOICING |
| 8 | **OVER TIME** | DRIFT; CHORD RATE where there is no DRIFT |

**Why this order (user, 2026-11-01).** Left half = the notes, right half =
the feel, as before. Within that, the knobs turned most sit where a hand finds
them: HARMONY is on 3, next to WHAT and HOW MUCH, ahead of WHERE (REGISTER and
OCTAVE are rarely turned, since the part's role already places it). DRIFT, the
knob played live, is on 8: an end knob is found by feel without looking. Both
moves are to be confirmed by ten minutes on the device with a mock-up before
the builder renumbers anything.

**Core knobs first (user, 2026-11-01: "keep seed, harmony, density, space,
pattern everywhere where it is meaningful").** When a generator has more
candidates than slots, PATTERN/WHAT, DENSITY, HARMONY, SPACE and SEED win
over the colour and feel knobs, each only where it applies (§2.8). **No generator has a SWING knob** (user, 2026-11-02:
"we follow clip swing"). Parts are written straight and the set's swing
swings them at playback: the engine delays every off-beat 16th by the set's
swing (`swing_delay`, `seq-core` `engine.rs`), so a swing baked into the notes
is swung twice. DYNAMICS takes SWING's slot 7. **No knob is dropped while a
slot is dark:** it takes the nearest empty slot (user, 2026-11-02). The builder adds DENSITY wherever it
is cheap and musical (`densityStage`, `drumDensity`, `patternDense`).
SPACE stays on New Clip only (see the pushback in §6).

Two exceptions, both stated:

- **Per-pad drums keep DENSITY on knob 1.** DENSITY is "the pad's" across both per-pad options (`ai/preview-pads.ts`), and DENSITY 0 removes the pad. It is the per-pad generators' main idea.
- **On Quantize, slot 1 is always TIMING**, because "how tight" is Quantize's main idea.

### 2.2 Every suitable generator, by jog (#3)

- The preview strip still opens on ORIG plus the curated first picks: 6 for Variation and Quantize, every suitable generator for New Clip (§2.9), as many as suit for Double.
- **Turning the jog past the last pick continues** into the other generators that suit this task and this clip, best fit first. This is a quiet extra, not the centre (user, 2026-11-01): the curated picks stay what the preview is about. **There is no cap** (revised 2026-11-01): a cap ranked by fit hid the same low-prior generators on every run for a given kind of clip, which deleted them in practice. Past the picks the order is **stable**, not by fit: grouped by family (close / rhythm / experimental), then by name, so a generator found once is in the same place next time. The strip scrolls only past the picks, and its last cell reads `MORE` while there are more.
- **Suitable** means:
  - same task (Quantize, Variation/New Clip, Double);
  - the generator's `fit` > 0 for this clip and role;
  - drum generators only on drum tracks, melodic only on melodic tracks;
  - the generator produced a result the guard accepts.

  A generator whose take is refused is skipped silently, never shown empty.
- A generator beyond the picks is **generated when the jog lands on it**. Generation runs in tick slices, as the picks do. While it runs, the clip keeps playing the last option heard and the cell shows `...`.
- Each option keeps its own knobs and edits, as today. A parked session (leaving the track and coming back) restores the scrolled position.
- Touching the jog shows `GENERATOR: NAME` as today (#2).

### 2.3 Step 14: New Clip inside Variation (#4)

- **On an empty track**, Shift + hold Step 14 is New Clip as today.
- **On a track that has clips**, Shift + hold Step 14 on a slot gives Variation's picks with **1–2 New Clip options among them**:
  - the New Clip generator for the track's role (its clip is bass → BASS; chords → CHORDS or PAD; drums → GROOVE or DRUM MAP);
  - at the experimental end, one more New Clip of a neighbouring role.
- Scrolling past the picks reaches every other New Clip generator too (§2.2).
- The hold toast keeps saying `NEW CLIP` on an empty track and `VARIATION` otherwise.

### 2.4 Granular undo (#5)

The generator session joins movy's normal undo history.

- **Undo steps inside a session:**
  - **A knob gesture** is one step: from the first detent until the knob is released, or the toast times out with no turn.
  - **A hand edit** is one step: a pad, a step, or a held-step edit.
  - **An option switch** is one step: the jog landing on another option.
- **During the preview:**
  - **Undo** steps back one step, and **Shift + Undo** (redo) steps forward.
  - Undo past the session's first step returns to ORIG with the preview still open. One more Undo closes the preview, leaving the clip as it was before the generator ran.
- **Committing** (jog click or Back) is itself a step. **Undo right after committing reopens the preview** on that clip, on the committed option with its knobs and edits, and further Undos walk back through the session as above.
- **Edits made after the commit** are undone first, as normal history. When undo reaches the commit, the preview reopens.
- **Leaving and coming back** (a parked session) keeps the session's undo steps.
- **Only the clip's most recent generator session can be reopened.** A new generator run on that clip replaces the old session's steps with a single "before → after" step.
- **Performance:** an undo or redo inside a session swaps notes in place and in time, the same path an option switch uses: no regeneration, no audible gap. Snapshots hold notes and knob states. Cap a session at 128 steps; the oldest merge into the first.

### 2.5 Removing SAFE / BALANCED / WILD (#8)

The GENERATORS row leaves Settings, and the stored preference is ignored.
What the level did today, and where it goes:

| Today | After |
| --- | --- |
| Mix of the first picks (close / rhythm / exp), `select.ts` | Always BALANCED's mix. Scrolling reaches the rest. |
| Knob default shifts (AMOUNT, TENSION, HARMONY, LIKENESS, LOCK, ENDING, SEAMS), `preset.ts` | Gone. Defaults are BALANCED's. |
| WILD-only harmony: bolder moves in `plan.ts`, `create/plans.ts`, `theory/moves.ts`, EVOLVE | Placed at the **far end of the HARMONY knob** (and EVOLVE's MOVE), so they are a turn away for anyone. They are never a default and never a take's roll. |

### 2.6 Vocabulary (#7) and DRIFT replacing VARY

- **SPARSE → SPACE** everywhere: the knob name, labels and manual. The ladder (BREATH, LAY OUT…) is unchanged.
- **BUSY → DENSITY** (New Clip GROOVE). Any knob that means "how many notes" is DENSITY. AMOUNT stays only for "how much of the clip is rewritten". COUNT (ghost notes, an absolute number) stays.
- **VARY → DRIFT** on every New Clip generator, melodic and drums:
  - the slot becomes DRIFT, the existing walk of one small change per click, away from the take and back (`drift.ts`);
  - New Clip parts no longer vary bar to bar unless DRIFT does it.
- **Plain language (user, 2026-11-01).** The audience has little theory, so theory words go where a plain word says the same thing:

  | Today | After |
  | --- | --- |
  | TENSION (knob) | **COLOUR** (the labels CHORD TONES … CHROMATIC stay) |
  | CHANGES (knob) | **CHORD RATE** |
  | PITCH FIX (knob) | **FIX NOTES** |
  | RETROGRADE (generator) | **BACKWARDS** |
  | ORNAMENT (Variation) and EMBELLISH (Quantize) | **DECORATE** (one name for one idea) |
  | PEDAL / DRONE MOVE (merged) | **HOLD NOTE** |
  | HARMONY's value: progression names (ROAD, LAMENT, CIRCLE…) | **the chords themselves**, e.g. `AM F C G`. A loop of more than four chords shows its first four and `…`, within the toast's width. |

  The user kept GATE, VOICING, VOICES and REGISTER. The builder sweeps the generators for any other theory word in a knob value label and lists the candidates for the user, without renaming them.
- **Manual:** the knob table in `site/manual/generators.md`, the New Clip section, and the removal of "How bold".

### 2.7 Merges (user, 2026-11-01: "avoid an overlong list … I hope we don't lose much")

| Task | Merged | Into | Notes |
| --- | --- | --- | --- |
| Quantize (melodic + drums) | TIGHT, TIDY, GROOVE | **TIGHT** | 8 knobs: TIMING, DENSITY, FIX NOTES (drums: CLEAN), GRID, LENGTH, VELOCITY, CLEAN (melodic; drums: —), FEEL. Decided: TIDY's EVEN and GROOVE's DYNAMICS merge into one centred **VELOCITY** knob in slot 6 (left = EVEN, middle = as played, right = DYNAMICS). Melodic CLEAN stays a knob, in slot 7 where SWING was (revised 2026-11-02). Option 1 stays the tightest. |
| Quantize (melodic + drums) | FULL | — removed | Everything it bundled is now in TIGHT + DECORATE (drums: TIGHT + GHOSTS + FILL). |
| Quantize | MODE, INVERT | **MODE** | INVERT becomes a MODE choice (`MIRROR`), and PIVOT applies only to it. |
| Variation | DISPLACE, ANTICIPATE | **DISPLACE** | Slot 1 = MODE (SHIFT / PUSH); PUSH's amount shares SHIFT's knob. |
| Variation | SPREAD, RE-VOICE, REGISTER | **RE-VOICE** | SPREAD, TOP, RANGE, SPLIT, INTERVAL in their role slots; 9 candidates with HARMONY, COLOUR, CHORD RATE, DRIFT, so INTERVAL (REGISTER's) becomes positions of SPLIT. |
| Variation | OCTAVE BASS | **BASSLINE** | Octave figures become BASSLINE PATTERN positions. |
| Variation | PEDAL, DRONE MOVE | **HOLD NOTE** | NOTE, AMOUNT, SHARED, RANGE. |
| Variation (drums) | FILL, TURNAROUND | **FILL** | WHERE (end / a bar of the loop), SIZE, DENSITY, PADS. |
| Variation (drums) | KICK, HATS, GHOSTS, SHIFT | — **not merged** | Revised 2026-11-01. With it, drum Variation had 6 generators (FILL, FEEL, GRIDS, DEVELOP, STYLE, FORM) for 6 slots: every run showed the same six, and a refused take was filled by a second take of one generator. Without it there are 10. |
| Variation (drums) | EUCLID | **GRIDS** | Euclidean patterns become an area of the GRIDS X/Y map. |
| Double | TURN | **TURNAROUND** | MOVE in slot 1 (APPROACH's positions + TURN's moves). |
| Double (drums) | PICKUP | **FILL** | A pickup is FILL at its smallest ENDING; PUSH and HITS fold into FILL's knobs. |
| New Clip (drums) | GROOVE | **DRUM MAP** | DRUM MAP gains FILL (slot 6) and SEED; GROOVE's styles become DRUM MAP genres where missing. |

**No-loss rule (a test, not a hope):** for each removed generator and each
fixture it served, the merged generator has a knob state whose take is the
removed generator's default take, or its nearest neighbour under the bench's
difference measure (`select.ts` `difference` below `MIN_PAIR`). Before
deleting a generator, the builder records its default takes as fixtures
(`browser-test/` data) so the test compares against the old sound, not the
new code. A merge that cannot pass is reported to the user, not forced.

§4 lists each merged generator's knobs before the merge and the merged
generator's layout after it, slot by slot (§2.1).

### 2.8 Knob behaviour (user, 2026-11-01, third round)

- **SEED, ordered close → far.** On every generator that has a random roll,
  SEED makes about 16 takes and sorts them by `spread` (`select.ts`) from take
  #1: position 0 is the default take, and turning right gives takes further
  from it. Turning back still returns the same notes; a new run rolls a new set.
  The takes are made a few per UI tick (as the harmony map is staged), with a
  new `perf.mjs` check. Generators with no random choice (BACKWARDS,
  HALF/DOUBLE, MODE…) get no SEED.
- **SEED beats DRIFT** (user: "SEED gives more valuable options"). Where only
  one fits, SEED stays. Where both fit, SEED takes the end knob 8 and DRIFT
  moves to 6, or to 7 when 6 holds SPACE, DYNAMICS or SEAMS (my call). Generators without randomness keep DRIFT on 8.
- **HARMONY only where it applies.** New Clip melodic parts; on Variation, the
  track that leads the harmony (bass or chords), or any track when the scene's
  harmony is not locked. Elsewhere slot 3 stays dark and the part keeps
  COLOUR. Reason: per-track HARMONY on followers is the 2026-10-27 bug (set
  mmv41ucwf, every track reharmonised on its own), and the "knob changes
  something" test cannot catch it, since a clash is still a change.
- **CHORDS and PAD: the left ends mean "nothing moves".** PATTERN at its
  minimum holds each chord for as long as it lasts (one sustained chord per
  chord change). HARMONY at its minimum stays on the tonic (I, or i in minor)
  for the whole loop. Today position 0 of both maps is the first named figure
  or loop, not these: the builder adds them as position 0. Defaults do not
  move.
- **Quantize DENSITY is centred:** middle = the notes you played (the
  default), left = drop the weakest, right = add a few quiet in-between notes
  (DECORATE's ghost-note code). A timing fix never deletes notes by default.
- **Later, not this rework:** SPACE on existing clips (find the player's
  phrases by their gaps, add rests only at their ends; `create/phrase.ts`,
  `land.ts`).
- **Undo after committing reopens the preview** as §2.4 says. Considered and
  rejected (user): restoring the notes without the preview.

### 2.9 New Clip adopts five Variation generators (user, 2026-11-01)

New Clip had no selection: one take per generator, all shown, the same 8
melodic options in the same order every run (`create/takes.ts`
`selectCreate`). It gains the Variation generators that make a kind of part it
could not, from the scene's chords alone:

| Adopted | New part | Offered when |
| --- | --- | --- |
| **HOLD NOTE** | a drone, or a held/repeated note under the music | always |
| **PULSE** | a one-note rhythmic ostinato | always |
| **WALK** | a walking bass | always |
| **LOOPER** | a generated line that locks into a loop | always |
| **HARMONIZE**, **FOLLOW** | a second line moving with an existing melody | another melodic track plays |

- **Show all, no selection (user).** The strip shows every suitable New Clip
  generator: today's 8 first, in today's order, then the adopted ones in the
  order above. It scrolls past 8 cells like §2.2, without a `MORE` cap.
- Each adopted generator gets a no-clip path: its first note from the scene's
  chords, its rhythm from the pattern map (HOLD NOTE, PULSE, LOOPER small;
  WALK, HARMONIZE, FOLLOW medium). On New Clip they follow the New Clip
  layout (§4) and get SPACE, as New Clip parts do.
- The guard and `fresh` rule apply as today: a take that copies a recent one
  is re-rolled, and one that the guard refuses is not shown.
- **Performance:** up to 14 takes instead of 8, still one per UI tick, so a
  New Clip opens up to ~1.75x later. `perf.mjs` gets a check for the full
  set, and the first 8 are made first so the strip plays while the rest arrive.
- Drums adopt nothing: the drum Variation generators that work from nothing
  (GRIDS, EUCLID) are what DRUM MAP and EUCLID KIT already are.

## 3. Undo flow (worked example)

```
New Clip → option 3 (BASS) → turn DENSITY → edit step 5 → turn GATE → jog click (commit)
Undo  → preview reopens: BASS with GATE turned, step 5 edited
Undo  → GATE back
Undo  → step 5 edit gone
Undo  → DENSITY back
Undo  → option 2 (the option switch back)   … → ORIG (preview open)
Undo  → preview closes; the clip is as before New Clip
Shift+Undo walks forward the same way.
```

## 4. Knobs per generator: before and after (to confirm)

For every generator: the knobs it has today, in today's order, and the
layout after the rework, by slot (§2.1). The user marks changes here.
`—` = an empty slot (LED dark). **⚑** = a trade for the user to decide.
`†` = HARMONY shown only where it applies (§2.8). Read from the code on
2026-11-02 (`src/gen/presets/*`, with `withSeed`/`withDrift`/`withFeel`
applied).

**Placement rules applied to every row** (from §2.1 and §2.8):

- SEED takes slot 8 wherever the generator has one.
- DRIFT takes slot 8 when there is no SEED. When there is one, DRIFT goes to 6, or to 7 when 6 holds SPACE or SEAMS. **My call:** §2.8 said "6", and on New Clip slot 6 is SPACE, a core knob.
- **No SWING anywhere** (user, 2026-11-02): the set's swing applies at playback (§2.1). DYNAMICS sits in slot 7 where that is free, else in 6.
- **No knob is dropped while a slot is dark** (user, 2026-11-02): it takes the nearest empty slot.

### 4.0 Shared knobs: what they control

Described once here. Under each generator, only that generator's own knobs get a description.

| Knob today → after | Controls | Values (default) |
| --- | --- | --- |
| HARMONY (Variation, Double) | the chord progression the part is re-written over: the scene's own, or a reharmonisation of it | the plans for this scene (scene's) → after: shows the chords, e.g. `AM F C G` |
| HARMONY (New Clip) | the progression the new part plays | the scene's, or the generated loops when the scene has none |
| CHANGES → **CHORD RATE** | how often the chords change under the part | AS PLAYED / APPROACH (a passing chord before each change) / APPROACH + BEAT / EVERY HALF BAR |
| TENSION → **COLOUR** | which notes a re-pitched note may land on | 0–3 chord tones, 4–6 colour (7ths, 9ths), 7–8 approach notes, 9–10 chromatic |
| RHYTHM | reshapes the part's rhythm | KEEP, PUSH, SYNCOPATE, DOUBLE, HALF, COMP, EUCLID, SHUFFLE, CYCLE 3/5/6/7 (a figure of N 16ths cycling over the bar) |
| VOICES | notes per chord | −1, AS IS, +1, +2, +3 |
| RANGE | how wide the part spreads in pitch | ×0.5 … ×3 (AS IS in the middle) |
| LENGTH (centred) | note lengths | −100 % … +100 % (AS IS in the middle) |
| DENSITY (centred) | fewer or more notes than the part has | −100 % … +100 % (AS IS in the middle) |
| DYNAMICS | velocity shaping, not a level: blends the velocities as written (0) toward an accent pattern on the beat (100 %): downbeats louder, off-16ths softer | 0–100 % |
| AMOUNT | how much of the clip is changed (Variation); a count of changes (Quantize mutations) | 0–100 %, or 0–10 / 0–16 |
| SEED | which random take | #1 … #100 → after: ordered close → far (§2.8) |
| DRIFT | one small change per click, away from the take and back (`drift.ts`) | OFF … +20 |
| TIMING (Quantize) | how far notes are pulled to the grid | 0–100 % (100 %) |
| SWING → **removed** | today: swing written into the notes | after: none; the set's swing swings every clip at playback |
| GRID (Quantize) | the grid notes are pulled to | 1/8, 1/8T, 1/16, 1/16T, 1/32 (the scene's) |
| PITCH FIX → **FIX NOTES** | how many off-harmony notes are corrected, worst first | OFF / 1 NOTE … / ALL |
| CLEAN (Quantize) | removes doubles and flams on one pad (window up to a 16th) and grazes quieter than up to 45 % of the median velocity | 0–100 % |
| EVEN (Quantize) | pulls velocities to the median | 0 as played … 10 all equal |
| FEEL (Quantize) | the timing pocket | STRAIGHT, SCENE, LAID BACK, PUSHED, SHUFFLE, DRUNK 16THS |
| LIKENESS | how close a walk in the part's learned style stays to the part | 0–100 % |
| PHRASE | bars the learned walk writes before repeating | 1 BAR / 2 BARS |
| ENDING (Double) | how much of the end of the doubled clip is rewritten | ½ BEAT, 1 BEAT, 2 BEATS, 1 BAR (2 BEATS) |
| SEAMS (Double) | rewrite the end of the second half only, or of both halves | END / BOTH |
| GATE (New Clip) | how much of the gap to the next note a note holds | 0 % … HELD |
| VARY (New Clip) → **DRIFT** | today: bar-to-bar changes (a hit dropped, pushed a 16th, repeated, held longer/shorter), one more event per click | 0–100 % (0) |
| STRUM (New Clip) | the chord's notes spread in time | OFF, 2–12 TICKS, UP 6/12, ROLL, SLOP, HARP, HARP 2X |
| SPARSE → **SPACE** (New Clip) | phrasing: the part played in phrases with rests that land | ALL, BREATH, LAY OUT, CALL+ANSWER, A_A_, HOOK, LEAD-IN, CHANGES, DUB … (per part) |
| HUMAN (New Clip drums) | random timing and velocity | 0–100 % (0) |
| VOICING (New Clip) | the chord shape | 12 shapes, DUO … NEO SOUL |
| REGISTER / OCTAVE (New Clip) | where the part sits | DEEP … TOP |

### 4.1 New Clip, melodic

**Changes for every row:**

- VARY becomes DRIFT, in slot 8 (or 7 next to SEED).
- SPARSE becomes SPACE, in slot 6.
- HARMONY moves to slot 3.
- Each core knob is in its role's slot.

**CHORDS:** block chords on a comping pattern.
- Before: PATTERN (a position on the comp map, 122 positions), VOICING, REGISTER, HARMONY, GATE, VARY, DENSITY (in SWING's place since 2026-11-01: the pattern thinned or filled, −5…+5), SPARSE.
- After: 1 PATTERN · 2 DENSITY · 3 HARMONY · 4 REGISTER · 5 GATE · 6 SPACE · 7 VOICING · 8 DRIFT.
- PATTERN's and HARMONY's left ends mean "nothing moves" (§2.8). Follows the set's swing.

**PAD:** held chords.
- Before: VOICING, MOTION (how the voices move between chords: SMOOTH, TOP LINE, CLIMB, ARCH, FALL, PARALLEL), REGISTER, HARMONY, GATE, PATTERN (in VARY's place: HELD, BAR, HALVES, 3-3-2, CHARLESTON, PUSH, 2+4), STRUM, SPARSE.
- After: 1 PATTERN · 2 VOICING · 3 HARMONY · 4 REGISTER · 5 GATE · 6 SPACE · 7 STRUM · 8 DRIFT.
- MOTION is fixed at SMOOTH (decided). PATTERN's left end = HELD.

**STABS:** short chords on an off-beat pattern.
- Before: PATTERN (104 positions), VOICING, REGISTER, HARMONY, GATE, VARY, SWING, SPARSE.
- After: 1 PATTERN · 2 DENSITY (new, as CHORDS) · 3 HARMONY · 4 REGISTER · 5 GATE · 6 SPACE · 7 VOICING · 8 DRIFT.
- SWING goes (decided); the set's swing applies.

**BASS:** a bassline from the bass pattern map.
- Before: PATTERN (128 positions), NOTES (AS WRITTEN, ROOTS, CHORD TONES, OCTAVES), OCTAVE, HARMONY, GATE, VARY, SWING, SPARSE.
- After: 1 PATTERN · 2 NOTES · 3 HARMONY · 4 OCTAVE · 5 GATE · 6 SPACE · 7 DYNAMICS · 8 DRIFT.

**ARP:** an arpeggio over the chords.
- Before: STYLE (UP, DOWN, UP-DOWN, ORDER, PINKY, BROKEN), RATE (1/4 … 1/16T), OCTAVES (1 … 4), HARMONY, GATE, VARY, SWING, SPARSE.
- After: 1 STYLE · 2 RATE · 3 HARMONY · 4 OCTAVES · 5 GATE · 6 SPACE · 7 DYNAMICS · 8 DRIFT.

**MELODY:** a phrase on a contour, answered.
- Before: CONTOUR (ARCH, RISE, FALL, WAVE, ZIGZAG), DENSITY (0–10, notes per phrase), RANGE (4TH … 2 OCT), SEED, GATE, VARY, SWING, SPARSE.
- After: 1 CONTOUR · 2 DENSITY · 3 HARMONY (new) · 4 RANGE · 5 GATE · 6 SPACE · 7 DRIFT · 8 SEED.
- Follows the set's swing.

**RIFF:** a short cell repeated through the chords.
- Before: CELL (1 BEAT, 2 BEATS, 3/8, 1 BAR), NOTES (0–6, distinct pitches in the cell), REGISTER, SEED, GATE, VARY, SWING, SPARSE.
- After: 1 CELL · 2 NOTES · 3 HARMONY (new) · 4 REGISTER · 5 GATE · 6 SPACE · 7 DRIFT · 8 SEED.
- Follows the set's swing.

**COUNTER:** a line moving where the band leaves room.
- Before: RATE (QUARTERS, 8THS, DOTTED, 16THS), MOTION (STEPS, MIXED, LEAPS), REGISTER, SEED, GATE, VARY, SWING, SPARSE.
- After: 1 RATE · 2 DENSITY (was MOTION: how much it moves) · 3 HARMONY (new) · 4 REGISTER · 5 GATE · 6 SPACE · 7 DRIFT · 8 SEED.
- Follows the set's swing. The builder checks that STEPS…LEAPS survive as DENSITY positions.

**Adopted from Variation (§2.9): New Clip layouts, my proposal ⚑.** None has a New Clip "before". Each takes GATE in place of LENGTH and gains SPACE.

| Generator | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | Not carried over |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| HOLD NOTE | NOTE | — | HARMONY | REGISTER | GATE | SPACE | SHARED | DRIFT | AMOUNT, SEED (nothing to rewrite) |
| PULSE | PATTERN | DENSITY | HARMONY | OCTAVE | GATE | SPACE | NOTE | DRIFT | RHYTHM, CHORD RATE, DYNAMICS |
| WALK | PATTERN | DENSITY | HARMONY | OCTAVE | GATE | SPACE | COLOUR | SEED | AMOUNT, DRIFT |
| LOOPER | LOOP | LOCK | HARMONY | SPREAD | GATE | SPACE | CLOCK | SEED | DENSITY, COLOUR |
| HARMONIZE | INTERVAL | AMOUNT | HARMONY | — | GATE | SPACE | COLOUR | DRIFT | — |
| FOLLOW | DIRECTION | DENSITY | HARMONY | VOICES | GATE | SPACE | COLOUR | DRIFT | RHYTHM, CHORD RATE (it follows the melody's) |

### 4.2 New Clip, drums

**Changes for every row:**

- VARY becomes DRIFT.
- SEED goes to slot 8 and DRIFT to 6 or 7.
- SWING goes; DYNAMICS takes slot 7 (user, 2026-11-02).

**PAD EUCLID:** one pad, hits spread evenly. Per pad.
- Before: DENSITY (0–10, hits on this pad; 0 removes the pad), ROTATE (0–15), ACCENT (FLAT, DOWNBEAT, ROLLING, RANDOM), RATE (1/16, 1/8, 1/8T), VARY, SWING, DYNAMICS, HUMAN.
- After: 1 DENSITY · 2 ROTATE · 3 ACCENT · 4 RATE · 5 HUMAN · 6 — · 7 DYNAMICS · 8 DRIFT.
- It gets no SEED: its only random part is ACCENT RANDOM. **My call:** this fixes the old table, which gave it a SEED it never had and dropped DYNAMICS.

**PAD PATTERN:** one pad, in a style. Per pad.
- Before: DENSITY (as above), STYLE (STRAIGHT, OFFBEAT, SYNCOPATED, BROKEN, GALLOP), FILL (NONE, LAST BEAT, LAST BAR), SEED, VARY, SWING, DYNAMICS, HUMAN.
- After: 1 DENSITY · 2 STYLE · 3 FILL · 4 — · 5 HUMAN · 6 DRIFT · 7 DYNAMICS · 8 SEED.

**GROOVE:** a genre's whole-kit pattern. Merged into DRUM MAP (§2.7).
- Before: STYLE (FOUR FLOOR, DISCO, BACKBEAT, 2-STEP, BREAKBEAT, HALF TIME, TRAP, BROKEN BEAT), BUSY (0–10, how many hits), FILL (NONE, SNARE, TOMS), SEED, VARY, SWING, DYNAMICS, HUMAN.
- After: gone. STYLE becomes DRUM MAP GROOVE positions where missing, FILL moves to DRUM MAP, and BUSY is covered by DRUM MAP's three counts.

**DRUM MAP:** whole kit from the genre map, after Grids.
- Before: GROOVE (57 map positions), KICK (0–8 hits), SNARE (0–8), HATS (0–16), VARY, SWING, DYNAMICS, HUMAN.
- After: 1 GROOVE · 2 KICK · 3 SNARE · 4 HATS · 5 HUMAN · 6 FILL (from GROOVE) · 7 DYNAMICS · 8 SEED (from GROOVE).
- **⚑ Nine knobs for eight slots: DRIFT is the one dropped** (SEED beats DRIFT, §2.8). The alternative is to drop SEED, which DRUM MAP only gains from GROOVE.
- **My call:** §2.7 put FILL in slot 4, which clashed with "three counts in 2–4". FILL goes to 6.

**EUCLID KIT:** every voice spread evenly.
- Before: KICK (0–8), SNARE (0–4), HATS (0–16), SHIFT (0–7, voices rotated against each other), VARY, SWING, DYNAMICS, HUMAN.
- After: 1 KICK · 2 SNARE · 3 SHIFT · 4 HATS · 5 HUMAN · 6 — · 7 DYNAMICS · 8 DRIFT.
- Nothing lost.

**BROKEN:** the kick on the band's accents, the snare off its post.
- Before: DENSITY (0–10), SYNC (0–10, how far off the grid posts), GHOSTS (0–10), SEED, VARY, SWING, DYNAMICS, HUMAN.
- After: 1 SYNC · 2 DENSITY · 3 GHOSTS · 4 — · 5 HUMAN · 6 DRIFT · 7 DYNAMICS · 8 SEED.

**PERC:** the kit's other voices.
- Before: DENSITY (0–10), PADS (0–4, how many voices), ACCENT (FLAT, DOWNBEAT, RANDOM), SEED, VARY, SWING, DYNAMICS, HUMAN.
- After: 1 — · 2 DENSITY · 3 ACCENT · 4 PADS · 5 HUMAN · 6 DRIFT · 7 DYNAMICS · 8 SEED.

### 4.3 Smart Quantize

**Changes for every row:**

- Slot 1 is always TIMING (HUMANIZE: LOOSE).
- PITCH FIX becomes FIX NOTES.
- DENSITY (centred) goes into slot 2 wherever that slot is free and it is musical. Rows mark this as "(DENSITY)".
- No DRIFT, as today.

**TIGHT** (melodic): notes onto the grid, slips off the harmony fixed. **Merged with TIDY and GROOVE (§2.7).**
- Before: TIMING, SWING, GRID, PITCH FIX, DENSITY.
- After: 1 TIMING · 2 DENSITY · 3 FIX NOTES · 4 GRID · 5 LENGTH (from TIDY) · 6 VELOCITY (new, centred: left = TIDY's EVEN, right = GROOVE's DYNAMICS) · 7 CLEAN (TIDY's, kept as a knob) · 8 FEEL (from GROOVE).

**TIDY** (melodic): on the grid, cleaned, velocities evened. Merged into TIGHT.
- Before: TIMING, CLEAN, EVEN, LENGTH (default +20 %), DENSITY.
- After: gone. CLEAN moves to TIGHT's slot 7, EVEN moves to TIGHT's VELOCITY left half, and LENGTH and DENSITY move to TIGHT.

**GROOVE** (melodic): on the scene's pocket with accents. Merged into TIGHT.
- Before: TIMING (90 %), SWING, DYNAMICS (60 %), FEEL, DENSITY.
- After: gone. FEEL moves to TIGHT, SWING goes (the set's swing), and DYNAMICS moves to VELOCITY's right half.

**SHAPED:** chords filled out and voice-led; a line's stray octave leaps folded back.
- Before: TIMING, PITCH FIX, VOICING (0–10, how far chords are filled and led), LENGTH.
- After: 1 TIMING · 2 (DENSITY) · 3 FIX NOTES · 4 VOICING · 5 LENGTH · 6 — · 7 — · 8 —.

**EMBELLISH → DECORATE:** grace, passing or neighbour notes added.
- Before: TIMING, AMOUNT (0–16 notes added), KIND (GRACE, PASSING, NEIGHBOUR), PITCH FIX, SEED.
- After: 1 TIMING · 2 AMOUNT · 3 FIX NOTES · 4 KIND · 5 — · 6 — · 7 — · 8 SEED.

**ANSWER** (Quantize): the second half answers the first, moved by scale steps.
- Before: TIMING, SPLIT (where the answer starts: 1/4, 1/2, 3/4), STEP (−2 … +2 scale steps), PITCH FIX, RHYTHM (reshapes the answer only), LENGTH, DENSITY, DYNAMICS.
- After: 1 TIMING · 2 DENSITY · 3 FIX NOTES · 4 SPLIT · 5 LENGTH · 6 DYNAMICS · 7 RHYTHM · 8 STEP.

**FULL** (melodic): everything at once. **Removed (§2.7).**
- Before: TIMING, SWING, GRID, PITCH FIX, EMBELLISH (0–16), DYNAMICS, LENGTH, RHYTHM.
- After: gone. TIGHT covers TIMING, GRID, FIX NOTES, LENGTH and DYNAMICS, and DECORATE covers EMBELLISH. **⚑ RHYTHM on a quantized clip is not carried anywhere.**

**MUTATE:** some pitches changed by scale steps.
- Before: TIMING, AMOUNT (0–10 notes), STEPS (1–4, how far they move), SEED.
- After: 1 TIMING · 2 AMOUNT · 3 — · 4 STEPS · 5 — · 6 — · 7 — · 8 SEED.

**MODE:** the clip moved into another mode. **Merged with INVERT (§2.7).**
- Before: TIMING, MODE (PARALLEL, DORIAN, PHRYGIAN, LYDIAN, MIXOLYDIAN, HARMONIC, MELODIC, LOCRIAN), WHERE (ALL, 2ND HALF, ODD BARS, LAST BAR), DYNAMICS.
- After: 1 TIMING · 2 — · 3 MODE (+ MIRROR, INVERT's) · 4 WHERE · 5 — · 6 DYNAMICS · 7 PIVOT (MIRROR only) · 8 —.

**INVERT:** the contour mirrored around a pivot. Merged into MODE.
- Before: TIMING, WHERE, PIVOT (FIRST, LOW, MID, HIGH), PITCH FIX.
- After: gone (MODE = MIRROR). **⚑ PITCH FIX is fixed at its default for MIRROR**, as every other mutation starts from TIGHT's default fix.

**OCTAVES:** some notes jump an octave.
- Before: TIMING, AMOUNT (0–10 notes), DIRECTION (UP, DOWN, BOTH), SEED.
- After: 1 TIMING · 2 AMOUNT · 3 — · 4 DIRECTION · 5 — · 6 — · 7 — · 8 SEED.

**RATCHET:** some notes repeated fast.
- Before: TIMING, AMOUNT (0–10 notes), RATE (1/32, 1/16T, 1/16), DECAY (0–10, repeats fading).
- After: 1 TIMING · 2 AMOUNT · 3 — · 4 RATE · 5 DECAY · 6 — · 7 — · 8 —.

**SHIFT:** the clip moved in the bar.
- Before: TIMING, STEPS (−4 … +4 sixteenths), KEEP (NONE, DOWNBEATS stay put), LENGTH.
- After: 1 TIMING · 2 (DENSITY) · 3 — · 4 STEPS · 5 LENGTH · 6 — · 7 KEEP · 8 —.

**HUMANIZE:** played looser.
- Before: LOOSE (0–10, timing spread), VELOCITY (0–10, velocity spread), LENGTH (0–10, length spread), SEED.
- After: 1 LOOSE · 2 — · 3 — · 4 — · 5 LENGTH · 6 — · 7 VELOCITY · 8 SEED.

**TIGHT (drums):** hits onto the grid. **Merged with TIDY and GROOVE.**
- Before: TIMING, SWING, GRID (default 1/8), CLEAN (30 %), DENSITY (thin the weakest hits / fill gaps).
- After: 1 TIMING · 2 DENSITY · 3 CLEAN · 4 GRID · 5 — · 6 VELOCITY (EVEN ← middle → DYNAMICS) · 7 — · 8 FEEL.

**TIDY (drums):** on the grid, cleaned hard, velocities evened. Merged into TIGHT.
- Before: TIMING, CLEAN (80 %), EVEN, GRID, DENSITY.
- After: gone. **⚑ TIDY's harder CLEAN default (80 % vs 30 %) is one turn of TIGHT's CLEAN**; the no-loss test checks it.

**GROOVE (drums):** on a pocket with accents. Merged into TIGHT.
- Before: TIMING (90 %), SWING, DYNAMICS, FEEL (default STRAIGHT), DENSITY.
- After: gone (into TIGHT's FEEL and VELOCITY; SWING goes).

**GHOSTS (drums):** quiet ghost notes added.
- Before: TIMING, COUNT (0–16 ghosts), LEVEL (20–50, their velocity), SEED.
- After: 1 TIMING · 2 COUNT · 3 LEVEL · 4 — · 5 — · 6 — · 7 — · 8 SEED.

**FILL (drums, Quantize):** a fill written into the end.
- Before: TIMING, SIZE (½ BEAT … 1 BAR), DENSITY, SEED.
- After: 1 TIMING · 2 DENSITY · 3 — · 4 SIZE · 5 — · 6 — · 7 — · 8 SEED.

**FULL (drums):** everything at once. **Removed.**
- Before: TIMING, SWING, GRID, CLEAN, GHOSTS (0–16), DYNAMICS, FILL (NONE … 2 BEATS), SEED.
- After: gone. TIGHT covers the timing, CLEAN and DYNAMICS, GHOSTS covers its ghosts, and FILL covers its fill.

**MUTATE (drums):** some hits moved to a neighbouring step.
- Before: TIMING, AMOUNT (0–10 hits), MOVE (1/16, 1/8, EITHER), SEED.
- After: 1 TIMING · 2 AMOUNT · 3 MOVE · 4 — · 5 — · 6 — · 7 — · 8 SEED.

**RATCHET (drums):** some hits rolled into ratchets.
- Before: TIMING, AMOUNT (0–10), RATE (1/32, 1/16T, 1/16), PAD (HATS, SNARE, ANY).
- After: 1 TIMING · 2 AMOUNT · 3 RATE · 4 PAD · 5 — · 6 — · 7 — · 8 —.

**HUMANIZE (drums):** played looser.
- Before: LOOSE, VELOCITY, LENGTH, SEED (as melodic).
- After: 1 LOOSE · 2 — · 3 — · 4 — · 5 LENGTH · 6 — · 7 VELOCITY · 8 SEED.

### 4.4 Variation, melodic

**Changes for every row:**

- TENSION becomes COLOUR (slot 7) and CHANGES becomes CHORD RATE (slot 8 when there is no DRIFT).
- HARMONY is in slot 3, shown only where it applies (†).
- SEED goes to 8 and DRIFT to 6 (§2.8).
- `?` marks a second "how much" knob that the builder places in the nearest free slot (§6).

**NEXT CHORDS:** the part's rhythm kept, new notes from the new harmony.
- Before: HARMONY, CHANGES, TENSION, RHYTHM, VOICES, RANGE, LENGTH, DENSITY.
- After: 1 RHYTHM · 2 DENSITY · 3 HARMONY† · 4 RANGE · 5 LENGTH · 6 VOICES · 7 COLOUR · 8 CHORD RATE.

**FOLLOW:** a second line moving with another track's melody.
- Before: HARMONY, CHANGES, TENSION, DIRECTION (NEAREST, UP, DOWN: where it sits against the melody), RHYTHM, VOICES, LENGTH, DENSITY.
- After: 1 DIRECTION · 2 DENSITY · 3 HARMONY† · 4 VOICES · 5 LENGTH · 6 RHYTHM · 7 COLOUR · 8 CHORD RATE.

**PULSE:** a one-note rhythmic ostinato.
- Before: NOTE (ROOT, FIFTH, THIRD), OCTAVE (LOW, MIDDLE, HIGH, OCTAVE UP), HARMONY, LENGTH, RHYTHM, CHANGES, DENSITY, DYNAMICS.
- After: 1 NOTE · 2 DENSITY · 3 HARMONY† · 4 OCTAVE · 5 LENGTH · 6 DYNAMICS · 7 RHYTHM · 8 CHORD RATE.

**HARMONIZE:** a parallel line a 3rd, 6th or 10th away.
- Before: INTERVAL (3RD UP, 6TH UP, 3RD DOWN, 6TH DOWN, 10TH UP), AMOUNT (share of notes harmonised), HARMONY, TENSION, DRIFT.
- After: 1 INTERVAL · 2 AMOUNT · 3 HARMONY† · 4 — · 5 — · 6 — · 7 COLOUR · 8 DRIFT.

**RE-VOICE:** chords inverted up or down; a line's contour mirrored. **Absorbs SPREAD and REGISTER (§2.7).**
- Before: AMOUNT (share of events changed), HARMONY, RANGE, SEED, DRIFT.
- After: 1 SPREAD (SPREAD's: CLOSE, DROP 2, DROP 2+4, WIDE) · 2 AMOUNT · 3 HARMONY† · 4 SPLIT (REGISTER's, with its INTERVAL moves as positions) · 5 TOP (SPREAD's) · 6 RANGE · 7 COLOUR · 8 SEED.
- **⚑ Dropped:** DRIFT (RE-VOICE's), CHORD RATE, RHYTHM, VOICES and LENGTH (SPREAD's). Their defaults are AS IS, so the no-loss test on default takes still passes, but the turns are gone.

**SPREAD:** chords opened into drop voicings, the top voice led on its own. Merged into RE-VOICE.
- Before: SPREAD, TOP (HOLD, STEP, FREE: the top voice), HARMONY, TENSION, RHYTHM, CHANGES, VOICES, LENGTH.
- After: gone. See RE-VOICE.

**REGISTER:** from SPLIT on, the part answers in another register. Merged into RE-VOICE.
- Before: SPLIT (1/4, 1/2, 3/4), INTERVAL (−2 OCT … +2 OCT, incl. 4th and 5th), HARMONY, RANGE, DRIFT.
- After: gone. See RE-VOICE.

**NEW LINE:** the rhythm kept, a new line walked over the chord tones.
- Before: HARMONY, TENSION, STEP (1–7, largest leap in chord tones), SEED, RHYTHM, CHANGES, LENGTH, DENSITY.
- After: 1 STEP · 2 DENSITY · 3 HARMONY† · 4 CHORD RATE (the empty slot; SEED holds 8) · 5 LENGTH · 6 RHYTHM · 7 COLOUR · 8 SEED.

**ANSWER:** call and response; the start stays, the rest answers by scale steps.
- Before: SPLIT, STEP (−3 … +3), HARMONY, TENSION, RHYTHM, CHANGES, LENGTH, DENSITY.
- After: 1 SPLIT · 2 DENSITY · 3 HARMONY† · 4 STEP · 5 LENGTH · 6 RHYTHM · 7 COLOUR · 8 CHORD RATE.

**ARP:** the part's chords arpeggiated.
- Before: PATTERN (UP, DOWN, UP-DOWN, DOWN-UP, CONVERGE, RANDOM), RATE (1/8 … 1/32), OCTAVES (1 … 4), HARMONY, DRIFT.
- After: 1 PATTERN · 2 RATE · 3 HARMONY† · 4 OCTAVES · 5 — · 6 — · 7 — · 8 DRIFT.

**DRONE MOVE:** a drone re-placed on every chord change. **Merged with PEDAL into HOLD NOTE.**
- Before: NOTE (PIVOT = a tone the chords share, ROOT, FIFTH, THIRD), SHARED (TIE, RESTRIKE a shared tone), HARMONY, LENGTH, DRIFT.
- After: gone. See HOLD NOTE.

**PEDAL:** a held note that lines alternate with, a bass returns to, or chords keep on top. Merged into HOLD NOTE.
- Before: AMOUNT, NOTE (TONIC, FIFTH, CHORD ROOT), HARMONY, RANGE, SEED, DRIFT.
- After: gone. See HOLD NOTE.

**HOLD NOTE** (new: PEDAL + DRONE MOVE).
- After: 1 NOTE (PIVOT, ROOT, FIFTH, THIRD, TONIC, CHORD ROOT) · 2 AMOUNT · 3 HARMONY† · 4 RANGE · 5 LENGTH · 6 DRIFT · 7 SHARED · 8 SEED.

**BASSLINE:** the bass re-written on a bass figure. **Absorbs OCTAVE BASS.**
- Before: PATTERN (OFFBEAT, ROLLING, OCTAVES, ROOT-FIFTH, 3-3-2, GALLOP, HALF NOTES, WALK, PUMP 8THS), NOTES (AS WRITTEN, ROOTS ONLY, MORE FIFTHS, CHORD TONES), HARMONY, CHANGES, LENGTH, OCTAVE (−1, AS IS, +1), DYNAMICS, SHIFT (0 … +3/16, the figure displaced).
- After: 1 PATTERN (+ OCTAVE BASS's figures) · 2 NOTES · 3 HARMONY† · 4 OCTAVE · 5 LENGTH · 6 DYNAMICS · 7 SHIFT · 8 CHORD RATE.

**OCTAVE BASS:** chosen bass notes jump up an octave. Merged into BASSLINE.
- Before: AMOUNT, PATTERN (OFFBEATS, ALTERNATE, LAST, RANDOM), HARMONY, LENGTH, SEED, DRIFT.
- After: gone. Its figures become BASSLINE PATTERN positions. **⚑ AMOUNT, SEED and DRIFT do not carry over.**

**DISPLACE:** some notes shifted in time. **Absorbs ANTICIPATE.**
- Before: AMOUNT, SHIFT (−8/16 … +8/16), HARMONY, SEED, DRIFT.
- After: 1 MODE (SHIFT, PUSH) · 2 AMOUNT · 3 HARMONY† · 4 SHIFT (in PUSH mode: PUSH's sizes) · 5 LENGTH (ANTICIPATE's) · 6 DRIFT · 7 COLOUR (ANTICIPATE's) · 8 SEED.

**ANTICIPATE:** chord changes pushed early, the note keeping its end. Merged into DISPLACE.
- Before: PUSH (1/32, 1/16, 1/8, 1/4), HARMONY, LENGTH, TENSION, DRIFT.
- After: gone. See DISPLACE (MODE = PUSH).

**CONNECT:** passing and approach notes into the strong beats; chords get a suspended voice.
- Before: AMOUNT, HARMONY, TENSION, LENGTH, SEED, DRIFT.
- After: 1 — · 2 AMOUNT · 3 HARMONY† · 4 — · 5 LENGTH · 6 DRIFT · 7 COLOUR · 8 SEED.

**RECOMBINE:** one dimension of the notes re-dealt among them (after Live's Recombine).
- Before: DIM (PITCH, LENGTH, VELOCITY, POSITION), ROTATE (0–7), AMOUNT (how much is shuffled), HARMONY, SEED, DRIFT.
- After: 1 DIM · 2 AMOUNT · 3 HARMONY† · 4 ROTATE · 5 — · 6 DRIFT · 7 — · 8 SEED.

**EUCLID:** the notes in order on a Euclidean rhythm.
- Before: PULSES (1–16 per bar), ROTATE (0–15), HARMONY, LENGTH, DRIFT.
- After: 1 PULSES · 2 — · 3 HARMONY† · 4 ROTATE · 5 LENGTH · 6 — · 7 — · 8 DRIFT.

**COMP:** chord rhythms from the comp map.
- Before: PATTERN (122 positions), HARMONY, CHANGES, TENSION, VOICES, LENGTH, DYNAMICS, RANGE.
- After: 1 PATTERN · 2 VOICES · 3 HARMONY† · 4 RANGE · 5 LENGTH · 6 DYNAMICS · 7 COLOUR · 8 CHORD RATE.

**WALK:** a walking approach into each chord change.
- Before: AMOUNT (how many notes before a change walk), TENSION, HARMONY, DENSITY, SEED, DRIFT.
- After: 1 — · 2 DENSITY · 3 HARMONY† · 4 AMOUNT? · 5 — · 6 DRIFT · 7 COLOUR · 8 SEED.

**THIN:** only the strongest notes, held longer.
- Before: AMOUNT (how much is removed), HARMONY, LENGTH (+40 %), RANGE, SEED, DRIFT.
- After: 1 — · 2 AMOUNT · 3 HARMONY† · 4 RANGE · 5 LENGTH · 6 DRIFT · 7 — · 8 SEED.

**MOTIF:** the opening cell repeated as a sequence through the scale.
- Before: CELL (1 BEAT, 2 BEATS, 1 BAR, 2 BARS), STEP (−4 … +4 scale steps per repeat), HARMONY, TENSION, DRIFT.
- After: 1 CELL · 2 — · 3 HARMONY† · 4 STEP · 5 — · 6 — · 7 COLOUR · 8 DRIFT.

**RETROGRADE → BACKWARDS:** pitches reversed inside each span; the rhythm stays.
- Before: AMOUNT (share of spans), SPAN (HALF BAR, BAR, 2 BARS), HARMONY, RANGE, SEED, DRIFT.
- After: 1 SPAN · 2 AMOUNT · 3 HARMONY† · 4 RANGE · 5 — · 6 DRIFT · 7 — · 8 SEED.

**HALF/DOUBLE:** half time or double time from a starting point.
- Before: SPEED (HALF, DOUBLE), FROM (START, 1/4, 1/2, 3/4), HARMONY, LENGTH, DRIFT.
- After: 1 SPEED · 2 — · 3 HARMONY† · 4 FROM · 5 LENGTH · 6 — · 7 — · 8 DRIFT.

**ORNAMENT → DECORATE:** ornaments on the strongest notes.
- Before: AMOUNT, KIND (GRACE, TURN, MORDENT, RESTRIKE), HARMONY, TENSION, SEED, DRIFT.
- After: 1 KIND · 2 AMOUNT · 3 HARMONY† · 4 — · 5 — · 6 DRIFT · 7 COLOUR · 8 SEED.

**DEVELOP:** the part developed: rhythm, chords and notes moved a little.
- Before: AMOUNT, HARMONY, CHANGES, TENSION, RHYTHM (default SYNCOPATE), DENSITY, RANGE, SEED.
- After: 1 RHYTHM · 2 AMOUNT · 3 HARMONY† · 4 RANGE · 5 DENSITY? · 6 CHORD RATE · 7 COLOUR · 8 SEED.

**STYLE:** a new part walked in the part's learned style.
- Before: LIKENESS, PHRASE, DENSITY, HARMONY, CHANGES, TENSION, RANGE, SEED.
- After: 1 PHRASE · 2 LIKENESS · 3 HARMONY† · 4 RANGE · 5 DENSITY? · 6 CHORD RATE · 7 COLOUR · 8 SEED.

**LOOPER:** a locked loop after the Turing Machine; LOCK sets how often a step is rewritten as it passes.
- Before: LOCK (0–10), LOOP (3–16 steps; polymeter where it does not divide 16), CLOCK (1/16, 1/8, 1/4), SPREAD (0–10, pitch range in scale steps), DENSITY, HARMONY, TENSION, SEED.
- After: 1 LOOP · 2 LOCK · 3 HARMONY† · 4 SPREAD · 5 CLOCK · 6 DENSITY · 7 COLOUR · 8 SEED.

**FORM:** the part laid out as a song form; A = its first unit, B/C = answers.
- Before: FORM (AABA, ABAB, AAAB, ABAC, GROWTH, MIRROR), UNIT (HALF BAR, 1 BAR), ANSWER (SOURCE, SEQUENCE, INVERT, DISPLACE, NEW: how B answers), STEP (−3 … +4), HARMONY, TENSION, RANGE, LENGTH.
- After: 1 FORM · 2 UNIT · 3 HARMONY† · 4 RANGE · 5 LENGTH · 6 STEP · 7 COLOUR · 8 ANSWER.

### 4.5 Variation, drums

**Changes for every row:** slot 3 holds the generator's second idea, and SEED goes to 8 with DRIFT on 6 (or 7 when 6 holds DYNAMICS).

**KICK:** the kick moved, added to, syncopated or dropped.
- Before: AMOUNT (0–6 changes), STYLE (MOVE, ADD, SYNCOPATE, DROP), BARS (EVERY, EVEN, LAST), SEED, DRIFT.
- After: 1 STYLE · 2 AMOUNT · 3 — · 4 BARS · 5 — · 6 DRIFT · 7 — · 8 SEED.

**HATS:** the hats re-written at a rate.
- Before: RATE (QUARTER, OFFBEAT, 8THS, 16THS, GALLOP), OPEN (0–4 open hats), DYNAMICS, SWING, DRIFT.
- After: 1 RATE · 2 OPEN · 3 — · 4 — · 5 — · 6 — · 7 DYNAMICS · 8 DRIFT.

**GHOSTS:** quiet ghost notes added.
- Before: COUNT (0–12), LEVEL (20–60 velocity), PAD (SNARE, HAT, PERC), SEED, DRIFT.
- After: 1 LEVEL · 2 COUNT · 3 — · 4 PAD · 5 — · 6 DRIFT · 7 — · 8 SEED.

**FILL:** a fill at the end. **Absorbs TURNAROUND.**
- Before: SIZE (1 BEAT … 1 BAR), DENSITY, PADS (SNARE, TOMS, MIXED), DYNAMICS, SEED, DRIFT.
- After: 1 SIZE · 2 DENSITY · 3 PADS · 4 WHERE (TURNAROUND's: END, EVERY BAR) · 5 — · 6 DRIFT · 7 DYNAMICS · 8 SEED.

**SHIFT:** some hits of one pad shifted by 16ths.
- Before: AMOUNT, STEPS (−2/16 … +2/16), PAD (SNARE, KICK, PERC, HAT), SEED, DRIFT.
- After: 1 STEPS · 2 AMOUNT · 3 — · 4 PAD · 5 — · 6 DRIFT · 7 — · 8 SEED.

**TURNAROUND:** a short fill before the loop turns, at the end or every bar. Merged into FILL.
- Before: WHERE (END, EVERY BAR), SIZE (1 BEAT, 2 BEATS), DENSITY, SEED, DRIFT.
- After: gone. See FILL.

**FEEL:** half time, doubled hats, or both.
- Before: MODE (HALF TIME, DOUBLE HATS, BOTH), AMOUNT, DYNAMICS, SEED, DRIFT.
- After: 1 MODE · 2 AMOUNT · 3 — · 4 — · 5 — · 6 DRIFT · 7 DYNAMICS · 8 SEED.
- **My call:** this fixes the old table, which had dropped FEEL's SEED.

**GRIDS:** an X/Y map between this pattern and the genres' patterns (after Mutable Instruments' Grids). **Absorbs EUCLID.**
- Before: X, Y (0–100 %), KICK, SNARE, HATS (− … +, each part's threshold), CHAOS (0–10, levels shaken), DYNAMICS, SEED.
- After: 1 X · 2 Y · 3 SNARE · 4 KICK · 5 HATS · 6 CHAOS · 7 DYNAMICS · 8 SEED.
- **My call:** SEED stays per §2.8, which supersedes the old "GRIDS loses SEED".

**EUCLID (drums):** one pad on a Euclidean rhythm. Merged into GRIDS.
- Before: PULSES (1–16), ROTATE (0–15), PAD (PERC, TOM, SNARE, HAT), DYNAMICS, DRIFT.
- After: gone. Euclidean patterns become an area of the GRIDS map. **⚑ PULSES, ROTATE and PAD stop being knobs.**

**DEVELOP (drums):** the pattern developed: fills, ghosts, shifts, accents, hats. Not merged (revised 2026-11-01).
- Before: AMOUNT, FILL (NONE … 1 BAR), GHOSTS (0–10), SHIFT (NONE, −1/16, +1/16, +2/16), DENSITY, ACCENT (FLAT … HARD), HATS (AS IS, or a rate), SEED.
- After: 1 FILL · 2 AMOUNT · 3 SHIFT · 4 GHOSTS · 5 DENSITY? · 6 ACCENT · 7 HATS · 8 SEED.

**STYLE (drums):** a new pattern walked in the pattern's learned style.
- Before: LIKENESS, PHRASE, DENSITY, SEED, DRIFT.
- After: 1 PHRASE · 2 LIKENESS · 3 DENSITY · 4 — · 5 — · 6 DRIFT · 7 — · 8 SEED.

**FORM (drums):** the pattern laid out as a form.
- Before: FORM (default AAAB), UNIT, ANSWER (FILL, STYLE, SPARSE, SOURCE: how B answers), DYNAMICS, DRIFT.
- After: 1 FORM · 2 UNIT · 3 ANSWER · 4 — · 5 — · 6 — · 7 DYNAMICS · 8 DRIFT.

### 4.6 Smart Double

**Changes for every row:** slot 5 is ENDING and slot 6 is SEAMS. ENDING moves from knob 1 to slot 5, and TENSION becomes COLOUR.

**TURNAROUND:** the ending's notes re-pitched to step into the clip's first note. **Absorbs TURN.**
- Before: ENDING, APPROACH (BELOW, ABOVE, ENCLOSE, CHROMATIC), TENSION, SEAMS, DRIFT.
- After: 1 MOVE (APPROACH's four + TURN's V7, IV, TRITONE, R, L, P) · 2 — · 3 HARMONY? · 4 — · 5 ENDING · 6 SEAMS · 7 COLOUR · 8 DRIFT.

**TURN:** the ending over a new chord that leads back to the first one. Merged into TURNAROUND.
- Before: ENDING, MOVE (V7, IV, TRITONE, R, L, P), TENSION, SEAMS, DRIFT.
- After: gone. See TURNAROUND.

**CADENCE:** the ending lands on one note or chord and holds it.
- Before: ENDING, LAND (ROOT, FIFTH, TONIC, DOMINANT), HOLD (1/4 … FULL, how long it holds), SEAMS, DRIFT.
- After: 1 LAND · 2 — · 3 — · 4 — · 5 ENDING · 6 SEAMS · 7 HOLD · 8 DRIFT.

**PUSH:** the ending anticipated into the downbeat.
- Before: ENDING, PUSH (1/16, 1/8, 1/4), ACCENT (0–10, the pushed note's accent), SEAMS, DRIFT.
- After: 1 PUSH · 2 — · 3 — · 4 — · 5 ENDING · 6 SEAMS · 7 ACCENT · 8 DRIFT.

**RUN:** the ending replaced by a run into the first note.
- Before: ENDING, RATE (8THS, 16THS, TRIPLETS), DIRECTION (UP, DOWN, ARCH), NOTES (SCALE, CHORD, CHROMATIC), DRIFT.
- After: 1 RATE · 2 NOTES · 3 — · 4 DIRECTION · 5 ENDING · 6 — · 7 — · 8 DRIFT.

**ECHO:** the figure before the ending (or the opening) repeated, moved through the scale.
- Before: ENDING, STEP (−3 … +4), FROM (BEFORE, OPENING), SEAMS, DRIFT.
- After: 1 STEP · 2 — · 3 — · 4 FROM · 5 ENDING · 6 SEAMS · 7 — · 8 DRIFT.

**STYLE:** the ending written new in the part's learned style.
- Before: ENDING, LIKENESS, DENSITY, SEED, DRIFT.
- After: 1 — · 2 LIKENESS · 3 — · 4 — · 5 ENDING · 6 DRIFT · 7 DENSITY? · 8 SEED.

**STOP:** the part drops out, then pickup notes lead back in.
- Before: ENDING, KIND (STOP, HOLD, STAB), PICKUP (0–3 notes), SEAMS, DRIFT.
- After: 1 KIND · 2 — · 3 — · 4 — · 5 ENDING · 6 SEAMS · 7 PICKUP · 8 DRIFT.

**EVOLVE:** the second half over the first half's chords developed.
- Before: MOVE (the developments this scene allows, closest first), TENSION, RHYTHM, RANGE, PHRASES (ONE MOVE, EACH phrase), DRIFT.
- After: 1 MOVE (+ WILD's bolder moves at the far end, §2.5) · 2 RHYTHM · 3 PHRASES · 4 RANGE · 5 — · 6 — · 7 COLOUR · 8 DRIFT.

**FILL (drums):** a fill over the ending. **Absorbs PICKUP.**
- Before: ENDING, DENSITY, PADS (SNARE, TOMS, BOTH), SEAMS, SEED, DRIFT.
- After: 1 — · 2 DENSITY (PICKUP's HITS as its lowest positions) · 3 PADS (+ KICK, OPEN HAT, KICK+SNARE) · 4 PUSH (PICKUP's) · 5 ENDING · 6 SEAMS · 7 DRIFT · 8 SEED.

**PICKUP (drums):** the pattern kept; one to three hits lead into the next downbeat. Merged into FILL.
- Before: PADS (KICK, SNARE, OPEN HAT, KICK+SNARE), PUSH (1/16, 1/8, 1/4), HITS (0–3), SEAMS, DRIFT.
- After: gone. See FILL.

**ROLL (drums):** a snare roll over the ending.
- Before: ENDING, RATE (8THS, 16THS, 32NDS, ACCEL), CRESC (0–10, how much it rises), SEAMS, DRIFT.
- After: 1 RATE · 2 — · 3 — · 4 — · 5 ENDING · 6 SEAMS · 7 CRESC · 8 DRIFT.

**REPEAT (drums):** the slice before the ending repeated through it.
- Before: ENDING, GRAIN (1/16, 1/8, 1/4), DECAY (0–10, each repeat quieter), SEAMS, DRIFT.
- After: 1 GRAIN · 2 — · 3 — · 4 — · 5 ENDING · 6 SEAMS · 7 DECAY · 8 DRIFT.

**BREAK (drums):** the ending drops to one part (or none), one hit leading back.
- Before: ENDING, KEEP (NOTHING, KICK, SNARE, HATS), PICKUP (NONE, SNARE, KICK, OPEN HAT), SEAMS, DRIFT.
- After: 1 KEEP · 2 — · 3 — · 4 — · 5 ENDING · 6 SEAMS · 7 PICKUP · 8 DRIFT.

**STYLE (drums):** the ending walked new in the pattern's learned style.
- Before: ENDING, LIKENESS, DENSITY, SEED, DRIFT.
- After: 1 — · 2 LIKENESS · 3 DENSITY · 4 — · 5 ENDING · 6 DRIFT · 7 — · 8 SEED.

## 5. Constraints

- **Performance:** the preview tick, option generation in slices, and the per-knob-turn regeneration budgets in `browser-test/perf.mjs` hold. Lazily generated scrolled options obey the same slice budget. Undo and redo do no regeneration.
- **File size:** source files stay under 200 lines; split rather than grow.
- **Tests:**
  - each change gets a logic test at the cheapest level;
  - the knob property test ("every knob changes the output") walks every generator in its new layout;
  - a slot-role test asserts each knob name sits in its role's slot, except as the table states;
  - the undo model gets logic tests for the worked example in §3.
- **The device:**
  - undo, scrolling and the Step 14 mix touch preview input and engine round trips, so they are gated by the vdev tier, then deployed;
  - a scoped device run (`ai`, `smoke`) before release.
- **Manual:** `site/manual/generators.md` and `site/reference/controls.md` (Undo/Redo in the preview, jog past the picks).

## 6. Left to the builder

- How the session's undo steps are stored in movy's undo history (UI ring vs the engine snapshot ring), as long as the order and behaviour in §2.4 hold.
- The order of fit beyond the curated picks.
- What the strip shows while scrolled (a window of cells and `MORE`), within the current strip renderer's look.
- How a scrolled, lazily generated option shows "working" (`...`), as long as playback never stops.
- Resolving each `?` in §4 by the slot rule, listing the moves in the commit.

### Pushback recorded

- **SPACE beyond New Clip is not in scope.** SPACE lays a NEW part into phrases (`create/phrase.ts`, `land.ts`). On an existing clip, which is what Variation and Quantize work on, it would cut the user's own phrases. DENSITY (thin to the strongest notes) and THIN cover "less" there. It is a separate design if wanted.
- **SEED next to DRIFT:** superseded by §2.8 (SEED wins where only one fits).

## 7. Suggested order

1. Record the default takes of every generator to be merged (§2.7), then merge them.
2. Knob roles and renames (§2.1, §2.6, the §4 table): pure generator code, cheap to test.
3. Removing the level (§2.5).
4. Scrolling past the picks (§2.2), then the Step 14 mix (§2.3), which reuses it.
5. Granular undo (§2.4): the biggest change, last, on a stable preview.
