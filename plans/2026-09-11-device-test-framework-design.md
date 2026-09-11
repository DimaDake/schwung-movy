# Device test framework — design

**Date:** 2026-09-11
**Status:** approved, not yet implemented
**Supersedes:** `scripts/test-*.sh` + `scripts/lib/test-set.sh` (migrated incrementally, not deleted up front)

---

## 1. Problem

The device tier is 14 bash suites, ~6 000 lines, driven from the dev machine over
ssh. Measured baseline for `test-auto.sh`: **61 s wall clock for 7 assertions**,
of which `7.8 s user + 1.7 s system` — 85 % of the runtime is the harness
waiting. Three structural causes:

1. **Every gesture is its own ssh round trip** (~500 ms). A press/release pair
   delivered as two injects is a >500 ms hold, which movy reads as a *different
   gesture*. `test-set.sh` works around this with device-side scripts
   (`ts_tap_cc`, `ts_tap_note`, `ts_tap_two_steps`) that deliver a whole gesture
   in one trip — a workaround for the transport, not a design.
2. **Synchronization is fixed sleeps.** `sleep 0.45` after a gesture asserts
   nothing; it is a guess at how long movy takes to react. `test-auto.sh` alone
   carries ~25 s of them.
3. **Assertions are log greps.** Movy serializes its view model into a log line,
   the suite greps it back out with `grep -oE` and an awk timestamp-dedup hack
   (needed because two sinks write `debug.log`). A failure yields a missing line,
   not a diff — so diagnosis costs a re-run plus several ssh log greps.

Secondary: the harness depends on `../schwung-midi-inject-ui.py`, outside the
movy repo; each suite re-establishes the fixture and closes movy on the way out.

## 2. Goals and non-goals

**Goals**

- All test logic in TypeScript, in the movy repo, deployed with movy.
- No wall-clock sleeps. Synchronization is frame-based or condition-based.
- Movy exposes its own state to the harness (the "callbacks"), so assertions are
  structural rather than textual.
- No references to scripts outside the movy repo.
- Drive lifecycle transitions: close/reopen, `dsp.so` swap, set switch,
  background park/unpark.
- Migration of the existing 14 suites is mechanical.
- Scenarios runnable against each `schwunggrid` renderer (MOVY / DRAW / PAGE).
- Concise agent-facing output with deeper artifacts one read away.
- Target: whole end-of-session regression ≤ 7 min. Optimistic; a substantial
  improvement short of it is still the right trade.

**Non-goals**

- No device simulator or mocking layer.
- No pixel-perfect full-frame device screenshots (region assertions only —
  device content legitimately differs between runs).
- No reinterpretation of the fixture's seeding semantics; `test-set.sh` is
  ported faithfully.
- No parallel scenario execution (one device, shared global state).
- No assertion DSL beyond `state / log / screen / leds / param`.
- No separate "test build" of movy (see §5.3).

## 3. What already exists

`schwung-testd` — an on-device test-bus daemon in `schwung/src/host/test_daemon/`
with a Python client at `schwung/tools/pytest-schwung`. **It is already installed
on the device** (`/data/UserData/schwung/bin/schwung-testd`). It is opt-in: not
started by `shim-entrypoint.sh`.

Line-based ASCII protocol over TCP (default `127.0.0.1:47777`; honours
`SCHWUNG_TEST_BIND` / `SCHWUNG_TEST_PORT`). Existing commands:

