# Trigger knob UI + PR #2 follow-up fixes

**Date:** 2026-07-30
**Status:** design, approved
**Base:** PR #2 (`agent/module-compatibility`, `689e91b`) merged with `main`

## Problem

PR #2 introduced one-shot "trigger" params: an enum whose options are
`idle`/`trigger`, fired by a clockwise knob turn. The mechanism works — the
param write reaches the DSP — but it is invisible.

`behavior` never leaves the model. There are no references to it in
`model/viewmodel.ts`, `renderer/`, or `types/viewmodel.ts`, and PR #2 changes no
renderer file. So the renderer has no idea the knob is an action and draws a
stock 2-option enum cell that permanently reads `IDLE`. Firing produces no
flash, no LED change, no acknowledgement of any kind.

Verified on device (smack v0.15.2 in FX 1): the action fires while the screen
never changes.

```
trigger slot=0 key=fx1:capture val=1     → CN:a0t1=idle
trigger slot=0 key=fx1:arm     val=1     → ARM:a0t1=idle
trigger slot=0 key=fx1:reroll  val=1     → RE-RO:a0t1=idle
```

A one-shot control with no acknowledgement is worse than the stateful enum it
replaced: the user cannot distinguish a fire from a no-op, and the gesture latch
silently swallows the second attempt. `IDLE` actively misleads — it reads as a
value you failed to change.

Two further defects found while reviewing PR #2 are fixed here because they sit
in the same code paths.

## Part A — trigger knob UI

### A1. State machine (`src/model/trigger.ts`, new)

**PR #2's 700 ms re-arm timer is kept.** It is a gesture-end debounce, not an
arbitrary delay: `lastTurnMs` updates on *every* turn, so the latch holds for as
long as the knob keeps moving and releases only once the hand stops for 700 ms.
Device measurements confirm it behaves correctly — detents 645 ms apart (one
continuous movement) fire once; detents 811 ms apart (stopped, then turned again)
fire twice. One sweep, one fire; a deliberate second gesture, a second fire.

Removing it was considered and rejected. Without it, repeat-firing a performance
control like `reroll` would need a CW–CCW–CW wiggle, which is worse on stage than
simply pausing. Keeping it also preserves PR #2's semantics exactly, so the
metadata contract stays shared with upstream instead of forking.

The defect is that the timer is **invisible**, so the user cannot tell why a
second turn did nothing. Render it (A3); don't delete it.

Three states — two persistent, one momentary:

| Input | ARMED | COOLING |
|---|---|---|
| turn CW | write `trigger` → **FIRED** (200 ms) → COOLING | nothing; drain restarts (gesture still going) |
| turn CCW | nothing (already idle; skip redundant IPC) | write `idle` → ARMED immediately |
| 700 ms with no turn | — | → ARMED automatically |

There are two ways out of COOLING and the badge shows both: turn back for an
immediate re-arm, or stop and let the drain finish.

CCW-while-ARMED writing nothing is the only deliberate departure from PR #2,
which writes `idle` on every CCW. The `COOLING`→`ARMED` transition still writes
`idle`, which is what a latching DSP needs in order to re-arm.

**Separately, fix the one real double-fire.** `loadHierarchy` resets
`s.paramGestures = {}` unconditionally, so a reload landing mid-gesture clears the
latch and the action fires twice. Observed once (4 rapid detents → 2 fires); a
reload fires ~1 s after a module loads as `pollModuleName` settles, which is
exactly when a user first reaches for the knob. Preserve gesture state across a
reload of the *same* module — clear it only when `s.moduleId` actually changes.

**State is never read back from the param.** The badge renders from the state
machine, so a module that latches the param cannot drag the display off state.
`refreshOneParam` may still update `knobValues`; nothing renders it for a
trigger. This also means `noRefreshKeys` is not involved — that set is owned and
repopulated by the automation-lane registry (`model/index.ts:250`) and must not
be co-opted.

### A2. Initial state seeding

A DSP may hold the param at `trigger` when movy loads — a latching module, or a
preset restored with the value at 1. If movy assumed ARMED, the first CW turn
would write `trigger` to a param already at `trigger`, producing no edge and no
action, while the UI flashed FIRED.

At hierarchy load, seed from the value already read: if it equals the trigger
index, start **COOLING** with the drain already empty (so it shows the CCW arrow
and does not auto-re-arm from a timer that never ran); otherwise **ARMED**.

Movy must **not** write `idle` to normalize the param at load. `arm` on smack is
documented as "arm-and-record" and carries real module state; movy cannot know
whether a non-idle value is stale or meaningful, and an unsolicited write could
disarm a module the user armed. Seeding the display costs nothing and stays
honest; the user's CCW turn then writes `idle` exactly as PR #2 already does.

### A3. Rendering

Close the chain that PR #2 leaves open:

```
trigger.ts (state) → ParamVM.trigger:     'armed' | 'fired' | 'cooling'
                     ParamVM.triggerCool: 0..8   (drain steps remaining)
                   → knob.ts       drawTriggerBadge()
                   → label.ts      name / "FIRED" / "<-TURN"
                   → knob-leds.ts  bright while FIRED, else dim
```

