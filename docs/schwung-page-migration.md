# Schwung page migration — ledger

**The single source of truth for where this migration is.** Direction and
rationale live in
`docs/superpowers/specs/2026-09-13-schwung-page-migration-design.md`; the
original symptom survey lives in `docs/schwung-param-pages-findings.md`. This
file is *state* plus *the plan for what is left*.

**Every session working this migration: read this file first, update it last.**
Write your own item plan into `plans/SP-<id>-<slug>.md` from the entry below —
do not expect one to be waiting, and do not trust a stale one over the code.

**Goal, in one line.** Schwung's `param_pages` becomes the only implementation
of a module's parameter pages in movy; `schwunggrid` and movy's own page
renderer are deleted.

**The acceptance bar is NATIVE SCHWUNG, not movy's `off`** (ruling, 2026-09-17).
A parameter page under `page` must be no worse than the page Schwung's own host
draws for the same module. Where movy's `off` renderer drew something Schwung
does not draw at all, that is a **movy extension**, and losing it is a deliberate
cost of the migration rather than a regression to be fixed. This bar closed
SP-21 and SP-22; it also bounds SP-16, SP-23 and SP-24 — none of them may grow
into "make Schwung draw what movy used to". The bar does **not** apply to
anything that is not parameter rendering: movy's own views, its sequencer, its
lanes and its gestures keep their own standard.

---

## The burn-down is the gate

```bash
SCHWUNG=../schwung node browser-test/page-mode.mjs
```

It prints `page-mode: N of M expected failures remain`. **That number may shrink
and must never grow.** If it grew, the last item regressed a sibling — stop. It
started at 13, SP-11 took it to 6, SP-17 to 5, and the SP-17 fix round to
**3**; the remaining three are named in
`browser-test/page-mode-expected-fail.json`, and they are one FIXTURE limit
rather than three defects — under `page` the page set is Schwung's own plan, and
for the module they run on that plan is a single page named *Main* while movy's
config gives it four banks. Every one of them is a check whose subject is "the
jog reaches bank N"; the consequence for the product — a bank that exists only
in movy's config is on no page under `page` — is owned by SP-32. See the SP-17
entry in Closed items.

**THE COUNT IS READ BACK, NOT RECALLED.** `browser-test/app-loop.mjs` prints a
permanent line on both arms, next to the labels it belongs to:

```
[page-plan] mrdrums fixture ck=synth mode=page lib=true movyBanks=4 claimed=true delegated=true ctlPages=1 names=["Main"]
[page-plan] mrdrums fixture ck=synth mode=off  lib=true movyBanks=4 claimed=false delegated=false ctlPages=0 names=[]
```

`off` plans nothing because movy draws — that is what the flag buys, not a
contradiction. The four banks against one page is the whole of the fixture
limit, in one line, on the same run that produces the failures. A claim about a
page plan that no run prints is a claim nobody has checked.

**AND `SCHWUNG=` MUST HAVE BEEN SET WHEN `dist/esm` WAS BUILT.** It is a
BUILD-time alias (`build/browser.mjs`): without it the `param_pages` import
resolves to a stub that throws, `schwungLibAvailable()` is false, the mode pins
to `off`, and **both arms measure the same thing** — while `page-mode.mjs`
reports every listed label as ✓ fixed, which instructs a maintainer to DELETE
labels that are still failing. The suite now asks the built artefact
(`schwungLibAvailable()`), not the variable, and SKIPS with the rebuild command
in the message. `SCHWUNG=… npm test` covers this; a hand-run
`node build/browser.mjs` between them does not.

Without `SCHWUNG=` every Schwung assertion is *skipped, not failed* — a green
run proves nothing.

**Arming page mode on the DEVICE reddens the device tier, and not because of the
code under test.** `items`, `module-contract` and `smoke` assert movy's OWN
writes, and under `schwunggrid=page` movy is not the renderer: the knob CC
arrives, `applyKnobDelta` is never reached, and the sweep reports eleven
failures that all read `writes: none`. Measured 2026-09-18 — the same `ui.js` is
`smoke` 9/11 at `schwunggrid=2` and 11/11 at `0`. Put the flag back to `off`
before `npm run test:device`, or read those three scenarios as page-mode results
rather than as regressions. **The key is `flags.schwunggrid`**, because
`readPrefFlags()` reads `prefs.flags` and nothing else: a top-level
`"schwunggrid"` in that file is inert, and a hand-edit that writes one there
changes no mode at all while looking exactly like the fix.

---

## State

`✅ done · 🔨 in progress · ⬜ not started · 🚫 blocked · ❌ closed without work`

### Done

| id | item |
| --- | --- |
| SP-01…SP-07, SP-04a | Phase 0 infrastructure — the harness runs both modes, the fleet dump is current, `page` has pixel coverage, the fork installs, the A/B is repeatable |
| SP-25 | Level-shadowed `short_name` — a cell is built from the def of the level that owns it |
| SP-10 | Delegation boundary: one ownership accessor, page identity at every site |
| SP-11 | Input ownership, incl. **Clear+knob no longer deletes the clip** |
| SP-12 | Polling + LED ownership |
| SP-13 | Per-tick cost: number, attribution, recommendation (the branch point) |
| SP-26 | Bulk read for a delegated page — the epoch cache in front of the port |
| SP-27 | The delegated page re-planned the whole module every 8 ticks — 67.5 ms → 3.0 |
| SP-14 | Cause E — drum/voice pages planned from movy's config |
| SP-15 | Cause D — contract lifecycle: the asking never stops, only its pace |
| SP-18 | The decoration channel: modulation tilde, mod dot, p-lock highlight, held-step filter |
| SP-17 | Cause C/B — the filepath dive, the header readout, the footer hints |
| SP-19 | Undo redraw + automation-follows-arc — **verified, not built**: SP-26's write-log drain delivers the **undo** half; a playing lane's arc is served by the 8-tick fill and nothing tests that path (SP-29) |
| SP-28 | Custom module visualisations (`custom:` viz kinds) — the four loader defects fixed, and hank's own waveform is on the panel under `page` |

### Open

| id | item | model | state | proposed order |
| --- | --- | --- | --- | --- |
| SP-32 | **NEW** — a bank or cell that exists only in movy's config is on no page under `page`: audit which before SP-30 flips the default | Sonnet | ⬜ | **1** |
| SP-31 | **NEW** — a knob release that lands on another page latches `touched`, and the next jog click is swallowed | Sonnet | ⬜ | **2** |
| SP-16 | Cause G — graphics return (**shrunk: upstream fixed the hard half**) | Sonnet | 🔨 **movy half done** 2026-09-18; floor bump waits on #509 | **5** |
| SP-20 | `ui_hierarchy` ownership under Schwung's planner | Opus | ⬜ | 6 |
| SP-21 | Metadata correction overlay | Sonnet | ❌ **dropped** — the audit found 1 real correction in 555 | — |
| SP-21a | Report po32-drum's `kit` range upstream (the 1) | Sonnet | ⬜ | 7 |
| SP-22 | Cut-curve viz kind | Sonnet | ❌ **dropped** — a movy extension; Schwung draws plain dials natively | — |
| SP-23 | Font parity + enum-overlay double-draw | Sonnet | ⬜ | 8 |
| SP-24 | movy-only page kinds verified against a Schwung body | Sonnet | ⬜ | 9 |
| SP-29 | **NEW** — Schwung now ships its own automation lanes and p-locks. Decide movy's position | Opus | ⬜ | 10 |
| SP-30 | Default-on: flip, device tier, docs, release, stated revert path | Sonnet | ⬜ | 11 |
| SP-40 | Delete `body` and the `.off` stand-ins | Sonnet | ⬜ | 12 |
| SP-41 | Delete `off`, movy's page renderer, model page planning. **No return** | Opus | ⬜ | 13 |

### Upstream

| id | item | state |
| --- | --- | --- |
| SU-1 | Viz gate per-cell or held-only, not "any decorations exist" | ✅ **fixed upstream** — schwung #509, unreleased |
| SU-2 | `decorations` gains a modulation bit | ❌ **not needed** — a separate `isModulated` channel already exists |
| SU-3 | Voice declaration for caller-supplied racks | ✅ shipped as #411; SP-14 consumed it |
| SU-4 | Non-enum dive intents (filepath, canvas) | ❌ **not upstream** — the intent contract is complete; the editor is the host's job (SP-17) |
| SU-5 | Cut-curve viz kind | ❌ **withdrawn** — with SP-22 dropped there is nothing movy needs it for |
| SU-6 | The 15-vs-16 widget band that offsets label rows by one row | ⬜ open, cosmetic |
| SU-7 | `io.getParams(keys)` — an optional BULK read | ❌ **moot** — SP-26 solved it caller-side with no library change |

---

## Upstream refresh — 2026-09-17

Read against `origin/main` and against what the device actually runs
(`/data/UserData/schwung/host/version.txt` = **1.4.0**). Four findings change
the plan.

**1. The viz gate is gone (SU-1 ✅).** `vizGroupsForDecorations()` in
`page_controller.mjs` now returns `vizGroups()` unconditionally — graphics no
longer stand down because decorations exist. Upstream's own reasoning, pinned by
`tests/host/test_viz_under_held_step.sh`: `drawLabelCell` sits *outside* the
`covered[col]` guard, so every column draws its own label band whether or not a
graphic spans its knob area, and the band is exactly where a lock shows. A
spanning graphic never hid anything. **This landed in #509 and is NOT in 1.4.0**
— it needs the next Schwung release plus a floor bump.

**2. Modulation already has its own channel, distinct from decorations
(SU-2 ❌).** Schwung's vocabulary today, all of it in 1.4.0 so **no floor bump
is required**:

| what | how it is fed | how it draws |
| --- | --- | --- |
| a parameter is modulated | `io.isModulated(key)` — **the only channel; `<key>:modulated` reads were deleted in this version** | a **wave-mark tilde** 6 px left of the label run, polarity-aware |
| where modulation has put it | `<key>:effective`, falling back to the plain key | a **5-pixel plus riding the knob arc**, while the pointer keeps showing the base you dialled in |
| a parameter lock / caller decoration | `ctl.setDecorations([{locked, value}])` — **two fields, no third; the `exact` above was this ledger's error** | a **2×2 corner dot**, an inverted label band, and the decoration's value **replaces** the live one on the widget |

**Two corrections, made by SP-18 (2026-09-18) and left visible rather than
quietly edited, because both were copied forward into a work item's brief.**
This table named a third decoration field, **`exact`, which does not exist**:
`setDecorations` is a bare passthrough, and the only two decoration fields any
renderer reads are `locked` and `value` (`render_page_movy.mjs` ~2593,
`render_page.mjs` ~466). The rule `exact` was standing in for — a lock mark on a
cell with no recorded value — is carried by `value === undefined`, which draws
the live value under the mark. And the modulation row's second channel is gone:
`page_controller.mjs` ~2318 records that the `<key>:modulated` reads cost 3.5 of
the grid's 7.1 reads per tick and were replaced by `io.isModulated` on the value
cursor. Neither correction changes the conclusion below.

