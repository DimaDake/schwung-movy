# Scene launching and Song mode — design

Status: approved design, not yet planned into tasks.

Two features, one gesture. **Scene launching** fires a whole column of the
Session grid across all 16 tracks. **Song mode** sequences those scenes into a
looping arrangement built live, by holding Shift and pressing scenes in order.

---

## 1. Where the truth lives

The song is **engine state**, not UI state — the same rule clips and the
transport already follow. `seq-core` owns the scene sequence, the scene-length
maths, the bar countdown and the one-bar-ahead queueing; the UI keeps a
read-only mirror fed by `status=` and paints it.

That split is what makes the song survive a UI reload, persist with the set, and
switch scenes against the *same* bar boundary that already resolves clip
launches — rather than against whenever a UI tick happened to notice.

New `Engine` fields:

```rust
song: Vec<u8>,        // raw pressed scene indices, e.g. [1,2,2,3]
song_pos: usize,      // index into the FOLDED entry list
song_bars_left: u32,  // bars remaining in the current entry
song_armed: bool,     // next entry already queued (the one-bar pulse is showing)
```

`song` stores the **raw presses**. Consecutive duplicates fold into
`(scene, reps)` entries only at scheduling time. So the screen readout
(`1 2 2 3`) and the persisted form are both the literal gesture the user made,
and "pressed twice = plays twice as long" falls out of `reps` without a second
representation to keep in sync.

## 2. Scene launching

New engine method `launch_scene(slot)`: for all 16 tracks, exactly today's
`launch_clip` semantics.

- Clip exists → `queued_slot = Some(slot)`
- Slot empty → `pending_stop = true`

Bar-quantized while the transport runs; immediate + `start_transport()` when
stopped. It reuses the existing per-track fields, so the queued and stopping
pulses in `sessionCellColor` light up with **no LED changes at all**.

**Empty slots stop the track.** A scene is a full snapshot: what is not in the
column stops playing. This is the plain existing stop path — `playing_slot`
becomes `None` at the bar boundary and `service_tick`'s existing "flush hanging
note-offs for any track that is not serviced" loop closes the open gates.
**No new gating is added**: no mute, no all-notes-off blast, no per-track
silencing layer. A track stops because its clip stopped, and nothing more.

There is no bare `scene` command: `song <slot>` (§4) replaces the song and
launches the scene, which for a single press is identical behaviour — §3 argues
a one-scene song *is* a hand-launched scene. A separate verb would be dead
surface with a third classification to keep correct.

`song` and `songadd` are classified in `command.rs` alongside `launch` /
`stoptrk` (they clear the capture buffer; not undoable — clip launching isn't
either, and both are performance gestures rather than edits).

**Scene length** = `max` over the 16 tracks of `ceil(clip.length_steps / 16)`
bars, counting only clips that exist in that column; minimum 1 bar. A
completely empty scene is 1 bar. Computed once when the entry starts, then
multiplied by `reps`.

## 3. Song scheduling

In `service_tick`, at the bar boundary, **after** the existing queue-resolution
block. The ordering is load-bearing: a 1-bar scene must queue its successor on
the same tick it starts, and putting the song step first would resolve the
launch we had only just queued.

```
song_bars_left -= 1

if song_bars_left == 1 && !song_armed:
    song_armed = true
    launch_scene(next entry's slot)          # the one-bar-ahead pulse

if song_bars_left == 0:
    song_pos = (song_pos + 1) % entries.len()   # loops
    song_bars_left = bars_for(entry) * reps
    song_armed = false
```

Arming is skipped when the next entry names the **same scene** as the current
one. Two rules fall out of that single guard:

- A repeat (`reps > 1`) only extends `song_bars_left`; clips are **not**
  re-queued between reps. A 1-bar clip inside a doubled scene simply loops on
  its own — "twice as long", not "triggered twice".
- A **one-entry song** (the single-scene case) wraps onto itself and therefore
  never re-launches. It behaves exactly like having launched that scene by hand,
  which is what "triggering a single scene effectively creates a song of one
  scene" should mean. Without the guard it would silently re-launch every scene
  length, resetting each track's `cycle` and so breaking A:B trig conditions.

No pulse shows in either case, correctly: nothing is about to change.

`play()` (and the auto-start path) resets `song_pos = 0` and launches entry 0,
so stop → start replays the song from the top. `stop()` leaves the song intact.

**Song deletion.** `launch_clip` — a Session pad press — clears `song`.
Clips already playing keep playing; only the sequencing stops. A new Shift+scene
press replaces the song wholesale.

## 4. The Shift gesture (UI)

New `src/seq/song.ts` owns the build gesture and the mirror. It is the only
place that knows Shift+scene is how a song is made.

**Scene row.** A new branch in `router-steps.ts`, *above* the
`trackSelectActive()` check, taken only when `sessionMode && shiftHeld`. Even
step indices are inert; odd ones (buttons 1,3,5…15 → 0-indexed 0,2,4…14) map to
scenes 0-7 — eight step buttons for eight clip slots.

