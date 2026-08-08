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
import { mutesSnapshot, restoreMutes } from '../mixer/track-mutes.js';
import { markUiStateDirty } from '../seq/persist.js';
import { seqState } from '../seq/state.js';
import { seqCmd } from '../seq/engine.js';
import { writePrefDefaultQuant } from '../seq/prefs.js';

export type UiField = 'rootPc' | 'scale' | 'mutes' | 'defaultQuant';

export function readUiField(f: UiField): string {
    if (f === 'rootPc') return String(keyboardState.rootPc);
    if (f === 'mutes') return JSON.stringify(mutesSnapshot());
    if (f === 'defaultQuant') return String(seqState.defaultQuant);
    return String(keyboardState.scale);
}

export function writeUiField(f: UiField, v: string): void {
    /* Solo bookkeeping: which track is soloed and the user's own mutes held
     * underneath it. The engine holds the DERIVED mutes and a seq snapshot
     * restores those; this is the half that lives only in movy, and without it
     * an undo would leave the two disagreeing — a latched solo over mutes that
     * no longer match it. */
    if (f === 'mutes') {
        try { restoreMutes(JSON.parse(v)); } catch {}
        markUiStateDirty();
        return;
    }
    const n = Number(v);
    if (!isFinite(n)) return;
    /* The engine consumes the default (it stamps clips on creation) but does
     * not persist it, and the prefs file is what carries it into the next new
     * set — so all three have to move together. */
    if (f === 'defaultQuant') {
        const q = Math.max(0, Math.min(100, n));
        seqState.defaultQuant = q;
        seqCmd('dq ' + q);
        writePrefDefaultQuant(q);
        markUiStateDirty();
        return;
    }
    if (f === 'rootPc') keyboardState.rootPc = n;
    else keyboardState.scale = n;
    markUiStateDirty();
}
