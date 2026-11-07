/* Mirror fields the UI writes optimistically, held against the engine's status
 * until the engine has applied the write.
 *
 * The flush and the snapshot read share one tick (engine.ts), so the status
 * parsed straight after a write was taken BEFORE the engine saw it. Adopting
 * that value reverted the mirror for a parse or two — with no repaint when the
 * true value came back, so the Shift+Step 16 panel kept showing the old box. */

/* key -> the request mark that carries the write; -1 until it is flushed. */
const writes = new Map<string, number>();

export function noteLocalWrite(key: string): void { writes.set(key, -1); }

/** At each flush: the writes queued since the last one ride this mark. Lazy,
 *  so a flush with nothing waiting costs no host call. */
export function stampLocalWrites(mark: () => number): void {
    for (const [k, m] of writes) if (m < 0) writes.set(k, mark());
}

/** Whether a status taken at `served` still predates the UI's write to `key`. */
export function localWritePending(key: string, served: number): boolean {
    const m = writes.get(key);
    if (m === undefined) return false;
    if (m < 0 || served < m) return true;
    writes.delete(key);
    return false;
}

export function resetLocalWrites(): void { writes.clear(); }