That is movy's own grammar — dot for automation, tilde for modulation — already
implemented, and the mod dot is something `off` never had. **movy passes none of
it**: `schwung-page-io.ts` hands the controller `getParam`, `setParam`,
`announce` and nothing else. SP-18 is therefore a wiring job, not an upstream
negotiation.

**3. A dive intent is complete; the editor is the host's (SU-4 ❌).** The
controller's `onClick` gates on `meta.divable` and returns a pending intent —
"the controller never opens it itself, that screen belongs to the host". There
is nothing to add upstream. movy's `openSchwungEditor()` handling enum-shaped
intents only is the entire gap, and it is SP-17.

**4. Schwung now has its own automation lanes and parameter locks (→ SP-29).**
#509 adds clip-associated, time-addressed lanes in the chain DSP, a step-held
**lock map**, record-arm read off Move's Record LED, and a `lanes:plock_step`
write path. It does not break movy — `applyHeldDecorations` yields explicitly
("A CALLER'S OWN DECORATIONS WIN", guarded by `heldDecOwned`) — but it means two
implementations of the same feature now exist on one box. That is a decision,
and it belongs in this ledger before SP-30 flips the default.

---

## Open items

Each entry: **Product** — what a person gets, and what they lose today without
it. **Design & implementation** — how to build it. **Closes when** — the
evidence. **Needs** — its predecessor.

---

### SP-32 — under `page`, whatever lives only in movy's config has no page

**Product.** A page under `page` is built from the module's OWN declaration —
`ui_hierarchy` for the shape, `chain_params` for the types. movy's config
(`src/modules/*.json`) is the other source: its banks, its file roots, its
filters, its `fileRequireContains`. Under `off` both are on screen, because movy
draws. Under `page` only the first is. A bank or a cell that exists ONLY in a
movy config is therefore not mis-drawn and not greyed out — it is **absent**,
with no error and no hint. SP-30 flips the default to `page`.

**What that costs is not what it looks like, and the difference is measured.**
The tempting reading — "movy's file browsing is a movy invention and dies under
`page`" — is **wrong**. `synth:ui_preset_path` is a real DSP param of mrdrums
(`docs/module-dump/modules/sound_generator--mrdrums.json` → `native.params`,
`type: "filepath"`), and the module names it in its own declaration
(`capabilities.ui_hierarchy.levels.root.params`), as it names `pad_sample_path`
under `pad_settings`. Given that declaration the plan carries the route:

```
logic: schwung page mode — Test: under `page` the plan is the module’s declaration
  ✓ a declared level becomes its own page
  ✓ and the declared filepath IS a page key
  ✓ so a click on it is a dive, which is the route `off` gets from movy’s config
```

(`browser-test/logic/schwung-page.mjs`. Teeth: drop `pad_sample_path` from the
fixture's `pad_settings` and the second reddens; change its `chain_params` type
away from `filepath` and the third does.)

So what is open is narrower than a design question, and it is an AUDIT: **which
movy-config banks and cells does no module declaration carry?** Only one end of
that is measured today — the suite's own fixture, which declares nothing at all:

```
[page-plan] mrdrums fixture ck=synth mode=page lib=true movyBanks=4 claimed=true delegated=true ctlPages=1 names=["Main"]
```

Four config banks, one planned page, and nothing on it that opens a file. That
is the fixture limit the ledger's three labels sit on, and it is a statement
about a MOCK. The real modules each need the same read-back, and none of them
has had it: `docs/module-dump/` (the 76-module inventory) against each
`src/modules/*.json` is the worklist.

**Closes when:** every bank and cell in `src/modules/*.json` is either carried
by that module's own declaration — the plan read back, not assumed — or listed
here as something a `page`-default user loses, with what they lose stated.

**Needs:** nothing. Do it BEFORE SP-30's flip, which is why its order is 1.

---

### SP-31 — a lost knob release latches the controller, forever

**Product.** A gesture goes dead. Touch a knob, and while it is held the page
under it changes — a chain switch, a module swap, a bank the fixture moved,
anything that resolves `knobOwner()` to a different page on the way up. The
release is routed to whatever screen is up now, so the pressed page never hears
it and keeps the slot in `touchOrder`. `touched` therefore stays ≥ 0 for the
rest of the session, and movy's router guard treats the controller as "a knob is
under the hand" — so **every later jog click is handed to the page instead of
movy**, and with SP-17's chrome the hint band also pins itself over the Loop
strip. Measured while working SP-17: `touched=1 order=[1]`, and the swallowed
jog click moved the CHAIN index rather than paging (measured with the latch on:
`ck=4 modelCk=lfo`).

**Design & implementation.** The controller has no staleness expiry for a held
knob on purpose — `page_controller.mjs` ~1499 returns early while
`touchOrder.length`, and `onKnobTouch` zeroes `turnClaimMs`, so nothing ages a
touch out. **The fix is on movy's side: pin the page at press and deliver the
release to THAT page.** A `Map<knobIndex, page>` filled in the router's
knob-touch branch and drained on release is ~15 lines, and it is the same shape
as the note-off ledger (`keyboard/held-notes.ts`) — the release must come from
what the press recorded, never from current state. SP-17 implemented exactly
that and reverted it, because it is not SP-17's to make: the pin cleared the
latch and took the burn-down 5 → **7** (`shift+jog: plain jog steps one page`
reddens whenever the pin is active — measured `pcount=1 ctlPages=1 names=Main`
pinned against `pcount=3 names=Main>Main - 2>Effects` unpinned), so the pin is
entangled with the FIXTURE limit rather than with the latch.

**Closes when:** a device or app-loop check holds a knob, changes the page under
it, releases out of order, and asserts the next jog click still reaches movy —
and the burn-down has not grown.

**Needs:** nothing. Do it after the fixture limit is understood, or it will look
like the fix that broke paging.

---

### SP-19 ✅ 2026-09-18 — undo redraw, and the arc that follows automation: VERIFIED, NOT BUILT

**Product.** Two invariants a person never thinks about until they break. **Undo
must redraw:** movy's undo writes the DSP and only repaints if
`syncParamsToModels` maps the key; under `page` the model is not the drawn truth,
so an undo could be correct in the engine and invisible on screen — the worst
possible failure, because the next thing a person does is undo again. **The arc
must follow the lane:** during playback an automated parameter's knob arc has to
move with its recorded value. In `off` that is movy's own widget driven by movy's
own model; under `page` the arc is Schwung's widget, and if nothing drives it the
page looks frozen while the sound moves.

**Design & implementation. Verify before building — this may already be closed by
SP-26.** The epoch cache's stale-write rule is that `EnginePort` logs every
write's key behind a sequence number and the cache drains that log before serving
any value, and *every* movy writer goes through the one memoized `portFor(track)`
— the knob under the hand, the sequencer, **an automation lane**, undo, the drum
handler. If that holds, a lane write invalidates the key and the controller's
next read is fresh, which is precisely "the arc follows the lane"; and undo is
the same path. **(Corrected after SP-19 closed: `an automation lane` does not
belong in that list of port writers. A lane's *value* never reaches the port —
the engine's CC is applied inside the chain's DSP — which is why a playing lane's
arc is served by the 8-tick fill. Kept rather than deleted so the prediction
above is not read as still standing; see the closed note and SP-29.)**
So the first session task is an assertion, not a feature: a logic
test that writes through the port as a lane would, ticks the page, and asserts
the controller's `values` moved and the rendered arc with it — and the same for
undo, including a key `syncParamsToModels` does *not* map, which is the case that
distinguishes the two mechanisms. If both pass, close the item on the tests and
say so. If the arc lags, the suspect is freshness rather than correctness (the
batch refills every 8 ticks), and the fix is to treat a lane-driven key the way
the controller treats a modulated one — on the fast lane, not the rotation.

**Closes when:** two logic tests exist and have teeth (remove the drain →
red), or a fix lands and they pass. Either outcome closes it; a verification with
no test does not.

**Closed 2026-09-18 — the first outcome: both pass, on tests that redden when the
drain is removed.** `browser-test/logic/page-freshness.mjs` holds the two. **(a)
The arc follows the lane:** a page under `schwunggrid=page`, a lane writing a
distinct value through `portFor(0)` every tick, and the controller's own cursor
read of that key — 4 reads over 40 ticks, every one of them the value the lane
had just written. **The teeth in (a) are the cursor-read assertion, NOT the arc
one:** the companion check that the drawn arc (`knobLevels()[0]`) wears that
value stays **green with the drain removed**, because the test's settle loop is
long enough for the fill to catch up. It is a real check of the end state, and it
is not evidence of the drain — said here so the two do not read alike.
**(b) Undo redraws on a key `syncParamsToModels` cannot map:** the model boots on
one declaration and the page is planned from another, so `q1` reaches the model
and `refreshParamKey('q1')` answers no (asserted in the test) — the undo is then
visible on the next read, `3` ticks, which is the page's whole rotation. **The
teeth, measured on the SOURCE, not on the built chunk:** with `drainWrites()`'s
body replaced by `return` and `dist/esm` rebuilt, (a) reports `expected 0, got 3`
(3 of its 4 reads behind the lane) and (b) reports delays of `9, 9, 6, 9, 9, 6`
against a rotation of 3. Restored and rebuilt, both green.

**The residue this does NOT cover belongs to SP-29, and is recorded there, not
here** — a *playing* lane's arc is served by the 8-tick fill and no test reaches
that path. It is stated in SP-29's own text because a closed item is where the
next session stops reading.

**WHY (b) IS A SHORT PAGE, WHICH IS THE ONE THING WORTH KEEPING.** The batch
fill is 8 ticks. A rotation is `keys.length + 1`, so an 8-key page (9) is
*slower* than the fill and the fill alone would serve every read — an **arrival**
bound there would not distinguish the drain from the timer and would pass for the
wrong reason, which is why (a) is an 8-key page that asserts *which* value each
read saw rather than when a value turned up. Two keys (3) is shorter than the
fill, so the only thing that can deliver the undo within one rotation is the
write having been drained, and (b) can assert an arrival bound outright.

**WHERE THE DRAIN IS *NOT* ON THE PATH, stated so it is not re-derived.** The
drain makes a key fresh when **movy** wrote it — `applyLaneMapping`'s binding
writes (`src/app/tick.ts:527`, `:552`), the knob under the hand, undo, the drum
handler — which is what (a) and (b) exercise. The engine's own lane **playback**
does not go through the port: `movy-dsp` emits `OutEvent::Cc` as
`midi_send_internal(0xB0 | track, 102 + lane, val)`
(`engine/crates/movy-dsp/src/lib.rs:675`) and the chain applies it in the DSP, so
nothing logs a write and the page sees the moved value on its next **fill** —
≤ 8 ticks, i.e. inside one rotation of an 8-key page. That is "not frozen", which
is what the product claim asks, but it is the fill and not the drain, and a
device measurement of the arc against a playing lane (not taken here) is what
would pin it. Read from source, not measured.

