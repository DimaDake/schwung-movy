# Set-state clearing: switch vs rename, stable pending ids, GC

Three field reports, one subsystem: `src/seq/set-session.ts`.

1. Deleting a set in Move clears schwung's synths but not movy's sequence — the
   next visit to that pad still plays the old set.
2. "Sets beyond the first few record nothing but the layout — no patterns, no
   instruments."
3. "Left movy in background mode, came back, the first 4 track modules were gone."

All three are from v0.29.0, whose persistence code is identical to `main`
(only `chtracks` has touched these files since the tag).

## Evidence

### The rename rule fires on real set switches (reproduced locally)

`identityChanged()` asks one question — does the incoming set have a movy state
file? — and calls `rename()` when it does not, carrying the work in hand into
that set. It never asks whether the *outgoing* id was provisional, which is the
only case the rename was written for.

Probe against the mock fs + mock engine: boot on real set `SETA` (has state),
record a pattern, flip `active_set.txt` to real set `SETB` (no state):

```
on set B: SETB
engine now holds: "...cl 0 0 32 0 0:24:62:110"   <- A's edit, still playing
B state on disk:  "...cl 0 0 32 0 0:24:62:110"   <- and written into B
```

schwung does the opposite. `SET_CHANGED` (shadow_ui.js:19025) saves the outgoing
set, clears all four slots, and for an unseen uuid seeds an **empty** state
directory (`seed_empty_set_state`, shadow_set_pages.c:119). It seeds from another
set only through the explicit "Copy"/Song.abl-size heuristic.

### Most set pads never resolve to a real uuid

The device has **8** real sets, and their `user.song-index` xattrs are scattered
(0, 6, 7, 8, 16, 24, 26, 27) — the other 24 pads are empty slots.

`shadow_poll_current_set` matches a set by scanning `UserLibrary/Sets/<uuid>` for
that xattr. Move only materialises that directory once **Move itself** has
content to save; a user who plays only through schwung/movy never gives it any.
So those pads never match, and the shim publishes `__pending-<index>-<seq>` with
a **fresh seq on every visit** (shadow_set_pages.c:576).

movy keys its state on that id, so every visit to the same pad is a brand-new
set. The device shows exactly that:

```
__pending-17-1  seq=766b  ui=36487b     <- real work, orphaned
__pending-10-1  seq=321b  ui=184b
__pending-10-3  seq=420b  ui=2838b      <- pad 11, visited at least 3 times
```

and schwung's own `set_state/` has pending directories for indices 2-31, several
per index (`__pending-9-2` … `__pending-9-7`).

This is report 2, exactly: the pattern is written to a namespace nothing will
ever read back, schwung seeds empty slots so the instruments go too, and the
layout survives only because it lives in memory and `rename()` never resets it.

### Background mode is on the same path

`sessionTick()` runs while parked (`src/app/tick.ts:246`), so all of the above is
live under Move's UI. Report 3 is schwung's pass-1 slot clear firing for an
identity it treats as new, while movy carries the sequence forward — the two
sides reacting to one identity change in opposite directions.

### Deleted sets leak

Of 11 uuid-keyed directories under movy's `sets/`, only 6 have a live
`UserLibrary/Sets/<uuid>`. One dead set is holding 1474 b of sequence and 16 KB
of UI state.

`host_remove_dir` — which the code's comments say does not exist — is registered
for module JS and permits any path under `/data/UserData/schwung/modules`
(js_host_common.c:437,455). movy's `sets/` is inside it.

## Design

### 1. Rename only when leaving a provisional identity

`readActiveSetAny()` already returns `provisional`; `sessionTick` throws it away.
The rule becomes:

| outgoing → incoming | today | after |
|---|---|---|
| provisional → real (materialisation) | rename | rename |
| provisional → provisional, other index | rename | **switch** |
| real → real, incoming has no state | rename | **switch** |
| any → incoming that has state | switch | switch |

A switch into a set with no state is `enterLoading`, which already pushes
`BLANK_STATE` and calls `resetUiState()` — schwung's empty seed, in movy's terms.

The middle row flips an assumption the R3 test encodes ("provisional to a
different provisional is still a rename"). With stable pending ids (below), a
different provisional id means a different pad, so it is a genuine switch. R3
gets rewritten rather than deleted: same-pad churn is what it was protecting, and
that is now impossible by construction.

Residual: provisional → a real set that movy has never seen still renames, and
would carry work onto it. Distinguishing that from materialisation needs the
incoming set's song index, which no host API exposes. Materialisation is the
common case and losing the work is the worse failure, so it keeps the rename.

### 2. Key an unresolved set by its index

Normalise `__pending-<index>-<seq>` to `__pending-<index>` for storage and
identity. One pad, one directory, across any number of visits.

Migration, so the work already on those devices is not stranded: when adopting
`__pending-<index>` for the first time and it has no state, probe
`__pending-<index>-<seq>` for seq 1..12 and adopt the highest that parses.
Bounded, runs once per pad, uses the existing `readBestState`.

### 3. Garbage-collect dead sets

No host API lists a directory, but `name-index.json` already maps every set name
movy has seen to its uuid. On load, for each uuid in that index whose
`UserLibrary/Sets/<uuid>` is gone, `host_remove_dir` its state directory and drop
the entry. Migrated `__pending-<index>-<seq>` directories go the same way.

## Tests

- `browser-test/logic/set-session.mjs`: real → real with no incoming state loads
  blank (the probe above, as an assertion); real → real with state still
  switches; provisional → real still renames; R3 rewritten to assert a switch;
  same-pad revisit under a new seq keeps its state; migration adopts the highest
  intact `-<seq>`; GC removes a uuid whose Move set is gone and keeps one whose
  set is live.
- Each new assertion checked with the fix removed, per CLAUDE.md.
- `mock-fs.mjs` needs `host_remove_dir` and directory-aware removal.

## Device verification (2026-08-27)

Deployed `ui.js` to `move.local` and opened movy via `open_tool_cmd.json` +
`/dev/shm/schwung-control[56] = 1`. The set state was backed up to
`sets.bak-preGC/` first.

```
seq: loaded set 5c8ce3c3-8016-4fcc-8482-e58a0cc81d39
seq: collected 4 deleted set(s)
```

All four collected directories had no `UserLibrary/Sets/<uuid>`; every live Set
was left alone. A fifth dead directory survived because it is not in
`name-index.json` — the documented limit of an index-driven sweep.

Migration was then exercised against real stranded work by pointing
`active_set.txt` at `__pending-17-1` (766 b of sequence, 36 KB of UI state):

```
seq: adopted orphaned pad state from 1 visit(s)
seq: loaded set __pending-17
```

`__pending-17-1` is gone and `__pending-17` holds its sequence.
`active_set.txt` was restored afterwards and movy switched back to the real Set,
as the rule requires (incoming has state → switch, not rename).

## Found while verifying — NOT fixed here

Saving a Set within a second or two of loading it truncates the movy-hosted
chain list. `restoreChains` queues one module load per audio callback, and a
`serializeUiState()` that runs before the queue drains captures only what has
landed: the forced save on the switch back rewrote pad 17's UI blob from 7
chains to 3 (36 KB → 13 KB). Restored from the backup by hand.

Pre-existing — the old rule took the same path for this transition — and
independent of everything above, but it is a data-loss bug in its own right and
a plausible second mechanism behind "the track modules were gone".
