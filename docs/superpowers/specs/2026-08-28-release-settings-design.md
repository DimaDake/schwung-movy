# Release-visible settings: CPU Optimization and Movy Tracks 1-4

**Date:** 2026-08-28
**Status:** implemented

## Problem

Two settings a user may legitimately need are locked inside a debug-only page.

1. **CPU optimization.** Parallel chain render, three lanes and full idle skip are
   what keep a heavy set inside the 2902 us frame. They are also the settings most
   likely to upset a module that misbehaves under threading. A user hitting that
   has no way out of it in a shipped build.
2. **Movy-hosted tracks 1-4.** `chtracks` moves tracks 1-4 off schwung's serial
   shadow slots and onto movy's parallel chains — worth ~20-25% of chain render.
   It ships OFF because it is not free: those tracks give up Move's mixer fader,
   per-slot Link Audio and schwung's cached param reads, and an existing set was
   built expecting the schwung behaviour.

The second one is the interesting half. We want new sets to get the faster
arrangement by default, without changing what any set built before it does.

## Design

### 1. The flag table describes visibility, scope and ownership

`FlagDef` (`src/seq/flags-def.ts`) gains four optional fields:

| field | meaning |
| --- | --- |
| `release` | listed on the page in a release build, not only in a debug one |
| `uiOnly` | never pushed to the engine under its own key |
| `perSet` | the value lives in the set's `ui-state.json`, not `prefs.json` |
| `labels` | word labels indexed from `min`, for values `OFF`/`ON` cannot say |

The table stays the single driver of the page, persistence and the engine push.
That property is the reason to extend it rather than special-case the two new
rows in page code.

(`uiOnly` rather than `local`: `browser-test/logic/flags.mjs` was already
written against that name, testing a field the table did not yet have.)

A new leaf `src/seq/flags-visible.ts` owns the list the page walks:

```ts
visibleFlags() = DEBUG_BUILD ? FLAGS : FLAGS.filter(f => f.release)
```

plus the one conditional row (below). `flags-page.ts` (jog clamp, knob target)
and `flags-page-vm.ts` walk that list instead of raw `FLAGS` — they index by
position today, so a filtered list without this change selects the wrong row.

It lives in its own module because `flags-def.ts` cannot import `flags.ts`
(the value store already imports the table).

Keeping `DEBUG_BUILD` referenced here also keeps `scripts/build-module.sh`'s
release assertion meaningful: once the page itself is un-gated, this is the only
remaining reader of the constant.

### 2. CPU Optimization is one master over two derived engine values

New flag `cpuopt` — `CPU Optimize`, bool, default ON, `release`, `uiOnly`.

It is not an engine param. `flags.ts` gains `engineValue(key)`:

| engine key | pushed value |
| --- | --- |
| `chparallel` | `cpuopt ? chparallel : 0` |
| `chidle` | `cpuopt ? chidle : 0` |
| `chtracks` | the RESOLVED host boolean (§3), never the mode |
| everything else | its own value; `local` flags are not pushed at all |

`chlanes` 3, `chidle` 3 and `chpin` 0 stay hidden at today's defaults and take
effect whenever the master is ON. Turning the master OFF is therefore a full
serial fallback — no lanes, no idle skip — which is what an escape hatch has to
be to be worth having.

Editing `cpuopt` re-pushes both derived keys; `setFlag` today pushes only the key
edited. The existing lanes-before-parallel ordering in `applyFlagsToEngine` is
preserved (turning parallel on spawns the pool at the current lane count).

No `FLAGS_REV` bump: the key is new, so no device has a stored opinion to
override.

In a debug build `chparallel` can read ON while `cpuopt` OFF makes it inert.
Deliberately unmarked — override plumbing for a debug-only row costs more than
it explains.

### 3. Movy Tracks 1-4 is a global mode plus a per-set value

`chtracks` becomes an ordinal 0..2:

| value | label | meaning |
| --- | --- | --- |
| 0 | `SCHWUNG` | tracks 1-4 are schwung shadow slots, everywhere |
| 1 | `MOVY` | tracks 1-4 are movy chains 0-3, everywhere |
| 2 | `NEW SETS` | each set decides; sets movy has never seen decide MOVY |

Default 2, with `revisedAt: 2` and `FLAGS_REV -> 2`, so a device that already
stored a 0 adopts the new default exactly once. `chparallel`'s `revisedAt: 1` is
untouched by the bump (`rev < 1` is already false).

