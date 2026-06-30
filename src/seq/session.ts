/* Session mode (manual §17): the Note/Session toggle turns the 32 pads into
 * the clip grid — one row per track, one column per clip slot. Pressing a
 * clip launches it (immediate when stopped, quantized to the next bar while
 * running); pressing an empty slot selects it and stops the track. Copy and
 * Delete held over a pad copy / delete that clip. Scenes are just pressing a
 * whole column (each pad launches/stops its own track).
 *
 * Pad layout: padNote 68 is bottom-left. The top row is track 0 (matching the
 * track buttons), the leftmost column is clip slot 0.
 *
 * The engine owns clip state; this module emits commands and paints the grid
 * LEDs from the `session` mirror, pulsing queued/stopping/selected cells. */

import { C_BLACK, C_DARKGREY, C_WHITE, trackColor, ANIM_NONE, ANIM_PULSE, ANIM_PULSE_FAST, ANIM_PULSE_SLOW } from './colors.js';
import { seqCmd, requestLabelSync } from './engine.js';
import { seqToast } from './render.js';
import { seqState } from './state.js';
import { appState } from '../app/state.js';
import { dupActive, onUnit as dupOnUnit } from './duplicate.js';

const COLS = 8;
const ROWS = 4;

/* Session Delete has its own held state (distinct from the Note-mode step
 * delete in edit-ops). Copy is handled by the shared duplicate gesture. */
let deleteHeld = false;

function padToCell(padNote: number, padMin: number): { track: number; slot: number } | null {
    const idx = padNote - padMin;
    if (idx < 0 || idx >= ROWS * COLS) return null;
    const rowFromBottom = Math.floor(idx / COLS);
    const slot = idx % COLS;
    const track = ROWS - 1 - rowFromBottom; // top row = track 0
    return { track, slot };
}

export function sessionActive(): boolean {
    return seqState.sessionMode;
}

export function sessionToggle(): void {
    seqState.sessionMode = !seqState.sessionMode;
    appState.masterDetail = false;   // always (re)enter the master chain on the slot grid
    seqToast(seqState.sessionMode ? 'Session' : 'Note');
}

export function sessionDeleteButton(down: boolean): void {
    deleteHeld = down;
}

/* Handle a session-grid pad press. Returns true (always consumed in session
 * mode). */
export function sessionPad(padNote: number, padMin: number): void {
    const cell = padToCell(padNote, padMin);
    if (!cell) return;
    const { track, slot } = cell;

    if (deleteHeld) {
        seqCmd(`clipdelat ${track} ${slot}`);
        requestLabelSync(); // freed lanes (clip's automation gone) → re-sync
        seqToast('Clip deleted');
        return;
    }
    if (dupActive()) {
        dupOnUnit({ kind: 'clip', track, slot });
        return;
    }
    // Launch the clip (or select-empty-stops). Also retarget the watched
    // track so the step view follows.
    seqState.watchTrack = track;
    seqCmd(`launch ${track} ${slot}`);
}

export interface CellCtx {
    exists: boolean; isSel: boolean; isPlaying: boolean; isQueued: boolean;
    track: number;
}
export interface CellLed { base: number; anim: number; channel: number; }

/* Native animation: `base` is the solid/channel-0 color; (`anim`,`channel`) is
 * the pulse target. Priority: queued > playing > selected > content > empty.
 * Two-color mapping (pulse base->white). On single-color firmware the same code
 * degrades to a white<->black pulse (the chosen fallback), since the base is
 * ignored once the pulse channel is set. */
export function sessionCellColor(c: CellCtx): CellLed {
    const tc = trackColor(c.track);
    if (c.isQueued)          return { base: c.exists ? tc : C_BLACK, anim: C_WHITE, channel: ANIM_PULSE_FAST }; // queued for launch
    if (c.isPlaying)         return { base: tc,        anim: C_WHITE,   channel: ANIM_PULSE };      // playing
    if (c.isSel && c.exists) return { base: tc,        anim: C_WHITE,   channel: ANIM_PULSE_SLOW }; // selected w/ content (focus)
    if (c.isSel)             return { base: C_DARKGREY, anim: C_DARKGREY, channel: ANIM_NONE };      // selected empty
    if (c.exists)            return { base: tc,        anim: tc,        channel: ANIM_NONE };        // has content
    return { base: C_BLACK, anim: C_BLACK, channel: ANIM_NONE };                                     // empty
}

/* Paint the 32-pad clip grid (manual §17.1 LED semantics) via the native
 * animation setter. */
export function sessionPaintGrid(
    setLed: (note: number, base: number, anim: number, channel: number) => void,
    padMin: number,
): void {
    for (let idx = 0; idx < ROWS * COLS; idx++) {
        const rowFromBottom = Math.floor(idx / COLS);
        const slot = idx % COLS;
        const track = ROWS - 1 - rowFromBottom;
        const st = seqState.session[track];
        const exists = (st.exist & (1 << slot)) !== 0;
        // Every track shows its own selected slot — no active-track special case.
        const isSel = st.selected === slot;
        const isPlaying = st.playing === slot;
        const isQueued = st.queued === slot;
        const led = sessionCellColor({ exists, isSel, isPlaying, isQueued, track });
        setLed(padMin + idx, led.base, led.anim, led.channel);
    }
}

export function resetSession(): void {
    deleteHeld = false;
}
