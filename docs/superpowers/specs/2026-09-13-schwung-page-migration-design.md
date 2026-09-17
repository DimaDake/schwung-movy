# Schwung page migration — design

**Status:** approved 2026-09-13. Supersedes nothing; consumes
`docs/schwung-param-pages-findings.md` §7 as an input, not as the plan.

**Goal.** Schwung's `param_pages` becomes the only implementation of a module's
parameter pages in movy. `schwunggrid` disappears, and movy's own page renderer
is deleted.

This document is the *direction*. Per-item implementation plans live in
`plans/SP-<id>-<slug>.md`. Live status lives in
`docs/schwung-page-migration.md` (the ledger).

---

## 1. End state

For any module component, Schwung owns:

- the **page plan** (which parameters land on which page, and pagination of
  overflow),
- the **widgets** and their **graphics** (viz),
- the **dives** (enum peek, section picker, child pages, filepath and canvas
  editors),
- the **knob LEDs** for the drawn page.

movy owns:

- the **surface** — header, bank bar, toast band,
- everything that is **not a module's parameters** — chain, mix, cpu, seq, keys,
  flags, versions, file browse,
- the **routing** that decides which of those is on screen,
- the **sequencer, automation lanes and LFO model** that target parameters
  Schwung draws.

Deleted at the end: `src/renderer/label.ts`, `knob.ts`, `envelope.ts`,
`filter-curve.ts`, `eq-curve.ts`, `cut-curve.ts`, `lfo-wave.ts`,
`src/model/page-layout.ts`, `generic-pages.ts`, `config-pages.ts`, and the
`off`/`body` modes with their `.off` stand-ins.

**Out of scope.** movy's non-parameter views never move onto Schwung
primitives; no Schwung page kind exists for a chain view, a mix page, a CPU
meter or a step-parameter page, and inventing them is a different project.

---

## 2. Where the seam is today

| mode | plans the page set | draws the widgets |
| --- | --- | --- |
| `off` / MOVY | movy | movy |
| `body` / DRAW | movy | Schwung |
| `page` / PAGE | **Schwung** | Schwung |

`page` is the migration target. `body` is a restyle that changes no parameter's
page or slot, and the findings show it is a dead end — it hard-codes `viz: []`,
so it has no graphics at all, and 111 of 149 screenshot baselines differ for no
functional gain. It is deleted in Phase 4 rather than maintained.

Mechanism, as built: `schwung-lib.ts` does one guarded top-level `await` over
the six `param_pages` modules and reports `schwungLibAvailable()`;
`schwungGridMode()` reads the `schwunggrid` flag *through* that gate, so a mode
the installed Schwung cannot serve pins itself to MOVY instead of taking the
screen to a renderer that cannot run; `schwung-grid.ts` holds one `SchwungPage`
per `(track, component)` and drops the cache when the mode changes.

Already closed, recorded so nobody re-opens them: the `host_api_v1_t`
`reserved[8]` tail (`ffi.rs:71`) and `PARAM_BUF` at 128 KB
(`chain_host.rs:305`), both from `docs/schwung-releases-review-2026-09.md` §1.
The body rect is one `GRID_BODY_RECT` in `layout.ts`, supplied at the
`ctl.render` call.

---

## 3. The architectural keystone

**movy has no concept of a delegated component.** Every seam point is an ad-hoc
`if (schwungActiveFor(...))`; `src/midi/router.ts` has fifteen of them. PR #18
routed *parameter* identity through Schwung (`knobInfoFor()`) but not *page*
identity, and its own comment records applying the rule to **one of three
sites**. Anything that addresses by `(page, slot)` or navigates by page resolves
against a frozen `0`.

That single omission produces all of:

- holding knob 1 opens movy's bank selector over Schwung's page,
- held-step jog jumps to the trig-condition page and back (`router.ts:892`,
  `onBank0` is always true),
- the file browser opens the wrong parameter (`model/index.ts:361`),
- LFO assign does not navigate, does not exit, shows None (`router.ts:744`),
- knob LED rings show movy's parameter, not the drawn one (`tick.ts:729/757`),
- a movy page flashes before Schwung takes over,
- **Clear+knob deletes the clip** — `knobInfoFor()` returns null, so
  `markDeleteActed()` never runs and Clear's *release* falls through to clip
  deletion. This is data loss and it is the highest-severity item in the
  project.

It is also the leading hypothesis for the per-tick cost (§Cause F): under `page`
there are two independent readers on one page — movy's `refreshOneParam` and the
controller's `reloadIfChanged()` + staggered read cursor.

