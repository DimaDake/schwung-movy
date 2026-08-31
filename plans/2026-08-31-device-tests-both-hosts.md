# Device suites on both track hosts

**Goal.** Every movy device suite passes with tracks 1-4 hosted by *movy's own
chains* (`chtracks = MOVY`), not just on schwung's shadow slots — and the sweep
is split into two runners, one per host.

## Why it does not work today

`scripts/fixtures/README.md` already states the problem: the fixture seeds
**schwung's** four shadow slots (`slots.txt` → plaits on slot 0, mrdrums on
slot 1) and the suites reach the instrument through `module-slot.mjs`, which
addresses those same slots. With `chtracks` resolved to MOVY, tracks 1-4 are
movy chains 0-3 — the fixture's instruments sit on slots movy no longer
addresses, so six suites fail on assertions about a chain that is genuinely
empty (`ui_hierarchy null`, `knobParams empty`, an automation lane falling back
to `octave_transpose`).

Measured 2026-08-30 at `chtracks: 1`: `test-unload`, `test-mutes`, `test-lfo`,
`test-master-fx`, `test-volume`, `test-jog-hint` pass; `test.sh`, `test-seq`,
`test-auto`, `test-reselect`, `test-module-contract`, `test-items` fail.

## The two things to build

### 1. The fixture gains a host dimension

`TS_HOST_MODE` (`schwung` | `movy`, default `schwung`) in
`scripts/lib/test-set.sh`.

* **Pin the host, don't infer it.** `test_set_begin` writes
  `flags.chtracks` = 0 / 1 into the device's `prefs.json` (and lifts
  `flagsRev` to the build's `FLAGS_REV`, read out of `flags-def.ts` so the two
  cannot drift). `resolveHost(0|1, …)` ignores the per-set half entirely, so
  the run's host is unambiguous — no dependence on which Move set is active or
  what `chtrackset` it happens to carry. `flags.ts` caches prefs for the life
  of one movy open, so the write must land while movy is closed; the fixture
  already closes it.

* **One `ui-state.json`, carrying `chains`.** movy's own chains persist in the
  per-set UI blob (`ui-state.ts` → `captureChains`/`restoreChains`), so seeding
  them is a fixture *file* edit, not a new transport. The same file works in
  both modes: with `chtracks` SCHWUNG, `chainSetTriples` drops every track
  under `HOST_TRACKS` (`chainInstance(t) < 0`), so the `chains` array is inert.
  The schwung slots stay seeded in both modes — it costs one ~2 s read when
  they are already right, and it keeps switching back to schwung instant.

* **Verify what the engine did, not what we wrote.** The remote-UI socket can
  write an engine param but has no read verb, so the movy-hosted chain state is
  proven from movy's debug log: the engine logs `chain <slot>: <component> =
  <module>` for every load (`chain_slots.rs`). `ts_verify_chains` opens movy
  and polls for one line per fixture component.

### 2. Two runners

`test-all-device.sh` keeps the sweep and reads `TS_HOST_MODE`; two thin
wrappers name the host:

* `scripts/test-all-device-schwung.sh` — tracks 1-4 on schwung's shadow slots.
* `scripts/test-all-device-movy.sh` — tracks 1-4 on movy's chains 0-3.

## Steps

1. `test-set.sh`: `TS_HOST_MODE`, `ts_apply_host_flag`, `ts_verify_chains`,
   wire both into `test_set_begin`.
2. Bootstrap the `chains` fixture: push it without preset blobs, let movy load
   and autosave, copy the captured blob back in as the committed fixture.
3. Two runner wrappers.
4. Extend `test-fixture-selftest.sh` with a movy-host section (the flag lands,
   the chains load, and a wrong module is still rejected).
5. Run the movy sweep; fix each suite that still reaches for a schwung slot.
6. Run the schwung sweep to prove no regression.
7. `scripts/fixtures/README.md` + `movy/CLAUDE.md` dev-loop step 4.

## Outcome (2026-08-31)

`./scripts/test-all-device-movy.sh` — **12/12 green** (652 s). Nothing in the
suites needed a behaviour change; what needed changing was the harness:

* `test.sh`, `test-items.sh` and `test-module-contract.sh` addressed
  **schwung's slot 0** directly (`module-slot.mjs`). They now go through
  `ts_load_component` / `ts_read_component`, which pick the transport for the
  host that actually owns the track — and they borrow the slot **after** movy
  is open, because a movy chain lives inside movy's own engine, which the host
  unloads on exit.
* `test.sh` was reporting a missing instrument as a PASS: it keyed the config
  check on `config loaded for`, a phrase that has not existed in `src/` for
  months, so plaits fell through to the "no synth loaded" branch. Pinned by
  `browser-test/device-scripts.mjs` Test 8.

Two things the fixture gained that are not about `chtracks` at all: the movy
chains are a fixed *parameter* state (Test 9), and the harness puts the user's
`chtracks` setting back when it is done.
