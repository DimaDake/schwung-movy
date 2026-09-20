# SP-45 — 8w8's pads do not select their pages, and the other three racks' do

Order 11. Product bug, scoped to the delegated (Schwung-renderer) arm of the
page migration. This is a **plan only** — no code changed while writing it.

## 1. Which of (a)/(b)/(c), proven by the diff

**Diffed the four configs directly** (`src/module-configs/{6w6,8w8,9w9,cw78}.json`).
Structurally identical shape across all four: `drum.padNoteStart = 36`,
`drum.rawMidi = false`, a leading run of banks each carrying `pad: 1..N` in
order, followed by page-only banks (`Reverb`, `Delay`, `Master`, and cw78's
extra `Rhythm`) with no `pad` field. 8w8's only structural difference is size —
16 voice banks (the whole 4×4 left-half sub-grid `keyboard/drum-grid.ts`
exposes) against 6w6's 8, 9w9's 11, cw78's 14 — exactly what the ledger already
named. No bank in any of the four configs lists more than 8 non-null param
slots, so no level can split across two physical pages under Schwung's
8-per-page grid (`page_plan.mjs`'s `KNOBS_PER_PAGE = 8`); pagination overflow
is not in play for any of the four.

**(b) is refuted, byte-for-byte.** `docs/module-dump/modules/sound_generator--{6w6,8w8,9w9,cw78}.json`
all report the **identical** `capabilities` object (`audio_out/audio_in/midi_in/
midi_out/chainable/component_type/default_forward_channel`) and both
`ui_hierarchy` and `ui_pages` are `null` on all four — not merely "empty", the
same absent shape. 8w8's module declares nothing extra and nothing different
from its three siblings. There is no upstream declaration divergence to ask
for.

**(a) is refuted by running the existing suite, not by inspection.**
`browser-test/fleet-pages.mjs` already plans all four shipped configs through
`hierarchyFromConfig` → schwung's real `planPages`, against the real captured
`chain_params`, and already asserts the exact invariant the SP-45 "closes when"
describes (every voice's declared level is carried by some page). Built
`dist/esm` with `SCHWUNG=../schwung` and ran it:

```
fleet-pages: 4 movy-config rack(s), planned from the translation
  ✓ 6w6: 11 pages named for its banks, 8 voices at 36,37,38,39,40,41,42,43
  ✓ 8w8: 19 pages named for its banks, 16 voices at 36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51
  ✓ 9w9: 14 pages named for its banks, 11 voices at 36,37,38,39,40,41,42,43,44,45,46
  ✓ cw78: 18 pages named for its banks, 14 voices at 36,37,38,39,40,41,42,43,44,45,46,47,48,49

ALL FLEET-PAGE CHECKS PASSED
```

8w8 already passes, today, with no code change. `buildRotation` (`model/
page-rotation.ts`) has no cap (confirmed: a plain `while` loop over the pads
array) and neither does `page_plan.mjs` — no `MAX_PAGES`, no page-count
truncation anywhere in `../schwung/src/shared/param_pages/*.mjs`. The
`renderedKnobSigs` dedup (`page_plan.mjs:790-1019`, "16 modules publish a
`children` alias level...") only collapses a level whose **authored key list**
is byte-identical to one already emitted; 8w8's 16 voices each use a unique
key prefix (`bd_`, `sd_`, `lt_`, `mt_`, `ht_`, `lc_`, `mc_`, `hc_`, `rs_`,
`cl_`, `ma_`, `cp_`, `cb_`, `ch_`, `oh_`, `cy_`), so no two voice pages'
signatures collide (checked by hand against the raw JSON). `BATCH_MAX_KEYS = 48`
(`renderer/schwung-page-batch.ts`) only bounds the periodic VALUE-fill
(`schwung-page-cache.ts`'s `fill()`); a cache **miss** — which is what
`ui_hierarchy`/`ui_pages`/the module-id read are on first ask — falls through
to a live blocking `port.getParam` unconditionally (`schwung-page-cache.ts`,
`get()`), so the 48-key budget cannot be why a contract fails to resolve or a
pad fails to route. All of this rules out a translation/pagination defect.

**So it is (c): movy's own reader treats 8w8 differently at runtime, and it is
not the matching site the ledger's own first-suspects paragraph names.**
`focusVoice`'s `p.level === v.level` check (`renderer/schwung-page-input.ts:188`)
is proven to succeed for 8w8's own translated hierarchy by the same
`fleet-pages.mjs` run above (its own orphan check: `voices.find(v =>
!levelled.has(v.level))` is exactly this comparison, over the SAME planned
`r.pages`, and it passed for 8w8). If the real device hands `focusVoice` the
same hierarchy the dump captured, the level-match succeeds and the byName
fallback is never even needed. The defect must therefore sit upstream of
`focusVoice` in one of:

1. **`pageOwnerOf(model).page` never becomes non-null for 8w8** — `app/
   page-owner.ts`'s `delegateOwner` returns `page: null` while
   `contract.isReady()` (`renderer/schwung-page-contract.ts`, `isReady = () =>
   loaded`, `loaded = !!(ctl.pages && ctl.pages.length)`) is false, and
   `midi/router.ts:486`'s `pageOwnerOf(model).page?.focusVoice(pad)` then
   **silently no-ops** — no `mlog`, nothing in `debug.log` at all, which
   matches the SP-45 note's second branch ("the press never reached
   `focusVoice`"). Nothing found in the static read shows why 8w8's contract
   specifically would fail to resolve on the real device (the pure planner
   handles it fine), so this has to be confirmed with a live read, not
   asserted from the repo.
2. **The live device's actual declaration for 8w8 differs from the
   2026-09-13 capture** — the dump is a point-in-time capture
   (`docs/module-dump/`, `browser-test/fleet-pages.mjs`'s own header: "94
   plannable of 95, 2026-09-13 capture"); if 8w8's plugin has since started
   answering something on `ui_hierarchy`/`ui_pages` (even a malformed or
   half-declared one), rung 1/2 of `chain/hierarchy-source.ts` would take over
   from movy's translation and could produce a different, real plan the dump
   never captured — quietly reproducing the 9W9-before-#411 class one layer
   down. This is testable only against the real device.

Both live only on the device; nothing in `src/` or the dump distinguishes
them further. **Section 5 below is written to settle exactly this, first,
before any code changes.**

## 2. Do the other three racks work by design, or by accident?

**By design, and 8w8 is doing nothing wrong.** `hierarchyFromConfig` (`model/
config-hierarchy.ts`) is one function serving all four racks with no
rack-specific branch, `buildRotation`'s voice-run rule is size-agnostic, and
`fleet-pages.mjs` proves the SAME invariant holds for 8w8 as for the other
three, from the SAME translation path, today. There is no "8w8 exposed a
latent defect that 6w6/9w9/cw78 happen to dodge by being smaller" — 8w8 is
the size ceiling (16 of the exposed 4×4 = 16 slots), not an out-of-range case;
`drumPadOfPhys` (`keyboard/drum-grid.ts:22`) maps physical pad → 1-based drum
pad correctly at the full 16 (`pad = Math.floor(idx/8)*4 + col + 1`, checked
by hand for pad 16: row 3, col 3 → `3*4+3+1=16`). So whatever the runtime
defect turns out to be, the fix goes on 8w8's path (or on the shared runtime
path in a way that happens to only bite 8w8), never on the other three.

## 3. Does the fix change behaviour under both renderer arms, or only the delegated one?

**Delegated (Schwung-renderer) arm only.** `focusVoice` is reached
exclusively through `pageOwnerOf(model).page?.focusVoice(pad)`
(`midi/router.ts:486`), and `page` is non-null only when
`schwungGridMode() === 'page'` (the role: delegated arm) **and** the
component is not movy-owned **and** the contract has resolved
(`app/page-owner.ts`'s `pageOwnerOf`/`delegateOwner`). The movy-renderer arm's
own pad-follow, `model!.selectBankForPad(pad)` (`model/index.ts:331`, always
called, unconditional on ownership), is generic over bank count via
`pageRotation`/`isVoiceBank` with no cap and no rack-specific code — read in
full for this plan, nothing 8w8-specific in it. So the movy-renderer arm is
not implicated and must not change. Confirm this stays true once the root
cause is found in Section 5 (if the actual defect turns out to live in code
shared by both arms — it does not look like it does, but say so explicitly
in the fix commit either way).

## 4. Test with teeth, cheapest level that reproduces it

**Local suites cannot reproduce this bug — proven, not assumed.**
`browser-test/fleet-pages.mjs` already implements the exact invariant SP-45's
"closes when" describes (every declared voice's level is carried by a
planned page) and it **already passes for 8w8**, with zero code changes, as
shown in Section 1. Writing another unit/dump-replay test at that level would
add coverage that is already green and would not catch this bug — it tests
the pure translation, and the pure translation is not where the defect is.
This satisfies the CLAUDE.md bar for reaching past the cheap tiers: "only
write a new device e2e script when the local suites genuinely cannot
reproduce the failure."

**So the test belongs in `test-device/scenarios/`, one new scenario
(`pad-follow.ts` or similar), parametrized over all four racks in one
sweep** — mirroring `fleet-pages.mjs`'s "all four at once" shape so the next
rack this happens to is caught the same way, per the briefing's guidance to
prefer one invariant over four:

- Load each rack in turn on a track (`ep('ch0:synth:module', <id>)`, the
  pattern `test-device/scenarios/page-dive.ts` already uses).
- Arm the delegated (Schwung-renderer) arm — the opposite of `MOVY_ARM` in
  `test-device/arm.ts`; that file already documents the three-value flag by
  role, and by the time this lands SP-40 will have collapsed it to two
  values, so arm by the delegated role, not a literal string.
- Poll `debug.log` for `schwung-body ok ... ck=synth pages=<N>` (the log line
  `app/tick.ts`'s `why()` already writes once per distinct `owner.reason`) to
  confirm ownership actually reaches "delegated and ready" before pressing
  anything — this is the Section-1-branch-1 check, for free, with no new
  instrumentation.
- Tap a pad for a voice partway through the rack's list (not pad 1 — a
  no-op bug would pass trivially on the page already showing), via the note
  arithmetic `keyboard/drum-grid.ts` already exposes
  (`padNoteStart + pad - 1`).
- Read `probe.page()` and assert its `cells` carry that voice's distinctive
  short label (e.g. Snare's `SNAPY`, present on every rack's Snare bank and
  nowhere else in that rack's config) — the same style `page-dive.ts` uses
  for its own assertion.
- Also grep the same `debug.log` window for `focusVoice no page for` — absent
  is the healthy case; present pins down Section 1's branch 1 vs 2 for
  whoever debugs a regression here later.

**Teeth**: run it before any fix (red on 8w8, green on the other three —
proving the scenario actually discriminates, not just fails everywhere or
passes everywhere), apply the fix from Section 5, confirm all four go green,
then temporarily revert the fix and confirm 8w8 alone reddens again before
committing. Report exactly what reddened and how (which check id, on which
rack) in the commit body, per the briefing.

## 5. Ordered steps for the implementation agent

1. **Read this plan and the SP-45 entry** (`docs/schwung-page-migration.md`
   lines 1050-1089) plus SP-20's entry (~line 2700) before touching code —
   both already loaded once for this plan; re-read if resuming cold.
2. **Reproduce and localize on the device FIRST, before writing any
   production code.** With 8w8 loaded on a track and the delegated arm set:
   - `ssh ableton@move.local 'touch /data/UserData/schwung/debug_log_on'`
     (once), then tail `debug.log` across a pad press.
   - Check for `schwung-body ok track=<n> ck=synth pages=19 at=<i>` —
     confirms ownership resolved and `page` is non-null (Section 1, branch 1
     ruled out if present).
     - If it never appears (only `not-ready ...` or nothing at all): the
       contract never resolves for 8w8 specifically. Next: log
       `ctl.contractUnresolved`, `ctl.pages?.length`, and `hier.raw()`'s
       return live (temporary `mlog`, or reuse existing instrumentation) to
       see which of `declared.get()` / `translated()` is stuck, and whether
       it is a moduleId() read that never lands (`cache.get(moduleReadKey(...))`
       returning null forever) versus something else.
   - Check for `focusVoice no page for <level>/<name> | ...` on the press
     itself.
     - **Present** — contradicts the static proof in Section 1; means the
       LIVE device's actual `ui_hierarchy`/`ui_pages`/`module.json` for 8w8
       disagrees with the 2026-09-13 dump capture. Recapture
       (`scripts/dump-modules.sh` or equivalent per `docs/module-dump/`'s own
       recipe) and re-run `fleet-pages.mjs` + the `config-hierarchy`/
       `hierarchy-source` logic suites against the fresh capture to see what
       changed; the fix is then either a hierarchy-source rung issue (SP-20's
       territory) or an upstream ask, not a config-hierarchy change.
     - **Absent, and no `schwung-body ok` either** — the press never reached
       ownership resolution at all. Follow the readiness thread from the
       bullet above.
3. **Apply the fix at the site the device evidence actually points to.**
   Do not guess ahead of step 2 — the ledger's own first-suspects paragraph
   (`buildRotation`, the name-match fallback, the 48-key budget) has now been
   checked and ruled out by this plan; re-verifying any of them on device
   before writing code is redundant. Whatever the live evidence shows, keep
   the fix in the runtime ownership/contract path (`app/page-owner.ts`,
   `renderer/schwung-page-contract.ts`, or `renderer/schwung-page-hierarchy.ts`),
   not in `model/config-hierarchy.ts` or `page-rotation.ts`, unless step 2's
   evidence specifically implicates the translation (branch 2 above).
4. **Add the device scenario from Section 4**, parametrized over all four
   racks, in `test-device/scenarios/`. Confirm the teeth (red pre-fix on 8w8
   only, green post-fix on all four, red again with the fix reverted).
5. **Re-run the full local gate** (`SCHWUNG=../schwung npm test` and
   `SCHWUNG=../schwung node browser-test/page-mode.mjs`, expecting the count
   to hold at 3 or shrink, never grow) — this bug's fix should not touch
   anything the pure suites grade, so both should already be green
   unchanged; confirm rather than assume.
6. **Update the SP-45 ledger entry** in `docs/schwung-page-migration.md`:
   move it from Open to Done, record which of Section 1's two branches was
   the actual cause, the teeth evidence from Section 4, and correct the
   ledger's own first-suspects paragraph if it pointed the wrong way (it
   likely did — say so plainly, the way SP-31's entry corrected its own
   earlier guess).
7. **Docs**: this is a bugfix restoring documented behaviour (pad → page
   follow, already covered under SP-14/MANUAL.md's existing drum-rack
   section), not a new feature — no MANUAL.md/README.md change expected
   unless step 2/3 turns up a user-visible behaviour change beyond "it now
   works".
8. **Commit and push** per the briefing's format, citing the reddened check
   from Section 4's teeth proof and which device evidence (Section 2's
   branch) the fix targets.

## Not investigated further (checked, ruled out, not worth more time)

- `hh_choke` is declared on **two** different levels in both 6w6 and 8w8
  (the `Cl Hat` voice bank and the page-only `Master` bank) — an odd but
  harmless duplicate authored key across levels; both are `authored` (not
  overflow), so `page_plan.mjs`'s dedup does not touch them, and it is
  present in 6w6 (which works) too, so it cannot be 8w8's differentiator.
- Pagination overflow (a level's key count exceeding 8) — checked by hand
  against all 19 of 8w8's banks; the largest is 8 keys (Snare, Maracas, Cl
  Hat), never 9+, so no level ever splits across two physical pages.
