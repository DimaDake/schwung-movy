# Device-suite migration — independent verification and follow-ups

Reviewed `feat/test-device-migration` on 2026-09-12, independently of the
migration's own reports. The review started at `c764e84`; while it ran, that
commit was amended to `d2840a7` (the doc fixes below landed in it) and `27ce44d`
was added on top, so the two items they resolve are marked closed here. `test-device/MIGRATION-STATUS.md`
is the migration's account of itself; this file is the audit of that account plus
the prioritised work it leaves behind.

---

## Status — 2026-09-12 evening

| item | state |
| --- | --- |
| 1. `test-all-device.sh` ran 1 of 14 | **closed** — the TS tier is one `run_one` entry; jog-hint's line is gone with the script |
| 2. `--scenario <name>` used the wrong host | **closed** (`f5bb22d`) |
| 3. the gate can never be green | **closed** — item 4 fixed, and `lfo`'s sampling made deterministic |
| 4. LFO modulation never reaches the driven param | **closed** (`be58142`) — and it was never the mod runtime: `lfo_report` read the plain key, which the chain host deliberately shadows to the BASE value. `:effective` is the driven one. A diagnostic bug, not an audio bug |
| 5. the watched-track push cannot heal a fresh UI | **open** |
| 6. `seq` transport-stop | **closed 2026-09-13** — hypothesis (a) was right after all, and the disproof of it was itself wrong (see below). `scenarios/seq.ts` is in the sweep at 16/16 over five consecutive runs |
| 7. working tree | **closed** — three untracked measurement scripts still want a decision |
| 8. seq WIP in a gitignored path | **closed** (`1717f8c`) — and it could not be imported at all until `4219b3e`; `npm run test:device -- --wip` runs it |
| 9. decorative guards in `device-scripts.mjs` | **closed** (`27ce44d`, `33823be`) |
| 10. two fixture implementations | **open** — `test-set.sh` outlives the suites; 14 non-test scripts source it |
| 11. scope of the remaining bash tier | **decided** — `browser-test/device-scripts.mjs` Test 16 is a ratchet: the five surviving suites are an allowlist that may shrink and may not grow |
| 12. name `test-device/` in the file-size rule | **closed** (`b65c747`) |

Three things this review did not know about, found while closing the above:

- **No scenario ever shipped an engine.** `npm run test:device` graded a Rust
  change against whatever `dsp.so` the device held. That, not item 6, was the
  reason `test-seq.sh` could not be retired. Closed in `78fb441`.
- **The harness could not restart the stack.** `swapEngine`/`restartStack` went
  through `bus.restartMove()`, i.e. as whoever owns `schwung-testd` — started as
  `ableton`, so the kill is EPERM and the script exits 0 — and then "confirmed"
  the restart by pinging that same testd, which never went down. Measured:
  MoveOriginal held pid 7515 across it. Closed in `78fb441`.
- **`test-device/` was never typechecked.** `tsconfig.json`'s include is `src/`,
  `browser-test/`, `build/`. The gate cited `npm run typecheck` as evidence over
  5,900 lines it never read. Closed in `8d436b3`, which found four real defects
  on its first run.

And item 11's "blocked by design" entry for `test-jog-hint.mjs` was wrong: the
framebuffer is a file in `/dev/shm` that scp reads, which is what the script
itself did. `SNAPSHOT_DISPLAY` was never needed. It is the `jog-hint` scenario
now (`8d436b3`).

---

## Verdict: the migration is faithful. Accept it.

| what was checked | how | result |
| --- | --- | --- |
| No assertion was silently dropped | re-derived every suite's assertion set from its **parent commit** and matched it label-by-label against the scenario's `t.check` ids — not by count | **11/11 exact** |
| No production code was bent to make tests pass | `git diff --name-only main...HEAD` filtered to `src/`, `engine/` | **empty** |
| Local gate | `npm test` (exit 0), `npm run typecheck`, `npm run build:test-device`, 164 screenshot baselines | **green** |
| Checks are not decoration | extracted every `t.check` condition; scanned for literals and tautologies | **no vacuous condition** |
| Stale-log false passes | every `logLines` use audited | **all before/after deltas**; `master-fx`'s two absolute reads are scoped by the log truncation in its own `rebootWith` |
| **The whole tier in one process** | `npm run test:device` end to end — never run before, only per-suite | **13 scenarios · 108 checks · 1 failed · 8m08s** |
| The one suite that was never migrated | `./scripts/test-seq.sh move.local`, the baseline the status doc says to establish first | **18/18, exit 0 — bash is green** |

