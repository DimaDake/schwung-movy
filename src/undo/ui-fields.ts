/* A third, tiny domain: set-level state that lives in the UI rather than in
 * the engine or in schwung.
 *
 * Root note and scale are musical settings the design puts in scope, but they
 * live in keyboardState and are persisted through seq/ui-state.ts — so neither
 * an engine snapshot nor a chain-param write can restore them. Rather than let
 * those knobs record an entry that silently does nothing, they get a named
 * field here with an explicit reader and writer.
 *
 * Deliberately a closed list. A generic "any UI field" mechanism would let
 * view state (which page is open, which pad is focused) become undoable by
 * accident, and design §1 excludes exactly that. */

import { keyboardState } from '../keyboard/state.js';
import { markUiStateDirty } from '../seq/persist.js';

export type UiField = 'rootPc' | 'scale';

export function readUiField(f: UiField): string {
    if (f === 'rootPc') return String(keyboardState.rootPc);
    return String(keyboardState.scale);
}

export function writeUiField(f: UiField, v: string): void {
    const n = Number(v);
    if (!isFinite(n)) return;
    if (f === 'rootPc') keyboardState.rootPc = n;
    else keyboardState.scale = n;
    markUiStateDirty();
}
