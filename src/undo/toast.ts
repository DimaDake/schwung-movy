/* Undo toast lifetime. Split from label.ts so the renderer can stay pure and
 * label.ts stays a set of string helpers with no state. */

import { undoToastVM, UNDO_TOAST_TICKS, type UndoToastVM } from './label.js';
import type { UndoResult } from './types.js';

let vm: UndoToastVM | null = null;
let ticksLeft = 0;

export function showUndoToast(r: UndoResult, redo: boolean): void {
    vm = undoToastVM(r, redo);
    ticksLeft = UNDO_TOAST_TICKS;
}

export function undoToastActive(): boolean { return vm !== null; }
export function undoToast(): UndoToastVM | null { return vm; }

/** Returns true when the toast just expired, so the caller can mark dirty. */
export function undoToastTick(): boolean {
    if (vm === null) return false;
    if (--ticksLeft > 0) return false;
    vm = null;
    return true;
}

export function resetUndoToast(): void {
    vm = null;
    ticksLeft = 0;
}
