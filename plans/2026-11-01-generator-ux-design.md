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
| + | An overlong list | **Merge overlapping generators** (§2.7), but never below the picks plus 4 for any task and track kind. Nothing audible may be lost: every merged generator's sound stays reachable. |

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
- A second knob page. New generators.

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
| 6 | **EXTRA** | SPACE, DYNAMICS, SEED, SEAMS |
| 7 | **FLAVOUR** | SWING, STRUM, COLOUR, VOICING, SEED |
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
over the colour and feel knobs, each only where it applies (§2.8). A part that loses SWING follows the scene's
swing, as CHORDS does since 2026-11-01. The builder adds DENSITY wherever it
is cheap and musical (`densityStage`, `drumDensity`, `patternDense`).
SPACE stays on New Clip only (see the pushback in §6).

Two exceptions, both stated:

- **Per-pad drums keep DENSITY on knob 1.** DENSITY is "the pad's" across both per-pad options (`ai/preview-pads.ts`), and DENSITY 0 removes the pad. It is the per-pad generators' main idea.
- **On Quantize, slot 1 is always TIMING**, because "how tight" is Quantize's main idea.

### 2.2 Every suitable generator, by jog (#3)

- The preview strip still opens on ORIG plus the curated first picks: 6 for Variation and Quantize, 8 for New Clip, as many as suit for Double.
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
| Quantize (melodic + drums) | TIGHT, TIDY, GROOVE | **TIGHT** | 8 knobs: TIMING, DENSITY, GRID, FIX NOTES (drums: CLEAN), LENGTH, —, SWING, FEEL. Decided: TIDY's EVEN and GROOVE's DYNAMICS merge into one centred **VELOCITY** knob in slot 6 (left = EVEN, middle = as played, right = DYNAMICS). Melodic CLEAN becomes automatic (fixed at TIDY's default, as drum TIGHT does). Option 1 stays the tightest. |
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
| New Clip (drums) | GROOVE | **DRUM MAP** | DRUM MAP gains FILL (slot 4); GROOVE's styles become DRUM MAP genres where missing. |

**No-loss rule (a test, not a hope):** for each removed generator and each
fixture it served, the merged generator has a knob state whose take is the
removed generator's default take, or its nearest neighbour under the bench's
difference measure (`select.ts` `difference` below `MIN_PAIR`). Before
deleting a generator, the builder records its default takes as fixtures
(`browser-test/` data) so the test compares against the old sound, not the
new code. A merge that cannot pass is reported to the user, not forced.

The §4 rows for merged generators are superseded by this table; the merged
generators' new layouts follow §2.1.

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
  moves to 6 (my call). Generators without randomness keep DRIFT on 8.
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

## 4. Knob table (to confirm)

The user marks changes here. `—` is an empty slot (LED dark). **⚑** marks a trade the user should decide.

### New Clip — melodic

| Generator | 1 WHAT | 2 HOW MUCH | 3 HARMONY | 4 WHERE | 5 LENGTH | 6 EXTRA | 7 COLOUR | 8 OVER TIME |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CHORDS | PATTERN | DENSITY | HARMONY | REGISTER | GATE | SPACE | VOICING | DRIFT |
| PAD | PATTERN | VOICING | HARMONY | REGISTER | GATE | SPACE | STRUM | DRIFT |
| STABS ⚑ | PATTERN | DENSITY | HARMONY | REGISTER | GATE | SPACE | VOICING | DRIFT |
| BASS | PATTERN | NOTES | HARMONY | OCTAVE | GATE | SPACE | SWING | DRIFT |
| ARP | STYLE | RATE | HARMONY | OCTAVES | GATE | SPACE | SWING | DRIFT |
| MELODY | CONTOUR | DENSITY | HARMONY | RANGE | GATE | SPACE | SEED | DRIFT |
| RIFF | CELL | NOTES | HARMONY | REGISTER | GATE | SPACE | SEED | DRIFT |
| COUNTER | RATE | DENSITY | HARMONY | REGISTER | GATE | SPACE | SEED | DRIFT |

Decided 2026-11-01:

- **PAD:** MOTION is fixed at SMOOTH, and DRIFT takes slot 6.
- **STABS** gains DENSITY (the same mechanism as CHORDS) and follows the scene's swing.
- **MELODY / RIFF / COUNTER** gain HARMONY (slot 4) and keep SEED (slot 7, by the core-knob rule), and follow the scene's swing. COUNTER's MOTION becomes DENSITY (how much it moves). The builder checks that COUNTER's motion range survives as DENSITY positions.

### New Clip — drums

| Generator | 1 WHAT | 2 HOW MUCH | 3 2nd IDEA | 4 WHERE | 5 LENGTH/HUMAN | 6 EXTRA | 7 FEEL | 8 OVER TIME |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PAD EUCLID | DENSITY* | ROTATE | ACCENT | RATE | HUMAN | SEED | SWING | DRIFT |
| PAD PATTERN | DENSITY* | STYLE | FILL | — | HUMAN | SEED | SWING | DRIFT |
| DRUM MAP | GROOVE | KICK | HATS | SNARE | FILL | HUMAN | SWING | DRIFT |
| EUCLID KIT | KICK | SNARE | SHIFT | HATS | HUMAN | DYNAMICS | SWING | DRIFT |
| BROKEN | SYNC | DENSITY | — | GHOSTS | HUMAN | SEED | SWING | DRIFT |
| PERC | ACCENT | DENSITY | — | PADS | HUMAN | SEED | SWING | DRIFT |

`*` the per-pad exception (§2.1). By the core-knob rule, SEED stays (slot 8) where a generator had it, over DYNAMICS. DRUM MAP and EUCLID KIT keep three per-voice counts in 2–4, since that is their idea.

### Smart Quantize

| Generator | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TIGHT | TIMING | DENSITY | FIX NOTES | GRID | — | — | SWING | — |
| TIDY | TIMING | DENSITY | FIX NOTES? → EVEN | CLEAN | LENGTH | — | — | — |
| GROOVE | TIMING | DENSITY | — | FEEL | — | DYNAMICS | SWING | — |
| SHAPED | TIMING | — | FIX NOTES | VOICING | LENGTH | — | — | — |
| DECORATE | TIMING | AMOUNT | FIX NOTES | KIND | — | SEED | — | — |
| ANSWER | TIMING | DENSITY | FIX NOTES | SPLIT | LENGTH | DYNAMICS | RHYTHM | STEP |
| FULL | TIMING | DECORATE | FIX NOTES | GRID | LENGTH | DYNAMICS | SWING | RHYTHM |
| MUTATE | TIMING | AMOUNT | — | STEPS | — | SEED | — | — |
| MODE | TIMING | — | MODE | WHERE | — | DYNAMICS | — | — |
| INVERT | TIMING | — | FIX NOTES | WHERE | — | — | PIVOT | — |
| OCTAVES | TIMING | AMOUNT | — | DIRECTION | — | SEED | — | — |
| RATCHET | TIMING | AMOUNT | — | RATE | DECAY | — | — | — |
| SHIFT | TIMING | — | — | STEPS | LENGTH | — | KEEP | — |
| HUMANIZE | LOOSE | — | — | — | LENGTH | SEED | VELOCITY | — |
| TIGHT (drums) | TIMING | DENSITY | CLEAN | GRID | — | — | SWING | — |
| TIDY (drums) | TIMING | DENSITY | CLEAN | GRID | — | — | EVEN | — |
| GROOVE (drums) | TIMING | DENSITY | — | FEEL | — | DYNAMICS | SWING | — |
| GHOSTS (drums) | TIMING | COUNT | LEVEL | — | — | SEED | — | — |
| FILL (drums) | TIMING | DENSITY | — | SIZE | — | SEED | — | — |
| FULL (drums) | TIMING | GHOSTS | CLEAN | GRID | FILL | DYNAMICS | SWING | — |
| MUTATE (drums) | TIMING | AMOUNT | — | MOVE | — | SEED | — | — |
| RATCHET (drums) | TIMING | AMOUNT | RATE | PAD | — | — | — | — |
| HUMANIZE (drums) | LOOSE | — | — | — | LENGTH | SEED | VELOCITY | — |

Every Quantize option gets DENSITY in slot 2 where it is free and makes musical sense (the builder adds it via `densityStage` / `drumDensity`, as TIGHT/TIDY/GROOVE got it on 2026-11-01). The builder confirms each with the "every knob changes something" property test.

### Variation — melodic

Rule: 8-knob generators put CHORD RATE in slot 8, COLOUR in 7, and the extra (VOICES, SEED, DYNAMICS) in 6. Generators with DRIFT have it in 8.

| Generator | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NEXT CHORDS | RHYTHM | DENSITY | HARMONY | RANGE | LENGTH | VOICES | COLOUR | CHORD RATE |
| FOLLOW | DIRECTION | DENSITY | HARMONY | VOICES | LENGTH | RHYTHM | COLOUR | CHORD RATE |
| PULSE | NOTE | DENSITY | HARMONY | OCTAVE | LENGTH | DYNAMICS | RHYTHM | CHORD RATE |
| HARMONIZE | INTERVAL | AMOUNT | HARMONY | — | — | — | COLOUR | DRIFT |
| RE-VOICE | — | AMOUNT | HARMONY | RANGE | — | SEED | — | DRIFT |
| NEW LINE | STEP | DENSITY | HARMONY | RHYTHM? → — | LENGTH | SEED | COLOUR | CHORD RATE |
| ANSWER | SPLIT | DENSITY | HARMONY | STEP | LENGTH | RHYTHM | COLOUR | CHORD RATE |
| SPREAD | SPREAD | RHYTHM | HARMONY | TOP | LENGTH | VOICES | COLOUR | CHORD RATE |
| ARP | PATTERN | RATE | HARMONY | OCTAVES | — | — | — | DRIFT |
| DRONE MOVE | NOTE | SHARED | HARMONY | — | LENGTH | — | — | DRIFT |
| BASSLINE | PATTERN | NOTES | HARMONY | OCTAVE | LENGTH | DYNAMICS | SHIFT | CHORD RATE |
| DISPLACE | SHIFT | AMOUNT | HARMONY | — | — | SEED | — | DRIFT |
| ANTICIPATE | PUSH | — | HARMONY | — | LENGTH | — | COLOUR | DRIFT |
| CONNECT | — | AMOUNT | HARMONY | — | LENGTH | SEED | COLOUR | DRIFT |
| RECOMBINE | DIM | AMOUNT | HARMONY | ROTATE | — | SEED | — | DRIFT |
| EUCLID | PULSES | — | HARMONY | ROTATE | LENGTH | — | — | DRIFT |
| COMP | PATTERN | VOICES | HARMONY | RANGE | LENGTH | DYNAMICS | COLOUR | CHORD RATE |
| OCTAVE BASS | PATTERN | AMOUNT | HARMONY | — | LENGTH | SEED | — | DRIFT |
| WALK | — | DENSITY | HARMONY | AMOUNT? | — | SEED | COLOUR | DRIFT |
| THIN | — | AMOUNT | HARMONY | RANGE | LENGTH | SEED | — | DRIFT |
| MOTIF | CELL | — | HARMONY | STEP | — | — | COLOUR | DRIFT |
| BACKWARDS | SPAN | AMOUNT | HARMONY | RANGE | — | SEED | — | DRIFT |
| HALF/DOUBLE | SPEED | — | HARMONY | FROM | LENGTH | — | — | DRIFT |
| DECORATE | KIND | AMOUNT | HARMONY | — | — | SEED | COLOUR | DRIFT |
| REGISTER | SPLIT | — | HARMONY | INTERVAL | RANGE? | — | — | DRIFT |
| HOLD NOTE | NOTE | AMOUNT | HARMONY | RANGE | — | SEED | — | DRIFT |
| DEVELOP | RHYTHM | AMOUNT | HARMONY | RANGE | DENSITY? | SEED | COLOUR | CHORD RATE |
| STYLE | PHRASE | LIKENESS | HARMONY | RANGE | DENSITY? | SEED | COLOUR | CHORD RATE |
| LOOPER | LOOP | LOCK | HARMONY | SPREAD | CLOCK | SEED | COLOUR | DENSITY? |
| FORM | FORM | UNIT | HARMONY | RANGE | LENGTH | STEP | COLOUR | ANSWER |

`?` marks a knob that has no natural slot because its generator has two "how much" knobs. The builder resolves each by moving the secondary one into the nearest free slot and lists the moves for the user.

### Variation — drums

| Generator | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| KICK | STYLE | AMOUNT | — | BARS | — | SEED | — | DRIFT |
| HATS | RATE | OPEN | — | — | — | DYNAMICS | SWING | DRIFT |
| GHOSTS | LEVEL | COUNT | — | PAD | — | SEED | — | DRIFT |
| FILL | SIZE | DENSITY | — | PADS | — | DYNAMICS | — | DRIFT |
| SHIFT | STEPS | AMOUNT | — | PAD | — | SEED | — | DRIFT |
| TURNAROUND | SIZE | DENSITY | — | WHERE | — | SEED | — | DRIFT |
| FEEL | MODE | AMOUNT | — | — | — | DYNAMICS | — | DRIFT |
| GRIDS | X | Y | SNARE | KICK | HATS | DYNAMICS | — | CHAOS |
| EUCLID | PULSES | — | ROTATE | PAD | — | DYNAMICS | — | DRIFT |
| DEVELOP | FILL | AMOUNT | SHIFT | GHOSTS | DENSITY? | SEED | HATS | ACCENT |
| STYLE | PHRASE | LIKENESS | DENSITY? | — | — | SEED | — | DRIFT |
| FORM | FORM | UNIT | ANSWER | — | — | DYNAMICS | — | DRIFT |

GRIDS keeps its X/Y map in 1–2 (it is the idea) and loses SEED (CHAOS is its randomness). CHAOS sits in slot 6 here and DYNAMICS in 8: GRIDS has no DRIFT, so the builder may move CHAOS to 8 as its live knob.

### Smart Double

Slot 5 is **ENDING** (how long the ending is) on every Double generator, and slot 6 is SEAMS.

| Generator | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TURNAROUND | APPROACH | — | — | — | ENDING | SEAMS | COLOUR | DRIFT |
| CADENCE | LAND | — | — | — | ENDING | SEAMS | HOLD | DRIFT |
| PUSH | PUSH | — | — | — | ENDING | SEAMS | ACCENT | DRIFT |
| RUN | RATE | NOTES | — | DIRECTION | ENDING | — | — | DRIFT |
| ECHO | STEP | — | — | FROM | ENDING | SEAMS | — | DRIFT |
| STYLE | — | LIKENESS | — | — | ENDING | SEED | DENSITY? | DRIFT |
| STOP | KIND | — | — | — | ENDING | SEAMS | PICKUP | DRIFT |
| TURN | MOVE | — | HARMONY? | — | ENDING | SEAMS | COLOUR | DRIFT |
| EVOLVE | MOVE | RHYTHM | PHRASES | RANGE | — | — | COLOUR | DRIFT |
| FILL (drums) | — | DENSITY | — | PADS | ENDING | SEAMS + SEED? | — | DRIFT |
| PICKUP (drums) | PUSH | HITS | — | PADS | — | SEAMS | — | DRIFT |
| ROLL (drums) | RATE | — | — | — | ENDING | SEAMS | CRESC | DRIFT |
| REPEAT (drums) | GRAIN | — | — | — | ENDING | SEAMS | DECAY | DRIFT |
| BREAK (drums) | KEEP | — | — | — | ENDING | SEAMS | PICKUP | DRIFT |
| STYLE (drums) | — | LIKENESS | — | — | ENDING | SEED | DENSITY? | DRIFT |

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
