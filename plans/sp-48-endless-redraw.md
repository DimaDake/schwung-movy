# SP-48 — a modulated or `live` param the page shows keeps it redrawing forever

Release gate, order **7.5**. Ledger entry: `docs/schwung-page-migration.md` →
`### SP-48` (line 1116). The item this regresses: `### SP-38 ✅` (line 1797) —
same file, its measurement method is reused here rather than re-invented.
Branch `feat/sp-gate-items-40-51`.

**Planning only.** No source file is touched by this document; it is the spec
for the implementing agent.

---

## 1. The loop, with file:line evidence

### 1.1 What changes, every tick, for a modulated/live/automated key

Three different "reasons a value moves" all funnel into **one** cache flag,
one code path, one merge, one observer. This is not three bugs; it is one
predicate with three doors into it.

```
schwung/src/shared/param_pages/page_controller.mjs:2344
    s.modCache[key] = !!isModulated(fullKey(key)) || !!(_lm && _lm.live === true);
```

`isModulated` here is **movy's own injected function**
(`src/renderer/schwung-page-io.ts:51-76`), and it answers `true` for two
things movy conflates on purpose (SP-36, `schwung-page-io.ts:54-69`):

- a real chain-hosted LFO/macro target (`modulatedKeys()`, movy's own
  registry), and
- an **automation lane** (`auto.isAutomated(qualify(full))`) — a lane moves a
  parameter the same way an LFO does, so SP-36 reused the channel rather than
  opening a second one.

So `modCache[key]` is set for: a genuine LFO target, a `"live": true`
declared param, **or** an active automation lane. All three are
indistinguishable from here on.

Every tick, for every `modCache`-flagged key (one per tick,
`MOD_FAST_READS_PER_TICK = 1`, `page_controller.mjs:339`), the controller
re-reads the driven value:

```
schwung/src/shared/param_pages/page_controller.mjs:4136-4148  refreshModulatedValues()
    → reads "<key>:effective" (or falls back to the plain key), writes s.modValues[key]
```

`:effective` for an automated key is answered by movy's own io
(`schwung-page-io.ts:106-120`, `SUF_EFF`) as `read(bare)` — the plain port
read, which for a lane-driven param is the lane's own written value, changing
every tick the lane plays a step.

The renderer then **merges before it observes**:

```
schwung/src/shared/param_pages/render_page_movy.mjs:2441
    const liveValues = hasMod ? Object.assign({}, values, modValues) : values;
```

and the two animated widgets both draw from that merge, not from `values`
(the base) alone:

```
render_page_movy.mjs:2160   shown = liveRaw ?? raw          (enum path)
render_page_movy.mjs:1579   observeLanded(anim, "enumw:" + animKey, raw, shown, nowMs, ENUM_ANIM_MS)
render_page_movy.mjs:2516   drawVizGroup(ctx, ..., liveValues, metaIndex, o.anim, o.nowMs, ...)
viz_draw.mjs:1115           observeLanded(anim, "wave:" + key, values[key] /* = liveValues[key] */, "s"+shape, nowMs, WAVE_MORPH_MS)
```

`values[key]` inside `viz_draw.mjs` is the `liveValues` object passed in —
confirmed by reading the call site, not assumed from its name.

`drawArcKnob(ctx, kx, ky, normVal)` (`render_page_movy.mjs:1237`) takes no
`anim`/`nowMs` at all — the **only** reason a plain float knob is immune. It is
not because of anything in the `values`/`modValues` split; a float that
happened to be enum- or wave-shaped would animate exactly like the two above.

### 1.2 What `settled` compares, and why it never converges

```
schwung/src/shared/param_pages/anim_state.mjs:53-82   observe(state, key, value, now, durationMs=120)
```

stamps `since = now` **whenever `!Object.is(prev, value)`** — a plain
value-changed test, no rate limiting of its own.

```
anim_state.mjs:150-157   settled(state, now, durationMs=120)
    for (const since of state.since.values())
        if (now - since >= 0 && now - since < durationMs) return false;
    return true;
```

`settled` is "nothing was stamped in the last 120 ms". A key whose observed
value differs from the last one **again** inside every 120 ms window
re-stamps `since` before the previous stamp ages past the window, so the
`for` loop above never finds an entry old enough and `settled` never returns
`true`. The threshold is a **frequency** (~8 Hz), not "did this frame
change": a 10 Hz source retriggers inside 100 ms < 120 ms and never settles; a
2 Hz source (500 ms period) is quiet for stretches longer than 120 ms and
settles between changes.

