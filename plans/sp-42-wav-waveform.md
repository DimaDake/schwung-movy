# SP-42 — a .wav has no waveform, because movy never registered the file reader

Order 10. Planning only — see `docs/schwung-page-migration.md:948-985` (entry),
`:2433-2564` (SP-28), `:2400-2432` (SP-34), `:254-377` (injection surface).

## 1. Precise cause — verified, and it is TWO defects, not one

**Defect A — the IO is never registered.** `src/renderer/schwung-lib.ts:121-151`
awaits ten `param_pages` modules; `wav_io_qjs.mjs` is not one of them (grepped
the whole tree — zero hits outside comments/the ledger). Confirmed against
`origin/main` (`git -C ../schwung fetch --all`,
`git -C ../schwung show origin/main:src/shared/param_pages/wav_io_qjs.mjs`):
it is a **side-effect-only module** — `import * as std from "std"; import * as
os from "os";` then one top-level `setWavPeaksIO({ open, stat })` call that
writes a module-level `IO` variable inside `wav_peaks.mjs`. Nothing else sets
`IO`, and `wav_peaks.mjs:98,116` (`startJob`/`fileSignature`) both guard `if
(!IO) return null` — so on movy's process `IO` stays `null` forever and the
sample cell never has an envelope to show. This part matches the ledger's
one-liner.

**Defect B — even registered, nothing advances the job (the ledger buries this
in "Design & implementation" but it is load-bearing, not optional).**
`wav_peaks.mjs` is **resumable**: `wavPeaksTick(path)` does `BLOCKS_PER_TICK =
2` blocks and returns; the picture only fills in across repeated calls.
`viz_draw.mjs:1480` (`drawSample`) is explicit: *"No I/O here: wavPeaks never
reads, and the job is advanced from the tick."* — the draw path only reads the
cache (`wavPeaks()`, `wav_peaks.mjs:271`), it never calls `wavPeaksTick`.
The ONLY caller of `wavPeaksTick` in the whole schwung tree is Schwung's own
host loop, `src/shadow/shadow_ui_param_pages.mjs:633-658` (`tickParamPages`):
it asks `controller.vizGroups()` for the current page's `VIZ_SAMPLE` groups,
reads each group's file path off `controller.state.values[g.roles.value]`,
and calls `wavPeaksTick` on the first one not yet `wavPeaksDone`, once per
tick. `page_controller.mjs:5417-5420`'s own comment says why `vizGroups` is a
public method at all: *"Exposed so the host can advance a sample's
peak-envelope job from its TICK without planning a second time."* Movy runs
its **own** host loop (`src/renderer/schwung-page-contract.ts:150-196`,
`ctl.tick()` at line 194) and never calls `ctl.vizGroups()` anywhere in `src/`
(grepped) — so even with Defect A fixed, a selected sample would draw the
"no envelope" fallback (a flat centre line, one pixel per column —
`viz_draw.mjs:1466` `halfAt = () => 0` — this is what "blank" looks like on
screen) forever, because nothing ever calls `wavPeaksTick`.

**So:** not "registered too late," not "registered and failing" — genuinely
**unregistered**, plus a **second, independent missing wire** the headline
doesn't name. Both must land for the product claim ("draws its envelope on
device") to be true. Present in v1.4.0 (current device version); the modules
involved (`wav_peaks.mjs`, `viz.mjs`, `wav_io_qjs.mjs`) are not new, so **no
`SCHWUNG_FLOOR` bump** (`src/renderer/schwung-floor.ts`).

## 2. Cost of importing it

- **Bundle size (device build):** `wav_io_qjs.mjs`, `wav_peaks.mjs` and
  `viz.mjs` are `external: ['/data/UserData/schwung/*']` in
  `build/device.mjs:84` — they ship on the device already (part of Schwung's
  own install), so this costs **zero device bundle bytes**. The browser build
  (`build/browser.mjs`) inlines them when `SCHWUNG=` is set, for tests only —
  not shipped.
- **QuickJS parse time at `shadow_ui` start:** `schwung-lib.ts`'s whole ladder
  is a single `Promise.all` under **top-level await**
  (`schwung-lib.ts:18-27,109-151`) — the load already blocks `shadow_load_ui_module`
  until every current import settles. `wav_peaks.mjs` and `viz.mjs` are
  **already loaded today**, transitively: `render_page_movy.mjs` (already
  imported, `schwung-lib.ts:127`) imports `drawVizGroup` from `viz_draw.mjs`
  (`render_page_movy.mjs:29`), which imports `wavPeaks`/`resamplePeaks` from
  `wav_peaks.mjs` (`viz_draw.mjs:36`) and `VIZ_SAMPLE` from `viz.mjs`
  (`render_page_movy.mjs:32`). Adding them to movy's own ladder is **not new
  parse work** — it is asking by name for two modules already sitting in
  memory, same argument as the existing `child_key.mjs`/`param_meta.mjs`/
  `page_plan.mjs`/`anim_state.mjs` entries (`schwung-lib.ts:134-150`).
  `wav_io_qjs.mjs` itself IS new parse work, but it is ~35 lines with two
  built-in-module imports (`std`, `os` — already resolved instantly, they are
  host natives) and one object literal — negligible next to the ladder's
  existing ten files.