| command | use here |
| --- | --- |
| `PING` | liveness |
| `INJECT_MIDI <8 hex>` | one USB-MIDI packet — replaces every `inject` ssh |
| `WAIT_FRAME N` | **blocks on the shim's real SPI frame counter** (~2.9 ms/frame) |
| `SNAPSHOT_PAD_LEDS` | 32 bytes of pad LED colour |
| `STATE` | `overtake_mode`, `selected_slot`, `ui_slot`, `shim_counter`, … |
| `SET_PARAM` / `GET_PARAM` / `SET_PARAM_FILE` / `DUMP_PARAM_FILE` | routed via `/schwung-param` into the **overtake DSP** — i.e. movy's Rust engine, which already answers `status` / `diag` / `cmd` |
| `SET_OPEN_TOOL <id>` | replaces the `open_tool_cmd.json` + mmap python snippet |
| `SUBSCRIBE`/`DUMP`/`UNSUBSCRIBE <channel>` | frame-stamped event capture; `midi_out` only today |
| `RESTART_MOVE` | sets the shim's restart flag |

The Python client also has `wait_for_overtake_dsp()`, which encodes the
overtake-load race the bash suites paper over with `sleep 3`: the mode flips when
the load is *requested* and the instance appears up to ~200 ms later, so injected
MIDI is dropped in between. It gates on mode `== 2` **then** `overtake_dsp:__ready`
leaving `"0"`, with separate budgets per gate.

The daemon's README lists as not-yet-built: display framebuffer snapshots,
**module state providers (`host_register_test_state`)**, log stream, and a
reversible-UI Commander. Those are this design's schwung additions — they are
schwung's own roadmap, not movy-shaped patches.

**Consequence that drives §5:** `GET_PARAM` reaches movy's *engine*, not its *UI*.
Every UI-level assertion in the current suites (automation dot, lane registry,
rendered page, knob arcs) needs a new observation channel.

## 4. Architecture

```
movy/test-device/
  bus.ts          schwung-testd line protocol client (TCP, one persistent connection)
  device.ts       deploy, open/close/park movy, flags, set switch, restart
  probe.ts        movy test-state reads and arrange-verbs
  expect.ts       assertions + evidence capture
  fixture.ts      TS port of scripts/lib/test-set.sh
  runner.ts       discovery, dirty-tracking teardown, tiered reporting
  scenarios/
    automation.ts  ← migrated test-auto.sh
    ...
```

Entry point: `npm run test:device [-- --scenario <name>] [--renderer MOVY|DRAW|PAGE]`.

One Node process, one TCP connection for the whole run. The runner ensures the
daemon is up with a single ssh at startup:

```
pgrep schwung-testd || SCHWUNG_TEST_BIND=0.0.0.0 nohup .../schwung-testd &
```

Binding `0.0.0.0` and connecting directly to `move.local:47777` avoids managing
an `ssh -L` tunnel process. The daemon is opt-in and unreachable from outside the
local network in normal use. The runner stops it at end of run **only if it
started it**, so a daemon left running by hand survives.

### 4.1 Synchronization — three primitives, no wall-clock sleeps

| primitive | blocks on |
| --- | --- |
| `await dev.frames(n)` | testd `WAIT_FRAME` — device-side, the real SPI counter |
| `await until(fn, { within: frames })` | polls a cheap getter, interleaving `WAIT_FRAME 1`; fails with a diagnostic when the frame budget is exhausted |
| `await movy.settled()` | movy's own **render-sequence counter** advancing past the value captured before the gesture |

`movy.settled()` is the callback the framework is built around. It is strictly
more informative than the sleep it replaces: `sleep 0.45` asserts nothing,
whereas waiting on `renderSeq` proves movy processed the input and repainted.

Frame budgets, not milliseconds, are the unit of every timeout. A budget
exhausting is a first-class failure with its own message (`waited 300 frames for
renderSeq > 412, stuck at 412`), not a silent fall-through.

### 4.2 Isolation — declare and unwind

```ts
scenario('automation', async (t) => {
  await t.need.track(0, 'plaits');       // no-op if the fixture already satisfies it
  await t.need.clip(0, { steps: [0] });  // registers its own undo
  ...
});
```

`t.need.*` pushes an undo closure onto a stack; the runner unwinds LIFO at
scenario end, **including on failure**. `fixture.ensure()` runs once per *run*
(the existing `ts_verify` fast path, which already short-circuits in ~2 s when
the chain is already correct). Between scenarios a cheap invariant check runs; if
it fails the fixture is re-seeded once and the run continues. A scenario that
corrupts state costs one re-seed, not a poisoned sweep.