**Widget — an action badge**, deliberately not a knob. The cell is 16×16
monochrome and must not read as an arc knob (circle + pointer), a bar, or an
enum box, all of which already exist.

- **ARMED** — solid 1px frame, clockwise circular arrow at r≈4 centred.
- **FIRED** — the whole 16×16 filled solid, with the same clockwise arrow
  knocked out in colour 0 (so the glyph reads as a negative of ARMED).
- **COOLING** — dashed frame, arrow mirrored counter-clockwise, plus a
  **cooldown drain**: the frame's top edge is drawn as a bar that shortens from
  full to empty as the 700 ms window elapses. When it empties the badge returns
  to ARMED on its own.

The arrow flips direction so the widget always shows which way to turn next, and
the drain shows the other exit — wait and it re-arms itself. Together they answer
"why won't it fire again?" without documentation.

**Drain quantisation.** The drain is quantised to 8 steps (~88 ms each) so the
widget repaints ~8 times per cooldown rather than once per tick (~70 repaints at
the measured 85–105 Hz). It restarts at full on every turn, mirroring
`lastTurnMs`, so it reads as "time since you stopped moving".

**Label row** (`label.ts`): triggers override the `touched ? displayValue :
shortName` rule so `idle` never appears. Shows the short name when armed,
`FIRED` during the flash, `<-TURN` while cooling.

Both strings must fit the 32px cell, because `drawLabelCell` centres on the knob
and does not clip — an over-wide string bleeds into the neighbouring cells.
Measured against the 5px font: `FIRED` = 23px and `<-TURN` = 28px both fit;
`TURN <-` = 33px does **not**. Any future wording change must be re-measured.

**LED** (`knob-leds.ts`): brightest level of the row's own scale (120 white for
knobs 1–4, 3 orange for knobs 5–8) while FIRED; the existing dim level
otherwise. Cooling stays dim-but-lit, preserving the file's stated intent that
every knob stays lit so the row is identifiable, and avoiding ambiguity with an
empty slot, which renders colour 0. The LED does not track the drain — that would
reintroduce per-tick LED sends for no information the screen isn't already giving.

`TRIGGER_FLASH_MS = 200` goes in `model/constants.ts` beside `HOLD_MS`.
`TRIGGER_REARM_MS = 700` moves there too, from PR #2's local
`TRIGGER_GESTURE_RESET_MS` in `store.ts`, since the renderer now needs it to
scale the drain.

**Repaints** follow the `jog-hint` precedent: tick sets `dirty` while a flash is
live or a drain step changes, then once more to settle. Bounded at ~20 ticks for
the flash plus ~8 drain steps at the measured 85–105 Hz device tick rate, so
repaints and LED sends both return to zero and the idle perf budgets hold.

### A4. Why a new module

`src/model/store.ts` is 319 lines, already past CLAUDE.md's 200-line hard limit,
and PR #2 adds ~70 more to it. The trigger state machine goes in
`src/model/trigger.ts` with a narrow interface — `applyTriggerDelta`,
`triggerVisualState(key)`, `triggerTick()` — so it is testable in isolation and
`store.ts` stops growing.

## Part B — PR #2 follow-up fixes

### B1. Module metadata must not defeat the global-bank automation guard

`hierarchy.ts:236` changed `slot.automatable ?? heuristic` to
`slot.automatable ?? cp.automatable ?? hier.automatable ?? heuristic`. The
heuristic's `!bank.global` term exists because global-bank params are not
reachable as chain `target:params`; the override was deliberately scoped to
movy's own config. Reproduced:

```
chain_params silent (baseline):                      g_master_vol automatable = false
module declares automatable:true on a GLOBAL param:  g_master_vol automatable = true
```

A third-party module can now re-enable a misleading automation dot on a param
the host cannot resolve. Keep `cp.automatable` / `hier.automatable` subordinate
to `!bank.global`.

Zero of the 78 dumped modules declare `automatable`, so this changes no existing
module's behaviour — it closes a future footgun.

### B2. Wide acceleration must not compound the accumulated delta

The shadow UI accumulates knob deltas and flushes one CC per tick, so a fast
hardware spin arrives as a single large delta, which the ladder then multiplies
by up to 250. Measured on device:

```
delta=+1/event, 3 events @25ms → seed 4304→4804   (+500)
delta=+3/event, 3 events @25ms → seed 4807→6307   (+1500)
delta=+6/event, 3 events @25ms → seed 6313→9313   (+3000)
```

A flick crosses the full 1–9999 range in ~2 ticks (~20 ms), making the middle of
the range unreachable at speed — the opposite of the feature's stated goal of
"slow single-step precision plus fast travel".

Apply the multiplier to a unit step rather than the raw delta:
`Math.sign(delta) * multiplier * p.step`. Fast still means far; it stops
multiplying an already-multiplied quantity.

### B3. Smaller items

- **Dead ternary** in `dump-boot.mjs`: `component_type === 'sound_generator' ?
  'sound_generator' : component_type` always equals `component_type`.
