# SP-51 — the movy MODEL's own knob touch is still resolved at release time

Ledger: `docs/schwung-page-migration.md` line 152 (table row), the SP-31 entry
(776–890, "Not covered" note at ~874), line 588 (proposed-order note), line
3332 (upstream-refresh recap). Order 7.9, not a release gate.

## 1. Press-path vs release-path resolution today

`src/midi/router.ts`, inside the `(status & 0xF0) === 0x90 && d1 < 8` block
(knob touch/release, note range 0–7):

- **Top of the block, unconditional on every release** (line 279):
  `const owed = d2 > 0 ? undefined : unpinPage(d1);` then `owed?.knobTouch(d1,
  false);` (line 280). This drains SP-31's page ledger and delivers the release
  to whichever **Schwung page** heard the press, before any of the
  Main/Clip/Flags/Step page branches can `return` and swallow it. `unpinPage`
  only ever returns something when a page was *delegated* at press time —
  `pinPage(knob, page|null)` treats `null` as "forget this knob"
  (`src/midi/knob-page-pin.ts:35-38`), and `owner.page` is `null` whenever
  Schwung has not claimed/delegated the component
  (`src/app/page-owner.ts:97-108`, `movyOwner()`). So under `off`, or under
  `page` before a contract resolves, this drain is always a no-op.
- **In the fallback branch** (reached only when Main/Clip/Flags/Step are not
  active), on **press** (`d2 > 0`, line 344):
  `knobModel()?.handleKnobTouch(d1, !owner.delegated);` — `knobModel()`
  (`router.ts:131`, `masterChainActive() ? masterModel() : activeModel()`) is
  evaluated **now**, i.e. at press time, and whichever `Model` that resolves to
  gets armed: `s.touchedSlots.push(d1)` and, if the knob's parameter is an
  enum/item-selector or a file, `s.enumOverlay` / `s.fileOverlay` is opened
  (`src/model/index.ts:168-209`, `handleKnobTouch`). Immediately after,
  `pinPage(d1, owner.page)` (line 348) pins the **Schwung page** only — never
  the model.
- On **release** (`d2 === 0`, line 361):
  `if (knobModel()?.handleKnobRelease(d1)) seqToast('Wrong preset type');` —
  `knobModel()` is called **again**, resolved at **release time**. If the page
  under the knobs changed mid-hold (track switch, chain-slot swap, or Session
  toggling `masterChainActive()`), this is a **different `Model` instance**
  than the one that got the touch.

**State left behind when the page changes mid-hold**, on the model that heard
the press (call it A), because release goes to a different model (B) instead:
- `s.touchedSlots` still contains the knob index — the highlight stays
  logically armed on A (`src/model/index.ts:171-173`, `handleKnobTouch`, never
  undone since A's own `handleKnobRelease` never runs).
- If the parameter was an enum/item-selector or a file, `s.enumOverlay` /
  `s.fileOverlay` stays **open, uncommitted** on A
  (`src/model/index.ts:190`, `199-206`) — the user's turned-to selection (if
  any) is never written to the port; only `handleKnobRelease` commits it
  (`src/model/index.ts:213-280`).
- `s.longPressCountdown` stays whatever `handleKnobTouch` set it to (`-1`,
  i.e. armed-then-immediately-disarmed for the long-press timer — a smaller
  leak, folded into the same fields).
- Model B, the one that wrongly receives `handleKnobRelease(d1)`, is usually a
  no-op (its own `touchedSlots`/`enumOverlay` have nothing at index `d1`
  unless B *coincidentally* has independent stale state on that same physical
  knob index from an earlier, unrelated unresolved gesture — in which case the
  stray release **commits B's stale overlay selection**, a second-order
  corruption riding on the same defect).

This matches every `Model` implementer identically: `src/model/index.ts`
(`ModelState`), `src/mixer/mix-model.ts:99-116` (`handleKnobTouch`/
`handleKnobRelease`), and `src/lfo/model.ts:125-138` — all three share the
`Model` interface (`src/model/index.ts:565`,
`export type Model = ReturnType<typeof createModel>`), and `knobModel()` can
resolve to any of them (chain slot 4 is the LFO model — `LFO_CHAIN_INDEX = 4`,
`src/chain/config.ts:26`). **Note**: `src/lfo/assign-mode.ts`'s
`holdTouch`/`holdRelease` (hold-to-modulate) is a *separate* system, keyed on
knob index alone and unaffected — not to be confused with `lfo/model.ts`'s own
`handleKnobTouch`/`handleKnobRelease`, which *is* affected like every other
`Model`.

