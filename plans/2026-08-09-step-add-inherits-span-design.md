# A note added to an occupied step inherits the chord's span

**Date:** 2026-08-09
**Status:** design → implementation

## The problem

Hold a step that already has notes, press a pad, and the new note does not line
up with what is already there. `Clip::push_note` hard-codes both ends:

```rust
fn push_note(&mut self, step: u16, pitch: u8, vel: u8) {
    self.notes.push(Note {
        tick: step as u32 * TICKS_PER_STEP,   // snapped to the grid
        gate: TICKS_PER_STEP,                 // exactly one step
        ...
```

So adding a voice to a chord that was played slightly behind the beat and held
for three steps produces a note that starts early and stops short — audibly not
part of the chord.

## Scope

`Clip::toggle_step_pitch` (the `ltog` the hold-step + pad gesture emits) is the
only path that adds a pitch to an already-occupied step: a plain step tap goes
through `toggle_step`, which either clears the step or fills an empty one. The
Loop-mode bar add (`addp` → `add_pitch_range`) also reaches `push_note` and gets
the same treatment, per step.

No protocol change and no UI change: the engine already tracks `watch_lane` from
`wlane`, which is what decides melodic vs drum below.

## The rule

**The added note takes the step's footprint: the earliest start and the latest
end of every note anchored at that step.** One sentence to learn — the new note
lasts as long as the chord does — and it collapses to an exact copy when the
existing notes agree, which is the common case.

Rejected: cloning the longest note (an arbitrary member), and copying the
nearest note in pitch (musical for a recorded strum, but the rule is invisible
and unpredictable on hardware).

### Melodic only

The footprint applies when `watch_lane` is `None`. In drum view the notes
sharing a step are independent lanes that merely coincide in time; lengthening
an open hat and then adding a kick must not produce a long kick. In melodic view
they are one chord.

In practice an unedited drum grid is all one-step notes, so the footprint would
usually equal the default anyway — making the exclusion explicit avoids the
surprising case rather than relying on that.

### The gate is capped

At the next note of the *same pitch*, and at the clip end — exactly as the
length knob already caps. Without it, a 4-step footprint inherited at step 4
would run the new note through its own next occurrence at step 6.

`Clip::held_note_max_gate` already computes this for an existing note, so the
arithmetic moves into a shared `max_gate_at(tick, pitch)` that both use, rather
than existing twice.

## Not part of this

- **Velocity** still comes from the pad. That is deliberate expressive input;
  the request was start and end.
- **Trig properties need no work.** `Trig` is keyed `(step, lane)` and melodic
  edits write `lane: None`, which `governing_trig` applies to any pitch at that
  step — so probability, condition and invert are already shared by the whole
  step and a new note picks them up for free. Asserted by a test so it stays
  true.
- **Undo** already covers `ltog` (engine snapshot).
- **The save format** is unchanged: notes already store `tick` and `gate`.

## Implementation

`crates/seq-core/src/clip.rs`:

1. `fn step_footprint(&self, step: u16) -> Option<(u32, u32)>` — earliest tick
   and the gate that reaches the latest end, or `None` for an empty step.
2. `fn max_gate_at(&self, tick: u32, pitch: u8) -> u32` — extracted from
   `held_note_max_gate`, which is rewritten to call it.
3. `push_note` gains an `inherit: bool`. With it, and when `step_footprint`
   returns a span, use that tick and gate capped by `max_gate_at`; otherwise
   today's grid default.
4. `toggle_step_pitch` and `add_pitch_range` gain the same flag and pass it
   through. `toggle_step` passes `false`.

`crates/seq-core/src/command.rs`: `ltog` and `addp` pass
`engine.watch_lane.is_none()`.

## Tests

`cargo test -p seq-core`:

- a single existing note is copied exactly (tick and gate)
- disagreeing notes give the earliest start and the latest end
- an empty step still gets the grid default
- drum view (`watch_lane` set) still gets the grid default
- the inherited gate is capped by the next same-pitch note
- the inherited gate is capped by the clip end
- the Loop-mode bar add inherits per step
- toggling a pitch off is unaffected
- an added note is governed by the step's existing trig properties

Teeth: revert the inherit and confirm the first test fails.
