# Migrating a device suite

Turning one `scripts/test-*.sh` into one `test-device/scenarios/*.ts`.

`scenarios/automation.ts` is the worked example — it was `test-auto.sh`, it
asserts the same seven things, and it runs in 33 s against that script's
measured 61 s. Read it before starting; most of what you need is a variation on
it.

---

## Run it

```bash
npm run test:device                      # every scenario
node test-device/run.mjs move.local --scenario automation
node test-device/selftest/wait.mjs       # host-only, no device
```

Green output is one line per scenario. A failure prints its own diagnosis plus a
path into `.test-out/<scenario>.md`, which holds expected-vs-actual, the probe
state around the gesture, and any notes the scenario recorded.

**Read that artifact before doing anything else.** It exists so a failure never
needs a re-run to understand.

---

## The recipe

1. **Measure the baseline first.** `time ./scripts/test-<name>.sh move.local`.
   Write the number down; you need it to show the migration was worth it, and a
   slower scenario means something is wrong.
2. **List the assertions.** Every `pass`/`fail` line in the bash script is one
   `t.check(...)`. Keep the count identical. Give each a stable kebab-case id —
   it becomes the artifact anchor.
3. **Write the scenario** using the mapping table below.
4. **Run it.** All checks green AND faster than the baseline.
5. **Prove teeth, per check.** Break the thing each check guards, confirm only
   that check fails, put it back. A check you have not seen fail is not a check.
6. **Delete the bash script** (`git rm`), remove it from `scripts/test-all-device.sh`,
   and drop any assertion naming it from `browser-test/device-scripts.mjs`.
7. **`npm test`** must stay green, then commit.

---

## Mapping

| bash | scenario |
| --- | --- |
| `test_set_begin` | `await fixture.ensure(t.bus, open, close)` — once, at the top |
| `ts_tap_cc 51` | `await dev.tap.cc(51)` |
| `ts_tap_note 16 127` | `await dev.tap.note(16, 127)` |
| `ts_tap_two_steps` | `await dev.tap.steps([a, b])` |
| holding a step while turning | `await dev.hold(note, async () => { … })` |
| `inj cc 75 <delta>` | `await dev.tap.knob(4, 12)` — knob **index**, signed delta |
| `ts_open_movy` / `ts_close_movy` | `await dev.open()` / `await dev.close(probe)` |
| `ts_focus_track0` / `ts_select_track n` | `await dev.selectTrack(n)` |
| `ts_verify_chains` | inside `fixture.ensure` already |
| `ts_fixture_synth 0` | `fixture.fixtureSynth(0)` |
| `ts_send` / engine param | `await dev.param.get('overtake_dsp:status')` |
| `sleep N` | **delete it** — see the rules |
| `movylog \| grep X` | `await probe.page()` / `probe.auto()` / `probe.tick()` |
| `ts_restart_stack` | `await dev.restartStack()` — recovery only |

---

## Rules — these are not style preferences

Each of these cost a debugging cycle. They are stated as rules so you do not
have to rediscover them.

1. **No `sleep`, no `setTimeout` as a delay, ever.** Wait on a condition:
   `await until(bus, 'what', () => read(), (v) => v === want)`. To let the
   device do work, `await t.bus.frames(n)` — that blocks on the real SPI frame
   counter and touches no param.

2. **Never observe movy while it is restoring a Set.** A param read starves the
   restore; the state you are waiting for never arrives. `dev.open()` already
   handles this — do not add your own readiness poll on top of it.

3. **Probe reads are expensive (~435 ms) and must stay spaced.** That is not
   politeness: the `overtake_dsp` param SHM is a single slot, and polling it
   tightly makes movy's own replies vanish. Do not lower `PROBE_GAP`.

4. **`Back` is not a close button.** At the root it OPENS the Leave modal; while
   the modal is up it DISMISSES it; elsewhere it navigates up one level — and
   before any of that it descends schwung's own layers. A fixed number of Backs
   is ambiguous by parity. Always `dev.close(probe)`.

5. **Read state, do not grep logs.** `probe.page()` gives the rendered cells with
   their `automated` / `touched` flags; `probe.auto()` gives the lane registry.
   The bash scripts parsed this out of a flattened log line — you do not have to.

6. **A gesture must be a gesture.** `dev.tap.*` delivers press and release with
   two frames between them. Do not hand-roll a press and a release with a wait
   in between: a long hold is a *different* gesture to movy.

