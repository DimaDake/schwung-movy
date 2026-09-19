# Why 2026-09-19 took nine hours — and eight proposals to make the next one shorter

**Scope.** One session (`4053feee…`, 09:17 → 18:38) delivered five ledger items
— SP-35, SP-38, SP-39, SP-37, SP-31 — on `feat/sp-35-38-gate-items`, plus three
unplanned repairs to the test infrastructure. The work is sound; the *execution*
was long and hard to follow, and the user said so mid-run ("explain with easy
words where we stuck for so long"). This is the measured account of where the
time went and what could be changed **in the repo** so the next run is shorter.

Nothing here is a criticism of the quality bar. Every proposal below is meant to
keep the bar and pay less for it.

---

## 1. What actually happened, measured

Read out of the session transcript, not recalled.

| | |
| --- | --- |
| Wall clock | **9 h 21 m** (09:17 → 18:38) |
| Items delivered | 5 (SP-35, SP-38, SP-39, SP-37, SP-31) |
| Unplanned infra repairs | 3 (cold-chain fixture, `smoke#refresh-blocking`, the device-tier arm) |
| Context exhaustions | **4** (10:49, 14:24, 15:33, 17:35) — each one re-derives the session's state |
| Subagent dispatches | **23** — 5 implement, 11 review/re-review, 3 infra, 4 fix-round |
| Orchestrator wake-ups of a stalled agent (`SendMessage`) | 14 |
| `TaskStop` | 3 |
| Orchestrator `Bash` calls | 146, of which **102 begin with `cd`** |

**Per item, from dispatch to closure:**

| item | elapsed | rounds |
| --- | --- | --- |
| SP-35 | 88 min | review + 1 fix + re-review, plus a blocked device fixture |
| SP-38 | 80 min | review + **3 fix rounds** + 2 re-reviews |
| SP-39 | **203 min** | review + 2 fix rounds + 2 re-reviews + **2 infra side-quests** |
| SP-37 | 65 min | review + 1 fix + re-review |
| (infra) device-tier arm | 58 min | — |
| SP-31 | 27 min | review, then the whole-branch review |
| final review + fix round | 34 min | **interrupted at 18:36 before its gates ran** |

**What the branch is made of** (added lines, `main..HEAD`):

| area | lines |
| --- | --- |
| docs + plans (`.md`) | **3 011** |
| `browser-test/` | 1 101 |
| `src/` | 1 041 |
| `test-device/` | 455 |
| `scripts/` | 266 |

and the new `src/` files are 48–75 % comment lines. The prose is the repo's
chosen style and it is genuinely load-bearing — but **three lines of prose per
line of code is the number to keep in mind while reading the proposals.**

---

## 2. The five things that ate the time

1. **The device is a single exclusive resource, and almost every claim needed
   it.** One implementer at a time; every measurement is build → deploy →
   reopen → wait → read the log. SP-39 paid that twice per arm, on two modules,
   plus a re-measure with SP-38's term stashed.
2. **Gate defects surfaced at the END of an item, not at its start.** Three
   times the tier was red for its own reasons (a partially cold chain, a check
   that graded a whole run instead of a window, an arm that was noted but never
   asserted). Each was found after an item's work was done, and each stopped the
   queue.
3. **Most review rounds were about RECORDS, not code.** SP-38's code change was
   about a dozen lines; it went round three times on a confidence-overstated
   number, a wrong causal explanation and wrong sample counts. Same shape in
   SP-39 ("correct three records") and in the final round (two wrong numbers in
   commit messages).
4. **Agents idled on work that had already died.** Twice an implementer ended
   its turn "waiting on the sweep" when the sweep was gone; the orchestrator had
   to notice and wake it. 14 `SendMessage` wake-ups is the cost.
5. **Context ran out four times.** The ledger alone is **3 398 lines** and every
   session is told to read it first; briefs ran 5–10 KB each; the final review
   covered 22 commits and 58 files.

---

## 3. Proposals

Ordered by (time saved) ÷ (effort). Each one is a change in this repo — none of
them is "try harder".

### P1 — prove the gate is green BEFORE dispatching an item ✅ **SHIPPED 2026-09-19**

Shipped as `./scripts/run-gate.sh preflight [host]` — reachability, then `smoke`
alone (~90 s), then one verdict. Documented in `CLAUDE.md`'s Dev loop as the
thing to run *before* an item rather than after it. No new harness code was
needed: the tier already had `--scenario`, and what was missing was the habit
and a name for it.

**Problem it kills:** #2 above, worth ~2 h in this session alone.

A 3-minute script that runs, in order: device reachable → `fixture.ensure`
read-back → arm takes → one canary scenario (`smoke`, or `--scenario` picked by
the changed paths). It exits non-zero with the specific cause. The orchestrator
runs it *before* each dispatch, and an implementer runs it as its first act.

A red preflight means "fix the harness, then start the item" — which is what
happened three times anyway, except each time it was discovered by an item that
had already spent an hour.

### P2 — make a skipped half a FAILURE, not a green run ✅ **SHIPPED 2026-09-19**

Shipped as `browser-test/schwung-built.mjs`, wired into `npm test` immediately
after the build. It asks the BUILT ARTEFACT (`schwungLibAvailable()`), never the
environment variable — a `SCHWUNG=` set on the run but not on the build is the
exact shape of the trap — and stops the run with the rebuild command. The
opt-out is `ALLOW_SKIPPED=1`, which is loud rather than silent. Verified in all
three states: stub build → exit 1; `ALLOW_SKIPPED=1` → exit 0 with the warning;
built with `SCHWUNG=` → exit 0, "the Schwung half will RUN".

**The rule is now in `CLAUDE.md`: a gate may be GREEN or RED, and "it did not
run" is RED.**

The original proposal, kept because the reasoning is the record:

**Problem it kills:** the `SCHWUNG=` build-time trap, which bit two agents in
one session and is the same class as the arm gap the final review found.

Today `npm test` prints `ALL LOGIC CHECKS PASSED` on a bundle built without
`SCHWUNG=`, with the Schwung half silently skipped. Change: the runner counts
skipped suites and **exits non-zero unless `--allow-skipped` is passed**, naming
what was skipped and the exact rebuild command. Same rule for the device tier:
a scenario whose arm did not take must fail by name (this one shipped in the
final round — generalise it).

**The principle worth writing into `CLAUDE.md`: a gate may be green or red, and
"it did not run" is red.**

### P3 — split the ledger: state vs history

**Problem it kills:** #5. The ledger is 3 398 lines and grows with every item;
every session reads it first and several read it twice after a compaction.

Split it into:

- `docs/schwung-page-migration.md` — the tables, the standing rulings, the
  burn-down, the environment facts. **A few hundred lines, and capped.**
- `docs/sp/SP-NN.md` — one file per item, holding the entry that today lives in
  the ledger body.

The index links out. A session reads the index plus the one item it is working
on. Nothing is lost — the history stays, it just stops being mandatory reading.

### P4 — numbers in records must be produced by a command, not typed

**Problem it kills:** #3. Four wrong numbers in one session (a flake
denominator, a file count, two sample counts), each costing a review round.