A second row `This Set` (`chtrackset`, `perSet`, `uiOnly`, labels
`SCHWUNG`/`MOVY`) is listed **only while the mode is NEW SETS**. In the two
explicit modes it would display a value the knob cannot change, which is worse
than not listing it.

**Resolution** is `resolveHost(mode, setChoice)`, a pure function in
`flags-def.ts` — beside the constants, and reachable from both the places that
need it. It cannot live in `host-mode.ts`: that file imports `ref.ts`, and
`ref.ts` is what needs the answer. `ref.ts` exports `movyTracksOn()` over it,
and `flags.ts` folds it into the engine's `chtracks`.

```
mode SCHWUNG  -> false
mode MOVY     -> true
mode NEW SETS -> this set's stored value (false until a set has resolved)
```

**Per-set storage** is a `flags` object in the set's `ui-state.json`, keyed by
flag key (`{"flags":{"chtrackset":1}}`) — the same shape prefs.json uses for the
machine's half, so a second per-set flag needs no new plumbing:

| path | value | why |
| --- | --- | --- |
| `resetUiState()` — no blob at all | 1 (movy) | a set movy has never seen is a new set |
| `applyUiState()`, field absent | 0 (`legacy`) | a set built before this feature keeps behaving as it did |
| `applyUiState()`, field present | as stored | the set's own decision, latched |
| before any set has loaded | 0 (`legacy`) | boot is neither case; the conservative answer, and what movy did before the flag existed |

That last row is not a detail: reading `def` at boot puts tracks 1-4 on movy
chains before the set that owns them has said so, which is a different host for
every param read in the window before the first load.

`serializeUiState()` writes it, so a decision reached either way latches on the
next save. The value is written and kept even while an explicit mode is active,
so returning to NEW SETS restores each set's own choice rather than a global one.

**Ordering.** Both apply paths set the per-set choice *before*
`clearChainsNotIn`/`restoreChains`, which route by `trackKind()`.
`setMovyTracks()` is refactored into `withHostFlip(next, mutate)`: same
release-gates, then flip, then drop the port cache, rebuild the track models,
reset the pad route, request a label sync — now driven by the RESOLVED value
changing for any reason, a set load included. That ordering is the whole point of
`host-mode.ts`: a note-off resolves its port at release time, so flipping first
delivers note-offs to the host that never played the note.

The engine receives the resolved 0/1 under `chtracks`. `drain_out` decides
whether a sequenced note leaves as MIDI or enters a chain; a mode value of 2
there is a silent routing bug.

### 4. The page exists in release; only its contents are filtered

The `DEBUG_BUILD &&` gates in `router-steps.ts` (Shift+Step 2), `tick.ts`
(render), `midi/router.ts` (knob touch, knob turn, jog), `param-page.ts` and
`input-reset.ts` become unconditional. Header `FLAGS` -> `SETTINGS` in both
builds, since it is now a user surface.

## Testing

Every test proven by removing the fix and watching it fail. Three mutations were
run against the finished code: dropping the `cpuopt` gate in `engineValue` (4
failures), giving an old set the new default instead of `legacy` (50), and
dropping the `release` filter in `visibleFlags` (1, naming the whole list).

One thing the plan did not anticipate: `chtracks` shipping as NEW SETS makes any
suite that loads a Set leave tracks 1-4 on movy chains, and the next suite reads
its params through the wrong port. The runner now resets that between suites,
and `app-loop.mjs` pins `chtracks` to SCHWUNG — its mocked instrument is a
schwung slot.

- Flag table pins: `cpuopt` default ON; `chtracks` default 2; the release list is
  exactly `cpuopt` + `chtracks` (+ `chtrackset` in NEW SETS); the debug list is
  all of them.
- Engine push table with `cpuopt` OFF: `chparallel` and `chidle` go out as 0
  while their stored values are unchanged; `local` keys are not pushed.
- `FLAGS_REV` adoption: a prefs.json holding `chtracks: 0` at rev 1 comes up at 2.
- Mode x per-set truth table through `trackKind()` / `chainInstance()`.
- `ui-state` round trip: new set -> movy, fieldless blob -> schwung, stored value
  honoured, serialize writes it.
- Chains restore into chains 0-3 only when the resolved host is movy.
- Screenshot baselines regenerate; a new `flags-release` scene covers the
  filtered list.
- `npm test`, then deploy and one device suite run.

## Out of scope

- Marking overridden rows in the debug list (see §2).
- Exposing `chlanes`, `chidle`, `chpin` or `setcommit` in release.
- Migrating an existing set's schwung slot contents into movy chains: nothing
  migrates, exactly as `chtracks` behaves today.
