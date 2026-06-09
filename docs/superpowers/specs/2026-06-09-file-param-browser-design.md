# File Parameter Browser — Design Spec

**Date:** 2026-06-09
**Scope:** movy — generic wav/file selection for any Schwung synth that exposes `type: "filepath"` in `chain_params`

---

## Overview

Synths expose file parameters via Schwung's `chain_params` mechanism (`type: "filepath"`). Movy currently ignores these. This feature adds:

1. A **file knob** on parameter pages that renders like an enum (shows current filename).
2. A **quick overlay** on touch: files from the current directory, selectable by rotating the knob, committed on release.
3. A **toast** (`"JOG: BROWSE"`) visible whenever a file knob is touched.
4. A **full-screen file browser** opened by jog-click while the knob is touched: directory navigation via a `".."` top item, jog rotation scrolls, jog click enters a dir or selects a file, Back exits without committing.

---

## 1. Types

### `KnobParam` (`src/types/param.ts`)

Add `'file'` to the type union. Add optional file metadata fields:

```typescript
type: 'float' | 'int' | 'enum' | 'file'

fileRoot?:      string    // root constraint; browsing cannot go above this
fileFilter?:    string[]  // extension filter e.g. ['.wav', '.aif']
fileStartPath?: string    // initial directory when current value is empty
```

`min`, `max`, `step` are `0` for file params and carry no meaning.

### `ModelState` (`src/model/state.ts`)

Two additions, kept strictly separate from the existing enum overlay:

```typescript
fileValues:  (string | null)[]  // parallel to knobValues; populated only for 'file' params
fileOverlay: FileOverlay | null // never active simultaneously with enumOverlay
```

```typescript
export interface FileOverlay {
    slot:     number    // physical knob slot (0–7)
    gi:       number    // global knob index
    items:    string[]  // absolute paths from dir scan, filtered + sorted
    selected: number    // index into items
    original: string    // path at touch time (unused at runtime, useful for future cancel)
    accum:    number    // fractional delta accumulator (same pattern as enum)
}
```

`enumOverlay` and `fileOverlay` are mutually exclusive in `ModelState`. `handleKnobTouch` clears whichever is active before opening the new one.

### `ViewModel` (`src/types/viewmodel.ts`)

`OverlayState` shape is **unchanged** — both enum and file overlays produce identical output consumed by the existing renderer:

```typescript
export interface OverlayState {
    slot:     number
    options:  string[]   // basenames (≤12 chars) for file overlay; option labels for enum
    selected: number
}
```

`ToastState` gains one flag:

```typescript
export interface ToastState {
    fullName:   string
    value:      string
    browseHint: boolean  // true → render "JOG: BROWSE" footer toast alongside header toast
}
```

---

## 2. Detection (`src/model/hierarchy.ts`)

In both the generic chain_params path and the custom config path, detect `type === 'filepath'` before the normal numeric KnobParam construction and redirect to a file param:

```typescript
if (type === 'filepath') {
    s.knobParams.push({
        key, label, shortLabel: null,
        type: 'file',
        min: 0, max: 0, step: 0,
        options: null,
        renderStyle: 'arc',
        fileRoot:      cp.root       ?? '/data/UserData',
        fileFilter:    parseFilter(cp.filter),  // string[]
        fileStartPath: cp.start_path ?? cp.root ?? '/data/UserData',
    });
    // push null into fileValues at this index
    continue;
}
```

`fileValues` is initialised to `new Array(s.knobParams.length).fill(null)` at the end of `loadHierarchy`, same as `knobValues`.

---

## 3. Value handling (`src/model/store.ts`)

### `refreshOneParam`

For `type === 'file'`: read raw string from `shadow_get_param`, store in `fileValues[i]`. Skip `parseFloat`. Mark dirty on change.

### `applyKnobDelta`

For `type === 'file'`: early return — rotation is handled through `fileOverlay` in `model/index.ts`.

### `formatValue`

For `type === 'file'`: return `'...'` (display value is produced directly in the viewmodel from `fileValues`, not via `formatValue`).

---

## 4. Touch / release behaviour (`src/model/index.ts`)

### `handleKnobTouch(k)` for `type === 'file'`

1. Dismiss any active `enumOverlay` or `fileOverlay`.
2. Add `k` to `touchedSlots` (existing logic).
3. Read `currentPath = fileValues[gi] ?? ''`.
4. Resolve `scanDir`: `dirname(currentPath)` if `currentPath` is non-empty and the dir exists; else `fileStartPath`.
5. Scan `scanDir` via `os.readdir`; filter by `fileFilter`; sort alphabetically.
6. Find `selected` = index of `currentPath` in results (or `0`).
7. Set `s.fileOverlay = { slot: k, gi, items, selected, original: currentPath, accum: 0 }`.
8. If scan fails or yields zero items: set `fileOverlay = null` (toast still shows `browseHint: true` via touched state).

### `handleKnobDelta(k)` when `fileOverlay` is active for slot `k`

Accumulate delta; integer steps move `fileOverlay.selected` (clamped to `0…items.length-1`). Same accumulator pattern as enum overlay.

### `handleKnobRelease(k)` when `fileOverlay` is active

1. Commit: `shadow_set_param(slot, componentKey + ':' + key, items[selected])`.
2. Update `fileValues[gi] = items[selected]`.
3. Dismiss: `fileOverlay = null`.
4. Remove `k` from `touchedSlots` (existing logic).

---

## 5. ViewModel mapping (`src/model/viewmodel.ts`)