The sweep's one red check is `lfo`'s `param-moving`, reproducing exactly as
documented (`frozen at 0.500000` across all four samples). Everything else was
green on the first attempt, with no flake and no cross-scenario interference.

Parity detail, since "the counts matched" is the load-bearing claim:

| suite | bash emissions | minus infra / grouped arms | scenario checks |
| --- | --- | --- | --- |
| reselect | 7 | 6 logical (if/elif groups) | 6 ✅ |
| lfo | 6 | 6 | 6 ✅ |
| items | 9 | −2 infra | 7 ✅ |
| volume | 7 | −2 infra, −1 if/else pair | 4 ✅ |
| sends | 14 (+1 helper def) | 14 | 14 ✅ |
| module-contract | 12 | −2 infra | 10 ✅ |
| master-fx | 6 | 6 | 6 ✅ |
| mutes | 15 | −1 infra, **+1 new** (`solo-reached-disk`) | 15 ✅ |
| test.sh → smoke | 16 | −4 infra, −1 elif arm | 11 ✅ |
| versions | 8 | 8 | 8 ✅ |
| migrate | 11 | 11 | 11 ✅ |

Two facts worth recording because the status doc states them more strongly than
the evidence does:

- **`mutes` is 14 bash assertions + 1 added**, not 15 → 15. The added check
  (`solo-reached-disk`) is a strengthening; the arithmetic just hides it.
- **The per-suite timings are standalone measurements.** In a sweep the first
  scenario carries the server + fixture cost: `automation` ran 95.2 s in-sweep
  against its recorded 33 s standalone. The rest land at or under their recorded
  figures, and the sweep total (8m08s for 13) still beats the bash tier's summed
  standalone times (~12m14s for 12), but the two columns are not comparable
  row-by-row.

---

## P0 — the tests do not all run

### 1. `test-all-device.sh` runs 1 of 14 suites and still prints "ALL DEVICE SUITES PASSED"

`MIGRATION.md` step 6 says to remove each retired script from the wrapper, and
every suite did — but nothing was ever added back, so `SCRIPTS=(test-seq.sh)` is
the whole sweep plus `test-jog-hint.mjs`. Meanwhile `CLAUDE.md` step 4b still
presents it as "Every device suite at once", and the wrapper's own comment still
says "Across a sweep that is eight needless restarts".

Either add `npm run test:device` to the wrapper as one `run_one` entry, or delete
the wrapper and point the docs at the two commands that exist. Anyone who runs
the documented full sweep today gets a green banner for 2 suites.

### 2. `npm run test:device -- --scenario <name>` sends the run at the wrong host

`test-device/run.mjs`:

```js
const HOST = process.env.HOST || flag('--host') || argv.find((a) => !a.startsWith('--')) || 'move.local';
```

`--scenario smoke` leaves `smoke` as the only non-flag argv entry, so `HOST`
becomes `"smoke"` and the run tries `ssh ableton@smoke`. Verified by evaluating
the expression directly. The branch's own new docs instruct exactly this form
three times (`CLAUDE.md`/`CONVENTIONS.md`: `--scenario smoke`, `reselect`,
`sends`), so the first person to follow them gets an ssh failure and blames the
device.

Fix: skip argv values consumed by a flag when picking the positional host.

### 3. The device gate can never be green

`CLAUDE.md` step 4 is now `npm run test:device`, and that always exits non-zero
because `lfo`'s `param-moving` is scored red on purpose. The uncommitted doc edit
explains this in a comment, which is honest but is not a fix: a gate that is red
by design is a gate people stop reading, and the next real regression hides
behind it.