## 2. Can SP-31's `knob-page-pin` ledger carry the model too?

**No — a second, small, structurally-parallel ledger, not a shared value.**
Verified in code, not assumed from the ledger's phrasing:

`knob-page-pin.ts`'s `pinPage(knob, page | null)` treats `page === null` as
"delete any pin for this knob" (`knob-page-pin.ts:35-38`), and the comment
explains why: *"a movy-owned page or an unsettled contract cannot leave a pin
for the next gesture to inherit"*. That rule is correct **for the page** —
under `off`, or before delegation resolves, there genuinely is no page to
route a release to, and the router's fallback (`owner.page?.knobTouch(d1,
false)` at the *current* owner, line 365, gated `if (!owed)`) is right.

The **model** has no such case. `knobModel()?.handleKnobTouch` fires on every
press that reaches the fallback branch, delegated or not (`off` included) —
there is always a model to pin (or there is no press to react to at all: a
chain slot with no module has no `Model`, and `knobModel()` returns undefined
either way, at press and at release, so nothing to lose). Applying page-pin's
"null clears" rule to the model would mean: every time `owner.page` is `null`
(the entire `off` fixture, and most of `page` before a contract settles), the
model pin is silently deleted right after being set — defeating the fix for
the flag state where this bug is most reachable. **The two ledgers' clearing
rule at press time is incompatible in the one case that matters, so one Map
cannot serve both without breaking the invariant the page ledger already
depends on.**

They *are* pinned/drained at the same two call sites (press: lines 344/348;
release: line 279's drain point, extended) and share the exact shape (`Map<
knobIndex, T>`, cleared globally where "releases provably cannot come back").
To honor rule 6 (no duplication) without conflating lifetimes: factor the
`Map<number, T>` + pin/unpin/clear/count operations in `knob-page-pin.ts` into
one small generic (e.g. a local `createKnobLedger<T>()` helper used by both
files), and give `knob-model-pin.ts` its **own** `pinModel`/`unpinModel`/
`clearModelPins` with `pinModel`'s `null` meaning only "no model to pin"
(chain slot empty), never "delegated, so forget it" — i.e. always pin
whatever `knobModel()` returned, non-conditionally on `owner.delegated`.

## 3. What `resetHeldInput` already clears — and is the ledger row's framing right?

**The ledger row's phrase "`resetHeldInput` clears it" is true but incomplete,
and naming only `resetHeldInput` would mislead an implementer into thinking
the ordinary mid-hold case is already handled — it is not.**

`resetHeldInput` (`src/app/input-reset.ts:42-79`) does iterate every model and
call `clearTouch()` (lines 71-73: `for (const track of appState.trackModels)
for (const m of track) m.clearTouch(); for (const m of
appState.masterFxModels) m.clearTouch();`), which wipes `touchedSlots`,
`enumOverlay`, `fileOverlay` and `longPressCountdown` unconditionally
(`src/model/index.ts:292-300`). **But `resetHeldInput` is called from exactly
two places**: `app/init.ts:134` (cold boot) and `router.ts:250`/`router.ts:702`
(Leave-Movy modal confirm / a second site, both "the foreground is being
handed away, releases provably cannot come back"). It is **not** called on an
ordinary track switch, chain-slot swap, or Session toggle — the three
scenarios the ledger row itself names as "a page change mid-hold". So
`resetHeldInput` does not touch the everyday case at all.

**What actually self-heals the everyday case** is a *different*,
already-existing mechanism the ledger row never names:
`src/app/tick.ts:722-732`. Every tick it computes a `shownKey` (`'M' + mIdx +
...'` for the master chain, else `track:chainIdx`, using the model **current
this tick** — i.e. computed from `appState.activeTrack.index` and
`chainIdx` as of *after* any switch already happened, `tick.ts:670-671`). When
`shownKey !== lastShownKey` it calls `.clearTouch()` on **whichever model is
now shown** (not the one that just lost the knobs). This means: model A's
armed `touchedSlots`/`enumOverlay` are **not** cleared at the moment the page
changes — they are cleared only later, reactively, **the next time A itself
becomes the shown model again** (because that transition is *also* a
`shownKey` change, and by then A is the "now shown" model the call targets).
Between those two points, A's overlay sits open and uncommitted, invisible
(nothing renders A while B is shown) but real — which is exactly the "hands
the release to the wrong model" defect, not a state that self-heals on its
own before the render layer would ever expose it.

