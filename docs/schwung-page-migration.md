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
started at 13 and is at **6**; the remaining six are named in
`browser-test/page-mode-expected-fail.json`.

Without `SCHWUNG=` every Schwung assertion is *skipped, not failed* — a green
run proves nothing.

**Arming page mode on the DEVICE reddens the device tier, and not because of the
code under test.** `items`, `module-contract` and `smoke` assert movy's OWN
writes, and under `schwunggrid=page` movy is not the renderer: the knob CC
arrives, `applyKnobDelta` is never reached, and the sweep reports eleven
failures that all read `writes: none`. Measured 2026-09-18 — the same `ui.js` is
`smoke` 9/11 at `schwunggrid=2` and 11/11 at `0`. Put the flag back to `off`
before `npm run test:device`, or read those three scenarios as page-mode results
rather than as regressions.

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

### Open

| id | item | model | state | proposed order |
| --- | --- | --- | --- | --- |
| SP-17 | Cause C/B — filepath & canvas dives, header readout, footer hints | Sonnet | ⬜ | **2** |
| SP-19 | Undo redraw + automation-follows-arc (**verify first — may already be closed**) | Sonnet | ⬜ | **3** |
| SP-28 | **NEW** — custom module visualisations (`custom:` viz kinds) | Sonnet | ⬜ | **4** |
| SP-16 | Cause G — graphics return (**shrunk: upstream fixed the hard half**) | Sonnet | ⬜ | **5** |
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

### SP-17 — Cause C/B: the dives that do not open, the header that says nothing, the footer that hints nothing

**Product.** Three losses that share one shape — Schwung offers something and
movy does not take it. **Dives:** clicking a filepath or canvas parameter reaches
the controller, the controller returns an `open` intent, and movy drops it on the
floor. On `mrsample` that means **you cannot choose a sample** — the module is
unusable under `page`. **Header:** Schwung's header strip is the held
parameter's full name and value, inverted; movy draws its own header and its
toast occupies that row, so the one readout that tells you what you are turning
and where it is now is gone. On a page of five-character short names that is the
difference between editing and guessing. **Footer:** Schwung's footer is
`[key, action]` pairs supplied by the caller, and movy supplies none — so
mrsample never says "jog click to pick a sample", which is how you would have
discovered the dive that also does not work.

**Design & implementation.** `openSchwungEditor()` in
`src/renderer/schwung-editor.ts` handles enum-shaped intents only, and its own
comment records the gap: "an intent with no options — a filepath, a canvas — has
no editor here; it is logged rather than dropped". movy already owns a file
browser and a canvas-capable screen, so the work is an adapter: map the pending
intent's param key and type onto movy's existing browser, and return the chosen
value through the same `setParam` path the enum editor uses, so undo and the
write-log drain (SP-26) see it like any other write. Two hazards worth naming in
the plan. First, the intent carries the *controller's* key, not movy's — bind the
browser to it directly and never re-derive from `(page, slot)`, which is exactly
the class of bug SP-10 existed to remove. Second, a filepath's `""` is a real
value (no file), not a failed read, and collapsing those two is the mistake this
branch has now made five times. For the header, movy composes its own; the
readout should be produced by movy from the controller's held-parameter state
rather than by asking Schwung to draw the band, because `BANDS.header` is `false`
deliberately — movy's bank bar and Schwung's would otherwise stack. For the
footer, pass the caller-supplied hint pairs into `ctl.render` and draw them in
movy's own footer row.

**Closes when:** on device, a click on mrsample's sample parameter opens movy's
browser and the chosen file plays; a `page` screenshot scene shows the held
parameter's name and value in the header; a module declaring footer hints renders
them. `page-mode` does not grow.

**Needs:** nothing — SP-15 landed 2026-09-18.

---

### SP-19 — undo redraw, and the arc that follows automation

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
the same path. So the first session task is an assertion, not a feature: a logic
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

**Needs:** nothing.

---

