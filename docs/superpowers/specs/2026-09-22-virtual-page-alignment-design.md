# Virtual page alignment — step, clip and set params under Schwung

SP-53/SP-54 put Clip Params, Set Params and the step page on the
virtual-component seam. They work; they do not yet *feel* like the pages they
replaced. This spec covers the alignment pass over all three, and the single
opt-in upstream PR for the parts a host cannot reach.

Read against `schwung@1959e661` and `movy@8a135a6`. Every claim below carries
the file:line it was read from, or the probe that produced it — the ledger's own
rule (`docs/schwung-page-migration.md`, "the burn-down is the gate") applies
here: a claim no run prints is a claim nobody has checked.

---

## Rulings that shape this work

Three, all the user's, all taken during design:

1. **Native first, not pixel identity.** Reuse Schwung's own widgets wherever
   they will do the job. Do not restore movy's old cell styles through a
   host-side widget layer.
2. **Upstream only what helps every param page.** A change that only movy wants
   is a host-side change or it does not happen.
3. **The upstream PR must not alter any existing rendering.** Every item in it
   is parametrized and defaults to today's behaviour, so a module that declares
   nothing draws and turns exactly as it does now.

Ruling 3 is what keeps the bundle reviewable: it is additive by construction,
and a reviewer can check that claim per item rather than trusting a diff.

---

## Findings

Verified before designing anything. The two that changed the design are marked.

### F1 — no viz group claims any virtual cell

A probe built each of the three contracts' `chain_params`, ran
`buildMetaIndex` + `resolveViz` under node, and printed the groups:

```
=== step   (no groups)
=== clip   (no groups)
=== set    (no groups)
```

So velocity is unclaimed and gets no fader by detection, and — importantly —
`drawnWide()` is **not** why the enum overlay is missing (a wide graphic
suppresses the peek: `page_controller.mjs:3423`). That hypothesis is dead.

### F2 — the peek is cleared by the touch, not by the turn ★

`onKnobTouch(slot, down)` sets `s.peek = null` unconditionally
(`page_controller.mjs:3623`), on press **and** on release. movy forwards touch
and release on all three pages (SP-53/SP-54).

Compounding it: the peek expires on a 1500 ms clock (`ENUM_PEEK_MS`,
`page_controller.mjs:380`, read through `enumPeek()` at `:3899`), and movy's
repaint gate (`src/app/tick.ts:321`) does not include the peek in its change
signature — so nothing asks for the frame in which the overlay should come
down.

**This is a diagnosis, not yet a proof.** Which of the two actually costs the
overlay on the box is the first task, and it decides whether the fix is
host-side, upstream, or both.

### F3 — MODE and LAYOUT toggle because they are 2-option enums ★

The same probe, printing meta per cell:

```
set  mode    kind=enum widget=enum divable=true flips=true opts=2
set  layout  kind=enum widget=enum divable=true flips=true opts=2
set  link    kind=enum widget=enum divable=true flips=true opts=2
step invert  kind=enum widget=enum divable=true flips=true opts=2
```

`isTwoWayMeta` (`knob_engine.mjs`) makes a 2-option enum **toggle on any
detent**, latched at `TWO_WAY_GESTURE_GAP_MS = 270`. Turning the knob therefore
flips the value back and forth rather than stepping it — the reported
"it cycles through values".

LINK and INVERT escape it for one reason: their options are `Off`/`On`, so
`isSwitchMeta` takes them first and the turn is direction-absolute (CW = on).
`Chromatic`/`In Key` and `4th`/`Piano` are word choices, so they fall through to
the toggle. This is why only the keyboard pair misbehaves.

### F4 — big numbers are name-gated, and tempo already passes

`shouldDrawBigNumber` (`render_page_movy.mjs:1806`) refuses a span over 24
(48 bipolar) unless `isCountedQuantity` matches the key or name against
`COUNTED_WORDS` — which contains `bpm|tempo|steps?|pulses?|rotation|count|
voices|polyphony|divisions?`. Probe:

