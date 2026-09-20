# SP-49 — an idle `page` tick costs half again what `off` costs

Ledger entry: `docs/schwung-page-migration.md` lines 1204-1265 (opened by SP-39,
lines 2018-2248; cost-accounting method reused from SP-38, lines 1797-2017).
Order **7.7**, a release gate — the tick period **is** the MIDI sampling
interval (SP-13), so a standing +1.3-1.5 ms/tick under `page` delays every
gesture, including one nobody is making, forever, not just while something
animates (SP-38/48) or a gesture is in flight (SP-39).

**This plan does not touch `../schwung`.** Where the evidence points upstream
(SU-14), it says so and stops.

---

## 1. Attributed budget — what an idle `page` tick pays that `off` does not

Source: the phase lines in the SP-49 ledger entry (`docs/schwung-page-migration.md:1234-1235`),
cross-read against the code that emits each phase name.

| term | ms/tick (idle) | present under `off`? | mechanism, with file:line |
| --- | --- | --- | --- |
| `ctltick` | **0.8** | no (`modeltick` 0.3 stands in its place) | `contract.tick()`'s own controller call — `src/renderer/schwung-page-contract.ts:193-195`, `perfPhase('ctltick'); ctl.tick(); perfPhaseEnd();`. `ctl.tick()` is Schwung's own `page_controller.mjs` tick: the one-key-a-tick cursor SP-26 traded for a bulk read, **plus** (per SP-38's own finding, `docs/schwung-page-migration.md:2145-2150`) a per-tick re-read of every `modCache`-flagged key's `:effective` value — a read that bypasses `io.getParam`'s cache path when the controller pulls it directly, so it can stay a live cost every tick rather than settling once warmed. Whether *this* fixture's page carries any `modCache` keys is unconfirmed (SP-39 found cw78's page emits no `render` phase at idle, i.e. "not modulated" for the animation predicate — that does not by itself prove no key is in `modCache`, only that none is animated-and-visible). **Unattributed further than this without a device trace — see §2.** |
| `ctlpoll` | **0.5** | no | The wrapping phase in `src/app/page-poll.ts:97-99` around `owner.poll()` → `page-owner.ts:149` `poll() { page.tick(); }` → `src/renderer/schwung-page.ts:160` `tick() { cache.tick(); contract.tick(); }`. Because `perfPhase`/`perfPhaseEnd` name a flat sequence of intervals rather than a real call stack (`src/app/perf-probe.ts:142-153`), this bucket actually measures `cache.tick()`'s own body — `src/renderer/schwung-page-cache.ts:130-136`: `drainWrites()` (a JS walk of the port's write log, cheap when nothing wrote) plus, every `FILL_TICKS` (8) ticks, `fill(port, entries, epoch)` — one bulk `port.getMany()` amortized over 8 ticks. |
| `ctlreload` | **0.2-0.3** (amortized over `RELOAD_POLL_TICKS`=8) | no | `src/renderer/schwung-page-contract.ts:176-191`: every 8th tick, `ctl.reloadIfChanged()` — **this is the exact call SU-14 is about**: it re-plans the whole module even when nothing changed, because the upstream fix (`schwung` PR #519, filed, unreviewed) has not shipped. `refreshLoaded()` and `widgets.afterReplan(adopted)` ride the same divider tick but are cheap (a boolean check; the widget probe is capped at `WIDGET_TRIES` and then parks — `src/renderer/schwung-page-widget-sync.ts:1-33`). **§4 bounds how much of this line is upstream's, not movy's.** |
| `mget ch0:*` (IPC line) | **+0.4** (0.4 vs 0.0 under `off`) | absent | A live single-key read through `EnginePort.getParam` (`src/track/engine-port.ts:61-63`) → `paramGet` → `host_module_get_param`, labelled by `src/app/perf-probe.ts:117,28-33` (`label('mget', 'ch0:...')` → `mget ch0:*`). Fires whenever `PageReadCache.get()` misses (`src/renderer/schwung-page-cache.ts:106-129`) — a key never asked before, one that fell outside `KEEP_EPOCHS` (`schwung-page-batch.ts:23`), or a value too large for the batch (`BATCH_VALUE_MAX`, `schwung-page-batch.ts:36`, e.g. `ctl.reloadIfChanged()`'s own contract read). **Not yet split between "reload's own live read" and "cursor/modCache miss" — see §2.** |
| `get overtake_dsp:*` (IPC line) | **+0.3** (0.5 vs 0.2 under `off`) | present, smaller | Labelled by a `shadow_get_param` call (`perf-probe.ts:117`, kind `get`, `keyArg=1`) whose key starts `overtake_dsp:`. **No call site in `src/` passes a literal `overtake_dsp:`-prefixed key to `shadow_get_param` directly** (grepped `src/**/*.ts`) — every movy-chain read goes through `EnginePort`'s `ch<N>:` prefix (labelled `mget`, not `get`), and the one place `overtake_dsp:` is a literal is `BULK_MARKER` in `src/host/param.ts:44`, which is `shadow_get_params`' own **second argument** (`keyArg=1` for that wrap too — `perf-probe.ts:131`), not a per-key read. Two readings are open, **neither confirmed**: (a) this is actually a `bget overtake_dsp:*` line and the ledger's transcription dropped the `b`; (b) it is a genuine `get`, from a call site not reached by a static grep (e.g. an already-open editor, `schwung-editor.ts`, or a shadow-slot fallback). **Do not guess further — trace it (§2).** |
| `ctl.pageLabel()` on the chain view (SP-37's flagged cost, `docs/schwung-page-migration.md:1681-1683`, `src/app/tick.ts:919-930`) | **not counted in the idle window** | n/a | `schwungChromeFor(pageOwner, schwungBody, false)` at `tick.ts:930` runs `pageLabelFor(ctl)` (`schwung-page-chrome.ts:70,103-115`) — but that whole render branch sits inside `if (modelDirty \|\| masterDirty \|\| appState.dirty \|\| ...)` at `tick.ts:776`, and SP-38's own idle measurement (`docs/schwung-page-migration.md:1980-1985`) records **no `render` phase in either arm at idle** — i.e. a genuinely idle window repaints zero times, so this branch does not execute at all during the window the 6.3-vs-5.0 ms figure was taken from. **Correction to SP-37's note, not a re-opening of it**: the cost is real and is paid on every repaint of the chain view (which is most of ordinary use, since `VIEW_CHAIN` is the view movy opens on), but it is a per-repaint cost, not a per-idle-tick one, and the evidence available says it is not part of *this* measured gap. Flagged rather than asserted — see §6 step 1, which re-verifies this before relying on it. |

**Net check against the headline numbers.** ms: `ctltick`(0.8) + `ctlpoll`(0.5) +
`ctlreload`(0.25) = 1.55 added, minus `modeltick`(0.3) removed = **~1.25 ms**
net — close to the measured `tick_ms` delta (3.2-3.3 vs 1.8, **~1.4-1.5 ms**).
calls: `mget`(+0.4) + `get`(+0.3) = **+0.7 calls/tick** — close to the measured
`calls/tick` delta (1.34 vs 0.60 on cw78, SP-39's table, **+0.74**). Both check
out within the instrument's granularity; neither is exact, which is expected at
a 1 ms `Date.now()` clock averaged over a 120-tick window.

---

## 2. How the number is read back — instrumentation, sample size, pass bar

**Instrument, already built, do not re-derive it (per the ledger's own
instruction):** `src/app/perf-probe.ts`'s `perf_ipc`/`perf_phase` lines, driven
by `scripts/measure-grid-cost.sh idle` (SP-38/SP-39's method,
`sp38-measurement.md` / `sp39-measurement.md`). One `perf_ipc` line is a mean
over `SAMPLE_TICKS = 120` ticks (`perf-probe.ts:16`) at 1 ms clock granularity.

**The recorded trap, heeded rather than repeated:** `perf_refresh_ms` (the
pre-SP-13 instrument) timed only `refreshOneParam`'s one GET and a `params=0`
run measured *nothing* — it is not used here. `perf_ipc`/`perf_phase` count
every host call and every named phase, wall-clock, on the QuickJS thread the
tick itself runs on — **not a realtime thread**, so a single window's absolute
number is noisy; what is stable across the existing SP-38/39 runs is the
**median across several 120-tick windows** and **`calls/tick`**, which a 1 ms
clock resolves far better than a sub-2-ms `ms` figure does. Report both, but
gate on `calls/tick` first.

**What is NOT yet measured, and must be before any fix lands (attribution
before fix):**

1. **A big module first**, per the ledger's own step (a) — cw78 (18 pages) is
   the smallest rack with voices; minijv (70 pages, corrected count per SP-39)
   idles at 5.9-7.7 ms against `off`'s 4.8-5.0, a **wider** gap, and its
   `ctlreload` (0.7-0.8 ms/tick) is "the single largest line anywhere in that
   run" (ledger, `docs/schwung-page-migration.md:1244-1246`) — i.e. on a large
   module `ctlreload` alone may be a bigger share of the gap than on cw78.
   Re-run `measure-grid-cost.sh idle` on minijv and get a fresh `perf_phase` +
   `perf_ipc` idle line before ranking fixes.
2. **Trace the two IPC lines to a call site**, using the tracer the probe
   already has for exactly this (`perf-probe.ts:35-39,47-50`,
   `TRACE_LABEL`): set `TRACE_LABEL = 'mget ch0'` for one idle run, redeploy,
   read the `perf_who mget ch0:* <- <stack>` line from `debug.log`; repeat with
   `TRACE_LABEL = 'get overtake_dsp'`. This settles both open questions in §1
   (whether the cache miss is the reload's own read or the cursor/modCache
   read; whether "get overtake_dsp:*" is a mistranscribed `bget` or a real
   site) without guessing.
3. **Isolate `ctlreload`'s share of `calls/tick`**, not just its `ms` line:
   stash the divider (call `ctl.reloadIfChanged()` every tick instead of every
   8, or the reverse — raise `RELOAD_POLL_TICKS` to a large number to remove it
   from the idle window entirely) and diff `calls/tick` and `ms/tick` idle
   against the baseline, same build, same module, both arms. This is what
   bounds §4.

**What counts as a pass, restated from the ledger's own closure bar (line
1257-1259):** the idle `page` tick's `calls/tick` **and** `tick_ms` land within
~10% of the idle `off` tick's, on the **same module and build**, measured with
this instrument, recorded in a fourth measurement handover (`sp49-measurement.md`,
alongside `sp38-`/`sp39-measurement.md`) — **or** SP-47 (the opt-in release
row) records an explicit acceptance naming the residual number and who accepted
it, if the SU-14 share turns out to dominate and cannot be bought back locally.

---

## 3. The fix(es), ranked by measured contribution — provisional until §2 runs

Ranking is **provisional**: it follows the ms/calls net-check in §1, which is
the best attribution available from static reading. §2's trace may re-order it
— do not implement out of order without re-checking against a fresh idle line.

1. **`ctlreload`'s amortized cost (§1 row 3) — rank it after §2.3 confirms how
   much is SU-14's and how much is `refreshLoaded`/`widgets.afterReplan`'s own
   JS.** If most of it is the unconditional re-plan itself, **there is no local
   fix** (see §4) beyond widening `RELOAD_POLL_TICKS` past 8 — which trades
   idle cost for slower module-swap detection and needs its own measurement
   (the ledger already prices one divider step at "tens of milliseconds,
   against a module load" — `schwung-page-contract.ts:144-146` — so a second
   widening is a small, bounded, reversible knob, not a redesign). Do this only
   if §2.1's minijv run confirms `ctlreload` dominates there too.
2. **`ctltick`'s modCache `:effective` re-read (§1 row 1), if §2.2's trace
   confirms it.** If Schwung's per-tick modulated-key read is going around
   `io.getParam`'s cache (reading straight from the port rather than through
   `cache.get()`), the fix is on movy's side of the seam: route that read
   through the same `io` the cache sits behind, so a key already fresh from
   the last fill is a map lookup instead of a live round trip. This is a
   plausible, bounded, **local** fix, but only if the trace confirms the read
   exists and bypasses the cache — do not build it against a guess.
3. **`ctlpoll`'s `drainWrites()` cost (§1 row 2), if the trace shows it, not
   the fill.** `drainWrites()` walks `port.writesSince(seenWrites)` every tick
   even when nothing wrote (`schwung-page-cache.ts:84-92`); if profiling shows
   this walk itself (not the amortized fill) costs meaningful JS time at idle,
   a short-circuit on `seq === seenWrites` (already present, `:87`) should
   already make it near-free — if it is not, the fix is finding what makes the
   early return miss, not adding a second guard on top of one that should work.
4. **The IPC line(s) traced to a call site movy owns (§2.2).** Whatever the
   trace names, the fix is "route it through the cache" (if it bypasses
   `io.getParam`) or "narrow when it is asked" (if it is a correct read fired
   too often) — named precisely once the stack trace exists, not before.

**Explicitly NOT a fix candidate:** SP-37's `ctl.pageLabel()` cost on the chain
view. Per §1's table, it is not part of the measured idle gap (no repaint fires
at idle), so "fixing" it would not move this item's numbers — it is a
per-repaint cost with its own accounting, left where SP-37 put it.

---

## 4. What is NOT movy's to fix — the upstream re-plan (SU-14)

`ctl.reloadIfChanged()` (`schwung-page-contract.ts:182`) is Schwung's own
`page_controller.mjs` function; the unconditional-re-plan-even-when-unchanged
behaviour is filed as **schwung PR #519** (head
`DimaDake:perf/page-reload-skip-unchanged-contract-upstream`, open and
unreviewed since 2026-09-17 — ledger `docs/schwung-page-migration.md:194`).
**Do not patch `../schwung` to work around it** (briefing rule 1); the action
on this half is to chase the PR, and to widen `RELOAD_POLL_TICKS` locally if
§2.1/§2.3 show the amortized cost is large enough to matter and the PR is not
close to landing.

**How much of the idle gap this bounds — stated as a lead, not a settled
number.** An earlier note in the same file (`schwung-page-contract.ts:140-142`,
written during SP-27) recorded the reload's own amortized cost, on a different
module/measurement, at **1.25 calls/tick against movy's own 1.13-call
baseline** — a magnitude comparable to or larger than the *entire* idle
`calls/tick` gap SP-39/49 later measured on cw78 (+0.74). If that number still
holds on today's build it would mean SU-14 accounts for most or all of the idle
`calls/tick` delta, leaving little for movy to buy back locally beyond the
divider width. **It is not reconciled with SP-49's own 0.2-0.3 ms/tick
`ctlreload` phase-time figure, was taken on a different fixture, and predates
this item — treat it as the reason to run §2.3 first, not as the answer.**

---

## 5. Tests

**Local, with teeth — a call-count assertion, not a device A/B.** Device time
is expensive and the device tier runs separately (briefing rule 3: cheapest
level that reproduces it). Add a logic suite (new file,
`browser-test/logic/schwung-page-idle-cost.mjs`, wired into `logic.mjs`'s two
lists the way `schwung-page-press.mjs` was, per SP-39) that:

- Builds a `SchwungPage` over a mock `TrackPort` (the harness's existing mock,
  extended with a call counter on `getParam`/`getMany`, the same shape
  `schwung-page-press.mjs`'s `countTripKinds` already uses).
- Ticks it `N` times (`N` a multiple of both `FILL_TICKS` and
  `RELOAD_POLL_TICKS`, e.g. 40) with **nothing changing** — no knob turn, no
  value drift, no page change — mirroring the idle window the device
  measurement takes.
- Asserts an **upper bound** on total port calls over the run: the expected
  floor is `ceil(N / FILL_TICKS)` bulk fills + `ceil(N / RELOAD_POLL_TICKS)`
  reload reads + a small slack for the one-key cursor's misses (the exact slack
  is whatever §2's trace establishes as the legitimate steady-state miss rate —
  record it as a named constant with a comment citing this plan, not a bare
  number). A regression that reintroduces a per-tick unconditional read (the
  shape SP-26/27 already fixed twice) pushes the total over the bound and reds
  the assertion.
- **Prove the teeth before calling it done**: temporarily lower
  `RELOAD_POLL_TICKS` to 1 (or stash the `KEEP_EPOCHS`/cache-hit path so every
  cursor read misses) and confirm the assertion goes red with the bound
  unchanged; restore and confirm green. Report exactly what reddened and by how
  many calls, the way SP-39's teeth section did (`0 bulk / 9 single` with the
  warm stashed).

