/* Main Parameters page: a global sequencer settings view (Tempo, Swing, Root,
 * Key) opened with Shift+Step 5/7/9 and exited with Back. Built to host more
 * pages later. Knob 0 tempo, 1 swing, 2 root, 3 key (scrollable scale overlay).
 * Mirrors the step-parameter page's structure; rendering reads main-page-vm. */

import { seqState } from './state.js';
import { seqCmd } from './engine.js';
import { scheduleTempoOverride } from './tempo-override.js';
import { SCALE_NAMES } from './scales.js';
import { keyboardState } from '../keyboard/state.js';
import { setRoot } from '../keyboard/handler.js';
import { countDetents } from './detent.js';
import { markUiStateDirty } from './persist.js';

const BPM_MIN_X100 = 2000, BPM_MAX_X100 = 30000;
const SWING_MIN = 50, SWING_MAX = 80;

export const mainPageState = {
    active: false,
    origin: 0,                          // view to restore on Back
    touchedKnob: -1,                    // 0..3 drives the top toast; -1 none
    scaleOverlay: false,                // Key list open
    scaleSel: 0,                        // highlighted scale while the list is open
};

const accum = [0, 0, 0, 0, 0];   // knobs 0-3 + LINK (knob 4)

export function mainPageActive(): boolean { return mainPageState.active; }

export function openMainPage(origin: number): void {
    mainPageState.active = true;
    mainPageState.origin = origin;
    mainPageState.touchedKnob = -1;
    mainPageState.scaleOverlay = false;
    accum.fill(0);
}

/** Close the page; returns the origin view the caller should restore. */
export function closeMainPage(): number {
    mainPageState.active = false;
    mainPageState.touchedKnob = -1;
    mainPageState.scaleOverlay = false;
    return mainPageState.origin;
}

export function mainPageTouch(k: number, down: boolean): void {
    mainPageState.touchedKnob = down ? k : -1;
    if (k === 3 && down) {
        mainPageState.scaleOverlay = true;
        mainPageState.scaleSel = keyboardState.scale;
        accum[3] = 0;
    }
}

export function mainPageRelease(k: number): void {
    if (k === 3 && mainPageState.scaleOverlay) {
        keyboardState.scale = mainPageState.scaleSel;
        mainPageState.scaleOverlay = false;
        markUiStateDirty();
    }
    if (mainPageState.touchedKnob === k) mainPageState.touchedKnob = -1;
}

export function mainPageKnob(k: number, delta: number, track: number): void {
    mainPageState.touchedKnob = k;
    const n = countDetents(accum, k, delta);
    if (n === 0) return;
    if (k === 0) {
        const next = Math.max(BPM_MIN_X100, Math.min(BPM_MAX_X100, seqState.bpmX100 + n * 100));
        if (next !== seqState.bpmX100) {
            seqState.bpmX100 = next;
            seqCmd('bpm ' + next);
            // Also drive Move's device-wide tempo via the Link override, so a
            // following Move tracks the knob (design §7 Phase 3).
            scheduleTempoOverride(next);
        }
    } else if (k === 1) {
        const next = Math.max(SWING_MIN, Math.min(SWING_MAX, seqState.swingPct + n));
        if (next !== seqState.swingPct) { seqState.swingPct = next; seqCmd('swing ' + next); }
    } else if (k === 2) {
        // Root knob cycles the pitch class within the current octave, wrapping at
        // the octave edges (B↔C); the +/- octave buttons change octave. setRoot
        // only updates state (the track-aware tick loop repaints pads), so this
        // never disturbs a drum rack / clip grid when used on a non-chromatic track.
        const base = keyboardState.rootNote;
        const oct  = Math.floor(base / 12) * 12;
        const pc   = (((base - oct + n) % 12) + 12) % 12;
        setRoot(oct + pc, track);
    } else if (k === 3 && mainPageState.scaleOverlay) {
        mainPageState.scaleSel = Math.max(0, Math.min(SCALE_NAMES.length - 1, mainPageState.scaleSel + n));
    } else if (k === 4) {
        // LINK toggle: turn right = ON, left = OFF. Persisted per set.
        const on = n > 0;
        if (on !== seqState.linkEnabled) {
            seqState.linkEnabled = on;
            seqCmd('link ' + (on ? 1 : 0));
            markUiStateDirty();
        }
    }
}

export function resetMainPage(): void {
    mainPageState.active = false;
    mainPageState.origin = 0;
    mainPageState.touchedKnob = -1;
    mainPageState.scaleOverlay = false;
    mainPageState.scaleSel = 0;
    accum.fill(0);
}