**Design.** Introduce the notion explicitly rather than fixing sites one at a
time. One ownership accessor for the active `(track, component)`, returning a
single object with two implementations — movy-owned and Schwung-owned — that
answers *page index*, *page count*, *slot→parameter*, *knob touch*, *knob LEDs*,
*poll*, *navigate*. Every one of the fifteen router sites and the two tick sites
calls through it. Nothing may read `getKnobPage()` or `knobPage` directly for a
component that may be delegated.

The point is not elegance. It is that "did you cover every site?" stops being a
review question and becomes a structural one, because the direct accessors are
gone. Site-at-a-time is how these eight symptoms arrived and how they would come
back.

---

## 4. Decisions taken

1. **Scope: parameter body and planning only.** movy keeps its header, bank bar,
   toast band and every non-parameter view (§1).
2. **Metadata corrections stay a movy layer.** `movy_config.json` range and
   enum-list corrections are kept as a thin, documented overlay on Schwung's
   metadata — ranges and enum lists only, never viz or labels. Upstreaming them
   into the 14 modules' own `chain_params` is a **separate backlog, outside this
   migration.** Rationale: `docs/schwung-param-pages-findings.md` §6 proposes
   gating default-on on those upstreams, which would put fourteen third-party
   repos' review latency on the critical path. The overlay is the cost of not
   doing that, and it drains as modules are fixed.
3. **Upstream: fork and pin a floor.** When a fix belongs in Schwung, work
   proceeds against a local fork branch installed on the device, with a recorded
   minimum Schwung version per feature and a runtime check. The upstream PR is
   filed in parallel and does not block the movy item. **All upstream PRs are
   written by Opus.**
4. **`off` is deleted.** PAGE becomes the default, then `body` goes, then `off`
   and movy's renderer go. Phase 4 is an explicit point of no return with its
   own sign-off.
5. **SP-13 (the per-tick cost verdict) is an investigation branch point, not a
   stop-the-project gate.** If the delegation boundary does not recover the tick
   cost, the project does not halt — SP-13 opens a scoped investigation whose
   output is a recommendation, and the remaining Phase 1 items continue in
   parallel. What SP-13 must produce is a *number and an attribution*, because
   attribution is precisely what failed last time.

---

## 5. Gaps the findings' §7 list does not cover

§7's ten items are all symptoms already reproduced on device. These are seams
nobody has looked at:

| gap | risk |
| --- | --- |
| undo/redo redraw through a delegated page | movy's undo writes the DSP and only redraws if `syncParamsToModels` maps the key; under `page` the model is not the drawn truth |
| automation value → knob arc | the arc must follow a lane during playback; that arc is now Schwung's widget, driven by nobody |
| knob LEDs as their own acceptance check | folded into Cause A with no check of its own, so Cause A can close while LEDs stay wrong |
| `ui_hierarchy` ownership | a SYNTH slot's hierarchy comes from the plugin and movy reads `module.json` itself; under Schwung's planner, who walks it? |
| movy-only page kinds | step-parameter pages, LFO pages and the trigger badge must coexist with a Schwung-owned body |
| enum-overlay double-draw | `knob-view.ts` draws `drawEnumOverlay(vm)` while `schwung-page.ts` calls `ctl.renderOverlays` — both may clear the screen |
| font parity | Schwung ships `font5x3.mjs`; movy pinned its own glyphs by chart |
| `schwung-page.ts` is 457 lines vs the repo's hard 200 | every Phase-1 item edits this file |
| runtime version floor | an older Schwung must land on MOVY *with a visible reason*, not a blank screen |
| rollback | no stated release gate or revert path for default-on |

---

## 6. Work items

One item is one session. `SP-*` movy, `SU-*` upstream Schwung. Every item's
plan names its predecessor's evidence and its successor.

### Phase 0 — infrastructure

Nothing in Phase 1 is verifiable without this. The enabler already exists and is
underused: **`SCHWUNG=/path/to/schwung` makes the browser build resolve the real
`param_pages`** instead of the throwing stub (`build/browser.mjs:255`), so
Schwung's actual planner runs in the Node harness with no device. Phase 0 cashes
that in.

