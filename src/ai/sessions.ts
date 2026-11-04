/* Parked generator sessions (preview.ts): one per clip, kept while the user
 * works elsewhere and taken back up on returning to that clip. RAM only — a
 * Set change, an undo or a restart ends them all. */

import { seqCmd } from '../seq/engine.js';

const parked = new Map<string, unknown>();

export const clipKey = (track: number, slot: number): string => track + ':' + slot;

export function parkSession<T>(key: string, o: T): void { parked.set(key, o); }

/** The session parked on `key`, removed from the parked set. */
export function takeSession<T>(key: string): T | undefined {
    const o = parked.get(key) as T | undefined;
    parked.delete(key);
    return o;
}

export function hasParked(): boolean { return parked.size > 0; }

/** Every parked session's clip, and none parked afterwards. */
export function clearParked(): string[] {
    const keys = [...parked.keys()];
    parked.clear();
    return keys;
}

/* The latest session kept on each clip (preview-undo.ts): an undo of its
 * entry reopens it; a newer run on the clip, a deleted clip or a Set change
 * forgets it. Each holds an engine stash of up to 48 clip copies, so only the
 * KEPT_CAP most recent stay; one dropped is freed, and its entry is then
 * plain history (the undo stack holds 64 entries, few of them kept sessions). */
export const KEPT_CAP = 16;
const latest = new Map<string, unknown>();
export function keepLatest<T>(key: string, o: T): void {
    latest.delete(key);   // to the newest end
    latest.set(key, o);
    for (const [k, old] of latest) {
        if (latest.size <= KEPT_CAP) break;
        latest.delete(k);
        /* Parked again after a reopen, it still shows from its stash. */
        if (parked.get(k) !== old) seqCmd('aiclr ' + k.replace(':', ' '));
    }
}
export function latestOn<T>(key: string): T | undefined { return latest.get(key) as T | undefined; }
export function forgetLatest(key?: string): void { if (key === undefined) latest.clear(); else latest.delete(key); }
