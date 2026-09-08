# Set version history — design

Status: approved design, not yet implemented.
Date: 2026-09-08

## Why

Movy keeps two rotating shadow copies of a set's sequence so a torn write cannot
lose it. That is enough to survive a crash and nothing else. It is not enough to
survive a *decision* — and this week it did not: a failure screen offered
`JOG CLICK = START EMPTY` for a fault it could not fix, users took the offer, and
the blank went to the canonical file and one shadow. The remaining shadow was the
only copy of the work, recoverable for exactly one more save.

Two copies that are both rewritten every few seconds are a torn-write guard, not
a history. This adds the history: a bounded set of older versions, kept on
deliberate conditions, browsable and restorable from the device.

## Goals

- Survive mistakes, not just crashes: a bad update, an accidental wipe, a set
  that opens blank.
- A limited amount of creative rollback — "take me back to before I rewrote the
  bassline" — without turning into a general version-control system.
- Restorable **on the device**, with no computer and no SSH.
- Existing sets, written by every earlier build, are picked up rather than
  starting from an empty history.

## Non-goals

- Browsing another set's history. The menu shows the set you have open; a set you
  are not in is recovered by switching to it first.
- Naming or annotating versions.
- Restoring Schwung's own four track slots. Those live in Move's set file, not
  movy's, and no host API lets movy write them. The confirm step says so.
- Deduplicating repeated ui blobs across versions. Reference-counting shared
  blobs through a thinning pass is real complexity for space this device has.

## Constraints that shaped the design

Discovered before designing, and each one closes off an otherwise-obvious option:

- **No directory listing.** `host_*` exposes read, write, exists, ensure_dir and
  remove_dir — nothing enumerates. So the version list must be an index movy
  maintains itself, and `collectDeadSets` already works this way (it sweeps
  `name-index.json`, not the filesystem).
- **No single-file delete.** `host_remove_dir` is the only removal, so anything
  that must be individually expirable has to be its own directory.
- **No append.** `host_write_file` writes whole files, which is why a journal
  format was rejected: its write cost would grow with the history it protects.
- **`Date.now()` works and the Move's clock is correct** (verified against real
  time on device). Timestamps are real — but a clock can still be wrong, so
  nothing is *ordered* by it.
- **Flash wear, not space, is the budget.** The autosave already writes three
  files every few seconds whenever the state is dirty.

## On-disk layout

Existing files keep their exact current names, contents and semantics:

```
sets/<uuid>/
  seq-state.json          current sequence, enveloped        (unchanged)
  seq-state.1.json        rotation shadow                    (unchanged)
  seq-state.2.json        rotation shadow                    (unchanged)
  ui-state.json           current ui blob                    (unchanged)
  versions.json           NEW — the index
  v/<n>/seq-state.json    NEW — a kept version's sequence, enveloped
  v/<n>/ui-state.json     NEW — that version's ui blob, OPTIONAL
```

`n` counts up per set and is never reused, so a stale index entry can never point
at a recycled directory.

Version history layers **on top of** the rotation rather than replacing it. The
rotation goes on absorbing torn writes at autosave speed; versions are a slower,
deliberate layer above it.

## The index — `versions.json`

```json
{
  "next": 12,
  "v": [
    {"n": 11, "gen": 48, "ms": 1788892154000, "why": "open",     "clips": 6, "ui": true},
    {"n": 9,  "gen": 41, "ms": 1788885000000, "why": "auto",     "clips": 6, "ui": true},
    {"n": 2,  "gen": 0,  "ms": 0,             "why": "adopted",  "clips": 5, "ui": false}
  ]
}
```

Newest first. Fields:

- `n` — directory name under `v/`.
- `gen` — the envelope generation of the stored sequence. **The ordering key.**
- `ms` — `Date.now()` at capture, or 0 when unknown. Display only, and bucketing.
- `why` — `open` | `auto` | `exit` | `pre-wipe` | `pre-restore` | `adopted`.
- `clips` — count of `cl ` lines in the payload. On a 128×64 screen this is how a
  user tells a real version from a blank one, which is the exact discrimination
  someone recovering a wipe needs.
- `ui` — whether `v/<n>/ui-state.json` exists.

**Write order: the version directory first, the index second.** A crash between
them leaves an unreferenced directory — harmless, and collected on the next
capture — rather than an index entry pointing at nothing.

**Self-heal on read:** an entry whose directory is gone is dropped from the list
(and the index rewritten); an unparseable index is treated as *no versions*,
never as an instruction to delete anything.

## Capture conditions

Five moments, and nothing else:

