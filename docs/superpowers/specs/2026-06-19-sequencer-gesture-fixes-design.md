# Sequencer Gesture & UX Fixes — Design

Date: 2026-06-19
Status: design pending written-spec review before planning.

## 1. Problem

A batch of sequencer interaction bugs/gaps, sharing one root cause:
**modifier-gated gestures (Mute / Clear / Copy held) are handled inconsistently
across the two routing layers (`seq/router.ts` first-look + `midi/router.ts`
param-page) and several modules (`edit-ops`, `session`, `automation`), each with
its own held/acted state.** This produces cross-layer leaks (mute moves the step
focus) and wrong side-effects (Clear still deletes the clip after clearing
automation).

## 2. Scope (6 issues; held-step length LEDs deferred)

1. **Mute focus leak** — muting a track must not switch the step-view focus to it,
   and pressing a track button while Mute is held must not switch tracks at all.
2. **Duplicate gesture** — hold Copy → press source → press destination, for
   clips (cross-track), steps, and bars; the destination is **replaced**, not
   merged.
3. **Clear + clip** — hold Clear, then press clip(s) to delete each (multiple
   while held), with a toast. A plain Clear **tap** still deletes the current
   clip when nothing else acted.
4. **No autostart on note entry** — entering a step/note while stopped must not
   start the transport.
5. **Toast duration** — toasts show a flat ~1.5 s.
6. **Clear + automation knob** — clearing a lane's automation must not also
   delete the whole clip.

**Deferred (next iteration):** held-step note-length step-LED indication (issue
7) — it is broken for melodic lanes too and is out of scope here.

**Rule established for this and future work:** to delete/clear anything the user
holds the **Clear button first**; "hold a target then press Clear" reverse
gestures are not supported anywhere.

## 3. Architecture

Targeted fixes plus one small shared-state cleanup — **not** a gesture-arbiter
rewrite (YAGNI). Three structural touch-points:

- **Mute gating at the first-look layer.** `seqHandleMidi`'s track-button
  observer skips the `watchTrack` retarget when `muteHeld()`. Combined with the
  existing `midi/router.ts` guard (which already skips `activeSlot` on
  `muteHeld()`), a track press while Mute is held is purely a mute — no focus
  change at either layer. (Issue 1)
- **A shared "Clear acted" signal.** `edit-ops` exposes `markDeleteActed()`; any
  clear action that runs while Clear is held (automation-knob clear, step-
  automation clear) calls it, so Clear-release deletes the clip only when nothing
  else acted. (Issues 3, 6)
- **Copy becomes one context-dispatched Duplicate gesture** in a new small
  `src/seq/duplicate.ts`. Hold Copy → press source → press destination, with the
  unit (clip / step / bar) chosen by the current view. Replaces today's two-step
  copy→paste. (Issue 2)

## 4. Per-issue design

### 4.1 Mute focus leak (issue 1)
`src/seq/router.ts` track-button branch (currently ~231-239): wrap the
`watchTrack`/`barOffset`/`watch` retarget in `if (!muteHeld())`. When Mute is
held, observe-and-ignore (still `return false` so the param layer runs its mute
path). `midi/router.ts:133` already does `if (muteHeld()) { muteTrack(track);
… return; }`, so no focus change happens anywhere. Removes both the focus switch
and the colour leak (the leak was the step view repainting for the muted track).

### 4.2 Duplicate gesture (issue 2)
New `src/seq/duplicate.ts` owns the Copy (CC 60) gesture for **all** views.
State: `dupHeld: boolean`, `dupSource: Unit | null`, where a `Unit` is
`{ kind: 'clip'|'step'|'bar', track, slot|step|bar }`.

- **Copy down:** `dupHeld = true; dupSource = null`.
- **Copy up:** `dupHeld = false; dupSource = null` (cancel; no-op if nothing
  captured).
- **A unit press while `dupHeld`:**
  - no `dupSource` yet → capture it (copy to the engine clipboard):
    - clip → `clipcopy <track> <slot>`
    - step → `cpy <track> <step> <step>`
    - bar  → `cpy <track> <bar*16> <bar*16+15>`
  - `dupSource` set → paste-**replace** at the pressed destination, and **keep
    `dupSource` armed** so the same source can be stamped to multiple
    destinations while Copy stays held:
    - clip → `clippaste <track> <slot>` (engine already overwrites the slot)
    - step → `pst <track> <destStep>`
    - bar  → `pst <track> <destBar*16>`
  - emit a toast on capture ("Copied") and on paste ("Pasted").

Routing: in `seq/router.ts`, Copy (CC 60) calls `duplicate.copyButton(down)`
regardless of view. When `duplicate.dupActive()` is true, the relevant button
press is consumed by the gesture **before** its normal handling:
- session clip pad → `onUnit({ kind: 'clip', track, slot })`;
- step button in **note** view → `onUnit({ kind: 'step', track, step })`;
- step button in **loop** view (a bar) → `onUnit({ kind: 'bar', track, bar })`.
The old `edit-ops` copy/`session` copy paths are removed.

