# SP-38 — nothing animates, because movy never asks for the next frame

Gate item #3 of five. Ledger entry: `docs/schwung-page-migration.md` → `### SP-38`.
Branch `feat/sp-35-38-gate-items`, base `fff4f25`.

## 1. Reproduction

Under `schwunggrid = page`, Schwung's animated widgets move **once** and then
freeze. The widgets that animate at all, read from the library rather than
recalled (all of these are upstream, hand-verified below):

| widget | file:line | what it animates | duration |
| --- | --- | --- | --- |
| enum square | `render_page_movy.mjs:1579` | the square's FRAME width, `enumw:<key>` | `ENUM_ANIM_MS = 120` |
| waveform morph | `viz_draw.mjs:1115` | the shape blend, `wave:<key>` | `WAVE_MORPH_MS = 100` |
| switch fill | `viz_draw.mjs:1380` | **nothing** — `drawSwitch(…, _anim, _nowMs)`, both unused | — |
| trigger bang | `render_page_movy.mjs:1455` `buttonPhase` | cap travel + radiating stubs | `BTN_FLASH_MS = 300` |

The switch does not need frames (it is drawn from the value, which is why a
value change is enough for it). The other three are time-driven.

**Why the frame never comes.** The renderer is pure and time is passed in:
`o.anim` and `o.nowMs` come from the controller, which does supply both
(`page_controller.mjs:4345-4346`, `anim: s.anim`, `nowMs: now()`). So the store
IS fed and the clock IS right. What is missing is the NEXT call: movy's
`app/page-poll.ts:pollDrawnPage` repaints only when a drawn cell's **value** or
the page **identity** moved. A widget mid-morph changes neither. Result: one
frame at the instant of the change, then a frozen halfway state for the rest of
the transition.

Reproduce with no device, in `browser-test/logic/page-freshness.mjs` (§5).

## 2. Where the ledger's claims needed correcting

Both corrections are recorded here rather than coded around.

**(a) The store is already wired; only `settled` is missing.** The entry says
"add `anim_state.mjs` to `schwung-lib.ts`'s import list", which implied the store
was unavailable. It is not: `page_controller.mjs:593` calls `createAnimState()`
and `:4345` passes it, and the device's installed copy is the same file
(`grep -c "anim: s.anim"` on `/data/UserData/schwung/shared/param_pages/
page_controller.mjs` → `1`, host 1.4.0). `anim_state.mjs` is still added to
`schwung-lib.ts`, but for the **predicate** `settled()` — movy never needed to
build the store.

**(b) `ctl.onCanvasPage` needs NO redraw wiring, and wiring it would be pure
cost.** The entry asks for it to be verified against the library before
building. Verified, and it fails on both halves:

- movy supplies no `io.drawCanvasPage`: `grep -rn "drawCanvasPage" src/` → no
  hits. `page_controller.mjs:4534` is `if (typeof io.drawCanvasPage !==
  "function") return;`, so under movy a canvas page's body draws **nothing**.
- no module in the fleet declares one: `grep -c '"as_page"' docs/module-dump/
  device-dump.json` → `0` (95 modules). `page_plan.mjs:473-486` only makes a
  canvas PAGE when a `canvas` param sets `as_page`; without it the param is a
  cell you click.

So `ctl.onCanvasPage()` is true on no page movy can show, and on a page that did
set it the redraw would cost a full render per tick forever and change zero
pixels. **Not wired.** That is the `off` half of the acceptance bar (a movy
extension lost is not a regression) and it is reversible in one line if SP-24
ever gives movy a canvas body drawer.

## 3. Design

One question, asked once per tick, from the site that already decides the
repaint: **is the drawn page still moving?**

```
src/renderer/schwung-lib.ts    + settled  (anim_state.mjs)
                               + buttonPhase (render_page_movy.mjs — already imported)
src/renderer/schwung-page.ts   + animating(nowMs) on SchwungPage
src/app/page-poll.ts           + `if (!moved) moved = page.animating(nowMs)`
```

`animating(nowMs)` answers two questions and only two:

1. `!settled(ctl.state.anim, nowMs)` — a widget transition is in flight.
   `anim_state.mjs:150` scans the `since` map for any entry younger than the
   duration. **An idle page's map is empty after the first render**, because
   `observe` stamps a first sighting as *already past* (line 63) — so an idle
   page iterates zero entries, which is what keeps the idle cost where SP-13
   left it.