**Device measurement — named, for the device agent to run once, not for this
plan to run:** `MODULE=minijv scripts/measure-grid-cost.sh idle` on both arms
(`off`, `page`), same build, plus the two `TRACE_LABEL` runs from §2.2. Record
the result as `sp49-measurement.md` beside `sp38-`/`sp39-measurement.md`. This
is the number §1's ranking and §2's pass bar both refer to — do not accept a
fix without it.

---

## 6. Ordered steps for the implementing agent

1. **Re-verify §1's chain-view correction** before relying on it: confirm on
   device (or by a quick logic-level check of `appState.dirty` transitions
   over an idle window) that a truly idle `page` tick never sets
   `viewRepainted` — i.e. that SP-38's "no render phase at idle" holds on
   whatever module/view this item's own measurement uses, not only on plaits.
2. **Run §2's three unmeasured items** (minijv idle baseline, the two
   `TRACE_LABEL` traces, the `ctlreload`-isolation diff) before writing any
   fix. Record results in `sp49-measurement.md`.
3. **Re-rank §3's fix list** against what step 2 found. If `ctlreload`
   dominates and traces back to the unconditional re-plan, stop at §4 (chase
   the PR, consider widening `RELOAD_POLL_TICKS`, do not patch schwung) and
   write up the residual as SP-47's acceptance if it does not close outright.