This preserves the order-independence the bash suites have without paying for it
14 times.

### 4.3 Lifecycle

| verb | mechanism |
| --- | --- |
| `movy.open()` | `SET_OPEN_TOOL` + the `wait_for_overtake_dsp` two-gate wait |
| `movy.close()` | Back×3 injected, wait on `overtake_mode` leaving 2 |
| `movy.reopen()` | close + open; picks up a redeployed `ui.js` (shadow_ui re-evaluates it on every tool open) |
| `movy.park()` / `unpark()` | `host_suspend_overtake()`, asserted on `globalThis.overtakeParked` |
| `dev.switchSet(uuid)` | set switch |
| `dev.swapEngine(path)` | close → atomic `mv` → open (see §7) |
| `dev.restartStack()` | testd `RESTART_MOVE` — **recovery only, never a teardown** |

Suites today restart the Move stack on the way out to hand the LEDs back
(~10 s each). `test_set_end`'s own comment notes that closing movy is what
actually returns the surface, and the full restart is already reserved for
`TS_FULL_RESTART=1`. The framework keeps only the close.

## 5. Observation

### 5.1 The schwung hook (generic, upstream)

`shadow_ui.js` gains a module-registered test-state provider:

```js
globalThis.shadow_register_test_state(fn)   // fn: (requestJson: string) => string
```

A module calls it during init. Per tick, shadow_ui checks a doorbell (the same
shape as the existing `shadow_get_open_tool_cmd()` builtin in
`src/shadow/shadow_ui.c`, which reads-and-clears a byte). On a pending request it
reads the request JSON, calls the registered provider, writes the response, and
acknowledges. Cost when no test is running: one integer compare per tick.

**The doorbell gets its own SHM segment, not a `shadow_control_t` field.**
`shmconfig.go` maps `min(256, segment-on-disk)` precisely because a segment left
by an older shim is shorter and touching past EOF is SIGBUS, not a zero. Adding a
field to the struct inherits that hazard for a test-only feature. Instead
`schwung-testd` creates `/dev/shm/schwung-test-probe` and shadow_ui maps it
lazily — absent segment means the feature is simply off, with no version
coupling in either direction.

`schwung-testd` gains:

| command | returns |
| --- | --- |
| `MODULE_STATE <json>` | the active overtake module's provider response (request is one line of JSON, so it carries a key or an arrange-verb) (file-backed when large, like `DUMP_PARAM_FILE`) |
| `SNAPSHOT_DISPLAY` | the 1024-byte framebuffer from `/dev/shm/schwung-display` (128×64, 8 pages of 128 bytes, bit 0 = topmost) — one round trip instead of a ~300 ms scp |
| `SNAPSHOT_STEP_LEDS` | `shadow_overlay_state_t.step_led_colors` — already stubbed "deferred" in `commands.c` |
| `SUBSCRIBE log` | frame-stamped `debug.log` lines, which removes the two-sinks duplicate problem by construction (events are identified by frame, not by a 5 ms timestamp heuristic) |

All four are generic to any module. Upstreamed as a schwung feature PR, per the
standing rule that third-party changes movy needs are framed as upstream
features, never as movy patches.

### 5.2 Movy's provider is a ViewModel dump

Movy registers a provider returning JSON for a small set of keys:

| key | contents |
| --- | --- |
| `tick` | `{ tickSeq, renderSeq, dirty }` |
| `page` | `{ pageId, pageIndex, pageCount, renderer, cells: [{ label, value, arc, autoDot, touched }] }` |
| `auto` | `{ lanes, heldLocks, recArmed, liveTurn }` |
| `leds` | movy's LED cache |
| `seq` | the UI's mirror of engine state |
| `flags` | active flag values |

Movy already has `buildViewModel` and renderers that read a `ViewModel`, so this
is largely serializing something that exists. Two consequences worth naming:

