# Movy Step 5 — Enum Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Long-pressing an enum knob opens a full-screen scrollable option list. Turning the knob scrolls through options (live value update). Releasing closes the overlay.

**Architecture:** Same as Step 4 — all device logic inlined in `ui.js`; `view/model.mjs` and `view/renderer.mjs` are canonical for browser tests and must mirror changes. The ViewModel gains an `overlay` field. The model gains `longPressCountdown` and `enumOverlay` state. No new files.

**Tech Stack:** QuickJS (device), `fill_rect`/`fontPrint` pixel drawing, same tick-rate (~344 ticks/s) used for the long-press timer.

---

## Display geometry

Long-press overlay replaces entire screen content (keeps normal header):
```
y= 0..7   Header (inverted): param full name left | current option value right
y= 8..63  Scrollable option list — 8 rows × 7px (FONT_HEIGHT=5 + 2px pad)
           Selected row: inverted rect + text
           Other rows: normal text
           Right edge: 1px scrollbar column (optional, if >8 options)
```

Visible window: 8 rows. Scroll so selected is always in view (center when possible).

---

## State additions

```javascript
const LONG_PRESS_TICKS = 172;   // ~0.5 s at 344 ticks/s

let longPressCountdown = -1;    // -1 = inactive
let enumOverlay = null;         // null | {slot, gi, options, selected}
```

---

## Task 1 — Model changes in `ui.js`

**Files:** Modify `ui.js`

- [x] **Step 1.1: Add constants and state variables**

After the existing `KNOB_REFRESH_TICKS = 69;` line, add:
```javascript
const LONG_PRESS_TICKS   = 172;   // ~0.5 s
```

After `let touchedSlot = -1;`, add:
```javascript
let longPressCountdown = -1;
let enumOverlay = null;
```

- [x] **Step 1.2: Update `handleKnobTouch` to start long-press timer for enum params**

Replace existing `handleKnobTouch`:
```javascript
handleKnobTouch(k) {
    if (enumOverlay) { enumOverlay = null; dirty = true; }
    if (touchedSlot !== k) { touchedSlot = k; dirty = true; }
    const gi = knobPage * KNOBS_PER_PAGE + k;
    const p  = knobParams[gi];
    longPressCountdown = (p && p.type === 'enum' && p.options && p.options.length)
        ? LONG_PRESS_TICKS : -1;
},
```

- [x] **Step 1.3: Update `handleKnobDelta` to route through overlay when open**

Replace existing `handleKnobDelta`:
```javascript
handleKnobDelta(k, delta) {
    if (enumOverlay && k === enumOverlay.slot) {
        const next = Math.max(0, Math.min(enumOverlay.options.length - 1,
                                          enumOverlay.selected + delta));
        if (next !== enumOverlay.selected) {
            enumOverlay.selected = next;
            knobValues[enumOverlay.gi] = next;
            dirty = true;
        }
        return;
    }
    longPressCountdown = -1;   // turning cancels long-press
    pendingDeltas[k] += delta;
    if (touchedSlot !== k) { touchedSlot = k; dirty = true; }
},
```

- [x] **Step 1.4: Update `handleKnobRelease` to confirm and close overlay**

Replace existing `handleKnobRelease`:
```javascript
handleKnobRelease() {
    if (enumOverlay) {
        /* Confirm: write selected value to device */
        const p = knobParams[enumOverlay.gi];
        if (p) {
            knobValues[enumOverlay.gi] = enumOverlay.selected;
            shadow_set_param(activeSlot, "synth:" + p.key,
                             String(enumOverlay.selected));
        }
        enumOverlay = null;
        dirty = true;
    }
    if (touchedSlot >= 0) { touchedSlot = -1; dirty = true; }
    longPressCountdown = -1;
},
```

- [x] **Step 1.5: Add long-press timer to `tick()`**

Inside `tick()`, right before `const wasDirty = dirty;`, add:
```javascript
if (longPressCountdown > 0) {
    longPressCountdown--;
    if (longPressCountdown === 0) {
        const k  = touchedSlot;
        if (k >= 0) {
            const gi = knobPage * KNOBS_PER_PAGE + k;
            const p  = knobParams[gi];
            if (p && p.type === 'enum' && p.options) {
                enumOverlay = {
                    slot:     k,
                    gi,
                    options:  p.options,
                    selected: Math.round(knobValues[gi] ?? 0),
                };
                dirty = true;
            }
        }
        longPressCountdown = -1;
    }
}
```

- [x] **Step 1.6: Add `overlay` to `getViewModel()` return**