**Needs:** nothing. No fix landed — the item's suspicion that SP-26 already
closed it was right, and the freshness rule ("treat a lane-driven key as the
controller treats a modulated one") was already the implementation.

---

### SP-28 ✅ 2026-09-18 — custom module visualisations (NEW, 2026-09-17)

**Product.** A module can ship a `canvas.js` beside its `module.json` and draw
its **own** picture in a knob cell — the module author's waveform, not a generic
dial. `hank` does exactly this today (`custom:hank_wave`, declared on `ratio` in
`chain_params`, with `canvas.js` installed on the device). **In movy it never
appears**, and in the default build it never can: movy's own renderer picks
graphics by its own detectors (envelope, LFO, filter, EQ, cut, waveform) and has
no concept of a module-declared `viz.kind` at all — `custom:` appears nowhere in
`src/model/`. So this is a capability that exists only on the far side of the
migration, which makes it an *argument for* SP-30 rather than a defect against
it: for a module author, movy is the one host that cannot draw their work.

**Design & implementation.** Under `page` the path exists and is wired
(`src/renderer/schwung-widgets.ts` → `registerWidget`, called from
`schwung-page-contract.ts:87`), and the library does the rest: `viz.mjs` claims a
cell for a `custom:` kind only once a widget is registered, `widget_registry.mjs`
falls through to a built-in when it is not, and `page_controller`'s `vizCache`
keys on `widgetsGeneration()` so a late registration invalidates a page resolved
before it. Four concrete defects to fix against that, all confirmed by reading:
**(1)** movy reads a single `ov.widgetKind`/`ov.drawCell`; upstream moved to
`registerOverlayWidgets(ov)`, which accepts several shapes including
`widgetKinds` (hank declares both — an author following current docs and
declaring only the array gets nothing from movy). **(2)** movy hard-codes
`canvas.js`; the module may name `canvas_script` in `module.json`, optionally
with a `#ref` suffix. **(3)** registration happens only inside movy's `reload()`,
which after the first success is never called again — a **module swap** goes
through `ctl.reloadIfChanged()` instead, so the new module's widget is never
registered. **(4)** movy never calls `clearWidgets()`, so a departed module's art
stays in a process-global registry and a later module declaring the same
`custom:` name silently inherits it — upstream clears per module for exactly
this reason. Also adopt upstream's rule that an **empty `chain_params` is not an
answer**: deciding "declares no custom kind" from an unsettled read and latching
it is how this failed on Schwung's own host, twice. And there is **no test
coverage at all** — `custom:` appears in no test in the repo. The cheapest teeth:
a `dump-replay` assertion that hank's `ratio` cell resolves to `custom:hank_wave`
once a stub widget is registered and to a built-in when it is not; the loader
itself needs the device, since `shadow_load_ui_module` does not exist off it.

**Closes when:** hank's cell draws hank's waveform on device under `page`; the
same holds after swapping hank in and out of a slot without leaving the grid; a
module declaring only `widgetKinds` registers; and the dump-replay assertion goes
red when registration is removed.

**Closed 2026-09-18 — four defects fixed, and all four were live.** Nothing
here was already fixed and nothing was moot; the one half that was already safe
is named under (2), where the fix is the resolution and not the safety net.
**(1) Live.** `overlayWidgets()` now mirrors every shape upstream's
`registerOverlayWidgets` accepts — the legacy `widgetKind` string, a
`widgetKinds` ARRAY sharing `drawCell`, and a `widgetKinds` OBJECT of drawers or
`{draw|drawCell, nominal|widgetNominal}` — read singular-first, so a module
spelling both keeps the richer entry for the name they share. hank declares
both, so it worked on hank and on nothing else: an author following today's docs
and writing the array alone registered nothing while the page still looked
reasonable. **(2) Live.** The script is the MODULE's, not movy's: `findOverlay()`
reads `capabilities.canvas_script` (top-level `canvas_script` honoured too),
splits a `#ref` fragment off as the global to read, and resolves the name against
the first of the seven `SEARCH_DIRS` that has a `module.json`. A name that
resolves nowhere, a script that does not load, a `shadow_load_ui_module` that
throws — each is `null`, which the registry answers with a built-in. **That
fall-through half was ALREADY correct**: the old loader returned `null` too, and
`null` registered nothing, so what this defect changed is which script gets
read, not what happens when reading fails. The fall-through is the whole safety
story of this path and is asserted in all three tiers.

**(3) Live.** Registration had ONE trigger, `reload()`, which runs at
construction and on the retry and never again once a page is up — so a module
swapped into a slot kept drawing the departed module's art. It now runs from
`createWidgetSync()` (its own unit, `src/renderer/schwung-page-widget-sync.ts`)
on two triggers: `sync()` after a reload, and `afterReplan(adopted)` after a
re-plan that ADOPTED a new plan (`ctl.reloadIfChanged()` answers that), which is
the swap. The budget is honest about what it is: a `false` is never taken for an
answer, but the question is asked at most three times per module id and then
**parked** — unanswered, not answered — until a contract that MOVED re-opens it.
**(4) Live.** `registerModuleWidgets` clears BEFORE it registers, and it clears
for a module that declares nothing too — that being exactly the case where a
stale name would otherwise be served, since the registry is process-global and
`shadow_ui` is long-lived. `clearWidgets()` bumps the generation in
`vizGroups()`'s cache key, so a clear also re-resolves a page that was already
planned.

**How it is tested, and what each tier can say.** Three suites, one entry point.
`browser-test/logic/schwung-widgets.mjs` runs with **no Schwung checkout at all**
and covers (1), (2) and the invariant half of (4): the shapes, the script and
`#ref` resolution, the search, and the two "not an answer" rules (an empty
`chain_params` and an unresolved module id are neither of them a verdict). The
door is stubbed by the two DEVICE globals only (`host_read_file`,
`shadow_load_ui_module`) — nothing imports `widget_registry.mjs` by its own
specifier, because that is a second empty map. `scripts/schwung-widgets-check.mjs`
(needs `SCHWUNG=`) is where the registry exists: it drives a plural-only
`widgetKinds` module through the same entry point and reads the kinds back out of
the REAL map, and asserts the clear against it. `test-device/scenarios/widgets.ts`
is the only place a swap can be staged: the module is written to the slot's own
param (`ch0:synth:module`) with movy open and the knobs page up from before the
first swap to after the last, and three reads have to agree — the log line
(delta), `probe.widget(kind)` through movy's binding, and the FRAMEBUFFER.

**Teeth, measured.** Removing the plural branch from `overlayWidgets` reddens
`an array-only declaration registers every kind it names` and `a built-in kind in
the list is dropped`; hard-coding `canvas.js` again reddens three script/`#ref`
checks; deleting the declare-nothing `clearWidgets()` reddens `the registry still
serves the departed module's kind` in the Schwung-gated script; and deleting the
adopted re-plan trigger reddens 4 of the device scenario's 7 checks, beginning
with `swap-in-registers-the-widget` — "no new line, `available=false`" — which is
the reported defect verbatim.

**What is NOT covered, stated rather than implied.** (4)'s registry contents
cannot be asserted without a registry, so the logic suite carries the invariant
and the two Schwung-backed tiers carry the claim; its teeth were therefore proved
in the Schwung-gated script rather than in the no-checkout suite. And the
assertion the item proposed — a `dump-replay` check that hank's `ratio` cell
resolves to `custom:hank_wave` — was NOT written: `dump-replay` pages a module
from `docs/module-dump/*.json` through movy's own planner, and under `page` the
kind is resolved by Schwung's `viz.mjs` against the registry, which a dump has no
access to. The device scenario is what replaced it, and it is the stronger test:
it reads the panel.

**Noticed while closing, and left alone as out of scope.** movy's view model
cannot be asked which page is up under `page`: `page-owner.ts` hands a jog turn
to the delegated controller (`page.changePage` → `ctl.onJog`), so `vm.bankIndex`
keeps reporting the bank movy last built while the screen moves — measured, four
jog turns left the probe on `page=0 of 3 cells=[PRESET]`. The device scenario now
finds its page from the framebuffer instead. Related: a backward jog turn at the
FIRST page does not page at all — with a step page available it SELECTS the step
page — so a page walk is not symmetric under turn direction. Both are worth
knowing before anything else tries to navigate a delegated page; neither is a
defect.

**Needs:** nothing. Independent of the other open items.

---

### SP-16 🔨 2026-09-18 — Cause G: graphics return (movy half done; the floor bump waits on #509)

**Product.** The parameter graphics — envelope, LFO wave, filter curve, EQ
curve, waveform — are the fastest read on the screen, and under `page` they were
disappearing permanently: automate one filter cutoff and that page's curve never
came back. **Upstream has fixed the hard half** (SU-1, schwung #509): graphics no
longer stand down because decorations exist. What remained on movy's side was
narrower but still wrong — the decoration pass (`decorationsFor()`,
`schwung-page-decorations.ts`) built decorations from whether a lane *exists* on
the page, with no `auto.held` in the condition, so a page carrying any automation
lane was permanently decorated: a lock mark and an inverted label band on a cell
that has no lock, all the time, and (until the fix, on the 1.4.0 the device runs)
the graphics standing down behind them as well. The item had gone from "the
migration's most visible regression" to "a mark that lies"; **the mention is
fixed, and what is left is the upstream half below.**

**Design & implementation.** Two halves, and they have landed differently.
**The movy half is DONE (2026-09-18): the condition, and nothing else.** The
first line of `decorationsFor()`'s body read `if (!auto) return null;` — decorate
whenever the page carries a live lane — and now reads

```
if (!auto || !auto.held) return null;
```

with the per-cell `auto.held ? auto.heldValues.get(lane) : undefined` losing the
guard that line now supplies. The cell loop, the `{ locked, value }` contract and
the `value === undefined` distinction SP-18 documented are untouched — **fewer
decorations, never different ones.** (The contract has no `exact` flag: this
section and SP-18's brief both assumed one and SP-18 found none in the library or
in either renderer. What it was reaching for is `value === undefined`, a cell
marked with no resolved value and the live value showing through.)

The scene is `page_lane_unheld`, in `browser-test/screenshot.mjs`'s
`PAGE_SCENES` beside `page_body`/`page_body_p2`, and it is `page_held_lock`'s
frame one term away: the same page, the same live lane, **nothing held**. Its
`setSchwungGridMode('page')` and its `pageOwnerOf(model).knobParamInfo(0)` key
resolution are both load-bearing — a lane built from movy's own knob 0 would mark
a different cell under `page` and the shot would stay green with the condition
taken out. **Teeth, measured in the source with `dist/esm` rebuilt:** with
`if (!auto) return null;` put back the suite reports `page_lane_unheld ... FAIL
(924 px differ)` and `174 passed, 1 failed` — and it is the ONLY scene that
reddens, which is the precision claim; with the change in place, `175 passed, 0
failed`.

**WHAT THE CO-REQUISITE ACTUALLY IS, RE-MEASURED — the earlier wording here was
right about the held screen and wrong about the unheld one.** It said the
condition change alone "changes nothing a user can see". On the held screen that
holds; on the unheld screen it is false, and the unheld screen is the item:

  * **Unheld, on the release movy currently ships against (1.4.0, pre-#509
    gate).** The old condition decorated every frame a lane existed, and the
    pre-#509 gate stands graphics down exactly when `s.decorations` is non-null —
    so the change DOES restore the graphics by itself, with no floor bump. Device,
    page mode on bouba-kiki's root page: with the old ui.js a live lane cost
    **177 px** of frame — the frame's lower content block re-laid-out (rows 36-55,
    158 px of it: the 8-px texture filling rows 52-55 loses 31 px of its ink and
    rows 36-47 change instead) — and the rows 48-63 band dropping **299 -> 269**.
    With the fix, **15 px**, and those rows stay **299**. The residual 15 px is
    the automation's own effect on the drawn value (the cell's readout and the
    filled bar moved, `MRPH` at 9%), not a mark: it is the same 15 px in all four
    builds.
  * **Unheld, against the post-#509 tree.** Same pair: with the old ui.js the
    diff is **97 px** — the same 15 px value effect plus **82 px in rows 8, 24-25
    and 32-33**, the cell's own band and mark region, while the frame's texture
    rows are untouched. The control is the fixed build on the same tree: the
    identical scenario, gesture and value — its 15 px is the same 15 px — shows
    none of those rows. So those 82 px are the decoration's ink, drawn with
    nothing held, and the mark still lies. With the fix, **15 px** and no mark.
    That pair is what the floor bump is finally for.
  * **Held, either build.** Unchanged, because the (c) gate (`if (held) return
    why('step-held')`, `src/app/tick.ts`) hands the whole held-step screen to
    movy's own body, so `sp.render` — the only caller of `setDecorations` — is
    never reached. Measured with `heldFlag:true` and `schwung-body step-held`
    logged (1.2-1.5 s window): the held frame is movy's body carrying the lock
    and an envelope curve — **the same across all four ui/pages combinations
    within ~10 px (0.1%), not byte-identical**: the lane→held distance spans
    1171-1189 px, and the ink bands land on [290,352,185,282] for A2 and C but
    [291,344,184,282] for D, so no single vector is right for all four builds.
    The claim is the tolerance, not identity. A held capture that
    comes back equal to the frame before it is a missed hold, not a result — the
    first A and B attempts did exactly that and were re-run. The held-`value`
    decoration is therefore still exercised **only** by the screenshot scene, and
    `auto.heldValues` feeding `renderer/label.ts` is still what draws the held
    value on the screen a user actually sees. Nothing here needs the held gate
    lifted; that would change what a held step shows, which is a different item.