7. **Verbs arrange, gestures assert.** The probe may set things up
   (`setGridMode`), but whatever the check is about must be triggered by real
   injected MIDI.

8. **Ask the fixture, do not hard-code.** `fixture.fixtureSynth(0)`, never
   `'plaits'`. A hard-coded id is how an assertion silently stops describing the
   fixture it runs against.

9. **`dsp.so` never hot-reloads.** `dev.swapEngine()` restarts the stack. This is
   measured, not assumed — see `plans/2026-09-11-dsp-hotswap-findings.md`.

---

## When a check goes red: STOP

Today's migration produced two confident, wrong diagnoses before the evidence
arrived. Both times the harness was at fault and movy was fine.

**Do not diagnose. Do this instead:**

1. Read `.test-out/<scenario>.md` — the failing check with expected vs actual.
2. Re-run **once**. If it passes, it is a race in your scenario, not a movy bug.
   The usual cause is reading before waiting.
3. Add `t.note('label', value)` around the suspect step and run again. Notes land
   in the artifact and cost nothing.
4. **Reproduce in isolation** before blaming movy: a small script that does only
   the suspect sequence. If it passes in isolation, the bug is in your scenario.
5. If it still fails, **escalate with the artifact** rather than fixing movy.

**Hard rule: if you have tried three fixes and it is still red, stop and hand it
over.** Three failed fixes means the model of the problem is wrong, and a fourth
guess makes it worse. This rule is not about capability; it applied to the model
that wrote the framework too.

**Never weaken a check to make it pass.** Changing `>=3` to `>=1`, or asserting
"something was drawn" instead of "the dot is on the automated param", turns a
test into decoration. If a check cannot pass, leave it failing and say so.

---

## Suggested order

Easiest first. The early ones assert mostly through engine params, which need no
probe and have the fewest traps.

| # | suite | lines | why this rank |
| --- | --- | --- | --- |
| 1 | `test-unload.sh` | 112 | small, one clear assertion, engine-side |
| 2 | `test-reselect.sh` | 154 | engine truth, no UI reads |
| 3 | `test-lfo.sh` | 175 | params only |
| 4 | `test-items.sh` | 179 | params + a little navigation |
| 5 | `test-volume.sh` | 180 | gestures + state |
| 6 | `test-sends.sh` | 191 | engine read-back (`sndlog`) |
| 7 | `test-module-contract.sh` | 222 | many small assertions, repetitive |
| 8 | `test-master-fx.sh` | 229 | master chain, more setup |
| 9 | `test-mutes.sh` | 276 | 16-track gesture matrix |
| 10 | `test.sh` | 312 | the original smoke suite, touches everything |
| 11 | `test-seq.sh` | 451 | biggest, but mostly mechanical engine asserts |
| 12 | `test-versions.sh` | 147 | lifecycle-heavy: real closes and reopens |
| 13 | `test-migrate.sh` | 169 | lifecycle + legacy slot seeding; hardest |

`test-jog-hint.mjs` is **blocked** — it asserts on the framebuffer, and
`SNAPSHOT_DISPLAY` was never built (we chose to make no schwung changes). Leave
it as the last bash-era script.

Do **one suite per commit**. Keep the bash script until its scenario is green,
then delete both in the same commit.

---

## Which model should do this

**Steps 1–4 of the recipe are mechanical and suit a smaller model.** The
translation is table-driven, the rules above remove the judgement calls, and the
worked example covers the common shapes. Suites 1–7 in particular are close to
transcription.

**The diagnosis is not mechanical.** Deciding whether a red check means "movy is
broken" or "my scenario raced" is where this work actually goes wrong — it went
wrong twice for the model that built the framework, and both times the honest
answer only arrived after isolating a reproduction. A smaller model asked to
diagnose a red device test will usually produce a confident, plausible, wrong
story.

So organise it that way:

- a smaller model migrates a suite and runs it;
- if everything is green and faster, it finishes the job — teeth, delete, commit;
- **if anything is red after one re-run, it stops and escalates** with the
  artifact, rather than investigating.

Suites 12 and 13 are worth giving to a stronger model outright: they drive real
closes, reopens and set switching, which is where the timing traps live.

Two things make the escalation cheap: the artifact already contains the
evidence, and the bash script is still there to compare against until the final
commit.
