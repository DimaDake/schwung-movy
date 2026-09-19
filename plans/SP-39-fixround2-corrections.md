# SP-39 fix round 2 — the four corrections, and SP-50 as a new item

Scoped re-review of `12a1bb7` (fix round 1). Repairs 1, 3, 4, 5 are ADDRESSED and
untouched. What follows is F1, F2, F3, F5 and the SP-50 ledger write-up. Findings
and their `file:line` evidence live in
`.superpowers/sdd/schwung-page-migration/sp39-fixround2-findings.md`.

## F5 — `ctlreload` left open by a throw (the only code change)

**Reproduction.** `src/renderer/schwung-page-contract.ts` opens
`perfPhase('ctlreload')` and closes it with `perfPhaseEnd()` after
`widgets.afterReplan(adopted)`, with two nested `perfPhase(...)` renames between
(`refreshloaded`, `reloadwidgets`). `perf-phase.ts` keeps the open phase in
module state — `perfProbeTick()` deletes the phase TOTALS and never touches
`phaseName`/`phaseStart`; `resetPerfProbeInstall()` clears only `installed`. A
throw out of `ctl.reloadIfChanged()`, `refreshLoaded()` or `afterReplan()` leaves
the phase open, and the next window's first `perfPhase` charges it the whole
inter-window gap. Same defect repair 3 closed for `padpage`
(`src/midi/router.ts:458-472`).

**Design.** The identical `try`/`finally`, closing via `perfPhaseEnd()` in the
`finally`, with the three phases still distinct (the separation is deliberate and
the comment above it says why). No behaviour change on the happy path — the
rename chain is untouched and the closing call happens at the same point.

**Teeth, measured.** `browser-test/logic/page-contract.mjs` drives a throw out of
`reloadIfChanged` over the REAL contract, waits a 250 ms inter-window gap,
performs what the next window's first `perfPhase` does, then flushes the probe
(120 `perfProbeTick` calls) and reads `ctlreload` off the `perf_phase` line —
the only place `phases` is observable, since the harness's console patch drops
every `[movy]` line. The print itself is asserted so a `SAMPLE_TICKS` drift
cannot make the check pass vacuously.

| arm | `ctlreload` | result |
| --- | --- | --- |
| fix in place | `0.0` | ✓ (green) |
| fix removed (`} finally {` → `}` + trailing `perfPhaseEnd()`) | `2.1` | ✗ (red) |

`perfPhase`, `perfPhaseEnd` and `perfProbeTick` join `harness.mjs`'s preamble and
export list — the documented route for a shared import, not a `dist/esm` path
spelled out in a suite.

## F1 — the "no fleet module reaches this" claim (record only)

`voice-poc` reaches it. It is the only one of the 95 dumps declaring
`child_note_base` (`modules/sound_generator--voice-poc.json:165`, `status` `ok`),
it is installed, and `browser-test/fleet-expect.json` → `voiceDeclaring` already
buckets it. The stronger reason the warm is inert there is that its `pads` level
declares NO `child_index_param`: `schwung-page-input.ts:167` writes the index only
where a level declares the param, so `syncChildIndexFromModule` returns early
(`page_controller.mjs:1775-1777`; `liveChildIndex` carries the same rule at
`:3981`) and the controller resolves at instance 0 while `concrete()` resolves at
`v.childIndex`. Corrected in the ledger NOTE, in the source comment, and in the
report's fix-round table and NOTE list. **The warm's code is unchanged.**

## F2 — the withdrawn scaling claim, still asserted in the carry-over list

The carry-over paragraph said "SP-38's animation cost does not scale with page
count" as established, ~1160 lines from where the same file says WITHDRAWN.
Rewritten to what was measured: the minijv control found NO animating window, so
SP-38's cost on a large module is NOT MEASURED — neither scaled nor falsified.
The weaker statement in SP-38's entry ("draws far more per frame") was checked and
carried the same inference; it is now marked as an expectation, not a result.

## F3 — the `BATCH_VALUE_MAX` comment described a mechanism not in the code

`warm` pushes keys and calls `apply`, which records `len` from the value it read
(`schwung-page-batch.ts:128`), so there is no seeding path that can insert an
oversized entry and no asymmetry for the pruning check to be missing. Comment and
ledger NOTE rewritten to the truth. **The code is unchanged.**

## SP-50 — the new item (ledger only)

Open-table row (Sonnet, ⬜, order 7.8, release gate ✔), the order paragraph after
SP-49's 7.7, the SP-47 pre-ship list (which named SP-48 and SP-49), and an
`### SP-50` entry beside theirs. Nothing here is movy code.

## Gates

- `SCHWUNG=../schwung npm test` → 0 failures.
- `SCHWUNG=../schwung node browser-test/page-mode.mjs` → `3 of 3 expected
  failures remain`, expected-fail list unedited.
- `npm run test:device` with `prefs.flags.schwunggrid` OFF.
- `engine/` untouched → no `cargo test`.