| `why` | When | Guard |
|---|---|---|
| `open` | `enterLoading`, from the state read off disk, **before movy can write anything** | skip if the payload equals the newest version's |
| `pre-wipe` | `sessionStartFromScratch`, before `BLANK_STATE` is written | none — always |
| `auto` | inside `saveSet`, when it actually wrote | at most one per `VERSION_MIN_MS` (10 min), and only if the payload changed |
| `exit` | `sessionFlush(force)` — teardown, or a set switch | only if the payload changed since the last version |
| `pre-restore` | immediately before a restore | none — always (a restore must be undoable) |

The `open` snapshot is the one that matters most: it costs a single write per set
open and would have made this week's incident a non-event.

Worst case a two-hour session captures `open` + twelve `auto` + `exit` ≈ 14
version writes. Against an autosave that already writes three files every few
seconds, that is a rounding error.

## Retention ladder

`MAX_VERSIONS = 32` per set. When a capture would exceed it, exactly one version
is dropped, decided by a **pure function** — versions plus `now` in, the `n` to
drop out — so the spread is directly testable.

Four age buckets, evaluated against the clock at capture time:

| Bucket | Cap | Spacing this produces |
|---|---|---|
| ≤ 1 hour | 8 | minutes — this is the session history |
| 1–24 hours | 8 | ~hourly |
| 1–7 days | 8 | ~daily |
| older | 8 | ~weekly |

Roughly two months of milestones in 32 slots: the last hour in detail, today by
the hour, this week by the day, then by the week.

**Caps do not roll over.** Letting an idle bucket lend slots to the recent one is
how a long session eats the history it exists to protect. Because the caps sum to
exactly `MAX_VERSIONS`, exceeding the total always means some bucket is over its
own cap — there is no separate global rule.

The spacing column is the ladder's *effect*, not a second mechanism. There is one
rule: **a version migrates down the ladder as it ages, and when its bucket is over
cap, the bucket drops the interior version whose two neighbours are closest
together in time** — thin where it is densest. Only interior versions are
candidates: a bucket's oldest and newest anchor its span, and dropping them would
shrink the range the bucket is there to cover. (A bucket over an 8-cap always has
interior members; should one somehow have none, it drops its oldest.)

Two protections override the ladder:

- the **newest 3** are never dropped;
- a **`pre-wipe` inside 7 days** is never dropped. Those exist precisely because
  something destructive happened.

**Clock safety.** A version whose `ms` is 0, missing, or in the future is placed
in the oldest bucket and ranked there by `gen`. Ordering is always by `gen`; the
clock only decides bucket membership.

## Adoption — existing sets

On the first open of a set with no `versions.json`, movy adopts what is already
on disk. This is what makes the feature useful on day one instead of after a week
of use, and it promotes the rescue copy that `scripts/recover-sets.mjs` currently
reaches for into the menu automatically.

1. Parse `seq-state.json`, `seq-state.1.json`, `seq-state.2.json`.
2. Discard unparseable ones; deduplicate by payload.
3. **Copy** the survivors into `v/<n>/`, ordered by `gen`, oldest `n` first, with
   `why: "adopted"`.

Copying is not optional. The shadows are live rotation slots — adopting them by
reference would mean the history evaporates on the next autosave.

**The ui half.** `ui-state.json` was never rotated: there is exactly one, the
current one. Pairing an *older* adopted sequence with today's chains would be a
quiet lie, so:

- the **newest** adopted version takes the current `ui-state.json` (`ui: true`);
- **older** adopted versions get none (`ui: false`);
- a version with `ui: false` restores **the sequence only, leaving chains
  untouched**, and the menu marks it `SEQ ONLY`.

**Legacy envelopes** — files predating the `gen`/`end` wrapper, which
`parseState` already reports as `legacy: true` — adopt at `gen 0`, `ms 0`, and
display as `OLDEST` rather than inventing a date.

Adoption is **lazy, per set, on open**. There is no directory listing, and
sweeping every set at startup would be a write burst for sets the user may never
open again.

## Restore

Restoring version `n`:

1. **Capture the present** as `pre-restore`. A mis-press must not cost the live
   take.
2. Write `n`'s sequence to the canonical file **and both rotation shadows**, at
   `gen = max(every copy and every version) + 1`.
3. Write `n`'s ui blob **if it has one**. If `ui: false`, chains are left alone.
4. Re-enter the ordinary load path — the same one a set switch uses — so the
   engine receives the state, chains reload, and the existing `LOADING MODULES`
   splash covers the settling.

**Step 2 writes all three copies for a proven reason.** Verified on device: with
a blank at generation 8 in a shadow and the rescue at generation 7, restoring
only the canonical file still loads empty, because `readBestState` takes the
highest generation it can read. The negative case is a test.

## UI

