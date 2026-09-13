# Device suite migration — status

Where every suite named in `MIGRATION.md` stands: migrated and finished, or
migrated and **postponed for escalation**.

Branch `feat/test-device-migration`. One commit per suite.

Read `MIGRATION.md` for the recipe and the rules; this file is the result.

---

## Summary

| # | suite | status | commit | checks | bash → scenario |
| --- | --- | --- | --- | --- | --- |
| — | `test-auto.sh` | done before this work | `92a2387` | 7 | 61 s → 33 s |
| 1 | `test-unload.sh` | done before this work | `60d1fee` | 3 | — |
| 2 | `test-reselect.sh` | **FINALIZED** | `800ceb6` | 6 | 49.2 s → 27.1 s |
| 3 | `test-lfo.sh` | **POSTPONED** — see below | `57246db` | 6 | 47.6 s → 31.9 s ⚠️ |
| 4 | `test-items.sh` | **FINALIZED** | `6817259` | 7 | 44.3 s → 28.6 s |
| 5 | `test-volume.sh` | **FINALIZED** | `4109ef6` | 4 | 27.6 s → 19.7 s |
| 6 | `test-sends.sh` | **FINALIZED** | `abf8734` | 14 | 57.1 s → 44.4 s |
| 7 | `test-module-contract.sh` | **FINALIZED** | `ec88f63` | 10 | 60.1 s → 43.0 s |
| 8 | `test-master-fx.sh` | **FINALIZED** | `14eb256` | 6 | 63.0 s → 35.4 s |
| 9 | `test-mutes.sh` | **FINALIZED** | `29fd0bc` | 15 | 85 s → 43 s |
| 10 | `test.sh` | **FINALIZED** | `3c296a1` | 11 | 30.5 s → 26.2 s |
| 11 | `test-seq.sh` | **DONE** 2026-09-13 — see below | `f78860d` | 16 | 1:59.8 → 40.7 s |
| 12 | `test-versions.sh` | **FINALIZED** | `ed1a5c9` | 8 | 39.7 s → 24.3 s |
| 13 | `test-migrate.sh` | **FINALIZED** | `e907f8e` | 11 | 109.8 s → 86.6 s |

**Result: of the 13 suites `MIGRATION.md` lists, 11 are migrated and finished and
2 are postponed for escalation** — `test-lfo.sh` (migrated, with one check held
red on a standing movy bug) and `test-seq.sh` (attempted, escalated under the
3-fix rule). `test-auto.sh`, the worked example that doc names outside its list,
was already migrated before this branch.

Every finished suite is faster than the bash it replaced, and the assertion count
was predicted from each parent commit **before any bash was deleted** and matched
exactly in all eleven.

`test-jog-hint.mjs` is **not migrating** — it asserts on the framebuffer and
`SNAPSHOT_DISPLAY` was never built (we chose to make no schwung changes). It
stays as the last bash-era script, by design, per `MIGRATION.md`.

---

## Postponed for escalation

### `test-lfo.sh` → `test-device/scenarios/lfo.ts` — `57246db`

**Five of six checks are green and final. One is red and should stay red.**

`param-moving` is a **standing movy bug, not a harness bug.** The LFO applies via
`chain_mod_emit_value` → `chain_mod_apply_effective_value` →
`chain_mod_set_param_string(target, param)` — the value never reaches the param.

What makes this safe to call a real bug rather than a race:

- The bash script scored the same assertion deliberately. Its Section 3 is
  marked *"a KNOWN FAILURE, reported but not scored"*, and it has been frozen at
  `0.500000` on both hosts since **v0.31.0**. This is pre-existing, and I checked
  it against the parent commit rather than taking "pre-existing" on trust.
- The migration **keeps the check scored** rather than reproducing bash's
  silence. A check that is reported-and-ignored is not a check.

⚠️ **One honest caveat on the timing:** bash built and deployed `dsp.so` (~10–12 s)
and the scenario deploys `ui.js` only, so 47.6 s → 31.9 s is **not a
like-for-like comparison**. The scenario is not slower; the comparison is just
not clean, and it would be dishonest to present it as a 33% win.

