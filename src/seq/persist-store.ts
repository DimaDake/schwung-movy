/* File I/O for one Set, from the UI's side.
 *
 * The engine writes the state and the chains (set_store.rs). This side reads
 * chains.json and reads and writes ui-state.json; it never opens the state
 * file — whether that parses is the engine's answer (`sbad`).
 *
 * A write is read straight back and compared. That is not fsync — it cannot
 * prove the bytes reached flash — but it does catch what the host API can
 * actually go wrong with: ENOSPC, EACCES and short writes. */

import {
    ensureDir, uuidToChainsPath, uuidToUiStatePath,
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
