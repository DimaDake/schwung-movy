# Per-Set Sequencer State — Design

**Date:** 2026-06-30
**Status:** Approved, ready for implementation plan

## Problem

Schwung stores its track/clip state per native Ableton Move *set*. Movy has a
single **singleton** state (`seq-state.json`) loaded once at boot. Switching the
Move set therefore keeps movy playing the *same* sequence while the native
tracks differ — movy and schwung are out of alignment.

## Goal

Make movy's sequencer + UI state **per-set**, mirroring schwung / the davebox
seq8 reference tool: each Move set recalls its own independent movy project, and
switching sets saves the old set and loads the new one.

## Decisions (agreed)

1. **Scope:** *Everything* per-set — engine state (clips, tracks, tempo, swing)
   **and** UI state (root note, scale).
2. **Copy/paste:** A duplicated set **inherits** its parent set's movy state
   (Move appends `" Copy"` / `" Copy N"` to the folder name). When multiple
   parents are possible, **auto-pick the best match** (no modal picker).
3. **Migration:** None. **Breaking backward compatibility is OK** — the old
   singleton `seq-state.json` is abandoned, no fallback path to it.

## Reference: how davebox does it

- Source of truth: `/data/UserData/schwung/active_set.txt` — line 1 = UUID,
  line 2 = set name. (`schwung-davebox/ui/ui_persistence.mjs:readActiveSet`.)
- Per-set state files keyed by UUID under `set_state/<uuid>/`.
- A name→UUID index (`seq8_name_index.json`) drives copy/paste inheritance.
- Inherit family = base name (suffix stripped) plus `base + " Copy [N]"`, each
  validated against an existing state file **and** an existing backing Move set.
- davebox tracks the loaded UUID in its **DSP** (`state_uuid` param) and detects
  switches on suspend→resume. Movy will track it in JS instead (see Approach).

## Approach (chosen: A — JS-only polling)

The UI owns set detection; the Rust engine stays **UUID-agnostic** (no
`dsp.so` change, no redeploy).

- Track `currentSetUuid` / `currentSetName` in a `persist.ts` module variable.
- Poll `active_set.txt` from `seqPersistTick` (~2×/sec). A UUID change funnels
  into one `switchToSet(uuid, name)` routine, the same routine the boot path
  uses. This naturally catches switches made while movy is suspended (caught on
  the first tick after resume) and self-heals if the JS context is torn down
  (the boot path re-reads `active_set.txt`).

Rejected: **B** — add a `state_uuid` param to the engine (davebox parity). More
robust to JS teardown but needs engine + `dsp.so` changes + redeploy + more test
surface, and polling already self-heals. Not worth it.

## Components

### 1. `src/seq/set-context.ts` (new)

Pure path/IO helpers, no orchestration:

- `readActiveSet(): { uuid: string; name: string }` — parse `active_set.txt`;
  `{uuid:'', name:''}` if missing/unreadable.
- `uuidToStatePath(uuid)` / `uuidToUiStatePath(uuid)`:
  - non-empty UUID → `…/modules/tools/movy/sets/<uuid>/seq-state.json` and
    `…/sets/<uuid>/ui-state.json`
  - empty UUID → a `…/sets/_default/…` fallback so movy runs off-device / in
    tests with no `active_set.txt`.
- `loadNameIndex()` / `saveNameIndex(idx)` / `rememberSet(name, uuid)` over
  `…/modules/tools/movy/sets/name-index.json`.
- `stripCopySuffix(name)` — strip one `" Copy"` / `" Copy N"` level; `null` if
  no suffix.
- `findInheritCandidates(name, idx)` — family regex on the name index, each
  candidate validated: its state file exists **and** its Move set still exists
  (`/data/UserData/UserLibrary/Sets/<uuid>`). Sorted base-name-first, then
  shortest, then alpha. Excludes the current set. Returns `{uuid,name}[]`.
- `copyStateFiles(srcUuid, dstUuid)` — copy `seq-state.json` (+ `ui-state.json`
  if present) from src to dst, ensuring the dst dir first.

All host calls guarded with `typeof … === 'function'`. When `host_file_exists`
is unavailable, treat "file exists" as "`host_read_file` returns non-empty".

