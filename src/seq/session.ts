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

import { C_BLACK, C_DARKGREY, C_GREEN, C_WHITE, trackColor } from './colors.js';
import { seqCmd } from './engine.js';
import { seqToast } from './render.js';
import { seqState } from './state.js';

const COLS = 8;
const ROWS = 4;

/* Session Copy/Delete have their own held state (distinct from the Note-mode
 * step copy/delete in edit-ops). */
let copyHeld = false;
let copySrc: { track: number; slot: number } | null = null;
let pasteArmed = false;
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
    seqToast(seqState.sessionMode ? 'Session' : 'Note');
}

export function sessionCopyButton(down: boolean): void {
    if (down) {
        if (pasteArmed) { // cancel a pending paste
            pasteArmed = false;
            copySrc = null;
            seqToast('Copy cancelled');
            return;
        }
        copyHeld = true;
        copySrc = null;
    } else {
        copyHeld = false;
        if (copySrc) {
            seqCmd(`clipcopy ${copySrc.track} ${copySrc.slot}`);
            pasteArmed = true;
            seqToast('Clip copied');
        }
    }
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
        seqToast('Clip deleted');
        return;
    }
    if (copyHeld) {
        copySrc = { track, slot };
        return;
    }
    if (pasteArmed) {
        seqCmd(`clippaste ${track} ${slot}`);
        pasteArmed = false;
        seqToast('Clip pasted');
        return;
    }
    // Launch the clip (or select-empty-stops). Also retarget the watched
    // track so the step view follows.
    seqState.watchTrack = track;
    seqCmd(`launch ${track} ${slot}`);
}

/* Blink phase for pulsing cells, derived from the engine tick. */
function pulseOn(): boolean {
    return Math.floor(seqState.engineTick / 24) % 2 === 0;
}

export interface CellCtx {
    exists: boolean; isSel: boolean; isPlaying: boolean; isQueued: boolean;
    blink: boolean; track: number;
}

export function sessionCellColor(c: CellCtx): number {
    if (c.isQueued)             return c.blink ? C_GREEN : C_BLACK;                     // queued for launch
    if (c.isPlaying && c.isSel) return c.blink ? C_WHITE : C_BLACK;                    // playing+selected pulse
    if (c.isPlaying)            return C_WHITE;                                          // playing (solid)
    if (c.isSel && c.exists)    return c.blink ? C_WHITE : trackColor(c.track);         // selected w/ content
    if (c.isSel)                return C_DARKGREY;                                       // selected empty
    if (c.exists)               return trackColor(c.track);                              // has content
    return C_BLACK;                                                                      // empty
}

/* Paint the 32-pad clip grid (manual §17.1 LED semantics). */
export function sessionPaintGrid(setLed: (note: number, color: number) => void, padMin: number): void {
    const blink = pulseOn();
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
        const color = sessionCellColor({ exists, isSel, isPlaying, isQueued, blink, track });
        setLed(padMin + idx, color);
    }
}

export function resetSession(): void {
    copyHeld = false;
    copySrc = null;
    pasteArmed = false;
    deleteHeld = false;
}
