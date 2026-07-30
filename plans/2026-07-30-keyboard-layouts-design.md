# Scales & Keyboard Layouts — design

Date: 2026-07-30

Adds selectable pad **layouts** (chromatic fourths / piano / in-key fourths /
in-key inline), moves the chromatic root to the 4th pad of the bottom row, and
makes the **octave per-track** and persistent across device restarts.

---

## 1. Problem

Today the melodic pad grid is hardcoded to a single chromatic fretboard
(`src/seq/pads.ts`): `+1` semitone per column, `+5` per row, root at
bottom-left. `keyboardState` holds one global `rootNote` that is *simultaneously*
the musical tonic and the pitch of the bottom-left pad. The `scale` setting only
tints LEDs — it never folds the layout.

Three consequences:

- No way to play strictly in-key, and no piano-shaped layout.
- No pads below the root, because the root is pinned to bottom-left.
- All four tracks share one octave, so switching tracks to a bass part means
  re-shifting the octave every time.

Splitting `rootNote` is required regardless of the other features: once the root
moves to column 4, the bottom-left pad is no longer the tonic, so "layout origin"
and "tonic" can no longer be one number.

## 2. State model

`src/keyboard/state.ts`:

```ts
export const keyboardState = {
    rootPc: 0,               // 0..11 tonic pitch class           (global)
    scale:  0,               // index into SCALES                 (global)
    mode:   0,               // 0 Chromatic | 1 In Key            (global)
    layout: 0,               // index into the mode's layout list (global)
    octave: [4, 4, 4, 4],    // per-track, 0..8                   (PER-TRACK)
    lastPlayedNote: 60,
};
```

`baseNoteFor(track) = octave[track] * 12 + rootPc`. The default `4 * 12 + 0 = 48`
(C3) matches today's `rootNote` default exactly, so a fresh set behaves as before
apart from the deliberate column-4 shift.

Only the octave is per-track. Tonic, scale, mode and layout stay global, matching
where `ROOT`/`KEY` already live.

## 3. New module: `src/keyboard/layouts.ts`

Single source of truth for pad → pitch:

```ts
buildPadMap(mode, layout, scale, baseNote): Int16Array   // length 32
```

Index = `padNote - PAD_MIN` (0..31, 8 cols × 4 rows, row 0 = bottom).
Value = MIDI pitch, or `-1` for a dead pad (piano gap, or pitch outside 0..127).

Everything downstream — note-on, LED colour, step-hold overlay — reads this
array. Note-**off** continues to come from the held-notes ledger, so changing
layout mid-hold cannot strand a note.

### Mapping table

| mode | layout | mapping (`row` 0 = bottom, `col` 0 = left) | root sits at |
|---|---|---|---|
| Chromatic | Fourths | `base + row*5 + col - 3` | bottom row, **col 4** |
| Chromatic | Piano | see below | bottom-left |
| In Key | Fourths | degree `row*3 + col` | bottom-left |
| In Key | Inline | degree `row*len + col` | bottom-left |

`len` = the selected scale's degree count. Degree → pitch:

```ts
degreeToPitch(base, degrees, i) =
    base + Math.floor(i / len) * 12 + degrees[((i % len) + len) % len]
```

This makes pentatonics and the 12-degree Chromatic scale work in In Key mode
without special-casing. **Confirmed:** In Key + Inline uses the scale's own
degree count as the row step, so a pentatonic gives 5-per-row with a slight
overlap between rows rather than a forced 7.

### Piano

```
WHITE = [0, 2, 4, 5, 7, 9, 11, 12]        // C D E F G A B C
BLACK = [-1, 1, 3, -1, 6, 8, 10, -1]      // .  C# D# .  F# G# A# .
pair    = row >> 1                        // rows 0-1 = octave 0, rows 2-3 = octave 1
isBlack = (row & 1) === 1
offset  = isBlack ? BLACK[col] : WHITE[col]
pitch   = offset < 0 ? -1 : base + pair * 12 + offset
```

