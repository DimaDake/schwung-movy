# Step recording — design

Status: approved 2026-08-02

Step-by-step note entry in the style of OP-Z, OP-XY and the Arturia KeyStep:
hold **Rec** while the transport is stopped and play the pads to fill the
sequencer one step at a time. Works on melodic and drum tracks.

Movy already has *hold-step + pad* entry (hold a step button, tap pads to place
notes there). Step recording is the complementary flow: the head moves for you,
so the step row is never touched during a phrase.

---

## 1. The gesture

While **Rec is held** and the transport is **stopped**:

| Input | Effect |
|---|---|
| pad(s) down | notes land on the head step; further pads pressed while any is still down join the same chord |
| all pads up | head advances one step |
| **→** with pads held | tie — the open chord grows one step longer, head follows |
| **←** with pads held | untie — the chord shrinks back one step |
| **→** no pads held | rest — head advances, step left empty |
| **←** no pads held | head steps back, plays what is there and lights its pads; the next pad press overwrites it |
| tap a step button | head jumps to that step; if it had notes they are cleared |
| Rec up | exit |

Chord accumulation is KeyStep semantics: notes overlap in time → same step.
Non-overlapping taps advance one step each, so a single-finger run plays in at
one note per step without any modifier.

A Rec **tap** that entered nothing falls through to today's behaviour (toggle
live-record arm), so no existing gesture is lost. Anything at all happening
during the hold (pad, arrow, step tap) suppresses that fallthrough.

## 2. Module boundary

New file `src/seq/step-rec.ts` owns the whole mode. Everything else only calls
into it.

State:

- `active` — mode on
- `head` — absolute step index
- `growMode` — latched at entry (see §3)
- open chord — pitches, `anchor` step, `tieSteps`
- `touched` — did anything happen during this hold (drives the tap fallthrough)
- `pressMs` — Rec-down timestamp (wall clock, as in `momentary.ts`)
- preview ledger — notes sounded by `←`, with their release deadline

Exports: `stepRecActive()`, `stepRecDown(nowMs)`, `stepRecUp(nowMs): boolean`,
`stepRecPad(pitch, vel)`, `stepRecPadRelease(pitch)`, `stepRecArrow(dir)`,
`stepRecStepTap(button)`, `stepRecHead()`, `stepRecTick()`, `resetStepRec()`.

Call sites:

- `seq/router.ts` — Rec branch, pad on/off, arrow branch, step-button branch
- `seq/leds.ts` — head LED on the step row
- `seq/render.ts` — the persistent header band
- `app/tick.ts` — `stepRecTick()` (preview release, header refresh)
- `app/input-reset.ts` — `resetStepRec()`

## 3. Head range

Decided once, at Rec-down, and held for the whole gesture — so entering the
first note on an empty clip cannot instantly turn it into a one-step clip that
wraps.

**Empty clip → grow mode.** Each advance sets the clip length to exactly what
has been played: `clen <t> <head>` after the head moves. Rests count, so `→`
extends the clip too. Ceiling 256 steps (16 bars), then wrap.

The engine rounds a clip up to the bar end when a note lands outside the
current window (`Clip::extend_to_step`), so the `clen` must follow the `addp`
in the same batch — it trims the rounding back to per-step length.

**Non-empty clip → wrap mode.** Past the last step the head returns to
`loopStart` and overwrites.

The head starts at **step 1** every time — not remembered per clip. `barOffset`
follows the head, so the step row always shows the head's bar. `←` never
shrinks a grow-mode clip; the length keeps the furthest point reached, and
LENGTH / Double Loop change it afterwards.

## 4. Commands emitted

| Gesture | Commands |
|---|---|
| first pad at a fresh head, **melodic** | `del t h h -1` then `addp t h h <pitch> <vel>` |
| first pad at a fresh head, **drums** (`watchLane >= 0`) | `addp t h h <pitch> <vel>` only |
| further pad in the open chord | `addp t h h <pitch> <vel>` |
| tie (`→`, pads held) | one `slen t anchor anchor <pitch> <(tieSteps+1)*24>` per open pitch |
| any head move | `hold t <head>` |
| grow-mode advance | `clen t <head>` |

Melodic replaces because the head is the user's cursor: stepping back with `←`
and replaying must overwrite cleanly. Drums only add, so a kick pass followed
by a snare pass builds a kit pattern instead of erasing it.

Velocity is the pad's, or 127 under Full Velocity — already applied upstream in
`midi/router.ts` before `seqNotePadPlayed`.

`slen` is emitted per pitch rather than with lane `-1` so a drum tie only
touches the notes this chord entered, never notes an earlier pass left on the
same step.

### Why `hold` carries the mode

Pointing the engine's `hold` at the head on every move is the reuse that keeps
the rest of the feature small. The status reply (`hnotes`, `hgate`) already
drives:

- pad LEDs for the held step (`app/tick.ts:533`)
- the note-length span on the step row (`lengthSpanColor`)

and it supplies the note names for the header and the pitches for the `←`
preview. On head move, clear `holdNotes` optimistically and set
`holdStep = head`, so a stale reply from the previous step can never be read as
this step's content. Exit sends `hold t -1`.

## 5. Feedback

**Step row** — head blinks red (`blinkPhase()`, already present), occupied
steps white, the head note's tied length shows as a span. The head takes
priority over the playhead and occupancy colours.

**Pads** — the head's notes light, free via `hold`.

**Screen** — the existing inverted announcement band stays up for the whole
gesture, refreshed each tick:

```
STEP REC  5/16   C3 E3 G3
```

The module's parameter page stays visible underneath, so the sound being played
in is still on screen.

**`←` preview** — sounds the head's notes directly
(`shadow_send_midi_to_dsp`) with a ~150 ms auto-release held in step-rec's own
ledger. It deliberately does not go through the pad note-off ledger: no pad is
involved, so it cannot misdirect a real pad release. Exit and reset flush it.

The preview fires when the poll for the new head arrives, not at the moment of
the `←`, since the pitches come from the engine.

## 6. Precedence against existing gestures

- While active, step buttons are **taps only** — they never register as held
  ranges, so hold-step editing and step recording cannot both claim the pads.
- Knobs are untouched: automation only claims them when `recording && playing`,
  so parameters stay editable while entering notes.
- **Play** exits step recording — the mode is stopped-only by definition.
- A lost pad release is covered by the existing `input-reset.ts` path.

## 7. Testing

- `browser-test/logic.mjs` — advance on all-release; chord accumulation;
  melodic-replace vs drum-add command sequences; tie/untie `slen` values; grow
  vs wrap at the clip end; tap fallthrough to `rec`; step tap clears and jumps;
  exit cleanup (`hold -1`, preview flushed).
- `browser-test/app-loop.mjs` — a full injected sequence (Rec down → pads →
  arrows → Rec up) checked against the engine queue and `setLED` calls.
- `browser-test/screenshot.mjs` — new baseline for the header band.
- `scripts/test-seq.sh` — one added device section, not a new script; the local
  suites carry the logic.

## 8. Docs

- `MANUAL.md` §5 — a **Step recording** subsection with a baseline screenshot.
- `README.md` — one-line mention.
- `CHANGELOG.md` — entry.