`schwung-page-anim.ts:85` is where movy asks the question:

```
src/renderer/schwung-page-anim.ts:85
    if (animSettled && !animSettled(ctl.state && ctl.state.anim, nowMs)) return true;
```

and `src/app/page-poll.ts:134` is where the answer decides whether to ask for
another frame:

```
src/app/page-poll.ts:134
    if (!moved) moved = page.animating(Date.now());
```

`moved` here is already `false` — base `values` and page identity are both
unchanged, which is exactly the condition SP-38 built this branch for. The
loop that never breaks:

```
tick N:   owner.poll() refreshes modValues[key] from :effective (page_controller.mjs:4148)
          page.knobLevels() reads BASE values only → unchanged → moved stays false
          page.animating(now) walks anim.since → an entry is < 120ms old → true
          pollDrawnPage returns true → app/tick.ts:769 sets appState.dirty = true
tick N:   (later this tick) the view repaints → p.render() runs
          → drawEnumSquare/drawVizGroup observe the NEW liveValues[key]
          → it differs from the previous observation (the modulation moved again)
          → anim_state.observe() re-stamps since = now
tick N+1: repeat, forever
```

Nothing in this loop depends on how the value changed — LFO routing table,
`"live": true`, or an automation lane's per-step CC are three different
*writers*, but they write into the same `s.modValues[key]`, get merged into
the same `liveValues`, and are observed by the same two call sites.

## 2. One mechanism, not two — with the evidence, not an assumption