- **`pixelmatch` version divergence**: PR #2 adds `pixelmatch@^7.2.0` to the root
  `package.json` while `browser-test/package.json` pins `^5.3.0`. The harness
  resolves v5 from `browser-test/node_modules`, so the new root declaration is
  inert but divergent. Reconcile on one version rather than declaring two.
- **Contract fixtures are a patch behind** every current release (smack-in
  0.15.1 vs 0.15.2, belt-in 0.2.0 vs 0.2.1, mono-voice 0.4.1 vs 0.4.2). All five
  differ from the shipped releases *only* in the `version` string — hierarchy,
  params, trigger and acceleration metadata are byte-identical — so refreshing
  them is a no-op for `dump-expect.json`. Cheap, and it removes a stale-looking
  baseline.
- **MANUAL.md**: PR #2 adds a prose paragraph but never reaches the Controls
  reference tables in section 8, which CLAUDE.md requires for a new gesture. The
  new badge states and the CW/CCW gesture go there.

## Non-goals

- **No confirmation guard for destructive actions.** `clear` and `detect_bpm`
  are declared triggers but appear on no `knobs` list in smack v0.15.2, so they
  are unreachable in movy today. Designing a guard for them is speculative.
- **Trigger detection is untouched.** `inferBehavior` keeps both paths: explicit
  `behavior: "trigger"` and the conventional `["idle","trigger"]` option pair.
- **`knob_acceleration` detection is untouched** — only the delta maths in B2.
- **No module-side changes.** `clear`/`detect_bpm` reachability is Tim's to fix
  upstream; report it, don't work around it.

## Affected params

Ten params across the 78-module fleet, all Smack family, and nothing else:

| Module | Params |
|---|---|
| `audio_fx/smack` | `capture`, `arm`, `reroll`, `clear`, `detect_bpm` |
| `sound_generator/smack-in` | same five |

Only `capture`, `arm` and `reroll` are reachable (on a `knobs` list). Zero
params currently rely on the `["idle","trigger"]` auto-inference path — every
one of them also declares `behavior` explicitly — so that path is forward-looking
for other module authors rather than load-bearing today.

## Upstream compatibility (Tim's modules)

Nothing here changes the **metadata contract**. `behavior: "trigger"`,
`knob_acceleration: "wide"` and `automatable` keep their meanings and their
detection rules; modules keep declaring exactly what they declare now. No module
needs to change, and no module breaks.

The **trigger gesture is unchanged too**: CW fires, CCW re-arms, and the 700 ms
gesture-end debounce is preserved exactly. Firing behaviour is bit-for-bit what
PR #2 ships; the work is that movy now *shows* it. That keeps the contract shared
with upstream — there is no forked semantics to reconcile later.

One **behaviour** change is worth telling Tim about, because it alters feel rather
than compatibility:

- **Acceleration is less aggressive** (B2). `seed` still travels fast, but a flick
  no longer crosses the whole 1–9999 range in ~20 ms, so the middle of the range
  becomes reachable at speed.

The two changes that only *tighten* things, with no module affected today:

- B1 stops module-declared `automatable` from overriding the global-bank guard.
  Zero of 78 modules declare `automatable`, so nothing existing changes.
- CCW-while-ARMED no longer writes a redundant `idle`. The `COOLING`→`ARMED`
  write, which is the one a latching DSP needs, is unchanged.

Two things to report upstream rather than fix here:

- `clear` and `detect_bpm` are declared as triggers but are on no `knobs` list in
  v0.15.2, so movy cannot show them. `clear` was previously visible — the fixture
  refresh drops it from `shownKeys` in `dump-expect.json`.
- B1 and B2 are defects in PR #2's own code. Offering them back upstream is worth
  doing regardless of where the UI work lands, so the fork does not carry private
  fixes.

## Testing

- **`logic.mjs`** — fires once per gesture; CW-while-COOLING is a no-op and
  restarts the drain; CCW-while-COOLING re-arms and writes `idle`;
  CCW-while-ARMED writes nothing; flash expires after `TRIGGER_FLASH_MS`; drain
  empties after `TRIGGER_REARM_MS` and auto-re-arms; drain quantises to 8 steps;
  load with value at trigger → COOLING (A2); gesture state **survives** a
  same-module hierarchy reload but resets on a module change; B1 global-bank
  guard; B2 acceleration no longer compounds.
- **`screenshot.mjs`** — four new scenes (armed / fired / cooling-full /
  cooling-nearly-empty) with baselines. CLAUDE.md requires a screenshot test for
  new rendering, and the drain needs two samples to pin its geometry.
- **`perf.mjs`** — LED sends return to 0 after the flash; repaints return to 0
  after the drain; `fill_rect` within budget on a page of 8 triggers.
- **`dump-replay.mjs`** — existing trigger invariants keep passing over all 78
  modules.
- **Device** — extend `scripts/test-module-contract.sh` to assert the cooling
  state and the auto-re-arm. The existing 700 ms-pause check **stays**, since the
  debounce it covers is retained. `scripts/inject-burst.py` is required for these
  gestures; per-event injection is ~600 ms per CC, far wider than the windows
  under test.

Each new test must be shown to fail with the fix reverted before it counts.
