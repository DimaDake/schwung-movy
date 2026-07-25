# Note-Off Sanity — Design

**Date:** 2026-07-26
**Status:** Approved, ready for implementation plan

## Problem

Movy strands MIDI notes. Two reported symptoms, several confirmed root causes.

Movy sounds notes from two independent sources:

1. **Live pad notes** — the UI sends them directly via `shadow_send_midi_to_dsp`
   for zero latency. Tracked in `keyboardState.held`.
2. **Sequencer notes** — the Rust engine (`dsp.so`) opens gates and emits
   `OutEvent::NoteOff` when they expire.

Each source leaks, and they leak for different reasons.

### Confirmed leaks — live pad notes

`keyboardState.held` is `padNote → midiNote` with **no track recorded**. The
release path (`src/midi/router.ts:172-190`) sends the note-off on
`appState.activeSlot` *as it reads at release time*.

- **Wrong channel on track switch.** Hold a pad on track 1, press track 2,
  release: the note-off goes to track 2's channel. Track 1's note hangs
  forever. `releaseAllNotes(track)` has the same single-channel flaw.
- **Record-capture drift.** `seqNotePadReleased` (`src/seq/router.ts:393`)
  sends `nof <watchTrack>`. Same wrong-track bug, leaving a dangling
  `rec_pending` in the engine.
- **Drum/melodic flip.** `drumPadOff` *recomputes* `midiNote` from the current
  `drumConfig`. If the module changes between note-on and note-off, the release
  takes the other branch, computes a different note, or returns early.
- **Session mode swallows releases.** `src/seq/router.ts:92-99` returns `true`
  for both `0x90` and `0x80` in the pad range, so entering Session mode with a
  pad physically held strands that note.

Investigated and ruled out: Step page, file browser, and module browse do not
touch pads — a pad release reaches `noteOff()` normally in all three.

### Confirmed leaks — sequencer notes

- **No release on teardown.** `host_exit_module()` (`src/midi/router.ts:90`)
  fires with no `stop` / `flush_gates`. Every open gate hangs when
  `unloadOvertakeDsp()` pulls the engine. This is the "close movy while it
  plays its sequence" symptom.
- **Mute is not immediate.** `command.rs:84` `"mute"` only flips the flag.
  Gate countdown runs for muted tracks (`step_tick` decrements before the
  `if !muted` block), so a note muted mid-gate keeps ringing until it expires.

### Host safety net (context, not a fix)

`invokeModuleOnUnload` (`schwung/src/shadow/shadow_ui.js:2782`) broadcasts
CC 123 on all 16 channels at every teardown, and `chain_host.c:103` forwards it
to the synth plugin. That net exists but depends on each synth plugin honoring
CC 123 — which is likely why notes still hang. Movy will not depend on it.

## Design decisions

| Decision | Choice | Rationale |
|---|---|---|
| Note sounding across a track switch | **Cut on switch** | No note outlives the context it belongs to. Simplest and most predictable. |
| Release mechanism | **Explicit note-offs from a ledger** | Universally honored by every synth. No CC 123 dependency anywhere in movy's own code. |
| Startup sweep for crash residue | **Dropped** | A fresh process has no ledger, so the only tool would be CC 123 — the dependency we are deliberately avoiding. Accepted cost: a crash strands notes until the next clean unload. |

## Architecture

### The ledger

New `src/keyboard/held-notes.ts` replaces `keyboardState.held`:

```ts
interface LiveNote { track: number; pitch: number; }
const live = new Map<number, LiveNote>();   // padNote → owner
```

API:

- `noteSounded(padNote, track, pitch)` — record at note-on
- `noteReleased(padNote): LiveNote | undefined` — remove and return the owner
- `drainAll(): LiveNote[]` — remove and return everything
- `drainTrack(track): LiveNote[]` — remove and return one track's entries
- `isSounding(padNote): boolean` — for LED code
- `soundingPitch(padNote): number | undefined`

Every `0x80` message leaves through one `emitNoteOff(track, pitch)` so nothing
else hand-rolls a note-off.