2. the trigger bang. `ctl.triggerFiredAt[key]` is a list of press times and
   `buttonPhase` is the ONE definition of how long a bang draws for, so movy
   asks that function rather than restating `BTN_FLASH_MS`. Bounded work: the
   map holds only keys that have fired, and the check takes the newest stamp
   first so the common (nothing flashing) case allocates nothing.

It is `ctl.state.anim` and `ctl.triggerFiredAt` — both already public on the
controller (`page_controller.mjs:5046`, `:5078`) — reached through the binding
(`schwung-page.ts`) so `page-poll.ts` never touches `ctl`.

**Ordering is already right and needs no change.** `poll` runs before the render
in the tick (`app/tick.ts:758` then `:855`), so on the tick the value changes the
poll answers "moved" on the value alone and the render records the transition
*after*; every later tick is answered by `animating()` until it settles.

**Clock.** `page-poll.ts` uses `Date.now()`, which is what the controller uses
(`page_controller.mjs:571`, `const now = io.now || (() => Date.now())` and movy
passes no `io.now`). The two must be the same clock or the transition never
appears to end; if movy ever injects `io.now` this must be re-pointed, and that
is why it is said here rather than left implicit.

**Nothing else changes.** No new host calls, no change to what any render draws,
no change to the delegated/non-delegated gate, and the assignment is inside the
`!moved` branch so a page whose values are moving is answered exactly as before.

## 4. Files

- `src/renderer/schwung-lib.ts` — `settled`, `buttonPhase` on the lib interface.
- `src/renderer/schwung-page.ts` — `animating(nowMs)` + interface line.
- `src/app/page-poll.ts` — the one new term in the repaint decision.
- `browser-test/logic/page-freshness.mjs` — the new section (§5).
- `browser-test/app-loop.mjs` — the integration half (§5).
- `scripts/measure-grid-cost.sh` — also emit `perf_phase` (the entry's required
  measurement is `perf_phase`; the script read `perf_ipc` only).
- `docs/schwung-page-migration.md` — closure.

## 5. Tests, and their teeth

**T1 — the policy.** `browser-test/logic/page-freshness.mjs`, new section.
Fixture `MOCK_SYNTHS.test_enum`: knob 0 is `mode`, a 4-option enum, so a real
render feeds the store (that is the wiring claim — `anim.prev.size > 0` after a
render). Then:

- poll to a stable state (twice, so `lastKey`/`levels` are primed and the answer
  is `false`);
- change `synth:mode`, poll until the value arrives → `true` (the value moved);
- render — as the tick does on that `true`;
- place the transition's start at *now* (the suite cannot spend 120 ms of wall
  clock; it sets the instant `settled()` reads, which is the input and not the
  logic) → poll → **must be `true`**. ← TEETH
- place it 1 s in the past → poll → **must be `false`** ("none after").

The placement is the only simulated input, and it is upstream's own field: the
elapsed time is `anim_state.mjs`'s semantics, which movy does not implement.

**T2 — the trigger bang.** Same section, second phase: stamp `ctl.triggerFiredAt`
(a key, `[now]`), poll → `true`; stamp `[now - 1000]` → poll → `false`. Teeth:
remove the bang term and the first assertion reddens.

**T3 — frames, end to end.** `browser-test/app-loop.mjs`. Wrap
`owner().page.render` and count frames across ticks. On a `page`-arm fixture:
write a value the drawn page reads, `advance()` ticks, and require **more than
one** frame (one is what the value change alone buys, and is the bug). Then place
every store stamp 1 s in the past, `advance()` the same number of ticks, and
require **zero** further frames. Teeth: without `animating()` the first count is
1.

Red/green evidence for each is the removal-and-rerun in §7.

## 6. Measurement (device, `perf_phase`)

Instrument: `scripts/measure-grid-cost.sh`, extended to also emit `perf_phase`
(it already selects the arm by writing `prefs.flags.schwunggrid`, reopens movy
and refuses to measure a page that is not the drawn one).

- **Module: `plaits`** — already loaded on the device, and knob 0 is `engine`, an
  enum whose options run "VA VCF" / "Phase Dist" / "6-Op I" / "Wave Terr" /
  "Str Mach" / "Chiptune" — widths that differ, so every detent retargets the
  enum square and starts a 120 ms transition. Same module, same arm, both runs.
