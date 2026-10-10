# Set manager — design (WP4 of the standalone migration)

Status: approved in chat 2026-10-10. Plan: `plans/2026-10-10-wp4-set-manager.md`.
Parent: `plans/2026-10-09-standalone-migration.md` → WP4.

## 1. What and why

movy-host (WP6) has no Move behind it, so nothing tells movy which Set is open.
movy needs its own library of Sets, a screen to manage it, and a one-time copy
of every Set movy already holds under Move's ids. WP4 builds all of it inside
overtake movy behind the flag `setsrc` (**default OFF** until standalone ships;
movy-host turns it on unconditionally).

## 2. Decisions (user, 2026-10-10)

| Question | Answer |
|---|---|
| Open | Shift + Step 1. Closes on Back or any other screen switch (it is a param-page sibling) |
| Input | Screen + buttons only. Pads come later (Move-style Set grid) |
| Rows | `[NEW]`, then the Sets |
| Rename | **Capture** renames the Set under the cursor, through schwung's `text_entry.mjs` |
| Duplicate / delete | **Copy** duplicates the Set under the cursor; **Delete** asks, then deletes |
| Footer | schwung-style hint pills, keys drawn as **button icons** (schwung has none; movy draws its own) |
| Order | Newest first by creation date; a Set's duplicates directly after it |
| Jog-click a Set | Load it and close the page |
| `[NEW]` | Creates `YYYY-MM-DD_NN` and moves the focus to it; does not load it |
| Open Set | A filled dot at the row's right end; the clip count before it when it fits |
| Legacy | Every movy Set kept under a Move uuid is imported (copied) at startup; sources untouched |
| Flag | `setsrc` OFF by default in overtake builds |

## 3. Storage

```
/data/UserData/UserLibrary/Movy/
  library.json          index (below)
  Sets/<id>/            exactly today's per-Set files: seq-state*.json,
                        chains.json, ui-state.json, versions.json, v/<n>/
  Trash/<id>-<ms>/      soft-deleted Sets (no UI yet)
```