**The upstream half is a floor bump that cannot be made yet, and the floor is
STILL `'1.3.0'`.** `src/renderer/schwung-floor.ts` untouched,
`browser-test/logic/schwung-floor.mjs` untouched and green. Re-measured
2026-09-18 against the checkout: the newest release tag is **`v1.4.0`**,
`git merge-base --is-ancestor 0ae48972 v1.4.0` answers NO, and `origin/main` is
still `43e3c3b7` — **no release contains #509.** Raise the floor to the first
release that does, say which feature needs it in the commit message, and confirm
with `tests/host/test_viz_under_held_step.sh` against the installed tree rather
than against `origin/main`. Until then the release keeps the old gate — which,
with the movy half in, now stands graphics down only while a step is held, which
is the behaviour SU-1 was asking for anyway.

**Closes when:** `schwung-floor.mjs` pins the first release containing #509. Both
scenes the item asked for already exist and pass — `page_lane_unheld` (a lane, no
held step, graphics drawn, no mark) and `page_held_lock`. **Left OPEN on that
single remainder**; the movy half is done and the floor bump does not re-open it.

**The box's `param_pages`, and the one thing the task report got wrong about it
(measured by the controller 2026-09-18).** The post-#509 tree was installed from
`43e3c3b7` for the A/B measurement, and the box's own pre-#509 tree put back
before the tier run. What the box holds now, read directly: `param_pages/` is
**31 `.mjs` + `README.md` + `styles/` = 33 directory entries** (the report's "33
files" is the installer's `ls param_pages | wc -l`, counting entries, not `.mjs`
— the `.mjs` count is 31); its `page_controller.mjs` is `66af3e4a…` and the
whole tree matches `/Users/dake/git/cld/schwung` on
`perf/page-reload-skip-unchanged-contract` **hash for hash over all 31 files**,
with the old gate back at `page_controller.mjs:4315` and `:4508` and **0**
matches for `vizGroupsForDecorations`.

**`param_pages.prev` holds the POST-#509 tree**, not the pre-#509 one. Its
`page_controller.mjs` is `ef2e8781…` — the same md5 the task report itself
recorded for the installed file — with **4** matches for
`vizGroupsForDecorations`. The report's note says the opposite ("this restore
overwrote `param_pages.prev`, which now holds this pre-#509 tree") and is
**wrong**, which matters because the installer's own printed rollback is
`mv param_pages{.prev,}`: a later session following that note would install a
post-#509 tree while believing it was restoring the box's original. The
report's pre-install manifest md5 (`f4e56dc3…`) does not reproduce, and the
pre-install bytes are **not recoverable** — `.prev` was overwritten by the
restore and the box holds no other copy (only those two directories exist under
`/data`). So the box is verified pre-#509 **by gate shape and by hash against
the reference branch**, not by a before/after fingerprint; the pre-install
fingerprint should be read as lost, not as evidence.

**Needs:** SP-18 (they share the decoration semantics and the scene set).

---

### SP-20 — `ui_hierarchy` ownership under Schwung's planner

**Product.** No direct user-visible symptom — this is the item that stops the
other symptoms coming back. A SYNTH slot's `ui_hierarchy` comes from the plugin,
and movy reads `module.json` itself; Schwung's planner reads it too. Two readers
of one contract is precisely how a pad press ended up with no page to jump to
(SP-14), and it is the last place where movy still has an opinion about a
module's page structure. Leaving it unresolved means every later item has to
remember which reader wins.

**Design & implementation.** The ladder already exists and is documented in
`schwung-page-io.ts`: `ui_hierarchy` is answered by
`src/renderer/schwung-page-hierarchy.ts`, not read from the port — the module's
own contract first, then `ui_pages` for a module that ships its own chain editor,
then movy's config translated for a rack that published neither (SP-14's
output). `focusVoice` climbs the same ladder, deliberately. The item is to make
that the *only* reader: find every other place movy parses `ui_hierarchy` or
`module.json` page structure for a component that may be delegated, route it
through `PageHierarchy`, and add a structural test in the shape of
`browser-test/logic/page-owner.mjs` — a grep that reddens when a second reader
appears, because behaviour tests cannot hold this. Note the suffix-matching
gotcha already recorded in the io: the controller asks with the component on the
key (`synth:ui_hierarchy`), so a whole-string comparison never matches and the
fallback silently never runs.

**Closes when:** a structural test names `schwung-page-hierarchy.ts` as the sole
reader and reddens when a second one is added; `page-mode` does not grow.

**Needs:** nothing — SP-15 landed 2026-09-18.

---

### SP-21 ❌ — the metadata correction overlay: DROPPED, 2026-09-17

**The audit ran and the answer is 1 in 555.** SP-21 existed to carry movy's
`movy_config.json` range and enum-list corrections onto Schwung's metadata, on
the assumption that dropping them would break knobs on the fourteen modules movy
corrects. Ten modules on the device ship a `movy_config`. Every `min`/`max` and
every `options` list in all ten, checked against the module's own
`chain_params` in `docs/module-dump/device-dump.json`:

| verdict | count |
| --- | --- |
| **duplicate** — the config repeats what the module already declares | **554** |
| **real correction** — the config and the module disagree | **1** |
| module declares nothing and the config is the only source | **0** |

The one: **`po32-drum`'s `kit`** — the module declares `min 0, max 2`, movy's
config says `0..31`. That is a functional difference (three kits reachable
instead of thirty-two) and it is a **bug in po32-drum**, which movy happens to
know the answer to. Per the standing rule that a third-party change movy needs
is framed as an upstream PR and never as a movy patch, it becomes **SP-21a** — a
one-line fix to the module's declaration — not a general-purpose overlay layer
with an audit, a size metric and a drain plan.

**What this does NOT license.** The configs are not redundant and must not be
deleted. 98 of their keys have no `chain_params` declaration at all — `forge`'s
43 `cv_*` aliases, `po32-drum`'s 21 `v_*`, `sophie`'s 16 `pad_*`, `tablor`'s 18
— and those are the **voice and bank declaration** SP-14 shipped against
(`bank.pad` is the page declaration; see the `movy-bundled-config-override` and
`movy-voice-page-rotation` findings). They are a different thing living in the
same file. What the audit does establish is that the 554 duplicate `min`/`max`/
`options` entries are dead weight, and **SP-41 can delete them with the `off`
renderer that is their only remaining reader**.

**Also settled by this: the "automation range may be wrong" finding.** Under
`page` a lane's `min`/`max` already come from `ctl.metaIndex.getOrGuess(k)`
rather than from movy's config, and with 554 of 555 entries identical there is
one key in the fleet where that can differ — `po32-drum`'s `kit`, which is an
`int` selector nobody automates. The symptom, if it is real, is Cause F lag and
not metadata.

**Reproduce the audit:** the script is thirty lines over
`docs/module-dump/device-dump.json` — walk each `movy_config`'s
`banks[].rows[][]`, compare `min`/`max`/`options` against the module's
`chain_params` entry for the same key. Re-run it after a dump re-capture if this
ever needs re-deciding.

---

### SP-21a — report po32-drum's `kit` range upstream

**Product.** `po32-drum` declares `kit` as `min 0, max 2`. Its actual kit count
is 32, which movy's config has known since it was written. Under `page` the
planner believes the module, so the Kit knob reaches three of thirty-two kits —
a module that appears mostly broken to anyone who does not have movy's config in
their head. It is also the *only* metadata disagreement in the fleet, which is
what makes it a bug report rather than an architecture.

**Design & implementation.** One line in po32-drum's `chain_params`
declaration (`"max": 31`), filed as an upstream PR per the standing rule that a
third-party change movy needs is never a local patch. movy already has per-voice
libpo32 work in flight, so check whether that PR is the right vehicle before
opening a second one. Until it lands, the knob is wrong under `page` in exactly
the way it is wrong on Schwung's own host — which is the acceptance bar, so it
does **not** block SP-30. Verify the real maximum against the module's DSP
before filing: the config's `31` is movy's claim, not the module's, and the
whole point of this item is to stop asserting ranges movy has not checked.

**Closes when:** a PR is open against po32-drum with the corrected range, linked
here. Merged is better; open is enough to close this item.

**Needs:** nothing.

---

### SP-22 ❌ — the cut curve: DROPPED, 2026-09-17

**It is a movy extension, and the acceptance bar is native Schwung.** movy draws
a lowcut/highcut pair as one cut-curve graphic; Schwung has no `cut` kind — its
kinds are envelope, filter, LFO, waveform, fader, switch, EQ and sample. So the
question is not "does movy lose a graphic" (it does) but "does `page` render
worse than Schwung's own host" (it does not — it renders identically).

**Measured, not assumed.** Seven of 95 fleet modules carry a lowcut/highcut pair
by movy's own detector words (`aphex`, `mono-voice`, `noisemaker`, `4k-eq`,
`spectra`, `superboom`, `verglas`). Planned through Schwung's real planner and
resolved through its real `resolveViz`, here is what Schwung draws on each page
that carries such a pair:

