# SP-10 — The delegation boundary: ownership accessor + page identity at every site

**Item:** `docs/schwung-page-migration.md` → Phase 1, SP-10 (Opus).
**Spec:** `docs/superpowers/specs/2026-09-13-schwung-page-migration-design.md` §3
("The architectural keystone") and §6.
**Predecessor evidence:** Phase 0 closed and independently re-verified
(Log, 2026-09-13); SP-25 closed 2026-09-14 with the device tier at 15 scenarios
/ 130 checks / 0 failed. The burn-down reads `13 of 13`.
**Successors:** SP-11 (input ownership), SP-12 (polling + LED ownership),
SP-13 (per-tick cost re-measure). All three consume what this item builds.

---

## Goal

movy has no concept of a delegated component. Every seam point re-derives the
answer itself:

```ts
const m  = knobModel();
const sp = m ? schwungActiveFor(appState.activeTrack.index,
                m.getComponentKey ? m.getComponentKey() : 'synth') : null;
```

That block appears **seven times** in `src/midi/router.ts` and `src/app/tick.ts`
with four different component-key fallbacks (`'synth'`, `'(none)'`, none at all,
`?? 'synth'`), plus two `schwungChangePage(...) || m?.changePage(...)` pairs.
Replace all of it with ONE accessor that answers page identity and ownership, so
"did you cover every site?" is a structural question and not a review question.

**Not this item:** SP-11's input sites (knob touch dual-drive, Clear+knob,
step-page jog, LFO assign, file browse) and SP-12's tick/LED sites. The accessor
must be the thing they consume, and this plan names exactly what they change.

---

## Global Constraints

- **Behaviour-preserving.** Every migrated site must answer what it answers
  today. The one deliberate narrowing is below (movy's own components are never
  claimed), and it can only *reduce* what Schwung takes.
- **The burn-down may shrink and must never grow:**
  `SCHWUNG=../schwung node browser-test/page-mode.mjs` → `13 of 13`.
- **The device log format is a contract.** `scripts/measure-grid-cost.sh:157`
  greps `schwung-body (ok track=N ck=X pages=N|not-ready…|mode=…|no-model|
  step-page-selected)`. Any new reason token goes into that regex in the same
  commit.
- `src/` hard limit 200 lines. `SCHWUNG=../schwung npm test` — without it every
  Schwung assertion is **skipped, not failed**.
- Prove every new test has teeth by breaking what it guards.

---

## The boundary

**`src/app/page-owner.ts`** — new, the single source of truth.

```ts
export interface PageRef  { readonly track: number; readonly componentKey: string; }

export interface PageOwner {
    readonly ref: PageRef | null;
    readonly claimed: boolean;     // Schwung is the intended owner (mode + component)
    readonly delegated: boolean;   // ...and its contract resolved: Schwung owns it NOW
    readonly page: SchwungPage | null;  // the delegated page, else null
    readonly pageIndex: number;    // whoever owns it — Schwung's index or movy's bank
    readonly pageCount: number;
    readonly reason: string;       // the device-log line, composed once
    poll(): void;                  // let a claimed page advance its own contract
    knobParamInfo(slot: number): any | null;
    changePage(delta: number): void;
}

export function pageRefOf(model: any): PageRef | null;
export function pageOwnerOf(model: any): PageOwner;
```