`UserLibrary/Movy/` sits outside the module directory, so it survives a reinstall
(Dronage's precedent). The engine already creates Set folders 0777 and files
0666, so files root writes in overtake stay writable by an ableton movy-host.

`library.json`:

```json
{ "v": 1, "current": "<id>",
  "imported": ["<legacy uuid>", ...],
  "sets": [ { "id": "...", "name": "...", "created": 1760000000000,
              "parent": "<id>|absent", "legacy": "<uuid>|absent", "clips": 3 } ] }
```

- **id** is the folder name and never changes. New and duplicated Sets get
  `m<created ms, base 36>`, bumped by 1 ms on collision. An imported Set keeps its
  legacy uuid as its id, so an import cut short by a crash is simply redone
  over the same folder. `_default` and `__pending-*` become `r-<sanitised>`.
- **imported** is the migration mark, and it outlives a delete: deleting an
  imported Set must not bring it back at the next startup.
- **clips** is cached so that listing never opens N state files. It is refreshed
  by the save that changed it, and the index is rewritten only when the count
  actually changes.
- Writes are atomic (`atomic_write`). A missing or unparseable index is an empty
  library. The parse failure is logged, and the bad file is kept as
  `library.json.bad` rather than overwritten.

## 4. The engine owns the library

Only the engine can list a directory (module JS cannot). It already owns every
byte of a Set under `engpersist`, and its saver thread serialises all Set file
work. Running library jobs on that same thread is what stops a duplicate or
delete from racing an autosave. New code: `set_library.rs` (index, order, ops)
and `set_import.rs` (legacy scan + copy). `set_saver.rs` only gains the job
arms.

### 4.1 Commands — `set_param("set", …)`

| Command | Effect |
|---|---|
| `lib import legacy=<dir> move=<dir> pages=<dir,dir>` | Scan + copy legacy Sets not yet in `imported`; then publish |
| `lib list` | Re-read the index and publish |
| `lib new <name>` | Create an empty entry (no files: a blank Set writes nothing); publish `made=<id>` |
| `lib dup <id> <name>` | Copy the Set's current files (not its history) to a new id with `parent=<id>`; publish `made=` |
| `lib rename <id> <name>` | Rename; the name runs to the end of the line |
| `lib del <id>` | Move `Sets/<id>` to `Trash/`, drop the entry. **Refused** for the Set the saver has open (`err=busy`) |

The **UI owns name policy** (date, suffix, "Copy"), as it already does in
`set-inherit.ts`, and the engine stores whatever it is sent. Names are cut at
48 characters, and tabs and newlines become spaces.

`open <id>` (the existing job) also records `current` when the saver root is
the library, so "the last-open Set reopens at launch" needs no extra command.

### 4.2 Answer — `get_param("lib")`

Published by the saver thread, already formatted (this runs on the audio thread):

```
rev=<n> cur=<id> made=<id|-> err=<code|->
<id>\t<clips>\t<depth>\t<name>
...
```

Rows arrive **in display order**. `rev` increments on every publish. `made` is
**sticky** (the last Set `new`/`dup` made), because an autosave or an open can
publish in between; the UI waits for it to *change* (ids are unique), never for
the very next answer. `depth` is the duplicate nesting level; the UI does not
draw it yet.

Engine guards that the device run surfaced or the design implied:

- `setsdir` with a **different** path re-roots the saver. Move mode and the
  library are two trees, and a saver left on the old one would autosave into
  the wrong Set.
- The Move-keyed dead-set sweep (`gc`) is **refused** for a library-rooted
  saver. Move knows none of a library's ids, so run there it would delete them
  all. The UI never sends it in library mode either.
- `lib dup` of the open Set first saves what the engine is holding, so the
  copy is not up to one autosave interval stale.

**Order:** roots newest first by `created`. After each Set come its duplicates,
newest first, and the rule nests. A Set whose `parent` is gone counts as a root.

### 4.3 Import

Candidates are the subdirectories of `legacy` (today's
`modules/tools/movy/sets/`). A candidate is imported when its uuid is not in
`imported` **and** it has a state file or a `chains.json`, i.e. when movy ever
saved content into it.

- **Name.** Use the single subfolder of `move/<uuid>/` (Move's Set name). Failing
  that, the same lookup under each `pages` root's `page_<n>/<uuid>/`; then
  `name-index.json`'s reverse entry; then `Imported <YYYY-MM-DD>`. `_default` and
  `__pending-*` are always `Recovered <YYYY-MM-DD>`.
- **Created.** The oldest non-zero `ms` in its `versions.json`, falling back to the
  state file's mtime.
- **Copy.** The whole tree (history included) goes to `Sets/<id>.importing`, then
  is renamed to `Sets/<id>`. Then the entry and `imported` are written. The
  source is only read.
- **After the import:** if `current` is unset, it becomes the newest Set. If the
  library is still empty, the UI makes the first Set (§5.2).

The import runs at every startup in `setsrc=MOVY`. It is idempotent and costs
one directory listing once everything has been imported.

## 5. UI

### 5.1 Set source — `src/seq/set-source.ts`

`setsrc` is latched on first use, i.e. once per open, since ui.js is
re-evaluated on every open; it applies at the next open, like `mstown`. Under `MOVY`:

- `setsDir()` (replacing the `SETS_DIR` constant everywhere) is
  `/data/UserData/UserLibrary/Movy/Sets`;
- identity comes from `wantedSet()`, seeded from the engine's `cur=` after
  the import and changed by the page. It no longer comes from `active_set.txt`;
- the provisional/rename branch, `set-commit`, `set-gc` and copy-on-inherit
  (`seedFor`) are not run. Move's ids do not exist in this mode;
- the engine must own persistence. `setsrc=MOVY` with `engpersist` off shows
  the failure screen `SETS NEED ENGINE SAVES` (engine scope, so it offers no
  blanking), rather than guessing.

Under `MOVE`, nothing changes.

### 5.2 Session flow under MOVY

1. Engine ready → `setsdir <lib>/Sets`, then `lib import …` (once per engine
   generation).
2. Wait for the `lib` answer (`rev>0`). If there is no `cur=` and no rows, send
   `lib new <today>_01` and use `made=`.
3. Load `cur` through the existing `enterLoading` path, so the splash, settle
   and versions behave exactly as they do today.
4. When `wantedSet()` changes, the existing `identityChanged` path runs as a
   **switch**: flush the old Set, load the new one.

### 5.3 The page — `VIEW_SETS`

A param-page sibling (`openParamPage`). Back, a track button, Session and every
other screen switch close it for free. Files: `sets-page.ts` (state + gestures),
`sets-page-vm.ts` (pure), `sets-lib.ts` (wire: send, poll, parse) and
`renderer/sets-view.ts`.

| Control | Effect |
|---|---|
| Jog | Scroll one row; Shift + jog jumps 8 |
| Jog-click `[NEW]` | `lib new <name>`; when `made=` arrives, the cursor moves to it |
| Jog-click a Set | Sets `wantedSet`, then closes the page (the splash shows the load) |
| Capture | `text_entry` with the current name; confirm sends `lib rename`; empty or unchanged does nothing |
| Copy | Flushes the open Set if it is the source, then `lib dup <id> "<name> Copy"`; the cursor moves to `made=` |
| Delete | Arms the confirm; a jog-click deletes, Back cancels, the jog is ignored while armed |
| Capture / Copy / Delete on `[NEW]` | Nothing |

**Deleting the open Set:**
- The UI first switches to the row below, or the row above when it is the last.
- If it is the only Set, the UI makes `lib new` first and switches to that.
- `lib del` is sent once `currentSetUuid()` has moved off the doomed id. The
  engine's busy guard backs this up.

**Default name:** `YYYY-MM-DD_NN` in local time, where NN is the highest `_NN`
already used today (two digits) plus 1. A duplicate's name is `<name> Copy`, cut
to fit 48 characters.

**Render** (128×64):
- the header `SETS`, then the settings list's row metrics and centred scroll
  window;
- each Set row: the name on the left, cut to what is free; on the right, the
  clip count and, for the open Set, a 3×3 filled dot. The count is dropped
  before the name falls below 40 px;
- the footer is three pills, `[◉] RENAME [⧉] DUP [✕] DEL`, in the shape of
  schwung's `drawFooter` (a notched inverted pill holding the key, the action
  plain beside it). The key is an icon from `renderer/button-icons.ts`;
- the confirm takes the two rows above the footer: `DELETE <NAME>?` /
  `JOG=DELETE BACK=CANCEL`. The page is excluded from the Loop strip, as the
  CPU page is.

**Rename modal:** `text_entry.mjs` is loaded through a top-level `await import()`
in try/catch, the pattern `schwung-lib.ts` set. When it fails to load, Capture
shows the toast `RENAME NEEDS NEWER SCHWUNG`. While the modal is open it gets
all MIDI and draws the whole screen. Back cancels it.

**Under `setsrc=MOVE`** the page still opens, and says `SETS FOLLOW MOVE` /
`SETTINGS > MOVY SETS`. There is nothing to list: Move's Sets are on Move's
pads.

### 5.4 Polling and cost

`lib` is read only while the page is open (every 16 ticks) or while an answer is
pending (every 4 ticks), and the rows are parsed only when `rev` changes. The
view model is built from the parsed rows, so a frame does no engine I/O.

## 6. What WP4 deliberately does not do

- The device fixture keeps seeding Move-bound Sets. The flag is OFF by default,
  so the 20 existing scenarios still run in Move mode. One new scenario seeds
  library Sets directly (no `set_state/<uuid>`, no Move materialisation, no
  stack restart). That is the goal-8 win the plan names, scoped to the mode
  that uses it. Converting the shared fixture waits until the flag defaults on
  (WP7).
- There is no Trash UI, pad Set grid or Set sorting UI.
- Legacy `sets/` and schwung's `set_state/` are never deleted or modified.
- A downgrade opens the pre-import state; this is the plan's accepted oddity.

## 7. Tests

- **cargo** (`set_library.rs`, `set_import.rs`):
  - the order, nested duplicates and orphans;
  - name sanitising;
  - creating an entry writes no files;
  - dup copies state but not history;
  - del moves to Trash and refuses the open Set;
  - a corrupt index is kept aside;
  - import idempotence, including after a delete;
  - the name fallbacks;
  - `_default` and `__pending` become Recovered;
  - blank legacy Sets are skipped;
  - the source is byte-identical afterwards;
  - `created` comes from versions, else mtime;
  - `open` records `current`.
- **logic:**
  - the `lib` wire parser;
  - default name and suffix, and duplicate names;
  - the VM (rows, dot, the clip count dropped when the name is long);
  - page gestures: focus follows `made=`, the confirm owns the jog, and the
    delete-open-Set sequencing;
  - set-source routing (`setsDir` under each mode).
- **screenshots:** `sets_list`, `sets_long_names`, `sets_confirm`,
  `sets_move_mode`.
- **perf:** with the page open, frame cost and engine reads per frame stay flat.
- **device:** `sets-library.ts`. It reads `library.json` from disk rather than
  the `lib` param, because testd's `GET_PARAM` is line-based and the answer is
  multi-line:
  - seed a library and legacy Sets; open with `setsrc=1`;
  - the import result on disk, sources unchanged;
  - new → focus → open → state saved under the library id;
  - dup, rename and delete, checked on disk;
  - reopen restores the last-open Set.