### 2. `src/seq/persist.ts` (refactor)

- Module state: `currentSetUuid`, `currentSetName`, `loaded`, save countdowns.
- **Boot** (`!loaded`): `readActiveSet()` → `switchToSet(uuid, name)` with no
  "old" to save → `loaded = true`.
- **Poll** (every `SET_POLL_TICKS`): `readActiveSet()`; if `uuid !==
  currentSetUuid` → `switchToSet`.
- **Autosave** (existing dirty timer): write engine `state` to
  `uuidToStatePath(currentSetUuid)`; write UI state to
  `uuidToUiStatePath(currentSetUuid)` when `uiDirty`.

`switchToSet(newUuid, newName)`:
1. **Save old** (if we had a loaded set): engine `get_param('state')` →
   `uuidToStatePath(oldUuid)`; `serializeUiState()` → `uuidToUiStatePath(oldUuid)`.
2. **Resolve new state blob**:
   - new UUID's state file exists → use its contents.
   - else `findInheritCandidates`; if any → `copyStateFiles(best.uuid, newUuid)`
     then read the seeded file.
   - else → `BLANK_STATE` (`"movy1\n"`).
3. `host_module_set_param_blocking('state', blob, 200)` → `requestLabelSync()`.
4. **UI state**: read `uuidToUiStatePath(newUuid)`; `applyUiState` if present,
   else reset to defaults (`rootNote = 48`, `scale = 0`).
5. `currentSetUuid/Name = new…`; `rememberSet(newName, newUuid)`; clear dirty.

### 3. Blanking — no engine change

The engine's `persist::load()` clears all clips/tracks **before** applying and
requires the `movy1` format tag. A tag-only blob (`"movy1\n"`) therefore yields
a clean slate. `BLANK_STATE` is a `persist.ts` constant with a comment pointing
at `FORMAT_TAG` in `engine/crates/seq-core/src/persist.rs`.

### 4. `src/types/schwung.d.ts`

Add `declare function host_file_exists(path: string): boolean;` and
`declare function host_ensure_dir(path: string): boolean;`.

## Data flow (live switch)

```
active_set.txt UUID changes
  └─ seqPersistTick poll detects (uuid !== currentSetUuid)
       └─ switchToSet(new):
            save old:  engine.get('state') → sets/<old>/seq-state.json
                       serializeUiState()  → sets/<old>/ui-state.json
            resolve:   file? → inherit(best)? → BLANK
            load:      set_param_blocking('state', blob) ; requestLabelSync()
            ui:        read sets/<new>/ui-state.json → applyUiState | defaults
            commit:    currentSetUuid = new ; rememberSet ; dirty = false
```

## Edge cases

- `active_set.txt` missing/empty → UUID `''` → `_default` paths; movy still
  works (tests, off-device).
- Same UUID on poll → no-op.
- `host_ensure_dir` / `host_file_exists` absent → guarded fallbacks.
- Switch with unsaved edits in the last poll window: the switch's save-old step
  captures them; periodic autosave (~3 s) bounds any non-switch loss, same as
  today.

## Testing

- **`browser-test/logic.mjs`** (mock host FS + mock engine recording `state`
  get/set): `stripCopySuffix`; `findInheritCandidates` ordering/validation;
  `switchToSet` save-then-load ordering; blank-on-unknown-UUID; inherit-on-copy
  seeds + loads parent; name-index updated on switch; UI-state apply/default.
- **`browser-test/app-loop.mjs`**: boot with one `active_set.txt`, mutate it,
  tick, assert the engine received a fresh `state` load for the new UUID.
- **Screenshot/perf**: no new rendering — unaffected. Run to confirm no
  regression.
- **Device (`scripts/test-seq.sh`)**: native set-switching can't be automated;
  the suite stays as-is for transport/step/record/persistence. Note the
  per-set path change in the suite if it hard-codes `seq-state.json`.

## Out of scope (YAGNI)

- davebox's modal inherit-picker (auto-pick replaces it).
- Snapshots / save-state browser.
- Old-singleton migration (BC break accepted).