| module | page | what Schwung draws on that page |
| --- | --- | --- |
| aphex | Filter, Patchbay | nothing — plain dials |
| aphex | Main | `fader[volume]` (unrelated to the pair) |
| mono-voice | Params - 5, Params - 6 | nothing — plain dials |
| noisemaker | Chr/Verb, Delay | nothing — plain dials |
| spectra | Control | two faders (unrelated to the pair) |
| superboom | Seal | nothing — plain dials |
| verglas | Filters | `filter[low_freq,low_q]` (a different pair) |

**In no case does Schwung claim the cut pair.** So the cost of dropping SP-22 is
bounded and known: seven modules render their cut pair as two dials, exactly as
they do on Schwung's own host today. Against that, the alternatives were an
upstream PR on a third-party review clock (SU-5, now withdrawn) or a documented
movy exception that would keep `cut-curve.ts` alive past SP-41 and stand as
precedent for every other movy graphic Schwung lacks. Neither is worth seven
modules' worth of two dials.

**If it comes back**, it comes back as an upstream `cut` kind that Schwung's own
host also draws — benefiting every embedder — and not as a movy-side exception.
That is the same door SU-5 went out of, and it can be reopened on evidence
(someone actually misses it on one of the seven).

---
### SP-23 — font parity and the enum-overlay double-draw

**Product.** Two small things that make `page` look like a different program
from the rest of movy. Schwung ships `font5x3.mjs`; movy pinned its own glyphs
by chart (see the `movy-tiny-font` work — every glyph is held by a test, and
regenerating wholesale is not allowed). If the two disagree, the body renders in
one typeface and movy's header, bank bar and toast in another, on a 128×64
screen where that reads as a rendering bug. Separately, the enum overlay may draw
twice: `knob-view.ts` runs `drawEnumOverlay(vm)` after the body while
`schwung-page.ts` calls `ctl.renderOverlays(ctx, { clearScreen })` — two overlay
systems on one frame, both permitted to clear the screen. Symptom would be a
flicker or a half-cleared list, and it is currently **unverified**.

**Design & implementation.** For the font: diff Schwung's `font5x3.mjs` glyph
table against movy's chart-pinned set and decide per divergence which is
correct — movy's charts are the reference for movy's chrome, so the likely
outcome is a small upstream PR for genuinely wrong glyphs and acceptance of the
rest, recorded. Do **not** regenerate movy's font to match. For the overlay:
reproduce first — the controller "refuses to draw without a `clearScreen`", and
movy now supplies one, so the question is whether movy's own `drawEnumOverlay`
still runs on a delegated component. If it does, the fix is the ownership
accessor SP-10 built: an overlay for a delegated component is Schwung's, full
stop, and movy's should be gated off at the same seam as its body. A screenshot
scene of an enum peek under `page` is the evidence for both halves.

**Closes when:** a `page` enum-peek scene is pinned and shows one overlay; the
font divergences are listed here with a decision each.

**Needs:** nothing.

---

### SP-24 — movy-only page kinds against a Schwung-owned body

**Product.** movy has screens Schwung has no page kind for and never will — the
step-parameter page (per-trig velocity, length, probability, condition, invert),
the track LFO page, and the trigger badge. They must keep working while the
module body next to them belongs to Schwung. The failure mode is not that they
break outright; it is that they half-work — a step page that opens over a
delegated body and leaves it drawn underneath, a trigger badge that draws in
Schwung's band, an LFO page whose knob row is Schwung's. These are the screens
that make movy movy, so a regression here undoes the case for the whole
migration.

**Design & implementation.** This is a verification item with fixes attached, not
a feature. The seam is `schwungBodyFor()`, which already returns `undefined` for
`stepPageSelected` to keep movy's own screen — the pattern generalises: every
movy-only page declares that it owns the body, and the delegated body is asked
for only when none does. Enumerate movy's page kinds, assert ownership for each
through SP-10's accessor rather than by adding conditions at call sites (the
site-at-a-time habit is what produced the original fifteen `if
(schwungActiveFor(...))` checks), and pin each with a `page`-mode screenshot
scene. Two specifics worth a plan line: the trigger badge's 700 ms re-arm is a
debounce and must survive (it has been removed before), and the track LFO page is
a fifth chain slot exposing the track's two schwung slot LFOs, so it is
addressed by track and not by component — check it against the slot-addressed API
refusal for `slot >= 4`.

**Closes when:** every movy-only page kind has a `page`-mode screenshot baseline
and an ownership assertion; removing an ownership declaration reddens its scene.

**Needs:** SP-24 runs last in Phase 2 — it is the parity sweep.

---

### SP-29 — Schwung ships its own automation lanes and p-locks: decide movy's position (NEW, 2026-09-17)

**Product.** As of schwung #509 the host has clip-associated automation lanes in
the chain DSP, step-held parameter locks with a lock map, and record-arm read off
Move's own Record button. movy has had its own lanes, its own p-locks and its own
sequencer for far longer. Two implementations of the same feature on one device
is a product question before it is an engineering one: which Record button arms
which recorder, which lock a person is looking at when they hold a step, and what
happens to a movy set opened on a box whose host is also recording. Nothing is
broken today — Schwung's `applyHeldDecorations` explicitly stands down when the
caller has set decorations ("A CALLER'S OWN DECORATIONS WIN", guarded by
`heldDecOwned`) — so this is not urgent. It is, however, load-bearing for SP-30:
flipping the default is the moment a person's lock gesture starts talking to a
page Schwung drew, and the answer to "whose lane is this" should be written down
before then, not discovered.