The briefing asks this explicitly, so it is answered explicitly: **a `live`
param and a modulated param fail by the same mechanism**, and so does an
automated one (SP-36's addition). The proof is that all three set the exact
same boolean at the exact same call site
(`page_controller.mjs:2344`, `s.modCache[key] = !!isModulated(...) ||
!!(_lm && _lm.live === true)`), all three are read back through the exact
same function (`refreshModulatedValues`, `:4136`), and there is no branch
anywhere in `render_page_movy.mjs` or `viz_draw.mjs` that treats a `live`-only
key differently from an LFO-modulated one or an automated one — `hasMod` at
`render_page_movy.mjs:2441` is a single boolean over one merged object. The
only axis that matters is **rate**, not **source**: whichever of the three
writes `modValues[key]` faster than ~8 Hz drives the same `observe()` call at
the same frequency and the same `settled()` never returns `true`. A fix aimed
at "the modulation case" that special-cased `isModulated` and missed `live`
(or vice versa) would leave the other door open; the fix below is keyed on
the shared *symptom* (`page.animating()` staying `true` past a grace period),
not on any one door, so it closes all three without having to enumerate them.

## 3. Chosen fix: a movy-side repaint cap, not the upstream route

**Rule 1 applies:** `../schwung` is a reference checkout, never patched. The
ledger's SU-11 (`docs/schwung-page-migration.md:188`) names the correct fix —
a per-key `durationMs` in the animation store so a key that never rests still
ages out once its own declared transition duration has elapsed, rather than
being compared against a single global 120 ms window forever. That is a
`schwung` change. It is filed as an **upstream ask** (§3.3 below), not built
here, and it is the reason the SP-48 ledger entry itself calls the upstream
route "preferred" — an agent picking the fallback should not read that as the
upstream route being wrong, only as it being unavailable inside this repo's
own gates.

### 3.1 The mechanism: escalate, then cap — not a flat throttle

The ledger's own sketch of the fallback ("the animating term asks for a frame
at most once per N ms") is a flat cap on *every* `animating()`-driven repaint.
Applied naively that throttles the three real one-shot transitions SP-38 was
built to fix (`ENUM_ANIM_MS=120`, `WAVE_MORPH_MS=100`,
`BTN_PRESS_MS=120`/`BTN_FLASH_MS=300` — all four constants read from
`render_page_movy.mjs:735,1358,1359` and `viz_draw.mjs:1033`) — a genuine
enum-width tween or trigger flash would visibly stutter, which is exactly the
regression SP-38 fixed, reintroduced by its own fallback fix.

The design here instead **escalates only once a page has been asking for a
frame, for animation reasons alone, longer than any real transition could
ever run**:

- `ANIM_GRACE_MS = 500` — comfortably above `BTN_FLASH_MS = 300`, the longest
  of the four constants, with margin. No real one-shot transition in the
  current widget set can still be "moving" 500 ms after it started, so this
  window is provably never entered by a legitimate animation; it exists
  purely to catch a `settled()` that never returns `true`.
- `REPAINT_CAP_MS = 200` — once the grace period has elapsed, a frame is
  asked for at most once per 200 ms (5 Hz) instead of every tick, until
  `page.animating()` reports `false` again (at which point the escalation
  resets — a modulation source that stops is not held to the cap on its next
  genuine transition).

This means: **zero behavioural change to anything SP-38 already fixed**
(every real transition finishes inside the grace window and is never
throttled), and a permanently-redrawing page degrades from the tick rate
(~190 Hz on device) to 5 Hz instead of running forever at full rate.

### 3.2 Where it lives: `src/app/repaint-cap.ts` (new, testable in isolation)

Split out for the same reason `schwung-page-anim.ts` was split out of
`schwung-page.ts` (SP-38): it is the one part of the decision that needs its
own tests without booting a real page, and `page-poll.ts` is already at 136
lines against a 200-line hard cap — this addition would push it over.

```ts
/* repaint-cap.ts — once "is anything still animating?" has said yes for
 * longer than any real transition can run, stop asking every tick and ask
 * on a bounded schedule instead. Pure given `now`, so it is tested without a
 * real page, a real anim store, or a real clock. See SP-48.
 */
export const ANIM_GRACE_MS = 500;   // > BTN_FLASH_MS (300, the longest known transition)
export const REPAINT_CAP_MS = 200;  // degrades to 5 Hz once past the grace window

export function createRepaintCap(graceMs = ANIM_GRACE_MS, capMs = REPAINT_CAP_MS) {
    let since = -1;      // when the CURRENT animating streak started, or -1
    let lastFrame = -1;  // last tick this cap itself allowed through

    /** `animating`: page.animating(now)'s answer this tick. `now`: the same
     *  clock the caller already has (movy's Date.now(), or a synthetic one
     *  in tests). Returns whether THIS predicate alone should ask for a frame. */
    return function repaintCap(animating: boolean, now: number): boolean {
        if (!animating) { since = -1; return false; }
        if (since < 0) since = now;
        if (now - since <= graceMs) return true;          // unthrottled: SP-38's behaviour
        if (now - lastFrame < capMs) return false;         // capped: bounded, not zero
        lastFrame = now;
        return true;
    };
}
```

Wiring into `src/app/page-poll.ts` (the one call site, `:134`):

```ts
import { createRepaintCap } from './repaint-cap.js';
const animCap = createRepaintCap();
// ...
if (!moved) moved = animCap(page.animating(Date.now()), Date.now());
```

`animCap` is module-level, same lifetime as the existing `levels`/`lastKey`
module state in the same file — there is one drawn page on screen at a time,
so one instance is correct, not a shortcut. It self-resets when
`page.animating()` goes false, so no explicit reset is needed at the
`lastKey`-changes branches: a page/identity change already makes `moved` true
from the key-diff check before `animCap` is ever asked, and the grace clock
naturally restarts cold on the new page's own first `animating()` call
(`since` starts at -1 for a page nobody has escalated yet).

### 3.3 The rejected alternative, and the upstream ask filed alongside

**Rejected as the sole fix:** SU-11 (per-key duration aging). It is the
architecturally correct answer — `settled()` would then be asking "has *this*
transition outlived its own declared budget", not "was anything stamped in
the last constant 120 ms" — but it requires editing
`schwung/src/shared/param_pages/anim_state.mjs`, which rule 1 forbids from
this repo. It is not blocked on review to ship the movy-side fix: the two are
independent, and the movy-side cap makes no assumption that survives the
upstream fix landing later (the cap simply stops mattering once `settled()`
ages a never-resting key out on its own, because `page.animating()` then
returns `false` on its own schedule and `animCap`'s grace window is never
entered).

**Upstream ask, ready to file as SU-11's PR description** (same shape as
SU-14's, `docs/schwung-page-migration.md:191` — fork branch, PR opened in
parallel, not waited on):