Pick one:

- **give `runner.ts` a known-failure concept** — the check still runs, still
  prints red, and is excluded from the exit code until the movy bug is fixed; or
- **fix the bug** (item 4) and the problem evaporates.

Note the migration applied exactly the right instinct to `seq` (a never-green
scenario was moved out of `scenarios/` so it could not pollute a sweep) and did
not apply it to `lfo`.

---

## P1 — what the migration surfaced

Items 4 and 5 are real movy bugs and outrank any further test work. Item 6 turned
out to be a harness gap, not a movy bug.

### 4. LFO modulation never reaches the driven param

`chain_mod_emit_value` → `chain_mod_apply_effective_value` →
`chain_mod_set_param_string(target, param)`; the value does not arrive. Frozen at
`0.500000` on both hosts since **v0.31.0**, and reproduced again in today's sweep.
This is the migration's explicit escalation ask, and it gates item 3.

### 5. The watched-track push cannot heal a fresh UI against a restored engine

After a real reopen the engine restores `trk=2` from the Set while a fresh UI's
mirror starts at `0`. The push is comparison-based — it only fires on a change —
so tapping track 0 does nothing and the disagreement is permanent. The engine's
`trk=` ack **is** parsed (`noteReportedTrack`) and never used to re-arm the push.

This is a user-facing bug on any reopen, not a test artefact, and the bash suite
could not have seen it because it never read the engine here.

### 6. ~~`seq`: the transport-stop escalation~~ — CLOSED 2026-09-13

The full account is in `test-device/MIGRATION-STATUS.md`. In short: the Play
press always reached the router, and its `cmd` batch was dropped by the param
SHM — `host_module_set_param_blocking` returns false on a write it cannot claim
and `src/seq/engine.ts` discarded that return. Measured with one throwaway
`mlog` at each end: **24 presses arrived, 15 batches died.** movy now resends a
refused batch behind a `#<seq>` tag the engine dedupes on, and the scenario
stopped polling the same slot every 30 frames (12/12 at `PARAM_POLL_GAP`,
**0/12** at `every: 30`).

Two things this file got wrong are worth keeping, because they are the reusable
lesson rather than the bug:

- **Hypothesis (a) was correct and this document dismissed it on bad evidence.**
  The dismissal ran "`mutes.ts` polls the same param and passes" — but `mutes`
  writes engine params from the harness side and never depends on movy's own
  queued batch surviving, so it cannot exercise the mechanism. A contradiction
  found in a test that does not run the code is not a contradiction. The later
  note that "(a) is refuted by `transportStop_step record` succeeding through
  the identical poll path" was the same mistake in a different suit: one success
  out of a run whose every other stop failed is a coin landing heads, not a
  disproof.
- **"Not reproducible run to run" was the symptom of the bug, not a separate
  blocker.** A dropped write is a race; 4, 8 and 7 failures over identical code
  is what a race looks like from outside. Chasing reproducibility first would
  have been chasing the same defect by a different name.

`Device.selectTrack`'s group-0 assumption was real but was never the transport
failure. It is handled where it bites — `goTrack` in the scenario now verifies
the engine's `trk=` and falls back to the absolute Session step row.

Three smaller defects found while closing it: the capture and reopen legs read
the log once instead of waiting for it (one run in three); `dev.deployUi()` runs
after `fixture.ensure()` opens movy, so the fixture phase always ran the previous
ui.js (ui.js is deployed once per sweep from `run.mjs` now); and eight other
scenarios still poll `overtake_dsp` params faster than `PARAM_POLL_GAP` —
**open**, see item 13.

---

### 13. Eight scenarios still poll the param SHM faster than the gap that works

`test-device/wait.ts` now carries `PARAM_POLL_GAP` (150 frames) and the
measurement behind it. `probe.ts` and `scenarios/seq.ts` use it; these do not,
and each is a write of movy's that a wait can starve the same way:

`automation.ts:112` (`every: 60`), `mutes.ts:162` (60), `unload.ts:64` (60),
`sends.ts:197,210,220` (100), `lfo.ts:135,157` (120), `items.ts:175` (120),
`module-contract.ts:234` (120), `reselect.ts:180,200` (120).