```
set  tempo   widget=bignum   (matched by name)
set  swing   widget=knob     (span 30 > 24, no name match)
clip length  widget=knob     (span 63 > 24, "Length" is not "steps")
```

So tempo is already right and needs nothing. Swing and clip length are dials
where movy showed numbers, and **no module can opt into the number** — the only
door is a name the library happens to recognise.

### F9 — the big face is twelve glyphs, and movy ships the whole one

`font_big_num.mjs:34` declares `CHARS = '0123456789+-'` — twelve glyphs, "matching
what `bigNumberText` can emit". `missingGlyphs` reports anything else rather
than drawing it wrong, and `tests/host/test_big_number_font.sh` sweeps the fleet
against that. So `50%` and `2:4` cannot be drawn in it at all today.

Its own header records where it came from: transcribed from movy's
`src/font/glyphs-big.ts`, MIT, © megadake — and **movy's copy is a full ASCII
atlas**, `%` `:` `/` `.` included (verified by reading it). Upstream vendored a
subset of a face this project already owns in full.

Two more gates sit in front of a non-numeric big value:

- `shouldDrawBigNumber` returns false for `kind === KIND_ENUM` outright
  (`render_page_movy.mjs:1807`), so COND's `2:4` was never reachable by any
  declaration.
- `bigNumberText(meta, raw)` computes its own text from the raw number, so a
  cell drawn big ignores whatever `short_options`/`options`/`formatValue`
  already resolved.

This is what makes U3 a capability rather than a rename.

### F5 — knob feel: 2× on enums, magnitude-scaled on velocity

Old movy charged `DETENT_DIV = 8` raw CC units per enum step
(`src/seq/detent.ts`). Delegation feeds **one detent per raw unit**
(`src/renderer/schwung-page-input.ts:113-135`, deliberately — collapsing to ±1
made knobs "move very very slowly") into `ENUM_DELTA_DIV = 4`
(`knob_engine.mjs`), so every enum on these pages is **twice as fast** as it
was.

Velocity changed shape, not just rate: old movy applied a flat ±4 per CC event
regardless of the event's magnitude (`step-edit.ts`'s `VEL_STEP`), while
delegation multiplies by it.

There is **no acceleration** on either path — `wideStepCount` applies only to
`knobAcceleration: "wide"`, which nothing declares. The complaint is rate and
consistency, not acceleration.

### F6 — the length cap is the engine's, and the old UI had no overlay

`Clip::set_length` clamps the gate to the next same-pitch note or the clip end
(`engine/crates/seq-core/src/clip.rs:588`); `applyStepLenIdx` mirrors that cap
and toasts "Max — blocked by next note" (`src/seq/step-edit.ts:310`).

The old step page built `overlay: null` (`src/seq/step-page-vm.ts:105`) — it
never had a length overlay to lose. The old clip page raised one for SCALE only
(`clip-page-vm.ts:67`); the old set page for key/mode/layout
(`main-page-vm.ts:100`).

**Ruling: no change.** The cap stays, the toast stays, and nothing stores a
length the engine would refuse.

### F8 — the old overlays committed on RELEASE; Schwung's peek writes on the detent

Where the old pages had an overlay, scrolling it moved a *selection* and the
edit happened on release (`main-page.ts:99`, `clip-page.ts:82` — both say so in
their own comments). Schwung's peek is the opposite by design: *"the detent
ALREADY WROTE. The list is an ANSWER"* (`enum_list.mjs:11`), and its picker —
the commit-on-click half — is reached by holding and clicking, not by turning.

**Accepted as a divergence, with no work attached** (ruling 1, and the user's
own call on 2026-09-22: we do not change back to commit-on-release). Recorded
because it is the one behavioural difference in this pass that a user can feel
without being told:
turning past `Dorian` on the way to `Mixolydian` now writes `Dorian` in
passing. It is also why H2's rate matters more here than it would have under
the old pages — a scroll that writes every step is one a slower knob makes
safer.

