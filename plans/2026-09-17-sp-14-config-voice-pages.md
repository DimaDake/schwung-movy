# SP-14 — Cause E: drum/voice pages under the delegated page

**Item:** a pad-scoped drum module declares its voices the MOVY way (`bank.pad`
in a config), so Schwung's planner never learns they are voices. Under `page`
6W6 plans as **ten pages named "Params" … "Params - 10"**, no level on any of
them, `voicesOf` returns zero, and `focusVoice()` has nothing to jump to — the
header follows the pad while the page stands still. The findings call it the
most dramatic user-visible regression in the migration.

Reproduced offline, no device, from the committed 2026-09-13 capture:

```
$ planPages({ hierarchy: null, chainParams: <6w6's 78 params> })
10 pages: Params | Params - 2 | ... | Params - 10   warnings: ["no ui_hierarchy"]
voicesOf(null) -> []
```

**Where the gap is (SP-04's census, restated):** Schwung's `voicesOf` is ready
and no module movy pages feeds it. Decision 2 keeps third-party module repos off
the critical path, so the movy-side translation is what this item costs.

**Not this item:**

- Modules that DO declare a hierarchy (mrdrums, forge, essaim, tablor). Their
  pages are already named and levelled; what they lack is a voice declaration,
  which is a module-side fact and belongs upstream (SU-3), not in a movy table
  that overrides what a module said about itself.
- Named pages for config modules with NO voice run (po32-drum, sophie). They are
  not Cause E — nothing follows a pad there — and widening the translation to
  them would change page structure for modules this item has no complaint about.
- Writing the module's own focus param. See **`ui_focus` is not `focus_param`**.
- Collapsing the jog to movy's one voice SEAT. See **Rotation**.

## Design

### The one rule: movy fills in only where the module said nothing

A module that declares its own `ui_hierarchy` is authoritative and is never
overridden — that is the direction the whole migration runs in. The translation
is a THIRD fallback, behind `ui_hierarchy` and behind `ui_pages`.

Exactly four fleet modules are in this class (no hierarchy + a movy config with
a leading pad run): `6w6`, `8w8`, `9w9`, `cw78` — the four in
`loader.ts`'s `OVERRIDES_MODULE_FILE`, whose bundled configs movy already ships
beside `ui.js`.

### `src/model/config-hierarchy.ts` (new, pure)

`hierarchyFromConfig(cfg)` → a Schwung hierarchy object, or null.

- **Null unless the config has a LEADING run of `pad`-declaring banks** and a
  finite `drum.padNoteStart`. That rule is not restated here: it is
  `page-rotation.ts`'s `buildRotation`, which movy's own renderer already uses to
  decide the same question. One definition of "voice run" is what stops the two
  page orders drifting apart — and the leading-run rule is load-bearing, because
  the SHIPPED 8w8/cw78 configs declare `pad` on page-only banks (a spare grid
  seat opening Master) and reading those as voices collapses the module.
- One level per bank: `name`, `params` and `knobs` = the bank's row keys with the
  padding nulls dropped. A **voice** bank also carries `note = padNoteStart +
  pad - 1`; a page-only bank carries none, which is precisely how `voicesOf`
  tells a voice from a page (9W9's Reverb/Delay).
- Level KEYS are slugged from the bank name and de-duplicated. The key is an
  identity `focusVoice` matches on, so two banks named the same must not become
  one level.
- `root` carries the nav links in bank order and no knobs — the planner drops a
  knobs page whose every slot is empty, so root costs no jog step.
- `pad_layout: "drums"`, because it is one, and because `padIconNote()` in
  Schwung's controller reads it to light the pad the page edits.
- Pure and in `model/`: it imports nothing from `renderer/`, so it is testable
  without a schwung checkout, the same rule `drum-declared.ts` follows.

### `src/renderer/schwung-page-hierarchy.ts` (new)

The ONE answer to "which hierarchy is this page planned from", for both readers.

This is the part that makes the item work rather than half-work. `focusVoice`
(`schwung-page-input.ts:108`) does its own raw `port.getParam('ui_hierarchy')`,
so a synthesized hierarchy that reached only the planner would give 6W6 its
eleven named pages and STILL not follow a pad. Two readers of one contract is
how this migration's symptoms arrive; so there is one source and both use it.

- Order: `ui_hierarchy` → `ui_pages` → `hierarchyFromConfig(loadModuleConfig(id))`.
  The `ui_pages` fallback moves here out of `schwung-page-io.ts` unchanged —
  9W9 serves `ui_hierarchy` empty on purpose and publishes under `ui_pages`.
- **The tri-state survives.** Synthesis happens only when the read RESOLVED and
  was empty. A null — the read did not complete — stays null, so the controller
  holds and asks again. Collapsing those three answers into two is the fourth
  bug of its kind in this branch; it does not get a fifth.
- **Memoized per module id**, and the SAME STRING is returned every time.
  `reloadIfChanged` fingerprints the contract every 8 ticks: a freshly
  stringified object each call would re-plan the page forever.
- Every read goes through the SP-26 cache, including the module-id read.

### Wiring

- `schwung-page-io.ts` answers `ui_hierarchy` from the source (its own
  `ui_pages` branch moves into it).
- `schwung-page-input.ts` `focusVoice` reads `.parsed()` instead of its two port
  reads. The rest of it — voice → level → page, the childIndex write, the name
  fallback — is untouched and is what makes the pad follow work.
- `schwung-page.ts` builds the source beside the cache and hands it to both.
  `contract.reload()` drops the memo with the cache, so a module swap re-reads.

### `ui_focus` is not `focus_param`

6w6, 8w8 and cw78 expose `ui_focus` (`int 0..padCount`) — the module's own
focused voice. It is NOT what `focus_param` declares: that answers a LEVEL NAME
("snare", never "2"), and `drum-declared.ts` already carries the scar from movy
writing a pad number into one. Declaring `ui_focus` as `focus_param` would have
`focusVoice` write "lo_tom" into an int param.

The honest declaration is the template shape's `child_index_param`, which the
sibling-per-voice shape this translation emits has no place for. So SP-14
declares no focus param and writes nothing: movy's screen follows the pad, and
the module's own focus is left where it is — the same as today. A module that
wants the two tied together can publish `focus_param` itself, which is the
upstream half (SU-3) and is out of scope here.

### Rotation

The jog walks every planned page (6W6: 11 steps; 8W8: 19), not movy's collapsed
four-seat rotation. Replicating the voice SEAT would mean movy filtering and
remapping the controller's page indices — a second implementation of page order,
which is the thing being removed. A pad press lands on its voice directly and
Schwung's section picker (jog click) is the shortcut; `page_plan` names every
page, which is what the bank bar and the header need.

## Tests — cheapest level that reproduces, in order

1. **`browser-test/logic/config-hierarchy.mjs` (new).** The pure translator
   against the four REAL bundled configs: names, notes (36..36+n-1), the
   leading-run rule, a config with no pad run → null, a page-only bank carries no
   note, duplicate bank names get distinct level keys.
2. **`browser-test/fleet-pages.mjs`.** Plan the four modules from the committed
   dump's real `chain_params` PLUS the synthesized hierarchy, and assert what is
   actually broken today: every page name equals a bank name, `voicesOf().length`
   equals `drum.padCount`, notes are the configs', and `checkPages` is clean.
   **Teeth:** with the translation removed this is `Params - 2 … Params - 10`,
   which is the measured "before" at the top of this file.
3. **`browser-test/logic/schwung-page.mjs`.** A delegated page for a rack with no
   hierarchy: the pages are the banks, and `focusVoice(3)` lands on Lo Tom.
   Teeth: without the `focusVoice` half it returns false.
4. **Screenshots** if the drawn body changes (`pad_layout: "drums"` turns on
   Schwung's pad icon).
5. **`browser-test/page-mode.mjs`** must not grow past 6.
6. **Device tier** — `npm run test:device`, and if a rack is reachable on the
   device, the page names and the pad follow read back from it.

## Done when

- 6W6 under `page` shows Kick/Snare/…/Master and a pad press turns to its voice.
- `npm test` green, burn-down still 6, device tier green.
- Ledger row SP-14 → ✅ with what was measured, and MANUAL.md if a user-facing
  page description changes.