- Device assertions and the existing `browser-test/logic` assertions come to
  speak the same vocabulary.
- The migration of `test-auto.sh` is mostly *deleting a serialization round trip*
  rather than inventing observability. Its current log line —
  `auto render held=1 | ENGI:a0t0=- … DCAY:a1t1=69% …` — is already a flattened
  view-model dump that the suite parses back out with `grep -oE` and awk.

The provider also accepts a small set of **arrange-verbs**: `setGridMode`
(wrapping the existing `setSchwungGridMode()` test override in
`src/renderer/schwung-grid.ts`, which writes no flag and survives no reload),
`selectTrack`, `openPage`.

**Hard rule: verbs arrange, gestures assert.** Anything under test goes through
real MIDI injection; the probe may never be what triggers the behaviour being
checked. This is the discipline `test-set.sh` already applies when it builds
scenes with engine commands and then asserts on real audibility.

### 5.3 No test build variant

The provider is compiled into the shipping bundle. A test-only binary is a
different artifact from the one users run — tests would pass on a build nobody
ships. The provider is pull-only and costs nothing unasked. If it should be
invisible in a release build, gate its *listing* behind the existing debug-flags
mechanism, not its existence.

### 5.4 Graceful degradation

If the hook is absent — the schwung PR is still in flight, or a store update
overwrote the deployed files — `probe.*` reports unavailable and assertions fall
back to `expect.log()`. A sweep degrades in fidelity; it does not break. This is
also what allows development to proceed against a locally patched device while
the upstream PR is open.

## 6. Reporting

Three levels. The rule behind them: **evidence is captured always, printed
never.** Probe state is recorded around every gesture regardless of outcome (a
local write, effectively free), so a failure never needs a re-run to diagnose.
That is the actual saving — today a red device suite costs a re-run plus several
ssh log greps.

**Level 0 — stdout.** The only thing read by default. A green sweep is ~16 lines:

```
✓ automation      7 checks   6.1s
✓ sequencer      31 checks  22.4s
…
14 scenarios · 212 checks · 0 failed · 4m12s   → .test-out/run.md
```

A failure's first line must be diagnostic on its own:

```
✗ automation      6/7 checks  6.3s
  ✗ p4-accumulate   distinct values 1, want ≥3     .test-out/automation.md#p4-accumulate
```

No progress chatter on stdout (`→ Building and deploying...` goes to the
artifact).

**Level 1 — `.test-out/<scenario>.md`, always written.** Per check: the
assertion, expected vs actual, the probe state **diff** around the gesture
(unchanged view-model fields elided), the frame range, and the log slice bounded
to that range. One `Read` diagnoses one failure.

**Level 2 — `.test-out/<scenario>/`.** Raw per-step JSON, PNGs, unelided log.

`.test-out/run.json` carries the machine-readable summary. `.test-out/` is
gitignored.

## 7. Engine (`dsp.so`) reload — spike first

`movy/CLAUDE.md` states that a redeployed `dsp.so` cannot hot-reload and the
stack must restart, because glibc returns the library already loaded under that
path for as long as MoveOriginal lives. **The schwung source contradicts this**:
`schwung_shim.c` retires the overtake module and the worker calls
`dlclose(overtake_free_handle)`, so on movy close the mapping should drop to
refcount 0 and unmap.

Falsifier, run before anything else:

1. Bump `ENGINE_VERSION`, build `dsp.so`.
2. `movy.close()`; wait for the `Overtake DSP: retired module freed` log line.
3. scp to temp + `mv` into place (fresh inode, as `deploy.sh` already does).
4. `movy.open()`; `GET_PARAM overtake_dsp:ping`.