### F7 — the two opt-in doors upstream already has

- `normalize()` is `{ ...raw, key }` (`param_meta.mjs:242`): an undeclared field
  survives onto the meta untouched. A per-param declaration is invisible to a
  module that does not write it.
- `createController(io)` defaults every optional hook inert
  (`page_controller.mjs:525-570`) — `isModulated`, `formatValue`, `loadCard`,
  whose own comment states the pattern: *"a module may declare card_script for
  years and nothing changes until a host offers to load it."*

Ruling 3 is therefore satisfiable with no conditional anywhere on the existing
draw path.

---

## Host-side work (movy)

### H1 — velocity draws Schwung's fader

Declare `viz: { kind: 'fader' }` on the `vel` cell in
`seq/step-params-contract.ts`. `param_meta` folds a `chain_params` `viz` field
straight through to the meta, and `viz.mjs collectDeclared` builds a single-key
group from it — Schwung's own `drawFader` (`viz_draw.mjs:1210`), no movy widget,
no registration, no upstream dependency.

Velocity is unipolar 0..127, which is what the fader draws honestly; the
detector's own "no negative minimum" rule (`viz.mjs:651`) is about detection and
does not gate a declaration.

### H2 — one knob rule for all three pages

**The rule, in the user's terms: 8 raw CC units = one step, on every cell of
these pages, with no acceleration.** "One step" means one enum option, one
velocity increment, one bpm, one percent, one semitone, one clip step.

Two halves, because the divisor upstream applies differs by kind:

1. **A per-slot accumulator in `schwung-page-input.ts`, for virtual components
   only.** Enum cells emit one Schwung detent per 2 raw units (× the
   `ENUM_DELTA_DIV = 4` upstream = 8 raw per option). Int cells emit one per 8.
   Remainders carry across events, the way `seq/detent.ts` already does — a
   truncated remainder is what made a movy knob move on one turn direction and
   not the other (`project_movy-knob-step-rules`).
2. **Each cell's declared `step` is set so one Schwung detent is one step**,
   checked against `perDetentStep` = `round(max(step, range × 0.01) × 0.5)`:

   | cell | range | declared step | per detent |
   | --- | --- | --- | --- |
   | step VEL | 0..127 | **8** (was 4) | 4 |
   | set TEMPO | 20..300 | 1 | 1 bpm |
   | set SWING | 50..80 | 1 | 1 % |
   | clip LENGTH | 1..64 | 1 | 1 step |
   | clip TRANSPOSE | -36..36 | 1 | 1 semitone |

   None of these ranges is ≤ 16, so `detentsPerStep`'s narrow-int branch (4
   detents per unit) never applies and the table is the whole rule.

Module pages keep today's feel: the accumulator is gated on
`isVirtualPageComponent`, so nothing outside these three contracts changes.

### H3 — MODE and LAYOUT step, direction-absolute

For a 2-option enum cell on a virtual component, the input layer writes the
option itself (CW → index 1, CCW → index 0) instead of calling `onKnobTurn`,
which is what `applyStepInvertOn(n > 0)` already did before delegation
(`step-edit.ts`). Deliberately narrow: LINK and INVERT keep the delegated path,
because `isSwitchMeta` already gives them exactly this behaviour.

This is a **stopgap with a named end**: U1 below is the general version, and
when it ships this code is deleted in favour of one declaration. The divergence
from pure delegation is two cells wide and written up here so the next reader
does not mistake it for a design position.

### H4 — units and readings through `formatValue`

The hook is already wired and already exercised (TRANSPOSE's `n/a`, TEMPO's
`EXT`). Add: swing `54%`, tempo `120 bpm` on the `header` surface only, clip
length `16 steps` on `header`. Cell surfaces stay bare where the box is 30px.

**Pairs with U3, and stands without it.** Once U3 ships, part 2 of it means the
cell draws exactly these strings in the big face; until then they read in the
header while the cell keeps Schwung's dial. Nothing here waits on the release.