**Governing rule: the ledger — not current UI state — decides the channel and
the pitch.** `noteOff(padNote)` loses its `track` parameter entirely, so it
cannot be passed a wrong one. This kills two bug classes structurally:

- Wrong-channel on track switch: the owner track is recorded at note-on.
- Drum/melodic flip: reading the recorded pitch instead of recomputing it means
  a module change mid-hold can no longer strand the note.

`seqNotePadReleased` takes the owner track from the ledger instead of
`seqState.watchTrack`, closing the dangling `rec_pending`.

Consumers of `keyboardState.held` (`src/app/tick.ts:499`, `:533`) move to
`isSounding()`.

### Release points

Two helpers: `releaseAllLive()` (drain everything) and `releaseLiveOnTrack(t)`.
Each emits on the note's **recorded** track.

| Point | Location | Status |
|---|---|---|
| Track switch | `src/midi/router.ts:281` + momentary-restore closure | new |
| Session mode entry | `src/seq/router.ts:201-207` | new |
| Module load/change in a slot | browse commit, before the swap | new |
| Track mute, and solo's implicit mutes | `src/seq/router.ts` mute/solo handlers | new — `releaseLiveOnTrack` |
| Leave-Movy modal | `src/midi/router.ts:332` | exists, rewired to drain-based |
| Root / octave change | `src/keyboard/handler.ts` `setRoot` | exists, rewired to drain-based |

### Engine teardown — `onUnload`

Register `globalThis.onUnload` (`src/app/globals.ts` → new `src/app/unload.ts`).

The host invokes it on **every** teardown path — Close Movy, Shift+Back instant
exit, and parked-module eviction (`shadow_ui.js:2847`, `:3073`) — before
`unloadOvertakeDsp()`. It:

1. Drains the live ledger and emits a note-off per entry.
2. Walks `seqState.activeNotes` and emits a note-off per sounding
   `(track, pitch)`.

Step 2 works without the engine being alive: the UI already mirrors the
engine's open gates into `seqState.activeNotes` from the `act=` status field
(`src/seq/state.ts:204`, engine `active_notes_state()` at `engine.rs:1355`).

**Staleness caveat:** `activeNotes` is a poll snapshot, so a gate opened since
the last status poll is missed. The host's unconditional CC 123 sweep fires
immediately after `onUnload` and mops up that residue. Movy does not rely on
it, but it is there.

### Engine — immediate mute

Add `Engine::flush_track_gates(track, out)` and call it from the `"mute"` op in
`command.rs` when muting, so sounding sequenced notes stop at mute time rather
than at gate end. Unmuting does not restore them.

## Testing

### `browser-test/logic.mjs`

Extends the existing MIDI-capture pattern at `:959`.

- Hold pad on track 0, switch to track 1: note-off fires on channel **0**, at
  switch time — not at pad release.
- Pad release after that switch emits nothing (ledger already drained).
- Drum module: note-on, swap `drumConfig` to melodic, release → the note-off
  carries the **recorded** pitch.
- `seqNotePadReleased` sends `nof` with the owner track, not `watchTrack`.
- Session-mode entry while a pad is held drains the ledger.
- Mute drains only the muted track's notes.

### `browser-test/app-loop.mjs`

Full init/tick/MIDI loop. Assert **note conservation**: every note-on has a
matching note-off on the same channel, and the ledger is empty at the end of
each scenario. This is the assertion that catches leak paths not enumerated
here.

### `engine/` cargo test

- `mute` mid-gate emits `NoteOff` on that tick.
- Other tracks' gates are untouched.
- The existing muted-track test (`engine.rs:2232`) still passes — no gates
  exist in that scenario, so nothing changes.

### Device

`scripts/test.sh` and `scripts/test-seq.sh` must still pass. The exit-path
note-off is hard to assert by ear; verify instead that `onUnload` fires and
emits the expected messages in the log.

## Out of scope

- Startup sweep for crash residue (dropped — see decisions above).
- Any change to schwung. The host's CC 123 net stays as-is.
- Background mode semantics: parking already releases live notes via the
  Leave-Movy modal, and the sequencer keeping time under Move's UI is intended.