New version ⇒ the ~10 s stack restart per engine build disappears, which is the
largest single per-iteration cost in the loop; `dev.swapEngine()` becomes real
and `CLAUDE.md` gets corrected. Old version ⇒ establish why (`RTLD_NODELETE`? the
chain host holding the same path? the `snap_wait_idle` wedge branch, which
explicitly *skips* the `dlclose` and leaks instead) and fall back to
`RESTART_MOVE`. Either outcome replaces a rule the source currently contradicts
with a documented answer.

## 8. Migration

| today | framework |
| --- | --- |
| `test_set_begin` | `fixture.ensure()` (once per run) |
| `ts_tap_cc` / `ts_tap_note` | `dev.tap.cc()` / `.note()` |
| `ts_tap_two_steps` | `dev.tap.steps([a, b])` |
| `ts_open_movy` / `ts_close_movy` | `movy.open()` / `.close()` |
| `ts_wait_ui_state` / `ts_wait_seq_state` | `until(() => …)` |
| `ts_focus_track0` | `movy.selectTrack(0)` |
| `ts_select_track` | `movy.selectTrack(n)` |
| `ts_verify_chains` / `ts_chloaded` | `fixture.verifyChains()` |
| `ts_seq_apply` | `movy.seq.apply()` |
| `ts_send` / `ts_slot_param` | `dev.param.set()` / `.get()` |
| `ts_restart_stack` | `dev.restartStack()` (recovery only) |
| `movylog \| grep X` | `expect.state(…)` preferred; `expect.log(…)` supported |

`expect.log()` stays a first-class primitive. Frame-bounded via `SUBSCRIBE log`,
so the awk timestamp-dedup hack disappears for free. A suite ports in one
mechanical pass, then tightens to `expect.state()` opportunistically.

Each old script stays until its scenario is green, then leaves
`test-all-device.sh`. `browser-test/device-scripts.mjs` — which asserts
invariants on the device scripts themselves — retires alongside the last script
it guards, replaced by type-checking the scenarios.

`../schwung-midi-inject-ui.py` has no remaining callers once the last suite
migrates.

## 9. Budget

Deletable: per-gesture ssh (500 ms → ~2 ms), fixed sleeps (→ frame waits),
per-suite deploy and fixture-verify (14× → 1×), per-suite restart.

Irreducible: one `fixture.ensure()` (~10 s), ~20 movy reopens across the sweep
(~3 s each — real device work), one build + deploy, and genuine musical time
where a scenario needs bars of playback to advance a playhead (the playhead only
moves with a playing clip that has notes).

Projection for the device tier: **3–5 min**. Whole-session gate at 7 min is
plausible, not guaranteed.

## 10. Acceptance criteria

1. `scenarios/automation.ts` asserts everything `test-auto.sh` asserts — all seven
   checks (P1 ×2, P2, P3, P2/P3-on-reopen, P4 ×2) — and runs
   **substantially faster than the 61 s baseline**.
2. It contains **zero wall-clock sleeps**.
3. Removing the fix each check guards makes that check fail — proven per check,
   not assumed.
4. The runner reports a green sweep in ≤ 20 lines of stdout, and a failure whose
   first line names expected vs actual.
5. No file under `movy/test-device/` references a path outside the movy repo.
6. `npm test` continues to pass; the new tier is additive until a suite is
   deleted.
7. The schwung additions are a single upstream PR touching only the test daemon
   plus the one shadow_ui hook, with the probe absent-safe on both sides.

## 11. Risks

| risk | mitigation |
| --- | --- |
| The schwung PR lands late or not at all | Develop against a locally patched device; probe degrades to `expect.log()` (§5.4) |
| A schwung store update overwrites the patched files | Same degradation path; runner reports "probe unavailable" rather than failing |
| `dsp.so` hot-swap turns out impossible | `RESTART_MOVE` fallback; §7 costs ~10 min to find out |
| Device flakiness is inherent, not transport-caused | Frame-bounded waits give a real diagnostic where a sleep gave silence; the existing "one attempt, don't chase" rule stands |
| Dirty-tracking isolation drifts from real independence | Cheap invariant check between scenarios, re-seed on failure (§4.2) |
