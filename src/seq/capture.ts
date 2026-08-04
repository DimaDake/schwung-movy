/* Retroactive capture, UI side: the Capture button, and the overlay the engine
 * opens after a capture made with the transport stopped.
 *
 * The engine owns the buffer, the take and the tempo maths. This file mirrors
 * just enough to draw the overlay and to move the selection: the per-tick
 * status poll carries the pending count and a generation counter, and only a
 * change in that generation costs one extra `capinfo` read. */

import { seqState } from './state.js';
import { seqCmd, engineReady } from './engine.js';
import { beginEdit, endEdit, CLOSE } from '../undo/group.js';
import { noteCount, trackLabel } from '../undo/label.js';
import { seqToast } from './render.js';
import { scheduleTempoOverride } from './tempo-override.js';
import { appState } from '../app/state.js';
import { mlog } from '../log.js';
import { markDeleteActed } from './edit-ops.js';

/* Note 9 — the main encoder's capacitive touch (knob touches are notes 0-7,
 * note 8 is the master/volume knob). */
const JOG_TOUCH = 9;

export interface CaptureState {
    /* 'none' = no overlay; 'select' = pick a tempo; 'fixed' = explain the fit. */
    overlay: 'none' | 'select' | 'fixed';
    cands: number[];
    idx: number;
    /* The tempo the take was read at (select: the applied candidate). */
    detected: number;
    /* The transport's tempo — differs from `detected` only in fixed mode. */
    bpm: number;
    why: 'ext' | 'notes' | '';
    bars: number;
    stretchPermille: number;
}

function blank(): CaptureState {
    return { overlay: 'none', cands: [], idx: 0, detected: 0, bpm: 0, why: '', bars: 0, stretchPermille: 0 };
}

export const captureState: CaptureState = blank();

let seenGen = -1;

export function captureOverlayActive(): boolean {
    return captureState.overlay !== 'none';
}

export function resetCapture(): void {
    Object.assign(captureState, blank());
    seenGen = -1;
}

/* Test hook: drive the view model without an engine. */
export function setCaptureStateForTest(s: Partial<CaptureState>): void {
    Object.assign(captureState, blank(), s);
}

function parseInfo(info: string): void {
    const f: Record<string, string> = {};
    for (const kv of info.split(' ')) {
        const eq = kv.indexOf('=');
        if (eq > 0) f[kv.slice(0, eq)] = kv.slice(eq + 1);
    }
    const mode = f.mode || 'none';
    captureState.overlay = mode === 'sel' ? 'select' : mode === 'fix' ? 'fixed' : 'none';
    captureState.cands = f.cands ? f.cands.split(',').map(Number).filter((n) => n > 0) : [];
    captureState.idx = Number(f.idx) || 0;
    captureState.detected = Number(f.det) || 0;
    captureState.bpm = Number(f.bpm) || 0;
    captureState.why = f.why === 'ext' ? 'ext' : f.why === 'notes' ? 'notes' : '';
    captureState.bars = Number(f.bars) || 0;
    captureState.stretchPermille = Number(f.stretch) || 0;
    if (captureState.overlay !== 'none' || mode === 'none') {
        mlog('seq: capture ' + (captureState.overlay === 'none' ? 'closed' : captureState.overlay)
             + ' bpm=' + captureState.bpm
             + ' bars=' + captureState.bars + (captureState.why ? ' why=' + captureState.why : ''));
    }
    appState.dirty = true;
}

/* Re-read the capture detail when the engine says it changed. Cheap by
 * construction: one get_param per commit or selection, never per tick. */
export function captureTick(): void {
    if (seqState.capGen === seenGen || seqState.capGen < 0) return;
    seenGen = seqState.capGen;
    if (typeof host_module_get_param !== 'function') return;
    const info = host_module_get_param('capinfo');
    if (info !== null) parseInfo(info);
}

/** Drop the buffered input — the view or the gesture has moved on. */
export function captureClear(): void {
    if (!engineReady()) return;
    seqCmd('capclr ' + seqState.watchTrack);
    seqState.capPending = 0;
}

/* Capture button. Hold Clear and press it to throw the buffer away — Move puts
 * that on Shift+Capture, but schwung's shim claims that combo for its skip-back
 * recorder and never forwards it, so a clear bound there would look like it
 * worked and do nothing. */
export function captureButton(clearHeld: boolean): void {
    if (!engineReady()) return;
    if (clearHeld) {
        markDeleteActed();   // this press consumed the Clear gesture
        seqToast(seqState.capPending > 0 ? 'Capture cleared' : 'Nothing buffered');
        captureClear();
        return;
    }
    if (seqState.capPending === 0) {
        seqToast('Nothing to capture');
        return;
    }
    const track = seqState.watchTrack;
    /* One undo for the whole capture: the commit, plus any tempo re-pick made
     * from the overlay before it is dismissed. Closed by closeCaptureOverlay,
     * with the idle timer covering a capture made while playing, which shows no
     * overlay to dismiss. */
    beginEdit({
        key: 'capture:' + track,
        verb: 'CAPTURE',
        target: trackLabel(track),
        detail: noteCount(seqState.capPending),
        close: CLOSE.IDLE, idleMs: 2000, seq: true,
    });
    seqCmd('cap ' + track);
    mlog('seq: capture commit trk=' + track + ' n=' + seqState.capPending);
    seqState.capPending = 0;
    if (seqState.playing) seqToast('Captured');
}

/** Jog while the selector is up: apply another candidate immediately. */
export function captureJog(delta: number): void {
    if (captureState.overlay !== 'select' || delta === 0) return;
    const n = captureState.cands.length;
    if (n < 2) return;
    const next = Math.max(0, Math.min(n - 1, captureState.idx + (delta > 0 ? 1 : -1)));
    if (next === captureState.idx) return;
    captureState.idx = next;
    captureState.bpm = captureState.cands[next];
    captureState.detected = captureState.bpm;
    seqCmd('capsel ' + next);
    // Move's tempo follows movy's, exactly as it does for the TEMPO knob.
    scheduleTempoOverride(captureState.bpm * 100);
    appState.dirty = true;
}

/* What a MIDI message means while the overlay is up. */
export type OverlayAction = 'jog' | 'swallow' | 'dismiss' | 'through';

/* The jog is the overlay's own control, and its capacitive touch (note 9) lands
 * before the first detent — dismissing on that closed the overlay just as you
 * reached for the tempo. Its touch and release are swallowed so nothing behind
 * the overlay acts on them either.
 *
 * Everything else that is a real press dismisses. Note the test is for a press,
 * not for "not a release": the shim emits empty [0,0,0] packets, and treating
 * those as presses dismissed the overlay ~30 ms after it opened. */
export function captureOverlayAction(data: number[]): OverlayAction {
    const type = data[0] & 0xF0;
    if (type === 0xB0 && data[1] === MoveMainKnob) return 'jog';
    if ((type === 0x90 || type === 0x80) && data[1] === JOG_TOUCH) return 'swallow';
    if ((type === 0x90 || type === 0xB0) && data[2] > 0) return 'dismiss';
    return 'through';
}

/** Any button, pad or knob touch closes the overlay and releases the take. */
export function captureDismiss(by?: number[]): void {
    if (captureState.overlay === 'none') return;
    captureState.overlay = 'none';
    if (by) mlog('seq: capture dismissed by ' + by.map((b) => b.toString(16)).join(' '));
    seqCmd('capdone');
    endEdit('capture:' + seqState.watchTrack);
    appState.dirty = true;
}
