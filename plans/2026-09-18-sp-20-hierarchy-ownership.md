# SP-20 — `ui_hierarchy` ownership under Schwung's planner

Ledger entry: `docs/schwung-page-migration.md` → SP-20. **One reader of a
component's declared page contract**, so the answer cannot diverge between the
site that plans the page and the site that reads it for something else.

## What the code does today

Three readers, three ladders, for the same contract:

| site | rungs it climbs | emptiness test |
| --- | --- | --- |
| `renderer/schwung-page-hierarchy.ts` (the delegated page + `focusVoice`) | `ui_hierarchy` → `ui_pages` → movy's config translated (SP-14) | text is `''` |
| `model/hierarchy.ts` (movy's own model: labels, drums, `off`-mode pages) | `ui_hierarchy` → `ui_pages` → `module.json` `capabilities.ui_hierarchy` | **no LEVELS** |
| `undo/module-dump.ts` `listParamOf` (the restore tier order) | `ui_hierarchy` only | text is falsy |

Two divergences follow from that table, and both are live:

1. **`module.json` is invisible to the delegated page.** Schwung serves a SYNTH
   slot's `ui_hierarchy` from the plugin alone, so a module that describes its UI
   in `module.json` (Slicer was the case) arrives with none. movy's model reads
   the manifest; the page planner does not — under `page` that module's pages are
   whatever `chain_params` paginates to, and its declared file browser is gone.
2. **`{}` is "declared" to one reader and "empty" to the other.** A module that
   serves `ui_hierarchy` as `"{}"` (the `module_json_hier` mock does exactly
   this, because that is what the device does) stops the page ladder at rung 1 —
   no `ui_pages`, no manifest, no translation — while the model reads it as
   nothing and climbs on.

`listParamOf` is the same bug one layer down: a module that publishes its
contract under `ui_pages` or in its manifest declares no `list_param` as far as
undo is concerned, so its preset param drops from tier 1 to tier 2 and is
restored after the params it rewrites.

## The shape

`src/chain/hierarchy-source.ts` — **the one reader**. Neutral layer: `model/`
may not import `renderer/`, and `undo/` keeps clear of `model/`; all three may
import `chain/`.

```ts
createContractSource({ read, moduleId, componentKey }) → { get(), invalidate() }
declaredContract(io)   // the one-shot form, for a caller with nothing to memoize
```

It returns the module's OWN word, tri-state intact:

```ts
{ text: string | null,        // the contract to plan from, null when none has levels
  levels: HierLevels | null,  // the same, already parsed — see the memo note below
  source: 'ui_hierarchy' | 'ui_pages' | 'module.json' | null,
  served: string | null,      // rung 1's raw answer — the '' / '{}' give-up token
  pending: boolean }          // rung 1 did not answer
```

- **A rung counts only if it declares LEVELS.** That is the model's test and it
  is the right one; `"{}"` is a module saying nothing in JSON.
- **`pending` is reported, not acted on.** A cached read (the page) can be in
  flight and must hold; a blocking port read (the model, undo) cannot be, and
  `null` there means the param does not exist. One ladder, two read semantics,
  and the difference is the caller's to apply — collapsing it is the
  latched-verdict bug this branch has had four times.
- **movy's translation is NOT a rung.** It is the delegated page's own last
  resort: the model consumes `movy_config` natively through `buildConfigPages`,
  and handing it a translated hierarchy would make movy's own table look like
  the module's declaration (`readSurface` would take it as declared voices).
  `schwung-page-hierarchy.ts` keeps it, after `declaredContract()` resolves
  empty, exactly as today.
- The manifest rung is memoized by module id inside the source, because
  `raw()` is on the pad-press path (SP-27) and `loadModuleJson` is a blocking
  `host_read_file`.
- **The levels test is memoized against the exact string it ran on**, and the
  parse comes back with the answer. `get()` runs on the page's reload divider;
  parsing minijv's 39 KB to ask "did the module say anything?" is SP-27's cost
  re-introduced one question earlier, and `grid-cost.mjs` counts it (it caught
  exactly this, at 75 re-derivations per 600 ticks, before the memo).

## Steps

1. `src/chain/hierarchy-source.ts` + unit coverage in
   `browser-test/logic/page-owner.mjs`: rung order, the levels test, `pending`,
   memoization, a manifest module.
2. `schwung-page-hierarchy.ts` delegates its first three rungs to the source and
   keeps the translation + `pending` hold. It gains the manifest rung.
3. `model/hierarchy.ts` drops its own three rungs and its `loadModuleJson` call.
4. `undo/module-dump.ts` `listParamOf` climbs the same ladder.
5. **The structural test** (`browser-test/logic/page-owner.mjs`, the block that
   already holds the io/cache rules): over `src/**.ts` with comments stripped, a
   quoted `ui_hierarchy` / `ui_pages` literal or a `loadModuleJson(` call outside
   the allowlist is a failure; the allowlist is the source itself plus
   `modules/loader.ts` (which DEFINES `loadModuleJson`), each entry checked for
   staleness the way the file's other allowlists are.

## Closes when

- The structural check names `chain/hierarchy-source.ts` as the sole reader and
  reddens when a second one appears (proven by putting one back).
- `SCHWUNG=../schwung node browser-test/page-mode.mjs` still says `3 of 3` — it
  may shrink, never grow.
- `SCHWUNG=../schwung npm test` exit 0.
