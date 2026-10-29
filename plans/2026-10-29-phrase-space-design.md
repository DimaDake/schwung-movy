# SPARSE as phrasing: space made the way players make it

User, 2026-10-29, after SPARSE v1 (15b8f6af, a metric mask): "Sparse doesn't work well on bass because sparsed
results are a bit weird (no phrases). Also density does not solve the problem for melody (and maybe others). With any
density level it fills most of the horizontal space. So we need proper sparse there as well (with phrases) … a global
high quality solution … maybe unique well integrated solution for each generator … powered by musical knowledge."

## 1. Diagnosis

Two different things are both being called "sparse":

- **Density**: how many notes play while the part is playing (notes per sounding beat). DENSITY and BUSY control this.
- **Occupancy**: how much of the loop the part plays in at all, and where its silences fall. **Nothing controls this
  today.** MELODY's `rhythm()` draws every step with the same probability across the whole phrase, so any DENSITY
  spreads its notes over the full width of the loop. That is the complaint.

SPARSE v1 changed occupancy with a mask. A mask cuts a line wherever its window ends, often in the middle of a gesture
on a weak 16th, and the silence then sounds like a dropout instead of a breath. That is why the bass results sounded
weird: there were no phrases.

## 2. What players do (the musical knowledge this is built on)

1. **The phrase is the unit of silence.** Pop and rock phrases are mostly 2 or 4 bars, roughly one sung line, and the
   space comes between phrases, not between single notes (Open Music Theory, *Melody and Phrasing*; Attas, MTO 17.3:
   in pop a phrase is a breath).
2. **A phrase ends, and then it rests.** The last note lands on a strong beat (1 or 3) on a stable tone (root, 3rd or
   5th; the tonic at a section end) and is lengthened. Phrase-final lengthening is found in performance, in speech, and
   in listeners' own expectation (Trainor lab; Kragness & Trainor 2016; Repp). A rest after a held, landed note reads as
   a breath. A rest after a weak short note reads as a mistake.
3. **Phrases pair up.** Statement and answer (aa′, antecedent and consequent): the second phrase starts like the first
   and ends more strongly. Four-phrase sections follow srdc (statement, restatement, departure, conclusion), and
   sections split into halves (OMT).
4. **Silence sits on weak hypermetre.** In a 2-bar unit the first bar carries the idea; the end of the second bar is
   where a part rests, or fills into the next unit. Pickups (a beat or less before the downbeat) lead a phrase in.
   Late entries (starting after the one, on the "and" or on beat 2) are an established pop and dub device.
5. **Bass makes space by anchoring, not by vanishing.** The bass holds the root under each chord change and moves in
   between with a figure, or only at the turnaround, leading into the next chord. Dub and dub techno take this
   furthest: "most of the pattern is empty space", and the notes that remain fall in between the beats (Ableton
   Learning Music, *Never Tell You*). Reggae rests on the one. Hip-hop 808s hold long notes after the kick.
6. **Comping lays out.** Chords comp for a bar and lay out for the next, or strike only where the harmony changes
   (comping at the harmonic rhythm), anticipating the change by a 16th or an 8th when the groove pushes.
7. **A part leaves room for the others.** A counter line or an answer phrase plays where the lead is silent (call and
   response across tracks). The scene's onsets (`ctx.band`) already show where that is.

## 3. The design: a phrase plan, realised per generator

### 3.1 Shared: `create/phrase.ts`, the phrase plan

A SPARSE position names a **phrase template** over the clip's hypermetre. The unit is 2 bars: 1 bar on a 1-bar clip,
and the units pair into 4-bar halves on clips of 8 bars or more. A template says, for each unit, which spans are
**on** and with what role:

- `call`: the statement
- `answer`: starts like the call, ends stronger
- `fill`: a lead-in to the next unit
- `hold`: a single held event

Spans start on a downbeat or with a pickup of at most a beat, and end on beat 1 or 3. Positions run from fullest to
emptiest. The percentage is the share of the unit that is on.