- **Arm:** `page` (`schwunggrid = 2`), written by the script and read back by its
  own preflight (`schwung-body ok track=0 ck=synth pages=…`).
- **Numbers, all per tick, averaged over a `perf_ipc` window (120 ticks):**
  `perf_phase render=`, `perf_ipc tick_ms=` / `period_ms=` / `calls/tick`.
- **Sections used:** `idle` (nothing moving → must be unchanged) and `knob`
  (30 detents each way → the animating window).

Run **before** the change (HEAD build) and **after**, on the same page and
module, and put `render=` (idle / knob) and `tick_ms` (idle / knob) in the
ledger. `calls/tick` must be unchanged in both — the fix adds no host call.

## 7. Closure evidence

- `SCHWUNG=../schwung npm test` → 0 failures.
- `SCHWUNG=../schwung node browser-test/page-mode.mjs` → `N of 3`, N not grown.
- the device tier with `prefs.flags.schwunggrid` at `off`, then restored to `2`.
- the red/green pair for T1/T2/T3.
- the before/after device numbers.
- screenshot baselines: **expected unchanged** (no renderer or pixel change).
  Any scene that does move is a flake by construction and is reported, not
  blanket-`--update`d.

## 8. As built — where this plan was wrong

Written after the work. Two corrections and one that cost a whole debugging
session; all three are evidence, not bookkeeping.

**(a) §2(b) was right about the conclusion and wrong about the reason.**
`onCanvasPage` is not merely unreachable — it is not a redraw source at all:
`page_controller.mjs:4572` is `!!(page().canvas)`, a pure PREDICATE, with **no
callers anywhere in `schwung/src`**. The two facts in the plan (no drawer in
movy, no `as_page` in 95 modules) are both confirmed by re-running the greps,
and they are the stronger reason. The library's comment on `drawCanvasPageBody`
— "a custom page is redrawn every tick precisely so it can show a live value
move" — means this is a real redraw source the day SP-24 gives movy a canvas
drawer, so it is recorded in the ledger rather than dropped.

**(b) T3's fixture was wrong in a way that made a correct fix look broken.**
The block drove `mode` `0`→`2` and required more than one frame. It failed with
`1 frames over 1 ticks` against a fix that was working. A temporary
`console.log` in `src/app/page-poll.ts` showed `moved=true lv0=0.666` on the tick
the value arrived, so the decision was right and the FRAMES were what was
missing — which pointed at the fixture, not the fix. The cause is
`drawEnumSquare` (`render_page_movy.mjs:1565`): the animated quantity is
`enumSquareWidth(text)` — a **pixel width**, not the option index — and `mode`
`0`→`2` is "LP"→"HP", **the same width**. `observe` saw no change, nothing was
stamped, and `animating()` was correctly false. `0`→`3` ("LP"→"Notch", 17 px →
the 28 px cap) is the transition the widget actually has. **The lesson is
general and is written into the test's own comment: a fixture for an animated
widget has to change the thing the widget animates, not merely the value.**

**(c) T1 was restructured because the first version was a wall-clock race.**
The plan had the suite "poll to a stable state", which does not work: the store
holds first sightings stamped `now - durationMs`, `settled`'s implicit window is
120 ms and `WAVE_MORPH_MS` is 100, so the page legitimately reads "moving" for
~20 ms after a render while the harness runs 60 ticks in ~18 ms. The suite now
**places** the stamps (`anim.since.set(k, t)`) rather than waiting on them, which
is the same input `settled` reads and is upstream's own field, and it asserts the
arrival rule structurally (`every(t => Date.now() - t > 0)`) instead of by
timing. T2 and T3 survived as planned apart from the fixture in (b) and a 10 s
(rather than 1 s) placement.

## 9. Not covered / left alone

- SP-36 (the automation dot, the jumping arc), SP-39, SP-31, SP-37 — out of
  scope; anything SP-36-shaped is a ledger note.
- `drawSwitch` does not animate (verified above); the reporter's "switch fills"
  is the value change, which is already framed correctly.
- A key whose read value changes representation on every read would keep the
  store permanently unsettled and the page permanently redrawing. That is
  upstream's `observe` semantics and the same on Schwung's own host (which
  redraws unconditionally), so it cannot be a regression against the bar — but
  it is the one way this change can cost more than it should, and it is written
  into the ledger as not-covered.