### H5 — the peek's expiry asks for a frame

Pending F2's diagnosis: add the controller's live peek (`ctl.enumPeek()`, or its
presence as a boolean) to movy's page change signature (`src/app/tick.ts:321`),
so the frame in which the overlay comes down is actually drawn. Cheap — it is
one more term in a string join that already runs every tick.

If F2 proves the touch is what kills the peek, the remaining half is U2's
sibling and belongs upstream: a host cannot stop the controller from nulling its
own state on a touch it must keep forwarding.

---

## The upstream PR — one branch, every item opt-in

Ruling 3 is the acceptance bar: **with no declaration and no new io hook, every
fleet module draws and turns byte-identically.** Each item names its door, its
default, and the test that proves the default.

### U1 — a 2-option enum may step instead of toggle

- **Door:** per-param `turn: "absolute"` (declared in `chain_params` or inline).
- **Default:** absent → `isTwoWayMeta` toggles, exactly as today.
- **Why general:** a knob turn that lands on a value determined by *direction*
  is the behaviour every other enum on the device has; a module whose two
  options are a choice rather than an on/off (`Mix`/`Reverb`, `Saw`/`Square`)
  has no way to ask for it today.
- **File:** `knob_engine.mjs` (low churn).

### U2 — the peek may be suppressed when the box already says it

