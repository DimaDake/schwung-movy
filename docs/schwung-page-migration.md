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
into "make Schwung draw what movy used to". **One extension has been asked back
by name (SP-46, the lone attack/decay graphic), and the bar still holds for it:
the route is an upstream viz kind, not movy reaching into Schwung's body.** The bar does **not** apply to
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
| SP-18 | The decoration channel: modulation tilde, mod dot, p-lock highlight, held-step filter — **see SP-33** for the half of the held-step gate it left undone, and **SP-35** for the gate that made its p-lock pass unreachable in production until SP-35 removed it |
| SP-17 | Cause C/B — the filepath dive, the header readout, the footer hints |
| SP-19 | Undo redraw + automation-follows-arc — **verified, not built**: SP-26's write-log drain delivers the **undo** half; a playing lane's arc is served by the 8-tick fill and nothing tests that path (SP-29) |
| SP-28 | Custom module visualisations (`custom:` viz kinds) — the four loader defects fixed, and hank's own waveform is on the panel under `page`. **See SP-34** for the fifth, found in review |
| SP-20 | `ui_hierarchy` ownership — one reader (`chain/hierarchy-source.ts`) for the page, the model and the undo dump; the manifest rung and the `"{}"` test were each a divergence |
| SP-35 | A held step keeps the delegated page — SP-33's gate reversed, and the p-lock decoration pass it had made unreachable is reachable again. The "cannot take a lock" filter is movy's chrome at the gesture, not a decoration; the per-cell half is SU-8 |
| SP-38 | Animated widgets draw until they settle — `anim_state.settled` asked by `pollDrawnPage` only when value and identity held still. Costs **0.7 ms/tick of `render`** in the animating window (0.2 before) — **on plaits, 2 pages, the SMALLEST shape in the fixture, so that is a FLOOR and not a representative**; n=1 window per arm. **SP-39 re-ran it on minijv and did NOT measure an animating window there at all** — the 0.2 that appears survives stashing this item's animation term and carries no `buildvm` — so the cost on a large module is **not measured, neither scaled nor falsified**, and the plaits floor above is still the only number there is. No host call, idle unchanged |
| SP-39 | A pad press onto a page the cache has never read paid one blocking read per cell; `jump` now hands that page's keys to the cache as **ONE bulk request** before `goToPage`. Teeth: the jump costs **1 bulk + 1 single** round trip against **0 bulk + 9 single**. **The call pattern is the whole of the measured win**: on device (`cw78`, the rack, both arms, the same build) the press's effect is **within noise** — `calls/tick` 1.69 → 1.54, `perf_ipc` 4.12 → 3.66 ms, tick 3.66 → 3.49, worst period 6.64 → 6.47 — and the **worst frame is unchanged, 26 → 27 ms**. `padpage` is 0.1–0.2 ms/tick under `page` in the windows that hold presses and absent under `off`. The page-vs-off gap is at IDLE (worst period 6.3 vs 5.0 ms, `calls/tick` 1.4 vs 0.6) — the delegated renderer's STANDING cost, not this gesture, **now opened as SP-49**. **The gesture is measured on a rack pad, not a drum-track pad — the fixture's drum module declares no note map.** The SP-38 re-run on `minijv` (70 pages, **not 72**) **measured no animating window at all** (the 0.2 survives stashing SP-38's term and carries no `buildvm`), so SP-38's cost on a large module is **not measured** |

### Open

**Order changed 2026-09-18** by the device findings section below: the user's
four release blockers come first, then the two-value flag, then the **opt-in
release** — which is now the milestone this ledger runs at, with SP-30's default
flip after it and SP-41 conditional on a decision nobody has made.

| id | item | model | state | order | release gate |
| --- | --- | --- | --- | --- | --- |
| SP-36 | **NEW** — the automation channel: the missing dot, and the arc that must not jump | Opus | ⬜ | **1** | ✔ |
| SP-37 | **NEW** — the header says a fixed word where the page name belongs | Sonnet | ⬜ | **5** | ✔ |
| SP-31 | a knob release that lands on another page latches `touched`, and every later jog click is swallowed | Sonnet | ⬜ | **6** | ✔ (unreportable if shipped) |
| SP-40 | the flag becomes two values, MOVY and SCHWUNG; `body` and the `.off` stand-ins deleted | Sonnet | ⬜ | **7** | ✔ |
| SP-47 | **NEW** — the opt-in release: the row goes in front of users, default still MOVY | Sonnet | ⬜ | **8** | — |
| SP-48 | **NEW** — a modulated or `live` param the page shows keeps it redrawing forever. **A regression SP-38 introduced**; the flag must not reach testers with it open | Sonnet | ⬜ | **7.5** | ✔ |
| SP-49 | **NEW** — an IDLE `page` tick costs half again what an `off` tick costs (worst period 6.3 vs 5.0 ms, `calls/tick` 1.4 vs 0.6) and it is there with nothing moving. **A standing LATENCY cost** — the tick period is the MIDI sampling interval — so it is a gate, not just inefficiency | Sonnet | ⬜ | **7.7** | ✔ |
| SP-50 | **NEW** — on a child-level page, movy and the controller disagree about WHICH child is showing, and a module that counts from a base disagrees by a whole instance. Live under `page`, unreachable under the default `off`; makes SP-39's child-page warm inert on the one fleet module that reaches the branch | Sonnet | ⬜ | **7.8** | ✔ |
| SP-32 | a bank or cell that exists only in movy's config is on no page under `page`: audit before SP-30 flips the default | Sonnet | ⬜ | 9 | — |
| SP-42 | **NEW** — a .wav has no waveform: `wav_io_qjs.mjs` is never imported | Sonnet | ⬜ | 10 | — |
| SP-45 | **NEW** — 8w8's pads do not select their pages; the other three racks' do | Sonnet | ⬜ | 11 | — |
| SP-43 | **NEW** — the second click on an entered preset page leaves it | Sonnet | ⬜ | 12 | — |
| SP-44 | **NEW** — knob 1 changes presets with no click first (feature) | Sonnet | ⬜ | 13 | — |
| SP-46 | **NEW** — a lone attack/decay has no graphic (against the acceptance bar, by request) | Sonnet | ⬜ | 14 | — |
| SP-16 | Cause G — graphics return (**shrunk: upstream fixed the hard half**) | Sonnet | 🔨 **movy half done** 2026-09-18; floor bump waits on #509 | 15 | — |
| SP-21a | Report po32-drum's `kit` range upstream (the 1) | Sonnet | ⬜ | 16 | — |
| SP-23 | Font parity + enum-overlay double-draw | Sonnet | ⬜ | 17 | — |
| SP-24 | movy-only page kinds verified against a Schwung body | Sonnet | ⬜ | 18 | — |
| SP-29 | Schwung ships its own automation lanes and p-locks. Decide movy's position | Opus | ⬜ | 19 | — |
| SP-30 | Default-on: flip, device tier, docs, release, stated revert path | Sonnet | ⬜ | 20 | — |
| SP-41 | Delete `off`, movy's page renderer, model page planning. **CONDITIONAL — may never happen** | Opus | ⬜ | 21 | — |
| SP-21 | Metadata correction overlay | Sonnet | ❌ **dropped** — the audit found 1 real correction in 555 | — | — |
| SP-22 | Cut-curve viz kind | Sonnet | ❌ **dropped** — a movy extension; Schwung draws plain dials natively | — | — |

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
| SU-8 | A per-cell channel for "this parameter is AUTOMATED" and "this cell cannot take a lock" — distinct from `locked` (a held step's lock) and from `isModulated` (the tilde) | ⬜ **new, conditional** — SP-35/SP-36 decide first whether movy can draw both in its own chrome |
| SU-9 | A knob drives a door page's list, with `list_knob.mjs`'s feel | ⬜ **new, likely** — SP-44; the list, its length and its commit path are the door's, and movy must not restate them |
| SU-10 | A viz kind for a LONE envelope stage (attack only, decay only) | ⬜ **new** — SP-46; take the fleet count with the ask, the way SP-22's drop was measured |
| SU-11 | A per-key duration in the animation store, so `settled` ages out a value that never rests | ⬜ **new, conditional** — SP-48; the alternative is a movy-side repaint cap, which is the fallback only if this is declined |

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

## Device findings — 2026-09-18, from the box

Twelve findings, reported by the user running `page` on hardware. **They are
symptoms, not diagnoses.** Every cause named below is READ FROM SOURCE unless it
says measured, none of the twelve has a failing test yet, and writing the repro
is the first task of the item it became — this file's own rule ("a claim about a
page plan that no run prints is a claim nobody has checked") applies to the
causes in this section exactly as it applies to a burn-down count.

**The end game changed shape, and that is the largest thing on this page.** The
flag stops being a three-way experiment and becomes a two-value user-facing
switch — **MOVY** and **SCHWUNG** — shipped VISIBLE in the next release with
MOVY still the default, so people can turn it on and report back. The default
flips to SCHWUNG once they are happy (SP-30), and **`off` may never be deleted
at all**: the user's words are "it could be that I leave both". SP-41 is
therefore no longer the assumed end state of this ledger — it is conditional,
and its entry says so.

**Four findings are the release gate**, named by the user: automations,
animations, pad-switch performance, and the header. Everything else lands after
the opt-in release rather than before it. That is the user's call on scope and
this file does not re-argue it; the non-gate items keep their own order below.

**Every gate fix is movy-side on the Schwung the device already runs.** Read
back from the tag, not from `origin/main` —
`git -C schwung show v1.4.0:src/shared/param_pages/<file>` — **1.4.0** already
carries `pageLabel` (SP-37), `createAnimState` + `settled` (SP-38),
`isModulated` and the `<key>:effective` read (SP-36), `list_knob.mjs` (SP-44)
and `wav_io_qjs.mjs` (SP-42). 1.4.0 is what
`/data/UserData/schwung/host/version.txt` reports. **No floor bump is on the
release path**, which is worth the one command it took to establish: every
previous "this needs upstream" in this file has cost a release cycle.

| # | reported | became | gate |
| --- | --- | --- | --- |
| 1 | hold a step to edit automation and the OLD movy page is shown | SP-35 | ✔ |
| 2 | no dot on a parameter that is automated | SP-36 | ✔ |
| 3 | an automated param's knob JUMPS as the transport moves it; it should stay put and carry a moving indicator, like the LFO's | SP-36 | ✔ |
| 4 | the header shows fixed text (preset / preset name) where the PAGE NAME belongs | SP-37 | ✔ |
| 5 | animations are completely broken — the LFO indicator, a waveform changing on a page change — Schwung supports them and they are very slow | SP-38 | ✔ |
| 6 | on a drum track, switching page by pressing a PAD is noticeably slower than movy's pages (check forge, on a page that supports switching) | SP-39 | ✔ |
| 7 | no waveform for a selected .wav in a parameter page | SP-42 | — |
| 8 | on the preset selector page the first jog click focuses the page (correct); the second jumps to the MAIN page to the right | SP-43 | — |
| 9 | feature: knob 1 should change presets with no jog click to focus first | SP-44 | — |
| 10 | pad page selection does not work for **8w8**; it works for the other xwx modules | SP-45 | — |
| 11 | no single attack / single decay visualisations | SP-46 | — |
| 12 | remove the `body` option: a two-value flag, MOVY and SCHWUNG, visible to users next release | SP-40 + SP-47 | ✔ |

**Proposed order, gate first.** 1 SP-36, 2 SP-35, 3 SP-38, 4 SP-39, 5 SP-37,
6 SP-31, 7 SP-40, **7.5 SP-48 — the regression SP-38 introduced**, **7.7 SP-49 —
the standing idle tick, which is latency and therefore a gate**, **7.8 SP-50 —
the child instance movy addresses is not the one the controller resolves, which
is live under `page`**, 8 **SP-47 —
the release**. Then SP-32, SP-42, SP-45, SP-43,
SP-44, SP-46, SP-16, SP-21a, SP-23, SP-24, SP-29, SP-30, and SP-41 only if it
is ever decided. SP-31 is in front of the release and the user did not name it
because it is not a symptom you can describe — a lost knob release latches the
controller and **every later jog click is swallowed**, so a tester whose box is
in that state reports "the jog stopped working" and nobody can reproduce it.
SP-32 is NOT in front of the opt-in release, and that is a deliberate change
from its own row: a bank that exists only in movy's config being absent is
something an opt-in tester can SEE and report, which is what the opt-in is for.
It goes back in front of SP-30, where it always belonged.

---

## Open items

Each entry: **Product** — what a person gets, and what they lose today without
it. **Design & implementation** — how to build it. **Closes when** — the
evidence. **Needs** — its predecessor.

---

### SP-36 — the automation channel: the dot that is missing, and the arc that must not jump

**Product.** Two halves of one complaint, both about a parameter movy is
automating. **(a)** Under `off` an automated parameter wears a 2×2 dot next to
its label (`renderer/label.ts:39`, `pvm.automated`), so you can see at a glance
which of the eight the sequencer is driving. Under `page` there is no dot on
anything unless a step is held, so the page cannot tell you what is automated.
**(b)** While the transport plays, an automated parameter's knob **jumps** —
the pointer chases the lane. The reporter's ask is explicit: the pointer should
**stay where you set it**, and the automation should show as a mark moving
across the knob, *"like with lfo"*.

**(b) is a change of movy's own long-standing behaviour, not only a `page`
defect.** movy shipped "the on-screen knob arc follows the automation value" as
a feature, and `off` does exactly that today. The reporter has now watched it on
hardware and wants the LFO reading instead. Under `off` that is a second piece
of work in movy's renderer; **decide in this item whether `off` changes too**,
or whether the two renderers deliberately read differently until SP-30. A silent
divergence between them is the thing this file exists to prevent.

**Design & implementation — the mechanism is already there, and it is
caller-side.** Schwung's vocabulary (1.4.0, no floor bump — see the upstream
refresh table): `io.isModulated(key)` raises a **wave-mark tilde**, and for a
key it reports true the controller reads `<fullKey>:effective` on a fast lane
(`MOD_FAST_READS_PER_TICK` keys a tick, ungated by the turn settle on purpose)
and draws a **5-pixel plus riding the arc while the pointer keeps the base**
(`page_controller.mjs` `refreshModulatedValues`, v1.4.0 ~4055: *"`values` stays
the BASE — what the user dialled in and what a turn edits"*). **movy owns both
sides of that**: `isModulated` is movy's own injected function
(`renderer/schwung-page-io.ts`, wired by SP-18 from the LFO routing model), and
`getParam` is movy's too — the epoch cache in front of `portFor(track)` — so
movy can answer `<key>:effective` with the lane's live value and the plain key
with the dialled base. That is precisely (b), with no upstream change.

**The open question is the BASE, and it is the whole item.** Under `page` the
plain-key read goes to the engine port, which answers the value the chain's DSP
currently holds — and for an automated parameter that IS the lane's value
(`engine/crates/movy-dsp/src/lib.rs:675` emits the CC; the chain applies it
inside the DSP, which is why no write is ever logged — SP-19, SP-29). So there
is no base to serve until movy decides where one comes from: the model's stored
value, the value at the last manual turn, or a lane-recorded base. Establish
that FIRST; everything else here is wiring.

**(a) needs a decision about grammar, and it may need upstream.** Reporting an
automated key through `isModulated` gets a mark today — but a **tilde**, movy's
symbol for modulation, on a parameter that is **automated**, whose symbol is a
dot. The two readings would collide on a parameter that is both. `decorations`
cannot carry it: `locked` means a held step's lock and the pass that would
otherwise set it always-on was removed for exactly this reason (see the
`decorationsFor` comment — *"a mark that is always there says 'locked' about a
cell nobody locked"*). So either movy draws its own dot in the chrome it already
owns, or the third channel becomes **SU-8**. Prefer whichever does not put a
second implementation of a mark inside Schwung's body.

**Closes when:** an automated parameter under `page` is marked; its pointer
stays at the base while a mark tracks the lane during playback; a logic test
drives a lane and asserts both (teeth: remove the `:effective` answer and the
mark freezes); and this entry records what `off` now does and why.

**Needs:** nothing upstream. Pairs with SP-35.

---

### SP-37 — the header says a fixed word where the page's name belongs

**Product.** On the module view the right-hand side of the header is where the
page is named. Under `page` it shows a fixed string — the reporter reads it as
"Preset" or the preset's name — for every page of the module, so jogging through
a module's pages moves the bank bar and the body while the one piece of text
that says WHERE YOU ARE never changes.

**Cause, read from source.** `renderer/knob-view.ts:35` builds the right-hand
text as `vm.drumPadName || vm.bankName` — **movy's model's** bank, from movy's
own config or its own pagination. Under `page` the bank BAR is already Schwung's
(the same function takes `bank.index` / `bank.count` from the delegated page
eleven lines later, with its own comment about the two page sets differing in
length) but the NAME was never moved with it. So the bar paginates over
Schwung's pages while the label names movy's — and on a module whose movy config
opens with a preset bank, that label is a constant.

**Design & implementation.** The controller already publishes the answer:
`ctl.pageLabel()` — present in **v1.4.0**, checked. Expose it on the
`SchwungPage` facade beside `pageCount`/`pageIndex` (`renderer/schwung-page.ts`
~141, where those two already live as getters), have `chromeFor` hand it out,
and let `knob-view` use it wherever it is taking `bank` from the delegated page.
Two conditions to keep: the **held-knob header** still outranks it (that branch
is `heldHeaderFor`, unchanged), and the **drum pad name** still outranks the page
label on a voice page, the same rule movy's chain view follows. Where the
delegated page is not what is drawn, nothing changes.

**Closes when:** a `page`-mode screenshot scene shows the page's own name in the
header and a second page of the same module shows a different one; the held-knob
and drum-pad branches are pinned by the same scene set.

**Needs:** nothing. Smallest of the four gate items; do it in the same session as
something else if it lands first.

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

**TWO CONFIG DIRECTORIES, AND AN AUDIT THAT GREPS ONE OF THEM IS WRONG (noted
2026-09-18, while working SP-45).** `src/modules/*.json` is the bundled set;
`src/module-configs/*.json` holds the four OVERRIDES movy ships for racks whose
own configs it replaces (6w6, 8w8, 9w9, cw78 — see `movy-bundled-config-override`).
Both are inputs to the same question.

**Closes when:** every bank and cell in `src/modules/*.json` **and
`src/module-configs/*.json`** is either carried
by that module's own declaration — the plan read back, not assumed — or listed
here as something a `page`-default user loses, with what they lose stated.

**Needs:** nothing. Do it BEFORE SP-30's flip — which is what its order now
says, and no longer before the opt-in release: a tester who finds a missing bank
is a report, and reports are the point of shipping the flag (SP-47).

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

**MOVED IN FRONT OF THE RELEASE (2026-09-18).** It was ordered against SP-30's
flip; with SP-47 putting the flag in front of users first, this is the defect a
tester cannot usefully report — the symptom they see is "the jog stopped
working", with no gesture to describe and nothing to reproduce from. A bug
report that cannot be acted on is worse than the bug.

---

### SP-47 — the opt-in release: the flag goes in front of users

**Product.** The migration's first user-visible step, and the reporter's own
plan: ship `page` as a **choice**, not as the default. The Settings row offers
**MOVY** and **SCHWUNG**, MOVY stays the default, and people who want to try the
new pages turn them on and report. The default flips later (SP-30), when the
reports say it should — and it is now explicitly possible that **both options
stay forever**.

**Design & implementation.** Three things, and only the first is code.

1. **The flag becomes release-visible.** `src/seq/flags-def.ts` — the entry has
   no `release`, which is why `visibleFlags()` hides it outside a debug build
   (`src/seq/flags-visible.ts`). Adding it is the whole switch. Its `hint` is
   what a user reads to decide, so rewrite it for them rather than for us; the
   floor reason still overrides it (`flags-page-vm.ts:40`), which is the path a
   user on an older Schwung gets and it must still say something true.
2. **SP-40 first.** A three-value flag whose middle value is a restyle is not
   something to put in front of a user, and the value renumbering it causes has
   to happen once, before anyone has stored a preference.
3. **Docs and release notes.** MANUAL.md states what the setting does, what
   changes when you turn it on (**pages re-paginate** — parameters move, which is
   the one surprise worth naming in advance), and how to turn it back. The
   revert is a flag, by name, in both, and CHANGELOG.md carries the line the
   store release quotes (`docs/RELEASING.md`). README.md stays untouched — the
   headline belongs to SP-30's flip, which its own row already owns.

**What must be TRUE before it ships, and this is the list to re-read rather than
re-derive.** The four gate items (SP-35, SP-36, SP-37, SP-38, SP-39 — five
entries, four complaints) plus SP-31, whose symptom a tester cannot report
usefully. Not SP-32: an opt-in tester noticing a missing bank is a report, and
reports are what the opt-in is for. **Three more rows are gates and are not in
that count, because none is one of the four complaints: SP-48 (a modulated or
`live` param keeps the page redrawing forever), SP-49 (an idle `page` tick
costs half again what an `off` tick costs) and SP-50 (on a child-level page movy
and the controller disagree about which child is showing). All three must be
closed, or explicitly accepted here with the number and the acceptor named,
before this item closes.**

**THE DEVICE TIER STAYS GREEN, and that is a consequence of the default rather
than of luck.** `items`, `module-contract` and `smoke` assert movy's OWN writes
and report eleven `writes: none` failures when the box is armed to `page` (see
the burn-down section) — shipping with MOVY as the default means the tier keeps
measuring what it always measured. That protection ends at SP-30, which is where
those three scenarios have to be taught the mode.

**Closes when:** a release build shows the row, the default is MOVY, the device
tier is green on that build, MANUAL.md carries the setting and its revert, and
the release notes name it.

**Needs:** SP-40, and the gate items above.

---

### SP-42 — a .wav has no waveform, because movy never registered the file reader

**Product.** Select a sample in a parameter page and the waveform that should
draw it is blank. The waveform is one of the strongest arguments for delegated
pages — it is drawn from the FILE, which movy's own renderer could only do for
its own widgets.

**Cause, read from source, and it is one missing import.** `wav_peaks.mjs`
computes the peak envelope, and it does **no I/O of its own**: *"THE I/O IS
INJECTED... `std` and `os` are QuickJS MODULES, so importing them here statically
would make this file unloadable under node"*. The device wires the real pair in
**`wav_io_qjs.mjs`**, which Schwung's own `shadow_ui.js` imports for its side
effect (`src/shadow/shadow_ui.js:307`). movy's `ui.js` is a different QuickJS
program: `renderer/schwung-lib.ts` imports ten `param_pages` modules and
`wav_io_qjs.mjs` is not one of them. So in movy's process `IO` is null,
`wavPeaks` reports an error rather than throwing — *"Without an IO this reports
an error rather than drawing nothing"* — and the graphic draws empty. Present in
**v1.4.0**; no floor bump.

**Design & implementation.** Add the side-effect import to `schwung-lib.ts`'s
ladder, where every other `param_pages` import already lives with the one
failure path. Three things to check while doing it: it must NOT break the
browser build (the file names `std`/`os`, so it needs the same `.off` /
build-alias treatment the rest of the layer has — this is why it is not a
one-liner); the peak job is **resumable and per-tick** (`BLOCKS_PER_TICK = 2`),
so something has to advance it, which is the same frame-clock question as SP-38
and is why `ctl.vizGroups()` is exposed ("so the host can advance a sample's
peak-envelope job from its TICK") and movy calls it nowhere; and `MAX_BLOCKS`
bounds a huge file to ~2 MB of reading.

**Closes when:** a page with a selected .wav draws its envelope on device, and a
logic test asserts the IO is registered when the layer loads (teeth: drop the
import and it reddens).

**Needs:** nothing, but the tick half is SP-38's clock — do it after.

---

### SP-43 — the second click on an entered preset page leaves it

**Product.** On the preset selector page the jog click enters the page, which is
correct. Click again and the screen jumps to the **main page to its right** —
the click that should be doing something inside the list instead leaves it. A
door you can only stay inside for one click is a door that does not work.

**Not yet reproduced, and the first task is the repro.** Both plausible causes
are one read away and they have different fixes:

- **movy's ladder handed the click on.** `midi/router.ts` ~760 takes a click for
  Schwung when `pickerOpen || isDoor() || touched >= 0`. `isDoor()` asks about
  the CURRENT page — which does not change on entering — so the second click
  should also reach Schwung. If it did not, the suspect is an earlier rung of
  movy's own ladder consuming it, and SP-31's latch (a stale `touched`) is a
  candidate for the opposite reason: it makes clicks reach Schwung that should
  not.
- **Schwung took it and moved.** A preset commit re-plans, and a re-plan can
  land `pageIndex` somewhere else. That is Schwung's behaviour and the fix is a
  host one — restore the page across the re-plan (`ctl.restorePage` exists) —
  or an upstream report.

Instrument before choosing: `owner.reason` already prints the page index every
tick, and `mlog` is on the click path.

**Closes when:** entering a preset page and clicking again stays on that page and
does what the footer promises (`CLK EDIT`), with an app-loop check.

**Needs:** SP-31, which is the other suspect on the same gesture.

---

### SP-44 — knob 1 should change presets with no click first

**Product.** A feature request: on the preset page, turn knob 1 and the preset
changes — no jog click to focus the page first. One gesture instead of two, for
the thing people do most on that page.

**Design & implementation.** Do NOT write a stepper for this. Upstream already
has `list_knob.mjs` (present in v1.4.0), whose entire subject is that a knob and
a jog are not the same input: `DETENTS_PER_ENTRY = 6` for a deliberate turn, and
a length-aware acceleration ceiling so a 519-entry list is crossable and a
6-option enum does not jump. A movy-side stepper would be a second copy of a
feel that has been calibrated against the real fleet, and it would drift.

The open question is whether the controller already accepts a knob turn on a
door page. `onKnobTurn` starts at `keyAt(slot)` and returns immediately when the
slot has no key, and a preset door's knob list is not its page keys — so the
likely answer is "no, and the routing is the ask". If so this is an **upstream**
request (SU-9) rather than a movy patch: the door page knows its list, its
length and its commit path, and none of those should be restated in movy. Read
`page_input.mjs` and the LAYOUT_LIST path first — a knobs-as-list page exists
upstream, and the feature may be one layout call away.

**Closes when:** knob 1 walks the preset list with `list_knob`'s feel and no
click first, with the routing owned by whichever side of the boundary the read
above says owns it.

**Needs:** nothing. After the release.

---

### SP-45 — 8w8's pads do not select their pages, and the other three racks' do

**Product.** On 8w8, pressing a pad does not take you to that voice's page.
6w6, 9w9 and cw78 — the same family, the same bundled-config mechanism — work.

**What is already established, so the audit starts narrower.** All four racks
declare **no** `ui_hierarchy` of their own (checked against
`docs/module-dump/modules/sound_generator--{6w6,8w8,9w9,cw78}.json`: their
`capabilities` carry audio/midi/chainable and nothing else), so all four are
planned through SP-14's translation of movy's bundled config
(`model/config-hierarchy.ts`). All four configs declare `pad` on a leading run
of banks and carry `drum.padNoteStart = 36`
(`src/module-configs/*.json`). The one structural difference is **size**: 8w8
has **16** voice banks — the whole pad grid — against 6w6's 8, 9w9's 11 and
cw78's 14, and 19 banks in total.

**First suspects.** `buildRotation` has no cap, so the translation itself is not
obviously it. `focusVoice` matches voice → page by `p.level === v.level` and
falls back to an upper-cased NAME match; a 19-level plan is where a planner is
most likely to split a level across two pages or abbreviate a name, and either
would break the second match while leaving the first intact for the smaller
racks. The other candidate is the read budget — `BATCH_MAX_KEYS = 48` and
`BATCH_VALUE_MAX` in the epoch cache, against a contract that is now 19 levels
wide.

**The evidence channel already exists**: `focusVoice` logs
`focusVoice no page for <level>/<name> | keys=… | p1=…` when it cannot resolve
(`schwung-page-input.ts:139`). One device run with 8w8 loaded and a pad pressed
either produces that line — in which case the audit is over and the fix is in
the matching — or it does not, in which case the press never reached
`focusVoice` and the fault is upstream of it in movy's own pad routing.

**Closes when:** a pad press on 8w8 opens that voice's page, and a logic test
plans all four racks from their shipped configs and asserts every pad resolves
to a page (teeth: it must fail for 8w8 before the fix).

**Needs:** nothing.

---

### SP-46 — a lone attack or decay has no graphic

**Product.** movy's own renderer draws a single envelope stage in the waveform
cell — a decay with a dotted rise, an attack as its mirror — precisely because
the module gives no control over the other edge (`renderer/knob.ts:134`). Under
`page` a parameter that is the only envelope control on its page gets an
ordinary dial, and a reading movy users have had for a year is gone.

**This one is against the acceptance bar, and that is the point.** The bar at
the top of this file says a movy extension Schwung does not draw is a deliberate
cost of the migration, and that bar closed SP-21 and SP-22. The reporter has
asked for this one back. So the item is NOT "make Schwung draw what movy used to"
by reaching into the body — it is an upstream ask (**SU-10**): Schwung's viz
detector recognises A/D/S/R groups, and a lone stage is a viz KIND it does not
have. Measure the fleet the way SP-22's drop was measured — how many modules
have a page with exactly one envelope-stage parameter — and take that number
upstream with the ask. If the answer is small, record the loss instead; the
measurement is what decides it, not this paragraph.

**Closes when:** either a viz kind exists upstream and movy draws it, or this
entry records the fleet count and the decision to accept the loss.

**Needs:** nothing. After the release.

---

### SP-48 — a modulated or `live` param the page shows keeps it redrawing forever. **A REGRESSION SP-38 INTRODUCED**

**Product.** A page showing an enum-shaped or waveform parameter with a host LFO
on it — or any `live` param that keeps moving — **never stops redrawing.**
Nothing looks wrong, and that is the point: the animation is doing its job and
the page pays the animating cost on every tick, forever. What a person notices
is a warm tool and a shorter battery; what the next item that measures tick
headroom notices is noise it cannot attribute.

**This is a regression, and it is SP-38's.** Before SP-38 the same setup
**froze**: `pollDrawnPage`'s `moved` came from `page.knobLevels()`, which reads
`ctl.state.values[k]` — the **BASE** map — so a modulated enum moved no level
and no key, `moved` stayed `false`, and the widget sat at a stale frame. That
freeze is the defect SP-38 fixed (finding #3), so the pressure is real and the
item is not "undo SP-38": the only reason the page redraws at all now is the
predicate that keeps it redrawing.

**Cause, with the chain, because it was got wrong once.** `settled(state, now)`
is "nothing was stamped within the last 120 ms" and `observe` re-stamps whenever
a value's string differs from the last one seen, so **a key that moves again
inside every 120 ms window never settles** — the threshold is a FREQUENCY, not a
per-frame change: ~8 Hz. A 10 Hz LFO does it; a 2 Hz LFO does not. The route is
a modulated or `live` param the DRAWN page shows, and the renderer **merges
before it observes**: `render_page_movy.mjs:2441` builds
`liveValues = {...values, ...modValues}`; the enum path hands
`shown = liveRaw ?? raw` (`:2160`) into `drawEnumSquare`, which observes `shown`
(`:1579`); the wave path passes `liveValues` to `drawVizGroup` (`:2516`) and
`drawWaveform` observes out of it (`viz_draw.mjs:1115`). So both animated widgets
observe the MODULATED value, and `modValues` is re-read from `:effective` every
tick (`page_controller.mjs:4148`, one key per tick) for every key `modCache`
flagged (`:2344` — which includes `live: true` params, not only modulated ones).
The arc knob is the only immune widget, and only because `drawArcKnob` (`:1237`)
takes no `anim` argument. The store never ages a key out: `since` is overwritten,
never expired, and the window is one constant, not per-key. Second-order and
SP-36's to check: a decoration feeding a raw value back into an animated key such
as `enumw:` is the same exposure by another door.

**The cost, and read it as a FLOOR.** The measured animating window is
**0.7 ms/tick of `render`** against 0.2 before, its worst tick 3.9 ms against a
2.8 ms baseline (worst period 5.7 → 6.8 ms, +19%) — measured on **plaits, 2
pages, the smallest shape in the fixture**, so it is the cheapest page this can
happen on. A permanently-redrawing page pays it on **every** tick rather than one
window in seven, and nobody has measured the same page on minijv (70 pages, where
the lag was reported — **SP-39 measured the count and corrected the 72 that stood
here**); expect more there. Raw lines, both arms:
`### SP-38 ✅` above.

**Fix route, two of them, and the first is not movy's.** (a) **Upstream — the
preferred one (SU-11).** A **per-key duration** in the store: record the
transition's own `durationMs` with the stamp and let `settled` age a key out
against that, so a key that never rests still passes once its transition is older
than its own duration. That is rule 2's answer — a change Schwung needs is an
upstream PR, never a local patch — and it is the same shape as the 100 ms
`WAVE_MORPH_MS` against the 120 ms window that SP-38 already records as a loss.
(b) **On movy's side, if upstream declines:** a **repaint cap in
`pollDrawnPage`** — the animating term asks for a frame at most once per N ms, so
a never-settling page degrades to a bounded frame rate instead of the tick rate.
N has to be picked against the shortest animation movy draws or the cap visibly
stutters the animations SP-38 fixed, so this is the fallback, not the plan.

**SP-47 interaction, and it is why this row carries a release gate.** SP-47 puts
the flag in front of testers, and one host LFO on an enum or waveform parameter
the page shows is a known way to make every tick pay the animating cost. **The
flag must not go out with this open** unless SP-47's entry records an explicit
acceptance and says who accepted it. The row is placed at order **7.5**, between
SP-40 and SP-47, for that reason; the owner can move it.

**Closes when:** the page goes idle again under a fast-modulated enum or wave
param, **with a test that proves it** — drive an `:effective` value moving faster
than the 120 ms window and assert `pollDrawnPage` stops asking for frames once
the transition has aged out. `browser-test/logic/page-freshness.mjs` already
drives `pollDrawnPage` directly, so this is a local test, not a device one. Or
SP-47 records the acceptance.

**Needs:** a decision on (a) versus (b) — the upstream PR first, the cap only if
it is declined. Nothing from the device; the measurement above is what is on
record.

---

### SP-49 — under `page` an IDLE tick costs half again what `off` charges. **A standing per-tick cost, with nothing moving**

**Product.** Nothing is wrong on screen, and that is the whole problem. Under
`page`, with no gesture, no automation and nothing animating, a tick costs half
again what the same tick costs under `off` on the same module and the same
build: worst idle period **6.3 vs 5.0 ms**, `calls/tick` **1.4 vs 0.6**, tick
**3.2–3.3 vs 1.8 ms**, `perf_ipc` **3.2 vs 1.3 ms** (`cw78`, track 0, both arms,
`sp39-measurement.md`; the same gap shows on minijv as 5.9–7.7 vs 4.8–5.0). What
a person would notice is not a stutter — it is a tool that is a little heavier
to hold, permanently.

**Why this is a LATENCY cost and therefore a release gate — the call this row
makes.** `perf_ipc`'s tick period **IS the MIDI sampling interval** (SP-13's
finding, and the reason the probe exists): a pad press is only seen on a tick,
so +1.3 ms of standing period is +1.3 ms before the press is even read, on every
gesture, including gestures nobody is making. That is the shape the release
would ship — SP-47 puts the row in front of testers who will judge it by
gestures — and **a per-tick cost half again the `off` arm's, present at idle, is
exactly what SP-47 must not discover on its own**: what it hears is "everything
under SCHWUNG feels a bit sluggish", a symptom no one can attribute to a page, a
module or a gesture. Recorded as a gate on that basis, at order **7.7**, between
SP-48 and the release. The counter-reading, stated so the call is visible and
reversible: the absolute numbers are small (6.3 ms ≈ 159 Hz), nothing has ever
been reported against it, and a reader could call this ordinary inefficiency.
The judgement above is that a latency the release would ship is a gate; an owner
who disagrees should MOVE this row, not delete it.

**Where it comes from, and it is not a defect.** The `page` arm runs a delegated
renderer, and all of its idle cost is by design. The phase lines, idle, `page`:
`ctltick` 0.8, `seqengine` 0.6, `rest` 0.6, `ctlpoll` 0.5, `ctlreload` 0.2–0.3
(`modeltick` 0.3 is gone; under `off` it is `seqengine` 0.5, `rest` 0.5,
`modeltick` 0.3, `ctlpoll` 0.0). The two IPC lines it adds are the largest two
in the window — `get overtake_dsp:*` **n=0.5 ms=1.2** and `mget ch0:*` **n=0.4
ms=0.8**, against n=0.2/ms=0.4 and n=0.0/ms=0.1 under `off`. The gap has been
known since SP-13 and bought back twice already: **SP-26** put the epoch cache in
front of the port, **SP-27** stopped the whole module being re-planned every 8
ticks (67.5 ms → 3.0). **The migration has already spent two items on this tick;
this row is the remainder, not a new discovery.** SP-39 met it while measuring a
gesture, and correctly refused to call it the gesture's cost — the numbers are in
its entry and in its Done row.

**Fix route, and step one is attribution, not a fix.** No phase owns the whole
1.5 ms: the phases above account for most of it and the IPC side for the rest, so
(a) **attribute it on a big module first** — minijv idles at 5.9–7.7 ms against
`off`'s 4.8–5.0 and its `ctlreload` 0.7–0.8 ms/tick at idle is the single largest
line anywhere in that run, which makes the reload the first suspect; (b) then ask
per phase whether a tick must carry it — a reload that need not happen every
tick, a poll that can be paced, a read the epoch cache can serve. Do **not**
re-derive the instrument: `sp38-measurement.md` and `sp39-measurement.md` are the
method, and `measure-grid-cost.sh`'s `idle` section is the run.

**Closes when:** the idle `page` tick is within ~10% of the `off` tick on the same
module and build, measured with the existing probe and recorded in a third
measurement handover — **or** SP-47 records an explicit acceptance that names the
number and who accepted it.

**Needs:** nothing from the plan, and no decision from anyone else. Device time,
and a judgement on how much of the delegated renderer's idle cost is worth
buying.

---

### SP-50 — on a child-level page, movy and the controller disagree about WHICH child is showing, and a module that counts from a base disagrees by a whole instance

**Product.** On a drum- or pad-level page, the parameter a knob turns can belong
to the NEIGHBOUR of the child the screen is on. Nothing looks wrong — the header,
the page name and the strip all say the child the user hit — and what answers is
one instance over, silently, on every turn of every knob on that page.

**Cause, half one: a permanent off-by-base.** `src/renderer/schwung-page-input.ts:167`
writes `String(v.childIndex)` into the module's child-index param. Schwung
converts in ONE place, next to the base that defines it: `childIndexToWire(level, i)`
(`../schwung/src/shared/param_pages/child_key.mjs:181-183`) adds
`child_index_base`, and the controller reads the value back through
`childIndexFromWire` (`:194`), which subtracts it. On a level declaring
`child_index_base: 1` — voice-poc's `pads` — the controller therefore tracks one
instance BELOW what movy wrote. That is an off-by-base that never corrects
itself, not the one-tick staleness the comment at that site describes.

**Cause, half two, same root: a level with no `child_index_param` has no channel
at all.** Where the level declares none (voice-poc's `pads`), movy cannot tell
the controller which child the UI is on: `syncChildIndexFromModule` returns early
without one (`page_controller.mjs:1775-1777`; `liveChildIndex` carries the same
rule at `:3981`), so nothing refreshes `s.childIndex[level]` and the controller
resolves at instance 0 (`childIndexFor`, `:817-820`) while movy navigates. That
is why SP-39's child-page warm is INERT on the one fleet module that reaches the
branch — it warms `p2_vol`…`p4_vol` and the controller reads `p1_vol`.

**Pre-existing, and NOT a regression.** `git blame src/renderer/schwung-page-input.ts:167`
→ `bf94962a` (2026-09-13). **Live under `page`; unreachable under the default
`off`**, because it needs a module declaring a child note map and the fixture's
`plaits` is not one — so it was invisible to every device run so far, which is
exactly why SP-30's flip is the deadline.

**Closes when:** a test drives the INSTALLED `voice-poc`
(`docs/module-dump/modules/sound_generator--voice-poc.json`; the fixture hook is
already in `browser-test/fleet-expect.json` → `voiceDeclaring`) and pins that the
child instance movy addresses and the instance the controller resolves are the
SAME on a level with `child_index_base: 1`, and that the warm covers the keys the
controller actually reads there. `browser-test/logic/schwung-page-press.mjs` (100
lines) drives `focusVoice(8)` only through the non-child path today, and
`grep -rn "resolveChildKey\|childLevel" browser-test/` returns nothing — **this
item is where the child-level branch gets its first coverage.**

**Needs:** nothing — the module, its dump and the fixture hook are all in the
tree already; the pin is a local test.

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

### SP-38 ✅ 2026-09-19 — an animated widget draws until it settles, and costs 0.7 ms/tick while it does — on the SMALLEST module, so that is a floor

**Symptom.** Under `page` Schwung's animated widgets are "completely broken" —
the enum square frozen halfway to its new width, a waveform not morphing, a
trigger bang not flashing out. Finding #3 of the twelve reported from the device
(2026-09-18).

**Cause, and it is one line of policy.** Schwung's renderer is pure and time is
passed in: every animated widget guards on `anim && typeof nowMs === "number"`,
and `page_controller.mjs` feeds both from `s.anim` + `now()` at the render call.
**The frames only exist if someone renders again.** Upstream's host redraws
unconditionally (`MOVY_REDRAW_MIN_MS` is zero). `app/page-poll.ts` repainted only
when a drawn cell's VALUE or the page IDENTITY moved — right for a page whose
only change is data, and it gives an animation exactly one frame, at the instant
of the change, and nothing after.

**Fix.** `anim_state.mjs` is imported by `schwung-lib.ts` alongside its siblings
and its `settled(state, now)` is exposed as `SchwungPage.animating(nowMs)`
(`renderer/schwung-page-anim.ts`, split out of `schwung-page.ts` when that file
crossed its 200-line cap); `pollDrawnPage` asks it **only when the value and
identity comparisons both held still**, so a page whose values are moving is
decided exactly as before and an idle page pays one walk of the animation store —
a subtraction and a compare per animated key the page has ever drawn, since
`anim_state` only ever sets and never deletes. Cheap, but not an empty map.
`observe` stamps a FIRST sighting already past, so a page does not animate itself
in on arrival — only a real change starts a transition.

**The second redraw source, verified and disposed of.** The entry named
`ctl.onCanvasPage` as one, quoting a contract about the host redrawing every
tick. Read from the library, that is **wrong twice over.** (1) `onCanvasPage()`
(`page_controller.mjs:4572`) is `!!(page().canvas)`, a PURE PREDICATE with **zero
callers anywhere in `schwung/src`** — it is not a redraw source and there is
nothing to wire. (2) A canvas page is **unreachable under movy**: nobody supplies
the drawer (`grep -rn drawCanvasPage src/` → no hits, and `drawCanvasPageBody` is
`if (typeof io.drawCanvasPage !== "function") return;`), and no module in the
fleet declares one (`grep -c '"as_page"' docs/module-dump/device-dump.json` →
**0 of 95**; `page_plan.mjs:478` only builds a canvas page from `as_page`).
Nothing was wired for it. Worth knowing that the library's INTENT there is the
opposite — "a custom page is redrawn every tick precisely so it can show a live
value move" — so if SP-24 ever gives movy a canvas body drawer, this is a redraw
source again and the decision comes back with it. The third source, the trigger
flash, is real: `ctl.triggerFiredAt` is public, and `animating` asks
`buttonPhase` — the ONE definition of a bang's duration — about the stamps, so
`BTN_FLASH_MS` moving upstream moves both rather than being restated.

**The cost, measured on device, and this is the number SP-39 starts from.**
`scripts/measure-grid-cost.sh page`, `SECTIONS="idle knob" MODULE=plaits`, the
same instrument on both arms, before = `fff4f25` and after = this commit. Tick is
~190 Hz. Units: `tick_ms`/`period_ms` are milliseconds averaged over the probe's
120-tick window; `perf_phase` is **ms per tick, averaged over the same window**
(the clock is `Date.now()`, so 1 ms granularity — read it as "how much of the
window went into drawing").

| section | arm | tick_ms | period_ms | calls/tick | `render` phase |
| --- | --- | --- | --- | --- | --- |
| idle | before | 2.2–2.6 | 5.2–5.4 | 0.8–0.9 | absent |
| idle | after | 2.4–2.7 | 5.2–5.5 | 0.8–0.9 | absent |
| knob | before | 2.4–2.8 | 5.2–5.7 | 0.8–0.9 | 0.2 ms/tick in 1 window |
| knob | after | 2.4–3.9 | 5.2–6.8 | 0.8–0.9 | **0.7 ms/tick in 1 window** |

**The animating window costs 0.7 ms/tick of `render` against 0.2 before, and the
knob section's worst tick goes 2.8 → 3.9 ms and its worst period 5.7 → 6.8 ms
(+19%).** `calls/tick` is identical in every cell: **this adds no host call**, it
makes more use of the frames movy already draws.

**Read that headline as a FLOOR, not a representative.** It is plaits — 2 pages,
the smallest shape in the fixture — so it is the CHEAPEST page this can be
measured on, and a 70-page component (minijv, where the lag was reported — 72 was
wrong, corrected by SP-39) is where a larger per-frame draw would be expected.
**That expectation is NOT a measurement, and SP-39 has since run this method on
minijv and found no animating window there at all** — so the scaling it implies
is neither measured nor falsified, and the claim that the cost does not scale
with page count is WITHDRAWN. See SP-39's entry for the run. It is also n=1 window per arm at a **1 ms-granularity**
clock, where `render=0.7` means "~84 of the window's 630 ms went into drawing"
rather than a per-frame time. The direction of the change is what is solid; the
magnitude is a lower bound. **This is what SP-39 started from, and it ran the
same method on minijv: no animating window, so this floor still stands alone and
no larger-module number replaces it.**

**The decisive raw lines**, so the claim can be checked without a device:

```
# knob section, BEFORE (fff4f25) — 8 windows
seqengine=0.6 rest=0.5 ctltick=0.4 ctlpoll=0.3 buildvm=0.2 render=0.2

# knob section, AFTER (this commit) — 7 windows. The animating window is the
# FIRST of them, and it is also the section's worst tick:
calls/tick=0.9 peak=10 ipc_ms=2.0 tick_ms=3.9 period_ms=6.8 peak_period=26 | …
seqengine=0.7 render=0.7 buildvm=0.6 rest=0.5 ctltick=0.4 ctlpoll=0.3

# idle section, BOTH arms — 19 windows each, and no `render` line in either
calls/tick=0.9 peak=9 ipc_ms=1.8 tick_ms=2.5 period_ms=5.3 peak_period=16 | get overtake_dsp:* n=0.3 ms=0.6 | get synth_module n=0.2 ms=0.4 | …
```

(A window is logged TWICE — `[shadow]` and `[move-shim]` print the same line —
and `measure-grid-cost.sh:148` greps the whole log, so **raw line count ÷ 2 IS
the window count**, and neither the raw count nor a deduplicated count is.
Verified against the raw files: all 38 before-arm idle lines are exact adjacent
duplicate pairs, **19 windows, none mismatched**; the same for the after arm, and
for the knob section (16 → 8 before, 14 → 7 after). An earlier revision reported
idle as 18/19 from a `sort -u` of the raw lines; the 18 came from one before-arm
line text occurring **four** times, i.e. two DISTINCT windows that happen to be
byte-identical, not a mismatched pair. Medians and ranges are unaffected.)

(`perf_phase` prints only the six largest phases, so a phase that is absent is
not in the top six — i.e. ~0. The two arms' idle `tick_ms` **medians are both
2.5**: identical, not merely overlapping.)

The idle section is unchanged
and carries no `render` phase in either arm; the after arm's 2.4–2.7 range
extends **0.1 ms above** the before arm's 2.2–2.6 (so it is not "inside" it),
both medians are equal at 2.5, and the delta is below the instrument's 1 ms
granularity — so the idle claim rests on the equal medians, `calls/tick` and the
absent phase, not on that delta. Exactly
one `perf_phase` line per section can carry the animation — 120 ms of transition
inside a ~630 ms report window — which is the expected shape, not a weak signal.
Method, commands and the resolution limits: `.superpowers/sdd/schwung-page-migration/sp38-measurement.md`.

**The one way this can invert into a permanent cost, named rather than feared.**
`settled()` is "nothing was stamped within the last 120 ms" and `observe` stamps
whenever a value's string differs from the last one seen, so **an observed key
whose value moves inside every 120 ms window never settles** — the page redraws
forever at the full 0.7 ms/tick instead of standing still. The threshold is a
FREQUENCY (~8 Hz), not a per-render change: a 10 Hz LFO does it, a 2 Hz LFO does
not.

**The route is a MODULATED or `live` param the drawn page shows — and an earlier
revision of this entry said the opposite, which is why the chain is written out.**
The renderer MERGES BEFORE IT OBSERVES. `render_page_movy.mjs:2441` builds
`liveValues = {...values, ...modValues}`; the enum path hands
`shown = liveRaw ?? raw` (`:2160`) into `drawEnumSquare`, which observes `shown`
at `:1579`; the wave path passes `liveValues` to `drawVizGroup` (`:2516`) and
`drawWaveform` observes out of it (`viz_draw.mjs:1115`). So **both animated
widgets observe the MODULATED value**, and `modValues` is re-read from
`:effective` every tick (`page_controller.mjs:4148`, one key per tick) for every
key `modCache` flagged (`:2344` — which includes `live: true` params, not only
modulated ones). A host LFO on an enum-shaped or wave-viz param the drawn page
shows is therefore a **shipped** route to a permanently-redrawing page. The arc
knob is the only immune widget, and only because `drawArcKnob` (`:1237`) takes
no `anim` argument — not because of any `values`/`modValues` split, which does
not exist on the observe path. Second-order and still worth the check: a jittery
base enum, or a decoration feeding a raw value back into `enumw:` — **SP-36 must
be checked against this predicate before it ships.** All of it is written into
`renderer/schwung-page-anim.ts` beside the predicate.

**THIS EXPOSURE IS AN OPEN ITEM — SP-48 — not a footnote here.** It is a
regression this item introduced, it has a shipped route, a fix route and an
owner, and it is written up in the Open list below with the rest of them; the
chain above is its evidence. Its SP-47 interaction is the reason it carries a
release gate.

**Teeth, and a fixture trap worth keeping.** `browser-test/logic/page-freshness.mjs`
drives `pollDrawnPage` itself (`dist/esm/app/page-poll.js`, a new build entry
point, because a suite that drove a whole tick could not tell "the term is gone"
from "the fixture happened not to animate"): a still page asks for no frame; a
render feeds the store; nothing is stamped at the instant of arrival; and then an
A/B **on one field** — every `anim.since` stamp placed at `now` vs 10 s in the
past, which is the `!moved` term and nothing else. `browser-test/app-loop.mjs`
counts `render` calls end to end: no frame while idle, frames until the
transition settles, none after. **Removing the term reddens exactly the
assertions that name it** — logic: `a page mid-transition asks for a frame` and
`a trigger bang asks for a frame` (`expected true, got false`), every control
green; app-loop: `...draws frames until the transition settles (1 frames over
5001 ticks)`, with the idle and settled checks green. Restored, all pass.
**The trap:** the square's frame travels to the WIDTH OF THE NEW LABEL
(`enumw:` observes `enumSquareWidth(text)`, a pixel count), so this block first
wrote `mode` `0`→`2` — "LP"→"HP", the same width — and the check failed against a
CORRECT fix. `0`→`3` is "LP"→"Notch", 17 px → the 28 px cap. **A fixture for an
animated widget has to change the thing the widget animates, not merely the
value.**

**What is NOT covered — the loss, stated.** `settled`'s default window is 120 ms,
which is LONGER than one of the durations it is asked about (`WAVE_MORPH_MS` 100)
and equal to `ENUM_ANIM_MS`'s 120; `BTN_FLASH_MS` 300 and `BTN_PRESS_MS` 120 are
at or above it, so the bang half is unaffected. So a 100 ms wave morph over-draws
by up to ~20 ms. Bounded,
self-limiting, and cheaper than re-deriving per-key durations in movy — but it is
real and it is the one place the two clocks disagree. **Not measured on a large
module:** plaits is 2 pages and the smallest shape in the fixture, so the
per-tick cost on minijv (70 pages, where the lag was reported) is unknown and
should be expected to be HIGHER — it is the first thing SP-39 should re-run.
**SP-39 re-ran it, and the re-run did NOT MEASURE an animating window — so the
large-module expectation above is neither confirmed nor falsified.** On minijv
`SECTIONS="idle knob"` (70 pages) the only `render` that clears the six-phase
cutoff anywhere in the run is `0.2 ms/tick` in one 120-tick window — the same 0.2
this entry records for plaits BEFORE the fix. **An identical run with this
entry's `pollDrawnPage` term stashed (`page-poll.ts`'s `page.animating(...)`
removed) came back with the SAME single window** —
`ctlreload=0.7 rest=0.6 seqengine=0.6 ctlpoll=0.4 render=0.2 ctltick=0.2` — and
**no `buildvm` line in either run**. That accompaniment is what says an animation
actually happened: on plaits the animating window carries `buildvm ≈ render` in
BOTH arms (`buildvm=0.2 render=0.2` before the fix, `render=0.7 buildvm=0.6`
after). **A window that survives the removal of the animation predicate is the
knob turn's own value-change redraw**, and a section that never triggered a
transition is indistinguishable from a cheap one. So the cost on a large module
is **NOT MEASURED — neither scaled nor falsified** — and the 2-page floor below
is still the only number this item has. (A plausible reason nothing animated:
`drawArcKnob` takes no `anim` argument, so a knob section whose cells draw as
arcs triggers no transition at all — recorded as the likely cause, not as a
finding.)
Documents: `MANUAL.md`/`README.md` were **not** touched, because under
`schwunggrid` the row is still internal (`off` is the default; the opt-in release
is SP-47) and nothing a user reads has changed.

**Closure evidence.** `SCHWUNG=../schwung npm test` exit 0 (typecheck clean);
`page-mode: 3 of 3 expected failures remain` (the list not edited); the device
tier with the flag at `off` — **18 scenarios, 143 checks, 0 failed**, exit 0,
with one `⚠ FLAKY` (`seq`: `capture-fixed-notes` / `capture-select-tempo` did not
log the fixed-tempo path on attempt 1 and passed on the retry — a MIDI-capture
flake, nothing this item reaches, and the flag was `off` so the new predicate was
inert for the whole tier). The tier was re-run after the fix round — which split
`animating` into `renderer/schwung-page-anim.ts` — and came back **18 scenarios,
143 checks, 0 failed, no flake at all**, so that split is behaviour-preserving at
the device tier too. Baselines: **no scene moved and `--update` was not
run** — SP-38 changes nothing about what a settled page draws, which is the same
reason the idle half of the measurement is unchanged.

**Needs:** nothing. SP-39 inherits the method.

---

### SP-39 ✅ 2026-09-19 — a pad press onto an unread page paid eight blocking reads; it pays one bulk request, and the rest of the gap is not the gesture

**Symptom.** On a drum track, a pad press turns the page to that voice's page.
Under `page` that switch is reported as noticeably slower than movy's own
(`off`). It is the most-used gesture on a drum track, so the complaint is about
a gesture, not a frame rate.

**Measured first, and the measurement named suspect 1.** `perf_phase`'s
`ctlpoll` / `knoblevels` split with a pad press as the event, the same build
under both arms, `scripts/measure-pad-page-latency.sh` (`MODULE=cw78`, track 0,
ms/tick averaged over the probe's 120-tick window):

| section | arm | calls/tick | ipc_ms | tick_ms | period_ms | peak_period | `padpage` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| idle | off | 0.6 | 1.0–1.4 | 1.6–1.8 | 4.7–5.0 | 16 | — |
| press | off | 0.6–0.7 | 1.2–1.5 | 1.5–2.0 | 4.8–5.1 | 15 | — |
| idle | page | 1.3–1.4 | 3.0–3.5 | 3.1–3.4 | 6.0–6.3 | 23 | — |
| press | page | 1.3–1.7 | 3.1–3.9 | 3.1–3.8 | 6.0–6.8 | 27 | **0.1–0.2** |

Twelve alternating presses per section; the page arm's preflight asserts the
gesture, not just the module — `drumPad note=71 pad=4` (the pad addressed a
voice) and the body's `at=` changing (`at=0 -> at=4`, the page turned). Suspect 1
was the mechanism: `ctl.goToPage` runs Schwung's `warmCurrentPage()`
synchronously, which asks for every key of the arriving page it does not hold,
**one `getParam` at a time**, and movy's epoch cache cannot see it coming —
`batchKeys()` iterates `entries`, and a key enters `entries` only by being asked
for, so the first read of every cell of a new page is a live single round trip.
Suspect 2 (`focusVoice` re-reading) is the 0.1–0.2 ms/tick of `padpage` and is
the small half; suspect 3 (no frame until something moves) is not in the numbers
— the page identity change does dirty the frame.

**Fix.** `schwung-page-cache.ts` gains `warm(keys)` — one `port.getMany()`, ONE
bulk round trip, seeded at the current epoch so the controller's asks are hits —
and `focusVoice` reaches a page through a new `jump(i)` helper
(`renderer/schwung-page-input.ts`) that hands the target page's keys over BEFORE
`ctl.goToPage(i)`, qualified the way `io.getParam` qualifies what the controller
asks for. `renderer/schwung-page-batch.ts` holds the batch policy (`fill` and
`warm`), split out of the cache so both files stay under the 200-line cap.
Schwung's behaviour is unchanged — it still asks one key at a time; the warm is
the cache's own half of the same contract (SP-26), so this is movy's file and not
an upstream PR.

**Teeth, measured.** `browser-test/logic/schwung-page-press.mjs` (moved out of
`schwung-page.mjs`, which was at the browser-test ceiling with the block in it)
counts the round trips across a `focusVoice` onto a page the session has never
read, with the harness's `countTripKinds` — bulk and single counted SEPARATELY,
because a total alone cannot tell "moved off the single-key channel" from "got
cheaper for another reason". With the `warm` call replaced by `void keys`: **0
bulk / 9 single** and both assertions red (`expected 1, got 0`, `expected 1, got
9`). Restored: **1 bulk / 1 single** and green. The one residual single is
`focusVoice`'s own contract lookup (`synth:ui_pages`, rung 2 of the ladder,
unserved and so uncached — a null is never cached); it is asserted as exactly 1
so a second one appearing is visible.

**What the device numbers say the fix did and did not change — and the honest
headline is: the CALL PATTERN is fixed, the device effect is WITHIN NOISE, and
the worst frame is UNCHANGED.** The pre-fix run stands beside the post-fix one
here; both arms, same module (`cw78`), same script, means of the window lines
each section printed (`perf_phase` is ms/tick averaged over a 120-tick window):

| section | arm | calls/tick | ipc_ms | tick_ms | period_ms | worst `peak_period` |
| --- | --- | --- | --- | --- | --- | --- |
| idle | `page` | 1.34 | 3.22 | 3.22 | 6.11 | 23 |
| idle | `off` | 0.60 | 1.25 | 1.68 | 4.84 | 16 |
| press | `page` **PRE** | 1.69 | 4.12 | 3.66 | 6.64 | 26 |
| press | `page` **POST** | 1.54 | 3.66 | 3.49 | 6.47 | **27** |
| press | `off` **PRE** | 0.62 | 1.35 | 1.80 | 4.98 | 21 |
| press | `off` **POST** | 0.63 | 1.35 | 1.81 | 4.95 | 15 |

`calls/tick` 1.69 → 1.54 and `perf_ipc` 4.12 → 3.66 ms move the right way and sit
inside the spread BETWEEN SECTIONS of the same arm (idle `page` is 1.34/3.22 and
press `page` is 1.54/3.66), so they bound the fix rather than measure it. **The
worst frame did not move: 26 → 27 ms.** The section alternates TWO pages, so at
most the first press onto each page is cold — the other ten presses were already
warm, and were always going to be: what this item removed was the cold one, and
there are two of them per section. That is why the mock is where the win shows
and the device is where it does not.

The press's synchronous cost is `padpage` = 0.1–0.2 ms/tick in the three windows
that hold presses under `page` (one window at 0.2 before the fix, three at
0.1–0.2 after — more presses clearing the cutoff, not a dearer press), and absent
under `off`, where the code path does not exist. **The page-vs-off gap is present
at IDLE** — worst period 6.3 vs 5.0, `calls/tick` 1.4 vs 0.6, tick 3.2 vs 1.8 —
so it is the delegated renderer's standing per-tick cost (`ctltick` 0.8,
`ctlpoll` 0.5, `ctlreload` 0.2–0.3 and the extra `overtake_dsp:*` / `ch0:*`
reads), **not** this gesture, and it is **not a claim about this fix**: it is
opened as **SP-49**, and the numbers above are that row's evidence too. The
gesture-shaped cost was the eight per-cell reads, and that is what the warm
removes.

**The SP-38 re-run this item owed, on a large module — and it MEASURED NO
ANIMATION, so SP-38's large-module cost is not measured here in either
direction.** `MODULE=minijv SECTIONS="idle knob"`, 70 pages: the only `render`
that clears the cutoff in the whole run is **`render = 0.2 ms/tick` in exactly
one 120-tick window**, the same 0.2 SP-38 measured on plaits BEFORE its fix (where
it went to 0.7). That was read as SP-38's animation on the first pass and it is
not: **the run was repeated with SP-38's `pollDrawnPage` term stashed and the
same single window came back unchanged** —
`ctlreload=0.7 rest=0.6 seqengine=0.6 ctlpoll=0.4 render=0.2 ctltick=0.2` — with
**no `buildvm` line anywhere in the run**. The `buildvm ≈ render` accompaniment is
what says an animation actually happened (on plaits: `buildvm=0.2 render=0.2`
before the fix, `render=0.7 buildvm=0.6` after), and a window that survives the
removal of the animation predicate is the knob turn's own value-change redraw. So
**"the animation cost does not scale with the page count" is WITHDRAWN — it is
NOT MEASURED, not falsified**, and SP-38's own entry now says so. What the run
DID establish stands: minijv's standing delegated cost (`ctlreload` 0.7 ms/tick at
idle) is larger than the whole window it was being asked about, and the probe's
clock cannot resolve below it.
The default five sections were NOT usable here: on a 70-page component a
10-detent jog does not walk off a small component, it walks the CHAIN
(`midi_fx1 → fx1 → fx2 → lfo → mix` and back), so all four gesture sections came
back INVALID — a finding about `measure-grid-cost.sh`'s documented model, left as
a NOTE for whoever owns it. **The page count is 70, not the 72 the ledger and
that script's header claimed** (`schwung-body ok track=0 ck=synth pages=70`, and
`docs/module-dump/params-exposure-audit.md:106` agrees); the stale 72 was
corrected here and in the script's comments.

**Read the cw78 measurement as a PROXY, and say so out loud.** The measured
gesture is a **rack pad on `cw78`, not a drum-track pad.** The device fixture's
drum module (`mrdrums`, track 1) declares no note map at all — no `child_note_base`,
no note hierarchy — so `voicesOf` finds nothing, `focusVoice` has no page to
follow and the literal gesture does not exist there; and of the 95 modules in
`docs/module-dump/`, only `sound_generator--voice-poc.json` declares a note map,
so **no faithful drum-track substitute exists without changing the fixture,
which is out of this item's scope.** What transfers from a rack pad: the per-cell
and per-frame mechanism (`goToPage` → `warmCurrentPage` → one `getParam` per
unread key → movy's cache), which is the same code path for any voice-declaring
module, and the shape of the cache miss. What does NOT transfer: `focusVoice`'s
own ladder walk and VOICE COUNT (a drum module would have more voices, more
levels and possibly a different page set), and anything specific to the drum
path's voice count or config translation (SP-14). A drum-track number could
still differ in magnitude; nothing here bounds it.

**The SP-48 trap, checked rather than assumed.** SP-48 says a modulated or
`live` param the drawn page shows redraws the page forever at ~0.7 ms/tick, which
would make any window I compared unfair. The cw78 page arm emits **no `render`
phase in any window at all** (the phase only clears the six-phase cutoff when the
page actually redraws; under `off` on the same module it appears as `render=0.0`),
so the cw78 page is not modulated and the A/B above is not contaminated. The one
`render` that does appear anywhere in this item's data is `0.2` in a single
minijv `page / knob` window, i.e. a redraw a knob turn caused — not a
never-settling page. The control run confirms it by removing the other
candidate: with SP-38's animating term stashed the same window is still there.

**Not covered.** (1) A drum-track pad, as above — the number is a rack's. (2) The
mock serves a value for every cell of every page; a module that answers `null`
stops Schwung's walk at that key, which the mock deliberately does not do. (3)
The 120-tick window at a 1 ms clock: `render = 0.2` means ~24 ms of a ~700 ms
window, not a per-frame time, and `padpage` is an average over ~3 presses per
window, so it bounds a press rather than timing one. (4) `off`'s body guard is
the constant `schwung-body mode=off`, so an unattributed stall inside an `off`
section cannot be told from the log — the minijv `off / knob` window with
`peak_period = 483 ms` is recorded and left unexplained (its size matches its
`modeltick = 4.2` × 120 ticks to within 4%, which is why it reads as the module's
view-model build, i.e. `off`'s own cost and not SP-39's). `MANUAL.md`/`README.md`
were **not** touched: under `schwunggrid` the row is still internal (`off` is the
default; the opt-in release is SP-47) and nothing a user reads has changed.

**NOTES — one latent gap, two traces, one device fact.** Recorded rather than
fixed, each for a reason.

- **The warm covers the concrete keys only where the rack declares them — and
  the one fleet module that reaches the branch does not.** On a child-level page
  `jump` resolves each alias through Schwung's own
  `resolveChildKey(p.childLevel, childIndex, k)` before qualifying it, which is
  the controller's own mapping (`page_controller.mjs:853`), so what it warms is
  the SHAPE the controller reads — but only when the page carries a `childLevel`
  AND the voice carries a `childIndex`; with either absent the alias goes over
  as-is and the warm covers keys no read looks up.
  **ONE MODULE IN THE FLEET REACHES THIS, AND IT IS INSTALLED: `voice-poc`.**
  It is the only one of the 95 modules in `docs/module-dump/` declaring
  `child_note_base` (`modules/sound_generator--voice-poc.json:165`, `status`
  `"ok"`), it is already bucketed in `browser-test/fleet-expect.json` →
  `voiceDeclaring`, and its `pads` level declares
  `child_count: 4, child_index_base: 1, child_note_base: 60, child_key_template:
  "p{index}_{key}"` — with **no `child_index_param`**. That last absence is the
  reason, and it is stronger than "no module arrives": `schwung-page-input.ts:167`
  writes the index only where the level declares a param, so `focusVoice` writes
  nothing, `syncChildIndexFromModule` returns early without one
  (`page_controller.mjs:3981`) and the controller resolves the child at instance
  0 (`childIndexFor`, `:817-820`) while `concrete()` resolves at `v.childIndex`.
  On pads 2-4 the warm therefore covers `p2_vol`/`p3_vol`/`p4_vol` while the
  controller reads `p1_vol`: **the press still pays its singles on the only fleet
  module that reaches the branch.** State plainly, because this reads like a
  regression and is not one: pre-fix behaviour was identical, no wrong value is
  ever cached (entries are keyed by the CONCRETE key), and the worst case is at
  most four wasted reads per press.
  **The recheck trigger is SP-50, not a module arriving — the module is already
  here**, and the two halves are one root (movy and the controller disagreeing
  about WHICH child is showing). Recheck it there, against the press suite in
  `browser-test/logic/`, not by hand. `browser-test/fleet-pages.mjs` is where
  the module is already COUNTED (`voiceDeclaring` is a baselined census there,
  fed by `fleet-expect.json`) — but that is a plan-level census, and this is the
  press/input path, which is why it passes today with the gap open.
- **The jog path is NOT warmed, and that is a traced decision.** `changePage` →
  `ctl.onJog` does not reach `goToPage`: `onJog` sets `s.pageIndex` through
  `page_nav`'s `step`/`stepLevel`/`restoreSection` and calls `warmCurrentPage()`
  itself (`page_controller.mjs`), so it pays the same singles — but it lands on
  the NEIGHBOUR, the one page the controller's own neighbour-prefetch lane exists
  to keep warm (`PREFETCH_HOLD_TICKS = 12` after a page change), where a pad jump
  lands on an arbitrary voice's page. A warm would also have to name the landing
  index before `onJog` computes it (menu and picker branches return without moving
  at all). Left as it is; `schwung-page.ts` carries the comment.
- **`BATCH_VALUE_MAX` is applied when pruning, and that is the only site where
  it can do anything** — recorded because it reads like an asymmetry and is not
  one. The claim that stood here (`warm` seeds an entry at the current epoch with
  `len` unset, so an enormous cell can enter the batch for one window) is false:
  `warm` pushes keys and calls `apply`, and `apply` records the length from the
  value it read — `schwung-page-batch.ts:128`,
  `entries.set(keys[i], { value: v, epoch, asked: epoch, len: v.length })`. There
  is no other seeding path in `renderer/` (`grep -n "entries.set"` → that line and
  `schwung-page-cache.ts:124`, both `len: v.length`) and `paramGetMany` returns
  whole values (`host/param.ts:130-135`), so an entry — warm-created or
  cache-read — carries `len > BATCH_VALUE_MAX` the moment it exists and is
  excluded by the pruning check above it. No second size policy is needed
  because there is nothing for one to catch; `schwung-page-batch.ts` records it
  at the site.
- **The device's `prefs.json` carries a stale TOP-LEVEL `"schwunggrid": 0`** from
  an older arm, beside the live `flags.schwunggrid`. It is **INERT** —
  `readPrefFlags()` reads `prefs.flags` only and every script here writes `flags`
  — but it reads like a second source of truth. Recorded so the next session does
  not chase it, and does not "tidy" it by hand on the box either.
- **The idle gap is SP-49's**, not this item's: it was opened as its own row
  rather than left here, because it is present with nothing moving and is a
  latency cost rather than this gesture's.

**Needs:** nothing. Measurement handover: `sp39-measurement.md`.

---

### SP-35 ✅ 2026-09-19 — a held step keeps the page, and the lock lands on the drawn cell

**Symptom.** Hold a step to edit automation under `page` and the screen showed
**movy's** parameter page, not the one you were just looking at — the parameters
move under your hand at the exact moment you are choosing which one to lock, and
what you lock is chosen by POINTING at it. Finding #1 of the twelve reported from
the device (2026-09-18). It is the one gate item that is a REVERSAL: SP-33 had
closed the opposite defect — the screen said movy and the lock landed on
Schwung's parameter — by handing the held step's whole page back to movy.

**Cause.** SP-33's gate was `live = page.ready && !seqState.stepAutoMode`
(`app/page-owner.ts`). `seqState.stepAutoMode` **is** `auto.held` (the automation
view, `app/tick.ts`), and `decorationsFor` (`renderer/schwung-page-decorations.ts`)
returns null unless `auto.held` — so it could only ever be non-null on a frame
where the delegated page did not render. **SP-18's whole p-lock decoration pass —
the 2×2 mark, the inverted band, the decoration's value replacing the live one —
was unreachable in production.** The entry said "verify this before building
anything: it is read from source, not measured", and it was right to: as a failing
test first, wrapping `ctl.setDecorations` and holding a step with a lock live gave
**0 calls for the entire hold** — the seam SP-18 reaches Schwung through is never
called. Two more things the gate was costing, both measured: a knob turn under the
hold bound the lane to MOVY's key while the page drew another (`alabel 0 0
synth:p1` with `p9` on screen — the mis-target SP-33 was supposed to have ended),
and the screen changed identity at the moment of the gesture.

**Fix.** **(1)** `live()` is `page.ready`; the `step-held` reason branch went with
it, and ONE accessor keeps ONE answer — SP-33's invariant is kept, only its
direction reversed. **(2)** The "cannot take a lock" filter is **movy's own chrome
at the gesture site**, which was the ruling. No decoration is written for it:
`locked` means a lane holds this PARAMETER, and setting it on a cell nobody locked
is the lie SP-16 removed; `renderer/label.ts` is not grown (standing rule 1). A
held-step turn on a non-automatable param is **consumed and toasted** — `NO LOCK:
<key>`, from `seq/automation.ts`'s `!info.automatable` branch, so there is still
exactly one statement of "this param can take a lock". That is also where the real
harm was: an unconsumed turn falls through to `owner.page.knobTurn` /
`model.handleKnobDelta`, i.e. it **rewrote the patch** under a hand that believed
it was taking a lock. `info.ioKey` is what is named, because under `page` that is
the key the person is looking at.

**What is NOT covered — the loss, stated.** The PROACTIVE half of the filter is
gone under `page`: a non-automatable cell is no longer dimmed or hidden, because
that only ever existed inside movy's body drawer (`hiddenDuringHold`) and the body
is Schwung's now. movy's chrome can say the refusal at the moment of the gesture
and cannot say it per-cell without writing the lie above. **SU-8 is the recorded
follow-up**, not an invented channel here. Two halves that DID need nothing: the
pool-full case is already said by movy's own `8 AUTOMATION LANES — FULL` toast
(its app-loop check passes in the `page` arm today, which is the evidence that the
toast channel survives delegation), and the live lock reading is untouched — both
renderers resolve it from the same `auto.heldValues`.

**Teeth.** `browser-test/app-loop.mjs`: the SP-33 block's checks replaced by their
opposites **in the same commit** — the ledger named two, there were **three**
(`a held step keeps movy reading its own page` also asserted the reversed
behaviour, and left alone it would have taken the burn-down to 4) — plus a new
block that holds a step and counts `ctl.setDecorations` at its one seam into
Schwung and asserts `alabel 0 0 synth:<the page's key>` and NOT `<movy's key>`.
**The jog is the teeth**: this fixture's two planners agree on all eight cells
(`differing slots: 0`), so the block jogs the delegated page first and the two are
then apart (`p9` on the page, `p1` in movy's bank 0 — the fixture premise is
asserted, gated on the arm that can have it). RED before the fix, `page` arm: 11
failures, all eight new/replaced checks among them — `expected true, got false`
for the page, the decoration and the lock target, and `...and not to the key
movy's planner had in that cell: expected false, got true`. `browser-test/
logic/automation.mjs`: `non-automatable not consumed` is inverted under a held
step and keeps its old answer with no step held. Teeth proven by REMOVING the
refusal: `non-automatable under a held step IS consumed: expected true, got false`
and `...and says why: expected "NO LOCK: sample", got "Length 4"`; green again on
restore. This is a second app-loop check the ledger did not name, and its
replacement is what keeps "N must not grow past 3" true.

**Fix round 1 (review).** The refusal's gate was `seqState.stepAutoMode` — "already
promoted" — and promotion is TIME-based (`stepAutoTick`, `STEP_AUTO_MS = 300`), so
a turn arriving inside that window was refused-but-not-consumed and edited the
patch: the exact harm the gesture-site design was chosen to prevent. It is now the
same admission test the lock itself uses, `stepAutoMode || (!recArmed &&
heldRange() !== null)`, read without `beginStepAutomation()`'s side effects so a
refusal does not promote. Deliberately NOT `anyStepHeld()`: `hold` is reused by
step record, the step page and drum multi-presses, where a turn is a legitimate
edit — and `heldRange()` is null for a multi-press, while the step page returns in
`midi/router.ts` before this function, which is what keeps the term no wider than
the claim. `recArmed` is excluded because under live record a turn is a take, not
an assign. Teeth: `non-automatable held-but-unpromoted IS consumed` is red with the
width removed (`expected true, got false`) and green with it, and the two neighbours
are guards rather than teeth — the live-record one passes either way.

**Baselines.** ONE scene changed, and it is the only one that asks the app for the
body under a hold: `page_held_unassignable`, 470 px — movy's held-step body (one
cell, `SENSITIVITY`, every other cell hidden by `hiddenDuringHold`) replaced by
Schwung's page (`KEY` / `INVL` / `SENS` / `HOLD`), with the scene's comment
rewritten to say what it now grades. The other **174** scenes are pixel-identical,
and the other eight `page_*` scenes call `sp.render()` directly and grade the
renderer, which is not what changed; `git status` after the update shows exactly
one baseline file modified. No blanket `--update` was needed to establish that.

**Gates.** `SCHWUNG=../schwung npm test` → 0 failures, all suites, screenshot
175/175; `SCHWUNG=../schwung node browser-test/page-mode.mjs` → `page-mode: 3 of 3
expected failures remain` / `PAGE-MODE LEDGER UP TO DATE` (all three are the
mrdrums-fixture page-plan limit, unrelated). **The device tier did NOT run**, three
attempts, always blocked before any scenario: the box had rebooted onto a cold
chain (finding #12's hazard) and the shim's boot instantiates **slot 0 only** —
schwung's own shadow UI reports the mismatch 251 times (`autosave: slot 1 shim
reports empty but slot_1.json has chain — preserving (likely shim glitch)`), and
the remote-UI route cannot fill an uninstantiated slot, so `fixture.ensure()`
never establishes. `.test-out/` holds no artifact newer than the previous evening,
which is the proof no scenario started. Nothing in this item touches slot or chain
loading; the device half of its integration story is **NOT VERIFIED**. The box was
left quiescent with `prefs.flags.schwunggrid` restored to `2` (`page`).
`MANUAL.md`/`README.md` deliberately NOT edited: the `page` flag is not
user-visible yet (SP-47 ships the two-value switch), so there is no user-facing
change to document.


---

### SP-33 ✅ 2026-09-18 — a held step moved the screen and not the knobs (review of SP-18)

**ITS DIRECTION WAS REVERSED BY SP-35 (2026-09-19), and the fix is not being
un-done.** What SP-33 established — one accessor, one answer, so the body and
every gesture site cannot disagree — stands; SP-35 removed the second term of
`live()` and the gate now answers the same way under a hold as at any other time.
Which way that one answer points under a held step is the reporter's call, and on
hardware they want the delegated page to stay up. Read this entry for the
invariant; read SP-35 for what the answer is now and what the old direction cost
(SP-18's decoration pass, unreachable in production, measured at 0 calls).

**Symptom.** Under `page`, hold an **empty** step and turn a knob: the screen
shows movy's labels and the lock lands on **Schwung's** parameter — a different
one on every cell where the two planners disagree, which `midi/router.ts`'s own
comment counts at nine across the mock presets. A step with an OCCURRENCE under
it is unaffected: it opens the step page, which returns before either decision.

**Cause.** SP-18 put the held-step test in `app/tick.ts`'s `schwungBodyFor`, so
the BODY went back to movy. Every gesture site reads OWNERSHIP instead
(`pageOwnerOf`), and that still said `delegated`. Two files, one question,
different answers — the exact shape SP-10 exists to make structurally
impossible, reintroduced by putting a second gate outside the accessor.

**Fix.** The hold is part of the accessor. `delegateOwner` gates on
`page.ready && !seqState.stepAutoMode`, so `delegated`, `page`, `knobParamInfo`,
`changePage` and the page index all fall through to the movy owner together, and
`schwungBodyFor` derives the body from `owner.page` like the bank bar and the
chrome already do. `poll()` stays OUTSIDE the gate — the contract keeps settling
under the finger, so the page is current when the step is let go.

**Teeth.** `browser-test/app-loop.mjs`, "a held step hands the page back to
movy", which reddened under `page` before the fix (the `off` arm cannot see it —
nothing is delegated there) plus "...so the knob targets the parameter movy
drew". The refresh check the block was built for is unchanged and still passes.

---

### SP-34 ✅ 2026-09-18 — one page's widget cleared every other page's (review of SP-28)

**Symptom.** hank's waveform appears, then vanishes the moment any other
component's page syncs, and **never comes back** — not on return to the track,
not on a re-plan, only on a module swap into that same slot.

**Cause.** The registry is process-global and its only removal is
`clearWidgets()`, which empties **all** of it — there is no per-kind
unregister. `registerModuleWidgets` cleared unconditionally, including for a
module declaring nothing, which is right for the slot it is asking about and
wrong for every other. And it cannot recover: `createWidgetSync` latches
`widgetDone` on a settled answer, so the page that registered the kind is not
asked again until its own plan moves. One chain slot along and back was enough.

Reproduced against the real entry points and the real library — `custom:hank_wave`
available `true` after the synth page syncs, `false` after an fx page with no
custom kind syncs, still `false` on return.

**Fix.** movy keeps its own `kind -> { owner, draw, nominal }` map and the
library's registry is a PROJECTION of it: `setOwnerWidgets(owner, widgets)`
replaces only that owner's entries and replays the whole map. The owner is the
page's `(track, component)` — the key the page cache already uses — so a module
swapped INTO a slot still replaces exactly what the module before it left there.
Replay is cheap: the drawers are in memory, and nothing re-reads a file.

**Teeth.** `browser-test/logic/schwung-widgets.mjs`, "one registry, several
pages" — three checks red before the fix, with the property the clear existed
for ("a module swapped into a slot drops the departed module's kind") green
throughout, which is what says the fix did not simply delete the clear. Needs a
registry, so it is skipped and says so where there is no Schwung checkout.

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

### SP-20 ✅ 2026-09-18 — `ui_hierarchy` ownership: one reader, and the two divergences it was hiding

**Product.** The item was written as "no direct user-visible symptom — this is
the one that stops the other symptoms coming back". It had two, both live:

1. **`module.json` was invisible to the delegated page.** Schwung serves a SYNTH
   slot's `ui_hierarchy` from the plugin alone, so a module that describes its UI
   in its manifest (Sample Slicer is the case that found this in the model, years
   of device evidence behind it) arrives with none. movy's MODEL has read the
   manifest since the beginning; the page planner had its own ladder and did not.
   Under `page` that module's declared pages — a sample browser above all — were
   on no page at all, and the knobs held whatever `chain_params` paginated to.
2. **`"{}"` was a declaration to one reader and nothing to the other.** A module
   that serves an empty object (the device does; the `module_json_hier` mock
   copies it because that is what was observed) stopped the PAGE at rung 1 — no
   `ui_pages`, no manifest, no translation — while the model read it as nothing
   and climbed on. Same module, two page sets, and nothing that could notice.

A third, one layer down: `undo/module-dump.ts` asked `ui_hierarchy` and nothing
else for the module's declared `list_param`, so a module publishing its contract
under `ui_pages` or in its manifest declared no preset list as far as undo was
concerned. Its preset then dropped from tier 1 to tier 2 and was replayed AFTER
the params a preset rewrites — a restore that looks like it lost the patch.

**Fix.** `src/chain/hierarchy-source.ts` is the one reader: three rungs
(`ui_hierarchy`, then `ui_pages`, then `module.json`'s
`capabilities.ui_hierarchy`), one emptiness test (**a rung counts when it
declares LEVELS**, which was the model's test and is the right one), one
tri-state. `renderer/schwung-page-hierarchy.ts`, `model/hierarchy.ts` and
`undo/module-dump.ts` all climb it.

**NOT in `schwung-page-hierarchy.ts`, which is what this entry said it would
be.** `model/` may not import `renderer/` — stated in `model/config-hierarchy.ts`
and `app/page-owner.ts`, and the reason is that the model has to be testable
without a schwung checkout — so a shared ladder living under `renderer/` would
have been the layering rule traded for the file name. `chain/` is the layer all
three callers already import. The file name in the closes-when moved with it.

**Two things stayed where they were, deliberately:**

- **movy's config translation is not a rung.** It is the delegated page's own
  last resort (SP-14), because Schwung's planner needs a contract or it has
  nothing to plan. The model consumes `movy_config` natively through
  `buildConfigPages`, and handing it a translated hierarchy would make movy's own
  table indistinguishable from the module's own declaration — `readSurface` would
  read it as declared voices and outvote the table it was translated from.
- **`pending` is reported, not acted on.** The page reads through SP-26's cache,
  where `null` is a read in flight and answering for the module would latch a
  verdict (the fifth time this branch would have had that bug). The model and the
  dump read through a BLOCKING port, where `null` means the param does not exist.
  One ladder, two read semantics, and which applies is the caller's to say.

**Cost.** The levels test is memoized against the exact string it ran on, and it
has to be: `grid-cost.mjs` counts contract re-derivations on minijv and wants
**zero**, and parsing 39 KB to answer "did the module say anything?" put 75 of
them back on the reload divider — SP-27's cost, re-introduced one question
earlier. Caught by the gate, before the device. The manifest rung is a blocking
`host_read_file`, so it is read once per module id inside the source. Final
numbers are baseline-identical: premium 109 (ceiling 163), idle 146/600 ticks,
re-derivations 0.

**Teeth.**

- `browser-test/logic/page-owner.mjs` — the structural rule, beside the other
  ownership greps: over `src/**.ts` with comments stripped, a quoted
  `ui_hierarchy`/`ui_pages` literal or a `loadModuleJson(` call outside
  `chain/hierarchy-source.ts` (and `modules/loader.ts`, which DEFINES it) fails
  the suite, with the same stale-allowlist check its siblings carry. Proven by
  putting the dump's own reader back: it reddened on that file by name. The io's
  suffix test moved into the source as `isContractKey` so the file that routes
  the controller's ask holds no key literal of its own.
- `browser-test/logic/hierarchy-source.mjs` (new suite) — the ladder's answers:
  rung order, the levels test on both a text and a manifest, `pending` vs
  served-and-empty, the manifest read once per module id, and **the delegated
  page planned from a manifest** (`knobParamInfo(0).key` is the declared
  `sample_path`, not the `threshold` that `chain_params` paginates to). That last
  one is skipped, and says so, without a schwung checkout.
- `browser-test/logic/undo-restore.mjs` — a contract published under `ui_pages`
  still names the list param. Written against a module whose list is called
  `mode`, on purpose: the name fallbacks catch `preset` and `program` whatever
  the contract says, so a module that calls its list something else is the only
  thing that can tell the ladder from the guesswork. Both checks red with the
  old single-key reader restored.
- `page-mode` held at **3 of 3** and `SCHWUNG=../schwung npm test` exits 0.

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

**NOW THE SECOND RELEASE STEP, NOT THE FIRST (2026-09-18).** SP-47 ships the
flag visible with MOVY still the default; this item is the later flip, taken
*"when the users are happy"*. Everything below still applies to the flip —
the stored-flag rule, the full gate, the rack on hardware, the docs, the stated
revert — but the README headline and the first user-facing documentation now
land at SP-47, and what is left here is the default itself.

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

### SP-40 — the flag becomes two values: delete `body`

**RESCOPED 2026-09-18, and it moved from last to before the release.** It was
debt removal owed nothing by anybody and needed SP-30; it is now a
**precondition of shipping the flag to users** (SP-47), because the thing going
in front of them is a two-value switch — MOVY and SCHWUNG — and a middle value
that is a restyle is not something to explain to a user. The reporter's words:
*"I want to remove body option and to have a flag ui with just 2 values movy
and schwung."*

**Product.** Still nothing user-visible on its own; this is debt removal. `body`/DRAW is a
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

**THE STORED VALUE IS THE PART THAT CAN BITE, and it has to be got right before
anybody stores one.** `schwunggrid` is `min 0, max 2, def 0` with
`labels: ['MOVY','DRAW','PAGE']` (`src/seq/flags-def.ts`) and `MODES` in
`renderer/schwung-grid.ts` indexes that array. Dropping the middle entry makes
**2 out of range and 1 mean PAGE**, so a box whose `prefs.json` says 2 — every
device this has ever been tested on, including the reporter's — silently lands
on whatever an out-of-range read does. The flag entry's own `revisedAt` is the
mechanism for exactly this (`movy-chtracks-and-parallel-default`: a stored flag
beats a changed default), so the remap is part of THIS item, not of SP-47: 2→1,
1→0, and a stored value nobody can produce any more is not left to `??`.

**Closes when:** no `body` mode exists, the flag has two labelled values, a box
holding a stored `2` comes up on SCHWUNG and one holding `1` on MOVY (asserted,
not reasoned), `npm test` is green with regenerated baselines, and no file
references `schwung-body`.

**Needs:** nothing. It is now in FRONT of the release, not behind the default
flip.

---

### SP-41 — delete `off` and movy's page renderer. CONDITIONAL, and no longer assumed

**THIS IS NO LONGER THE ASSUMED END STATE (2026-09-18).** The reporter's plan
for the flag ends *"but it could be that I leave both"*. Two renderers kept on
purpose is a legitimate outcome — it is what the two-value switch buys — and
this item may therefore never be done. Nothing else in this ledger may be
written as though it will be: an item whose justification is "we are deleting
`off` anyway" has lost that justification until someone decides. The decision
is the user's and belongs in this entry when it is made.

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

**Needs:** SP-40, SP-30 having been live long enough to trust, and an explicit
decision that both renderers are NOT being kept — see the note at the top of this
entry.

---

## Proposed reprioritisation — 2026-09-17

**SUPERSEDED 2026-09-18 by the device findings section** — the order there is the
live one. Kept because the reasons below are still the reasons, and because two
of them (SP-19's "verify first", SP-21/SP-22's drop) are rulings rather than
orderings.

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

- **SP-39 ✅ 2026-09-19 — a pad press onto an unread page paid eight blocking
  reads; it pays one bulk request.** `warm(keys)` on the epoch cache + a `jump(i)`
  helper in `focusVoice` that hands the target page's keys over BEFORE
  `goToPage`, qualified as `io.getParam` qualifies them. Teeth: the jump costs
  **1 bulk + 1 single** against **0 bulk + 9 single** (`countTripKinds`, in
  `browser-test/logic/schwung-page-press.mjs`). On device (`cw78`, both arms,
  same build) `padpage` is **0.1–0.2 ms/tick** under `page` and absent under
  `off`, and **the rest of the page-vs-off gap is at IDLE too** (worst period 6.3
  vs 5.0 ms) — the delegated renderer's standing cost, not the gesture. **Two
  facts a later session would otherwise re-derive.** (1) **minijv is 70 pages,
  not 72** — the ledger and `measure-grid-cost.sh` both said 72; read back as
  `schwung-body ok track=0 ck=synth pages=70`, and the module-dump audit agrees.
  (2) **SP-38's cost on a large module is NOT MEASURED — neither scaled nor
  falsified**, and the claim that it does not scale with page count is WITHDRAWN
  (the full statement is in SP-38's own entry above, which is where it belongs).
  The minijv re-run **measured no animating window at all**: the single
  `render = 0.2 ms/tick` window that looks like one survives stashing SP-38's
  `pollDrawnPage` term unchanged and carries **no `buildvm` line**, where a real
  animation carries `buildvm ≈ render` in both arms on plaits. A window that
  survives the removal of the animation predicate is the knob turn's own
  value-change redraw, so it is evidence about the knob and not about animation.
  What the run DID establish stands: minijv's standing delegated cost
  (`ctlreload` 0.7 ms/tick at idle) is larger than the whole window the question
  was about. **And the measured gesture is a RACK pad (`cw78`), not a drum-track
  one** — the fixture's drum module declares no note map, and no drum-class module
  in `docs/module-dump/` declares one either (the ONE module that does,
  `voice-poc`, is a sound generator and is not in the fixture — see the NOTE
  below and SP-50), so the literal gesture is
  unreachable without changing the fixture. Per-cell/per-frame behaviour
  transfers; `focusVoice`'s ladder walk and voice count may not. **SP-48 checked,
  not assumed:** the cw78 page arm emits no `render` phase in any window, so the
  comparison is not against a forever-redrawing page.

- **SP-38 ✅ 2026-09-19 — an animated widget draws until it settles: `settled`
  asked by the repaint decision, and only last.** `anim_state.mjs` joined
  `schwung-lib.ts`'s imports and `SchwungPage.animating(nowMs)` asks it, plus the
  trigger flash through `buttonPhase`. `pollDrawnPage` asks only when the value
  and identity comparisons both held still, so an idle page pays one walk of the
  animation store — one entry per animated key the page has drawn, since
  `anim_state` only ever sets and never deletes. **The exposure this opens is
  SP-48, an open item, not a note here.** **Two facts a later session would
  re-derive.** (1) **The
  entry's `ctl.onCanvasPage` is not a redraw source** — it is `!!(page().canvas)`,
  a predicate with ZERO callers in `schwung/src`, and a canvas page is handed no
  `nowMs` (`{ touched, values }`), so it is a pure function of values and the
  value comparison already covers it. Nothing was wired. (2) **The clock must
  stay `Date.now()`** — `page_controller` takes `io.now || (() => Date.now())`
  and `schwung-page-io.ts` injects no `io.now`, so both sides of `settled` are
  stamped from the same source; supplying one re-points this line or a transition
  never appears to end. **Measured cost:** 0.7 ms/tick of `render` in the
  animating window against 0.2 before, knob-section worst tick 2.8 → 3.9 ms and
  worst period 5.7 → 6.8 ms; `calls/tick` identical, idle section unchanged with
  no `render` phase in either arm (**idle `tick_ms` medians equal at 2.5** in
  both arms). Read the cost as a FLOOR: plaits is 2 pages, the smallest fixture
  shape, and it is n=1 window per arm. Not covered: `settled`'s 120 ms window is
  longer than `WAVE_MORPH_MS` (100), and nothing was measured on a large module —
  minijv is SP-39's first step. **The inversion to watch:** an observed key whose
  value moves inside every 120 ms window (~8 Hz) never settles and the page
  redraws forever. The renderer merges `modValues` into `liveValues` BEFORE it
  observes (`render_page_movy.mjs:2441` → `:1579`, and the viz path at
  `viz_draw.mjs:1115`), so **a host LFO on an enum-shaped or wave-viz param the
  page shows is a shipped route**; only the arc knob is immune, because
  `drawArcKnob` takes no `anim`. A decoration feeding `enumw:` is the
  second-order one — SP-36 must be checked against this predicate.

- **SP-20 ✅ 2026-09-18 — one reader of the declared contract:
  `src/chain/hierarchy-source.ts`.** Three rungs — `ui_hierarchy`, `ui_pages`,
  `module.json`'s `capabilities.ui_hierarchy` — climbed by the delegated page,
  movy's model and the undo dump alike. **Two facts a later session would
  re-derive.** (1) It is NOT in `renderer/schwung-page-hierarchy.ts`, where this
  item's closes-when put it: `model/` may not import `renderer/` (the model has
  to be testable without a schwung checkout), and `chain/` is the layer all three
  callers already import. (2) **The levels test must be memoized against the
  string it ran on** — `levelsOf` on minijv's 39 KB contract, called from the
  reload divider, put 75 re-derivations back and reddened `grid-cost.mjs`, which
  is SP-27's cost re-introduced one question earlier. movy's config translation
  stayed OUT of the ladder (it is the page's own rung 4; a translated hierarchy
  in the model would let `readSurface` read movy's table as declared voices), and
  `pending` is reported rather than acted on, because the page's reads can be in
  flight and the model's and dump's cannot.

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
- **2026-09-19 — the same check, red again, and the window was the reason.**
  The 2026-09-13 fix taught the check to ignore samples with `params=0`, but not
  where the window should START or END, and the comment said the window was taken
  *before* the jog while the code read it *after* it. It wanted a loaded module in
  steady state; it got the stretch on both sides of the jog. The 2026-09-19 red
  artifact shows the window containing `loadHierarchy: slot=0 module=—` at
  13:27:44.339 and `ui_hierarchy null — no params` at :44.349, nine seconds after
  the fixture loaded — nine seconds in which the chain cursor had been jogged onto
  an empty chain slot, so the window was grading a slot that had been emptied from
  under it. Three reds in the 35 smoke runs recorded before this task, and no
  pattern to which sample
  caught it — `9edec30` went red at 10:18 and green at 10:30 on the same sha,
  which is the flake in miniature. Fixed by giving the check its OWN window (`refW`,
  not `w0`) that opens once the fixture's module has demonstrably loaded
  (`loadHierarchy: chain_params <n>` seen) and closes BEFORE the jog, and by
  closing it on a COUNT of measuring samples rather than a fixed frame budget, so
  the close condition and the assertion are the same helper. That second half is
  robustness, not a proven fix: restoring the old 2400-frame budget under the
  corrected window still passed on this box, and the code comment says so rather
  than claiming a red it never produced. The sample cadence is tick-rate-bound
  (344 ticks — 2.3 s at 151 Hz, 5.5 s at the 63 Hz floor), so the fixed budget is
  a bet on the device's speed that the count does not make. No threshold moved:
  `REFRESH_MIN_SAMPLES` is still 3, `REFRESH_MS_MAX` still 10.
  What it still does not cover, and did not before: `params > 0` proves the
  refresh had something to READ, not that it READ it — a refresh that stopped
  altogether emits `perf_refresh_ms=0 params=14` and passes on the median. The
  median catches a refresh that got slower; nothing here catches one that stopped.
  The same hole makes the check close to vacuous under `schwunggrid=page`, where
  SP-12 stops `refreshOneParam` for a delegated component — the tier's note that
  this check is only meaningful at 0 is load-bearing.