- **Transitive deps:** `wav_io_qjs.mjs` → `wav_peaks.mjs` only (confirmed by
  reading the file). No new transitive surface beyond what already loads.
- **Standing cost once wired — the real number to worry about, and it is
  Defect B's, not the import's.** Once `advanceSample` (new, see §4/§6) is
  added to `schwung-page-contract.ts`'s tick, EVERY tick does one
  `ctl.vizGroups()` read (cached per fingerprint+page+child+widget-generation,
  `page_controller.mjs:5152-5175`, so a repeat ask on an unchanged page is a
  map lookup, not a re-resolve) plus, only while an undone sample cell is on
  the CURRENT page, one `wavPeaksTick` (2 blocks, no IPC — pure local file
  read). **Off a sample page this is a cache hit and a `for` loop over an
  empty or already-`done` array — the same shape as SP-38's `settled` read,
  which the ledger already accepts as free.** This is not a standing cost
  comparable to SP-49's (idle IPC) — it is idle CPU on a page most Sets are not
  showing, bounded to the ticks that page is actually up.
- **Should it be lazy, and how, given the module-cache trap?** The `Promise.all`
  ladder is not "lazy" in the sense of deferred-until-used — it is **eager at
  load and cheap** (see above), which is the file's own stated design
  (`schwung-lib.ts:110-113`: *"Loaded together rather than lazily: a page that
  half-exists is worse than one that does not... One catch for the whole set
  means one answer to 'is the grid available'."*). Since `wav_peaks.mjs` and
  `viz.mjs` already load unconditionally as soon as `render_page_movy.mjs`
  does, there is **no lazy option cheaper than what already happens** — trying
  to defer `wav_io_qjs.mjs`'s import until a sample cell is actually seen would
  need its own gate, and `3262-3313`'s recorded trap (QuickJS caches every
  module `ui.js` imports for the **whole `shadow_ui` process life** — a later
  "now register it" import would either re-run the top-level `setWavPeaksIO`
  call harmlessly idempotently, since it just overwrites the module var, or
  (if built as a *conditional* `import()` gated behind first-sample-seen) work
  fine functionally but buys nothing: the import cost is what's already being
  paid by the transitive load, so gating it saves nothing and adds a second
  place the availability answer can diverge from `schwungLibAvailable()`'s
  single source of truth. **Recommendation: import eagerly, in the same
  `Promise.all`, same as everything else in the file** — it is already paid
  for.

## 3. Fleet modules that actually exhibit this

Cross-referenced `docs/module-dump/modules/*.json` for `filepathParam`/
`filepath_param` (the field that makes `detectSample` claim a `VIZ_SAMPLE`
group, `viz.mjs:869-1068` — as opposed to hank's `custom:hank_wave`, which is
SP-28's already-fixed, module-authored canvas path and NOT this item's
target). **Six modules carry a sample path; one (hank) is `custom:` and out of
scope here; five use the built-in detector:**

| module | field(s) |
| --- | --- |
| `mrsample` | `sample_path` (two `filepathParam` sites — main + loop) |
| `granny` | `sample_path` (two sites, same shape) |
| `breakbeat` | `sample_path`, side-by-side A/B (the two-cell stress case `CACHE_MAX=4`/one-per-tick fairness exists for, `wav_peaks.mjs:70-88`) |
| `slicer` | `sample_path` |
| `mrdrums` | per-voice `p01_sample_path` … `p16_sample_path` (child-level, `filepath_param: pad_sample_path`) |

**`mrdrums` is already the fixture's track-1 module**
(`scripts/fixtures/device-set/slots.txt:11`, `ui-state.json`) — no new module
swap needed for a device test, only setting one pad's `p01_sample_path` (today
`""` in `scripts/fixtures/device-set/slot_1.json`) to a real on-device file.
Cheapest real exhibition for the **logic**-tier test is a single-sample module
shape: `browser-test/mock-synth.mjs` already declares one
(`sample_path`/`filepath_param: 'sample_path'` appears at lines 223, 253-255,
268-284, 1111-1155 across a few mock synths) — reuse one of these rather than
inventing a seventh mock.