**Verdict: the fix is "pin the model," not "the clear is enough."** The
self-heal in `tick.ts` is real, useful, and should stay (it is the backstop
for any release that truly never arrives — modal takeover, a dropped MIDI
byte), but it does not make the release land on the right model; it only
guarantees stale state is wiped **before it would ever be rendered** on
return. The user-visible cost (§4) survives that backstop.

## 4. User-visible symptom, and is it flag-independent?

**Yes — flag-independent, unlike SP-31.** SP-31's fix lives in the delegated
path only (`pinPage(knob, owner.page)` records nothing when `owner.page` is
`null`, which is every `off` gesture and most `page` gestures before
delegation resolves). SP-51's call site, `knobModel()?.handleKnobTouch(d1,
!owner.delegated)` / `knobModel()?.handleKnobRelease(d1)`, runs
**unconditionally** in the same fallback branch regardless of `owner.delegated`
— movy's own model is touched and released the same way whether or not
Schwung owns the page. So the test must not gate on `GRID_ARM`/`page` the way
SP-31's app-loop block does (`app-loop.mjs:602`, `if (GRID_ARM === 'page')`) —
asserting unconditionally is itself part of the evidence.

**Symptom**: hold a knob whose cell is an enum/item-selector (>6 options) or a
file param — the overlay list opens and the user rolls to a different item —
then switch tracks (or toggle Session, or swap the module in the focused
slot) *while still holding the knob*, then let go. The newly-rolled selection
is **silently discarded** instead of committed: the release lands on
whichever model is now on screen, which has no matching overlay at that knob
index, so nothing happens there, and the model that actually holds the open
overlay never hears a release at all. The user's pick reverts (or rather, is
never written) the next time that page is shown, with no error and no visual
cue that anything was dropped.

## 5. Test with teeth — logic level, not device

**Home: `browser-test/app-loop.mjs`**, immediately after the existing SP-31
block ("a knob release that outlives its page does not latch the controller",
lines 564-612) — same file drives the real `onMidiMessageInternal`/`tick`
loop SP-31 needed, and the two bugs are proven with the same shape of
gesture (press → page changes → release), so keeping them adjacent avoids a
second harness. (Not `dump-replay.mjs` — this is a MIDI-timing/state-identity
bug, not a static layout invariant, so the cheapest level that can reproduce
it is a router-driven logic test, per rule 3.) `app-loop.mjs` is the recorded
600-line-ceiling exception (movy/CLAUDE.md, "named EXCEPTION at 3560 lines");
adding one more coherent block here follows existing precedent rather than
growing a fresh file.

**Fixture**: `MOCK_SYNTHS.name_enum` (`browser-test/mock-synth.mjs:574-582`)
— knob 0 = `division`, an enum with 10 options (`>6` → opens `enumOverlay`
on touch with no turn needed), seeded at index 4 ("1/8"). No file-scan fixture
needed (avoids `env.setFiles` complexity), no schwung claim/delegation needed
(avoids `GRID_ARM` branching) — the model's own `handleKnobTouch` opens the
overlay unconditionally on a >6-option enum, in both arms.

**Steps** (both tracks loaded with the same synth so each gets its own
`ModelState`, since `env.setParams` is global/component-keyed, not
per-track — `browser-test/env.mjs:107-108`):

```js
engine.reset();
env.setParams(MOCK_SYNTHS.name_enum);
resetSeqState(); resetSeqEngine();
globalThis.init();
appState.trackModels[0][1].reload();
appState.trackModels[1][1].reload();
advance(12);                      // settle both models' hierarchy
selectTrack(0);
appState.currentView = VIEW_KNOBS;

sendMidi([0x90, 0, 127]);         // touch knob 0 on track 0 — opens its enumOverlay
selectTrack(1);                   // the page changes mid-hold (no MIDI needed —
                                   // this is the state knobModel() reads)
sendMidi([0x90, 0, 0]);           // release — must land on track 0's model, not track 1's

eq('the pressed track\'s overlay is closed by its OWN release',
   appState.trackModels[0][1].getViewModel().overlay, null);
