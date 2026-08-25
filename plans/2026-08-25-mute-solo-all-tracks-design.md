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

Every form is a **latch**: one press toggles, the state stays until it is
toggled back. There is no momentary/hold mute — how long a button is held is
not a different intent here, which is the rule `momentaryUpUngated` already
encodes for the Mute button today.

Shift counts if it was down when Mute was pressed **or** is down at the moment
of the action, as it does today (`muteShiftHeld() || appState.shiftHeld`) —
either order of the two modifiers works.

Mute alone in Session view stays a no-op: there is no current track there. That
is also Move's own rule (manual §16.3 — Mute alone is Note mode only).

### Both ways into Session view

Session view is reachable two ways, and the mute gesture must work in both:

- **latched** — a tap of Note/Session leaves you in Session view;
- **held (temporary)** — the Session button held down shows Session view for as
  long as it is held, and the view reverts on release.

The step row is the 16-track selector in both, plus a third case:
`trackSelectHold`, where a selection made during a held Session keeps the row a
selector after the switch has already dropped you back onto a track. One
predicate already names exactly that set — `trackSelectActive()`
(`seq/track-select.ts:44`) — so the mute branch keys off it rather than off
`sessionMode`, and all three cases are covered by construction.

### Routing

The mute branch sits **above** `sessionStepPress` in `seq/router-steps.ts:58`:
while Mute is held the step row is a mute map, not the track selector, and the
press must not also switch tracks.

It must also leave the **Session button's own momentary alone**. Holding
Session, muting a track, then releasing Session has to revert to the prior view
— the hold was a peek, and muting inside it does not turn it into a latch. So
the mute branch does not touch `CC_NOTE_SESSION`'s momentary the way
`sessionStepPress` does (`momentaryCancel`) for a real track switch.

### The shared momentary slot must stop being clobbered

`momentary.ts` holds exactly **one** active button, and Mute's press currently
takes it (`momentaryDown(CC_MUTE, () => {})`, `router-buttons.ts:65`). Holding
Session and then pressing Mute therefore overwrites the Session momentary,
restore closure included: the later `momentaryUp(CC_NOTE_SESSION)` returns
`none`, the restore never runs, and the peek silently latches into Session view.
That is a bug today, and the new gesture lands squarely on it — holding Session
and pressing Mute is now something the user is *told* to do.

The fix is to stop Mute using the shared slot at all. It never needed the
primitive's real job — its restore is a no-op — only the "was a gesture made
while held" flag. That becomes a plain module-level boolean in
`router-buttons.ts`, and `midi/router.ts:416`'s `momentaryGesture()` call in the
Mute+track branch sets it instead. Mute then never disturbs another button's
momentary, and Session's peek survives.

## State

`src/mixer/track-mutes.ts` remains the sole owner of mute, solo and the
interaction between them, and stays well under the 200-line limit: the only
change to it is the guard.

- Both guards become `track < 0 || track >= TRACK_COUNT`.
- `toggleMute` / `toggleSolo` keep their present shape — one gesture, one undo
  entry, solo derived from the engine mutes with the user's own intent held in
  `base`.
- No new state and no new module: every surface calls those same two functions.

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

Unchanged. Each mute or solo press is one undo entry covering both halves of
what it moves — the engine mutes and the solo bookkeeping — exactly as
`asOneEdit` does today. `mutesSnapshot`/`restoreMutes` are already 16-wide, so
the persisted blob's shape does not move; tracks 5-16 simply start appearing in
arrays that always had room for them.

## Tests

Local first, cheapest level that reproduces each claim:

- `browser-test/logic/mute-solo.mjs`
  - a mute on track 15 reaches the engine (`mute 15 1`) and the mirror — prove
    the teeth by restoring the `> 3` guard and watching it fail;
  - solo on a track above 3 derives all sixteen mutes and restores `base` on
    un-solo.
- `browser-test/logic/seq-router.mjs`
  - with Mute held, a Session step press mutes that track and does **not**
    switch tracks; Shift makes the same press a solo;
  - the same press works in all three selector states: latched Session, held
    Session, and `trackSelectHold`;
  - pressing Mute while Session is held no longer strands the Session
    momentary — the Session release still reverts to the prior view. (Teeth:
    fails on today's code.)
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
  16-track reach, the Session step gesture (in both latched and held Session
  view), and the new LED meanings.
- `README.md` only if this is called out as a headline feature; otherwise
  MANUAL.md alone.
- `CHANGELOG.md` entry.

## Out of scope

- Changing what mute silences (audio gate vs sequenced-note gate).
- Making solo additive rather than exclusive.
- A momentary (hold-to-mute) form on any surface. Every mute latches.
- Mute for drum pads within a track (Move has it; movy does not, and it is a
  different feature).
- Any schwung-side or Move-side mute integration.
