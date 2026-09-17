# SP-11 — Input ownership: knob touch, **Clear+knob must not delete the clip**, step-page jog, LFO assign, file browse

**Item:** `docs/schwung-page-migration.md` → Phase 1, SP-11 (Opus).
**Spec:** `docs/superpowers/specs/2026-09-13-schwung-page-migration-design.md` §3
(the eight symptoms) and §6.
**Predecessor evidence:** SP-10 closed 2026-09-14 (`af479b0`) —
`src/app/page-owner.ts` is the one accessor; `SCHWUNG=../schwung npm test` exit
0; burn-down `13 of 13`; device tier 15 scenarios / 130 checks / 0 failed. The
two sites SP-10 left by name (`router.ts` step-page-at-bank-0 and the Left/Right
arrows) and `model/index.ts`'s `getFileBrowseTarget` are this item's opening.
**Successors:** SP-12 (polling + LED ownership) consumes `owner.delegated`;
SP-13 re-measures the cost after SP-12.

---

## Goal

Every gesture that addresses a parameter page goes to whoever OWNS that page.
Today a handful of input sites still address movy's own bank index, and one of
them loses user data:

- **Clear + knob deletes the clip.** `deleteActive() && info` — when the owner
  names no parameter for that knob (an empty cell, a page with fewer than 8
  knobs, a delegated page mid-load), the branch falls through, `markDeleteActed()`
  never runs, and Clear's *release* deletes the active clip. Highest-severity
  item in the project.
- **Knob touch dual-drives.** movy's model opens its OWN enum / file dive for
  its OWN idea of the parameter, on top of the page Schwung drew.
- **The step-page jog and the Left/Right arrows** read `getKnobPage()` directly.
- **The LFO-assign click never commits**: Schwung's door block takes the click
  first, because the knob under the hand is touched.
- **The file browser opens the wrong parameter**: `getFileBrowseTarget()`
  resolves through `s.knobPage`.

## Global Constraints

- Every input site asks `pageOwnerOf(...)`. No site re-derives ownership, and
  no site calls `getKnobPage()` / `model.changePage()` for a component that may
  be delegated — pinned STRUCTURALLY, because the defect is a site nobody
  wrote to ask.
- **The burn-down may shrink and must never grow.**
  `SCHWUNG=../schwung node browser-test/page-mode.mjs`.
- `src/` hard limit 200 lines; comments say WHY. `SCHWUNG=../schwung npm test`
  or every Schwung assertion is skipped, not failed.
- Prove every test's teeth by breaking what it guards, and restore it.

---

## Tasks

### Task 1 — the tests, red first

- [ ] `browser-test/app-loop.mjs`: **the clip survives Clear + knob.** Hold
      Clear, touch a knob the owner has no parameter for, release both → no
      `clipdel` op. Red in BOTH arms today (this is not only a delegation bug:
      movy's own empty cell falls through the same way).
- [ ] `browser-test/logic/page-owner.mjs`, structural: no file outside the page
      implementations names `changePage(` / `getKnobPage(`, and no input site
      calls `getFileBrowseTarget()` with no argument or `handleKnobTouch(k)`
      with no dive flag.
- [ ] `browser-test/logic/page-owner.mjs`, behaviour: `getFileBrowseTarget`
      resolves the DRAWN key when one is supplied; `handleKnobTouch(k, false)`
      records the touch and opens no overlay.

### Task 2 — `src/midi/router.ts`

- [ ] Clear+knob consumes the gesture and marks it acted whether or not the
      owner named a parameter; the release marks it too.
- [ ] `handleKnobTouch(d1, !owner.delegated)` — the dive belongs to whoever drew
      the cell.
- [ ] Step-page jog + Left/Right: `owner.pageIndex` / `owner.changePage(±1)`.
- [ ] Master detail paging and the assign-mode LFO jump go through the owner
      too, so the structural rule is absolute.
- [ ] The click ladder: a movy gesture already in flight (assign mode, a held
      step) is decided BEFORE Schwung's door.
- [ ] File browse: the target comes from the drawn key when delegated.

### Task 3 — `src/model/index.ts`

- [ ] `handleKnobTouch(k, dive = true)`; `getFileBrowseTarget(keyAt?)`.

### Task 4 — the burn-down

- [ ] Re-run; every label that now passes is DELETED from
      `browser-test/page-mode-expected-fail.json`. A check that asserts movy's
      internal bank index for a gesture whose visible effect is "the page under
      the knobs moved" is re-phrased through the accessor — the same value in
      the `off` arm, the drawn page in the `page` arm.

### Task 5 — gates and bookkeeping

- [ ] `SCHWUNG=../schwung npm test` 0 failures; burn-down no larger.
- [ ] `npm run test:device` in the foreground, blocking. Input ownership is
      exactly what that tier exists to catch.
- [ ] Ledger: SP-11 ✅ + a dated Log entry; docs call stated.
- [ ] Commit named files, push.

## Deliberately out of scope

- **Shift+jog's level skip** (`m?.changePageGroup(dir)`). Schwung's pages have
  no group, so routing it through the owner would move a delegated page by one
  and turn a passing app-loop check red — the burn-down must never grow. The
  section jump is Schwung's Shift+click picker, i.e. SP-17.
- **The filepath dive itself (Cause C).** Under a ready delegated page the click
  is Schwung's and its `open` intent for a filepath has no editor — SP-17 / SU-4.
  This item fixes which parameter the browser would open, not who gets the click.
- SP-12's polling/LED gate and SP-13's cost re-measure.
