/* Toast text for an undo or redo.
 *
 * Labels are composed when the edit is CAPTURED, not when the toast is drawn —
 * by then the state they describe is gone. This file only turns a finished
 * UndoResult into the three lines the overlay renders. */

import type { UndoResult } from './types.js';

export interface UndoToastVM {
    head: string;    // "UNDO" / "REDO" / the failure reason
    verb: string;    // the operation
    detail: string;  // target + values
}

/* ~1 s at the 63-205 Hz device tick. Long enough to read three short lines,
 * short enough not to sit over the next gesture. */
export const UNDO_TOAST_TICKS = 120;

function failHead(reason: string | undefined, redo: boolean): string {
    if (reason === 'drift') return 'UNDO UNAVAILABLE';
    if (reason === 'busy') return 'UNDO BUSY';
    return redo ? 'NOTHING TO REDO' : 'NOTHING TO UNDO';
}

function failVerb(reason: string | undefined): string {
    if (reason === 'drift') return 'MODULE CHANGED';
    if (reason === 'busy') return 'RESTORE IN PROGRESS';
    return '';
}

export function undoToastVM(r: UndoResult, redo: boolean): UndoToastVM {
    if (!r.ok) {
        return { head: failHead(r.reason, redo), verb: failVerb(r.reason), detail: '' };
    }
    /* Target and detail share the bottom line: on a 128 px display two short
     * fields read better together than one field padded out. The separator is
     * ASCII because the pixel font only covers 0x20-0x7E (font/index.ts). */
    const parts: string[] = [];
    if (r.target) parts.push(r.target);
    if (r.detail) parts.push(r.detail);
    return {
        head: redo ? 'REDO' : 'UNDO',
        verb: r.verb,
        detail: parts.join(' - '),
    };
}

/** Track label used by every edit site, so "T2" means the same thing across
 *  the whole feature. */
export function trackLabel(track: number): string {
    return 'T' + (track + 1);
}

/** "T2 CLIP 3" — the common two-part target. */
export function clipTarget(track: number, slot: number): string {
    return trackLabel(track) + ' CLIP ' + (slot + 1);
}

/** "12 NOTES" / "1 NOTE" — plural agreement, since the toast is user-facing. */
export function noteCount(n: number): string {
    return n + (n === 1 ? ' NOTE' : ' NOTES');
}

/** "0.42 > 0.31" — a param's before and after. */
export function valueChange(from: string, to: string): string {
    return from + ' > ' + to;
}
