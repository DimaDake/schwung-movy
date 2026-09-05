# Schwung param pages in movy — findings

What we learned evaluating PR #18 (`charlesvestal:schwung-grid-delta`, merged as
899b294) on hardware and in the local suites, 2026-09-04/05.

The PR lets Schwung's `page_controller` plan and draw a module's parameter
pages instead of movy's own renderer. It merged **off by default**. This
document is the record of what stands between that and turning it on.

**Read the status tags.** Everything below is marked CONFIRMED (reproduced, with
a mechanism identified in code), REPRODUCED (seen on device, mechanism inferred),
or UNVERIFIED (suspected from reading, never reproduced). Several conclusions in
this evaluation were wrong before they were right, and the tags are what stop the
next reader inheriting a guess as a fact.

---

## 1. The three modes

| mode | who plans the page set | who draws the widgets |
| --- | --- | --- |
| `off` / MOVY | movy | movy |
| `body` / DRAW | movy | Schwung |
| `page` / PAGE | **Schwung** | Schwung |

`draw` is a restyle: movy's view model crosses the seam and Schwung expresses it,
so no parameter changes page or slot. `page` hands the planning over, which is
where the features are — every page kind (preset, items, menu, child pages, all
of which movy drew blank), divable parameters, the enum peek, the section picker,
module-supplied widgets (schwung #405), and drum racks a module declares itself
(#411). It is also where every finding below lives.

movy keeps its header, bank bar and footer in both (`bands: { header: false,
bank: false, footer: false }`).

---

## 2. Environment

**Schwung floor.** The PR needs Schwung `main` at or past #405 / #411 / #414 /
#415. An older install is missing `widget_registry.mjs` and `voices.mjs`
entirely.

**A file copy is not enough — the stack must restart.** Copying
`src/shared/param_pages/` onto a running device and reopening the tool produces:

```
Could not find export 'navLabelsOf' in module
  '/data/UserData/schwung/shared/param_pages/page_plan.mjs'
```

QuickJS caches modules per `shadow_ui` process. `shadow_load_ui_module` gives
`ui.js` a unique `path#N` name to dodge the cache, but **its imports are not
renamed**, so the already-loaded old `page_plan.mjs` is what a freshly loaded
`voices.mjs` links against. `page_controller.mjs` kept working because it was
cached from the same old generation and was self-consistent. Full
`scripts/install.sh` (which reboots) is the reliable path.

**The failure is silent.** `shadow_load_ui_module` → `eval_buf` →
`js_std_dump_error` writes to stderr, and `/proc/<shadow_ui>/fd/2 -> /dev/null`.
The device has no syslog. All `debug.log` says is `shadow_load_ui_module
returned false` and `"Error: Failed to load tool"`. To get the real message,
deploy a throwaway `ui.js` that does the import inside `try { await import(...) }
catch { console.log(...) }` — `console.log` reaches `debug.log`.

---

## 3. Findings

### Cause A — movy's model is still fully live under `page`

**CONFIRMED.** The largest cluster, and the highest-value fix. Under `page`,
Schwung owns the page set, but movy's model keeps polling
(`model/tick.ts:processTick` → `refreshOneParam`, one param per tick), keeps
building a view model every frame, keeps handling knob touches, and keeps a
`knobPage` index that no longer moves.

PR #18 routed **parameter** identity through Schwung — `knobInfoFor()` in
`router.ts` is a good fix, with an honest comment about having applied the rule
to one of three sites — but not **page** identity. Anything that addresses by
*(page, slot)* or navigates *by page* now resolves against a frozen `0`.

| symptom | mechanism |
| --- | --- |
| obxd: page draws correctly, but holding knob 1 opens **movy's** bank selector | `router.ts` calls `knobModel()?.handleKnobTouch(d1)` alongside `sp2.knobTouch()`; movy's model acts on its own idea of slot 0 |
| holding a step and jogging jumps straight to the trig-condition page, skipping everything between, then jumps back | `router.ts:815` — `const onBank0 = (m?.getKnobPage?.() ?? 0) === 0` is **always true**, so any CCW jog takes the `setStepPageSelected(true)` branch |
| file browser opens the wrong parameter, or nothing | `model/index.ts:361` — `gi = s.knobPage * KNOBS_PER_PAGE + local` |
| LFO assign / hold-to-modulate does not navigate, does not exit, shows None | `router.ts:675` — `lm.changePage(r.lfoIdx - lm.getKnobPage())` |
| knob LED rings show movy's parameter, not the drawn one | `tick.ts:729` and `tick.ts:757` — `updateKnobLEDs(vm)` on movy's view model |
| a movy page flashes before Schwung takes over | both engines render; movy draws until `sp.ready` |

**Data loss: Clear + knob deletes the clip.** Normally the Clear+knob branch
calls `clearLaneForKnob()` then `markDeleteActed()`, and that second call is what
stops Clear's *release* from also deleting the clip. When `knobInfoFor()` returns
null the branch never runs, the guard never fires, and the release falls through
to clip deletion.

**Evidence.** `browser-test/app-loop.mjs` fails **13 checks** with the flag on,
and every one belongs to this cause:

```
✗ chain page: file-param jog click opens file browser: expected 4, got 3
✗ browser opened: expected 4, got 1
✗ browseOrigin captured the pre-open view: expected 1, got 3
✗ Back leaves the file browser: expected 1, got 3
✗ select committed the preset path: … got undefined
✗ assigned: navigated to LFO slot: expected 4, got 1
✗ assigned: on chain view: expected 3, got 1
✗ assign mode exited: expected false, got true
✗ LFO page shows the assigned target (not None): expected true, got false
✗ module touch cleared on return: expected null, got 0
✗ held-step jog switches page: expected 1, got 0
✗ chain+held jog-press drills to params: expected 1, got 3
✗ shift+jog: plain jog steps one page: expected 1, got 0
```

**Direction of fix.** Movy's model should stop independently paging, polling and
handling input for a component Schwung owns. That also removes the leading
hypothesis for Cause F.

---

### Cause B — Schwung's chrome is suppressed and movy does not replace it

**REPRODUCED.**

- **Top toasts are movy's.** Schwung's header strip is the held parameter's full
  name and value, inverted (`headerStrings` in `render_page_movy.mjs`). movy
  draws its own header and its toast occupies that row, so the readout is lost.
- **Bottom hints never appear.** Schwung's footer is `[key, action]` pairs
  supplied by the *caller* — movy supplies none. On mrsample there is no
  "jog click to pick a sample" hint.

---

### Cause C — a whole class of dive is unimplemented

**CONFIRMED by reading; matches the device symptom.** `openSchwungEditor()`
handles enum-shaped intents only. The PR's own comment says so: *"An intent with
no options — a filepath, a canvas — has no editor here; it is logged rather than
dropped."*

So on mrsample the click reaches the controller, the controller returns an
`open` intent for a filepath, and movy drops it. The missing hint (Cause B) and
the missing action are the same gap seen twice.

---

### Cause D — contract lifecycle does not hold

**REPRODUCED.** Both are behaviours PR #18 describes as fixed.

- **Setting a slot to None leaves Schwung drawing the departed module.** The
  `refreshLoaded()` / `contractUnresolved` tri-state exists precisely for this
  (*"Reported as 'if I choose None I do not get kicked out'"*), but it does not
  hold in practice.
- **The first module into an empty slot does not take.** It stays on movy's page
  until you navigate to the chain view and back, sometimes also needing a page
  change. **HYPOTHESIS:** the retry budget — `RETRY_TICKS 12` × `RETRY_LIMIT 60`
  in `schwung-page.ts` — is spent before the module arrives, and only a cache
  drop re-arms it. `refreshLoaded()` re-arms on going *empty*, which does not
  cover a slot that was never loaded.

Related: after a reboot no chain slot is active and the remote-UI ring cannot
load the first module at all, which may compound this.

---

### Cause E — pad-scoped drum modules are not planned as voice pages

**REPRODUCED on 6W6.** Every page shows at once, and pressing a pad does not move
the page. The header *does* name the right pad — because that part is movy's —
which makes it look like it should be working.

6W6, 8W8, 9W9 and cw-78 declare voice pages the **movy** way (`bank.pad` in a
bundled config in `src/module-configs/`), not via Schwung's #411 declaration. So
the planner does not know those levels are voices, `focusVoice()` returns false,
and nothing follows the pad. A pad-scoped module should show its global banks
plus the selected pad's bank, not all of them.

This is the most dramatic user-visible regression found. A fix could live in any
of three places — movy reading `bank.pad` and telling the planner, a Schwung
fallback, or the modules declaring their racks the `voice-poc` way.

---

### Cause F — per-tick cost, worst on movy chains

**REPRODUCED, NOT ATTRIBUTED.** See §4 for the numbers and for why attribution
failed.

On a movy chain with a heavier module (mini JV) the jog becomes unresponsive
enough that the last page is unreachable, knobs lag, and **pads stop responding
too**. That last part is diagnostic: movy's tick period *is* its MIDI input
sampling interval (`process_shadow_midi` runs once per host loop, before tick),
so a longer tick degrades every input at once, and jog detents get coalesced.

Schwung slots feel fine; the problem is specific to movy chains, where each
param read is an engine round-trip rather than a cached slot read.

**HYPOTHESIS:** under `page` there are two independent readers on one page —
movy's model (`refreshOneParam`, deliberately one call per tick) and the
controller's `reloadIfChanged()` + `tick()` + staggered read cursor. Same fix as
Cause A.

**Related, CONFIRMED by reading:** starting to turn a knob to assign automation
has a distinct initial lag. `onKnobTurn`'s seeding branch does a blocking
`getParam(fullKey(key))` when the read cursor has not yet reached that
parameter. A knob *flick* is **not** a write storm — movy replays the delta as up
to 63 `ctl.onKnobTurn` calls, but they land inside one millisecond and
`SETPARAM_THROTTLE_MS` collapses them to a single `setParam` plus a
`pendingWrite`.

---

### Cause G — parameter graphics disappear, permanently

**CONFIRMED, both halves.** Two bugs, and the second is the nastier one.

**G1 — graphics vanish while a step is held.** This is a regression against movy,
not a shared design rule. movy's `label.ts:drawKnobRow` draws the envelope,
LFO wave, filter curve, EQ curve, cut curve and waveform *before* the per-cell
loop, unconditionally; `hiddenDuringHold` only skips individual knob widgets and
labels. So in movy you keep seeing the cutoff curve while placing a p-lock.

Schwung's rule is different — `page_controller.mjs:3840` and `:4015`:

```js
viz: (vizEnabled && !s.decorations) ? vizGroups() : [],
```

Graphics are suppressed whenever decorations exist *at all*. PR #18 also
hard-codes `viz: []` into the `body` adapter, so `draw` mode has no graphics
whatsoever.

**G2 — and they never come back.** `schwung-page.ts:render()` builds decorations
from whether a lane *exists* on the page:

```js
const on = lane >= 0 && (auto.activeLanes & (1 << lane)) !== 0;
```

There is no `auto.held` in that condition — `held` only decides whether a
`value` is attached to the decoration. So the moment a page carries any
automation lane, `s.decorations` is permanently non-null, and by the controller
line above **that page loses its graphics for good**. Automate one filter cutoff
and the curve never returns.

"Only set decorations while held" is not the fix, since the lock marks should
stay visible. The viz gate is simply too blunt: it could stand graphics down only
for a held p-lock readout, or only for the cells a graphic actually spans.

---

### Smaller findings

**The body sits 2 px too high and overlaps movy's bank bar. CONFIRMED.**
`schwung-page.ts:render()` passes no `rect`, so `movyBandLayout()` uses Schwung's
own vertical rhythm: widget row 0 at `y=9`, on top of movy's bank bar (`BAR_Y 8`,
`BAR_H 2` → rows 8–9), and the last label ends at 54 leaving three dead rows
before `TOAST_Y 58`.

Supplying `rect: { x: 0, y: 10, w: 128, h: 47 }` reflows it: `y += gutter0(1)` →
row 0 at **11**, then `+15+7`, `+gutter1(2)` → row 1 at **35** — exactly movy's
`ROW0_Y` and `ROW1_Y`. The body needs precisely 47 rows
(`1+15+7+2+15+7`), so `10+47 = 57` sits right above the toast band. Label rows
still land one row higher than movy's (26/50 vs 27/51) because Schwung's widget
band is 15 tall and movy's is 16; that is not reachable from the rect.

`schwung-body.ts` has the same issue with `BODY_Y = 8, BODY_H = 48`; the aligned
values are `10` and `47`. Its comment claiming this "is the only rect that fits"
is not right — the requirement is 47 rows, so `y` has room.

**The held-step filter is gone. CONFIRMED.** movy's `hiddenDuringHold` hides
non-automatable params while a step is held and, at the 8-lane cap, hides
unassigned ones — so every knob you can see is one you can edit. Nothing in
`schwung-page.ts:render()` does this. Cheap fix: `schwungBodyFor()` already
returns `undefined` for `stepPageSelected` to keep movy's own screen; extending
that gate to `vm.automationHeld` restores it.

**Automation dot and modulation tilde collapse into one mark. CONFIRMED.**
`drawLabelCell` draws a 2×2 dot for automation and a 4×2 tilde for LFO
modulation, deliberately distinct at a glance. Schwung's channel is
`decorations: { value, locked }` — one bit — and `schwung-body.ts` maps
`(c.automated || c.assigned)` onto it. The modulation tilde disappears. Schwung
has no LFO modulation of its own, so there is nothing upstream to align to; this
needs one extra field.

**P-lock value not highlighted under the knob. REPRODUCED.** Holding a step does
not highlight the automated parameter's value the way movy does.

**Automation range may be wrong. UNVERIFIED.** Live recording sometimes plays
back over what looks like a different range than was recorded. Could be Cause F
lag. The other candidate: the lane's `min`/`max` now come from
`ctl.metaIndex.getOrGuess(k)` (`knobParamInfo` in `schwung-page.ts`) rather than
movy's metadata, so where movy's config corrected a wrong range the lane now
uses the module's uncorrected one.

**Possible overlay double-draw. UNVERIFIED.** `knob-view.ts` runs
`drawEnumOverlay(vm)` after the body, while `schwung-page.ts:render()` calls
`ctl.renderOverlays(ctx, { clearScreen })`. Two overlay systems on one frame,
both permitted to clear the screen.

**MrDrums whole-preset selection.** No way to select the whole preset through the
file browser. Almost certainly an mrdrums-side gap, not PR #18's.

---

## 4. Measurements

### What was measured

Passive `perf_ipc` capture (`src/app/perf-probe.ts`) while a human drove the
device, on a **movy chain** (track index 4 / `ch0`, Sophie), with
`schwung-body ok track=4 ck=synth pages=3 at=1 → at=2` interleaved in the same
window — proving both that the grid owned the frame and that the page was
actually moving.

```
idle       period_ms 5.6    calls/tick 0.6   peak_period 81
jogging    period_ms 23.8   calls/tick 5.2   peak_period 120
           get overtake_dsp:* n=2.3 ms=6.2 | mget ch4:* n=2.2 ms=5.8
```

A 120 ms worst tick. Since the tick period is the MIDI sampling interval, that is
long enough to coalesce jog detents — the "swallowed jog" symptom and the
"laggy knobs" symptom are the same number.

For scale: stock movy's module page is designed around **one** param read per
tick (`refreshOneParam`), and that ceiling is why the tick rate is what it is.
4.5 host calls per tick is 4–5× that budget.

### Why it is not attributed

**No flag-off arm was obtained.** Everything below failed, and the reasons are
worth recording so the next attempt skips them.

1. **Synthesised gestures cannot reach an overtaking tool.**
   `shadow_ui.c:process_shadow_midi` re-resolves `onMidiMessageExternal` on every
   message for **cable 2** ("in case overtake module replaced it"), but
   dispatches **cable 0** through a handler captured at `shadow_ui` startup —
   schwung's own. So:
   - cable 0 (what `scripts/inject-any.py` and `inject-ui.py` both hardcode)
     reaches the **host UI**, not the tool;
   - cable 2 reaches movy's *external note* handler, not its control surface.

   There is no cable that reaches `onMidiMessageInternal` while movy is
   overtaking. **Any probe built on those injectors measures schwung.** An early
   reading in this evaluation — a jog burst producing 21.8 ms — was schwung's
   shadow UI reacting to its own CC, not movy.

2. **A `ui.js` swap needs a tool reopen, and a reopen lands on track 1**, which
   has no module. So the flag-off arm needs manual re-navigation to the movy
   track for every measurement.

3. **`schwung-body` logs once per distinct reason**, so a page sitting still
   emits nothing and "no line" is indistinguishable from "wrong view". A harness
   that did not check this returned a flat ~4.8 ms across five sections, which
   read as "the grid is free" and was really "the device was not on a module
   page". The `ok` reason embeds `at=<pageIndex>`, so a jog and its undo force a
   re-log — that is the positive signal to assert on.

`scripts/measure-grid-cost.sh` carries this preflight. `scripts/inject-movy.py`
documents the cable finding. `scripts/grid-call-cost.mjs` attempts the same A/B
locally by counting host calls; **it does not work yet** — both arms returned an
identical 41/46 with `knobPage=0` after the jog, meaning the gesture took in
neither, and it only wraps `shadow_get_param`/`shadow_set_param` while the device
also shows `mget`/`bget`/`msetb` traffic.

---

## 5. Test coverage

| suite | flag on (`page`) | what it actually covers |
| --- | --- | --- |
| `app-loop` | **FAIL (13)** | the real router — **the gate for this feature** |
| `logic` | PASS | does not touch the renderer |
| `dump-replay` | PASS | replays **movy's model**, the layer Schwung bypasses — structurally blind to re-pagination |
| `screenshot` | PASS | **vacuously** — see below |
| `perf`, `device-scripts`, `track-colors`, `abi-parity` | PASS | unaffected |

**`screenshot` does not exercise the flag at all.** `schwungGridEnabled()` is
`mode === 'body'`, so under `page` it is false, and screenshot scenes pass no
`bodyOverride` — every baseline still renders movy's widgets whatever the flag
says. Under `body` it does bite: **111 of 149 baselines differ**. That 111 is the
honest number for the visual scope of the restyle, not the PR's "19.5% of one
band", which measures one band of one mode.

**Nothing checks the real 80-module fleet under Schwung's planner.** That is the
class of problem the `ui_pages` fallback fixed for 9W9 (13 pages of "Params - 2"
with no level on any of them), and only a fleet sweep catches the next one.

PR #18's own nine checks all pass, including against Schwung `origin/main`. They
test the embedding; they do not test movy's behaviour around it.

---

## 6. Accepted by design

Recorded so the next reader does not re-open them:

- **Schwung's viz detectors replacing movy's**, and **Schwung's metadata
  replacing `movy_config.json` ranges, labels and enum lists.** movy's copies are
  a fork of module metadata; one implementation is the goal.

  The implication is not free, and it is a release gate rather than a bug: some
  of those configs carry real corrections (a wrong `min`/`max` makes a knob
  unusable; at least one enum list only worked because movy's copy overrode the
  module's). Those have to reach the modules' own `chain_params` before
  default-on. Ten modules on the test device ship `movy_config.json`
  (`4k-eq, tape-echo2, tablor, cw78, po32-drum, 9w9, 8w8, sophie, 6w6, forge`)
  plus four bundled in `src/module-configs/`.

  One outright gap rather than a duplicate: movy's **cut curve** (lowcut/highcut
  pair) has no kind in Schwung's `viz.mjs`.

- **`dump-replay` staying on movy's model.**
- **Jog click opening Schwung's doors instead of movy's module browser** —
  conditional on the module browser staying reachable from ordinary pages and the
  module LED behaviour there being unchanged.
- **Graphics standing down for a *held* p-lock** is arguable; graphics never
  returning (G2) is not.

---

## 7. Before default-on

1. Cause A — movy's model must stop owning input, paging and rendering for a
   delegated component. One fix, eight symptoms, and the leading candidate for
   Cause F.
2. Clear+knob must not delete the clip.
3. Cause D — module removal ejects; first load takes.
4. Cause E — drum modules functional. No dramatic regression is the bar, and
   drum racks are a large part of how movy is used.
5. Cause F — the tick cost on movy chains, ideally with a real A/B.
6. Cause G — graphics return.
7. Config corrections upstreamed into the modules' `chain_params`.
8. Cause C and B — filepath dives, header readout, footer hints.
9. The 2 px body offset; the held-step filter.
10. Coverage: `app-loop` green under `page`; a screenshot scene that actually
    exercises `page`; a fleet sweep under Schwung's planner.

---

## 8. What we changed on top

**The imports had to become dynamic before any of this could be a setting.** The
five `schwung-*.ts` modules imported `param_pages` statically by absolute device
path, and esbuild keeps an external import regardless of whether the importing
code is reachable. That is a **load-time** dependency: on an older Schwung movy
does not start at all, silently. PR #18 worked around it by swapping the modules
for `.off` stand-ins whenever the grid was compiled out — which is exactly why
the switch had to be a build define and could not be a setting.

`src/renderer/schwung-lib.ts` is that workaround moved to runtime: one guarded
top-level `await` over the six modules movy uses, with `schwungLibAvailable()`
false when it fails. Top-level await is safe in that one place — `eval_buf` runs
`js_std_await` on the module result, so the host load blocks until it settles and
every global movy assigns afterwards is in place before the load reports success.
It is **not** safe anywhere else in movy: nothing pumps the job queue during a
tick.

The mode then became the `schwunggrid` flag on the Global Params page
(Shift+Step 2), values `MOVY / DRAW / PAGE`, default MOVY, debug-only.
`schwungGridMode()` reads the flag through the availability gate, so a mode the
library cannot serve pins itself to MOVY instead of taking the screen to a
renderer that cannot run. It also notices its own change and drops the cached
controllers, rather than hooking `setFlag` — that hook would make `flags.ts` and
`schwung-grid.ts` import each other, and a TDZ at load is movy not starting.

`MOVY_NO_SCHWUNG_GRID=1` still removes the layer entirely (537.1 KB vs
554.1 KB). `scripts/schwung-off-is-free.mjs` now tests that axis plus the one
that replaced it: that an ordinary build's dependency is dynamic. A static import
there would be the old bug back, and invisible on any device whose Schwung
happens to be current.
