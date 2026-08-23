# Revert module duplication; put the flags on a page

Two changes that meet in one place — the chain planner's pin key.

1. **Module isolation is removed.** Copying a module's `.so` per chain took
   MoveOriginal down with `helm` and the mechanism was never explained
   (`2026-08-23-per-chain-module-isolation-plan.md` §5). Modules are now assumed
   thread-safe; the ones proven otherwise go on a **blacklist** that puts all
   their instances back on one lane.
2. **A Global Params page** (Shift+Step 2) lists the runtime flags with their
   values, jog to scroll, knob 1 to change. The flags become **persistent** and
   get readable names. Debug builds only.

---

## 1. What "assume thread-safe" changes

Before: every duplicated module was pinned to one lane, always. That is why
twelve chains of one module returned exactly 1.00×, and it is what isolation
existed to undo.

After: a duplicate renders on any lane. A chain is pinned only when it shares a
module that is **blacklisted**, or when `chpin` (pin every duplicate) is on.

| set | plan |
| --- | --- |
| twelve of one module, not blacklisted | spreads over all lanes |
| twelve of one module, blacklisted | one lane, as before |
| `chpin 1` | one lane per shared module, whatever the blacklist says |

**This is deliberately unsafe and it is the user's call.** The static audit
(`audit-render-globals.py`) found six fleet modules mutating file-scope state
from `render_block` and twelve more reaching the chain host's clock globals, and
none of that is fixed — it is now merely *assumed absent*. The equivalence
oracle has never contradicted it (0 differences, 4/12 chains covered), but 4/12
is the coverage, not the verdict. The blacklist is how a module that turns out
to race gets contained, and it ships **empty**: nothing has been measured
racing, and seeding it from the audit would re-pin most of the fleet and give
back the speedup this change exists to unlock.

`helm` is NOT blacklisted. Its crash was inside the *second `dlopen` of a copy*,
which no longer happens; two helm chains sharing one mapping were always fine
(86 ms, measured).

### Work

- Delete `module_iso.rs` (trees, canary) and `chain_iso.rs` (isolation policy).
- New `chain_pin.rs`: per-chain component tracking + the blacklist + pin keys.
  Keys stay keyed on `<namespace>/<module>` rather than the synth id — two chains
  can share an audio FX while running different synths, and airwindows is the
  module in the fleet most likely to appear twice.
- `render_plan::plan()` loses its `pin_duplicates` argument. Grouping is now
  purely "non-empty key", because whether to pin is decided where the key is
  computed. One decision, one place.
- `chiso` / `chcanary` are gone. `chblock <csv>` sets the blacklist, sent by the
  UI from `prefs.json`'s `moduleBlacklist` on every engine boot — including when
  it is empty, since the engine replaces the list wholesale and an empty write
  is how a module removed from the file stops being pinned.
- `pin_duplicates` defaults to **false** (it was true).
- Device: remove the `.movy-iso` tree.

The blacklist is edited by hand in `prefs.json`; it is deliberately not on the
flags page, which edits numbers. There is also no writer for it in movy: a movy
that could add to its own hazard list would have to be sure a crash was that
module's fault, and the isolation canary is precisely the machinery that turned
out not to be worth its cost.

## 2. The Global Params page

Shift+Step **2**, alongside Set Params (5/7/9) and Clip Params (3). A third
sibling in the `param-page.ts` layer, so one Back leaves all three and a track
button closes them.

```
+------------------------------+
| FLAGS                        |
| Parallel Render          ON  |   <- selected row, inverted
| Render Lanes              3  |
| Pin Duplicates           OFF |
+------------------------------+
```

Jog scrolls the selection. Knob 1 changes the selected flag's value. Knob 1's
LED carries the value (dim → bright) and is the only lit knob, which is what
says the page is on knob 1 and nothing else.

### The registry

One table, `src/seq/flags-def.ts`, so adding a flag is one entry and needs no
page code:

```ts
{ key: 'chparallel', name: 'Parallel Render', min: 0, max: 1, def: 0, bool: true }
{ key: 'chlanes',    name: 'Render Lanes',    min: 1, max: 4, def: 3 }
{ key: 'chpin',      name: 'Pin Duplicates',  min: 0, max: 1, def: 0, bool: true }
```

These are the flags that exist today. The page is built to grow into public
params, so the value column is a number with a bool presentation, not a
checkbox.

### Persistence

Flags were never persisted — deliberately, while they were measurement
instruments. They are settings now, so they go in `prefs.json` (machine-level,
beside `defaultQuant`): a flag is about this Move, not about one set. Applied to
the engine on every engine (re)boot, in `engine.ts`'s ready branch, immediately
before `chain_host` — a re-dlopened engine is a brand new one that has never
been told.

### The debug gate

`__MOVY_DEBUG__` is an esbuild `define`. `build-module.sh` (the only release
path) sets `MOVY_DEBUG=0` and **asserts the substituted constant is false in the
built `ui.js`** — a define that silently stopped applying would otherwise ship
the page. Everything else defaults to on, so dev builds and the browser tests
have it.

Gated at the *gesture*, not just the render: with the gate off, Shift+Step 2 is
inert, so there is no view a release build can reach and no dead page to render.

**This hides the page; it does not strip it.** The device bundle is not
minified, so `false && flagsPageActive()` survives as written and the flag names
are still in the file — measured, not assumed. Stripping would mean minifying
the release bundle, which would make the shipped artefact differ from the one
that was device-tested, and that is a worse trade for a page nobody can open.
The release assertion checks the constant for that reason: asserting the strings
were absent would be asserting something untrue and would fail every release.

## 3. Teeth

Each guard removed and the failure watched:

- blacklist ignored → twelve blacklisted chains must spread (they must not)
- pin key computed without the "shared with another chain" test → a lone
  instance of a blacklisted module gets pinned to nothing
- `chpin` not forcing a replan → the flag flips and the plan does not
- flags not re-applied on engine reboot → a reloaded engine renders serial while
  the page says parallel
- debug gate checked only in the renderer → Shift+Step 2 opens a blank view in a
  release build
