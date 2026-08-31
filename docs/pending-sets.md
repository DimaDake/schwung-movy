# Set pads Move never writes to disk

Movy deliberately does **not** solve this. The behaviour is aligned with Schwung
and davebox, both of which have the same gap. This file is the record of what
the gap is, what it costs, and what a fix would look like — so the next person
to look does not have to rediscover it from a device.

## What happens

Move materialises `UserLibrary/Sets/<uuid>/` for a Set only once **Move itself**
has something to save in it. A user who plays entirely through Schwung — every
instrument in a Schwung chain, every note in Movy's sequencer — never gives Move
anything, so the Set is never written.

Schwung's shim identifies the current Set by scanning `Sets/` for the directory
whose `user.song-index` xattr matches `currentSongIndex` from `Settings.json`
(`shadow_poll_current_set`, shadow_set_pages.c). When nothing matches, it
publishes a synthetic id instead:

```c
snprintf(pending_uuid, sizeof(pending_uuid), "__pending-%d-%u",
         song_index, (unsigned)sampler_pending_set_seq);
```

`sampler_pending_set_seq` increments **on every visit** to an unresolved pad and
never resets. So one set pad produces a new identity each time you open it.

## What it costs

Everything keyed on that id is written to a namespace nothing will ever read
again. Measured on a device in the field:

| Store | Symptom |
|---|---|
| Schwung slot state (`set_state/__pending-<n>-<s>/slot_*.json`) | the pad's instruments are gone on the next visit |
| Movy sequence + UI state (`sets/__pending-<n>-<s>/`) | the pad's patterns are gone on the next visit |

That device had 32 set pads and **8** real Sets. Schwung's `set_state/` held
pending directories for indices 2 through 31, several per index; Movy's `sets/`
held `__pending-17-1` with 766 bytes of sequence and 36 KB of UI state, stranded.

From the user's seat this reads as "the pad only remembers my layout" — the
layout appears to survive because it lives in memory and the transition into a
new id is treated as the current Set being renamed, which never resets it.

## Why it is not fixed here

- **Schwung does not fix it.** The seq comes from the shim; Movy cannot change
  what id it is handed.
- **davebox does not handle it either.** `seq8` keys its per-set files on
  whatever `active_set.txt` says, including a `__pending-*` id, and churns the
  same way (`ui/ui_persistence.mjs`).
- A Movy-only fix means Movy filing a Set under an id neither of the other two
  agree with, which is the opposite of the goal — and it does nothing for the
  instruments, which are Schwung's.

The Set is still fully playable while you are on it. Recording anything into the
Set from Move itself materialises it, after which everything persists normally —
and only a real Set can be renamed, copied or backed up.

## What movy does about it

Movy asks Move to commit the Set, rather than working around an unreal one — a
track-button press is the gesture that does it, and Move accepts it from the
injection ring like any hardware press.

Two facts constrain when it can be sent, both established on a device and then
confirmed in schwung's source:

- **It must be held.** A press of ~50-200 ms does nothing; 1 s and 2 s both
  work. Movy holds 1.2 s of wall-clock — ticks are the wrong unit, since the
  rate swings 43-220 Hz.
- **The drain is shut while movy is overtaking.** `shadow_drain_midi_inject`
  refuses to feed Move's MIDI_IN whenever a tool is up:

  ```c
  /* In OVERTAKE mode the queue belongs to the overtake publisher in
   * schwung_shim.c, not to us. */
  if (sc && sc->overtake_mode != 0) return;
  ```

  There is no startup window either: `loadOvertakeModule` sets
  `shadow_set_overtake_mode(2)` in step 1 and calls the module's `init()` in
  step 6, so movy is already overtaking before its first line runs.

