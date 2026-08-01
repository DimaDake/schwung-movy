# Device test fixtures

`device-set/` is the state every device test runs against. `test_set_begin`
(from `scripts/lib/test-set.sh`) applies it to whichever Move set is active —
Move's firmware owns set switching, so the harness cannot select a set.

| File | What it is |
|---|---|
| `slots.txt` | `slot module` per line; `none` leaves the slot empty |
| `slot_<N>.json` | schwung's own slot format — module **and** every parameter value |
| `seq-state.json` | movy's sequencer state (clips, tempo, automation lanes) |
| `ui-state.json` | movy's per-set UI state — mute/solo, root, scale, layout, per-track octave |

Both movy files are per-set and both must be reset: resetting only `seq-state`
leaves each run inheriting the previous one's solo state. The rotating
`seq-state.1/2.json` shadows are deleted on apply, since a stale
higher-generation shadow outranks the fixture and would be restored back over
it on the next open.

## Why `load_file` and not just a module id

Loading a module id alone leaves the slot's parameters wherever the last test
dragged them, which is not a fixed state. `load_file` restores the module and
its full parameter state together.

Three device behaviours the library works around, all verified on hardware:

- `load_file` acts on the slot's **existing chain instance**. It does nothing to
  an empty slot, and on a slot holding a *different* module it empties the slot
  instead of switching it. So the module is loaded first whenever the slot does
  not already hold it.
- Fixtures must **not** live under `set_state/<uuid>/`. schwung autosaves over
  that directory, so a fixture kept there silently becomes a copy of whatever
  ran last. They are pushed to `/data/UserData/schwung/_movy-fixture/` instead.
- Chain loads settle at their own pace — a slot can still read empty seconds
  after the shim logs the load — so apply retries until a read-back confirms it.

## Regenerating slot_<N>.json

Load the module you want, set its parameters on the device, then let schwung
autosave and copy its file out:

    ssh ableton@move.local 'ls /data/UserData/schwung/set_state/<uuid>/'
    scp ableton@move.local:/data/UserData/schwung/set_state/<uuid>/slot_0.json \
        scripts/fixtures/device-set/slot_0.json

`<uuid>` is line 1 of `/data/UserData/schwung/active_set.txt`.

## Editing seq-state.json

Edit it by hand — it is movy's line format (see
`engine/crates/seq-core/src/persist.rs`), not JSON despite the name, which is
fixed by `src/seq/set-context.ts`.

    bpm <bpm x100>            swing <pct>          link <0|1>
    tk <track> <active_clip> <muted>
    au <track> <lane> <base> <label>
    cl <track> <clip> <length_steps> <loop_start> <tick:gate:pitch:vel;...>
    cp <track> <clip> <scale_num> <scale_den> <transpose>

A step is 24 ticks. Drum pitches are pad addresses — mrdrums starts at note 36
(`padNoteStart` in `src/modules/mrdrums.json`).

It must carry **neither** a `gen` line nor an `end` trailer: a blob with neither
is accepted as a legacy file at generation 0 (`src/seq/persist-blob.ts`), while
`gen` without a matching `end` is rejected as a torn write. That is what lets
this file stay readable and diffable instead of carrying a checksum.

No test regenerates these files: a test that rewrites its own fixture cannot
detect drift.
