# Parameter Automation — Latching Playback (Design)

Date: 2026-06-18
Status: design pending written-spec review before planning.
Supersedes the playback semantics of `plans/2026-06-15-param-automation-design.md`
(§4 `engine.rs` step-entry emission, §5 revert-to-base). Everything else in that
design — data model, lane assignment, gestures, dots, persistence — is unchanged.

## 1. Problem

Today an automation lock is a **one-step blip**: the engine emits a lane's CC
when the playhead enters that exact step, and **every unlocked step reverts to
the lane base**. So a value dialed in while holding a step lasts 1/16th of a bar
and then snaps back.

The user wants the value to **latch** — once set on a step, it stays applied
across following steps until a defined musical event ends it.

## 2. Desired behavior (agreed)

An automation value set on step **S** for a lane **latches** (stays applied)
until the **earliest** of:

1. **The next automation value on that same lane** — a later step's lock, or a
   live-recorded move (both are stored as locks).
2. **The next note anchored to a step other than S** — a note on a *different*
   step ends the latch and the param reverts to base.

A note anchored to **S itself** (a chord, or extra hits on the same step) does
**not** end the latch — the lock on that step wins.

The latch **carries across the loop boundary**: a latch active at the last step
continues into the next pass (cyclically) until its end condition is hit.

Automation attaches to a **step, not a note** — you can automate a step with no
note on it; it still latches. Notes matter only as *ending* events.

### Consequence for dense tracks (by design, not a bug)

On a drum track where most steps have hits, a latch is ended by the next step's
note almost immediately, so automation effectively spans only the gap until the
next hit. That is exactly "lasts until the next note" and is the intended feel.

## 3. The rule as a per-step recurrence

This is the whole algorithm. For an assigned lane, on **entering step T** (the
playhead crossed into a new step), the lane's effective value is:

```
if clip.lock_at(lane, T) is Some(v):   value = v        # case 1: new automation point
elif clip.step_has_notes(T):           value = base     # case 2: a note ends the latch
else:                                  value = carry    # case 3: latch holds (prev value)
```

- **Case 1** subsumes live-recorded moves (recorded as a lock at the playing
  step) and the "same-step note doesn't end it" clause (a lock co-located with a
  note still wins).
- **Case 2** reverts to the lane base. If that note's step also carries a lock,
  case 1 already fired instead — so a note that has its own automation re-latches
  rather than reverting.
- **Case 3** carries the previous value. Because the carry state is **never reset
  at the loop top**, latches cross the loop boundary for free.

Emit the lane's CC **only when `value` changes** from the last emitted value
(idempotent CC suppression — see §6 Perf).

### Why this is deterministic

The recurrence is the unrolled form of a pure function `effective_at(lane, T)`
that scans backward cyclically within the loop window `[loop_start,
loop_start+length)`:

```
for d in 0 .. length:
    s = wrap(T - d)                       # cyclic within the loop window
    if clip.lock_at(lane, s) is Some(v): return v
    if clip.step_has_notes(s):           return base
return base
```

Walking backward from T, the **first** lock encountered governs (it latched
forward to T with no interrupting note in between); the **first** note
encountered before any lock means the latch was already broken → base. This
matches the forward recurrence exactly in steady state and is used to **seed**
playback (§5) and as the **test oracle** (§7).

## 4. Engine changes (`seq-core`)

All changes are in the engine. No change to the lock data model, commands, lane
assignment, dots, gestures, or persistence.

### `track.rs`
- Add per-lane runtime latch state (not persisted — derived):
  - `auto_cur: [i16; 8]` — value currently applied per lane (`-1` = none emitted
    yet / force re-emit). Used for emit-on-change.
- `last_auto_step: i32` already exists and still gates "entered a new step."

### `clip.rs`
- No new storage. `lock_at(lane, step)` and `step_has_notes(step)` already exist
  and are exactly the two predicates the recurrence needs.
- Add the pure oracle `effective_at(&self, lane: u8, step: u16, base: u8) ->
  u8` implementing the §3 cyclic backward scan over `[loop_start_steps,
  loop_start_steps + length_steps)`. (Lives on `Clip` because it reads locks +
  notes + loop window.)

### `engine.rs`
- **`emit_automation` (rewrite).** Replace the current
  `lock_at(...).unwrap_or(base)` body with the §3 per-step recurrence:
  for each assigned lane compute `value` (case 1/2/3 using `auto_cur` for carry),
  and push `OutEvent::Cc` **only if `value != auto_cur[lane]`**, then store it.
- **Seed on entry into automation playback.** When the playhead position is set
  discontinuously (transport start, loop/clip jump, pattern change) the `carry`
  is undefined. Add `seed_auto(track, slot, step)` that sets
  `auto_cur[lane] = effective_at(lane, step, base)` for each assigned lane and
  emits the seeded CC. Call it:
  - on transport start (play pressed), for each track at its start step;
  - whenever a track's playhead is repositioned outside normal step advance.
  `last_auto_step` is set so the next `service_tick` doesn't double-emit.
