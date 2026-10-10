# WP4 Set Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** movy's own library of Sets (list/open/new/rename/duplicate/delete +
legacy import) behind `setsrc`, with a Shift+Step 1 manager page.

**Architecture:** The engine's saver thread owns `library.json`, the import and
every file move (`set_library.rs`, `set_import.rs`); it serves pre-formatted rows
on `get_param("lib")`. The UI owns name policy, the page, and which Set is wanted
(`set-source.ts`), and reuses the existing load/switch path.

**Tech Stack:** Rust (movy-dsp), TypeScript (QuickJS UI), node browser-test
suites, TS device tier.

**Spec:** `docs/superpowers/specs/2026-10-10-set-manager-design.md`

## Global Constraints

- Library root `/data/UserData/UserLibrary/Movy/` (`Sets/`, `Trash/`, `library.json`).
- `setsrc` flag: `def: 0`, `bool`, applies next open. MOVY requires `engpersist`.
- Legacy dirs are read-only inputs. Never written, never deleted.
- Names ≤ 48 chars, tabs/newlines → spaces. Default `YYYY-MM-DD_NN`; dup `<name> Copy`.
- No file I/O on the audio thread; mutex never held across I/O (set_saver.rs rule).
- TS files ≤ 200 lines; comments explain WHY.
- ENGINE_VERSION bump in `lib.rs` + `src/seq/constants.ts` (wire changed).

---

### Task 1: `set_library.rs` — index, order, ops (engine)

**Files:** Create `engine/crates/movy-dsp/src/set_library.rs`; modify `lib.rs` (mod).

**Produces:**
- `pub struct Entry { id, name, created: u64, parent: Option<String>, legacy: Option<String>, clips: u32 }`
- `pub struct Library { current: String, imported: Vec<String>, sets: Vec<Entry> }`
- `pub fn load(path:&Path)->Library` (missing → empty; corrupt → rename to `.bad`, empty)
- `pub fn save(path:&Path, lib:&Library)->Result<(),String>` (atomic_write)
- `pub fn ordered(lib:&Library)->Vec<(&Entry, u32 /*depth*/)>`
- `pub fn clean_name(s:&str)->String`
- `pub fn new_id(lib:&Library, sets_dir:&Path, now:u64)->String`
- `pub fn wire(lib:&Library, rev:u32, made:&str, err:&str)->String`
- ops on `LibCtx { root: PathBuf /*Movy*/, store: &SetStore }`: `create(name)->id`, `dup(src,name)->Option<id>`, `rename(id,name)->bool`, `delete(id, open:&str)->Result<(),&'static str>`, `note_clips(id,payload)`, `set_current(id)`.

Tests (in-module): order roots newest-first + nested dup + orphan; clean_name;
create writes no Set files; dup copies seq-state/chains/ui-state but not
versions.json/v; delete → Trash, entry gone, `busy` for the open id; corrupt
index → `.bad` kept; wire format.

- [ ] write tests → fail → implement → `cargo test set_library` pass

### Task 2: `set_import.rs` — legacy import (engine)

**Produces:** `pub struct ImportSrc { legacy: PathBuf, move_sets: PathBuf, pages: Vec<PathBuf> }`,
`pub fn import(lib:&mut Library, sets_dir:&Path, src:&ImportSrc)->u32` (count).

Rules: spec §4.3. Name lookup order: `move/<uuid>/<only subdir>`,
`pages[*]/page_<0..8>/<uuid>/<only subdir>`, `legacy/name-index.json` reverse,
`Imported <date>`; `_default`/`__*` → `Recovered <date>`, id `r-<sanitised>`.
Created: min nonzero `ms` in `versions.json` else state mtime. Copy to
`<id>.importing` then rename. Date formatting from epoch ms (UTC civil-from-days).

Tests: idempotent (2nd run imports 0), not re-imported after delete, all name
fallbacks, recovered naming, blank skipped (no state, no chains), source bytes
unchanged (compare a hash of every file before/after), created from versions,
history copied.

