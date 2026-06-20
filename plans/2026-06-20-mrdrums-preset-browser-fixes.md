# Mr Drums preset browser fixes + track colors + record toast

Date: 2026-06-20. All changes are in `movy/` only — the mrdrums DSP repo is not touched.

## Root cause (preset browser issues 1–3)

`mrdrums.json` and the device `chain_params` both specify `fileRoot` / `fileFilter` /
`fileStartPath` for `ui_preset_path`, but `model/hierarchy.ts` **custom-config path**
(the branch used for any module with a `.json` layout) builds the `KnobParam` and
**drops those three fields**. At runtime the file param therefore has no filter and no
start path:

- start path lost → overlay + full browser default to `/data/UserData` ("root")
- filter lost → overlay's `scanFiles` lists folders + non-presets → selecting one sets
  the param → mrdrums tries to load garbage → crash

## Changes

1. **`types/param.ts`** — add `fileRequireContains?: string` to `KnobSlot` and `KnobParam`.
2. **`model/hierarchy.ts`** (custom-config path) — for `type === 'file'` slots, propagate
   `fileRoot` / `fileFilter` / `fileStartPath` / `fileRequireContains` (slot first, then
   `chain_params` `root`/`filter`/`start_path`). *Fixes start dir + restores filtering.*
3. **`model/index.ts` `scanFiles`** — skip directories explicitly. The overlay is a flat
   quick-pick with no navigation, so folders must never appear. *Fixes overlay folders.*
4. **`model/file-validate.ts`** (new) — `fileContentAllows(path, requireContains)`:
   reads the file via `host_read_file`; returns `true` if no token required or token is
   present or file is unreadable (so a host read failure never blocks a valid preset).
   Mirrors mrdrums' own internal `"drumRack"` check.
5. **Incompatible-preset toast** — on commit in both paths, if `fileContentAllows` is
   false, abort the commit and show the timed `seqToast('Wrong preset type')`:
   - overlay: `model/index.ts handleKnobRelease` returns a `fileRejected` boolean; router
     shows the toast (keeps model free of the seq layer).
   - full browser: `browser/file-handler.ts activateFileBrowserItem` shows it and keeps
     the browser open.
   - thread `requireContains` through `getFileBrowseTarget` → `openFileBrowser` →
     `FileBrowserState`.
6. **`mrdrums.json`** preset slot — add `"fileRequireContains": "drumRack"`.
7. **Full browser** already shows folders + hides non-matching files (`scanDir`) and
   already closes on file-select (`activateFileBrowserItem`) — locked with tests.
8. **`seq/router.ts:192`** — remove the record `seqToast`.
9. **`seq/colors.ts`** — track 3 `Cyan(14)`→`BrightPink(25)` dim `90`→`109`;
   track 4 `Purple(22)`→`Blue(125)` dim `105`→`95`.

## Tests (TDD)

- `logic.mjs`: hierarchy file-field propagation for mrdrums preset slot; `scanFiles`
  excludes folders; overlay starts in Track Presets + hides wrong files; `fileContentAllows`
  accept/reject; overlay commit rejected on wrong type (param unchanged, `fileRejected`).
- `app-loop.mjs` / existing colour tests reference `trackColor()` so they follow the new
  values automatically; add an assertion for the new pink/blue indices.
- `screenshot.mjs` + `perf.mjs` regression. Device `test.sh` if `move.local` reachable.
