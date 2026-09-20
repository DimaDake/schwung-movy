/* Main Parameters page: a global sequencer settings view opened with
 * Shift+Step 5/7/9 and exited with Back. Row 0 is TEMPO / SWING / LINK, row 1
 * the four musical params ROOT / KEY / MODE / LAYOUT.
 * Mirrors the step-parameter page's structure; rendering reads main-page-vm.
 * The absolute-value writers (`applyTempoX100` etc, shared with the
 * virtual-component seam's `set()` — SP-53) live in `main-page-apply.ts`,
 * split out to keep this file under the 200-line cap. */

import { appState, VIEW_MAIN_PARAMS } from '../app/state.js';
import { seqState } from './state.js';
import { endEdit } from '../undo/group.js';
import { SCALE_NAMES } from './scales.js';
import { MODE_NAMES, layoutNames } from '../keyboard/layouts.js';
import { keyboardState } from '../keyboard/state.js';
import { countDetents } from './detent.js';
import { quantIndexForPct } from './quant.js';
import { applyTempoX100, applySwing, applyLink, applyDefaultQuantIdx,
         applyRootPc, applyScaleIdx, applyModeIdx, applyLayoutIdx } from './main-page-apply.js';
import { K_TEMPO, K_SWING, K_LINK, K_QUANT, K_ROOT, K_KEY, K_MODE, K_LAYOUT } from './main-page-constants.js';

const OVERLAY_KNOBS = [K_KEY, K_MODE, K_LAYOUT];

/* No `active` flag lives here. Whether this page is up IS
 * `appState.currentView === VIEW_MAIN_PARAMS` — the same thing app/tick.ts
 * renders from. They used to be two fields synced by hand at the open site, and
 * any path that moved currentView without closing the page left this one
 * latched "active". The knob dispatch asks this page first, so a latched flag
 * silently ate every knob turn on every other page — clip length, module params
 * — until movy was reopened. That is the input lock-up users kept reporting. */
export const mainPageState = {
    touchedKnob: -1,                    // 0..7 drives the top toast; -1 none
    overlayKnob: -1,                    // knob whose enum list is open; -1 closed
    overlaySel: 0,                      // highlighted entry while the list is open
};

const accum = [0, 0, 0, 0, 0, 0, 0, 0];

/** Options behind an overlay knob. LAYOUT's list depends on the current mode. */
export function overlayOptions(k: number): string[] {
    if (k === K_KEY) return SCALE_NAMES;
    if (k === K_MODE) return MODE_NAMES;
    return layoutNames(keyboardState.mode);
}

function overlayCurrent(k: number): number {
    if (k === K_KEY) return keyboardState.scale;
    if (k === K_MODE) return keyboardState.mode;
    return Math.min(keyboardState.layout, layoutNames(keyboardState.mode).length - 1);
}

export function mainPageActive(): boolean {
    return appState.currentView === VIEW_MAIN_PARAMS;
}

/** Drop the transient gesture state. The view switch itself belongs to
 *  param-page.ts, which owns the one-level hierarchy the two param pages share
 *  and calls this on every entry to and exit from the layer. */
export function clearMainPage(): void {
    mainPageState.touchedKnob = -1;
    mainPageState.overlayKnob = -1;
    accum.fill(0);
}

/** @param delegated Schwung owns this knob's page (SP-53) — the long-enum
 *  scroll-and-commit-on-release overlay below is movy's OWN dive editor, and
 *  under delegation Schwung's own click-to-list-picker replaces it (SU-4: "the
 *  editor is the host's"). Touch/release bookkeeping (the toast, the undo
 *  boundary) still runs either way. */
export function mainPageTouch(k: number, down: boolean, delegated = false): void {
    mainPageState.touchedKnob = down ? k : -1;
    if (!delegated && down && OVERLAY_KNOBS.indexOf(k) >= 0) {
        mainPageState.overlayKnob = k;
        mainPageState.overlaySel = overlayCurrent(k);
        accum[k] = 0;
    }
}

export function mainPageRelease(k: number, delegated = false): void {
    if (!delegated && mainPageState.overlayKnob === k) {
        if (k === K_KEY) applyScaleIdx(mainPageState.overlaySel);
        else if (k === K_MODE) applyModeIdx(mainPageState.overlaySel);
        else applyLayoutIdx(mainPageState.overlaySel);
        mainPageState.overlayKnob = -1;
    }
    endEdit('mainknob:' + k);
    if (mainPageState.touchedKnob === k) mainPageState.touchedKnob = -1;
}

export function mainPageKnob(k: number, delta: number): void {
    mainPageState.touchedKnob = k;
    const n = countDetents(accum, k, delta);
    if (n === 0) return;
    if (k === K_TEMPO) applyTempoX100(seqState.bpmX100 + n * 100);
    else if (k === K_SWING) applySwing(seqState.swingPct + n);
    else if (k === K_LINK) applyLink(n > 0);   // turn right = ON, left = OFF
    else if (k === K_QUANT) applyDefaultQuantIdx(quantIndexForPct(seqState.defaultQuant) + n);
    else if (k === K_ROOT) applyRootPc(keyboardState.rootPc + n);
    else if (mainPageState.overlayKnob === k) {
        // Scrolling the overlay only moves a selection; the edit happens on
        // release (mainPageRelease), same shape as Clip Params' SCALE.
        const max = overlayOptions(k).length - 1;
        mainPageState.overlaySel = Math.max(0, Math.min(max, mainPageState.overlaySel + n));
    }
}

export function resetMainPage(): void {
    clearMainPage();
    mainPageState.overlaySel = 0;
}
