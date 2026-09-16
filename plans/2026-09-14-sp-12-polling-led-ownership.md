# SP-12 — polling + LED ownership

**Item:** `tick.ts` stops `refreshOneParam` and `updateKnobLEDs` for a delegated
component. Ledger: `docs/schwung-page-migration.md`. Design: §3 / §6 of
`docs/superpowers/specs/2026-09-13-schwung-page-migration-design.md`.

**Predecessor evidence (SP-11, 2026-09-14, `c7a1335`).** No input path polls any
more; `owner.poll()` has exactly one caller left to gain (`tick.ts`);
`owner.delegated` is the proven gate; `owner.knobParamInfo` is what the LED ring
must ask. Burn-down stands at **6 of 6**.

**Successor:** SP-13 re-measures the per-tick cost against the 2026-09-13 A/B
baseline. This item is what it measures.

---

## 1. What is actually wrong today

Under `page` both readers run on one page. Two separate defects:

1. **`refreshOneParam` still runs for a delegated component.** It lives in
   `model/tick.ts:142-147`, reached through `activeModel.tick()`
   (`app/tick.ts:593`). On a movy chain it is a bulk engine round trip of 16
   keys every `REFRESH_BULK_TICKS`; on a host slot one read per tick. Every one
   of those reads is of a page nobody is drawing.
2. **`updateKnobLEDs(vm)` lights movy's parameters, not the drawn ones**
   (`app/tick.ts:753` VIEW_KNOBS, `:781` VIEW_CHAIN). This is symptom 5 of
   design §3 — "knob LED rings show movy's parameter, not the drawn one".

## 2. The hazard this item must not create

**LED ownership is load-bearing** (memory: *Movy LED Ownership*). Suppressing
movy's LED work must not leave the row stale, wrong, or driven by nobody.

Schwung's `param_pages` does ship `knob_leds.mjs`, but **its only caller is
`shadow_ui_param_pages.mjs`** — the shadow UI's own host, not the controller.
An embedder gets no LED writes from `createController`. So:

> **The delegated page supplies the VALUES; movy's `knob-leds.ts` stays the one
> WRITER.** The diff cache (`lastKnobColor`) and the frame LED budget
> (`ledBudgetTake`) are movy's, and two writers on eight LEDs is precisely how
> a knob ends up claiming a colour it no longer shows.

The normalisation rule is **not** re-implemented: `normalizedOf` is imported
from `render_page_movy.mjs`, which `page_controller.mjs` itself imports by name
— so it exists wherever the library loads at all.

## 3. The second-order defect, and it is the real work

`refreshOneParam` sets `s.dirty = true` unconditionally. **That is what has been
driving movy's repaint cadence**, and the repaint is what calls
`schwungBodyFor()`, which is the only thing that calls `owner.poll()`. Stop the
refresh naively and the chain is:

```
no refresh → model never dirty → no frame → no poll → the page never reads →
its values freeze → nothing ever dirties → dead page, dark-or-stale LEDs
```

So SP-12 is three changes, not one:

- the poll leaves the render branch and runs **once per tick**, and
- the delegated page's own drawn values become the **repaint signal** that the
  model's refresh used to be, and
- **only then** may the refresh stop.

### The poll's guard is not "always"

`schwung-page-contract.ts` spends a finite budget (`RETRY_TICKS 12` ×
`RETRY_LIMIT 60`) and has **no recovery once spent** — that is SP-15's Cause D.
Polling on every tick regardless of view would burn it down while movy sits on
the sequencer, so the page would be given up before the user ever opened it.

The poll therefore keeps today's condition exactly, minus the dirty gate:
`moduleGridOnScreen()` = the Set is ready, not session mode, no Schwung editor
up, and `currentView` is `VIEW_KNOBS` or `VIEW_CHAIN`. **The body callback is
computed from the same call**, so the guard cannot drift from what is drawn: one
computation, two uses.

## 4. Changes

