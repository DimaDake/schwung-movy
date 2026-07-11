# Hold-a-knob → assign LFO target — Design

Date: 2026-07-11

Assign a module parameter as an LFO modulation target by holding its knob. Adds
a hold gesture, an assign-mode toast with jog cycling/commit, navigation to the
LFO page on assign, and a `~` indicator on modulated params.

## Gesture

On knob **touch** of an **automatable** (numeric, non-global) module param on the
track chain, start a 500 ms timer (mirrors `src/seq/step-edit.ts` `pressMs` +
`stepAutoTick`). Held that long **without a turn** → enter **assign mode**. The
mode lives only while the knob stays held. Cancelled by: turning that knob,
releasing it, switching track, or Back.

Gated on `KnobParamInfo.automatable` (from `getKnobParamInfo(physK)`), which is
also how we get the held param's `target` (componentKey) and `ioKey` (param key,
pad-scoped for drums).

## Assign mode

Permanent bottom toast (drawn via `drawJogToast` while active):
- shown LFO not modulating this param → `CLICK: MODULATE <LFO1>`
- shown LFO already modulating it → `CLICK: REMOVE <LFO1> MOD`

`<…>` are the cycle arrows. **Jog turn** cycles the shown LFO `LFO1 ↔ LFO2`.
**Jog click**:
- **assign**: blocking writes `lfoN:target`=comp, `lfoN:target_param`=ioKey,
  `lfoN:enabled`=1; then navigate — `trackChainIndex[track] = LFO_CHAIN_INDEX`,
  `currentView = VIEW_CHAIN`, LFO model bank → that LFO (`getKnobPage`/
  `changePage`). Exit mode.
- **remove** (only when that LFO targets *this* param): clear `lfoN:target`/
  `target_param`, `enabled`=0; **stay** on the page; transient toast
  `LFO1 modulation removed`. Exit mode.

An LFO has a single target; a param can be targeted by both LFOs, so cycling to
the other LFO adds a second modulation to the same param.

## Indicator

`ParamVM` gains `modulated: boolean`. `buildViewModel` reads the track's
`lfo1:target`/`lfo1:target_param` and `lfo2:*` once per build and marks each cell
whose `componentKey` + `paramIoKey` matches. `drawLabelCell` draws a small drawn
**tilde `~` (~5×3 px) at the top-left** of the label — the mirror of the
automation dot (top-right). Both coexist; inverted when the cell is touched.
Single `~` regardless of one or two LFOs. Skipped for `master_fx:*` components.

## Files

- New `src/lfo/assign.ts` — pure target helpers (blocking writes):
  `lfoTargetsParam(track, lfoIdx, comp, param): boolean`,
  `assignLfoTarget(track, lfoIdx, comp, param): void`,
  `clearLfoTarget(track, lfoIdx): void`. Reused by the LFO model's commit (DRY).
- New `src/lfo/assign-mode.ts` — gesture state machine:
  `holdTouch(track, physK, info)`, `holdTurnCancel()`, `holdRelease(physK)`,
  `holdTick(): boolean`, `assignActive(): boolean`, `assignCycle(dir)`,
  `assignCommit(): { assigned: boolean; lfoIdx: number } | null`,
  `assignToastText(): string`, `resetAssignMode()`.
- Edit `src/types/viewmodel.ts` (+`modulated`), `src/seq/param-vm.ts` (default),
  `src/model/viewmodel.ts` (detect + set), `src/renderer/label.ts`
  (+`drawWaveMark`, draw on modulated), `src/midi/router.ts` (wire knob
  touch/turn/release + jog turn/click), `src/app/tick.ts` (`holdTick()` + render
  toast + `jogToastShown`), `src/lfo/model.ts` (commit via `assign.ts`),
  `build/browser.mjs` (entry points for the new importable modules).

## Testing

- logic: `assign.ts` assign/clear/targets-param; `assign-mode` (activates only
  after 500 ms hold of an automatable param without a turn; cycle; commit assign
  vs remove; cancel on turn/release); `buildViewModel` sets `modulated`.
- app-loop: hold → toast → jog-click assigns + navigates to the LFO slot; release
  cancels; hold an already-modulated param → remove.
- screenshot: `~` mark on a modulated param; `~` + automation dot together; the
  assign toast.
- device: `./scripts/test.sh` after deploy.

## Non-goals

Master FX and LFO-page params; multiple `~` marks for 2 LFOs; assign for enum /
non-automatable params (they open overlays on touch).