- [ ] tests → fail → implement → pass

### Task 3: saver wiring + `get_param("lib")` + ENGINE_VERSION

**Files:** `set_saver.rs` (Job::Lib, parse, worker arms, `Shared.lib`), `lib.rs`
(`"lib"` get_param, version bump), `src/seq/constants.ts` (version).

- `parse_cmd("lib import legacy=.. move=.. pages=a,b")`, `lib list|new <name>|dup <id> <name>|rename <id> <name>|del <id>`.
- Library mode = the saver root's file name is `Sets` and parent holds `library.json`
  OR any `lib` command arrived (simplest: `LibCtx` built lazily from `root.parent()`
  on first `lib` job; `Open` records current only once lib is active).
- Save arm calls `note_clips` when lib active.
- `del` refuses `shared.uuid`.

Tests: parse cases; through `Saver` (drain_for_test): new→made, open records
current, save updates clips, del of open → `err=busy`.

- [ ] tests → fail → implement → `cargo test` all pass

### Task 4: set source + dynamic sets dir (UI)

**Files:** create `src/seq/set-source.ts`; modify `set-context.ts` (SETS_DIR →
`setsDir()`), all SETS_DIR users, `flags-def.ts` (`setsrc`), `set-session.ts`
(identity under MOVY, skip rename/commit/gc), `set-load.ts` (seed off under MOVY).

**Produces:** `setSourceMovy():boolean` (latched by `latchSetSource()` from
`resetSetSession`), `setsDir():string`, `wantedSet():string`,
`wantSet(id:string):void`, `LIBRARY_ROOT`, `LEGACY_SETS_DIR`.

Tests (logic `set-library.mjs`): setsDir per mode; latch ignores mid-session flag
change; identity under MOVY follows `wantSet`.

### Task 5: `sets-lib.ts` wire + names (UI)

**Produces:** `parseLib(s:string): LibState {rev,cur,made,err,rows:{id,clips,depth,name}[]}`,
`libSend(cmd)`, `libPoll(tick, pageOpen)`, `libState()`, `defaultSetName(now:Date, rows)`,
`dupName(name)`, `libBoot()` (setsdir + import once per engine gen).

Tests: parser incl. names with spaces, empty rows; default name suffix 01/next/other-day;
dup name truncation.

### Task 6: page state, VM, router, render, icons

**Files:** `seq/sets-page.ts`, `seq/sets-page-vm.ts`, `renderer/sets-view.ts`,
`renderer/button-icons.ts`, `renderer/text-entry-lib.ts`, `app/state.ts`
(VIEW_SETS), `seq/param-page.ts`, `seq/step-shortcuts.ts` + constants
(STEP_SETS=0), `midi/router.ts` (jog, click, back, modal), `seq/router-buttons.ts`
(Capture/Copy/Delete on page), `app/tick.ts` (render + strip exclusion),
`app/page-poll.ts` (screen-owning).

Tests: logic gestures (new focus via made, open closes page + wantSet, confirm
owns jog, delete-open sequencing, buttons on [NEW] no-op); screenshots
`sets_list`, `sets_long_names`, `sets_confirm`, `sets_move_mode`; perf.

### Task 7: session flow under MOVY

`set-session.ts`: boot import, wait for rev, create first Set, pending delete
executes after switch. Logic tests through the mock engine param.

### Task 8: device scenario `sets-library.ts` + docs

Seed `UserLibrary/Movy` + a legacy dir, flip `setsrc` in prefs with movy closed,
assert import on disk + sources unchanged, new/dup/rename/delete on disk,
reopen restores current; restore prefs and remove the library after.
MANUAL.md section + controls table; CHANGELOG.

### Task 9: gates + commit

`./scripts/run-gate.sh both`; fix; commit + push on `standalone-migration`.
