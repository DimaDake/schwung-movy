# Migrating tracks 1-4 off schwung's shadow slots

**Status:** design, approved 2026-09-10
**Supersedes the host-choice half of:** `plans/2026-08-24-movy-hosted-first-tracks.md`

## Problem

Tracks 1-4 can be hosted two ways. `chtracks` decides which host movy
*addresses* — schwung's four shadow slots, or movy's own chains 0-3 — and
nothing ever moves between them: schwung's slot keeps its module and goes
silent, movy's chain starts empty, and flipping back finds the slot as it was.

That was the right call for a live flip (a module load blocks the audio callback
~1986 µs, and a partial migration would leave a track half-configured on a live
audio path). It is the wrong end state. Two hosts means two code paths for
routing, ports, note-offs, volume, LFOs, the CPU page and the param pages, two
device sweeps to keep both green, and a flag whose wrong setting makes a user's
tracks silently unreachable.

Movy moves to **one host**. Tracks 0-15 are all movy chains. Work built on
schwung slots is carried across by a one-time, per-set migration that runs on
set load, and the schwung host path is deleted.

## Scope

In scope: tracks 1-4 (slots 0-3), the modules movy's UI shows, and the state
that makes those modules sound the way the user left them.

Out of scope: the master chain. `master_fx:` is schwung's, global to the shim,
and rides slot 0 as a carrier — it keeps working exactly as it does today, which
is why `HostSlotPort` survives this change.

## End state

- `chtracks` and `chtrackset` cease to exist — flag defs, the Settings rows, the
  per-set value, and the engine fold.
- `trackKind()`, `TrackKind` and `HOST_TRACKS` are deleted. `chainInstance(i)` is
  always `i`. `portFor()` loses its branch and always returns a `MovyChainPort`.
- In the engine, `movy_tracks` is deleted and `drain_out` always routes a
  sequenced note into a chain. `ENGINE_VERSION` bumps.
- `HostSlotPort` survives, moved to `src/track/shim-port.ts`. It is no longer a
  *track* port: its remaining jobs are `master_fx:` (via `hostPort(0)`) and
  reading schwung's slots during migration.

## Migration

### When it runs

Behind the loading splash, never outside it. A migration that ran against a live
surface could race a user edit, and the whole point of the splash is that no
gesture reaches the instrument while it is up.

Per set load:

1. `applyUiState` asks the migration module for a plan.
2. **Plan ready** — the common case, and the case where the set is not a
   candidate at all. The migrated `ChainTrackState[]` are merged into what
   `restoreChains` was already about to send, and go out as **one** chain-set
   document. Preset blobs, LFOs and the mix value ride the existing
   `chain-payload` deferral; no new delivery machinery exists.
3. **Plan pending** — schwung has not finished loading its slots. `restoreChains`
   is **held**, the settle tick re-probes, and the single document goes out when
   the plan resolves or its budget expires.

**`settleCheck()` must gate on "the chain document has been sent".** It promotes
today on `chainPending === 0`, which is trivially true *before* any document
goes out — so a held document would promote a candidate set straight through the
splash. This is the same shape as the bug where the splash gated on the engine
only, and it gets its own assertion.

### Which sets are candidates

The ui-state blob gains a per-set marker, `migv`. Present → migration never runs
for that set again. Absent → resolve what the set's host *was*, and decide:

| set blob | legacy resolve | action |
|---|---|---|
| present | MOVY | not a candidate — write `migv`, done |
| present | SCHWUNG | candidate — probe slots 0-3 |
| absent | — | candidate — probe slots 0-3 |

The resolve reads the raw legacy values (`chtracks` from `prefs.json`,
`flags.chtrackset` from the set blob) through the existing `resolveHost(mode,
setChoice)` rule, kept in `src/track/legacy-host.ts` and marked deletable once
the fleet has turned over. Reading them is all that survives of the flag.

**A set with no blob at all is a candidate even though its legacy resolve is
MOVY** (`resetUiState` takes the shipped default). That default is what a
*brand-new* set wants — but a set **duplicated in Move** also arrives with no
movy blob, and schwung has copied the original's slot state into it. Trusting
the default there would strand the copy on a host that no longer exists. The two
are indistinguishable until the probe has run: schwung clears slots before it
reloads them, so a duplicated set mid-load reads exactly like an empty new one.

