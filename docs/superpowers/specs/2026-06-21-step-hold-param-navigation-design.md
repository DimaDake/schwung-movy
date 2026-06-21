# Step-hold parameter navigation (2026-06-21)

## Goal

Let the user hold a single step and automate parameters **across param pages and
across chain modules**, by turning the held-step gesture into a "navigation
mode": jog wheel, jog-press and Back navigate params/modules instead of editing
note length or opening the module browser. Reaching the 8-lane cap hides the
other knobs and shows the limit toast immediately.

The held-step / step-automation state (`stepAutoMode`, `holdStep`, the lane
registry, `heldLocks`) already persists across page/chain/module changes — these
are purely **input-routing** changes.

## Behaviour while a step is held

| Control | While a step is held | When no step is held (unchanged) |
|---|---|---|
| Jog turn (VIEW_KNOBS) | switch param page (`changePage`) | switch param page |
| Jog turn (VIEW_CHAIN) | switch chain slot | switch chain slot |
| Jog press (VIEW_CHAIN) | drill into the focused module's params (→ VIEW_KNOBS); **never** the module browser (ignore empty/Shift branch) | open params, or browser on empty/Shift |
| Jog press (VIEW_KNOBS) | no-op (browser suppressed) | open module browser |
| Back | VIEW_KNOBS/KEYS → VIEW_CHAIN (already works) | same |

Note-length editing on the jog wheel is **removed entirely** (decision: drop it;
velocity stays on the Volume encoder, transpose on +/−, nudge on ←/→). Loop-mode
wheel-resize (Loop button held) is untouched.

## Changes

1. **`seq/router.ts`** — drop the `editLength(...)` call from the `CC_WHEEL`
   handler so the wheel is not consumed while a step is held; it falls through to
   the normal jog handler in `midi/router.ts`. Remove the now-unused `editLength`
   (and its `elen` emission) from `seq/step-edit.ts`. Keep `loopHeld → loopWheel`.

2. **`midi/router.ts`** — in the jog-click handler, when `anyStepHeld()`:
   - `VIEW_CHAIN` → set `currentView = VIEW_KNOBS` (drill in), skip all browser /
     file-browser logic;
   - `VIEW_KNOBS` → no-op.
   Normal (no step held) path is unchanged.

3. **Limit feedback** — already driven by the live `poolIsFull(track)`: when the
   8th lane is assigned, `hiddenDuringHold` hides non-assigned knobs and
   `renderKnobsView` shows "8 AUTOMATION LANES — FULL" on the same render. No new
   logic; add a test asserting the toast (not just hiding) appears at exactly 8.

## Cross-module note

Lanes are per-track (8-lane pool shared across the track's components). Holding
one step and automating `synth:*` then `fx1:*` params fills the same pool — by
design.

## Tests

- **logic/app-loop:** jog-while-held in VIEW_KNOBS calls `changePage` (no `elen`
  emitted); jog-press while held in VIEW_CHAIN switches to VIEW_KNOBS and never
  calls `openBrowser`; jog-press while held in VIEW_KNOBS is a no-op; Back while
  held → VIEW_CHAIN; the limit toast flag is set the moment the 8th lane assigns.
- **Device:** hold a step, jog across pages, drill into a second module, automate
  several params, confirm the cap hides knobs + shows the toast.

## Out of scope

←/→ remain nudge while a step is held (jog is the page-switcher). Re-homing
note-length editing to another control (can revisit if missed).