`shadow_set_overtake_mode` is exposed to modules, so movy lowers the flag for
the length of one press and puts it back — no parking, no exit, screen
untouched. Measured on device: `2 -> 0 @0.15s -> 2 @2.01s`, the Set committed,
and movy kept the surface. Doing it without parking is what makes it cover the
paths parking cannot — an instant Shift+Back exit, a crash, a power cut —
because the Set is real within seconds of opening rather than whenever the user
next parks. Parked, movy does not try at all. The drain is open there and no borrowing
would be needed, but the press is swallowed — Move is still loading the Set the
user just picked, and the pad they picked it with is the last thing it handled.
Every parked attempt did nothing; every attempt from the front committed.
Nothing is lost by waiting: the Set becomes real the moment movy is back on
screen, long before an exit or a crash could cost anything.

The cost, stated plainly: for ~1.7 s the surface belongs to Move, so a pad
pressed in that window plays Move rather than movy, and schwung sees an overtake
exit and re-entry (it holds the inject drain 3 frames across that transition,
which is why the press waits 300 ms before going out). Lowering the flag also
clears `overtake_suppress_sysex`, movy's claim on the LEDs, so movy re-claims it
with the surface. That is why this sits behind the `setcommit` flag — on by
default, because the alternative is losing the Set, but switchable.

## What a fix would look like

**Upstream, one line, fixes it for everyone.** Drop the per-visit counter and key
the pending namespace by the song index alone (`__pending-<index>`). Schwung's
own instruments then persist on these pads, and every tool that follows
`active_set.txt` inherits the fix without changing anything. This is the right
fix and the only one that covers instruments.

**Movy-only, if it ever has to be done without upstream.** It was built and
measured before being dropped; both halves worked on a device:

1. Normalise `__pending-<index>-<seq>` to `__pending-<index>` in
   `readActiveSetAny`, so one pad is one directory across visits.
2. On first adopting `__pending-<index>` with no state, probe
   `__pending-<index>-<seq>` for a bounded range and adopt the highest that
   parses, so work already stranded is recovered rather than deleted.

Two things to know before rebuilding it:

- **It changes the rename rule.** With ids keyed by pad, a *different*
  provisional id means a different pad, so `provisional → provisional` must
  become a switch rather than a rename. Getting that wrong drags one pad's
  sequence into the next.
- **It only moves Movy.** Schwung still churns, so the pad's instruments still
  vanish. The user-visible bug is only half fixed, which is most of the argument
  for doing it upstream instead.

## For the upstream conversation

`schwung-per-set-tool-state.md` is the version of this written for Schwung
rather than for movy: the same three problems (identity churn, uncollected
deleted Sets, no way to reach Move under overtake), with movy's workarounds
described only as evidence of what not fixing them centrally costs.

## Related: storing state where Schwung and davebox store it

davebox writes its per-set files **inside Schwung's own directory** —
`set_state/<uuid>/seq8-state.json` and `seq8-ui-state.json`, next to Schwung's
`slot_*.json` and `shadow_chain_config.json`. Movy keeps a private tree at
`modules/tools/movy/sets/<uuid>/`.

Co-locating would make one Set one directory for all three. It is not free:
`host_remove_dir` is only permitted under `modules/` (js_host_common.c), so
moving there costs the ability to delete state from the module JS at all —
which is why davebox prunes from its **DSP** instead, where C can `opendir` and
`unlink` (`prune_orphan_states`). Movy has its own Rust engine and could do the
same. The order, if this is picked up: move the paths, migrate the old tree on
load, then move collection into the engine — not the other way round, or
collection silently stops working.

Whatever prunes, it must use davebox's aliveness test rather than a bare check
of `Sets/`: switching Schwung set pages moves whole Sets into
`set_pages/page_<n>/`, so from any other page every Set on every other page
looks deleted. Movy's `setUuidAlive` (`src/seq/set-gc.ts`) already implements it.

The benefits and costs of that move — including the two that hold up without
the alignment argument, and the one that turned out to depend on an upstream
change — are worked through in `engine-owned-persistence.md`.