They are green today, which is the argument for leaving them alone and the
reason they are worth fixing: a starved write is silent, so a green run does not
say the channel was healthy. Waits over the LOG (ssh) and over the daemon's
`STATE` are unaffected — only `overtake_dsp:*` reads share the slot.

## P2 — durability and hygiene

### 7. ~~Commit the working tree~~ — mostly done; one unrelated change left

The D1/D2/D3 doc fixes (`CLAUDE.md`, `CONVENTIONS.md`,
`.github/pull_request_template.md`, `MIGRATION-STATUS.md`) landed in `d2840a7`
while this review was running. **Still loose:** `.aider.conf.yml` is modified
(it drops the `../schwung` and `../*` reads), which has nothing to do with this
migration — separate commit or revert, but do not let it ride along. Three
untracked measurement scripts (`scripts/grid-call-cost.mjs`,
`scripts/inject-movy.py`, `scripts/measure-grid-cost.sh`) are also sitting in the
tree from earlier work and want a decision.

### 8. The `seq` WIP is stored in a gitignored path

`MIGRATION-STATUS.md` says the 16-check WIP is "preserved at
`.superpowers/sdd/test-device-migration/seq-wip.ts`", but `.superpowers/sdd/.gitignore`
ignores it — along with all thirteen per-suite reports and `progress.md`. A clean
clone or a fresh worktree has none of it. Move the WIP somewhere tracked before
the next attempt needs it.

### 9. ~~`device-scripts.mjs` has a decorative guard of its own~~ — fixed in `27ce44d`

Test 10's third guard ("unlinks the state files before seeding over them") keyed
on strings that `versions.ts`'s `scpTo` destinations guarantee regardless of the
`clear` command. `27ce44d` now parses each `scpTo` destination and requires an
`rm -rf` naming it earlier in the file — order, not substring presence.

**Still open in the same suite:** Test 10's other two guards and Test 13's
`slot-state.mjs` conjunct are weak for the same reason (O1–O3 in the migration's
`final-review.md`). Worth one pass while the context is fresh, since this is the
suite whose whole job is catching checks that cannot fail.

### 10. Two fixture implementations now have to stay in sync

`test-device/fixture.ts` (382 lines) and `scripts/lib/test-set.sh` (733) seed the
same device state. This already cost a bug: `6cc850d`'s `chains.json` authority
removal had to be hand-ported into `fixture.ts` in `800ceb6`, and until it was,
the fixture asked for plaits while the engine reported rex. `test-set.sh` cannot
be deleted yet — `test-seq.sh`, `test-chains.sh`, `test-cpu.sh`,
`test-fixture-selftest.sh` and six `measure-*.sh` scripts source it.

Retiring `seq` is what unblocks this; until then, treat any change to either
fixture as a change to both.

### 11. Decide the scope of the remaining bash tier

Not in `MIGRATION.md` and therefore untouched: `test-chains.sh`, `test-cpu.sh`,
`test-fixture-selftest.sh`, `test-voice-slot.sh`. Plus `test-jog-hint.mjs`, which
is blocked by design (it reads the framebuffer; `SNAPSHOT_DISPLAY` was never
built). This is a decision, not a defect — but "the bash tier is retired" is not
true until it is made.

### 12. Name `test-device/` in the file-size rule

Scenarios run 273–583 lines (`mutes.ts` 583, `module-contract.ts` 518,
`migrate.ts` 484). That is over the 200-line `src/` cap and under the ~600-line
ceiling `CLAUDE.md` grants `browser-test/` for exactly the same reason — one
suite is one coherent subsystem. The rule simply does not mention
`test-device/`; say so explicitly rather than leaving it to inference.

---

## Suggested order

1. Items 1–3 (half a day, all mechanical, and they restore the gate).
2. Item 4, then close item 3 properly.
3. Item 6's local test, then the device discriminator; item 5 alongside it.
4. Items 7–9 (small), then 10–12 with the `seq` retirement.
