/* Durable file I/O for one set's state.
 *
 * Two things the old single-file writer could not do:
 *
 *  - Survive a torn write. schwung gives JS no rename and no fsync, so the
 *    substitute is redundancy: each save goes to one of two rotating shadow
 *    slots first and to the canonical seq-state.json last. Whatever the crash
 *    interrupts, a complete older copy is still on disk, and the envelope's
 *    checksum is what tells the two apart at load time.
 *
 *  - Notice a failed write. host_write_file's boolean was discarded while the
 *    engine had already cleared its dirty flag on the state read, so a write
 *    that failed was lost for good and nothing ever asked for it again. Every
 *    write is now read straight back and compared. That is not fsync — it
 *    cannot prove the bytes reached flash — but it does catch what the host
 *    API can actually go wrong with: ENOSPC, EACCES and short writes. */

import { wrapState, parseState, ParsedState } from './persist-blob.js';
import { BLANK_STATE, ensureDir, shadowPath, uuidToStatePath, uuidToUiStatePath } from './set-context.js';

function readFile(path: string): string | null {
    return (typeof host_read_file === 'function') ? host_read_file(path) : null;
}

/** Write and confirm. `false` means the caller must keep the data pending. */
export function safeWrite(path: string, content: string): boolean {
    if (typeof host_write_file !== 'function') return false;
    if (!host_write_file(path, content)) return false;
    return readFile(path) === content;
}

/* Which shadow slot the next save uses. Reset per set: starting a new set at
 * slot 1 can only overwrite an older generation, which is always safe. */
let slotUuid = '';
let nextSlot = 1;

export function resetStoreRotation(): void {
    slotUuid = '';
    nextSlot = 1;
}

/** Persist `payload` at generation `gen`. `false` = not durable anywhere. */
export function writeStateBlob(uuid: string, payload: string, gen: number): boolean {
    ensureDir(uuid);
    if (uuid !== slotUuid) { slotUuid = uuid; nextSlot = 1; }

    const wrapped = wrapState(payload, gen);
    if (!safeWrite(shadowPath(uuid, nextSlot), wrapped)) return false;
    nextSlot = nextSlot === 1 ? 2 : 1;

    /* The canonical path is written last because until it lands it still holds
     * the previous generation — the one thing worth protecting. Its failure is
     * not fatal: the shadow already verified, so the state IS durable and
     * readBestState will find it. Report success and let the next save retry. */
    safeWrite(uuidToStatePath(uuid), wrapped);
    return true;
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