Black keys sit above the white note they lead *into* (C# above D), matching the
sketched layout. Cols 0, 3 and 7 of each black row are dead — unlit and silent.
Two octaves on the grid.

```
row3  .  C# D# .  F# G# A# .
row2  C  D  E  F  G  A  B  C     (+1 octave)
row1  .  C# D# .  F# G# A# .
row0 [C] D  E  F  G  A  B  C
```

### Caching

The map is rebuilt only when `(track, mode, layout, scale, baseNote)` changes —
a one-entry cache in `padMapFor(track)`. This is a net perf **win**: today
`chromaticPitch()` does 32 div/mod every tick in the LED loop; after this it is
32 array reads.

## 4. Pad colouring

Extends `chromaticPadColor` rather than replacing it. In priority order:

1. dead pad (`-1`) → `C_BLACK`
2. sounding (held or sequencer-active) → `C_GREEN`
3. in the hold-overlay / last-held set → `C_WHITE`
4. pitch class == `rootPc` → `trackColor(track)`
5. in scale → `C_LIGHTGREY`, **except** piano black keys → `C_DARKGREY`
6. otherwise → `C_BLACK`

Rule 5's piano exception is what makes the keyboard shape read at a glance.

**Confirmed:** piano ignores `KEY` for *layout* but still honours it for
*colouring* — out-of-scale pads stay unlit, so selecting the Chromatic scale
lights the whole keyboard.

In In Key mode every pad is in scale, so the grid reads as roots in track colour
over a light-grey field.

## 5. SET PARAMETERS page

Rearranged so the four musical params share the bottom row:

```
 TEMPO   SWING    LINK      —
  120     50%     OFF

  ROOT    KEY     MODE    LAYOUT
   C     Major   In Key   Fourths
```

Knob mapping: 0 TEMPO, 1 SWING, 2 LINK, 3 unused, 4 ROOT, 5 KEY, 6 MODE,
7 LAYOUT.

- `MODE` — long enum: `Chromatic`, `In Key`.
- `LAYOUT` — long enum whose options follow mode: `Fourths | Piano` when
  Chromatic, `Fourths | Inline` when In Key. There is no Inline for Chromatic.
  Both lists are length 2, so the layout index carries over cleanly on a mode
  flip and needs no clamping beyond `min(idx, len-1)`.
- `ROOT` keeps its current feel: cycles the pitch class, wrapping B↔C.
- `+` / `−` buttons call `changeOctave(activeSlot, ±1)`, clamped 0..8 — **active
  track only**. Still disabled on drum tracks.

`mainPageState` replaces the single-purpose `scaleOverlay: boolean` /
`scaleSel: number` pair with a generic `overlayKnob: number` (−1 = closed) and
`overlaySel: number`, since three knobs now open a scrollable enum overlay. The
`accum` array grows from 5 to 8 entries.

## 6. Persistence & migration

`serializeUiState()` grows to:

```json
{ "root": 48, "rootPc": 0, "scale": 0, "mode": 0, "layout": 0,
  "oct": [4, 4, 4, 4], "mutes": … }
```

`root` is retained as `octave[0] * 12 + rootPc` so an older build reading a newer
file still lands somewhere sane.

`applyUiState()` migration path — no version field needed:

- `oct` present → use `oct` and `rootPc` directly (clamped).
- `oct` absent (legacy blob) → `rootPc = root % 12`, all four octaves =
  `floor(root / 12)`.
- `mode` / `layout` absent → 0 / 0 (Chromatic + Fourths).

State is already stored per-set on disk (`set-context.ts`), so per-track octave
survives a device restart for free.

## 7. Files touched

| file | change |
|---|---|
| `src/keyboard/layouts.ts` | **new** — `buildPadMap`, `degreeToPitch`, layout metadata/names |
| `src/keyboard/state.ts` | new shape, `baseNoteFor(track)`, `padMapFor(track)` cache |
| `src/keyboard/handler.ts` | `noteOn`/`noteOff` via pad map; `setRootPc`, `changeOctave` replace `setRoot`/`changeRoot` |
| `src/keyboard/drum-handler.ts` | drop the unused `rootNote` param |
| `src/keyboard/leds.ts` | drop the unused `rootNote` param |
| `src/seq/pads.ts` | `chromaticPitch`/`chromaticPadColor` read the pad map |
| `src/app/tick.ts` | pass track; use pad map in both LED loops |
| `src/app/init.ts` | reset the new fields |
| `src/midi/router.ts` | `+`/`−` → `changeOctave(activeSlot, ±1)`; drum call-site arg drop |
| `src/seq/main-page.ts` | knob remap, generic overlay, MODE/LAYOUT handling |
| `src/seq/main-page-vm.ts` | new cells + row rearrangement |
| `src/seq/persist.ts` | serialize / apply / reset + legacy migration |
| `src/renderer/keys-view.ts` | takes `baseNoteFor(activeSlot)` |

All new/edited files stay under the 200-line hard limit; `layouts.ts` is ~100.

## 8. Tests

- **`browser-test/logic.mjs`** — exact expected pitch grids for all four layouts
  in C major, C minor and minor-pentatonic; root position per layout; piano dead
  pads at cols 0/3/7; degree wrap across octaves; octave clamp at 0 and 8;
  per-track octave isolation; persist round-trip **including a legacy
  `{root:48}` blob**.
- **`browser-test/app-loop.mjs`** — a pad press in each layout emits the correct
  note-on; `+` shifts only the active track's octave.
- **`browser-test/screenshot.mjs`** — SET PARAMETERS with the rearranged rows and
  the two new cells, plus the MODE and LAYOUT overlays open. New baselines.
- **`browser-test/perf.mjs`** — assert the pad map is rebuilt only on change, not
  per tick, and that the LED-loop `setLED` count does not regress.
- **No new device script.** Per the cheapest-level rule, the suites above
  reproduce every behaviour here; `test.sh` and `test-seq.sh` still run unchanged
  as integration cover.

Each new test is proven to have teeth by removing the corresponding change and
watching it fail.

## 9. Docs

- `MANUAL.md` — new "Layouts" section under the keyboard chapter, plus rows in
  the Controls reference for MODE, LAYOUT and the now per-track `+`/`−`.
- `README.md` — one headline bullet with a screenshot from the new baseline.
- `CHANGELOG.md` — entry.

## 10. Out of scope

- Per-track mode/layout/scale (global, as decided).
- Any change to how the sequencer stores or transposes notes — layouts only
  change which pitch a pad produces.
- The Keys view footer hint text (`L/R:oct U/D:semi`), which is already stale.