> `anim_state.observe(state, key, value, now, durationMs)` already receives
> `durationMs` per call and could stash it in `state.since` alongside the
> timestamp (a second parallel map, or a `{since, durationMs}` pair per key).
> `settled(state, now)` would then compare `now - since` against **that
> key's own** `durationMs` instead of its own hardcoded default, so a key
> re-triggered every 50 ms with a 120 ms `durationMs` still reports settled
> once 120 ms have passed *since its last observed stamp that hasn't itself
> expired* — practically: age each entry out once `now - since >= durationMs`
> regardless of how many times `observe()` has re-stamped it in between, by
> tracking the FIRST stamp of the current unbroken run rather than the last.
> This is the same shape as `WAVE_MORPH_MS` (100) already disagreeing with
> the 120 ms window `settled` uses for everything (SP-38's own recorded
> loss) — one per-key number instead of one global one closes both gaps at
> once.

Filing the actual PR (fork branch + open PR, per rule 2) is **not** required
to close this gate item — the movy-side cap is what closes it. Note in the
ledger (§6 below) that the ask exists and is unfiled, exactly as SU-9/SU-10/
SU-12/SU-13 are recorded today without a branch yet existing.

## 4. The cost claim, and what will (and will not) be measured

**Primary evidence: a local redraw-count proxy, always available.** Drive
`repaintCap` (or, end to end, `pollDrawnPage` with an injectable clock — see
§5) with a synthetic clock across a simulated multi-second span while
`page.animating()` answers `true` throughout. Count how many calls return
`true`:

- **Before the fix:** every call — `page.animating(Date.now())` is returned
  unchanged, so N ticks over the span all ask for a frame.
- **After the fix:** `ceil(graceMs / tickPeriod)` ticks during the grace
  window, then roughly one call in every `capMs / tickPeriod` thereafter.