| file | change |
| --- | --- |
| `src/renderer/schwung-page-render.ts` | `knobLevels()` — the 8 drawn cells' normalised values via Schwung's own `normalizedOf`; `null` for unbound/unread, which is an unlit knob |
| `src/renderer/schwung-page.ts` | `knobLevels` on the `SchwungPage` surface; `normalizedOf` threaded from the lib |
| `src/renderer/schwung-lib.ts` | publish `normalizedOf` (already-imported namespace; no new import risk) |
| `src/renderer/knob-leds.ts` | one writer: `writeKnobRow()` shared by `updateKnobLEDs(vm)` and the new `updateKnobLEDsFrom(levels)` — same cache, same budget, same `knobLED k=` log line |
| `src/app/page-poll.ts` (new) | `moduleGridOnScreen()`, `refreshDrawnPage(owner)` (fills the level cache, answers whether the drawn page moved), `drawnKnobLevels()` |
| `src/model/tick.ts` / `src/model/index.ts` | `tick(refreshValues = true)` → `processTick(s, refreshValues)`, gating **only** the `refreshOneParam` call |
| `src/app/tick.ts` | one `pageOwnerOf` per tick; `tick(!owner.delegated)`; body + bank take the owner; poll hoisted out of the render branch; LEDs follow the body |

Deliberately NOT touched: `pollModuleName`, `refreshModulatedKeys`,
`retryUnsettledMeta`, `refreshParamKey` (undo's explicit re-read),
`visibilityChanged`. They are not the value refresh, and two of them are how a
module swap is noticed at all.

## 5. Tests, cheapest level first

**A — `browser-test/logic/page-owner.mjs`, structural (SP-10/SP-11 idiom).**
Three greps over `src/**/*.ts`:

1. `.poll()` appears only in `app/tick.ts` (the caller) and `app/page-owner.ts`
   (the implementations) — a second poller is the failure this item's cadence
   change invites.
2. `app/tick.ts` never calls `activeModel?.tick()` with no argument — a model
   ticked without the gate is the defect, silently.
3. `updateKnobLEDs(` / `updateKnobLEDsFrom(` are called only from
   `app/tick.ts`, and defined only in `renderer/knob-leds.ts` — one writer.

Each with the stale-allowlist companion the file already uses.

**B — `browser-test/logic/page-owner.mjs`, unit.** `knobLevels()` on a resolved
delegated page: 8 entries, bound cells normalised to the drawn values, unbound
cells `null`. And `knob-leds.ts`: `updateKnobLEDsFrom` writes the same colours
`updateKnobLEDs` writes for the same normalised values (one ramp, not two).

**C — `browser-test/app-loop.mjs`, behaviour, BOTH ARMS, appended last** (a
module swap poisons later blocks — SP-11's Cause D note). Fixture `test16`: 16
params, `p<i> = i/15`, two pages under either planner.

- *the reader*: change `synth:p1` behind the model's back, advance well past
  `REFRESH_BULK_TICKS`, and assert **movy's model picked it up iff movy owns the
  page** (`eq('...', movyPickedItUp, !delegated)`) while **the drawn page picked
  it up in both arms**. One label, passes in both arms, and it is exactly the
  gate.
- *the LEDs*: jog one page. Under `page` Schwung's index moves and movy's bank
  does not (SP-10's divergence), so if movy still drove the row the colours
  would not move. Assert the eight knob LEDs equal the colours of **the drawn
  page's** values, in both arms.
- *the other half*: the non-delegated movy pages — Main Params, Settings — light
  exactly as before in both arms.

Teeth are proved by mutation per check, and restored.

## 6. Gates

1. `SCHWUNG=../schwung npm test` — 0 failures. Regenerate screenshot baselines
   only if a pixel moves (`off` mode is untouched, so none should).
2. `SCHWUNG=../schwung node browser-test/page-mode.mjs` — **6 of 6**, never more.
3. `npm run test:device` in the foreground — a gate, retries itself.

## 7. What SP-13 should expect

The page arm's **idle floor** collapses (movy's refresh was most of it); the
**gesture premium** — what `browser-test/grid-cost.mjs` asserts — should be
roughly unchanged, because a per-tick cost adds equally to both of the page
arm's windows and cancels out of the premium. `off` is untouched at −418.
On device, re-run `./scripts/measure-grid-cost.sh off|page` against the
2026-09-13 `period_ms` table; anything inside that spread is a null result.
