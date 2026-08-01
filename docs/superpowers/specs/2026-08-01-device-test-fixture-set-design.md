# Device tests run against a fixed fixture state

**Date:** 2026-08-01
**Status:** approved, pending implementation plan

## Goal

Device tests are **stable** and **independent**. Concretely, the acceptance bar
for every one of the nine device scripts:

1. **Standalone** — passes when run on its own, with no other script run first.
2. **Any order** — passes regardless of which scripts ran before it.
3. **Repeatable** — passes twice in a row without manual cleanup between runs.
4. **Honest** — when a precondition genuinely cannot hold, it says so and fails
   or skips with a stated reason; it never passes vacuously and never exits
   silently.

Today none of these hold. The suites assert against whatever the device's live
set happens to contain and mutate that state for each other: `test-unload.sh`
deletes the clip whose automation lane `test-reselect.sh` needs; step presses
toggle, so "fill 16 steps" empties a clip a previous run filled;
`test-seq.sh`'s multi-step check skips entirely because track 0 holds a melodic
module; `test-auto.sh` drove a knob on a page whose contents depended on the
loaded module.

## Non-goals

- **Switching Move sets.** Move's firmware owns set switching — schwung only
  reacts to a `SET_CHANGED` flag from the shim, and `active_set.txt` is a mirror
  shadow_ui *writes* (from `getSlotParam(0, "active_set")`), not an input. The
  harness therefore cannot select a set. It applies the fixture to whichever set
  is active and restores that set afterwards.
- **Changing product code.** This is harness work. If a fixture exposes a real
  product bug, that is a separate change.
- **Local (browser) suites.** Unaffected; they are already deterministic.

## Architecture

### Shared library

One new `scripts/lib/test-set.sh`, sourced by the eight shell scripts.
`test-jog-hint.mjs` (node) shells out to the same script rather than
reimplementing it — one implementation, so the two paths cannot drift. Three
verbs:

- `test_set_begin` — snapshot the current state, apply the fixture, then
  **verify the fixture took**, aborting with a clear message if not. Silent
  divergence between intended and actual state is the failure mode this whole
  design exists to remove, so it must never be inferred — always read back.
- `test_set_restore` — put the captured state back. Registered with
  `trap test_set_restore EXIT INT TERM` so it runs on failure and Ctrl-C, not
  only on a clean exit. `test-module-contract.sh` already proves this pattern.
- `test_set_recover` — called at the start of `test_set_begin`: if a previous
  run died hard and left a stale on-device backup, restore from it *before*
  snapshotting, so a crash cannot cascade into the fixture being captured as
  though it were the user's state.

### State surfaces

| Half | Location | How it is captured / applied |
|---|---|---|
| schwung chain | slot modules, per component | `scripts/module-slot.mjs get\|set <slot> <component>` (remote-UI WS, port 7700) |
| movy sequencer | `modules/tools/movy/sets/<uuid>/seq-state.json` | file copy on device; `<uuid>` from line 1 of `active_set.txt` |

The snapshot is written to `/data/UserData/schwung/_movy-test-backup/` on the
device (not just a shell variable) so it survives the script process dying.

**Ordering constraint:** movy reads `seq-state.json` when it opens and autosaves
over it while running. The fixture state must therefore be written while movy is
**closed**, and the restore must also happen with movy closed — otherwise a
running movy overwrites the restored file within ~3 s.

## Fixture

Checked into the repo under `scripts/fixtures/device-set/`.

| Slot | Module | Why |
|---|---|---|
| Track 0 synth | `plaits` | melodic, has a movy config (`src/modules/plaits.json`) → deterministic knob layout for the automation tests |
| Track 1 synth | `mrdrums` | drum config → `watchLane >= 0`, so multi-step **asserts** instead of skipping |
| Tracks 2–3 synth | empty | nothing needs them; keeps apply/restore cheap |
| All FX slots | empty | `test-module-contract.sh` parks `smack` in FX 1 itself and restores it |

