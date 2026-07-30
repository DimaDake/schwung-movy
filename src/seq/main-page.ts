/* Main Parameters page: a global sequencer settings view opened with
 * Shift+Step 5/7/9 and exited with Back. Row 0 is TEMPO / SWING / LINK, row 1
 * the four musical params ROOT / KEY / MODE / LAYOUT.
 * Mirrors the step-parameter page's structure; rendering reads main-page-vm. */

import { seqState } from './state.js';
import { seqCmd } from './engine.js';
import { scheduleTempoOverride } from './tempo-override.js';
import { SCALE_NAMES } from './scales.js';
import { MODE_NAMES, layoutNames } from '../keyboard/layouts.js';
import { keyboardState } from '../keyboard/state.js';
import { setRootPc } from '../keyboard/handler.js';
import { countDetents } from './detent.js';
import { markUiStateDirty } from './ui-dirty.js';

const BPM_MIN_X100 = 2000, BPM_MAX_X100 = 30000;
const SWING_MIN = 50, SWING_MAX = 80;

/* Knob map: 0 TEMPO, 1 SWING, 2 LINK, 3 unused, 4 ROOT, 5 KEY, 6 MODE,
 * 7 LAYOUT — the four musical params share the bottom row. */
const K_TEMPO = 0, K_SWING = 1, K_LINK = 2, K_ROOT = 4, K_KEY = 5, K_MODE = 6, K_LAYOUT = 7;
const OVERLAY_KNOBS = [K_KEY, K_MODE, K_LAYOUT];

export const mainPageState = {
    active: false,
    origin: 0,                          // view to restore on Back
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

function overlayCommit(k: number, sel: number): void {
    if (k === K_KEY) keyboardState.scale = sel;
    else if (k === K_MODE) {
        keyboardState.mode = sel;
        // Chromatic and In Key both offer two layouts, so the index carries
        // over; the clamp is here so adding a third option later can't strand it.
        keyboardState.layout = Math.min(keyboardState.layout, layoutNames(sel).length - 1);
    } else keyboardState.layout = sel;
    markUiStateDirty();
}

export function mainPageActive(): boolean { return mainPageState.active; }

export function openMainPage(origin: number): void {
    mainPageState.active = true;
    mainPageState.origin = origin;
    mainPageState.touchedKnob = -1;
    mainPageState.overlayKnob = -1;
    accum.fill(0);
}

/** Close the page; returns the origin view the caller should restore. */
export function closeMainPage(): number {
    mainPageState.active = false;
    mainPageState.touchedKnob = -1;
    mainPageState.overlayKnob = -1;
    return mainPageState.origin;
}

export function mainPageTouch(k: number, down: boolean): void {
    mainPageState.touchedKnob = down ? k : -1;
    if (down && OVERLAY_KNOBS.indexOf(k) >= 0) {
        mainPageState.overlayKnob = k;
        mainPageState.overlaySel = overlayCurrent(k);
        accum[k] = 0;
    }
}

export function mainPageRelease(k: number): void {
    if (mainPageState.overlayKnob === k) {
        overlayCommit(k, mainPageState.overlaySel);
        mainPageState.overlayKnob = -1;
    }
    if (mainPageState.touchedKnob === k) mainPageState.touchedKnob = -1;
}

export function mainPageKnob(k: number, delta: number): void {
    mainPageState.touchedKnob = k;
    const n = countDetents(accum, k, delta);
    if (n === 0) return;
    if (k === K_TEMPO) {
        const next = Math.max(BPM_MIN_X100, Math.min(BPM_MAX_X100, seqState.bpmX100 + n * 100));
        if (next !== seqState.bpmX100) {
            seqState.bpmX100 = next;
            seqCmd('bpm ' + next);
            // Also drive Move's device-wide tempo via the Link override, so a
            // following Move tracks the knob (design §7 Phase 3).
            scheduleTempoOverride(next);
        }
    } else if (k === K_SWING) {
        const next = Math.max(SWING_MIN, Math.min(SWING_MAX, seqState.swingPct + n));
        if (next !== seqState.swingPct) { seqState.swingPct = next; seqCmd('swing ' + next); }
    } else if (k === K_LINK) {
        // LINK toggle: turn right = ON, left = OFF. Persisted per set.
        const on = n > 0;
        if (on !== seqState.linkEnabled) {
            seqState.linkEnabled = on;
            seqCmd('link ' + (on ? 1 : 0));
            markUiStateDirty();
        }
    } else if (k === K_ROOT) {
        // Cycles the pitch class, wrapping B↔C; the +/- buttons own the octave.
        setRootPc(keyboardState.rootPc + n);
    } else if (mainPageState.overlayKnob === k) {
        const max = overlayOptions(k).length - 1;
        mainPageState.overlaySel = Math.max(0, Math.min(max, mainPageState.overlaySel + n));
    }
}

export function resetMainPage(): void {
    mainPageState.active = false;
    mainPageState.origin = 0;
    mainPageState.touchedKnob = -1;
    mainPageState.overlayKnob = -1;
    mainPageState.overlaySel = 0;
    accum.fill(0);
}
