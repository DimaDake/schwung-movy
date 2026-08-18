# Set lifecycle: one owner, one phase, no load over live work

**Status:** design approved, not yet implemented
**Date:** 2026-08-18

## The problem

Movy decides three things — which Set it is in, whether the engine is alive, and
whether its state has been loaded — in three different files, from four
independent variables (`curUuid === null`, `engineReady()`, `engineGeneration()
=== restoredGen`, and implicitly whether a status poll has landed). Nothing owns
the answer, so every caller reassembles it, and the combinations nobody thought
about are where the bugs live.

Four shipped bugs came out of one such combination (#4, #5, #6, fixed in
`7bbbb5a` / `8f37a53`): a Set resolving *after* the user had already played into
the engine caused Movy to push that Set's state — which for a new Set is nothing
— straight over the live pattern. The fix works, but it is a guard bolted onto a
shape that invites the mistake. This design removes the shape.

`persist.ts` is 227 lines, over the project's own 200-line limit, which is the
same fact stated another way.

## What we know about Set identity

Established by reading schwung and by probing the device, not assumed.

**`__pending-N-M` is schwung's invention, not Move's.** When Move's
`Sets/<uuid>/` directory has not materialised yet, `shadow_set_pages.c:560`
synthesises `__pending-<songIndex>-<seq>` and, in its own comment, presents *"an
immediate blank working state in a synthetic pending namespace"*. Schwung
publishes that as the current Set, and the UI thread writes it into
`active_set.txt` — which is where Movy reads it.

Movy's own comment attributing this to Move is wrong and should be corrected
when this lands.

**It is common and it persists.** The device carries **25** orphaned
`set_state/__pending-*` directories, and `__pending-28-3/slot_1.json` holds 7 KB
of real module state. These are not momentary.

**Nothing bounds how long it lasts.** It ends when Move materialises the Set
directory with its `user.song-index` xattr — outside schwung's control and
outside ours. No part of this design may depend on a duration.

## Decisions

| Decision | Choice |
|---|---|
| Brand-new Set | **Never lock the user out.** Identity is discovered; work is never blocked on it. |
| Engine boot | **Gate everything** behind a visible loading state. |
| Storage | **Lifecycle only.** On-disk format, envelope, checksum, rotation and the engine-generation guard are untouched. |
| Structure | **A phase machine with one owner.** |

## Design

### One owner

`src/seq/set-session.ts` holds the only lifecycle state:

- **phase** — `booting → loading → ready`, plus `switching`
- **set** — `{ id, name, provisional }`

Everything else asks `sessionReady()` instead of assembling an answer.

### Phases

- **booting** — the engine is not answering. Input refused; the screen says so.
- **loading** — one pass, in order: resolve identity → read blobs → push engine
  state → apply UI state → restore chains. Not interactive.
- **ready** — normal operation; autosave runs.
- **switching** — the Set changed underneath us: flush the old, re-enter loading.

The engine-generation guard folds in: if the generation changes, we are by
definition no longer `ready`, so we re-enter `loading`. The same protection,
expressed once instead of compared at three call sites.

### Identity, and the rule that kills the bug class

A Set is either **real** (a UUID) or **provisional**. Movy does not invent its
own provisional namespace — it **adopts schwung's**, because `active_set.txt`
already carries `__pending-N-M`. Movy's provisional identity is therefore
"whatever schwung published", and Movy's transition is the same transition
schwung is making.

Two transitions exist, and only two:

- **provisional → real is a RENAME.** The work in hand already belongs to this
  Set. Its files are rewritten under the real UUID and **nothing is loaded**.
  Write the new location first, delete the provisional directory only after that
  write is confirmed, so a half-done rename leaves garbage rather than a hole.
- **real → different real is a SWITCH.** Flush the old, load the new.

There is no third case. The "adopt" special case in `switchToSet` and
`engineHoldsClips()` disappear: a rename cannot overwrite anything, so the bug
becomes unrepresentable rather than guarded against.

### The gate

Input is refused while `booting` and `loading`, with one exception: **Back must
always work.** If the engine never comes up the user has to be able to leave.

If the engine is declared **absent** (the existing failure state, ~10-30 s),
Movy surfaces the failure and unlocks the chain/knob pages, because that half of
Movy needs no engine and gating it would leave a brick. The sequencer stays
visibly inert. This is a degraded mode, not a second input category in the happy
path.

Gating removes the `seqCmd` queue-into-a-not-yet-existing-engine path outright:
nothing can be queued before the engine exists, so every handler may assume a
live engine.

### What this deletes

- the `adopt` branch and `engineHoldsClips()`
- the scattered `curUuid === null` guards
- `UNKNOWN_SET_POLLS` and the `_default` fallback — a provisional Set *is* that,
  promoted to a first-class thing
- the pre-ready command queue

## Step 0: measure the pending window

Before building, turn the remaining assumption into data. A script polls
`active_set.txt` at ~200 ms and logs id + timestamp while the user creates a Set
on the Move. It yields the real id format, the real duration, and a fixture for
the tests. This is the one step needing a human at the device; everything else
stays automated.

It also answers a question this design deliberately does not depend on, so a
surprising result changes the tests, not the architecture.

## Not in scope

**Schwung wipes the chain on the same transition.** `shadow_ui.js:14352`
handles `SET_CHANGED` by seeding the new Set's `slot_N.json` with `"{}"`,
clearing **all** slots, then reloading only files longer than 10 bytes — so a
module loaded during the pending window is cleared and never restored. Confirmed
in the field: a module loaded on a new Set vanished seconds later, with
schwung's own "set loaded" toast.

This is the host-side twin of the bug fixed here and Movy cannot fix it —
tracks 1-4 *are* schwung slots. It is very likely the cause of #1 and #9. It
needs an upstream fix, and the minimal one reuses machinery already present:
when the outgoing directory was a pending namespace for the same song index,
copy it into the new directory instead of seeding empty, exactly as schwung
already does for duplicated Sets.

Movy's own state is unaffected by that bug: the sequencer's notes live in
Movy's own file.

## Testing

- **`logic.mjs`** — phase transitions; provisional → real keeps the work and
  writes it under the real id; a Set with saved state still loads; engine reload
  re-pushes; switch flushes then loads. The F6/F6a tests rewrite against the new
  API.
- **`app-loop.mjs`** — presses during `booting`/`loading` are ignored rather
  than queued; Back still exits while gated.
- **`screenshot.mjs`** — a baseline for the loading screen (new UI state).
- **`perf.mjs`** — the session tick adds no per-tick IPC.
- **Device** — `test-seq.sh` gains an assertion that a step pressed during boot
  leaves no note behind.
- **`MANUAL.md`** — the loading screen is user-visible and gets a line.

Every test must be proven to fail with the fix removed.

## Layout

`persist.ts` (227 lines) splits into three files, each under the limit:

| File | Holds |
|---|---|
| `set-session.ts` | phase, identity, transitions |
| `set-load.ts` | the loading pass |
| `set-save.ts` | autosave and flush |

`set-context.ts`, `set-inherit.ts`, `persist-store.ts`, `persist-blob.ts`,
`ui-state.ts` and `chain-persist.ts` are untouched. No format change, so
existing Sets on device load exactly as they do today.