Plus a canonical `seq-state.json` carrying: known tempo and swing, a clip on
track 0, and a **pre-existing automation lane on track 0** so
`test-reselect.sh` runs standalone rather than depending on `test-auto.sh`
having run first.

That file is **hand-written plain text**, which `src/seq/persist-blob.ts:60`
permits: a blob carrying neither a `gen` line nor an `end` trailer is accepted
as a legacy file at generation 0. Only a blob with `gen` but no matching
trailer is rejected as a torn write. So the fixture needs no checksum and stays
readable, diffable and editable in the repo — better than capturing a real
save, which would be opaque and would bake in a stale generation number.

`scripts/fixtures/README.md` records the grammar and how to start from a real
save if ever needed. No test regenerates it: a test that rewrites its own
fixture cannot detect drift.

## Per-script changes

| Script | Change |
|---|---|
| `test.sh` | `test_set_begin`; assert against the fixture's slot-0 synth instead of "no synth loaded (expected)" |
| `test-seq.sh` | `test_set_begin`; multi-step targets **track 1** and becomes a real assertion, replacing the skip |
| `test-auto.sh` | `test_set_begin`; keep the Preset-page paging as belt-and-braces |
| `test-unload.sh` | `test_set_begin`; keeps its own clip delete + fast `tap_step` |
| `test-reselect.sh` | `test_set_begin`; the fixture's automation lane removes the "add automation first" skip |
| `test-mutes.sh`, `test-volume.sh` | `test_set_begin` for consistency; neither depends on a module |
| `test-module-contract.sh` | `test_set_begin` outside its existing FX-1 park/restore, which stays |
| `test-jog-hint.mjs` | same begin/restore via the node path |

## Verifying the harness itself

The library is test infrastructure, so it needs its own proof — and the proof
must have teeth:

1. **Restore is faithful** — snapshot a known chain, apply the fixture, restore,
   then read every slot back and compare. Sabotage the restore and watch it fail.
2. **Fail-fast fires** — make `apply` a no-op and confirm `test_set_begin`
   aborts with its stated message rather than proceeding.
3. **Crash recovery** — kill a run between apply and restore, then confirm the
   next `test_set_begin` recovers the user's state from the on-device backup.
4. **The acceptance bar** — run all nine scripts standalone, then in a shuffled
   order, then twice back-to-back, and confirm each passes every time.

## Stretch: interference from physical input

A stray knob turn or pad press mid-run corrupts a test and today produces a
mystery failure. Blocking hardware input outright is **not available**: schwung
exposes only output-side suppression (`shadow_set_overtake_suppress_sysex`) and
`host_suspend_overtake`, with no input lock. Adding one means changing schwung,
which is a reference repo here and would belong upstream, not in movy.

So the goal is narrowed to *detecting* interference and saying so, which is what
stability actually requires — a run disturbed by a human should report that
plainly instead of failing obscurely. Capacitive touch is the signal with the
lowest false-positive rate: the harness never injects knob-touch (notes 0–7) or
jog-touch (note 9) except where a test does so deliberately, so an unexplained
touch during a run means a human hand. Optional and last: the suite is useful
without it.

## Risks

- **The user's active set is modified during a run.** Accepted (chosen over a
  dedicated-set gate, which would require a manual device step before every
  run). Mitigated by the on-device backup and the crash-recovery path. Device
  tests should not be run mid-session on a set with unsaved work until restore
  has been observed working.
- **`plaits` / `mrdrums` must be installed.** Both are present on the device
  today. `test_set_begin` verifies the applied module reads back and fails with
  a clear message naming the missing module rather than running on wrong state.
- **Move firmware may rewrite `active_set.txt`** if the user switches sets
  mid-run, which would point the restore at the wrong set. The captured UUID is
  recorded at snapshot time and the restore refuses to write if the active UUID
  has changed since.
