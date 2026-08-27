/* Copy-on-inherit: Move's Copy/Paste makes a new set whose movy state doesn't
 * exist yet, and a user copying a set expects their sequence to come with it.
 * A copy is recognised by name ("X Copy", "X Copy 2") and seeded from the
 * best-matching family member that still has both a state file and a live
 * Move set. */

import {
    BLANK_STATE, MOVE_SETS_DIR, fileExists, loadNameIndex, provisionalIndex, removeSetState,
    uuidToStatePath,
} from './set-context.js';
import { readBestState, readUiBlob, writeStateBlob, writeUiBlob } from './persist-store.js';
import { mlog } from '../log.js';

/* How far up the per-visit seq to look. schwung's counter climbs once per
 * unresolved visit and never resets, so this is a recovery window rather than a
 * bound: devices in the field showed seqs up to 8. */
const ORPHAN_SEQ_MAX = 12;

/* State written before provisional ids were keyed by pad: one directory per
 * visit (`__pending-9-2` … `__pending-9-7`), each abandoned the moment the user
 * left the pad. The highest intact one is the most recent work, so it becomes
 * the pad's state and the per-visit directories go.
 *
 * Runs only for a pad that has no state of its own — which is once, since
 * adopting the orphan gives it some. */
function adoptOrphans(uuid: string): { payload: string; gen: number } | null {
    const idx = provisionalIndex(uuid);
    if (idx < 0) return null;
    let best: { payload: string; gen: number } | null = null;
    let bestSeq = 0;
    const found: string[] = [];
    for (let seq = 1; seq <= ORPHAN_SEQ_MAX; seq++) {
        const from = '__pending-' + idx + '-' + seq;
        const st = readBestState(from);
        if (!st) continue;
        found.push(from);
        if (seq >= bestSeq) { best = { payload: st.payload, gen: st.gen }; bestSeq = seq; }
    }
    if (!best || !writeStateBlob(uuid, best.payload, best.gen + 1)) return null;
    const ui = readUiBlob('__pending-' + idx + '-' + bestSeq);
    if (ui) writeUiBlob(uuid, ui);
    for (const from of found) removeSetState(from);
    mlog('seq: adopted orphaned pad state from ' + found.length + ' visit(s)');
    return { payload: best.payload, gen: best.gen + 1 };
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* Move's Copy/Paste appends " Copy" then " Copy N"; strip one level. */
export function stripCopySuffix(name: string): string | null {
    const m = (name || '').match(/^(.*?)\s+Copy(?:\s+\d+)?\s*$/);
    return m ? m[1].replace(/\s+$/, '') : null;
}

/* Family members (base name, or base + " Copy [N]") whose movy state file AND
 * backing Move set still exist. Sorted base-first, then shortest, then alpha.
 * Excludes the queried name so it never offers a no-op self-inherit. */
export function findInheritCandidates(
    name: string, idx: Record<string, string>,
): { uuid: string; name: string }[] {
    const base = stripCopySuffix(name);
    if (!base) return [];
    const re = new RegExp('^' + escapeRegex(base) + '(?:\\s+Copy(?:\\s+\\d+)?)?$');
    const out: { uuid: string; name: string }[] = [];
    for (const n in idx) {
        if (n === name || !re.test(n)) continue;
        const uuid = idx[n];
        if (!uuid) continue;
        // The canonical path is always written, so it alone answers "has state".
        if (!fileExists(uuidToStatePath(uuid))) continue;
        if (!fileExists(MOVE_SETS_DIR + '/' + uuid)) continue;
        out.push({ uuid, name: n });
    }
    out.sort((a, b) => {
        if (a.name === base) return -1;
        if (b.name === base) return 1;
        if (a.name.length !== b.name.length) return a.name.length - b.name.length;
        return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
    });
    return out;
}

/* The state to load for `uuid`: its own newest intact copy → best-match
 * inherit (seeded onto disk so the copy owns it from here on) → blank. The
 * generation comes back with it so the next save continues the sequence
 * instead of restarting at 1 and losing to a stale higher-numbered copy left
 * behind by an earlier session. */
export function resolveState(uuid: string, name: string): { payload: string; gen: number } {
    const own = readBestState(uuid);
    if (own) return own;

    const orphan = adoptOrphans(uuid);
    if (orphan) return orphan;

    const cands = findInheritCandidates(name, loadNameIndex());
    if (cands.length > 0) {
        const src = readBestState(cands[0].uuid);
        if (src && writeStateBlob(uuid, src.payload, 1)) {
            const ui = readUiBlob(cands[0].uuid);
            if (ui) writeUiBlob(uuid, ui);
            return { payload: src.payload, gen: 1 };
        }
    }
    return { payload: BLANK_STATE, gen: 0 };
}
