# Device tier runtime — what to cut

**Status:** proposed 2026-10-09, not implemented. Estimated from the last full
run (`.test-out/run.json`, 2026-10-08, sha 610ba73: 20 scenarios, 168 checks,
green), the flake ledger (`test-device/.flake-log.json`, 50 runs) and the
source. The device was offline: **no timing below was measured** — take a
before/after sweep when implementing.

Scenario time last run: **937 s (~15.6 min)**, plus build/deploy. Target
saving: **~3.5–5.5 min**.

| scenario | s | | scenario | s |
|---|---|---|---|---|
| sends | 90 | | reselect | 40 |
| automation | 84 | | widgets | 37 |
| page-lifecycle | 72 | | master-fx | 37 |
| migrate | 67 | | mutes | 34 |
| module-contract | 57 | | unload | 33 |
| page-dive | 51 | | volume | 28 |
| items | 47 | | master-chain | 28 |
| jog-hint | 45 | | smoke | 27 |
| lfo | 45 | | versions | 26 |
| seq | 43 | | virtual-pages | 25 |

## A. Zero coverage loss

### A1. automation: drop the dead persist wait (~25 s)

`scenarios/automation.ts:157-163` waits up to 6000 frames (`every: 200`, one
ssh per poll) for `seq-state.json` to change before closing. Last run it
**timed out** (`persistedBeforeClose: false`): the save had already happened
during the takes (`blob_afterTakes` and `blob_afterClose` are both `gen 5`),
so nothing new was ever written. The detector is also weak —
`fixture.seqStateMtime()` (`fixture.ts:286`) compares `ls -l` output, which
BusyBox prints at minute resolution.

Close saves anyway (see `fixture.ensure()`'s note), and the wait only feeds a
note, never a check. **Do:** delete the wait, or poll the `gen` from
`fixture.blobInfo()` with a short budget and stop as soon as it is ≥ the
post-take gen.

### A2. Multiplex ssh (est. 1–3 min, unmeasured)

`fixture.ensure()` runs before every scenario and cost 12.3 s in `smoke`
(`t_1_fixture`) — ~45 % of that scenario. It makes ~10–15 separate ssh/scp
calls, and `fixture.ts`, `device.ts` (`logLines`) and `engine.ts` all open a
fresh connection per call (README: ~0.5 s per round trip on the device).
Only `display.ts` uses `ControlMaster`.

**Do:** one shared ssh-options constant with
`ControlMaster=auto, ControlPath=/tmp/movy-ssh-%C, ControlPersist=60`, used by
fixture, device, engine and display. Measure `t_1_fixture` before/after.
Watch for gesture-timing changes (lower latency should only help — the helpers
deliver whole gestures in one inject).

## B. Cut where local suites already cover the logic

### B1. Delete `jog-hint` (~40 s)

`browser-test/app-loop.mjs:2029-2053` asserts the same five behaviours (no hint
on touch, none mid-hold, hint after hold, turn removes it, none after a turn).
The device adds only the real framebuffer and wall clock. **Do:** delete the
scenario and fold one framebuffer check ("hint band lit after a 1 s jog hold")
into `smoke`, which already has movy open (~3 s).

### B2. Take `migrate` out of the default sweep (67 s, up to ~4.5 min)

It is `knownFlaky` (`migrate.ts:504`) and therefore **non-gating** — it can
never turn the tier red, yet it costs 67 s per sweep and up to 4 attempts when
it flakes. Logic is covered by `browser-test/logic/track-migrate.mjs`, and the
path only runs once per legacy Set. **Do:** register it as opt-in (run only
when named via `--scenario migrate`, or behind an `--extended` flag); bring it
back into the sweep when the flake is fixed.

### B3. Trim `mutes` (34 s → ~15 s)

Keep: `mute-long-press`, `shift-mute-solo`, `solo-reached-disk`,
`solo-survives-reopen` (real Mute CC routing + on-disk persistence).
Drop: `session-view-inert`, `track-view-mute-step`, `no-stray-active-mute`,
`track-view-latch`, `mute-step-past-4`, `mute-step-no-switch`,
`session-map-latch`, `shift-mute-step-solo`, `un-solo-releases-16` — each is
asserted in `logic/mute-solo.mjs` or `logic/seq-router.mjs` (§ "Mute + step").

## C. Look closer before acting

- **module-contract (57 s):** trigger fire-once / re-arm / pause-re-arm are in
  `logic/trigger-badge.mjs`; acceleration in `logic/knob-input.mjs`. The
  device-only value is real detent packet shape. Candidate: keep
  `gesture-fires-once`, drop the rest.
- **page-dive (51 s):** 16 fails in 40 ledger runs (each a 2× retry, ~100 s),
  green in the last four sweeps. If it recurs, fix rather than cut — it is the
  only end-to-end of the file-browser commit into a sample param.

## Keep

`sends`, `seq`, `master-fx`, `versions`, `reselect`, `lfo`, `items`,
`widgets`, `volume`, `unload`, `smoke`, `page-lifecycle`, `virtual-pages`,
`master-chain` — each covers audio routing, IPC, on-device files,
reboot/restore or real third-party modules that no local suite reaches.

## Estimate

| item | saving |
|---|---|
| A1 automation persist wait | ~25 s |
| A2 ssh multiplexing | ~1–3 min (unmeasured) |
| B1 jog-hint | ~40 s |
| B2 migrate opt-in | ~67 s (more when it flakes) |
| B3 mutes trim | ~15 s |
| **total** | **~3.5–5.5 min of ~15.6** |

Order: A1, B1, B2 (cheap, no risk) → A2 (measure) → B3 → C.