Two halves:

- **Tooling prints the sentence.** `npm run test:device -- --flakes` already
  owns the flake rate; extend the same idea — a `--record` flag that prints a
  paste-ready line with the numbers and their denominators.
- **A linter for the ledger.** `browser-test/ledger-rules.mjs`: every claim
  matching a measurement shape (`N of M`, `N/M runs`, `N lines`, `N files`) must
  be followed within its paragraph by the command that produces it, in
  backticks. Cheap to write, and it makes "where did this number come from" a
  test failure instead of a review finding.

### P5 — separate CODE review from RECORD review

**Problem it kills:** #3 again, from the other end.

A review returns findings already tagged `CODE` or `RECORD`. `CODE` findings get
a fix round as today. `RECORD` findings are collected and land in **one
documentation pass at the end of the branch** — not a per-item re-review cycle.
Three of this session's fix rounds would have been one.

### P6 — a foreground gate runner, so no agent can wait on a dead job ✅ **SHIPPED 2026-09-19**

Shipped as `./scripts/run-gate.sh {local|preflight|device|both} [host]`: it
exports `SCHWUNG=` for the build from the sibling checkout, prints a heartbeat
every 30 s, and ends with `VERDICT: GREEN` / `RED` / `DEVICE OFFLINE`. The
original proposal:

**Problem it kills:** #4.

`scripts/run-gate.sh <local|device|both>` that runs the gate **in the
foreground**, streams a heartbeat line every 30 s, and exits with the verdict.
An agent that runs it cannot end its turn believing something is still running,
because the command has not returned. Combined with the existing rule about
`pgrep` matching its own polling loop (added to `CLAUDE.md` this session), this
removes the whole class.

### P7 — scope the device tier to what changed

**Problem it kills:** #1 — the 18-scenario sweep runs for a one-file UI change,
deploys `dsp.so`, restarts the stack and destroys the set state each time.

Add `npm run test:device -- --since <sha>`: a path→scenario map (already
implicit in each scenario's header) selects the affected scenarios, prints what
it skipped and why, and the full sweep stays the pre-merge gate. A UI-only item
would run four scenarios instead of eighteen.

### P8 — a dispatch contract file instead of a 5–10 KB brief each time

**Problem it kills:** part of #5, and the "two agents rediscovered the same
trap" pattern.

Most of every brief was the same standing material: the gates, the burn-down
rule, the `SCHWUNG=` trap, "never `git add -A`", "one implementer at a time",
the report path. Put that in `docs/dispatch-contract.md` and let a brief be the
ITEM plus a one-line pointer. Shorter briefs, and a single place to fix when a
trap is discovered — this session discovered two and had to remember to fold
them into every later brief by hand.

---

## 3b. What shipped, and what is still a proposal

**Shipped the same day (2026-09-19):** P1 (preflight), P2 (a skipped half is a
failure), P6 (the foreground gate runner) — the three with the best ratio of
time saved to code written, and the only three that are enforced by the repo
rather than by anyone remembering them.

**Still proposals:** P3 (split the ledger), P4 (numbers produced by a command),
P5 (CODE vs RECORD review), P7 (`--since` scenario selection), P8 (a dispatch
contract file). P3 and P7 are the next two worth doing and both are real work —
a 3 400-line doc restructure, and a path→scenario map — which is exactly why
they did not ride along with the cheap three.

---

## 4. What NOT to change

- **The review gate itself.** It caught a real batch-eviction defect (`asked`
  stamped by the prefetch) that every other gate passed, plus a false-green
  arming gap. Both were worth the session.
- **The comment density in `src/`.** It is 48–75 % in the new files and it is
  why a later session can read `schwung-page-batch.ts` and know why `asked` is
  not stamped. P3 and P5 reduce the prose a session must *read*, not the prose
  the code carries.
- **"One implementer at a time" on the device.** The resource really is
  exclusive; P1 and P7 make each turn on it cheaper instead of pretending it can
  be shared.

---

## 5. The one concrete follow-up this session left

The final-review fix round was **interrupted at 18:36 before its gates ran and
before it committed**. Its whole output sat uncommitted in the working tree —
the `asked` fix and its new test, the arm assertion, three ledger corrections
and SP-51's id. That is why the branch looked unfinished: not a missing fix, a
missing commit. It was gated and committed on 2026-09-19 in the following
session, which also verified SP-31 on the device for the first time.

**The general lesson, and the reason P6 and P1 are first:** an interrupted run
is indistinguishable from an incomplete one unless the work is committed in
small, gated pieces. A round that ends "done, gates pending" should not be able
to end at all.
