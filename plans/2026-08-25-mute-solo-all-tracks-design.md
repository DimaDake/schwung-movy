# Mute and solo for all 16 tracks — design

Status: design, approved 2026-08-25. Implementation plan to follow.

## The bug

`toggleMute` and `toggleSolo` (`src/mixer/track-mutes.ts:86`, `:98`) both open with

```js
if (track < 0 || track > 3) return;
```

That ceiling was written when movy had four tracks and has been stale since
`578139b` widened the UI to sixteen. Everything underneath it is already
16-wide: `seqState.muted` (`seq/state.ts:146`), the `solo`/`base` arrays, the
persisted blob (`mutesSnapshot`), and the engine's `mute` command, which accepts
any `t < NUM_TRACKS` with `NUM_TRACKS = 16` (`seq-core/src/track.rs:6`).

So the existing gestures already *point at* tracks 5-16 — `Mute + track button`
addresses the focused group's quartet, and the octave buttons scroll that group
across all sixteen — and are silently dropped at the door. Nothing reports it:
the toast, the log line and the LED all read the mirror, which never moved.

Two gaps beyond the guard:

- Reaching tracks 5-16 by track button requires scrolling the group first.
  Session view already turns the 16 step buttons into a 16-track selector
  (`seq/track-select.ts`), which is the surface that can address every track at
  once — but it has no mute gesture.
- Session view renders no mute state at all. The step row shows selection and
  focus group; the clip grid shows clip content and transport. A muted track is
  invisible there, while a track button dims for the same state.

## What mute means (unchanged)

Mute is the engine's sequenced-note gate for all 16 tracks: the track keeps
advancing and emits nothing (`engine.rs:980`). Live pads played on a silenced
track and any audio tail still sound. Solo is derived from it — soloing mutes
everything else — and stays movy's own control; nothing here touches schwung.

The considered alternative was a true audio mute for movy tracks via the
mixer's `TrackMix.muted` (`movy-dsp/src/mixer.rs:35`, reachable through the
`mix` param). Rejected for this work: it exists only for movy chains, so tracks
1-4 and 5-16 would mute differently unless `chtracks` is on, and it is a
separate question from "the gesture does not reach track 7". The schwung route
(`slot:muted`) is deliberately not resurrected — `ce500e9` moved solo off the
schwung path on purpose.

Solo also stays **exclusive** (soloing another track moves the solo) and keeps
overriding mute. Neither is revisited here.

## Gestures

| Surface | Gesture | Result |
|---|---|---|
| Track view | **Mute** | mute/unmute the active track — now any of 16 |
| Track or Session view | **Mute + track button** | that track; quartet-addressed, now works above track 4 |
| Session view | **Mute + step 1-16** | that track directly, no group scrolling |
| any of the above | **+ Shift** | solo instead of mute |
| Session step form only | tap vs hold | tap latches; hold ≥ 500 ms reverts on release |

Shift counts if it was down when Mute was pressed **or** is down at the moment
of the action, as it does today (`muteShiftHeld() || appState.shiftHeld`) —
either order of the two modifiers works.

The two rows of that table compose: **Shift + Mute + step** solos, and it takes
the same tap/hold rule — a held Shift+Mute+step is a momentary solo that drops
on release.

Mute alone in Session view stays a no-op: there is no current track there. That
is also Move's own rule (manual §16.3 — Mute alone is Note mode only).

Toasts follow the state, not the gesture: the press toasts as today
(`T7 MUTED` / `T7 SOLO`), and a revert toasts the state it restored, so the
display never keeps claiming a mute that has already lifted.

### Why the hold form is Session-only

Approved 2026-08-25: `Mute + track button` keeps today's behaviour, where any
press latches however long it is held. Only the Session step form distinguishes
tap from hold. The two surfaces therefore differ, and MANUAL.md must say so
rather than describe one rule.

### Routing

The Session step branch must sit **above** `sessionStepPress` in
`seq/router-steps.ts:58`: while Mute is held the step row is a mute map, not the
track selector, and the press must not also switch tracks. It calls
`momentaryGesture()` on the Mute momentary so that Mute's own release does not
additionally toggle the active track — the same suppression
`midi/router.ts:416` already performs for the track-button form.

## State

`src/mixer/track-mutes.ts` remains the sole owner of mute, solo and the
interaction between them. It is 150 lines today and the hold bookkeeping will
not fit under the 200-line limit, so the map and its release rule move into
`src/mixer/mute-hold.ts`, which calls back into the toggle API rather than
touching `solo`/`base` itself — one owner of the state, one owner of the
gesture's timing.

- Both guards become `track < 0 || track >= TRACK_COUNT`.
- New pair for the hold form: `muteGestureDown(track, opts)` /
  `muteGestureUp(track)`, backed by a module-level
  `Map<number, {solo, pressMs, prevMuted, prevSolo}>`.
- Release rule: `now - pressMs >= HOLD_MS (500)` → revert to the snapshot taken
  at the press; otherwise latch. Wall-clock, not ticks, for the reason
  `seq/momentary.ts` already documents: the device tick rate is not a constant.
- The map is deliberately **not** `momentary.ts`. That primitive holds exactly
  one active button and Mute already occupies the slot
  (`router-buttons.ts:65`). A per-track map also allows several tracks to be
  held muted at once, which is the point of a momentary mute.
