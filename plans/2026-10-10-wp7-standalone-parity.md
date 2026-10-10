# WP7: standalone parity — plan

> Session plan for WP7 of `plans/2026-10-09-standalone-migration.md`. Read the
> master plan's *Global constraints* and WP7, then `docs/standalone/movy-host.md`
> (what WP6 built and measured) and `docs/standalone/testbus.md`.

**Goal (master plan):** movy-sa passes the whole device tier, with the debugging
and performance surface intact, and the perf table shows no regression.

**Starting point (2026-10-10, after WP6 `f395cac`):**
- movy-host runs the unchanged `ui.js` + `dsp.so`. `smoke` passes 13/13 on
  movy-sa, under a root stack and under an ableton stack.
- The overtake tier is green: 20 scenarios, 156 checks.
- The first full standalone baseline is in *Baseline* below.
- Upstream: U6 schwung#635 (`open_tool_cmd` launches a standalone tool), U2
  schwung#636 (shm contracts doc), U1 schwung#637 (standalone SDK issue). None
  is merged. Nothing below may depend on them; each stays a stand-in until
  `SCHWUNG_FLOOR` covers it.

## Baseline: full tier on movy-sa

`npm run test:device -- --flavour sa`, 2026-10-10:

| Result | Scenarios |
|---|---|
| green (13) | automation, unload, lfo, items, sends, master-chain, module-contract, page-lifecycle, virtual-pages, page-dive, sets-library (after one infra retry), mutes, smoke, versions |
| **red (2)** | `reselect` 5/6: `undo-swap`, "the swap recorded no undo entry" (cause unknown; overtake is green). `master-own` 5/7: `default-unbound` / `unbound` want `mfx:own=0`, and standalone binds movy's master by host mode BY DESIGN (WP3), so the scenario's expectation must follow the flavour |
| N/A (2) | volume, master-fx (`needs: 'move'`); migrate is opt-in |
| **not run (2)** | `seq`, `widgets`: the tier hung at `seq`. Two `launch()` calls fired in the same instant (after a retry), both ran launch-standalone.sh, and the loser's restarted Move under the running movy-host. **Fixed in WP6** (single-flight launch, `selftest/standalone-launch.mjs`), not yet re-run |

Each scenario took ~140-360 s against ~25 s on overtake: every close/open
round-trips through a Move restart (T1).

## Deferred manual checks (the user asked to do these later)

These are not WP7 blockers. Run them in one sitting before WP8:

1. Open "Movy SA (dev)" from the Tools menu by hand. Expected: Move goes
   away, movy comes up in ~3 s, and Close Movy returns to Move.
2. A listening check on the fixture Set: pads sound, there is no click at
   start or exit, and nothing is audible at the Tools→movy handoff (R9).
3. Press the power button while movy-sa runs, once WP7's power path exists.

## Tasks, in order

Each task ends with its own device proof. Gate per CLAUDE.md: `run-gate.sh both`
(overtake), plus `--flavour sa` for the tier at the end.

### T0. Close out the baseline

- Re-run `seq` and `widgets` on movy-sa (they never ran; single-flight launch
  is fixed).
- `master-own`: make `default-unbound` / `unbound` follow the flavour.
  Standalone binds movy's master by host mode, which is WP3's design and not a
  bug.
- `reselect` `undo-swap`: find out why a module swap records no undo entry on
  movy-host. It may be timing (the 2 ms tick vs the 63-205 Hz overtake tick)
  or a host-global answer that differs (the slot API answering null). Fix it
  or explain it, with a logic test.
- The lock loser still costs a Move restart. Even single-flight, a second
  launch (a person pressing Tools twice) runs launch-standalone.sh, which
  restarts Move under the running movy-host once the loser exits. The
  launcher should refuse BEFORE launch-standalone.sh kills anything. That
  needs a launch-standalone hook (U5 family) or a pre-check in the Tools path.
  Track it upstream.

### T1. Restart without a Move round trip (harness speed + R6)

Today every close/reopen goes through `launch-standalone.sh`: Move is restarted
on each exit and killed again on each launch. The baseline shows the cost
(`reselect` 280 s; it is ~1/4 of that on overtake). Once, after an ableton-uid
exit, Move also took ~60 s to bring shadow_ui back.
- **Launcher loop:** `standalone/launch.sh` runs movy-host in a loop while it
  exits with a "relaunch" code (e.g. 75); bus verb `EXIT relaunch` (or
  `RESTART`). A plain exit still returns to Move. Then
  `transport-standalone.ts` `restart()` and the Close→Open cycle stay inside
  movy-host, and the frame clock is down for ~0.5 s instead of ~7 s.