Two implementations, as §3 asks: `movyOwner` (no claim — movy plans, pages and
answers) and `delegateOwner` (a claim exists; it holds the movy owner as its
fallback for the window before the contract resolves, which is exactly what
`schwungActiveFor`'s `ready ? p : null` expresses today).

`claimed` vs `delegated` is the distinction `tick.ts` needs and the current code
smears: a page that is claimed but not ready must keep being ticked, while every
gesture still goes to movy.

Why `src/app/`: the accessor must read `appState.activeTrack` (page identity) and
`renderer/schwung-grid` (the cache). `model/` may not import `renderer/` and
`renderer/` must not grow app state, so `app/` is the one layer that already sees
both. `midi/router.ts` imports from `app/` today.

**`src/chain/config.ts`** gains `isMovyOwnComponent(key)` beside
`isMasterComponent`/`isSendComponent`: `mix` and the LFO components are movy's
own pages — not a module's declared contract, so there is nothing for Schwung's
planner to plan. Today they are claimed, a controller is built for them, and the
contract never resolves; the answer is the same and one fewer controller exists.

**`src/renderer/schwung-grid.ts`** loses `schwungActiveFor` and
`schwungChangePage` — their bodies move into the owner. The file stays what it
is: the mode and the per-`(track, component)` page cache.

---

## Tasks

### Task 1 — the test, red first

`browser-test/logic/page-owner.mjs` (new, registered in `logic.mjs`'s two lists).

- [ ] **Structural (the one with real teeth).** Walk `src/**/*.ts`; assert
      `schwungActiveFor(`/`schwungChangePage(`/`schwungPageFor(` appear ONLY in
      `src/renderer/schwung-grid.ts` and `src/app/page-owner.ts`, with a named
      allowlist and a stale-allowlist check, the idiom
      `browser-test/logic/tracks-refs.mjs:120` already uses. **Red before the
      migration** (`router.ts` and `tick.ts` both name them today).
- [ ] Identity: `pageRefOf(model)` is `{track: activeTrack, componentKey}`;
      null for no model and for a model that cannot name its component.
- [ ] movy-owned: mode `off` → `claimed` false, `page` null, `pageIndex` is the
      model's bank, `changePage(+1)` moves the model's bank.
- [ ] movy's OWN components are never claimed, even under `page` (mix, lfo).
- [ ] No model → movy owns; `changePage` is a no-op, not a throw.
- [ ] Delegated (guarded on `schwungLibAvailable()`): mode `page`, ticked to
      `ready` the way `screenshot.mjs`'s `page_body` scene does → `delegated`,
      `page` non-null, and `changePage(+1)` moves **Schwung's** index while
      movy's bank stands still. That divergence is the bug the accessor exists
      to stop: the two planners disagree, so a site reading movy's index while
      Schwung draws is reading the wrong page.
- [ ] Claimed-but-not-ready falls back to movy, and `poll()` is what resolves it.

### Task 2 — `src/app/page-owner.ts` + `isMovyOwnComponent`

- [ ] Write the module, ≤200 lines, comments on WHY.
- [ ] Delete `schwungActiveFor` / `schwungChangePage` from `schwung-grid.ts`.

### Task 3 — migrate `src/midi/router.ts`

- [ ] `knobInfoFor` → `pageOwnerOf(knobModel()).knobParamInfo(k)`.
- [ ] Knob touch / release (`:302`, `:323`) — one owner for the gesture, used for
      both `info` and the `knobTouch` forward.
- [ ] Drum-pad voice focus (`:409`), knob turn (`:499`), Back (`:589`),
      click (`:678`) — `owner.page`.
- [ ] Jog paging (`:902`, `:909`) — `owner.changePage(dir)` replaces both
      `schwungChangePage(...) || m?.changePage(dir)` pairs.

### Task 4 — migrate `src/app/tick.ts`

- [ ] `schwungBodyFor` reads `owner.reason` / `owner.poll()` / `owner.page`,
      preserving the log tokens verbatim.
- [ ] `schwungBankFor` returns `owner.delegated ? {index,count} : undefined`.
- [ ] `scripts/measure-grid-cost.sh:157` learns the `movy-page` reason.

### Task 5 — gates and bookkeeping

- [ ] `SCHWUNG=../schwung npm test` = 0 failures; `page-mode` still `13 of 13`;
      screenshots unchanged (nothing here changes a pixel — if one moves,
      regenerate and inspect every moved baseline).
- [ ] `npm run test:device` green, blocking, in the foreground.
- [ ] Ledger: SP-10 → ✅ + a dated Log entry naming what SP-11/12/13 build on.
- [ ] Commit with named files.

---

## Deliberately left (and why)

- **`router.ts:892` and `:933` — `(m?.getKnobPage?.() ?? 0) === 0`.** The
  step-page-at-bank-0 interplay and the Left/Right arrows. These are direct page
  reads for a component that may be delegated, and the standing rule in
  `movy/CLAUDE.md` names exactly them — but the fix is a *behaviour* change to
  the step-page jog, which is SP-11's listed scope. The accessor makes it one
  line: `pageOwnerOf(m).pageIndex === 0`, and the arrows become
  `pageOwnerOf(m).changePage(±1)`.
- **`model/index.ts:361` `getFileBrowseTarget`.** Reads `s.knobPage`; `model/`
  cannot import `app/` at all, so this needs the target to be passed in — SP-11's
  "file browse" item.
- **The master-FX port.** `schwungPageFor` builds every page on
  `portFor(trackIndex)`, so a `master_fx*` component's page is read from
  `ch<track>:master_fx…`, which does not exist: master pages are claimed and
  never resolve. `componentPort()` is the function that already knows better.
  Fixing it would *enable* delegation of a surface with no device coverage, which
  is not this item's job — recorded for SP-14/SP-20.

---

## Exit criteria

1. No file in `src/` outside `page-owner.ts` derives Schwung ownership, proved by
   a suite that was red before the migration.
2. `SCHWUNG=../schwung npm test` 0 failures; `page-mode` `13 of 13`.
3. Device tier green in the foreground.
4. Ledger updated; SP-11/12/13 told what to consume.
