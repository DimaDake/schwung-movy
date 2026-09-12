# Device-suite migration — independent verification and follow-ups

Reviewed `feat/test-device-migration` at `c764e84` (12 commits) on 2026-09-12,
independently of the migration's own reports. `test-device/MIGRATION-STATUS.md`
is the migration's account of itself; this file is the audit of that account plus
the prioritised work it leaves behind.

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

### 6. `seq`: the transport-stop escalation, re-scoped

**First, the gap the status doc flags as worth closing first is now closed: the
bash suite is green.** `./scripts/test-seq.sh move.local`, run once today on this
branch, passed **18/18 and exited 0** — including `capture-commit`,
`capture-select-tempo`, `capture-fixed-notes`, `steprec-rest-advanced` and
`set-loaded-on-reopen`, every one of the checks that died downstream of the
transport in the scenario. Capture-while-stopped is the path that only exists off
a stopped transport, so the device stops its transport perfectly well.

So this is **not** a pre-existing device failure and **not** a movy bug: it is a
gap between the bash harness and the TS scenario. The bash tier remains
trustworthy for `seq` in the meantime.

Two concrete differences, both in the direction the report ruled out:

- **Bash never reads the engine before pressing.** Lines 126/128, 149, 239/240
  and 271/272 of `scripts/test-seq.sh` are blind press/release pairs with no
  `status` read anywhere near them. The scenario replaced that with
  read-the-play-byte → press → poll-until-stopped, retried three times — which
  puts the harness on the single-slot `overtake_dsp` SHM exactly while the UI is
  trying to flush its `cmd` batch. That is hypothesis (a) below, and it is the
  one difference that tracks the failure.
- **The gesture shape was only half reproduced.** The report states bash's stop
  is `ts_tap_cc` (a 50 ms device-side hold) and reproduced that. True for line
  149 — but the capture-leg stops at 239/240 and 271/272 are **two separate ssh
  injects**, i.e. a hold of >500 ms by `CLAUDE.md`'s own harness note, not 50 ms.
  The shape the report tested and declared dead is not the shape those sites use.

Second, the report's central inference is wrong, and correcting it reopens the
hypothesis it discarded. Both halves are verified locally, no device needed:

- **`seq: play=0` is emitted from inside `parseStatus`** (`src/seq/engine.ts:398`,
  in the function that starts at `:303`) — so it fires *only* when the engine
  itself reports `play=0`. "No `play=0` line appeared" is therefore the **same
  single fact** as "`play=` stayed 1", not a second, independent witness. It does
  not show that the press failed to reach the router.
- **The optimistic mirror flip is silently reverted.** `router.ts:99-100` sends
  `stop` and sets `seqState.playing = false`; the next status poll in the same
  tick sets it straight back from the engine's byte. Nothing is logged.

Driven through the local mock (`browser-test/mock-engine.mjs` + `parseStatusForTest`),
a Play press against a mirror that says *playing* **does** claim the event and
**does** queue `stop`. So the UI-side logic is correct, and what remains is:

- (a) the `stop` op was queued and its batch was lost on the single-slot
  `overtake_dsp` param SHM — the coalescing hazard `CLAUDE.md` documents,
  plausibly aggravated by the scenario's own `every: 30` polling (2× house style,
  5× `PROBE_GAP`). Consistent with `last_key=cmd` being 0, since a coalesced
  batch is not a *failed* write; or
- (b) the press never reached `seqHandleMidi` in the later legs — the capture and
  quantize overlays in `src/midi/router.ts` swallow any non-jog press as a
  dismissal, and the failing legs are the capture legs.

What the missing log line *does* rule out is the third option: the mirror was not
stale-false at press time, so the router did not send `play` again.

The counter-evidence the report used to kill hypothesis (a) — "`mutes.ts` polls
the same param and passes" — does not apply: `mutes` writes engine params from
the harness side and never depends on movy's own queued `cmd` batch surviving.
With bash green off blind presses, (a) is now the leading candidate on evidence
rather than on argument.

Cheapest path, in order:

1. Extend `browser-test/logic/seq-engine.mjs` with the probe above, so the UI
   half is pinned by a unit test forever (it is ~15 lines and needs no device).
2. Drop `stopTransport`'s pre-read and its poll loop — press blind like bash,
   then verify once, spaced at `PROBE_GAP`. If that turns the leg green, (a) is
   confirmed and the rule to write down is "never poll the param slot across a
   gesture the UI has to answer".
3. Only if it stays red, separate (a) from (b) on device with one `mlog` at
   `router.ts:96`.

---

## P2 — durability and hygiene

### 7. Commit the working tree; unbundle the unrelated change

Uncommitted at review time: `CLAUDE.md`, `CONVENTIONS.md`,
`.github/pull_request_template.md`, `test-device/MIGRATION-STATUS.md` — these are
the fixes for the migration review's own D1/D2/D3 and should land. Also modified:
`.aider.conf.yml` (drops the `../schwung` and `../*` reads), which has nothing to
do with this migration — separate commit or revert, but do not let it ride along.

### 8. The `seq` WIP is stored in a gitignored path

`MIGRATION-STATUS.md` says the 16-check WIP is "preserved at
`.superpowers/sdd/test-device-migration/seq-wip.ts`", but `.superpowers/sdd/.gitignore`
ignores it — along with all thirteen per-suite reports and `progress.md`. A clean
clone or a fresh worktree has none of it. Move the WIP somewhere tracked before
the next attempt needs it.

### 9. `device-scripts.mjs` has a decorative guard of its own

Test 10's third guard ("unlinks the state files before seeding over them") keys on
strings that `versions.ts`'s `scpTo` destinations guarantee regardless of the
`clear` command — its bash predecessor required each destination to appear in a
removal. This suite exists to catch exactly this class of check, so it should not
contain one. (Test 10's other two guards and Test 13's `slot-state.mjs` conjunct
are weak for the same reason; see O1–O3 in the migration's `final-review.md`.)

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