Replace the `return {` block in `getViewModel`:
```javascript
return {
    moduleName:  activeModuleName,
    bankName,
    bankIndex:   knobPage,
    bankCount:   nBanks,
    rows,
    touchedSlot: touchedSlot >= 0 ? touchedSlot : null,
    toast,
    overlay:     enumOverlay
        ? { slot: enumOverlay.slot, options: enumOverlay.options, selected: enumOverlay.selected }
        : null,
};
```

---

## Task 2 — Renderer: draw overlay in `ui.js`

**Files:** Modify `ui.js`

- [x] **Step 2.1: Add `_drawEnumOverlay` function before `renderKnobsView`**

```javascript
function _drawEnumOverlay(vm) {
    const ov = vm.overlay;
    const p  = /* get param label from rows */ (() => {
        const row = Math.floor(ov.slot / 4);
        const col = ov.slot % 4;
        return vm.rows[row] && vm.rows[row][col] ? vm.rows[row][col] : null;
    })();
    const fullName  = p ? p.fullName  : "";
    const valueStr  = ov.options[ov.selected] || String(ov.selected);

    clear_screen();
    _drawInvertedHeader(fullName, valueStr);

    const LIST_TOP = 8;
    const ROW_H    = 7;
    const VISIBLE  = Math.floor((64 - LIST_TOP) / ROW_H);   /* 8 rows */
    const n        = ov.options.length;
    const half     = Math.floor(VISIBLE / 2);
    const start    = Math.max(0, Math.min(ov.selected - half, n - VISIBLE));

    for (let i = 0; i < VISIBLE; i++) {
        const idx = start + i;
        if (idx >= n) break;
        const y = LIST_TOP + i * ROW_H;
        if (idx === ov.selected) {
            fill_rect(0, y, _W, ROW_H, 1);
            fontPrint(2, y + 1, ov.options[idx], 0);
        } else {
            fontPrint(2, y + 1, ov.options[idx], 1);
        }
    }

    /* Scrollbar: 1px wide on right edge when list overflows */
    if (n > VISIBLE) {
        const trackH = 64 - LIST_TOP;
        const thumbH = Math.max(3, Math.round(trackH * VISIBLE / n));
        const thumbY = LIST_TOP + Math.round((trackH - thumbH) * start / Math.max(1, n - VISIBLE));
        fill_rect(_W - 1, LIST_TOP, 1, trackH, 1);
        fill_rect(_W - 1, thumbY,   1, thumbH, 0);
    }
}
```

- [x] **Step 2.2: Update `renderKnobsView` to dispatch to overlay**

At the top of `renderKnobsView(vm)`, before `clear_screen()`:
```javascript
export function renderKnobsView(vm) {
    if (vm.overlay) { _drawEnumOverlay(vm); return; }
    clear_screen();
    /* ... rest unchanged ... */
```

---

## Task 3 — Sync to `view/renderer.mjs` and `view/model.mjs`

Apply identical changes (same logic, same names with/without underscore prefix per each file's convention).

- [x] **Step 3.1: `view/model.mjs`** — same as Task 1 changes (uses `formatValue` not `_formatValue`, no `mlog` in browser version... actually model.mjs does have `mlog`)

- [x] **Step 3.2: `view/renderer.mjs`** — same as Task 2 changes (uses `W` not `_W`, `drawInvertedHeader` not `_drawInvertedHeader`)

---

## Task 4 — Regenerate baselines and run tests

- [x] **Step 4.1: Regenerate baselines**
```bash
node browser-test/screenshot.mjs --update
```
Expected: 5 passed, 0 failed. Baselines regenerated (overlay not visible in static snapshots since no touch is simulated).

- [x] **Step 4.2: Run device test**
```bash
./scripts/test.sh
```
Expected: ALL CHECKS PASSED (overlay is triggered by touch, not by CC, so automated test is unaffected).

---

## Verification (manual, on hardware)

1. Open Movy with Plaits loaded
2. Touch and hold the Engine (enum) knob for ~0.5 s without turning
3. Screen shows full-screen list: "Engine" header, all 24 engine options, current selected inverted
4. Turn knob → list scrolls, selection moves, device value updates live
5. Release knob → overlay closes, normal knob view returns, value persists
6. Touch and immediately turn a float knob → no overlay (long-press cancelled)
7. While overlay open, touch a different knob → overlay closes immediately

---

## Remaining roadmap

| Step | What |
|------|------|
| 6 | Group widgets — filter (cut+res) and envelope (ADSR) |
| 7 | LEDs — row-2 amber, row-1 white |
| 8 | Jog click → module selector |