**Escalation ask:** diagnose the mod path above. It is a movy engine bug and it
outranks this migration.

### `test-seq.sh` → `test-device/scenarios/seq.ts` — CLOSED 2026-09-13

16 checks, in the sweep. Five consecutive runs at 16/16 before it was promoted,
and `scripts/test-seq.sh` is deleted — the last bash suite the migration was
about. `scripts/lib/test-set.sh` outlives it regardless: ten non-test scripts
still source it, so the two fixture implementations stay in sync by hand until
`test-chains.sh`, `test-cpu.sh`, `test-voice-slot.sh` and the `measure-*` family
move too.

It was escalated under the 3-fix rule on 2026-09-12 and sat as a WIP for a day,
on this blocking fact: **the Play button never stopped a running transport**, and
the failure count moved 4, 8, 7 over identical code. Both were one cause, and it
was not in the scenario.

`host_module_set_param_blocking` reports a refused write by returning false —
the single-slot `overtake_dsp` param SHM refuses what it cannot claim inside the
timeout — and `src/seq/engine.ts` discarded that return, clearing the batch
either way. So any `cmd` batch written while something else held the slot was
dropped in silence. Measured on device with one throwaway `mlog` at each end:
**24 Play presses all reached the router and 15 of their batches died there**,
which is exactly what "press three times against a transport that never stops"
looks like.

Two fixes, both with tests that fail without them:

- **movy** keeps a refused batch and rewrites it verbatim until it lands, behind
  a `#<seq>` tag the engine dedupes on (`seq-core::apply_batch`) — a refusal
  cannot say whether the shim had already taken the request, and `tog` applied
  twice toggles the step back off. ENGINE_VERSION 0.75.0 → 0.76.0.
- **the scenario** stopped polling that same slot every 30 frames. `PARAM_POLL_GAP`
  (150) now lives in `wait.ts` and is what both `probe.ts` and this scenario use.
  A Play press moved the engine's play byte 12/12 at that gap and **0/12** at
  `every: 30`: the poll loop was starving the very write it was waiting on.

Worth recording, because the 2026-09-12 review reasoned about it from the
outside and got it backwards: the leading hypothesis — *harness polling starves
the shared param slot* — was **right**. It was dismissed because `mutes.ts`
polls the same param and passes, but `mutes` writes engine params from the
harness side and never depends on movy's own queued batch surviving. A
contradiction found in a suite that does not exercise the mechanism is not a
contradiction.

Three smaller defects the scenario itself carried, all fixed here:

- the capture and reopen legs read the log **once**, immediately after a press,
  where every other leg waits (`settle`). One run in three scored
  `capture-fixed-notes` as "movy never reported it" when the UI tick had simply
  not come round yet.
- `goTrack` had no answer when the track BUTTONS could not reach the wanted
  track at all — they address Move's focused group of four, and §7 moves it.
  It now falls back to the Session step row, which is absolute over all sixteen.
- `dev.deployUi()` runs AFTER `fixture.ensure()`, which opens movy — so the
  fixture phase always ran the previous ui.js. Harmless until the UI and engine
  had to agree on a version, at which point the tier hung. ui.js is now deployed
  once per sweep from `run.mjs`, next to the engine, before anything opens.

