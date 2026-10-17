/* File I/O for one Set, from the UI's side.
 *
 * The engine writes the state and the chains (set_store.rs); this side only
 * READS them, and writes nothing but ui-state.json.
 *
 * A write is read straight back and compared. That is not fsync — it cannot
 * prove the bytes reached flash — but it does catch what the host API can
 * actually go wrong with: ENOSPC, EACCES and short writes. */

import { parseState, ParsedState } from './persist-blob.js';
import {
    BLANK_STATE, ensureDir, shadowPath, uuidToChainsPath, uuidToStatePath, uuidToUiStatePath,
} from './set-context.js';
import { platform } from '../platform/index.js';

function readFile(path: string): string | null {
    return platform.readFile(path);
}

/** Write and confirm. `false` means the caller must keep the data pending. */
export function safeWrite(path: string, content: string): boolean {
    if (!platform.writeFile(path, content)) return false;
    return readFile(path) === content;
}

/** The newest intact copy of `uuid`'s state, or null if none survives. */
export function readBestState(uuid: string): ParsedState | null {
    const canon = parseState(readFile(uuidToStatePath(uuid)));

    /* A canonical file with no envelope was written by a build that predates
     * it — and such a build never touches the shadows. So if it carries real
     * content it is necessarily NEWER than any shadow, however high that
     * shadow's generation: the user downgraded, worked, and came back. Ordering
     * it by generation would silently restore the pre-downgrade set over it.
     *
     * "Real content" is the guard against the other reading: a canonical torn
     * down past its `gen` line also parses as legacy, but only as the bare tag,
     * and that must fall through to the shadows rather than blank the set. */
    if (canon && canon.legacy && canon.payload.length > BLANK_STATE.length) return canon;

    let best: ParsedState | null = canon;
    for (const p of [shadowPath(uuid, 1), shadowPath(uuid, 2)]) {
        const c = parseState(readFile(p));
        if (c && (!best || c.gen > best.gen)) best = c;
    }
    return best;
}

/** The engine's chain document. Read-only here — the engine owns this file,
 *  and a second writer is the shape this whole design exists to remove. */
export function readChainsFile(uuid: string): string | null {
    return readFile(uuidToChainsPath(uuid));
}

/* The UI blob (tonic, scale, layout, octaves, mutes) is deliberately NOT
 * rotated: it is JSON, so an envelope would break `JSON.parse` for older
 * builds, and a torn one costs the user their scale and mutes rather than
 * their music — applyUiState already falls back to defaults. It does get the
 * verified write, so a failed save is still retried. */
export function readUiBlob(uuid: string): string | null {
    return readFile(uuidToUiStatePath(uuid));
}

export function writeUiBlob(uuid: string, content: string): boolean {
    ensureDir(uuid);
    return safeWrite(uuidToUiStatePath(uuid), content);
}
