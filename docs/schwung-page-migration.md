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
arrives, `applyKnobDelta` is never reached, and the sweep reports failures that
all read `writes: none` (or `0 commits`). Measured 2026-09-18 — the same `ui.js`
is `smoke` 9/11 at `schwunggrid=2` and 11/11 at `0`.
**None of the three depends on this any more.** As of 2026-09-19 each one arms
its OWN renderer through `test-device/arm.ts` (`probe.setGridMode(MOVY_ARM)` — the
override `page-lifecycle.ts` arms through, which writes no flag and so touches no
prefs), so the sweep no longer reads ambient `schwunggrid` state at all and
nobody has to set the flag before `npm run test:device`. Measured at the resting
`2`: `smoke` 8/11 → 11/11, `items` 4/7 → 7/7 (`commit-once`,
`reread-after-commit`, `selection-stuck`), `module-contract` 4/10 → 10/10 (the
six trigger-write checks), and the whole sweep is **18 scenarios · 143 checks ·
0 failed**, exit 0. `page-dive` and `page-lifecycle` arm `page` DELIBERATELY —
they grade the delegated path — and `widgets` arms its own; every other scenario
is arm-independent, which is why `mutes`, `sends` and the rest were already green
at rest. **The key is `flags.schwunggrid`**, because
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
| SP-37 | The header names the PAGE, not movy's bank — the right-hand end was `vm.drumPadName \|\| vm.bankName` while the bar above it already paginated Schwung's pages, so one set's name sat under the other set's bar (a constant, on a module whose movy config opens with a preset bank). `PageChrome.pageLabel` (`ctl.pageLabel()`) rides with the chrome `chromeFor` already withholds where the delegated page is not the drawn body, which is what keeps `off` byte-identical; `headerRightText(vm, chrome)` is `chrome?.pageLabel \|\| vm.drumPadName \|\| vm.bankName`, the pad name taking the FALLBACK — a pad name that leads names every page of its module with the same word, which is the same symptom on a declared drum rack (`voice-poc`), so the pad name wins only where the page IS that pad's page and the two words already agree. Teeth, each with the fix removed: the whole `\|\|` chain reverted → 11 logic checks red, `page_body_p2` red (79 px), `page_voice_pad` throws; the pad name put back on top → the same; `pageLabelFor` → null → **6** logic checks red, `page_body_p2` red (79 px), `page_voice_pad` throws — **and 6 is the whole count**: the six per-page `page N draws its own name` assertions SKIP in this arm rather than fail, because a null label is exactly the case the loop's `if (label === null) continue;` guard (`logic/schwung-page.mjs:417`) exists for, so what reddens is the three empty-array structural checks plus the three pre-existing label checks; `off`'s `setSchwungGridMode(null)` dropped → the off check red. **No measurement, and the label is not free:** one `ctl.pageLabel()` per rendered frame — an `s.pages.filter(...)` + template string on a child-level page — also paid and discarded on the chain view (`src/app/tick.ts:919`, `paging: false`); SP-49 owns that cost. **Not covered:** the held-knob branch is SP-17's code, pinned by two pre-existing scenes — demoting the readout below the label reddens `page_chrome_held` (726 px) and `page_chrome_flip` (721 px) — and `page_body`'s baseline did NOT move — test16's page 0 is named *Main*, the same word movy's bank says, so page 0 is the one frame where the two sets agree |
| SP-31 | A lost knob release latched the controller forever — the release is delivered to the page that heard the PRESS, through a knob-indexed ledger (`midi/knob-page-pin.ts`), never to whatever page is current. The (a)/(b)/(c) question the entry left open is settled **(c)**, with (a) refuted by measurement: the plan line is byte-identical with the pin, without it and at BASE, so this pin does not touch the plan; the `pct=1 ctlPages=1 names=Main` SP-17 recorded against a 3-page fixture was a pin reachable from somewhere other than the gesture, i.e. a stale page served as the current one. The three survivors stay a FIXTURE limit (SP-32). **Not covered:** the movy-MODEL half of the same gesture (`knobModel()?.handleKnobTouch/Release`) is still resolved at release time — **SP-51**, not this entry |
| SP-36 | The automation channel — under `page` an automated parameter is MARKED and its pointer stops chasing the lane: movy reports it through `isModulated`, answers `<key>:base` from its own record of what the user dialled in (`seq/automation-base.ts`, mirroring the `abase`/`abaseq` it already sends, seeded from the engine's new `abases` for a restored Set) and lets the live read answer `<key>:effective`. The controller does the rest — pointer at the base, a 5-pixel plus riding the arc — so **nothing upstream changed**. Two rulings, both the user's: `off` is **unchanged** (a deliberate divergence until SP-30) and the mark is the **tilde**, with the dot-vs-tilde grammar deferred to SU-8. `knobLevels()` now answers the DRIVEN value, without which nothing asks for the frame back and the mark freezes. ENGINE 0.80.0 |

### Open

**Order changed 2026-09-18** by the device findings section below: the user's
four release blockers come first, then the two-value flag, then the **opt-in
release** — which is now the milestone this ledger runs at, with SP-30's default
flip after it and SP-41 conditional on a decision nobody has made.

**SP-52…SP-56 were added 2026-09-20 and are a WAVE, not five more items in the
queue.** They extend delegation to the seven knob surfaces the flag has never
reached — the master chain, movy's own parameter pages — and they are ordered
after the release deliberately: none of them is a release gate, and the seam
SP-53 builds is worth designing against a renderer that has already been in front
of users. Their inventory, their route and the answer to "does this need upstream
PRs" (**no — zero are required**) are in *The pages that are not a track module's
— 2026-09-20*, below.

| id | item | model | state | order | release gate |
| --- | --- | --- | --- | --- | --- |
| SP-40 | the flag becomes two values, MOVY and SCHWUNG; `body` and the `.off` stand-ins deleted | Sonnet | ✅ | **7** | ✔ |
| SP-47 | **NEW** — the opt-in release: the row goes in front of users, default still MOVY | Sonnet | ⬜ | **8** | — |
| SP-48 | a modulated or `live` param the page shows keeps it redrawing forever. **A regression SP-38 introduced** — fixed with a movy-side repaint cap (`src/app/repaint-cap.ts`), the flag must not reach testers with it open (now satisfied) | Sonnet | ✅ | **7.5** | ✔ |
| SP-49 | An IDLE `page` tick costs half again what an `off` tick costs. **Attributed on `minijv` (70 pages): the WHOLE gap is downstream of `ctl.reloadIfChanged()` (SU-14) — stashing that divider out collapsed calls/tick 1.1→0.6, worst period 6.1→5.4ms, both matching `off` exactly.** Local fix landed: `RELOAD_POLL_TICKS` 8→16 (`src/renderer/schwung-page-contract.ts`), confirmed on device to roughly halve `ctlreload` (0.8→0.4ms/tick) and the standing gap (worst period 6.1→5.7ms). **Does not clear the ~10% closure bar** — residual is SU-14's own cost, amortized wider; needs SP-47's explicit acceptance or SU-14 landing | Sonnet | 🔨 **partial, 2026-09-20** | **7.7** | ✔ |
| SP-50 | On a child-level page movy and the controller disagree about WHICH child is showing. **Fixed movy-side, both halves**: `jump`'s `concrete()` now warms at `ctl.childIndexOf(level)` when the level owns no write channel (agreement, not pad-follow — that needs `voice-poc` to gain `child_index_param` upstream, **SU-15**); the wire write goes through `childIndexToWire`. Half one (missing channel) is tested against the real `voice-poc` dump; half two (off-by-base) has **no fleet exhibition**, pinned by a synthetic fixture only | Sonnet | ✅ | **7.8** | ✔ |
| SP-51 | The movy MODEL's own knob touch was resolved at RELEASE time (`knobModel()?.handleKnobTouch` on the press against `handleKnobRelease` on the release, `src/midi/router.ts`), so a page change mid-hold left the model that heard the press with its touched/overlay state armed and handed the other model a release it never had. **Different consequence from SP-31, not the same bug**: the model's touch is movy's own state — fixed with a second small ledger (`midi/knob-model-pin.ts`), not a shared Map with SP-31's page pin (incompatible `null`-clears rule). Teeth: `app-loop.mjs`, flag-independent, `3 of 3` unchanged. Raised by SP-31 as a note; the id was added 2026-09-19 | Sonnet | ✅ | **7.9** | — |
| SP-32 | a bank or cell that exists only in movy's config is on no page under `page`: audit before SP-30 flips the default. **The route is the hierarchy movy already returns** — see The injection surface §2 | Sonnet | ⬜ | 9 | — |
| SP-42 | a .wav has no waveform: **two independent defects**, not the one the headline named — the IO was never registered (`wav_io_qjs.mjs` unimported), and even registered, nothing ever advanced the resumable peak job (movy's own tick loop never called `ctl.vizGroups()`/`wavPeaksTick`, only Schwung's own host did). Both fixed: the ladder now imports `wav_io_qjs.mjs`/`wav_peaks.mjs`/`viz.mjs` (`schwung-lib.ts`), and a new `schwung-page-sample.ts`'s `advanceSample` runs after `ctl.tick()` in `schwung-page-contract.ts`, mirroring `shadow_ui_param_pages.mjs`'s block exactly. **Device tier not yet run** — deferred to the wave's device agent; the recipe is in this entry | Sonnet | ✅ **movy-side, 2026-09-20** | 10 | — |
| SP-45 | **NEW** — 8w8's pads do not select their pages; the other three racks' do | Sonnet | ⬜ | 11 | — |
| SP-44 | **NEW** — knob 1 changes presets with no click first (feature) | Sonnet | ⬜ | 13 | — |
| SP-46 | **NEW** — a lone attack/decay has no graphic (against the acceptance bar, by request). **Does not wait on SU-10**: `vizOverrides` + movy's own widget registry is a host-side route — see The injection surface §1 | Sonnet | ⬜ | 14 | — |
| SP-16 | Cause G — graphics return (**shrunk: upstream fixed the hard half**) | Sonnet | 🔨 **movy half done** 2026-09-18; floor bump waits on #509 | 15 | — |
| SP-21a | Report po32-drum's `kit` range upstream (the 1) | Sonnet | ⬜ | 16 | — |
| SP-23 | Font parity + enum-overlay double-draw | Sonnet | ⬜ | 17 | — |
| SP-24 | movy-only page kinds verified against a Schwung body | Sonnet | ⬜ | 18 | — |
| SP-29 | Schwung ships its own automation lanes and p-locks. Decide movy's position | Opus | ⬜ | 19 | — |
| SP-30 | Default-on: flip, device tier, docs, release, stated revert path | Sonnet | ⬜ | 20 | — |
| SP-41 | Delete `off`, movy's page renderer, model page planning. **CONDITIONAL — may never happen** | Opus | ⬜ | 21 | — |
| SP-52 | **NEW** — the master chain: MFX 1–4 and SEND 1–3 are on movy's renderer under every flag value. The INPUT half already delegates; nothing draws or polls it, and the page it would build is on the wrong port | Sonnet | ⬜ | 22 | — |
| SP-53 | **NEW** — Set Params and Clip Params become a host-owned contract (the virtual-component seam) | Sonnet | ⬜ | 23 | — |
| SP-54 | **NEW** — the step page: a contract that exists only while a step is held | Sonnet | ⬜ | 24 | — |
| SP-55 | **NEW** — MIX and the two LFO pages: they have a port and a key, and are refused delegation by name. The easiest of the wave | Sonnet | ⬜ | 25 | — |
| SP-56 | **NEW** — Settings, CPU and Backups: a scope decision, not a build | Opus | ⬜ | 26 | — |
| SP-21 | Metadata correction overlay | Sonnet | ❌ **dropped** — the audit found 1 real correction in 555 | — | — |
| SP-22 | Cut-curve viz kind | Sonnet | ❌ **dropped** — a movy extension; Schwung draws plain dials natively | — | — |
| SP-43 | The second click on an entered preset page leaves it | Sonnet | ❌ **dropped** 2026-09-20 — it is upstream's DOCUMENTED design, not a defect; the user's ruling is to drop it and correct the record | — | — |

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
| SU-8 | A per-cell channel for "this parameter is AUTOMATED" and "this cell cannot take a lock" — distinct from `locked` (a held step's lock) and from `isModulated` (the tilde) | ⬜ **new, and no longer conditional — both deciders have ruled.** SP-35 put the "cannot take a lock" half in movy's own chrome at the gesture (a toast), and SP-36 shipped the automated half **through `isModulated`**, i.e. wearing the tilde. So what is left for upstream is exactly the GRAMMAR: a lane and an LFO now draw the same mark, and a parameter that is both says it once. The ask is one bit per cell (`decorations[slot].automated`, beside `locked`) plus the 2×2 mark `render_page_movy.mjs` already has the corner for — not a second renderer, and not a value channel: movy already answers the value through `:effective` |
| SU-9 | A knob drives a door page's list, with `list_knob.mjs`'s feel | ⬜ **new, likely** — SP-44; the list, its length and its commit path are the door's, and movy must not restate them. **No host-side route exists** — the feel constants are `export const` and `onKnobTurn` takes a direction, not a magnitude (The injection surface §4) |
| SU-10 | A viz kind for a LONE envelope stage (attack only, decay only) | ⬜ **new** — SP-46; take the fleet count with the ask, the way SP-22's drop was measured. **Not blocking**: SP-46 can ship on `vizOverrides` first, so the ask can be made against a widget that already draws (The injection surface §1) |
| SU-11 | A per-key duration in the animation store, so `settled` ages out a value that never rests | ⬜ **new** — SP-48 shipped the movy-side repaint cap fallback instead (2026-09-20); this ask is written (SP-48's own writeup has the PR-ready text) but **not yet filed** as a branch/PR, same as SU-9/SU-10/SU-12/SU-13. Not blocking anything — the cap makes no assumption that survives this landing later |
| SU-12 | A caller-supplied trailing page of kind `knobs`, not only `menu` — so movy's own pages can join a module's page set | ⬜ **new, expected to close without work.** `buildTrailingPages` hard-codes `kind: PAGE_MENU` (`page_plan.mjs:381`), so appending a KNOB page is upstream — but movy already owns the contract string, and folding the page into that is the host-side route (SP-54, route 1). Open this only if the fold is measured too expensive |
| SU-13 | A host-owned page's write throttle and knob feel | ⬜ **new, conditional, and bounded by The injection surface §4.** `SETPARAM_THROTTLE_MS = 20` and the acceleration constants are `export const` bindings — readable, not writable — so a feel complaint about a migrated Set Params page (the tempo knob) is an upstream ask or it does not happen. Do not open it before a complaint exists |
| SU-14 | The re-plan skip: `param_pages` re-plans the whole module even when the contract has not changed | 🔨 **FILED — schwung PR #519, OPEN and unreviewed since 2026-09-17** (head `DimaDake:perf/page-reload-skip-unchanged-contract-upstream`, `3bca6d68`; the local `1959e661` is its working copy). 87 lines of `page_controller.mjs` + one host test. **The action is to chase it, not to write it**, and it lands in the highest-churn file in the library (98 commits/90 days), so it is overtaken the longer it waits. Until it ships, a host-owned contract pays the FULL unconditional re-plan — see the correction in *The pages that are not a track module's*. **SP-49 measured how much: on `minijv` (70 pages), stashing movy's own reload-poll divider out to where it never fires collapsed the ENTIRE idle `page`-vs-`off` gap to noise — this is not one line among several, it is the whole of what SP-49 could still see once SP-26/27/48 had already been paid for** (`sp49-measurement.md`) |
| SU-15 | **NEW, SP-50.** The reference module `voice-poc`'s `pads` level to declare `child_index_param`, matching `sophie`'s, so the already-correct `child_index_param` machinery closes the loop for a shipping example — today no dumped module has both a child note map AND `child_index_param` on one level, so SP-50's half two (the off-by-base write) has no fleet exhibition at all | ⬜ **new, ask only — an example-module change, not a defect in the library itself** |

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

## The injection surface — 2026-09-20

**READ FROM SOURCE, none of it measured, and no run in this repo prints any of
it yet.** Every claim below is a file:line read of `schwung@1959e661` and of
movy's own tree; the ledger's rule that "a claim about a page plan that no run
prints is a claim nobody has checked" applies to this section exactly as it
applies to a burn-down count. It is here because three open items turn out to
have a host-side route they did not have when they were written.

**`createController(io)` accepts ELEVEN hooks and movy injects FOUR.**
`schwung-page-io.ts` supplies `getParam`, `setParam`, `isModulated` and a no-op
`announce`. The rest default to inert:

| hook | what it buys | movy today |
| --- | --- | --- |
| `vizOverrides` | `(key) => vizObj \| false \| null` — force an unclaimed key into any kind, `custom:` included, "without a module release" | **unused** |
| `formatValue` | `(fullKey, raw, surface) => string\|null`; `surface` is `"cell"` or `"header"`, and null falls through per key | **unused** — movy's own readings reach the body path as `displayFor` and the `page` path not at all |
| `enableViz: false` | the plain grid, every cell individually addressable | **unused** |
| `trailingMenus` | append movy's OWN `PAGE_MENU` pages to the module's page set, re-evaluated on every plan (`page_plan.mjs:362`) | **unused** |
| `loadCard` | module-supplied card drawers, loaded on first touch and cached for the session | **unused** |
| `now` | the clock every timing path reads — a deterministic seam for the suites | **unused** |
| `drawCanvasPage` | a custom page body, ticked every frame | **unused, and correctly so** — see SP-38's entry: no fleet module declares `as_page` (0 of 95), so there is no page to draw |

### 1. A new graphic has a host-side route (→ SU-10, SP-46)

`vizOverrides` is consulted **after** the declared groups and **before** the
detectors (`viz.mjs:1155`), and what it returns may name a `custom:` kind.
`isWidgetAvailable` checks the registry **movy's own copy holds** —
`schwung-widgets.ts:50` registers into `schwungLib()`, not into the host's —
which is the thing SP-28 already made work. The degradation is designed for
this: an unregistered or broken `custom:` kind leaves the key **in the detector
pool** rather than leaving a hole (`viz.mjs:256-280`, "a typo, a failed load, an
older host and a one-strike disable, all on one path"), so a movy widget cannot
strand a cell.

**The limit is exact.** A key already `claimed` by a DECLARED group is skipped
before the override is called (`viz.mjs:1157`). So an override ADDS a graphic
where the module declared none, and `false` SUPPRESSES a detector's guess — it
does not replace a module's own declaration.

This does not close SU-10, and its own rule stands: take the fleet count with
the ask, the way SP-22's drop was measured. What it changes is that **SP-46 need
not wait on it**, and that the upstream ask can be made against a movy-side
widget that already draws rather than against a description.

### 2. The contract is movy's to write, and `chain_params` wins

Both halves of the contract arrive through the injected `getParam`:
`${prefix}:ui_hierarchy` at `page_controller.mjs:957` and
`${prefix}:chain_params` at `:1078`. movy already answers the first
(`schwung-page-io.ts:137` → `chain/hierarchy-source.ts`, SP-20's one reader);
the second is passed straight to the port.

**`buildMetaIndex` merges `{ ...inline, ...chain }` (`param_meta.mjs:163`) — the
chain entry spreads LAST.** So metadata written into the hierarchy movy hands
over is honoured where `chain_params` declares nothing and **silently shadowed
where it declares the same field**. Replacing a module's declared `viz`, or its
range or its enum options, therefore needs the `chain_params` read intercepted
too — a suffix test beside `isContractKey`, in the same file that already holds
the other one.

The re-plan needs no new signal: `declSame` compares the RAW BYTES
(`page_controller.mjs:1024`), so a changed string re-plans by itself.

**→ SP-32.** A bank that exists only in movy's config is on no page under `page`
because the hierarchy movy returns does not describe it. The route is the string
movy already owns, not an upstream change — `hierarchy-source.ts` synthesises
one from movy's config for a rack that published none (SP-14), and that is the
same rung. Two things it does not buy: the keys must still be params the port
can read and write (a reorder is free, an invention is not), and SP-20 made this
the one reader for **the page, the model and the undo dump**, so a rewrite here
moves all three together.

### 3. A notice is movy's to suppress

Worth writing down before someone opens an item for it. `s.notice` is raised
**only** by the child-level copy/clear/undo gestures (`page_controller.mjs:4026`
and its callers at `:4035-4090`) and drawn **only** from `renderOverlays`
(`:4661`). `drawNotice` centres it in `s.frameRect` (`:4105`) — the rect movy
passes — so it lands inside movy's body and never over movy's own header or
footer. Three levels of control, in order of bluntness: skip the
`renderOverlays` call (`schwung-page-render.ts:148`, which also gives up the
enum peek and declared cards), null `ctl.state.notice` before it, or
`dismissHint()` for the hint layer. `ctl.state` is the live object and movy
already reads it in nine places.

### 4. Knob feel is upstream or it does not happen (→ bounds SU-9)

`onKnobTurn(slot, direction, nowMs, { fine })` takes a **±1 direction**, and
movy calls it as `ctl.onKnobTurn(slot, dir)` in a loop, once per detent
(`schwung-page-input.ts:120`) — no `nowMs`, no `fine`. So movy owns **how many
detents a CC is worth** and nothing about what one detent is worth: the step
comes from the contract's meta, which under `page` is the module's.

And every tuning constant is an `export const` — `SETPARAM_THROTTLE_MS`,
`ANNOUNCE_THROTTLE_MS`, `TURN_CLAIM_MS`, `ENUM_PEEK_MS`, `SETTLE_TICKS`,
`PREFETCH_HOLD_TICKS`, `CONTRACT_*`, and `TRIGGER_KNOB_GESTURE_GAP_MS` which is
module-private. ES module bindings are readable and **not writable**, so there
is no host-side route to any of them. A feel ask is an upstream ask.

### 5. Which upstream files move under an ask

Measured off `origin/main` with `git log`, which is the one number in this
section that is counted rather than read: **199 commits into `param_pages` in
six months, 153 of them in August.** Last 90 days, by file:

| file | commits |
| --- | --- |
| `page_controller.mjs` | 98 |
| `render_page_movy.mjs` | 62 |
| `page_plan.mjs` | 31 |
| `viz_draw.mjs` | 21 |
| `viz.mjs`, `page_input.mjs` | 14 each |
| `styles/*.mjs`, `anim_state.mjs` | 4–8 each |

Read it as sequencing, not as a verdict on any ask. An item landing in a **new**
`styles/viz_*.mjs` plus a one-line registration (SU-10's shape) survives the gap
between writing it and its release; one landing in `page_controller.mjs` or
`render_page_movy.mjs` (SU-8's shape, SU-9's) is likely to be overtaken while it
waits, which is an argument for making those asks small and early rather than
complete.

---

## The pages that are not a track module's — 2026-09-20

**READ FROM SOURCE, none of it measured.** Every claim here is a file:line read
of movy's tree and of `schwung@origin/main` (`6977c4c6`); the ledger's rule that
an unprinted claim is an unchecked claim applies exactly as it does to a
burn-down count. Raised by the reporter: *"we should eventually migrate all
parameter pages to schwung — send fx, mfx and custom pages like step params,
clip params, set params."*

**This ledger has only ever been about ONE surface**: the parameter pages of a
module sitting in a TRACK chain slot, drawn from `VIEW_KNOBS` or `VIEW_CHAIN`.
`moduleGridOnScreen()` says so in four clauses (`app/page-poll.ts:64`), and
everything the flag does is behind it. Seven other knob surfaces exist and the
flag reaches none of them.

### The inventory

| surface | who draws it today | what its eight knobs are | item |
| --- | --- | --- | --- |
| **MFX 1–4** (`master_fx:fx1..fx4`) | movy's renderer, under every flag value — the session branch (`app/tick.ts:838`) calls `renderKnobsView` with no body and no chrome | a **real module's contract**, behind `hostPort(0)` | **SP-52** |
| **SEND 1–3** (`snd0..snd2`) | the same branch | a **real module's contract**, behind `engineRootPort()` | **SP-52** |
| **MIX** (`mix`) | movy's model; delegation refused by name at `chain/config.ts:89` | movy's own params, real port | **SP-55** |
| **TRACK LFO** (`<prefix>lfo`), **MASTER LFO** (`master_fx:lfo`) | movy's scoped LFO model; refused by the same line | movy's own params, real port | **SP-55** |
| **Step Params** | `seq/step-page-vm.ts`; `schwungBodyFor` declines on `stepSelected` (`app/tick.ts:161`) | trig properties held in the engine — **no port param exists for any of them** | **SP-54** |
| **Clip Params** (`VIEW_CLIP_PARAMS`) | `seq/clip-page-vm.ts` | `seqState` fields | **SP-53** |
| **Set Params** (`VIEW_MAIN_PARAMS`) | `seq/main-page-vm.ts` | `seqState` + `keyboardState` fields | **SP-53** |
| Settings, CPU, Backups | `flags-view.ts`, `cpu-view.ts`, `versions-view.ts` | **not parameters** — a list, a meter and a restore picker | **SP-56**, a scope decision |

**The master chain is already HALF migrated, and nobody did it on purpose.** The
input side delegates: `knobModel()` returns the master model in session mode
(`midi/router.ts:131`), the knob-CC branch resolves `pageOwnerOf(model)`
(`:577`), and the jog calls `pageOwnerOf(masterModel()).changePage` in three
places (`:980`, `:1038`, `:1054`). The render side does not, and cannot — the
poll that makes a page `ready` is gated on `moduleGridOnScreen()`, which is
false in session mode, so the contract never resolves, `owner.page` stays null
and every question falls through to movy. **Inert today, and wrong underneath:**
`schwungPageFor` builds that page on `portFor(trackIndex)` (`renderer/schwung-grid.ts:119`),
not on `componentPort`, so a `master_fx:` key would be read as
`ch<N>:master_fx:…` — the exact namespacing mistake `componentPort` exists to
prevent (`track/registry.ts:64`) — and the cache id is `trackIndex + ':' + componentKey`
(`:116`), which gives a GLOBAL component sixteen pages. That is SP-52's first
paragraph, not a separate finding.

### Do these need upstream PRs? — no, and the reason is structural

**Minimum upstream PRs to migrate every surface above: ZERO.** Not "probably
none" — the two things a host page needs are both already injected, and neither
touches Schwung:

1. **The contract is a string movy writes.** `page_controller.mjs` reads
   `${s.prefix}:ui_hierarchy` (`:1025`) and `${s.prefix}:chain_params` (`:1130`)
   **through the injected `getParam`**, and movy already intercepts the first
   (`renderer/schwung-page-io.ts`, `isContractKey`). Nothing makes the library
   ask a port, a module or a file: `s.prefix` is whatever string
   `setComponent` was handed. A page with **no module behind it at all** is
   therefore already expressible — the planner cannot tell.
2. **Every read and write is movy's.** Rule 1 of `param_pages` is that the
   library does no I/O. So `getParam`/`setParam` over `seqState`, over
   `keyboardState`, or over the held trig is the same injection the port
   already uses; the io simply answers from a different place.

And the plan settles immediately for a host-owned contract: `armContractSettle`
(`page_controller.mjs:1300`) is called on a **selection**, never on first load,
so the 500 ms `CONTRACT_SETTLE_MS` window is not paid by a contract that was
never read off a device.

**The three gaps that look like upstream asks, and the host-side route for each:**

| gap | looks like | the route that exists |
| --- | --- | --- |
| movy's own cell shapes — `len`'s stacked fraction, `cond`'s big font, `vbar` | a new viz kind (an SU-10-shaped ask) | `vizOverrides` may return a `custom:` kind, resolved against **movy's own** widget registry (`renderer/schwung-widgets.ts:50`) — the thing SP-28 already made work. See The injection surface §1 |
| a reading only movy can compute — `1/4`, `+3 ct`, `n/a on drums`, `120 EXT` | `displayValue` has no delegated equivalent | `formatValue(fullKey, raw, surface)`, injected, null-falls-through per key (`page_controller.mjs` ~`:632`). **Unused today** |
| a cell that must not be turned — transpose on a drum track | SU-8's per-cell channel | movy owns `setParam`. Dropping the write is movy's; only the **dim** is upstream, and SP-35 already ruled that movy answers a refused turn at the gesture rather than with a dimmed cell |

**What IS worth an upstream PR, and it is the same short list already in the
table above.** This wave adds no new blocking ask. It strengthens two:

- **SU-8** gains a third caller. `automated` vs modulated (SP-36), "cannot take
  a lock" (SP-35) and now "this cell is inert on this track" are one bit per
  cell, beside `locked`. Still grammar, still not blocking.
- **SU-9** gains the tempo knob. `SETPARAM_THROTTLE_MS = 20` and the
  acceleration curve are `export const` bindings — readable, not writable — so a
  feel complaint about a migrated Set Params page is an upstream ask or it does
  not happen (The injection surface §4).

Two new rows, **both expected to close without work**, recorded so a later
session does not re-derive them: **SU-12** (a caller-supplied trailing page of
kind `knobs`) and **SU-13** (host-owned throttle). See the Upstream table.

### Why this wave is a precondition of SP-41, not a successor to it

SP-41's deletion list includes `src/renderer/label.ts` and `knob.ts`. Step
Params, Clip Params and Set Params all draw through `renderKnobsView`, which
draws through both. **So SP-41 cannot be done while these pages are movy's** —
SP-24 says as much in its *Closes when*, without naming the consequence. Either
this wave lands first, or SP-41 keeps movy's renderer alive for three pages and
deletes nothing.

### The one thing that is genuinely undecided

Where do movy's own pages live in the page SET? Today the step page is page 0 of
movy's bank indicator and the module's banks follow it
(`seq/step-page-vm.ts:104`, `bankCount` mirrors the module's). Under `page` the
bar is Schwung's page set. Three routes, in order of preference:

1. **Fold them into the contract movy already writes.** `hierarchy-source.ts`
   synthesises a hierarchy for a rack that published none (SP-14); a level whose
   knobs are the step page's five keys is the same rung, and the contract movy
   hands over is a string movy can change on a step hold. Zero upstream.
   **The cost to measure is the re-plan.** On `origin/main` `load()` re-plans
   unconditionally — there is no byte compare (see the correction below) — and
   movy already calls `ctl.reloadIfChanged()` every 8 ticks
   (`renderer/schwung-page-contract.ts:147,182`), so a contract that changes on
   a hold costs **one extra re-plan of a cost the page already pays every 8 ticks**. SP-27 measured that re-plan at up to
   67.5 ms on minijv (70 pages) and near-nothing on plaits (2 pages), so this
   route is cheap on a small page and has to be measured on a large one.
2. **A `knobs`-kind trailing page.** `buildTrailingPages` hard-codes
   `kind: PAGE_MENU` (`page_plan.mjs:381`), so this is upstream — **SU-12**, and
   route 1 is why it is expected to close without work.
3. **Two page sets side by side**, with the jog handing off. This is the shape
   SP-31 and SP-50 are both bugs in. Not recommended.

---

### A correction to The injection surface §2 — `declSame` is not upstream *yet*

Left visible rather than quietly edited, because §2's route for SP-32 rests on
it. §2 says *"the re-plan needs no new signal: `declSame` compares the RAW BYTES
(`page_controller.mjs:1024`), so a changed string re-plans by itself"*, read off
`schwung@1959e661`. **`1959e661` is a local branch,
`perf/page-reload-skip-unchanged-contract`, and `declSame` appears nowhere in
`origin/main:page_controller.mjs` nor in the 1.4.0 the device runs** —
`git merge-base --is-ancestor 1959e661 origin/main` answers no.

**It IS filed, and this entry said otherwise for an hour on 2026-09-20 —
recorded so the wrong version is not re-derived from the branch name.** The
local branch is the working copy; its rebased twin, `3bca6d68` on
`perf/page-reload-skip-unchanged-contract-upstream`, is pushed to the fork and
is **schwung PR #519, OPEN since 2026-09-17** — no review, no comments, no
milestone. 87 lines of `page_controller.mjs` plus
`tests/host/test_page_reload_skips_unchanged_contract.sh`. So the action is
**chase it**, not write it.

Two consequences, and neither changes §2's conclusion:

1. **A changed contract still re-plans**, because on main `load()` re-plans every
   time it is called, byte compare or not. §2's *route* is intact; only its
   *reason* was wrong — the re-plan happens because nothing skips it, not because
   something detects the change. **And §2 must not be read as describing the
   device**: until #519 merges and ships, a host-owned contract's re-plan cost is
   the full unconditional one, which is what SP-54 has to measure.
2. **It is the only open upstream PR this project has.** It lands in the
   highest-churn file in the library (98 commits in 90 days — The injection
   surface §5), so every week it waits is a week it can be overtaken. Tracked as
   **SU-14**.

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
| 8 | on the preset selector page the first jog click focuses the page (correct); the second jumps to the MAIN page to the right | SP-43 ❌ **dropped** — Schwung's documented design, refuted 2026-09-20; the want is served by SP-44 | — |
| 9 | feature: knob 1 should change presets with no jog click to focus first | SP-44 | — |
| 10 | pad page selection does not work for **8w8**; it works for the other xwx modules | SP-45 | — |
| 11 | no single attack / single decay visualisations | SP-46 | — |
| 12 | remove the `body` option: a two-value flag, MOVY and SCHWUNG, visible to users next release | SP-40 + SP-47 | ✔ |

**Proposed order, gate first.** 1 SP-36 ✅ **closed 2026-09-19**, 2 SP-35, 3 SP-38, 4 SP-39, 5 SP-37,
6 SP-31 ✅ **closed 2026-09-19**, 7 SP-40, **7.5 SP-48 — the regression SP-38 introduced**, **7.7 SP-49 —
the standing idle tick, which is latency and therefore a gate**, **7.8 SP-50 —
the child instance movy addresses is not the one the controller resolves, which
is live under `page`**, **7.9 SP-51 ✅ closed 2026-09-20 — the movy MODEL half of that
same gesture was resolved at release time; not a gate (it does not latch the
controller), fixed alongside this fix round**, 8 **SP-47 —
the release**. Then SP-32, SP-42, SP-45,
SP-44, SP-46, SP-16, SP-21a, SP-23, SP-24, SP-29, SP-30, and SP-41 only if it
is ever decided. SP-31 (✅ closed 2026-09-19) was in front of the release and the user did
not name it because it is not a symptom you can describe — a lost knob release latches the
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

### SP-36 ✅ 2026-09-19 — the automation channel: the mark that was missing, and the pointer that chased the lane

**Symptom, both halves, in the reporter's words.** **(a)** under `off` an
automated parameter wears a 2×2 dot next to its label (`renderer/label.ts`,
`pvm.automated`); under `page` nothing marked it, so the page could not tell you
what the sequencer was driving. **(b)** while the transport plays, an automated
parameter's knob **jumps** — the pointer chases the lane — and it should
instead *"stay where you set it"* with the automation showing as *"a mark moving
across the knob, like with lfo"*.

**THE MECHANISM WAS ALREADY THERE AND IT IS CALLER-SIDE.** Schwung's controller
draws exactly (b) for any key movy reports modulated: the **pointer** takes
`<key>:base` and a five-pixel plus **rides the arc** at `<key>:effective`
(`page_controller.mjs` `refreshModulatedValues`; `render_page_movy.mjs`
`drawModDot` — *"the base only moves when you turn the knob, so only the dot
needs live data"*). Both reads come back to movy's own injected io. So the whole
item was: answer them.

**THE BASE WAS THE WHOLE ITEM, and it was not lost — it was just never asked
for.** The engine emits a lane's value as a CC and the chain applies it inside
the DSP (`movy-dsp/src/lib.rs`, `OutEvent::Cc`), so a read of the plain key
answers **the lane**: there is no second value on the port. But movy tells the
engine the base once per edit already — `abase` at `assignLane`, `abaseq` on the
release that ends a normal turn (`seq/automation.ts`) — and the engine keeps it
as `lane_base`, which is what playback reverts to. So the base is **mirrored
where it is already sent** (`seq/automation-base.ts`), in the parameter's own
units rather than the wire's 7 bits, and the one case a mirror cannot cover — a
Set the engine restored, whose lanes the UI rebuilds from `alabels` having never
emitted their bases — is filled by a new engine read-back, **`abases`**, in
`alabels`' own shape and read on the same sync (`app/tick.ts`). ENGINE_VERSION
**0.79.0 → 0.80.0**.

**The two open questions were rulings, and the user made both (2026-09-19).**

- **Does `off` change too? NO — `page` only.** movy's own renderer goes on
  following the lane until SP-30 flips the default. **This is a deliberate
  divergence and here is what it is:** under `off` an automated parameter's arc
  shows the LANE and wears a dot; under `page` it shows the BASE and wears a
  tilde plus a travelling mark. Whoever does SP-30 owns closing it — `off`'s
  half is a mod dot on `renderer/knob.ts`'s arc, which movy has never drawn.
- **Which mark? THE TILDE, with SU-8 filed.** Automated keys answer
  `isModulated`, which is what buys (b) at all. The cost is the grammar: a lane
  and an LFO now draw the same mark, so **(a) is satisfied in substance — the
  page marks what is automated — and not in vocabulary.** The dot is upstream
  (SU-8, now unconditional and specified: one bit per cell beside `locked`), not
  a second mark movy paints into Schwung's cell, which is what this entry's own
  question said to prefer against.

**The half that nobody asked for and the feature does not work without.**
`page.knobLevels()` read `ctl.state.values[k]` — the BASE map — and that is the
only thing `app/page-poll.ts` watches to decide whether to repaint. With the
base/effective split the base stands still by definition while a lane plays, so
the mark would have been drawn **once and frozen** — the same defect SP-48
records from the other direction. `knobLevels` now answers the DRIVEN value
where there is one, which also makes the knob LED follow what the parameter IS
doing, as it did under movy's own renderer.

**Teeth — `browser-test/logic/page-automation.mjs`, ten checks, each removal
measured.**

| removed | what reddens |
| --- | --- |
| the `isModulated` widening | `the key reports as modulated` + the pointer chases (`0.90`, `0.10`) + no mark at all (`modValues` undefined) |
| the `:base` answer | `expected "0.5", got "0.90"` then `got "0.10"` — **the reported bug, reproduced** |
| `knobLevels`' live value | `the levels follow the driven value` goes flat |
| the `:effective` answer | **39 port round trips across 40 ticks, against 0** |

**`:effective` IS A READ, NOT THE DOT, and this is the one thing a later
simplification will get wrong.** The controller falls back to the plain key when
`:effective` does not answer, so the dot appears either way — measured, removing
the answer reddens no value check. What it costs is a live blocking engine GET
**every tick**, forever: the engine does not serve that key, a null is never
cached (`schwung-page-cache.ts`), and the controller asks for one modulated key
per tick. **That cost is pre-existing for LFO keys and is still there for them**
— deliberately: since schwung #276 a chain-modulation target's PLAIN key answers
the BASE, so answering `:effective` with the plain read would park the dot on
the pointer. It is right for an automated key only because movy knows what the
plain key holds for one. Part of SP-49's standing cost, now smaller by one key
per tick per automated parameter on the drawn page.

**Checked against SP-48, as SP-38's entry required.** The mark rides the ARC,
and `drawArcKnob` takes no `anim` — so an automated float cannot reach the
animation predicate. What it does widen is the route: `modValues` is merged
before the renderer observes, so an automated **enum-shaped or wave-viz**
parameter whose value moves faster than ~8 Hz is now a second way into SP-48's
never-settling page, where before only a host LFO or a `live` param could get
there. No new mechanism, one more source; SP-48 still owns it and its fix covers
both.

**No new screenshot baseline, deliberately.** No rendering logic changed: the
widget, the tilde and the travelling plus are all Schwung's and are already
pinned by `page_mod_cell` / `page_mod_cell_held`; what movy supplies is the
three values, which the logic suite asserts directly. The repo rule is the
cheapest level that reproduces the bug, and a baseline here would re-assert
Schwung's pixels through a longer path.

**Docs.** `MANUAL.md`/`README.md` untouched, for SP-31's reason: the `page` flag
is not user-visible yet (SP-47), so no gesture, page or control a user has today
has changed.

**Needs:** nothing. SU-8 is the follow-up and is not a blocker.

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

### SP-31 ✅ 2026-09-19 — a lost knob release latched the controller, forever

**Symptom.** A gesture goes dead. Touch a knob, and while it is held the page
under it changes — a chain switch, a module swap, or Session taking the knobs to
the master bus. The release is then routed to whatever screen is up NOW, so the
pressed page never hears it and keeps the slot in `touchOrder`. `touched` is
recomputed from `touchOrder` alone (`page_controller.mjs`), and the controller
has no staleness expiry for a held knob on purpose (it refuses to settle a
contract under a hand, and `onKnobTouch` zeroes `turnClaimMs`), so nothing ages
it out: `touched` stays ≥ 0 for the life of that controller. That is not a stale
highlight — movy's jog-click guard (`src/midi/router.ts`) reads it as "a knob is
under the hand", so every later jog click is handed to the page instead of movy.
Measured while working SP-17: `touched=1 order=[1]`.

**Cause.** One gesture, two answers: the press is recorded against the page that
owns the knobs at press time, the release is delivered to whoever owns them at
release time. Every other held-input latch in movy already answers this way —
`keyboard/held-notes.ts`'s header states the rule (*the release must come from
what the PRESS recorded, never from current state*) — and this was the one seek
that still derived its answer at the end.

**Fix.** `src/midi/knob-page-pin.ts` — a `Map<knobIndex, page>`, the shape of
`held-notes.ts`: `pinPage(knob, page | null)` at the press (a `null` page
DELETES, so a movy-owned page or an unsettled contract cannot leave a pin for
the next gesture to inherit), `unpinPage(knob)` at the release, `clearPins()`
where releases provably cannot come back (`app/input-reset.ts`, next to the
`clearTouch()` loop it is the other half of). The drain sits at the TOP of the
router's `0x90 && d1 < 8` block, ABOVE the Main/Clip/Flags/Step overrides,
because they `return` — a param page that comes up while a knob is down would
otherwise strand the pressed page exactly as a page change does. The release is
then skipped on the current owner when the pin already took it. Keyed by knob
INDEX because that is the only identifier the two halves of the gesture share.
Not changed, deliberately: the controller's touch semantics (a Schwung change is
an upstream PR) and `pageOwnerOf` — the pin is consulted only at the two gesture
sites, so ownership stays the one accessor's answer.

**The (a)/(b)/(c) ruling is (c), and (a) is refuted by measurement.** The entry
said the pin was entangled with the fixture limit because SP-17's record has it
taking the burn-down 5 → 7. It is not, and it does not. The burn-down is
**3 of 3** with this pin — the same three labels as BASE — and the plan line is
**byte-identical** with the pin, with the pin removed, and at BASE:
`[page-plan] mrdrums fixture ck=synth mode=page lib=true movyBanks=4
claimed=true delegated=true ctlPages=1 names=["Main"]`. So (a) is false: this
pin does not change the controller's planned page set. (b) is the correct
description of the three survivors and needs no fixture change — `movyBanks=4`
against `ctlPages=1 names=["Main"]` is the whole limit, one mechanism, owned by
SP-32. And the record itself cannot describe this design: `pct=1 ctlPages=1
names=Main` pinned AGAINST `pct=3 names=Main>Main - 2>Effects` unpinned is a pin
that changed `ctlPages` on the `hier_params_overflow_two_levels` fixture — but
that block sends no `0x90` note below 8 at all, and a knob-indexed map drained in
that branch is unreachable from it (`shift+jog: plain jog steps one page` is
green at BASE, green with this pin, and green with this pin removed). So SP-17's
pin was reachable from somewhere the entry's own description does not name —
most plausibly `pageOwnerOf` or the cache lookup behind it, where a pin left over
from an earlier block answers for the PREVIOUS fixture: one page, named *Main*,
exactly what the record shows — a stale page served as the current one, which is
why reverting it was right. **Limitation:** SP-17's code is unrecoverable (it was
reverted before commit; `git log --all -G"pinPage|heldPage|pinnedPage|touchOrder|knobPin"`,
`-S "Map<number,"` and a rev-list `git grep` over every `router.ts` revision
return no such blob), so that last paragraph is an inference from two records
that cannot both describe one piece of code. What is measured is the plan line
and that this pin cannot reach that check.

**Teeth — `browser-test/app-loop.mjs`, "a knob release that outlives its page
does not latch the controller".** The block holds knob 1 on `VIEW_KNOBS`, presses
Session (the knobs are the master bus now), **releases the knob while Session is
still down**, toggles Session off, and asserts three things: the pressed page is
not left holding the knob (`ctl.state.touched === -1`), the ledger is empty again
(`pinnedCount() === 0`), and the next jog click still reaches movy
(`currentView === VIEW_BROWSE`). Removing the fix's delivery reddens the first
and the third (`expected -1, got 1` / `expected 2, got 1`) and
`page-mode.mjs` reports both as **REGRESSION under page — not in the expected-fail
list**, `5 of 3`, exit 1; removing the DRAIN reddens all three
(`and the ledger is empty again: expected 0, got 1`). Restored: the three green,
`3 of 3`, `PAGE-MODE LEDGER UP TO DATE`, and the `off` arm clean in every state.
**The detail that cost this test its teeth** — the first version of it got this
wrong, and every later reader should know: **`CC_NOTE_SESSION` toggles on the PRESS** — the release
is only the button coming up — so a test that presses and releases Session once
has NOT left session mode, and its jog click was answered by the MASTER page,
which is never latched. The check passed with the fix removed until the second
press/release pair was added.

**ON THE DEVICE, 2026-09-19 — and it had never run there.** The item closed on
the logic suite alone; its device half was not verified, which is exactly the
gap a reader of this entry would have assumed was covered. It is now
`page-lifecycle`'s **L4** (`knob-release-does-not-latch`), and it grades the
SYMPTOM rather than a proxy: hold knob 1 on track 0's delegated page, switch to
track 1 *while it is down* (`dev.knobHold`, so the release lands on the other
page), come back, and click the jog — `probe.page().view` must be `browse`, the
module browser, which a latched `touched` swallows. Two real controllers for two
real chains, and a track switch only the hardware's own MIDI produces; the
logic suite models both ends. The click is backed out with Back rather than
committed, so the fixture's chain is untouched whichever way the check goes.

**Docs.** MANUAL.md and README.md are untouched, and that is the answer rather than an
omission: the `page` flag is not user-visible yet (that is SP-47's item), so no gesture,
page or control a user has changed.

**Not covered here — CLOSED as SP-51.** It was a ledger NOTE without an id until
2026-09-19, which is the thing this ledger's own convention exists against: a
prose-only note is a finding the next session re-derives from scratch instead of
picking up. The movy-MODEL half of the same gesture was still resolved at
release time: `knobModel()?.handleKnobTouch(d1, !owner.delegated)` on the press
against `knobModel()?.handleKnobRelease(d1)` on the release (`src/midi/router.ts`).
A page change mid-hold left the model that heard the press with its own
touched/overlay state armed and handed the other model a release it never had.
Different consequence, not the same bug: the model's touch is movy's own state,
not the controller's, so it never latched a jog click. **Correction to this
entry's own earlier framing:** the claim that `resetHeldInput` clears the leak
was true but incomplete, and would have misled an implementer into thinking the
everyday case was covered — `resetHeldInput` runs only at cold boot and on
Leave-Movy, never on an ordinary track switch or Session toggle, which is
exactly the scenario this note names. What actually self-healed the everyday
case was `app/tick.ts`'s `shownKey` check, and only *reactively*: it clears
`touchedSlots`/`enumOverlay` on whichever model is shown NOW, not the one that
just lost the knobs, so the pressed model's open overlay sat live and
uncommitted until the next time IT was shown again — after the user's roll was
already lost, never because the release landed right. See SP-51 below for the
fix. The LFO hold is NOT affected, checked rather than assumed:
`lfo/assign-mode.ts`'s `holdRelease(physK)` keys on the knob index alone, so the
release clears it whichever model is current.

---

### SP-51 ✅ 2026-09-20 — the movy MODEL's own knob touch was still resolved at RELEASE time

**Symptom.** Hold a knob whose cell is an enum/item-selector (>6 options) or a
file param — the overlay opens and the user rolls to a different item — then
switch tracks (or toggle Session, or swap the module in the focused slot)
*while still holding the knob*, then let go. The newly-rolled selection is
silently discarded: the release lands on whichever model is now on screen (a
no-op there), and the model that actually holds the open overlay never hears a
release at all. Flag-independent, unlike SP-31: `knobModel()?.handleKnobTouch`/
`handleKnobRelease` run unconditionally in the router's fallback branch,
delegated or not.

**Cause.** `knobModel()` (`masterChainActive() ? masterModel() : activeModel()`)
is resolved fresh on every call — once at press, again at release. A track
switch, chain-slot swap, or Session toggle between the two resolves it to a
DIFFERENT `Model` instance, so the release commits nothing on the model that
opened the overlay.

**Fix.** `src/midi/knob-model-pin.ts` — a second small ledger, not a shared Map
with SP-31's `knob-page-pin.ts`: that ledger's `pinPage(knob, null)` means
"delegated, so forget it," which is correct for a PAGE (a movy-owned or
unsettled page has nothing to hand a release to) but wrong for a MODEL — there
is always one to pin whenever there was a press to react to, `off` included,
which is the flag state this bug is most reachable in. Applying the page rule
here would delete the model pin right after every press under `off`. The two
ledgers share only their `Map<knobIndex, T>` bookkeeping, factored out as
`createKnobLedger<T>()` in `knob-page-pin.ts` (rule 6: no duplication without
conflating the two lifetimes). `pinModel(knob, model)` at the press (capturing
`knobModel()` once, alongside `pinPage`), `unpinModel(knob)` drained
UNCONDITIONALLY at the top of the `0x90 && d1 < 8` block — same site as SP-31's
page drain, before the Main/Clip/Flags/Step `return`s — and `clearModelPins()`
in `app/input-reset.ts` next to `clearPins()`. The release branch's own
`knobModel()?.handleKnobRelease(d1)` call was deleted entirely (not left beside
the drain) — keeping both would double-fire.

**Teeth — `browser-test/app-loop.mjs`, "a knob release outliving its model does
not strand its overlay."** Two tracks loaded with `MOCK_SYNTHS.name_enum`
(knob 0 = a 10-option enum, opens on touch with no turn needed): touch knob 0
on track 0, `selectTrack(1)` mid-hold, release. Asserts
`trackModels[0][1].getViewModel().overlay === null`. Unconditional — no
`GRID_ARM` guard — since the bug is flag-independent; it fails identically in
`off`, default and `page`. Removing the `pinModel`/`owedModel` wiring reddens it:
`expected null, got {"slot":0,...}` — the release reached track 1's fresh model,
a genuine no-op there, so track 0's overlay was never committed. Restored: green,
burn-down unchanged at `3 of 3`.

**A test-hygiene trap the first draft of this block hit, worth recording:**
inserting a module swap (`env.setParams(MOCK_SYNTHS.name_enum)`) between two
existing blocks that assumed the SAME module carried over
(`renderer/schwung-grid.ts`'s `pages` cache is keyed by `track:component`, not
by synth identity, and a bare `model.reload()` does not drop a stale cached
`SchwungPage`) turned three UNRELATED, downstream `page`-arm checks red
("file param not automated", "a held step refuses to lock it", "shift+jog:
plain jog steps one page") — none of them touch track 1, the track this block
switches to. `schwungGridReload()` at both ends of the block (dropping the
prior block's cache before swapping in, and this block's own half-resolved
track-1 page before handing off) fixed it; every other block in this file that
swaps modules follows the same pattern. Recorded so the next session does not
have to re-diagnose it from a page-mode regression with no apparent connection
to the change that caused it.

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
entries, four complaints) plus SP-31 ✅, whose symptom a tester could not report
usefully (closed 2026-09-19). Not SP-32: an opt-in tester noticing a missing bank is a report, and
reports are what the opt-in is for. **Three more rows are gates and are not in
that count, because none is one of the four complaints: SP-48 (a modulated or
`live` param keeps the page redrawing forever) — **✅ closed 2026-09-20, a
movy-side repaint cap; this row no longer needs an explicit acceptance for it** —
SP-49 (an idle `page` tick costs half again what an `off` tick costs) and SP-50
(on a child-level page movy and the controller disagree about which child is
showing) — **✅ closed 2026-09-20, both halves fixed movy-side; half two's
fleet exhibition is dormant behind a separate, unopened page-landing question
(see the entry) and half one has no fleet exhibition at all (SU-15)**. SP-49
remains open — partial, needs SP-47's acceptance or SU-14 landing.

**THE DEVICE TIER MEASURES MOVY'S OWN WORK AT EVERY VALUE, and as of
2026-09-19 that is the scenarios' doing rather than the default's.** `items`,
`module-contract` and `smoke` assert movy's OWN writes and report `writes: none`
/ `0 commits` failures when the box is armed to `page` (see the burn-down
section) — the earlier wording here said the tier stayed green because MOVY was
the default, and that was only ever true of a box someone had already set to
`off`: red at rest predates this migration work, not a consequence of it. All
three now arm themselves through `test-device/arm.ts`, so the tier is 0 failed
at rest whatever the flag says, and SP-30 no longer has to teach them the mode.

**Closes when:** a release build shows the row, the default is MOVY, the device
tier is green on that build, MANUAL.md carries the setting and its revert, and
the release notes name it.

**Needs:** SP-40, and the gate items above.

---

### SP-42 ✅ movy-side, 2026-09-20 — a .wav has no waveform: TWO independent defects, not the one the headline named

**Product.** Select a sample in a parameter page and the waveform that should
draw it is blank. The waveform is one of the strongest arguments for delegated
pages — it is drawn from the FILE, which movy's own renderer could only do for
its own widgets.

**Cause, read from source — and it turned out to be two defects, verified
independently, each load-bearing on its own.**

**Defect A — the IO is never registered**, which is the one the headline named.
`wav_peaks.mjs` computes the peak envelope and does **no I/O of its own**: *"THE
I/O IS INJECTED... `std` and `os` are QuickJS MODULES, so importing them here
statically would make this file unloadable under node"*. The device wires the
real pair in **`wav_io_qjs.mjs`**, a side-effect-only module Schwung's own
`shadow_ui.js` imports (`src/shadow/shadow_ui.js:307`). movy's `ui.js` is a
different QuickJS program: `renderer/schwung-lib.ts` imported ten `param_pages`
modules and `wav_io_qjs.mjs` was not one of them, so in movy's process `IO`
stayed `null` forever and `startJob`/`fileSignature` (`wav_peaks.mjs:98,116`)
both guard `if (!IO) return null` — the cache entry becomes `{error: "unreadable
wav"}` forever.

**Defect B — even registered, nothing ever advances the job**, which the
original entry's "Design & implementation" section had already half-noticed
(the `ctl.vizGroups()` clue) but buried as a footnote rather than naming as a
second defect. `wav_peaks.mjs` is **resumable**: `wavPeaksTick(path)` does
`BLOCKS_PER_TICK = 2` blocks per call and returns; `viz_draw.mjs`'s `drawSample`
is explicit — *"No I/O here: wavPeaks never reads, and the job is advanced from
the tick."* The ONLY caller of `wavPeaksTick` anywhere in the schwung tree is
Schwung's own host loop (`src/shadow/shadow_ui_param_pages.mjs`'s
`tickParamPages`), which movy does not run — movy ticks its own
`schwung-page-contract.ts`, and nothing there ever called `ctl.vizGroups()`.
So even with Defect A fixed, a selected sample drew the "no envelope" flat
fallback (`viz_draw.mjs:1466`, `halfAt = () => 0`) forever — the picture never
starts, not "starts and stalls".

**So:** not "registered too late" — genuinely unregistered, plus a second,
independent missing wire. Both had to land for the product claim to be true.
Present in **v1.4.0** (the device's current version); no floor bump — none of
`wav_peaks.mjs`, `viz.mjs`, `wav_io_qjs.mjs` are new.

**Fix.**
1. `renderer/schwung-lib.ts`'s `Promise.all` ladder gained three entries —
   `wav_io_qjs.mjs` (side effect, unused binding), `wav_peaks.mjs`
   (`wavPeaksTick`/`wavPeaksDone`/read-only `wavPeaks`) and `viz.mjs`
   (`VIZ_SAMPLE`) — all four optional on the `SchwungLib` interface, same
   convention as `settled`/`buttonPhase`. `wavPeaks` itself is exposed even
   though nothing in `src/` calls it, because it is the ONE door and a test
   proving the job actually filled in (not just finished) has no other way to
   ask.
2. New `renderer/schwung-page-sample.ts` (`schwung-page-contract.ts` was
   already over its 200-line budget from SP-49; the advance is a sibling file,
   not inline) exports `advanceSample(ctl, lib)`, mirroring
   `shadow_ui_param_pages.mjs`'s block exactly, including skipping a settled
   sample cell to find the next unfinished one (breakbeat's A/B pair). Wired
   into `schwung-page-contract.ts`'s `tick()`, right after `ctl.tick()`.
3. `build/browser.mjs`'s `onResolve` gained a branch: `wav_io_qjs.mjs`
   resolves to a new movy-authored `browser-test/stubs/wav-io-qjs.mjs` instead
   of the real checkout file when `SCHWUNG=` is set — the real file's static
   `import * as std from "std"` cannot resolve under esbuild/node. The stub is
   backed by the SAME `globalThis.std/os` mocks `browser-test/env.mjs` already
   installs for movy's own `model/wav-peaks.ts` suite, and imports
   `setWavPeaksIO` from the real schwung path so the registration lands on the
   SAME `wav_peaks.mjs` instance `schwung-lib.ts` itself resolves to.

**Cost, measured, not estimated.** `wav_peaks.mjs` and `viz.mjs` were already
loaded transitively (`render_page_movy.mjs` → `viz_draw.mjs` → both), so asking
for them by name is not new parse work — same argument as the existing
`child_key.mjs`/`param_meta.mjs` entries. `wav_io_qjs.mjs` itself is new: the
whole `dist/esm` browser-test bundle grew **1290257 → 1304566 bytes (+14309 B,
~1.1%)** for one ~35-line file with two host-native imports. The standing
per-tick cost (`advanceSample` running unconditionally after every
`ctl.tick()`) measured **zero** against SP-49's own idle-tick budget: the
`schwung-page-idle-cost.mjs` suite (test16, no sample param) still reports
**43 ≤ 48** — unchanged — because an empty `vizGroups()` read is a cached map
lookup and a `for` over an empty array, exactly as the plan predicted.

**Teeth, each defect reddening a DIFFERENT way (new suite
`browser-test/logic/schwung-sample.mjs`, mock `wav_beside_filter` — mrsample's
real shape, `filepath_param` included):**
- Defect A alone (import removed from the ladder): the job STARTS but
  `wavPeaks(path)` comes back with a non-empty error (`IO` missing) and no
  points — "the envelope job reached a resolved cache entry" still passes, "no
  read error" fails.
- Defect B alone (`advanceSample`'s call site removed): `wavPeaksTick` is
  never called at all, so `wavPeaks(path)` stays `null` — "the envelope job
  reached a resolved cache entry" itself fails, a different assertion than A's.
- Screenshot teeth: a new delegated scene `page_sample` (mrsample's mock, a
  real WAV via `env.setFiles`, reusing `makeSceneWav()`) — with Defect B
  reintroduced, **72 px differ** from the accepted baseline (the waveform
  collapses to the flat fallback line). Reviewed by eye before accepting.

**Not covered — deferred to the wave's device-tier agent, per the dispatch's
own instruction not to run that tier here.** `test-device/scenarios/widgets.ts`
needs a second block: `mrdrums` (already the fixture's track-1 module) with
`p01_sample_path` set to a real on-device file
(`find /data/CoreLibrary -name '*.wav' | head -1`, not hard-coded), the
delegated renderer armed the same way `widgets.ts` already arms it
(`probe.setGridMode`), navigate to pad 1's sample page, and read the
FRAMEBUFFER for the sample cell — the same "read the panel" reasoning SP-28
used, since a dump-replay assertion has no registry/IO to read off-device.

**Closes when:** the device-tier scenario above lands and shows a page with a
selected .wav drawing its envelope on hardware — the local half is done.

**Needs:** nothing blocking; independent of SP-38's clock question (this item
supplies its own per-tick driver).

---

### SP-43 ❌ — the second click leaves the preset page: DROPPED, 2026-09-20

**It is not a defect. It is Schwung's documented design, and this entry's whole
premise — "a door you can only stay inside for one click is a door that does not
work" — was wrong about whose door it is.**

The repro this entry asked for was never needed: the answer is readable in the
library. `page_controller.mjs`'s `onClick` PAGE_PRESET branch jumps to
`firstGrid` deliberately, and says so in **two** independent comments — its own,
and `restorePage`'s. The behaviour is byte-identical between `origin/main`
(:3911-3917) and the 1.4.0 the device runs (:3632-3638), so it is not drift
either.

**Both of this entry's candidate causes are refuted, not merely unchosen:**

- *movy's ladder handed the click on* — it does, and that is CORRECT.
  `router.ts:834-838` delegates with `isDoor()` true on both clicks. No earlier
  rung consumes it; SP-31's latch is not involved.
- *Schwung took it and moved* — Schwung took it and moved **on purpose**.
  `applyInput`'s door branch calls `onClick(-1)` unconditionally; it mutates
  state synchronously and returns null. There is no re-plan, no double delivery
  and no movy-side leak, so there is nothing for `ctl.restorePage` to restore.

Confirmed against real fleet metadata rather than reasoning alone: `obxd`'s root
level (`docs/module-dump/modules/sound_generator--obxd.json`) plans
`[Presets, Main, …]`, so the second click lands on *Main* — exactly the "main
page to its right" this entry described as the symptom. movy's own footer
already advertises the behaviour correctly (`CLK EDIT`,
`schwung-page-chrome.ts:132`).

**The ruling (the user's, 2026-09-20): drop it, and do not pin it.** No test, no
upstream ask, no host-side override. An override was considered and rejected —
keeping the door open against the controller's own page model is precisely the
kind of divergence SP-41 would later have to reconcile, and no clean seam for it
exists. **SP-44 is unaffected** and is where the underlying want is served: knob
1 changes presets with no click at all, so the door's click ladder stops
mattering.

**Plan retained** at `plans/sp-43-second-click-leaves-preset-page.md` for the
evidence trail — its §4 states what SP-44 inherits, and it names `obxd` as a
reusable fixture for it.

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
(`focusVoice`'s own `mlog`, `src/renderer/schwung-page-input.ts`). One device run with 8w8 loaded and a pad pressed
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

### SP-48 ✅ 2026-09-20 — a modulated or `live` param the page shows keeps it redrawing forever. **A REGRESSION SP-38 INTRODUCED**

**Product.** A page showing an enum-shaped or waveform parameter with a host LFO
on it — or any `live` param that keeps moving — **never stops redrawing.**
Nothing looks wrong, and that is the point: the animation is doing its job and
the page pays the animating cost on every tick, forever. What a person notices
is a warm tool and a shorter battery; what the next item that measures tick
headroom notices is noise it cannot attribute.

**SP-36 ADDED A SECOND SOURCE, NOT A SECOND MECHANISM (2026-09-19).** An
automated parameter now reports `isModulated`, so its live value rides
`modValues` the same way an LFO target's does — and the renderer merges before
it observes. A float is immune (the mark rides the arc, and `drawArcKnob` takes
no `anim`), so what SP-36 widened is exactly: an automated **enum-shaped or
wave-viz** parameter whose lane moves it faster than ~8 Hz. The fix below covers
it unchanged; the count of ways in went from two to three.

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

**Closed: route (b), the movy-side fallback — plan `plans/sp-48-endless-redraw.md`.**
`src/app/repaint-cap.ts` (new, `createRepaintCap`) is an **escalate-then-cap**
state machine, not a flat throttle: unthrottled for `ANIM_GRACE_MS = 500` (chosen
> `BTN_FLASH_MS = 300`, the longest of the four known transition constants, so no
real one-shot transition SP-38 fixed can still be running when the grace window
ends), then bounded to one ask per `REPAINT_CAP_MS = 200` (5 Hz) for as long as
`page.animating()` keeps saying true past that point; it self-resets the moment
`animating()` goes false, so a real transition after a stuck page is never
punished for the page's past. Wired into the one call site,
`src/app/page-poll.ts:134`
(`if (!moved) { const now = nowFn(); moved = animCap(page.animating(now), now); }`),
which also gained an optional `nowFn: () => number = Date.now` parameter so the
test can drive it with a synthetic clock — the default keeps every existing
caller (`app/tick.ts:769`) byte-identical.

**Teeth, at two levels, both proven by reverting and restoring.**
`browser-test/logic/page-freshness.mjs`'s SP-48 block has a unit test
(`repaintCap` alone, no schwung/model/device) and an integration test
(`pollDrawnPage` with `page.animating` stubbed true and a synthetic `nowFn`,
asserted one-for-one against a fresh `repaintCap`). Reverting `repaintCap`'s body
to a passthrough (`return animating`) reddened exactly the three "refused"
assertions in the unit test (the three capMs-window checks) while the
grace-window and positive checks stayed green — proving the test discriminates
the real throttle from a broken-but-passing stub, not just from total removal.
Separately, reverting `page-poll.ts:134` to
`if (!moved) moved = page.animating(Date.now());` (the pre-fix wiring) left the
unit test green (it never touches `page-poll.ts`) and reddened the integration
test's one assertion — proving the wiring itself, not just the standalone cap
function, is covered. Both reverts were restored before the gates below ran.

**Gates:** `SCHWUNG=../schwung npm test` — 0 failures. `SCHWUNG=../schwung node
browser-test/page-mode.mjs` — still **3 of 3** expected failures, unmoved (this
item touches no page-plan behaviour). `screenshot.mjs` — 176/176, no baseline
diffs (the cap changes *how often* an already-drawn frame repaints, never *what*
is drawn). No `engine/` change.

**Cost bound — DERIVED, not measured.** SP-38 measured the animating window at
0.7 ms/tick of `render` **on plaits**, which SP-38 and SP-39 both record as a
**floor, not a representative** (SP-39 could not find an animating window on
minijv at all). Taking that floor and `REPAINT_CAP_MS = 200` against SP-38's own
idle `tick_ms` median (~5.3 ms), the fix reduces the *floor's* steady state from
0.7 ms on every tick forever to 0.7 ms roughly once every 38 ticks — call it
≈0.02 ms/tick averaged. This is **arithmetic on SP-38's own recorded number, not
a new device reading**, and inherits every one of SP-38's caveats. No device
measurement was taken for this item (optional per the plan, not required to
close it).

**SU-11 stays UNFILED — the fallback is what shipped.** See the Upstream table:
the per-key duration ask (§3.3 of the plan, ready to paste into a PR) is written
but no fork branch or PR exists yet, same "new" wording as SU-9/SU-10/SU-12/SU-13
rather than SU-14's "FILED". The movy-side cap makes no assumption that survives
SU-11 landing later — it simply stops mattering once `settled()` ages a
never-resting key out on its own.

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

**Resolution, 2026-09-20 — attributed, partially bought back, not closed.**
Full method and every number: `sp49-measurement.md`. Summary:

Ran the plan's three unmeasured items on `minijv` (70 pages — the big module
the plan's own §2.1 asked for first) rather than guessing further from `cw78`'s
numbers: (1) idle baseline, both arms; (2) `TRACE_LABEL` traces on the two
previously-unattributed IPC lines; (3) stashing the reload divider
(`RELOAD_POLL_TICKS`) out to where it never fires in a window, to isolate its
true share.

**Result: on this fixture the entire idle gap is downstream of
`ctl.reloadIfChanged()` — SU-14.** With the divider stashed out, `page`'s idle
numbers (calls/tick 0.6, ipc_ms 1.3, worst period 5.4ms) match `off`'s
(0.6 / 1.3 / 5.1ms) within noise. The two IPC lines SP-38/39/49 could not
attribute — `mget ch0:*` (movy's own `loadHierarchy`/`pollModuleName`/
`buildViewModel`, per the trace) and `get overtake_dsp:*` (traced to
`schwung/shadow/shadow_ui.js:8905`, **not movy's code — schwung's own**) —
vanished together with `ctlreload`'s ms cost, meaning both ride the SAME
divider tick as reads the re-plan itself makes, not separate standing costs.
The earlier hypothesis that movy's own reads were bypassing a warm cache
(§1/§3 of the plan) does **not** survive this isolation — there was nothing
independently movy's to fix on the read side.

**What shipped: `RELOAD_POLL_TICKS` widened 8 → 16**
(`src/renderer/schwung-page-contract.ts`, `RELOAD_POLL_TICKS` moved to module
scope so a test can import the real value instead of copying the number).
This is the one lever the plan's own §4 sanctioned once SU-14 was confirmed
dominant: it cannot fix the re-plan's per-call cost (that is schwung's own
function body, upstream, rule 1 — do not patch `../schwung`), only how often
movy pays for one. Confirmed on device, same module/build: `ctlreload`
0.8→0.4ms/tick, worst idle period 6.1→5.7ms, calls/tick 1.1→0.8-0.9. Module-
swap notice delay doubles to at most 16 ticks (~100ms on this device's tick
rate) against a module LOAD costing hundreds of ms — the plan's own bar for
"small, bounded, reversible," and matched the earlier `RETRY_TICKS`-family
precedent already accepted in this file.

**Does not close outright.** Residual against `off` (worst period 5.7 vs
5.1ms, calls/tick 0.8-0.9 vs 0.6) is smaller but outside the plan's ~10%
closure bar — the remainder is SU-14's own cost, amortized over a wider
divider, not a new movy term. Per the plan's own closure rule, this needs
**either** SU-14 (schwung PR #519) landing, **or** SP-47 recording an explicit
acceptance naming this residual number. Widening `RELOAD_POLL_TICKS` further is
possible (the win is `1/RELOAD_POLL_TICKS`-linear) but was not done blind —
a second widening wants its own fresh device measurement, not a repeat of this
one's math.

**Teeth, local — `browser-test/logic/schwung-page-idle-cost.mjs`.** Ticks the
REAL contract/cache (real `param_pages` via `SCHWUNG=`, mock `TrackPort`) 96
idle ticks (a multiple of both `FILL_TICKS`=8 and `RELOAD_POLL_TICKS`=16) and
asserts total host calls stay at or under a literal, hand-computed bound (not
derived from the runtime constants, so a broken divider and a broken bound
cannot move together) — measured 12 bulk + 31 single = 43 against a bound of
48. Breaking the divider (`sinceReload >= 1` instead of `>= RELOAD_POLL_TICKS`,
reverted after) reddened it at **133 calls vs the unchanged 48 bound** — and
also reddened `schwung-page.mjs`'s pre-existing "under one round trip per two
ticks" budget, confirming both catch the same regression shape. Also updated:
`page-contract.mjs`'s divider-throw test (hardcoded loop of 8 ticks would never
reach a 16-wide divider) now imports the real `RELOAD_POLL_TICKS` instead of
copying the number.

**Not movy's, scoped out:** `get overtake_dsp:*`'s extra idle rate — confirmed
schwung's own `shadow_ui.js`, not a movy call site, so there is nothing here
for movy to route through a cache or narrow.

---

### SP-50 — on a child-level page, movy and the controller disagree about WHICH child is showing, which makes the one fleet module that reaches the branch inert — CLOSED, both halves movy-side

**Product.** On a drum- or pad-level page, the parameter a knob turns can belong
to the NEIGHBOUR of the child the screen is on. Nothing looks wrong — the header,
the page name and the strip all say the child the user hit — and what answers is
the controller's child, not the user's, silently, on every turn on that page.

**Cause, half one: a permanent off-by-base — real, and with NO FLEET
EXHIBITION.** `focusVoice` in `src/renderer/schwung-page-input.ts` writes
`String(v.childIndex)`, a ZERO-based instance (`voices.mjs:109`), into the
module's child-index param — but Schwung's wire value counts from
`child_index_base`. Schwung converts in ONE place, next to the base that defines
it: `childIndexToWire(level, i)`
(`../schwung/src/shared/param_pages/child_key.mjs:181-183`) adds the base and
`childIndexFromWire` (`:194`) subtracts it, and nothing else on either side
applies it. On a level declaring `child_index_base: 1` the controller would
therefore track one instance BELOW what movy wrote: an off-by-base that never
corrects itself, not the one-tick staleness the comment at that site describes.

**No module in the fleet can exhibit half one, and the two halves of the reason
are two different modules.** The write above is conditional — movy writes the
param only where the level DECLARES one. Of the 95 dumps, exactly one declares
`child_index_param`, **sophie** (`ui_hierarchy_legacy` `root`/`ring`:
`child_index_base: 1`, `child_index_param: "focused_pad"`, `child_count: 16`),
and it declares no `child_note_base` — so `voicesOf` returns **zero** voices
(measured on its real dump, not inferred), `focusVoice` returns at its `!v`
guard, and movy never reaches the write. The one module that HAS voices is
**voice-poc**, and its `pads` level declares no `child_index_param`, so line
177's `if (cip)` is false and movy never writes there either. Recorded anyway,
because the conversion is a trap for the next module that declares both.

**Cause, half two, same root: a level with no `child_index_param` has no channel
at all — and THIS is the live defect.** Where the level declares none (voice-poc's
`pads`), movy cannot tell the controller which child the UI is on:
`syncChildIndexFromModule` returns early without one (`page_controller.mjs:1772`,
early return `:1777`; `liveChildIndex` falls back the same way at `:3981`), so
nothing refreshes `s.childIndex[level]` and the controller resolves at instance 0
(`childIndexFor`, `:817-820`) while movy navigates. That is why SP-39's
child-page warm is INERT on the one fleet module that reaches the branch:
`concrete` resolves at the voice movy is on while the controller stays on child
0, so pressing the level's Nth voice warms `p{N}_vol` and only N=1 matches the
`p1_vol` the controller reads — the other three children pay their singles.

**Pre-existing, and NOT a regression.** `git blame` on `focusVoice`'s write
above (`src/renderer/schwung-page-input.ts`) → `bf94962a` (2026-09-13). **Live under
`page`; unreachable under the default `off`** — and it is HALF TWO that makes
that true: it needs a module declaring a child note map, the fixture's `plaits`
is not one, and half one's shape (the param AND the base on one level) is one the
fleet does not contain. So it was invisible to every device run so far, which is
exactly why SP-30's flip is the deadline.

**Closes when:** a test drives the INSTALLED `voice-poc`
(`docs/module-dump/modules/sound_generator--voice-poc.json`; the fixture hook is
already in `browser-test/fleet-expect.json` → `voiceDeclaring`) on the `pads`
level it really publishes, and pins the two halves of the statement above: that
movy and the controller agree about WHICH child is showing when the level
declares no `child_index_param`, and that the warm covers the keys the controller
actually reads there. It must NOT be pinned on `child_index_base: 1` — that is
half one, which no fleet module can reach. `browser-test/logic/schwung-page-press.mjs`
(100 lines) drives `focusVoice(8)` only through the non-child path today, and
`grep -rn "resolveChildKey\|childLevel" browser-test/` returns nothing — **this
item is where the child-level branch gets its first coverage.**

**Fixed, 2026-09-20, movy-side only — `../schwung` untouched.**

- **Half two (the live one), fixed.** `jump`'s `concrete()`
  (`src/renderer/schwung-page-input.ts`) now warms at
  `ctl.childIndexOf(level)` — the controller's own oracle, already exported —
  whenever the level's `childLevel` declares no `child_index_param`, instead
  of always warming at the voice movy just pressed. This does **not** make
  the controller follow the pressed pad (no channel exists for that without
  the upstream change below) — it makes movy stop lying to itself: the warm
  now targets the cell `childIndexFor` will actually answer with. Tested
  against the real `docs/module-dump` `voice-poc` fixture in
  `browser-test/logic/schwung-page-press.mjs`. **Teeth**: reverting `concrete()`
  to the old unconditional `childIndex` turns the warmed key from `p1_vol`
  (instance 0, correct) to `p2_vol` (the pressed voice, wrong) — verified by
  hand before landing.
  **Found while writing that test, recorded here because it changes what the
  fix is worth today:** Schwung's own planner (`page_plan.mjs`'s
  `childPickerNeeded`, `if (!idxParam) return true`) inserts an items-kind
  picker page ahead of the level's knobs page for ANY level lacking
  `child_index_param` — and `focusVoice`'s first-match-by-level loop lands
  there. That page carries no `keys`, so `jump`'s whole warm block — old code
  or new — never runs at all on an unmodified press of `voice-poc`'s `pads`
  (measured: `focusVoice(5)` on the untouched fixture reads nothing). The test
  above splices that picker page out of the real, device-shaped page list to
  reach the branch; the real planner cannot produce a first-match knobs page
  for this shape today. **This means the fix is currently dormant on the
  fleet**, same as the bug it replaces — both are real once a module's
  `focusVoice` press can land directly on a childless-index level's knobs
  page, which today requires either an upstream planner change or a movy-side
  fix to which page a press selects (a different bug, not opened here).
- **Half one (the off-by-base), fixed, no fleet exhibition.** The write in
  `focusVoice` now routes through `lib.childIndexToWire(lvl, v.childIndex)`
  (added to `SchwungLib` in `src/renderer/schwung-lib.ts`, guarded optional
  like `resolveChildKey`) instead of `String(v.childIndex)`. No dumped module
  declares both `child_index_param` and a note map on one level, so this is
  pinned by a **hand-built synthetic hierarchy** in the same test file, not a
  real dump — the cost stated plainly: it proves the arithmetic
  (`childIndexToWire` applied, with the right level/index), not that a
  shipping module round-trips it. **Teeth**: reverting to
  `String(v.childIndex)` turns the wire write from `'2'` (instance 1 +
  `child_index_base: 1`, correct) to `'1'` (wrong) — verified by hand before
  landing.

**Needs:** nothing further on movy's side. `SU-15` below, if the maintainer
wants the fleet-exhibition gap closed for real.

---

### SP-52 — the master chain: MFX and the sends are on movy's renderer under every flag value (NEW, 2026-09-20)

**Product.** Four master FX slots and three send buses hold ordinary audio-FX
modules with ordinary contracts — the same modules a track slot holds, and often
literally the same module. Under `page` a track's copy is drawn by Schwung and
the master's copy is drawn by movy, on the same screen session, from the same
`chain_params`. That is the migration's worst kind of half-state: not a
regression anyone can point at, but two renderers for one module, and a user who
has been told the setting changes how module pages look will find a page it does
not change.

**This one is already half done, by accident, and the half that exists is the
INPUT half.** `knobModel()` returns the master model while the master chain is
on screen (`midi/router.ts:131`), the knob-CC branch resolves
`pageOwnerOf(model)` (`:577`), and the jog calls
`pageOwnerOf(masterModel()).changePage` at `:980`, `:1038` and `:1054`. So the
gestures already ask the delegated owner. Nothing draws it and nothing polls it:
`moduleGridOnScreen()` is false in session mode by an explicit clause
(`app/page-poll.ts:66`), so `contract.tick()` never runs, `page.ready` never goes
true, `owner.page` stays null and every question falls through to the movy owner
underneath. **Inert, and that is the only reason this has not been a bug report.**

**Design & implementation.** Four defects, all movy's, and the first two are live
the moment the third lands — fix them in that order or the first frame reads the
wrong chain.

1. **The port.** `schwungPageFor` builds the page on `portFor(trackIndex)`
   (`renderer/schwung-grid.ts:119`). A `master_fx:` key belongs to `hostPort(0)`
   and a `snd<n>` key to `engineRootPort()` — `componentPort` is the one place
   that rule is written down (`track/registry.ts:64`), and reaching a master key
   through `portFor` namespaces it `ch<N>:master_fx:…`, which is the exact
   failure that comment exists to prevent. Take `componentPort(trackIndex, componentKey)`.
2. **The cache id.** `trackIndex + ':' + componentKey`
   (`renderer/schwung-grid.ts:116`) gives a GLOBAL component sixteen pages, one
   per track, each with its own controller and its own read cache, and a track
   switch silently shows a different one. A master component's id must not carry
   a track. `pageRefOf` has the same problem one layer up — it stamps
   `appState.activeTrack.index` onto every ref (`app/page-owner.ts:101`) — and
   the two must be fixed together or the id and the ref disagree.
3. **The render.** The session branch calls `renderKnobsView(vm, ...)` with no
   body and no chrome (`app/tick.ts:838-846`). It needs the same three arguments
   the `VIEW_KNOBS` branch passes, from a `pageOwner` built off `masterModel()`
   — and `moduleGridOnScreen()` has to stop excluding session mode, which means
   its `!seqState.sessionMode` clause becomes `sessionMode → masterDetail`
   (the master slot GRID is a chain view, not a param page).
4. **The tilde.** `modulatedKeysOf` walks `appState.trackModels[track]`
   (`app/modulated-keys.ts:27`) and the master models are in
   `appState.masterFxModels`, so a master FX parameter driven by a master LFO
   would report unmodulated forever. One branch on `isMasterComponent`, in that
   file, next to the existing walk.

**No upstream change, and none is conceivable for this item** — these are seven
ordinary module contracts reached through three ports movy already owns.

**The send's key form is the trap.** A send's component key IS its namespace —
`snd0:cutoff`, with `EngineRootPort` adding nothing — and `qualify`
(`renderer/schwung-page.ts:111`) passes any key containing a colon through
untouched, which is correct here by luck rather than by design. Pin it: a test
that asserts a send page's write lands on `snd0:<key>` and not on
`ch0:snd0:<key>` or `snd0:snd0:<key>`.

**Closes when:** under `page`, MFX 1–4 and SEND 1–3 draw Schwung's body with
Schwung's chrome; a master page's reads and writes are asserted to go through
`componentPort`'s destination and not the active track's; one master component
holds ONE page across a track switch (asserted, not reasoned); a master LFO
target wears the tilde; `page-mode.mjs` does not grow; and a `page`-mode
screenshot scene covers a master FX page and a send page.

**Needs:** SP-40 (so the flag has two values) and SP-47 (so there is a release
this can be reported against). Not blocked by SP-30.

---

### SP-53 — Set Params and Clip Params become a host-owned contract (NEW, 2026-09-20)

**Product.** The two global parameter pages — tempo/swing/link/quantize/root/key/
mode/layout, and scale/length/transpose/quantize — are knob grids with labels,
values and under-knob LEDs, drawn by movy's own renderer through
`renderKnobsView`. They are indistinguishable from a module page to look at and
completely different underneath. Migrating them is what makes "Schwung draws the
knobs" true of the whole product rather than of one view, and it is the
precondition for deleting movy's renderer at all (see SP-41, below).

**Start with Clip Params.** Four cells, one of which (`QUANT`) is already the
same enum-square treatment a module enum gets, and one of which (`TRANS`) is the
only `n/a` case in either page. Set Params is the same work at twice the width
plus three long enums and the tempo knob's feel.

**Design & implementation.** The seam is a **virtual component**: a page whose
`prefix` names no module and whose io answers out of movy's own state.

- **The contract.** movy writes `ui_hierarchy` and `chain_params` as strings and
  answers them from `getParam` — `page_controller.mjs` reads both through the
  injection (`:1025`, `:1130`) and `schwung-page-io.ts` already intercepts the
  first. `chain_params` carries min/max/step/`options`/`short_options`; the
  documented types are enough for every cell on both pages (`validate_contract.mjs`
  lists `float int enum string filepath file canvas wav_position note rate
  module_picker parameter_picker`, plus `toggle` in use).
- **The io.** `getParam`/`setParam` over `seqState` and `keyboardState` instead
  of over a port. This is where the page's identity stops being a `TrackPort`,
  so `createSchwungPage` has to take a param SOURCE rather than a port — today
  it takes `port` and threads it into the cache, the hierarchy reader, the io and
  the input (`renderer/schwung-page.ts:118-146`). Introduce the interface; do
  not widen `TrackPort`, which means something specific.
- **The read cache is the question to answer first.** SP-26's cache exists
  because a port read is a ~2.8 ms blocking round trip. A `seqState` read is a
  field access. Either the source declares itself cheap and the cache becomes a
  passthrough, or a whole page's worth of synchronous reads per tick appears on
  a page that had none. Decide it in the plan, with a number.
- **Three cell readings need `formatValue`**, which movy has never injected
  (`page_controller.mjs:635`): tempo's `120 EXT`, transpose's `n/a` on a drum
  track, and the toast's `+3 ct` / `N steps` / `%` units. `formatValue` takes the
  FULL key and a `surface` of `"cell"` or `"header"`, and null falls through per
  key, so it answers exactly these three and ignores everything else.
- **Two cell SHAPES are movy's own** — `preset`'s big number (tempo, swing, root,
  length, transpose) and `switch` (LINK). Route: `vizOverrides` returning a
  `custom:` kind against movy's own widget registry
  (`renderer/schwung-widgets.ts:50`), which SP-28 already proved works and which
  degrades to a detector guess rather than a hole (`viz.mjs:256-280`). **Take
  Schwung's native drawing first and only reach for a widget where the reading
  is genuinely worse** — the acceptance bar at the top of this file is native
  Schwung, and a big-font number that Schwung would draw as a dial is a movy
  extension, not a regression.
- **The long-enum overlay stays movy's.** KEY, MODE, LAYOUT and SCALE open
  movy's scrollable overlay today. Under a delegated page they become a dive
  intent, which the controller raises and **never opens itself** — the editor is
  the host's, which is SP-17's code and SU-4's ruling. So this is wiring to an
  existing screen, not a new one.
- **The writes are not free of the sequencer.** `mainPageKnob` and `clipPageKnob`
  (`midi/router.ts:538,542`) do more than set a field — tempo talks to the
  transport, length talks to the engine's loop window, scale re-quantises. The io's
  `setParam` calls those functions; it does not assign.

**Closes when:** both pages plan and draw under `page` with no movy body; every
cell's reading matches the `off` arm or is justified against the acceptance bar
in the commit message; a knob turn on each page has the same effect it has today,
asserted through the existing page logic tests and not only by screenshot; `off`
is byte-identical; and each page has a `page`-mode screenshot scene.

**Needs:** SP-40, SP-47. Independent of SP-52.

---

### SP-54 — the step page: a contract that exists only while a step is held (NEW, 2026-09-20)

**Product.** Velocity, length, probability, condition and invert, for the trig
under the finger. This is the page that makes movy an Elektron-style sequencer
rather than a knob box, and it is the one in this wave with a real reason to stay
movy's: it is contextual, its cells are shapes Schwung has no kind for, and it
shares a screen with the held-step gesture that SP-35 spent an item getting
right.

**Design & implementation.** Do SP-53 first — this is the same seam under harder
conditions, and doing it first would design the seam around the hardest case.

- **The contract appears and disappears.** A step hold adds a level; releasing
  removes it. `hierarchy-source.ts` synthesising a level is the same rung SP-14
  established. **The cost is a re-plan on every hold**, and on `origin/main`
  `load()` re-plans unconditionally — see the correction in *The pages that are
  not a track module's*. Measure it on a large module (minijv, 70 pages) before
  committing to the shape; the fallback is route 3 there (movy keeps the screen,
  Schwung keeps the module's page set) at the cost SP-31 and SP-50 describe.
- **Three shapes have no Schwung kind**: `vbar` (velocity), `len`'s stacked
  fraction (`1/16`), and `cond`'s big `A:B`. `vizOverrides` + movy's widget
  registry is the route, exactly as SP-53's two are — and unlike SP-53's, these
  three are not a restyle of something Schwung draws adequately. They are the
  page.
- **`holdGateMixed` has no contract expression.** A multi-step hold shows `...`
  for a length that differs between the held steps. There is no "indeterminate"
  in `chain_params`; `formatValue` can return the string, and the *widget* has to
  agree not to draw a position for it. Name this in the plan — it is the one
  reading that cannot be inferred from a value.
- **`hiddenDuringHold` does not come along.** SP-35 ruled that the offer that
  cannot be taken is answered at the gesture, from movy's own chrome, not by a
  dimmed cell — and these five params are intrinsic trig properties which take no
  lane at all, so the filter has nothing to say about them. Confirm that reading
  in the plan rather than assuming it.

**Closes when:** the step page plans and draws under `page`; a held step still
shows the trig's five properties and editing each one still writes the trig; the
hold's re-plan cost is MEASURED on a large module and recorded here; `off` is
unchanged; a `page`-mode screenshot scene covers a held step.

**Needs:** SP-53 (the seam), SP-35 (done).

---

### SP-55 — MIX, the track LFO page and the master LFO page (NEW, 2026-09-20)

**Product.** Three pages that already occupy chain slots, already have a
component key and already have a port — and are refused delegation by name:
`isMovyOwnComponent` answers true for `mix` and for anything ending `lfo`
(`chain/config.ts:89`). The refusal is correct today and for a stated reason: no
module declares them, so Schwung's planner had nothing to plan and was handed
them anyway, building a controller whose contract never resolved.

**These are the EASIEST case in the wave, not the hardest**, and worth doing
right after SP-53's seam exists. Unlike Set Params and Clip Params they need no
virtual param source at all: their keys are real params behind
`portFor(track)` and `hostPort(0)`. All that is missing is the contract — which
is the string movy writes.

**Design & implementation.** Write `ui_hierarchy` for each of the three out of
what movy's own model already knows (`mixer/mix-model.ts`, `lfo/model.ts`), hand
it back from `hierarchy-source.ts`, and delete the corresponding clause from
`isMovyOwnComponent`. Three specifics:

- **The LFO page is addressed by TRACK, not by component.** It is a fifth chain
  slot exposing the track's two schwung slot LFOs, and the slot-addressed APIs
  refuse `slot >= 4` — write through `portFor(track)` (carried ruling, also
  SP-24's). The master LFO page is the same shape on `hostPort(0)`.
- **The LFO target cell is exactly what `formatValue` exists for.** A target is
  stored as `fx1` and reads `FX 1: Room Size`; only movy knows what is loaded in
  `fx1`, and the library's own comment on `formatValue` (`page_controller.mjs:617-635`)
  names this case verbatim. Inject it here.
- **The mix page's sends must not become a second write path.** A send amount
  lives in movy's engine under `snd<n>:`; the io writes through the existing
  mix-model setter, not by assigning a param.

**Closes when:** the three pages plan and draw under `page`;
`isMovyOwnComponent` is gone or reduced to whatever genuinely has no contract;
an LFO target cell reads its resolved name; `off` is unchanged; a `page`-mode
scene covers each of the three.

**Needs:** SP-53 (`formatValue` and the widget route are established there).

---

### SP-56 — Settings, CPU and Backups: a scope decision, not a build (NEW, 2026-09-20)

**Product.** Three screens reached by Shift+Step that are NOT parameter pages:
Settings is a scrolling list of flags with one live knob, CPU is a meter, Backups
is a restore picker with a confirm. Calling them "parameter pages" and putting
them in this wave would be the scope creep this ledger's acceptance bar exists to
prevent.

**Output is a ruling recorded in this ledger, and if it implies work, new
items — not an implementation.** What to establish:

- **Settings** is the only plausible candidate. Schwung has a list page kind
  (`PAGE_ITEMS`) and a caller-supplied menu kind (`PAGE_MENU` via
  `trailingMenus`, `page_plan.mjs:381`), and a flag row is an enum with a name. It
  is also the page that carries the `schwunggrid` flag itself, so a delegated
  Settings page is a page that can turn off the renderer drawing it. **That
  circularity is the reason to decide rather than to build.**
- **CPU and Backups** have no parameter reading at all and the only route is
  `drawCanvasPage` — a custom page body ticked every frame, which movy correctly
  does not inject today. Recommend: out of scope, permanently, and say so here so
  it is not re-derived.

**Closes when:** the ruling is written into this file and any implied items are
opened with ids.

**Needs:** nothing. Can be done at any time; cheapest done before SP-41 is
seriously considered.

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

### SP-37 ✅ 2026-09-19 — the header names the page, not movy's bank

**Symptom.** On the module view the right-hand end of the header is where the
page is named. Under `page` it showed one fixed string for every page — the
reporter read it as "Preset" or the preset's name — while the bank bar and the
body paged under it.

**Cause.** `renderer/knob-view.ts` built that text as
`vm.drumPadName || vm.bankName`: **movy's** bank. The bar eleven lines below was
already Schwung's (`schwungBankFor`, over the delegated page's
`pageIndex`/`pageCount` — the two page sets differ in length, which is why the bar
had been moved first) but the NAME was never moved with it. So the bar paginated
one set while the label named the other, and on a module whose movy config opens
with a preset bank that label is a constant.

**Fix.** `PageChrome` gained a third field, `pageLabel`, filled by
`pageLabelFor(ctl)` from `ctl.pageLabel()` — the controller's own name for the
page on screen, never `page.name`, because a page belonging to a CHILD level is
named after WHICH child it shows and the planned name cannot know. It now LEADS
the header's right-hand text, through `headerRightText(vm, chrome)`:

```
chrome?.pageLabel || vm.drumPadName || vm.bankName
```

**The precedence, and the finding that fixed it.** The brief asked for "the
**drum pad name** still outranks the page label **on a voice page**". The first
fix implemented the bold half and dropped the qualifier, so `vm.drumPadName` —
the FOCUSED pad's name, a property of the MODULE and not of the page — led on
every page: the §1 symptom one class wider, still standing on any module that
declares a rack. The repo's own metadata had the witness all along: `voice-poc`
in `docs/module-dump/device-dump.json` declares `pad_layout: "drums"` with a page
per voice, so with pad 2 focused its six pages read *Kick* / *Snare* / *Hat* /
*Reverb* / *Selected Pad* / *Tom Lo* while the pad's name said *Snare* on all
six. The ruling that closes it: **the pad name wins on the page that IS that
pad's page — where the page label already carries the same word — and the page
label wins otherwise, with the pad name as the fallback.** That is exactly the
`||` chain above, because on the pad's own page the two ARE the same word; the
pad therefore still names the header there, the pad ICON names it on every other
page, and where no page can be named at all (`off`, a chrome withheld because
the delegated page is not the body, a controller that cannot name one) the pad
name and then movy's bank follow — movy's header before this item, unchanged.

**The held-knob ruling, kept.** The held-knob header still outranks the label
(`chrome?.header` is tested FIRST, and `heldHeaderFor` is untouched). A null or
empty label falls through rather than blanking the header.

**Departure from the entry's route.** The entry said to expose the name on the
`SchwungPage` facade beside `pageCount`/`pageIndex`. It went on `PageChrome`
instead: `chromeFor` is the one place that composes what movy says while a
delegated page is the body, and the one place that already knows whether it
should say ANYTHING — the whole object is withheld where the delegated page is
not what is drawn (`schwungChromeFor` returns undefined), and that single guard
is what keeps `off` byte-identical. A facade getter would have been a second seam
for one fact, and the renderer has no page object to ask. The expression itself
is exported (`headerRightText`) for the same reason: a renderer read only as
pixels cannot say "and it changes when the jog does".

**Teeth.** Each with the fix removed and the suite re-run — both tiers, because
the logic assertions are about the rule and the baseline is the proof that the
view draws it. The whole `||` chain reverted to `vm.drumPadName || vm.bankName`
→ **11 logic checks red**, `page_body_p2` red (**79 px**) and `page_voice_pad`
**throws** ("the frame draws \"Snare\" where the page is named \"Kick\""). The
first fix's precedence (`vm.drumPadName || chrome?.pageLabel || …`) put back →
the same 11 and the same throw. `pageLabelFor` returning null → **6 logic
checks red**, `page_body_p2` red (**79 px**), `page_voice_pad` throws. **Six,
not twelve**, and the difference is the test's own shape rather than a weaker
arm: nulling the label is precisely the case the loop's
`if (label === null) continue;` guard (`logic/schwung-page.mjs:417`) exists for,
so the six per-page `page N draws its own name` assertions are SKIPPED there —
they contribute nothing to the count in either direction — and the six that do
fail are the three empty-array structural checks (`IS the pad's own: []`,
`and another is not: []`, `CHANGES ... : []`) plus the three pre-existing label
checks (`carries the page's own name: null`, `...for the page on screen:
expected "Kick", got null`, `...and the jog moves it: still null one page on`).
Both halves need `SCHWUNG=../schwung` at BUILD time as well as at run time:
`npm run build:browser` without it bakes a `dist/esm` in which the whole Schwung
half prints SKIPPED and reports zero, which is how a figure like this can be
taken from a build that never ran the arm. The `off`
check's `setSchwungGridMode(null)` dropped → that check red, with the live
delegated page printed in the failure. `page_body` is green in every arm:
`test16`'s page 0 is named *Main*, the same word movy's bank says, so page 0 is
the one frame where the two sets agree and this bug is invisible. `page_body_p2`
is `test16` one jog click on — *Main - 2* where movy's bank says *Main*.
`page_voice_pad` is the real rack, replayed by `dump-fixture.mjs` from the dump
(a mock was written for it first and deleted: its page names were the mock's own
invention, so a change to Schwung's naming would have moved the fixture rather
than the baseline). The scene asserts the two names DIFFER — the pad's name is
only evidence of the precedence if the label it beats says something else — and
that the frame draws the page's, so it cannot pass by coincidence. **What the
frame reads — `T1 > VOICE-POC` … `KICK` with the focused pad *Snare* — is
DERIVED, not a reading** (corrected in the record round, F8'): nothing in this
round OCRs the baseline, and the ledger's own standard is that a count is read
back rather than recalled. It follows from the code — `rightText =
headerRightText(vm, chrome)`, which is the argument `drawHeaderWithPadIcon` /
`drawHeader` receive at `src/renderer/knob-view.ts:74-78` — together with a green
`page_voice_pad` whose scene throws unless the drawn text IS the page's name. The
pixel-level evidence for this precedence is a failure count and not a rendering:
putting the old precedence back makes `page_body_p2` differ by **79 px**, and
that number is a measured diff, not a guess at what the frame says.

**Not covered.** No measurement of a saving, and the cost is not nothing: one
`ctl.pageLabel()` per rendered FRAME, which on a child-level knob page is an
`s.pages.filter(...)` plus a template string
(`param_pages/page_controller.mjs:877-900`), and it is paid and discarded on the
chain view too (`src/app/tick.ts:919`, `paging: false` — `chain-view.ts` reads
only `chrome.header`/`chrome.footer`). Not gated on `paging`, because `paging`
answers a different question; SP-49 is the item about `page`'s standing per-tick
cost. The held-knob branch is pinned only by two pre-existing scenes —
demoting the readout below the label reddens `page_chrome_held` (**726 px**) and
`page_chrome_flip` (**721 px**). And **only `page_body_p2` and
`page_voice_pad` were ever regenerated**, both surgically (the baseline removed
and re-saved by the next ordinary run, never a blanket `--update`).

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

**NOTES — one gap that reaches an INSTALLED module, two traces, one device
fact.** Recorded rather than fixed, each for a reason.

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
  reason, and it is stronger than "no module arrives": `focusVoice`
  (`src/renderer/schwung-page-input.ts`) writes the index only where the level declares a param, so `focusVoice` writes
  nothing, `syncChildIndexFromModule` returns early without one
  (`page_controller.mjs:1772`, early return `:1777`; `liveChildIndex` falls back
  the same way at `:3981`) and the controller resolves the child at instance
  0 (`childIndexFor`, `:817-820`) while `concrete()` resolves at `v.childIndex`.
  On pads 2-4 the warm therefore covers `p2_vol`/`p3_vol`/`p4_vol` while the
  controller reads `p1_vol`: **the press still pays its singles on the only fleet
  module that reaches the branch.** State plainly, because this reads like a
  regression and is not one: pre-fix behaviour was identical, and no wrong value
  is ever cached (entries are keyed by the CONCRETE key).
  **The recheck trigger is SP-50, not a module arriving — the module is already
  here.** (SP-50 also carries an off-by-base on the wire value, and THAT half
  cannot fire in this fleet at all — the missing `child_index_param` above is
  what is live.) Recheck it there, against the press suite in
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

**RESCOPED BY THE 2026-09-20 WAVE, and the scope SHRANK.** SP-53, SP-54 and
SP-55 migrate the step page, Clip Params, Set Params, MIX and the two LFO pages
to a host-owned contract. A page that has migrated is no longer a movy-only page
kind and needs no ownership declaration here — it is a delegated page like any
other. What is left for this entry is whatever does NOT migrate: the trigger
badge and its 700 ms re-arm debounce, and whatever SP-56 rules out of scope. Read
this entry against the wave's outcome, not against the page list above, which was
written when every one of them was staying.

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

**Needs:** every Phase 1 and Phase 2 item and SP-29's decision. **SP-31 ✅ is
closed (2026-09-19)** — a `page`-mode defect — a lost knob release latches the controller and swallows
every later jog click — so it cannot happen while `off` is the default. This is
the item that makes `page` the default, which makes SP-31 a precondition of it.
SP-32's own row already carries the same "before SP-30" dependency; SP-31's is
now satisfied.

---

### SP-40 ✅ 2026-09-20 — the flag becomes two values: delete `body`

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

**Needs:** SP-40, SP-30 having been live long enough to trust, an explicit
decision that both renderers are NOT being kept — see the note at the top of this
entry — **and SP-53, SP-54 and SP-55.** That last one was implicit and is now
written down: the deletion list above includes `src/renderer/label.ts` and
`knob.ts`, and Set Params, Clip Params and the step page all draw through
`renderKnobsView`, which draws through both. So either that wave lands first or
SP-41 keeps movy's renderer alive for three pages and deletes nothing.

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

- **SP-40 ✅ 2026-09-20 — `body` deleted; `schwunggrid` is a two-value flag,
  and a stored value needed a REMAP, not a clamp.** `schwung-body.ts`,
  `schwung-body.off.ts` and `schwung-flag.ts` are gone; `SchwungGridMode` is
  `'off' | 'page'`; `knob-view.ts`'s body render is `bodyOverride() :
  drawKnobParams(vm)` with no third branch. **The precedent this sets for any
  future flag renumbering:** `FlagDef` gained `remapAt?: (old: number) =>
  number`, applied in `flags.ts`'s `ensure()` only in the branch a stored value
  is `superseded` (same `revisedAt` trigger as an ordinary default change) —
  `clampFlag` alone would have mapped old `DRAW=1` onto new `SCHWUNG=1` by
  coincidence of range-shrinking, silently handing a restyle-only user the
  fully delegated, re-paginating renderer on upgrade. `remapAt: (old) => (old
  >= 2 ? 1 : 0)` (old `PAGE=2`→new `SCHWUNG=1`, old `DRAW=1`→new `MOVY=0`, old
  `MOVY=0` stays `0`) with a fresh `FLAGS_REV` bump to **5** (not a reused 4 —
  `engpersist` already adopted against 4, and a device past rev 4 must not
  re-trigger that a second time). **Teeth:** removing `remapAt` reddens exactly
  one of the two new assertions (`old PAGE (2) remaps to new SCHWUNG (1):
  expected 1, got 0`) — the `DRAW=1` case stays green even without the remap,
  because it coincidentally lands on the same number (`0`) the plain
  `f.def`-fallback branch would have given it anyway; that asymmetry is exactly
  what makes the PAGE case the one that would have shipped a silent hazard.
  **Plan gaps found and fixed while implementing (the plan's inventory was
  otherwise accurate, verified file:line against the code before touching
  it):** three more `browser-test/logic/flags.mjs` assertions the plan's
  "no change needed" list missed, all reddening for real once the range
  narrowed — a knob-turn test that started `schwunggrid` at the OLD max (1)
  and turned further expecting a rise (now already at the new ceiling), a
  second "a flag with no revision keeps its stored value" control test at a
  different line than the one line the plan caught (both needed `setcommit`,
  not `schwunggrid`, as the control — `schwunggrid` is no longer revision-less
  after this item), and the `flagsRev` write-back literal in that same block
  (`4`→`FLAGS_REV`, since the bump to 5 is unconditional, not tied to which
  flag the fixture names). Screenshots: only `flags-scrolled.png` moved
  (`PAGE`→`SCHWUNG` text); `flags-top.png` byte-identical, confirming nothing
  else renders through the deleted path. `page-mode.mjs` stayed at 3 of 3,
  `schwung-off-is-free.mjs` stayed non-zero both arms (36.5 KB layer weight).
- **SP-31 ✅ 2026-09-19 — a lost knob release latched the controller, forever.**
  The release is delivered to the page that heard the PRESS: `midi/knob-page-pin.ts` is a
  `Map<knobIndex, page>` filled in the router's knob-touch branch and drained at the top of it
  (above the page overrides, which `return`), cleared where releases cannot come back. **The
  entry's open question is settled (c), with (a) refuted by measurement:** the `[page-plan]`
  line is byte-identical with the pin, without it and at BASE, so the pin does not touch the
  plan, and the `pct=1 ctlPages=1 names=Main` SP-17 recorded against a three-page fixture cannot
  come from a knob-indexed map drained in the `0x90 d1<8` branch — that block sends no knob note.
  Teeth: removing the delivery reddens two app-loop checks and `page-mode.mjs` calls both
  REGRESSIONs (`5 of 3`, exit 1); removing the drain reddens the ledger check too
  (`expected 0, got 1`). **`CC_NOTE_SESSION` toggles on the PRESS** — a test that releases the
  button once has not left session mode, which is what made the jog-click check toothless until
  it pressed twice. **Note, not fixed — now an item: SP-51** (the id was added 2026-09-19; it
  spent its first day as prose, and this line is where a later session was expected to find it).
  The movy MODEL's own touch is still resolved at release
  time (`knobModel()?.handleKnobTouch` vs `handleKnobRelease`); the LFO hold is not affected
  (`holdRelease` keys on the knob index alone).
- **SP-37 ✅ 2026-09-19 — the header names the page, not movy's bank.**
  `PageChrome.pageLabel` (`ctl.pageLabel()`, never `page.name`) rides with the
  chrome `schwungChromeFor` already withholds where the delegated page is not the
  drawn body; `headerRightText(vm, chrome)` in `renderer/knob-view.ts` is
  `chrome?.pageLabel || vm.drumPadName || vm.bankName` — the page's name LEADS
  and the pad name falls back, because a pad name that leads is a property of the
  module and not of the page, which pins the header to one word for the module
  (the reported symptom, one class wider). **Departure from the entry:** it named
  the `SchwungPage` facade; `chromeFor` is the one composition point AND the one
  place that already knows whether to speak at all. Teeth, each with the fix
  removed: reverted `||` chain → **11 logic checks** red, `page_body_p2` red
  (**79 px**), `page_voice_pad` throws; the first fix's pad-first precedence back
  → the same; `pageLabelFor` → null → **6** red (the six per-page
  `page N draws its own name` assertions SKIP on the `label === null` guard,
  `logic/schwung-page.mjs:417`, so they are not among them), `page_body_p2` red
  (79 px), `page_voice_pad` throws; the `off` check without `setSchwungGridMode(null)` →
  red with the live delegated page printed in the failure. **Four facts a later
  session would otherwise re-derive.** (1) **`page_body`'s baseline did NOT
  move** — test16's page 0 is named *Main* and movy's bank is *Main* too, so page
  0 is the one frame where the two sets agree and the bug is invisible; only
  `page_body_p2` (*Main - 2*) and `page_voice_pad` were regenerated, both
  surgically and never by a blanket `--update`. (2) **`vm.drumPadName` can only
  come from a module that DECLARES `pad_layout: "drums"` with named voices**
  (`model/hierarchy.ts`, via `readSurface`), so `mock-synth.mjs` can never supply
  one — and **"no mock does" is not "it does not happen": `voice-poc` in
  `docs/module-dump/` is a real, installed fleet module, so the pad-name branch
  is reachable on a device whenever `page` is ARMED** — it is not reachable at
  rest, because the branch is behind `mode === 'page'`
  (`src/app/page-owner.ts:169-170` hands every other mode movy's own owner, and
  with it `page: null` and no chrome), and the box's resting
  `flags.schwunggrid` is **2** (`prefs.json`, read back on the device
  2026-09-19; the trailing top-level `"schwunggrid": 0` is inert), which is
  exactly why the ledger's own later section has to arm the mode to redden the
  device tier. Phrased this way in the record round (F5'), where "today" had
  overstated it; the conclusion is unchanged — the witness is
  `dumpFixture('voice-poc')` and the `drums_hier` mock written first is gone. (3) **The screenshot harness had no surface reader at all** —
  `setSurfaceReader(surfaceOf)` (`app/globals.ts`'s own start-up line) is now
  registered for `page_voice_pad` only and cleared for every other scene, because
  every other baseline was written without one; without it the scene throws "the
  rack declared no pad names". (4) **`ctl.pageLabel()` returns the CHILD's name
  on a child-level page**, so the planned name would print the wrong number — the
  header takes the controller's answer, as Schwung's own host header does. **Not
  covered:** no measurement (and the label is not free — one `ctl.pageLabel()`
  per rendered frame, an `s.pages.filter(...)` + template string on a child-level
  page, also paid and discarded on the chain view at `src/app/tick.ts:919`);
  the held-knob precedence is pinned by two pre-existing scenes — demoting the
  readout below the label reddens `page_chrome_held` (**726 px**) and
  `page_chrome_flip` (**721 px**).
  `MANUAL.md`/`README.md` were NOT edited: the `page` flag is not user-visible yet
  (SP-47).

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
  **[Cross-reference added 2026-09-19 by SP-31: do not re-cite this figure as a
  property of that design.** SP-31 ✅ closed by implementing the entry's own
  description of the pin — `Map<knobIndex, page>` filled and drained inside the
  router's `0x90 && d1 < 8` branch — and measured the plan line BYTE-IDENTICAL
  with the pin and without it, with `shift+jog: plain jog steps one page` green
  in both. A map drained in that branch cannot be reached by a block that sends
  no knob-touch note, so what was measured here was a pin reachable from
  somewhere this description does not name. See the SP-31 entry.**]
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
  **The check GATES ON THE ARM IT RAN IN** — first by reading the flag, then (see
  the 2026-09-19 arm entry below) by setting the arm itself. Under
  `schwunggrid=page` (the device's resting value, `prefs.flags.schwunggrid = 2`)
  Schwung owns the component's pages, so the UI stops calling `refreshOneParam`
  for it (`src/app/tick.ts` passes `!pageOwner.delegated`), `params` still counts
  populated params, and the samples read `perf_refresh_ms=0 params=14` — a full
  median of zeros that PASSED. That was this check's second vacuity hole, reached
  through the other door from the one 2026-09-13 closed, and nothing under
  `test-device/` set the flag; it depended on someone having set `0` by hand
  first. The fix made the check read `prefs.flags.schwunggrid` and FAIL when it
  is not `0`, naming the arm and the fix, so a run in the wrong arm can no longer
  report a green that means "not measured".
- **2026-09-19 — the flake ledger could kill a whole tier, and its headline
  number was a tautology.** Fix round on the entry above, both found by review.
  The ledger (`test-device/.flake-log.json`) was re-serialised as a JSON OBJECT
  by a hand-edit; `readLog` cast the parse to `RunEntry[]` with no shape check
  and `recordRun` spread it, so `[...readLog(p), entry]` threw **after all 18
  scenarios had run and before the summary printed** — no summary, no
  `→ .test-out/run.md` pointer, no exit code. `readLog` now returns `[]` for
  anything that is not an array, and `selftest/flake.mjs` covers valid-JSON-
  wrong-shape (its old corrupt-log case only ever wrote invalid JSON, which is
  why `npm test` stayed green while the real ledger was broken). Separately,
  `summarize` bumped `runs` and `flaky` in the same statement for a check-id row,
  so `runs === flaky` by construction, every check row printed `(100%)`, and such
  a row could never carry a denominator of passing runs — `smoke#refresh-blocking
  8 flaky 0 failed of 8 runs` was read as "never passed first try" when it had
  passed first try twenty times in between. A check row's denominator is now its
  scenario's run count.
- **2026-09-19 — the refresh check owns its arm; the operator does not.**
  The entry above made `smoke#refresh-blocking` FAIL unless
  `prefs.flags.schwunggrid` was `0`, which closed a real vacuity hole and opened
  a worse one: every task's contract is to restore the flag to what it found, the
  box rests at `2`, so a bare `npm run test:device` was red on arrival for a
  reason that was not movy being wrong — and `movy/CLAUDE.md` is explicit that a
  gate red by design is a gate people stop reading. **Measured on 2026-09-19 at
  the resting `2`: `smoke` 8/11 — `set-param-attempted`, `set-param-ipc` and
  `refresh-blocking` all red, all three for that one reason.** The other two are
  the same arm dependence, not a second bug: in the `page` arm Schwung owns the
  component's pages, so the knob turn never reaches `applyKnobDelta` and neither
  check can pass there by design.
  So the scenario **arms itself** — `probe.setGridMode('off')`, the override
  `page-lifecycle.ts` arms through, which writes no flag and so never touches the
  device's prefs — for the WHOLE scenario rather than around the one check that
  names the arm, because the other two are just as dependent and leaving them on
  the ambient arm is what kept the suite red on a box at rest. It is re-armed
  after the scenario's reopen, since `openTool` re-evaluates `ui.js` and the
  override is a module-level `let` (the same reason `page-lifecycle` re-arms
  after its own). The check then asserts the arm it actually ran in: `renderer`
  off the probe's page reply, which is `schwungGridMode()`'s own answer, not a
  read of the flag file it is derived from. **The assertion stays hard** — with
  the arm self-set, a red there can only mean a real disagreement.
  Teeth, without a device-forced red: with the two arm calls removed the check
  reddens with `the renderer did not answer 'off', it answered 'page'`, while the
  three samples it graded are `perf_refresh_ms=0 params=14` — `measured.length`
  3 and median `0`, so the arm is provably the ONLY thing standing between that
  window and a free green. The failure message no longer says to set the flag.
  `smoke.ts` paid for the addition by extraction rather than length: the
  log-field readers and the refresh window's arithmetic and thresholds moved to
  `test-device/log-fields.ts` (583 → 538 lines against the ~600 ceiling).
- **2026-09-19 — the arm is ONE shared thing, and the tier is green at rest
  because of it.** Fix round 2 on the entry above. It corrects two things that
  entry got wrong, both of them the coordinator's premise rather than the code:
  **the red-at-rest tier PREDATES this work.** `items` and `module-contract`
  have no `setGridMode` call at HEAD *or* at `234f7be^` — re-measured, they were
  failing at rest before the arm assertion existed at all — so `234f7be` did not
  make the tier red by design; it added `smoke`'s three failures to nine that
  were already there (`items` 3, `module-contract` 6, and `page-dive`'s single
  one which is the tracked race and not this class). "Red by design" was
  stronger than the evidence. What this work actually contributed is that
  `smoke` stopped grading a median of zeros and passing.
  **And the fix is all three scenarios', not `smoke`'s.** Arming one of them left
  the property the round was justified by — a bare `npm run test:device` that is
  green on a box at rest — untrue, so `items` and `module-contract` now arm too,
  one call each, immediately after `selectTrack(0)`. Neither reopens the tool
  mid-scenario, so neither needs the re-arm `smoke` does.
  **One value, in one place.** `test-device/arm.ts` holds `MOVY_ARM = 'off'` and
  `armMovy(probe)` — which returns the renderer the probe reports, so a caller
  can assert the arm it actually got as `smoke` does — together with the argument
  for the arm in full. **That "can" was the gap, closed 2026-09-19: `armMovy` now
  REGISTERS the check itself (`armMovy(t, probe)`, check id `arm-taken`,
  `arm-taken-after-reopen` for `smoke`'s second arm) so a caller cannot ignore
  it.** Only `smoke` ever spent the return; `items` and `module-contract` noted
  it and moved on, which is a false green in this tier's own class — a scenario
  that grades the wrong renderer reports feature failures that are a setting, or
  worse, passes on a `body`-arm box where the checks happen to hold. Teeth,
  measured on the device 2026-09-19 (see the record-corrections bullet below for
  the run): with `armMovy`'s `setGridMode` call replaced by a no-op — the one
  real failure mode, since the override writes nothing and does not survive a
  reopen — `arm-taken` reddens by name in `items` and `module-contract` while the
  checks below it stay red for the arm's own reason, and restoring the call
  returns both scenarios to green. Not three copies of a one-liner: the reason is long and
  must exist once, and a literal copied into three files is a set that silently
  drifts, at which point the argument stops holding for whichever scenario moved.
  `smoke.ts` imports it and drops its local block — **522 lines**, down from the
  538 the extraction left it at and 61 fewer than before this whole fix round
  (`items.ts` 360, `module-contract.ts` 526; all under the ~600 ceiling).
  **Measured on 2026-09-19 at the resting `2`, box untouched, before and after
  the source restore: 18 scenarios · 143 checks · 0 failed**, exit 0 — `smoke`
  11/11, `items` 7/7, `module-contract` 10/10, every one first attempt, no
  `⚠ FLAKY` anywhere in the sweep. Teeth, from a source edit and not a
  device-forced state: with each `armMovy` call replaced by a no-op note, the two
  scenarios redden again to exactly their pre-fix sets — `items` 4/7
  (`commit-once`, `reread-after-commit`, `selection-stuck`), `module-contract`
  4/10 (the five trigger-write checks `writes: none`, plus `non-wide-unaffected`,
  which reads as its own unmet precondition rather than as a missing write) —
  and both go back to green when the call is restored. **`page-dive` was left
  alone**: it arms `page` deliberately and its one failure is the race this
  ledger already tracks, a different cause.
  **One number to read with care: `smoke#refresh-blocking`'s `--flakes` row now
  has a MIXED denominator.** The historical rows were taken with the box set to
  `schwunggrid=0` and the recent ones with the scenario arming itself at rest.
  The check asserts the same thing in both arms, but no run can separate the two
  populations, so the printed rate (`8 flaky 0 failed of 39 runs`) blends them
  and is not a single-arm rate.
- **2026-09-19 — two RECORD NUMBERS were wrong, and they are corrected here
  because a reported SHA is not rewritten.** Both are from this branch's own
  commit messages; a message is history, but this file is what the next session
  reads as truth, so the correction lands where the claim was made.
  **(1) `871ae07`'s "eleven files name it, all in comments, none parsing it" —
  it is TWELVE files, and one is not a comment.** `git grep -l
  schwung-page-migration 871ae07 -- src engine build browser-test test-device
  scripts` returns 12: seven under `browser-test/`, two under `scripts/`, three
  under `src/`. Eleven of them name the ledger inside a comment; the twelfth is
  **`browser-test/page-mode-expected-fail.json`**, a JSON data file whose `note`
  field ends "Owner: docs/schwung-page-migration.md" — parsed by
  `page-mode.mjs`, which reads its `labels` array. The substantive claim still
  holds and was re-checked at that revision: nothing PARSES the ledger path, and
  `logic/page-owner.mjs`'s `CONTRACT_READ` allowlist really does name
  `src/chain/hierarchy-source.ts` and `src/modules/loader.ts` and nothing else.
  A count in a record commit is the class of defect this file exists to catch,
  which is why it is worth a correction rather than a shrug: at twelve the claim
  is still true, and at twelve it can be re-checked by one command.
  **(2) SP-31's reported `capture-fixed-notes 7/50 runs` — the denominator is
  wrong, and it is exactly the habit `234f7be` removed from the code.** 50 is
  the flake ledger's total number of recorded RUNS (all scenarios, last 50); a
  check's own denominator is its SCENARIO's run count, which `summarize`
  back-fills (`r.runs = rows.get(key.slice(0, hash))?.runs ?? 0`) — 36 for the
  `seq` scenario at the time. So the number the tooling prints, and the number
  this ledger should carry, is **`7/36`**; `npm run test:device -- --flakes`
  owns it. The code dropped the old habit in `234f7be` and the commit message
  kept it, which is the failure mode a READ-BACK rule is for: the only way a
  number in a record stays right is if the tool that produces it is asked.

- **2026-09-19 — the sweep's ONE red was a named race the flake ledger already
  had the rate for, and it is not this branch's.** The full tier on the branch
  tip came back **18 scenarios · 148 checks · 1 failed**: `smoke#set-param-ipc`,
  red through its own retry (`attempt 1 failed (assert)`, attempt 2 the same).
  What it asserts is that no `set_param returned false` appears in the gesture
  window; one did, out of the three knob writes the scenario makes
  (`set slot=0 gi=0 key=synth:engine` twice, `gi=1 key=synth:harmonics` once —
  `set-param-attempted` PASSED, so the writes were made).
  **The rate was already recorded**: `npm run test:device -- --flakes` says
  `smoke#set-param-ipc 4 flaky 0 failed of 42 runs (10%)`, and the `smoke`
  scenario itself `8 failed of 42 runs (19%)` — the check needed a retry on
  2026-09-17 and failed twice at `871ae07` earlier the same day, both **before**
  SP-36 existed. **Attribution, not assumption:** `false` is
  `host_module_set_param_blocking` refusing or timing out on the single-slot
  `overtake_dsp:` SHM (`src/host/param.ts` `paramSet`), the arm is `off` (so no
  delegated-page code runs at all), and **three standalone re-runs of the
  scenario on the same build came back green — 13 checks each, first attempt**.
  The sweep is where it bites, which is itself a clue: smoke runs 13th there,
  on a box twelve scenarios' worth of work warmer. **The real defect underneath is not the check:
  a refused knob write is SILENTLY LOST** — `applyKnobDelta` logs
  `set_param returned false` and moves on, so the detent the user turned does
  nothing. A bounded retry there (or a wider budget for this one write) is the
  fix; it is a movy defect rather than a migration item, which is why it is
  recorded here and not given an SP number.
