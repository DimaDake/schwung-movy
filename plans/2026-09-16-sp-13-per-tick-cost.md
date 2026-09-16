# SP-13 — per-tick cost: a number, an attribution, a recommendation

**Predecessor's evidence:** SP-12 (`541e973`) — the Log entry of 2026-09-16 and
`plans/2026-09-14-sp-12-polling-led-ownership.md` §7. It predicts, off device,
page premium **51 → 7**, page idle **678 → 753 / 600 ticks** (1.13 → 1.25
calls/tick), `off` untouched at **−418 / 678**, and says `grid-cost.mjs`'s
ceiling of 90 is now 13x the measurement and is SP-13's to re-derive.

**Successor:** SP-14 (Cause E). SP-13 is a **branch point, not a gate** (design
§4 decision 5): whatever the number says, Phase 1 continues.

**The baseline this compares against** is the ledger's *A/B baseline,
2026-09-13* table under the SP-13 item-detail section: five `perf_ipc` sections
per arm on device, `calls/tick=0.6`, `ipc_ms` 1.2–1.5, worst `period_ms` 5.1.

---

## 1. What this item must produce

1. **A number** — calls/tick and `ipc_ms` per arm, both arms, measured with
   SP-07's harness the same way the baseline was taken.
2. **An attribution** — which layer the remaining calls are in, from
   measurement, not inference. Attribution is precisely what failed last time.
3. **A recommendation** — continue as planned, or the scoped investigation the
   spec opens (which runs in parallel and halts nothing).

## 2. Method

**Off device — the number with the burden.** The host-call count is
load-independent, which is why the ledger puts the verdict here and keeps the
device figures as a baseline.

```bash
SCHWUNG=../schwung node build/browser.mjs        # the real planner, not the throwing stub
for i in 1 2 3 4 5; do node scripts/grid-call-cost.mjs off;  done
for i in 1 2 3 4 5; do node scripts/grid-call-cost.mjs page; done
```

Five runs per arm, not one: the child is *claimed* to be deterministic to the
call, and a claim of determinism is itself a measurement. Report the spread —
idle total, gesture total, premium, calls/tick — for every run. 20 gestures per
window, 600 ticks per window, spans printed and refused if they disagree.

**On device — the half the ledger records as a baseline.**

```bash
./scripts/measure-grid-cost.sh off    # then page, then off, then page
```

Two runs per arm, alternating, so a drift across the session shows up as a
difference between the first and second run of the *same* arm rather than as an
arm effect. Each run reopens movy and prints its own preflight line, so the view
it measured is proved before its numbers are read. The device tier runs with
`schwunggrid` OFF, so **the flag is put back to 0 and movy reopened at the end**
— leaving the device on `page` would change what every later device run means.

A device move smaller than the baseline's own spread is a **null result**, not a
pass (ledger, SP-13 section).

## 3. Attribution — how, so it is evidence

The premium and the idle floor are totals; a total is not an attribution. Run a
scratch variant of the child that keys every `shadow_get_param` /
`shadow_set_param` by **param key** and by **call site** (one frame of the stack
above the wrapper), for both arms, over the same two windows. That answers
"where is the remaining cost" with a table instead of a hypothesis. It lives in
the scratchpad — it is an instrument for this reading, not a suite.

Two things it must separate, because they are the two candidates SP-12 named:

- movy's `refreshOneParam` (the `off` arm's whole floor, and the thing the page
  arm is supposed to have *replaced*), versus
- the delegated page's read cursor plus `reloadIfChanged` on its divider of 8.

## 4. The ceiling

`BUDGET_RATIO = 90` was derived from a page premium of 51 against a doubling at
102. If the premium really is ~7, the same rule gives a ceiling near 10 and the
committed 90 passes a doubled gesture — the exact regression it exists for.

Re-derive it **from the measured spread**, not from a round number: the ceiling
must sit above every observed run and below `2 ×` the measurement, and the
choice within that window has to be stated. Update the teeth in the same commit
— they encode 51/102 today, so leaving them would pin a measurement that no
longer exists. Prove the new ceiling has teeth by running the doubling through
it.

**If the measurement says no code change is warranted, that is the outcome.** Do
not invent a refactor.

## 5. Gates

1. `SCHWUNG=../schwung npm test` — 0 failures. Always, code change or not.
2. `npm run test:device` — only if code under `src/`, `engine/` or
   `browser-test/` changed. If the only edit is a measurement doc, say why it
   was unnecessary.

## 6. Bookkeeping

New numbers into the ledger's SP-13 section **in the same shape as the
2026-09-13 baseline**, so the two read side by side; the attribution and the
recommendation beside them; SP-13's Phase 1 state → ✅; a dated 2026-09-16 Log
entry.