- **Door:** `io.enumPeek(key, meta) -> boolean | null`; null falls through.
- **Default:** no hook → raised as today.
- **Why general:** this is the rule `page_controller.mjs:3402-3420` *already*
  applies to `LAYOUT_LIST` ("a list row already prints the option in full, so
  the panel covers a legible answer with the same answer"), and its own comment
  records a device report about exactly that. The grid has the same case
  whenever `short_options` or a 3-char label fits.
- **File:** `page_controller.mjs` (98 commits/90d — file the ask small and
  early; see *Which upstream files move under an ask*).

### U3 — a param may declare that its value is drawn in the big face

**Not `display: "number"`** — the user's note, and F9 says why it would have
been a lie: the values that most want this cell are `50%`, `2:4`, `1/16`. The
door is therefore about the FACE, not about the type.

- **Door:** per-param `display: "big"`.
- **Default:** absent → the `COUNTED_WORDS` name match and the 24/48 span cap,
  exactly as today. No fleet module declares it, so no fleet cell moves.
- **Four parts, each additive:**
  1. `shouldDrawBigNumber` honours the declaration ahead of its name/span rules,
     and stops excluding `KIND_ENUM` **for a declaring param only** — the blanket
     `kind === KIND_ENUM` refusal stays for everything else.
  2. The cell draws the text the page already resolved (`short_options` →
     `options` → `formatValue` → `bigNumberText`), instead of recomputing it from
     the raw number. Undeclared params keep reaching `bigNumberText` unchanged.
  3. The atlas gains the glyphs those strings need — `%` `:` `/` `.` — taken from
     movy's `src/font/glyphs-big.ts`, the same MIT source the twelve already came
     from, so this is completing a vendoring rather than drawing new letterforms.
  4. `BIG_NUM_MAX_DIGITS`'s three-digit guard becomes a **measured width** guard
     (`fontWidth(text) <= cell width`), falling back to the ordinary widget when
     the string does not fit. Strictly safer than counting digits, which is a
     proxy for the same question, and it is what keeps a declared `Mixolydian`
     from smearing across its neighbour.
- **Why general:** `isCountedQuantity` already concedes the principle — some
  values are read, not aimed — but the only way in is a name the library happens
  to recognise, and the face can only spell integers. A ratio, a percentage, a
  note division and a two-character mode are the same shape and none of them can
  ask.
- **Covers:** set SWING (`50%`), clip LENGTH (`16`), step COND (`2:4`) — the
  "big font where we need it" asks across all three pages, which no other item
  in this bundle reaches.
- **Files:** `render_page_movy.mjs` (62 commits/90d), `font_big_num.mjs` (low
  churn).
- **Risk to ruling 3, named:** part 3 touches a shared atlas. It is additive —
  no existing glyph changes — and `test_big_number_font.sh` already asserts that
  the fleet emits nothing outside the declared set, so the sweep proves the
  claim rather than the diff having to.

### U4 — whatever F2 proves to be upstream

Held open deliberately. If the touch-clear is the cause, the ask is a hook or a
declaration that keeps a peek alive across the touch that raised it — written
once the device says so, not before.

### Carried, already written, unfiled

Folded into the same branch because they are additive and have been waiting:

- **SU-8** — `decorations[slot].automated`, beside `locked`. Additive field; no
  mark drawn unless a host sets it.
- **SU-11** — a per-key duration in the animation store, so `settled` ages out a
  value that never rests. Additive; absent = today's behaviour.
- **SU-13** — `io.feel` overrides for `SETPARAM_THROTTLE_MS` and the knob
  constants. Defaults are today's `export const` values, so an io without it is
  unchanged.

### Dropped from this PR

- **SU-6** — the 15-vs-16 widget band that offsets label rows by one row. It is
  a layout *correction*: it changes existing rendering by definition, and
  gating a bug fix behind a flag is worse than filing it separately. Stays in
  the ledger as its own cosmetic item.

---

## Non-goals

- Restoring movy's old cell styles as such (ruling 1). Where Schwung's native
  widget is merely *different*, it stays.
- Storing a step length the engine would refuse (F6).
- Restoring commit-on-release for the overlays (F8). Schwung's peek writes on
  the detent and that is what it stays; the ruling is the user's.
- Any change to how module pages feel or draw (H2's gate, ruling 3).
- Touching `off` mode. These pages' movy-renderer path is unchanged; SP-30/SP-41
  own its fate.

---

## Testing

Per `CLAUDE.md`, both tiers gate every code change here.

**Local (`npm test`, 0 failures required):**

- A logic check per contract change — the fader declaration resolving to a
  single-key group (extend the node probe in
  `browser-test/logic/step-params-source.mjs`), the `step` table in H2, the
  direction-absolute write in H3, each `formatValue` reading in H4.
- **Teeth, per the code-quality rule:** every fix is reverted individually and
  watched red before it is called covered. The harness's own `ok(label, cond)`
  trap is on record (`feedback_verify-teeth-and-baseline`) — assert the
  condition, not the label.
- New `page`-mode screenshot scenes for all three pages, reviewed at 8× by eye,
  never blessed blind.

**Device tier (`npm run test:device`)** as the gate, and it is where F2 is
settled: the diagnosis runs through the MIDI-inject harness with no manual
gestures (`feedback_automate-repro-infra`), reading the drawn page back rather
than trusting a sleep — the tick rate varies 63–205 Hz with load
(`movy-device-tick-rate`), so any fixed-sleep read of async state is a race.

**Upstream:** the PR carries a host test per item asserting the *default* — the
claim ruling 3 makes is the one a reviewer must be able to check mechanically.

---

## Risks

- **F2 is a diagnosis.** If the device refutes both candidate causes, H5 and U4
  are re-scoped and the overlay work does not land in this wave. Everything else
  is independent of it.
- **Churn.** U2 and U3 land in the two highest-churn files in the library; the
  ledger's own reading is that such asks are overtaken while they wait. Mitigated
  by filing early and keeping each item to one door.
- **H3 is a divergence.** Two cells stop going through `onKnobTurn`. Written up
  in the code with U1 named as its end, so it is deleted rather than inherited.
- **Release cadence.** Nothing upstream reaches the device until Schwung
  releases and movy's floor bumps (SP-16 is already waiting on #509). Every
  host-side item above is therefore designed to stand alone.

---

## Ledger items

To be opened in `docs/schwung-page-migration.md` when this lands: **SP-57**
(this alignment pass, host-side) and **SU-16…SU-19** for U1–U4, with SU-8/11/13
moved to "filed" once the branch exists.