This is read back from the test itself, not asserted from memory, and it is
the number that actually gates §6's "closes when" — no device is needed for
it (matching the ledger's own closure clause for this item, "this is a local
test, not a device one").

**Derived, not measured, estimate of the steady-state `render` cost.** SP-38
measured the animating window at **0.7 ms/tick of `render`** on plaits — and
recorded, emphatically, that plaits (2 pages, the smallest shape in the
fixture) is a **floor, not a representative**, and that the same probe found
**no animating window on minijv at all** (SP-39). This plan does not
manufacture a number the source data cannot support: taking the 0.7 ms/tick
floor and the `REPAINT_CAP_MS = 200` cap against a ~5.3 ms device tick period
(`SP-38`'s own idle `tick_ms` median), the fix reduces the *floor's* steady
state from **0.7 ms on every tick, forever**, to **0.7 ms roughly once every
38 ticks** — call it ≈0.02 ms/tick averaged. This is arithmetic on SP-38's
own recorded number, not a new device reading, and it inherits every one of
SP-38's caveats (plaits floor, n=1 window, 1 ms clock granularity, unscaled
to a large module). State it as a derived bound in the ledger, not as a
measured result.

**Optional, best-effort device confirmation — not required to close the
item.** If an implementing agent has device time, `scripts/measure-grid-cost.sh`
can be re-run on `plaits` (SP-38's own module, so the numbers are directly
comparable) with a new `SECTIONS` value that holds a real modulation route
active for the whole probe window rather than one flick — e.g. assign an LFO
to `engine` (plaits' one `"type": "enum"` param, `src/modules/plaits.json:9`)
at a rate ≥ 10 Hz via the existing chain-modulation test helpers, and diff
`render`'s ms/tick before vs after this fix with the route left running for
the whole window. This would confirm the direction (bounded vs unbounded) on
real hardware, but it is optional: the local test in §5 is what the ledger's
own closure clause asks for, and a device run here would still only be
plaits — it could not stand in for a large-module number any more than
SP-38's or SP-39's could, so do not let it be reported as "the cost on a
representative page."

## 5. The local test, with teeth

Home: `browser-test/logic/page-freshness.mjs`, alongside the existing
"SP-38 — the repaint decision while a widget is moving" block — the file the
ledger's own closure clause names, and the file this whole subsystem's tests
already live in. Two additions, in order.

### 5.1 Unit-level: `repaintCap` in isolation (no schwung, no model, no device)

This does not need `schwungLibAvailable()` at all — `repaintCap` has no
Schwung dependency — so it runs unconditionally, which is the cheapest
possible level for this bug (a synchronous state machine over one boolean
and one clock):

```js
import { createRepaintCap } from '../../dist/esm/app/repaint-cap.js';

_log('\nTest: SP-48 — a never-settling animation is capped, not forever-repainted');
{
    const cap = createRepaintCap(500, 200);   // same defaults, spelled out for the reader
    // Synthetic clock: `animating()` says true at every one of these instants,
    // simulating a modulated/live/automated key that never lets `settled()` win.
    const asked = [0, 100, 200, 300, 400, 500, 501, 600, 700, 701, 800, 900, 901]
        .map((t) => cap(true, t));

    // Grace window (<=500ms): every call passes through unthrottled — this is
    // the SAME behaviour as before the fix, i.e. zero regression risk for a
    // real transition, which never runs anywhere near this long.
    eq('every ask inside the grace window is let through',
       asked.slice(0, 6).every(Boolean), true);

    // Past the grace window: bounded, not continuous. 501 is the first ask
    // AFTER the cap engages and it is allowed (nothing capped it yet); 600 is
    // <200ms after 501 and must NOT be let through; 700/701/800/900/901 give
    // three more `capMs`-spaced windows and only the FIRST ask in each is true.
    eq('501 (just past grace) still asks once', asked[6], true);
    eq('600 is inside the same 200ms cap window and is refused', asked[7], false);
    eq('700 is a fresh cap window and asks again', asked[8], true);
    eq('701 is inside 700''s cap window and is refused', asked[9], false);

    // THE TEETH: remove the fix (asked = ts.map(() => true), i.e. `if (!moved)
    // moved = page.animating(Date.now())` restored) and this is what reddens —
    // every one of the "refused" assertions above, because an un-capped
    // predicate answers true for every entry in the array.
    const stillAnimating = cap(true, 5000);
    ok('a source still animating far past the window keeps asking, at the cap rate',
       stillAnimating);

    // Recovery: once `animating()` reports false, the next TRUE starts a fresh
    // grace window rather than being permanently capped — a real animation
    // that starts after a long-stuck one is not punished for the page's past.
    cap(false, 5001);
    eq('animating() going false resets the escalation',
       cap(true, 5002), true);
}
```

(The literal timestamps above are illustrative; the implementing agent should
compute the boundary values from `ANIM_GRACE_MS`/`REPAINT_CAP_MS` rather than
hardcode 500/200 twice, so a later constant change does not silently
desynchronise the test from the code — e.g. import the constants themselves.)

**Teeth, stated per rule 4:** reverting `page-poll.ts:134` to
`if (!moved) moved = page.animating(Date.now());` (no cap) makes `600`,
`701`, and `900`'s "refused" assertions above **all** read `true` instead of
`false` — three of the six new `eq`/`ok` checks redden immediately, with the
grace-window checks staying green (proving the test discriminates the fix
from a broken-but-passing stub, not just from total removal).

### 5.2 Integration-level: `pollDrawnPage` actually calls the cap

The unit test above proves the cap's own logic; this proves the wiring —
that `page-poll.ts` really asks `repaintCap`, not that a parallel
implementation exists unreachable from the real call site. `pollDrawnPage`
needs one additive change for this to be testable without real sleeps: an
optional clock parameter, default `Date.now`, so a test can drive it with a
synthetic sequence exactly as `stampAt` already drives `anim.since` in the
existing SP-38 block two tests above this one:

```ts
export function pollDrawnPage(owner: PageOwner, nowFn: () => number = Date.now): boolean
```

(`app/tick.ts:769`'s call site is unchanged — the default keeps every
existing caller byte-identical.) Then, reusing the existing SP-38 block's
`test_enum` fixture and `pageOwnerOf`/`owner.page` (`page-freshness.mjs:169-184`),
stub `page.animating` to always answer `true` (bypassing the real
`anim_state` timing entirely — that channel is already covered by the
existing SP-38 block immediately above this one) and drive `nowFn` with the
same synthetic sequence as §5.1, asserting `pollDrawnPage(owner, nowFn)`
matches `repaintCap`'s own answers one-for-one. This is the check that a
regression in the *wiring* (someone "fixes" a different bug by deleting the
`animCap(...)` call and inlining `page.animating(Date.now())` again) is
caught even though §5.1's unit test still passes.

### 5.3 What is deliberately not re-tested here

The existing SP-38 block (`page-freshness.mjs:161-259`) already proves the
real `anim_state`/`settled` integration — a still page asks for no frame, a
render feeds the store, a trigger bang asks for a frame. None of that is
touched by this fix and none of it needs re-asserting; §5.1/§5.2 add exactly
the one thing that block cannot show, because it never runs the clock past
120 ms: what happens when `settled()` never returns `true` at all.

## 6. Ordered steps for the implementing agent

1. Read `src/app/page-poll.ts` and `src/renderer/schwung-page-anim.ts` in
   full (both are short) before touching either — the comments in both
   explain invariants this fix must not break (the `!page` early return, the
   `key !== lastKey` identity check, the "ALREADY PAST" first-sighting rule).
2. Create `src/app/repaint-cap.ts` per §3.2. Keep it under the 100-line
   target — it is one function and two constants; the header comment
   explains WHY the grace window exists (so it is not "optimised away" by a
   later pass that reads it as dead slack).
3. Wire it into `src/app/page-poll.ts:134` per §3.2, and give
   `pollDrawnPage` the optional `nowFn` parameter per §5.2 (default
   `Date.now`, so no existing caller changes).
4. Add §5.1 (unit) and §5.2 (integration) to
   `browser-test/logic/page-freshness.mjs`, after the existing SP-38 block.
   Run `node browser-test/logic.mjs` alone first to confirm both new blocks
   pass, then remove the fix exactly as described in §5.1's teeth paragraph
   and confirm the specific three assertions redden — not a full-suite
   failure count, the *named* checks — then restore it.
5. Run the full local gate from `movy/`:
   ```bash
   SCHWUNG=../schwung npm test
   SCHWUNG=../schwung node browser-test/page-mode.mjs
   ```
   `npm test` must be 0 failures; `page-mode.mjs` must still read
   **3 of 3** (this change touches no page-plan behaviour, so the count must
   not move in either direction — a shrink here would be a false signal, not
   a win). No `engine/` change, so `cargo test` is not required. No
   screenshot-visible change (the cap only changes *how often* an animation
   already drawn is redrawn, never *what* is drawn), so `screenshot.mjs`
   baselines are not expected to move — run it anyway and treat any diff as a
   signal something else regressed, not as an update to accept.
6. Skip the device tier for this item specifically only if it is genuinely
   unreachable (report DEVICE OFFLINE in caps per the standing rule); this is
   a release-gate item so do not skip it by choice. The device tier's own
   scenarios do not construct a sustained modulation route, so a green
   `npm run test:device` here is confirming no regression elsewhere, not
   confirming the fix — say that in the report rather than implying the
   device tier validated the cap.
7. Optionally, per §4's "optional, best-effort" paragraph, re-run
   `scripts/measure-grid-cost.sh page` on plaits with a sustained-modulation
   section if device time allows. Not required to close the item.
8. Update the ledger (`docs/schwung-page-migration.md`):
   - Move SP-48 from Open to Done, with the fix location
     (`src/app/repaint-cap.ts`, `src/app/page-poll.ts`), the teeth evidence
     from §5.1 (what reddened, how much), and the derived cost bound from §4
     labelled as derived, not measured.
   - Update SU-11's row (currently "new, conditional... the alternative is a
     movy-side repaint cap") to record that the fallback shipped and the
     upstream ask (§3.3) is written but **not yet filed** as a PR — same
     wording pattern as SU-9/SU-10/SU-12/SU-13's "new" rows, not SU-14's
     "FILED" wording, until a branch actually exists.
   - Note explicitly, next to SP-47's row, that the release-gate condition
     ("the flag must not go out with this open") is now satisfied, so SP-47
     no longer needs to record an explicit acceptance for this specific
     defect.
9. Docs (`MANUAL.md`/`README.md`): **not required.** This is a perf/behaviour
   fix with no user-visible change — a modulated widget still animates
   exactly as before; only how often movy asks Schwung to redraw it changes,
   and the row is still internal (`off` default, SP-47 is the opt-in). Same
   reasoning SP-38 itself recorded for the identical question.
10. Commit only the files this item touches
    (`src/app/repaint-cap.ts`, `src/app/page-poll.ts`,
    `browser-test/logic/page-freshness.mjs`,
    `docs/schwung-page-migration.md`) — never `git add -A`.

## 7. What this plan does not cover

- Filing the actual SU-11 PR against `schwung` — the ask text in §3.3 is
  ready to paste into one, but opening the fork branch and PR is left to
  whoever picks that up next (or the same agent, at their discretion; it is
  not gated on this item closing).
- A device-measured cost number on a large module — nobody has one for SP-38
  either (SP-39 tried and found no animating window on minijv at all), and
  manufacturing one here would contradict the ledger's own standing caveat.
- Any change to `anim_state.mjs`'s semantics, `ENUM_ANIM_MS`,
  `WAVE_MORPH_MS`, or any other Schwung-side constant — all read-only inputs
  to this fix, never edited (rule 1).