**Design & implementation.** Output is a decision recorded in this ledger and, if
it implies work, one or more new items — **not** an implementation. Read
`docs/CHAIN.md` and `docs/plans/2026-09-12-automation-lanes-design.md` in the
schwung checkout (both new in #509) and establish: whether the two lane models
can coexist per component or per track; whether movy's lanes should keep writing
through `portFor(track)` as they do now — **the parenthetical that used to sit
here ("which is what makes SP-19's arc follow") is FALSE, and SP-19 is what
falsified it:** a lane's **value** never goes through the port — only its
**binding** does: `applyLaneMapping` writes `knob_<N>_set` / `mixlane` through
`portFor(slot)` (`src/seq/lane-mapping.ts:38-54`, called at `src/app/tick.ts:527`
and `:552`), and that is a real port write. Read "the value never goes through
the port", never "nothing about a lane does" — the latter invites a later session
to delete those writes as dead. The engine
emits `OutEvent::Cc` → `midi_send_internal(0xB0 | track, 102 + lane, val)`
(`engine/crates/movy-dsp/src/lib.rs:675`) and the **chain** applies it inside the
DSP, so **no write is ever logged**; under `page` a playing lane's arc is served
by the 8-tick **fill** (`FILL_TICKS`, `src/renderer/schwung-page-cache.ts`).
**Nothing tests that path.** SP-19 verifies the drain for the writers that *do*
go through the port — the knob under the hand, undo, the drum handler — and
argues the playing-lane case from source alone. Whether that is good enough is
part of this item, not a settled question
— or migrate onto `lanes:*` verbs; what `lanes:plock_step` does when movy is the
one holding the step; and whether Move's Record button is now contended.
Three outcomes are plausible and all are acceptable: **coexist** (movy keeps its
lanes, Schwung's are inert under movy because movy owns decorations and the
transport — cheapest, and the current de-facto state), **delegate** (movy's lane
model is eventually deleted in favour of the host's — large, and it would
significantly extend Phase 4), or **divide** (movy's lanes for movy chains,
Schwung's for schwung slots — probably the worst, two behaviours on one gesture).
Recommendation going in: coexist, and record the reasons, because movy's lanes
are engine-owned and set-persisted (`engpersist`) in ways the clip-keyed model is
not.

**Closes when:** a section in this ledger names the decision, its reasons, and
any items it spawns.

**Needs:** nothing, but it must close before SP-30.

---

### SP-30 — default-on

**Product.** The migration only pays off when `page` is what people actually get.
This is the item that turns months of work into a shipped feature: `schwunggrid`
defaults to `page`, every module in the fleet is planned by Schwung, and the
things this ledger has been buying — correct pagination for modules movy
mis-paginated, module-declared graphics, custom widgets, the mod dot, enum peeks,
the dives — arrive at once. It is also the item that can most damage trust, so it
carries a stated revert path: a person on a bad build must be one flag away from
the renderer they had.

**Design & implementation.** Flip the default in
`src/renderer/schwung-grid.ts`, and honour the stored-flag rule
(`movy-chtracks-and-parallel-default`: a stored flag beats a changed default, so
the default change needs a `FLAGS_REV` bump or existing users keep `off`
silently). Then the full gate: `SCHWUNG=../schwung npm test` with regenerated
`page` baselines, `page-mode` not grown, `grid-cost` under its ceilings, and the
device tier green — including, explicitly, **a RACK under `page` on real
hardware**, which SP-14 could not do and nothing else will. Documentation is part
of the item, not a follow-up: MANUAL.md always, README.md for the headline, both
with screenshots taken from the new baselines via `make-doc-assets.mjs`. Raise
`SCHWUNG_FLOOR` to whatever release the shipped feature set needs (SP-16's bump
lands here if it has not already) and check the under-floor path still pins to
MOVY with a visible reason in the Settings row — that is what an older Schwung
gets, and a blank screen is not acceptable. State the revert in the release notes
and in MANUAL.md, by flag name.

**Closes when:** the default is `page`, the whole gate is green with the device
tier included and a rack verified on hardware, docs and release notes are
updated, and the revert path is written where a user can find it.

**Needs:** every Phase 1 and Phase 2 item, SP-29's decision, and **SP-31**. SP-31
is a `page`-mode defect — a lost knob release latches the controller and swallows
every later jog click — so it cannot happen while `off` is the default. This is
the item that makes `page` the default, which makes SP-31 a precondition of it.
SP-32's own row already carries the same "before SP-30" dependency; this makes
SP-31's explicit too.

---

### SP-40 — delete `body`

**Product.** Nothing user-visible; this is debt removal. `body`/DRAW is a
restyle that changes no parameter's page or slot, hard-codes `viz: []` so it has
no graphics at all, and moves 111 of 149 screenshot baselines for no functional
gain. Keeping it means every later change is tested three ways.

**Design & implementation.** Delete `schwung-body.ts`, its `.off` stand-in, the
mode from `schwunggrid`, and the baselines that only exist to cover it. The one
thing to preserve is `GRID_BODY_RECT` in `layout.ts` — it is shared with the
delegated path and the two modes previously carried disagreeing copies of it,
which is how the body came to sit 2 px too high over movy's bank bar. Do it in
one commit, alone, with the baseline regeneration in the same commit so the diff
is readable.

**Closes when:** no `body` mode exists, `npm test` is green with regenerated
baselines, and no file references `schwung-body`.

**Needs:** SP-30.

---

### SP-41 — delete `off` and movy's page renderer. Point of no return

**Product.** The end state: one implementation of a module's parameter pages.
After this there is no fallback, which is the point — the only honest proof the
migration worked is that the fallback was never needed. Everything a person sees
on a module page is Schwung's, and every future module improvement upstream
arrives in movy for free.

**Design & implementation.** Delete `src/renderer/label.ts`, `knob.ts`,
`envelope.ts`, `filter-curve.ts`, `eq-curve.ts`, `cut-curve.ts`, `lfo-wave.ts`,
`src/model/page-layout.ts`, `generic-pages.ts`, `config-pages.ts`, the `off`
mode and the `.off` stand-ins. Two preconditions that are not negotiable: the
Schwung floor must be a **released** version, because after this a
below-floor host has nowhere to fall back to — the "pin to MOVY with a visible
reason" path stops existing — and SP-24's movy-only pages must be proven not to
depend on any deleted file. Expect a large screenshot baseline churn and expect
`dump-replay` assertions written against movy's model to need rewriting against
the plan, since the layer they replay is the one being deleted. Explicit sign-off
before the commit; this is the one item in the project with no revert.

**Closes when:** the files are gone, the whole gate is green including the device
tier, and the floor is a released Schwung.

**Needs:** SP-40, and a sign-off.

---

## Proposed reprioritisation — 2026-09-17

Up for review. What changed and why:

1. **SP-16 moves down** (was 2nd of the remaining Phase 1, now 6th). Upstream
   fixed the half that made it a blocker; what is left is a mark that lies, not
   lost graphics, and it needs an unreleased Schwung anyway.
2. **SP-18 moves up** (was 4th, now 2nd). After the upstream refresh it needs no
   Schwung change and no floor bump, it is four wirings in two files, and it
   restores two everyday readings while adding one (`the mod dot`) that `off`
   never had. Best ratio left in the project.
3. **SP-19 becomes verify-first** and moves up. SP-26's write-log drain may
   already deliver "the arc follows the lane" and the undo redraw; the item's
   first task is two assertions, and if they pass it closes on the tests.
   **(Settled 2026-09-18: it did deliver the undo half. A playing lane's arc is
   served by the 8-tick fill and was never a drain claim — SP-29.)**
4. **SP-28 is new** — custom module visualisations. Raised from the device: hank
   declares `custom:hank_wave` and movy draws a dial. Four concrete loader
   defects, zero test coverage, and it is a reason a module author would want
   `page`.
5. **SP-29 is new** — Schwung's own automation lanes and p-locks landed
   yesterday. A decision item, not a build, and it gates SP-30.
6. **SU-2, SU-4, SU-7 close without work.** The modulation channel already
   exists, the dive intent contract is already complete, and SP-26 solved the
   bulk read caller-side.
7. **SP-15 closed 2026-09-18, so SP-18 is first.** It was the only item that
   made the mode unusable rather than imperfect; everything left is polish.
   **SP-18 then closed the same day, so SP-17 is first** — the ordering above is
   the 09-17 proposal and is not renumbered; read it as "SP-18, then SP-17".
8. **SP-21 and SP-22 are DROPPED, and SU-5 withdrawn with them** — asked
   directly, and the answer is the acceptance bar at the top of this file plus
   two measurements. SP-21's own audit ran: 554 duplicates, **1** real
   correction, 0 cases where movy's config is the only source of a range — so
   the overlay's entire content is one wrong `max` in po32-drum, which becomes
   the upstream one-liner **SP-21a**. SP-22's cost was measured the same way:
   7 of 95 fleet modules carry a cut pair and Schwung claims none of them, so
   dropping it lands exactly on native parity. All of Phase 2 that remains is
   SP-23 and SP-24, both of which are parity checks rather than features.

---

## Carried items — rulings that outlive the plan workspace

The final whole-branch review adjudicated the items that were carried out of the
per-item rounds. Only those with a named owner or a real next action are kept
here; the ones that ended with nothing to do are not carried forward. This
section is the durable copy — it stood in the plan workspace's `progress.md`,
which is git-ignored scratch deleted with that workspace.

- **Files over the 200-line limit — pinned debt.** `src/app/tick.ts` **1078**,
  `src/midi/router.ts` **1055**. The parked item's path, `src/seq/tick.ts`,
  **does not exist** — that is the correction. Owner: the Phase-4 deletion of
  movy's page renderer, or whoever next edits `tick.ts`'s body gate.
- **The device page-mode ritual needs no fixture — accepted in writing.** Neither
  `test-device/fixture.ts` nor `scripts/lib/test-set.sh` writes `flags`/`prefs`,
  and none is needed: every page-mode device check now pins the mode by override
  **and** asserts `p.renderer === PAGE_MODE` (`page-lifecycle.ts:173,190,261`,
  `page-dive.ts:210,224,229`, `widgets.ts:193,259`), so a fallback to the box flag
  reddens instead of silently grading `off`.
- **`page-dive.ts` mutating `prefs.json` — keep.** `page-dive.ts:139-160`
  establishes absence, snapshots, restores, and reads back with a throw. This is
  **the pattern for machine-level state**, not an inherited habit.
- **`README.md` untouched — parked, decided.** The headline lands when SP-30 flips
  the default, and SP-30's *Closes when* already owns the README line; writing it
  now documents a feature nobody has. Must be re-read at SP-30.
- **`schwung-page-contract.ts` at 198/200 — park, owner SP-30 or SP-40.** The
  retry/pace policy (`RETRY_TICKS:108`, `RETRY_LIMIT:109`, `IDLE_RETRY_TICKS:131`,
  and the `!loaded` branch of `tick()`) is one responsibility and should move out
  before the file is next edited.
- **`tickSeq` in the probe payload — the follow-up this fix round creates.**
  `noteTick` was its only writer, so the field is permanently `0`. **Nothing reads
  it**: the only `tickSeq` mention anywhere under `test-device/` is the comment at
  `page-lifecycle.ts:250` that records this very thing, and the payload fields the
  device actually reads are `renderSeq` and `parked`. So the choice is to delete
  the field from the payload (and reword that comment) or give it a real writer —
  a comment is not a consumer. Owner: whoever next touches `src/test/probe.ts`.
- **The `widgets` device flake — a named race, not a watch.** Measured **4/10** to
  date in `test-device/.flake-log.json`, on check
  `the-widget-is-what-is-on-the-screen` (the first three, all on `3f933fb`, took
  `fallthrough-still-draws` and `swap-back-registers-again` with them). The fourth
  flake is `2026-09-18T15:28:54.443Z` on `a49121e` — **outside** the `13:57–14:03`
  development window an earlier ruling rested on, and on code the scenario was not
  being changed for — which meets the escalation trigger that ruling set. Fix
  belongs to SP-28's follow-up and costs a device tier.
- **The `page-dive` flake.** The flakiest scenario in the log: **6 of 13** runs to
  date, on `e7a4304` (×3: 11:04, 11:08, 11:22), **`a7512c4`** (14:48),
  **`a49121e`** (15:28) and **`0515ba3`** (16:00) — three of them on this branch's
  own commits. The check is `dive-commit-lands-in-the-parameter` in **5** of the
  6; the sixth (11:04) took `file-param-click-opens-the-browser` instead, and
  11:08 flaked two. Both attempts ran the same build, so it is a race in the
  browse/commit path and not a code difference.

---

## Environment facts a fresh session needs

- **The fleet dump is `2026-09-13T16:33:12.253Z`, 95 modules, `complete: true`.**
  `audio_fx--gesture-test` is captured `load_timeout` — its directory holds a
  `module.json` and no `.so`, so it is an incomplete install, not a stalled
  module.
- **The real planner runs offline.** `SCHWUNG=/path/to/schwung node build/browser.mjs`
  resolves `/data/UserData/schwung/shared/param_pages/*` to the checkout instead
  of the deliberately-throwing stub. Without it every Schwung assertion is
  skipped, not failed.
- **The local schwung checkout is not on `main`.** Read upstream with
  `git -C schwung show origin/main:<path>`, and `git -C schwung fetch --all`
  first — `git pull` will not fast-forward.
- **`MOVY_SCHWUNG_GRID=off|page` is STALE** — it survives in two script usage
  lines and no build honours it. Off device use `setSchwungGridMode()`
  (`src/renderer/schwung-grid.ts`); on device set the `schwunggrid` flag.
  `MOVY_NO_SCHWUNG_GRID=1` still removes the layer from the bundle.
- **A file copy does not reload `param_pages`, and the failure is silent.**
  QuickJS caches the modules `ui.js` imports for the whole `shadow_ui` process
  life, and `param_pages` is external to movy's bundle — so reopening movy
  reloads nothing. **This cost four device readings in SP-27, and they read as a
  plausible 4% result rather than as an error.** Restart the stack with
  `scripts/lib/restart-stack.py` (as root) between arms, or do not compare them.
- **An injected gesture reaches movy on CABLE 0 of the UI ring**
  (`/dev/shm/schwung-ui-midi`). Measured: head `0x0B` moves movy's selection,
  head `0x2B` leaves the framebuffer byte-identical. Note-on is `0x09` / `0x08`.
  `schwung-midi-inject-ui.py`, `test-device/device-agent/ui-agent.py` and
  `scripts/inject-any.py` all write cable 0.
- **`Shift` + step opens a movy page and the screen says which one** (step 2 is
  Settings). The gesture is global, so it is the one reliable way to confirm a
  gesture path by screenshot. A backgrounded movy shows nothing.
- **Schwung floor is `SCHWUNG_FLOOR = '1.3.0'`** in
  `src/renderer/schwung-floor.ts`, pinned by
  `browser-test/logic/schwung-floor.mjs` which reddens when it moves — on
  purpose. Raise it when a feature needs a newer host and say which feature in
  the commit. The device currently runs **1.4.0**.
- **The installed version is NOT in `release.json`.** That file is the store
  descriptor fetched from GitHub; what a host on the box reports is
  `/data/UserData/schwung/host/version.txt`. `schwungVersion()` reads
  `release.json` first and falls through to that file, and the fall-through must
  be **total** — absent, corrupt, and *present-but-versionless* all reach the
  second rung, because `''` reads as "unreadable" and unreadable reads as met.
- **`schwungLibError()` carries no screen.** In production nothing renders it;
  the Settings row's *Param Pages* hint is where a reason reaches a person,
  composed in `src/seq/flags-page-vm.ts` (not in `renderer/flags-view.ts`, which
  is pure).
- **"`src/renderer/` has no state" means the render FUNCTIONS are pure.** The
  `schwung-*` family has always held connection state — the availability latch,
  the grid's mode and page cache, the floor's memoized read. What has teeth is
  that no *render function* reads host state.

---

## Closed items — one line each

Newest first. The full narrative for each is in git history; what is kept here is
the fact a later session would otherwise re-derive.

- **SP-19 ✅ 2026-09-18 — verified, not built: SP-26's write-log drain already
  delivers both invariants it was asked about.** Two logic tests,
  `browser-test/logic/page-freshness.mjs` (a new subsystem module, registered in
  `logic.mjs`'s two lists). **(a) The arc follows the lane** — a lane writes a
  distinct value through `portFor(0)` every tick, and every cursor read of that
  key saw the value the lane had just written. **What (a) proves and what it does
  not:** a lane's *playback* value never reaches the port (the engine's CC is
  applied inside the chain's DSP), so *real* automation's arc is served by the
  8-tick fill rather than by the drain, and **nothing tests that path** — SP-29.
  The cursor-read assertion is the teeth; the companion check that the drawn arc
  wore the last value stays green with the drain removed, because the settle loop
  lets the fill catch up. **(b) Undo redraws a key
  `syncParamsToModels` cannot map** — the model boots on one declaration and the
  page is planned from another, so the model answers `refreshParamKey('q1')`
  `false` (asserted in the test); the undo is visible on the next read, one
  rotation. Teeth, measured with the drain's body removed in the SOURCE and
  `dist/esm` rebuilt: (a) `expected 0, got 3`, (b) delays `9, 9, 6, 9, 9, 6`
  against a rotation of 3. **The one thing worth re-deriving:** the batch fill is
  8 ticks and a rotation is `keys.length + 1`, so (b) had to be a TWO-key page —
  on an 8-key page the fill alone serves every read and the test would pass with
  the drain gone.

- **SP-17 ✅ 2026-09-18 — the filepath dive opens movy's browser; the header and
  the hint band are movy's rows with the controller's words.** Three pieces.
  **(a) The dive.** The controller's click returns `{action:"open", key, fullKey,
  meta}` and opens nothing — that screen is the host's. `openSchwungEditor` takes
  the enum-shaped intents and declines these, so `src/browser/schwung-dive.ts`
  is the adapter: `filepath`/`file` intents become movy's file browser, bound to
  `intent.fullKey` (the dive ANCHOR, which is not always the clicked cell — a
  gizmo inside a sample graphic redirects, `diveTargetAt`), never re-derived from
  `(page, slot)`. Directory, filter and start hint come from the page's own
  `meta`; movy supplies only what Schwung has no concept of (its file-value
  index, its preset guard), both asked BY KEY and both optional. The commit is
  unchanged — movy's `activateFileBrowserItem` writes under `undoableEdit`, so
  undo and the SP-26 write log see it. A `canvas` or a `string` still falls
  through to the `schwung-open unhandled` log; that is the honest report, and the
  brief's claim that movy has "a canvas-capable screen" is **wrong** — movy's
  param types are `float|int|enum|file` and it draws no canvas. The `canvas.js`
  SP-28 added is the opposite kind of thing — a module-supplied widget SCRIPT,
  loaded by `src/renderer/schwung-canvas.ts` — and is not a param type movy
  renders, so the two items do not disagree.
  **(b) The chrome.** `schwung-page-chrome.ts` composes both bands from the
  controller: `describePage({}).header` (Schwung's `movyHeaderFor`, so the
  readout cannot drift from the host's) and `inverted` — which is true on
  exactly the held-param branch — as the gate, so the header never tells you
  about a param that is not under the hand. `BANDS.header` stays false, as the
  brief required. **(c) The footer is drawn last in the yield chain**, because
  the hint band's rows (57..63) overlap the Loop strip's (60..63) and the strip
  clears them on every tick: the caller sets `jogToastShown` on the frame the
  band is drawn, exactly as a bottom-row toast does. It is drawn only while a
  knob is held — with nothing held the click is MENU and the line is the least
  useful one on screen.
  **TWO OF THE BRIEF'S THREE MECHANISMS WERE WRONG, AND THE CODE WON.** It said
  to "pass the caller-supplied hint pairs into `ctl.render`": `render`'s `footer`
  argument is consumed only when `bands.footer` is true, and `describePage`
  merely echoes `o.footer` back — so movy composes the pairs itself and draws
  them with Schwung's own `drawFooter` (one definition of a pill). The words are
  a second copy of `footerHints()` (the shadow-side HOST, not importable); every
  CONDITION is the controller's — page kind from `PAGE_MENU/PRESET/ITEMS`,
  `menuEntered`, `pickerOpen`, and for a held cell `meta.writeOnly`,
  `flipsOnClick` and `diveTargetAt`, the same predicates `onClick` walks. That is
  why a two-option enum says FLIP and a trigger says FIRE: neither returns an
  intent at all.
  **THE BURN-DOWN WENT 6 → 5 AND ONLY ONE LABEL WAS EVER A CAUSE-C FAILURE.**
  `chain page: file-param jog click opens file browser` was; it now passes and is
  DELETED from the ledger file, whose note now records that the remaining labels
  are one FIXTURE limit (Schwung plans a single page named *Main* for the suites'
  mocks, movy's config has four banks, so "the jog reaches bank N" cannot hold —
  `ctlPages=1 names=["Main"]` against `movyBanks=4`, printed by app-loop's
  `[page-plan]` line, not quoted from a probe). The brief's count of five
  Cause-C labels was this item's own error, copied from a symptom list written
  before SP-15.
  **THE FIX ROUND TOOK IT 5 → 3, AND NOT BY FIXING ANYTHING.** Two of the five —
  `Back leaves the file browser` and `select committed the preset path` — were
  **FAILING**, as one cascade rather than two defects. The fixture's plan has no
  Preset page, so the jog never reaches `ui_preset_path`, so movy's browser never
  opens — and an assertion about where a browser left the view then reads the
  chain view instead, because MoveBack exited the knobs page (the drill's own
  view — and the expected side — is VIEW_KNOBS), and one about what a commit
  wrote reads `undefined`. The
  measurement is in `progress.md` ("Burn-down adjudication"); the two lines are
  `✗ Back leaves the file browser: expected 1, got 3` (VIEW_KNOBS expected,
  VIEW_CHAIN actual — MoveBack exiting the knobs page, which is movy behaving
  normally) and `✗ select committed the preset path: … got undefined`.
  **A DIFFERENT SET of checks was vacuous, and the two must not be confused.**
  `Back clears fileBrowserState`, `select leaves the file browser` and
  `select clears fileBrowserState` expect the state a browser-less run is already
  in, so they were green while proving nothing — and **not one of those three was
  ever a burn-down entry**, because a passing label is not a failure and this
  file lists failures. They therefore moved no number; the two above did.
  Deleting the two was not available — they were FAILING, and an unlisted failure
  fails the run as a regression — and neither was leaving them listed, so the
  block's tail is now gated on its own premise —
  `if (appState.currentView === VIEW_FILE_BROWSE)` — and the five checks it holds
  either run against a real browser or do not run. `off` still runs every one of
  them; the coverage is where the browser is. **The gated checks are not
  "passing": they are absent under `page`, and the two labels left the ledger
  because a check that never ran cannot be a failure — a COVERAGE REDUCTION, not
  a fix.**
  **Scope discipline, measured.** Pin the pressed page across a press/release
  pair to fix the latched-`touched` defect below and the ledger goes 5 → **7**:
  it clears the latch but breaks `shift+jog: plain jog steps one page` (measured
  with the pin: `pcount=1 ctlPages=1 names=Main`; without it:
  `pcount=3 names=Main>Main - 2>Effects`). Reverted in full. A fix that grows the
  ledger is not SP-17's to make.
  **Tests, and what they can see.** `browser-test/logic/schwung-page.mjs` walks
  every bound slot of the `switches` mock and asserts the footer's CLK verb
  equals what the click actually DID (`OPEN` from a returned intent, `FIRE` from
  `meta.writeOnly`, `FLIP` from a two-way enum that wrote, else `MENU`);
  `app-loop.mjs` drives the real tick and asserts a held knob takes the bottom
  rows AND that the painter was the band rather than a toast (knob 1, not 0 — on
  that model knob 0 is the `file` param and movy's own `JOG: BROWSE` toast
  legitimately wins the row one rung higher). Teeth: with `chromeFor`'s footer
  forced null the band check reddens (`a knob under the hand takes the bottom
  rows` expected false, got true) and `page-mode` reports a 6th unexpected label.
  Scenes `page_chrome_held` / `page_chrome_flip`, plus `file_browse` (movy's own
  browser, now an esbuild entry point) for the MANUAL.
  **A REAL DEFECT FOUND AND LEFT OPEN, because it is not this item's.** A knob
  release resolves `knobOwner()` after an ownership change and lands on a
  different page; the controller has no staleness expiry for a held knob
  (`page_controller.mjs` ~1499 returns early while `touchOrder.length`, and
  `onKnobTouch` zeroes `turnClaimMs`), so the pressed page keeps the slot
  forever, `touched` latches ≥ 0, and movy's router guard then routes every later
  jog click to the controller instead of movy — with the new chrome it would also
  pin the hint band over the Loop strip. Owner-pinning the pair is the fix and it
  belongs in its own item (see the Open list).
- **SP-18 ✅ 2026-09-18 — the decoration channel came back; only one of its four
  parts was a wiring job, and the brief named a field that does not exist.**
  **(a) The tilde was the whole of the wiring.** The controller already computed
  `modulated: (key) => !!s.modCache[key]` and called `io.isModulated(fullKey)`
  once per tick on the read cursor's rotation; movy's `createPageIo` did not
  implement `isModulated`, so every cell read as unmodulated. Answering it from
  movy's own LFO routing (`model.modulatedKeys()`, threaded
  `page-owner → schwung-page → io`, stripped back to the bare key) restored the
  tilde **and** the mod dot: `refreshModulatedValues` only visits keys whose
  `modCache` bit is set, so the dot rides the arc for free once this answers.
  **(b) The p-lock highlight and its held value needed no code change at all.**
  The decoration pass — `schwung-page-render.ts` at the time, `decorationsFor()`
  since the split below — already passed `{locked, value}` from
  `auto.heldValues`, gated on `auto.held`. SP-18's output here is the scene, the
  documentation, and the correction below — the diff that produced it is 36 added
  lines, **all comments, zero behaviour**. **(c)** needed one condition plus a
  second one the brief did not name, both below. **(d)** is (a) plus (b) and
  needed no third wiring.
  **Three of the brief's claims were wrong, and the code won.** **(1)** There is
  **no `exact` flag.** The contract is `{ locked, value }`: `setDecorations` is a
  bare passthrough holding whatever the caller handed it, and the only two fields
  either renderer reads are `locked` and `value` (`render_page_movy.mjs` ~2593,
  `render_page.mjs` ~466). The ledger's own upstream-refresh table had invented
  the third field, which is where the brief got it; that table is now corrected
  in place. The rule `exact` was reaching for is carried by `value === undefined`
  — marked, no resolved lock — and is documented at the site now.
  **(2)** The `<key>:modulated` fallback does not exist to fall back on. This
  Schwung version DELETED it; `page_controller.mjs` ~2318 keeps the measurement
  that killed it (3.5 of the grid's 7.1 reads per tick, half). `s.modCache[key]`
  is set from `io.isModulated` and nothing else. So **movy's answer is the only
  answer**: a key movy reports unmodulated gets no tilde and no dot, because
  `refreshModulatedValues` collects from `modCache` too and no second source
  would notice. What it does NOT lose is the pointer — `:base` is asked only when
  the bit is set, but since schwung #276 the plain key also answers with the base
  for a modulated target, so the knob keeps showing what you dialled in either
  way. **(3)** `hiddenDuringHold` needed no new gate. In `page` mode
  `schwungGridEnabled()` is false, so the `undefined` body `schwungBodyFor`
  already returns for a step page falls through to movy's `drawKnobParams`, which
  is where the filter lives. The only gap was that `held` meant "a step page is
  open" rather than "a step is held"; `schwungBodyFor(owner, stepSelected, held)`
  now takes the wider fact as a parameter, read from `seqState.stepAutoMode` —
  the same value `auto.held` is built from, so body and decorations cannot
  disagree.
  **Handing the screen to movy obliges movy to keep READING it, and the gate that
  did not know that was the review's find.** The refresh gate above the body gate
  asked only "is the page delegated?" (`activeModel.tick(!pageOwner.delegated)`),
  so under `page` the held-step screen was drawn from whatever movy last read
  before the finger went down: the LOCKED cells stayed right — they come from the
  engine's own status poll — and every NEIGHBOURING cell froze, which is exactly
  the shape that reads as working. The two gates are now one expression's worth of
  the same opinion (the `held` fact is read once, above both), and
  `browser-test/app-loop.mjs` measures it through the real tick: a held step
  **is still a delegated page** (measured, `owner().delegated === true`) and the
  value written behind movy's back **arrives** while it is held. Teeth: reverting
  the expression alone reddens `a held step keeps movy reading its own page`
  (`expected true, got false`) and takes the `page` arm to a 7th unexpected label,
  which `page-mode.mjs` fails on. Cost of the exception, stated because this repo
  counts it: one bulk read per `REFRESH_BULK_TICKS` — the pre-migration pace — for
  as long as a step is held, and not one tick longer.
  **The SP-12 question the brief asked has an answer, and the scenes cannot see
  it.** The modulated-key sweep DOES still run for a delegated component:
  `refreshModulatedKeys` is called from the `pollCountdown` block
  (`model/tick.ts`), which is not gated by the `refreshValues` flag — only
  `refreshOneParam` is. That is why (a) works at all on a delegated page. Note
  what it means for the coverage: every `page_mod_cell*` scene calls
  `model.refreshModulation()` by hand, so if the production sweep ever stopped,
  the tilde would vanish on the device and **every scene would stay green**. The
  logic suite's own reach is the scenes; the sweep itself has no test. Worth one
  if that call is ever touched.
  **Teeth, one scene each, only its own wiring removed, and every other scene
  `ok` in each run so no scene grades another's wiring:**
  `page_mod_cell` and `page_mod_cell_held` red by **128 px** with
  `io.isModulated` neutered; `page_held_lock` red by **9 px** with the
  decoration forced to `{locked: true}`; `page_held_unassignable` red by
  **470 px** with `if (held) return why('step-held')` removed.
  `page-mode-expected-fail.json` is unchanged at 6 — no label grew, none shrank.
  **NINE PIXELS IS THIN EVIDENCE AND THE ITEM DOES NOT DRESS IT UP.** That is the
  measured difference between the decoration's value and the live value for one
  cell holding a two-character reading; the scene grades it, but it grades it
  barely. A future change could perturb it into a false pass. It is recorded
  here so the next session widens the reading rather than trusting the colour.
  **Two things not to smooth over. First, (b) and (c) are in tension.** The brief
  wanted a held step with a resolved lock to show the lock **and the held value,
  not the live one**. movy's own UI cannot reach that state: the (c) gate hands
  the whole screen back to movy while a step is held, which is what the ledger's
  (c) asks for and what was implemented. So the held-`value` path in
  `decorationsFor()` is real, tested, and **unreachable in the app** —
  only the screenshot scene drives it. Either SP-16's condition change makes it
  reachable, or movy has decided it wants no held-`value` reading and the code
  should say so out loud. That call is not SP-18's and is not made here. (**SP-16
  answered it on 2026-09-18: the condition change does NOT make the path
  reachable — the (c) gate still hands the whole held screen to movy's own body,
  measured identical across all four ui/pages combinations on device — so the
  decoration's `value` stays scene-only, and movy's body is the held reading a
  user actually sees.**) What
  movy's own body draws for a held step is `auto.heldValues` through
  `renderer/label.ts`, and THAT path is live and user-visible.
  **Second, the unit agreement was never verified on hardware.** movy's
  `heldValues` are `denorm7`-ed into the param's own units and Schwung's
  `values[key]` are too, so the decoration's `value` lands in the right space by
  construction — but the app-side path is the one the gate closes, so only the
  scene (which sources both from the same meta index) exercises it. If SP-16
  reopens the path, check the held reading on a real held step before trusting
  the green.
  **The decoration pass has moved, and that is where SP-16 works now.** The
  documentation above and the condition SP-16 edits are in
  `src/renderer/schwung-page-decorations.ts` (**new**, `decorationsFor()`), split
  out of `schwung-page-render.ts` (195 → 138) because 36 of the lines this item
  added there were prose, leaving 5 lines of headroom against the 200 limit and
  nothing for the next change to write in. Behaviour is identical: the split is
  the file's existing seam — that pass answers "what should the cells say", the
  rendering either side of it answers "draw them". Both files are now well inside
  the limit and `schwung-page-render.ts` has 62 lines of room.
  Also: SP-16's brief cites "SP-18's `exact` rule" twice; both now point at the
  `value` distinction, which is what actually exists.
- **SP-15 ✅ 2026-09-18 — the contract's retry budget latched, and the asking may
  not stop.** `attempts` reached `RETRY_LIMIT` and never reset for a slot that
  had never loaded, so a module arriving later was never noticed — and with
  `loaded === false` `tick()` returns before the reload divider, so the retry is
  the only discovery path and nothing else could have re-armed it. The numbers
  are unchanged; what changed is what `RETRY_LIMIT` MEANS (the end of the urgent
  window) and what `attempts` counts. After it, the asking continues at
  module-load pace for as long as the slot is unloaded, while a settled,
  empty-and-resolved contract still stops reading.
  Teeth are in `browser-test/logic/page-contract.mjs` — red on both
  late-arrival cases with the fix removed. **The two halves are not equal
  evidence, and the item does not claim they are.** The `None` half was already
  correct once the engine serves a genuinely empty answer — which is the
  tri-state's job, and the case the logic suite can only model — so it is kept
  as a **regression guard**; the half this item demonstrates is the
  **late-arrival re-arm**. `test-device/scenarios/page-lifecycle.ts` covers the
  end-to-end outcome on hardware and does **not** discriminate the fix there:
  measured with the latch reverted, with the renderer pinned to `page`
  (`probe.page().renderer`, now asserted in all three checks — the first version
  silently graded movy's own renderer, because L3's reopen drops the mode
  override and falls back to the device flag), and with the empty-slot window at
  10000 frames — ~29 s, ~1840 ticks at the slowest tick rate the board is known
  to tick, against a 720-tick budget — the module's page comes back anyway. The
  device does not reach the latch by that route; something re-makes the contract
  when the module lands, and which path that is was not established.
- **SP-27 ✅ 2026-09-17 — the delegated page re-planned the whole module every 8
  ticks and discarded the result.** `load()` ran `planPages` unconditionally and
  returned at `planned.fingerprint === s.fingerprint`, which in a steady state is
  every time; the fingerprint is over `[hierarchy, chainParams, mode]` only, so
  comparing those bytes first is an equivalence, not a heuristic. Device
  `tick_ms` **67.5 → 3.0**, `period_ms` **70.4 → 5.9** against `off`'s 4.9 —
  minijv was ticking at **13 Hz**. Fix is **upstream**
  (`perf/page-reload-skip-unchanged-contract`), because movy owns the `io` but
  not the reload cadence. Two lessons kept: every existing instrument ran the
  best case (11-param mocks, 14-param plaits, against minijv's 433 params and 57
  levels), and the cost was invisible to `perf_phase` because `VIEW_CHAIN`
  carried no phases at all.
- **SP-26 ✅ 2026-09-17 — the delegated page reads a page at a time.** An epoch
  cache (`src/renderer/schwung-page-cache.ts`) refilled by one `port.getMany()`
  every 8 ticks; the tracked set is **learned** from what the controller asks,
  not predicted. Stale writes are answered **at the port by pull**: `EnginePort`
  logs each write's key behind a sequence number and the cache drains it before
  serving any value, so one rule covers every writer and nothing is subscribed.
  **A null is never cached** — `null` is "did not answer", `""` is a real answer,
  and collapsing them took the burn-down 6 → 7. Device tick period 9.1–9.5 →
  6.8–7.2 ms; idle round trips off device 753 → 146.
- **SP-13 ✅ 2026-09-16 — the number is 9.1 ms and the attribution is the
  un-batched read.** Branch point, not a gate. Also the session that found
  `scripts/inject-any.py` had been parsing d1/d2 as decimal since the day it was
  written, so **every injected gesture in every prior device A/B had failed
  silently** and five sections of "real numbers" were all the idle floor.
- **SP-12 ✅ 2026-09-16 — one reader and one LED writer.** `tick.ts` stops
  `refreshOneParam` and `updateKnobLEDs` for a delegated component; the page is
  ticked only while the grid is on screen, which is why a returning page knows
  nothing about how old its values are.
- **SP-11 ✅ 2026-09-14 — input ownership; the clip survives Clear+knob.** The
  highest-severity item in the project (data loss) closed here.
- **SP-10 ✅ 2026-09-14 — the delegation boundary exists and it is one accessor.**
  Fifteen ad-hoc `if (schwungActiveFor(...))` sites in `src/midi/router.ts` plus
  two in `tick.ts` now call through it. "Did you cover every site?" is
  structural, not a review question.
- **SP-25 ✅ 2026-09-14 — level-shadowed `short_name`.** `absorbHierarchy`
  flattened every level's `params[]` into one map, last write wins, so `jp8000`'s
  Performance page rendered two knobs both labelled `MODE` from labels the module
  never gave them. A cell is now built from the def of the level that owns it.
  jp8000 is the only module in the fleet with this shape.
- **SP-14 ✅ 2026-09-17 — movy's config IS the declaration, for four modules.**
  `6w6`, `8w8`, `9w9`, `cw78` declare voice pages the movy way (`bank.pad` in
  `src/module-configs/`), not via Schwung's #411 declaration; movy translates
  them into the contract the planner wants, on the same ladder `focusVoice`
  climbs.
- **Phase 0 ✅ 2026-09-13** — SP-01 (both modes as arms, named expected-fail
  ledger), SP-02 (`installEnv()` is idempotent), SP-03 (`schwung-page.ts` 457 →
  124, split four ways), SP-04a (fleet dump re-captured: 76 → 95 modules, so 19
  including all four movy drum kits were absent from every earlier reading),
  SP-04 (fleet sweep through `page_plan`), SP-05 (`page` screenshot scenes — the
  mode previously had **zero** pixel coverage), SP-06 (fork install + runtime
  floor with a visible reason), SP-07 (repeatable device A/B).
- **2026-09-13 — the red gate was the check, not the code.**
  `smoke#refresh-blocking` had been red on arrival for every recorded run: it was
  measuring a refresh that was not running and grading it by a wall clock that
  could not tell a descheduled tick from a slow refresh.