```

**What reddens with the fix removed** (i.e. `knobModel()?.handleKnobRelease
(d1)` called with `knobModel()` re-resolved at release, as today): the release
reaches track 1's fresh model, which has no `enumOverlay` at slot 0 and no
entry in `touchedSlots` — a genuine no-op there — so track 0's overlay is
**never committed**, and `appState.trackModels[0][1].getViewModel().overlay`
is still the open `{ slot: 0, ... }` object, not `null`. The assertion is
unconditional (no `GRID_ARM` guard), so it fails identically in the `off` run,
the default run, and the `page` run `page-mode.mjs` spawns
(`browser-test/page-mode.mjs:50`) — proving §4's flag-independence claim as
a side effect of the same test.

Optional second assertion for defence-in-depth (not required for teeth):
`eq('track 1 was not perturbed by the stray release',
appState.trackModels[1][1].getViewModel().overlay, null)` — true in both
arms already; documents that the common case has no collateral damage, distinct
from the corner case in §1 where a coincidentally-armed B would be.

## 6. Ordered implementation steps

1. In `src/midi/knob-page-pin.ts`, factor the `Map<number, T>` +
   `pin`/`unpin`/`clear`/`count` shape into a small private generic (e.g.
   `createKnobLedger<T>()`) so the new module can reuse it without copying the
   Map bookkeeping; keep `pinPage`'s "`null` clears" behaviour local to that
   file (it is page-specific, per §2).
2. Add `src/midi/knob-model-pin.ts`: `pinModel(knob, model: Model | null):
   void` (always sets when non-null, always deletes when null — deleting only
   means "no model to pin", never "forget because delegated"), `unpinModel
   (knob): Model | undefined`, `clearModelPins(): void`, `modelPinnedCount()`
   for a ledger-emptiness assertion mirroring SP-31's `pinnedCount()` check
   (`app-loop.mjs:606-607`). Import `type { Model } from '../model/index.js'`.
3. In `src/midi/router.ts`:
   - At the top of the `0x90 && d1 < 8` block (near line 279), add
     `const owedModel = d2 > 0 ? undefined : unpinModel(d1);` and, right after
     `owed?.knobTouch(d1, false);`, add
     `if (owedModel?.handleKnobRelease(d1)) seqToast('Wrong preset type');` —
     unconditional, before the Main/Clip/Flags/Step `return`s, for the same
     reason SP-31's page drain sits there (a page that comes up mid-hold must
     not swallow the release before the pinned model hears it).
   - In the press branch (~line 344), capture the model once:
     `const model = knobModel(); model?.handleKnobTouch(d1, !owner.delegated);
     pinModel(d1, model ?? null);` (keep `pinPage(d1, owner.page)` as is).
   - In the release branch (~line 361), delete
     `if (knobModel()?.handleKnobRelease(d1)) seqToast('Wrong preset type');`
     entirely — it is now handled unconditionally at the top via `owedModel`,
     and re-resolving `knobModel()` here is exactly today's bug.
4. In `src/app/input-reset.ts`, import and call `clearModelPins()` next to
   `clearPins()` (same comment block: "the pins below are owed releases, and
   past this point they cannot arrive").
5. Add the `browser-test/app-loop.mjs` block from §5, right after the SP-31
   block (after line 612). Run it once with the fix in place (green), then
   comment out the `pinModel`/`owedModel` wiring in router.ts (not the whole
   feature — just enough to reproduce release-time `knobModel()`
   re-resolution) to confirm the new assertion reddens, then restore.
6. Gates: `SCHWUNG=../schwung npm test` (0 failures) and
   `SCHWUNG=../schwung node browser-test/page-mode.mjs` (must not grow past
   3 of 3 — this item touches no delegated-page plan logic, so it should stay
   3 of 3). No `engine/` change, no screenshot change — skip those legs.
7. Update the ledger: SP-51 row state ⬜ → ✅, with the teeth number, and the
   SP-31 "Not covered" note's dangling id resolved (it already points at
   SP-51; no new note needed beyond the state row).

## Files referenced (no writes made by this planning pass)

- `src/midi/router.ts` (lines 131, 279-280, 344-368)
- `src/midi/knob-page-pin.ts` (whole file, 53 lines)
- `src/model/index.ts` (lines 168-300, 565)
- `src/mixer/mix-model.ts` (lines 97-116)
- `src/lfo/model.ts` (lines 125-138)
- `src/app/tick.ts` (lines 387, 670-671, 718-732)
- `src/app/input-reset.ts` (whole file, 79 lines)
- `src/chain/config.ts` (line 26)
- `browser-test/app-loop.mjs` (lines 564-612, precedent block)
- `browser-test/mock-synth.mjs` (lines 574-582, `name_enum` fixture)
- `browser-test/env.mjs` (lines 107-108, slot-aware param store)
- `browser-test/logic/knob-input.mjs` (lines 39-47, overlay-commit test style)
- `browser-test/logic/page-owner.mjs` (lines 96-103, the structural regex the
  fix's press-site call shape must keep satisfying)