4. **Implement the highest-ranked local fix** (if any survives step 3),
   smallest change first — the `io.getParam` cache-routing fix (§3.2) is
   contained to `schwung-page-io.ts`/`schwung-page-contract.ts` if it applies;
   the `drainWrites` short-circuit (§3.3) is contained to
   `schwung-page-cache.ts` if it applies.
5. **Write the local test from §5**, prove its teeth, add it to `logic.mjs`'s
   two lists.
6. **Run local gates**: `SCHWUNG=../schwung npm test` (0 failures),
   `SCHWUNG=../schwung node browser-test/page-mode.mjs` (N of M, must not grow
   from 3). No screenshot baselines expected to move (no rendering changed) —
   confirm rather than assume, since `ctl.pageLabel()`/`chromeFor` sit on the
   render path this item touches near.
7. **Hand the device measurement (§5, "Device measurement" bullet) to the
   dedicated device agent** at the next wave boundary — do not run
   `npm run test:device` from this item, and do not hand-run
   `measure-grid-cost.sh` against a live device from a docs-only or
   local-code-only commit.
8. **Update the ledger**: SP-49's row in the Open table, the SP-49 entry itself
   (attribution numbers, which fix landed, the SU-14 bound if resolved), and
   the SU-14 row if the PR's status changed.
9. Commit local-code changes (test + fix, if any) separately from this
   planning commit, per the briefing's commit style, with the teeth evidence
   in the body.

**Needs:** the device measurement in §5/§2 before the fix ranking in §3 is
final. No decision from anyone else unless SU-14 turns out to bound most of the
gap, in which case SP-47 needs an explicit acceptance call, per the ledger's
own closure bar.
