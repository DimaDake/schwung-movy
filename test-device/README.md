# Device tier (`test-device/`) — the reference

`CLAUDE.md` carries only the gate rules (→ *Device gate*). This file is the
detail behind them: what the harness can do, what each rule cost to learn,
the fixture, and how retries and the flake ledger work. Read it before
writing or debugging a scenario.

## The device tier is `test-device/`

One process, one connection to the device, one report. `npm run test:device`
runs every scenario; `--scenario a,b` runs those. A clean run exits **0**. A
check that stays red is fixed, or carried for at most two days as a row in
`../KNOWN-RED.md` (the tier prints the rows and turns red when one is overdue),
never left red. A gate that is red by design is a gate people stop reading.

The tier **builds and deploys `dsp.so` before any scenario runs**, so a Rust
change is the one actually under test. It restarts the stack only when the
bytes changed, and a failed build aborts the run instead of falling through to
the engine already on the device. `--no-engine` skips it for UI-only iteration
and says so loudly.

**New device tests go in `test-device/scenarios/`.** The bash tier is closed to
additions and `browser-test/device-scripts.mjs` enforces it — a new
`scripts/test-*.sh` fails `npm test`. The list may shrink, never grow.

What is still bash, and why:

| script | why it is still here |
| --- | --- |
| `test-seq.sh` | its scenario (`test-device/scenarios/seq.ts`) is green and in the sweep as of 2026-09-13; this is now a duplicate kept only until `scripts/lib/test-set.sh` goes. Retire it with that. |
| `test-chains.sh`, `test-cpu.sh`, `test-voice-slot.sh` | never in `MIGRATION.md`'s scope, and not in the sweep either. Migrate on next touch. |
| `test-fixture-selftest.sh` | it tests `scripts/lib/test-set.sh`, which outlives the suites: fourteen non-test scripts (`measure-*`, `bench-*`, `dev-probe`) still source it. |

## What the harness can do

Everything below is in `test-device/`; reach for it before writing anything new.

**Scenarios talk to a transport, never to a server.** `transport.ts` is the
interface (`t.tx`): `frames`, `uiMidi`/`dspMidi`, `engineGet`/`engineSet`/
`engineSetQueued` with **unprefixed** engine keys (`status`, `ch0:mix`),
`padLeds`, `framebuffer`, `logGrep`, `launch`/`running`/`restart`, the deploys,
and `move` (the coexistence door, null without Move). `transport-overtake.ts` is
today's implementation over schwung-testd + ui-agent + scp/ssh, and the only file
that may name `overtake_dsp:` or import `bus`/`agent`/`daemon`
(`browser-test/device-scripts.mjs` enforces it). The standalone flavour is a
second implementation over movy-host's test bus (`docs/standalone/testbus.md`),
`transport-standalone.ts`, driving the dev tool movy-sa
(`docs/standalone/movy-host.md`); `run.mjs --flavour sa` (or `standalone`) picks
it, `overtake` is the default. Plain ssh to the box (fixture files, a saved Set)
stays outside the transport, because the filesystem is the same under both.