- `Device.close()` on standalone: Close Movy really exits (the user's path). The
  fixture's close/open pairs can use the relaunch instead; decide per call
  site, never silently.
- Investigate the 60 s case: time MoveOriginal → shadow_ui spawn after an
  ableton exit, then a root one. If it reproduces, it is an upstream report
  (U5 family).

### T2. Test bus: the rest of protocol v1

- `LOG_SEQ` / `LOG_TAIL`: a 4096-line ring fed by `mh_log` / `mh_log_src`
  (movy-host, `movy-dsp`, the UI's `shadow` source). `logGrep` in the standalone
  transport moves to `LOG_TAIL 0 <pattern>`, with no ssh. The README rule "a
  `logLines` check must be a delta" becomes exact.
- `SUBSCRIBE midi_out` / `DUMP`: tap `midi_out_take` (audio thread → SPSC → bus).
- `UI_EVAL` (dev builds only, `MOVY_TESTBUS_EVAL`): queued to the UI thread
  and run between ticks; await promises.
- Selftests for the line parsing (host/tests) and the transport (selftest).

### T3. Standalone behaviour behind caps

- **Volume knob → master volume.** CC 79 without a held track drives
  `mfx:vol`, with the touch overlay. Decide where it is stored: global prefs,
  not per Set (the master plan says "standalone decides"). Router today ignores
  CC 79 without a track held (`midi/router.ts` ~584).
- **Track + volume** on all 16 tracks without Move's overlay: check
  `mixer/track-volume.ts` under `coexistsWithMove=false` (injectHold and
  setMoveExcluded are already no-ops).
- **Power button.** The source says it is cable-0 SysEx
  `F0 00 21 1D 01 01 3A <id> <val> 00 F7` (4 packets). Capture it live through
  the bus, and show a shutdown dialog: Save + Power off / Cancel. Power-off
  needs root: add a second closed verb to `bin/heal` (`heal poweroff <pid>`,
  same exe check), or U3 upstream. Never power off without a confirm.
- **Hard fallback exit**, in C so it works even when the UI is wedged:
  Shift+Vol-touch+Jog-click (shadow_ui's escape) → clean exit. Document it.
- **Leave modal:** already "Close Movy" only (WP1 caps). Verify on device.
- **Speaker EQ (R8):** decide: port it to the master chain, or document it in
  MANUAL as a limitation.

### T4. Debuggability checklist, each proven by a script or scenario

`dev-probe.sh log|status` (flavour-aware), `capture-screen.mjs` (display-server
stream: already works), `grab-screen.mjs`, the CPU meter page, `perf-probe.ts`
`perf_ipc`, engine `diag` commands, `inject-*.py` via the inject ring (works
since WP6, unproven by a script), JS stack traces (WP6: any throw logs a
stack), and a native crash backtrace (WP6 handler: prove it with a dev-only
`SIGSEGV` trigger).

### T5. Fixture and Sets under standalone

The WP6 fixture branch installs movy's half only, on the Move-bound Set (under
`setsrc` legacy). Decide whether the standalone tier runs on the library
(`setsrc`=1, WP4). If so, the fixture seeds a library Set, and `sets-library.ts`
must pass on movy-sa.

### T6. Performance comparison (same fixture Set, both flavours)

Compare frame headroom, CPU-page totals, the `perf_refresh_ms` median, the tick
rate and pad-to-sound latency (`measure-pad-latency.sh`, ported to the
transport). Every number must be equal or better. Results go in
`docs/track-performance.md` as a new section. Also: the chain-load slow frames
(12–40 ms, parity with the shim). Measure them, and decide whether moving loads
off the audio thread (an engine change) belongs here or in WP11.

### T7. `run-gate.sh device --flavour sa`

The gate takes the flavour. `needs: 'move'` scenarios print N/A, and every
other scenario is green or in KNOWN-RED with a reason. Then a MANUAL draft for
the standalone behaviours (Close, volume, power, the fallback exit).

**Exit:** both flavours are green on the full tier; the perf table shows no
regression; the MANUAL draft is written.

## Risks to watch

- The baseline will run long until T1 lands. Do T1 first.
- The root vs ableton uid: every new file or shm movy-host creates must be usable by
  both (WP6 found four such bugs). Run the standalone tier at least once
  under each.
- A movy-sa left running blocks the overtake tier. The transports guard
  against it now. Keep `close()` exiting.