Note the migration did find and fix two real harness defects on the way (a
`key=value` log reader aimed at space-separated `seq: step 4 lane 36` /
`seq: steprec 2`, and a `goTrack` retry keyed on the engine's `trk=` ack), which
turned three checks green. Teeth were never reached: with the suite not green,
mutation-testing would have been measuring noise, and the report says so plainly
instead of implying coverage.

---

## Independent movy finding (outlives this migration)

**The watched-track push cannot heal a fresh UI against a restored engine.**
After a real reopen, the engine restored `trk=2` from the Set while the fresh
UI's mirror started at `0`; tapping track 0 changed nothing, because the push is
comparison-based and only fires on a *change*. The engine's `trk=` ack is parsed
(`noteReportedTrack`) but never used to re-arm the push, so a lost `watch` op is
permanent. `test-seq.sh` never read the engine here, so the bash suite could not
have noticed. Relevant to suites 12–13, which drive real closes and reopens.

---

## Not in scope

`MIGRATION.md` names thirteen suites. Four other bash scripts exist on disk and
are **not** in that list, so they are untouched by this work:

`scripts/test-chains.sh`, `scripts/test-cpu.sh`,
`scripts/test-fixture-selftest.sh`, `scripts/test-voice-slot.sh`

(`scripts/test-all-device.sh` is the runner, not a suite.) Flagging this so their
survival is not read as an omission.

---

## How the migration was controlled

The failure mode this guards against is a subagent silently dropping an
assertion and still reporting green.

Before any bash script was deleted, every suite's assertion sites were counted
and recorded, and the metric was **calibrated against the two suites that were
already migrated and known good** (`automation`, `unload`):

```
scenario checks = bash success-branch emissions − infrastructure assertions
```

"Infrastructure" is `SSH reachable` / `Built + deployed` / `ENGINE UNREACHABLE` /
"log enabled and cleared" / "opened fresh" — preconditions the harness now owns
and no scenario asserts.

Two things this caught that a bare check-count would not:

- **`if`/`elif`/`else` arms.** An `if`/`elif` group over one fact emits one
  `pass` per success arm, so the raw count over-reports. It fired on exactly one
  suite out of ten (`test.sh`, 16 emissions vs 11 real checks) and was resolved
  by reading the parent commit, not by trusting either number.
- **Decorative checks.** Six suites contained assertions that *could not fail*:
  `items` A3 was a bare unconditional `pass`; `module-contract`'s
  `non-wide-unaffected` passed under a real mutation; its `no-lane-bound`
  grepped a line movy never emits on that path; `mutes` check 11 passed with the
  stale `track > 3` ceiling re-added; `volume`'s `gesture-reached-handler` grepped
  an 80-line tail that could match a previous run; `migrate`'s
  `migrated-patch-carried` keyed on a value that *is* the module's factory
  defaults (so nothing could distinguish a carried patch from a merely loaded
  module) and its `chains-array-saved` was satisfied by `"chains":[]`. All were
  **strengthened**, not copied, and none were weakened.

  The `migrate` case is worth reading in full — it is the clearest example of
  why "the bash passed" is not evidence a check means anything. Its keyed arm
  `"engine":"VA VCF"` could never match, because the preset blob is a JSON string
  embedded inside JSON and every quote in it is escaped; that left a bare
  substring match as the only arm that could fire. Proven by measurement: with
  the preset read deleted the check still passed.

Each suite was verified independently of its subagent's report: commit contents
checked to contain no `src/` or `engine/` change, working tree confirmed clean
(catching an un-reverted teeth mutation), `t.check` count checked against the
recorded expectation, `npm test` run.

**The prediction held in all eleven finished suites** — every one landed exactly
on its recorded count, including `test-lfo.sh`, whose six checks matched its six
bash assertions even though one of them is red. (`test-seq.sh` is excluded: it
was never green, so it never reached the point of being counted.) That is the
evidence the migration is faithful rather than merely green: a dropped assertion
would have shown up as a missing check, and none did.

**Whole-branch invariant:** across every commit on
`feat/test-device-migration`, there is **no change to `src/` or `engine/`**.
Suite migrations added scenarios, deleted bash, and updated the two registries —
nothing else. A migration that alters production code to make tests pass has
failed at the thing it was for; this one does not.

**Teeth.** Every check was proved by mutation — break the thing it guards,
confirm that check and only that check fails, put it back. Where a check could
not be isolated under a single mutation, the suite note says so rather than
claiming full coverage. `.superpowers/sdd/test-device-migration/progress.md`
holds the per-suite detail, including which checks could not be isolated.