The cost is that a genuinely new set pays the full probe budget (~1.5 s of
splash) once, to reach a stable all-empty read. Accepted: it is one time per
set, and the alternative is a duplicated set losing its instruments.

Per track, automatic migration writes only into a movy chain the restored set
left **empty**. A set carrying its own chains for tracks 0-3 is never clobbered.

### What is read

Per track 0-3, through `HostSlotPort`:

- **Modules and presets** for the four components movy's UI shows —
  `midi_fx1`, `synth`, `fx1`, `fx2`: the module id (`<c>_module`) and the
  preset blob (`<c>:state`).
- **LFOs** — the twelve `lfoN:*` keys. The spelling is identical on both hosts,
  so `lfoStateKeys()` / `packLfoState()` / `lfoPairs()` are reused verbatim, and
  an LFO target naming a component carries across unchanged.
- **Level** — `slot:volume` onto movy's `mix` gain. Both are linear amplitude
  with unity at 1.0; the value is clamped to movy's mix range. Pan and the send
  amounts have no schwung equivalent and stay at their defaults.

Mutes are **not** migrated: movy already owns per-set track mutes, and merging
two sources of truth invites them to disagree.

### Deciding that schwung has settled

Schwung clears all four slots and then reloads them
(`shadow_ui.js` SET_CHANGED: pass 1 clears, pass 2 `load_file`s each with its own
timeout and retry). **A single empty read is therefore ambiguous** and must never
be taken for "this slot is empty".

Settled = two consecutive identical **non-empty** signatures, where the signature
is the four components' module ids across the four slots. Budget: ~6 probes over
~1.5 s, inside the splash.

A stable **all-empty** read is a legitimate "nothing to migrate": logged as such,
marked, no error raised.

`fx3` and `fx4` are probed but never migrated — movy's UI has no place to show
them. Anything found there marks that track incompletely migrated.

### Failure, and what the user is told

Budget exhausted, a component that never read back, or leftovers in `fx3+`:

- write `migv` anyway,
- log a specific `[movy] mig:` line naming the track, the component and the key,
- raise a toast once the set is ready naming the affected tracks.

Marking a failed migration is safe **because the schwung slot is never cleared**.
The patch is still in Move's own set file and still reachable from schwung's own
UI, so a failed migration loses nothing — it leaves a track that needs its module
loading by hand, or the manual action below pressing. Leaving the set unmarked
instead would re-probe it on every open for the rest of its life.

The splash reads `MIGRATING TRACKS` while this runs.

**Every read of a schwung slot lives in one file.** A future schwung rename must
have exactly one place to be fixed, and must fail loud and specific rather than
degrading into a silent "nothing to migrate".

## Manual migration

A second Settings action row, `MIGRATE TRACKS`, below `BACKUPS`. It does not add
a second migration path — it re-enters the first one:

1. On confirm, probe slots 0-3 **once**. The set is `ready`, so schwung's slots
   are settled by definition; this is the one case the retry machinery is not
   needed for.
2. Nothing there → toast `NOTHING TO MIGRATE`. No reload, nothing disturbed.
3. Something there → force a save of the current set (autosave is on a ~3-8 s
   countdown, so reloading without this drops recent edits), clear this set's
   `migv`, then `reloadCurrentSet()` — already documented as *deliberately the
   same path a set switch takes*.

The splash comes up and the automatic path runs unchanged.

**Manual migration overwrites** movy chains 0-3, where automatic skips a
non-empty chain. The two likeliest reasons to press the button — a migration that
came up partial, and a chain the user has since broken — are exactly what a guard
would refuse. It is safe to re-run because schwung's slot is never cleared, and
it is gated behind the confirm below.

Because a stray jog-click would stop playback and reload every module, the row
**arms on first click** (`>` → `CONFIRM?`) and runs on the second. Moving the
selection disarms it. No new page.

`flags-page-vm.ts` currently hardcodes a single action row (`count =
flags.length + 1`, `onAction = sel === flags.length`). It generalizes to a list.
The comment above that code records what this shape broke last time: a row added
to the jog clamp and the router but not to the viewmodel was selectable,
clickable and invisible, and every screenshot stayed byte-identical because the
viewmodel never changed. The assertion that `rows.length` equals
`flagsRowCount()` extends to cover both rows.

## Testing

