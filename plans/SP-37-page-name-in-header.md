# SP-37 — the header says a fixed word where the page's name belongs

Gate item #5 of five. Ledger entry: `docs/schwung-page-migration.md` → `### SP-37`
(device finding #4). Branch: the session's current branch, base `f7d183c`
(SP-39 fix round 3).

## 1. Reproduction

Under `schwunggrid = page` the module view's header keeps naming **movy's** bank
whatever page is on screen. Jog once and the bank bar and the body move while the
right-hand text does not.

Read from source, not recalled: `renderer/knob-view.ts:35` builds it as

```ts
const rightText = vm.drumPadName || vm.bankName;
```

and `vm.bankName` is movy's own bank — from `src/modules/*.json` or movy's own
pagination. Eleven lines below, the bank **bar** already takes
`bank.index` / `bank.count` from the delegated page (`knob-view.ts:58-59`,
`schwungBankFor`), because the two page sets differ in length. So the bar counts
Schwung's pages and the label names movy's, and on a module whose movy config
opens with a preset bank that label is a constant ("Preset" or the preset's name,
which is the report).

**Reproduced locally, no device:** the `page_body` / `page_body_p2` screenshot
scenes jog from page 0 to page 1 of `test16` (two pages, "Main" / "Main - 2").
Before the fix both scenes draw the same right-hand text (`Main`, movy's bank
name) while their bodies and bars differ. After it they draw "Main" and
"Main - 2".

## 2. Design

**The controller already publishes the answer.** `ctl.pageLabel()`
(`page_controller.mjs:877`, exported `:5013`) returns `null` with no page, else
the page's own name — and for a **child-level knob page** the CHILD's name
(`render_page_movy.mjs:3168-3175`: a page belonging to a child level is named
after WHICH CHILD it shows, which the planned name cannot know). Using the
controller's answer rather than `page.name` is therefore not a shortcut but the
only way to get a voice page's header right.

Three changes, each at the seam that already exists:

1. **`renderer/schwung-page-chrome.ts`** — `PageChrome` gains
   `pageLabel: string | null`, filled by a small `pageLabelFor(ctl)`. Guarded on
   `typeof ctl.pageLabel === 'function'` for the same reason
   `schwung-voices.ts`'s `pressParamOf` guards its two library reads: an older
   Schwung that cannot answer must cost movy nothing but this label, and the
   fallback for "cannot answer" is exactly today's behaviour. `''` is folded to
   `null` so an empty name can never win over movy's bank.
2. **`renderer/knob-view.ts`** — the expression becomes
   `vm.drumPadName || chrome?.pageLabel || vm.bankName`.
3. **Nothing else.** No new field on the facade: `pageCount` / `pageIndex` are
   the pattern, but this is consumed by `chromeFor` and nowhere else, and the
   facade's job is to publish what its callers ask for.

### Why `chromeFor` and not a new seam

`chromeFor(ctl, lib, paging)` is already the one place movy composes what its own
header and footer say while a delegated page is the body, and it is already
derived from the **body** (`app/tick.ts:schwungChromeFor(owner, body, paging)`
returns `undefined` unless the body is the delegated page). Putting the label
there is what makes "where the delegated page is not what is drawn, nothing
changes" structural rather than a condition someone has to remember: under `off`
`chrome` is `undefined`, so the expression falls to `vm.bankName` unchanged.

`pageLabel` is **not** gated on `paging`. `paging` says whether the JOG moves
this page set, which is what the footer's `JOG PAGE` pill is about; the page's
name is the page's name on either view. The chain view passes `paging: false`
and draws `chrome.header` only, so it never reads the field — and on the chain
view the header's right text is `vm.drumPadName || vm.moduleName`
(`chain-view.ts:56`), which is the "same rule" the ledger asks this item to
follow.

### The two conditions, and what the second one costs

- **The held-knob header still outranks it, unchanged.** `if (chrome?.header)`
  is FIRST in `knob-view.ts:26` and draws `chrome.header.left/right` from
  `heldHeaderFor`. The label is NOT routed through `chrome.header`, or the
  left-hand `T<n> > moduleName` would be clobbered with it. The observable proof
  is that `page_chrome_held` / `page_chrome_flip` baselines do **not** move.
- **The drum pad name still outranks the page label.** `vm.drumPadName` stays
  first. Stated consequence, since it is not obvious and the ledger should carry
  it: on a module that DECLARES a drum rack (`pad_layout: "drums"` with named
  voices — the only way `drumPadName` is ever non-empty, `model/hierarchy.ts:191`)
  the pad name therefore wins on **every** page of that module, including pages
  that are not voice pages, and SP-37 changes nothing there. That is exactly
  `off`'s behaviour preserved, and it is the reading the brief mandates ("the
  drum pad name still outranks the page label on a voice page"); a rule that
  meant "only on voice pages" would need the controller's page kind as an input
  and is a different expression.
- **`pageLabel()` returning `null`** falls through to `vm.bankName`, which is
  today's text. "movy has no page name" and "movy's bank name" must not be told
  apart by the pixels.

## 3. Files

| file | change |
| --- | --- |
| `src/renderer/schwung-page-chrome.ts` | `PageChrome.pageLabel`, `pageLabelFor()` |
| `src/renderer/knob-view.ts` | one expression (`:35`) |
| `browser-test/screenshot.mjs` | `page_body`/`page_body_p2` pass `sp.chrome(true)`; new scene `page_voice_pad`; three lists (`PRESETS`, `PAGE_SCENES`, `BASE`); `setSurfaceReader` pushed in (see below) |
| `browser-test/mock-synth.mjs` | new preset `drums_hier` — the only mock that declares `pad_layout: "drums"` |
| `browser-test/logic/schwung-page.mjs` | label assertions in the existing header block, plus the `off`/delegated pair |
| `docs/schwung-page-migration.md` | SP-37 → Done |

## 4. Tests and their teeth

Cheapest level that reproduces it: the pixel oracle (screenshot) for the render
and the logic suite for the label's identity and page-dependence. No device test
is added — `chrome` is undefined at `schwunggrid = 0`, which is what the device
tier runs at.

| check | command | teeth (observed) |
| --- | --- | --- |
| the page's own name reaches the header, and page 2 shows a different one | `node browser-test/screenshot.mjs` | revert `knob-view.ts` to `vm.drumPadName \|\| vm.bankName` → `page_body_p2` **FAIL (79 px differ)**; restore → 176 passed, 0 failed |
| the drum pad name still outranks it | same | swap the order to `chrome?.pageLabel \|\| vm.drumPadName \|\| …` → `page_voice_pad` **FAIL (185 px differ)**, both page-label scenes still `ok`; restore → green |
| the held-knob readout still outranks the label | `node browser-test/screenshot.mjs` | demote it: `if (chrome?.header && !chrome.pageLabel)` → `page_chrome_held` **FAIL (726 px differ)**, `page_chrome_flip` **FAIL (721 px differ)**; restore → green |
| the label is Schwung's, for the page on screen, and it moves | `SCHWUNG=../schwung npm test` (`logic/schwung-page.mjs`) | `pageLabelFor` → `null` → three red: `the chrome carries the page's own name: null`, `…it is the controller's, for the page on screen: expected "Kick", got null`, `…and the jog moves it: still null one page on`; restore → green |
| `off` is unchanged | `SCHWUNG=../schwung npm test` | the PAIRED assertion: the same model's owner is delegated while the grid pages (`page !== null`) and movy's own the moment the mode goes off (`page === null`). Dropping `setSchwungGridMode(null)` → red, and the failure prints the live page — which is what says the second half is not vacuous |
| …and nothing else moved | `node browser-test/screenshot.mjs` | all 173 pre-existing non-page baselines byte-identical. **`page_body` did NOT change**: test16's page 0 is named *Main*, the same word movy's bank says |

## 5. Measurement

None. This is a string in a header on a path that already runs every frame; no
per-tick work is added (`pageLabelFor` is called once per `chromeFor`, which the
frame already calls once, and it is a getter on an array index). Nothing here is
a latency claim, so nothing here is a number.

## 6. Closure evidence

- burn-down: `SCHWUNG=../schwung node browser-test/page-mode.mjs` → still
  `3 of 3` (this item neither adds nor removes an expected failure).
- `SCHWUNG=../schwung npm test` → 0 failures.
- device tier at `flags.schwunggrid = 0` (found `2`; restored to `2`).
- baselines: **only `page_body_p2` regenerated** (the header text is the item)
  and `page_voice_pad` new. `page_body` did NOT change. Never a blanket
  `--update`: the one stale baseline was removed and the next ordinary run saved
  it (`page_body_p2 ... saved baseline`, every other scene `ok`).
- the screenshot harness now pushes the surface reader in
  (`setSurfaceReader(surfaceOf)`, `app/globals.ts`'s own start-up line), scoped to
  `page_voice_pad` and cleared for every other scene — without it no mock can
  declare a rack and the scene throws "the rack declared no pad names".

## 7. What is NOT covered

- No device-tier check reads this header. The device runs at `schwunggrid = 0`
  under this tier's rules, where `chrome` is `undefined`; a `page`-mode device
  run would redden `items`/`module-contract`/`smoke` for reasons that have
  nothing to do with this item (ledger, "Arming page mode on the DEVICE").
- The drum-pad scene sets `vm.drumPadName` through the model of a declared rack,
  but the rack is a browser mock, not a fleet module.
- `MANUAL.md` / `README.md`: the `page` flag is not user-visible yet (SP-47), so
  neither is edited.