## 4. Test with teeth, cheapest level first

**Logic tier (no device, `SCHWUNG=../schwung` required — this is a
Schwung-side assertion).** New sibling module
`browser-test/logic/schwung-sample.mjs` (schwung-page.mjs is already 661
lines, over the suite's own ~600-line convention — do not grow it; register
the new module in `browser-test/logic.mjs`'s two lists per the existing
"add a subsystem" recipe). Build a real controller against a mock synth that
declares `filepath_param` (reuse `bootModel`/`portFor`/`schwungPageFor` from
`harness.mjs`, the same scaffold `schwung-page.mjs` already uses), point its
`sample_path` at a fixture path via `env.setFiles`, and reuse the WAV
byte-builder — **extract `makeWav` out of
`browser-test/logic/wav-peaks.mjs`'s closure into a shared helper** (e.g.
`browser-test/logic/wav-fixture.mjs`, exported, imported by both suites) so
the new suite does not duplicate it (the "no code duplication" rule). Assert:

1. **Teeth for Defect A:** after enough `advanceSample`/tick calls, the
   resolved `VIZ_SAMPLE` group's file reads back a real, non-empty peak array
   (mirrors `wav-peaks.mjs`'s own "silence at the start / full scale in the
   middle" assertions, but through Schwung's `wavPeaks()`, not movy's). Remove
   the `wav_io_qjs.mjs` import from `schwung-lib.ts`'s ladder → `IO` stays
   null → `startJob` returns null → the cache entry is `{error: "unreadable
   wav"}` forever → this assertion reddens.
2. **Teeth for Defect B:** with the import restored but `advanceSample` never
   called (comment out its call site), the group is resolved but its envelope
   never starts (`wavPeaksTick` never runs) → the same assertion reddens a
   second, independent way. Prove both separately — one fix without the other
   must still fail this suite, which is what makes it catch a partial revert.
3. A cheap existence check that `schwungLib()` actually exposes the three new
   optional fields when the library loads (`typeof schwungLib().wavPeaksTick
   === 'function'`, etc.) — catches a typo in the ladder without needing a
   full envelope run.

**Device tier (the only place real `std`/`os` I/O is proven end-to-end).**
Extend `test-device/scenarios/widgets.ts` (SP-28's home; `MODULE = 'hank'` at
line 93 is nearby but this is a **different** module/kind — add a second block
in the same scenario rather than a new file, since it is the same
"custom/detected graphic" subject SP-28 already opened, or add a short sibling
scenario if the file is near its own 600-line device-tier cap — check before
choosing). Steps: set `mrdrums`'s `p01_sample_path` (already the fixture's
track-1 module) to a real file found on-device (`find /data/CoreLibrary -name
'*.wav' | head -1` at scenario setup, not hard-coded, so it survives a
CoreLibrary reshuffle), arm the delegated renderer for this scenario only
(`probe.setGridMode`, per `test-device/arm.ts` — the per-scenario arm
mechanism the injection-surface/burn-down sections describe; do not touch
ambient `schwunggrid`), navigate to pad 1's sample page, wait several frames,
and read the **FRAMEBUFFER** (not the probe) for the sample cell — SP-28's own
closing note calls this "the stronger test: it reads the panel," and the same
reasoning applies here (a dump-replay assertion has no registry/IO to read
against off-device, same limitation SP-28 hit and the same reason it used a
device scenario instead). Teeth: with either defect present the cell frame is
byte-identical to the flat-baseline case; with both fixed it is not.

## 5. Screenshot baseline

**Yes — a waveform is pixels, and `browser-test/screenshot.mjs` already has a
delegated-arm path** (`page_body`/`page_body_p2`/`page_voice_pad`,
`screenshot.mjs:1282-1372`, built via `bodyOverride` + `schwungPageFor`, no
device needed, just `SCHWUNG=../schwung`). Add one new scene (e.g.
`page_sample`) on the same mock synth/fixture the new logic test uses, with
`env.setFiles` backing a real WAV and enough ticks for the envelope to
resolve, so the baseline shows an actual waveform, not the flat fallback line.
Update with `SCHWUNG=../schwung node browser-test/screenshot.mjs --update`
and review the diff by eye before accepting (per gate rules) — this is the one
part of the suite where "it looks like a waveform" is a human judgment call a
numeric assertion can't make.

## 6. Ordered implementation steps