- `prevSolo` is the previously soloed track index (or `-1`): solo is exclusive,
  so one number restores it exactly. `prevMuted` is that track's own mute bit —
  the user's intent (`isMuted`), not the derived engine mute, so a hold taken
  while some other track is soloed reverts to the right thing.
- Timestamps are injected by the caller for the same testability reason
  `momentaryDownAt`/`momentaryUpAt` take them.

**The gesture belongs to the step, not to Mute.** Releasing the Mute button
while a step is still held does not end the hold — the step's own release
decides latch vs revert. Otherwise letting go of the modifier first (the common
grip) would silently latch a mute the user was auditioning.

**In-flight holds are reverted, never stranded.** `resetHeldInput`
(`app/input-reset.ts`) and `resetTrackMutes` restore every open hold's snapshot
rather than dropping it where `resetTrackSelect` drops its latches: an
abandoned view switch is a surprise, but an abandoned momentary mute is a
silent track with no finger on it and no way to see why.

A momentary hold does move `seqState.muted`, so an autosave landing mid-hold
can persist a mute the user never latched. That is bounded by the revert-on-
reset rule above (movy's teardown restores it) and is not worked around
further — a hold is a sub-second gesture, and the alternative is a shadow mute
state the engine does not share.

## LEDs

The rule everywhere: **muted → the dim track colour**, composed with whatever
that surface already encodes.

- **Session step row** (`sessionStepLed`, `track-select.ts:55`). Selection stays
  solid white and outranks everything. A muted track in the focused group pulses
  `black ↔ trackColorDim` instead of `black ↔ trackColor`, so focus (motion) and
  mute (brightness) are both still readable; a muted track outside the group is
  solid dim.
- **Clip grid** (`sessionCellColor`, `session.ts:98`). A muted track's cells take
  `trackColorDim` as their base. Playing and queued keep their white pulse so
  transport stays legible on a muted track.
- **Track buttons**: unchanged — they already dim from the same mirror.
- **Solo gets no rendering of its own**, exactly as on the track buttons today
  (`leds.ts:134`): it silences other tracks by muting them, so the mute
  rendering already shows it.
- **Mute button LED**: today pinned to `WHITE_DIM` (`leds.ts:174`, `paintAffordances`).
  It becomes bright while any track is muted or soloed. With 16 tracks and 4
  visible track buttons this is the only always-visible "something is silenced"
  cue.

All three LED surfaces read `seqState.muted`, which already carries the derived
solo mutes — no second source of truth.

## Undo and persistence

A momentary that reverts leaves **no** undo entry. Otherwise a one-second hold
pushes MUTE and then UNMUTE, and undo walks the user through states they never
chose.

So the press applies raw (not through `asOneEdit`) and captures
`readUiField('mutes')`; the release decides:

- **latch** → open the edit group, record the one UI op, close it — exactly the
  entry today's tap produces;
- **revert** → restore raw, record nothing.

Latched mutes persist unchanged: `mutesSnapshot`/`restoreMutes` are already
16-wide and their shape does not move. An in-flight hold is deliberately not
persisted — it dies with the gesture, and reviving one on reopen would strand a
mute the user never latched.

## Tests

Local first, cheapest level that reproduces each claim:

- `browser-test/logic/mute-solo.mjs`
  - a mute on track 15 reaches the engine (`mute 15 1`) and the mirror — prove
    the teeth by restoring the `> 3` guard and watching it fail;
  - solo on a track above 3 derives all sixteen mutes and restores `base` on
    un-solo;
  - latch vs revert with injected timestamps (`< 500 ms` latches, `>= 500 ms`
    reverts to the exact prior mute *and* solo state);
  - a reverted hold records no undo entry; a latched one records exactly one;
  - releasing Mute before the step does not end the hold;
  - `resetTrackMutes` with a hold open restores the snapshot.
- `browser-test/logic/seq-router.mjs` — with Mute held, a Session step press
  mutes that track and does **not** switch tracks; Shift makes the same press a
  solo.
- `browser-test/logic/seq-leds.mjs`, `seq-session.mjs` — dim rendering on the
  step row (including the muted-and-focused composition) and on clip-grid cells;
  Mute button bright while anything is muted.
- `browser-test/perf.mjs` — unchanged budgets must still pass. Nothing here adds
  IPC or a per-tick read: the LED work reads `seqState.muted`, which the status
  poll already maintains, and every write goes through the existing
  `cachedSetLED`/`cachedSetAnimLED` diffing, so an idle frame sends nothing new.
- Screenshot baselines regenerated if rendering moves
  (`node browser-test/screenshot.mjs --update`).
- `scripts/test-mutes.sh` extended on device with one track above 4 and the
  Session step form, including the reopen case the browser tests structurally
  cannot cover.

## Docs

- `MANUAL.md` §Mute/Solo (~line 744) and the gesture table (~line 1405): the
  16-track reach, the Session step gesture, the Session-only hold rule, and the
  new LED meanings.
- `README.md` only if this is called out as a headline feature; otherwise
  MANUAL.md alone.
- `CHANGELOG.md` entry.

## Out of scope

- Changing what mute silences (audio gate vs sequenced-note gate).
- Making solo additive rather than exclusive.
- Mute for drum pads within a track (Move has it; movy does not, and it is a
  different feature).
- Any schwung-side or Move-side mute integration.