### Local

`browser-test/logic/track-migrate.mjs`:

- the candidate decision table: a blob resolving MOVY is skipped, a blob
  resolving SCHWUNG is a candidate, and a set with no blob is a candidate
- the component filter (`midi_fx1`/`synth`/`fx1`/`fx2` in, `fx3`/`fx4` out)
- the empty-chain guard on automatic, and its absence on manual
- volume and LFO mapping
- the ambiguity rule: one empty read is not "empty"; two matching non-empty
  reads are "settled"
- budget exhausted → marker written, error reported
- `migv` round-trips through `serializeUiState` / `applyUiState`
- the settle gate: a candidate set must not promote before its document is sent

Plus the flags-page VM assertions for the second action row, and a screenshot
scene for the `MIGRATING TRACKS` splash and the armed `CONFIRM?` row.

Each of these is proved by removing the fix and watching it fail.

### Device — `scripts/test-migrate.sh`

Three arms, plus one for the manual row. The first is the answer to
"future changes on the schwung side".

- **Contract canary.** Read every key the migration depends on straight from a
  seeded schwung slot — `synth_module`, `synth:state`, `fx1_module`,
  `lfo1:target`, `slot:volume` — and fail **naming the key** that came back
  empty. When schwung renames or drops one, this says which. Without it the
  migration would quietly no-op and the suite would stay green.
- **Positive.** Seed slots plus a legacy ui blob (`flags.chtrackset = 0`, no
  `migv`, no `chains`), open movy, wait for ready. Assert the fixture's modules
  are on chains 0/1 via `chloadedlog`; that a param the fixture set **off its
  default** reads back non-default through `ch0:` — audibility, not a module id;
  that the level landed; that the saved blob now carries `migv` and `chains`;
  and that schwung's slot still holds its module, untouched.
- **Negative control and idempotence.** Re-open the same set → the migration log
  line is absent and the chains are unchanged. A set with empty schwung slots →
  "nothing to migrate", so `migrated 0` can never be read as success.

**Manual row.** Press it on a set whose chains already hold modules, and assert
the overwrite happened — the one behaviour that differs from the automatic path.

`TS_HOST_MODE` and the two-host matrix collapse to one sweep —
`test-all-device-schwung.sh` and `test-all-device-movy.sh` are replaced by
`test-all-device.sh`. The fixture keeps seeding schwung's slots, now as the
migration test's input rather than as a live host.

## Cleanup

Deleted: `src/track/host-mode.ts`; `movy_tracks` and its two tests in
`engine/crates/movy-dsp/src/lib.rs`; `test-all-device-schwung.sh` and
`test-all-device-movy.sh`; `TS_HOST_MODE` in `scripts/lib/test-set.sh`.

Moved: `src/track/host-port.ts` → `src/track/shim-port.ts`.

Host branches removed from: `ref.ts`, `registry.ts`, `chain-persist.ts`,
`chain-payload.ts`, `flags.ts`, `flags-def.ts`, `flags-visible.ts`,
`flags-page.ts`, `mixer/mix-io.ts` (`HOST_VOLUME_KEY`), `mixer/mix-model.ts`,
`mixer/mix-cells.ts`, `mixer/track-volume.ts`, `seq/drum-sync.ts`,
`seq/cpu-page-vm.ts`, `lfo/scope.ts`, `undo/param-sync.ts`.

Docs: `MANUAL.md` (the Settings row, and tracks 1-4 no longer having a host
choice), `README.md`, `CHANGELOG.md`, `docs/track-performance.md`,
`scripts/fixtures/README.md`. `plans/2026-08-24-movy-hosted-first-tracks.md`
gets a pointer to this spec.

## Risks

- **Reading an unsettled slot and marking the set migrated.** Mitigated by the
  two-matching-reads rule, the retry budget, and by never clearing schwung's
  slot — the worst case is a track that needs its module loading by hand.
- **A held chain document promoting the splash early.** Mitigated by the
  `settleCheck` gate and its own assertion.
- **schwung changing a key spelling.** Mitigated by the contract canary, which
  fails naming the key, and by keeping every slot read in one file.
- **A migration that lands but is never saved.** The normal autosave writes the
  chains, so this reduces to the existing save path; the `pendingPayloadFor`
  guard already refuses to capture a chain whose payload has not landed.