**A scenario that needs Move beside movy says so**: `scenario(name, fn,
{ needs: 'move' })`. On a flavour without Move it is not run and prints **N/A**,
by declaration; it stays out of the flake ledger and fails nothing. Today that
is `master-fx`, `migrate` and `volume`. A *section* of a scenario that needs Move
checks `t.tx.has('move')` and notes why it skipped (smoke's park/resume).

- **Gestures** — `dev.tap.cc/note/knob/jog`, `dev.hold*` for real holds,
  `dev.selectTrack`. One inject is one ssh round trip (~0.5 s), so a
  press/release pair sent as two injects is a **>500 ms hold** and movy reads it
  as a different gesture. Use the helpers; they deliver a whole gesture at once.
- **Waits** — `until(bus, what, read, pred)` and `bus.frames(n)`. Wait on the
  thing itself, in **device frames**, never on a wall clock: the tick rate
  swings 63-205 Hz with load, so any fixed sleep reading async state is a race.
  The one exception is behaviour whose SPEC is a wall clock (the jog hint's
  1 s hold) — and that check then has to defend its own timing.
- **Reads** — `probe` (movy's own ViewModel), `dev.param.get/set` (engine
  params, unprefixed), `dev.logLines` (debug.log, always as a before/after
  delta), `new Display(t.tx)` (the real framebuffer).
- **Engine** — `tx.deployEngine()` (build + deploy + conditional restart),
  `dev.restartStack()` (`tx.restart()`).

## Rules that were each paid for once

- **A restart must run as root and be verified.** MoveOriginal is root, so
  `restart-move.sh` as `ableton` is EPERM, `|| true` swallows it, and the script
  exits **0** with the old engine still running (measured: pid 7515 unchanged).
  `scripts/lib/restart-stack.py` is the one body both tiers use; it fails unless
  the process actually went away and a new one came back. Never confirm a
  restart by asking whether `schwung-testd` answers — testd does not go down
  with the stack, so it answers instantly and the no-op reports green.
- **A redeployed `dsp.so` is not the running one** until that restart happens,
  and it must go to a fresh inode (`scp` to a temp name + `mv`) — overwriting a
  mapped `.so` corrupts its pages and crashes MoveOriginal.
- **`dev.selectTrack(n)` taps a group-relative track button.** There are four,
  addressing the focused group of four, so it is right only while that group is
  0. With the focus on track 9, `selectTrack(2)` selects track **10**. The
  16-track selector (hold Session + step) is not a drop-in: it commits the
  switch and stays in Session view, where the pads are the clip grid, and its
  press also runs `captureClear()` and `releaseAllLive()`.
- **Sampling a periodic value a fixed number of times asks "was I lucky".**
  Poll to a deadline instead — "did it move within 6 s" has one answer. And park
  the base mid-range first: a 0..1 param modulated at depth 0.9 from near a rail
  spends most of its cycle clamped and reads as frozen while working perfectly.
- **A `logLines` check must be a delta**, opened before the gesture. `debug.log`
  persists across runs, so an absolute read is satisfied by the last run.
- **Assert audibility, not a proxy** — the synth's real param value moving, not
  a repopulated host cache.
- **The playhead only advances with a playing clip that HAS notes** (`len>0` in
  `status`); an empty clip freezes `step`/`pos` at 0 even at `play=1`.
- **MIDI-inject to overtake drops notes and CCs unpredictably.** Build scenes
  with engine commands (`tog`/`clen`/`aset`/`clipdel`) and read `status`/`diag`
  back, rather than driving every setup gesture through the surface.
- **Never `kill -9` `shadow_ui`** — MoveOriginal does not respawn it and the
  device UI stays broken until a reboot.
- **`pgrep -f "<script>"` matches the polling loop that is waiting on it.** A
  wait written as `until ! pgrep -f "test-device/run.mjs"; do sleep 5; done`
  carries the pattern in its OWN command line, so `pgrep` keeps finding the loop
  itself: once the real process is gone the loop never exits, and a later
  `pgrep` "confirms" a tier that finished minutes ago. It cost a session a
  stalled wait and a wrong reading of what was still running (2026-09-19). Wait
  on the child's own exit (`... ; echo done` in a `run_in_background` command),
  or match something the loop does not contain — `pgrep -f "node .*test-device"`
  still matches itself, so prefer the exit status over any `pgrep` pattern.

## The fixture

`test-device/fixture.ts` (`fixture.ensure`) puts the device into the state in
`scripts/fixtures/device-set/`: plaits on track 0, a drum module on track 1,
fixed clips, a seeded automation lane. It applies the state and then **reads it
back** — a scenario never runs on unconfirmed state, which is what makes the
sweep order-independent. Tracks 1-16 are all movy chains, verified via
`chloadedlog`; the four schwung shadow slots are seeded too, as the legacy
material the `migrate` scenario pulls from. A scenario that names an instrument
must ask `fixtureSynth(track)`, never hard-code `plaits`.

Move's firmware owns set switching, so the fixture lands on whichever set is
active and the previous contents are **not** preserved.

`scripts/lib/test-set.sh` is the bash half of the same job and the two must stay
in sync by hand until the last bash suite is gone. After changing it, run
`./scripts/test-fixture-selftest.sh` — a fixture that quietly did nothing makes
every suite look clean while running on whatever the device happened to hold.

## The device tier is a gate, and it retries itself

Local suites cover correctness; the device covers integration (MIDI routing,
IPC, display). Both must be green before a commit — `npm test` (which includes
`npm run typecheck` over `test-device/`, and the harness's own host-only
selftests) and the device tier.

The tier retries a failed scenario itself, by cause, so a race and a break do
not look alike:

| outcome | what it means | what you do |
| --- | --- | --- |
| `✓` | passed first time | nothing |
| `✓` + `infra-retried` | the ssh or the socket dropped and the retry landed | nothing; the link, not movy |
| `⚠ FLAKY` | failed, then passed on the retry | exit 0, but it is **recorded**: see the ledger below |
| `✗` | failed twice | a real failure — follow *Device gate* in `CLAUDE.md`: re-run those scenarios once; still red → fix it, or (if it predates your change) list it in `KNOWN-RED.md` |
| `✗` + `KNOWN FLAKY — not gating` | a scenario marked `knownFlaky` stayed red through its 3 assert retries | exit 0; reported and in the ledger. Mention it in the commit |

`scenario(name, fn, { knownFlaky: '<reason>' })` is a **stop-gap** for a flake
under investigation, not a verdict: it raises that scenario's assert retries to
3 and keeps a surviving red out of the exit code. Only `migrate` carries it
(2026-09-26, teardown park race). Remove the mark with the fix.

`{ optIn: '<reason>' }` keeps a scenario out of the default sweep: it runs only
when named with `--scenario`, and every sweep prints the skip and its reason.
For a scenario that cannot gate anyway and whose logic a local suite owns.
`migrate` carries it (2026-10-09, alongside its `knownFlaky`): run
`npm run test:device -- --scenario migrate` after touching `src/track/migrate.ts`.
Drop both marks with the flake fix.

So a red tier is a red tier. It is not "flaky, probably fine": the retry already
ran and it stayed red. Read the first line of the failure, which carries
`actual, want expected` and a path to the artifact in `.test-out/`. Then
re-run only the red scenarios ONCE (`--scenario a,b`), not the whole sweep. A
retry inside one sweep cannot tell a bug from a device left in a bad state
(after a module churn, say), and a fresh targeted run can: on 2026-10-01 that
re-run turned automation and page-dive green with nothing changed, and left
seq red, which was a real bug.

`⚠ FLAKY` does not block the commit, but it is not free either — every flake
lands in `test-device/.flake-log.json` (last 50 runs, gitignored). `npm run
test:device -- --flakes` prints what has needed a second attempt and how often,
per scenario and per check id. A check that flakes in a few runs out of twenty
is a named race worth an issue and a fix, not a reason to distrust the tier.

`! wait near budget` is the leading indicator: a wait that resolved at ~70%+ of
its frame budget passed *this* time. It is next month's flake, and cheaper to
widen or fix now.

Only two escapes: **DEVICE OFFLINE in caps** when the device is unreachable, and
`--no-retry` for debugging one scenario (it says so on stdout, because one
attempt halves what the run means).

```bash
# Useful commands
./scripts/deploy.sh [move.local]              # build + deploy ui.js AND dsp.so
./scripts/deploy.sh --release [move.local]    # the bundle that SHIPS
npm run test:device -- --scenario smoke       # one scenario
npm run test:device -- --flakes               # what has needed a retry lately
npm run test:device -- --no-retry             # one attempt, for debugging a race
node scripts/grab-screen.mjs /tmp/shot.png    # the live screen as a PNG
ssh ableton@move.local 'touch /data/UserData/schwung/debug_log_on'   # once per boot
ssh ableton@move.local 'tail -f /data/UserData/schwung/debug.log | grep "\[movy\]"'
```