- **`auto_base` / `auto_base_quiet`** unchanged. They keep the lane base in sync
  with the param's manual (resting) value; the next step entry's recurrence
  picks the base up via case 2/3 as usual.

### Live recording (now latches like step automation)
The Rec+turn live-record path (`handleAutomationKnob`, `aset` at the playing
step) keeps writing one lock per step crossed (per-step resolution — **no**
sub-step curves). A live-recorded value is just a lock, so it latches under
case 1 exactly like a hold-step lock.

**One behavior change (UI side, `automationKnobReleased`):** today releasing the
knob after live-recording fires `abase … → revert to base`, snapping the param
back to base the instant you let go. Under latching the last recorded value must
**hold** (latch forward until the next note on a different step, or the next
lock). So **remove the revert-to-base on release for recorded lanes** — the
recorded lock latches via playback, no release-time emit. (`recordingLanes`
becomes dead once this revert is gone; remove it. The normal non-recording
`abaseq` quiet base-sync on release is unchanged.)

### Status / held-step display — unchanged
`status()` `hauto` keeps reporting **only explicit locks** at the held step, and
the UI keeps showing them as today. No inherited-value display is added.

### Version
- Bump `ENGINE_VERSION` in `engine/crates/movy-dsp/src/lib.rs` **and**
  `src/seq/constants.ts` (build-time guard) — playback semantics changed.

## 5. UI / gesture changes — one small one

The renderer, lane registry, automation dot, held-step display, hold-step+turn,
and clear are all untouched. The **only** UI-side change is in
`automationKnobReleased` (`src/seq/automation.ts`): remove the revert-to-base on
release for live-recorded lanes (§4) so the recorded value latches until its end
trigger instead of snapping back. `recordingLanes` is removed as dead code.

**On-screen knobs do not follow automation during playback — already handled.**
`src/app/tick.ts` calls `setNoRefreshKeys(laneKeysForTrack(...))` each tick, so
an assigned lane's param is excluded from the value read-back poll
(`store.ts` `refreshOneParam`). The knob keeps showing the UI-owned **base**
value while the engine drives the actual param underneath; it never animates to
the latched value. The latch change does not affect this.

## 6. Performance

- Emit-on-change means a held latch emits **one** CC at its start and **one** at
  its end (the interrupting note/lock), not one per step — strictly fewer CCs
  than today's per-step-entry emission. `perf.mjs` asserts CC count ≤ today's.
- Per step entry the work is O(assigned lanes) for the forward recurrence; the
  O(length) backward scan runs only on seed (transport start / seek), not per
  tick.

## 7. Tests

### Rust (`cargo test`, `seq-core`)
- `effective_at` oracle: lock latches forward across unlocked steps; a later
  note reverts to base; a same-step note does **not** (lock wins); a note with
  its own lock re-latches; carry wraps across the loop boundary; no-lock → base.
- `emit_automation`: emits on change only (start + end), not per step; revert-to-
  base on the interrupting note; carry across wrap matches `effective_at`.
- `seed_auto`: starting playback mid-loop emits the correct seeded value
  (matches `effective_at` at the start step) before any step advance.
- Regression: existing automation tests updated for latch semantics (the old
  "blip + revert every step" assertions are replaced).

### `logic.mjs`
- `automationKnobReleased` for a live-recorded lane issues **no** revert-to-base
  command (the lock latches); the normal non-recording quiet base-sync still
  fires.

### `app-loop.mjs`
- A playing clip with one lock and sparse notes emits the latched `CC 102+lane`
  sequence the recurrence predicts (capture MIDI, assert the change points).
- A live-recorded sweep latches: the last recorded value holds after knob
  release until the next note/lock (no snap-back to base).

### `perf.mjs`
- CC emission count for a latched lane ≤ the pre-change per-step count.

### Device (`test-seq.sh`)
- Deploy engine+UI; verify a latched value audibly holds across steps and
  reverts on the next note; survives persistence (locks already persisted).

## 8. Edge cases (decided)

- **Stopped audition unchanged.** Hold-step+turn while stopped still emits the
  held value live and reverts to base on release (a single-step audition; the
  latch is a playback concept).
- **On-screen knobs stay on base during playback** (§5) — the displayed knob
  never animates to the latched value; only the underlying param moves.
- **Empty clip / no locks** → every lane stays at base (case 3 carry of the
  seeded base); no behavior change from today for un-automated clips.

## 9. Out of scope (YAGNI)

- Sub-step / smooth automation curves (still one value per step).
- Per-note (rather than per-step) automation storage.
- Any change to lane assignment, the 8-lane limit, dots, clear, or persistence
  format.