The separation-of-concerns boundary: both overlay types produce an identical `OverlayState`; the renderer never knows which triggered it.

```typescript
const enumOv = s.enumOverlay
    ? { slot: s.enumOverlay.slot, options: s.enumOverlay.options, selected: s.enumOverlay.selected }
    : null;

const fileOv = s.fileOverlay
    ? {
        slot:     s.fileOverlay.slot,
        options:  s.fileOverlay.items.map(p => basename(p).slice(0, 12)),
        selected: s.fileOverlay.selected,
      }
    : null;

overlay: enumOv ?? fileOv
```

**Display value for file knobs** (used in the knob grid and header toast):

```typescript
const dv = p.type === 'file'
    ? (s.fileValues[gi] ? basename(s.fileValues[gi]) : '—')
    : /* existing formatValue / nameKey logic */;
```

**Toast**: when the primary touched param is `type === 'file'`:
```typescript
toast = { fullName: p.label, value: dv, browseHint: true };
```
`browseHint` is `false` for all non-file params (including when `jogTouched` is true for module swap).

---

## 6. Rendering

### `drawEnumOverlay` (`src/renderer/overlay.ts`)

**No changes.** It already renders any `OverlayState` — identical output for both enum and file overlays.

### `renderKnobsView` (`src/renderer/knob-view.ts`)

Add one branch for `browseHint`:

```typescript
if (vm.toast?.browseHint) drawJogToast('JOG: BROWSE');
else if (jogTouched)       drawJogToast('CLICK JOG: SWAP MODULE');
```

The browse-hint toast takes priority over the swap-module toast. Both are drawn *after* the knob rows, at the bottom of the screen using the existing `drawJogToast` helper.

### File knob in the knob grid

`ParamVM.type === 'file'` — rendered identically to `'enum'`: arc knob with display value (basename). No special visual treatment needed; the overlay and toast provide all the affordance.

---

## 7. Full-screen file browser

### New view constant

```typescript
export const VIEW_FILE_BROWSE = 4;   // src/app/state.ts
```

### `fileBrowserState` (`src/app/state.ts`)

Added to `appState`:

```typescript
fileBrowserState: {
    paramSlot:    number
    componentKey: string
    paramKey:     string
    gi:           number    // global knob index — for updating fileValues on commit
    root:         string
    filter:       string[]
    currentDir:   string
    items:        FileBrowserItem[]
    selectedIndex: number
} | null
```

```typescript
interface FileBrowserItem {
    name:  string
    path:  string
    isDir: boolean
}
```

### Opening the browser (`src/midi/router.ts`)

Jog click in `VIEW_KNOBS`:

```
if primaryTouchedParam.type === 'file':
    openFileBrowser(...)
    appState.browseOrigin = VIEW_KNOBS
else:
    existing module browser path (openBrowser)
```

`openFileBrowser` clears any active `fileOverlay` on the model, scans the param's current directory (same logic as `handleKnobTouch` dir resolution), builds `fileBrowserState`, transitions to `VIEW_FILE_BROWSE`.

### Controls in `VIEW_FILE_BROWSE`

| Input | Action |
|---|---|
| Jog rotation | Scroll `selectedIndex` |
| Jog click — `".."` item | `currentDir = dirname(currentDir)`; rescan; `selectedIndex = 0` |
| Jog click — directory item | `currentDir = item.path`; rescan; `selectedIndex = 0` |
| Jog click — file item | Commit: `shadow_set_param`; update `fileValues[gi]`; return to `browseOrigin` |
| Back | Exit browser; return to `browseOrigin`; **no commit** |

The `".."` item is **omitted** when `currentDir === root` (cannot go above root). It is always the **first item** in the list when present.

### `renderFileBrowseView` (`src/renderer/file-browse-view.ts`)

- **Header**: truncated `currentDir` path (right-aligned bank indicator omitted)
- **List**: `".."` item first (if shown), then dirs (rendered with `>` prefix), then files — same scrollable list pattern as `renderBrowseView`
- **No footer**

---

## 8. Files changed

| File | Change |
|---|---|
| `src/types/param.ts` | Add `'file'` type; add `fileRoot?`, `fileFilter?`, `fileStartPath?` to `KnobParam` and `KnobSlot` |
| `src/types/viewmodel.ts` | Add `browseHint: boolean` to `ToastState` |
| `src/model/state.ts` | Add `FileOverlay` interface; add `fileValues`, `fileOverlay` to `ModelState` and `createModelState` |
| `src/model/hierarchy.ts` | Detect `type: 'filepath'`; build file `KnobParam`; init `fileValues` |
| `src/model/store.ts` | `refreshOneParam` string path for file; `applyKnobDelta` early-return for file; `formatValue` returns `'...'` for file |
| `src/model/index.ts` | `handleKnobTouch` dir-scan → `fileOverlay`; `handleKnobDelta` file accumulator; `handleKnobRelease` commit |
| `src/model/viewmodel.ts` | `fileOv` mapping; file display value from `fileValues`; `browseHint` in toast |
| `src/app/state.ts` | Add `VIEW_FILE_BROWSE = 4`; add `fileBrowserState` to `appState` |
| `src/renderer/knob-view.ts` | `browseHint` → `drawJogToast('JOG: BROWSE')` |
| `src/renderer/file-browse-view.ts` | **New** — header + list, no footer |
| `src/midi/router.ts` | Jog-click dispatches to `openFileBrowser` for file params; `VIEW_FILE_BROWSE` input handling |
| `browser-test/logic.mjs` | New tests for file param detection, overlay behaviour, viewmodel mapping |