| # | Name | Per 2-bar unit | ~on |
| --- | --- | --- | --- |
| 0 | FULL | everything (today's part) | 100% |
| 1 | BREATH | the phrase ends on beat 3 of bar 2 (held), rest to the next unit | 85% |
| 2 | CALL+ANSWER | bar 1 to beat 3 (held), breath; bar 2 to beat 3 (held), breath | 70% |
| 3 | CALL | bar 1, ending on its beat 3; bar 2 rests (the band answers) | 45% |
| 4 | ANSWER | bar 1 rests; bar 2 enters late (beat 1 or its "and") and lands on the next one | 45% |
| 5 | HOOK | a 2-beat motif at the unit's start; the rest is silence | 25% |
| 6 | LEAD-IN | only the last beat or two before each unit, into its downbeat | 15% |
| 7 | ONE | one held event per unit, or per chord change for the harmonic parts | anchor |

On clips of 4 bars or more there are two more positions: UNIT ON / UNIT OFF (a whole unit rests: srdc's sr played, dc
left to the band) and SECTION END (only the last unit's phrase plays, a turnaround). Positions that a clip's length
cannot express are left out, as today.

Rules the plan enforces for every generator:

- **Every span ends landed:** its last event sits on a strong beat, on a stable tone of the chord there (the tonic on
  the clip's last span), and is held to the span's end, minus the GATE's release. That is what turns a cut into a
  breath.
- **Answers echo calls:** an answer span takes the call's rhythm and changes only its ending. A part repeated across
  units repeats its rhythm, so the silences recur and the listener hears a form.
- **Pickups belong to the phrase they lead into.** An anticipation of a span's downbeat starts the span early.
- **ANSWER and LEAD-IN read the scene:** with other tracks, a part chooses the unit half where `ctx.band` is quietest,
  so it answers the lead and does not talk over it.

### 3.2 Per generator: the generator writes into its spans

The plan is not a mask laid over a finished part. Each generator is given its spans and writes a phrase into each one,
in its own idiom.

- **MELODY**: `rhythm()` runs per span, not over the whole loop, so DENSITY becomes "notes inside a phrase" and
  SPARSE becomes "how many phrases, how long". The contour arches over each span, not over the loop. The span's last
  note is a guide or chord tone on a strong beat, held to the end (`create/guide.ts` already places these). The answer
  phrase repeats the call's rhythm with a stronger landing. ONE becomes LONG TONES: a held chord tone per unit,
  voice-led.
- **BASS**: an off-span does not go silent. It **holds the anchor**: the root of each chord that starts there, sounded
  once and held. The figure plays in the on-spans. LEAD-IN turns into an approach figure into the next chord
  (`approachTo`, the existing pickup), and ONE becomes ROOTS, one held root per chord change. The bass ladder adds DUB
  as its last, experimental position: rest on the one, enter on the "and", most of the bar empty.
- **CHORDS, STABS**: the beat windows from v1 stay (user: beat 3 alone makes sense for chords). The phrase positions
  are added on top: CALL becomes LAY OUT (comp a bar, sit out a bar), and ONE becomes CHANGES (one strike per chord
  change, pushed when the pattern pushes).
- **ARP**: arpeggiates inside its spans and ends each one on the chord's top or root, held. HOOK is one sweep per
  unit, and LEAD-IN a run-up into each chord change.
- **RIFF**: the cell repeats inside a span, which ends on the cell's first note, held (riff and hold). CALL plays the
  riff, then rests.
- **COUNTER**: its positions choose the spans where the band is quiet, so a counter line answers. FULL keeps today's
  behaviour.
- **PAD**: BREATH releases a beat before the next chord. Its other positions are CALL (pad on alternate units) and
  CHANGES (a swell at each change, rests between).

### 3.3 Knobs and defaults

- **SPARSE stays knob 8** on the seven generators that have it, and **MELODY gets it too, in DYNAMICS' place**:
  MELODY's own DENSITY now means notes per phrase, so the two knobs no longer overlap.
- **Defaults** (my call, so runs do not always fill the bar): MELODY and COUNTER roll SPARSE from {FULL, BREATH,
  CALL+ANSWER}, because a phrased melody is the norm and a wall of notes is the exception. RIFF rolls {FULL, BREATH}.
  Bass, chords, arp and pad default to FULL. `create/checks.ts` judges density **per sounding bar** for a phrased take,
  so a CALL+ANSWER melody is not refused as too sparse.
- **No dice.** Templates are fixed rules. A take's own seed still writes the notes inside the phrases, as it does
  today.

## 4. Scope

- **This build:** the 8 melodic New Clip generators. The v1 mask code becomes the CHORDS/STABS beat-window branch of
  the plan.
- **Phase 2, proposed, not in this build:** Variation and Smart Double. Their DENSITY (`shape/density.ts`) thins
  uniformly, so it has the same "fills the width" problem. A phrase-aware SPACE option there would cut the source by a
  template and land each phrase end (hold, plus a stable tone through the existing pitch fix).

## 5. Proving it

- **Logic tests**, `gen-create.mjs` or a new `gen-phrase.mjs`:
  - occupancy falls position by position;
  - every rest follows a landed phrase end: strong beat, stable tone, held (the test that fails on v1's mask);
  - in a bass off-span the anchor root is held;
  - a melody answer repeats the call's rhythm;
  - every click changes the notes;
  - phrased defaults pass `create/checks.ts`.
- **Bench** (`quality/`): new metrics **occupancy**, **phrases per unit**, **landed ends** and **mid-gesture cuts**,
  added to the musical verdict so the bench can show the problem and its fix: v1 SPARSE should score badly on cuts and
  the new plan close to 0.
- **Perf:** the plan is a few spans per unit and is built once per take, so the cost is negligible next to the take
  slice (0.8 ms at 16 bars).

## 6. Left to the builder

The exact beat of each landing within a template (beat 3 versus beat 1 of the next unit, per part), the pitch rule
for the held anchor under an inversion (bass of the chord versus its root), and the order of the bass ladder's last
positions.
