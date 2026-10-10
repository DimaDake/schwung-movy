/* What the SETS page draws — computed without pixels, so the rows, the open
 * Set's mark and the confirm wording are testable on their own. */

import type { LibRow } from './sets-lib.js';

export interface SetsRowVM { name: string; clips: string; current: boolean; isNew: boolean; }
export interface SetsPageVM {
    /* `move`: Sets follow Move, nothing to list. `loading`: the library has
     * not answered yet. */
    mode: 'list' | 'move' | 'loading';
    rows: SetsRowVM[];
    selected: number;
    confirm: string | null;
}

export const NEW_ROW = '[NEW]';

export function buildSetsPageVM(movy: boolean, rows: LibRow[] | null, openId: string,
                                selected: number, confirming: boolean): SetsPageVM {
    if (!movy) return { mode: 'move', rows: [], selected: 0, confirm: null };
    if (!rows) return { mode: 'loading', rows: [], selected: 0, confirm: null };
    const out: SetsRowVM[] = [{ name: NEW_ROW, clips: '', current: false, isNew: true }];
    for (const r of rows) out.push({ name: r.name, clips: String(r.clips), current: r.id === openId, isNew: false });
    const sel = Math.max(0, Math.min(selected, out.length - 1));
    const target = out[sel];
    return { mode: 'list', rows: out, selected: sel,
             confirm: confirming && !target.isNew ? 'DELETE ' + target.name.toUpperCase() + '?' : null };
}
