# Device test fixtures

`device-set/` is the state every device test runs against. `test_set_begin`
(from `scripts/lib/test-set.sh`) applies it to whichever Move set is active —
Move's firmware owns set switching, so the harness cannot select a set.

| File | What it is |
|---|---|
| `slots.txt` | `slot module` per line; `none` leaves the slot empty |
| `slot_<N>.json` | schwung's own slot format — module **and** every parameter value |
| `seq-state.json` | movy's sequencer state (clips, tempo, automation lanes) |
| `ui-state.json` | movy's per-set UI state — mute/solo, root, scale, layout, per-track octave, **and the movy-hosted chains** |

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

## Restoring the hardware

Every suite calls `test_set_end` on exit, which restarts the Move stack via
`restart-move.sh` and waits for it to come back (~10 s).

This is not optional housekeeping: device tests leave movy open in overtake,
where it owns the LEDs and suppresses Move's own LED writes. Nothing hands them
back when the run ends, so without the restart the pads and step buttons stay
dark and the hardware looks broken. The restart also clears the wedged inject
ring that intermittently floods shadow_ui with zero-MIDI.

Set `TS_SKIP_RESTORE=1` to suppress it — `test-all-device.sh` does this so a
sweep restarts once at the end rather than once per suite.

## The fixture seeds BOTH hosts for tracks 1-4

Tracks 1-4 belong to whichever host `chtracks` names — Schwung's four shadow
slots, or movy's own chains 0-3 — and every suite runs on both:

    ./scripts/test-all-device-schwung.sh    # tracks 1-4 on schwung's slots
    ./scripts/test-all-device-movy.sh       # tracks 1-4 on movy's chains 0-3

`TS_HOST_MODE` (`schwung` | `movy`, default `schwung`) is what those two set.
It reaches the device as `flags.chtracks` in **`prefs.json`** — the global mode,
deliberately, not the set's `chtrackset`: `resolveHost` consults the per-set
half only in `NEW SETS` mode, so writing 0 or 1 makes the run's host independent
of which Move set happens to be active. Move's firmware owns set switching, so
leaving the host to the set would make the mode a coin flip. `flags.ts` caches
prefs for the life of one movy open, so it is written with movy closed.

Both halves of the fixture are installed in either mode:

| Host | Seeded from | Verified by |
|---|---|---|
| schwung slots | `slots.txt` + `slot_<N>.json`, via `module-slot.mjs` | `ts_verify` (`slots-read.mjs`) |
| movy chains | the `chains` array in `ui-state.json`, restored by movy itself | `ts_verify_chains` (`chloadedlog`) |

Only one is live at a time — `chainSetTriples` drops every track under
`HOST_TRACKS` when the flag says schwung — so the inactive half is inert rather
than conflicting, and switching modes costs no reload. A suite that needs to
name the instrument asks `ts_fixture_synth <track>` rather than writing `plaits`
down, because the two hosts are seeded from different files.

### Reading a movy chain back

There is no `get` verb on the remote-UI socket, so a movy-hosted chain cannot be
read the way `slots-read.mjs` reads a schwung slot. The engine answers instead:
writing `overtake_dsp:chloadedlog` makes it log `chain loaded: <slot>:<comp>=<module>`
for every chain, read **off the live instance** (`ChainSlots::loaded_report`),
with a trailing `?` on a component that was requested but never instantiated.

The per-load line (`chain 0: synth = plaits`) is not a substitute: `set_chain_set`
deliberately leaves a chain that already holds the right module alone rather
than dlclosing and dlopening back to where it started, so a second run against
the same fixture logs no load at all and would read as a failed one.

### The `chains` array

    "chains": [{"t": 0, "comp": [{"c": "synth", "m": "plaits"}]}]

`t` is the TRACK (a movy track's chain is its index), `c` the component key,
`m` the module id. The module's preset blob (`s`) is **not** written here — it
is rendered in from `slot_<t>.json` at install time by
`scripts/fixture-ui-state.mjs`, so the fixture declares its parameter values
exactly once and the two hosts cannot drift into testing different sounds. Add
a chain by naming its module here and giving it the matching `slot_<N>.json`,
the same file the schwung side needs.

The blob is not decoration. Without it the chain comes up at the module's
shipped defaults — a fixed state only for as long as the chain is created
fresh, and (per the section above) a chain that already holds the module is
never rebuilt. So every run after the first would inherit whatever the previous
suite dragged the parameters to: the same trap `load_file` exists to avoid on
the schwung side.