1. **`src/renderer/schwung-lib.ts`** — extend the `SchwungLib` interface
   (near the existing OPTIONAL block, `:69-96`) with `wavPeaksTick?: any`,
   `wavPeaksDone?: any`, `VIZ_SAMPLE?: any` (optional, same convention as
   `settled`/`buttonPhase`: an older Schwung missing these costs movy the
   feature, not the library). Add three entries to the `Promise.all` array
   (`:121-151`): `import('/data/UserData/schwung/shared/param_pages/wav_io_qjs.mjs')`
   (side-effect only — destructure to an unused, underscore-prefixed
   binding), `wav_peaks.mjs` (for `wavPeaksTick`, `wavPeaksDone`), `viz.mjs`
   (for `VIZ_SAMPLE`) — literal absolute paths, matching the file's own
   "LITERAL PATHS, NOT A CONCATENATION" rule (`:99-104`). Wire the three new
   fields into the `lib = {...}` object (`:152-168`).
2. **New file `src/renderer/schwung-page-sample.ts`** (new module, not grown
   into `schwung-page-contract.ts` — that file is already at 199/200 lines).
   Export `advanceSample(ctl, lib)`, mirroring
   `shadow_ui_param_pages.mjs:633-658` exactly: guard on
   `typeof ctl.vizGroups === 'function' && lib.wavPeaksTick && lib.wavPeaksDone`
   (missing on an older Schwung → no-op, same optional-field pattern as
   `schwung-page-anim.ts`); find the first `VIZ_SAMPLE` group whose
   `roles.value` names a truthy path in `ctl.state.values` and is not yet
   `wavPeaksDone`; call `wavPeaksTick` on it; `break` after one (one bounded
   batch per tick, same as upstream).
3. **`src/renderer/schwung-page.ts`** and **`schwung-page-contract.ts`** —
   thread `lib` into `createPageContract(...)` (lib is already in scope where
   `createPageContract` is called, `schwung-page.ts:141`) and call
   `advanceSample(ctl, lib)` once, right after `ctl.tick()`
   (`schwung-page-contract.ts:194`).
4. **`build/browser.mjs`** — inside the existing `onResolve` for
   `param_pages/` (`:332-341`), add a branch before the generic `if (SCHWUNG)`
   resolve: when `a.path.endsWith('wav_io_qjs.mjs')`, resolve to a new
   `browser-test/stubs/wav-io-qjs.mjs` instead of the real checkout file —
   the real file's static `import * as std from "std"` cannot resolve under
   esbuild/node, which is exactly the "browser-build trap" the ledger entry
   flags. `wav_peaks.mjs` itself needs no such treatment (it never imports
   `std`/`os` — only accepts injected IO).
5. **New file `browser-test/stubs/wav-io-qjs.mjs`** — same shape as the real
   file, but backed by `globalThis.std`/`globalThis.os` (the SAME mocks
   `browser-test/env.mjs` already installs for movy's own
   `src/model/wav-peaks.ts` tests) instead of real ES-module `std`/`os`
   imports, and importing `setWavPeaksIO` from the **absolute** schwung path
   (`/data/UserData/schwung/shared/param_pages/wav_peaks.mjs`) so the plugin's
   existing resolve rule points it at the same real, un-stubbed file
   `schwung-lib.ts`'s own import resolves to — same module instance, so the
   registration is visible to both. (Schwung's own `tools/param-pages/
   widget_sheet.mjs` does the equivalent with real `fs`, read-only, for
   reference — do not copy it verbatim; movy's harness mocks are the existing
   in-repo idiom and avoid a second IO-backing mechanism.)
6. **`browser-test/logic/wav-fixture.mjs`** (new, or add to `harness.mjs`) —
   extract `makeWav` out of `wav-peaks.mjs`'s closure so it's shared.
7. **`browser-test/logic/schwung-sample.mjs`** (new) — the three assertions in
   §4; register in `browser-test/logic.mjs`'s two lists.
8. **`browser-test/screenshot.mjs`** — one new scene per §5.
9. **`test-device/scenarios/widgets.ts`** — extend per §4's device steps.
10. Run gates: `SCHWUNG=../schwung npm test` (0 failures),
    `SCHWUNG=../schwung node browser-test/page-mode.mjs` (must not grow past 3),
    `SCHWUNG=../schwung node browser-test/screenshot.mjs --update` and review,
    then `npm run test:device` (device tier, includes the extended scenario).
11. Update `docs/schwung-page-migration.md`'s SP-42 row to Done, and
    `MANUAL.md` if the waveform is described there as a known gap.

**Needs:** nothing blocking; independent of SP-38's clock question (this item
supplies its OWN per-tick driver rather than depending on SP-38 landing
first), though both live in the same "who advances what, per tick" territory
in `schwung-page-contract.ts` — worth a second look for a shared abstraction
once both have shipped, not before (avoid speculative generalization now).