| id | item | model | evidence that closes it |
| --- | --- | --- | --- |
| SP-01 | `app-loop` parameterised over `off`/`page` via `setSchwungGridMode`; the 13 Cause-A failures land as a **named expected-fail ledger** | Sonnet | `npm run test:app` prints `page-mode: 13 of 13 expected failures remain`; a check outside the list failing is a hard failure; a listed check passing must be removed from the list, so the list only shrinks |
| SP-02 | Fix the harness env leak — `dump-boot.mjs`'s `createDumpBoot()` calls `installEnv()` a second time, so later suites read whatever the dump left behind | Sonnet | every suite green with `run_schwung_page` restored beside `run_schwung_grid`; §7 warns this turns other suites red, which is the point — do it alone, first |
| SP-03 | Split `schwung-page.ts` (457 → ≤200 per file) | Sonnet | `npm test` green, no file over 200 lines, no behaviour change |
| SP-04 | **Fleet sweep**: `dump-replay` plans through `page_plan.mjs` over all of `docs/module-dump/` | Sonnet | every module's every page has a level and a name; the 9W9 class (13 pages of "Params - 2") fails the assertion |
| SP-05 | `page` screenshot scenes — today `schwungGridEnabled()` is `mode === 'body'`, so `page` has **zero** pixel coverage and `GRID_BODY_RECT`'s *use* at the render call is unasserted | Sonnet | new baselines under `page`; removing the rect from the `ctl.render` call turns them red |
| SP-06 | Forked-Schwung install script (with the reboot QuickJS's per-process module cache requires) + runtime version floor with a visible reason | Sonnet | installing a fork branch and reopening shows the fork's behaviour; an under-floor Schwung pins to MOVY and says why |
| SP-07 | Promote the untracked `scripts/grid-call-cost.mjs` / `measure-grid-cost.sh` into a repeatable device A/B: one injected gesture script, both modes, `perf_ipc`, one number | Opus | the same gesture run twice reproduces within noise; the run names which layer the time is in |

SP-04 is the highest-leverage item in the project: the only thing that finds
*unknown* fleet-wide blockers across ~80 real modules, at no device cost.

### Phase 1 — blockers, hardest first

| id | item | model |
| --- | --- | --- |
| SP-10 | The delegation boundary: ownership accessor + page identity at every site | Opus |
| SP-11 | Input ownership: knob touch, **Clear+knob must not delete the clip**, step-page jog, LFO assign navigation, file browse | Opus |
| SP-12 | Polling + LED ownership: `tick.ts` stops `refreshOneParam` and `updateKnobLEDs` for a delegated component | Opus |
| SP-13 | Per-tick cost: re-measure with SP-07 against SP-12. **Branch point** — output is a number, an attribution and a recommendation; the project does not halt on it | Opus |
| SP-14 | Cause E — drum/voice pages: `bank.pad` racks are invisible to the planner, `focusVoice()` returns false, every page shows at once. Pairs with SU-3 | Opus |
| SP-15 | Cause D — setting a slot to None ejects; the first module into an empty slot takes (retry-budget hypothesis: `RETRY_TICKS 12` × `RETRY_LIMIT 60` spent before arrival) | Sonnet |
| SP-16 | Cause G — graphics return. G2 is the nasty half: `schwung-page.ts:render()` sets decorations from whether a lane *exists*, so one automated cutoff kills that page's graphics for good. Pairs with SU-1 | Sonnet |
| SP-17 | Cause C/B — filepath and canvas dives, header readout, footer hints. Pairs with SU-4 | Sonnet |
| SP-18 | Decoration channel: automation dot vs LFO tilde (Schwung has one bit), p-lock value highlight, held-step filter. Pairs with SU-2 | Sonnet |
| SP-19 | Undo/redo redraw and automation-follows-arc through a delegated page | Sonnet |
| SP-20 | `ui_hierarchy` ownership under Schwung's planner | Opus |

SP-14 is the most dramatic user-visible regression found, and drum racks are a
large part of how movy is used; it is sequenced above the cheaper items for that
reason, not for difficulty.

### Phase 2 — parity

| id | item | model |
| --- | --- | --- |
| SP-21 | Metadata correction overlay (ranges + enum lists only), with the audit naming which of the 14 configs carry *real* corrections vs. duplicates | Sonnet |
| SP-22 | Cut curve has no kind in Schwung's `viz.mjs` — SU-5, or a documented movy exception | Sonnet |
| SP-23 | Font parity and the enum-overlay double-draw | Sonnet |
| SP-24 | movy-only page kinds verified against a Schwung-owned body: step-parameter pages, LFO pages, trigger badge | Sonnet |

### Phase 3 — default-on

| id | item | model |
| --- | --- | --- |
| SP-30 | Flip the default; device tier green; MANUAL.md and README.md with baseline screenshots; CHANGELOG; release; **a stated revert path** | Sonnet |

### Phase 4 — deletion

| id | item | model |
| --- | --- | --- |
| SP-40 | Delete `body` and its `.off` stand-ins | Sonnet |
| SP-41 | Delete `off`, movy's page renderer and the model's page planning. **Point of no return, explicit sign-off** | Opus |

### Upstream — all Opus

| id | item |
| --- | --- |
| SU-1 | The viz gate is per-cell or held-only, not "any decorations exist" (`page_controller.mjs:3840`, `:4015`) |
| SU-2 | `decorations` gains a modulation bit, so an automation dot and an LFO tilde stay distinct |
| SU-3 | Voice declaration for caller-supplied racks, so a `bank.pad`-style rack can be focused |
| SU-4 | Non-enum dive intents — a filepath or canvas `open` needs an editor or a documented caller contract |
| SU-5 | A cut-curve (lowcut/highcut pair) viz kind |
| SU-6 | The 15-vs-16 widget band that keeps label rows one pixel off movy's — not reachable from the rect |

---

## 7. Sequencing rationale

Order is by *what could invalidate the migration*, not by difficulty or size.

1. **Phase 0 first** because every Phase-1 claim is otherwise unverifiable.
   `app-loop` is the gate and it fails 13; `screenshot` passes **vacuously**
   under `page`; `dump-replay` replays movy's model, the layer Schwung bypasses,
   so it is structurally blind to re-pagination. Building behaviour on that is
   building on green that means nothing.
2. **The delegation boundary next** because it is one fix for eight symptoms,
   one of which is data loss, and because every later item would otherwise be
   written against a model that is still dual-driving.
3. **Cost, then drums, immediately after** because they are the two findings
   that could say *this architecture does not fit the hardware* or *this
   regresses how movy is actually used*. Reaching them at items 13 and 14 rather
   than items 30 and 40 is the whole point of the ordering.
4. **Cheap self-contained items last within Phase 1**, because they are the ones
   least likely to change the design.
5. **Deletion last and alone**, because it is irreversible and because the only
   honest proof that the migration worked is that the fallback was never needed.

---

## 8. Keeping direction across sessions

Each item runs in its own session. Four mechanisms, in descending order of how
much they actually work:

1. **A machine-checkable burn-down.** SP-01's expected-fail ledger means a fresh
   session runs one command and reads `9 of 13 Cause-A checks still failing`. A
   number cannot be rationalised away, does not depend on anyone reading prose,
   and fails loudly if an item regresses a sibling. This is the real mechanism;
   the rest is support.
2. **One ledger file — `docs/schwung-page-migration.md`.** Not a plan; a status
   table: item id, state, assigned model, Schwung version floor, and **the
   specific evidence that closes it**. First action of every session: read it.
   Last action: update it.
3. **A standing block in `movy/CLAUDE.md`**, in force until Phase 4: no new
   features in movy's page renderer; anything upstream is a PR, never a local
   patch; a delegated component is never dual-driven. A session that never opens
   the ledger still cannot push against the migration.
4. **Item contracts.** Each `plans/SP-<id>-*.md` names its predecessor's
   evidence and its successor. A session that finds that evidence absent
   **stops and reports** rather than improvising — that failure mode is what
   kills multi-session projects.

**Model policy.** Opus: all upstream PRs, the delegation boundary
(SP-10/11/12), cost attribution (SP-07/SP-13), hierarchy ownership (SP-20), and
the deletion (SP-41). Sonnet: everything with a written spec and a test that
proves it. Nothing below Sonnet touches `src/`. No pro tier.

---

## 9. Risks

| risk | handling |
| --- | --- |
| The tick cost does not recover after SP-12 | SP-13 is a branch point, not a halt: it produces an attribution and a recommendation while the rest of Phase 1 continues |
| An upstream PR sits unreviewed | fork-and-pin (decision 3); the movy item never waits |
| The metadata overlay becomes permanent | it is scoped to ranges and enum lists, listed per module, and its size is a line in the ledger |
| The fleet sweep finds a class of breakage nobody costed | that is what it is for, and it runs in Phase 0 when re-planning is still cheap |
| A user on an older Schwung after default-on | SP-06's runtime floor pins to MOVY with a visible reason; SP-41 cannot land until the floor is a released Schwung |