**Building.** The **first** scene press of a Shift hold replaces the song
(`song 3`); every later press in the same hold appends (`songadd 5`). Releasing
Shift ends the build. A bare Shift press with no scene press does nothing —
Shift is used all over the instrument, so a song can only be destroyed by an
actual scene or clip press, never by reaching for Shift.

The first press also launches straight away (queued to the next bar, like any
clip launch), so the song starts before you have finished building it.

**LEDs** (`leds.ts`): when `sessionMode && shiftHeld`, `paintSceneRow()` takes
the row from `paintTrackSelector()`.

| Step | State | LED |
|---|---|---|
| even | not a scene | black |
| odd | scene not in the song | solid green |
| odd | scene used in the current song | pulsing green/black |

Every scene in the song pulses — the whole arrangement reads as queued at a
glance, not just the one scene that happens to be next. The pulse uses the
native animation channel with the lit colour in `anim` and black in `base`
(`{ base: C_BLACK, anim: C_GREEN, channel: ANIM_PULSE }`), per the rule in
`leds.ts`: firmware that ignores the base once a pulse channel is set must still
show the colour.

The scene row shares `cachedSetAnimLED` with the track selector, so the two swap
inside one cache and **no new `seqLedsInvalidate` edge is needed** — that
hazard only applies when swapping between the `cachedSetLED` and
`cachedSetAnimLED` maps, which are independent.

Which scenes are "in the song" comes from the `song=` mirror, so the row and the
screen never disagree.

## 5. Screen

New `drawSongBand()` in `render.ts`, at the bottom of the display in Session
view only. The row is free there: `drawLoopStrip()` is already skipped when
`sessionMode` (`app/tick.ts:712`).

An inverted band reading `SONG 1 2 2 3`, with the currently-playing entry drawn
bright-on-inverted so you can see where in the arrangement you are. Scene
numbers are bare digits — no `s` prefix.

Visible whenever **Shift is held in Session view** (so it appears the instant
you press Shift, empty at first) **or a song is active**. Outside Session view
it is never drawn.

Overflow: a scroll window sized with `fontWidth()` that always keeps the current
entry and the one after it on screen, with a leading `…`.

Repainted **only when the text or the current entry changes**, never per tick,
so a running song costs nothing in the steady state.

## 6. Persistence

One line in `persist.rs`: `sg 1 2 2 3`, omitted when there is no song. The
format's unknown-line tolerance means old saves load fine and new saves stay
readable by older builds.

Transport state stays unsaved, as today: the song loads stopped and starts from
the top on Play.

## 7. Recording

No new mechanism. Recording already targets `rec_track`'s *playing* slot and
extends it bar by bar (`engine.rs:1846`). When a scene switch moves that track's
`playing_slot`, the take follows into the new clip.

What this needs is a test, not code: a scene switch during a take must not
strand the capture on the old slot, and must not wrap a held note's cycle count
into a maximal gate — the same hazard the existing `pending_rec` bar-boundary
code already guards for queued takes.

## 8. Testing

**`cargo test` — the gate.**

- Scene launch reaches all 16 tracks; an empty slot stops that track and nothing
  else is silenced.
- Scene length is the longest clip in the column, rounded up to bars; an empty
  scene is 1 bar.
- Song advance, repeats (`reps` extends duration and does *not* re-queue), and
  wrap-around looping.
- One-bar-ahead arming: `queued_slot` is set exactly one bar early — including
  the 1-bar-scene case, where arming happens on the same boundary the scene
  starts.
- A one-entry song never re-launches: `cycle` keeps counting across the wrap, so
  an A:B trig condition still resolves.
- Stop → restart replays from entry 0; `stop()` preserves the song.
- A clip launch deletes the song; the playing clips keep playing.
- Persist round-trip, including a song with repeats.
- Recording across a scene switch (§7).

**`browser-test/logic/song.mjs`** — new subsystem module, plus one line in each
of `logic.mjs`'s two lists: odd-step → scene mapping, band text, the scroll
window at overflow, and the three scene-row LED states.

**`app-loop.mjs`** — Shift+step in Session view reaches `setLED` as the green
scene row and emits `scene`.

**`screenshot.mjs`** — a new baseline for Session view with the song band.

**`perf.mjs`** — the band adds no per-tick `fill_rect` when unchanged.

**Device** — fold into the existing `test-seq.sh` rather than adding a script.
The engine tests reproduce the scheduling; the device only needs to prove the
gesture and the LEDs survive the real MIDI path.

---

## Behaviour notes worth knowing

- Shift+scene **takes the step row from the 16-track selector** while Shift is
  down. The selector stays on plain (unshifted) presses, so nothing is lost, but
  Shift does change what the row means in Session view.
- A song whose scenes cover different tracks will start and stop those tracks as
  it moves. That is the intended meaning of a scene as a snapshot.
