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

/* The head is the button's name, always — it is a label, not a result. What
 * happened goes in the body, so a failure fills the box the same way a success
 * does instead of leaving it looking half-drawn. */
function failBody(reason: string | undefined, redo: boolean): string[] {
    if (reason === 'drift') return ['UNAVAILABLE', 'MODULE CHANGED'];
    if (reason === 'busy') return ['BUSY', 'RESTORE IN PROGRESS'];
    return [redo ? 'NOTHING TO REDO' : 'NOTHING TO UNDO'];
}

export function undoToastVM(r: UndoResult, redo: boolean): UndoToastVM {
    if (!r.ok) {
        const [verb, detail] = failBody(r.reason, redo);
        return { head: redo ? 'REDO' : 'UNDO', verb, detail: detail ?? '' };
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
        detail: parts.join(': '),
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

/* Trailing zeros are an artefact of the wire format (floats are written with
 * four decimals), not something the user chose. */
function tidyNumber(v: string): string {
    if (!/^-?\d+\.\d+$/.test(v)) return v;
    return v.replace(/0+$/, '').replace(/\.$/, '');
}

/** The last segment of a path. A sample or preset path is far too long for a
 *  128 px line, and the overlay trims from the END — so left whole, the one
 *  part that identifies the file is the part that gets cut. */
function basename(v: string): string {
    const parts = v.split('/').filter((p) => p !== '');
    return parts.length > 0 ? parts[parts.length - 1] : v;
}

function tidy(v: string): string {
    if (v.indexOf('/') >= 0) return basename(v);
    return tidyNumber(v);
}

/** A module identifier as something readable: a track slot stores an id
 *  ("wurl"), a master FX slot a DSP path whose own basename is "dsp.so" — so
 *  the module is the directory above it. */
function moduleName(v: string): string {
    if (v === '') return 'NONE';
    if (v.indexOf('/') < 0) return v;
    const parts = v.split('/').filter((p) => p !== '' && !p.endsWith('.so'));
    return parts[parts.length - 1] ?? v;
}

/** "0.42 -> 0.31" — before and after, with the RESULT last. The arrow always
 *  points at what the value is now, so the same rendering reads correctly for
 *  an undo and for a redo; only the two ends swap. */
export function valueChange(from: string, to: string): string {
    return tidy(from) + ' -> ' + tidy(to);
}

/**
 * What this entry changed, in the direction being applied.
 *
 * Built here rather than at record time because the two directions read
 * differently: undoing goes from the value the edit set BACK to the original,
 * and redoing goes the other way. A string baked when the edit happened could
 * only ever describe one of them.
 */
export function changeDetail(e: {
    paramOps: { old: string; new: string }[];
    uiOps: { old: string; new: string }[];
    moduleOp?: { oldWrite: string; newWrite: string };
}, undoing: boolean): string {
    if (e.moduleOp) {
        const { oldWrite, newWrite } = e.moduleOp;
        return valueChange(moduleName(undoing ? newWrite : oldWrite),
                           moduleName(undoing ? oldWrite : newWrite));
    }
    const ops = [...e.paramOps, ...e.uiOps];
    if (ops.length === 0) return '';
    if (ops.length === 1) {
        const o = ops[0];
        return valueChange(undoing ? o.new : o.old, undoing ? o.old : o.new);
    }
    /* A gesture that moved several params at once (an LFO assignment writes
     * three) has no single before/after worth showing. */
    return ops.length + ' VALUES';
}