**Entry.** The Settings page (Shift+Step 2) gains an action row, `BACKUPS ▸`.
It is not a flag — jog-click opens `VIEW_VERSIONS`.

**The list.** Newest first, one row per version:

```
   2m ago   OPENED       6 clips
  18m ago   AUTOSAVE     6 clips
   1h ago   BEFORE WIPE  6 clips
   3h ago   AUTOSAVE     4 clips
  Sep 4     ADOPTED      5 clips   SEQ ONLY
```

Relative time reads better than absolute at this size and degrades gracefully: a
version with no usable timestamp shows `OLDEST` rather than a fabricated date.

**Gestures.** Jog scrolls. **Shift+jog jumps bucket to bucket** — 32 rows is
eight screens of plain scrolling — reusing the level-skip idiom the cursor
pagination already established. Jog-click selects and raises a confirm line:

```
JOG = RESTORE · BACK = CANCEL
SCHWUNG TRACK SLOTS NOT INCLUDED
```

Back leaves. Structurally the page is a sibling of Set Params and Clip Params in
the `param-page.ts` layer, so one Back leaves it and a track button closes it,
exactly like its neighbours.

**Empty state.** `NO BACKUPS YET` — also what an unreadable index shows.

## Failure handling

- Every write verified by read-back (`safeWrite`), as today.
- Version directory before index entry; orphan directories collected, dangling
  entries dropped.
- An unreadable index reads as *no versions*, never as permission to delete.
- **A capture that fails never blocks a save.** The set's current state outranks
  its history, always.
- A version whose files will not parse is shown as unusable rather than offered.
- `collectDeadSets` already removes a dead set's directory; `v/` goes with it.

## Compatibility

**Backward** — covered by adoption above.

**Forward** — structural, and asserted rather than assumed: `seq-state.json`, the
two shadows and `ui-state.json` keep their exact current format. Everything new
lives in files an older build never opens, so an older movy installed over this
one reads the same set it always did. A local test pins the canonical layout so
that adding a key to it fails there.

## Testing

### Local (the gate)

- **Retention ladder** — table-driven against the pure function: a month of
  timestamps in, bucket occupancy out; the newest 3 survive; a recent `pre-wipe`
  survives; no bucket lends slots to another; a version with `ms: 0` lands in the
  oldest bucket and is ranked by `gen`.
- **Adoption** — against the real pre-feature captures already checked in at
  `browser-test/fixtures/old-sets/`: distinct copies adopted, duplicates
  collapsed, `ui: true` on the newest only, legacy envelopes at `gen 0`.
- **Capture conditions** — each of the five fires exactly when it should; the
  `auto` interval holds; a blank payload never displaces a version with content.
- **Restore** — writes all three copies at a winning generation. The negative
  case (canonical only) must fail, mirroring the device-proven trap.
- **Index self-heal** — dangling entry dropped, orphan directory collected,
  unparseable index reads as empty.
- **Forward compatibility** — the canonical file's format is unchanged.
- **Screenshots** — the page empty, populated, and confirming.

### Device — `scripts/test-versions.sh`, both host arms

Backward compatibility is the emphasis; all four run under
`test-all-device-schwung.sh` and `test-all-device-movy.sh`.

1. **An old set adopts.** Seed a set directory with real pre-feature files, open
   movy, assert: the set loads with its clips intact, `versions.json` appears,
   the adopted directories match the distinct copies on disk, and the current
   state was not modified.
2. **A legacy-envelope file adopts** at generation 0 and is still restorable.
3. **The full loop** — capture, wipe, restore, then read the clips back **out of
   the engine**, not off disk.
4. **An old set that this build has never opened** still opens unchanged.

## Module plan

New files, each with one job and inside the repo's 200-line limit:

| File | Responsibility |
|---|---|
| `src/seq/version-index.ts` | the index record, parse/serialize, self-heal |
| `src/seq/version-store.ts` | version directory I/O — read, write, remove |
| `src/seq/version-capture.ts` | the five capture conditions, and adoption |
| `src/seq/version-retain.ts` | the bucket ladder — **pure**, no I/O |
| `src/seq/version-restore.ts` | the restore sequence |
| `src/seq/versions-page.ts` | page state, jog, click, confirm |
| `src/renderer/versions-view.ts` | the rows |

Edits to existing files, all small: `set-session.ts` (capture hooks at open,
autosave and flush), `set-fail.ts` (`pre-wipe`), `flags-page.ts` (the `BACKUPS ▸`
row), `app/state.ts` (`VIEW_VERSIONS`), `param-page.ts` (sibling wiring),
`midi/router.ts` (page gestures).

`version-retain.ts` being pure is deliberate: the whole "good spread" guarantee
lives in one function with no I/O, so it is exhaustively testable.
