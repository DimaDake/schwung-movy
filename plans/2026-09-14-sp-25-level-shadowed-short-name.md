# SP-25 — Level-shadowed `short_name`

Ledger: `docs/schwung-page-migration.md` (Phase 1 table + SP-25 section).
Design: `docs/superpowers/specs/2026-09-13-schwung-page-migration-design.md`.

## Defect (pinned by the ledger)

`src/model/hierarchy.ts:108` `absorbHierarchy` flattens **every** level's
`params[]` into one `paramDefs` map keyed only by param key — last level
processed wins. `src/model/generic-pages.ts:156` builds every cell's metadata
from that flat map, so a page built from an EARLIER level reads a def that a
LATER level (processed after it by `Object.values(allLevels)`) overwrote.
`src/model/param-build.ts:52-57` `declaredShortName` prefers the level def over
`chain_params`, so the shadowed value wins over the module's live metadata.
`src/renderer/shorten.ts:185` then locks the cell (non-null shortLabel), so
`collisionGroups`/`forceUnique` never run to disambiguate — there is nothing
to disambiguate, the two cells silently read the same wrong string.

Repro: `jp8000`'s `Performance` page (built from level `perf_main`, which
declares `key_mode` → "KeyMd" and `arp_mode` → "ArpMd") renders `MODE`/`MODE`
because `perf_setup` (declares `key_mode` → "Mode") and `perf_arp` (declares
`arp_mode` → "Mode") come later in `ui_hierarchy.levels` and overwrite the flat
map before any page is built.

## Fix

Build each cell from the def of the level that **owns the page being built**,
not from a hierarchy-wide flattened map. Every page `generic-pages.ts` builds
already corresponds to exactly one source level:
- the "Main" page(s) ← `rootLevel`
- every page from `buildLevelPages` (`hierarchy-walk.ts`) ← the `lvl` object
  `visit()` is currently walking

So the walk already has the right level in hand at the point it decides a
page's `keys` — it just never captured that level's own defs alongside them.

1. `src/model/hierarchy-walk.ts`: add `levelOwnDefs(lvl)` — the same
   params-then-knobs merge `absorbHierarchy` does, scoped to one level's own
   `.params`/`.knobs` arrays. `buildLevelPages`'s returned pages carry
   `defs: Record<string, RawMeta>` alongside `name`/`keys`, computed via
   `levelOwnDefs(lvl)` at the same point the page is pushed.
2. `src/model/generic-pages.ts`: thread a `defs` map through `addPage`/
   `addLevel`/`bankEntries` (one per bank entry, same as `group`). The
   "Main" page's defs come from `levelOwnDefs(rootLevel)`; the B1
   chain_params-only fallback passes `{}` (there is no hierarchy to own
   anything). The final per-key build loop reads
   `entry.defs[key] ?? paramDefs[key] ?? knobInline[key] ?? {}` — the
   page's OWN level first, falling through to the pre-existing flattened
   map only when that level said nothing about the key at all.

   **This fallback layer turned out to be load-bearing, not incidental —
   found by running the fix against the full fleet before trusting it.** A
   first cut dropped `paramDefs`/`knobInline` entirely (page-own defs only),
   and `dump-replay` immediately reddened a SECOND, unrelated module:
   `audio_fx--filter`. Its `root` level lists `lfo_rate_div` in its own
   `knobs[]` but never redeclares an object entry for it — only the child
   `lfo` level does (`short_name: "Div"`); `root` is deliberately
   *inheriting* that declaration, the same pattern `env_amount` uses between
   `root` and `envelope` (both declare it as a bare string in one place,
   object in the other). That is a genuinely different shape from jp8000's:
   jp8000's colliding levels each carry their OWN full object redeclaration
   with a DIFFERENT value; filter's non-owning levels carry no declaration
   at all and rely on inheriting the one that exists. Removing the
   fallback broke the inheriting case to fix the redeclaring case. The
   layered read (`entry.defs[key] ?? paramDefs[key] ?? knobInline[key]`)
   is what serves both: a level's OWN object entry beats the flattened map,
   but a level that names a key without an object entry still inherits
   from wherever the flattened map found one.
3. `src/model/hierarchy.ts`: `paramDefs`/`knobInline` stay exactly as
   built (`absorbHierarchy`, unchanged) and are still passed into
   `buildGenericPages` — now explicitly as the fallback layer, not the
   primary source. Comments at both the build site and the call site say
   why the fallback still has to exist.

**Deliberately out of scope:** `config-pages.ts:67` reads the same flattened
`paramDefs` for movy-config (custom `ModuleConfig`) modules. It has the same
shape but no known repro — none of `KNOWN_COLLIDING_PAGES`' five entries are a
config-path module (the 14 config modules are enumerated in `src/modules/`;
`jp8000`/`helm`/`aphex`/`obxd`/`eucalypso` are not among them), and a
hand-written config typically sets `slot.short` per occurrence, sidestepping
it in practice. Not touched here — noted in the ledger Log as a discovered,
unverified parallel shape rather than silently left as a landmine.

## Test (TDD, write first)

Cheapest level that reproduces it, per project rules: a synthetic
`ui_hierarchy` fixture in `browser-test/mock-synth.mjs`
(`level_shadowed_short_name`) shaped exactly like jp8000's — a `main` level
declaring `key_mode`/`arp_mode` with distinct `short_name`s, and sibling
`setup`/`arp` levels (visited AFTER `main`, so `Object.values` order matches
jp8000's `perf_main` < `perf_setup`/`perf_arp`) redeclaring the same keys with
`short_name: "Mode"`. Assert in `browser-test/logic/model-hierarchy.mjs`:

- `main`'s own page reads `KEYMD`/`ARPMD` (the level that owns the page), not
  `MODE`/`MODE` (the shadowing level's write).
- `setup`'s and `arp`'s own pages still read `MODE` for their own keys — a
  regression guard that per-level scoping doesn't break the levels that were
  already correct by coincidence of write order.

Confirm red against the unmodified code, then green after the fix (teeth).

Second, fleet-wide confirmation: `browser-test/dump-replay.mjs`'s
`KNOWN_COLLIDING_PAGES` carries `'sound_generator--jp8000::Performance'` as a
**temporary accommodation** (its comment says so explicitly and names this
fix). Remove that entry once the fix lands and re-run — the real fleet's
`jp8000` must independently confirm distinct, non-colliding short names on
that page with no accommodation. Regenerate `dump-expect.json`'s
`pageShortNames` for `jp8000` (`--update`), and diff-review that this is the
*only* module whose snapshot changes.

## Verification

1. `npm test` — 0 failures.
2. `npm run test:device` — device tier, gate, do not re-run by hand on red.
3. If any screenshot baseline touches jp8000/Performance-shaped content,
   regenerate and inspect the diff (expect none — no bundled screenshot scene
   targets jp8000 today, confirmed by grep before starting).

## Bookkeeping

- Ledger: flip SP-25 ✅, append a Log entry.
- MANUAL.md/README.md: not touched — this is a label-correctness fix for one
  third-party module's Performance page, not a new feature, page, gesture, or
  control per the docs granularity rule.
- Commit + push, trailer `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`.