### SP-28 — custom module visualisations (NEW, 2026-09-17)

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

**Needs:** nothing. Independent of the other open items.

---

### SP-16 — Cause G: graphics return

**Product.** The parameter graphics — envelope, LFO wave, filter curve, EQ
curve, waveform — are the fastest read on the screen, and under `page` they were
disappearing permanently: automate one filter cutoff and that page's curve never
came back. **Upstream has fixed the hard half** (SU-1, schwung #509): graphics no
longer stand down because decorations exist. What remains on movy's side is
narrower but still wrong — `schwung-page-render.ts` builds decorations from
whether a lane *exists* on the page, with no `auto.held` in the condition, so a
page carrying any automation lane is permanently decorated. With the viz gate
gone that no longer costs graphics; it costs *meaning*: a lock mark and an
inverted label band on a cell that has no lock, all the time. The item has gone
from "the migration's most visible regression" to "a mark that lies", and its
priority should move accordingly.

**Design & implementation.** Two halves that can land separately. The movy half
is the condition in `schwung-page-render.ts:render()`: decorate a cell only when
there is something to show — a held step with a resolved lock value — rather than
whenever `activeLanes` has a bit set. **Note what "resolved" means there:** the
decorations contract is `{ locked, value }` and there is no `exact` flag in it —
this section and SP-18's brief both assumed one, and SP-18 found none in the
library, the README or either renderer. The rule it was reaching for is carried
by `value === undefined`: a cell is marked without a value when the lock has not
resolved, and the live value shows through. SP-18 left that distinction in place
and documented it at the point the decoration is built, so this half is a change
to the CONDITION and nothing else. It is a
three-line change with a screenshot scene, and it should be written as part of
SP-18's scene set since both are about what the decoration channel means. The
upstream half is a **floor bump**: `SCHWUNG_FLOOR` is `'1.3.0'` in
`src/renderer/schwung-floor.ts`, pinned by
`browser-test/logic/schwung-floor.mjs` which reddens deliberately when it moves.
#509 is not in 1.4.0, so raise the floor to the first release that contains it,
say which feature needs it in the commit message, and confirm with
`tests/host/test_viz_under_held_step.sh` against the installed tree rather than
against `origin/main`. Until that release exists, movy on 1.4.0 keeps the old
gate — which is a reason to fix the movy half first: with decorations set only
when a lock is real, the old gate stands graphics down only while a step is held,
which is the behaviour SU-1 was asking for anyway.

**Closes when:** a `page` screenshot scene shows a page with an automation lane
drawing its graphics with no lock mark; the same page under a held step shows the
lock and (post-floor-bump) keeps its graphics; `schwung-floor.mjs` pins the new
value.

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
through `portFor(track)` as they do now (which is what makes SP-19's arc follow)
or migrate onto `lanes:*` verbs; what `lanes:plock_step` does when movy is the
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

**Needs:** every Phase 1 and Phase 2 item, and SP-29's decision.

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
  `schwung-page-render.ts` already passed `{locked, value}` from
  `auto.heldValues`, gated on `auto.held`. SP-18's output here is the scene, the
  documentation, and the correction below — `git diff` on that file is 36 added
  lines, **all comments, zero behaviour**. **(c)** needed one condition, below.
  **(d)** is (a) plus (b) and needed no third wiring.
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
  `schwung-page-render.ts` is real, tested, and **unreachable in the app** —
  only the screenshot scene drives it. Either SP-16's condition change makes it
  reachable, or movy has decided it wants no held-`value` reading and the code
  should say so out loud. That call is not SP-18's and is not made here.
  **Second, the unit agreement was never verified on hardware.** movy's
  `heldValues` are `denorm7`-ed into the param's own units and Schwung's
  `values[key]` are too, so the decoration's `value` lands in the right space by
  construction — but the app-side path is the one the gate closes, so only the
  scene (which sources both from the same meta index) exercises it. If SP-16
  reopens the path, check the held reading on a real held step before trusting
  the green.
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