**Engine — replace semantics.** `paste_steps` must clear the destination span
before pasting so steps/bars replace rather than merge — and an **empty source
must still clear** the destination (replace with empty). So `copy_steps` records
the source span width `clipboard_span = s1 - s0 + 1` on the engine (a new field),
independent of whether the source had any notes/locks. `paste_steps` then:
- `delete_range(track, dest, dest + clipboard_span - 1, None)` (notes) and clears
  locks in `[dest, dest + clipboard_span - 1]`,
- pastes the clipboard notes/locks as today (no-op if the source was empty).
Remove the early-return on an empty clipboard so an empty source still clears the
destination. `clippaste`/`paste_clip` already overwrites the whole slot, so clips
need no change.

### 4.3 Clear + clip; Clear tap (issue 3)
Session `Clear` (CC 119) keeps `deleteHeld`; a clip pad pressed while
`deleteHeld` emits `clipdelat <track> <slot>` + toast, and `deleteHeld` persists
so multiple clips delete in one hold. No reverse gesture. In note/loop view, a
Clear **tap** (press+release, nothing pressed between) still deletes the current
clip via `edit-ops.deleteButton` release — gated by the shared acted flag (§4.6).
Confirm/ensure the toast fires for every delete.

### 4.4 No autostart on note entry (issue 4)
- **Engine:** remove the `maybe_autostart` calls from the `tog`, `pst`, `addp`,
  and live-record entry paths in `command.rs` (and drop `maybe_autostart` if it
  becomes unused, plus its test `tog_autostarts_transport`, replaced by a
  "tog does NOT autostart" test).
- **UI:** remove the optimistic `if (!seqState.playing) seqState.playing = true;`
  in `seq/router.ts` `toggleStep`.
Entering notes while stopped leaves the transport stopped; the clip is still
created and steps still light.

### 4.5 Toast duration (issue 5)
`render.ts` `seqToast` uses a fixed duration for every toast (~1.5 s). At the
device's ~196 ticks/s that is ~294 ticks; define `TOAST_TTL = 294` and have
`seqToast` ignore any per-call `ttlTicks`. The **header** view-switch
announcements (`seqHeaderAnnounce`) are unchanged.

### 4.6 Clear + automation knob (issue 6)
`midi/router.ts:58` (`if (deleteActive() && info) { clearLaneForKnob(...);
return; }`) calls `markDeleteActed()` after clearing the lane, so the subsequent
Clear-release in `edit-ops.deleteButton` sees `delActed === true` and does **not**
emit `clipdel`. The step-automation clear path (`edit-ops.deleteButton` down,
which already sets `delActed`) is unchanged. Toast remains "Automation cleared".

## 5. Files touched

- `src/seq/router.ts` — mute gating; route Copy/clips/steps/bars to `duplicate`;
  drop the optimistic `playing = true`.
- `src/seq/duplicate.ts` — **new**, the unified duplicate gesture.
- `src/seq/edit-ops.ts` — export `markDeleteActed()`; remove old copy/paste-step
  gesture (moved to `duplicate`); keep Clear tap→clip-delete + the step-automation
  clear.
- `src/seq/session.ts` — remove old session copy/paste (moved to `duplicate`);
  keep Clear+clip delete.
- `src/midi/router.ts` — `markDeleteActed()` after `clearLaneForKnob`.
- `src/seq/render.ts` — flat `TOAST_TTL`.
- `engine/crates/seq-core/src/command.rs` — drop autostart on entry paths.
- `engine/crates/seq-core/src/engine.rs` — `paste_steps` replace semantics; maybe
  remove `maybe_autostart`.
- Bump `ENGINE_VERSION` (engine + `constants.ts`) — engine behavior changed.

## 6. Tests

### Rust (`cargo test`)
- `paste_steps` clears the destination span before pasting (replace, not merge);
  source span width derived correctly.
- `paste_steps` with an **empty** source clears the destination span (replace
  with empty), using `clipboard_span`.
- `tog` / `pst` / `addp` do **not** start the transport when stopped (replace
  `tog_autostarts_transport`).
- `clippaste` still overwrites the whole slot (regression).

### `logic.mjs`
- Mute held + track press → `watchTrack` unchanged, no `watch` cmd.
- Duplicate: Copy down → source press → dest press emits `clipcopy`+`clippaste`
  (session), `cpy`+`pst` (note), bar `cpy`+`pst` (loop); source stays armed for a
  second destination.
- Clear held + clip press(es) → `clipdelat` per clip + toast; Clear tap with no
  other action → `clipdel`; Clear + automation-knob clear → `aclr` and **no**
  `clipdel` on release.
- Step entry while stopped → `playing` stays false; clip still created.
- `seqToast` TTL is the flat value.

### `screenshot.mjs`
- New baseline for the ~1.5 s toast if timing affects a captured frame (else no
  new baselines — no rendering change).

### Device (`test-seq.sh`)
- Mute+track does not switch the step view; duplicate clip/step/bar replaces the
  destination; multi-clip clear while holding Clear; entering steps while stopped
  does not start playback.

## 7. Out of scope (YAGNI / deferred)
- Held-step note-length step-LED indication (issue 7) — next iteration.
- "Hold target then press Clear" reverse gestures — explicitly unsupported.
- A general gesture-arbiter/state-machine rewrite — targeted fixes suffice.
